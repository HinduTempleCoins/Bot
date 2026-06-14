// trader.mjs — the angelicalist HIVE-Engine trade layer. KEY FROM ENV, NEVER COMMITTED.
//
// Operator 2026-06-01: trade on the already-breached angelicalist account, sweep profits to
// kalivankush (which we never get the key to). Safety posture, given the prior −6,424 HIVE
// SWAP.LTC bleed:
//   • The active WIF is read ONLY from process.env.ANGELICALIST_WIF (or the vault at runtime).
//     It is NEVER hard-coded, NEVER logged, NEVER committed. The git guard blocks WIF shapes.
//   • DRY-RUN IS THE DEFAULT. Nothing broadcasts unless ANGELICALIST_LIVE === 'true' AND a key
//     is present. Without both, every action is simulated and printed.
//   • The SWAP.LTC bleed guard (no one-way accumulation) from trade-presets is honoured.
//   • Profits sweep to kalivankush (receiving needs no key) so the hot account stays near-empty.
//
//   ANGELICALIST_LIVE=true ANGELICALIST_WIF=<active-wif> node integrations/angelicalist/trader.mjs
//   (no env) node integrations/angelicalist/trader.mjs   # dry-run: prints intended actions
//   import { placeOrder, sweepToKali, runPresets } from './angelicalist/trader.mjs'

import { Client, PrivateKey } from '@hiveio/dhive';
import { simulate } from '../trade-presets.mjs';
import { market } from '../hive-engine-market.mjs';

const HIVE_NODES = (process.env.HIVE_NODES || 'https://api.hive.blog,https://api.deathwing.me,https://rpc.mahdiyari.info').split(',');
const ACCOUNT = process.env.ANGELICALIST_ACCOUNT || 'angelicalist';
const SWEEP_TO = process.env.SWEEP_TO_ACCOUNT || 'kalivankush';
const SSC_ID = 'ssc-mainnet-hive';
const client = new Client(HIVE_NODES, { timeout: 8000, failoverThreshold: 3 });

// LIVE only when explicitly enabled AND a key is present. Default = dry-run.
const LIVE = process.env.ANGELICALIST_LIVE === 'true';
function activeKey() {
  const wif = process.env.ANGELICALIST_WIF || '';
  if (!wif) return null;
  try { return PrivateKey.fromString(wif); } catch { return null; }
}
export function mode() {
  const hasKey = !!process.env.ANGELICALIST_WIF;
  return { live: LIVE && hasKey, hasKey, flagLive: LIVE, account: ACCOUNT, sweepTo: SWEEP_TO };
}

// broadcast a HIVE-Engine custom_json with the active key — the ONLY place that signs. Gated.
async function broadcastSSC(payload, { actionLabel }) {
  const key = activeKey();
  if (!LIVE || !key) {
    return { simulated: true, would: actionLabel, payload }; // dry-run: never touches the chain
  }
  const op = ['custom_json', { required_auths: [ACCOUNT], required_posting_auths: [], id: SSC_ID, json: JSON.stringify(payload) }];
  const r = await client.broadcast.sendOperations([op], key);
  return { simulated: false, txId: r.id, action: actionLabel };
}

// place a HIVE-Engine market order (buy/sell). quantity + price are strings/numbers in the token's terms.
export async function placeOrder({ side, symbol, quantity, price }) {
  if (!['buy', 'sell'].includes(side)) throw new Error("side must be 'buy' or 'sell'");
  const payload = { contractName: 'market', contractAction: side, contractPayload: { symbol, quantity: String(quantity), price: String(price) } };
  return broadcastSSC(payload, { actionLabel: `${side.toUpperCase()} ${quantity} ${symbol} @ ${price}` });
}

// cancel a resting HIVE-Engine market order by id. Needed by the VKBT outbid-ratchet
// (price-nudge.mjs) to pull a stale bid before placing a higher one — without this, price-nudge
// guards the call (`typeof trader.cancel === 'function'`) and SILENTLY SKIPS, so stale bids pile up.
// HE market cancel payload: { type: 'buy'|'sell', id }. Dry-run unless LIVE + key, like every write.
export async function cancel({ symbol, orderId, type = 'buy' }) {
  if (!['buy', 'sell'].includes(type)) throw new Error("type must be 'buy' or 'sell'");
  const payload = { contractName: 'market', contractAction: 'cancel', contractPayload: { type, id: orderId } };
  return broadcastSSC(payload, { actionLabel: `CANCEL ${type} #${orderId}${symbol ? ` ${symbol}` : ''}` });
}

