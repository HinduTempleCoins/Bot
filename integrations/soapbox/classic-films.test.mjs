// classic-films.test.mjs — public-domain classics catalogue. Offline. node --test integrations/soapbox/classic-films.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PD_CLASSICS, GENRES, EXCLUDED, classicsByGenre, classicTile } from './classic-films.mjs';
import { licenseLabel, looksLikeRip, PD_YEAR } from './archive-video.mjs';

test('every classic has a valid IA id, year, genre and a documented public-domain reason', () => {
  const ids = new Set();
  const genres = new Set(GENRES.map((g) => g.id));
  for (const f of PD_CLASSICS) {
    assert.match(f.id, /^[\w.!-]+$/, f.id);
    assert.ok(!ids.has(f.id), `duplicate ${f.id}`); ids.add(f.id);
    assert.ok(Number.isInteger(f.year) && f.year >= 1895 && f.year <= 1970, f.title);
    assert.ok(genres.has(f.genre), `${f.title} genre ${f.genre}`);
    assert.match(f.why, /published ≤1930|not renewed|public domain/i, f.title);
    if (/≤1930/.test(f.why)) assert.ok(f.year <= PD_YEAR, `${f.title} claims PD by age`);
    assert.equal(looksLikeRip(f.id, f.title), false, f.id);
  }
  assert.ok(PD_CLASSICS.length >= 40);
});

test('classics are cleared at the licence check (registered at import) and excluded titles are absent', () => {
  for (const f of PD_CLASSICS) assert.equal(licenseLabel('', ['feature_films'], { id: f.id, year: String(f.year) }).token, 'public-domain', f.id);
  const titles = new Set(PD_CLASSICS.map((f) => f.title.toLowerCase()));
  for (const x of EXCLUDED) assert.ok(!titles.has(x.title.toLowerCase()), `${x.title} must not be streamed`);
  assert.ok(EXCLUDED.some((x) => /Scarlet Pimpernel/.test(x.title)));
});

test('grouping and tiles', () => {
  const groups = classicsByGenre();
  assert.equal(groups.reduce((n, g) => n + g.films.length, 0), PD_CLASSICS.length);
  const t = classicTile(PD_CLASSICS[0]);
  assert.match(t.streamUrl, /^https:\/\/archive\.org\/embed\//);
  assert.equal(t.licenseToken, 'public-domain');
});
