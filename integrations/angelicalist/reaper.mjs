// reaper.mjs — cancel the resting orders that can never fill, and put the inventory back in reach.
//
// WHY THIS EXISTS. `trader.mjs` has exported `cancel()` since 2026-06-16 and NOTHING HAS EVER CALLED
// IT. Every order the bot placed that did not fill immediately stayed on the book forever, holding
// its tokens inside the Hive-Engine market contract where no strategy can see or spend them. The
// count went 22 (2026-08-23) -> 31 (2026-09-16), and on 2026-09-16 every one of the 31 was a SELL
// priced above the top bid -- from 1.01x to 49,808x over it. Listed notional 103.77 HIVE; value at
// the real bids 58.02 HIVE; realized: nothing.
//
// A resting order is not a position and it is not profit. It is inventory parked where it cannot be
// spent. This module finds those orders and cancels them.
//
// ── THE HARD RULE ───────────────────────────────────────────────────────────────────────────────
// Cancelling MOVES NO FUNDS. The market contract returns the locked tokens to the same account that
// locked them. Nothing leaves @angelicalist, so this is inside the operator's rule that funds may
// leave only as genuine realized profit. It is the opposite of a dump: it RECOVERS inventory that a
// bad price had taken out of play, so it can be sold later into a real bid.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────────────────────────
// Dry-run by default, twice over: `plan()` is pure and never broadcasts, and `reap()` only executes
// when BOTH `--execute` is passed AND trader.mjs's existing gate (ANGELICALIST_LIVE + WIF) is open.
// Without both it returns the intended cancels as intents. It never places an order, only removes
// one, so the worst case of a bug here is that inventory becomes spendable again.
//
//   node integrations/angelicalist/reaper.mjs              # read-only: what would be cancelled
//   node integrations/angelicalist/reaper.mjs --execute    # cancel (still needs the live gate open)
//   import { plan, reap } from './angelicalist/reaper.mjs'

import { openOrders as liveOpenOrders, bidDepth as liveBidDepth, askDepth as liveAskDepth } from './internal.mjs';
import { cancel as liveCancel, mode } from './trader.mjs';

const ACCOUNT = process.env.ANGELICALIST_ACCOUNT || 'angelicalist';
// How far above the best opposing price an order may sit before we call it unfillable. A sell 2%
// over the top bid is a live quote waiting its turn; a sell 3x over it is furniture.
const REAP_OVER = +(process.env.REAP_OVER_BOOK || 1.05);
// A quote that has not filled in this many hours is not a quote, whatever its price says.
const REAP_AFTER_HOURS = +(process.env.REAP_AFTER_HOURS || 24);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/**
 * classify — pure. Decide one order's fate against the live book. No I/O.
 *
 *   order:  { side:'SELL'|'BUY', symbol, price, quantity, id, timestamp }
 *   book:   { topPrice }  best opposing price (highest bid for a SELL, lowest ask for a BUY)
 *   now:    ms epoch
 *
 * Returns { keep:boolean, reason, ratio, ageHours }.
 */
export function classify(order, book = {}, now = Date.now()) {
  const price = num(order?.price);
  const top = num(book?.topPrice);
  const side = String(order?.side || '').toUpperCase();
  const ts = num(order?.timestamp) * 1000;
  const ageHours = ts > 0 ? (now - ts) / 3.6e6 : 0;

  if (!(price > 0)) return { keep: false, reason: 'order has no price', ratio: null, ageHours };
  if (!(top > 0)) {
    return { keep: false, reason: `no opposing book at all for ${order.symbol} — nothing can ever fill this`, ratio: null, ageHours };
  }
  // for a SELL the order is unfillable when it sits ABOVE the best bid; for a BUY, BELOW the best ask.
  const ratio = side === 'SELL' ? price / top : top / price;
  if (ratio > REAP_OVER) {
    return { keep: false, reason: `${side} at ${price} is ${ratio.toFixed(2)}x away from the best opposing price ${top} — unfillable`, ratio, ageHours };
  }
  if (ageHours > REAP_AFTER_HOURS) {
    return { keep: false, reason: `${side} has rested ${ageHours.toFixed(1)}h without filling (limit ${REAP_AFTER_HOURS}h) — stale`, ratio, ageHours };
  }
  return { keep: true, reason: `within ${REAP_OVER}x of the book and ${ageHours.toFixed(1)}h old — still a live quote`, ratio, ageHours };
}

/**
 * plan — READ-ONLY. Look at every resting order and say which ones cannot fill. Never broadcasts.
 * All readers injectable so this runs fully offline in tests.
 */
