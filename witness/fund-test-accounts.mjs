#!/usr/bin/env node
// fund-test-accounts.mjs — TESTNET. Make the populated test accounts actually able to curate:
// Hathor SENDS each one TESTS (the welcome grant), then each account POWERS ITSELF UP (self-vest)
// so its votes clear the dust threshold and carry real curation weight. Optionally Hathor also
// delegates a tiny RC bootstrap so they can transact while they learn.
//
// Runs ON the box (where Hathor's key is). Hathor's active key comes from env (piped from the vault,
// never on the command line / never logged). The test accounts' OWN keys are re-derived from
// POPULATE_SEED in-process (same as populate-testnet.mjs). Hard TST/TESTS guard. --live to broadcast.
//
//   On the box (Hathor active key JIT from the vault):
//     cd /opt/melek-bot && node vault.mjs get hathor-testnet-keys \
//       | sed -n 's/^active:[[:space:]]*//p' \
//       | HATHOR_ACTIVE_KEY=$(cat) node repo/witness/fund-test-accounts.mjs melekvankush angelnetwork cryptokannon vrhathor --live
//
// Env: HATHOR_ACTIVE_KEY (required for --live), GRANT_TESTS (default 1000), KEEP_LIQUID (default 5),
//      RC_DELEGATION (default '0.100000 VESTS', 0 to skip), POPULATE_SEED, MELEK_RPC.

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const SEED = process.env.POPULATE_SEED || 'melek-testnet-populate-v1';
// The WELCOME GRANT scales with what Hathor can afford (and the coin price, once one exists) — it is
// NOT a flat number. The 5-15 band is a USD target when a price is known; until then the grant is just
// a small fraction of Hathor's live balance, clamped into the band. Either way it is dust-level — real
// curation weight is something each user builds over time, not something Hathor hands out.
const GRANT_MIN = Number(process.env.GRANT_MIN || 5);   // band low (USD target when priced; else TESTS floor)
const GRANT_MAX = Number(process.env.GRANT_MAX || 15);  // band high
const GRANT_PCT = Number(process.env.GRANT_PCT || 0.05); // fraction of Hathor's balance she'll grant one newcomer
const PRICE = process.env.MELEK_PRICE_USD ? Number(process.env.MELEK_PRICE_USD) : null; // null until a market exists

// Pure: given Hathor's balance (+ optional price), how much does one newcomer get?
//   priced  → band is [GRANT_MIN, GRANT_MAX] USD ÷ price, capped by what she can afford (GRANT_PCT of balance)
//   no price→ band is [GRANT_MIN, GRANT_MAX] TESTS, and the grant is GRANT_PCT of balance clamped into it
//   broke   → if she can't afford the low end, she gives what little she can (down toward 0)
export function computeWelcomeGrant(hathorBalance, { price = PRICE, pct = GRANT_PCT, min = GRANT_MIN, max = GRANT_MAX } = {}) {
  const lo = price && price > 0 ? min / price : min;
  const hi = price && price > 0 ? max / price : max;
  const affordable = Math.max(0, hathorBalance) * pct;
  const grant = affordable < lo ? affordable : Math.min(hi, affordable);
  return Math.round(grant * 1000) / 1000;
}
const RC_DELEGATION = process.env.RC_DELEGATION ?? '0.100000 VESTS'; // tiny RC bootstrap (Hathor → account); '' to skip
const VOTE_GAP_MS = Number(process.env.VOTE_GAP_MS || 3500);
const live = process.argv.includes('--live');
// --powerup is OPT-IN (test-only): self-vest most of the grant. Off by default — the welcome grant
// leaves the gift LIQUID so the user chooses when to power up (the tutorial's power_up stage).
const doPowerup = process.argv.includes('--powerup');
const KEEP_LIQUID = Number(process.env.KEEP_LIQUID || 1);
const accounts = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const activeKey = (n) => PrivateKey.fromLogin(n, PrivateKey.fromSeed(`${SEED}:${n}`).toString().slice(0, 32), 'active');
const bc = (ops, key, label) => client.broadcast.sendOperations(ops, key)
  .then((r) => console.log(`  ${label}: tx ${r.id || r.trx_id}`))
  .catch((e) => console.log(`  ${label}: ERR ${String(e.message || e).slice(0, 110)}`));

