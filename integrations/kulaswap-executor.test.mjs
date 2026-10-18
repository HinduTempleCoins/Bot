// kulaswap-executor.test.mjs — OFFLINE: calldata, quote decoding, and the profit-only rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { units, fromUnits, encodeApprove, encodeSwap, encodeGetAmountsOut, decodeUintArray, planArb, ROUTER } from './kulaswap-executor.mjs';

test('units round-trip for 8 and 18 decimals', () => {
  assert.equal(units('400', 8), 40000000000n);
  assert.equal(units('1.5', 18), 1500000000000000000n);
  assert.equal(fromUnits(40000000000n, 8), 400);
});

test('calldata selectors and layout', () => {
  assert.equal(encodeApprove(ROUTER, 5n).slice(0, 10), '0x095ea7b3');
  const s = encodeSwap(100n, 99n, ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20)], '0x' + '33'.repeat(20), 1000);
  assert.equal(s.slice(0, 10), '0x38ed1739');
  assert.equal((s.length - 10) / 64, 5 + 1 + 2, 'five head words, array length, two addresses');
  assert.equal(encodeGetAmountsOut(1n, ['0x' + '11'.repeat(20)]).slice(0, 10), '0xd06ca61f');
});

test('decode a uint256[] return', () => {
  const hex = '0x' + (32).toString(16).padStart(64, '0') + '2'.padStart(64, '0') + 'a'.padStart(64, '0') + 'b'.padStart(64, '0');
  assert.deepEqual(decodeUintArray(hex), [10n, 11n]);
  assert.deepEqual(decodeUintArray('0x'), []);
});

test('profit only: refuse below the minimum, pin amountOutMin above break-even', () => {
  assert.equal(planArb({ amountIn: 1000n, quotedOut: 1005n, minProfitBps: 100 }).trade, false);
  assert.equal(planArb({ amountIn: 1000n, quotedOut: 900n }).trade, false);
  const p = planArb({ amountIn: 1000n, quotedOut: 1160n, minProfitBps: 100, slippageBps: 30 });
  assert.equal(p.trade, true);
  assert.ok(p.amountOutMin >= 1010n, 'never below break-even + minimum profit');
  assert.ok(p.amountOutMin <= 1160n);
});

test('rebalance: only past the band, and the swap restores the target', async () => {
  const { planRebalance } = await import('./kulaswap-executor.mjs');
  assert.equal(planRebalance({ balA: 100, balB: 100, price: 1 }).trade, false);
  const p = planRebalance({ balA: 1000, balB: 10, price: 0.74, target: 0.5 });
  assert.equal(p.trade, true); assert.equal(p.side, 'sellA');
  const afterA = 1000 - p.amount, afterB = 10 + p.amount * 0.74;
  assert.ok(Math.abs((afterA * 0.74) / (afterA * 0.74 + afterB) - 0.5) < 1e-9);
});

test('grid: first run sets the level, then buy on a fall, sell on a rise after a buy', async () => {
  const { planGrid } = await import('./kulaswap-executor.mjs');
  assert.equal(planGrid({ price: 18, last: null }).record, 18);
  assert.equal(planGrid({ price: 18.2, last: 18 }).trade, false);
  assert.equal(planGrid({ price: 17.4, last: 18 }).side, 'buy');
  assert.equal(planGrid({ price: 18.6, last: 18, lastSide: 'buy' }).side, 'sell');
  assert.equal(planGrid({ price: 18.6, last: 18, lastSide: 'sell' }).trade, false, 'no sell right after a sell');
});
