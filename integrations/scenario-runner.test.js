// scenario-runner.test.js — the weighted selector. Proves the ≥20% VKBT/CURE daily floor holds
// and that selection stays within the wallet's holdings. Pure (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTokens, PRIORITY_TOKENS, PRIORITY_FLOOR } from './scenario-runner.mjs';

const HOLDINGS = ['VKBT', 'CURE', 'SWAP.GIFU', 'SWAP.PEPET', 'TOOFUCKEH', 'SWAP.HIVE'];

test('over a full day (96 ticks) at least 20% of runs hit VKBT/CURE', () => {
  let priority = 0;
  for (let t = 0; t < 96; t++) {
    const picked = pickTokens(t, HOLDINGS, () => 0.99); // worst case: rng never picks priority by chance
    if (picked.some((s) => PRIORITY_TOKENS.includes(s))) priority++;
  }
  assert.ok(priority / 96 >= PRIORITY_FLOOR, `priority share ${(priority / 96 * 100).toFixed(1)}% < floor`);
});

test('forced ticks alternate between VKBT and CURE', () => {
  // ticks 0,5,10,15 are forced (every 5th). They should alternate VKBT/CURE.
  assert.deepEqual(pickTokens(0, HOLDINGS, () => 0.5), ['VKBT']);
  assert.deepEqual(pickTokens(5, HOLDINGS, () => 0.5), ['CURE']);
  assert.deepEqual(pickTokens(10, HOLDINGS, () => 0.5), ['VKBT']);
});

test('always picks a token the wallet actually holds', () => {
  for (let t = 0; t < 50; t++) {
    const picked = pickTokens(t, HOLDINGS, () => (t % 7) / 7);
    for (const s of picked) assert.ok(HOLDINGS.includes(s), `${s} not held`);
  }
});

test('priority tokens carry extra weight (appear MORE than the bare floor)', () => {
  let priority = 0;
  // uniform-ish rng -> with 2x weight, VKBT/CURE should exceed the 20% floor
  for (let t = 0; t < 200; t++) { const r = (t * 0.013) % 1; if (pickTokens(t, HOLDINGS, () => r).some((s) => PRIORITY_TOKENS.includes(s))) priority++; }
  assert.ok(priority / 200 > PRIORITY_FLOOR, 'extra weight should push above the floor');
});

test('empty holdings -> empty pick (no crash)', () => {
  assert.deepEqual(pickTokens(3, [], () => 0.5), []);
});
