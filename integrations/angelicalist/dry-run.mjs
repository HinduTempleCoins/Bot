// dry-run.mjs — the END-TO-END DRY-RUN HARNESS for the angelicalist trade flow (task #69).
// It connects the existing order-sizing layer (execute.mjs: decide → bleed-guard → size → place)
// to the profit-sweep (skim to @kalivankush) and runs the WHOLE pipeline without ANY live trade.
//
// WHY this exists, and the hard safety rules it enforces (operator, 2026-06-01):
//   • The trade bot trades as the (already-breached) angelicalist account; profits skim to
//     @kalivankush, whose keys the operator keeps and the bot NEVER holds. This harness proves the
//     full flow — including the sweep — purely on paper.
//   • DRY-RUN IS THE DEFAULT and the ONLY mode this file offers. There is no live path here at all.
//     Market data and the broadcaster (signer) are INJECTED, so nothing touches the chain.
//   • No WIF, ever. The harness never reads, holds, logs, or asks for a private key. The injected
//     broadcaster is a spy/no-op; `assertNoLiveBroadcast()` proves it was never used.
//   • The SWAP.LTC bleed guard from execute.mjs is honoured — a BUY with no matching SELL leg in the
//     same cycle is blocked (the anti-drain lesson from the −6,424 HIVE SWAP.LTC bleed).
//
// REUSE: the per-order sizing + per-order cap live in execute.mjs (sizeOrder). We reuse it here and
// only add the orchestration: feed injected signals → guard → size (dry) → compute sweep.
//
//   node integrations/angelicalist/dry-run.mjs        # demo cycle on built-in fixtures, no network
//   import { dryRunCycle, planSweep, assertNoLiveBroadcast, summary } from './angelicalist/dry-run.mjs'

import { sizeOrder } from './execute.mjs';
import { market } from '../hive-engine-market.mjs';

export const SWEEP_TO = 'kalivankush';                                   // cold account; bot never holds its key
const SWEEP_THRESHOLD = +(process.env.SWEEP_THRESHOLD_HIVE || 5);       // only skim profit above this much
const round = (n) => +(+n).toFixed(8);

// A no-op broadcaster that records calls so the safety assertion can prove it was NEVER invoked.
// The real signer is in MELEK-Signer (elsewhere); this harness must never reach it.
export function makeSpyBroadcaster() {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return { simulated: true, blocked: 'dry-run harness: broadcasting is disabled' }; };
  fn.calls = calls;
  return fn;
}

// Provide injected per-symbol market metrics to execute.mjs's sizeOrder WITHOUT going to the network.
// sizeOrder reads `market.metrics(sym)`; we temporarily point that at the injected data for the call,
// then restore it. This keeps sizeOrder (the per-order cap + bleed-aware sizing) as the single source.
async function sizeWithInjectedMarket(decision, tokens, injectedMetrics) {
  if (!injectedMetrics) return sizeOrder(decision, tokens);            // fall back to the real module
  const original = market.metrics;
  market.metrics = async (sym) => injectedMetrics[sym] || null;
  try { return await sizeOrder(decision, tokens); }
  finally { market.metrics = original; }                              // always restore — never leak the stub
}

/**
 * planSweep — pure. Decide how much PROFIT to skim to @kalivankush, never the principal.
 * `balances` is { SWAP.HIVE|HIVE: <liquid>, principal: <the float we must keep> }.
 * Only the amount ABOVE (principal + threshold) is swept; below that, nothing moves.
 */
export function planSweep({ balances = {}, threshold = SWEEP_THRESHOLD, asset = 'SWAP.HIVE', principal = 0 } = {}) {
  const liquid = +(balances[asset] ?? balances.HIVE ?? 0) || 0;
  const keep = (+principal || 0) + (+threshold || 0);                  // never touch principal; leave threshold buffer
  const profit = liquid - keep;
  const amount = profit > 0 ? round(profit) : 0;
  return {
    to: SWEEP_TO,
    asset,
    amount,
    skim: amount > 0,
    reason: amount > 0
      ? `liquid ${round(liquid)} ${asset} − principal ${round(principal)} − buffer ${round(threshold)} = skim ${amount}`
      : `liquid ${round(liquid)} ${asset} ≤ principal ${round(principal)} + buffer ${round(threshold)} — keep all, sweep nothing`,
  };
}

/**
 * dryRunCycle — the full pipeline on paper: decide(injected) → bleed-guard → size(dry) → sweep.
 * Inputs:
 *   { market: { [sym]: {highestBid, lowestAsk} }, signals: [ {action:'BUY'|'SELL', sym, ...} ] }
 *   opts: { tokens, balances, principal, threshold, broadcaster }
 * Returns a complete plan with NO broadcasts performed.
 */
