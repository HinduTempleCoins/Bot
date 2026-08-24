// scam-alert.test.mjs — offline suite for the ScamAlert / consumer-protection vertical.
// House style: node --test, FULLY OFFLINE (every source injected — no network), soft-fail-never-throw,
// esc() proven. We stub BOTH engine seams: __setSources() (businessPage's FDA/CPSC/CFPB/SEC slots) and
// __setExtraSources() (the composed SAM.gov / FSIS / CourtListener / regulator-alert readers), so no
// reader ever touches the network. One test drives the REAL fsis-recalls reader via its __setFetch seam.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, homePage, companyReport, companyPage, slugify,
  assertNoVerdict, __setSources, __resetSources, __setExtraSources, __resetExtraSources,
} from './server.mjs';
import * as fsis from '../../integrations/soapbox/fsis-recalls.mjs';

// A fact record in the engine's flat shape. businessPage keeps only { kind:'fact', source }.
const F = (o) => ({ kind: 'fact', source: 'X', sourceUrl: 'https://example.gov', asOf: '2026-01-01', title: 't', detail: 'd', ...o });

// Fully-offline stub for businessPage's own source slots: everything empty unless overridden. This is
// what keeps every test off the network — identity/neighborhood would otherwise dynamic-import + fetch.
function stubEngine(over = {}) {
  __setSources({
    identity: async () => null,
    neighborhood: async () => null,
    fdaRecalls: async () => [],
    cpscRecalls: async () => [],
    cfpbComplaints: async () => [],
    secFilings: async () => [],
    ownReviews: async () => [],
    windowedReviews: async () => [],
    scamReports: async () => [],
    ...over,
  });
}
// Fully-offline stub for the composed extra sources: empty unless overridden.
function stubExtra(over = {}) {
  __setExtraSources({
    samExclusions: async () => [],
    fsisRecalls: async () => [],
    courtOpinions: async () => [],
    regulatorAlerts: async () => [],
    ...over,
  });
}

function resetAll() { __resetSources(); __resetExtraSources(); }

// Minimal mock req/res that captures status, headers, and the body passed to res.end().
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('home page: 200 with search box + the aggregated official sources', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /action="\/company"/);           // search box GETs /company
  assert.match(res.body, /name="q"/);
  assert.match(res.body, /SAM\.gov federal exclusions/);   // a composed source is advertised
  assert.match(res.body, /Facts, not verdicts/);           // the discipline banner
});

test('company report: renders official facts each WITH a source link', async () => {
  stubEngine({
    cfpbComplaints: async () => [F({ source: 'CFPB', sourceUrl: 'https://www.consumerfinance.gov/complaint', title: 'Billing dispute', detail: 'unresolved' })],
  });
  stubExtra({
    samExclusions: async () => [F({ source: 'SAM.gov Exclusions', sourceUrl: 'https://sam.gov/search/?index=ex', title: 'Federal exclusion: Ineligible', detail: 'Debarred by GSA' })],
  });
  const html = await companyPage('Acme Corp');
  resetAll();
  assert.match(html, /Official records/);
  assert.match(html, /CFPB/);
  assert.match(html, /Billing dispute/);
  assert.match(html, /href="https:\/\/www\.consumerfinance\.gov\/complaint"/);
  assert.match(html, /SAM\.gov Exclusions/);               // the COMPOSED source shows up as a fact
  assert.match(html, /href="https:\/\/sam\.gov\/search\/\?index=ex"/);
});

test('companyReport: Clarity summarizes the UNION of engine + composed records', async () => {
  stubEngine({ cfpbComplaints: async () => [F({ source: 'CFPB' })] });          // 1 engine record
  stubExtra({ samExclusions: async () => [F({ source: 'SAM.gov Exclusions' }), F({ source: 'SAM.gov Exclusions' })] }); // 2 composed
  const page = await companyReport('Acme Corp');
  resetAll();
  assert.equal(page.officialRecords.length, 3);
  assert.equal(page.clarity.officialRecordCount, 3);       // recomputed over the union
  assert.equal(page.clarity.basis, 'official-records-only');
});

