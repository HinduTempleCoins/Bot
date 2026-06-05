// cheap-stores.test.mjs — offline tests for the true-dollar-store aggregator. Network stubbed via the
// Overpass + Nominatim __setFetch seams and the module's own seam (Google path). No live calls, no keys.
// Run: node --test integrations/soapbox/cheap-stores.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAINS, chainFacts, trulyCheapChains, chain, HOW_WE_DECIDE,
  locateStores, locateStoresOSM, locateStoresGoogle, googlePlacesStatus, GOOGLE_KEY_ENV,
  renderChainTable, renderResults, renderMap, esc, __setFetch,
} from './cheap-stores.mjs';
import { __setFetch as __setOverpassFetch } from './overpass.mjs';
import { __setFetch as __setNominatimFetch } from './nominatim.mjs';

// ── Layer 1: chain facts shape ──────────────────────────────────────────────────────────────────────
test('every chain has the required schema fields with sane types', () => {
  assert.ok(CHAINS.length >= 6);
  for (const c of CHAINS) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length);
    assert.ok(c.basePrice === null || typeof c.basePrice === 'number');
    assert.ok(c.priceCeiling === null || typeof c.priceCeiling === 'number');
    assert.equal(typeof c.trulyUnder2, 'boolean');
    assert.ok(c.notes && typeof c.notes === 'string');
    assert.ok(/^https?:\/\//.test(c.source), `${c.name} needs a real source URL`);
    assert.ok(['open', 'closed'].includes(c.status));
  }
});

test('Dollar Tree and Daiso are truly under $2 with real current base prices; DG/FD are name-only', () => {
  const dt = chain('dollar-tree');
  assert.equal(dt.basePrice, 1.25);
  assert.equal(dt.trulyUnder2, true);
  const daiso = chain('daiso');
  assert.equal(daiso.basePrice, 1.75);
  assert.equal(daiso.trulyUnder2, true);
  assert.equal(chain('dollar-general').trulyUnder2, false);
  assert.equal(chain('family-dollar').trulyUnder2, false);
});

test('99 Cents Only is recorded as closed and excluded from locatable chains', () => {
  const c = chain('99-cents-only');
  assert.equal(c.status, 'closed');
  // it is NOT in the truly-cheap OPEN set used by the locator
  assert.ok(!trulyCheapChains().some((x) => x.id === '99-cents-only'));
});

test('chainFacts filters by trulyUnder2 and open', () => {
  assert.ok(chainFacts({ trulyUnder2: true }).every((c) => c.trulyUnder2));
  assert.ok(chainFacts({ trulyUnder2: false }).every((c) => !c.trulyUnder2));
  assert.ok(chainFacts({ open: true }).every((c) => c.status === 'open'));
});

// ── Layer 2: locator with fake fetch (Overpass + Nominatim) ───────────────────────────────────────────
const overpassResp = (elements) => async () => ({ ok: true, json: async () => ({ elements }) });
const nominatimResp = (lat, lon) => async () => ({
  ok: true,
  json: async () => [{ lat: String(lat), lon: String(lon), display_name: 'Dallas, TX', type: 'city', boundingbox: ['32.6', '33.0', '-97.0', '-96.5'] }],
});

test('locateStoresOSM matches brand tokens and drops non-dollar variety stores', async () => {
  __setOverpassFetch(overpassResp([
    { type: 'node', id: 1, lat: 32.78, lon: -96.80, tags: { shop: 'variety_store', name: 'Dollar Tree #123', 'addr:city': 'Dallas', 'addr:state': 'TX' } },
    { type: 'node', id: 2, lat: 32.79, lon: -96.79, tags: { shop: 'variety_store', name: "Bob's Junk Shop" } }, // no match → dropped
    { type: 'node', id: 3, lat: 32.77, lon: -96.81, tags: { shop: 'variety_store', brand: 'Daiso' } },
    { type: 'node', id: 4, lat: 32.76, lon: -96.82, tags: { shop: 'variety_store', name: 'Dollar General' } }, // name-only → not locatable
  ]));
  const res = await locateStoresOSM({ lat: 32.7767, lon: -96.797, radiusM: 16000 });
  __setOverpassFetch(null);
  const ids = res.map((r) => r.chainId);
  assert.ok(ids.includes('dollar-tree'));
  assert.ok(ids.includes('daiso'));
  assert.ok(!ids.includes('dollar-general')); // name-only excluded from locator
  assert.equal(res.length, 2);
  // distance computed + sorted ascending
  assert.ok(res[0].distanceMi != null);
  assert.ok(res[0].distanceMi <= res[1].distanceMi);
});

test('locateStoresOSM soft-fails to [] on bad coords / network error', async () => {
  assert.deepEqual(await locateStoresOSM({}), []);
  __setOverpassFetch(() => async () => { throw new Error('down'); });
  assert.deepEqual(await locateStoresOSM({ lat: 1, lon: 2 }), []);
  __setOverpassFetch(null);
});

