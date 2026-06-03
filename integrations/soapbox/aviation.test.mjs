// aviation.test.mjs — offline tests with injected fetch. Run:
//   node --test integrations/soapbox/aviation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  flightsInArea, airportStatus, airportStatuses, majorAirports, summary,
  renderPage, dataNote, __setFetch, normalizeState, isDelayed, esc,
} from './aviation.mjs';

// ── canned OpenSky /states/all payload (POSITIONAL array shape) ─────────────────────────────────────
// index: 0 icao24, 1 callsign, 2 country, 3 time_pos, 4 last_contact, 5 lon, 6 lat,
//        7 baro_alt, 8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate
const OPENSKY = {
  time: 1717000000,
  states: [
    ['abc123', 'DAL123  ', 'United States', 1717000000, 1717000000, -83.5, 37.2, 10668, false, 240.5, 270, 0],
    ['def456', 'UAL456  ', 'United States', 1717000000, 1717000000, -82.1, 38.9, 0, true, 0, 90, 0],
    ['ghi789', 'NODATA  ', 'Canada', 1717000000, 1717000000, null, null, 9000, false, 200, 180, 0], // no position → dropped
  ],
};

// ── canned FAA ASWS airport-status payloads ─────────────────────────────────────────────────────────
const FAA_DELAYED = {
  IATA: 'EWR', Name: 'Newark Liberty International',
  Delay: true,
  Status: { Type: 'Ground Delay', Reason: 'low ceilings / weather', AvgDelay: '1 hour and 15 minutes' },
  Weather: { Weather: [{ Temp: ['54.0 F (12.2 C)'] }] },
};
const FAA_NORMAL = {
  IATA: 'ATL', Name: 'Hartsfield-Jackson Atlanta International',
  Delay: false,
  Status: { Type: 'Normal', Reason: null },
  Weather: { Temp: ['72.0 F (22.2 C)'] },
};

// helpers to build a fake fetch
const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const fail = () => async () => { throw new Error('network down'); };
const notOk = () => async () => ({ ok: false, status: 503, json: async () => ({}) });
const reset = () => __setFetch(null);

// ── flightsInArea ───────────────────────────────────────────────────────────────────────────────────

test('flightsInArea parses the OpenSky positional states array', async () => {
  __setFetch(okJson(OPENSKY));
  const f = await flightsInArea({ lamin: 36, lomin: -84, lamax: 40, lomax: -80 });
  reset();
  assert.equal(f.length, 2); // third row has no lat/lon → dropped
  assert.equal(f[0].callsign, 'DAL123'); // trimmed
  assert.equal(f[0].country, 'United States');
  assert.equal(f[0].lat, 37.2);
  assert.equal(f[0].lon, -83.5);
  assert.equal(f[0].altitudeM, 10668);
  assert.equal(f[0].velocityMs, 240.5);
  assert.equal(f[0].onGround, false);
  assert.equal(f[1].onGround, true);
});

test('flightsInArea soft-fails to [] on network error / bad response / bad box', async () => {
  __setFetch(fail());
  assert.deepEqual(await flightsInArea({ lamin: 36, lomin: -84, lamax: 40, lomax: -80 }), []);
  __setFetch(notOk());
  assert.deepEqual(await flightsInArea({ lamin: 36, lomin: -84, lamax: 40, lomax: -80 }), []);
  reset();
  // missing coordinates → [] without a fetch
  assert.deepEqual(await flightsInArea({}), []);
});

test('normalizeState handles a positional row and rejects positionless rows', () => {
  assert.equal(normalizeState(['x', 'AAL9 ', 'US', 0, 0, -80, 40, 1000, false, 100]).callsign, 'AAL9');
  assert.equal(normalizeState(['x', 'AAL9', 'US', 0, 0, null, null]), null);
  assert.equal(normalizeState(null), null);
});

// ── airportStatus ─────────────────────────────────────────────────────────────────────────────────────

