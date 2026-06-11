// price-push-plan.test.mjs — offline tests for the patient price-push planner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextAction,
  cooldownRemaining,
  affordable,
  MICRO_AMOUNT,
  MAJOR_COOLDOWN_MS,
  MICRO_COOLDOWN_MS,
} from './price-push-plan.mjs';

const HOUR = 60 * 60 * 1000;
const NOW = 10_000_000_000;

// A small, cheap-to-clear sell wall.
const BOOK = [
  { price: 0.0100, quantity: 100 },
  { price: 0.0120, quantity: 250 },
  { price: 0.0150, quantity: 400 },
  { price: 0.0200, quantity: 1000 },
];

// ---------- cooldownRemaining ----------

test('cooldownRemaining: 0 when window elapsed', () => {
  assert.equal(cooldownRemaining(NOW - 7 * HOUR, 6 * HOUR, NOW), 0);
});

test('cooldownRemaining: positive when window active', () => {
  const r = cooldownRemaining(NOW - 0.5 * HOUR, HOUR, NOW);
  assert.equal(r, 0.5 * HOUR);
  assert.ok(r > 0);
});

test('cooldownRemaining: never negative, never NaN, exact-boundary = 0', () => {
  assert.equal(cooldownRemaining(NOW - HOUR, HOUR, NOW), 0); // exactly elapsed
  // future lastTs → negative elapsed → larger remaining, still finite & >= 0
  assert.equal(cooldownRemaining(NOW + HOUR, HOUR, NOW), 2 * HOUR);
  assert.ok(cooldownRemaining(NOW, HOUR, NOW) >= 0);
});

test('cooldownRemaining: missing lastTs → eligible (0)', () => {
  assert.equal(cooldownRemaining(null, HOUR, NOW), 0);
  assert.equal(cooldownRemaining(undefined, HOUR, NOW), 0);
});

test('cooldownRemaining: soft-fails to 0 on garbage', () => {
  assert.equal(cooldownRemaining('x', 'y', 'z'), 0);
  assert.equal(cooldownRemaining(NOW, -5, NOW), 0);
  assert.equal(cooldownRemaining(NOW, HOUR, NaN), 0);
});

// ---------- affordable ----------

test('affordable: true when cost <= max', () => {
  assert.equal(affordable(4, 5), true);
  assert.equal(affordable(5, 5), true); // boundary
  assert.equal(affordable(0, 5), true);
});

test('affordable: false when cost > max or bad input', () => {
  assert.equal(affordable(9, 5), false);
  assert.equal(affordable(4, 0), false);   // non-positive budget
  assert.equal(affordable(-1, 5), false);  // negative cost
  assert.equal(affordable('a', 5), false);
  assert.equal(affordable(4, undefined), false);
});

// ---------- nextAction: happy paths ----------

test('nextAction: major when wall affordable and major cooldown elapsed', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 7 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.equal(r.action, 'major');
  assert.ok(r.estCostHive > 0);
  assert.ok(r.estCostUsd > 0);
  // USD = HIVE / hivePerUsd
  assert.ok(Math.abs(r.estCostUsd - r.estCostHive / 3) < 1e-9);
  assert.equal(r.eligibleAt, NOW);
});

test('nextAction: micro when major on cooldown but micro free', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 1 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.equal(r.action, 'micro');
  assert.ok(r.estCostHive > 0);
  assert.ok(r.estCostHive < 1); // tiny anchor
  assert.equal(r.eligibleAt, NOW);
});

test('nextAction: micro when wall unaffordable but micro free', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 7 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 0.0001, // far too small for the wall
  });
  assert.equal(r.action, 'micro');
  assert.match(r.reason, /not affordable/);
});

test('nextAction: wait when both cooldowns active, eligibleAt is soonest', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 1 * HOUR, lastMicroTs: NOW - 0.5 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.equal(r.action, 'wait');
  assert.ok(r.eligibleAt > NOW);
  // micro unlocks at +0.5h, major at +5h → soonest is micro (+0.5h).
  assert.equal(r.eligibleAt, NOW + 0.5 * HOUR);
});

test('nextAction: wait when wall unaffordable and micro on cooldown', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 7 * HOUR, lastMicroTs: NOW - 0.25 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 0.0001,
  });
  assert.equal(r.action, 'wait');
  // only the micro is a possible action → eligibleAt = micro unlock (+0.75h)
  assert.equal(r.eligibleAt, NOW + 0.75 * HOUR);
});

// ---------- nextAction: defaults / overrides ----------

test('nextAction: default cooldowns are 6h major / 1h micro', () => {
  assert.equal(MAJOR_COOLDOWN_MS, 6 * HOUR);
  assert.equal(MICRO_COOLDOWN_MS, HOUR);
  assert.equal(MICRO_AMOUNT, 0.0001);

  // With defaults: last major 5h ago (still on 6h cooldown), last micro 2h ago (>1h, free)
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 5 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.equal(r.action, 'micro');
});

test('nextAction: never-acted timestamps make both eligible → major', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: null, lastMicroTs: null,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.equal(r.action, 'major');
});

test('nextAction: custom microAmount scales the micro cost', () => {
  const small = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 1 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5, microAmount: 0.0001,
  });
  const big = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 1 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5, microAmount: 0.01,
  });
  assert.equal(small.action, 'micro');
  assert.equal(big.action, 'micro');
  assert.ok(big.estCostHive > small.estCostHive);
});

// ---------- nextAction: determinism ----------

test('nextAction: deterministic given the same inputs', () => {
  const args = {
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 1 * HOUR, lastMicroTs: NOW - 0.5 * HOUR,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  };
  assert.deepEqual(nextAction(args), nextAction(args));
});

// ---------- nextAction: soft-fail edges ----------

test('nextAction: soft-fails to wait on null/garbage opts', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const r = nextAction(bad);
    assert.equal(r.action, 'wait');
    assert.equal(r.estCostHive, 0);
    assert.equal(r.estCostUsd, 0);
  }
});

test('nextAction: soft-fails to wait on bad nowTs', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW, lastMicroTs: NOW, nowTs: 'nope',
    hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.equal(r.action, 'wait');
  assert.equal(r.reason, 'bad-input');
});

test('nextAction: empty/garbage book → no wall → micro or wait, never major', () => {
  const r = nextAction({
    book: [], targetPrice: 0.0150,
    lastMajorTs: null, lastMicroTs: null,
    nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  assert.notEqual(r.action, 'major'); // no wall to push → can't be major
  assert.equal(r.action, 'micro');    // micro is free (never acted)
  assert.ok(r.estCostHive >= 0);
});

test('nextAction: missing hivePerUsd cannot produce major (no USD cost)', () => {
  const r = nextAction({
    book: BOOK, targetPrice: 0.0150,
    lastMajorTs: NOW - 7 * HOUR, lastMicroTs: NOW - 2 * HOUR,
    nowTs: NOW, hivePerUsd: undefined, maxUsdPerPush: 5,
  });
  // Without a valid hivePerUsd, USD cost is NaN → unaffordable → falls to micro.
  assert.notEqual(r.action, 'major');
  assert.equal(r.action, 'micro');
});

test('nextAction: zero/negative budget never affords a major', () => {
  for (const b of [0, -5]) {
    const r = nextAction({
      book: BOOK, targetPrice: 0.0150,
      lastMajorTs: NOW - 7 * HOUR, lastMicroTs: NOW - 2 * HOUR,
      nowTs: NOW, hivePerUsd: 3, maxUsdPerPush: b,
    });
    assert.notEqual(r.action, 'major');
  }
});
