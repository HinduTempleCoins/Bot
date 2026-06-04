// law.test.mjs — offline tests for the Law.SoapBox portal (operator 2026-06-03). Fully offline: the
// underlying readers expose a __setFetch seam, so we inject a fake fetch (returning canned JSON, or
// throwing/404 for the soft-fail cases) and drive the exported handler through a mock req/res — no port
// is bound and no real network call is ever made. We assert: every route serves 200, HTML is escaped,
// each reader-backed route soft-fails to an empty-state (never throws / never 500s), the citation path
// resolves "347 U.S. 483", the U.S.C. parser routes to official links, the case↔judge cross-links are
// present, jurisdiction-prefix routing works, and health/robots/sitemap respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as opinions from '../../integrations/soapbox/courtlistener-opinions.mjs';
import * as cap from '../../integrations/soapbox/caselaw-cap.mjs';
import * as ecfr from '../../integrations/soapbox/ecfr.mjs';
import * as fedreg from '../../integrations/soapbox/federal-register.mjs';
import * as judges from '../../integrations/soapbox/courtlistener-judges.mjs';

import {
  handler, casesView, caseDetailView, docketsView, statutesView, judgesView, lawyersView, complaintsView,
  looksLikeCitation, splitJurisdiction, publicInterestData, browseByCourt, esc,
} from './server.mjs';

// ── fetch fakes ─────────────────────────────────────────────────────────────────────────────────
function jsonResponse(obj, ok = true, status = 200) {
  return { ok, status, json: async () => obj };
}
// A fetch that dispatches on URL substring → canned JSON. Anything unmatched returns a soft 404.
function fakeFetch(routes) {
  return async (u) => {
    const url = String(u);
    for (const [needle, payload] of routes) {
      if (url.includes(needle)) return typeof payload === 'function' ? payload(url) : payload;
    }
    return jsonResponse(null, false, 404);
  };
}
const throwingFetch = async () => { throw new Error('network down'); };

function setAllFetch(fn) {
  opinions.__setFetch(fn); cap.__setFetch(fn); ecfr.__setFetch(fn);
  fedreg.__setFetch(fn); judges.__setFetch(fn);
}
function resetAllFetch() { setAllFetch(undefined); }

// ── mock req/res ──────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });
async function drive(urlPath) {
  setAllFetch(throwingFetch); // default: everything soft-fails unless a test overrides first
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

// ── 1. routes serve ────────────────────────────────────────────────────────────────────────────
test('home route serves 200 HTML with all sections', async () => {
  const res = await drive('/');
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SoapBox Law/);
  for (const sec of ['/cases', '/dockets', '/statutes', '/regulations', '/judges', '/lawyers', '/complaints']) {
    assert.ok(res.body.includes(`href="${sec}"`), `home links ${sec}`);
  }
});

// ── 1b. browse-by-court + dockets (court-organized front page, Justia-style dockets) ───────────────
test('home page shows a Browse-by-court section with SCOTUS + a circuit link', async () => {
  const res = await drive('/');
  resetAllFetch();
  assert.match(res.body, /Browse by court/);
  // SCOTUS prominent + at least one circuit, both linking /cases?court=<slug>
  assert.ok(res.body.includes('/cases?court=scotus'), 'home links SCOTUS browse');
  assert.ok(res.body.includes('/cases?court=ca9'), 'home links a circuit (9th)');
  assert.match(res.body, /Circuit Courts of Appeals/);
});

test('browseByCourt() lists SCOTUS + all 13 circuits and points at docket search for district courts', () => {
  const html = browseByCourt();
  assert.ok(html.includes('/cases?court=scotus'));
  for (const slug of ['ca1', 'ca11', 'cadc', 'cafc']) {
    assert.ok(html.includes(`/cases?court=${slug}`), `circuit ${slug} linked`);
  }
  assert.match(html, /docket search|\/dockets/);
});

