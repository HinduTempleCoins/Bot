// execute.mjs — turns the preset BUY/SELL decisions into CONCRETE, SIZED HIVE-Engine orders and
// (only when LIVE) places them. This is the piece that was missing: trader.mjs decided, but never
// sized an order. Here we size from live depth + the account's real balances, cap every order, and
// honor the SWAP.LTC bleed guard.
//
// SAFETY:
//   • DRY-RUN IS THE DEFAULT. placeOrder() (trader.mjs) only broadcasts when ANGELICALIST_LIVE==='true'
//     AND a key is present. Without both, every order is simulated and printed.
//   • Hard per-order cap: MAX_ORDER_HIVE (default 10). No single order can spend/clear more than this.
//   • Dust floor: MIN_ORDER_HIVE (default 1). Skips trades too small to matter.
//   • Bleed guard: a BUY with no matching SELL leg in the same run is blocked (anti-SWAP.LTC).
//
//   node integrations/angelicalist/execute.mjs                                  # dry-run: size + simulate
//   ANGELICALIST_LIVE=true ANGELICALIST_WIF=<wif> node integrations/angelicalist/execute.mjs   # live

import { placeOrder, mode } from './trader.mjs';
import { simulate } from '../trade-presets.mjs';
import { market } from '../hive-engine-market.mjs';
import { tokenBalances } from './internal.mjs';

const MAX_ORDER_HIVE = +(process.env.MAX_ORDER_HIVE || 10); // hard per-order ceiling (in SWAP.HIVE)
const MIN_ORDER_HIVE = +(process.env.MIN_ORDER_HIVE || 1);  // dust floor — skip below this

const round = (n) => +(+n).toFixed(8);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const balOf = (tokens, symbol) => {
  const t = tokens.find((x) => x.symbol === symbol);
  return t ? t.balance : 0;
};

// ─── INVENTORY-SKEW GUARD (Avellaneda–Stoikov inventory-risk idea) ──────────────────────────────
// ADOPT note: the upstream concept is from Hummingbot's pure-market-making strategy (Apache-2.0),
// which itself implements the Avellaneda–Stoikov (2008) inventory-risk model. CONCEPT borrowed, code
// is our own. The A–S insight, simplified: a market maker holding too much of one asset on a THIN
// book carries inventory risk — if the price moves against the lopsided position there is no easy
// exit. The principled response is to bias order flow back toward a target inventory: shrink (or
// zero) the orders that would pile on MORE of the over-held asset, and lean slightly into the orders
// that rebalance. This is the named lesson of the −6,424 HIVE SWAP.LTC bleed: the danger was not any
// single buy but the relentless one-sided accumulation. The hard bleed guard in autoTrade() (a BUY
// with no SELL leg is blocked outright) STAYS as the floor; this skew guard sits ABOVE it and tempers
// the size of the orders that survive, so even a fully-legged BUY shrinks as we get heavy on a side.

// inventorySkew — how far inventory is tilted from target, normalized to q ∈ [-1, 1].
//   q = 0  → at target (balanced)
//   q → +1 → almost entirely BASE (over-held the risky asset; e.g. all SWAP.LTC)
//   q → -1 → almost entirely QUOTE (e.g. all SWAP.HIVE)
// Both balances are measured in the SAME unit by the caller (or both as raw token counts when a
// like-for-like comparison is intended). targetRatio is the desired BASE share of the two-asset book.
export function inventorySkew({ baseBalance = 0, quoteBalance = 0, targetRatio = 0.5 } = {}) {
  const base = Math.max(0, +baseBalance || 0);
  const quote = Math.max(0, +quoteBalance || 0);
  const total = base + quote;
  if (total <= 0) return 0;                       // nothing held → no skew
  const baseShare = base / total;                 // actual BASE fraction of the book, in [0,1]
  const t = clamp(+targetRatio || 0, 0, 1);
  // map deviation from target onto [-1,1]: at-target=0, all-base=+1, all-quote=-1, monotonic either way.
  const dev = baseShare - t;
  const span = dev >= 0 ? (1 - t) : t;            // distance from target to the relevant extreme
  if (span <= 0) return dev >= 0 ? 1 : -1;        // degenerate target (0 or 1): saturate
  return clamp(dev / span, -1, 1);
}

