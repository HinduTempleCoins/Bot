import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wd from './films-wikidata.mjs';

const E = 'http://www.wikidata.org/entity/';
const row = (f, p, v, vl, vsl) => ({
  f: { value: E + f }, p: { value: p }, v: { value: v },
  ...(vl ? { vl: { value: vl } } : {}), ...(vsl != null ? { vsl: { value: String(vsl) } } : {}),
});
const BINDINGS = [
  row('Q151599', 'label', 'Metropolis'),
  row('Q151599', 'desc', '1927 German science fiction film'),
  row('Q151599', 'sl', '68'),
  row('Q151599', 'P31', E + 'Q11424'),
  row('Q151599', 'P577', '1927-01-10T00:00:00Z'),
  row('Q151599', 'P577', '1926-01-01T00:00:00Z'),
  row('Q151599', 'P2047', '153'),
  row('Q151599', 'P57', E + 'Q19504', 'Fritz Lang'),
  row('Q151599', 'P161', E + 'Q1', 'Minor Actor', 2),
  row('Q151599', 'P161', E + 'Q2', 'Brigitte Helm', 40),
  row('Q151599', 'P161', E + 'Q3'),                       // no label: dropped
  row('Q151599', 'P136', E + 'Q471839', 'science fiction film'),
  row('Q151599', 'P1874', '60026474'),
  row('Q151599', 'P724', 'metropolis_20201015'),
  row('Q151599', 'P345', 'tt0017136'),
  row('Q151599', 'P3383', 'http://commons.wikimedia.org/wiki/Special:FilePath/Metropolis%20poster.jpg'),
  row('Q5', 'labelmul', 'A Person'),                      // not a film; mul label fallback
  row('Q5', 'P31', E + 'Q5'),
  { bogus: true },
];

test('foldBindings: compact record, earliest year, fame-sorted cast, genre suffix stripped', () => {
  const [m, person] = wd.foldBindings(BINDINGS);
  assert.equal(m.id, 'Q151599');
  assert.equal(m.t, 'Metropolis');
  assert.equal(m.y, 1926);
  assert.equal(m.rt, 153);
  assert.deepEqual(m.d, ['Fritz Lang']);
  assert.deepEqual(m.c, ['Brigitte Helm', 'Minor Actor']);
  assert.deepEqual(m.g, ['science fiction']);
  assert.equal(m.w.netflix, '60026474');
  assert.equal(m.w.archive, 'metropolis_20201015');
  assert.equal(m.r.imdb, 'tt0017136');
  assert.equal(m.poster, 'Metropolis poster.jpg');
  assert.equal(m.film, true);
  assert.equal(person.t, 'A Person');
  assert.equal(person.film, false);
});

test('batchQuery only admits QIDs', () => {
  const q = wd.batchQuery(['Q1', 'x"}; DROP', 'Q22']);
  assert.match(q, /VALUES \?f \{ wd:Q1 wd:Q22 \}/);
  assert.doesNotMatch(q, /DROP/);
});

test('linkFor / commonsThumb / slug', () => {
  assert.equal(wd.linkFor('https://www.netflix.com/title/$1', '123'), 'https://www.netflix.com/title/123');
  assert.equal(wd.linkFor('https://www.rottentomatoes.com/$1', 'm/metropolis'), 'https://www.rottentomatoes.com/m/metropolis');
  assert.equal(wd.linkFor('https://x/$1', 'a b?c'), 'https://x/a%20b%3Fc');
  assert.equal(wd.linkFor('https://x/$1', ''), '');
  assert.match(wd.commonsThumb('Metropolis poster.jpg', 200), /Special:FilePath\/Metropolis_poster\.jpg\?width=200$/);
  assert.equal(wd.slug('Science Fiction!'), 'science-fiction');
});

test('fetchFilms and searchFilms soft-fail and filter to films', async () => {
  wd.__setFetch(async (url) => {
    const u = String(url);
    if (u.includes('wbsearchentities')) return { ok: true, json: async () => ({ search: [{ id: 'Q5' }, { id: 'Q151599' }] }) };
    if (u.includes('sparql')) return { ok: true, json: async () => ({ results: { bindings: BINDINGS } }) };
    return { ok: false };
  });
  const hits = await wd.searchFilms('metropolis');
  assert.deepEqual(hits.map((h) => h.id), ['Q151599']);
  wd.__setFetch(async () => { throw new Error('offline'); });
  assert.deepEqual(await wd.fetchFilms(['Q1']), []);
  assert.deepEqual(await wd.searchFilms('x'), []);
  assert.deepEqual(await wd.listFilmIds(), []);
  wd.__setFetch(null);
});

test('build writes NDJSON of films only', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(tmpdir() + '/films-build-');
  wd.__setFetch(async (url, opts) => {
    const body = decodeURIComponent(String(opts && opts.body || ''));
    if (body.includes('SELECT DISTINCT ?f ?sl')) return { ok: true, json: async () => ({ results: { bindings: [{ f: { value: E + 'Q151599' }, sl: { value: '68' } }, { f: { value: E + 'Q5' }, sl: { value: '9' } }] } }) };
    return { ok: true, json: async () => ({ results: { bindings: BINDINGS } }) };
  });
  const n = await wd.build({ out: dir + '/films.ndjson', sleep: async () => {} });
  assert.equal(n, 1);
  const rec = JSON.parse(readFileSync(dir + '/films.ndjson', 'utf8').trim());
  assert.equal(rec.id, 'Q151599');
  assert.equal(rec.film, undefined);
  wd.__setFetch(null);
});