test('/cases?court=scotus renders the court header and lists recent opinions (dateFiled desc)', async () => {
  const sink = {};
  setAllFetch(async (u) => { sink.url = String(u); return jsonResponse({
    results: [{ cluster_id: 222, caseName: 'Recent SCOTUS Case', court: 'scotus', dateFiled: '2024-06-01', citeCount: 3, status: 'Published' }],
  }); });
  const html = await casesView('', 'scotus');
  resetAllFetch();
  assert.match(html, /Recent opinions — Supreme Court/);
  assert.match(html, /Recent SCOTUS Case/);
  assert.match(sink.url, /court=scotus/);
  assert.match(sink.url, /order_by=dateFiled\+desc/);
});

test('/cases with NO term and NO court renders the Browse-by-court grid inside the tab', async () => {
  setAllFetch(throwingFetch);
  const html = await casesView('', '');
  resetAllFetch();
  assert.match(html, /Browse by court/);
  assert.ok(html.includes('/cases?court=scotus'));
});

test('the /cases?court=scotus route serves a 200 noindex page with the court header', async () => {
  opinions.__setFetch(async () => jsonResponse({
    results: [{ cluster_id: 222, caseName: 'Recent SCOTUS Case', court: 'scotus', dateFiled: '2024-06-01', citeCount: 3, status: 'Published' }],
  }));
  const res = mockRes();
  await handler(req('/cases?court=scotus'), res);
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /noindex,follow/);
  assert.match(res.body, /Recent opinions — Supreme Court/);
});

test('docketsView renders injected RECAP docket rows (case name, number, court, judge)', async () => {
  setAllFetch(fakeFetch([
    ['/search/', jsonResponse({ results: [{
      docket_id: 777, caseName: 'Roe v. Acme', docketNumber: '3:22-cv-00099', court: 'cand',
      dateFiled: '2022-01-04', dateTerminated: '2023-03-10', nature_of_suit: 'Contract',
      assigned_to_str: 'Hon. A. Judge', absolute_url: '/docket/777/roe-v-acme/',
    }] })],
  ]));
  const html = await docketsView('acme', '');
  resetAllFetch();
  assert.match(html, /Roe v\. Acme/);
  assert.match(html, /3:22-cv-00099/);
  assert.match(html, /Hon\. A\. Judge/);
  assert.match(html, /\/docket\/777\//);
  assert.match(html, /Party, docket number, or case/);
});

test('docketsView soft-fails to an empty-state when RECAP is down (no throw)', async () => {
  setAllFetch(throwingFetch);
  const html = await docketsView('nothing here', '');
  resetAllFetch();
  assert.match(html, /No docket records found/);
  assert.match(html, /courtlistener\.com/);
});

test('the /dockets route serves 200 (noindex on query) with docket rows', async () => {
  opinions.__setFetch(fakeFetch([
    ['/search/', jsonResponse({ results: [{ docket_id: 5, caseName: 'X v. Y', docketNumber: '1:20', court: 'nysd', dateFiled: '2020-01-01' }] })],
  ]));
  const res = mockRes();
  await handler(req('/dockets?q=x'), res);
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /noindex,follow/);
  assert.match(res.body, /X v\. Y/);
});

test('/dockets with no query serves an indexable landing (the search box, no rows)', async () => {
  const res = await drive('/dockets');
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Party, docket number, or case/);
  assert.match(res.body, /index,follow/);
});

test('every content route serves 200 even with the network down (soft-fail, no 500)', async () => {
  for (const p of ['/cases', '/statutes', '/regulations', '/judges', '/lawyers', '/complaints']) {
    const res = await drive(p);
    assert.equal(res.statusCode, 200, `${p} serves 200`);
    assert.ok(res.body.length > 200, `${p} renders a body`);
  }
  resetAllFetch();
});

