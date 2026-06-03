// worldbank.test.mjs — offline tests for the World Bank Open Data reader.
// All network calls are stubbed via __setFetch with canned [meta, data] two-element JSON; no live calls,
// no keys. Run: node --test integrations/soapbox/worldbank.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indicator, countryProfile, compareCountries, INDICATORS, renderPage, dataNote,
  normalizeSeries, latestPoint, __setFetch,
} from './worldbank.mjs';

// The World Bank shape: [ metadata, [ { date, value, indicator, country }, ... ] ].
function wbFetch(rows, { ok = true, meta = { page: 1, total: rows == null ? 0 : rows.length } } = {}) {
  return async () => ({ ok, json: async () => [meta, rows] });
}
function throwingFetch() {
  return async () => { throw new Error('network down'); };
}
// Returns a series for whichever indicator code is in the URL — lets profile/compare tests vary by code.
function byCodeFetch(map) {
  return async (url) => {
    const code = Object.keys(map).find((c) => String(url).includes(c));
    const rows = code ? map[code] : null;
    return { ok: true, json: async () => [{ page: 1 }, rows] };
  };
}

const usGdp = [
  { date: '2022', value: 25462700000000, indicator: { id: 'NY.GDP.MKTP.CD' }, country: { id: 'US' } },
  { date: '2021', value: 23315080560000, indicator: { id: 'NY.GDP.MKTP.CD' }, country: { id: 'US' } },
  { date: '2020', value: null, indicator: { id: 'NY.GDP.MKTP.CD' }, country: { id: 'US' } }, // null → dropped
];

test('indicator parses the canned [meta, data] series, newest first', async () => {
  __setFetch(wbFetch(usGdp));
  const series = await indicator({ country: 'US', indicator: 'NY.GDP.MKTP.CD', years: 5 });
  __setFetch(null);
  assert.equal(series.length, 2); // the null-value 2020 row is dropped
  assert.deepEqual(series[0], { year: '2022', value: 25462700000000 });
  assert.equal(series[1].year, '2021');
});

test('indicator soft-fails to [] on network error', async () => {
  __setFetch(throwingFetch());
  const series = await indicator({ country: 'US', indicator: 'NY.GDP.MKTP.CD' });
  __setFetch(null);
  assert.deepEqual(series, []);
});

test('indicator soft-fails to [] on the [meta, null] empty shape', async () => {
  __setFetch(wbFetch(null)); // World Bank returns [meta, null] when a query has no data
  const series = await indicator({ country: 'ZZ', indicator: 'NY.GDP.MKTP.CD' });
  __setFetch(null);
  assert.deepEqual(series, []);
});

test('indicator soft-fails to [] with missing args', async () => {
  assert.deepEqual(await indicator({}), []);
  assert.deepEqual(await indicator({ country: 'US' }), []);
  assert.deepEqual(await indicator({ indicator: 'NY.GDP.MKTP.CD' }), []);
});

test('countryProfile assembles the latest value for each curated indicator', async () => {
  __setFetch(byCodeFetch({
    'NY.GDP.MKTP.CD': usGdp,
    'SP.POP.TOTL': [{ date: '2022', value: 333287557 }, { date: '2021', value: 332031554 }],
    'SP.DYN.LE00.IN': [{ date: '2021', value: 76.33 }],
    // other curated codes return null (no data) → those entries become null
  }));
  const p = await countryProfile({ country: 'US' });
  __setFetch(null);
  assert.equal(p.country, 'US');
  assert.equal(p.indicators['GDP'].value, 25462700000000);
  assert.equal(p.indicators['GDP'].year, '2022');
  assert.equal(p.indicators['GDP'].unit, 'USD');
  assert.equal(p.indicators['Population'].value, 333287557);
  assert.equal(p.indicators['Life expectancy'].value, 76.33);
  assert.equal(p.indicators['Unemployment'], null); // no data for that code → null
});

