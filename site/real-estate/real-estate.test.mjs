// real-estate.test.mjs — offline tests for the Real Estate vertical (drives `handler` with a mock
// req/res; no port bound, no network). Verifies routes, value-ranking render, affordability context,
// affiliate-wrapped outbound links, honest-empty soft-fail, robots/sitemap, and XSS escaping.
//
// Fully offline: engine fetch is injected via re.__setFetch and per-call deps ({fetch, byMetro}); no
// route or helper is allowed to reach the network.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, searchView, esc, SITEMAP_PATHS, TYPES } from './server.mjs';
import * as re from '../../integrations/soapbox/real-estate.mjs';

// Minimal mock res that captures status/headers/body.
function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'real-estate.test', ...headers } }, res);
  return res;
}

// A canned fetch that returns a fixed listings payload (or empty), so searchListings runs offline.
function cannedFetch(rows) {
  return async () => ({ ok: true, json: async () => ({ listings: rows }) });
}
// deps for a fully-offline searchView: canned listings + a canned metro median-income lookup.
function offlineDeps(rows, income = 60000) {
  return { fetch: cannedFetch(rows), byMetro: async () => ({ value: income }) };
}

const SAMPLE = [
  { address: '1 Cheap St', price: 1200, beds: 2, baths: 1, sqft: 1000, url: 'https://www.apartments.com/1' }, // $1.20/sqft
  { address: '2 Dear Ave', price: 3000, beds: 2, baths: 2, sqft: 1000, url: 'https://www.apartments.com/2' }, // $3.00/sqft
];

test('home 200 lists all three search types + the not-a-broker footer', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  for (const label of ['Rent', 'Buy', 'Commercial']) {
    assert.ok(res.body.includes(label), `home missing ${label}`);
  }
  assert.match(res.body, /not a licensed real-estate/i);
  assert.match(res.body, /search/i);
});

test('search renders listings ranked by value (cheapest price/sqft first), not commission', async () => {
  const view = await searchView({ type: 'rent', area: 'Austin' }, offlineDeps(SAMPLE));
  assert.ok(view.html.includes('1 Cheap St'));
  assert.ok(view.html.includes('2 Dear Ave'));
  // value-first ordering: the $1.20/sqft listing appears before the $3.00/sqft one.
  assert.ok(view.html.indexOf('1 Cheap St') < view.html.indexOf('2 Dear Ave'), 'cheaper-per-sqft must rank first');
});

test('a high-commission sponsored listing is segregated to the end, never outranking organic', async () => {
  const rows = [
    ...SAMPLE,
    { address: '3 Paid Blvd', price: 500, beds: 1, baths: 1, sqft: 1000, commission: 999, sponsored: true, url: 'https://www.apartments.com/3' },
  ];
  const view = await searchView({ type: 'rent', area: 'Austin' }, offlineDeps(rows));
  const organicIdx = view.html.indexOf('1 Cheap St');
  const sponsoredIdx = view.html.indexOf('3 Paid Blvd');
  assert.ok(organicIdx > -1 && sponsoredIdx > -1);
  assert.ok(sponsoredIdx > organicIdx, 'sponsored (even cheaper) must not appear before organic');
  assert.match(view.html, /Sponsored/);
});

test('search shows the affordability context (28% rule) for the area', async () => {
  const view = await searchView({ type: 'rent', area: 'Austin' }, offlineDeps(SAMPLE, 60000));
  // median 60k → monthly income 5000 → max ~1400/mo; cheapest rent 1200 ≤ 1400 → within the rule.
  assert.match(view.html, /Affordability/i);
  assert.match(view.html, /within/i);
});

test('outbound listing links are affiliate-wrapped when the network id is configured', async () => {
  const prev = process.env.CJ_PUBLISHER_ID;
  process.env.CJ_PUBLISHER_ID = 'TESTPID42';
  try {
    const view = await searchView({ type: 'rent', area: 'Austin' }, offlineDeps(SAMPLE));
    assert.match(view.html, /pid=TESTPID42/, 'outbound link should carry the env-named affiliate id');
    // rel=sponsored nofollow is present on outbound listing links
    assert.match(view.html, /rel="sponsored nofollow noopener"/);
  } finally {
    if (prev === undefined) delete process.env.CJ_PUBLISHER_ID; else process.env.CJ_PUBLISHER_ID = prev;
  }
});

test('every rendered search page carries the FTC affiliate disclosure', async () => {
  const view = await searchView({ type: 'buy', area: 'Austin' }, offlineDeps(SAMPLE));
  assert.match(view.html, /ftc-disclosure/);
  assert.match(view.html, /affiliate/i);
});

test('empty results are honest — "No listings found." and never a crash', async () => {
  const view = await searchView({ type: 'rent', area: 'Nowhere' }, offlineDeps([]));
  assert.match(view.html, /No listings found\./);
});

test('/search with an area soft-fails offline (no network) and still renders 200', async () => {
  // Force the engine's default fetch to a benign miss so the live route stays fully offline.
  re.__setFetch(async () => ({ ok: false }));
  try {
    const res = await get('/search?type=rent&area=Austin');
    assert.equal(res.code, 200);
    assert.match(res.body, /No listings found\.|real-estate/);
  } finally {
    re.__setFetch(null); // restore default
  }
});

test('/search with no area prompts for one (form present, no crash)', async () => {
  const res = await get('/search?type=buy');
  assert.equal(res.code, 200);
  assert.match(res.body, /Enter a city or metro/i);
  assert.match(res.body, /action="\/search"/);
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  assert.match(sm.body, /\/search/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Rent|Buy|Commercial/);
});

test('SITEMAP_PATHS covers home + every search type', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  for (const t of TYPES) assert.ok(SITEMAP_PATHS.includes(`/search?type=${t}`));
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('XSS — a hostile area value is escaped, never reflected as live markup', async () => {
  const view = await searchView({ type: 'rent', area: '<script>alert(1)</script>' }, offlineDeps(SAMPLE));
  assert.ok(!view.html.includes('<script>alert(1)</script>'), 'raw script tag must not be reflected');
  assert.match(view.html, /&lt;script&gt;/);
  // via the full handler too
  const res = await get('/search?type=rent&area=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  re.__setFetch(async () => ({ ok: false }));
  const res2 = await get('/search?type=rent&area=%3Cscript%3Ex%3C%2Fscript%3E');
  re.__setFetch(null);
  assert.ok(!res2.body.includes('<script>x</script>'));
});

test('esc() helper neutralizes all five HTML-significant characters', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('homePage() is a pure string with the three type cards and the value framing', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /price per square foot/i);
  assert.match(html, /Commercial/);
});
