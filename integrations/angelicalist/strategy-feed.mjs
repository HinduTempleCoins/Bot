// strategy-feed.mjs — the fix for "SPS made +76 HIVE but was never wired into the executor."
//
// The live loop's ONLY decision source is trade-presets.simulate() — SWAP peg-arb over SWAP_PAIRS, a
// universe the account holds nothing tradeable in, so it correctly HOLDs every tick and earns $0. The
// only thing that ever made money on-chain (SPS / Splinterlands) sat in WATCH_TOKENS, never on the
// tradeable path. This module turns the already-registered strategies in ../trade-strategies.mjs
// (momentum / grid / market-make — the frozen decide(name,ctx)→{orders} shape) into decisions the loop
// can act on for SPS/DEC, in the EXACT shape execute.sizeOrder expects: { action:'BUY'|'SELL', sym, ... }.
//
// ── DEFAULT OFF (zero behavior change) ──────────────────────────────────────────────────────────────
// `MOMENTUM_TOKENS` is empty by default → strategyDecisions() returns [] → the loop is byte-for-byte
// unchanged until the operator opts a token in. Turning it on is one env line (surfaced in the go-live
// doc), and even then the loop's guards (bleed-guard, dead-book reject, thin-depth skip, buy-first)
// and execute.sizeOrder's caps/dust-floor still bind every resulting order. Nothing here signs or
// broadcasts — it only produces decisions; the existing single signing gate (trader.mjs) is untouched.
//
// ── how it honors the guards (important) ────────────────────────────────────────────────────────────
// The momentum core only BUYs when flat (single unit, no pyramiding) and SELLs the whole position on
// exit. In the loop, a BUY with no same-tick SELL leg is bleed-guarded to WATCH — so under the current
// guards this feed's realized-profit path is SELLING HELD INVENTORY INTO STRENGTH (a round-trip close
// against earlier buys), which is exactly the disciplined, buy-first version of what SPS did to make
// +76 HIVE. Seeding an initial position to let entries execute is an operator funding decision.

import { decide, listStrategies } from '../trade-strategies.mjs';

function list(v, dflt) {
  if (v == null || v === '') return dflt.slice();
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}
const num = (x, d = NaN) => (Number.isFinite(+x) ? +x : d);

/** Tokens the strategy feed is authorized to trade. DEFAULT EMPTY = feed off. */
export function momentumTokens() { return list(process.env.MOMENTUM_TOKENS, []); }
/** Which registered strategy to run. Default 'momentum' (mean/trend, single-unit, bounded). */
export function strategyName() { return process.env.MOMENTUM_STRATEGY || 'momentum'; }

// Translate a strategy core's frozen orders into the loop's decision shape.
function toDecisions(res, sym, strategy) {
  return (res?.orders || []).map((o) => ({
    action: String(o.side || '').toUpperCase(),
    sym: o.symbol || sym,
    reason: o.reason || res?.reason || `${strategy} signal`,
    strategy,
    // heldBalance is advisory; execute.sizeOrder re-reads the real balance for SELLs itself.
    heldBalance: num(o.qtyToken),
  })).filter((d) => d.action === 'BUY' || d.action === 'SELL');
}

/**
 * Produce strategy decisions for the opted-in tokens. Pure/injectable:
 *   getSnapshot(sym) -> { fast, slow, hePrice|mid, center, ... }   (market snapshot for the core)
 *   getState(sym)    -> { inventoryToken, ... }                    (position state; drives entry/exit)
 * Both default to soft-failing live loaders. With no tokens opted in, returns [] (feed off).
 */
export async function strategyDecisions({
  tokens = momentumTokens(),
  strategy = strategyName(),
  getSnapshot = liveSnapshot,
  getState = liveState,
  params = {},
} = {}) {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  const valid = new Set(listStrategies().map((s) => s.name));
  if (!valid.has(strategy)) return [];
  const out = [];
  for (const sym of tokens) {
    try {
      const snap = await getSnapshot(sym);
      if (!snap) continue;
      const state = (await getState(sym)) || {};
      const res = decide(strategy, { symbol: sym, ...snap }, params[sym] || params.default || params, state);
      out.push(...toDecisions(res, sym, strategy));
    } catch { /* soft-fail per symbol — one bad snapshot never breaks the tick */ }
  }
  return out;
}

// ── default LIVE loaders (soft-fail; only reached when a token is opted in) ──────────────────────────
// A fast/slow SMA snapshot from recent Hive-Engine trade history + current book mid. All best-effort:
// any failure returns null and that symbol is simply skipped this tick.
async function liveSnapshot(sym) {
  try {
    const m = await import('../hive-engine-market.mjs');
    const metrics = await m.market.metrics(sym).catch(() => null);
    if (!metrics) return null;
    const mid = (num(metrics.highestBid) + num(metrics.lowestAsk)) / 2 || num(metrics.lastPrice);
    if (!(mid > 0)) return null;
    // fast/slow from recent trades if available; otherwise fall back to lastPrice-based flat signal.
    let fast = mid, slow = num(metrics.lastPrice, mid);
    try {
      const trades = await m.market.tradesHistory?.(sym, 50).catch(() => []);
      const prices = (trades || []).map((t) => num(t.price)).filter((x) => x > 0);
      if (prices.length >= 6) {
        const sma = (arr, n) => arr.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, arr.length);
        fast = sma(prices, 6); slow = sma(prices, prices.length);
      }
    } catch {}
    return { fast, slow, hePrice: mid, mid, center: slow };
  } catch { return null; }
}

async function liveState(sym) {
  try {
    const { tokenBalances } = await import('./internal.mjs');
    const bals = await tokenBalances().catch(() => []);
    const t = (bals || []).find((x) => x.symbol === sym);
    return { inventoryToken: t ? num(t.balance, 0) : 0 };
  } catch { return {}; }
}

// ── fee-clearing sizing recommendation (advisory; default cap stays safe/unchanged) ─────────────────
// A HE round-trip costs ~2% (both legs + walk). At the current 4-HIVE (~$0.25) cap a 2% edge nets a
// few tenths of a cent — noise. This computes the per-order HIVE notional needed for a target NET
// dollar profit after fees, given the edge. It only RECOMMENDS; MAX_ORDER_HIVE stays env-driven and
// defaults safe (the operator sets the funded size).
export function recommendedCapHive({ hiveUsd = 0.05, edgePct = 3, roundTripFeePct = 2, targetNetUsd = 1 } = {}) {
  const netPct = Math.max(0, num(edgePct, 0) - num(roundTripFeePct, 0)) / 100; // net edge after fees
  if (!(netPct > 0) || !(hiveUsd > 0)) return { capHive: null, note: 'no net edge after fees — no size clears' };
  const notionalUsd = num(targetNetUsd, 1) / netPct;   // $ notional whose net edge = target profit
  const capHive = Math.ceil(notionalUsd / hiveUsd);
  return { capHive, notionalUsd: +notionalUsd.toFixed(2), netEdgePct: +(netPct * 100).toFixed(2),
    note: `to net ~$${targetNetUsd} at ${edgePct}% edge (−${roundTripFeePct}% fees), size ≈ ${capHive} HIVE (~$${(capHive * hiveUsd).toFixed(2)}); current default cap is safe/smaller.` };
}

export default { momentumTokens, strategyName, strategyDecisions, recommendedCapHive };
