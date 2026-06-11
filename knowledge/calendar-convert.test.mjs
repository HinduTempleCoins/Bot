// calendar-convert.test.mjs — offline tests for the calendar conversion module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  gregorianToJDN,
  jdnToGregorian,
  julianToJDN,
  jdnToJulian,
  gregorianToJulian,
  julianToGregorian,
  dayOfWeek,
  daysBetween,
  isLeap,
} from './calendar-convert.mjs';

test('esc escapes HTML metacharacters and handles null', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(2026), '2026');
});

test('gregorianToJDN known epochs', () => {
  // JDN epoch: Nov 24, 4714 BC (Gregorian) = year -4713.
  assert.equal(gregorianToJDN({ year: -4713, month: 11, day: 24 }), 0);
  // 2000-01-01 Gregorian = JDN 2451545.
  assert.equal(gregorianToJDN({ year: 2000, month: 1, day: 1 }), 2451545);
  // 2026-06-11.
  assert.equal(typeof gregorianToJDN({ year: 2026, month: 6, day: 11 }), 'number');
});

test('gregorian round-trips through JDN', () => {
  const samples = [
    { year: 1, month: 1, day: 1 },
    { year: 1582, month: 10, day: 15 },
    { year: 2000, month: 2, day: 29 },
    { year: 2026, month: 6, day: 11 },
    { year: -100, month: 7, day: 4 },
  ];
  for (const d of samples) {
    const jdn = gregorianToJDN(d);
    assert.deepEqual(jdnToGregorian(jdn), d);
  }
});

test('julian round-trips through JDN', () => {
  const samples = [
    { year: 1, month: 1, day: 1 },
    { year: 1582, month: 10, day: 4 },
    { year: 2026, month: 6, day: 11 },
  ];
  for (const d of samples) {
    const jdn = julianToJDN(d);
    assert.deepEqual(jdnToJulian(jdn), d);
  }
});

test('Gregorian reform alignment: 1582-10-15 Greg == 1582-10-05 Julian', () => {
  const jdnGreg = gregorianToJDN({ year: 1582, month: 10, day: 15 });
  const jdnJul = julianToJDN({ year: 1582, month: 10, day: 5 });
  assert.equal(jdnGreg, jdnJul);
  assert.deepEqual(gregorianToJulian({ year: 1582, month: 10, day: 15 }), {
    year: 1582,
    month: 10,
    day: 5,
  });
  assert.deepEqual(julianToGregorian({ year: 1582, month: 10, day: 5 }), {
    year: 1582,
    month: 10,
    day: 15,
  });
});

test('cross-calendar 13-day offset in 2000s', () => {
  // In the 21st century Julian lags Gregorian by 13 days.
  const greg = { year: 2000, month: 1, day: 14 };
  assert.deepEqual(gregorianToJulian(greg), { year: 2000, month: 1, day: 1 });
});

test('dayOfWeek: 2000-01-01 was a Saturday (6)', () => {
  const jdn = gregorianToJDN({ year: 2000, month: 1, day: 1 });
  assert.equal(dayOfWeek(jdn), 6);
  // 2026-06-11 is a Thursday (4).
  assert.equal(dayOfWeek(gregorianToJDN({ year: 2026, month: 6, day: 11 })), 4);
});

test('daysBetween accepts dates and JDNs', () => {
  const a = { year: 2026, month: 1, day: 1 };
  const b = { year: 2026, month: 1, day: 11 };
  assert.equal(daysBetween(a, b), 10);
  assert.equal(daysBetween(b, a), -10);
  assert.equal(daysBetween(0, 100), 100);
  assert.equal(daysBetween(a, a), 0);
});

test('isLeap: Gregorian rules (4/100/400)', () => {
  assert.equal(isLeap(2000), true);
  assert.equal(isLeap(1900), false);
  assert.equal(isLeap(2024), true);
  assert.equal(isLeap(2026), false);
});

test('isLeap: Julian rule (every 4th)', () => {
  assert.equal(isLeap(1900, { calendar: 'julian' }), true);
  assert.equal(isLeap(2000, { calendar: 'julian' }), true);
  assert.equal(isLeap(2026, { calendar: 'julian' }), false);
});

test('soft-fail: invalid inputs return null, never throw', () => {
  assert.equal(gregorianToJDN(null), null);
  assert.equal(gregorianToJDN({}), null);
  assert.equal(gregorianToJDN({ year: 2026, month: 13, day: 1 }), null);
  assert.equal(gregorianToJDN({ year: 2026, month: 1, day: 0 }), null);
  assert.equal(gregorianToJDN({ year: 'x', month: 1, day: 1 }), null);
  assert.equal(jdnToGregorian('not a number'), null);
  assert.equal(jdnToGregorian(undefined), null);
  assert.equal(julianToJDN(undefined), null);
  assert.equal(jdnToJulian(null), null);
  assert.equal(gregorianToJulian({ month: 1 }), null);
  assert.equal(julianToGregorian('nope'), null);
  assert.equal(dayOfWeek('abc'), null);
  assert.equal(daysBetween(null, 5), null);
  assert.equal(isLeap('abc'), null);
  assert.equal(isLeap(2000, { calendar: 'mayan' }), null);
});

test('numeric-string coercion works', () => {
  assert.equal(gregorianToJDN({ year: '2000', month: '1', day: '1' }), 2451545);
  assert.equal(dayOfWeek('2451545'), 6);
  assert.equal(isLeap('2000'), true);
});
