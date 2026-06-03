// usgs-hazards.test.mjs — offline tests with injected fetch. Run:
//   node --test integrations/soapbox/usgs-hazards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  earthquakes, recentSignificant, volcanoes, hazardSummary, renderPage, dataNote,
  __setFetch, volcanoSeverity, isElevatedVolcano, haversineKm, normalizeQuake, esc,
} from './usgs-hazards.mjs';

// ── canned USGS payloads ──────────────────────────────────────────────────────────────────────────
const QUAKE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { mag: 6.2, place: '12km NE of Ridgecrest, CA', time: 1717000000000, url: 'https://earthquake.usgs.gov/eq/x1' },
      geometry: { type: 'Point', coordinates: [-117.6, 35.7, 8.5] },
    },
    {
      type: 'Feature',
      properties: { mag: 4.1, place: '5km S of Somewhere', time: 1717000100000, url: 'https://earthquake.usgs.gov/eq/x2' },
      geometry: { type: 'Point', coordinates: [-118.2, 34.1, 12.0] },
    },
  ],
};

const SIG_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { mag: 7.4, place: 'offshore Big Place', time: 1716000000000, url: 'https://earthquake.usgs.gov/eq/sig1' },
      geometry: { type: 'Point', coordinates: [140.1, 38.2, 25.0] },
    },
  ],
};

const VOLCANO_PAYLOAD = [
  { volcano_name: 'Kilauea', alert_level: 'WATCH', color_code: 'ORANGE' },
  { volcano_name: 'Mount St. Helens', alert_level: 'ADVISORY', color_code: 'YELLOW' },
  { volcano_name: 'Sleepy Cone', alert_level: 'NORMAL', color_code: 'GREEN' },
];

function fetchReturning(json, { ok = true } = {}) {
  return async () => ({ ok, json: async () => json });
}
function fetchThrows() {
  return async () => { throw new Error('network down'); };
}

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────────
test('volcanoSeverity ranks WARNING > WATCH > ADVISORY > NORMAL', () => {
  assert.ok(volcanoSeverity('WARNING') > volcanoSeverity('WATCH'));
  assert.ok(volcanoSeverity('WATCH') > volcanoSeverity('ADVISORY'));
  assert.ok(volcanoSeverity('ADVISORY') > volcanoSeverity('NORMAL'));
  assert.equal(volcanoSeverity('UNASSIGNED'), 0);
});

test('isElevatedVolcano excludes NORMAL/unknown', () => {
  assert.ok(isElevatedVolcano('watch'));
  assert.ok(!isElevatedVolcano('NORMAL'));
  assert.ok(!isElevatedVolcano(''));
});

test('haversineKm gives a sane distance and null on bad input', () => {
  const d = haversineKm(34.05, -118.24, 35.7, -117.6); // LA → Ridgecrest area, a couple hundred km
  assert.ok(d > 100 && d < 400, `unexpected distance ${d}`);
  assert.equal(haversineKm(null, 0, 1, 1), null);
});

test('normalizeQuake maps geometry to depth/lat/lon', () => {
  const q = normalizeQuake(QUAKE_GEOJSON.features[0]);
  assert.equal(q.mag, 6.2);
  assert.equal(q.depthKm, 8.5);
  assert.equal(q.lon, -117.6);
  assert.equal(q.lat, 35.7);
  assert.ok(q.time.startsWith('20'));
});

// ── earthquakes ───────────────────────────────────────────────────────────────────────────────────
test('earthquakes parses canned geojson features sorted by magnitude', async () => {
  __setFetch(fetchReturning(QUAKE_GEOJSON));
  const rows = await earthquakes({ minMagnitude: 2.5 });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mag, 6.2); // sorted desc
  assert.equal(rows[0].place, '12km NE of Ridgecrest, CA');
  assert.equal(rows[1].mag, 4.1);
});

