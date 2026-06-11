// corpus-merge.test.mjs — offline node:test suite for the corpus merge/dedupe transform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  djb2,
  idFor,
  normalizeRecord,
  mergeSources,
  dedupeByText,
  tagBySourceAndDate,
  runCli,
} from './corpus-merge.mjs';

test('djb2 is deterministic, 8 hex chars, NOT crypto', () => {
  assert.equal(djb2('abc'), djb2('abc'));
  assert.match(djb2('abc'), /^[0-9a-f]{8}$/);
  assert.notEqual(djb2('abc'), djb2('abd'));
  assert.equal(djb2(''), djb2(null)); // null coerces to ''
});

test('normalizeRecord: stable id, source from opts, meta capture', () => {
  const n = normalizeRecord({ text: 'hello', date: '2026-01-01', author: 'x' }, { source: 'forum' });
  assert.equal(n.source, 'forum');
  assert.equal(n.date, '2026-01-01');
  assert.equal(n.text, 'hello');
  assert.deepEqual(n.meta, { author: 'x' });
  assert.equal(n.id, idFor('forum', 'hello'));
  // record's own source wins over opts
  const n2 = normalizeRecord({ text: 'hi', source: 'own' }, { source: 'opt' });
  assert.equal(n2.source, 'own');
});

test('normalizeRecord: body/content fallback fields', () => {
  assert.equal(normalizeRecord({ body: 'b' }, {}).text, 'b');
  assert.equal(normalizeRecord({ content: 'c' }, {}).text, 'c');
});

test('normalizeRecord soft-fail: no/empty text -> null, never throws', () => {
  assert.equal(normalizeRecord({ date: '2026' }, {}), null);
  assert.equal(normalizeRecord({ text: '   ' }, {}), null);
  assert.equal(normalizeRecord(null, {}), null);
  assert.equal(normalizeRecord('nope', {}), null);
});

test('mergeSources: normalizes, drops textless, sorts by date then source', () => {
  const merged = mergeSources({
    zsrc: [{ text: 'z', date: '2026-01-02' }],
    asrc: [{ text: 'a', date: '2026-01-02' }, { text: 'early', date: '2026-01-01' }, { text: '' }],
  });
  assert.equal(merged.length, 3); // textless dropped
  assert.deepEqual(merged.map(r => r.text), ['early', 'a', 'z']);
  // tie on date 2026-01-02 -> source asc: asrc before zsrc
  assert.deepEqual(merged.slice(1).map(r => r.source), ['asrc', 'zsrc']);
});

test('mergeSources soft-fail on bad input', () => {
  assert.deepEqual(mergeSources(null), []);
  assert.deepEqual(mergeSources({ s: 'not-an-array' }), []);
  assert.deepEqual(mergeSources({ s: [123, null] }), []);
});

test('dedupeByText: keeps earliest date, unions sources', () => {
  const recs = mergeSources({
    forum: [{ text: 'same', date: '2026-02-02' }],
    reddit: [{ text: 'same', date: '2026-01-01' }],
  });
  const d = dedupeByText(recs);
  assert.equal(d.length, 1);
  assert.equal(d[0].date, '2026-01-01'); // earliest survives
  assert.equal(d[0].source, 'reddit');
  assert.deepEqual(d[0].sources, ['forum', 'reddit']); // sorted union
});

test('dedupeByText: distinct text kept separate; deterministic order', () => {
  const recs = mergeSources({
    a: [{ text: 'one', date: '2026-01-01' }, { text: 'two', date: '2026-01-03' }],
    b: [{ text: 'one', date: '2026-01-02' }],
  });
  const d = dedupeByText(recs);
  assert.equal(d.length, 2);
  assert.deepEqual(d.map(r => r.text), ['one', 'two']);
  assert.deepEqual(d[0].sources, ['a', 'b']);
  // idempotent / deterministic
  assert.deepEqual(dedupeByText(recs), d);
});

test('dedupeByText soft-fail: bad input + textless skipped', () => {
  assert.deepEqual(dedupeByText(null), []);
  assert.deepEqual(dedupeByText([null, 'x', { date: '2026' }]), []);
});

test('tagBySourceAndDate: guarantees present source+date (queue 260)', () => {
  const tagged = tagBySourceAndDate([{ text: 't' }, { text: 'u', source: 's', date: 'd' }]);
  assert.equal(tagged[0].source, '');
  assert.equal(tagged[0].date, '');
  assert.equal(tagged[1].source, 's');
  assert.equal(tagged[1].date, 'd');
  assert.deepEqual(tagBySourceAndDate('bad'), []);
});

test('runCli: fixtures merge + dedupe the overlapping record', () => {
  const out = runCli();
  assert.equal(out.sourceCount, 2);
  assert.equal(out.mergedCount, 4); // textless reddit record dropped
  assert.equal(out.dedupedCount, 3); // "MELEK is five letters." merged across sources
  const dup = out.records.find(r => r.text === 'MELEK is five letters.');
  assert.equal(dup.date, '2026-01-01'); // reddit's earlier date wins
  assert.deepEqual(dup.sources, ['forum_a', 'reddit']);
});
