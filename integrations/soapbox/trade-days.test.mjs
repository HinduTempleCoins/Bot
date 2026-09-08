// trade-days.test.mjs — OFFLINE. Pure date maths; no network, no clock of its own.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  MARKETS, market, openDates, nthWeekdayOf, describeRule, calendar, nextOpen, discoveryQuery, handler,
} from './trade-days.mjs';

// ── the maths that stops someone driving to an empty field ────────────────────────────────────────
test('⭐ Canton is NEVER open on the first Monday — the day it is named after', () => {
  const c = market('canton-first-monday');
  for (const [y, m] of [[2026, 9], [2026, 10], [2026, 11], [2027, 1], [2027, 2]]) {
    const dates = openDates(c.rule, y, m);
    const firstMonday = nthWeekdayOf(y, m, 'monday', 1).toISOString().slice(0, 10);
    assert.ok(!dates.includes(firstMonday), `${y}-${m}: open on the first Monday ${firstMonday}`);
    assert.equal(dates.length, 4, 'Thursday through Sunday');
    assert.ok(dates.every((d) => d < firstMonday), 'every open day falls BEFORE the anchor');
  }
});

test('McKinney is never open on the third Monday either', () => {
  const t = market('mckinney-third-monday');
  for (const [y, m] of [[2026, 9], [2026, 12], [2027, 3]]) {
    const dates = openDates(t.rule, y, m);
    const thirdMonday = nthWeekdayOf(y, m, 'monday', 3).toISOString().slice(0, 10);
    assert.ok(!dates.includes(thirdMonday), `${y}-${m}`);
    assert.equal(dates.length, 3, 'Friday through Sunday');
  }
});

test('the known September 2026 dates', () => {
  assert.deepEqual(openDates(market('canton-first-monday').rule, 2026, 9),
    ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
  assert.deepEqual(openDates(market('mckinney-third-monday').rule, 2026, 9),
    ['2026-09-18', '2026-09-19', '2026-09-20']);
});

test('a month starting ON the anchor weekday still resolves correctly', () => {
  // June 2026 starts on a Monday, so the first Monday is the 1st and the market runs in MAY.
  const d = openDates({ kind: 'before-nth-weekday', n: 1, weekday: 'monday', days: ['thursday', 'friday', 'saturday', 'sunday'] }, 2026, 6);
  const firstMonday = nthWeekdayOf(2026, 6, 'monday', 1).toISOString().slice(0, 10);
  assert.equal(firstMonday, '2026-06-01');
  assert.ok(d.every((x) => x < firstMonday), 'the whole run falls in the previous month, which is correct');
  assert.ok(d[0].startsWith('2026-05'));
});

test('nthWeekdayOf returns null when the month has no Nth of that weekday', () => {
  assert.equal(nthWeekdayOf(2026, 2, 'monday', 5), null, 'no fifth Monday in Feb 2026');
  assert.ok(nthWeekdayOf(2026, 9, 'monday', 4));
  assert.equal(nthWeekdayOf(2026, 9, 'notaday', 1), null);
  assert.equal(nthWeekdayOf(2026, 9, 'monday', 0), null);
  assert.equal(nthWeekdayOf(2026, 9, 'monday', 6), null);
});

// ── the other rule kinds ──────────────────────────────────────────────────────────────────────────
test('weekly gives every matching weekday and never overruns the month', () => {
  const d = openDates({ kind: 'weekly', days: ['saturday'] }, 2026, 2);
  assert.ok(d.length === 4, 'Feb 2026 has four Saturdays');
  assert.ok(d.every((x) => x.startsWith('2026-02')));
});

test('a season closes a market out of season, in both wrapping and non-wrapping form', () => {
  const summer = { kind: 'weekly', days: ['saturday'], season: { from: 4, to: 11 } };
  assert.ok(openDates(summer, 2026, 6).length > 0);
  assert.equal(openDates(summer, 2026, 1).length, 0);
  const winter = { kind: 'weekly', days: ['saturday'], season: { from: 11, to: 2 } };
  assert.ok(openDates(winter, 2026, 12).length > 0, 'a wrapping season includes December');
  assert.ok(openDates(winter, 2026, 1).length > 0, 'and January');
  assert.equal(openDates(winter, 2026, 6).length, 0);
});

test('monthly-day skips months that are too short', () => {
  assert.deepEqual(openDates({ kind: 'monthly-day', day: 31 }, 2026, 2), []);
  assert.deepEqual(openDates({ kind: 'monthly-day', day: 15 }, 2026, 2), ['2026-02-15']);
});

test('junk input yields no dates rather than throwing', () => {
  assert.deepEqual(openDates({}, 2026, 9), []);
  assert.deepEqual(openDates({ kind: 'nonsense' }, 2026, 9), []);
  assert.deepEqual(openDates(null, 2026, 9), []);
  assert.deepEqual(openDates({ kind: 'weekly', days: ['saturday'] }, 2026, 13), []);
  assert.deepEqual(openDates({ kind: 'weekly', days: ['saturday'] }, NaN, 9), []);
});

// ── the reader-facing parts ───────────────────────────────────────────────────────────────────────
test('the description warns that the market is closed on its own namesake day', () => {
  const s = describeRule(market('canton-first-monday').rule);
  assert.match(s, /NOT on the monday itself/i);
  assert.match(s, /before the first Monday/i);
});

test('nextOpen finds the next date, rolls into later months, and refuses junk', () => {
  const r = market('mckinney-third-monday').rule;
  assert.equal(nextOpen(r, '2026-09-01'), '2026-09-18');
  assert.equal(nextOpen(r, '2026-09-19'), '2026-09-19', 'today counts if it is open today');
  assert.equal(nextOpen(r, '2026-09-21'), '2026-10-16', 'rolls to next month');
  assert.equal(nextOpen(r, 'not-a-date'), null);
  assert.equal(nextOpen({ kind: 'nonsense' }, '2026-09-01'), null);
});

test('the calendar merges markets in date order and carries the confidence through', () => {
  const c = calendar(2026, 9);
  assert.ok(c.length >= 7);
  const dates = c.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.ok(c.every((x) => x.confidence), 'a row that does not say how sure we are is not shippable');
});

test('EVERY seeded market is marked unverified with a source and a verify instruction', () => {
  for (const m of MARKETS) {
    assert.equal(m.confidence, 'unverified', `${m.id} must not claim verification it does not have`);
    assert.match(m.source, /^https:\/\//);
    assert.ok(m.verify && m.verify.length > 20, `${m.id} must say what to check`);
  }
  assert.equal(market('nope'), null);
});

test('discoveryQuery builds an Overpass query and makes no network call', () => {
  const q = discoveryQuery(33.1972, -96.6398);
  assert.match(q, /amenity"="marketplace/);
  assert.match(q, /around:40000,33.1972,-96.6398/);
  assert.equal(discoveryQuery('x', 'y'), null);
  assert.match(discoveryQuery(33, -96, 9e9), /around:80000/, 'radius is clamped');
});

test('the handler states the rule that the module exists for', () => {
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.match(j.rule, /named after a day it is closed on/);
  assert.ok(j.markets.every((m) => m.schedule && m.confidence));
});
