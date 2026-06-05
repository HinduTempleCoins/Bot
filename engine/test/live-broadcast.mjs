#!/usr/bin/env node
/**
 * live-broadcast.mjs — end-to-end test against the live MELEK testnet.
 *
 * Broadcasts real custom_json ops (create -> issue -> transfer) signed with a
 * TESTNET THROWAWAY key, then streams the affected blocks into a fresh engine
 * and asserts the engine state reflects the lifecycle.
 *
 * NEVER run with a mainnet key. The key here is the public testnet init key.
 *
 *   TESTNET_WIF=<public-testnet-init-key> \
 *   MELEK_ENGINE_RPC=http://127.0.0.1:8090 \
 *   MELEK_ENGINE_ISSUER=initminer TESTNET_ACCT=initminer \
 *   node engine/test/live-broadcast.mjs
 *
 * The TESTNET_WIF is the well-known public Steem-testnet init key (the value
 * is found in the testnet node's config.ini on the chain host). It is NEVER
 * hardcoded here and is NEVER a mainnet key.
 */

import dhive from '@hiveio/dhive';
import { State } from '../lib/state.mjs';
import { Engine } from '../lib/engine.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { headBlock, streamRange } from '../lib/streamer.mjs';
import { config } from '../config.mjs';

const RPC = config.rpcNodes[0];
const CHAIN_ID = config.chainId;
const PREFIX = config.addressPrefix;
// Public MELEK testnet init key — supplied via env, never hardcoded. Throwaway,
// NOT a mainnet key. (Found in the testnet node's config.ini on the chain host.)
const WIF = process.env.TESTNET_WIF;
const ACCT = process.env.TESTNET_ACCT || 'initminer';
if (!WIF) {
  console.error('set TESTNET_WIF (public testnet init key) to run the live broadcast test');
  process.exit(1);
}

const client = new dhive.Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 8000 });
const key = dhive.PrivateKey.fromString(WIF);

// Symbols are uppercase letters only (Hive-Engine convention). Map the run's
// timestamp digits to letters for a unique, valid symbol.
const SYMBOL = 'EE' + String(Date.now()).slice(-5).replace(/[0-9]/g, (d) => 'ABCDEFGHIJ'[+d]);

async function broadcast(action, payload) {
  const op = ['custom_json', {
    required_auths: [ACCT],
    required_posting_auths: [],
    id: config.sidechainId,
    json: JSON.stringify({ contractName: 'tokens', contractAction: action, contractPayload: payload }),
  }];
  const r = await client.broadcast.sendOperations([op], key);
  console.log(`  broadcast ${action} ${SYMBOL} -> ${r.id} @block ${r.block_num}`);
  return r.block_num;
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`E2E token ${SYMBOL} as @${ACCT} via ${RPC}`);
  const startBlk = await headBlock();

  const b1 = await broadcast('create', { symbol: SYMBOL, name: 'E2E Token', precision: 3, maxSupply: '1000000' });
  await wait(4000);
  const b2 = await broadcast('issue', { symbol: SYMBOL, to: ACCT, quantity: '500' });
  await wait(4000);
  const b3 = await broadcast('transfer', { symbol: SYMBOL, to: 'hathor', quantity: '100' });
  await wait(4000);

  const endBlk = await headBlock();
  console.log(`replaying blocks ${startBlk}..${endBlk} into fresh engine…`);

  // The engine's genesis issuer (MELEK_ENGINE_ISSUER) is minted the genesis
  // APIS, so it can pay creation fees. Run this test with the broadcasting
  // account == genesis issuer (e.g. MELEK_ENGINE_ISSUER=initminer) so the full
  // create->issue->transfer lifecycle succeeds with real fees.
  const s = new State(null);
  bootstrapGenesis(s);
  const e = new Engine(s);
  await streamRange(e, startBlk, endBlk, {
    onBlock: (b, c) => { if (c) console.log(`  blk ${b}: ${c} op(s)`); },
  });

  const tok = s.findOne('tokens', { symbol: SYMBOL });
  const issuerBal = s.findOne('balances', { account: ACCT, symbol: SYMBOL });
  const hathorBal = s.findOne('balances', { account: 'hathor', symbol: SYMBOL });
  const processed = s.collection('processed').filter((p) => p.action && p.action.startsWith('tokens.') && p.txId);

  console.log('\n--- RESULT ---');
  console.log('token row:', tok ? `${tok.symbol} supply=${tok.supply} issuer=${tok.issuer}` : 'MISSING');
  console.log('issuer balance:', issuerBal ? issuerBal.balance : '0');
  console.log('hathor balance:', hathorBal ? hathorBal.balance : '0');
  console.log('processed ops for', SYMBOL + ':');
  for (const p of s.collection('processed')) {
    if (JSON.stringify(p).includes(SYMBOL) || [b1, b2, b3].includes(p.block)) {
      console.log(`  blk ${p.block} ${p.action} sender=${p.sender} ok=${p.ok}${p.error ? ' err=' + p.error : ''}`);
    }
  }
  console.log('state hash:', s.hash().slice(0, 24));

  const created = !!tok;
  console.log(created ? '\n✓ E2E lifecycle reflected in engine state' : '\n✗ token not created — check fee/auth');
  process.exit(created ? 0 : 2);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
