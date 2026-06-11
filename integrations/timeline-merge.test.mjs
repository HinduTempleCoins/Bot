// Offline tests for timeline-merge.mjs — node:test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTimelines, uniqueTo, conflicts } from './timeline-merge.mjs';

test('merges and sorts events chronologically across sources', () => {
  const sources = [
    { name: 'a', events: [{ date: '2026-06-05', title: 'Phase 1' }] },
    { name: 'b', events: [{ date: '2017-03-14', title: 'Email' }] },
  ];
  const { merged } = mergeTimelines(sources);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].title, 'Email'); // 2017 sorts before 2026
  assert.equal(merged[1].title, 'Phase 1');
});

test('dedupes events sharing normalized date+title and unions origins + tags', () => {
  const sources = [
    { name: 'archive', events: [{ date: '2026-06', title: 'Phase 2 shipped', tags: ['build'] }] },
    { name: 'chainlog', events: [{ date: '2026-06', title: 'phase 2  SHIPPED', tags: ['phase2'] }] },
  ];
  const { merged, byEvent } = mergeTimelines(sources);
  assert.equal(merged.length, 1, 'case/whitespace-insensitive title + same month → one event');
  assert.deepEqual(merged[0].origins, ['archive', 'chainlog']);
  assert.deepEqual(merged[0].tags, ['build', 'phase2']);
  // byEvent is keyed by normalized date+title and points at the merged record.
  assert.ok(byEvent.size === 1);
  const [rec] = [...byEvent.values()];
  assert.equal(rec, merged[0]);
});

test('different ISO precision of the same instant does NOT dedupe (distinct iso)', () => {
  const sources = [
    { name: 'a', events: [{ date: '2026-06', title: 'X' }] },     // YYYY-MM → 2026-06-01T00:00:00Z
    { name: 'b', events: [{ date: '2026-06-15', title: 'X' }] },  // different day
  ];
  const { merged } = mergeTimelines(sources);
  assert.equal(merged.length, 2);
});

test('uniqueTo returns only events a single named source contributes', () => {
  const sources = [
    { name: 'archive', events: [
      { date: '2017-03-14', title: 'Email' },
      { date: '2026-06', title: 'Shared' },
    ] },
    { name: 'chainlog', events: [
      { date: '2026-06', title: 'Shared' },          // dedupes with archive → not unique
      { date: '2026-06-05', title: 'Phase 1' },       // unique to chainlog
    ] },
  ];
  const uniq = uniqueTo(sources, 'chainlog');
  assert.deepEqual(uniq.map((e) => e.title), ['Phase 1']);
  const uniqA = uniqueTo(sources, 'archive');
  assert.deepEqual(uniqA.map((e) => e.title), ['Email']);
});

test('conflicts reports same title with differing dates across sources', () => {
  const sources = [
    { name: 'a', events: [{ date: '2017-03-14', title: 'Email' }] },
    { name: 'b', events: [{ date: '2017-03-15', title: 'Email' }] },
    { name: 'c', events: [{ date: '2026-06', title: 'NoConflict' }] },
  ];
  const { merged } = mergeTimelines(sources);
  const c = conflicts(merged);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, 'Email');
  assert.equal(c[0].variants.length, 2);
  const dates = c[0].variants.map((v) => v.date).sort();
  assert.deepEqual(dates, ['2017-03-14T00:00:00.000Z', '2017-03-15T00:00:00.000Z']);
  // origins traceable per variant
  assert.deepEqual(c[0].variants.find((v) => v.date.startsWith('2017-03-14')).origins, ['a']);
});

test('conflicts also accepts the full {merged} return shape', () => {
  const sources = [
    { name: 'a', events: [{ date: '2020', title: 'T' }] },
    { name: 'b', events: [{ date: '2021', title: 'T' }] },
  ];
  const full = mergeTimelines(sources);
  const c = conflicts(full); // pass {merged, byEvent} directly
  assert.equal(c.length, 1);
});

test('undated events merge by raw date text and sort last', () => {
  const sources = [
    { name: 'a', events: [{ date: 'someday', title: 'TBD' }] },
    { name: 'b', events: [{ date: 'someday', title: 'tbd' }] }, // same raw + title → dedupe
    { name: 'c', events: [{ date: '2026-06', title: 'Dated' }] },
  ];
  const { merged } = mergeTimelines(sources);
  assert.equal(merged.length, 2);
  assert.equal(merged[merged.length - 1].title, 'TBD'); // undated last
  assert.deepEqual(merged[merged.length - 1].origins, ['a', 'b']);
  assert.equal(merged[merged.length - 1].date, null);
});

test('epoch seconds and ms parse like event-timeline', () => {
  const sources = [
    { name: 'a', events: [{ date: 1717200000, title: 'sec' }] },     // epoch seconds
    { name: 'b', events: [{ date: 1717200000000, title: 'ms' }] },   // epoch ms (same instant)
  ];
  const { merged } = mergeTimelines(sources);
  assert.equal(merged[0].date, merged[1] ? merged[0].date : merged[0].date);
  // both resolve to the same iso instant
  assert.equal(merged.length, 2); // different titles → not deduped
  assert.equal(merged[0].date, merged[1].date);
});

test('soft-fail: non-array sources, bad source/event entries are skipped, never throws', () => {
  assert.deepEqual(mergeTimelines(null).merged, []);
  assert.deepEqual(mergeTimelines('nope').merged, []);
  assert.deepEqual(mergeTimelines(undefined).merged, []);
  const sources = [
    null,
    42,
    { name: 'good', events: [null, 'bad', { date: '2026-06', title: 'OK' }] },
    { name: 'noEvents' }, // missing events
    { events: [{ date: '2020', title: 'Anon' }] }, // missing name → name ''
  ];
  const { merged } = mergeTimelines(sources);
  assert.deepEqual(merged.map((e) => e.title).sort(), ['Anon', 'OK']);
});

test('uniqueTo and conflicts soft-fail on junk input', () => {
  assert.deepEqual(uniqueTo(null, 'x'), []);
  assert.deepEqual(conflicts(null), []);
  assert.deepEqual(conflicts('nope'), []);
  assert.deepEqual(conflicts([{}, null, 'x']), []); // no titles → no conflicts
});

test('deterministic: same input yields identical output across calls', () => {
  const sources = [
    { name: 'a', events: [{ date: '2026-06', title: 'X', tags: ['t'] }, { date: '2017', title: 'Y' }] },
    { name: 'b', events: [{ date: '2026-06', title: 'X' }] },
  ];
  const r1 = JSON.stringify(mergeTimelines(sources).merged);
  const r2 = JSON.stringify(mergeTimelines(sources).merged);
  assert.equal(r1, r2);
});