// skewAdjustedSize — scale a base order size by the inventory skew, A–S style.
//   `increasesSkew` = true when filling this order would push inventory FURTHER from target (i.e. a
//   BUY of base while already base-heavy, or a SELL of base while already base-light). Those orders
//   are shrunk toward zero as |skew| grows, reaching 0 at the extreme. Orders that REDUCE skew are
//   left as-is and may be mildly boosted (capped). Monotonic in skew, never negative, never > cap.
// `aggressiveness` ∈ (0, ∞) controls how hard we throttle: 1 = linear; >1 = throttle harder.
export function skewAdjustedSize(baseSize, skew, { aggressiveness = 1, cap = Infinity, increasesSkew = true } = {}) {
  const size = Math.max(0, +baseSize || 0);
  if (size === 0) return 0;
  const q = clamp(+skew || 0, -1, 1);
  const a = Math.max(0, +aggressiveness || 0);
  const mag = Math.abs(q);                         // how far from target, 0..1

  if (increasesSkew) {
    // throttle: factor goes 1 → 0 as the relevant-side skew goes 0 → 1. (1-mag)^a is monotone-decreasing
    // in mag and exactly 0 at mag=1 (full skew → order zeroed). a>1 throttles sooner/harder.
    const factor = Math.pow(1 - mag, a);
    return Math.min(round(size * factor), cap);
  }
  // order REDUCES skew: lean in mildly, but never above the per-order cap.
  const factor = 1 + mag;                          // up to 2× at the extreme
  return Math.min(round(size * factor), cap);
}

// size one BUY/SELL decision into a concrete order using live depth + the account's balances.
// `inventory` (optional) enables the A–S inventory-skew guard. When omitted, sizing is IDENTICAL to
// the original behavior (backward compatible — proven in execute.test.mjs).
//   inventory: { baseBalance, quoteBalance, targetRatio?, aggressiveness? }
export async function sizeOrder(decision, tokens, inventory = null) {
  const { action, sym } = decision;
  const m = await market.metrics(sym).catch(() => null);
  if (!m) return { ...decision, skip: 'no market metrics' };

  // Compute the skew adjustment factor once (if inventory provided). A BUY increases base inventory,
  // so it INCREASES skew when we're already base-heavy (q>0). A SELL reduces base, so it increases
  // skew when we're base-LIGHT (q<0). We capture direction by sign of skew vs. the order side.
  const skew = inventory ? inventorySkew(inventory) : 0;
  const aggressiveness = inventory && inventory.aggressiveness != null ? +inventory.aggressiveness : 1;
  const adjustQty = (qty, side) => {
    if (!inventory) return qty;                    // backward compatible: no inventory → untouched
    const increasesSkew = side === 'buy' ? skew > 0 : skew < 0;
    return skewAdjustedSize(qty, skew, { aggressiveness, cap: qty, increasesSkew });
  };

  if (action === 'SELL') {
    const have = balOf(tokens, sym);
    if (have <= 0) return { ...decision, skip: `no ${sym} balance to sell` };
    const price = +m.highestBid;
    if (!price) return { ...decision, skip: 'no bid to hit' };
    let qty = Math.min(have, MAX_ORDER_HIVE / price); // cap proceeds at MAX_ORDER_HIVE
    qty = adjustQty(qty, 'sell');
    const proceeds = qty * price;
    if (proceeds < MIN_ORDER_HIVE) return { ...decision, skip: `proceeds ${proceeds.toFixed(3)} < min ${MIN_ORDER_HIVE} HIVE` };
    return { ...decision, order: { side: 'sell', symbol: sym, quantity: round(qty), price: round(price) }, proceedsHive: +proceeds.toFixed(4) };
  }

  if (action === 'BUY') {
    const swapHive = balOf(tokens, 'SWAP.HIVE');
    const price = +m.lowestAsk;
    if (!price) return { ...decision, skip: 'no ask to lift' };
    let spend = Math.min(MAX_ORDER_HIVE, swapHive);
    let qty = spend / price;
    qty = adjustQty(qty, 'buy');
    spend = qty * price;                            // recompute spend from the (possibly shrunk) qty
    if (spend < MIN_ORDER_HIVE) return { ...decision, skip: `SWAP.HIVE balance ${swapHive.toFixed(3)} < min ${MIN_ORDER_HIVE} (skew-throttled spend ${spend.toFixed(3)})` };
    return { ...decision, order: { side: 'buy', symbol: sym, quantity: round(qty), price: round(price) }, spendHive: +spend.toFixed(4) };
  }

  return { ...decision, skip: `action ${action} not executable` };
}

