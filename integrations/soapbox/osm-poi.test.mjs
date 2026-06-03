// osm-poi.test.mjs — offline tests for the OSM "places near here" reader. All network is replaced via
// __setFetch with canned Nominatim + Overpass JSON; nothing here hits the wire. Covers: geocode coords +
// soft-fail; nearby parsing + soft-fail; AMENITIES contents; findNear chaining; HTML escaping in
// renderPage; ODbL/OSM attribution in dataNote; and that a descriptive User-Agent is set on requests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geocode, nearby, findNear, AMENITIES, renderPage, dataNote, esc, __setFetch, MIN_REQUEST_INTERVAL_MS,
} from './osm-poi.mjs';

// ── canned responses ───────────────────────────────────────────────────────────────────────────────────
const NOMINATIM_HIT = [{
  lat: '45.5202471',
  lon: '-122.6741949',
  display_name: 'Portland, Multnomah County, Oregon, United States',
  boundingbox: ['45.432', '45.6529', '-122.836', '-122.472'],
}];

const OVERPASS_HIT = {
  elements: [
    { type: 'node', id: 1, lat: 45.521, lon: -122.675, tags: { amenity: 'pharmacy', name: 'Downtown Pharmacy' } },
    { type: 'way', id: 2, center: { lat: 45.519, lon: -122.679 }, tags: { amenity: 'pharmacy', name: 'Riverside Rx' } },
    // an element with no name → falls back to the amenity label; still has a point.
    { type: 'node', id: 3, lat: 45.522, lon: -122.671, tags: { amenity: 'pharmacy' } },
    // an element with no usable point → dropped.
    { type: 'relation', id: 4, tags: { amenity: 'pharmacy', name: 'No Point Rx' } },
  ],
};

// Build a fake fetch that records the last request and returns the supplied JSON (or an error response).
function fakeFetch(json, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    return { ok, status, json: async () => json };
  };
  fn.calls = calls;
  return fn;
}

function restore() { __setFetch(null); }

// ── geocode ──────────────────────────────────────────────────────────────────────────────────────────
test('geocode returns normalized coords + bounding box', async () => {
  __setFetch(fakeFetch(NOMINATIM_HIT));
  const g = await geocode('Portland, Oregon');
  restore();
  assert.equal(g.lat, 45.5202471);
  assert.equal(g.lon, -122.6741949);
  assert.match(g.displayName, /Portland/);
  assert.deepEqual(g.boundingbox, [45.432, 45.6529, -122.836, -122.472]);
});

test('geocode soft-fails to null on empty result', async () => {
  __setFetch(fakeFetch([]));
  assert.equal(await geocode('Nowhereville XYZ'), null);
  restore();
});

test('geocode soft-fails to null on a thrown fetch', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.equal(await geocode('Portland'), null);
  restore();
});

test('geocode returns null for empty input', async () => {
  __setFetch(fakeFetch(NOMINATIM_HIT));
  assert.equal(await geocode(''), null);
  restore();
});

// ── nearby ───────────────────────────────────────────────────────────────────────────────────────────
test('nearby parses canned Overpass elements (node + way center), dropping point-less ones', async () => {
  __setFetch(fakeFetch(OVERPASS_HIT));
  const rows = await nearby({ lat: 45.52, lon: -122.67, amenity: 'pharmacy', radiusM: 2000 });
  restore();
  assert.equal(rows.length, 3); // the relation with no point is dropped
  assert.equal(rows[0].name, 'Downtown Pharmacy');
  assert.equal(rows[0].type, 'pharmacy');
  assert.equal(rows[0].lat, 45.521);
  // way uses center
  assert.equal(rows[1].lat, 45.519);
  assert.equal(rows[1].lon, -122.679);
  // unnamed element falls back to the amenity label
  assert.equal(rows[2].name, 'Pharmacies');
  // tags are carried through
  assert.equal(rows[0].tags.amenity, 'pharmacy');
});

test('nearby soft-fails to [] on a non-ok response', async () => {
  __setFetch(fakeFetch(null, { ok: false, status: 504 }));
  assert.deepEqual(await nearby({ lat: 45.52, lon: -122.67, amenity: 'pharmacy' }), []);
  restore();
});

