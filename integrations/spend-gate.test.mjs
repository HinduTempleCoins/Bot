// integrations/spend-gate.test.mjs
// Offline node --test for the pure spend-budget + cooldown gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import spendGate, { makeGate, dayKeyOf } from './spend-gate.mjs';

const HOUR = 3600e3;
const T0 = Date.UTC(2026, 5, 11, 12, 0, 0); // 2026-06-11 12:00 UTC

test('default export bundles helpers', () => {
  assert.equal(typeof spendGate.makeGate, 'function');
  assert.equal(typeof spendGate.dayKeyOf, 'function');
});

test('happy path: micro push within budget, cooldown elapsed, allowed', () => {
  const g = makeGate();
  const r = g.check({
    nowMs: T0,
    action: 'micro',
    spentTodayHive: 0,
  });
  assert.equal(r.allow, true);
  assert.equal(r.reason, 'ok');
  assert.equal(r.remainingBudgetHive, 35);
  assert.equal(r.cooldownRemainingMs, 0);
});

test('micro amount defaults to microPushHive', () => {
  const g = makeGate({ microPushHive: 0.0001 });
  const r = g.check({ nowMs: T0, action: 'micro', spentTodayHive: 34.99999 });
  // remaining ~0.00001 < 0.0001 default amount => budget-exceeded
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'budget-exceeded');
});

test('budget exhaustion: amount exceeds remaining', () => {
  const g = makeGate({ dailyBudgetHive: 35 });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 10,
    spentTodayHive: 30,
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'budget-exceeded');
  assert.equal(r.remainingBudgetHive, 5);
});

test('budget boundary: amount exactly equal to remaining is allowed', () => {
  const g = makeGate({ dailyBudgetHive: 35 });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 5,
    spentTodayHive: 30,
  });
  assert.equal(r.allow, true);
  assert.equal(r.remainingBudgetHive, 5);
});

test('cooldown not elapsed -> blocked with remaining ms', () => {
  const g = makeGate({ majorCooldownMs: 6 * HOUR });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 1,
    spentTodayHive: 0,
    lastActionMs: T0 - 2 * HOUR, // only 2h ago
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'cooldown');
  assert.equal(r.cooldownRemainingMs, 4 * HOUR);
});

test('cooldown boundary: exactly elapsed is allowed', () => {
  const g = makeGate({ majorCooldownMs: 6 * HOUR });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 1,
    spentTodayHive: 0,
    lastActionMs: T0 - 6 * HOUR,
  });
  assert.equal(r.allow, true);
  assert.equal(r.cooldownRemainingMs, 0);
});

test('micro cooldown is independent of major cooldown', () => {
  const g = makeGate({ majorCooldownMs: 6 * HOUR, microCooldownMs: 1 * HOUR });
  const r = g.check({
    nowMs: T0,
    action: 'micro',
    spentTodayHive: 0,
    lastActionMs: T0 - 1.5 * HOUR, // > micro cooldown
  });
  assert.equal(r.allow, true);
});

test('future lastActionMs is treated as full cooldown remaining', () => {
  const g = makeGate({ microCooldownMs: 1 * HOUR });
  const r = g.check({
    nowMs: T0,
    action: 'micro',
    spentTodayHive: 0,
    lastActionMs: T0 + 5 * HOUR,
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'cooldown');
  assert.equal(r.cooldownRemainingMs, 1 * HOUR);
});

test('price jump > max pct -> blocked (spam-block)', () => {
  const g = makeGate({ maxPctIncreasePerSession: 0.05 });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 1,
    spentTodayHive: 0,
    lastPrice: 1.0,
    proposedPrice: 1.10, // +10% > 5%
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'price-jump');
});

test('price jump at exactly max pct is allowed', () => {
  const g = makeGate({ maxPctIncreasePerSession: 0.05 });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 1,
    spentTodayHive: 0,
    lastPrice: 1.0,
    proposedPrice: 1.05, // +5% == limit
  });
  assert.equal(r.allow, true);
});

