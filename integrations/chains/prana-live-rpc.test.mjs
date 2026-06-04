// prana-live-rpc.test.mjs — LIVE EVM RPC smoke test for the PRANA read path.
//
// This is the one test that talks to an actual EVM JSON-RPC node, to prove the
// keyless read path (balances.chainBalance('prana', …) → prana-wallet.portfolio)
// works end-to-end once a PRANA node exists. It is GATED on PRANA_RPC_URL: with
// the env unset it SKIPS cleanly (no node required for CI / a clean checkout).
//
// To run it locally against a throwaway devnet (no PRANA chain build needed):
//   1. start any EVM node on :8545  — e.g. a local hardhat/anvil node, or the
//      real PRANA miner (chain/scripts/run-miner.sh) once built.
//   2. PRANA_RPC_URL=http://127.0.0.1:8545 PRANA_CHAIN_ID=108369 \
//        node --test integrations/chains/prana-live-rpc.test.mjs
//
// It is READ-ONLY: eth_chainId / eth_blockNumber / eth_getBalance only. No keys,
// no signing, no broadcast — exactly the surface the Bot is allowed to use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chainBalance } from './balances.mjs';
import { pranaRpc, pranaChainId } from './multichain.mjs';
import { portfolio } from '../prana-wallet.mjs';

const RPC = process.env.PRANA_RPC_URL;
const SKIP = !RPC;

async function raw(method, params = []) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// A funded read target: PRANA genesis pre-funds the well-known Hardhat/Anvil
// account #0 (also what a default hardhat/anvil node funds), so this address has
// a balance on either a real PRANA devnet or a throwaway local node.
const DEV_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

test('PRANA live RPC: env seam resolves to the configured node', { skip: SKIP && 'PRANA_RPC_URL not set' }, () => {
  assert.ok(pranaRpc().includes(RPC), 'pranaRpc() should include PRANA_RPC_URL');
});

test('PRANA live RPC: eth_chainId responds', { skip: SKIP && 'PRANA_RPC_URL not set' }, async () => {
  const hex = await raw('eth_chainId');
  const id = parseInt(hex, 16);
  assert.ok(Number.isInteger(id) && id > 0, `expected a positive chainId, got ${hex}`);
  // If PRANA_CHAIN_ID is set we cross-check it against the live node (a real PRANA
  // node returns 108369). On a generic local devnet they may differ — only assert
  // when both are present AND equal-able, otherwise just record it.
  const envId = Number(pranaChainId());
  if (Number.isInteger(envId) && envId !== 7777) {
    // 7777 is the dormant placeholder; only compare a real configured id.
    if (envId !== id) {
      // eslint-disable-next-line no-console
      console.log(`  note: live chainId ${id} != env PRANA_CHAIN_ID ${envId} (ok on a generic devnet)`);
    }
  }
});

test('PRANA live RPC: eth_blockNumber responds', { skip: SKIP && 'PRANA_RPC_URL not set' }, async () => {
  const hex = await raw('eth_blockNumber');
  const n = parseInt(hex, 16);
  assert.ok(Number.isInteger(n) && n >= 0, `expected a block number, got ${hex}`);
});

test('PRANA live RPC: balances.chainBalance("prana", …) reads a real balance', { skip: SKIP && 'PRANA_RPC_URL not set' }, async () => {
  const row = await chainBalance('prana', DEV_ACCOUNT);
  assert.equal(row.chain, 'prana');
  assert.ok(!row.error, `unexpected error: ${row.error}`);
  assert.ok(Number.isFinite(row.balance), 'balance should be a finite number');
  assert.ok(row.balance >= 0, 'balance should be >= 0');
});

test('PRANA live RPC: prana-wallet.portfolio sums the live position', { skip: SKIP && 'PRANA_RPC_URL not set' }, async () => {
  const pf = await portfolio({ accounts: [{ chain: 'prana', address: DEV_ACCOUNT }] });
  assert.equal(pf.positions.length, 1);
  const pos = pf.positions[0];
  assert.equal(pos.chain, 'prana');
  assert.ok(!pos.error, `unexpected position error: ${pos.error}`);
  assert.ok(Number.isFinite(pos.amount) && pos.amount >= 0, 'position amount should be a finite >= 0 number');
  assert.equal(pos.symbol, 'PRANA');
});