test('health, robots.txt, and sitemap.xml respond', async () => {
  const h = await drive('/health'); assert.equal(h.statusCode, 200); assert.equal(h.body, 'ok');
  const r = await drive('/robots.txt'); assert.equal(r.statusCode, 200); assert.match(r.body, /Sitemap:/);
  const s = await drive('/sitemap.xml'); assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/); assert.ok(s.body.includes('/cases'));
  resetAllFetch();
});

test('every page carries the facts-not-verdicts footer + right-of-reply', async () => {
  const res = await drive('/');
  resetAllFetch();
  assert.match(res.body, /Facts, not verdicts/);
  assert.match(res.body, /Right of reply/);
  assert.match(res.body, /public domain/i);
  assert.match(res.body, /not\s+legal advice/i);
});

// ── 2. escaping ──────────────────────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<script>"&"</script>'), '&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
});

test('a malicious query is escaped in the rendered cases page (no raw tag)', async () => {
  setAllFetch(throwingFetch);
  const html = await casesView('<img src=x onerror=alert(1)>');
  resetAllFetch();
  assert.ok(!html.includes('<img src=x'), 'no raw injected tag');
  assert.match(html, /&lt;img src=x/);
});

// ── 3. citation parsing + resolve path ───────────────────────────────────────────────────────────
test('looksLikeCitation distinguishes a reporter citation from free text', () => {
  assert.ok(looksLikeCitation('347 U.S. 483'));
  assert.ok(looksLikeCitation('98 F.3d 1010'));
  assert.ok(!looksLikeCitation('qualified immunity'));
  assert.ok(!looksLikeCitation('Brown v. Board'));
});

test('"347 U.S. 483" resolves to a case via the CAP citation path', async () => {
  // Feed CAP's /cases/?cite=… a Brown v. Board record.
  setAllFetch(fakeFetch([
    ['api.case.law', jsonResponse({
      results: [{
        id: 12345, name_abbreviation: 'Brown v. Board of Education',
        decision_date: '1954-05-17', citations: [{ cite: '347 U.S. 483' }],
        court: { name_abbreviation: 'U.S.' }, frontend_url: 'https://case.law/caselaw/?case=12345',
        casebody: { data: { opinions: [{ text: 'Separate educational facilities are inherently unequal.' }] } },
      }],
    })],
  ]));
  const html = await casesView('347 U.S. 483');
  resetAllFetch();
  assert.match(html, /Brown v\. Board of Education/);
  assert.match(html, /347 U\.S\. 483/);
  assert.match(html, /case\.law/);
});

test('an unresolved citation soft-fails to an empty-state with the CAP look-up link', async () => {
  setAllFetch(fakeFetch([['api.case.law', jsonResponse({ results: [] })]]));
  const html = await casesView('999 U.S. 999');
  resetAllFetch();
  assert.match(html, /No case found/);
  assert.match(html, /Caselaw Access Project/);
});

test('a U.S.C. citation routes to official OLRC + Cornell links (no gloss)', async () => {
  const html = await statutesView('18 U.S.C. § 2261A');
  assert.match(html, /18 U\.S\.C\. § 2261A/);
  assert.match(html, /uscode\.house\.gov/);
  assert.match(html, /law\.cornell\.edu/);
});

test('non-citation statute input falls through to an eCFR search (and soft-fails empty)', async () => {
  setAllFetch(throwingFetch);
  const html = await statutesView('clean water effluent');
  resetAllFetch();
  assert.match(html, /Code of Federal Regulations/);
  assert.match(html, /No matching regulations/);
});

// ── 3b. case DETAIL: the court's FULL verbatim opinion text (Justia-style) ────────────────────────
// A unique sentence repeated far past the 280-char snippet cap; the detail page must render the WHOLE
// thing, not a truncated snippet.
const FULL_OPINION = 'Separate educational facilities are inherently unequal. '.repeat(30);

