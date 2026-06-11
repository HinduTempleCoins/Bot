// source-tagger.test.mjs — offline tests for the corpus source/date tagger.
// node --test integrations/source-tagger.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceFromUrl,
  tagRecord,
  tagAll,
  KNOWN_HOSTS,
} from './source-tagger.mjs';

// --- sourceFromUrl: known hosts -------------------------------------------

test('sourceFromUrl maps known hosts to slugs', () => {
  assert.equal(sourceFromUrl('https://www.reddit.com/r/foo/comments/x'), 'reddit');
  assert.equal(sourceFromUrl('https://bitcointalk.org/index.php?topic=1'), 'bitcointalk');
  assert.equal(sourceFromUrl('https://www.sacred-texts.com/hin/index.htm'), 'sacred-texts');
});

test('sourceFromUrl strips www and lowercases', () => {
  assert.equal(sourceFromUrl('HTTPS://WWW.Reddit.COM/r/foo'), 'reddit');
});

test('sourceFromUrl matches subdomains of known hosts by suffix', () => {
  assert.equal(sourceFromUrl('https://old.reddit.com/r/foo'), 'reddit');
  assert.equal(sourceFromUrl('https://en.wikipedia.org/wiki/Thing'), 'wikipedia');
});

test('sourceFromUrl handles short-host aliases', () => {
  assert.equal(sourceFromUrl('https://youtu.be/abc'), 'youtube');
  assert.equal(sourceFromUrl('https://x.com/someone'), 'twitter');
});

// --- sourceFromUrl: fallback + soft-fail ----------------------------------

test('sourceFromUrl falls back to registrable domain for unknown hosts', () => {
  assert.equal(sourceFromUrl('https://blog.example.co/path'), 'example.co');
  assert.equal(sourceFromUrl('https://example.com/x'), 'example.com');
});

test('sourceFromUrl tolerates scheme-less urls', () => {
  assert.equal(sourceFromUrl('www.reddit.com/r/foo'), 'reddit');
});

test('sourceFromUrl returns unknown for bad/empty input, never throws', () => {
  assert.equal(sourceFromUrl(''), 'unknown');
  assert.equal(sourceFromUrl(null), 'unknown');
  assert.equal(sourceFromUrl(undefined), 'unknown');
  assert.equal(sourceFromUrl('not a url at all'), 'unknown');
  assert.equal(sourceFromUrl(12345), 'unknown');
});

// --- tagRecord: happy path -------------------------------------------------

test('tagRecord stamps source, source_host, scraped_at, and tags', () => {
  const rec = { title: 'A post', body: 'hi', tags: ['mystery'] };
  const out = tagRecord(rec, {
    url: 'https://www.reddit.com/r/occult/comments/1',
    fetchedAt: '2026-06-11T00:00:00.000Z',
  });
  assert.equal(out.source, 'reddit');
  assert.equal(out.source_host, 'reddit.com');
  assert.equal(out.scraped_at, '2026-06-11T00:00:00.000Z');
  assert.deepEqual(out.tags, ['mystery', 'reddit']);
  assert.equal(out.title, 'A post');
});

test('tagRecord does NOT mutate the input record', () => {
  const rec = { title: 'x', tags: ['a'] };
  const snapshot = JSON.stringify(rec);
  const out = tagRecord(rec, { url: 'https://example.com/y', fetchedAt: 0 });
  assert.equal(JSON.stringify(rec), snapshot);
  assert.notStrictEqual(out, rec);
  assert.notStrictEqual(out.tags, rec.tags);
});

test('tagRecord dedupes when source already present in tags', () => {
  const out = tagRecord({ tags: ['reddit', 'foo'] }, {
    url: 'https://reddit.com/r/x',
    fetchedAt: '2026-01-01',
  });
  assert.deepEqual(out.tags, ['reddit', 'foo']);
});

