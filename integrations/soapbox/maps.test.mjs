// OFFLINE tests for maps.mjs — provider-failover order + normalization, with an injected fetch.
// No network, no env keys required (we set/clear them per-test). We model each provider by the URL it
// hits and assert: (1) keyed providers are skipped when no key, (2) a failing provider falls through to
// the next, (3) every answer is normalized to one schema and provenance-tagged.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { __setFetch, geocode, reverseGeocode, route, places } from './maps.mjs';

const ENV_KEYS = ['GOOGLE_MAPS_KEY', 'HERE_KEY', 'MAPBOX_KEY'];
let saved;
beforeEach(() => { saved = {}; for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } __setFetch(null); });

// Build a fake fetch from a map of url-substring → handler. Handler returns { ok, json } or throws.
function fakeFetch(routes) {
  const calls = [];
  __setFetch(async (url) => {
    calls.push(url);
    for (const [frag, h] of routes) {
      if (url.includes(frag)) {
        if (typeof h === 'function') return h(url);
        return { ok: true, json: async () => h };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return calls;
}
const fail = () => { throw new Error('boom'); };
const notOk = () => ({ ok: false, status: 500, json: async () => ({}) });

test('geocode: no keys → skips Google/HERE/Mapbox, lands on OSM (keyless floor)', async () => {
  const calls = fakeFetch([
    ['nominatim.openstreetmap.org/search', [{ display_name: 'Eiffel Tower, Paris, France', lat: '48.8584', lon: '2.2945' }]],
  ]);
  const r = await geocode('Eiffel Tower');
  assert.equal(r.provider, 'osm');
  assert.equal(r.lat, 48.8584);
  assert.equal(r.lon, 2.2945);
  assert.equal(r.name, 'Eiffel Tower');
  assert.equal(r.address, 'Eiffel Tower, Paris, France');
  // never tried the keyed providers' hosts (no key)
  assert.ok(!calls.some((u) => u.includes('googleapis.com') || u.includes('hereapi.com') || u.includes('api.mapbox.com')));
});

test('geocode: Google has key and answers first → wins, normalized + tagged', async () => {
  process.env.GOOGLE_MAPS_KEY = 'g';
  fakeFetch([
    ['maps.googleapis.com/maps/api/geocode', { results: [{ formatted_address: 'Paris, France', geometry: { location: { lat: 48.85, lng: 2.35 } } }] }],
  ]);
  const r = await geocode('Paris');
  assert.equal(r.provider, 'google');
  assert.deepEqual([r.lat, r.lon], [48.85, 2.35]);
  assert.equal(r.address, 'Paris, France');
});

test('geocode: Google errors → HERE errors → Mapbox answers (failover order)', async () => {
  process.env.GOOGLE_MAPS_KEY = 'g';
  process.env.HERE_KEY = 'h';
  process.env.MAPBOX_KEY = 'm';
  fakeFetch([
    ['maps.googleapis.com', fail],
    ['hereapi.com', notOk],
    ['api.mapbox.com/geocoding', { features: [{ text: 'Lyon', place_name: 'Lyon, France', center: [4.83, 45.76] }] }],
  ]);
  const r = await geocode('Lyon');
  assert.equal(r.provider, 'mapbox');
  assert.deepEqual([r.lat, r.lon], [45.76, 4.83]); // [lon,lat] → normalized correctly
  assert.equal(r.name, 'Lyon');
});

test('geocode: all providers empty → null (never throws)', async () => {
  process.env.GOOGLE_MAPS_KEY = 'g';
  fakeFetch([['maps.googleapis.com', { results: [] }]]); // OSM 404s via default
  assert.equal(await geocode('nowhere-xyz'), null);
  assert.equal(await geocode(''), null);
});

test('reverseGeocode: no keys → OSM, normalized', async () => {
  fakeFetch([
    ['nominatim.openstreetmap.org/reverse', { display_name: '10 Downing St, London, UK' }],
  ]);
  const r = await reverseGeocode({ lat: 51.5, lon: -0.12 });
  assert.equal(r.provider, 'osm');
  assert.deepEqual([r.lat, r.lon], [51.5, -0.12]);
  assert.equal(r.address, '10 Downing St, London, UK');
});

test('reverseGeocode: bad input → null', async () => {
  assert.equal(await reverseGeocode({}), null);
  assert.equal(await reverseGeocode({ lat: 'x', lon: 1 }), null);
});

test('route: no keys → OSM, distance/duration/mode normalized; from/to echoed', async () => {
  fakeFetch([
    ['router.project-osrm.org/route', { code: 'Ok', routes: [{ distance: 12345, duration: 678 }] }],
  ]);
  const r = await route({ from: { lat: 1, lon: 2 }, to: { lat: 3, lon: 4 }, mode: 'walking' });
  assert.equal(r.provider, 'osm');
  assert.equal(r.distanceM, 12345);
  assert.equal(r.durationS, 678);
  assert.equal(r.mode, 'walking');
  assert.deepEqual(r.from, { lat: 1, lon: 2 });
  assert.deepEqual(r.to, { lat: 3, lon: 4 });
});

test('route: Google key, Google fails → falls to OSM', async () => {
  process.env.GOOGLE_MAPS_KEY = 'g';
  fakeFetch([
    ['maps.googleapis.com/maps/api/directions', fail],
    ['router.project-osrm.org/route', { code: 'Ok', routes: [{ distance: 100, duration: 50 }] }],
  ]);
  const r = await route({ from: { lat: 0, lon: 0 }, to: { lat: 1, lon: 1 } });
  assert.equal(r.provider, 'osm');
  assert.equal(r.mode, 'driving'); // default mode
});

test('route: string endpoints get geocoded first (OSM), then routed (OSM)', async () => {
  const geoFor = (u) => {
    const isParis = u.includes('Paris');
    return { ok: true, json: async () => [{ display_name: isParis ? 'Paris' : 'Lyon', lat: isParis ? '48.85' : '45.76', lon: isParis ? '2.35' : '4.83' }] };
  };
  fakeFetch([
    ['nominatim.openstreetmap.org/search', geoFor],
    ['router.project-osrm.org/route', { code: 'Ok', routes: [{ distance: 460000, duration: 16000 }] }],
  ]);
  const r = await route({ from: 'Paris', to: 'Lyon', mode: 'cycling' });
  assert.equal(r.provider, 'osm');
  assert.equal(r.distanceM, 460000);
  assert.deepEqual(r.from, { lat: 48.85, lon: 2.35 });
});

test('places: no keys → OSM list, each normalized + filtered to valid coords', async () => {
  fakeFetch([
    ['nominatim.openstreetmap.org/search', [
      { display_name: 'Cafe A, Paris', lat: '48.1', lon: '2.1' },
      { display_name: 'Cafe B, Paris', lat: '48.2', lon: '2.2' },
    ]],
  ]);
  const r = await places({ q: 'coffee', near: { lat: 48, lon: 2 } });
  assert.equal(r.length, 2);
  assert.equal(r[0].provider, 'osm');
  assert.deepEqual([r[0].name, r[0].lat, r[0].lon], ['Cafe A', 48.1, 2.1]);
});

test('places: Google key but empty → falls to OSM', async () => {
  process.env.GOOGLE_MAPS_KEY = 'g';
  fakeFetch([
    ['maps.googleapis.com/maps/api/place', { results: [] }],
    ['nominatim.openstreetmap.org/search', [{ display_name: 'Spot, Town', lat: '10', lon: '20' }]],
  ]);
  const r = await places({ q: 'museum' });
  assert.equal(r.length, 1);
  assert.equal(r[0].provider, 'osm');
});

test('places: empty query → [] without any fetch', async () => {
  let touched = false;
  __setFetch(async () => { touched = true; return { ok: false, json: async () => ({}) }; });
  assert.deepEqual(await places({ q: '' }), []);
  assert.equal(touched, false);
});
