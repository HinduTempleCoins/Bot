// witness-payout.mjs — send a witness account's block rewards on to another account, once a day.
//
// On MELEK the block producer is paid in LIQUID MELEK (the chain's MELEK_LIQUID_MINING_TIME path: the
// producer_reward virtual op reads "0.000000 VESTS", but the reward lands in the account's balance). So a
// witness that "pays to @melek" is simply: read the witness account's MELEK balance, keep a small reserve,
// transfer the rest to @melek with a plain memo.
//
// Keys: none here. The transfer is signed by MELEK-Signer with a token scoped to `transfer` for the witness
// account only (MELEK_WITNESS_PAYOUT_TOKEN). The token is never logged.
//
// House style: ESM, injectable fetch, soft-fail (a failed run logs and exits non-zero; the next run retries).
//   node integrations/witness-payout.mjs [--dry]
//   env: PAYOUT_FROM (default melek-witness), PAYOUT_TO (default melek), PAYOUT_RESERVE (MELEK kept, default 1.000),
//        PAYOUT_MIN (smallest transfer, default 1.000), MELEK_RPC_URL, MELEK_SIGNER_URL, MELEK_WITNESS_PAYOUT_TOKEN
import { signerBroadcast } from '../autovote/signer-castvote.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const toMilli = (s) => {
  const m = String(s || '').trim().match(/^(\d+)(?:\.(\d{1,3}))?\s+MELEK$/);
  return m ? Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0')) : null;
};
const fmt = (milli) => `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')} MELEK`;

/**
 * Decide the transfer. Pure.
 * @returns {{send:boolean, amount?:string, reason:string}}
 */
export function planPayout({ balance, reserve = '1.000 MELEK', min = '1.000 MELEK' } = {}) {
  const bal = toMilli(balance), res = toMilli(reserve), mn = toMilli(min);
  if (bal == null || res == null || mn == null) return { send: false, reason: `unreadable amount (balance ${balance})` };
  const out = bal - res;
  if (out < mn) return { send: false, reason: `${fmt(Math.max(out, 0))} above the reserve, under the ${fmt(mn)} minimum` };
  return { send: true, amount: fmt(out), reason: 'ok' };
}

export function transferOp({ from, to, amount, date = new Date() }) {
  return ['transfer', { from, to, amount, memo: `Witness rewards from @${from}, ${date.toISOString().slice(0, 10)}` }];
}

async function balanceOf(rpc, account) {
  const r = await _fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [[account]] }) });
  const j = await r.json();
  const a = j && j.result && j.result[0];
  return a ? a.balance : null;
}

if (process.argv[1] && process.argv[1].endsWith('witness-payout.mjs')) {
  const env = process.env;
  const from = env.PAYOUT_FROM || 'melek-witness', to = env.PAYOUT_TO || 'melek';
  const rpc = env.MELEK_RPC_URL || 'https://melek.salon/rpc';
  const dry = process.argv.includes('--dry');
  try {
    const balance = await balanceOf(rpc, from);
    const plan = planPayout({ balance, reserve: env.PAYOUT_RESERVE || '1.000 MELEK', min: env.PAYOUT_MIN || '1.000 MELEK' });
    console.log(`[witness-payout] @${from} balance ${balance} → ${plan.send ? `send ${plan.amount} to @${to}` : `nothing to send (${plan.reason})`}`);
    if (plan.send && !dry) {
      const result = await signerBroadcast({ token: env.MELEK_WITNESS_PAYOUT_TOKEN, ops: [transferOp({ from, to, amount: plan.amount })],
        signerUrl: env.MELEK_SIGNER_URL || undefined, clientId: 'witness-payout', role: 'active', fetch: _fetch });
      console.log(`[witness-payout] sent ${plan.amount} to @${to}: trx ${result && result.id}`);
    }
  } catch (e) {
    console.error(`[witness-payout] failed: ${String(e && e.message || e).slice(0, 200)}`);
    process.exit(1);
  }
}
