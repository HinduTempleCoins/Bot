// pd-films-gap.test.mjs — the gap audit's additions: documented, registered, de-duplicated, surfaced on /free. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_GAP, GAP_REJECTED } from './pd-films-gap.mjs';
import { PD_MORE, GENRES, ALL_MORE, moreByGenre } from './pd-films-more.mjs';
import { PD_CLASSICS } from './classic-films.mjs';
import { PD_HORROR_FILMS } from './horror-taxonomy.mjs';
import { licenseLabel, looksLikeRip } from './archive-video.mjs';
import { allFreeFilms } from './free-film-registry.mjs';

test('every gap film has an id, title, year, a known genre, a documented PD reason and its source', () => {
  const genres = new Set(GENRES.map((g) => g.id));
  assert.ok(PD_GAP.length > 300, `only ${PD_GAP.length}`);
  for (const f of PD_GAP) {
    assert.match(f.id, /^[\w.-]+$/, f.id);
    assert.ok(f.title && f.year > 1880 && f.year < 2000, JSON.stringify(f));
    assert.ok(genres.has(f.genre), `${f.title}: genre ${f.genre}`);
    assert.ok(f.year <= 1930 ? /1930|by age/.test(f.why) : /Wikipedia/.test(f.why), `${f.title}: ${f.why}`);
    assert.ok(f.foundVia, f.title);
    assert.equal(looksLikeRip(f.id, f.title), false, f.id);
  }
});

test('gap films are cleared to play, appear in the registry and on /free, and never duplicate existing lists', () => {
  const others = new Set([...PD_MORE, ...PD_CLASSICS, ...PD_HORROR_FILMS].map((f) => f.id));
  const ids = new Set();
  for (const f of PD_GAP) {
    assert.equal(others.has(f.id), false, `duplicate of an existing list: ${f.id}`);
    assert.equal(ids.has(f.id), false, `duplicate inside the gap list: ${f.id}`);
    ids.add(f.id);
    assert.equal(licenseLabel('', ['feature_films'], { id: f.id, year: '1960' }).token, 'public-domain', f.id);
  }
  const reg = new Set(allFreeFilms().map((f) => f.id));
  assert.ok(PD_GAP.every((f) => reg.has(f.id)));
  assert.equal(ALL_MORE.length, PD_MORE.length + PD_GAP.length);
  assert.equal(moreByGenre().reduce((n, g) => n + g.films.length, 0), ALL_MORE.length);
  assert.ok(GAP_REJECTED.every((r) => r.why && !ids.has(r.id)));
});