test('caseDetailView (?id=) renders the FULL CourtListener opinion text, not a 280 snippet', async () => {
  setAllFetch(fakeFetch([
    ['/opinions/', jsonResponse({
      type: 'lead', plain_text: FULL_OPINION, absolute_url: '/opinion/118144/brown/',
      cluster: {
        id: 118144, case_name: 'Brown v. Board of Education', court: '.../courts/scotus/',
        date_filed: '1954-05-17', citations: [{ volume: '347', reporter: 'U.S.', page: '483' }],
      },
    })],
  ]));
  const html = await caseDetailView({ clId: '118144' });
  resetAllFetch();
  assert.match(html, /Brown v\. Board of Education/);
  assert.match(html, /The court's words/);
  assert.match(html, /<article class=opinion>/);
  // FULL text: the repeated sentence appears many times (far past a 280-char snippet, which would hold ~5).
  const occurrences = (html.match(/Separate educational facilities are inherently unequal/g) || []).length;
  assert.ok(occurrences >= 20, `full opinion rendered (${occurrences} occurrences, snippet would be ~5)`);
  // it is NOT a truncated snippet — no ellipsis cut.
  assert.ok(!html.includes('inherently unequal.…'), 'not truncated with an ellipsis');
  assert.match(html, /347 U\.S\. 483/);
  assert.match(html, /1954-05-17/);
  assert.match(html, /source:/);
  // discipline: the source's words, no holding-summary/verdict of ours.
  assert.match(html, /no holding-summary, headnote, or verdict/i);
});

test('caseDetailView (?cap=) renders the FULL CAP opinion text, not a snippet', async () => {
  const capBody = 'We conclude that the statute is unconstitutional as applied. '.repeat(30);
  setAllFetch(fakeFetch([
    ['api.case.law', jsonResponse({
      id: 12345, name_abbreviation: 'Doe v. State', decision_date: '1999-01-01',
      court: { name_abbreviation: 'Cal.' }, citations: [{ cite: '1 Cal. 1' }],
      frontend_url: 'https://case.law/caselaw/?case=12345',
      casebody: { data: { opinions: [{ text: capBody }] } },
    })],
  ]));
  const html = await caseDetailView({ capId: '12345' });
  resetAllFetch();
  assert.match(html, /Doe v\. State/);
  assert.match(html, /<article class=opinion>/);
  const occurrences = (html.match(/We conclude that the statute is unconstitutional/g) || []).length;
  assert.ok(occurrences >= 20, `full CAP opinion rendered (${occurrences} occurrences)`);
  assert.match(html, /case\.law/);
});

test('caseDetailView soft-fails to an empty-state when the source is down (no throw)', async () => {
  setAllFetch(throwingFetch);
  const html = await caseDetailView({ clId: '999999' });
  resetAllFetch();
  assert.match(html, /No opinion on record/);
});

test('the /cases?id= route serves a 200 noindex detail page with the full text', async () => {
  opinions.__setFetch(fakeFetch([
    ['/opinions/', jsonResponse({ type: 'lead', plain_text: FULL_OPINION, cluster: { id: 1, case_name: 'X v. Y', court: '.../courts/scotus/', date_filed: '2020-01-01', citations: [] } })],
  ]));
  const res = mockRes();
  await handler(req('/cases?id=1'), res);
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /noindex,follow/);
  assert.match(res.body, /<article class=opinion>/);
  const occurrences = (res.body.match(/Separate educational facilities are inherently unequal/g) || []).length;
  assert.ok(occurrences >= 20, `route renders the full opinion (${occurrences} occurrences)`);
});

test('the case list view links each row to the on-site full-opinion detail route', async () => {
  setAllFetch(fakeFetch([
    ['/search/', jsonResponse({
      results: [{ cluster_id: 111, caseName: 'United States v. Jones', court: 'scotus', dateFiled: '2012-01-23', citeCount: 500, status: 'Published' }],
    })],
  ]));
  const html = await casesView('gps tracking');
  resetAllFetch();
  assert.match(html, /\/cases\?id=111/, 'list row links the detail route by cluster id');
  assert.match(html, /read the full opinion/);
});

