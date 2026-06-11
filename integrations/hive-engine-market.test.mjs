// hive-engine-market.test.mjs — verifies the market.* param-mapping in hive-engine-market.mjs.
// Fully OFFLINE: we inject he-client's fetch seam (__setFetch) and capture each POST body, then
// assert that each market.* method calls the contracts RPC with the correct
// contract + table + query + limit + indexes. Canned results let the calls resolve.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { market } from './hive-engine-market.mjs';
import { __setFetch } from './he-client.mjs';

// --- offline fetch harness -------------------------------------------------
// Records every POST body (parsed) and replies with a canned JSON-RPC result.
// `result` is what the HE `find` RPC returns (an array of rows); findOne takes [0].
let captured = [];
function installFetch(result = []) {
  captured = [];
  __setFetch(async (_url, opts = {}) => {
    const body = JSON.parse(opts.body);
    captured.push(body);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
}
// Pull out the JSON-RPC params of the (single) captured call.
function lastParams() {
  assert.equal(captured.length, 1, 'exactly one RPC call expected');
  const b = captured[0];
  assert.equal(b.method, 'find', 'HE method is always find');
  return b.params;
}

test.afterEach(() => { __setFetch(null); });

// --- metrics → findOne('market','metrics',{symbol}) ------------------------
test('metrics maps to market/metrics findOne with {symbol}', async () => {
  installFetch([{ lastPrice: '1.23' }]);
  const out = await market.metrics('SWAP.HIVE');
  const p = lastParams();
  assert.equal(p.contract, 'market');
  assert.equal(p.table, 'metrics');
  assert.deepEqual(p.query, { symbol: 'SWAP.HIVE' });
  assert.equal(p.limit, 1, 'findOne forces limit 1');
  assert.deepEqual(p.indexes, []);
  assert.deepEqual(out, { lastPrice: '1.23' }, 'findOne returns the first row');
});

test('metrics returns null when the table is empty (edge)', async () => {
  installFetch([]);
  const out = await market.metrics('NOPE');
  assert.equal(out, null);
  assert.deepEqual(lastParams().query, { symbol: 'NOPE' });
});

// --- buyBook → find('market','buyBook',{symbol},limit, priceDec desc) ------
test('buyBook maps to market/buyBook with priceDec descending and default limit 10', async () => {
  installFetch([{ price: '1.0', quantity: '5' }]);
  const out = await market.buyBook('LEO');
  const p = lastParams();
  assert.equal(p.contract, 'market');
  assert.equal(p.table, 'buyBook');
  assert.deepEqual(p.query, { symbol: 'LEO' });
  assert.equal(p.limit, 10, 'default limit');
  assert.deepEqual(p.indexes, [{ index: 'priceDec', descending: true }]);
  assert.deepEqual(out, [{ price: '1.0', quantity: '5' }]);
});

test('buyBook passes an explicit limit through', async () => {
  installFetch([]);
  await market.buyBook('LEO', 3);
  assert.equal(lastParams().limit, 3);
});

// --- sellBook → find('market','sellBook',{symbol},limit, priceDec asc) -----
test('sellBook maps to market/sellBook with priceDec ascending and default limit 10', async () => {
  installFetch([{ price: '2.0', quantity: '7' }]);
  await market.sellBook('LEO');
  const p = lastParams();
  assert.equal(p.contract, 'market');
  assert.equal(p.table, 'sellBook');
  assert.deepEqual(p.query, { symbol: 'LEO' });
  assert.equal(p.limit, 10);
  assert.deepEqual(p.indexes, [{ index: 'priceDec', descending: false }]);
});

test('sellBook passes an explicit limit through', async () => {
  installFetch([]);
  await market.sellBook('LEO', 25);
  assert.equal(lastParams().limit, 25);
});

// --- trades → find('market','tradesHistory',{symbol},limit, timestamp desc)
test('trades maps to market/tradesHistory with timestamp descending and default limit 15', async () => {
  installFetch([{ type: 'buy', price: '1.5' }]);
  await market.trades('LEO');
  const p = lastParams();
  assert.equal(p.contract, 'market');
  assert.equal(p.table, 'tradesHistory');
  assert.deepEqual(p.query, { symbol: 'LEO' });
  assert.equal(p.limit, 15, 'default limit');
  assert.deepEqual(p.indexes, [{ index: 'timestamp', descending: true }]);
});

test('trades passes an explicit limit through', async () => {
  installFetch([]);
  await market.trades('LEO', 50);
  assert.equal(lastParams().limit, 50);
});

// --- tokenInfo → findOne('tokens','tokens',{symbol}) -----------------------
test('tokenInfo maps to tokens/tokens findOne with {symbol}', async () => {
  installFetch([{ issuer: 'someone', supply: '1000' }]);
  const out = await market.tokenInfo('LEO');
  const p = lastParams();
  assert.equal(p.contract, 'tokens');
  assert.equal(p.table, 'tokens');
  assert.deepEqual(p.query, { symbol: 'LEO' });
  assert.equal(p.limit, 1, 'findOne forces limit 1');
  assert.deepEqual(p.indexes, []);
  assert.deepEqual(out, { issuer: 'someone', supply: '1000' });
});

test('tokenInfo returns null for an unknown token (edge)', async () => {
  installFetch([]);
  assert.equal(await market.tokenInfo('GHOST'), null);
});

// --- topHolders → find('tokens','balances',{symbol},limit, balance desc) ---
test('topHolders maps to tokens/balances with balance descending and default limit 10', async () => {
  installFetch([{ account: 'whale', balance: '999' }]);
  const out = await market.topHolders('LEO');
  const p = lastParams();
  assert.equal(p.contract, 'tokens');
  assert.equal(p.table, 'balances');
  assert.deepEqual(p.query, { symbol: 'LEO' });
  assert.equal(p.limit, 10, 'default limit');
  assert.deepEqual(p.indexes, [{ index: 'balance', descending: true }]);
  assert.deepEqual(out, [{ account: 'whale', balance: '999' }]);
});

test('topHolders passes an explicit limit through', async () => {
  installFetch([]);
  await market.topHolders('LEO', 100);
  assert.equal(lastParams().limit, 100);
});

// --- offset is always 0 for these single-page reads (shared invariant) -----
test('all market reads request offset 0', async () => {
  installFetch([]);
  await market.metrics('X');
  assert.equal(lastParams().offset, 0);
});
