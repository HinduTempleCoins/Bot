// unified-data.test.mjs — OFFLINE tests. Injected fetch, no network.
// Covers: provider failover (Covalent errors -> The Graph), normalized schema + provenance
// tagging, and soft-fail-never-throw behavior.
//
//   node --test integrations/chains/unified-data.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { balances, tokenTransfers, txByHash, __setFetch, CHAIN_MAP } from './unified-data.mjs';

// Build a fake fetch that routes by URL substring. Each entry: { covalentKey } may be toggled.
function fakeFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, handler] of routes) {
      if (u.includes(needle)) {
        const { ok = true, status = 200, body = {} } = await handler(u);
        return { ok, status, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const COVALENT_BAL = {
  data: {
    items: [
      {
        contract_address: '0xAAA', contract_ticker_symbol: 'USDC', contract_name: 'USD Coin',
        contract_decimals: 6, balance: '1000000', quote: 1.0,
      },
      {
        contract_address: '0xBBB', contract_ticker_symbol: 'WETH', contract_name: 'Wrapped Ether',
        contract_decimals: 18, balance: '500000000000000000', quote: 1600.5,
      },
    ],
  },
};

const GRAPH_BAL = {
  data: [
    { contract: '0xCCC', symbol: 'DAI', name: 'Dai', decimals: 18, amount: '42', value_usd: 42 },
  ],
};

const ORIG_COVALENT = process.env.COVALENT_KEY;
const ORIG_GOLDRUSH = process.env.GOLDRUSH_KEY;

beforeEach(() => {
  delete process.env.COVALENT_KEY;
  delete process.env.GOLDRUSH_KEY;
});

afterEach(() => {
  __setFetch(null);
  if (ORIG_COVALENT === undefined) delete process.env.COVALENT_KEY; else process.env.COVALENT_KEY = ORIG_COVALENT;
  if (ORIG_GOLDRUSH === undefined) delete process.env.GOLDRUSH_KEY; else process.env.GOLDRUSH_KEY = ORIG_GOLDRUSH;
});

test('CHAIN_MAP maps known chains to both provider slugs', () => {
  assert.equal(CHAIN_MAP.ethereum.covalent, 'eth-mainnet');
  assert.equal(CHAIN_MAP.ethereum.graph, 'mainnet');
  assert.ok(CHAIN_MAP.polygon && CHAIN_MAP.base && CHAIN_MAP.arbitrum);
});

test('balances: Covalent path normalizes + provenance-tags when key present', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => ({ body: COVALENT_BAL })],
  ]));
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.equal(out.length, 2);
  assert.equal(out[0].symbol, 'USDC');
  assert.equal(out[0].contract, '0xaaa', 'contract lowercased');
  assert.equal(out[0].decimals, 6);
  assert.equal(out[0].balance, '1000000');
  assert.equal(out[0].quoteUsd, 1.0);
  // provenance
  assert.equal(out[0].provider, 'covalent');
  assert.equal(out[0].source, 'covalent');
  assert.equal(out[0].chain, 'ethereum');
});

test('balances: no key -> Covalent skipped, falls through to The Graph', async () => {
  // No COVALENT_KEY/GOLDRUSH_KEY set (beforeEach clears them).
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => { throw new Error('should not be called without key'); }],
    ['token-api.thegraph.com', () => ({ body: GRAPH_BAL })],
  ]));
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'DAI');
  assert.equal(out[0].provider, 'thegraph');
  assert.equal(out[0].balance, '42');
  assert.equal(out[0].quoteUsd, 42);
});

test('balances: Covalent HTTP error -> failover to The Graph', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => ({ ok: false, status: 500, body: {} })],
    ['token-api.thegraph.com', () => ({ body: GRAPH_BAL })],
  ]));
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.equal(out.length, 1);
  assert.equal(out[0].provider, 'thegraph', 'failed over to The Graph');
  assert.equal(out[0].symbol, 'DAI');
});

test('balances: Covalent JSON-level error object -> failover to The Graph', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => ({ body: { error: true, error_message: 'bad address' } })],
    ['token-api.thegraph.com', () => ({ body: GRAPH_BAL })],
  ]));
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.equal(out[0].provider, 'thegraph');
});

test('balances: GOLDRUSH_KEY alias works like COVALENT_KEY', async () => {
  process.env.GOLDRUSH_KEY = 'gr-key';
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => ({ body: COVALENT_BAL })],
  ]));
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.equal(out[0].provider, 'covalent');
});

