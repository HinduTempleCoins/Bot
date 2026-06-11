// reminder-schedule.test.mjs — offline tests for the deterministic next-fire calculator.
// node:test + node:assert/strict, no network, no timers. All times injected as fixed ms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFire, upcoming, describe } from './reminder-schedule.mjs';

const T = (iso) => Date.parse(iso);
const HOUR = 3600000;
const DAY = 86400000;
const WEEK = 7 * DAY;

// 2026-01-01 is a Thursday (UTC weekday 4).
const REF = T('2026-01-01T12:30:00Z');

test('nextFire is strictly after fromTs', () => {
  const t = nextFire({ every: 'day', at: '09:00' }, REF);
  assert.ok(t > REF, 'must be strictly after fromTs');
});

test('daily at 09:00 rolls to next day when fromTs is past 09:00', () => {
  // REF is 12:30, so 09:00 today already passed -> next is 2026-01-02 09:00.
  const t = nextFire({ every: 'day', at: '09:00' }, REF);
  assert.equal(new Date(t).toISOString(), '2026-01-02T09:00:00.000Z');
});

test('daily at 09:00 fires same day when fromTs is before 09:00', () => {
  const before = T('2026-01-01T06:00:00Z');
  const t = nextFire({ every: 'day', at: '09:00' }, before);
  assert.equal(new Date(t).toISOString(), '2026-01-01T09:00:00.000Z');
});

test('daily with no at fires at midnight UTC', () => {
  const t = nextFire({ every: 'day' }, REF);
  assert.equal(new Date(t).toISOString(), '2026-01-02T00:00:00.000Z');
});

test('hourly fires on the next hour boundary', () => {
  const t = nextFire({ every: 'hour' }, REF);
  assert.equal(new Date(t).toISOString(), '2026-01-01T13:00:00.000Z');
});

test('hourly with at minute targets that minute', () => {
  const t = nextFire({ every: 'hour', at: '00:45' }, REF); // h ignored for hour cadence
  assert.equal(new Date(t).toISOString(), '2026-01-01T12:45:00.000Z');
});

test('numeric interval is epoch-phase-locked and deterministic', () => {
  const t = nextFire({ every: 1000 }, 5500);
  assert.equal(t, 6000);
  const t2 = nextFire({ every: 1000 }, 6000); // exactly on a slot -> strictly next
  assert.equal(t2, 7000);
});

test('weekly with weekday advances to that weekday (UTC)', () => {
  // Target Monday (1). From Thursday 2026-01-01, next Monday is 2026-01-05.
  const t = nextFire({ every: 'week', weekday: 1, at: '08:00' }, REF);
  assert.equal(new Date(t).toISOString(), '2026-01-05T08:00:00.000Z');
});

test('weekly with no weekday keeps a 7-day cadence', () => {
  const t = nextFire({ every: 'week', at: '12:30' }, REF);
  // 12:30 today already == fromTs, so push a week -> 2026-01-08 12:30.
  assert.equal(new Date(t).toISOString(), '2026-01-08T12:30:00.000Z');
});

test('upcoming returns n ascending, strictly increasing timestamps', () => {
  const arr = upcoming({ every: 'day', at: '09:00' }, REF, 3);
  assert.equal(arr.length, 3);
  assert.ok(arr[0] < arr[1] && arr[1] < arr[2]);
  assert.equal(new Date(arr[0]).toISOString(), '2026-01-02T09:00:00.000Z');
  assert.equal(new Date(arr[1]).toISOString(), '2026-01-03T09:00:00.000Z');
  assert.equal(new Date(arr[2]).toISOString(), '2026-01-04T09:00:00.000Z');
});

test('upcoming interval spacing is exact', () => {
  const arr = upcoming({ every: HOUR }, REF, 4);
  for (let i = 1; i < arr.length; i++) assert.equal(arr[i] - arr[i - 1], HOUR);
});

test('upcoming weekly weekday yields consecutive Mondays', () => {
  const arr = upcoming({ every: 'week', weekday: 1 }, REF, 3);
  assert.equal(arr.length, 3);
  for (const t of arr) assert.equal(new Date(t).getUTCDay(), 1);
  assert.equal(arr[1] - arr[0], WEEK);
  assert.equal(arr[2] - arr[1], WEEK);
});

test('rule.count caps the number of fires upcoming yields', () => {
  const arr = upcoming({ every: 'day', count: 2 }, REF, 10);
  assert.equal(arr.length, 2);
});

// --- soft-fail / edge cases: never throw ---

test('invalid rule returns null / empty / safe string, never throws', () => {
  assert.equal(nextFire(null, REF), null);
  assert.equal(nextFire(undefined, REF), null);
  assert.equal(nextFire({}, REF), null);
  assert.equal(nextFire({ every: 'fortnight' }, REF), null);
  assert.equal(nextFire({ every: 0 }, REF), null);
  assert.equal(nextFire({ every: -5 }, REF), null);
  assert.equal(nextFire({ every: 'day' }, NaN), null);
  assert.equal(nextFire({ every: 'day' }, 'soon'), null);
  assert.deepEqual(upcoming({ every: 'nope' }, REF, 3), []);
  assert.deepEqual(upcoming({ every: 'day' }, REF, 0), []);
  assert.deepEqual(upcoming({ every: 'day' }, REF, -2), []);
  assert.deepEqual(upcoming(null, REF, 3), []);
});

test('bad at / weekday soft-fail to null', () => {
  assert.equal(nextFire({ every: 'day', at: '25:00' }, REF), null);
  assert.equal(nextFire({ every: 'day', at: '9-30' }, REF), null);
  assert.equal(nextFire({ every: 'week', weekday: 9 }, REF), null);
  assert.equal(nextFire({ every: 'week', weekday: -1 }, REF), null);
  assert.equal(nextFire({ every: 'day', count: 0 }, REF), null);
});

test('describe is human-readable, esc-safe, and never throws', () => {
  assert.equal(describe({ every: 'hour' }), 'Every hour');
  assert.equal(describe({ every: 'day', at: '09:00' }), 'Every day at 09:00 UTC');
  assert.equal(describe({ every: 'week', weekday: 1, at: '08:00' }), 'Every Monday at 08:00 UTC');
  assert.equal(describe({ every: 'week' }), 'Every week');
  assert.equal(describe({ every: 1000 }), 'Every 1000 ms');
  assert.equal(describe({ every: 'day', count: 1 }), 'Every day (up to 1 time)');
  assert.equal(describe({ every: 'day', at: '09:00', count: 3 }), 'Every day at 09:00 UTC (up to 3 times)');
  assert.equal(describe(null), 'Invalid schedule');
  // esc-safe: output carries no raw angle brackets / ampersands.
  assert.ok(!/[<>]/.test(describe({ every: 'day' })));
});