test('tagRecord accepts Date and ms-number fetchedAt', () => {
  const d = new Date('2026-06-11T12:00:00.000Z');
  assert.equal(tagRecord({}, { url: 'https://x.com/a', fetchedAt: d }).scraped_at,
    '2026-06-11T12:00:00.000Z');
  assert.equal(tagRecord({}, { url: 'https://x.com/a', fetchedAt: d.getTime() }).scraped_at,
    '2026-06-11T12:00:00.000Z');
});

test('tagRecord falls back to record.url when opts.url absent', () => {
  const out = tagRecord({ url: 'https://bitcointalk.org/t/1' }, { fetchedAt: 0 });
  assert.equal(out.source, 'bitcointalk');
  assert.equal(out.source_host, 'bitcointalk.org');
});

// --- tagRecord: edge / soft-fail ------------------------------------------

test('tagRecord soft-fails on bad url to source=unknown, host=empty', () => {
  const out = tagRecord({ title: 't' }, { url: 'garbage', fetchedAt: '2026-01-01' });
  assert.equal(out.source, 'unknown');
  assert.equal(out.source_host, '');
  assert.deepEqual(out.tags, ['unknown']);
});

test('tagRecord omits scraped_at when fetchedAt unparseable', () => {
  const out = tagRecord({}, { url: 'https://reddit.com/x', fetchedAt: 'not-a-date' });
  assert.equal('scraped_at' in out, false);
});

test('tagRecord tolerates non-object record and missing opts', () => {
  const a = tagRecord(null);
  assert.equal(a.source, 'unknown');
  assert.deepEqual(a.tags, ['unknown']);
  const b = tagRecord('a string');
  assert.equal(b.source, 'unknown');
  const c = tagRecord(['arr']);
  assert.equal(c.source, 'unknown');
});

test('tagRecord normalizes messy tags (whitespace, non-strings, blanks)', () => {
  const out = tagRecord({ tags: ['  spaced  ', '', 7, null, 'spaced'] }, {
    url: 'https://example.com/x',
    fetchedAt: 0,
  });
  assert.deepEqual(out.tags, ['spaced', '7', 'example.com']);
});

test('tagRecord is deterministic for the same inputs', () => {
  const rec = { title: 't', tags: ['k'] };
  const opts = { url: 'https://reddit.com/x', fetchedAt: '2026-06-11T00:00:00.000Z' };
  assert.deepEqual(tagRecord(rec, opts), tagRecord(rec, opts));
});

// --- tagAll ----------------------------------------------------------------

test('tagAll maps over an array of records', () => {
  const recs = [
    { title: 'a', url: 'https://reddit.com/1' },
    { title: 'b', url: 'https://bitcointalk.org/2' },
  ];
  const out = tagAll(recs, { fetchedAt: '2026-06-11T00:00:00.000Z' });
  assert.equal(out.length, 2);
  assert.equal(out[0].source, 'reddit');
  assert.equal(out[1].source, 'bitcointalk');
  assert.equal(out[0].scraped_at, '2026-06-11T00:00:00.000Z');
});

test('tagAll soft-fails to [] on non-array input', () => {
  assert.deepEqual(tagAll(null), []);
  assert.deepEqual(tagAll('nope'), []);
  assert.deepEqual(tagAll({}), []);
  assert.deepEqual(tagAll(undefined), []);
});

test('tagAll does not mutate inputs', () => {
  const recs = [{ tags: ['x'], url: 'https://reddit.com/1' }];
  const snap = JSON.stringify(recs);
  tagAll(recs, { fetchedAt: 0 });
  assert.equal(JSON.stringify(recs), snap);
});

// --- sanity on the export --------------------------------------------------

test('KNOWN_HOSTS exposes the documented anchor mappings', () => {
  assert.equal(KNOWN_HOSTS['reddit.com'], 'reddit');
  assert.equal(KNOWN_HOSTS['bitcointalk.org'], 'bitcointalk');
  assert.equal(KNOWN_HOSTS['sacred-texts.com'], 'sacred-texts');
});