test('balances: both providers fail -> soft-fail to [] (never throws)', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => ({ ok: false, status: 502, body: {} })],
    ['token-api.thegraph.com', () => ({ ok: false, status: 503, body: {} })],
  ]));
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.deepEqual(out, []);
});

test('balances: missing args -> []', async () => {
  assert.deepEqual(await balances({}), []);
  assert.deepEqual(await balances({ chain: 'ethereum' }), []);
  assert.deepEqual(await balances(), []);
});

test('balances: unmapped chain -> [] (both providers throw on unmapped)', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(fakeFetch([['', () => ({ body: {} })]]));
  const out = await balances({ chain: 'fantasychain', address: '0xUser' });
  assert.deepEqual(out, []);
});

test('tokenTransfers: Covalent flattens nested transfers + normalizes', async () => {
  process.env.COVALENT_KEY = 'test-key';
  const body = {
    data: {
      items: [
        {
          tx_hash: '0xTX1', block_height: 100, block_signed_at: '2026-01-01T00:00:00Z',
          transfers: [
            { from_address: '0xFrom', to_address: '0xTo', contract_address: '0xAAA',
              contract_ticker_symbol: 'USDC', contract_decimals: 6, delta: '250' },
          ],
        },
      ],
    },
  };
  __setFetch(fakeFetch([['api.covalenthq.com', () => ({ body })]]));
  const out = await tokenTransfers({ chain: 'polygon', address: '0xUser' });
  assert.equal(out.length, 1);
  assert.equal(out[0].hash, '0xtx1');
  assert.equal(out[0].from, '0xfrom');
  assert.equal(out[0].to, '0xto');
  assert.equal(out[0].symbol, 'USDC');
  assert.equal(out[0].value, '250');
  assert.equal(out[0].timestamp, '2026-01-01T00:00:00Z');
  assert.equal(out[0].provider, 'covalent');
  assert.equal(out[0].chain, 'polygon');
});

test('tokenTransfers: Covalent error -> failover to The Graph normalized shape', async () => {
  process.env.COVALENT_KEY = 'test-key';
  const graphBody = {
    data: [
      { transaction_id: '0xTX2', from: '0xA', to: '0xB', contract: '0xCCC',
        symbol: 'DAI', decimals: 18, amount: '1', datetime: '2026-02-02T00:00:00Z', block_num: 200 },
    ],
  };
  __setFetch(fakeFetch([
    ['api.covalenthq.com', () => ({ ok: false, status: 500, body: {} })],
    ['token-api.thegraph.com', () => ({ body: graphBody })],
  ]));
  const out = await tokenTransfers({ chain: 'ethereum', address: '0xUser' });
  assert.equal(out.length, 1);
  assert.equal(out[0].provider, 'thegraph');
  assert.equal(out[0].hash, '0xtx2');
  assert.equal(out[0].value, '1');
  assert.equal(out[0].blockHeight, 200);
});

test('txByHash: Covalent returns one normalized element', async () => {
  process.env.COVALENT_KEY = 'test-key';
  const body = {
    data: {
      items: [
        { tx_hash: '0xHASH', from_address: '0xA', to_address: '0xB', value: '999',
          fees_paid: 0.5, successful: true, block_height: 300, block_signed_at: '2026-03-03T00:00:00Z' },
      ],
    },
  };
  __setFetch(fakeFetch([['api.covalenthq.com', () => ({ body })]]));
  const out = await txByHash({ chain: 'ethereum', hash: '0xHASH' });
  assert.equal(out.length, 1);
  assert.equal(out[0].hash, '0xhash');
  assert.equal(out[0].value, '999');
  assert.equal(out[0].feeUsd, 0.5);
  assert.equal(out[0].success, true);
  assert.equal(out[0].provider, 'covalent');
});

test('txByHash: Covalent empty items -> [] result counts as success (no failover needed)', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(fakeFetch([['api.covalenthq.com', () => ({ body: { data: { items: [] } } })]]));
  const out = await txByHash({ chain: 'ethereum', hash: '0xNONE' });
  assert.deepEqual(out, []);
});

test('txByHash: missing args -> []', async () => {
  assert.deepEqual(await txByHash({ chain: 'ethereum' }), []);
  assert.deepEqual(await txByHash({}), []);
});

test('soft-fail: a thrown fetch (network error) never propagates', async () => {
  process.env.COVALENT_KEY = 'test-key';
  __setFetch(() => { throw new Error('network down'); });
  const out = await balances({ chain: 'ethereum', address: '0xUser' });
  assert.deepEqual(out, []);
});
