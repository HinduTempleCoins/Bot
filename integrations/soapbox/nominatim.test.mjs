// nominatim.test.mjs — offline tests for the standalone Nominatim geocoder. Network stubbed via __setFetch;
// no live calls, no keys. Run: node --test integrations/soapbox/nominatim.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geocode, reverseGeocode, provenance, dataNote, renderRecord, esc,
  LICENSE, ATTRIBUTION, MAX_RPS, MIN_REQUEST_INTERVAL_MS, __setFetch,
} from './nominatim.mjs';

const SEARCH_HIT = [{
  lat: '48.8584', lon: '2.2945', display_name: 'Eiffel Tower, Paris, France',
  type: 'attraction', osm_type: 'way', osm_id: 5013364,
  boundingbox: ['48.8574', '48.8594', '2.2935', '2.2955'],
  address: { tourism: 'Eiffel Tower', city: 'Paris', country: 'France' },
}];
const REVERSE_HIT = {
  lat: '48.8584', lon: '2.2945', display_name: 'Champ de Mars, Paris, France',
  type: 'park', osm_type: 'way', osm_id: 4486491,
  boundingbox: ['48.85', '48.86', '2.29', '2.30'],
  address: { road: 'Champ de Mars', city: 'Paris', country: 'France' },
};

const okFetch = (payload) => async () => ({ ok: true, json: async () => payload });
const throwingFetch = () => async () => { throw new Error('network down'); };
const notOk = () => async () => ({ ok: false, json: async () => ({}) });

test('geocode parses a Nominatim search hit into a clean record with ODbL provenance', async () => {
  __setFetch(okFetch(SEARCH_HIT));
  const r = await geocode('Eiffel Tower');
  __setFetch(null);
  assert.equal(r.lat, 48.8584);
  assert.equal(r.lon, 2.2945);
  assert.equal(r.displayName, 'Eiffel Tower, Paris, France');
  assert.equal(r.type, 'attraction');
  assert.deepEqual(r.boundingbox, [48.8574, 48.8594, 2.2935, 2.2955]); // strings → numbers
  assert.equal(r.provenance.license, 'ODbL');
  assert.equal(r.provenance.attribution, '© OpenStreetMap contributors');
  assert.match(r.provenance.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('geocode soft-fails to null on empty query / network error / not-ok / empty array', async () => {
  assert.equal(await geocode(''), null);
  assert.equal(await geocode('   '), null);
  __setFetch(throwingFetch());
  assert.equal(await geocode('x'), null);
  __setFetch(notOk());
  assert.equal(await geocode('x'), null);
  __setFetch(okFetch([]));
  assert.equal(await geocode('x'), null);
  __setFetch(null);
});

test('reverseGeocode turns a single object payload into an address record', async () => {
  __setFetch(okFetch(REVERSE_HIT));
  const r = await reverseGeocode({ lat: 48.8584, lon: 2.2945 });
  __setFetch(null);
  assert.equal(r.displayName, 'Champ de Mars, Paris, France');
  assert.equal(r.address.city, 'Paris');
  assert.equal(r.provenance.license, 'ODbL');
});

test('reverseGeocode soft-fails to null on missing coords and on an {error} payload', async () => {
  assert.equal(await reverseGeocode({}), null);
  assert.equal(await reverseGeocode({ lat: 1 }), null);
  __setFetch(okFetch({ error: 'Unable to geocode' }));
  assert.equal(await reverseGeocode({ lat: 0, lon: 0 }), null);
  __setFetch(null);
});

test('provenance + dataNote name OSM, the ODbL license, and attribution', () => {
  const p = provenance();
  assert.equal(p.license, LICENSE);
  assert.equal(p.attribution, ATTRIBUTION);
  assert.match(p.source, /OpenStreetMap/);
  const n = dataNote();
  assert.match(n, /ODbL/);
  assert.match(n, /OpenStreetMap contributors/);
});

test('usage-policy constants encode the 1 rps floor', () => {
  assert.equal(MAX_RPS, 1);
  assert.equal(MIN_REQUEST_INTERVAL_MS, 1000);
});

test('renderRecord escapes hostile content and renders an empty note for null', () => {
  const html = renderRecord({ lat: 1, lon: 2, displayName: '<script>alert(1)</script>', type: null, provenance: provenance() });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('ODbL'));
  assert.ok(renderRecord(null).includes('No match'));
  assert.equal(esc('<a>'), '&lt;a&gt;');
});
