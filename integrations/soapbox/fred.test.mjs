// fred.test.mjs — OFFLINE guards for the SoapBox FRED economic-series reader. Fake fetch only; asserts
// observation normalization + soft-fail (incl. no-key) + latest change + dashboard assembly + curated
// SERIES map + HTML escaping + FRED named in dataNote + key read by env NAME (no literal). No network.
// Run: node --test integrations/soapbox/fred.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, series, SERIES, latest, dashboard, renderPage, dataNote,
} from './fred.mjs';

// minimal Response-like stub
const res = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// canned FRED /series/observations payload (oldest → newest, incl. a "." sentinel that must be dropped)
const fredPayload = (obs) => ({
  realtime_start: '2026-06-03',
  realtime_end: '2026-06-03',
  observation_start: '1776-07-04',
  observation_end: '9999-12-31',
  units: 'lin',
  observations: obs,
});

const UNRATE_OBS = [
  { date: '2026-03-01', value: '4.1' },
  { date: '2026-04-01', value: '.' },   // sentinel — must be dropped
  { date: '2026-05-01', value: '4.3' },
];

const restore = () => { __setFetch(null); delete process.env.FRED_API_KEY; };

test('series() normalizes observations and drops the "." sentinel', async () => {
  process.env.FRED_API_KEY = 'unit-test-key';
  __setFetch(async (url) => {
    assert.match(String(url), /api\.stlouisfed\.org\/fred\/series\/observations/);
    return res(fredPayload(UNRATE_OBS));
  });
  const obs = await series('UNRATE');
  assert.deepEqual(obs, [
    { date: '2026-03-01', value: 4.1 },
    { date: '2026-05-01', value: 4.3 },
  ]);
  restore();
});

test('series() soft-fails to [] on a not-ok response', async () => {
  process.env.FRED_API_KEY = 'unit-test-key';
  __setFetch(async () => res({}, false));
  assert.deepEqual(await series('UNRATE'), []);
  restore();
});

test('series() soft-fails to [] when NO key is set (without hitting the network)', async () => {
  delete process.env.FRED_API_KEY;
  let called = false;
  __setFetch(async () => { called = true; return res(fredPayload(UNRATE_OBS)); });
  const obs = await series('UNRATE');
  assert.deepEqual(obs, []);
  assert.equal(called, false, 'no key → no fetch attempted');
  restore();
});

test('latest() returns the most-recent value + change from the prior observation', async () => {
  process.env.FRED_API_KEY = 'unit-test-key';
  __setFetch(async () => res(fredPayload(UNRATE_OBS)));
  const lat = await latest('UNRATE');
  assert.equal(lat.value, 4.3);
  assert.equal(lat.date, '2026-05-01');
  assert.equal(lat.change, Math.round((4.3 - 4.1) * 1000) / 1000); // 0.2
  assert.equal(lat.prevValue, 4.1);
  assert.equal(lat.unit, '%');
  restore();
});

test('latest() soft-fails to null when there is no data', async () => {
  process.env.FRED_API_KEY = 'unit-test-key';
  __setFetch(async () => res(fredPayload([])));
  assert.equal(await latest('UNRATE'), null);
  restore();
});

test('dashboard() assembles latest values for the curated series', async () => {
  process.env.FRED_API_KEY = 'unit-test-key';
  // route per series_id so each curated entry gets a distinct value
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('series_id=DFF')) return res(fredPayload([{ date: '2026-05-01', value: '5.0' }, { date: '2026-05-02', value: '5.25' }]));
    if (u.includes('series_id=UNRATE')) return res(fredPayload(UNRATE_OBS));
    if (u.includes('series_id=CPIAUCSL')) return res(fredPayload([{ date: '2026-05-01', value: '310.2' }]));
    // everything else: usable single point
    return res(fredPayload([{ date: '2026-05-01', value: '1.0' }]));
  });
  const dash = await dashboard();
  assert.ok(Array.isArray(dash.items));
  assert.equal(dash.items.length, Object.keys(SERIES).length);
  const fedFunds = dash.items.find((i) => i.name === 'Fed Funds Rate');
  assert.equal(fedFunds.value, 5.25);
  assert.equal(fedFunds.change, 0.25);
  const unemp = dash.items.find((i) => i.name === 'Unemployment');
  assert.equal(unemp.value, 4.3);
  restore();
});

test('dashboard() shows n/a rows when a source soft-fails (no throw)', async () => {
  process.env.FRED_API_KEY = 'unit-test-key';
  __setFetch(async () => res({}, false)); // every source dead
  const dash = await dashboard();
  assert.equal(dash.items.length, Object.keys(SERIES).length);
  for (const it of dash.items) assert.equal(it.value, null);
  restore();
});

test('SERIES has Fed Funds + CPI + Unemployment (and the rest of the curated set)', () => {
  assert.equal(SERIES['Fed Funds Rate'], 'DFF');
  assert.equal(SERIES['CPI'], 'CPIAUCSL');
  assert.equal(SERIES['Unemployment'], 'UNRATE');
  assert.equal(SERIES['Real GDP'], 'GDPC1');
  assert.equal(SERIES['30yr Mortgage'], 'MORTGAGE30US');
  assert.equal(SERIES['M2 Money Supply'], 'M2SL');
  assert.equal(SERIES['10yr Treasury'], 'DGS10');
});

test('renderPage() escapes injected content (dashboard view)', () => {
  const html = renderPage({
    asOf: '2026-06-03',
    items: [{ name: '<script>x</script>', seriesId: '"><img>', value: 1, change: 0.1, changePct: 1, unit: '%', date: '2026-05-01' }],
  });
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('"><img>'));
  assert.ok(html.includes('&quot;&gt;&lt;img&gt;'));
});

test('renderPage() escapes injected content (single-series table view)', () => {
  const html = renderPage({
    name: '<b>Series</b>',
    seriesId: 'X<Y',
    observations: [{ date: '2026-05-01<script>', value: 1 }],
  });
  assert.ok(!html.includes('<b>Series</b>'));
  assert.ok(html.includes('&lt;b&gt;Series&lt;/b&gt;'));
  assert.ok(html.includes('2026-05-01&lt;script&gt;'));
});

test('dataNote() names FRED / Federal Reserve Bank of St. Louis with an as-of date', () => {
  const note = dataNote();
  assert.match(note, /FRED/);
  assert.match(note, /Federal Reserve Bank of St\. Louis/);
  assert.match(note, /as of \d{4}-\d{2}-\d{2}/);
});

test('the FRED key is read by ENV NAME, never a literal in the source', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./fred.mjs', import.meta.url), 'utf8');
  assert.match(src, /process\.env\.FRED_API_KEY/);
  // the source must not contain an inlined key assignment with a literal value
  assert.doesNotMatch(src, /FRED_API_KEY\s*=\s*['"][\w-]+['"]/);
});
