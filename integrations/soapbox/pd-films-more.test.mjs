// pd-films-more.test.mjs — the wider public-domain shelf. Offline. node --test integrations/soapbox/pd-films-more.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_MORE, GENRES, EXCLUDED, moreByGenre, moreTile } from './pd-films-more.mjs';
import { PD_HORROR_FILMS } from './horror-taxonomy.mjs';
import { PD_CLASSICS } from './classic-films.mjs';
import { allFreeFilms } from './free-film-registry.mjs';
import { licenseLabel, looksLikeRip, PD_YEAR } from './archive-video.mjs';

test('every entry: valid unique IA id, year, genre and a documented public-domain reason', () => {
  const ids = new Set();
  const genres = new Set(GENRES.map((g) => g.id));
  for (const f of PD_MORE) {
    assert.match(f.id, /^[\w.!'-]+$/, f.id);
    assert.ok(!ids.has(f.id), `duplicate ${f.id}`); ids.add(f.id);
    assert.ok(Number.isInteger(f.year) && f.year >= 1895 && f.year <= 1970, f.title);
    assert.ok(genres.has(f.genre), `${f.title} genre ${f.genre}`);
    assert.match(f.why, /published ≤1930|published 1930|not renewed|public domain|federal government|notice|copyright filed/i, f.title);
    if (/≤1930|published 1930/.test(f.why)) assert.ok(f.year <= PD_YEAR, `${f.title} claims PD by age`);
    assert.equal(looksLikeRip(f.id, f.title), false, f.id);
  }
  assert.ok(PD_MORE.length >= 150, `only ${PD_MORE.length}`);
});

test('no overlap with the horror and classics shelves; excluded titles are absent', () => {
  const other = new Set([...PD_HORROR_FILMS, ...PD_CLASSICS].map((f) => f.id));
  for (const f of PD_MORE) assert.ok(!other.has(f.id), `${f.id} already on another shelf`);
  const titles = new Set(PD_MORE.map((f) => `${f.title.toLowerCase()}|${f.year}`));
  for (const x of EXCLUDED) assert.ok(!titles.has(`${x.title.toLowerCase()}|${x.year}`), `${x.title} must not be streamed`);
  assert.ok(EXCLUDED.some((x) => /Till the Clouds Roll By/.test(x.title)));
});

test('cleared at the licence check, in the free-film registry, grouped and tiled', () => {
  for (const f of PD_MORE) assert.equal(licenseLabel('', ['feature_films'], { id: f.id, year: '1960' }).token, 'public-domain', f.id);
  const reg = new Set(allFreeFilms().map((f) => f.id));
  for (const f of PD_MORE) assert.ok(reg.has(f.id), `${f.id} not in the registry`);
  assert.equal(moreByGenre().reduce((n, g) => n + g.films.length, 0), PD_MORE.length);
  const t = moreTile(PD_MORE[0]);
  assert.match(t.streamUrl, /^https:\/\/archive\.org\/embed\//);
  assert.equal(t.licenseToken, 'public-domain');
  assert.ok(PD_MORE.some((f) => f.pick));
});
