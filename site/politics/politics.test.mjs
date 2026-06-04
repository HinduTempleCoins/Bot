// politics.test.mjs — offline tests for the Politics.SoapBox portal. Fully offline: the reader modules
// expose a __setFetch seam, so we inject a fake/throwing fetch and drive the exported handler through a
// mock req/res — no port is bound and no real network call is ever made. The accountability view takes
// INJECTED records directly (accountabilityView is exported with a records arg), so its graph is built
// from canned data. We assert: every route serves 200 (soft-fail, never 500), HTML is escaped, each
// reader-backed route soft-fails to an honest empty-state, the Politics↔Law cross-links are present (a
// judge → law.soapbox.community/judges?q=…; a politician → /money?q=…), the facts-not-verdicts /
// right-of-reply / not-advice footer is on every page, noindex on query pages, and health/robots/sitemap
// respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as congress from '../../integrations/soapbox/congress-legislators.mjs';
import * as electionsInfo from '../../integrations/soapbox/elections-info.mjs';
import * as lobbying from '../../integrations/soapbox/lobbying-lda.mjs';
import * as fec from '../../integrations/soapbox/fec.mjs';

import {
  handler, homePage, relatedOn, repsView, electionsView, lobbyingView, moneyView, accountabilityView,
  esc, HAS_FEC,
} from './server.mjs';

// ── fetch fakes ─────────────────────────────────────────────────────────────────────────────────
function jsonResponse(obj, ok = true, status = 200) {
  return { ok, status, json: async () => obj };
}
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
  congress.__setFetch(fn); electionsInfo.__setFetch(fn); lobbying.__setFetch(fn); fec.__setFetch(fn);
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

// the content routes that exist regardless of whether /money is mounted
const CORE_ROUTES = ['/reps', '/elections', '/lobbying', '/accountability'];
const ALL_ROUTES = HAS_FEC ? [...CORE_ROUTES, '/money'] : CORE_ROUTES;

// ── 1. routes serve ────────────────────────────────────────────────────────────────────────────
test('home route serves 200 HTML with all sections', async () => {
  const res = await drive('/');
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SoapBox Politics/);
  for (const sec of CORE_ROUTES) {
    assert.ok(res.body.includes(`href="${sec}"`), `home links ${sec}`);
  }
});

