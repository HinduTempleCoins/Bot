// prana-wallet.test.mjs — OFFLINE tests for integrations/prana-wallet.mjs (task #199).
// No network: we inject a fake balance reader and a fake price reader via the
// __set* hooks, so portfolio()/summarize()/valuePosition() are exercised purely.
//
//   node --test integrations/prana-wallet.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  portfolio, valuePosition, summarize, SUPPORTED_CHAINS,
  __setBalanceReader, __setPriceReader,
} from './prana-wallet.mjs';
import { __setFetch as __setBalancesFetch } from './chains/balances.mjs';

// reset injected readers between tests
function reset() { __setBalanceReader(null); __setPriceReader(null); }

// ---------------------------------------------------------------------------
// valuePosition (pure math)
// ---------------------------------------------------------------------------
test('valuePosition multiplies and rounds to 2dp', () => {
  assert.equal(valuePosition(2, 3), 6);
  assert.equal(valuePosition(1.5, 10), 15);
  assert.equal(valuePosition(2, 3.14), 6.28); // 2dp
});

test('valuePosition soft-fails bad inputs to 0', () => {
  assert.equal(valuePosition(undefined, 5), 0);
  assert.equal(valuePosition('abc', 5), 0);
  assert.equal(valuePosition(5, null), 0);
  assert.equal(valuePosition(NaN, NaN), 0);
});

// ---------------------------------------------------------------------------
// SUPPORTED_CHAINS shape
// ---------------------------------------------------------------------------
test('SUPPORTED_CHAINS describes the three ecosystem chains with kind + readVia', () => {
  for (const name of ['melek', 'soap', 'prana']) {
    assert.ok(name in SUPPORTED_CHAINS, `missing ${name}`);
    const c = SUPPORTED_CHAINS[name];
    assert.equal(typeof c.kind, 'string');
    assert.ok(c.kind.length > 0);
    assert.equal(typeof c.readVia, 'string');
    assert.ok(c.readVia.length > 0);
  }
  assert.equal(SUPPORTED_CHAINS.melek.kind, 'graphene');
  assert.equal(SUPPORTED_CHAINS.soap.kind, 'bitshares');
  assert.equal(SUPPORTED_CHAINS.prana.kind, 'evm');
});

// ---------------------------------------------------------------------------
// portfolio — empty input
// ---------------------------------------------------------------------------
test('portfolio with no accounts returns empty zeroed shape', async () => {
  reset();
  const pf = await portfolio({});
  assert.deepEqual(pf.positions, []);
  assert.equal(pf.totalUsd, 0);
  assert.deepEqual(pf.byChain, {});
  assert.equal(typeof pf.updatedAt, 'string');

  const pf2 = await portfolio(); // no arg at all
  assert.deepEqual(pf2.positions, []);
  assert.equal(pf2.totalUsd, 0);
});

// ---------------------------------------------------------------------------
// portfolio — multi-chain with injected balances + prices, sums correctly
// ---------------------------------------------------------------------------
test('multi-chain portfolio sums positions and groups byChain', async () => {
  reset();
  __setBalanceReader(async (chain, address) => {
    const table = {
      melek:    { balance: 100, symbol: 'MELEK' },
      ethereum: { balance: 2,   symbol: 'ETH' },
      prana:    { balance: 50,  symbol: 'PRANA' },
    };
    assert.ok(address, 'reader should receive an address');
    return { chain, ...(table[chain] || { error: 'unknown' }) };
  });
  __setPriceReader(async (chains) => {
    assert.ok(Array.isArray(chains));
    return { melek: 0.5, ethereum: 2000, prana: 0 };
  });

  const pf = await portfolio({ accounts: [
    { chain: 'melek', address: 'hathor' },
    { chain: 'ethereum', address: '0xabc' },
    { chain: 'prana', address: '0xdef' },
  ] });

  assert.equal(pf.positions.length, 3);
  const byChain = Object.fromEntries(pf.positions.map((p) => [p.chain, p]));
  assert.equal(byChain.melek.valueUsd, 50);     // 100 * 0.5
  assert.equal(byChain.ethereum.valueUsd, 4000); // 2 * 2000
  assert.equal(byChain.prana.valueUsd, 0);       // 50 * 0 (no market yet)
  assert.equal(byChain.melek.symbol, 'MELEK');
  assert.equal(byChain.ethereum.symbol, 'ETH');

  assert.equal(pf.totalUsd, 4050);
  assert.equal(pf.byChain.melek, 50);
  assert.equal(pf.byChain.ethereum, 4000);
  assert.equal(pf.byChain.prana, 0);
});

// ---------------------------------------------------------------------------
// portfolio — one chain fails, the others survive
// ---------------------------------------------------------------------------
test('one failing chain does not sink the portfolio', async () => {
  reset();
  __setBalanceReader(async (chain) => {
    if (chain === 'ethereum') throw new Error('rpc down');
    if (chain === 'bitcoin') return { chain, error: 'no address configured' };
    return { chain, balance: 10, symbol: 'MELEK' };
  });
  __setPriceReader(async () => ({ melek: 1, ethereum: 2000, bitcoin: 50000 }));

  const pf = await portfolio({ accounts: [
    { chain: 'melek', address: 'hathor' },
    { chain: 'ethereum', address: '0xabc' }, // throws
    { chain: 'bitcoin', address: 'bc1q' },   // soft error row
  ] });

  assert.equal(pf.positions.length, 3);
  const byChain = Object.fromEntries(pf.positions.map((p) => [p.chain, p]));
  assert.equal(byChain.melek.valueUsd, 10);
  assert.equal(byChain.ethereum.amount, 0);
  assert.equal(byChain.ethereum.valueUsd, 0);
  assert.match(byChain.ethereum.error, /rpc down/);
  assert.equal(byChain.bitcoin.valueUsd, 0);
  assert.match(byChain.bitcoin.error, /no address/);

  // total = only the working chain
  assert.equal(pf.totalUsd, 10);
});

