// voting_rules/karma-curation-bridge.test.mjs — offline tests for the karma→curation bridge.
// node:test + node:assert/strict, fully offline, no network, no disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KARMA_SCALE,
  MAX_WEIGHT,
  esc,
  karmaOf,
  curationWeight,
  rankByCurationPower,
  karmaWeightedBudget,
  __setReader,
  __getReader,
} from './karma-curation-bridge.mjs';

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── constants / esc ──────────────────────────────────────────────────────────
test('constants', () => {
  assert.equal(KARMA_SCALE, 100);
  assert.equal(MAX_WEIGHT, 10000);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── injectable seam ────────────────────────────────────────────────────────
test('__setReader / __getReader round-trips and rejects non-functions', () => {
  const fn = () => 1;
  __setReader(fn);
  assert.equal(__getReader(), fn);
  __setReader('not a fn');
  assert.equal(__getReader(), null);
});

// ── karmaOf ──────────────────────────────────────────────────────────────────
test('karmaOf reads field priority karma>dharma>score>balance', () => {
  assert.equal(karmaOf({ karma: 42, dharma: 10 }), 42);
  assert.equal(karmaOf({ dharma: 30 }), 30);
  assert.equal(karmaOf({ score: 70 }), 70);
  assert.equal(karmaOf({ balance: 88 }), 88);
});

test('karmaOf accepts bare numbers and clamps to 0..100', () => {
  assert.equal(karmaOf(55), 55);
  assert.equal(karmaOf(250), 100);
  assert.equal(karmaOf(-5), 0);
});

test('karmaOf soft-fails on junk', () => {
  assert.equal(karmaOf(null), 0);
  assert.equal(karmaOf(undefined), 0);
  assert.equal(karmaOf('hello'), 0);
  assert.equal(karmaOf({}), 0);
  assert.equal(karmaOf({ karma: NaN }), 0);
  assert.equal(karmaOf({ karma: Infinity }), 0);
});

// ── curationWeight ───────────────────────────────────────────────────────────
test('curationWeight linear at gamma=1', () => {
  assert.ok(approx(curationWeight(100, { gamma: 1 }), 1));
  assert.ok(approx(curationWeight(50, { gamma: 1 }), 0.5));
  assert.ok(approx(curationWeight(0, { gamma: 1 }), 0));
});

test('curationWeight default gamma=0.5 (sqrt) compresses differences', () => {
  // sqrt(0.25)=0.5 — a 25-karma account gets HALF the weight, not a quarter.
  assert.ok(approx(curationWeight(25), 0.5));
  assert.ok(approx(curationWeight(100), 1));
});

test('curationWeight soft-fails: bad karma -> 0, bad gamma -> linear', () => {
  assert.equal(curationWeight(NaN), 0);
  assert.ok(approx(curationWeight(50, { gamma: 0 }), 0.5));   // 0 gamma -> linear
  assert.ok(approx(curationWeight(50, { gamma: -3 }), 0.5));  // negative -> linear
  // NaN gamma -> num() default 0.5 -> 0.5^0.5 = sqrt(0.5).
  assert.ok(approx(curationWeight(50, { gamma: NaN }), Math.sqrt(0.5)));
});

// ── rankByCurationPower ──────────────────────────────────────────────────────
test('rankByCurationPower sorts by weight desc, then name', () => {
  const out = rankByCurationPower([
    { name: 'low', karma: 10 },
    { name: 'high', karma: 90 },
    { name: 'mid', karma: 50 },
  ], { gamma: 1 });
  assert.deepEqual(out.map((a) => a.name), ['high', 'mid', 'low']);
  assert.ok(approx(out[0].weight, 0.9));
});

test('rankByCurationPower tie-break by name then index (stable)', () => {
  const out = rankByCurationPower([
    { name: 'zeta', karma: 50 },
    { name: 'alpha', karma: 50 },
  ], { gamma: 1 });
  assert.deepEqual(out.map((a) => a.name), ['alpha', 'zeta']);
});

test('rankByCurationPower soft-fails on non-array / empty', () => {
  assert.deepEqual(rankByCurationPower(null), []);
  assert.deepEqual(rankByCurationPower(undefined), []);
  assert.deepEqual(rankByCurationPower('nope'), []);
  assert.deepEqual(rankByCurationPower([]), []);
});

test('rankByCurationPower handles malformed entries (karma 0)', () => {
  const out = rankByCurationPower([null, {}, { name: 'x', karma: 80 }], { gamma: 1 });
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'x');
  assert.equal(out[0].karma, 80);
});

// ── karmaWeightedBudget: happy path ──────────────────────────────────────────
test('karmaWeightedBudget distributes proportionally when no cap binds', () => {
  // Two equal-karma accounts, generous cap -> split evenly.
  const r = karmaWeightedBudget(
    [{ name: 'a', karma: 50 }, { name: 'b', karma: 50 }],
    100,
    { gamma: 1, capFraction: 1 },
  );
  const a = r.distribution.find((d) => d.name === 'a');
  const b = r.distribution.find((d) => d.name === 'b');
  assert.ok(approx(a.share, 50));
  assert.ok(approx(b.share, 50));
  assert.ok(approx(r.distributed, 100));
});

test('karmaWeightedBudget caps a whale and redistributes the excess', () => {
  // Whale would otherwise dominate; capFraction 0.25 pins it to 25% of budget.
  const r = karmaWeightedBudget(
    [
      { name: 'whale', karma: 100 },
      { name: 'a', karma: 10 },
      { name: 'b', karma: 10 },
      { name: 'c', karma: 10 },
    ],
    100,
    { gamma: 1, capFraction: 0.25 },
  );
  const whale = r.distribution.find((d) => d.name === 'whale');
  assert.ok(approx(whale.share, 25), `whale share ${whale.share}`);
  // Remaining 75 split among a,b,c equally (25 each).
  for (const n of ['a', 'b', 'c']) {
    const d = r.distribution.find((x) => x.name === n);
    assert.ok(approx(d.share, 25), `${n} share ${d.share}`);
  }
  assert.ok(approx(r.distributed, 100));
  assert.ok(approx(r.cap, 25));
});

test('karmaWeightedBudget never lets one account exceed cap (multi-whale)', () => {
  const r = karmaWeightedBudget(
    [
      { name: 'w1', karma: 100 },
      { name: 'w2', karma: 100 },
      { name: 'small', karma: 1 },
    ],
    100,
    { gamma: 1, capFraction: 0.25 },
  );
  for (const d of r.distribution) {
    assert.ok(d.share <= r.cap + 1e-9, `${d.name} share ${d.share} > cap ${r.cap}`);
  }
});

test('karmaWeightedBudget reports votes (rounded) and voteWeight (graphene)', () => {
  const r = karmaWeightedBudget(
    [{ name: 'a', karma: 100 }, { name: 'b', karma: 50 }],
    10,
    { gamma: 1, capFraction: 1 },
  );
  const a = r.distribution.find((d) => d.name === 'a');
  assert.equal(typeof a.votes, 'number');
  assert.equal(a.votes, Math.round(a.share));
  // voteWeight derives from karma -> percent×100 of MAX_WEIGHT.
  assert.equal(a.voteWeight, 10000);
  const b = r.distribution.find((d) => d.name === 'b');
  assert.equal(b.voteWeight, 5000);
});

test('karmaWeightedBudget skips below-min-karma and zero-weight accounts', () => {
  const r = karmaWeightedBudget(
    [
      { name: 'ok', karma: 80 },
      { name: 'tiny', karma: 2 },
      { name: 'zero', karma: 0 },
    ],
    100,
    { gamma: 1, capFraction: 1, minKarma: 5 },
  );
  const names = r.distribution.map((d) => d.name);
  assert.deepEqual(names, ['ok']);
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.name, s.reason]));
  assert.equal(reasons.tiny, 'below-min-karma');
  // 'zero' has karma 0: below default? minKarma is 5, so also below-min-karma.
  assert.equal(reasons.zero, 'below-min-karma');
});

