import { test } from 'node:test';
import assert from 'node:assert';
import {
  alertSeverityScore, alertTier, weatherCodeLabel, cToF, normalizeCoords,
  normalizeAlert, normalizeOpenMeteo,
  forecast, activeAlerts, weatherSummary, __setFetch,
} from './weather.mjs';

// ---- pure helpers (offline) ----

test('alertSeverityScore ranks Extreme > Severe > Moderate > Minor > unknown', () => {
  assert.ok(alertSeverityScore('Extreme') > alertSeverityScore('Severe'));
  assert.ok(alertSeverityScore('Severe') > alertSeverityScore('Moderate'));
  assert.ok(alertSeverityScore('Moderate') > alertSeverityScore('Minor'));
  assert.ok(alertSeverityScore('Minor') > alertSeverityScore('Whatever'));
  assert.equal(alertSeverityScore(null), 10);
  assert.equal(alertSeverityScore('SEVERE'), alertSeverityScore('severe')); // case-insensitive
});

test('alertTier buckets by score', () => {
  assert.equal(alertTier(90), 'critical');
  assert.equal(alertTier(65), 'high');
  assert.equal(alertTier(40), 'med');
  assert.equal(alertTier(10), 'low');
});

test('weatherCodeLabel maps WMO codes and handles unknowns', () => {
  assert.equal(weatherCodeLabel(0), 'Clear');
  assert.equal(weatherCodeLabel(95), 'Thunderstorm');
  assert.equal(weatherCodeLabel(123), 'Code 123');
  assert.equal(weatherCodeLabel('x'), 'Unknown');
});

test('cToF converts and is null-safe', () => {
  assert.equal(cToF(0), 32);
  assert.equal(cToF(100), 212);
  assert.equal(cToF(37), 99);
  assert.equal(cToF(null), null);
  assert.equal(cToF('nope'), null);
});

test('normalizeCoords validates range and type', () => {
  assert.deepEqual(normalizeCoords({ lat: 40.71, lon: -74.01 }), { lat: 40.71, lon: -74.01 });
  assert.deepEqual(normalizeCoords({ lat: '40', lon: '-74' }), { lat: 40, lon: -74 }); // coerces strings
  assert.equal(normalizeCoords({ lat: 91, lon: 0 }), null); // lat out of range
  assert.equal(normalizeCoords({ lat: 0, lon: 200 }), null); // lon out of range
  assert.equal(normalizeCoords({ lat: 'x', lon: 0 }), null); // non-numeric
  assert.equal(normalizeCoords(), null);
});

test('normalizeAlert flattens a GeoJSON feature and scores it', () => {
  const feat = {
    id: 'urn:oid:1.2.3',
    properties: {
      event: 'Tornado Warning', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed',
      areaDesc: 'Dallas, TX; Tarrant, TX', headline: 'Take cover', sent: 's', expires: 'e',
    },
  };
  const a = normalizeAlert(feat);
  assert.equal(a.event, 'Tornado Warning');
  assert.equal(a.area, 'Dallas, TX'); // first area only
  assert.equal(a.severity, 'Extreme');
  assert.equal(a.score, 90);
  assert.equal(a.tier, 'critical');
  assert.equal(normalizeAlert({}), null);
  assert.equal(normalizeAlert(null), null);
});

test('normalizeOpenMeteo handles both current and current_weather shapes', () => {
  const a = normalizeOpenMeteo({ current: { temperature_2m: 20, weather_code: 3, wind_speed_10m: 12, time: 't' } }, { lat: 1, lon: 2 });
  assert.equal(a.tempC, 20);
  assert.equal(a.tempF, 68);
  assert.equal(a.summary, 'Overcast');
  assert.equal(a.windKph, 12);
  assert.equal(a.lat, 1);

  const b = normalizeOpenMeteo({ latitude: 5, longitude: 6, current_weather: { temperature: 0, weathercode: 0, windspeed: 5, time: 't' } });
  assert.equal(b.tempC, 0);
  assert.equal(b.tempF, 32);
  assert.equal(b.summary, 'Clear');
  assert.equal(b.lat, 5);

  assert.equal(normalizeOpenMeteo({}), null);
  assert.equal(normalizeOpenMeteo(null), null);
});

// ---- soft-fail + fetch injection (offline, never hits the network) ----

test('forecast returns null for bad coords without fetching', async () => {
  let called = false;
  __setFetch(() => { called = true; throw new Error('should not be called'); });
  const r = await forecast({ lat: 999, lon: 0 });
  assert.equal(r, null);
  assert.equal(called, false);
  __setFetch(null);
});

test('forecast parses an injected Open-Meteo response', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ latitude: 40.71, longitude: -74.01, current: { temperature_2m: 25, weather_code: 61, wind_speed_10m: 8 } }) }));
  const r = await forecast({ lat: 40.71, lon: -74.01 });
  assert.equal(r.summary, 'Light rain');
  assert.equal(r.tempF, 77);
  __setFetch(null);
});

test('forecast soft-fails to null on fetch throw', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await forecast({ lat: 0, lon: 0 });
  assert.equal(r, null);
  __setFetch(null);
});

test('activeAlerts normalizes + sorts by score desc, [] on failure', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ features: [
    { id: '1', properties: { event: 'Flood Watch', severity: 'Moderate', areaDesc: 'A' } },
    { id: '2', properties: { event: 'Tornado Warning', severity: 'Extreme', areaDesc: 'B' } },
  ] }) }));
  const out = await activeAlerts({ area: 'TX' });
  assert.equal(out.length, 2);
  assert.equal(out[0].event, 'Tornado Warning', 'highest severity first');
  assert.equal(out[1].event, 'Flood Watch');
  __setFetch(null);
});

test('activeAlerts returns [] when fetch fails (never throws)', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await activeAlerts({ area: 'TX' }), []);
  __setFetch(async () => { throw new Error('boom'); });
  assert.deepEqual(await activeAlerts({}), []);
  __setFetch(null);
});

test('weatherSummary combines forecast + alerts, caps alert list', async () => {
  __setFetch(async (url) => {
    if (String(url).includes('open-meteo')) {
      return { ok: true, json: async () => ({ current: { temperature_2m: 10, weather_code: 0, wind_speed_10m: 3 } }) };
    }
    return { ok: true, json: async () => ({ features: [
      { id: 'a', properties: { event: 'Heat Advisory', severity: 'Minor', areaDesc: 'X' } },
      { id: 'b', properties: { event: 'Hurricane Warning', severity: 'Extreme', areaDesc: 'Y' } },
      { id: 'c', properties: { event: 'Wind Advisory', severity: 'Moderate', areaDesc: 'Z' } },
    ] }) };
  });
  const s = await weatherSummary({ lat: 25.76, lon: -80.19, maxAlerts: 2 });
  assert.equal(s.forecast.summary, 'Clear');
  assert.equal(s.alertCount, 3);
  assert.equal(s.alerts.length, 2, 'capped to maxAlerts');
  assert.equal(s.worst.event, 'Hurricane Warning');
  __setFetch(null);
});

test('weatherSummary returns null for bad coords', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  assert.equal(await weatherSummary({ lat: 'bad', lon: 0 }), null);
  __setFetch(null);
});