test('locateStores geocodes a zip via Nominatim then locates via OSM', async () => {
  __setNominatimFetch(nominatimResp(32.7767, -96.797));
  __setOverpassFetch(overpassResp([
    { type: 'node', id: 1, lat: 32.78, lon: -96.80, tags: { shop: 'variety_store', name: 'Dollar Tree' } },
  ]));
  const loc = await locateStores('75201');
  __setNominatimFetch(null); __setOverpassFetch(null);
  assert.ok(loc.origin);
  assert.equal(loc.provider, 'osm');
  assert.equal(loc.results.length, 1);
  assert.equal(loc.results[0].chainId, 'dollar-tree');
});

test('locateStores accepts a raw "lat,lng" with no geocode call', async () => {
  __setOverpassFetch(overpassResp([
    { type: 'node', id: 1, lat: 32.78, lon: -96.80, tags: { shop: 'convenience', brand: 'Daiso' } },
  ]));
  // nominatim left throwing to prove no geocode happens for lat,lng input
  __setNominatimFetch(() => async () => { throw new Error('should not be called'); });
  const loc = await locateStores('32.7767,-96.797');
  __setOverpassFetch(null); __setNominatimFetch(null);
  assert.ok(loc.origin);
  assert.equal(loc.results[0].chainId, 'daiso');
});

test('locateStores returns origin:null for an ungeocodable place', async () => {
  __setNominatimFetch(() => async () => ({ ok: true, json: async () => [] }));
  const loc = await locateStores('asdfqwerzxcv-nowhere');
  __setNominatimFetch(null);
  assert.equal(loc.origin, null);
  assert.deepEqual(loc.results, []);
});

// ── Google Places adapter (dormant + fake-fetch when keyed) ───────────────────────────────────────────
test('Google Places is dormant without a key — no call, no spend', async () => {
  const had = process.env[GOOGLE_KEY_ENV];
  delete process.env[GOOGLE_KEY_ENV];
  assert.equal(googlePlacesStatus().enabled, false);
  assert.deepEqual(await locateStoresGoogle({ lat: 32.7, lon: -96.8 }), []);
  if (had !== undefined) process.env[GOOGLE_KEY_ENV] = had;
});

test('Google Places path works with a key + fake fetch and confirms chain by name', async () => {
  const had = process.env[GOOGLE_KEY_ENV];
  process.env[GOOGLE_KEY_ENV] = 'FAKE_TEST_KEY';
  __setFetch(async () => ({
    ok: true,
    json: async () => ({
      results: [
        { name: 'Dollar Tree', geometry: { location: { lat: 32.78, lng: -96.80 } }, vicinity: '100 Main St, Dallas' },
        { name: 'Some Other Mart', geometry: { location: { lat: 32.79, lng: -96.79 } }, vicinity: 'x' }, // not a chain → dropped
      ],
    }),
  }));
  const res = await locateStoresGoogle({ lat: 32.7767, lon: -96.797 });
  __setFetch(null);
  if (had === undefined) delete process.env[GOOGLE_KEY_ENV]; else process.env[GOOGLE_KEY_ENV] = had;
  assert.ok(res.some((r) => r.chainId === 'dollar-tree' && r.provider === 'google'));
  assert.ok(!res.some((r) => r.name === 'Some Other Mart'));
});

// ── Render escaping + shape ───────────────────────────────────────────────────────────────────────────
test('renderChainTable escapes and always carries the how-we-decide line + sources', () => {
  const html = renderChainTable();
  assert.ok(html.includes('Dollar Tree'));
  assert.ok(html.includes(esc(HOW_WE_DECIDE)));
  assert.ok(html.includes('[source]'));
  assert.ok(html.includes('truly under $2'));
  assert.ok(html.includes('dollar in name only'));
});

test('renderResults escapes a hostile place string (no raw markup)', () => {
  const html = renderResults({ where: '<script>alert(1)</script>', origin: null, results: [] });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderResults renders a keyless OSM map iframe and the store list', () => {
  const loc = {
    where: 'Dallas', origin: { lat: 32.7767, lon: -96.797 }, provider: 'osm',
    results: [{ chainId: 'dollar-tree', name: 'Dollar Tree', basePrice: 1.25, lat: 32.78, lon: -96.80, address: '100 Main St', distanceMi: 0.7 }],
  };
  const html = renderResults(loc);
  assert.ok(html.includes('openstreetmap.org/export/embed.html'));
  assert.ok(html.includes('OpenStreetMap contributors'));
  assert.ok(html.includes('Dollar Tree'));
  assert.ok(html.includes('0.7 mi'));
});

test('renderMap soft-handles a missing origin', () => {
  assert.equal(renderMap(null), '');
  assert.ok(renderMap({ lat: 32.7, lon: -96.8 }).includes('iframe'));
});
