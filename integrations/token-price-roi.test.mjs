// token-price-roi.test.mjs — offline unit tests for the price-change / ROI calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pctChange, roi, movingAverage, volatility, summarize } from './token-price-roi.mjs';

// ── pctChange ─────────────────────────────────────────────────────────────────────────
test('pctChange: happy path up and down', () => {
  assert.equal(pctChange(100, 125), 0.25);
  assert.equal(pctChange(100, 50), -0.5);
  assert.equal(pctChange(2, 2), 0);
});

test('pctChange: soft-fail on non-positive / bad from', () => {
  assert.equal(pctChange(0, 10), 0);
  assert.equal(pctChange(-5, 10), 0);
  assert.equal(pctChange(null, 10), 0);
  assert.equal(pctChange('abc', 10), 0);
  assert.equal(pctChange(10, undefined), 0);
  assert.equal(pctChange(10, NaN), 0);
});

// ── roi ───────────────────────────────────────────────────────────────────────────────
test('roi: profitable position', () => {
  const r = roi({ entryPrice: 1.0, currentPrice: 1.4, qty: 500 });
  assert.deepEqual(r, { costBasis: 500, value: 700, pnl: 200, pct: 0.4 });
});

test('roi: loss position', () => {
  const r = roi({ entryPrice: 2, currentPrice: 1, qty: 10 });
  assert.deepEqual(r, { costBasis: 20, value: 10, pnl: -10, pct: -0.5 });
});

test('roi: zero entry price never divides by zero', () => {
  const r = roi({ entryPrice: 0, currentPrice: 5, qty: 3 });
  assert.equal(r.costBasis, 0);
  assert.equal(r.value, 15);
  assert.equal(r.pnl, 15);
  assert.equal(r.pct, 0); // guarded, not Infinity
});

test('roi: soft-fail on missing / bad args', () => {
  assert.deepEqual(roi(), { costBasis: 0, value: 0, pnl: 0, pct: 0 });
  assert.deepEqual(roi({}), { costBasis: 0, value: 0, pnl: 0, pct: 0 });
  assert.deepEqual(roi({ entryPrice: 'x', currentPrice: 1, qty: 1 }),
    { costBasis: 0, value: 0, pnl: 0, pct: 0 });
  assert.deepEqual(roi({ entryPrice: 1, currentPrice: 1, qty: -5 }),
    { costBasis: 0, value: 0, pnl: 0, pct: 0 });
});

test('roi: missing qty treated as zero', () => {
  const r = roi({ entryPrice: 1, currentPrice: 2 });
  assert.deepEqual(r, { costBasis: 0, value: 0, pnl: 0, pct: 0 });
});

// ── movingAverage ─────────────────────────────────────────────────────────────────────
test('movingAverage: trailing window with leading nulls', () => {
  const ma = movingAverage([1, 2, 3, 4, 5], 3);
  assert.deepEqual(ma, [null, null, 2, 3, 4]);
});

test('movingAverage: window of 1 echoes input', () => {
  assert.deepEqual(movingAverage([10, 20, 30], 1), [10, 20, 30]);
});

test('movingAverage: window larger than series is all null', () => {
  assert.deepEqual(movingAverage([1, 2], 5), [null, null]);
});

test('movingAverage: drops non-finite entries before computing', () => {
  // 'x', NaN, undefined dropped → cleaned [2,4,6], window 2 → [null,3,5]
  assert.deepEqual(movingAverage([2, 'x', 4, NaN, 6, undefined], 2), [null, 3, 5]);
});

test('movingAverage: soft-fail on bad window / empty', () => {
  assert.deepEqual(movingAverage([1, 2, 3], 0), []);
  assert.deepEqual(movingAverage([1, 2, 3], -2), []);
  assert.deepEqual(movingAverage([1, 2, 3], 'q'), []);
  assert.deepEqual(movingAverage([], 3), []);
  assert.deepEqual(movingAverage('nope', 3), []);
});

test('movingAverage: fractional window floors to integer', () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4], 2.9), [null, 1.5, 2.5, 3.5]);
});

// ── volatility ────────────────────────────────────────────────────────────────────────
test('volatility: zero for flat series', () => {
  assert.equal(volatility([5, 5, 5, 5]), 0);
});

test('volatility: positive for moving series', () => {
  const v = volatility([1, 2, 1, 2]);
  assert.ok(v > 0);
});

test('volatility: soft-fail for fewer than 2 points', () => {
  assert.equal(volatility([42]), 0);
  assert.equal(volatility([]), 0);
  assert.equal(volatility('nope'), 0);
});

test('volatility: never divides by zero on non-positive base prices', () => {
  // base prices all <= 0 → no usable returns → 0, no Infinity/NaN
  assert.equal(volatility([0, 0, 0]), 0);
  assert.equal(volatility([-1, -2, -3]), 0);
});

// ── summarize ─────────────────────────────────────────────────────────────────────────
test('summarize: full shape over a real series', () => {
  const s = summarize([1.0, 1.1, 1.05, 1.2, 1.15, 1.3, 1.25, 1.4]);
  assert.equal(s.first, 1.0);
  assert.equal(s.last, 1.4);
  assert.equal(s.high, 1.4);
  assert.equal(s.low, 1.0);
  assert.equal(s.pctChange, 0.4);
  assert.ok(typeof s.ma7 === 'number'); // 8 points, window 7 → last filled
  assert.ok(s.vol >= 0);
});

test('summarize: ma7 is null when fewer than 7 points', () => {
  const s = summarize([1, 2, 3]);
  assert.equal(s.ma7, null);
  assert.equal(s.first, 1);
  assert.equal(s.last, 3);
  assert.equal(s.high, 3);
  assert.equal(s.low, 1);
});

test('summarize: empty / unusable input gives null/zero shape', () => {
  const s = summarize([]);
  assert.deepEqual(s, { first: null, last: null, high: null, low: null, pctChange: 0, ma7: null, vol: 0 });
  assert.deepEqual(summarize('nope'),
    { first: null, last: null, high: null, low: null, pctChange: 0, ma7: null, vol: 0 });
});

test('summarize: single point', () => {
  const s = summarize([7]);
  assert.equal(s.first, 7);
  assert.equal(s.last, 7);
  assert.equal(s.high, 7);
  assert.equal(s.low, 7);
  assert.equal(s.pctChange, 0);
  assert.equal(s.ma7, null);
  assert.equal(s.vol, 0);
});
