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
// The WELCOME GRANT is small by spec: a random 5-15 TESTS gift per account (hathor-welcome-genesis.mjs).
// It is deliberately NOT enough to clear the vote dust threshold — real curation weight is something
// each user builds over time from their own earned/powered-up stake, not something Hathor hands out.
const GRANT_MIN = Number(process.env.GRANT_MIN || 5);
const GRANT_MAX = Number(process.env.GRANT_MAX || 15);
const RC_DELEGATION = process.env.RC_DELEGATION ?? '0.100000 VESTS'; // tiny RC bootstrap (Hathor → account); '' to skip
const VOTE_GAP_MS = Number(process.env.VOTE_GAP_MS || 3500);
const live = process.argv.includes('--live');
// --powerup is OPT-IN (test-only): self-vest most of the grant. Off by default — the welcome grant
// leaves the gift LIQUID so the user chooses when to power up (the tutorial's power_up stage).
const doPowerup = process.argv.includes('--powerup');
const KEEP_LIQUID = Number(process.env.KEEP_LIQUID || 1);
const accounts = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Per-account grant in [GRANT_MIN, GRANT_MAX], varied by account name (deterministic, no RNG).
const grantFor = (name) => {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GRANT_MIN + (h % (Math.max(0, GRANT_MAX - GRANT_MIN) + 1));
};

if (PREFIX !== 'TST') { console.error('FATAL: testnet-only (prefix must be TST)'); process.exit(1); }
if (!accounts.length) { console.error('usage: fund-test-accounts.mjs <acct...> [--live]'); process.exit(1); }
const hathorKey = process.env.HATHOR_ACTIVE_KEY && PrivateKey.fromString(process.env.HATHOR_ACTIVE_KEY.trim());
if (live && !hathorKey) { console.error('FATAL: set HATHOR_ACTIVE_KEY for --live'); process.exit(1); }

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const activeKey = (n) => PrivateKey.fromLogin(n, PrivateKey.fromSeed(`${SEED}:${n}`).toString().slice(0, 32), 'active');
const bc = (ops, key, label) => client.broadcast.sendOperations(ops, key)
  .then((r) => console.log(`  ${label}: tx ${r.id || r.trx_id}`))
  .catch((e) => console.log(`  ${label}: ERR ${String(e.message || e).slice(0, 110)}`));

(async () => {
  console.log(`fund-test-accounts (${live ? 'LIVE' : 'dry'}) on ${RPC}`);
  console.log(`WELCOME GRANT: Hathor sends each account ${GRANT_MIN}-${GRANT_MAX} TESTS (liquid gift)${RC_DELEGATION ? ` + delegates ${RC_DELEGATION} RC` : ''}${doPowerup ? ' + account self-powers-up (--powerup, test-only)' : ''}.`);
  const total = accounts.reduce((s, a) => s + grantFor(a), 0);
  console.log(`grants: ${accounts.map((a) => `@${a}=${grantFor(a)}`).join(', ')}  (total ${total} TESTS — Hathor must hold at least this)\n`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }

  for (const a of accounts) {
    const grant = grantFor(a);
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
  console.log('\nNote: 5-15 TESTS is dust-level — votes stay rshares=0 until the user builds real stake over time. That is by design.');
})();
