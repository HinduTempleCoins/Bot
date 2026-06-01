// grade-regression.test.js — the "did this rewrite get worse?" guard (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRegression, lastGrade } from './grade-regression.mjs';

const HIST = [
  { id: 'brief-a', score: 0.8, at: '2026-06-01T00:00:00Z' },
  { id: 'brief-a', score: 0.85, at: '2026-06-01T01:00:00Z' },
  { id: 'brief-b', score: 0.6, at: '2026-06-01T00:00:00Z' },
];

test('flags a regression when the new score drops past the threshold', () => {
  const v = checkRegression('brief-a', 0.6, HIST); // was 0.85 -> 0.6 = -0.25
  assert.equal(v.regressed, true);
  assert.equal(v.prior, 0.85);
  assert.ok(v.delta < 0);
});

test('no regression for an improvement', () => {
  const v = checkRegression('brief-a', 0.95, HIST);
  assert.equal(v.regressed, false);
});

test('no regression for a small dip within threshold', () => {
  const v = checkRegression('brief-a', 0.8, HIST, { drop: 0.1 }); // 0.85 -> 0.8 = -0.05
  assert.equal(v.regressed, false);
});

test('first-ever grade has nothing to regress against', () => {
  const v = checkRegression('brand-new', 0.5, HIST);
  assert.equal(v.regressed, false);
  assert.equal(v.prior, null);
});

test('lastGrade returns the most recent for an id', () => {
  assert.equal(lastGrade('brief-a', HIST).score, 0.85);
  assert.equal(lastGrade('brief-b', HIST).score, 0.6);
});