// ── 4. cross-links (the case-files ↔ judges connection) ──────────────────────────────────────────
test('a case search result cross-links to the judge lookup', async () => {
  setAllFetch(fakeFetch([
    ['/search/', jsonResponse({
      results: [{ cluster_id: 111, caseName: 'United States v. Jones', court: 'scotus', dateFiled: '2012-01-23', citeCount: 500, status: 'Published' }],
    })],
  ]));
  const html = await casesView('gps tracking');
  resetAllFetch();
  assert.match(html, /United States v\. Jones/);
  assert.match(html, /\/judges\?q=/, 'case row links a judge lookup');
});

test('a judge profile cross-links to a search of their opinions', async () => {
  setAllFetch(fakeFetch([
    ['/people/123/', jsonResponse({ id: 123, name_first: 'Thurgood', name_last: 'Marshall', positions: [] })],
    ['/positions/', jsonResponse({ results: [{ position_type: 'Justice', court_str: 'Supreme Court', date_start: '1967-10-02' }] })],
    ['/opinions/', jsonResponse({ count: 322, results: [] })],
    ['/financial-disclosures/', jsonResponse({ results: [] })],
  ]));
  const html = await judgesView('', '123');
  resetAllFetch();
  assert.match(html, /Thurgood Marshall/);
  assert.match(html, /\/cases\?q=/, 'judge profile links opinion search');
  assert.match(html, /322/, 'authored opinion count shown');
});

test('judge search with no hits soft-fails to an empty-state', async () => {
  setAllFetch(fakeFetch([['/people/', jsonResponse({ results: [] })]]));
  const html = await judgesView('zzznosuchname', '');
  resetAllFetch();
  assert.match(html, /No judges found/);
});

// ── 5. regulations + lawyers + complaints soft-fail / data ───────────────────────────────────────
test('regulations renders the agency tabs and soft-fails empty when FR is down', async () => {
  setAllFetch(throwingFetch);
  const res = await drive('/regulations?agency=securities-and-exchange-commission');
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SEC/);
  assert.match(res.body, /No recent Federal Register/);
});

test('lawyers search soft-fails (no public bar API) to the bar-referral path', async () => {
  const html = await lawyersView('Jane Smith', 'CA');
  assert.match(html, /No bar records available/);
  assert.match(html, /Bar referral/);
  assert.match(html, /americanbar\.org/);
});

test('complaints page renders the where-to-file public-interest links', () => {
  const html = complaintsView();
  assert.match(html, /File a complaint/);
  assert.match(html, /consumerfinance\.gov/);
  assert.match(html, /reportfraud\.ftc\.gov/);
  // pulls from lawyer-directory.PUBLIC_INTEREST when present
  const data = publicInterestData();
  assert.ok(Object.keys(data).length >= 3, 'three+ public-interest groups');
});

// ── 6. jurisdiction namespacing (extension plan) ─────────────────────────────────────────────────
test('splitJurisdiction strips a known /us/ prefix and defaults otherwise', () => {
  assert.deepEqual(splitJurisdiction('/us/cases'), { juris: 'us', path: '/cases' });
  assert.deepEqual(splitJurisdiction('/cases'), { juris: 'us', path: '/cases' });
  // an unknown two-letter prefix is NOT a jurisdiction → left intact for the (302) fallthrough
  assert.deepEqual(splitJurisdiction('/zz/cases'), { juris: 'us', path: '/zz/cases' });
});

test('a /us/cases jurisdiction-prefixed path serves the cases page', async () => {
  setAllFetch(throwingFetch);
  const res = await drive('/us/cases');
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1>Cases<\/h1>/);
});

test('unknown route 302-redirects home', async () => {
  const res = await drive('/nonsense');
  resetAllFetch();
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});
