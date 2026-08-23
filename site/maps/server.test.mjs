// server.test.mjs — offline tests for Maps.MELEK. All network is replaced via the readers' own
// __setFetch hooks (nominatim.mjs + osm-poi.mjs); nothing here touches the wire. Covers: the home page
// renders the search box + map container; a ?q= search geocodes + lists nearby POIs (SSR) and injects
// script-safe map JSON; /api/search returns a shaped JSON object; an empty/failed reader yields a
// graceful empty state (no throw); /health / /robots.txt / /sitemap.xml; and esc-safety on a
// <script>-laden query.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, searchData, esc } from './server.mjs';
import * as nominatim from '../../integrations/soapbox/nominatim.mjs';
import * as osmPoi from '../../integrations/soapbox/osm-poi.mjs';

// ── canned reader responses ─────────────────────────────────────────────────────────────────────────
const NOMINATIM_HIT = [{
  lat: '32.7766642',
  lon: '-96.7969879',
  display_name: 'Dallas, Dallas County, Texas, United States',
  boundingbox: ['32.617', '33.016', '-96.999', '-96.463'],
}];

const OVERPASS_HIT = {
  elements: [
    { type: 'node', id: 1, lat: 32.7770, lon: -96.7975, tags: { amenity: 'restaurant', name: 'Angel Diner' } },
    { type: 'way', id: 2, center: { lat: 32.7800, lon: -96.8000 }, tags: { amenity: 'restaurant', name: 'Hathor Cafe' } },
    { type: 'node', id: 3, lat: 32.7760, lon: -96.7960, tags: { amenity: 'restaurant' } }, // no name → label fallback
    { type: 'relation', id: 4, tags: { amenity: 'restaurant', name: 'No Point Grill' } }, // no point → dropped
  ],
};

// Route a single fake fetch by URL: Overpass POSTs to /interpreter, Nominatim GETs /search.
function fakeFetch({ nominatim = NOMINATIM_HIT, overpass = OVERPASS_HIT, ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    const body = u.includes('interpreter') ? overpass : nominatim;
    return { ok, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

// Both readers keep their own _fetch; set the same routing fake on each, then restore.
function installFetch(cfg) {
  const f = fakeFetch(cfg);
  nominatim.__setFetch(f);
  osmPoi.__setFetch(f);
  return f;
}
function restore() { nominatim.__setFetch(null); osmPoi.__setFetch(null); }

// Minimal mock response object capturing what the handler wrote.
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

// ── / (home, no query) ────────────────────────────────────────────────────────────────────────────
test('/ renders the search box and the map container', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<form class=msearch/);
  assert.match(res.body, /name=q/);
  assert.match(res.body, /id=map/);       // Leaflet map div present
  assert.match(res.body, /MELEK Maps/);
  // ecosystem tie-ins present
  assert.match(res.body, /move\.melek\.salon/);
});

// ── /?q=Dallas — geocode + nearby POIs (SSR) ────────────────────────────────────────────────────────
test('/?q=Dallas renders the resolved place and a POI list', async () => {
  installFetch();
  const res = await get('/?q=Dallas');
  restore();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Dallas, Dallas County, Texas/); // resolved displayName
  assert.match(res.body, /Angel Diner/);                  // a nearby POI
  assert.match(res.body, /Hathor Cafe/);
  assert.match(res.body, /class=poi-list/);
  // the client map gets script-safe JSON with the center coords
  assert.match(res.body, /32\.7766642/);
  assert.match(res.body, /-96\.7969879/);
  // and the No-Point element was dropped from markers
  assert.doesNotMatch(res.body, /No Point Grill/);
});

// ── /api/search — shaped JSON ───────────────────────────────────────────────────────────────────────
test('/api/search returns a shaped JSON object', async () => {
  installFetch();
  const res = await get('/api/search?q=Dallas');
  restore();
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const data = JSON.parse(res.body);
  assert.equal(data.ok, true);
  assert.equal(data.query, 'Dallas');
  assert.equal(data.type, 'restaurant');
  assert.ok(data.place && Math.abs(data.place.lat - 32.7766642) < 1e-6);
  assert.ok(Array.isArray(data.results) && data.results.length >= 3);
  assert.equal(data.count, data.results.length);
  assert.equal(data.attribution, '© OpenStreetMap contributors');
  // distance is computed + results sorted nearest-first
  assert.ok(data.results[0].distanceM <= data.results[data.results.length - 1].distanceM);
});

test('/api/search honors a known ?type= and falls back for an unknown one', async () => {
  installFetch();
  const known = JSON.parse((await get('/api/search?q=Dallas&type=pharmacy')).body);
  const unknown = JSON.parse((await get('/api/search?q=Dallas&type=wormhole')).body);
  restore();
  assert.equal(known.type, 'pharmacy');
  assert.equal(unknown.type, 'restaurant'); // unknown → default
});

// ── soft-fail: empty / failing readers → graceful empty state, never throws ─────────────────────────
test('empty geocode → graceful empty page, no throw', async () => {
  installFetch({ nominatim: [] }); // Nominatim finds nothing
  const res = await get('/?q=Nowhereville');
  restore();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Couldn't find/);
});

test('empty geocode → shaped empty JSON (ok:false)', async () => {
  installFetch({ nominatim: [] });
  const res = await get('/api/search?q=Nowhereville');
  restore();
  const data = JSON.parse(res.body);
  assert.equal(data.ok, false);
  assert.equal(data.place, null);
  assert.deepEqual(data.results, []);
  assert.equal(data.count, 0);
});

test('a thrown fetch soft-fails to the empty shape (no throw)', async () => {
  const boom = async () => { throw new Error('network down'); };
  nominatim.__setFetch(boom); osmPoi.__setFetch(boom);
  const data = await searchData('Dallas');
  restore();
  assert.equal(data.ok, false);
  assert.equal(data.place, null);
  assert.deepEqual(data.results, []);
});

test('geocode ok but Overpass fails → place resolved, empty POI list', async () => {
  installFetch({ overpass: { elements: [] } });
  const res = await get('/?q=Dallas');
  restore();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Dallas, Dallas County/);
  assert.match(res.body, /No nearby places found/);
});

test('empty query returns the empty shape without any network', async () => {
  // no fetch installed → if it tried the wire it would throw; it must not.
  const data = await searchData('');
  assert.equal(data.ok, false);
  assert.equal(data.query, '');
  assert.deepEqual(data.results, []);
});

// ── esc-safety on a <script>-laden query ────────────────────────────────────────────────────────────
test('a <script> query is escaped in the page (no raw injection)', async () => {
  installFetch({ nominatim: [] }); // fails geocode → query echoed in the "couldn't find" note
  const res = await get('/?q=' + encodeURIComponent('<script>alert(1)</script>'));
  restore();
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;/);
});

test('esc() escapes the dangerous HTML characters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

// ── infra routes ────────────────────────────────────────────────────────────────────────────────────
test('/health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('/robots.txt renders', async () => {
  const res = await get('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /User-agent/i);
});

test('/sitemap.xml renders XML', async () => {
  const res = await get('/sitemap.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.body, /<urlset/);
});

test('unknown path redirects home', async () => {
  const res = await get('/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});
