// nl-dates.test.mjs — offline tests for the natural-language date extractor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDates, normalizeToIso, earliest, latest } from './nl-dates.mjs';

const REF = { now: '2026-01-01' };

test('ISO YYYY-MM-DD: extracts iso + day granularity + char offset', () => {
  const text = 'Shipped on 2026-06-05 to the testnet.';
  const hits = extractDates(text, REF);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { raw: '2026-06-05', iso: '2026-06-05', granularity: 'day', index: 11 });
});

test('Month D, YYYY (full + abbreviated, case-insensitive)', () => {
  assert.equal(normalizeToIso('March 14, 2017', REF), '2017-03-14');
  assert.equal(normalizeToIso('mar 14 2017', REF), '2017-03-14');
  assert.equal(normalizeToIso('MARCH 14, 2017', REF), '2017-03-14');
  assert.equal(normalizeToIso('Sept 1, 2020', REF), '2020-09-01');
});

test('D Month YYYY with ordinal suffix', () => {
  assert.equal(normalizeToIso('14 March 2017', REF), '2017-03-14');
  assert.equal(normalizeToIso('1st January 2000', REF), '2000-01-01');
});

test('US M/D/YYYY and M/D/YY (2-digit year resolved via INJECTED opts.now)', () => {
  assert.equal(normalizeToIso('6/11/2026', REF), '2026-06-11');
  assert.equal(normalizeToIso('6/11/26', REF), '2026-06-11');
  // Reference year drives 2-digit resolution; without injection -> sentinel 2000.
  assert.equal(normalizeToIso('1/2/99', { now: 2026 }), '1999-01-02');
  assert.equal(normalizeToIso('1/2/05', { now: '1980-01-01' }), '2005-01-02');
});

test('Month YYYY -> month granularity', () => {
  const hits = extractDates('Phase 2 in June 2026.', REF);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].iso, '2026-06');
  assert.equal(hits[0].granularity, 'month');
});

test('bare 4-digit year -> year granularity, range 1000-2099', () => {
  assert.equal(normalizeToIso('1999', REF), '1999');
  assert.equal(normalizeToIso('2099', REF), '2099');
  // out of range -> no match
  assert.equal(normalizeToIso('999', REF), null);
  assert.equal(normalizeToIso('2100', REF), null);
});

test('a year embedded in a fuller date is NOT double-counted', () => {
  const hits = extractDates('Met on March 14, 2017 sharp.', REF);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].iso, '2017-03-14');
  assert.equal(hits[0].granularity, 'day');
});

test('invalid / ambiguous dates are SKIPPED, never throw', () => {
  assert.equal(normalizeToIso('13/40/2020', REF), null); // month 13, day 40
  assert.equal(normalizeToIso('Feb 30, 2021', REF), null); // no Feb 30
  assert.equal(normalizeToIso('2021-02-29', REF), null); // 2021 not leap
  assert.equal(normalizeToIso('2020-13-01', REF), null); // month 13
  // Feb 29 on a leap year IS valid
  assert.equal(normalizeToIso('2020-02-29', REF), '2020-02-29');
});

test('soft-fail on non-string / empty / junk input', () => {
  assert.deepEqual(extractDates(null), []);
  assert.deepEqual(extractDates(undefined), []);
  assert.deepEqual(extractDates(42), []);
  assert.deepEqual(extractDates(''), []);
  assert.deepEqual(extractDates('no dates here at all'), []);
  assert.equal(normalizeToIso(null), null);
  assert.equal(normalizeToIso(''), null);
  assert.equal(normalizeToIso('not a date'), null);
});

test('multiple dates: ordered by char index, mixed granularities', () => {
  const text = 'From 2017 through June 2026, with a milestone on 2026-06-05.';
  const hits = extractDates(text, REF);
  assert.deepEqual(hits.map((h) => h.iso), ['2017', '2026-06', '2026-06-05']);
  assert.deepEqual(hits.map((h) => h.granularity), ['year', 'month', 'day']);
  // offsets strictly increasing
  assert.ok(hits[0].index < hits[1].index && hits[1].index < hits[2].index);
});

test('earliest / latest across mixed granularities', () => {
  const text = 'Founded 1999, scaled in June 2026, peak day 2026-06-05.';
  assert.equal(earliest(text, REF), '1999');
  assert.equal(latest(text, REF), '2026-06-05');
});

test('earliest/latest on text with no dates -> null', () => {
  assert.equal(earliest('nothing here'), null);
  assert.equal(latest('nothing here'), null);
});

test('reference year never reads wall clock: same input, different opts.now', () => {
  // "5/5/45" resolves relative to the injected reference, deterministically.
  assert.equal(normalizeToIso('5/5/45', { now: 2026 }), '2045-05-05');
  assert.equal(normalizeToIso('5/5/45', { now: 1990 }), '1945-05-05');
});

test('Date object and epoch-ms accepted as opts.now', () => {
  assert.equal(normalizeToIso('1/1/30', { now: new Date(Date.UTC(2026, 0, 1)) }), '2030-01-01');
  assert.equal(normalizeToIso('1/1/30', { now: Date.UTC(2026, 0, 1) }), '2030-01-01');
});
