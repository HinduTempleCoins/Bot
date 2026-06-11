// neediness-weight.test.mjs — offline tests for the Neediness Weight helper.
// Run: node --test karma/neediness-weight.test.mjs   (fully offline, no network)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  needinessWeight,
  classifyNeed,
  WEIGHTS,
  THRESHOLDS,
  REFERENCE_BP,
  REFERENCE_POSTS,
  REFERENCE_DORMANT_DAYS,
  REFERENCE_FOLLOWERS,
} from './neediness-weight.mjs';

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── constants sanity ─────────────────────────────────────────────────────────────
test('WEIGHTS sum to 1 so the blend stays in [0,1]', () => {
  const sum = WEIGHTS.inverseBP + WEIGHTS.inverseActivity + WEIGHTS.dormancy + WEIGHTS.inverseReach;
  assert.ok(approx(sum, 1), `weights sum to ${sum}`);
});

test('THRESHOLDS are ordered high > medium', () => {
  assert.ok(THRESHOLDS.high > THRESHOLDS.medium);
});

// ── boundary clamps ──────────────────────────────────────────────────────────────
test('maximally needy account → weight 1', () => {
  const w = needinessWeight({ bp: 0, postCount: 0, lastActiveDaysAgo: REFERENCE_DORMANT_DAYS, followerCount: 0 });
  assert.ok(approx(w, 1), `got ${w}`);
});

test('fully established account → weight 0', () => {
  const w = needinessWeight({
    bp: REFERENCE_BP,
    postCount: REFERENCE_POSTS,
    lastActiveDaysAgo: 0,
    followerCount: REFERENCE_FOLLOWERS,
  });
  assert.ok(approx(w, 0), `got ${w}`);
});

test('values above references clamp (no negative / >1 weight)', () => {
  const wHi = needinessWeight({ bp: 1e12, postCount: 1e9, lastActiveDaysAgo: -50, followerCount: 1e9 });
  assert.ok(wHi >= 0 && wHi <= 1, `got ${wHi}`);
  assert.ok(approx(wHi, 0), `over-established should bottom at 0, got ${wHi}`);

  const wLo = needinessWeight({ bp: -1, postCount: -1, lastActiveDaysAgo: 1e9, followerCount: -1 });
  assert.ok(wLo >= 0 && wLo <= 1, `got ${wLo}`);
  assert.ok(approx(wLo, 1), `over-needy should top at 1, got ${wLo}`);
});

test('result always within [0,1] across a grid of inputs', () => {
  for (const bp of [0, 5000, 10000, 50000]) {
    for (const postCount of [0, 50, 100, 1000]) {
      for (const lastActiveDaysAgo of [0, 15, 30, 365]) {
        for (const followerCount of [0, 250, 500, 5000]) {
          const w = needinessWeight({ bp, postCount, lastActiveDaysAgo, followerCount });
          assert.ok(w >= 0 && w <= 1, `out of range: ${w}`);
        }
      }
    }
  }
});

// ── documented blend value ───────────────────────────────────────────────────────
test('half-way account yields the weighted-average midpoint 0.5', () => {
  const w = needinessWeight({
    bp: REFERENCE_BP / 2,            // inverseBP = 0.5
    postCount: REFERENCE_POSTS / 2, // inverseActivity = 0.5
    lastActiveDaysAgo: REFERENCE_DORMANT_DAYS / 2, // dormancy = 0.5
    followerCount: REFERENCE_FOLLOWERS / 2,        // inverseReach = 0.5
  });
  assert.ok(approx(w, 0.5), `got ${w}`);
});

test('a single needy dimension contributes exactly its weight', () => {
  // established on everything except BP=0 → only inverseBP fires → weight === WEIGHTS.inverseBP
  const w = needinessWeight({
    bp: 0,
    postCount: REFERENCE_POSTS,
    lastActiveDaysAgo: 0,
    followerCount: REFERENCE_FOLLOWERS,
  });
  assert.ok(approx(w, WEIGHTS.inverseBP), `got ${w}, expected ${WEIGHTS.inverseBP}`);
});

// ── soft-fail / neutral defaults ─────────────────────────────────────────────────
test('no argument → neutral 0.5 (never throws)', () => {
  assert.ok(approx(needinessWeight(), 0.5));
  assert.ok(approx(needinessWeight(undefined), 0.5));
  assert.ok(approx(needinessWeight(null), 0.5));
});

test('empty object → neutral 0.5 (all fields default to midpoints)', () => {
  assert.ok(approx(needinessWeight({}), 0.5));
});

test('missing fields default to neutral midpoint, present fields still count', () => {
  // only bp given (=0 → inverseBP 1), others neutral 0.5
  const w = needinessWeight({ bp: 0 });
  const expected =
    WEIGHTS.inverseBP * 1 +
    WEIGHTS.inverseActivity * 0.5 +
    WEIGHTS.dormancy * 0.5 +
    WEIGHTS.inverseReach * 0.5;
  assert.ok(approx(w, expected), `got ${w}, expected ${expected}`);
});

test('garbage / non-finite fields coerce to neutral, never throw', () => {
  assert.doesNotThrow(() => needinessWeight({ bp: 'xyz', postCount: NaN, lastActiveDaysAgo: Infinity, followerCount: {} }));
  assert.ok(approx(needinessWeight({ bp: 'xyz', postCount: NaN, lastActiveDaysAgo: Infinity, followerCount: {} }), 0.5));
});

test('non-object argument soft-fails to neutral', () => {
  assert.ok(approx(needinessWeight(42), 0.5));
  assert.ok(approx(needinessWeight('hello'), 0.5));
  assert.ok(approx(needinessWeight(true), 0.5));
});

// ── classifyNeed bands ───────────────────────────────────────────────────────────
test('classifyNeed bands at and around the thresholds', () => {
  assert.equal(classifyNeed(1), 'high');
  assert.equal(classifyNeed(THRESHOLDS.high), 'high');           // inclusive lower edge
  assert.equal(classifyNeed(THRESHOLDS.high - 1e-6), 'medium');
  assert.equal(classifyNeed(THRESHOLDS.medium), 'medium');       // inclusive lower edge
  assert.equal(classifyNeed(THRESHOLDS.medium - 1e-6), 'low');
  assert.equal(classifyNeed(0), 'low');
});

test('classifyNeed soft-fails out-of-range / garbage to a valid band', () => {
  assert.equal(classifyNeed(undefined), 'low');
  assert.equal(classifyNeed(null), 'low');
  assert.equal(classifyNeed(NaN), 'low');
  assert.equal(classifyNeed('not a number'), 'low');
  assert.equal(classifyNeed(-5), 'low');
  assert.equal(classifyNeed(99), 'high');
});

test('needinessWeight output feeds classifyNeed coherently', () => {
  const needy = needinessWeight({ bp: 0, postCount: 0, lastActiveDaysAgo: REFERENCE_DORMANT_DAYS, followerCount: 0 });
  const whale = needinessWeight({ bp: REFERENCE_BP, postCount: REFERENCE_POSTS, lastActiveDaysAgo: 0, followerCount: REFERENCE_FOLLOWERS });
  assert.equal(classifyNeed(needy), 'high');
  assert.equal(classifyNeed(whale), 'low');
});