test('karmaWeightedBudget skips zero-weight when minKarma=0', () => {
  const r = karmaWeightedBudget(
    [{ name: 'ok', karma: 80 }, { name: 'zero', karma: 0 }],
    100,
    { gamma: 1, capFraction: 1, minKarma: 0 },
  );
  const names = r.distribution.map((d) => d.name);
  assert.deepEqual(names, ['ok']);
  assert.equal(r.skipped.find((s) => s.name === 'zero').reason, 'zero-weight');
});

// ── karmaWeightedBudget: edge / soft-fail ────────────────────────────────────
test('karmaWeightedBudget soft-fails on bad budget', () => {
  const r = karmaWeightedBudget([{ name: 'a', karma: 50 }], NaN);
  assert.equal(r.budget, 0);
  assert.equal(r.distributed, 0);
  assert.equal(r.distribution[0].share, 0);
});

test('karmaWeightedBudget soft-fails on negative budget -> 0', () => {
  const r = karmaWeightedBudget([{ name: 'a', karma: 50 }], -100, { capFraction: 1 });
  assert.equal(r.budget, 0);
  assert.equal(r.distributed, 0);
});

test('karmaWeightedBudget non-array accounts -> empty distribution', () => {
  const r = karmaWeightedBudget(null, 100);
  assert.deepEqual(r.distribution, []);
  assert.equal(r.distributed, 0);
  assert.equal(r.budget, 100);
});

test('karmaWeightedBudget all-zero-karma -> nothing distributed', () => {
  const r = karmaWeightedBudget(
    [{ name: 'a', karma: 0 }, { name: 'b', karma: 0 }],
    100,
    { minKarma: 0 },
  );
  assert.deepEqual(r.distribution, []);
  assert.equal(r.distributed, 0);
  assert.equal(r.skipped.length, 2);
});

test('karmaWeightedBudget clamps capFraction out of range', () => {
  // capFraction > 1 clamps to 1 (no cap binds for a single account).
  const r = karmaWeightedBudget([{ name: 'a', karma: 50 }], 100, { capFraction: 5, gamma: 1 });
  assert.ok(approx(r.cap, 100));
  assert.ok(approx(r.distribution[0].share, 100));
  // capFraction <= 0 -> treated as 1 (no cap).
  const r2 = karmaWeightedBudget([{ name: 'a', karma: 50 }], 100, { capFraction: 0, gamma: 1 });
  assert.ok(approx(r2.cap, 100));
});

test('karmaWeightedBudget never throws on garbage', () => {
  assert.doesNotThrow(() => karmaWeightedBudget(undefined, undefined, undefined));
  assert.doesNotThrow(() => karmaWeightedBudget([null, 5, 'x'], 'bad', { gamma: 'x', capFraction: 'y' }));
});

test('karmaWeightedBudget total distributed never exceeds budget', () => {
  const r = karmaWeightedBudget(
    [
      { name: 'a', karma: 90 },
      { name: 'b', karma: 60 },
      { name: 'c', karma: 30 },
      { name: 'd', karma: 100 },
    ],
    50,
    { gamma: 0.5, capFraction: 0.3 },
  );
  assert.ok(r.distributed <= r.budget + 1e-9);
});