test('every content route serves 200 even with the network down (soft-fail, no 500)', async () => {
  for (const p of ALL_ROUTES) {
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
  assert.match(s.body, /<urlset/); assert.ok(s.body.includes('/reps') && s.body.includes('/accountability'));
  resetAllFetch();
});

test('llms.txt and sitemap-index respond', async () => {
  const l = await drive('/llms.txt'); assert.equal(l.statusCode, 200); assert.match(l.body, /SoapBox Politics/);
  const si = await drive('/sitemap-index.xml'); assert.equal(si.statusCode, 200); assert.match(si.body, /sitemapindex|<sitemap/);
  resetAllFetch();
});

test('unknown route 302-redirects home', async () => {
  const res = await drive('/nonsense');
  resetAllFetch();
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── 2. footer / disclaimer discipline on every page ──────────────────────────────────────────────
test('every page carries facts-not-verdicts + not-advice + right-of-reply + no-score', async () => {
  for (const p of ['/', ...ALL_ROUTES]) {
    const res = await drive(p);
    assert.match(res.body, /Facts, not verdicts/, `${p} footer`);
    assert.match(res.body, /not\s+legal,?\s+electoral,?\s+or\s+financial advice|not legal/i, `${p} disclaimer`);
    assert.match(res.body, /right of\s+reply/i, `${p} right-of-reply`);
    assert.match(res.body, /no score, no rating/i, `${p} no-score`);
  }
  resetAllFetch();
});

// ── 3. noindex on query pages ────────────────────────────────────────────────────────────────────
test('query pages are noindex,follow; bare pages index,follow', async () => {
  const bare = await drive('/reps');
  assert.match(bare.body, /name=robots content="index,follow/);
  const queried = await drive('/reps?q=Warren');
  assert.match(queried.body, /name=robots content="noindex,follow"/);
  resetAllFetch();
});

// ── 4. escaping ──────────────────────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<script>"&"</script>'), '&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
});

test('a malicious query is escaped in rendered views (no raw tag)', async () => {
  setAllFetch(throwingFetch);
  const reps = await repsView('<img src=x onerror=alert(1)>', '');
  const lob = await lobbyingView('<svg onload=alert(1)>');
  const acc = accountabilityView('<b>boom</b>');
  resetAllFetch();
  for (const html of [reps, lob, acc]) {
    assert.ok(!html.includes('<img src=x'), 'no raw img');
    assert.ok(!html.includes('<svg onload'), 'no raw svg');
    assert.ok(!html.includes('<b>boom</b>'), 'no raw b');
  }
  assert.match(reps, /&lt;img src=x/);
});

// ── 5. relatedOn() — THE cross-site web (Politics ↔ Law) ──────────────────────────────────────────
test('relatedOn() links a judge to their opinions on Law.SoapBox', () => {
  const html = relatedOn({ name: 'Thurgood Marshall', role: 'judge' });
  assert.match(html, /law\.soapbox\.community\/judges\?q=Thurgood/);
  assert.match(html, /opinions on Law\.SoapBox/i);
});

test('relatedOn() infers judge from a court office', () => {
  const html = relatedOn({ name: 'Pat Justice', office: 'U.S. Court of Appeals for the Ninth Circuit' });
  assert.match(html, /law\.soapbox\.community\/judges\?q=Pat/);
});

test('relatedOn() links a politician with finance to /money', () => {
  const html = relatedOn({ name: 'Elizabeth Warren', chamber: 'Senate', party: 'Democrat' });
  if (HAS_FEC) {
    assert.match(html, /\/money\?q=Elizabeth/);
  }
});

test('relatedOn() emits nothing for an entity with no name or no signals', () => {
  assert.equal(relatedOn({}), '');
  assert.equal(relatedOn({ name: '' }), '');
  assert.equal(relatedOn({ name: 'Some Civilian' }), HAS_FEC ? '' : '');
});

// ── 6. /reps — congress lookup soft-fails honestly + cross-links ──────────────────────────────────
test('reps soft-fails to an honest empty-state with the source link when the dataset is down', async () => {
  setAllFetch(throwingFetch);
  const html = await repsView('Warren', '');
  resetAllFetch();
  assert.match(html, /No members found/);
  assert.match(html, /congress-legislators/);
});

test('reps renders members and cross-links a member to /money (Politics↔money)', async () => {
  if (!HAS_FEC) return; // /money cross-link only when fec is wired
  setAllFetch(fakeFetch([
    ['legislators-current.json', jsonResponse([
      { id: { bioguide: 'W000817' }, name: { first: 'Elizabeth', last: 'Warren', official_full: 'Elizabeth Warren' },
        terms: [{ type: 'sen', state: 'MA', party: 'Democrat', start: '2013-01-03', end: '2025-01-03' }] },
    ])],
  ]));
  const html = await repsView('Warren', '');
  resetAllFetch();
  assert.match(html, /Elizabeth Warren/);
  assert.match(html, /Senate/);
  assert.match(html, /\/money\?q=Elizabeth/, 'member row cross-links the money page');
});

test('reps lists a delegation when a 2-letter state code is entered', async () => {
  setAllFetch(fakeFetch([
    ['legislators-current.json', jsonResponse([
      { id: { bioguide: 'A000001' }, name: { first: 'Ada', last: 'Aye', official_full: 'Ada Aye' },
        terms: [{ type: 'rep', state: 'CA', district: 12, party: 'Democrat', start: '2023-01-03', end: '2025-01-03' }] },
      { id: { bioguide: 'B000002' }, name: { first: 'Bo', last: 'Bee', official_full: 'Bo Bee' },
        terms: [{ type: 'sen', state: 'NY', party: 'Republican', start: '2021-01-03', end: '2027-01-03' }] },
    ])],
  ]));
  const html = await repsView('CA', '');
  resetAllFetch();
  assert.match(html, /from CA/);
  assert.match(html, /Ada Aye/);
  assert.ok(!/Bo Bee/.test(html), 'NY member filtered out of CA delegation');
});

// ── 7. /elections — calendar always renders + local-office pointer + soft-fail ballot ─────────────
test('elections always renders the next-election calendar + the local election office pointer', async () => {
  const res = await drive('/elections');
  resetAllFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Next general election/);
  assert.match(res.body, /Find your local election office/);
  assert.match(res.body, /usa\.gov|USA\.gov/i);
});

test('elections with an address soft-fails to the office pointer when no key/data', async () => {
  setAllFetch(throwingFetch);
  const html = await electionsView('1600 Pennsylvania Ave');
  resetAllFetch();
  assert.match(html, /Voting information/);
  assert.match(html, /No voter information is available/);
});

// ── 8. /lobbying — disclosures soft-fail + render ─────────────────────────────────────────────────
test('lobbying soft-fails to an honest empty-state pointing at the LDA database', async () => {
  setAllFetch(throwingFetch);
  const html = await lobbyingView('Boeing');
  resetAllFetch();
  assert.match(html, /No lobbying disclosures found/);
  assert.match(html, /lda\.senate\.gov/);
});

test('lobbying renders disclosed filings as facts (registrant/client/issue/$), no verdict', async () => {
  setAllFetch(fakeFetch([
    ['/filings/', jsonResponse({
      results: [{
        filing_uuid: 'abc-123', filing_year: 2024, filing_period_display: 'Q1',
        registrant: { name: 'BigLobby LLC' }, client: { name: 'AcmeCorp' },
        lobbying_activities: [{ general_issue_code_display: 'Energy' }],
        income: 50000, filing_document_url: 'https://lda.senate.gov/filings/public/filing/abc-123/print/',
      }],
    })],
  ]));
  const html = await lobbyingView('Acme');
  resetAllFetch();
  assert.match(html, /BigLobby LLC/);
  assert.match(html, /AcmeCorp/);
  assert.match(html, /Energy/);
  assert.match(html, /50,000/);
});

// ── 9. /money — campaign finance (only when fec wired) ────────────────────────────────────────────
test('money search soft-fails honestly + detail view renders totals when fec is wired', async () => {
  if (!HAS_FEC) return;
  setAllFetch(throwingFetch);
  const empty = await moneyView('Warren', '');
  assert.match(empty, /No FEC candidates found/);
  assert.match(empty, /fec\.gov/i);

  setAllFetch(fakeFetch([
    ['/candidate/S0MA00170/totals/', jsonResponse({ results: [{ candidate_id: 'S0MA00170', cycle: 2024, receipts: 1000000, disbursements: 500000, last_cash_on_hand_end_period: 500000 }] })],
    ['/candidate/S0MA00170/committees/', jsonResponse({ results: [] })],
    ['/candidate/S0MA00170/', jsonResponse({ results: [{ candidate_id: 'S0MA00170', name: 'WARREN, ELIZABETH', party_full: 'DEMOCRATIC PARTY', office_full: 'Senate', state: 'MA' }] })],
  ]));
  const detail = await moneyView('', 'S0MA00170');
  resetAllFetch();
  assert.match(detail, /WARREN, ELIZABETH/);
  assert.match(detail, /2024/);
  assert.match(detail, /Campaign finance — public record/);
});

// ── 10. /accountability — sourced power-map + Politics↔Law cross-link for judges ──────────────────
test('accountability soft-fails to an honest empty-state (never fabricates connections)', () => {
  const html = accountabilityView('Some Politician');
  assert.match(html, /No sourced connections are loaded/);
  assert.match(html, /never fabricate a connection/);
});

test('accountability builds a sourced map from injected records and cross-links a judge to Law.SoapBox', () => {
  const records = [
    { type: 'ruling', judge: 'Hon. Pat Justice', caseName: 'AcmeCorp v. State', court: 'ca9',
      disposition: 'affirmed', dateFiled: '2023-09-01', source: 'CourtListener', url: 'https://www.courtlistener.com/op/1' },
  ];
  const html = accountabilityView('Hon. Pat Justice', records);
  assert.match(html, /Power-map: Hon\. Pat Justice/);
  assert.match(html, /AcmeCorp v\. State/);          // the sourced ruling appears
  assert.match(html, /courtlistener\.com/);          // every claim links its source
  assert.match(html, /law\.soapbox\.community\/judges\?q=/, 'judge cross-links opinions on Law.SoapBox');
  assert.match(html, /Connected to the law/);
});

test('accountability renders the no-verdicts discipline line on a real map', () => {
  const records = [
    { type: 'donation', contributor: 'Jane Donor', recipient: 'Friends of Smith PAC', amount: 2800,
      date: '2024-03-01', source: 'OpenFEC', url: 'https://www.fec.gov/x' },
  ];
  const html = accountabilityView('Jane Donor', records);
  assert.match(html, /we do not render verdicts/i);
  assert.match(html, /Jane Donor/);
});
