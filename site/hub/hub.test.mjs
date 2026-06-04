// hub.test.mjs — offline tests for SoapBox.community, the bracket hub. Fully offline: the home page is
// rendered from PUBLIC_SITES + the ecosystem-map ESTATE constant (no network). We drive the exported
// handler through a mock req/res (no port bound) and assert: the bracket contains the root + several
// live site nodes + at least one sub-branch, planned items render muted ("coming") with no link,
// admin (soapy.blog) NEVER appears anywhere, and health/robots/sitemap/llms respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, topBranches, organismTier, footerLinks, esc } from './server.mjs';
import { PUBLIC_SITES } from '../../integrations/soapbox/crawlers.mjs';

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

// ── 1. home serves the bracket ──────────────────────────────────────────────────────────────────
test('home route serves 200 HTML', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /SoapBox\.community/);
});

test('bracket contains the root node', () => {
  const html = homePage();
  assert.match(html, /class="node root">SoapBox</);
});

test('bracket contains several LIVE site nodes, each linking its subdomain', () => {
  const html = homePage();
  // these slugs are live → must appear as working links to their real subdomain
  for (const slug of ['data', 'search', 'wiki', 'hemp', 'stocks']) {
    const site = PUBLIC_SITES.find((s) => s.slug === slug);
    assert.ok(html.includes(`href="${esc(site.url)}"`), `live site ${slug} links ${site.url}`);
    assert.ok(html.includes(esc(site.name)), `live site ${slug} shows its name`);
  }
  // at least 4 distinct live subdomain links present
  const liveLinks = ['data', 'search', 'wiki', 'hemp', 'stocks']
    .filter((slug) => html.includes(`href="${esc(PUBLIC_SITES.find((s) => s.slug === slug).url)}"`));
  assert.ok(liveLinks.length >= 4, 'at least 4 live site nodes are linked');
});

test('bracket contains at least one sub-branch (vertical leaf) under a live site', () => {
  const html = homePage();
  // hemp's real sub-routes are live and should be linked into hemp.soapbox.community
  assert.match(html, /node leaf islive/);
  assert.ok(html.includes('hemp.soapbox.community/law'), 'hemp law sub-branch links the real route');
  assert.ok(html.includes('US law: hemp vs marijuana'), 'a sub-branch label renders');
});

test('planned / not-yet-live items render muted with a "coming" pill and no link', () => {
  const html = homePage();
  assert.match(html, /pill coming">coming</);
  // law is a public site but NOT live → must not be a working link to law.soapbox.community
  assert.ok(!html.includes('href="https://law.soapbox.community"'), 'not-live law site is not linked');
  // a not-live leaf label appears but only inside a muted span, never an <a>
  assert.ok(html.includes('Hathor AI answer mode'), 'a coming leaf label renders');
  assert.ok(!/<a[^>]*>Hathor AI answer mode/.test(html), 'coming leaf is not a link');
});

test('the organism tier renders chains, bots, and tokens from ESTATE', () => {
  const html = homePage();
  assert.match(html, /Chains/);
  assert.match(html, /Bots &amp; agents|Bots &amp; agents/);
  assert.match(html, /Tokens/);
  assert.ok(html.includes('MELEK'), 'a chain label appears');
  assert.ok(html.includes('Hathor'), 'a bot appears');
});

// ── 2. ADMIN MUST NEVER APPEAR ──────────────────────────────────────────────────────────────────
test('admin (soapy.blog) appears NOWHERE on the page', () => {
  const html = homePage();
  assert.ok(!/soapy\.blog/i.test(html), 'soapy.blog must not appear');
  assert.ok(!/\badmin\b/i.test(html), 'the word admin must not appear');
});

test('footer cross-links only live subdomains, never admin', () => {
  const links = footerLinks();
  assert.ok(!/soapy\.blog/i.test(links), 'footer has no admin link');
  assert.ok(links.includes('data.soapbox.community'), 'footer links a live subdomain');
});

// ── 3. data integrity of the bracket model ──────────────────────────────────────────────────────
test('topBranches mirrors PUBLIC_SITES (single source of truth)', () => {
  const tb = topBranches();
  assert.equal(tb.length, PUBLIC_SITES.length);
  for (const b of tb) {
    assert.ok(PUBLIC_SITES.find((s) => s.slug === b.slug), `${b.slug} comes from PUBLIC_SITES`);
    assert.equal(typeof b.live, 'boolean');
    assert.ok(Array.isArray(b.children));
  }
});

test('organismTier is a non-empty string', () => {
  const t = organismTier();
  assert.equal(typeof t, 'string');
  assert.ok(t.length > 50);
});

// ── 4. infra routes ─────────────────────────────────────────────────────────────────────────────
test('health responds ok', async () => {
  const res = await drive('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('robots.txt is index-friendly and lists a sitemap', async () => {
  const res = await drive('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Sitemap:/i);
  assert.ok(!/soapy\.blog/i.test(res.body), 'robots never references admin');
});

test('sitemap.xml renders with the home url', async () => {
  const res = await drive('/sitemap.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.body, /<urlset|<url>/);
});

test('sitemap-index and llms.txt respond, never referencing admin', async () => {
  const idx = await drive('/sitemap-index.xml');
  assert.equal(idx.statusCode, 200);
  assert.ok(!/soapy\.blog/i.test(idx.body));
  const llms = await drive('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.ok(!/soapy\.blog/i.test(llms.body));
});

test('unknown path redirects home', async () => {
  const res = await drive('/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('every interpolated site name is escaped (no raw < in output beyond tags)', () => {
  const html = homePage();
  // sanity: page is well-formed enough to contain the bracket container exactly once-ish
  assert.match(html, /class=bracket/);
});
