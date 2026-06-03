// certainty.test.mjs — OFFLINE unit tests for the MYCIN certainty-factor algebra.
import { test } from 'node:test';
import assert from 'node:assert';
import { combineCF, chainCF, aggregate, toConfidence, clampCF } from './certainty.mjs';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── clampCF ───────────────────────────────────────────────────────────────────
test('clampCF clamps to [-1, 1] and maps garbage to 0', () => {
  assert.equal(clampCF(2), 1);
  assert.equal(clampCF(-5), -1);
  assert.equal(clampCF(0.5), 0.5);
  assert.equal(clampCF(NaN), 0);
  assert.equal(clampCF('not a number'), 0);
  assert.equal(clampCF(Infinity), 1);
  assert.equal(clampCF(-Infinity), -1);
});

// ── combineCF: both positive ──────────────────────────────────────────────────
test('combineCF both positive: x + y(1-x), grows toward 1 with diminishing returns', () => {
  // 0.5 + 0.5*(1-0.5) = 0.75
  assert.ok(close(combineCF(0.5, 0.5), 0.75));
  // 0.7 + 0.5*(1-0.7) = 0.85
  assert.ok(close(combineCF(0.7, 0.5), 0.85));
  // result exceeds both inputs but stays below 1
  const c = combineCF(0.6, 0.6);
  assert.ok(c > 0.6 && c < 1);
});

// ── combineCF: both negative ───────────────────────────────────────────────────
test('combineCF both negative: x + y(1+x), drives toward -1', () => {
  // -0.5 + -0.5*(1+-0.5) = -0.75
  assert.ok(close(combineCF(-0.5, -0.5), -0.75));
  // -0.7 + -0.5*(1-0.7) = -0.85
  assert.ok(close(combineCF(-0.7, -0.5), -0.85));
  const c = combineCF(-0.6, -0.6);
  assert.ok(c < -0.6 && c > -1);
});

// ── combineCF: mixed sign ──────────────────────────────────────────────────────
test('combineCF mixed sign: partial cancellation via (x+y)/(1-min|.|)', () => {
  // (0.6 + -0.3) / (1 - 0.3) = 0.3/0.7
  assert.ok(close(combineCF(0.6, -0.3), 0.3 / 0.7));
  // equal-and-opposite cancels exactly to 0
  assert.ok(close(combineCF(0.5, -0.5), 0));
  // direct contradiction (+1 vs -1) → 0 ("no idea"), not a divide-by-zero blowup
  assert.equal(combineCF(1, -1), 0);
  assert.ok(Number.isFinite(combineCF(1, -1)));
});

// ── combineCF: commutativity ───────────────────────────────────────────────────
test('combineCF is commutative across all sign regimes', () => {
  const pairs = [[0.7, 0.4], [-0.7, -0.4], [0.6, -0.3], [-0.2, 0.9], [0, 0.5], [0, -0.5]];
  for (const [a, b] of pairs) {
    assert.ok(close(combineCF(a, b), combineCF(b, a)), `commutative for ${a},${b}`);
  }
});

// ── combineCF: associativity (parallel evidence is order-independent) ───────────
test('combineCF is associative for positive evidence', () => {
  const left = combineCF(combineCF(0.3, 0.4), 0.5);
  const right = combineCF(0.3, combineCF(0.4, 0.5));
  assert.ok(close(left, right));
});

// ── combineCF: identity & bounds ───────────────────────────────────────────────
test('combineCF: 0 is the identity element', () => {
  assert.ok(close(combineCF(0.42, 0), 0.42));
  assert.ok(close(combineCF(0, -0.31), -0.31));
});

test('combineCF stays within [-1, 1] and clamps out-of-range inputs', () => {
  for (const a of [-1, -0.5, 0, 0.5, 1]) {
    for (const b of [-1, -0.5, 0, 0.5, 1]) {
      const c = combineCF(a, b);
      assert.ok(c >= -1 && c <= 1, `in-bounds for ${a},${b} got ${c}`);
    }
  }
  // out-of-range inputs are clamped before combining
  assert.equal(combineCF(5, 5), 1);
  assert.equal(combineCF(-5, -5), -1);
});

// ── chainCF: rule discounted by premise belief ─────────────────────────────────
test('chainCF: conclusion = ruleCF * max(0, evidenceCF)', () => {
  assert.ok(close(chainCF(0.8, 0.6), 0.48));
  assert.ok(close(chainCF(1, 0.5), 0.5));
  // full belief in premise passes the rule strength through unchanged
  assert.ok(close(chainCF(0.9, 1), 0.9));
});

test('chainCF: disbelieved premise does NOT fire the rule (clamped to 0)', () => {
  assert.equal(chainCF(0.8, -0.6), 0);
  assert.equal(chainCF(0.8, 0), 0);
});

test('chainCF: a negative rule with positive evidence argues against the conclusion', () => {
  assert.ok(close(chainCF(-0.7, 0.5), -0.35));
});

test('chainCF stays within bounds', () => {
  assert.equal(chainCF(2, 2), 1);   // clamped inputs → 1*1
  assert.ok(chainCF(0.5, 0.5) <= 1 && chainCF(0.5, 0.5) >= -1);
});

// ── aggregate ──────────────────────────────────────────────────────────────────
test('aggregate folds combineCF over a list', () => {
  // combine(0.5,0.5)=0.75 ; combine(0.75,0.5)=0.875
  assert.ok(close(aggregate([0.5, 0.5, 0.5]), 0.875));
});

test('aggregate empty list → 0 (no evidence); single element → itself', () => {
  assert.equal(aggregate([]), 0);
  assert.equal(aggregate(), 0);
  assert.ok(close(aggregate([0.42]), 0.42));
});

test('aggregate is order-independent (uses commutative/associative combineCF)', () => {
  const a = aggregate([0.2, 0.7, -0.3, 0.5]);
  const b = aggregate([0.5, -0.3, 0.7, 0.2]);
  assert.ok(close(a, b));
});

test('aggregate clamps and stays in bounds with extreme inputs', () => {
  const r = aggregate([0.9, 0.9, 0.9, 0.9]);
  assert.ok(r > 0.9 && r <= 1);
  assert.ok(aggregate([5, 5, 5]) <= 1);
});

// ── toConfidence ───────────────────────────────────────────────────────────────
test('toConfidence maps [-1,1] → [0,100] with 0→50 midpoint', () => {
  assert.equal(toConfidence(-1), 0);
  assert.equal(toConfidence(0), 50);
  assert.equal(toConfidence(1), 100);
  assert.equal(toConfidence(0.5), 75);
  assert.equal(toConfidence(-0.5), 25);
});

test('toConfidence clamps out-of-range CFs', () => {
  assert.equal(toConfidence(2), 100);
  assert.equal(toConfidence(-9), 0);
});