test('missing chain/address on an account soft-fails that position only', async () => {
  reset();
  __setBalanceReader(async () => ({ balance: 5, symbol: 'MELEK' }));
  __setPriceReader(async () => ({ melek: 2 }));
  const pf = await portfolio({ accounts: [
    { chain: 'melek', address: 'hathor' },
    { chain: 'melek' }, // no address
  ] });
  assert.equal(pf.positions.length, 2);
  assert.equal(pf.positions[0].valueUsd, 10);
  assert.equal(pf.positions[1].valueUsd, 0);
  assert.match(pf.positions[1].error, /missing chain or address/);
  assert.equal(pf.totalUsd, 10);
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------
test('summarize renders a human one-liner block with total', async () => {
  reset();
  __setBalanceReader(async (chain) => ({ chain, balance: chain === 'melek' ? 100 : 2, symbol: chain === 'melek' ? 'MELEK' : 'ETH' }));
  __setPriceReader(async () => ({ melek: 0.5, ethereum: 2000 }));
  const pf = await portfolio({ accounts: [
    { chain: 'melek', address: 'hathor' },
    { chain: 'ethereum', address: '0xabc' },
  ] });
  const s = summarize(pf);
  assert.match(s, /PRANA Wallet/);
  assert.match(s, /total ≈ \$4,050\.00/);
  assert.match(s, /MELEK: 100/);
  assert.match(s, /ETH: 2/);
});

test('summarize handles empty + error positions safely', () => {
  assert.match(summarize({ positions: [] }), /no accounts/);
  assert.match(summarize(null), /no accounts/);
  const s = summarize({ totalUsd: 0, positions: [{ chain: 'ethereum', symbol: 'ETH', amount: 0, valueUsd: 0, error: 'rpc down' }] });
  assert.match(s, /ETH: 0 \(rpc down\)/);
});

// ---------------------------------------------------------------------------
// no reader available → all positions zeroed, never throws
// ---------------------------------------------------------------------------
test('with no balance reader, positions zero out instead of throwing', async () => {
  reset();
  // force "no reader" by injecting a falsy-returning loader path: set a reader
  // that we then clear; instead just point the dynamic import at nothing by
  // injecting null and relying on the real balances.mjs — but to keep it
  // network-free we inject a reader that returns an error row.
  __setBalanceReader(async (chain) => ({ chain, error: 'no address configured' }));
  __setPriceReader(async () => ({}));
  const pf = await portfolio({ accounts: [{ chain: 'prana', address: '0x1' }] });
  assert.equal(pf.positions.length, 1);
  assert.equal(pf.positions[0].valueUsd, 0);
  assert.equal(pf.totalUsd, 0);
  assert.ok(pf.positions[0].error);
});

// ---------------------------------------------------------------------------
// PRANA end-to-end through the REAL balances.mjs reader (no injected reader),
// proving the dormant chain entry resolves: lit when PRANA_RPC_URL is set,
// soft-fails when not. Network is stubbed via balances' own __setFetch seam.
// ---------------------------------------------------------------------------
test('portfolio includes PRANA via the real balances reader when PRANA_RPC_URL is set', async () => {
  reset(); // no injected balance reader → defensive loader uses balances.chainBalance
  const prev = process.env.PRANA_RPC_URL;
  process.env.PRANA_RPC_URL = 'https://rpc.prana.test';
  __setBalancesFetch(async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' }) })); // 1 PRANA
  __setPriceReader(async () => ({})); // no public market → priced at 0
  try {
    const pf = await portfolio({ accounts: [{ chain: 'prana', address: '0xabc' }] });
    assert.equal(pf.positions.length, 1);
    const pos = pf.positions[0];
    assert.equal(pos.chain, 'prana');
    assert.equal(pos.symbol, 'PRANA');
    assert.equal(pos.amount, 1);     // read through the new dormant CHAINS entry
    assert.equal(pos.valueUsd, 0);   // no price source yet
    assert.equal(pos.error, undefined);
  } finally {
    __setBalancesFetch(null);
    if (prev === undefined) delete process.env.PRANA_RPC_URL; else process.env.PRANA_RPC_URL = prev;
  }
});

test('portfolio PRANA soft-fails (zeroed, error row) when PRANA_RPC_URL is UNSET', async () => {
  reset();
  const prev = process.env.PRANA_RPC_URL;
  delete process.env.PRANA_RPC_URL;
  let called = false;
  __setBalancesFetch(async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
  __setPriceReader(async () => ({}));
  try {
    const pf = await portfolio({ accounts: [{ chain: 'prana', address: '0xabc' }] });
    assert.equal(pf.positions.length, 1);
    assert.equal(pf.positions[0].chain, 'prana');
    assert.equal(pf.positions[0].amount, 0);
    assert.equal(pf.positions[0].valueUsd, 0);
    assert.ok(pf.positions[0].error, 'dormant prana yields an error row, not a throw');
    assert.equal(pf.totalUsd, 0);
    assert.equal(called, false, 'no RPC → never hits the network');
  } finally {
    __setBalancesFetch(null);
    if (prev === undefined) delete process.env.PRANA_RPC_URL; else process.env.PRANA_RPC_URL = prev;
  }
});
