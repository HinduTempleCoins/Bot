import { test } from 'node:test';
import assert from 'node:assert';
import {
  cheapestOffer, durationMinutes,
  normalizeDuffel, normalizeTravelpayouts, normalizeDistribusion,
  normalizeAeroDataBox, normalizeAviationstack, normalizeVessel,
  searchFlights, flightStatus, groundOptions, vesselPosition,
  __setFetch,
} from './flights.mjs';

// ── pure helpers ────────────────────────────────────────────────────────────────

test('cheapestOffer picks the lowest valid price, ignores unpriced', () => {
  const offers = [
    { id: 'a', price: 320, source: 'duffel' },
    { id: 'b', price: null, source: 'duffel' },
    { id: 'c', price: 199, source: 'travelpayouts' },
    { id: 'd', price: '250', source: 'duffel' },
  ];
  assert.equal(cheapestOffer(offers).id, 'c');
});

test('cheapestOffer returns null on empty / all-unpriced / non-array', () => {
  assert.equal(cheapestOffer([]), null);
  assert.equal(cheapestOffer([{ price: null }, { price: 'NaN' }]), null);
  assert.equal(cheapestOffer(null), null);
});

test('durationMinutes computes minutes and rejects bad input', () => {
  assert.equal(durationMinutes('2026-07-01T08:00:00Z', '2026-07-01T15:30:00Z'), 450);
  assert.equal(durationMinutes('not-a-date', '2026-07-01T15:30:00Z'), null);
  assert.equal(durationMinutes(null, null), null);
});

// ── normalizers ─────────────────────────────────────────────────────────────────

test('normalizeDuffel flattens slices/segments, tags source, drops unpriced', () => {
  const json = { data: { offers: [
    {
      id: 'off_1', total_amount: '412.50', total_currency: 'USD',
      owner: { name: 'British Airways' },
      slices: [{ segments: [
        { origin: { iata_code: 'JFK' }, destination: { iata_code: 'BOS' }, departing_at: '2026-07-01T08:00:00Z', arriving_at: '2026-07-01T09:30:00Z', marketing_carrier: { name: 'BA' } },
        { origin: { iata_code: 'BOS' }, destination: { iata_code: 'LHR' }, departing_at: '2026-07-01T11:00:00Z', arriving_at: '2026-07-01T22:00:00Z' },
      ] }],
    },
    { id: 'off_2', slices: [{ segments: [{ origin: { iata_code: 'JFK' }, destination: { iata_code: 'LHR' } }] }] }, // no price → dropped
  ] } };
  const out = normalizeDuffel(json);
  assert.equal(out.length, 1);
  const o = out[0];
  assert.equal(o.from, 'JFK');
  assert.equal(o.to, 'LHR');
  assert.equal(o.stops, 1);
  assert.equal(o.price, 412.5);
  assert.equal(o.carrier, 'British Airways');
  assert.equal(o.source, 'duffel');
  assert.equal(o.durationMin, durationMinutes('2026-07-01T08:00:00Z', '2026-07-01T22:00:00Z'));
});

test('normalizeTravelpayouts walks nested dest map and tags affiliate source', () => {
  const json = { data: { LHR: {
    0: { airline: 'BA', flight_number: 178, price: 305, departure_at: '2026-07-01T08:00:00Z', transfers: 0 },
    1: { airline: 'VS', flight_number: 4, price: null }, // dropped
  } } };
  const out = normalizeTravelpayouts(json, { from: 'JFK', to: 'LHR' });
  assert.equal(out.length, 1);
  assert.equal(out[0].price, 305);
  assert.equal(out[0].from, 'JFK');
  assert.equal(out[0].source, 'travelpayouts');
});

test('normalizeDistribusion normalizes ground connections with mode + price', () => {
  const json = { data: { connections: [
    { id: 'c1', mode: 'rail', departureStation: { name: 'Paris' }, arrivalStation: { name: 'Lyon' }, departureTime: '2026-07-01T10:00:00Z', arrivalTime: '2026-07-01T12:00:00Z', price: { amount: 49, currency: 'EUR' }, marketingCarrier: { name: 'SNCF' } },
  ] } };
  const out = normalizeDistribusion(json);
  assert.equal(out.length, 1);
  assert.equal(out[0].mode, 'rail');
  assert.equal(out[0].price, 49);
  assert.equal(out[0].durationMin, 120);
  assert.equal(out[0].source, 'distribusion');
});

