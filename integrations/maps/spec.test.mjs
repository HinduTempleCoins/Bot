// node --test integrations/maps/spec.test.mjs — the history-maps job format (offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatYear, yearAt, routeAt, parseRouteCsv, validateTerritories, validateJob } from './spec.mjs';

const here = (p) => new URL(p, import.meta.url);

test('formatYear: BC, AD below 1000, plain years after; no year 0', () => {
  assert.equal(formatYear(-334), '334 BC');
  assert.equal(formatYear(117), 'AD 117');
  assert.equal(formatYear(0), 'AD 1');
  assert.equal(formatYear(1453), '1453');
  assert.equal(formatYear(-0.4), '1 BC'); // August of 1 BC: fractional years belong to their floor
  assert.equal(formatYear(-217.42), '218 BC'); // July 218 BC, not "217 BC"
  assert.equal(formatYear(-218.75), '219 BC');
});

test('yearAt ticks linearly from first to last frame', () => {
  assert.equal(yearAt(0, 11, -336, -326), -336);
  assert.equal(yearAt(10, 11, -336, -326), -326);
  assert.equal(yearAt(5, 11, -336, -326), -331);
});

test('routeAt interpolates between dated waypoints and stops at the end', () => {
  const pts = [{ lat: 0, lon: 0, year: -336 }, { lat: 10, lon: 20, year: -334 }, { lat: 10, lon: 40, year: -330 }];
  assert.deepEqual(routeAt(pts, -340), { lat: 0, lon: 0, reached: 0, done: false, started: false });
  const mid = routeAt(pts, -335);
  assert.equal(mid.lat, 5); assert.equal(mid.lon, 10); assert.equal(mid.reached, 0);
  assert.equal(routeAt(pts, -332).lon, 30);
  assert.equal(routeAt(pts, -300).done, true);
});

test('route CSV: sample parses; bad rows fail with a clear message', () => {
  const pts = parseRouteCsv(readFileSync(here('./samples/route.csv'), 'utf8'));
  assert.equal(pts.length, 3);
  assert.equal(pts[1].year, -330.5);
  assert.throws(() => parseRouteCsv('label,lat,lon\nA,1,2'), /header must include year|at least 2/);
  assert.throws(() => parseRouteCsv('label,lat,lon,year\nA,1,2,-300\nB,1,2,-310'), /backwards/);
  assert.throws(() => parseRouteCsv('label,lat,lon,year\nA,95,2,-300\nB,1,2,-290'), /lat\/lon/);
  assert.equal(parseRouteCsv('label,lat,lon,year,note\n"Babylon, city",32,44,-331,"a, b"\nX,1,2,-330')[0].label, 'Babylon, city');
});

test('territories GeoJSON: sample validates; missing years / bad geometry / bad colour rejected', () => {
  const fc = JSON.parse(readFileSync(here('./samples/territories.geojson'), 'utf8'));
  assert.equal(validateTerritories(fc), 3);
  const bad = (mut) => { const c = structuredClone(fc); mut(c.features[0]); return () => validateTerritories(c); };
  assert.throws(bad((f) => { delete f.properties.fromYear; }), /fromYear\/toYear/);
  assert.throws(bad((f) => { f.geometry = { type: 'Point', coordinates: [1, 2] }; }), /Polygon or MultiPolygon/);
  assert.throws(bad((f) => { f.geometry.coordinates = [[[0, 0], [1, 1]]]; }), /invalid coordinates/);
  assert.throws(bad((f) => { f.properties.colour = 'red'; }), /#rrggbb/);
  assert.throws(() => validateTerritories({ type: 'FeatureCollection', features: [] }), /no features/);
});

test('validateJob: sample job and every shipped clip job are valid; bad jobs fail clearly', () => {
  const sample = JSON.parse(readFileSync(here('./samples/job.json'), 'utf8'));
  assert.equal(validateJob(sample).fps, 24);
  for (const id of ['alexander-campaign', 'rome', 'china', 'world', 'kush-nubia', 'hannibal']) {
    const j = JSON.parse(readFileSync(here(`./clips/${id}.json`), 'utf8'));
    assert.equal(validateJob(j).title, j.title, id);
  }
  assert.throws(() => validateJob({ ...sample, bbox: [10, 10, 5, 20] }), /bbox/);
  assert.throws(() => validateJob({ ...sample, years: [-100, -500] }), /years/);
  assert.throws(() => validateJob({ ...sample, size: [1281, 720] }), /even/);
  assert.throws(() => validateJob({ ...sample, duration: 1000 }), /duration/);
  assert.throws(() => validateJob({ ...sample, territories: { source: 'somewhere' } }), /source/);
  assert.throws(() => validateJob({ ...sample, territories: undefined, routes: [] }), /territories and\/or routes/);
  assert.throws(() => validateJob({ ...sample, projection: 'mercator' }), /projection/);
});

test('route stops: validated in time order, media normalised, kinds checked; the sample job with stops passes', async () => {
  const { validateStops } = await import('./spec.mjs');
  const years = [-219, -201];
  const ok = validateStops([
    { label: 'Rhône crossing', lat: 43.9, lon: 4.6, year: -217.33, media: ['remakes/rhone.png', { src: 'https://example.org/a.jpg', credit: 'PD' }], kind: 'record', source: 'Polybius 3.42–46' },
    { label: 'Cannae', lat: 41.3, lon: 16.1, year: -215.41, date: '2 August 216 BC', hold: 20, kind: 'record' },
  ], years);
  assert.equal(ok[0].media[0].src, 'remakes/rhone.png');
  assert.equal(ok[0].hold, 12);
  assert.equal(ok[0].date, '218 BC');
  assert.equal(ok[1].date, '2 August 216 BC');
  assert.throws(() => validateStops([{ label: 'B', lat: 1, lon: 1, year: -210 }, { label: 'A', lat: 1, lon: 1, year: -215 }], years), /time order/);
  assert.throws(() => validateStops([{ label: 'X', lat: 1, lon: 1, year: -100 }], years), /within the job's years/);
  assert.throws(() => validateStops([{ label: 'X', lat: 1, lon: 1, year: -210, kind: 'maybe' }], years), /kind must be/);
  assert.throws(() => validateStops([{ label: 'X', lat: 1, lon: 1, year: -210, media: ['../../etc/passwd'] }], years), /'\.\.'/);
  assert.throws(() => validateStops([{ label: 'X', lat: 1, lon: 1, year: -210, hold: 900 }], years), /hold/);
  assert.equal(validateStops([{ label: 'X', lat: 1, lon: 1, year: -210, media: ['remake:hannibal_alps_poussin/1_real_punic.png'] }], years)[0].media[0].src, 'remake:hannibal_alps_poussin/1_real_punic.png');
  assert.throws(() => validateStops([{ label: 'X', lat: 1, lon: 1, year: -210, media: ['remake:../../etc/passwd'] }], years), /'\.\.'/);
  assert.throws(() => validateStops([{ label: 'X', lat: 1, lon: 1, year: -210, media: ['library:/etc/passwd'] }], years), /'\.\.'/);
  const job = JSON.parse(readFileSync(here('./samples/job-stops.json'), 'utf8'));
  const { validateJob } = await import('./spec.mjs');
  assert.equal(validateJob(job).stops.length, 3);
});
