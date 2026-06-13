import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWelcomeGrant } from './fund-test-accounts.mjs';

const opts = { pct: 0.05, min: 5, max: 15 }; // explicit so the test ignores env

test('no price: grant is a % of balance, clamped into the band', () => {
  assert.equal(computeWelcomeGrant(212, opts), 10.6);        // 5% of 212, inside 5-15
  assert.equal(computeWelcomeGrant(1000, opts), 15);          // 5% = 50 → capped at band high
  assert.equal(computeWelcomeGrant(200, opts), 10);
});

test('broke: if she cannot afford the low end, she gives only what she can', () => {
  assert.equal(computeWelcomeGrant(40, opts), 2);             // 5% = 2 < 5 → gives 2
  assert.equal(computeWelcomeGrant(0, opts), 0);
});

test('priced: the band becomes a USD target divided by price, still afford-capped', () => {
  // price $2: band = [2.5, 7.5] TESTS; 5% of 212 = 10.6 → min(7.5, 10.6) = 7.5
  assert.equal(computeWelcomeGrant(212, { ...opts, price: 2 }), 7.5);
  // price $0.50: band = [10, 30]; 5% of 212 = 10.6 → inside → 10.6
  assert.equal(computeWelcomeGrant(212, { ...opts, price: 0.5 }), 10.6);
});
