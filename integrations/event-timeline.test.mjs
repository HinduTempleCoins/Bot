// event-timeline.test.mjs — offline unit tests for the generic timeline builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, groupByTag, renderMarkdown, renderMermaid } from './event-timeline.mjs';

test('buildTimeline orders events ascending by parsed date', () => {
  const evs = [
    { date: '2020-05-01', title: 'b' },
    { date: '2018-01-01', title: 'a' },
    { date: '2022-12-31', title: 'c' },
  ];
  const tl = buildTimeline(evs, { bucket: 'day' });
  assert.deepEqual(tl.ordered.map((e) => e.title), ['a', 'b', 'c']);
  assert.equal(tl.span.first.slice(0, 10), '2018-01-01');
  assert.equal(tl.span.last.slice(0, 10), '2022-12-31');
});

test('tolerant date parse: ISO, epoch s, epoch ms, YYYY, YYYY-MM', () => {
  const evs = [
    { date: '1970-01-01T00:00:00.000Z', title: 'iso' },
    { date: 1000, title: 'epoch-s' },       // 1000 s
    { date: 2000000, title: 'epoch-ms-or-s' }, // < 1e12 → treated as seconds
    { date: 1700000000000, title: 'epoch-ms' }, // ms
    { date: '1999', title: 'year' },
    { date: '2005-06', title: 'year-month' },
  ];
  const tl = buildTimeline(evs);
  // every event parsed (none null)
  for (const e of tl.ordered) assert.notEqual(e.date, null);
  // YYYY → Jan 1 UTC
  const y = tl.ordered.find((e) => e.title === 'year');
  assert.equal(y.date.slice(0, 10), '1999-01-01');
  // YYYY-MM → first of month
  const ym = tl.ordered.find((e) => e.title === 'year-month');
  assert.equal(ym.date.slice(0, 10), '2005-06-01');
});

test('unparseable dates sort last with date null', () => {
  const evs = [
    { date: 'garbage', title: 'bad1' },
    { date: '2020-01-01', title: 'good' },
    { date: null, title: 'bad2' },
  ];
  const tl = buildTimeline(evs);
  assert.equal(tl.ordered[0].title, 'good');
  // the two unparseable trail, preserving input order, with null dates
  assert.deepEqual(tl.ordered.slice(1).map((e) => e.title), ['bad1', 'bad2']);
  assert.equal(tl.ordered[1].date, null);
  assert.equal(tl.ordered[2].date, null);
});

test('buckets by month and by year', () => {
  const evs = [
    { date: '2020-01-15', title: 'jan' },
    { date: '2020-01-20', title: 'jan2' },
    { date: '2020-03-01', title: 'mar' },
    { date: '2021-07-01', title: 'next-year' },
  ];
  const byMonth = buildTimeline(evs, { bucket: 'month' });
  assert.deepEqual(byMonth.buckets.map((b) => b.period), ['2020-01', '2020-03', '2021-07']);
  assert.equal(byMonth.buckets[0].events.length, 2);

  const byYear = buildTimeline(evs, { bucket: 'year' });
  assert.deepEqual(byYear.buckets.map((b) => b.period), ['2020', '2021']);
  assert.equal(byYear.buckets[0].events.length, 3);
});

test('undated events bucket under "unknown" at the end', () => {
  const evs = [
    { date: 'nope', title: 'x' },
    { date: '2020-01-01', title: 'y' },
  ];
  const tl = buildTimeline(evs, { bucket: 'year' });
  assert.equal(tl.buckets[tl.buckets.length - 1].period, 'unknown');
});

test('invalid bucket falls back to day', () => {
  const tl = buildTimeline([{ date: '2020-01-01', title: 'a' }], { bucket: 'fortnight' });
  assert.equal(tl.buckets[0].period, '2020-01-01');
});

test('soft-fail: non-array input → empty timeline, no throw', () => {
  for (const bad of [null, undefined, 42, 'string', {}]) {
    const tl = buildTimeline(bad);
    assert.deepEqual(tl.ordered, []);
    assert.deepEqual(tl.buckets, []);
    assert.deepEqual(tl.span, { first: null, last: null });
  }
});

test('soft-fail: malformed event records do not throw', () => {
  const evs = [null, 5, { title: 'no-date' }, { date: '2020-01-01' }];
  const tl = buildTimeline(evs);
  assert.equal(tl.ordered.length, 4);
  // record with no title → empty string title
  assert.ok(tl.ordered.every((e) => typeof e.title === 'string'));
});

test('groupByTag returns a Map keyed by tag, untagged bucketed', () => {
  const evs = [
    { date: '2020-01-01', title: 'a', tags: ['chain', 'build'] },
    { date: '2020-02-01', title: 'b', tags: 'chain' },     // scalar tag tolerated
    { date: '2020-03-01', title: 'c' },                     // no tags
  ];
  const g = groupByTag(evs);
  assert.ok(g instanceof Map);
  assert.equal(g.get('chain').length, 2);
  assert.equal(g.get('build').length, 1);
  assert.equal(g.get('untagged').length, 1);
});

test('groupByTag soft-fails on non-array', () => {
  const g = groupByTag(null);
  assert.ok(g instanceof Map);
  assert.equal(g.size, 0);
});

test('renderMarkdown is deterministic and escapes HTML', () => {
  const evs = [{ date: '2020-01-01', title: '<script>x</script>', tags: ['t'], source: 'src&1' }];
  const tl = buildTimeline(evs, { bucket: 'year' });
  const md1 = renderMarkdown(tl);
  const md2 = renderMarkdown(tl);
  assert.equal(md1, md2);
  assert.ok(md1.includes('&lt;script&gt;'));
  assert.ok(!md1.includes('<script>'));
  assert.ok(md1.includes('src&amp;1'));
  assert.ok(md1.includes('## 2020'));
});

test('renderMarkdown handles malformed timeline without throwing', () => {
  assert.doesNotThrow(() => renderMarkdown(null));
  assert.doesNotThrow(() => renderMarkdown({}));
  assert.ok(renderMarkdown(null).includes('# Timeline'));
});

test('renderMermaid produces a fenced mermaid timeline block', () => {
  const evs = [
    { date: '2020-01-01', title: 'alpha: beta' },  // colon must be sanitized
    { date: '2021-01-01', title: 'gamma' },
  ];
  const tl = buildTimeline(evs, { bucket: 'year' });
  const out = renderMermaid(tl);
  assert.ok(out.startsWith('```mermaid'));
  assert.ok(out.includes('timeline'));
  assert.ok(out.includes('section 2020'));
  assert.ok(out.includes('section 2021'));
  // colon collapsed so it doesn't break Mermaid's event delimiter
  assert.ok(out.includes('alpha- beta'));
  assert.ok(out.trim().endsWith('```'));
});

test('renderMermaid handles empty timeline without throwing', () => {
  assert.doesNotThrow(() => renderMermaid(buildTimeline([])));
  assert.doesNotThrow(() => renderMermaid(null));
});