test('earthquakes soft-fails to [] on throw', async () => {
  __setFetch(fetchThrows());
  const rows = await earthquakes({});
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('earthquakes soft-fails to [] on non-ok response', async () => {
  __setFetch(fetchReturning({}, { ok: false }));
  const rows = await earthquakes({});
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── recentSignificant ─────────────────────────────────────────────────────────────────────────────
test('recentSignificant returns the summary feed normalized', async () => {
  __setFetch(fetchReturning(SIG_GEOJSON));
  const rows = await recentSignificant();
  __setFetch(null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mag, 7.4);
  assert.equal(rows[0].place, 'offshore Big Place');
});

test('recentSignificant soft-fails to [] on throw', async () => {
  __setFetch(fetchThrows());
  const rows = await recentSignificant();
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── volcanoes ─────────────────────────────────────────────────────────────────────────────────────
test('volcanoes normalizes alert levels and sorts by severity', async () => {
  __setFetch(fetchReturning(VOLCANO_PAYLOAD));
  const rows = await volcanoes();
  __setFetch(null);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, 'Kilauea'); // WATCH outranks ADVISORY/NORMAL
  assert.equal(rows[0].alertLevel, 'WATCH');
  assert.equal(rows[0].colorCode, 'ORANGE');
});

test('volcanoes elevatedOnly drops NORMAL', async () => {
  __setFetch(fetchReturning(VOLCANO_PAYLOAD));
  const rows = await volcanoes({ elevatedOnly: true });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((v) => v.alertLevel !== 'NORMAL'));
});

test('volcanoes tolerates {items:[...]} envelope and soft-fails on throw', async () => {
  __setFetch(fetchReturning({ items: VOLCANO_PAYLOAD }));
  let rows = await volcanoes();
  assert.equal(rows.length, 3);
  __setFetch(fetchThrows());
  rows = await volcanoes();
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── hazardSummary ─────────────────────────────────────────────────────────────────────────────────
test('hazardSummary combines nearby quakes + elevated volcanoes', async () => {
  // one fetch impl that returns quakes for the FDSN URL, volcanoes for the HANS URL
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('fdsnws/event')) return { ok: true, json: async () => QUAKE_GEOJSON };
    if (u.includes('volcano')) return { ok: true, json: async () => VOLCANO_PAYLOAD };
    return { ok: false, json: async () => ({}) };
  });
  const s = await hazardSummary({ lat: 34.05, lon: -118.24, radiusKm: 500 });
  __setFetch(null);
  assert.ok(s.quakeCount >= 1);
  assert.equal(s.elevatedVolcanoCount, 2); // NORMAL dropped
  assert.ok(s.worstQuake);
  assert.ok(s.quakes.every((q) => q.distanceKm == null || q.distanceKm <= 500));
  assert.ok(s.asOf.startsWith('20'));
});

test('hazardSummary soft-fails halves independently', async () => {
  __setFetch(fetchThrows());
  const s = await hazardSummary({ lat: 1, lon: 1 });
  __setFetch(null);
  assert.deepEqual(s.quakes, []);
  assert.deepEqual(s.volcanoes, []);
  assert.equal(s.quakeCount, 0);
});

// ── renderPage escaping ───────────────────────────────────────────────────────────────────────────
test('renderPage escapes a malicious place name', () => {
  const html = renderPage({
    lat: 1, lon: 2, radiusKm: 100, asOf: '2026-06-03T00:00:00.000Z',
    quakes: [{ mag: 5.0, place: '<script>alert(1)</script>', depthKm: 3, distanceKm: 10, url: 'https://x/"onmouseover="y' }],
    volcanoes: [{ name: '<img src=x onerror=z>', alertLevel: 'WATCH', colorCode: 'ORANGE' }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<img src=x onerror=z>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('"onmouseover="')); // url quote escaped
});

test('renderPage shows empty states without throwing', () => {
  const html = renderPage({});
  assert.ok(html.includes('No recent earthquakes'));
  assert.ok(html.includes('No elevated volcano alerts'));
});

// ── dataNote ──────────────────────────────────────────────────────────────────────────────────────
test('dataNote names USGS + an as-of date', () => {
  const note = dataNote('2026-06-03T12:00:00.000Z');
  assert.match(note, /USGS/);
  assert.match(note, /as of 2026-06-03/);
});

test('esc handles all five entities', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
