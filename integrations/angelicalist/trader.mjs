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

// sweep a token balance to the cold account (kalivankush). Receiving needs no key; we only sign the send.
export async function sweepToKali({ symbol, quantity, to = SWEEP_TO, memo = 'sweep' }) {
  const payload = { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol, to, quantity: String(quantity), memo } };
  return broadcastSSC(payload, { actionLabel: `SWEEP ${quantity} ${symbol} -> @${to}` });
}

// run the deterministic presets and (in live mode) execute the non-HOLD, non-GUARD decisions.
export async function runPresets() {
  const decisions = await simulate();
  const actionable = decisions.filter((d) => d.action === 'SELL' || d.action === 'BUY');
  const results = [];
  for (const d of actionable) {
    // the bleed guard: never act on a BUY without an explicit selling leg in the same run.
    if (d.action === 'BUY' && !actionable.some((x) => x.sym === d.sym && x.action === 'SELL')) {
      results.push({ ...d, blocked: 'no-selling-leg (SWAP.LTC bleed guard)' });
      continue;
    }
    results.push({ ...d, exec: '(execution wired; supply quantity/price from depth before going live)' });
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
  else for (const d of r.actionable) console.log(`  [${d.action}] ${d.sym} — ${d.reason}${d.blocked ? `  BLOCKED: ${d.blocked}` : ''}`);
}
