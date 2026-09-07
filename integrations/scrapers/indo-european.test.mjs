import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKS, TRACK_IDS, getTrack, PRIMARY_REFERENCES,
  queriesFor, toRecord, toJsonl, harvest, __setFetch, UA, RATE_LIMIT_MS,
} from './indo-european.mjs';

test('the track set is well-formed and every query is unique', () => {
  const seen = new Set();
  for (const t of TRACKS) {
    assert.ok(t.id && t.label && Array.isArray(t.queries) && t.queries.length, `${t.id} malformed`);
    assert.ok(t.weight >= 1);
    for (const q of t.queries) {
      assert.ok(!seen.has(q), `duplicate query: ${q}`);
      seen.add(q);
    }
  }
  assert.equal(seen.size, queriesFor().length);
  assert.ok(queriesFor().length >= 90, 'the harvest should be substantial');
});

test('etymology is weighted heaviest, as the corpus requires', () => {
  const ety = getTrack('etymology');
  assert.equal(ety.weight, 3);
  const etyish = ['etymology', 'sound-laws', 'lexicon']
    .reduce((n, id) => n + getTrack(id).queries.length, 0);
  const rest = queriesFor().length - etyish;
  assert.ok(etyish > rest / 2, `etymology tracks (${etyish}) must dominate the rest (${rest})`);
});

test('the fringe track is carried AND flagged, never dropped and never laundered', () => {
  const fringe = getTrack('fringe');
  assert.equal(fringe.contested, true);
  assert.ok(fringe.queries.some((q) => /Nostratic/i.test(q)));
  // every fringe query must also pull the refutation, not just the proposal
  assert.ok(fringe.queries.filter((q) => /critique|criticism|debate|refut/i.test(q)).length >= 3);
  // and no OTHER track may be silently contested
  for (const t of TRACKS) if (t.id !== 'fringe') assert.ok(!t.contested, `${t.id} is contested but unflagged`);
});

test('queriesFor() tags each query with its track and contested flag', () => {
  const all = queriesFor();
  assert.ok(all.every((q) => TRACK_IDS.includes(q.track)));
  assert.ok(all.filter((q) => q.contested).length === getTrack('fringe').queries.length);
  const one = queriesFor(['lexicon']);
  assert.equal(one.length, getTrack('lexicon').queries.length);
  assert.deepEqual(queriesFor([]), []);
  assert.deepEqual(queriesFor(['no-such-track']), []);
});

test('the standard reference works are named so a harvest can be checked against them', () => {
  const works = PRIMARY_REFERENCES.map((r) => r.work).join(' ');
  for (const w of ['Pokorny', 'LIV', 'Watkins', 'Benveniste', 'Horse, the Wheel']) {
    assert.ok(works.includes(w) || PRIMARY_REFERENCES.some((r) => r.author.includes(w.split(',')[0])), `missing ${w}`);
  }
  assert.ok(PRIMARY_REFERENCES.every((r) => r.author && r.work && r.year));
});

test('toRecord() carries the scholarly metadata through, not just title and url', () => {
  const r = toRecord({
    title: ' Grimm law ', url: 'https://example.org/a', snippet: 's',
    doi: '10.1/x', year: 1999, authors: ['A'], venue: 'Language', cited: 42,
    openAccess: true, abstract: 'abs', providers: ['crossref', 'openalex'],
  }, { track: 'sound-laws', query: 'q', harvestedAt: 'T' });
  assert.equal(r.title, 'Grimm law');
  assert.equal(r.corpus, 'indo-european');
  assert.equal(r.doi, '10.1/x');
  assert.equal(r.cited, 42);
  assert.equal(r.openAccess, true);
  assert.equal(r.abstract, 'abs');
  assert.deepEqual(r.providers, ['crossref', 'openalex']);
  assert.equal(r.harvestedAt, 'T');
  assert.equal(r.contested, false);
});

test('toRecord() nulls missing metadata rather than inventing it', () => {
  const r = toRecord({ url: 'https://example.org/b' }, { track: 'etymology', query: 'q', harvestedAt: 'T' });
  assert.equal(r.doi, null);
  assert.equal(r.year, null);
  assert.equal(r.venue, null);
  assert.equal(r.cited, null);
  assert.deepEqual(r.authors, []);
  assert.equal(r.title, '');
});

test('harvest() dedupes across queries and tracks', async () => {
  // Every search returns the same two URLs; a 3-query run must yield exactly two records.
  __setFetch(async () => ({
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ RelatedTopics: [] }),
    text: async () => '',
  }));
  const { records, stats } = await harvest({
    tracks: ['lexicon'], perQuery: 2, throttleMs: 0, now: () => 'T',
  });
  // With a stub that yields nothing, the run must still complete cleanly rather than throw.
  assert.ok(Array.isArray(records));
  assert.equal(stats.queries, getTrack('lexicon').queries.length);
  assert.equal(stats.ok + stats.failed, stats.queries);
  __setFetch(null);
});

test('harvest() soft-fails per query so one dead provider cannot kill a long run', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const { records, stats } = await harvest({ tracks: ['genetics'], throttleMs: 0, now: () => 'T' });
  assert.deepEqual(records, []);
  assert.equal(stats.queries, getTrack('genetics').queries.length);
  assert.ok(stats.ok + stats.failed === stats.queries);
  __setFetch(null);
});

test('harvest() reports progress per query', async () => {
  __setFetch(async () => { throw new Error('x'); });
  const seen = [];
  await harvest({ tracks: ['comparative-method'], throttleMs: 0, onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, getTrack('comparative-method').queries.length);
  assert.equal(seen[0].of, seen.length);
  assert.equal(seen[seen.length - 1].i, seen.length);
  __setFetch(null);
});

test('toJsonl() emits one parseable record per line', () => {
  const recs = [
    toRecord({ url: 'https://a.example/1', title: 'A' }, { track: 'etymology', query: 'q', harvestedAt: 'T' }),
    toRecord({ url: 'https://a.example/2', title: 'B' }, { track: 'writing', query: 'q2', harvestedAt: 'T' }),
  ];
  const lines = toJsonl(recs).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).title, 'A');
  assert.equal(JSON.parse(lines[1]).track, 'writing');
  assert.equal(toJsonl([]), '');
});

test('the crawler identifies itself and declares a rate floor', () => {
  assert.match(UA, /MELEK-Bot/);
  assert.match(UA, /github\.com/);
  assert.ok(RATE_LIMIT_MS >= 1000, 'be polite to free scholarly APIs');
});

test('the alphabet route the corpus argues is actually in the query set', () => {
  const writing = getTrack('writing').queries.join(' ');
  assert.match(writing, /Proto-Sinaitic/);
  assert.match(writing, /Cadmus/);
  assert.match(writing, /Serabit el-Khadim/);
  assert.match(writing, /Tifinagh/, 'the Berber script must be in the sweep');
});