test('price decrease is always allowed (no lower bound here)', () => {
  const g = makeGate();
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 1,
    spentTodayHive: 0,
    lastPrice: 2.0,
    proposedPrice: 1.0,
  });
  assert.equal(r.allow, true);
});

test('cooldown takes precedence over price-jump', () => {
  const g = makeGate({ majorCooldownMs: 6 * HOUR });
  const r = g.check({
    nowMs: T0,
    action: 'major',
    amountHive: 1,
    spentTodayHive: 0,
    lastActionMs: T0 - 1 * HOUR,
    lastPrice: 1.0,
    proposedPrice: 5.0,
  });
  assert.equal(r.reason, 'cooldown');
});

test('remaining() clamps at zero and handles bad input', () => {
  const g = makeGate({ dailyBudgetHive: 35 });
  assert.equal(g.remaining(10), 25);
  assert.equal(g.remaining(100), 0);
  assert.equal(g.remaining(-5), 35); // bad input -> full budget
  assert.equal(g.remaining('x'), 35);
});

test('resetIfNewDay detects day rollover (UTC)', () => {
  const g = makeGate();
  const today = dayKeyOf(T0);
  const same = g.resetIfNewDay(T0, today);
  assert.equal(same.newDay, false);
  assert.equal(same.dayKey, today);

  const nextDay = T0 + 24 * HOUR;
  const rolled = g.resetIfNewDay(nextDay, today);
  assert.equal(rolled.newDay, true);
  assert.notEqual(rolled.dayKey, today);
});

test('resetIfNewDay with no prior key is a new day', () => {
  const g = makeGate();
  const r = g.resetIfNewDay(T0, null);
  assert.equal(r.newDay, true);
  assert.equal(r.dayKey, dayKeyOf(T0));
});

test('resetIfNewDay soft-fails on bad clock', () => {
  const g = makeGate();
  const r = g.resetIfNewDay('nope', '2026-06-11');
  assert.equal(r.newDay, false);
  assert.equal(r.dayKey, '2026-06-11');
});

test('soft-fail: missing nowMs', () => {
  const g = makeGate();
  const r = g.check({ action: 'micro', spentTodayHive: 0 });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'invalid-input');
});

test('soft-fail: bad action', () => {
  const g = makeGate();
  const r = g.check({ nowMs: T0, action: 'huge', spentTodayHive: 0 });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'invalid-input');
});

test('soft-fail: negative spentToday', () => {
  const g = makeGate();
  const r = g.check({ nowMs: T0, action: 'micro', spentTodayHive: -1 });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'invalid-input');
});

test('soft-fail: non-numeric amount', () => {
  const g = makeGate();
  const r = g.check({ nowMs: T0, action: 'major', amountHive: 'lots', spentTodayHive: 0 });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'invalid-input');
});

test('soft-fail: proposedPrice present but non-numeric with baseline', () => {
  const g = makeGate();
  const r = g.check({
    nowMs: T0, action: 'major', amountHive: 1, spentTodayHive: 0,
    lastPrice: 1.0, proposedPrice: 'NaNish',
  });
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'invalid-input');
});

test('check never throws on garbage input', () => {
  const g = makeGate();
  assert.doesNotThrow(() => g.check());
  assert.doesNotThrow(() => g.check(null));
  assert.doesNotThrow(() => g.check(42));
  const r = g.check(null);
  assert.equal(r.allow, false);
  assert.equal(r.reason, 'invalid-input');
});

test('makeGate tolerates bad options and uses defaults', () => {
  const g = makeGate({ dailyBudgetHive: -10, majorCooldownMs: 'x' });
  assert.equal(g.config.dailyBudgetHive, 35);
  assert.equal(g.config.majorCooldownMs, 6 * HOUR);
});
