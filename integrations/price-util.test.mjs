// price-util.test.mjs — offline, pure. node --test integrations/price-util.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, rejectOutliers, robustMedian, normalizeQuote, pctDiff, weightedMedian,
} from './price-util.mjs';
import { robustMedian as oracleRobustMedian } from './price-oracle.mjs';

test('median: odd-length', () => {
  assert.equal(median([3, 1, 2]), 2);
});

test('median: even-length averages the two middles', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('median: empty → null', () => {
  assert.equal(median([]), null);
  assert.equal(median(null), null);
});

test('median: ignores NaN / Infinity / junk', () => {
  assert.equal(median([1, NaN, 2, Infinity, 3, 'x']), 2);
  assert.equal(median([NaN, 'x', null]), null);
});

test('rejectOutliers: drops a 10x outlier, keeps the cluster', () => {
  const kept = rejectOutliers([100, 101, 99, 100.5, 1000]);
  assert.ok(!kept.includes(1000));
  assert.deepEqual([...kept].sort((a, b) => a - b), [99, 100, 100.5, 101]);
});

test('rejectOutliers: custom tolPct', () => {
  // with a tight 5% band, 110 is outside ~5% of the median (~100.25)
  const kept = rejectOutliers([100, 100, 100.5, 110], { tolPct: 5 });
  assert.ok(!kept.includes(110));
});

test('rejectOutliers: never returns empty (single value is not its own outlier)', () => {
  assert.deepEqual(rejectOutliers([42]), [42]);
  assert.deepEqual(rejectOutliers([]), []);
});

test('normalizeQuote: bare number', () => {
  assert.equal(normalizeQuote(3.14), 3.14);
});

test('normalizeQuote: object shapes price/usd/value/priceUsd', () => {
  assert.equal(normalizeQuote({ price: 5 }), 5);
  assert.equal(normalizeQuote({ usd: 6 }), 6);
  assert.equal(normalizeQuote({ value: 7 }), 7);
  assert.equal(normalizeQuote({ priceUsd: '8.5' }), 8.5);
  assert.equal(normalizeQuote({ lastPrice: 9 }), 9);
  assert.equal(normalizeQuote({ amount: '10' }), 10);
});

test('normalizeQuote: junk → null', () => {
  assert.equal(normalizeQuote(null), null);
  assert.equal(normalizeQuote(undefined), null);
  assert.equal(normalizeQuote({}), null);
  assert.equal(normalizeQuote({ price: 'abc' }), null);
  assert.equal(normalizeQuote({ foo: 1 }), null);
  assert.equal(normalizeQuote('nope'), null);
  assert.equal(normalizeQuote(NaN), null);
});

test('normalizeQuote: numeric string', () => {
  assert.equal(normalizeQuote('123.45'), 123.45);
});

test('pctDiff: correct', () => {
  assert.equal(pctDiff(110, 100), 10);
  assert.equal(pctDiff(90, 100), -10);
  assert.equal(pctDiff(100, 100), 0);
});

test('pctDiff: divide-by-zero / junk → null', () => {
  assert.equal(pctDiff(1, 0), null);
  assert.equal(pctDiff('x', 100), null);
  assert.equal(pctDiff(1, 'x'), null);
});

test('robustMedian: mixed number+object quotes → cluster median, reports dropped outlier', () => {
  const r = robustMedian([{ usd: 100 }, { price: 101 }, 99, { value: 1000 }]);
  assert.equal(r.price, 100);
  assert.deepEqual(r.dropped, [1000]);
  assert.equal(r.n, 3);
  assert.deepEqual([...r.kept].sort((a, b) => a - b), [99, 100, 101]);
});

test('robustMedian: empty / all-junk → null price, not confident', () => {
  const r = robustMedian([{ foo: 1 }, 'x', null]);
  assert.equal(r.price, null);
  assert.equal(r.n, 0);
  assert.equal(r.confident, false);
});

test('robustMedian: confident when >=2 survivors agree within 5%', () => {
  const r = robustMedian([100, 101, 102]);
  assert.equal(r.confident, true);
  assert.ok(r.spreadPct <= 5);
});

test('robustMedian: not confident on a single source', () => {
  const r = robustMedian([100]);
  assert.equal(r.price, 100);
  assert.equal(r.confident, false);
});

test('robustMedian: keeps duplicate values correctly (multiset partition)', () => {
  const r = robustMedian([100, 100, 100, 1000]);
  assert.deepEqual(r.dropped, [1000]);
  assert.equal(r.n, 3);
  assert.equal(r.price, 100);
});

test('weightedMedian: weight shifts the median toward heavy quote', () => {
  const r = weightedMedian([{ price: 100, volume: 9 }, { price: 110, volume: 1 }]);
  assert.equal(r.price, 100);
});

test('weightedMedian: bare numbers get equal weight', () => {
  const r = weightedMedian([100, 100, 200]);
  assert.equal(r.price, 100);
});

test('weightedMedian: empty → null', () => {
  assert.equal(weightedMedian([]).price, null);
});

// --- Parity with the reference implementation in price-oracle.mjs ---
// price-oracle's robustMedian takes a plain number[] and returns { usd, sources, spreadPct, confident }.
// Ours takes numbers-or-objects and returns { price, n, spreadPct, confident }. On a numeric sample
// the core results must agree (price==usd, n==sources, spreadPct, confident).
test('robustMedian agrees with price-oracle.mjs on numeric samples', () => {
  const samples = [
    [100, 101, 99, 100.5, 1000],
    [2500, 2510, 2490, 2505],
    [0.05, 0.051, 0.049, 0.5],
    [42],
    [10, 11, 30],
  ];
  for (const s of samples) {
    const mine = robustMedian(s);
    const ref = oracleRobustMedian(s);
    assert.equal(mine.price, ref.usd, `price for ${JSON.stringify(s)}`);
    assert.equal(mine.n, ref.sources, `sources for ${JSON.stringify(s)}`);
    assert.equal(mine.spreadPct, ref.spreadPct, `spreadPct for ${JSON.stringify(s)}`);
    assert.equal(mine.confident, ref.confident, `confident for ${JSON.stringify(s)}`);
  }
});