test('airportStatus normalizes a canned FAA delayed response', async () => {
  __setFetch(okJson(FAA_DELAYED));
  const s = await airportStatus('ewr');
  reset();
  assert.equal(s.airport, 'EWR');
  assert.equal(s.delay, true);
  assert.equal(s.reason, 'low ceilings / weather');
  assert.equal(s.weather, '54.0 F (12.2 C)');
  assert.ok(/ground delay/i.test(s.status));
});

test('airportStatus marks a normal airport as not delayed', async () => {
  __setFetch(okJson(FAA_NORMAL));
  const s = await airportStatus('ATL');
  reset();
  assert.equal(s.airport, 'ATL');
  assert.equal(s.delay, false);
});

test('airportStatus soft-fails to null on error / bad response / empty code', async () => {
  __setFetch(fail());
  assert.equal(await airportStatus('ATL'), null);
  __setFetch(notOk());
  assert.equal(await airportStatus('ATL'), null);
  reset();
  assert.equal(await airportStatus(''), null);
});

test('isDelayed treats explicit flag and non-normal status types as delayed', () => {
  assert.equal(isDelayed({ Delay: true }), true);
  assert.equal(isDelayed({ Status: { Type: 'Ground Stop' } }), true);
  assert.equal(isDelayed({ Status: { Type: 'Normal' } }), false);
  assert.equal(isDelayed({}), false);
  assert.equal(isDelayed(null), false);
});

// ── majorAirports ─────────────────────────────────────────────────────────────────────────────────────

test('majorAirports includes ATL/LAX/JFK', () => {
  const codes = majorAirports().map((a) => a.iata);
  for (const c of ['ATL', 'LAX', 'JFK']) assert.ok(codes.includes(c), `missing ${c}`);
  assert.ok(majorAirports().every((a) => a.iata && a.name));
});

test('airportStatuses sweeps a list and drops nulls', async () => {
  // delayed for EWR, normal otherwise
  __setFetch(async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('/EWR') ? FAA_DELAYED : FAA_NORMAL),
  }));
  const rows = await airportStatuses(['EWR', 'ATL']);
  reset();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.airport === 'EWR').delay, true);
});

// ── summary ───────────────────────────────────────────────────────────────────────────────────────────

test('summary counts flights and delayed airports', () => {
  const s = summary({
    flights: [{ callsign: 'A' }, { callsign: 'B' }],
    airports: [{ airport: 'EWR', delay: true }, { airport: 'ATL', delay: false }, { airport: 'BOS', delay: true }],
  });
  assert.equal(s.flightCount, 2);
  assert.equal(s.airportCount, 3);
  assert.equal(s.delayedCount, 2);
  assert.deepEqual(s.delayed.sort(), ['BOS', 'EWR']);
  assert.ok(s.asOf);
});

// ── renderPage / dataNote ─────────────────────────────────────────────────────────────────────────────

test('renderPage escapes a malicious callsign', () => {
  const html = renderPage({
    flights: [{ callsign: '<script>alert(1)</script>', country: 'X', lat: 1, lon: 2 }],
    airports: [{ airport: '"><img>', status: 'Normal', delay: false }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('"><img>'));
});

test('dataNote names OpenSky + FAA with an as-of date', () => {
  const n = dataNote('2026-06-03T00:00:00Z');
  assert.ok(/OpenSky/.test(n));
  assert.ok(/FAA/.test(n));
  assert.ok(/2026-06-03/.test(n));
});

test('esc escapes the five HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

// ── secrets hygiene ───────────────────────────────────────────────────────────────────────────────────

test('OpenSky credentials are referenced by env NAME only (no literal secret)', () => {
  const src = readFileSync(fileURLToPath(new URL('./aviation.mjs', import.meta.url)), 'utf8');
  assert.ok(src.includes('OPENSKY_USERNAME'));
  assert.ok(src.includes('OPENSKY_PASSWORD'));
  assert.ok(src.includes('process.env['));
  // no hard-coded basic-auth literal or inline password
  assert.ok(!/Authorization['"]?\s*[:=]\s*['"]Basic [A-Za-z0-9+/=]{8,}/.test(src));
});
