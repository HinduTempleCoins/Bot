// fbi-crime.test.mjs — offline tests for the FBI Crime Data Explorer (CDE) reader. Injects a fake fetch
// that returns canned CDE JSON (in two of the real payload shapes) routed by URL substring. No network,
// no keys — the api.data.gov key is referenced by env NAME only and falls back to DEMO_KEY.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, API_KEY_ENV, cdeGet, normalizeEstimates, stateCrime,
  nationalTrend, agencies, summary, renderPage, dataNote, esc,
} from './fbi-crime.mjs';
import { invalidate } from './cache.mjs';

// Shape A: a plain array of estimate rows (state estimates form). Rate present on some rows; one row
// gives only count + population so the rate must be COMPUTED.
const STATE_TX = [
  { data_year: '2019', offense: 'violent-crime', value: '120000', rate: '410.5', population: '29000000' },
  { data_year: '2020', offense: 'violent-crime', value: '125000', population: '29500000' }, // rate computed
  { data_year: '2021', offense: 'violent-crime', value: '118000', rate: '395.0', population: '30000000' },
];

// Shape C: the keyed estimates payload (year→value maps) — national form.
const NATIONAL = {
  actual: { '2018': 1245000, '2019': 1203000, '2020': 1310000 },
  rates: { '2018': 380.6, '2019': 366.7, '2020': 398.5 },
  population: { '2018': 327000000, '2019': 328000000, '2020': 329000000 },
};

const AGENCIES_CA = [
  { ori: 'CA0010000', agency_name: 'Alameda County SO', agency_type_name: 'County', county_name: 'Alameda', is_nibrs: true },
  { ori: 'CA0190100', agency_name: 'Los Angeles PD', agency_type_name: 'City', county_name: 'Los Angeles', is_nibrs: 'false' },
];

// Route a fake fetch by URL substring → canned JSON. Records the last URL seen (for key assertions).
let lastUrl = '';
function mockFetch(routes) {
  return async (url) => {
    lastUrl = String(url);
    for (const [needle, json] of Object.entries(routes)) {
      if (lastUrl.includes(needle)) return { ok: true, status: 200, json: async () => json };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const reset = () => { invalidate(); lastUrl = ''; };

test('normalizeEstimates handles the array shape + computes a missing rate', () => {
  const rows = normalizeEstimates(STATE_TX, 'violent-crime');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].year, 2019);
  assert.equal(rows[0].ratePer100k, 410.5);
  // 2020 had no rate → computed: 125000 / 29500000 * 100000 = 423.7
  assert.equal(rows[1].ratePer100k, 423.7);
  assert.equal(rows[1].count, 125000);
});

test('normalizeEstimates handles the keyed (year→value) shape', () => {
  const rows = normalizeEstimates(NATIONAL, 'violent-crime');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.year), [2018, 2019, 2020]); // sorted oldest→newest
  assert.equal(rows[0].ratePer100k, 380.6);
  assert.equal(rows[2].count, 1310000);
});

test('stateCrime normalizes + reads/computes rates, filters by year', async () => {
  reset();
  __setFetch(mockFetch({ '/estimate/state/TX/violent-crime': STATE_TX }));
  const all = await stateCrime({ state: 'tx', offense: 'violent-crime' });
  assert.equal(all.length, 3);
  assert.ok(all.every((r) => r.ratePer100k != null), 'every row has a rate per 100k');

  reset();
  __setFetch(mockFetch({ '/estimate/state/TX/violent-crime': STATE_TX }));
  const one = await stateCrime({ state: 'TX', year: 2021, offense: 'violent-crime' });
  assert.equal(one.length, 1);
  assert.equal(one[0].year, 2021);
  assert.equal(one[0].ratePer100k, 395.0);
  __setFetch();
});

test('stateCrime soft-fails to []', async () => {
  reset();
  __setFetch(mockFetch({})); // 404 for everything
  assert.deepEqual(await stateCrime({ state: 'TX' }), []);
  reset();
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await stateCrime({ state: 'TX' }), []);
  assert.deepEqual(await stateCrime({}), []); // no state
  __setFetch();
});

