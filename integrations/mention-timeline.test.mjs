// mention-timeline.test.mjs — offline tests for the pure mention→timeline transform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, toJSONL, dedupe } from './mention-timeline.mjs';

const mixed = [
  { date: '2026-03-05T12:00:00Z', source: 'hive', subject: 'launch', text: 'Big day: MELEK went live and the witness hathor is producing.', url: 'h:1' },
  { timestamp: 1735732800, source: 'email', subject: 'note', text: 'A quiet mention of melek in passing.' }, // 2025-01-01 epoch s
  { date: 'Wed, 04 Mar 2026 09:30:00 +0000', source: 'forum', text: 'Discussion thread about MELEK governance.' },
  { date: 'totally-broken', source: 'rss', text: 'Some MELEK rumor with no usable date.' },
];

test('buildTimeline sorts ascending and buckets undated at the end', () => {
  const tl = buildTimeline(mixed, { query: 'MELEK', contextChars: 15 });
  assert.equal(tl.count, 4);
  // Dated events ascending: epoch(2025-01-01) < 2026-03-04 < 2026-03-05, then undated.
  assert.equal(tl.events[0].source, 'email');
  assert.equal(tl.events[1].source, 'forum');
  assert.equal(tl.events[2].source, 'hive');
  assert.equal(tl.events[3].dayKey, 'undated');
  assert.equal(tl.events[3].dateISO, null);
});

test('quote is the matched span (original casing) and snippet is padded', () => {
  const tl = buildTimeline(mixed, { query: 'melek', contextChars: 10 });
  const hive = tl.events.find(e => e.source === 'hive');
  assert.equal(hive.quote, 'MELEK'); // original casing preserved
  assert.ok(hive.snippet.includes('MELEK'));
  // padded to roughly query + 2*context, with ellipsis on at least one side
  assert.ok(hive.snippet.length <= 'MELEK'.length + 2 * 10 + 2);
  assert.ok(hive.snippet.includes('…'));
});

test('no query => whole (collapsed) text is the snippet, quote empty', () => {
  const tl = buildTimeline([{ date: '2026-01-01', source: 's', text: '  lots   of   space  here  ' }]);
  assert.equal(tl.events[0].quote, '');
  assert.equal(tl.events[0].snippet, 'lots of space here');
});

test('byDay and bySubject grouping + range', () => {
  const tl = buildTimeline(mixed, { query: 'MELEK' });
  assert.ok(tl.byDay['2026-03-05']);
  assert.ok(tl.byDay['2026-03-04']);
  assert.ok(tl.byDay[ 'undated' ]);
  assert.deepEqual(tl.byDay['2026-03-05'].map(e => e.source), ['hive']);
  assert.ok(tl.bySubject['launch']);
  assert.ok(tl.bySubject['(no subject)']); // the forum + rss records have no subject
  // range covers earliest..latest DATED event only
  assert.equal(tl.range.from.slice(0, 10), '2025-01-01');
  assert.equal(tl.range.to.slice(0, 10), '2026-03-05');
});

test('dedupe by url and by (source,text,day)', () => {
  const dups = [
    { date: '2026-01-02', source: 'a', text: 'same', url: 'x' },
    { date: '2026-09-09', source: 'b', text: 'different time', url: 'x' }, // same url => dup
    { date: '2026-01-02', source: 'c', text: 'hello world' },
    { date: '2026-01-02', source: 'c', text: 'HELLO   world' }, // same source/text/day => dup
    { date: '2026-01-03', source: 'c', text: 'hello world' }, // different day => kept
  ];
  const out = dedupe(dups);
  assert.equal(out.length, 3);
  assert.equal(out[0].url, 'x');
});

test('JSONL round-trip: one event per line, parses back to the events', () => {
  const tl = buildTimeline(mixed, { query: 'MELEK', contextChars: 12 });
  const jsonl = toJSONL(tl);
  const lines = jsonl.split('\n');
  assert.equal(lines.length, tl.count);
  const parsed = lines.map(l => JSON.parse(l));
  assert.deepEqual(parsed, tl.events);
  // exported events carry the training-relevant fields
  for (const p of parsed) {
    assert.ok('dateISO' in p && 'dayKey' in p && 'source' in p && 'subject' in p
      && 'quote' in p && 'snippet' in p && 'url' in p);
    assert.ok(!('_ts' in p) && !('_order' in p)); // internal sort helpers stripped
  }
});

test('soft-fail: garbage input never throws and yields well-formed empties', () => {
  for (const bad of [null, undefined, 42, 'str', {}, [null, 7, 'x']]) {
    const tl = buildTimeline(bad);
    assert.deepEqual(tl, { events: [], byDay: {}, bySubject: {}, range: { from: null, to: null }, count: 0 });
    assert.equal(toJSONL(tl), '');
  }
  assert.deepEqual(dedupe('nope'), []);
  assert.equal(toJSONL(null), '');
  assert.equal(toJSONL({}), '');
});

test('query present but absent from a record: snippet kept, quote empty', () => {
  const tl = buildTimeline([{ date: '2026-01-01', source: 's', text: 'nothing relevant here' }], { query: 'MELEK' });
  assert.equal(tl.events[0].quote, '');
  assert.ok(tl.events[0].snippet.length > 0);
});
