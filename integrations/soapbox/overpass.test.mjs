// overpass.test.mjs — offline tests for the standalone Overpass bbox/place reader. Network stubbed via
// __setFetch (overpass) and the nominatim geocode seam. No live calls, no keys.
// Run: node --test integrations/soapbox/overpass.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  queryAround, queryBbox, queryPlace, FEATURE_KEYS, provenance, dataNote, renderPage, esc, __setFetch,
} from './overpass.mjs';
import { __setFetch as __setNominatimFetch } from './nominatim.mjs';

// An Overpass response: a node (lat/lon direct) + a way (center) + a point-less element (dropped).
const OVERPASS_RESP = {
  elements: [
    { type: 'node', id: 1, lat: 45.52, lon: -122.68, tags: { amenity: 'cafe', name: 'Stumptown' } },
    { type: 'way', id: 2, center: { lat: 45.53, lon: -122.67 }, tags: { amenity: 'cafe', name: 'Heart' } },
    { type: 'relation', id: 3, tags: { amenity: 'cafe', name: 'No Point' } }, // no lat/lon/center → dropped
  ],
};

const okOverpass = (payload) => async () => ({ ok: true, json: async () => payload });
const throwing = () => async () => { throw new Error('down'); };
const notOk = () => async () => ({ ok: false, json: async () => ({}) });

test('queryAround normalizes nodes + way-centers and stamps ODbL provenance per record', async () => {
  __setFetch(okOverpass(OVERPASS_RESP));
  const res = await queryAround({ lat: 45.52, lon: -122.68, value: 'cafe', radiusM: 1500 });
  __setFetch(null);
  assert.equal(res.length, 2); // point-less relation dropped
  assert.equal(res[0].name, 'Stumptown');
  assert.deepEqual([res[0].lat, res[0].lon], [45.52, -122.68]);
  assert.equal(res[1].name, 'Heart'); // way center used
  assert.equal(res[1].lat, 45.53);
  assert.equal(res[0].category, 'cafe');
  assert.equal(res[0].provenance.license, 'ODbL');
  assert.equal(res[0].provenance.attribution, '© OpenStreetMap contributors');
  assert.equal(res[0].id, 'node/1');
});

test('queryAround soft-fails to [] on bad coords / network error / not-ok', async () => {
  assert.deepEqual(await queryAround({}), []);
  assert.deepEqual(await queryAround({ lat: 1 }), []);
  __setFetch(throwing());
  assert.deepEqual(await queryAround({ lat: 1, lon: 2, value: 'cafe' }), []);
  __setFetch(notOk());
  assert.deepEqual(await queryAround({ lat: 1, lon: 2, value: 'cafe' }), []);
  __setFetch(null);
});

test('queryBbox queries a [south,west,north,east] box and normalizes results', async () => {
  __setFetch(okOverpass(OVERPASS_RESP));
  const res = await queryBbox({ bbox: [45.4, -122.8, 45.6, -122.5], value: 'cafe' });
  __setFetch(null);
  assert.equal(res.length, 2);
  assert.equal(res[0].key, 'amenity');
});

test('queryBbox soft-fails to [] on a malformed bbox', async () => {
  assert.deepEqual(await queryBbox({ bbox: [1, 2, 3] }), []); // wrong length
  assert.deepEqual(await queryBbox({ bbox: ['a', 'b', 'c', 'd'] }), []); // non-numeric
  assert.deepEqual(await queryBbox({}), []);
});

test('queryPlace geocodes (Nominatim seam) then queries the place bbox', async () => {
  __setNominatimFetch(async () => ({
    ok: true,
    json: async () => [{
      lat: '45.52', lon: '-122.68', display_name: 'Portland, Oregon',
      boundingbox: ['45.43', '45.65', '-122.84', '-122.47'], // [sLat, nLat, wLon, eLon]
    }],
  }));
  __setFetch(okOverpass(OVERPASS_RESP));
  const out = await queryPlace('Portland, Oregon', { value: 'cafe' });
  __setFetch(null);
  __setNominatimFetch(null);
  assert.equal(out.place.displayName, 'Portland, Oregon');
  // bbox reordered to Overpass [south, west, north, east]
  assert.deepEqual(out.bbox, [45.43, -122.84, 45.65, -122.47]);
  assert.equal(out.results.length, 2);
});

test('queryPlace soft-fails to empty when geocode fails', async () => {
  __setNominatimFetch(async () => ({ ok: true, json: async () => [] }));
  const out = await queryPlace('Nowheresville', { value: 'cafe' });
  __setNominatimFetch(null);
  assert.equal(out.place, null);
  assert.deepEqual(out.results, []);
  assert.equal(out.bbox, null);
});

test('FEATURE_KEYS lists the OSM top-level keys, and provenance/dataNote name ODbL', () => {
  assert.ok(FEATURE_KEYS.includes('amenity'));
  assert.ok(FEATURE_KEYS.includes('shop'));
  assert.equal(provenance().license, 'ODbL');
  assert.match(dataNote(), /ODbL/);
  assert.match(dataNote(), /OpenStreetMap contributors/);
});

test('renderPage escapes feature names and accepts both array + {results} shapes', () => {
  const arr = renderPage([{ name: '<b>x</b>', category: 'cafe', lat: 1, lon: 2 }]);
  assert.ok(!arr.includes('<b>x</b>'));
  assert.ok(arr.includes('&lt;b&gt;'));
  const obj = renderPage({ place: { displayName: 'Portland' }, results: [] });
  assert.ok(obj.includes('No features'));
  assert.ok(obj.includes('Portland'));
  assert.equal(esc('<a>'), '&lt;a&gt;');
});
