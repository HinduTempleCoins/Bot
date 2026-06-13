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
const GRANT = Number(process.env.GRANT_TESTS || 1000);     // TESTS Hathor sends each account
const KEEP_LIQUID = Number(process.env.KEEP_LIQUID || 5);  // TESTS each account keeps liquid after powering up
const RC_DELEGATION = process.env.RC_DELEGATION ?? '0.100000 VESTS'; // tiny RC bootstrap (Hathor → account); '' to skip
const VOTE_GAP_MS = Number(process.env.VOTE_GAP_MS || 3500);
const live = process.argv.includes('--live');
const accounts = process.argv.slice(2).filter((a) => !a.startsWith('--'));

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
  console.log(`plan per account: Hathor grants ${GRANT} TESTS -> account self-vests ${GRANT - KEEP_LIQUID} (keep ${KEEP_LIQUID})${RC_DELEGATION ? ` + Hathor delegates ${RC_DELEGATION} RC` : ''}\n`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }

  for (const a of accounts) {
    console.log(`@${a}:`);
    // 1. Hathor grants TESTS (the welcome grant)
    await bc([['transfer', { from: 'hathor', to: a, amount: `${GRANT.toFixed(3)} TESTS`, memo: 'Welcome to MELEK — power up and curate' }]], hathorKey, `grant ${GRANT} TESTS`);
    await sleep(VOTE_GAP_MS);
    // 2. tiny RC delegation so they can transact while learning (NOT vote weight)
    if (RC_DELEGATION) { await bc([['delegate_vesting_shares', { delegator: 'hathor', delegatee: a, vesting_shares: RC_DELEGATION }]], hathorKey, `RC delegate ${RC_DELEGATION}`); await sleep(VOTE_GAP_MS); }
    // 3. account powers ITSELF up so its votes carry weight (self-stake with its own active key)
    const vest = Math.max(0, GRANT - KEEP_LIQUID);
    if (vest > 0) { await bc([['transfer_to_vesting', { from: a, to: a, amount: `${vest.toFixed(3)} TESTS` }]], activeKey(a), `self power-up ${vest} TESTS`); await sleep(VOTE_GAP_MS); }
  }

  console.log('\n=== verify (vesting after) ===');
  const accts = await client.database.call('get_accounts', [accounts]).catch(() => []);
  for (const a of (accts || [])) console.log(`  @${a.name}: balance=${a.balance}, vesting=${a.vesting_shares}, received=${a.received_vesting_shares}`);
  console.log('\nNext: re-run mutual-curation-live (a fresh weight) — votes should now carry rshares > 0.');
})();
