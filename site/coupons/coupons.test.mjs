// coupons.test.mjs — offline tests for the Coupons.SoapBox portal. Fully offline: the coupons module's
// findCoupons takes an INJECTABLE fetch (offline → []) and storeView accepts canned coupons directly, so
// no real network call is ever made. We drive the exported handler through a mock req/res (no port bound)
// and assert: every route serves 200, HTML is escaped (XSS), the FTC affiliate disclosure is on every
// page, outbound merchant links carry the trackedLink/affiliate shape, sponsored coupons can't outrank
// organic, schema.org JSON-LD is emitted, the "deals change" disclaimer is present, and 404/unknown
// routes redirect home. health/robots/sitemap/llms respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, homePage, categoryView, storeView, findCategory, esc, CATEGORIES, SITEMAP_PATHS,
} from './server.mjs';

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
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

// ── 1. routes serve 200 ──────────────────────────────────────────────────────────────────────────
test('home route serves 200 HTML with category cards', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /SoapBox Coupons/);
  for (const c of CATEGORIES) {
    assert.ok(res.body.includes(`href="/c/${c.slug}"`), `home links /c/${c.slug}`);
  }
});

test('every category route serves 200 (soft-fail, no 500)', async () => {
  for (const c of CATEGORIES) {
    const res = await drive(`/c/${c.slug}`);
    assert.equal(res.statusCode, 200, `/c/${c.slug} serves 200`);
    assert.ok(res.body.length > 200, `/c/${c.slug} renders a body`);
    // each store links to its store page
    assert.match(res.body, /\/store\?store=/);
  }
});

test('store route serves 200 and soft-fails to honest "no coupons" offline', async () => {
  const res = await drive('/store?store=Nike');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Nike coupons/);
  // offline coupon source is empty → honest empty state, never a fabricated code
  assert.match(res.body, /No coupon codes are listed/);
  // cashback portals still render
  assert.match(res.body, /Rakuten/);
});

test('store route with no store shows the find form', async () => {
  const res = await drive('/store');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Find coupons/);
});

test('health, robots.txt, sitemap.xml, llms.txt respond', async () => {
  const h = await drive('/health'); assert.equal(h.statusCode, 200); assert.equal(h.body, 'ok');
  const r = await drive('/robots.txt'); assert.equal(r.statusCode, 200); assert.match(r.body, /Sitemap:/);
  const s = await drive('/sitemap.xml'); assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/);
  for (const c of CATEGORIES) assert.ok(s.body.includes(`/c/${c.slug}`), `sitemap has /c/${c.slug}`);
  const l = await drive('/llms.txt'); assert.equal(l.statusCode, 200); assert.match(l.body, /SoapBox Coupons/);
});

// ── 2. 404 / unknown handling ──────────────────────────────────────────────────────────────────────
test('unknown route 302-redirects home', async () => {
  const res = await drive('/nonsense/path');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('unknown category 302-redirects home', async () => {
  const res = await drive('/c/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
  assert.equal(findCategory('does-not-exist'), undefined);
});

// ── 3. escaping / XSS ────────────────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('a malicious store name is escaped, never reflected raw', async () => {
  const xss = '<img src=x onerror=alert(1)>';
  const res = await drive(`/store?store=${encodeURIComponent(xss)}`);
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('<img src=x onerror'), 'raw XSS payload not present');
  assert.match(res.body, /&lt;img src=x onerror/);
});

test('a malicious coupon discount field is escaped in the rendered row', async () => {
  const { html } = await storeView('TestStore', {
    coupons: [{ store: 'TestStore', type: 'code', code: 'SAVE10', discount: '<b>10%</b><script>x</script>' }],
  });
  assert.ok(!html.includes('<script>x</script>'), 'no raw script tag');
  assert.match(html, /&lt;b&gt;10%&lt;\/b&gt;/);
});

// ── 4. FTC affiliate disclosure on every page ──────────────────────────────────────────────────────
const DISCLOSURE_RE = /affiliate link|never sell your data|may earn a commission/i;

test('home, category, and store pages all carry an affiliate disclosure', async () => {
  for (const path of ['/', '/c/fashion', '/store?store=Nike']) {
    const res = await drive(path);
    assert.match(res.body, DISCLOSURE_RE, `${path} has the FTC disclosure`);
  }
});

test('store body specifically carries the FTC disclosure line', async () => {
  const { html } = await storeView('Nike');
  assert.match(html, /class=ftc-disclosure/);
  assert.match(html, /never sell your data/i);
});

// ── 5. outbound merchant links carry the trackedLink/affiliate shape ───────────────────────────────
test('store "shop" outbound is an affiliate-tracked link (works unmonetized)', async () => {
  const { html } = await storeView('Nike');
  // the primary outbound is rendered with rel="sponsored nofollow noopener"
  assert.match(html, /rel="sponsored nofollow noopener"/);
  // unmonetized pre-go-live: clearly labeled, link still present (never broken)
  assert.match(html, /Shop Nike →/);
});

test('cashback portal links are present and disclosed (rate read live at portal)', async () => {
  const { html } = await storeView('Nike');
  assert.match(html, /rate read live at portal/);
  assert.match(html, /Rakuten/);
});

// ── 6. honest ranking: sponsored can never outrank organic ─────────────────────────────────────────
test('a sponsored coupon is segregated below an organic one', async () => {
  const { html } = await storeView('Acme', {
    coupons: [
      { store: 'Acme', type: 'code', code: 'SPON', discount: '90% off', sponsored: true },
      { store: 'Acme', type: 'code', code: 'ORG', discount: '5% off' },
    ],
  });
  const iOrg = html.indexOf('ORG');
  const iSpon = html.indexOf('SPON');
  assert.ok(iOrg !== -1 && iSpon !== -1, 'both coupons render');
  assert.ok(iOrg < iSpon, 'organic appears before sponsored despite bigger sponsored discount');
});

// ── 7. schema.org JSON-LD ──────────────────────────────────────────────────────────────────────────
test('home emits Organization + WebSite JSON-LD', () => {
  const html = homePage();
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"Organization"/);
  assert.match(html, /"@type":"WebSite"/);
});

test('category page emits an ItemList of stores', () => {
  const cat = findCategory('fashion');
  const { jsonld } = categoryView(cat);
  assert.equal(jsonld['@type'], 'ItemList');
  assert.ok(jsonld.itemListElement.length === cat.stores.length);
  assert.equal(jsonld.itemListElement[0]['@type'], 'ListItem');
});

test('store page emits an ItemList of offers when coupons exist', async () => {
  const { jsonld } = await storeView('Acme', {
    coupons: [{ store: 'Acme', type: 'code', code: 'X', discount: '10% off' }],
  });
  assert.equal(jsonld['@type'], 'ItemList');
  assert.ok(jsonld.itemListElement.length >= 1);
});

// ── 8. "deals change — verify" disclaimer ──────────────────────────────────────────────────────────
test('every shopper-facing page carries the "deals change — verify" disclaimer', async () => {
  for (const path of ['/', '/c/fashion', '/store?store=Nike']) {
    const res = await drive(path);
    assert.match(res.body, /Deals change/i, `${path} has the verify disclaimer`);
    assert.match(res.body, /verify the current offer/i);
  }
});

// ── 9. sanity on the exported registry ─────────────────────────────────────────────────────────────
test('SITEMAP_PATHS covers home + every category', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  for (const c of CATEGORIES) assert.ok(SITEMAP_PATHS.includes(`/c/${c.slug}`));
});
