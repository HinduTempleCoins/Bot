// Pure-logic unit tests for the reader internals — no network. Covers the price-oracle robust
// median/outlier rejection, the timeline reconstruction, and the he-client failover order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robustMedian, median } from './price-oracle.mjs';
import { reconstructTimeline } from './timeline.mjs';
import { withFailover } from './he-client.mjs';

// ── price-oracle ──────────────────────────────────────────────────────────────
test('median handles odd and even counts', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('robustMedian drops a >35% outlier and stays confident', () => {
  // four agree near 2000, one stale at 800 (the SWAP.ETH phantom shape)
  const r = robustMedian([1980, 1981, 1983, 1981, 800]);
  assert.ok(Math.abs(r.usd - 1981) < 5, `outlier should be dropped (got ${r.usd})`);
  assert.equal(r.sources, 4);
  assert.ok(r.confident, 'four sources within 5% should be confident');
});

test('robustMedian is not confident with a single source', () => {
  const r = robustMedian([1981]);
  assert.equal(r.sources, 1);
  assert.equal(r.confident, false);
});

test('robustMedian is not confident when survivors disagree >5%', () => {
  const r = robustMedian([100, 130]); // 30% apart, neither is a 35% outlier from their median
  assert.equal(r.confident, false);
});

test('robustMedian on empty input is safe', () => {
  const r = robustMedian([]);
  assert.deepEqual(r, { usd: 0, sources: 0, spreadPct: null, confident: false });
});

// ── timeline ──────────────────────────────────────────────────────────────────
test('reconstructTimeline nets buys against sells and normalizes epoch dates', () => {
  const ops = [
    { operation: 'market_buy', timestamp: 1727500000, data: { symbol: 'SWAP.LTC', quantityHive: 100 } },
    { operation: 'market_sell', timestamp: 1727600000, data: { symbol: 'SWAP.BLURT', quantityHive: 60 } },
    { operation: 'market_buy', timestamp: 1727600000, data: { symbol: 'SWAP.LTC', quantityHive: 40 } },
  ];
  const tl = reconstructTimeline(ops, 'tester');
  assert.equal(tl.account, 'tester');
  assert.equal(tl.ops, 3);
  // realized = -100 (buy) +60 (sell) -40 (buy) = -80
  assert.equal(tl.finalCumRealized, -80);
  const ltc = tl.tokens.find((t) => t.symbol === 'SWAP.LTC');
  assert.equal(ltc.net, -140);
  assert.equal(ltc.buys, 2);
  assert.match(ltc.first, /^\d{4}-\d{2}-\d{2}$/); // epoch normalized to ISO date
});

test('reconstructTimeline ignores non-fill ops and zero-hive rows', () => {
  const ops = [
    { operation: 'market_placeOrder', timestamp: 1, data: { symbol: 'X', quantityHive: 0 } },
    { operation: 'market_sell', timestamp: 2, data: { symbol: 'X', quantityHive: 0 } },
  ];
  const tl = reconstructTimeline(ops);
  assert.equal(tl.finalCumRealized, 0);
  assert.equal(tl.days, 0);
});

// ── he-client failover ──────────────────────────────────────────────────────────
test('withFailover returns the first node that succeeds', async () => {
  const tried = [];
  const r = await withFailover(['a', 'b', 'c'], async (node) => {
    tried.push(node);
    if (node === 'a') throw new Error('a down');
    return `ok:${node}`;
  });
  assert.equal(r, 'ok:b');
  assert.deepEqual(tried, ['a', 'b']); // stopped at first success, didn't try c
});

test('withFailover throws the last error when all nodes fail', async () => {
  await assert.rejects(
    withFailover(['a', 'b'], async (node) => { throw new Error(`${node} down`); }),
    /b down/,
  );
});
