// regulated-goods.test.mjs — OFFLINE tests for the SoapBox Tobacco/Vape/Alcohol/Wine vertical. No
// network: a fake fetch is installed via __setFetch() and routed by URL substring. We assert the
// NORMALIZATION + SHAPE each export produces, the link-out DIRECTORY shape (no scraping), and the
// graceful soft-fail contract (never throws).
//
//   node --test integrations/soapbox/regulated-goods.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  __setFetch, ENDPOINTS, PRICE_SOURCES,
  tobaccoProducts, alcoholPermits, tobaccoPrevalence, whoTobaccoIndicator,
  priceLinks, regulatedGoodsSummary,
} from './regulated-goods.mjs';
import { invalidate } from './cache.mjs';

// a fetch double: caller registers URL-substring → JSON; unmatched URLs return 404 (soft-fail path).
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, payload] of routes) {
      if (String(url).includes(needle)) {
        if (payload === 'NETWORK_ERROR') throw new Error('boom');
        if (payload === '404') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

beforeEach(() => { invalidate(); __setFetch(null); });

// ── PRICE_SOURCES / priceLinks() — link-out directory, no scraping ──────────────────────────────────
test('PRICE_SOURCES is a curated link-out directory with the expected categories', () => {
  for (const cat of ['Wine', 'Spirits', 'Beer', 'Tobacco & Vape']) {
    assert.ok(Array.isArray(PRICE_SOURCES[cat]) && PRICE_SOURCES[cat].length, `${cat} present`);
    for (const s of PRICE_SOURCES[cat]) {
      assert.equal(typeof s.name, 'string');
      assert.match(s.home, /^https:\/\//, 'home is an https link-out');
      assert.equal(typeof s.note, 'string');
    }
  }
  // The named retailers from the brief are present.
  const wineNames = PRICE_SOURCES.Wine.map((s) => s.name);
  assert.ok(wineNames.includes('Wine-Searcher'));
  assert.ok(wineNames.includes('Vivino'));
});

test('priceLinks() deep-links the query and marks everything as not scraped', () => {
  const links = priceLinks('Opus One 2018', 'Wine');
  assert.ok(links.length >= 2);
  for (const l of links) {
    assert.equal(l.category, 'Wine');
    assert.equal(l.scraped, false, 'this module never scrapes pricing');
    assert.match(l.url, /^https:\/\//);
  }
  const ws = links.find((l) => l.name === 'Wine-Searcher');
  assert.match(ws.url, /wine-searcher\.com\/find\/Opus\+One/);
});

test('priceLinks() with empty query falls back to the home link, never throws', () => {
  const links = priceLinks('', 'Wine');
  const ws = links.find((l) => l.name === 'Wine-Searcher');
  assert.equal(ws.url, 'https://www.wine-searcher.com/');
  // no category → spans all categories
  assert.ok(priceLinks('x').length > links.length);
});

// ── tobaccoProducts() / openFDA tobacco ─────────────────────────────────────────────────────────────
test('tobaccoProducts() flattens + de-dupes openFDA tobacco product rows with report counts', async () => {
  __setFetch(fakeFetch([['/tobacco/problem.json', {
    results: [
      { products: [{ product_category: 'E-Cigarette', product_sub_category: 'Closed System', tobacco_products: 'JUUL' }] },
      { products: [{ product_category: 'E-Cigarette', product_sub_category: 'Closed System', tobacco_products: 'JUUL' }] },
      { products: [{ product_category: 'Cigar', product_sub_category: 'Large', tobacco_products: 'BrandX' }] },
    ],
  }]]));
  const r = await tobaccoProducts('juul');
  assert.equal(r.found, true);
  assert.equal(r.products.length, 2, 'duplicate product de-duplicated');
  assert.equal(r.products[0].brand, 'JUUL');
  assert.equal(r.products[0].reports, 2, 'reports counted');
  assert.equal(r.products[0].category, 'E-Cigarette');
  assert.match(r.source, /openFDA/);
  assert.match(r.authorization, /^https:\/\/www\.fda\.gov/, 'authorization link-out surfaced');
});

test('tobaccoProducts() soft-fails on empty query and on no results', async () => {
  const empty = await tobaccoProducts('  ');
  assert.equal(empty.found, false);
  assert.deepEqual(empty.products, []);
  __setFetch(fakeFetch([['/tobacco/problem.json', { results: [] }]]));
  const none = await tobaccoProducts('notabrand');
  assert.equal(none.found, false);
  assert.deepEqual(none.products, []);
});

// ── alcoholPermits() / TTB + CDC open data ──────────────────────────────────────────────────────────
test('alcoholPermits() normalizes permit rows from the keyless open-data feed', async () => {
  __setFetch(fakeFetch([['/permits.json', [
    { applicant_name: 'Acme Wines LLC', permit_number: 'BWN-CA-1234', product_class_type: 'Table Wine', brand_name: 'Acme Red', state: 'CA', status: 'Active' },
  ]]]));
  const r = await alcoholPermits('acme');
  assert.equal(r.found, true);
  assert.equal(r.permits.length, 1);
  assert.equal(r.permits[0].applicant, 'Acme Wines LLC');
  assert.equal(r.permits[0].permitNumber, 'BWN-CA-1234');
  assert.equal(r.permits[0].productClass, 'Table Wine');
  assert.equal(r.registryUrl, ENDPOINTS.ttb, 'TTB COLA registry link always returned');
});

test('alcoholPermits() soft-fails to the registry link when no feed is reachable', async () => {
  __setFetch(fakeFetch([['/permits.json', '404']]));
  const r = await alcoholPermits('acme');
  assert.equal(r.found, false);
  assert.deepEqual(r.permits, []);
  assert.equal(r.registryUrl, ENDPOINTS.ttb);
  assert.match(r.note, /TTB COLA registry/);
});

test('alcoholPermits() soft-fails on empty query without throwing', async () => {
  const r = await alcoholPermits('');
  assert.equal(r.found, false);
  assert.deepEqual(r.permits, []);
  assert.equal(r.registryUrl, ENDPOINTS.ttb);
});

// ── tobaccoPrevalence() / CDC ───────────────────────────────────────────────────────────────────────
test('tobaccoPrevalence() normalizes CDC state-system rows', async () => {
  __setFetch(fakeFetch([['data.cdc.gov', [
    { locationdesc: 'California', year: '2022', measuredesc: 'Current Smoking', data_value: '10.5', data_value_unit: '%' },
  ]]]));
  const r = await tobaccoPrevalence('California');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].location, 'California');
  assert.equal(r.rows[0].value, 10.5, 'value coerced to number');
  assert.match(r.source, /CDC/);
});

test('tobaccoPrevalence() soft-fails to empty rows on outage', async () => {
  __setFetch(fakeFetch([['data.cdc.gov', 'NETWORK_ERROR']]));
  const r = await tobaccoPrevalence('California');
  assert.deepEqual(r.rows, []);
});

// ── whoTobaccoIndicator() / WHO GHO ─────────────────────────────────────────────────────────────────
test('whoTobaccoIndicator() normalizes the WHO GHO OData value array', async () => {
  __setFetch(fakeFetch([['ghoapi', {
    value: [{ SpatialDim: 'USA', TimeDim: 2020, Dim1: 'BTSX', NumericValue: 19.4 }],
  }]]));
  const r = await whoTobaccoIndicator();
  assert.equal(r.values.length, 1);
  assert.equal(r.values[0].country, 'USA');
  assert.equal(r.values[0].year, 2020);
  assert.equal(r.values[0].value, 19.4);
  assert.match(r.source, /WHO/);
});

test('whoTobaccoIndicator() soft-fails to empty values on 404', async () => {
  __setFetch(fakeFetch([['ghoapi', '404']]));
  const r = await whoTobaccoIndicator();
  assert.deepEqual(r.values, []);
});

// ── regulatedGoodsSummary() — static, keyless overview ──────────────────────────────────────────────
test('regulatedGoodsSummary() returns the category/source/price overview without network', async () => {
  const s = await regulatedGoodsSummary();
  assert.match(s.vertical, /Tobacco/);
  assert.ok(Array.isArray(s.categories) && s.categories.length >= 3);
  for (const c of s.categories) {
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.authority, 'string');
    assert.match(c.verify, /^https:\/\//);
  }
  assert.ok(s.publicHealthSources.some((x) => /CDC/.test(x)));
  assert.ok(s.publicHealthSources.some((x) => /WHO/.test(x)));
  assert.equal(typeof s.priceSources.Wine[0].name, 'string');
  assert.match(s.pricingPolicy, /link-out only/i);
  assert.match(s.pricingPolicy, /[Nn]ot scraped/);
});

// ── cross-cutting: nothing throws ───────────────────────────────────────────────────────────────────
test('every export soft-fails (never throws) on a total network outage', async () => {
  __setFetch(() => { throw new Error('offline'); });
  await assert.doesNotReject(Promise.all([
    tobaccoProducts('x'), alcoholPermits('x'), tobaccoPrevalence('x'),
    whoTobaccoIndicator(), regulatedGoodsSummary(),
  ]));
  // synchronous link helpers also never throw
  assert.doesNotThrow(() => priceLinks('x'));
});