test('nearby soft-fails to [] on bad input', async () => {
  __setFetch(fakeFetch(OVERPASS_HIT));
  assert.deepEqual(await nearby({ lat: null, lon: -122.67, amenity: 'pharmacy' }), []);
  assert.deepEqual(await nearby({ lat: 45.52, lon: -122.67, amenity: '' }), []);
  restore();
});

// ── AMENITIES ────────────────────────────────────────────────────────────────────────────────────────
test('AMENITIES includes pharmacy + hospital (and other curated types)', () => {
  const types = AMENITIES.map((a) => a.type);
  assert.ok(types.includes('pharmacy'));
  assert.ok(types.includes('hospital'));
  assert.ok(types.includes('atm'));
  assert.ok(types.includes('charging_station')); // EV chargers
  assert.ok(types.includes('library'));
  // every entry is well-formed
  for (const a of AMENITIES) {
    assert.equal(typeof a.type, 'string');
    assert.equal(typeof a.label, 'string');
  }
});

// ── findNear (chaining) ──────────────────────────────────────────────────────────────────────────────
test('findNear chains geocode → nearby', async () => {
  let n = 0;
  __setFetch(async (url, opts = {}) => {
    n += 1;
    // first call = Nominatim geocode (GET), second = Overpass (POST)
    const json = n === 1 ? NOMINATIM_HIT : OVERPASS_HIT;
    return { ok: true, status: 200, json: async () => json };
  });
  const out = await findNear('Portland, Oregon', 'pharmacy');
  restore();
  assert.equal(n, 2);
  assert.ok(out.place);
  assert.equal(out.amenity, 'pharmacy');
  assert.equal(out.results.length, 3);
});

test('findNear soft-fails (no geocode → empty results, place null)', async () => {
  __setFetch(fakeFetch([])); // geocode comes up empty
  const out = await findNear('Nowhereville XYZ', 'pharmacy');
  restore();
  assert.equal(out.place, null);
  assert.deepEqual(out.results, []);
});

// ── renderPage (escaping) ────────────────────────────────────────────────────────────────────────────
test('renderPage escapes a malicious POI name', () => {
  const evil = '<script>alert("xss")</script>';
  const html = renderPage({
    place: { lat: 45.52, lon: -122.67, displayName: 'Portland' },
    amenity: 'pharmacy',
    results: [{ name: evil, type: 'pharmacy', lat: 45.521, lon: -122.675, tags: {} }],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  // distance is rendered from the geocoded point
  assert.match(html, /poi-dist/);
});

test('renderPage handles empty results gracefully', () => {
  const html = renderPage({ place: { lat: 45.52, lon: -122.67, displayName: 'Portland' }, amenity: 'pharmacy', results: [] });
  assert.match(html, /No places found/);
});

test('esc handles all five HTML metacharacters', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

// ── dataNote (attribution) ───────────────────────────────────────────────────────────────────────────
test('dataNote names OpenStreetMap + ODbL + an as-of date', () => {
  const note = dataNote();
  assert.match(note, /OpenStreetMap/);
  assert.match(note, /ODbL/);
  assert.match(note, /as of \d{4}-\d{2}-\d{2}/);
});

// ── User-Agent header ────────────────────────────────────────────────────────────────────────────────
test('a descriptive User-Agent header is set on Nominatim requests', async () => {
  const f = fakeFetch(NOMINATIM_HIT);
  __setFetch(f);
  await geocode('Portland');
  restore();
  const ua = f.calls[0].opts.headers['User-Agent'];
  assert.ok(ua && ua.length > 0);
  assert.match(ua, /SoapBox/);
});

test('a User-Agent header is set on Overpass requests (POST with body)', async () => {
  const f = fakeFetch(OVERPASS_HIT);
  __setFetch(f);
  await nearby({ lat: 45.52, lon: -122.67, amenity: 'pharmacy' });
  restore();
  const call = f.calls[0];
  assert.match(call.opts.headers['User-Agent'], /SoapBox/);
  assert.equal(call.opts.method, 'POST');
  assert.match(call.opts.body, /amenity/); // the Overpass QL is in the body
});

// ── politeness constant ──────────────────────────────────────────────────────────────────────────────
test('a polite rate-limit interval is exported', () => {
  assert.equal(typeof MIN_REQUEST_INTERVAL_MS, 'number');
  assert.ok(MIN_REQUEST_INTERVAL_MS >= 1000);
});
