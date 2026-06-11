/**
 * voting_rules/daily-vote-budget.test.mjs — offline tests for the daily vote
 * budget / RC-aware cap planner. Fully offline, soft-fail, deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planVotes,
  rcAfter,
  voteWeightFor,
  esc,
  MAX_WEIGHT,
} from './daily-vote-budget.mjs';

test('day-cap binding: caps the number of approved votes', () => {
  const plan = planVotes({
    candidates: [
      { name: 'a', merit: 90 },
      { name: 'b', merit: 80 },
      { name: 'c', merit: 70 },
      { name: 'd', merit: 60 },
    ],
    maxVotesPerDay: 2,
    rcAvailable: 1e9,
    rcPerVote: 1,
    minMerit: 0,
  });
  assert.equal(plan.approved.length, 2);
  assert.deepEqual(plan.approved.map((x) => x.name), ['a', 'b']);
  assert.equal(plan.skipped.length, 2);
  assert.ok(plan.skipped.every((s) => s.reason === 'daily-cap'));
});

test('RC binding: stops when RC budget cannot cover another vote', () => {
  const plan = planVotes({
    candidates: [
      { name: 'a', merit: 90 },
      { name: 'b', merit: 80 },
      { name: 'c', merit: 70 },
    ],
    maxVotesPerDay: 100,
    rcAvailable: 250,
    rcPerVote: 100,
    minMerit: 0,
  });
  // 250 / 100 = 2 votes affordable.
  assert.equal(plan.approved.length, 2);
  assert.deepEqual(plan.approved.map((x) => x.name), ['a', 'b']);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, 'rc-exhausted');
  assert.equal(rcAfter(plan), 50);
});

test('min-merit filter: below-floor candidates skipped before cap/RC checks', () => {
  const plan = planVotes({
    candidates: [
      { name: 'low', merit: 5 },
      { name: 'ok', merit: 50 },
    ],
    maxVotesPerDay: 10,
    rcAvailable: 1000,
    rcPerVote: 10,
    minMerit: 20,
  });
  assert.deepEqual(plan.approved.map((x) => x.name), ['ok']);
  assert.equal(plan.skipped[0].name, 'low');
  assert.equal(plan.skipped[0].reason, 'below-min-merit');
});

test('weight clamping: merit -> percent×100 within bounds', () => {
  assert.equal(voteWeightFor(100), MAX_WEIGHT); // 100% -> 10000
  assert.equal(voteWeightFor(50), 5000);
  assert.equal(voteWeightFor(0), 1); // clamps up to min default 1
  assert.equal(voteWeightFor(50, { min: 1, max: 4000 }), 4000); // clamps to max
  assert.equal(voteWeightFor(50, { min: 6000, max: 10000 }), 6000); // clamps to min
  // Inverted bounds get swapped, not thrown.
  assert.equal(voteWeightFor(100, { min: 10000, max: 1 }), MAX_WEIGHT);
  // Out-of-legal-range bounds hard-clamp into 0..10000.
  assert.equal(voteWeightFor(100, { min: 0, max: 999999 }), MAX_WEIGHT);
});

test('tie-break determinism: equal merit sorted by ascending name', () => {
  const args = {
    candidates: [
      { name: 'carol', merit: 95 },
      { name: 'bob', merit: 95 },
      { name: 'alice', merit: 95 },
    ],
    maxVotesPerDay: 2,
    rcAvailable: 1e9,
    rcPerVote: 1,
    minMerit: 0,
  };
  const p1 = planVotes(args);
  const p2 = planVotes(args);
  assert.deepEqual(p1.approved.map((x) => x.name), ['alice', 'bob']);
  assert.deepEqual(p1.approved.map((x) => x.name), p2.approved.map((x) => x.name));
  assert.equal(p1.skipped[0].name, 'carol');
});

test('descending merit ordering wins over name', () => {
  const plan = planVotes({
    candidates: [
      { name: 'aaa', merit: 10 },
      { name: 'zzz', merit: 99 },
    ],
    maxVotesPerDay: 1,
    rcAvailable: 1e9,
    rcPerVote: 1,
    minMerit: 0,
  });
  assert.deepEqual(plan.approved.map((x) => x.name), ['zzz']);
});

test('soft-fail: empty candidates -> empty plan', () => {
  const plan = planVotes({ candidates: [], maxVotesPerDay: 5, rcAvailable: 1, rcPerVote: 1, minMerit: 0 });
  assert.deepEqual(plan.approved, []);
  assert.deepEqual(plan.skipped, []);
});

test('soft-fail: missing args and garbage never throw', () => {
  assert.doesNotThrow(() => planVotes());
  assert.doesNotThrow(() => planVotes({}));
  assert.doesNotThrow(() => planVotes({ candidates: null }));
  const plan = planVotes({
    candidates: [
      null,
      { name: 'x' }, // merit missing -> 0
      { name: 'y', merit: NaN }, // NaN -> 0
      { merit: 'oops' }, // name missing, merit non-numeric -> 0
    ],
    maxVotesPerDay: NaN,
    rcAvailable: 'lots',
    rcPerVote: undefined,
    minMerit: -5,
  });
  assert.ok(Array.isArray(plan.approved));
  assert.ok(Array.isArray(plan.skipped));
});

test('soft-fail: NaN numeric fields clamp to 0 (cap NaN -> 0 votes)', () => {
  const plan = planVotes({
    candidates: [{ name: 'a', merit: 90 }],
    maxVotesPerDay: NaN, // -> 0
    rcAvailable: 1000,
    rcPerVote: 10,
    minMerit: 0,
  });
  assert.equal(plan.approved.length, 0);
  assert.equal(plan.skipped[0].reason, 'daily-cap');
});

test('rcAfter: pure remaining-RC computation', () => {
  const plan = planVotes({
    candidates: [
      { name: 'a', merit: 90 },
      { name: 'b', merit: 80 },
    ],
    maxVotesPerDay: 10,
    rcAvailable: 500,
    rcPerVote: 100,
    minMerit: 0,
  });
  assert.equal(rcAfter(plan), 300); // 500 - 2*100
  assert.equal(rcAfter(plan, 500), 300); // explicit budget arg
  assert.equal(rcAfter(null), 0); // soft-fail
  assert.equal(rcAfter({}), 0);
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