test('normalizeAeroDataBox + normalizeAviationstack produce a common status shape', () => {
  const adb = normalizeAeroDataBox([{ number: 'BA178', status: 'Departed', airline: { name: 'British Airways' }, departure: { airport: { iata: 'JFK' }, scheduledTime: { utc: '2026-07-01T08:00:00Z' } }, arrival: { airport: { iata: 'LHR' } } }], 'BA178');
  assert.equal(adb.flightNo, 'BA178');
  assert.equal(adb.status, 'Departed');
  assert.equal(adb.from, 'JFK');
  assert.equal(adb.source, 'aerodatabox');

  const avs = normalizeAviationstack({ data: [{ flight: { iata: 'BA178' }, flight_status: 'active', airline: { name: 'British Airways' }, departure: { iata: 'JFK', scheduled: '2026-07-01T08:00:00Z' }, arrival: { iata: 'LHR' } }] }, 'BA178');
  assert.equal(avs.flightNo, 'BA178');
  assert.equal(avs.status, 'active');
  assert.equal(avs.source, 'aviationstack');
  assert.deepEqual(Object.keys(adb).sort(), Object.keys(avs).sort());
});

test('normalizeAeroDataBox / normalizeAviationstack return null on empty', () => {
  assert.equal(normalizeAeroDataBox([], 'X'), null);
  assert.equal(normalizeAviationstack({ data: [] }, 'X'), null);
});

test('normalizeVessel extracts lat/lon and tags source; null without position', () => {
  const json = { MetaData: { MMSI: 477553000, ShipName: 'EVER GIVEN ', time_utc: '2026-07-01T10:00:00Z' }, Message: { PositionReport: { Latitude: 30.02, Longitude: 32.58, Sog: 12.3, Cog: 145 } } };
  const v = normalizeVessel(json, 477553000);
  assert.equal(v.mmsi, 477553000);
  assert.equal(v.name, 'EVER GIVEN');
  assert.equal(v.lat, 30.02);
  assert.equal(v.sog, 12.3);
  assert.equal(v.source, 'aisstream');
  assert.equal(normalizeVessel({ MetaData: { MMSI: 1 } }, 1), null);
});

// ── soft-fail wiring (no keys / injected fetch) ──────────────────────────────────

test('exported APIs validate inputs and soft-fail to []/null', async () => {
  __setFetch(async () => { throw new Error('network must not be called'); });
  assert.deepEqual(await searchFlights({ from: '', to: 'LHR' }), []);
  assert.deepEqual(await groundOptions({ from: 'A' }), []);
  assert.equal(await flightStatus(''), null);
  assert.equal(await vesselPosition(''), null);
  __setFetch(null);
});

test('searchFlights uses Duffel with a key and falls back to Travelpayouts when empty', async () => {
  const prevDuffel = process.env.DUFFEL_KEY, prevTp = process.env.TRAVELPAYOUTS_KEY;
  process.env.DUFFEL_KEY = 'test-duffel';
  process.env.TRAVELPAYOUTS_KEY = 'test-tp';
  const calls = [];
  __setFetch(async (url) => {
    const u = String(url?.toString?.() ?? url);
    calls.push(u);
    if (u.includes('duffel.com')) return { ok: true, json: async () => ({ data: { offers: [] } }) }; // empty → fallback
    if (u.includes('travelpayouts.com')) return { ok: true, json: async () => ({ data: { CDG: { 0: { airline: 'AF', flight_number: 1, price: 222, departure_at: '2026-07-01T08:00:00Z' } } } }) };
    throw new Error('unexpected ' + u);
  });
  const offers = await searchFlights({ from: 'JFK', to: 'CDG', date: '2026-12-25' }); // unique key, avoid cache
  assert.equal(offers.length, 1);
  assert.equal(offers[0].source, 'travelpayouts');
  assert.equal(cheapestOffer(offers).price, 222);
  assert.ok(calls.some((c) => c.includes('duffel.com')), 'tried duffel first');
  assert.ok(calls.some((c) => c.includes('travelpayouts.com')), 'fell back');
  __setFetch(null);
  if (prevDuffel === undefined) delete process.env.DUFFEL_KEY; else process.env.DUFFEL_KEY = prevDuffel;
  if (prevTp === undefined) delete process.env.TRAVELPAYOUTS_KEY; else process.env.TRAVELPAYOUTS_KEY = prevTp;
});
