// geo-basics.test.mjs — offline tests for the keyless geo-reference readers + GeoNames soft-skip.
// Network stubbed via __setFetch; GEONAMES_USERNAME manipulated via process.env in-test. No live calls.
// Run: node --test integrations/soapbox/geo-basics.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  elevation, country, timezone, geoSearch, renderRecord, dataNote, PROVENANCE, esc, __setFetch,
} from './geo-basics.mjs';

const okFetch = (payload) => async () => ({ ok: true, json: async () => payload });
const throwing = () => async () => { throw new Error('down'); };

test('elevation parses Open-Elevation results to meters with provenance', async () => {
  __setFetch(okFetch({ results: [{ latitude: 39.7391, longitude: -104.9847, elevation: 1609 }] }));
  const r = await elevation({ lat: 39.7391, lon: -104.9847 });
  __setFetch(null);
  assert.equal(r.elevationM, 1609);
  assert.equal(r.provenance.source, 'Open-Elevation');
  assert.match(r.provenance.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('elevation soft-fails to null on bad coords / network error / empty results', async () => {
  assert.equal(await elevation({}), null);
  assert.equal(await elevation({ lat: 1 }), null);
  __setFetch(throwing());
  assert.equal(await elevation({ lat: 1, lon: 2 }), null);
  __setFetch(okFetch({ results: [] }));
  assert.equal(await elevation({ lat: 1, lon: 2 }), null);
  __setFetch(null);
});

test('country resolves an ISO code into a clean reference record', async () => {
  __setFetch(okFetch([{
    name: { common: 'France', official: 'French Republic' },
    cca2: 'FR', cca3: 'FRA', region: 'Europe', subregion: 'Western Europe',
    capital: ['Paris'], population: 67391582,
    currencies: { EUR: { name: 'Euro' } }, languages: { fra: 'French' }, latlng: [46, 2],
  }]));
  const r = await country('FR');
  __setFetch(null);
  assert.equal(r.name, 'France');
  assert.equal(r.capital, 'Paris');
  assert.equal(r.region, 'Europe');
  assert.equal(r.population, 67391582);
  assert.deepEqual(r.currencies, ['EUR']);
  assert.deepEqual(r.languages, ['French']);
  assert.equal(r.provenance.source, 'REST Countries');
});

test('country soft-fails to null on empty input and a {status} not-found payload', async () => {
  assert.equal(await country(''), null);
  __setFetch(okFetch({ status: 404, message: 'Not Found' }));
  assert.equal(await country('ZZ'), null);
  __setFetch(null);
});

test('timezone returns current time + UTC offset for a TZ area', async () => {
  __setFetch(okFetch({
    timezone: 'America/Denver', datetime: '2026-06-03T12:00:00.000000-06:00',
    utc_offset: '-06:00', abbreviation: 'MDT', day_of_week: 3, dst: true,
  }));
  const r = await timezone('America/Denver');
  __setFetch(null);
  assert.equal(r.timezone, 'America/Denver');
  assert.equal(r.utcOffset, '-06:00');
  assert.equal(r.dst, true);
  assert.equal(r.provenance.source, 'WorldTimeAPI');
});

test('timezone soft-fails to null on empty input and an {error} payload', async () => {
  assert.equal(await timezone(''), null);
  __setFetch(okFetch({ error: 'unknown location' }));
  assert.equal(await timezone('Mars/Olympus'), null);
  __setFetch(null);
});

test('geoSearch SOFT-SKIPS when GEONAMES_USERNAME is unset (never throws)', async () => {
  const prev = process.env.GEONAMES_USERNAME;
  delete process.env.GEONAMES_USERNAME;
  const r = await geoSearch('Denver');
  if (prev !== undefined) process.env.GEONAMES_USERNAME = prev;
  assert.equal(r.skipped, true);
  assert.match(r.reason, /GEONAMES_USERNAME/);
  assert.deepEqual(r.results, []);
});

test('geoSearch queries GeoNames when the username env IS set', async () => {
  const prev = process.env.GEONAMES_USERNAME;
  process.env.GEONAMES_USERNAME = 'soapbox_test';
  __setFetch(okFetch({
    geonames: [
      { geonameId: 5419384, name: 'Denver', countryCode: 'US', adminName1: 'Colorado', lat: '39.73915', lng: '-104.9847', fcl: 'P', fcode: 'PPLA2', population: 600158 },
      { geonameId: 1, name: 'NoCoords', countryCode: 'US', lat: null, lng: null }, // dropped (no coords)
    ],
  }));
  const r = await geoSearch('Denver');
  __setFetch(null);
  if (prev === undefined) delete process.env.GEONAMES_USERNAME; else process.env.GEONAMES_USERNAME = prev;
  assert.equal(r.skipped, false);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].name, 'Denver');
  assert.equal(r.results[0].lat, 39.73915);
  assert.equal(r.results[0].provenance.license, 'CC-BY-4.0');
});

test('geoSearch soft-handles a GeoNames {status} error payload (bad user / quota)', async () => {
  const prev = process.env.GEONAMES_USERNAME;
  process.env.GEONAMES_USERNAME = 'bad_user';
  __setFetch(okFetch({ status: { message: 'user does not exist', value: 10 } }));
  const r = await geoSearch('Denver');
  __setFetch(null);
  if (prev === undefined) delete process.env.GEONAMES_USERNAME; else process.env.GEONAMES_USERNAME = prev;
  assert.equal(r.skipped, false);
  assert.match(r.reason, /user does not exist/);
  assert.deepEqual(r.results, []);
});

test('renderRecord escapes content; dataNote names all four sources + licenses', () => {
  const html = renderRecord({ name: '<script>x</script>', region: 'Europe', provenance: PROVENANCE.country }, 'Country');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(renderRecord(null).includes('No data'));
  const n = dataNote();
  assert.match(n, /Open-Elevation/);
  assert.match(n, /REST Countries/);
  assert.match(n, /WorldTimeAPI/);
  assert.match(n, /GeoNames/);
  assert.match(n, /CC-BY-4\.0/);
  assert.equal(esc('<a>'), '&lt;a&gt;');
});
