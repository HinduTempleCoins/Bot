import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toTile, parseSearch, searchArchive, films, shows, licenseLabel,
  bestVideoFile, parseMetadata, archiveMetadata, dataNote, esc, __setFetch,
} from './archive-video.mjs';

const SEARCH_JSON = {
  response: {
    docs: [
      { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: '1968', creator: 'George A. Romero', collection: ['feature_films'], licenseurl: '' },
      { identifier: 'PrelingerHomeMovie', title: ['Home Movie'], year: 1955, creator: ['Prelinger'], collection: ['prelinger'], licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' },
      { title: 'no identifier — dropped' },
    ],
  },
};

const META_JSON = {
  server: 'ia800100.us.archive.org',
  dir: '/12/items/night_of_the_living_dead',
  metadata: { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: '1968', collection: ['feature_films'] },
  files: [
    { name: '__ia_thumb.jpg', format: 'JPEG Thumb' },
    { name: 'notld.mp4', format: 'h.264' },
    { name: 'notld.ogv', format: 'Ogg Video' },
  ],
};

const mockJson = (obj) => async () => ({ ok: true, json: async () => obj });

test('esc escapes the single quote too', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
});

test('licenseLabel: CC0/PDM, PD, CC-BY, and collection fallback', () => {
  assert.equal(licenseLabel('https://creativecommons.org/publicdomain/mark/1.0/').token, 'cc0');
  assert.equal(licenseLabel('https://creativecommons.org/licenses/by/4.0/').token, 'cc-by');
  assert.equal(licenseLabel('').token, 'public-domain');
  assert.match(licenseLabel('', ['prelinger']).label, /Prelinger/);
});

test('toTile normalizes a doc → shared tile with a whitelisted IA player streamUrl + license', () => {
  const t = toTile(SEARCH_JSON.response.docs[0], 'film');
  assert.equal(t.id, 'night_of_the_living_dead');
  assert.equal(t.title, 'Night of the Living Dead');
  assert.equal(t.kind, 'film');
  assert.equal(t.year, '1968');
  assert.equal(t.source, 'Internet Archive');
  assert.match(t.streamUrl, /^https:\/\/archive\.org\/embed\/night_of_the_living_dead$/); // IA official player
  assert.ok(t.license, 'every tile carries a license label');
  assert.equal(t.licenseToken, 'public-domain');
});

test('toTile handles array title/year/creator and drops no-identifier docs', () => {
  const t = toTile(SEARCH_JSON.response.docs[1]);
  assert.equal(t.title, 'Home Movie');
  assert.equal(t.year, '1955');
  assert.equal(t.creator, 'Prelinger');
  assert.equal(t.licenseToken, 'cc0');
  assert.equal(toTile(SEARCH_JSON.response.docs[2]), null);
  assert.equal(toTile({}), null);
});

test('parseSearch parses the advancedsearch response, dropping the junk doc', () => {
  const tiles = parseSearch(SEARCH_JSON, 'film');
  assert.equal(tiles.length, 2);
  assert.ok(tiles.every((t) => t.streamUrl && t.license && t.source === 'Internet Archive'));
});

test('searchArchive fetches + parses → tiles', async () => {
  __setFetch(mockJson(SEARCH_JSON));
  const out = await searchArchive({ q: 'zombie', rows: 5 });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'night_of_the_living_dead');
  __setFetch(null);
});

test('films/shows soft-fail to [] on a bad response and on a throw', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await films({ q: 'x' }), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await shows({ q: 'x' }), []);
  __setFetch(null);
});

test('bestVideoFile prefers an h.264 mp4 over thumbnails/ogv', () => {
  const f = bestVideoFile(META_JSON.files);
  assert.equal(f.name, 'notld.mp4');
  assert.equal(bestVideoFile([]), null);
  assert.equal(bestVideoFile([{ name: 'x.jpg', format: 'JPEG' }]), null);
});

test('parseMetadata builds a REAL directly-playable mp4 streamUrl', () => {
  const m = parseMetadata(META_JSON);
  assert.equal(m.id, 'night_of_the_living_dead');
  assert.match(m.streamUrl, /^https:\/\/ia800100\.us\.archive\.org\/12\/items\/night_of_the_living_dead\/notld\.mp4$/);
  assert.equal(m.mimetype, 'video/mp4');
  assert.ok(m.license);
  assert.equal(parseMetadata(null), null);
  assert.equal(parseMetadata({ files: [] }), null); // no identifier
});

test('archiveMetadata fetches + resolves; soft-fails to null', async () => {
  __setFetch(mockJson(META_JSON));
  const m = await archiveMetadata('night_of_the_living_dead');
  assert.ok(m.streamUrl.endsWith('notld.mp4'));
  __setFetch(async () => { throw new Error('boom'); });
  assert.equal(await archiveMetadata('x'), null);
  __setFetch(null);
});

test('a hostile title is not executed as markup by toTile (data stays data)', () => {
  const t = toTile({ identifier: 'evil', title: '<script>alert(1)</script>', collection: ['prelinger'] });
  // toTile does not itself escape (the surface esc()s at render); assert it stores the raw string safely.
  assert.equal(t.title, '<script>alert(1)</script>');
  assert.equal(esc(t.title), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('dataNote states the never-rehost / never-scrape discipline', () => {
  assert.match(dataNote(), /never a rehost|never a scraped/i);
});
