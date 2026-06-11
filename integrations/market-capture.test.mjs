// market-capture.test.mjs — offline verification of snapshot() in market-capture.mjs.
// Drives the read-only HIVE-Engine path through the he-client __setFetch seam: the canned
// fetch dispatches on the JSON-RPC POST body's params.table (metrics / buyBook / sellBook),
// returning JSON-RPC envelopes ({ result }). No network. We do NOT assert on the Date-based
// 'at' field (non-deterministic by design).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch } from './he-client.mjs';
import { snapshot } from './market-capture.mjs';

// Build a canned fetch that reads the JSON-RPC request body and returns rows per table.
// `tables` maps a table name -> the array of rows to return as `result`.
function cannedFetch(tables) {
  return async (_url, opts = {}) => {
    let body = {};
    try { body = JSON.parse(opts.body || '{}'); } catch { body = {}; }
    const table = body?.params?.table;
    const rows = Object.prototype.hasOwnProperty.call(tables, table) ? tables[table] : [];
    return {
      ok: true,
      status: 200,
      async json() { return { jsonrpc: '2.0', id: 1, result: rows }; },
    };
  };
}

test('snapshot parses metrics + book depth from canned JSON-RPC', async () => {
  __setFetch(cannedFetch({
    // metrics is fetched via findOne -> find(..., limit 1) -> result[0]
    metrics: [{ symbol: 'VKBT', lastPrice: '1.25', highestBid: '1.20', lowestAsk: '1.30', volume: '4200.5' }],
    buyBook: [
      { price: '1.20', quantity: '100', account: 'a' },
      { price: '1.19', quantity: '50.5', account: 'b' },
      { price: '1.18', quantity: '0.5', account: 'c' },
    ],
    sellBook: [
      { price: '1.30', quantity: '40', account: 'd' },
      { price: '1.31', quantity: '60', account: 'e' },
    ],
  }));

  const s = await snapshot('VKBT');

  assert.equal(s.symbol, 'VKBT');
  assert.equal(s.lastPrice, 1.25);
  assert.equal(s.highestBid, 1.2);
  assert.equal(s.lowestAsk, 1.3);
  assert.equal(s.volume, 4200.5);
  // buyDepth = sum of buyBook quantities (100 + 50.5 + 0.5)
  assert.equal(s.buyDepth, 151);
  // sellDepth = sum of sellBook quantities (40 + 60)
  assert.equal(s.sellDepth, 100);
  // tradesHistory is undefined on the market client -> recentFills defaults to []
  assert.deepEqual(s.recentFills, []);
  // walls are arrays (pure detector, never throws)
  assert.ok(Array.isArray(s.buyWalls));
  assert.ok(Array.isArray(s.sellWalls));

  __setFetch(null);
});

test('snapshot falls back to book tops when metrics fields are missing', async () => {
  __setFetch(cannedFetch({
    // metrics present but no bid/ask/price/volume -> falls back / zeroes
    metrics: [{ symbol: 'VKBT' }],
    buyBook: [{ price: '0.90', quantity: '10', account: 'a' }, { price: '0.89', quantity: '5', account: 'b' }],
    sellBook: [{ price: '0.95', quantity: '7', account: 'c' }, { price: '0.96', quantity: '3', account: 'd' }],
  }));

  const s = await snapshot('VKBT');

  assert.equal(s.lastPrice, 0);
  // highestBid falls back to buyBook[0].price, lowestAsk to sellBook[0].price
  assert.equal(s.highestBid, 0.9);
  assert.equal(s.lowestAsk, 0.95);
  assert.equal(s.volume, 0);
  assert.equal(s.buyDepth, 15);
  assert.equal(s.sellDepth, 10);
  assert.deepEqual(s.recentFills, []);

  __setFetch(null);
});

test('snapshot is soft on empty books and null metrics', async () => {
  __setFetch(cannedFetch({
    // no metrics row -> findOne returns null; empty books
    metrics: [],
    buyBook: [],
    sellBook: [],
  }));

  const s = await snapshot('NOPE');

  assert.equal(s.symbol, 'NOPE');
  assert.equal(s.lastPrice, 0);
  assert.equal(s.highestBid, 0);
  assert.equal(s.lowestAsk, 0);
  assert.equal(s.volume, 0);
  assert.equal(s.buyDepth, 0);
  assert.equal(s.sellDepth, 0);
  assert.deepEqual(s.recentFills, []);
  assert.deepEqual(s.buyWalls, []);
  assert.deepEqual(s.sellWalls, []);

  __setFetch(null);
});
