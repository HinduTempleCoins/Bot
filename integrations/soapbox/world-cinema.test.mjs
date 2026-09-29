import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_FILMS, WORLD_TAGS, WORLD_LEADS, WORLD_EXCLUDED, COUNTRIES, TYPES, countryShelves, countryCounts, worldTile } from './world-cinema.mjs';
import { licenseLabel, looksLikeRip } from './archive-video.mjs';
import { allFreeFilms, LISTS } from './free-film-registry.mjs';

test('every world film: valid id/year/country/type, published <= 1930, documented, not rip-named, registered as cleared', () => {
  const countries = new Set(COUNTRIES.map((c) => c.id)); const types = new Set(TYPES.map((t) => t.id));
  const ids = new Set();
  for (const f of WORLD_FILMS) {
    assert.ok(f.id && !ids.has(f.id), `unique id ${f.id}`); ids.add(f.id);
    assert.ok(f.year >= 1888 && f.year <= 1930, `${f.title} year ${f.year}`);
    assert.ok(countries.has(f.country), `${f.title} country ${f.country}`);
    assert.ok(types.has(f.genre), `${f.title} type ${f.genre}`);
    assert.match(f.why, /public domain in the US/);
    assert.equal(looksLikeRip(f.id, f.title), false, f.id);
    assert.equal(licenseLabel('', [], { id: f.id }).token, 'public-domain', `${f.id} cleared`);
  }
  assert.ok(WORLD_FILMS.length > 250);
});

test('no world film duplicates another list; the registry includes the world list', () => {
  assert.ok(LISTS.some((l) => l.name === 'world'));
  const other = new Set(allFreeFilms().filter((f) => f.list !== 'world').map((f) => f.id));
  for (const f of WORLD_FILMS) assert.equal(other.has(f.id), false, `${f.id} already in another list`);
});

test('country shelves: by type, never mixed across countries; tagged titles from other lists appear on their country', () => {
  const byId = new Map(allFreeFilms().map((f) => [String(f.id), f]));
  const fr = countryShelves('france', (id) => byId.get(id));
  assert.ok(fr.length > 1);
  for (const s of fr) for (const f of s.films) { assert.equal(f.country, 'france'); assert.equal(f.genre, s.id); }
  const taggedFr = Object.entries(WORLD_TAGS).filter(([, t]) => t.country === 'france').map(([id]) => id);
  assert.ok(taggedFr.length && fr.some((s) => s.films.some((f) => taggedFr.includes(f.id))), 'existing French titles surface on the French page');
  const counts = countryCounts((id) => byId.get(id));
  assert.ok(counts.find((c) => c.id === 'japan').count >= 1);
  assert.ok(counts.find((c) => c.id === 'korea').leads >= 1); // leads-only country still listed
});

test('leads are where-to-watch only (no IA ids, sourced, dated); exclusions carry reasons', () => {
  for (const l of WORLD_LEADS) { assert.match(l.url, /^https:\/\//); assert.match(l.source, /^https:\/\//); assert.equal(l.seen, '2026-09-29'); assert.equal(l.id, undefined); }
  assert.ok(WORLD_EXCLUDED.every((e) => e.reason));
  assert.ok(WORLD_EXCLUDED.some((e) => /1933 sound re-edit/.test(e.reason)));
});

test('worldTile shows country and language, curated PD licence, IA embed', () => {
  const t = worldTile(WORLD_FILMS.find((f) => f.country === 'japan'));
  assert.match(t.creator, /Japan/);
  assert.equal(t.licenseToken, 'public-domain');
  assert.match(t.streamUrl, /^https:\/\/archive\.org\/embed\//);
});
