// contribution-reward.test.mjs — offline tests for the data-contribution reward points calculator.
// node:test + node:assert/strict, fully offline (pure module, no network/IO).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreContribution,
  rankContributions,
  poolSplit,
  WEIGHTS,
  esc,
} from './contribution-reward.mjs';

// --- scoreContribution: happy path --------------------------------------------------------------

test('scoreContribution: accepted contribution earns positive points', () => {
  const p = scoreContribution({ words: 200, sources: 2, novelty: 1, accepted: true });
  // base 10 + words min(200*0.1,50)=20 + sources min(2*5,30)=10 = 40; novelty 1 -> mult 1.0 -> 40
  assert.equal(p, 40);
});

test('scoreContribution: novelty=0 still keeps the floor (half), never zero/negative', () => {
  const full = scoreContribution({ words: 200, sources: 2, novelty: 1, accepted: true });
  const none = scoreContribution({ words: 200, sources: 2, novelty: 0, accepted: true });
  assert.equal(none, full * WEIGHTS.noveltyFloor); // 40 * 0.5 = 20
  assert.ok(none > 0);
});

test('scoreContribution: word and source contributions are CAPPED', () => {
  // huge word/source counts should be limited to wordCap+sourceCap+base, then novelty mult.
  const p = scoreContribution({ words: 999999, sources: 999999, novelty: 1, accepted: true });
  const capped = WEIGHTS.base + WEIGHTS.wordCap + WEIGHTS.sourceCap; // 10+50+30 = 90
  assert.equal(p, capped);
});

test('scoreContribution: rejected => 0', () => {
  assert.equal(scoreContribution({ words: 1000, sources: 10, novelty: 1, accepted: false }), 0);
});

test('scoreContribution: missing accepted flag => 0 (must be explicitly accepted)', () => {
  assert.equal(scoreContribution({ words: 1000, sources: 10, novelty: 1 }), 0);
});

test('scoreContribution: opts override weights', () => {
  const p = scoreContribution(
    { words: 0, sources: 0, novelty: 1, accepted: true },
    { base: 100 },
  );
  assert.equal(p, 100); // base 100, no words/sources, novelty 1 -> mult 1
});

test('scoreContribution: words/sources accepted as arrays (length used)', () => {
  const a = scoreContribution({ words: ['a', 'b', 'c'], sources: ['s'], novelty: 1, accepted: true });
  const b = scoreContribution({ words: 3, sources: 1, novelty: 1, accepted: true });
  assert.equal(a, b);
});

// --- scoreContribution: soft-fail / edge ---------------------------------------------------------

test('scoreContribution: garbage inputs soft-fail to a finite non-negative number', () => {
  for (const bad of [undefined, null, 'x', 42, [], NaN, {}]) {
    const p = scoreContribution(bad);
    assert.ok(Number.isFinite(p), `finite for ${String(bad)}`);
    assert.ok(p >= 0);
  }
});

test('scoreContribution: negative words/sources and out-of-range novelty are clamped', () => {
  const p = scoreContribution({ words: -500, sources: -5, novelty: 9, accepted: true });
  // words/sources -> 0; novelty clamps to 1 -> just base*1 = 10
  assert.equal(p, WEIGHTS.base);
  assert.ok(Number.isFinite(p));
});

test('scoreContribution: NaN/string fields never produce NaN', () => {
  const p = scoreContribution({ words: 'lots', sources: NaN, novelty: 'meh', accepted: true });
  assert.ok(Number.isFinite(p));
  assert.ok(p >= 0);
});

// --- rankContributions ---------------------------------------------------------------------------

test('rankContributions: sorted desc by points with 1-based rank attached', () => {
  const list = [
    { id: 'low', words: 10, sources: 0, novelty: 0.1, accepted: true },
    { id: 'high', words: 1000, sources: 10, novelty: 1, accepted: true },
    { id: 'mid', words: 200, sources: 2, novelty: 0.5, accepted: true },
  ];
  const ranked = rankContributions(list);
  assert.equal(ranked[0].id, 'high');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[2].id, 'low');
  assert.equal(ranked[2].rank, 3);
  // monotonic non-increasing points
  assert.ok(ranked[0].points >= ranked[1].points);
  assert.ok(ranked[1].points >= ranked[2].points);
});

