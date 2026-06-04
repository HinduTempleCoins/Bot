// health-providers.test.mjs — offline tests for the SoapBox healthcare-provider-finder reader.
// Injects a fake fetch returning canned NPI-Registry + Medicare-Care-Compare JSON. No network, no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, findProviders, hospitalQuality, compareHospitals,
  renderPage, dataNote, esc,
} from './health-providers.mjs';
import { invalidate } from './cache.mjs';

// Canned NPI Registry response (npiregistry.cms.hhs.gov/api shape).
const NPI_RESULTS = {
  result_count: 1,
  results: [
    {
      number: '1234567890',
      basic: { first_name: 'Jane', last_name: 'Doe', credential: 'MD' },
      taxonomies: [
        { desc: 'Family Medicine', primary: false },
        { desc: 'Cardiovascular Disease', primary: true },
      ],
      addresses: [
        { address_purpose: 'MAILING', address_1: 'PO Box 1', city: 'X', state: 'CA', postal_code: '90000' },
        { address_purpose: 'LOCATION', address_1: '123 Main St', city: 'San Francisco', state: 'CA', postal_code: '94110' },
      ],
    },
  ],
};

// Canned Medicare Care Compare (Provider Data Catalog SQL) response — array of rows.
const COMPARE_ROWS = [
  {
    facility_id: '050001',
    facility_name: 'General Hospital',
    hospital_type: 'Acute Care Hospitals',
    hospital_ownership: 'Voluntary non-profit - Private',
    emergency_services: 'Yes',
    hospital_overall_rating: '4',
    mortality_national_comparison: 'Same as the national average',
    readmission_national_comparison: 'Below the national average',
  },
];

function mockFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, payload] of Object.entries(routes)) {
      if (u.includes(needle)) return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const reset = () => invalidate();

test('findProviders normalizes NPI data (primary taxonomy + location address)', async () => {
  reset();
  __setFetch(mockFetch({ 'npiregistry.cms.hhs.gov': NPI_RESULTS }));
  const list = await findProviders({ specialty: 'cardiology', zip: '94110' });
  assert.equal(list.length, 1);
  const p = list[0];
  assert.equal(p.npi, '1234567890');
  assert.equal(p.name, 'Jane Doe');
  assert.equal(p.specialty, 'Cardiovascular Disease'); // primary taxonomy chosen
  assert.ok(p.address.includes('123 Main St'), 'uses LOCATION address');
  assert.ok(p.address.includes('San Francisco, CA'));
  assert.ok(p.asOf, 'has an as-of timestamp');
  __setFetch();
});

test('findProviders soft-fails to [] (error, non-ok, and no selector)', async () => {
  reset();
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await findProviders({ specialty: 'x', zip: '1' }), []);
  reset();
  __setFetch(mockFetch({})); // 404 everything
  assert.deepEqual(await findProviders({ specialty: 'x', zip: '1' }), []);
  reset();
  __setFetch();
  assert.deepEqual(await findProviders({}), []); // no specialty + no zip
});

test('hospitalQuality returns sourced official measures (source + asOf)', async () => {
  reset();
  __setFetch(mockFetch({ 'data.cms.gov': COMPARE_ROWS }));
  const q = await hospitalQuality({ name: 'General Hospital' });
  assert.ok(q, 'got a result');
  assert.equal(q.id, '050001');
  assert.equal(q.name, 'General Hospital');
  assert.match(q.source, /Medicare Care Compare \(CMS\)/);
  assert.ok(q.sourceUrl, 'has a source URL');
  assert.ok(q.asOf, 'has an as-of timestamp');
  assert.ok(Array.isArray(q.measures) && q.measures.length > 0, 'has measures');
  const overall = q.measures.find((m) => m.label === 'Overall star rating');
  assert.equal(overall.value, '4');
  __setFetch();
});

test('hospitalQuality soft-fails to null (error, non-ok, empty, no selector)', async () => {
  reset();
  __setFetch(async () => { throw new Error('boom'); });
  assert.equal(await hospitalQuality({ name: 'X' }), null);
  reset();
  __setFetch(mockFetch({})); // 404
  assert.equal(await hospitalQuality({ name: 'X' }), null);
  reset();
  __setFetch(mockFetch({ 'data.cms.gov': [] })); // empty
  assert.equal(await hospitalQuality({ name: 'X' }), null);
  reset();
  __setFetch();
  assert.equal(await hospitalQuality({}), null); // no id + no name
});

test('compareHospitals lines up measures WITHOUT declaring a winner', async () => {
  const a = {
    id: '050001', name: 'General Hospital',
    measures: [{ label: 'Overall star rating', value: '4' }, { label: 'Emergency services', value: 'Yes' }],
  };
  const b = {
    id: '050002', name: 'County Medical',
    measures: [{ label: 'Overall star rating', value: '2' }], // missing Emergency services
  };
  const cmp = compareHospitals([a, b]);
  assert.equal(cmp.hospitals.length, 2);
  // measures unioned by label
  const star = cmp.rows.find((r) => r.label === 'Overall star rating');
  assert.deepEqual(star.values, ['4', '2']);
  const er = cmp.rows.find((r) => r.label === 'Emergency services');
  assert.deepEqual(er.values, ['Yes', null], 'missing value is null, not invented');
  // NO winner declared anywhere
  const blob = JSON.stringify(cmp).toLowerCase();
  assert.ok(!blob.includes('winner'), 'no "winner"');
  assert.ok(!/\bbest\b/.test(blob.replace(/no .{0,8}best/i, '')), 'no "best" verdict (only the disclaimer disclaims one)');
  assert.match(cmp.note, /no .*ranking|not our judgment|facts/i);
  assert.equal(compareHospitals([]).rows.length, 0); // soft on empty
});

test('renderPage escapes a malicious provider name + ALWAYS shows not-medical-advice banner', async () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    providers: [{ npi: '1', name: evil, specialty: 'x', address: 'y' }],
    quality: null,
    comparison: null,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  assert.ok(/not medical advice/i.test(html), 'banner present');
  assert.ok(html.includes('not-medical-advice'), 'banner class present');
  // right-of-reply note always present
  assert.ok(/right-of-reply|dispute|contact CMS/i.test(html), 'right-of-reply note present');

  // banner present even with NO data at all
  const empty = renderPage({});
  assert.ok(/not medical advice/i.test(empty), 'banner present on empty page');
});

test('renderPage shows official quality as sourced facts, not a verdict', async () => {
  const html = renderPage({
    providers: [],
    quality: {
      id: '050001', name: 'General Hospital',
      source: 'Medicare Care Compare (CMS)', sourceUrl: 'https://www.medicare.gov/care-compare/',
      asOf: '2026-06-04T00:00:00Z',
      measures: [{ label: 'Overall star rating', value: '4' }],
    },
  });
  assert.ok(/official CMS/i.test(html), 'labels the data as official CMS');
  assert.ok(html.includes('Medicare Care Compare (CMS)'), 'attributes the source');
  assert.ok(/not a SoapBox rating/i.test(html), 'explicitly disclaims it as our verdict');
});

test('dataNote names BOTH official sources + not-medical-advice + as-of', () => {
  const note = dataNote('2026-06-04');
  assert.match(note, /NPI Registry \(CMS\)/);
  assert.match(note, /Medicare Care Compare \(CMS\)/);
  assert.match(note, /official/i);
  assert.match(note, /as of 2026-06-04/);
  assert.match(note, /not medical advice/i);
});

test('esc escapes the HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
