#!/usr/bin/env node
// rotate-hathor-keys.mjs — TESTNET-ONLY. Move @hathor's on-chain authority from the public genesis
// default key (which the re-genesis left it on) to its real vault keys, so the vault-key JIT path
// (price feed, welcomer, grants) works and hathor is no longer controlled by a well-known key.
//
// The CURRENT owner is the public Steem-testnet genesis key (constant below — not a secret). The NEW
// authorities are derived from the vault block piped in on stdin (`vault.mjs get hathor-testnet-keys`).
// No private key is ever passed on the command line; only public keys are printed. Dry by default;
// pass --live to broadcast the account_update.

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
// The public, well-known Steem-testnet genesis key currently controls @hathor (the re-genesis left it
// on all authorities), so it can sign this one rotation. Provided via env (kept in .local, never
// committed): export MELEK_GENESIS_WIF=$(cat .local/genesis-wif).
const GENESIS_WIF = (process.env.MELEK_GENESIS_WIF || '').trim();
if (!GENESIS_WIF) { console.error('FATAL: set MELEK_GENESIS_WIF (public testnet genesis key, from .local)'); process.exit(1); }

let block = '';
for await (const chunk of process.stdin) block += chunk;
function wifFor(label) {
  const m = block.match(new RegExp(`^${label}:\\s*(5[1-9A-HJ-NP-Za-km-z]{50})`, 'm'));
  return m && m[1];
}
const wifs = { owner: wifFor('owner'), active: wifFor('active'), posting: wifFor('posting'), memo: wifFor('memo') };
for (const [k, v] of Object.entries(wifs)) if (!v) { console.error(`FATAL: could not parse ${k} key from vault block`); process.exit(1); }

const pub = (wif) => PrivateKey.fromString(wif).createPublic(PREFIX).toString();
const auth = (p) => ({ weight_threshold: 1, account_auths: [], key_auths: [[p, 1]] });
const pubs = { owner: pub(wifs.owner), active: pub(wifs.active), posting: pub(wifs.posting), memo: pub(wifs.memo) };
const genesisPub = PrivateKey.fromString(GENESIS_WIF).createPublic(PREFIX).toString();

console.log('=== rotation plan ===');
console.log('current owner (genesis):', genesisPub);
console.log('NEW vault pubkeys:', JSON.stringify(pubs, null, 2));
if (Object.values(pubs).some((p) => p === genesisPub)) {
  console.error('REFUSING: a vault key still equals the genesis key — that would not be a real rotation.');
  process.exit(1);
}

const op = ['account_update', {
  account: 'hathor',
  owner: auth(pubs.owner),
  active: auth(pubs.active),
  posting: auth(pubs.posting),
  memo_key: pubs.memo,
  json_metadata: '',
}];

if (!process.argv.includes('--live')) {
  console.log('\n(dry run — no broadcast. Re-run with --live to rotate.)');
  process.exit(0);
}

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const r = await client.broadcast.sendOperations([op], PrivateKey.fromString(GENESIS_WIF)).catch((e) => ({ error: String(e.message || e) }));
if (r.error) { console.error('ROTATION FAILED:', r.error); process.exit(1); }
console.log('\nROTATED — tx', r.id || r.trx_id);
// verify
const acct = await client.database.call('get_accounts', [['hathor']]).catch(() => null);
const onchain = acct && acct[0] ? acct[0].posting.key_auths[0][0] : '?';
console.log('hathor posting authority now:', onchain, onchain === pubs.posting ? '✓ matches vault' : '✗ MISMATCH');