export async function plan({
  account = ACCOUNT,
  getOpenOrders = liveOpenOrders,
  getBidDepth = liveBidDepth,
  getAskDepth = liveAskDepth,
  now = Date.now(),
} = {}) {
  const orders = await Promise.resolve()
    .then(() => getOpenOrders(account))
    .catch(() => []);
  const list = Array.isArray(orders) ? orders : [];

  // one book read per symbol per side, not per order.
  const books = new Map();
  const bookFor = async (symbol, side) => {
    const k = `${symbol}|${side}`;
    if (books.has(k)) return books.get(k);
    const read = side === 'SELL' ? getBidDepth : getAskDepth;
    const b = await Promise.resolve().then(() => read(symbol, 0)).catch(() => null);
    books.set(k, b);
    return b;
  };

  const cancels = [];
  const keeps = [];
  let lockedToken = 0, lockedListedHive = 0, recoverableHive = 0;
  for (const o of list) {
    const side = String(o.side || '').toUpperCase();
    const book = await bookFor(o.symbol, side);
    const verdict = classify(o, book || {}, now);
    const row = {
      id: o.id, txId: o.txId, side, symbol: o.symbol,
      quantity: num(o.quantity), price: num(o.price),
      topOpposing: num(book?.topPrice), ...verdict,
    };
    if (verdict.keep) { keeps.push(row); continue; }
    lockedToken += row.quantity;
    lockedListedHive += row.quantity * row.price;
    // what the tokens are actually worth at the real book, i.e. what cancelling puts back in play.
    if (side === 'SELL') recoverableHive += row.quantity * row.topOpposing;
    cancels.push(row);
  }

  return {
    at: new Date(now).toISOString(), account,
    openOrders: list.length,
    cancels, keeps,
    summary: {
      toCancel: cancels.length, toKeep: keeps.length,
      lockedToken: +lockedToken.toFixed(8),
      lockedListedHive: +lockedListedHive.toFixed(6),
      recoverableHive: +recoverableHive.toFixed(6),
    },
  };
}

/**
 * reap — execute the plan. DOUBLE-GATED: `execute` must be true AND trader.mjs's live gate
 * (ANGELICALIST_LIVE + a key) must be open. Otherwise every cancel is returned as an intent.
 * Cancelling moves no funds; it returns locked inventory to the account that locked it.
 */
export async function reap({ execute = false, doCancel = liveCancel, getMode = mode, spacingMs = 3500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ...planOpts } = {}) {
  const p = await plan(planOpts);
  const m = getMode();
  const armed = execute === true && m.live === true;
  const results = [];
  for (const c of p.cancels) {
    if (!armed) { results.push({ ...c, result: { intent: true, would: `CANCEL ${c.side.toLowerCase()} #${c.id} ${c.symbol}` } }); continue; }
    const r = await doCancel({ symbol: c.symbol, orderId: c.id, type: c.side.toLowerCase() }).catch((e) => ({ error: e.message }));
    results.push({ ...c, result: r });
    if (spacingMs > 0) await sleep(spacingMs);   // avoid duplicate-tx / RC throttling
  }
  return { ...p, armed, mode: m, results };
}

export function report(p) {
  const L = [];
  const s = p.summary;
  L.push(`angelicalist reaper — @${p.account}  ${p.armed === true ? '🔴 EXECUTING' : '🟢 DRY-RUN (no broadcast)'}  ${p.at}`);
  L.push(`  ${p.openOrders} resting order(s): ${s.toCancel} unfillable · ${s.toKeep} still live`);
  L.push(`  locked by the unfillable ones: ${s.lockedListedHive} HIVE at their listed prices, ${s.recoverableHive} HIVE at the real book`);
  for (const c of (p.results || p.cancels)) {
    const tag = c.result ? (c.result.intent ? 'WOULD CANCEL' : c.result.error ? `ERROR ${c.result.error}` : c.result.simulated ? 'SIMULATED' : `CANCELLED tx ${c.result.txId}`) : 'CANCEL';
    L.push(`  [${tag}] ${c.side} ${c.quantity} ${c.symbol} @ ${c.price} — ${c.reason}`);
  }
  if (!(p.results || p.cancels).length) L.push('  nothing to reap — every resting order is within reach of the book.');
  return L.join('\n');
}

export default { classify, plan, reap, report };

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('reaper.mjs')) {
  const execute = process.argv.includes('--execute');
  const r = await reap({ execute }).catch((e) => ({ error: e.message }));
  if (r.error) { console.error('reaper error:', r.error); process.exit(1); }
  console.log(report(r));
  if (!r.armed && r.cancels.length) {
    console.log('\n  Nothing was broadcast. Run with --execute (and ANGELICALIST_LIVE=true + key) to cancel.');
  }
}
