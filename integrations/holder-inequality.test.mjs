// holder-inequality.test.mjs — offline, no network. Exercises the pure inequality calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gini, nakamotoCoefficient, topNShare, lorenzPoints, herfindahl, inequality,
} from './holder-inequality.mjs';

test('gini of a perfectly equal vector is ~0', () => {
  assert.ok(Math.abs(gini([1, 1, 1, 1])) < 1e-9, `expected ~0, got ${gini([1, 1, 1, 1])}`);
  assert.ok(Math.abs(gini([5, 5, 5])) < 1e-9);
});

test('gini of a single-whale vector approaches 1', () => {
  const g = gini([1000000, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.ok(g > 0.85, `expected near 1, got ${g}`);
  assert.ok(g < 1, 'gini stays strictly below 1');
  // monotonic: more concentration → higher gini
  assert.ok(gini([100, 1, 1, 1]) > gini([10, 1, 1, 1]));
});

test('gini accepts {account,total} objects identically to raw numbers', () => {
  const objs = [{ account: 'a', total: 4 }, { account: 'b', total: 1 }, { account: 'c', total: 1 }];
  assert.equal(gini(objs), gini([4, 1, 1]));
  // and percentOfSupply as a fallback weight field
  const pcts = [{ account: 'a', percentOfSupply: 50 }, { account: 'b', percentOfSupply: 50 }];
  assert.ok(Math.abs(gini(pcts)) < 1e-9);
});

test('nakamoto on a known vector', () => {
  // total = 100. sorted desc: 50,30,10,10. 51% target = 51.
  //   50 < 51 → need 2 (50+30=80 ≥ 51).
  assert.equal(nakamotoCoefficient([10, 50, 30, 10]), 2);
  // a 60% whale alone clears 51% → nakamoto 1
  assert.equal(nakamotoCoefficient([60, 20, 20]), 1);
  // perfectly equal 10 holders, need 6 to clear 51%
  assert.equal(nakamotoCoefficient(Array(10).fill(1)), 6);
  // custom threshold
  assert.equal(nakamotoCoefficient([60, 20, 20], 0.7), 2);
});

test('topNShare returns top-n percentage of supply', () => {
  assert.equal(topNShare([50, 30, 10, 10], 1), 50);
  assert.equal(topNShare([50, 30, 10, 10], 2), 80);
  assert.equal(topNShare([50, 30, 10, 10], 99), 100);
});

test('herfindahl: equal → 1/n, single holder → 1', () => {
  assert.ok(Math.abs(herfindahl([1, 1, 1, 1]) - 0.25) < 1e-6);
  assert.equal(herfindahl([42]), 1);
  assert.ok(herfindahl([90, 5, 5]) > herfindahl([40, 30, 30]));
});

test('lorenzPoints start at origin, end at (1,1)', () => {
  const pts = lorenzPoints([1, 2, 3, 4]);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  const last = pts[pts.length - 1];
  assert.equal(last.x, 1);
  assert.equal(last.y, 1);
  assert.equal(pts.length, 5); // origin + one per holder
});

test('inequality() combined summary, with issuer exclusion', () => {
  const balances = [
    { account: 'issuer', total: 900 },
    { account: 'a', total: 50 },
    { account: 'b', total: 30 },
    { account: 'c', total: 20 },
  ];
  const all = inequality(balances);
  assert.equal(all.holders, 4);
  const sans = inequality(balances, { issuer: 'issuer' });
  assert.equal(sans.holders, 3); // issuer dropped
  assert.ok(sans.gini < all.gini, 'removing the dominant issuer lowers measured inequality');
  // summary shape
  for (const k of ['gini', 'nakamoto', 'top10', 'top1', 'whaleCount', 'herfindahl']) {
    assert.ok(k in all, `missing key ${k}`);
  }
});

test('soft-fail: empty / invalid input returns zeros, never throws', () => {
  assert.equal(gini([]), 0);
  assert.equal(gini(null), 0);
  assert.equal(gini('nonsense'), 0);
  assert.equal(nakamotoCoefficient([]), 0);
  assert.equal(topNShare([], 5), 0);
  assert.equal(herfindahl([]), 0);
  assert.deepEqual(lorenzPoints([]), [{ x: 0, y: 0 }]);
  const s = inequality(undefined);
  assert.deepEqual(s, { gini: 0, nakamoto: 0, top10: 0, top1: 0, whaleCount: 0, herfindahl: 0, holders: 0 });
  // garbage entries are filtered, not fatal
  assert.equal(gini([{ account: 'x' }, NaN, -5, 'foo', 2, 2]), 0);
});