async function main() {
  if (PREFIX !== 'TST') { console.error('FATAL: testnet-only (prefix must be TST)'); process.exit(1); }
  if (!accounts.length) { console.error('usage: fund-test-accounts.mjs <acct...> [--live]'); process.exit(1); }
  const hathorKey = process.env.HATHOR_ACTIVE_KEY && PrivateKey.fromString(process.env.HATHOR_ACTIVE_KEY.trim());
  if (live && !hathorKey) { console.error('FATAL: set HATHOR_ACTIVE_KEY for --live'); process.exit(1); }

  console.log(`fund-test-accounts (${live ? 'LIVE' : 'dry'}) on ${RPC}`);
  // Read Hathor's LIVE balance — the grant is computed from it (and price, when one exists).
  const h = (await client.database.call('get_accounts', [['hathor']]).catch(() => []))[0];
  const hathorBalance = h ? Number(String(h.balance).split(' ')[0]) : 0;
  const grant = computeWelcomeGrant(hathorBalance);
  console.log(`Hathor balance: ${hathorBalance} TESTS; price: ${PRICE ? '$' + PRICE : 'none yet → grant scales off balance only'}`);
  console.log(`WELCOME GRANT (computed): ${grant} TESTS each (${(GRANT_PCT * 100).toFixed(0)}% of balance, band ${GRANT_MIN}-${GRANT_MAX})${RC_DELEGATION ? ` + ${RC_DELEGATION} RC` : ''}${doPowerup ? ' + self power-up (test-only)' : ''}.`);
  console.log(`total out: ${(grant * accounts.length).toFixed(3)} TESTS across ${accounts.length} account(s)\n`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }
  if (!(grant > 0)) { console.error('Hathor cannot afford a grant right now (balance too low).'); process.exit(1); }

  for (const a of accounts) {
    console.log(`@${a}:`);
    // 1. the welcome grant — a small liquid gift (stays liquid; user powers up later, the tutorial way)
    await bc([['transfer', { from: 'hathor', to: a, amount: `${grant.toFixed(3)} TESTS`, memo: 'Welcome to MELEK' }]], hathorKey, `welcome grant ${grant} TESTS`);
    await sleep(VOTE_GAP_MS);
    // 2. tiny RC delegation so they can transact/comment while they learn (NOT vote weight)
    if (RC_DELEGATION) { await bc([['delegate_vesting_shares', { delegator: 'hathor', delegatee: a, vesting_shares: RC_DELEGATION }]], hathorKey, `RC delegate ${RC_DELEGATION}`); await sleep(VOTE_GAP_MS); }
    // 3. (opt-in, test-only) self power-up — real users do this themselves at the tutorial's power_up stage
    if (doPowerup) { const vest = Math.max(0, grant - KEEP_LIQUID); if (vest > 0) { await bc([['transfer_to_vesting', { from: a, to: a, amount: `${vest.toFixed(3)} TESTS` }]], activeKey(a), `self power-up ${vest} TESTS`); await sleep(VOTE_GAP_MS); } }
  }

  console.log('\n=== verify ===');
  const accts = await client.database.call('get_accounts', [accounts]).catch(() => []);
  for (const a of (accts || [])) console.log(`  @${a.name}: balance=${a.balance}, vesting=${a.vesting_shares}, received_vests=${a.received_vesting_shares}`);
  console.log('\nNote: a welcome grant is dust-level — votes stay rshares=0 until the user builds real stake over time. That is by design.');
}

// CLI guard (house style): only run when invoked directly, so importing exposes computeWelcomeGrant only.
if (process.argv[1] && process.argv[1].endsWith('fund-test-accounts.mjs')) {
  main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
