// auto-claim.mjs — claim waiting author and curation rewards for Auto-Vote users who allowed it.
//
// On MELEK, rewards sit in an account's "to be claimed" balance (reward_vesting_balance and friends) until
// the owner redeems them, and until then they add nothing to MELEK Power — so a member's votes stay weightless
// (a real user, @udabeu, hit exactly this). This job reads Auto-Vote's users (each signed in through
// MELEK-Signer) and, for those whose token includes the `claim_reward_balance` scope (granted on the
// signer's own consent screen), broadcasts claim_reward_balance through the signer. No keys here.
//
// House style: ESM, injectable fetch, soft-fail per account, pure planner tested offline, CLI-guarded.
//   node integrations/auto-claim.mjs [--dry]   env: AUTOVOTE_DB, MELEK_RPC_URL, MELEK_SIGNER_URL
import { readFileSync } from 'node:fs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const num = (s) => parseFloat(String(s || '0').split(' ')[0]) || 0;

/** The claim op for an account, or null when nothing is waiting. Pure. */
export function claimOp(acct) {
  if (!acct || !acct.name) return null;
  const steem = acct.reward_steem_balance || '0.000 MELEK', sbd = acct.reward_sbd_balance || '0.000 MBD', vests = acct.reward_vesting_balance || '0.000000 VESTS';
  if (num(steem) <= 0 && num(sbd) <= 0 && num(vests) <= 0) return null;
  return ['claim_reward_balance', { account: acct.name, reward_steem: steem, reward_sbd: sbd, reward_vests: vests }];
}

/** MELEK users with a signer token, from Auto-Vote's DB. Pure over the parsed DB. */
export function signerUsers(db) {
  return Object.values((db && db.users) || {}).filter((u) => u && u.msToken && (u.chain || 'melek').startsWith('melek') && u.account)
    .map((u) => ({ account: u.account, token: u.msToken }));
}

async function rpc(method, params) {
  const r = await _fetch(process.env.MELEK_RPC_URL || 'https://melek.salon/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}

export async function runAutoClaim({ users, dry = false, signerUrl = process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon' }) {
  const out = [];
  if (!users.length) return out;
  const accts = await rpc('condenser_api.get_accounts', [users.map((u) => u.account)]) || [];
  for (const u of users) {
    const op = claimOp(accts.find((a) => a.name === u.account));
    if (!op) { out.push({ account: u.account, claimed: false, reason: 'nothing waiting' }); continue; }
    if (dry) { out.push({ account: u.account, claimed: false, would: op[1] }); continue; }
    try {
      const r = await _fetch(`${signerUrl}/v1/broadcast`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${u.token}` }, body: JSON.stringify({ ops: [op], client_ref: 'auto-claim', role: 'posting' }) });
      const j = await r.json().catch(() => ({}));
      out.push(j.ok ? { account: u.account, claimed: true, vests: op[1].reward_vests, trx: j.result && j.result.id }
        : { account: u.account, claimed: false, reason: /scope/.test(j.error || '') ? 'auto-claim not allowed yet (sign in to Auto-Vote again to allow it)' : String(j.error || 'refused').slice(0, 120) });
    } catch (e) { out.push({ account: u.account, claimed: false, reason: String(e.message || e).slice(0, 120) }); }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('auto-claim.mjs')) {
  try {
    const db = JSON.parse(readFileSync(process.env.AUTOVOTE_DB || '/var/melek-bot/autovote/autovote.json', 'utf8'));
    const res = await runAutoClaim({ users: signerUsers(db), dry: process.argv.includes('--dry') });
    for (const r of res) console.log(`[auto-claim] @${r.account}: ${r.claimed ? `claimed ${r.vests} (trx ${r.trx})` : r.would ? `would claim ${r.would.reward_vests}` : r.reason}`);
  } catch (e) { console.error(`[auto-claim] ${String(e.message || e).slice(0, 200)}`); process.exit(1); }
}
