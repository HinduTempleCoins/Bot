// health-providers.test.mjs — offline suite for the SoapBox Health-Providers vertical.
// Fully offline: the engine's fetch seam (hp.__setFetch) is injected with canned Care-Compare rows;
// the handler is driven with a mock req/res. No network, soft-fail-never-throw, esc() everywhere.
//   node --test site/health-providers/health-providers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, hospitalView, compareView, esc, SITEMAP_PATHS } from './server.mjs';
import * as hp from '../../integrations/soapbox/health-providers.mjs';

// ── mock req/res ────────────────────────────────────────────────────────────────────────────────
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

// A canned Care-Compare row (Provider Data Catalog "Hospital General Information" shape).
const cannedRow = (over = {}) => ({
  facility_id: '360180',
  facility_name: 'MERCY GENERAL HOSPITAL',
  hospital_overall_rating: '4',
  hospital_type: 'Acute Care Hospitals',
  hospital_ownership: 'Voluntary non-profit - Private',
  emergency_services: 'Yes',
  mortality_national_comparison: 'Above the national average',
  ...over,
});
// A fetch stub returning the given rows (Provider Data Catalog returns a bare array).
const fetchRows = (rows) => async () => ({ ok: true, json: async () => rows });

// ── 1. home 200 + content ─────────────────────────────────────────────────────────────────────────
test('home returns 200 with search + Medicare-not-ours framing', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /SoapBox Health Providers/);
  assert.match(res.body, /form/);
  assert.match(res.body, /not a SoapBox rating/i);
  assert.match(res.body, /Not medical advice/i);
});

// ── 2. homePage() unit ──────────────────────────────────────────────────────────────────────────
test('homePage renders NPI + Care Compare provenance', () => {
  const html = homePage();
  assert.match(html, /NPI Registry/);
  assert.match(html, /Medicare Care Compare/);
});

// ── 3. /hospital?q= renders official rating + Medicare-source disclaimer ─────────────────────────────
test('/hospital renders the official star rating with a CMS-source, not-ours disclaimer', async () => {
  hp.__setFetch(fetchRows([cannedRow()]));
  const res = await get('/hospital?q=Mercy%20General');
  hp.__setFetch(); // restore
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /MERCY GENERAL HOSPITAL/);
  assert.match(res.body, /Overall star rating/);
  assert.match(res.body, /4/);
  assert.match(res.body, /official CMS figures, not a SoapBox rating/i);
  assert.match(res.body, /Not medical advice/i);
  assert.match(res.body, /Medicare Care Compare/);
});

// ── 4. hospitalView with injected quality (no fetch) ──────────────────────────────────────────────
test('hospitalView renders injected quality data', async () => {
  const view = await hospitalView('Somewhere', {
    quality: { name: 'ACME HOSPITAL', measures: [{ label: 'Overall star rating', value: '5' }],
      source: 'Medicare Care Compare (CMS)', sourceUrl: 'https://www.medicare.gov/care-compare/' },
  });
  assert.match(view.html, /ACME HOSPITAL/);
  assert.match(view.html, /Overall star rating/);
  assert.match(view.html, /not a SoapBox rating/i);
});

// ── 5. empty result is honest, still renders banners ──────────────────────────────────────────────
test('/hospital with no match soft-fails honestly (no throw, banner present)', async () => {
  hp.__setFetch(fetchRows([])); // no rows
  const res = await get('/hospital?q=Nonexistent%20Clinic');
  hp.__setFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No providers found/i);
  assert.match(res.body, /Not medical advice/i);
});

// ── 6. /hospital with no q shows the lookup prompt, not an error ───────────────────────────────────
test('/hospital without q shows the search prompt', async () => {
  const res = await get('/hospital');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Hospital lookup/);
  assert.match(res.body, /form/);
});

// ── 7. /compare lines up official measures and declares NO winner ─────────────────────────────────
test('/compare renders side-by-side official measures with no winner', async () => {
  const view = await compareView(['A', 'B'], {
    list: [
      { id: '1', name: 'ALPHA HOSPITAL', measures: [{ label: 'Overall star rating', value: '3' }] },
      { id: '2', name: 'BETA HOSPITAL', measures: [{ label: 'Overall star rating', value: '5' }] },
    ],
  });
  assert.match(view.html, /ALPHA HOSPITAL/);
  assert.match(view.html, /BETA HOSPITAL/);
  assert.match(view.html, /Side-by-side/i);
  assert.match(view.html, /No .*best.* ranking is implied|no winner implied/i);
});

// ── 8. /compare route via fetch seam ──────────────────────────────────────────────────────────────
test('/compare route fetches and renders both hospitals', async () => {
  hp.__setFetch(fetchRows([cannedRow({ facility_id: '100', facility_name: 'NORTH HOSPITAL' })]));
  const res = await get('/compare?q=North&q=South');
  hp.__setFetch();
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /NORTH HOSPITAL/);
  assert.match(res.body, /Not medical advice/i);
});

// ── 9. /compare with no q shows the compare prompt ────────────────────────────────────────────────
test('/compare without q shows the compare prompt', async () => {
  const res = await get('/compare');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Compare hospitals/);
  assert.match(res.body, /no winner|declare no winner/i);
});

// ── 10. XSS: interpolated query is escaped ────────────────────────────────────────────────────────
test('XSS-escape: a malicious query is HTML-escaped, not injected', async () => {
  const res = await get('/hospital?q=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;/);
});

// ── 11. esc() unit ────────────────────────────────────────────────────────────────────────────────
test('esc escapes all HTML-significant characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

// ── 12. robots.txt ────────────────────────────────────────────────────────────────────────────────
test('/robots.txt is served as text', async () => {
  const res = await get('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.match(res.body, /[Ss]itemap/);
});

// ── 13. sitemap.xml + sitemap-index.xml ───────────────────────────────────────────────────────────
test('/sitemap.xml and /sitemap-index.xml serve XML', async () => {
  const sm = await get('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset/);
  for (const p of SITEMAP_PATHS) assert.ok(sm.body.includes(p === '/' ? '/</loc>' : p) || sm.body.includes(p));
  const idx = await get('/sitemap-index.xml');
  assert.equal(idx.statusCode, 200);
  assert.match(idx.headers['content-type'], /xml/);
});

// ── 14. llms.txt ──────────────────────────────────────────────────────────────────────────────────
test('/llms.txt describes the site and the not-our-rating discipline', async () => {
  const res = await get('/llms.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SoapBox Health Providers/);
  assert.match(res.body, /NOT a SoapBox rating/i);
});

// ── 15. /health ───────────────────────────────────────────────────────────────────────────────────
test('/health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

// ── 16. unknown route → home (302) ────────────────────────────────────────────────────────────────
test('unknown route redirects to home', async () => {
  const res = await get('/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── 17. handler never throws on a garbage request ─────────────────────────────────────────────────
test('handler soft-fails on a broken request without throwing', async () => {
  const res = mockRes();
  await assert.doesNotReject(handler({ url: '/hospital?q=%', method: 'GET' }, res));
  assert.ok(res.statusCode); // some response written
});
