// noaa-climate.test.mjs — offline tests for the NOAA CO-OPS / CPC reader.
// All network calls are stubbed via __setFetch with canned NOAA JSON; no live calls, no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tides, waterLevel, climateOutlook, STATIONS, renderPage, dataNote,
  normalizePrediction, normalizeWaterLevel, normalizeOutlook, normalizeLean, tideType,
  __setFetch,
} from './noaa-climate.mjs';

// canned-response fetch builder: returns an ok JSON response.
function jsonFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function throwingFetch() {
  return async () => { throw new Error('network down'); };
}

test('tides normalizes canned hilo predictions', async () => {
  __setFetch(jsonFetch({
    predictions: [
      { t: '2026-06-03 03:24', v: '4.521', type: 'H' },
      { t: '2026-06-03 09:50', v: '0.118', type: 'L' },
      { t: '2026-06-03 15:40', v: '5.002', type: 'h' }, // lowercase still valid
      { t: '2026-06-03 22:10', v: 'NaN', type: 'L' },     // bad height → dropped
    ],
  }));
  const rows = await tides({ station: '8518750', days: 1 });
  __setFetch(null);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { time: '2026-06-03 03:24', type: 'H', heightFt: 4.521 });
  assert.equal(rows[1].type, 'L');
  assert.equal(rows[2].type, 'H'); // lowercase 'h' normalized to 'H'
});

test('tides soft-fails to [] on network error', async () => {
  __setFetch(throwingFetch());
  const rows = await tides({ station: '8518750' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('tides soft-fails to [] with no station', async () => {
  const rows = await tides({});
  assert.deepEqual(rows, []);
});

test('waterLevel returns the latest observed reading', async () => {
  __setFetch(jsonFetch({
    data: [
      { t: '2026-06-03 11:00', v: '2.100' },
      { t: '2026-06-03 11:06', v: '2.140' },
      { t: '2026-06-03 11:12', v: '2.215' }, // latest
    ],
  }));
  const w = await waterLevel({ station: '8518750' });
  __setFetch(null);
  assert.equal(w.heightFt, 2.215);
  assert.equal(w.time, '2026-06-03 11:12');
  assert.equal(w.station, '8518750');
  assert.equal(w.name, 'The Battery, NY'); // resolved from STATIONS
});

test('waterLevel soft-fails to null on error', async () => {
  __setFetch(throwingFetch());
  const w = await waterLevel({ station: '8518750' });
  __setFetch(null);
  assert.equal(w, null);
});

test('STATIONS has curated 7-digit-ish ids with names', () => {
  assert.ok(Array.isArray(STATIONS));
  assert.ok(STATIONS.length >= 4);
  for (const s of STATIONS) {
    assert.ok(/^\d{7}$/.test(s.id), `station id ${s.id} should be 7 digits`);
    assert.ok(typeof s.name === 'string' && s.name.length > 0);
  }
  assert.ok(STATIONS.some((s) => s.id === '8518750'));
});

test('climateOutlook normalizes a canned CPC response', async () => {
  __setFetch(jsonFetch({
    outlook: { period: 'JJA 2026', temp: 'Above', precip: 'below', probability: '40%' },
  }));
  const o = await climateOutlook();
  __setFetch(null);
  assert.equal(o.period, 'JJA 2026');
  assert.equal(o.tempLean, 'above');
  assert.equal(o.precipLean, 'below');
  assert.equal(o.confidence, '40%');
});

test('climateOutlook soft-fails to null on error', async () => {
  __setFetch(throwingFetch());
  const o = await climateOutlook();
  __setFetch(null);
  assert.equal(o, null);
});

test('renderPage escapes a malicious station name', () => {
  const html = renderPage({
    name: '<script>alert(1)</script>',
    tides: [{ time: '2026-06-03 03:24', type: 'H', heightFt: 4.5 }],
    water: { time: '2026-06-03 11:12', heightFt: 2.2 },
    outlook: { period: 'JJA 2026', tempLean: 'above', precipLean: 'below' },
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('High'));
  assert.ok(html.includes('source: NOAA'));
});

test('renderPage handles missing data without throwing', () => {
  const html = renderPage({});
  assert.ok(html.includes('unavailable'));
  assert.ok(html.includes('</section>'));
});

test('dataNote has source + as-of date', () => {
  const n = dataNote();
  assert.match(n, /source: NOAA CO-OPS \/ CPC/);
  assert.match(n, /as of \d{4}-\d{2}-\d{2}/);
});

// ---- pure helper coverage ----

test('tideType normalizes H/L and rejects garbage', () => {
  assert.equal(tideType('h'), 'H');
  assert.equal(tideType('L'), 'L');
  assert.equal(tideType('X'), null);
  assert.equal(tideType(''), null);
});

test('normalizePrediction rejects unusable rows', () => {
  assert.equal(normalizePrediction(null), null);
  assert.equal(normalizePrediction({ t: 'x', type: 'H' }), null); // no height
  assert.equal(normalizePrediction({ v: '1.0', type: 'H' }), null); // no time
});

test('normalizeWaterLevel takes the latest usable reading', () => {
  assert.equal(normalizeWaterLevel({ data: [] }), null);
  const w = normalizeWaterLevel({ data: [{ t: 'a', v: '1' }, { t: 'b', v: 'bad' }] });
  assert.equal(w.time, 'a'); // 'b' unusable → falls back to 'a'
});

test('normalizeLean maps to stable vocabulary', () => {
  assert.equal(normalizeLean('Above'), 'above');
  assert.equal(normalizeLean('cool'), 'below');
  assert.equal(normalizeLean(''), 'near-normal');
  assert.equal(normalizeLean('whatever'), 'near-normal');
});

test('normalizeOutlook returns null with no lean fields', () => {
  assert.equal(normalizeOutlook({ period: 'x' }), null);
});
