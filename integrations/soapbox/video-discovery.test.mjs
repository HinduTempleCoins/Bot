// video-discovery.test.mjs — offline tests for the video discovery reader.
// All network calls stubbed via __setFetch; TMDB soft-skips without TMDB_API_KEY. Run:
//   node --test integrations/soapbox/video-discovery.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveFilms, tmdbSearch, discover, IA_COLLECTIONS,
  renderList, dataNote, __setFetch,
} from './video-discovery.mjs';

function jsonFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function throwingFetch() {
  return async () => { throw new Error('network down'); };
}

const iaPayload = {
  response: {
    docs: [
      { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: '1968', creator: 'George A. Romero', licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/', description: 'A classic.' },
      { identifier: 'Prelinger_Coffee', title: ['Coffee House'], year: 1949, description: ['short film'] },
    ],
  },
};

// ── Internet Archive (keyless) ─────────────────────────────────────────────────────────────────────
test('archiveFilms parses docs, builds IA-OWN-player embeds, stamps source/license/provenance', async () => {
  __setFetch(jsonFetch(iaPayload));
  const r = await archiveFilms({ q: 'living dead' });
  __setFetch(null);
  assert.equal(r.length, 2);
  const a = r[0];
  assert.equal(a.title, 'Night of the Living Dead');
  assert.equal(a.source, 'Internet Archive');
  assert.equal(a.embed, 'https://archive.org/embed/night_of_the_living_dead'); // official player via embed gate
  assert.equal(a.url, 'https://archive.org/details/night_of_the_living_dead');
  assert.match(a.provenance, /Internet Archive item/);
  assert.ok(a.license);
  // array-valued title/year/description flatten cleanly
  assert.equal(r[1].title, 'Coffee House');
  assert.equal(r[1].year, '1949');
});

test('archiveFilms queries the openly-licensed collections (prelinger + feature_films)', async () => {
  let seen = '';
  __setFetch(async (url) => { seen = String(url); return { ok: true, json: async () => ({ response: { docs: [] } }) }; });
  await archiveFilms({ q: 'moon' });
  __setFetch(null);
  assert.match(decodeURIComponent(seen), /collection:prelinger/);
  assert.match(decodeURIComponent(seen), /collection:feature_films/);
  assert.match(decodeURIComponent(seen), /mediatype:movies/);
  assert.deepEqual(IA_COLLECTIONS, ['prelinger', 'feature_films']);
});

test('archiveFilms soft-fails to [] on error and on a malformed payload', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await archiveFilms({ q: 'x' }), []);
  __setFetch(jsonFetch({ nope: true }));
  assert.deepEqual(await archiveFilms({ q: 'x' }), []);
  __setFetch(null);
});

// ── TMDB (keyed; soft-skip) ────────────────────────────────────────────────────────────────────────
test('tmdbSearch soft-skips to [] when TMDB_API_KEY is unset (never calls fetch)', async () => {
  __setFetch(throwingFetch()); // proves no fetch happens
  const r = await tmdbSearch({ q: 'moon' });
  __setFetch(null);
  assert.deepEqual(r, []);
});

// ── discover merges, JustWatch discipline ──────────────────────────────────────────────────────────
test('discover returns keyless IA results (TMDB soft-skipped); every record has provenance + license', async () => {
  __setFetch(jsonFetch(iaPayload));
  const r = await discover({ q: 'dead' });
  __setFetch(null);
  assert.ok(r.length >= 2);
  assert.ok(r.every((v) => v.source === 'Internet Archive')); // TMDB absent (no key)
  assert.ok(r.every((v) => v.provenance && v.license && v.source));
  // IA records are playable (own-player embed); none host a third-party stream
  assert.ok(r.every((v) => v.embed === '' || v.embed.startsWith('https://archive.org/embed/')));
});

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────
test('renderList escapes a malicious title, flags playable vs link-out, shows data note', () => {
  const html = renderList([
    { title: '<img src=x onerror=alert(1)>', year: '1968', url: 'https://archive.org/details/x', embed: 'https://archive.org/embed/x', license: 'PD', source: 'Internet Archive' },
    { title: 'Some Movie', year: '2001', url: 'https://www.themoviedb.org/movie/1', embed: '', license: 'metadata', source: 'TMDB' },
  ]);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('playable'));   // IA row
  assert.ok(html.includes('link out'));   // TMDB row
  assert.ok(html.includes('Films &amp; video'));
});

test('renderList handles empty + dataNote states the never-host discipline', () => {
  assert.ok(renderList([]).includes('No films'));
  assert.ok(renderList(null).includes('</section>'));
  assert.match(dataNote(), /never host/);
  assert.match(dataNote(), /Internet Archive/);
});
