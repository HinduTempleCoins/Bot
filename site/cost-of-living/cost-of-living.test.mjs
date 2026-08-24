// cost-of-living.test.mjs — offline tests for the Cost-of-Living vertical. Injects canned BLS/Census
// responses into the engines (coliving + census-acs both expose __setFetch), drives `handler` with a
// mock req/res. Verifies real data renders with provenance, the thin-content guard, compare, routes.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, findCity, SITEMAP_PATHS, CITIES } from './server.mjs';
import * as coliving from '../../integrations/soapbox/coliving.mjs';
import * as census from '../../integrations/soapbox/census-acs.mjs';

let saved;
beforeEach(() => {
  saved = { fred: process.env.FRED_API_KEY, usda: process.env.USDA_API_KEY, cen: process.env.CENSUS_API_KEY, bls: process.env.BLS_API_KEY };
  delete process.env.FRED_API_KEY; delete process.env.USDA_API_KEY; delete process.env.CENSUS_API_KEY; delete process.env.BLS_API_KEY;
});
afterEach(() => {
  for (const [k, v] of [['FRED_API_KEY', saved.fred], ['USDA_API_KEY', saved.usda], ['CENSUS_API_KEY', saved.cen], ['BLS_API_KEY', saved.bls]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  coliving.__setFetch(null); census.__setFetch(null);
});

// coliving's fetch: BLS (POST) for CPI + gas, and Census ACS1 (GET) for metro income.
function colFetch(url, opts = {}) {
  const u = String(url);
  if (u.includes('api.bls.gov')) {
    const body = JSON.parse(opts.body || '{}');
    const sid = (body.seriesid || [])[0];
    const value = sid === 'APU000074714' ? '3.45' : '312.5'; // gas $/gal vs CPI
    return Promise.resolve({ ok: true, json: async () => ({ Results: { series: [{ data: [{ value, period: 'M04', year: '2026' }] }] } }) });
  }
  if (u.includes('api.census.gov') && u.includes('acs1')) {
    return Promise.resolve({ ok: true, json: async () => ([
      ['NAME', 'B19013_001E', 'metropolitan statistical area/micropolitan statistical area'],
      ['Austin-Round Rock-Georgetown, TX Metro Area', '85000', '12420'],
    ]) });
  }
  return Promise.resolve({ ok: false, json: async () => null });
}
// census-acs profile fetch: ACS5.
function censusFetch(url) {
  const u = String(url);
  if (u.includes('api.census.gov') && u.includes('acs5')) {
    return Promise.resolve({ ok: true, json: async () => ([
      ['NAME', 'B01003_001E', 'B19013_001E', 'B01002_001E', 'B25064_001E', 'B25003_002E', 'B25003_001E', 'B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E', 'B15003_001E', 'B17001_002E', 'B17001_001E'],
      ['Austin city, Texas', '961855', '86556', '34.2', '1500', '200000', '400000', '150000', '30000', '15000', '5000', '600000', '80000', '900000'],
    ]) });
  }
  return Promise.resolve({ ok: false, json: async () => null });
}

function mockRes() {
  return { code: null, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(s) { this.body = s == null ? '' : String(s); } };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'col.test' } }, res);
  return res;
}

test('home 200 lists the city directory + compare form', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /Austin, TX/);
  assert.match(res.body, /Compare/);
});

test('city page renders REAL injected data with source + freshness labels', async () => {
  coliving.__setFetch(colFetch);
  census.__setFetch(censusFetch);
  const res = await get('/city/austin-tx');
  assert.equal(res.code, 200);
  assert.match(res.body, /Gasoline/);
  assert.match(res.body, /3\.45|3,45|3\.45/);          // gas value rendered
  assert.match(res.body, /85,000/);                      // metro median income
  assert.match(res.body, /86,556/);                      // ACS median household income
  assert.match(res.body, /Median household income/);
  assert.match(res.body, /bls|census/i);                 // provenance labels present
});

test('city page marks index,follow when it has real data', async () => {
  coliving.__setFetch(colFetch);
  census.__setFetch(censusFetch);
  const res = await get('/city/austin-tx');
  assert.match(res.body, /index,follow|max-image-preview/);
  assert.ok(!/noindex/.test(res.body), 'a data-rich page must not be noindex');
});

test('THIN-CONTENT GUARD: no data → honest "unavailable" page + noindex, never fabricated stats', async () => {
  // engines return nothing (default fetch, no keys) → density 0
  coliving.__setFetch(() => Promise.resolve({ ok: false, json: async () => null }));
  census.__setFetch(() => Promise.resolve({ ok: false, json: async () => null }));
  const res = await get('/city/denver-co');
  assert.equal(res.code, 200);
  assert.match(res.body, /don't have live cost-of-living data/i);
  assert.match(res.body, /noindex/);
});

test('/compare renders an income-anchored comparison', async () => {
  census.__setFetch(censusFetch); // both cities resolve to the same fixture profile → equal income
  const res = await get('/compare?a=austin-tx&b=denver-co');
  assert.equal(res.code, 200);
  assert.match(res.body, /Austin, TX vs Denver, CO/);
  assert.match(res.body, /median household income/i);
});

test('/compare with a bad slug redirects home', async () => {
  const res = await get('/compare?a=austin-tx&b=nowhere');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('unknown city → redirect home (never 500)', async () => {
  const res = await get('/city/atlantis');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('robots/sitemap/sitemap-index/llms all serve; sitemap lists city pages', async () => {
  assert.equal((await get('/robots.txt')).code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /\/city\/austin-tx/);
  assert.equal((await get('/sitemap-index.xml')).code, 200);
  const llms = await get('/llms.txt');
  assert.match(llms.body, /Austin, TX/);
});

test('SITEMAP_PATHS + registry cover home and every city', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  assert.ok(SITEMAP_PATHS.includes('/city/austin-tx'));
  assert.equal(SITEMAP_PATHS.length, CITIES.length + 1);
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.body, 'ok');
});

test('city name is escaped in output (no raw injection vector via registry)', async () => {
  coliving.__setFetch(colFetch); census.__setFetch(censusFetch);
  const res = await get('/city/austin-tx');
  assert.ok(!res.body.includes('<script>'));
});

test('homePage() is a pure string', () => {
  assert.equal(typeof homePage(), 'string');
  assert.match(homePage(), /Cost of Living/);
});