export async function dryRunCycle({ market: injectedMetrics = null, signals = [] } = {}, opts = {}) {
  const {
    tokens = [],
    balances = {},
    principal = 0,
    threshold = SWEEP_THRESHOLD,
    sweepAsset = 'SWAP.HIVE',
    broadcaster = makeSpyBroadcaster(),
  } = opts;

  const decisions = (signals || []).filter((d) => d && (d.action === 'BUY' || d.action === 'SELL'));

  // bleed guard (reused pattern from execute.mjs): drop any BUY without a matching SELL leg this cycle.
  const guarded = decisions.filter((d) => d.action !== 'BUY' || decisions.some((x) => x.sym === d.sym && x.action === 'SELL'));
  const blocked = decisions
    .filter((d) => !guarded.includes(d))
    .map((d) => ({ ...d, blocked: 'no-selling-leg (SWAP.LTC bleed guard)' }));

  // size each surviving decision via execute.mjs's sizeOrder (per-order cap + dust floor live there).
  const orders = [];
  for (const d of guarded) {
    const sized = await sizeWithInjectedMarket(d, tokens, injectedMetrics);
    orders.push(sized);
    // NOTE: we deliberately do NOT call placeOrder here. The harness never broadcasts; it plans only.
  }

  const sweep = planSweep({ balances, threshold, asset: sweepAsset, principal });

  return {
    at: new Date().toISOString(),
    dryRun: true,                 // load-bearing flag the safety assertion checks
    decisions: guarded,
    blocked,
    orders,
    sweep,
    broadcasts: [],               // ALWAYS empty — the harness performs no broadcasts
    broadcaster,                  // kept so callers/tests can assert it was never called
  };
}

/**
 * assertNoLiveBroadcast — the safety guarantee. Throws if the cycle was not dry-run, if any broadcast
 * was recorded on the result, or if the injected broadcaster spy was ever called.
 */
export function assertNoLiveBroadcast(result) {
  if (!result || result.dryRun !== true) throw new Error('SAFETY: result is not marked dryRun — a live path may have run');
  if (Array.isArray(result.broadcasts) && result.broadcasts.length > 0) throw new Error(`SAFETY: ${result.broadcasts.length} broadcast(s) recorded — expected zero`);
  const spy = result.broadcaster;
  if (spy && Array.isArray(spy.calls) && spy.calls.length > 0) throw new Error(`SAFETY: broadcaster was called ${spy.calls.length} time(s) — expected zero`);
  return true;
}

/** summary — human-readable dry-run report of what WOULD happen (nothing is executed). */
export function summary(result) {
  if (!result) return '(no result)';
  const lines = [];
  lines.push(`angelicalist DRY-RUN cycle — ${result.dryRun ? '🟢 DRY-RUN (no broadcasts)' : '⚠️ NOT DRY-RUN'}  (${result.at})`);
  if (!result.orders.length && !result.blocked.length) lines.push('  (nothing actionable — all HOLD)');
  for (const o of result.orders) {
    if (o.skip) { lines.push(`  [SKIP] ${o.sym}: ${o.skip}`); continue; }
    const econ = o.order.side === 'sell' ? `proceeds ~${o.proceedsHive} HIVE` : `spend ~${o.spendHive} HIVE`;
    lines.push(`  [WOULD ${o.order.side.toUpperCase()}] ${o.order.quantity} ${o.order.symbol} @ ${o.order.price}  (${econ})`);
  }
  for (const b of result.blocked) lines.push(`  [BLOCKED] ${b.sym}: ${b.blocked}`);
  const s = result.sweep;
  lines.push(s.skim
    ? `  [WOULD SWEEP] ${s.amount} ${s.asset} -> @${s.to}   (${s.reason})`
    : `  [NO SWEEP] ${s.reason}`);
  lines.push('  broadcasts performed: 0 (harness never signs; no WIF on this host)');
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('dry-run.mjs')) {
  // Built-in fixtures — fully offline. BTC has both legs (sizes); LTC is BUY-only (bleed-guard blocks).
  const injectedMarket = {
    'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' },
    'SWAP.LTC': { highestBid: '0.01', lowestAsk: '0.011' },
  };
  const signals = [
    { action: 'BUY', sym: 'SWAP.BTC', reason: 'demo discount' },
    { action: 'SELL', sym: 'SWAP.BTC', reason: 'demo premium' },
    { action: 'BUY', sym: 'SWAP.LTC', reason: 'demo one-way buy (should be blocked)' },
  ];
  const tokens = [{ symbol: 'SWAP.HIVE', balance: 100 }, { symbol: 'SWAP.BTC', balance: 20 }];
  const result = await dryRunCycle(
    { market: injectedMarket, signals },
    { tokens, balances: { 'SWAP.HIVE': 100 }, principal: 50, threshold: 5 },
  );
  assertNoLiveBroadcast(result);
  console.log(summary(result));
  console.log(`\nsafety: assertNoLiveBroadcast passed — broadcaster called ${result.broadcaster.calls.length} time(s).`);
}