test('countryProfile soft-fails to empty with no country', async () => {
  const p = await countryProfile({});
  assert.equal(p.country, null);
  assert.deepEqual(p.indicators, {});
});

test('compareCountries ranks latest values high → low, dropping no-data countries', async () => {
  // Each country gets a distinct GDP via the URL country segment.
  __setFetch(async (url) => {
    const s = String(url);
    let rows = null;
    if (s.includes('/country/US/')) rows = [{ date: '2022', value: 25462700000000 }];
    else if (s.includes('/country/CN/')) rows = [{ date: '2022', value: 17963170521000 }];
    else if (s.includes('/country/IN/')) rows = [{ date: '2022', value: 3385089881000 }];
    else if (s.includes('/country/ZZ/')) rows = null; // no data
    return { ok: true, json: async () => [{ page: 1 }, rows] };
  });
  const res = await compareCountries(['IN', 'US', 'ZZ', 'CN'], 'NY.GDP.MKTP.CD');
  __setFetch(null);
  assert.equal(res.indicator, 'NY.GDP.MKTP.CD');
  assert.equal(res.unit, 'USD');
  assert.equal(res.rows.length, 3); // ZZ dropped
  assert.deepEqual(res.rows.map((r) => r.country), ['US', 'CN', 'IN']); // ranked descending
  assert.equal(res.rows[0].value, 25462700000000);
});

test('compareCountries soft-fails to empty rows with bad args', async () => {
  assert.deepEqual((await compareCountries([], 'NY.GDP.MKTP.CD')).rows, []);
  assert.deepEqual((await compareCountries(['US'], null)).rows, []);
});

test('INDICATORS has GDP and Population mapped to World Bank codes', () => {
  assert.equal(INDICATORS['GDP'].code, 'NY.GDP.MKTP.CD');
  assert.equal(INDICATORS['Population'].code, 'SP.POP.TOTL');
  assert.ok(INDICATORS['Inflation (CPI)']);
  assert.ok(INDICATORS['Life expectancy']);
  assert.ok(INDICATORS['CO2 per capita']);
});

test('renderPage (profile) escapes a malicious country name', () => {
  const html = renderPage({
    country: '<script>alert(1)</script>',
    indicators: {
      'GDP': { code: 'NY.GDP.MKTP.CD', unit: 'USD', year: '2022', value: 25462700000000 },
      'Unemployment': null,
    },
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Country profile'));
  assert.ok(html.includes('25.46T')); // compact formatting
  assert.ok(html.includes('source: World Bank'));
});

test('renderPage (comparison) renders a ranked table', () => {
  const html = renderPage({
    indicator: 'NY.GDP.MKTP.CD',
    unit: 'USD',
    rows: [
      { country: 'US', year: '2022', value: 25462700000000 },
      { country: '<b>x</b>', year: '2022', value: 100 },
    ],
  });
  assert.ok(html.includes('Compare countries'));
  assert.ok(html.includes('GDP'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;'));
});

test('renderPage handles missing data without throwing', () => {
  assert.ok(renderPage({}).includes('</section>'));
  assert.ok(renderPage({ rows: [] }).includes('No data'));
});

test('dataNote names World Bank + latest available year', () => {
  const n = dataNote();
  assert.match(n, /World Bank Open Data/);
  assert.match(n, /latest available year/);
});

// ---- pure helper coverage ----

test('normalizeSeries handles all the bad shapes', () => {
  assert.deepEqual(normalizeSeries(null), []);
  assert.deepEqual(normalizeSeries([{ page: 1 }]), []); // one-element (no data part)
  assert.deepEqual(normalizeSeries([{ page: 1 }, null]), []); // [meta, null]
  assert.deepEqual(normalizeSeries([{ page: 1 }, 'nope']), []); // data not an array
});

test('latestPoint returns the newest point or null', () => {
  assert.equal(latestPoint([]), null);
  assert.equal(latestPoint(null), null);
  assert.deepEqual(latestPoint([{ year: '2022', value: 1 }]), { year: '2022', value: 1 });
});
