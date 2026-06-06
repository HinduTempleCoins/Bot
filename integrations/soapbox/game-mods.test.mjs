// game-mods.test.mjs — offline tests for the game-mods reader. All network is stubbed via __setFetch;
// no live calls, no real keys. Run: node --test integrations/soapbox/game-mods.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchMods, modrinthSearch, modrinthProject, normalizeModrinth, renderResults,
  fmtCount, dataNote, KEY_ENV, curseforgeSearch, nexusLatest, __setFetch,
} from './game-mods.mjs';

function okFetch(json, { ok = true } = {}) {
  return async () => ({ ok, json: async () => json });
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }

const modrinthPayload = {
  hits: [
    { slug: 'create', title: 'Create', author: 'simibubi', downloads: 80000000, follows: 12000,
      project_type: 'mod', description: 'Building, creating, engineering', categories: ['technology', 'forge'] },
    { project_id: 'xyz789', title: 'Sodium', author: 'jellysquid', downloads: 60000000,
      project_type: 'mod', description: 'Rendering optimization', categories: ['optimization'] },
    { title: 'no-slug-dropped' }, // no slug/project_id → dropped
  ],
};

test('normalizeModrinth parses hits into clean rows, dropping slug-less entries', () => {
  const rows = normalizeModrinth(modrinthPayload);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'Modrinth');
  assert.equal(rows[0].slug, 'create');
  assert.equal(rows[0].downloads, 80000000);
  assert.ok(rows[0].url.includes('modrinth.com/mod/create'));
  assert.equal(rows[1].slug, 'xyz789'); // fell back to project_id
});

test('normalizeModrinth soft-handles junk → []', () => {
  assert.deepEqual(normalizeModrinth(null), []);
  assert.deepEqual(normalizeModrinth({}), []);
  assert.deepEqual(normalizeModrinth({ hits: 'nope' }), []);
});

test('modrinthSearch returns normalized rows from a canned payload', async () => {
  __setFetch(okFetch(modrinthPayload));
  const rows = await modrinthSearch('create', { limit: 5 });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'Create');
});

test('modrinthSearch soft-fails to [] on empty query and on network error', async () => {
  assert.deepEqual(await modrinthSearch(''), []);
  __setFetch(throwingFetch());
  assert.deepEqual(await modrinthSearch('create'), []);
  __setFetch(null);
});

test('modrinthProject returns a detail object or null', async () => {
  __setFetch(okFetch({ slug: 'create', title: 'Create', project_type: 'mod', downloads: 5,
    license: { id: 'mit' }, categories: ['technology'] }));
  const p = await modrinthProject('create');
  __setFetch(null);
  assert.equal(p.slug, 'create');
  assert.equal(p.license, 'mit');
  __setFetch(okFetch(null));
  assert.equal(await modrinthProject('nope'), null);
  __setFetch(null);
});

test('curseforgeSearch & nexusLatest soft-skip to [] when their key env is unset', async () => {
  const prevCf = process.env[KEY_ENV.curseforge];
  const prevNx = process.env[KEY_ENV.nexus];
  delete process.env[KEY_ENV.curseforge];
  delete process.env[KEY_ENV.nexus];
  // even with a fetch that would throw, no key means we never call it
  __setFetch(throwingFetch());
  assert.deepEqual(await curseforgeSearch('create'), []);
  assert.deepEqual(await nexusLatest({ game: 'skyrim' }), []);
  __setFetch(null);
  if (prevCf !== undefined) process.env[KEY_ENV.curseforge] = prevCf;
  if (prevNx !== undefined) process.env[KEY_ENV.nexus] = prevNx;
});

test('searchMods aggregates Modrinth results, lists sources, never throws', async () => {
  const prevCf = process.env[KEY_ENV.curseforge];
  delete process.env[KEY_ENV.curseforge]; // keyless path: only Modrinth runs
  __setFetch(okFetch(modrinthPayload));
  const res = await searchMods('create', { limit: 12 });
  __setFetch(null);
  if (prevCf !== undefined) process.env[KEY_ENV.curseforge] = prevCf;
  assert.equal(res.query, 'create');
  assert.equal(res.results.length, 2);
  assert.deepEqual(res.sources, ['Modrinth']);
  assert.ok(typeof res.note === 'string' && res.note.includes('Modrinth'));
});

test('searchMods returns the empty shape for a blank query (no network)', async () => {
  const res = await searchMods('   ');
  assert.deepEqual(res.results, []);
  assert.deepEqual(res.sources, []);
});

test('renderResults escapes content and includes the data note', () => {
  const html = renderResults({ results: [
    { source: 'Modrinth', title: '<b>x</b>', url: 'https://modrinth.com/mod/x', downloads: 1500000, categories: ['a'] },
  ] });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), 'title escaped');
  assert.ok(html.includes('1.5M'), 'count formatted');
  assert.ok(html.includes('data-note'));
  assert.ok(renderResults({ results: [] }).includes('No mods found'));
});

test('fmtCount formats and dataNote names Modrinth as keyless', () => {
  assert.equal(fmtCount(73), '73');
  assert.equal(fmtCount(1500), '1.5K');
  assert.equal(fmtCount(2500000), '2.5M');
  assert.equal(fmtCount(null), '—');
  assert.ok(dataNote().toLowerCase().includes('modrinth'));
  assert.ok(dataNote().toLowerCase().includes('keyless'));
});