test('rankContributions: stable — ties broken by original input order', () => {
  const same = { words: 100, sources: 1, novelty: 0.5, accepted: true };
  const list = [
    { id: 'first', ...same },
    { id: 'second', ...same },
    { id: 'third', ...same },
  ];
  const ranked = rankContributions(list);
  assert.deepEqual(ranked.map((r) => r.id), ['first', 'second', 'third']);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test('rankContributions: rejected contributions sink to 0 points but still ranked', () => {
  const list = [
    { id: 'rej', words: 9999, sources: 99, novelty: 1, accepted: false },
    { id: 'acc', words: 50, sources: 1, novelty: 0.5, accepted: true },
  ];
  const ranked = rankContributions(list);
  assert.equal(ranked[0].id, 'acc');
  assert.equal(ranked[1].id, 'rej');
  assert.equal(ranked[1].points, 0);
});

test('rankContributions: non-array / empty => []', () => {
  assert.deepEqual(rankContributions(undefined), []);
  assert.deepEqual(rankContributions(null), []);
  assert.deepEqual(rankContributions('nope'), []);
  assert.deepEqual(rankContributions([]), []);
});

test('rankContributions: preserves original fields on each element', () => {
  const ranked = rankContributions([{ id: 'x', extra: 'keep', words: 10, accepted: true }]);
  assert.equal(ranked[0].id, 'x');
  assert.equal(ranked[0].extra, 'keep');
  assert.ok('points' in ranked[0]);
  assert.equal(ranked[0].rank, 1);
});

// --- poolSplit -----------------------------------------------------------------------------------

test('poolSplit: distributes pro-rata to points', () => {
  const payouts = poolSplit({ scores: [30, 10], pool: 100 });
  assert.equal(payouts.length, 2);
  assert.ok(Math.abs(payouts[0] - 75) < 1e-9);
  assert.ok(Math.abs(payouts[1] - 25) < 1e-9);
  assert.ok(Math.abs(payouts[0] + payouts[1] - 100) < 1e-9);
});

test('poolSplit: accepts scored objects ({points}) as well as raw numbers', () => {
  const a = poolSplit({ scores: [{ points: 30 }, { points: 10 }], pool: 100 });
  const b = poolSplit({ scores: [30, 10], pool: 100 });
  assert.deepEqual(a, b);
});

test('poolSplit: total points <= 0 => all zero, never NaN', () => {
  const payouts = poolSplit({ scores: [0, 0, 0], pool: 1000 });
  assert.deepEqual(payouts, [0, 0, 0]);
  for (const p of payouts) assert.ok(Number.isFinite(p));
});

test('poolSplit: negative/garbage points treated as 0 for their share', () => {
  const payouts = poolSplit({ scores: [-5, 'x', 10], pool: 100 });
  assert.equal(payouts.length, 3);
  assert.equal(payouts[0], 0);
  assert.equal(payouts[1], 0);
  assert.ok(Math.abs(payouts[2] - 100) < 1e-9);
});

test('poolSplit: non-finite/negative pool => all zero', () => {
  assert.deepEqual(poolSplit({ scores: [1, 2], pool: NaN }), [0, 0]);
  assert.deepEqual(poolSplit({ scores: [1, 2], pool: -50 }), [0, 0]);
});

test('poolSplit: missing/garbage args => [] or zeros, never throws', () => {
  assert.deepEqual(poolSplit(), []);
  assert.deepEqual(poolSplit({}), []);
  assert.deepEqual(poolSplit({ scores: 'nope', pool: 10 }), []);
});

test('poolSplit: never produces NaN across fuzzed inputs', () => {
  const inputs = [
    { scores: [Infinity, 1], pool: 100 },
    { scores: [NaN, NaN], pool: 100 },
    { scores: [1], pool: Infinity },
  ];
  for (const inp of inputs) {
    for (const v of poolSplit(inp)) assert.ok(Number.isFinite(v));
  }
});

// --- end-to-end: score -> rank -> split ----------------------------------------------------------

test('end-to-end: rank then split distributes the whole pool among accepted only', () => {
  const list = [
    { id: 'a', words: 800, sources: 5, novelty: 0.9, accepted: true },
    { id: 'b', words: 120, sources: 1, novelty: 0.4, accepted: true },
    { id: 'c', words: 500, sources: 3, novelty: 0.7, accepted: false }, // rejected
  ];
  const ranked = rankContributions(list);
  const payouts = poolSplit({ scores: ranked, pool: 1000 });
  const total = payouts.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total - 1000) < 1e-6); // whole pool distributed
  // rejected 'c' is last and gets 0
  const cIdx = ranked.findIndex((r) => r.id === 'c');
  assert.equal(payouts[cIdx], 0);
});

// --- esc -----------------------------------------------------------------------------------------

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
