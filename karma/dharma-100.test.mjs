// dharma-100.test.mjs — offline tests for the 100/100 Dharma merit-balance math. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dharmaScore,
  isBalanced,
  tier,
  normalizeAxis,
  DHARMA_TIERS,
  FULL_SCALE,
  REFERENCE_UNITS,
} from './dharma-100.mjs';

test('constants are sane', () => {
  assert.equal(FULL_SCALE, 100);
  assert.ok(REFERENCE_UNITS > 0, 'REFERENCE_UNITS positive');
  assert.ok(Array.isArray(DHARMA_TIERS) && DHARMA_TIERS.length > 0, 'DHARMA_TIERS non-empty');
  // tiers ordered HIGH→LOW and end at min:0 so every score lands somewhere
  for (let i = 1; i < DHARMA_TIERS.length; i++) {
    assert.ok(DHARMA_TIERS[i - 1].min > DHARMA_TIERS[i].min, 'tiers strictly descending');
  }
  assert.equal(DHARMA_TIERS[DHARMA_TIERS.length - 1].min, 0, 'lowest tier covers 0');
});

test('normalizeAxis: linear up to REFERENCE_UNITS', () => {
  assert.equal(normalizeAxis(0), 0);
  assert.equal(normalizeAxis(REFERENCE_UNITS / 2), 50);
  assert.equal(normalizeAxis(REFERENCE_UNITS), 100);
});

test('normalizeAxis: clamps above 100 and below 0', () => {
  assert.equal(normalizeAxis(REFERENCE_UNITS * 10), 100, 'over-scale clamps to 100');
  assert.equal(normalizeAxis(-50), 0, 'negative clamps to 0');
});

test('normalizeAxis: soft-fail on garbage → 0', () => {
  assert.equal(normalizeAxis(undefined), 0);
  assert.equal(normalizeAxis(null), 0);
  assert.equal(normalizeAxis(NaN), 0);
  assert.equal(normalizeAxis(Infinity), 0);
  assert.equal(normalizeAxis('not a number'), 0);
  assert.equal(normalizeAxis({}), 0);
});

test('dharmaScore: symmetric axes → balance 100', () => {
  const s = dharmaScore({ given: 80, received: 80 });
  assert.equal(s.givenScore, 80);
  assert.equal(s.receivedScore, 80);
  assert.equal(s.balance, 100);
});

test('dharmaScore: lopsided (hoarder) → low balance', () => {
  const s = dharmaScore({ given: 10, received: 90 });
  assert.equal(s.givenScore, 10);
  assert.equal(s.receivedScore, 90);
  assert.equal(s.balance, 20); // 100 - |10-90|
});

test('dharmaScore: over-scale inputs clamp before balancing', () => {
  const s = dharmaScore({ given: 1000, received: 1000 });
  assert.equal(s.givenScore, 100);
  assert.equal(s.receivedScore, 100);
  assert.equal(s.balance, 100);
});

test('dharmaScore: soft-fail — missing/garbage arg → zeros, trivially balanced', () => {
  for (const bad of [undefined, null, 42, 'x', []]) {
    const s = dharmaScore(bad);
    assert.equal(s.givenScore, 0);
    assert.equal(s.receivedScore, 0);
    assert.equal(s.balance, 100, 'two zeros are symmetric');
  }
});

test('dharmaScore: never throws on weird member types', () => {
  const s = dharmaScore({ given: 'lots', received: {} });
  assert.equal(s.givenScore, 0);
  assert.equal(s.receivedScore, 0);
  assert.equal(s.balance, 100);
});

test('isBalanced: boundary at exactly tolerance', () => {
  // balance 90 with default tolerance 10 → exactly at the FULL_SCALE-tolerance threshold → balanced
  assert.equal(isBalanced(90), true);
  assert.equal(isBalanced(89), false);
  assert.equal(isBalanced(91), true);
  assert.equal(isBalanced(100), true);
});

test('isBalanced: custom tolerance widens/narrows the band', () => {
  assert.equal(isBalanced(80, 20), true);
  assert.equal(isBalanced(79, 20), false);
  assert.equal(isBalanced(99, 0), false, 'zero tolerance demands perfection');
  assert.equal(isBalanced(100, 0), true);
});

test('isBalanced: accepts a dharmaScore result object', () => {
  assert.equal(isBalanced(dharmaScore({ given: 50, received: 50 })), true);
  assert.equal(isBalanced(dharmaScore({ given: 10, received: 90 })), false);
});

test('isBalanced: soft-fail — garbage score not balanced, garbage tolerance strict', () => {
  assert.equal(isBalanced(undefined), false);
  assert.equal(isBalanced(NaN), false);
  assert.equal(isBalanced('x'), false);
  // negative/NaN tolerance coerces to 0 → only a perfect 100 passes
  assert.equal(isBalanced(95, -5), false);
  assert.equal(isBalanced(100, NaN), true);
});

test('tier: bands map to the right labels', () => {
  assert.equal(tier(95), 'Bodhi');
  assert.equal(tier(90), 'Bodhi');     // inclusive lower edge
  assert.equal(tier(89), 'Dharmika');
  assert.equal(tier(70), 'Dharmika');
  assert.equal(tier(69), 'Grihastha');
  assert.equal(tier(50), 'Grihastha');
  assert.equal(tier(49), 'Shishya');
  assert.equal(tier(30), 'Shishya');
  assert.equal(tier(29), 'Atithi');
  assert.equal(tier(0), 'Atithi');
});

test('tier: clamps out-of-range and accepts score objects', () => {
  assert.equal(tier(1000), 'Bodhi', 'over-100 clamps into top band');
  assert.equal(tier(-50), 'Atithi', 'negative clamps to bottom band');
  assert.equal(tier(dharmaScore({ given: 95, received: 95 })), 'Bodhi'); // balance 100
  assert.equal(tier(dharmaScore({ given: 0, received: 80 })), 'Atithi'); // balance 20
});

test('tier: soft-fail on garbage → lowest band', () => {
  assert.equal(tier(undefined), 'Atithi');
  assert.equal(tier(NaN), 'Atithi');
  assert.equal(tier('nope'), 'Atithi');
});