// sweep a token balance to the cold account (kalivankush). Receiving needs no key; we only sign the send.
export async function sweepToKali({ symbol, quantity, to = SWEEP_TO, memo = 'sweep' }) {
  const payload = { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol, to, quantity: String(quantity), memo } };
  return broadcastSSC(payload, { actionLabel: `SWEEP ${quantity} ${symbol} -> @${to}` });
}

// HARD per-order cap (the operator's $1-5 stake). An order's notional is capped to this many HIVE so
// a wired-live run can only ever risk a tiny amount per trade. Env-overridable (kept small).
export const MAX_ORDER_HIVE = +(process.env.ANGELICALIST_MAX_ORDER_HIVE || 10);

// Size + execute ONE decision against the live HE book. SELL hits the highest bid, BUY lifts the
// lowest ask; the order notional is capped to MAX_ORDER_HIVE (so quantity = cap / price). placeOrder
// is gated — this is a dry-run (prints the exact intended order) unless ANGELICALIST_LIVE + a key.
// `getMetrics` is injectable so tests run fully offline.
export async function executeDecision(d, { getMetrics = (s) => market.metrics(s) } = {}) {
  const m = await getMetrics(d.sym).catch(() => null);
  if (!m) return { ...d, skipped: 'no market metrics' };
  const priceHive = d.action === 'SELL' ? +m.highestBid : +m.lowestAsk;
  if (!(priceHive > 0)) return { ...d, skipped: d.action === 'SELL' ? 'no bid to sell into' : 'no ask to buy from' };
  const quantity = +(MAX_ORDER_HIVE / priceHive).toFixed(8);
  if (!(quantity > 0)) return { ...d, skipped: 'computed zero quantity' };
  const order = { side: d.action.toLowerCase(), symbol: d.sym, quantity, price: priceHive, notionalHive: MAX_ORDER_HIVE };
  const result = await placeOrder(order);
  return { ...d, order, result };
}

// run the deterministic presets and (in live mode) execute the non-HOLD, non-GUARD decisions.
export async function runPresets(opts = {}) {
  const decisions = await simulate();
  const actionable = decisions.filter((d) => d.action === 'SELL' || d.action === 'BUY');
  const results = [];
  for (const d of actionable) {
    // the bleed guard: never act on a BUY without an explicit selling leg in the same run.
    if (d.action === 'BUY' && !actionable.some((x) => x.sym === d.sym && x.action === 'SELL')) {
      results.push({ ...d, blocked: 'no-selling-leg (SWAP.LTC bleed guard)' });
      continue;
    }
    results.push(await executeDecision(d, opts));   // dry-run unless LIVE+key (placeOrder is gated)
  }
  return { mode: mode(), decisions, actionable: results };
}

if (process.argv[1] && process.argv[1].endsWith('trader.mjs')) {
  const m = mode();
  console.log(`angelicalist trader — ${m.live ? '🔴 LIVE' : '🟢 DRY-RUN (default)'}  account=@${m.account} sweep->@${m.sweepTo}`);
  console.log(`  key present: ${m.hasKey}   live flag: ${m.flagLive}   -> broadcasting: ${m.live}`);
  if (!m.hasKey) console.log('  set ANGELICALIST_WIF (env/vault) + ANGELICALIST_LIVE=true to enable broadcasting. Never commit the key.');
  console.log('\nPreset decisions against the live market:');
  const r = await runPresets().catch((e) => ({ error: e.message }));
  if (r.error) { console.log('  error:', r.error); }
  else if (!r.actionable.length) { console.log('  (all HOLD — nothing to do right now)'); }
  else for (const d of r.actionable) {
    const o = d.order ? ` → ${d.order.side} ${d.order.quantity} ${d.order.symbol} @ ${d.order.price} (~${d.order.notionalHive} HIVE)${d.result && d.result.simulated ? ' [DRY-RUN]' : d.result && d.result.txId ? ` [BROADCAST ${d.result.txId}]` : ''}` : '';
    console.log(`  [${d.action}] ${d.sym} — ${d.reason}${d.blocked ? `  BLOCKED: ${d.blocked}` : ''}${d.skipped ? `  SKIPPED: ${d.skipped}` : ''}${o}`);
  }
  console.log(`\n  per-order cap: ${MAX_ORDER_HIVE} HIVE. ${m.live ? '🔴 LIVE — orders above are REAL.' : 'DRY-RUN — set ANGELICALIST_LIVE=true (+ key) to execute.'}`);
}
