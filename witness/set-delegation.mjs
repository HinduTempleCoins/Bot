#!/usr/bin/env node
// set-delegation.mjs — TESTNET. Set Hathor's vesting delegation to an account to an EXACT amount
// (delegate_vesting_shares overwrites the prior value; lowering it returns the excess to Hathor after
// the chain's delegation cooldown). Used to walk back the old 200-VESTS over-delegation to the new
// 0.1 RC-bootstrap. Active key via env (HATHOR_ACTIVE_KEY, from the vault; never logged). --live.
//
//   node witness/set-delegation.mjs <account> <vests> --live      e.g. zoe 0.1
import { Client, PrivateKey } from '@hiveio/dhive';
const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const FROM = process.env.HATHOR_ACCOUNT || 'hathor';
const live = process.argv.includes('--live');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [to, vestsNum] = args;
if (PREFIX !== 'TST') { console.error('FATAL: testnet-only'); process.exit(1); }
if (!to || vestsNum == null) { console.error('usage: set-delegation.mjs <account> <vests> [--live]'); process.exit(1); }
const vesting = `${Number(vestsNum).toFixed(6)} VESTS`;
const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
(async () => {
  console.log(`set delegation @${FROM} -> @${to} = ${vesting}${live ? '' : '  (dry)'}`);
  if (!live) return;
  const key = process.env.HATHOR_ACTIVE_KEY && PrivateKey.fromString(process.env.HATHOR_ACTIVE_KEY.trim());
  if (!key) { console.error('FATAL: set HATHOR_ACTIVE_KEY'); process.exit(1); }
  const op = ['delegate_vesting_shares', { delegator: FROM, delegatee: to, vesting_shares: vesting }];
  const r = await client.broadcast.sendOperations([op], key).catch((e) => ({ error: String(e.message || e).slice(0, 140) }));
  console.log(r && r.error ? `ERR ${r.error}` : `tx ${r.id || r.trx_id}`);
})();
