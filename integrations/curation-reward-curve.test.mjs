import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  curationWeight,
  curationShare,
  optimalVoteDelay,
  DEFAULT_WINDOW_SECONDS,
  WINDOW_SECONDS_STEEM_30M,
  WINDOW_SECONDS_5M,
} from './curation-reward-curve.mjs';

test('constants: documented historical windows', () => {
  assert.equal(WINDOW_SECONDS_STEEM_30M, 1800);
  assert.equal(WINDOW_SECONDS_5M, 300);
  assert.equal(DEFAULT_WINDOW_SECONDS, WINDOW_SECONDS_5M);
});

test('curationWeight: linear penalty inside the window', () => {
  const w = 600;
  // halfway through the window → half weight, half penalty
  const half = curationWeight({ voteRshares: 1000, secondsSincePost: 300, windowSeconds: w });
  assert.equal(half.effectiveRshares, 500);
  assert.equal(half.penaltyFraction, 0.5);

  // quarter through → quarter weight
  const q = curationWeight({ voteRshares: 1000, secondsSincePost: 150, windowSeconds: w });
  assert.equal(q.effectiveRshares, 250);
  assert.equal(q.penaltyFraction, 0.75);
});

test('curationWeight: voting at t=0 forfeits everything', () => {
  const w = curationWeight({ voteRshares: 1000, secondsSincePost: 0, windowSeconds: 600 });
  assert.equal(w.effectiveRshares, 0);
  assert.equal(w.penaltyFraction, 1);
});

test('curationWeight: at and beyond the boundary → full weight, no penalty', () => {
  const at = curationWeight({ voteRshares: 1000, secondsSincePost: 600, windowSeconds: 600 });
  assert.equal(at.effectiveRshares, 1000);
  assert.equal(at.penaltyFraction, 0);

  const beyond = curationWeight({ voteRshares: 1000, secondsSincePost: 99999, windowSeconds: 600 });
  assert.equal(beyond.effectiveRshares, 1000);
  assert.equal(beyond.penaltyFraction, 0);
});

test('curationWeight: uses DEFAULT_WINDOW_SECONDS when window omitted', () => {
  const w = curationWeight({ voteRshares: 1000, secondsSincePost: DEFAULT_WINDOW_SECONDS / 2 });
  assert.equal(w.effectiveRshares, 500);
  assert.equal(w.penaltyFraction, 0.5);
});

test('curationWeight: non-positive window disables the penalty', () => {
  const zero = curationWeight({ voteRshares: 1000, secondsSincePost: 0, windowSeconds: 0 });
  assert.equal(zero.effectiveRshares, 1000);
  assert.equal(zero.penaltyFraction, 0);

  const neg = curationWeight({ voteRshares: 1000, secondsSincePost: 0, windowSeconds: -5 });
  assert.equal(neg.effectiveRshares, 1000);
  assert.equal(neg.penaltyFraction, 0);
});

test('curationWeight: soft-fail on garbage inputs (never throws)', () => {
  assert.doesNotThrow(() => curationWeight());
  const empty = curationWeight();
  assert.equal(empty.effectiveRshares, 0);
  // default window applies → t=0 → full penalty
  assert.equal(empty.penaltyFraction, 1);

  const junk = curationWeight({ voteRshares: 'abc', secondsSincePost: NaN, windowSeconds: 'x' });
  assert.equal(junk.effectiveRshares, 0);

  // negative rshares / elapsed clamp to 0
  const negRshares = curationWeight({ voteRshares: -500, secondsSincePost: 300, windowSeconds: 600 });
  assert.equal(negRshares.effectiveRshares, 0);
  const negElapsed = curationWeight({ voteRshares: 1000, secondsSincePost: -100, windowSeconds: 600 });
  assert.equal(negElapsed.effectiveRshares, 0);
  assert.equal(negElapsed.penaltyFraction, 1);
});

test('curationShare: pro-rata slice of the pool', () => {
  // your 250 of 1000 total → 25% of a 100-token pool
  assert.equal(curationShare({ yourEffective: 250, totalEffective: 1000, curatorPool: 100 }), 25);
  // full claim
  assert.equal(curationShare({ yourEffective: 1000, totalEffective: 1000, curatorPool: 100 }), 100);
});

test('curationShare: total <= 0 → 0 (no division by zero)', () => {
  assert.equal(curationShare({ yourEffective: 10, totalEffective: 0, curatorPool: 100 }), 0);
  assert.equal(curationShare({ yourEffective: 10, totalEffective: -5, curatorPool: 100 }), 0);
});

test('curationShare: zero pool or zero stake → 0', () => {
  assert.equal(curationShare({ yourEffective: 0, totalEffective: 1000, curatorPool: 100 }), 0);
  assert.equal(curationShare({ yourEffective: 250, totalEffective: 1000, curatorPool: 0 }), 0);
});

test('curationShare: cannot claim more than the whole pool', () => {
  // yours > total (inconsistent input) is capped at total → full pool, not more
  assert.equal(curationShare({ yourEffective: 5000, totalEffective: 1000, curatorPool: 100 }), 100);
});

test('curationShare: soft-fail on garbage (never throws)', () => {
  assert.doesNotThrow(() => curationShare());
  assert.equal(curationShare(), 0);
  assert.equal(curationShare({ yourEffective: 'a', totalEffective: 'b', curatorPool: 'c' }), 0);
});

test('curationShare: a field of pro-rata slices sums to the pool', () => {
  const pool = 100;
  const effs = [250, 250, 500];
  const total = effs.reduce((a, b) => a + b, 0);
  const sum = effs.reduce((a, e) => a + curationShare({ yourEffective: e, totalEffective: total, curatorPool: pool }), 0);
  assert.ok(Math.abs(sum - pool) < 1e-9);
});

test('optimalVoteDelay: returns the window boundary', () => {
  assert.equal(optimalVoteDelay({ windowSeconds: 600 }), 600);
  assert.equal(optimalVoteDelay({ windowSeconds: WINDOW_SECONDS_STEEM_30M }), 1800);
  assert.equal(optimalVoteDelay(), DEFAULT_WINDOW_SECONDS);
});

test('optimalVoteDelay: non-positive/invalid window → 0', () => {
  assert.equal(optimalVoteDelay({ windowSeconds: 0 }), 0);
  assert.equal(optimalVoteDelay({ windowSeconds: -10 }), 0);
  assert.equal(optimalVoteDelay({ windowSeconds: 'nope' }), 0);
  assert.doesNotThrow(() => optimalVoteDelay());
});

test('integration: waiting until optimalVoteDelay yields full effective rshares', () => {
  const windowSeconds = WINDOW_SECONDS_STEEM_30M;
  const delay = optimalVoteDelay({ windowSeconds });
  const w = curationWeight({ voteRshares: 7777, secondsSincePost: delay, windowSeconds });
  assert.equal(w.effectiveRshares, 7777);
  assert.equal(w.penaltyFraction, 0);
});
