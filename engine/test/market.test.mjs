// market.test.mjs — OFFLINE: the AMM math the market pages show, and the page with PRANA unreachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountOut, priceImpact, priceIn, renderMarket, renderToken, __setFetch } from '../ui/market.mjs';

test('constant-product output with the 0.3% fee', () => {
  // 100 in against 1000/1000: 100*9970*1000 / (1000*10000 + 100*9970) = 90.66
  assert.ok(Math.abs(amountOut(100, 1000, 1000) - 90.66) < 0.01);
  assert.equal(amountOut(0, 1000, 1000), 0);
});

test('price impact grows with size and includes the fee', () => {
  const small = priceImpact(1, 1000, 1000), big = priceImpact(250, 1000, 1000);
  assert.ok(small > 0.0029 && small < 0.005);
  assert.ok(big > small && big > 0.2);
});

test('prices route through KULA when there is no direct pool', () => {
  const pools = [{ s0: 'A', s1: 'KULA', r0: 10, r1: 20 }, { s0: 'KULA', s1: 'B', r0: 100, r1: 50 }];
  assert.equal(priceIn(pools, 'A', 'KULA'), 2);
  assert.equal(priceIn(pools, 'A', 'B'), 1);
  assert.equal(priceIn(pools, 'C', 'KULA'), null);
});

test('pages render with PRANA unreachable, and unknown tokens are a 404', async () => {
  __setFetch(async () => { throw new Error('offline'); });
  assert.match(await renderMarket(), /unreachable right now/);
  assert.equal(await renderToken('NOPE'), null);
  __setFetch(null);
});