test('nationalTrend returns a series, oldest→newest, windowed', async () => {
  reset();
  __setFetch(mockFetch({ '/estimate/national/violent-crime': NATIONAL }));
  const series = await nationalTrend({ offense: 'violent-crime' });
  assert.equal(series.length, 3);
  assert.ok(series[0].year < series[2].year, 'sorted ascending');

  reset();
  __setFetch(mockFetch({ '/estimate/national/violent-crime': NATIONAL }));
  const win = await nationalTrend({ offense: 'violent-crime', years: [2019, 2020] });
  assert.deepEqual(win.map((r) => r.year), [2019, 2020]);
  __setFetch();
});

test('agencies lists reporting agencies, normalizing the NIBRS flag', async () => {
  reset();
  __setFetch(mockFetch({ '/agency/byStateAbbr/CA': AGENCIES_CA }));
  const list = await agencies({ state: 'ca' });
  assert.equal(list.length, 2);
  assert.equal(list[0].ori, 'CA0010000');
  assert.equal(list[0].name, 'Alameda County SO');
  assert.equal(list[0].nibrs, true);
  assert.equal(list[1].nibrs, false); // 'false' string → false
  reset();
  __setFetch(mockFetch({})); // 404
  assert.deepEqual(await agencies({ state: 'CA' }), []);
  assert.deepEqual(await agencies({}), []);
  __setFetch();
});

test('summary gives a trend direction (rising/falling/flat) from rates', () => {
  const rising = summary([
    { year: 2018, offense: 'x', ratePer100k: 300, count: 100 },
    { year: 2020, offense: 'x', ratePer100k: 360, count: 120 },
  ]);
  assert.equal(rising.trend, 'rising');
  assert.equal(rising.latestRate, 360);
  assert.equal(rising.pctChange, 20);

  const falling = summary([
    { year: 2018, offense: 'x', ratePer100k: 400 },
    { year: 2020, offense: 'x', ratePer100k: 320 },
  ]);
  assert.equal(falling.trend, 'falling');

  const flat = summary([
    { year: 2018, offense: 'x', ratePer100k: 300 },
    { year: 2020, offense: 'x', ratePer100k: 301 },
  ]);
  assert.equal(flat.trend, 'flat');

  assert.equal(summary([]).trend, 'no data');
});

test('renderPage escapes a malicious offense label + shows the reporting caveat + emphasizes rates', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({ rows: [{ year: 2020, offense: evil, ratePer100k: 410.5, count: 125000 }] });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  assert.match(html, /Reporting caveat/);
  assert.match(html, /voluntary/i);
  assert.match(html, /per 100,000|Rate \/ 100k/, 'emphasizes rate per 100k');
});

test('dataNote names FBI CDE + per-100k + voluntary reporting', () => {
  const note = dataNote('2026-06-03');
  assert.match(note, /FBI Crime Data Explorer \(UCR\/NIBRS\)/);
  assert.match(note, /as of 2026-06-03/);
  assert.match(note, /per 100k/);
  assert.match(note, /voluntary/i);
});

test('API key is referenced by env NAME only (DEMO_KEY fallback; no literal key in source)', async () => {
  assert.equal(API_KEY_ENV, 'DATA_GOV_API_KEY');

  // Unset env → DEMO_KEY is sent
  reset();
  const prev = process.env[API_KEY_ENV];
  delete process.env[API_KEY_ENV];
  __setFetch(mockFetch({ '/estimate/national/x': NATIONAL }));
  await cdeGet('/estimate/national/x');
  assert.match(lastUrl, /API_KEY=DEMO_KEY/, 'DEMO_KEY fallback when env unset');

  // Set by name → that value is forwarded (proving we read env, not a literal)
  reset();
  process.env[API_KEY_ENV] = 'env-injected-key';
  __setFetch(mockFetch({ '/estimate/national/x': NATIONAL }));
  await cdeGet('/estimate/national/x');
  assert.match(lastUrl, /API_KEY=env-injected-key/);

  if (prev === undefined) delete process.env[API_KEY_ENV]; else process.env[API_KEY_ENV] = prev;
  __setFetch();

  // Source must not contain a hard-coded api.data.gov key literal (DEMO_KEY constant aside)
  const src = await (await import('node:fs/promises')).readFile(new URL('./fbi-crime.mjs', import.meta.url), 'utf8');
  assert.ok(!/['"]DATA_GOV[_A-Z]*['"]\s*[:=]\s*['"][A-Za-z0-9]{16,}/.test(src), 'no literal key assignment');
});

test('esc escapes the five HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