test('assertNoVerdict passes on an assembled report (no platform verdict ever ships)', async () => {
  stubEngine({ cfpbComplaints: async () => [F({ source: 'CFPB', title: 'complaint' })] });
  stubExtra({ courtOpinions: async () => [F({ source: 'CourtListener', title: 'Doe v. Acme' })] });
  const page = await companyReport('Acme Corp');
  resetAll();
  assert.doesNotThrow(() => assertNoVerdict(page)); // the runtime guarantee
  assert.equal(page.clarity.basis, 'official-records-only');
  assert.ok(!('verdict' in page) && !('label' in page.clarity));
});

test('user scam report is labeled USER-SUBMITTED / UNVERIFIED, not a platform claim', async () => {
  stubEngine();
  stubExtra();
  const html = await companyPage('Acme Corp', { report: 'they never shipped my order', handle: 'buyer99' });
  resetAll();
  assert.match(html, /USER-SUBMITTED \/ UNVERIFIED/);
  assert.match(html, /they never shipped my order/);
  assert.match(html, /buyer99/);
  // The user text must NOT be presented as the platform's official record.
  assert.doesNotMatch(html, /Official records \(facts\)[\s\S]*they never shipped my order[\s\S]*<\/ul>\s*<p class="disclaimer"/);
});

test('empty sources: honest "no records" message, never an error', async () => {
  stubEngine();  // everything empty
  stubExtra();
  const html = await companyPage('Nobody Business');
  resetAll();
  assert.match(html, /No official records found\./);
  assert.doesNotMatch(html, /error/i);
});

test('soft-fail: a throwing reader yields an empty section, page still renders', async () => {
  stubEngine({ cfpbComplaints: async () => { throw new Error('CFPB down'); } });
  stubExtra({ samExclusions: async () => { throw new Error('SAM down'); } });
  const page = await companyReport('Acme Corp');
  resetAll();
  assert.equal(page.officialRecords.length, 0);
  assert.doesNotThrow(() => assertNoVerdict(page));
});

test('XSS: a hostile company name and user report are escaped', async () => {
  stubEngine();
  stubExtra();
  const html = await companyPage('<script>alert(1)</script>Evil Co', { report: '<img src=x onerror=alert(2)>' });
  resetAll();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;script&gt;/);                    // escaped form is present
});

test('real fsis-recalls reader wired via its own __setFetch seam', async () => {
  fsis.__setFetch(async () => ({
    ok: true,
    json: async () => ([{
      field_title: 'Acme Foods recalls ground beef',
      field_recall_date: '2026-02-10',
      field_recall_reason: 'Possible E. coli contamination',
      field_establishment: 'Acme Foods',
    }]),
  }));
  stubEngine();
  // Override only the OTHER three extras (empty); omit fsisRecalls so __setExtraSources keeps its real
  // default adapter, which calls the fsis reader → exercises the __setFetch seam above.
  __setExtraSources({
    samExclusions: async () => [],
    courtOpinions: async () => [],
    regulatorAlerts: async () => [],
  });
  const page = await companyReport('Acme Foods');
  fsis.__setFetch(null);
  resetAll();
  const fsisRec = page.officialRecords.find((r) => r.source === 'USDA FSIS');
  assert.ok(fsisRec, 'FSIS fact composed from the real reader');
  assert.match(fsisRec.title, /ground beef/);
  assert.doesNotThrow(() => assertNoVerdict(page));
});

test('routing: /company?q= renders a report (200)', async () => {
  stubEngine({ cfpbComplaints: async () => [F({ source: 'CFPB', title: 'complaint' })] });
  stubExtra();
  const res = await get('/company?q=Acme%20Corp');
  resetAll();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Acme Corp/);
  assert.match(res.body, /Official records/);
});

test('routing: /company with no q redirects home (302)', async () => {
  const res = await get('/company');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('routing: /company/<slug> resolves the slug to a name', async () => {
  stubEngine();
  stubExtra();
  const res = await get('/company/acme-corp');
  resetAll();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Acme Corp/i);
  assert.equal(slugify('Acme Corp!'), 'acme-corp');
});

test('robots.txt served', async () => {
  const res = await get('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Sitemap:/);
});

test('sitemap.xml + sitemap-index.xml served as XML', async () => {
  const sm = await get('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset/);
  const idx = await get('/sitemap-index.xml');
  assert.equal(idx.statusCode, 200);
  assert.match(idx.body, /<sitemapindex/);
});

test('llms.txt describes the facts-not-verdicts stance', async () => {
  const res = await get('/llms.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /never a verdict/i);
});

test('health probe returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});