// skewReport — plain-English description of the current inventory tilt and what it does to order flow.
export function skewReport({ baseBalance = 0, quoteBalance = 0, targetRatio = 0.5, baseSymbol = 'base', quoteSymbol = 'quote' } = {}) {
  const base = Math.max(0, +baseBalance || 0);
  const quote = Math.max(0, +quoteBalance || 0);
  const total = base + quote;
  if (total <= 0) return 'inventory is empty — nothing held, no skew, sizing unaffected.';
  const q = inventorySkew({ baseBalance, quoteBalance, targetRatio });
  const basePct = Math.round((base / total) * 100);
  const quotePct = 100 - basePct;
  const near = Math.abs(q) < 0.1;
  if (near) return `inventory is balanced (${basePct}% ${baseSymbol} / ${quotePct}% ${quoteSymbol}) — no skew throttle, orders sized normally.`;
  if (q > 0) {
    return `inventory is ${basePct}% ${baseSymbol} — over-held; buys throttled until it rebalances (sells of ${baseSymbol} leaned into).`;
  }
  return `inventory is ${quotePct}% ${quoteSymbol} — light on ${baseSymbol}; sells of ${baseSymbol} throttled until it rebalances (buys leaned into).`;
}

// full loop: decide → bleed-guard → size → place (gated). Returns a structured report.
export async function autoTrade() {
  const m = mode();
  const decisions = await simulate();
  const actionable = decisions.filter((d) => d.action === 'SELL' || d.action === 'BUY');

  // bleed guard: drop any BUY that has no matching SELL leg in this same run (anti-SWAP.LTC drain).
  const guarded = actionable.filter((d) => d.action !== 'BUY' || actionable.some((x) => x.sym === d.sym && x.action === 'SELL'));
  const blocked = actionable
    .filter((d) => !guarded.includes(d))
    .map((d) => ({ ...d, blocked: 'no-selling-leg (SWAP.LTC bleed guard)' }));

  const tokens = await tokenBalances();
  const placed = [];
  for (const d of guarded) {
    const sized = await sizeOrder(d, tokens);
    if (sized.skip) { placed.push(sized); continue; }
    const result = await placeOrder(sized.order); // gated: simulated unless LIVE + key present
    placed.push({ ...sized, result });
  }

  return { mode: m, capHive: MAX_ORDER_HIVE, minHive: MIN_ORDER_HIVE, placed, blocked };
}

function report(r) {
  if (r.error) { console.log('error:', r.error); return; }
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] angelicalist auto-trade — ${r.mode.live ? '🔴 LIVE' : '🟢 DRY-RUN (default)'}  cap=${r.capHive} HIVE/order  account=@${r.mode.account} sweep->@${r.mode.sweepTo}`);
  console.log(`  key present: ${r.mode.hasKey}   live flag: ${r.mode.flagLive}   -> broadcasting: ${r.mode.live}`);
  if (!r.placed.length && !r.blocked.length) console.log('  (all HOLD — nothing actionable right now)');
  for (const p of r.placed) {
    if (p.skip) { console.log(`  [SKIP] ${p.sym}: ${p.skip}`); continue; }
    const tag = p.result?.simulated ? 'SIMULATED' : `LIVE tx ${p.result?.txId}`;
    const econ = p.order.side === 'sell' ? `proceeds ~${p.proceedsHive} HIVE` : `spend ~${p.spendHive} HIVE`;
    console.log(`  [${p.order.side.toUpperCase()}] ${p.order.quantity} ${p.order.symbol} @ ${p.order.price}  (${econ})  ${tag}`);
  }
  for (const b of r.blocked) console.log(`  [BLOCKED] ${b.sym}: ${b.blocked}`);
}

if (process.argv[1] && process.argv[1].endsWith('execute.mjs')) {
  const loop = process.argv.includes('--loop') || process.argv.includes('--cron');
  const everyMin = +(process.env.TRADE_INTERVAL_MIN || 5);
  const once = async () => report(await autoTrade().catch((e) => ({ error: e.message })));
  await once();
  if (loop) {
    console.log(`\n  looping every ${everyMin} min — Ctrl-C to stop.`);
    setInterval(once, everyMin * 60 * 1000);
  }
}
