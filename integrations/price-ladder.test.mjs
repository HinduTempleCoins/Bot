// price-ladder.test.mjs — offline coverage for the pure order-book sweep model. No network.
// sweep() is the load-bearing market-impact primitive; lock its fill math + guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from './price-ladder.mjs';

test('sweep: empty book spends nothing', () => {
  const r = sweep([], 1000);
  assert.deepEqual(r, { spentHive: 0, tokens: 0, lastPrice: 0 });
});

test('sweep: budget large enough clears the whole book', () => {
  const asks = [{ price: 0.1, quantity: 10 }, { price: 0.2, quantity: 5 }]; // 1.0 + 1.0 = 2.0 HIVE
  const r = sweep(asks, 100);
  assert.equal(+r.spentHive.toFixed(6), 2);
  assert.equal(+r.tokens.toFixed(6), 15);
  assert.equal(r.lastPrice, 0.2);
});

test('sweep: partial fill at the level where budget runs out', () => {
  const asks = [{ price: 0.1, quantity: 10 }, { price: 0.2, quantity: 100 }];
  // first level costs 1.0 HIVE (10 tokens); budget 1.5 leaves 0.5 → 0.5/0.2 = 2.5 tokens at 0.2
  const r = sweep(asks, 1.5);
  assert.equal(+r.spentHive.toFixed(6), 1.5);
  assert.equal(+r.tokens.toFixed(6), 12.5);
  assert.equal(r.lastPrice, 0.2);
});

test('sweep: zero budget fills nothing but does not throw', () => {
  const r = sweep([{ price: 0.1, quantity: 10 }], 0);
  assert.equal(r.spentHive, 0);
  assert.equal(r.tokens, 0);
});

test('sweep: skips malformed/zero/negative levels without crashing', () => {
  const asks = [
    { price: 0, quantity: 10 },        // bad price
    { price: 0.1, quantity: 0 },       // bad qty
    { price: -1, quantity: 5 },        // negative
    { price: 'x', quantity: 'y' },     // NaN
    { price: 0.2, quantity: 4 },       // valid: 0.8 HIVE
  ];
  const r = sweep(asks, 100);
  assert.equal(+r.spentHive.toFixed(6), 0.8);
  assert.equal(+r.tokens.toFixed(6), 4);
  assert.equal(r.lastPrice, 0.2);
});

test('sweep: numeric strings (HIVE-Engine returns strings) are coerced', () => {
  const asks = [{ price: '0.5', quantity: '2' }];
  const r = sweep(asks, 100);
  assert.equal(+r.spentHive.toFixed(6), 1);
  assert.equal(+r.tokens.toFixed(6), 2);
});
