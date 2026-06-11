// snapshot-delta.test.mjs — offline tests for the pure snapshot delta tracker.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diff, series, firstLast, summarize, __setReader } from './snapshot-delta.mjs';

// crafted 3-point series (the value side of one price-snapshots.json entry)
function mk(unique, whales, gini, floor, costToPush, current) {
  return {
    symbol: 'TKN',
    holders: { unique, whales, top10Percent: 0.5, giniCoefficient: gini },
    price: { current, target: 1, percentToTarget: 0 },
    wall: { costToPush, sellFloor: floor },
  };
}

const S0 = mk(1000, 10, 0.80, 0.0100, 5.0, 0.0100);
const S1 = mk(1014, 11, 0.79, 0.0101, 5.5, 0.0102);
const S2 = mk(1030, 12, 0.78, 0.0103, 6.0, 0.0105);

test('diff computes signed delta + pct for each tracked field', () => {
  const d = diff(S0, S1);
  assert.equal(d.holdersUnique.from, 1000);
  assert.equal(d.holdersUnique.to, 1014);
  assert.equal(d.holdersUnique.delta, 14);
  assert.equal(d.holdersUnique.pct, 1.4);

  assert.equal(d.whales.delta, 1);
  assert.equal(d.gini.delta, -0.01);
  assert.equal(d.floor.delta, 0.0001);
  assert.equal(d.costToPush.delta, 0.5);
  assert.equal(d.priceCurrent.delta, 0.0002);
  // pct present and signed correctly
  assert.equal(d.gini.pct, -1.25);
});

test('diff is soft-fail on missing fields: delta/pct null, never throws', () => {
  const partial = { holders: { unique: 1100 } }; // no whales/gini/wall/price
  const d = diff(S0, partial);
  assert.equal(d.holdersUnique.delta, 100);
  assert.equal(d.whales.delta, null);
  assert.equal(d.whales.pct, null);
  assert.equal(d.gini.delta, null);
  assert.equal(d.floor.delta, null);
  assert.equal(d.costToPush.delta, null);
  assert.equal(d.priceCurrent.delta, null);
});

test('diff handles non-object / null inputs without throwing', () => {
  assert.doesNotThrow(() => diff(null, undefined));
  const d = diff(null, S1);
  assert.equal(d.holdersUnique.from, null);
  assert.equal(d.holdersUnique.delta, null);
});

test('diff guards divide-by-zero (from === 0 => pct null, delta intact)', () => {
  const zero = mk(0, 0, 0, 0, 0, 0);
  const d = diff(zero, S1);
  assert.equal(d.holdersUnique.delta, 1014);
  assert.equal(d.holdersUnique.pct, null); // from 0 => no pct
});

test('series produces N-1 consecutive diffs over a 3-point series', () => {
  const out = series([S0, S1, S2]);
  assert.equal(out.length, 2);
  assert.equal(out[0].holdersUnique.delta, 14);   // S0 -> S1
  assert.equal(out[1].holdersUnique.delta, 16);   // S1 -> S2
});

test('series on a 2-point series yields one diff; <2 yields []', () => {
  assert.equal(series([S0, S1]).length, 1);
  assert.equal(series([S0]).length, 0);
  assert.deepEqual(series([]), []);
  assert.deepEqual(series('nope'), []);
});

test('series skips non-object entries (soft-fail)', () => {
  const out = series([S0, null, S2, 'x']);
  // only S0 and S2 survive => 1 diff
  assert.equal(out.length, 1);
  assert.equal(out[0].holdersUnique.delta, 30); // S0 -> S2
});

test('firstLast collapses the whole window to first->last', () => {
  const d = firstLast([S0, S1, S2]);
  assert.equal(d.holdersUnique.from, 1000);
  assert.equal(d.holdersUnique.to, 1030);
  assert.equal(d.holdersUnique.delta, 30);
  assert.equal(d.priceCurrent.delta, 0.0005);
});

test('firstLast soft-fails on <2 points (all deltas null/zero, never throws)', () => {
  const d1 = firstLast([S0]);          // single point: diff(S0,S0)
  assert.equal(d1.holdersUnique.delta, 0);
  const d0 = firstLast([]);            // empty: diff(undefined,undefined)
  assert.equal(d0.holdersUnique.delta, null);
});

test('summarize renders the one-line string in spec form', () => {
  const d = diff(S0, S1);
  const s = summarize(d);
  assert.ok(s.includes('holders +14 (+1.4%)'), s);
  assert.ok(s.includes('gini -0.01'), s);
  assert.ok(s.includes('floor +0.0001'), s);
});

test('summarize skips null-delta fields and never throws', () => {
  const d = diff(S0, { holders: { unique: 1010 } });
  const s = summarize(d);
  assert.ok(s.includes('holders +10'), s);
  assert.ok(!s.includes('whales'), s);
  assert.ok(!s.includes('gini'), s);
});

test('summarize on empty / non-object => "no change"', () => {
  assert.equal(summarize(null), 'no change');
  assert.equal(summarize({}), 'no change');
  // all-null deltas also read as no change
  assert.equal(summarize(diff(null, null)), 'no change');
});

test('__setReader seam is injectable and offline', () => {
  let called = '';
  __setReader((p) => { called = p; return JSON.stringify({ TKN: [S0, S1] }); });
  // nothing in the public API forces a read, but the seam must accept + reset cleanly
  assert.doesNotThrow(() => __setReader(null));
  assert.equal(called, '');
});
