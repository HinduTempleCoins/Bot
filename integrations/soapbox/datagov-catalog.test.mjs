// datagov-catalog.test.mjs — OFFLINE guards for the Data.gov CKAN meta-discovery reader. Fake fetch
// only; asserts normalization + soft-fail + facet extraction + summary tallies + HTML escaping +
// the as-of provenance note. No network.
// Run: node --test integrations/soapbox/datagov-catalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, searchDatasets, datasetDetail, organizations, facets, summary,
  renderPage, dataNote,
} from './datagov-catalog.mjs';

// minimal Response-like stub
const res = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// route a fake fetch by URL substring
function route(map) {
  __setFetch(async (url) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(map)) {
      if (u.includes(needle)) return typeof body === 'function' ? body(u) : res(body);
    }
    return res({}, false); // unmatched → not-ok → soft-fail
  });
}
const restore = () => __setFetch(null);

const PKG = {
  name: 'air-quality-system',
  title: 'Air Quality System',
  notes: 'EPA AQS data.',
  organization: { name: 'epa-gov', title: 'U.S. Environmental Protection Agency' },
  resources: [
    { name: 'AQS CSV', format: 'csv', url: 'https://aqs.epa.gov/data.csv' },
    { name: 'AQS API', format: 'api', url: 'https://aqs.epa.gov/api' },
  ],
};

test('searchDatasets() normalizes a canned package_search', async () => {
  route({ package_search: { success: true, result: { count: 1, results: [PKG] } } });
  const rows = await searchDatasets({ q: 'air quality' });
  restore();
  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.equal(p.title, 'Air Quality System');
  assert.equal(p.org, 'U.S. Environmental Protection Agency');
  assert.deepEqual(p.formats, ['CSV', 'API']);
  assert.equal(p.resources.length, 2);
  assert.equal(p.resources[0].url, 'https://aqs.epa.gov/data.csv');
  assert.equal(p.url, 'https://catalog.data.gov/dataset/air-quality-system');
});

test('searchDatasets() soft-fails to [] on throw', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const rows = await searchDatasets({ q: 'x' });
  restore();
  assert.deepEqual(rows, []);
});

test('searchDatasets() soft-fails to [] on non-ok response', async () => {
  __setFetch(async () => res({}, false));
  const rows = await searchDatasets({ q: 'x' });
  restore();
  assert.deepEqual(rows, []);
});

test('datasetDetail() returns a full record', async () => {
  route({ package_show: { success: true, result: PKG } });
  const p = await datasetDetail('air-quality-system');
  restore();
  assert.equal(p.name, 'air-quality-system');
  assert.equal(p.resources.length, 2);
  assert.deepEqual(p.formats, ['CSV', 'API']);
});

test('datasetDetail() soft-fails to null', async () => {
  assert.equal(await datasetDetail(''), null);
  route({ package_show: { success: false } });
  assert.equal(await datasetDetail('nope'), null);
  restore();
});

test('organizations() lists orgs', async () => {
  route({ organization_list: { success: true, result: ['epa-gov', 'noaa-gov', 'nasa-gov'] } });
  const orgs = await organizations({ limit: 10 });
  restore();
  assert.deepEqual(orgs, ['epa-gov', 'noaa-gov', 'nasa-gov']);
});

test('facets() extracts format/org facets', async () => {
  route({
    package_search: {
      success: true,
      result: {
        count: 100,
        results: [],
        search_facets: {
          res_format: { items: [{ name: 'CSV', display_name: 'CSV', count: 42 }, { name: 'JSON', display_name: 'JSON', count: 17 }] },
          organization: { items: [{ name: 'epa-gov', display_name: 'EPA', count: 30 }] },
          groups: { items: [] },
        },
      },
    },
  });
  const f = await facets({ q: 'climate' });
  restore();
  assert.deepEqual(f.formats, [{ name: 'CSV', count: 42 }, { name: 'JSON', count: 17 }]);
  assert.deepEqual(f.orgs, [{ name: 'EPA', count: 30 }]);
  assert.deepEqual(f.groups, []);
});

test('summary() tallies formats and orgs', async () => {
  const s = summary([
    { org: 'EPA', formats: ['CSV', 'JSON'] },
    { org: 'EPA', formats: ['CSV'] },
    { org: 'NOAA', formats: ['API'] },
  ]);
  assert.equal(s.count, 3);
  assert.deepEqual(s.topFormats[0], { name: 'CSV', count: 2 });
  assert.deepEqual(s.topOrgs[0], { name: 'EPA', count: 2 });
});

test('renderPage() escapes a malicious dataset title and resource url', async () => {
  const html = renderPage({
    query: 'test',
    results: [{
      title: '<script>alert(1)</script>',
      name: 'evil',
      org: 'Bad & Co',
      notes: 'note',
      formats: ['CSV'],
      resources: [{ name: 'x', format: 'CSV', url: 'https://e.com/?a=1&b="><img>' }],
      url: 'https://catalog.data.gov/dataset/evil',
    }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Bad &amp; Co'));
  assert.ok(!html.includes('"><img>'));
  assert.ok(html.includes('&amp;b=&quot;&gt;&lt;img&gt;'));
});

test('dataNote() has source and as-of date', () => {
  const note = dataNote();
  assert.match(note, /Data\.gov CKAN catalog/);
  assert.match(note, /as of \d{4}-\d{2}-\d{2}/);
});
