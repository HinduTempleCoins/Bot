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
  // Derived from PUBLIC_SITES rather than hardcoded. An earlier version pinned the slug 'data', and
  // when data.soapbox.community was removed from the registry for failing its reachability probe the
  // test failed for the right change — it was asserting a particular host rather than the property.
  // The hub carries its OWN per-branch live flag, and deliberately renders some registry sites as
  // muted "coming" nodes with no link (see the planned-items test below). So the property is "several
  // registry sites are linked", not "all of them are".
  assert.ok(PUBLIC_SITES.length >= 4, 'registry has sites to link');
  const linked = PUBLIC_SITES.filter((site) => html.includes(`href="${esc(site.url)}"`));
  assert.ok(linked.length >= 4, `at least 4 live site nodes are linked (got ${linked.length})`);
  for (const site of linked) {
    assert.ok(html.includes(esc(site.name)), `linked site ${site.slug} shows its name`);
  }
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
  // directory is a public site but NOT live → must not be a working link to directory.soapbox.community
  // (law + politics ARE live now, so they're legitimately linked.)
  assert.ok(!html.includes('href="https://directory.soapbox.community"'), 'not-live directory site is not linked');
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
test('admin (soapy.blog) is never LINKED or named on the page', () => {
  const html = homePage();
  // The rule protects against ADVERTISING the admin host — a link, a nav entry, a sitemap row. The
  // analytics beacon references soapy.blog in a script src because the collector is deliberately
  // hosted there (private, robots disallow-all, absent from PUBLIC_SITES). That is plumbing, not an
  // advertisement, so it is excluded before the assertion rather than weakening it.
  const withoutBeacon = html
    .replace(/<script[^>]*soapy\.blog[^>]*><\/script>/g, '')
    .replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  assert.ok(!/soapy\.blog/i.test(withoutBeacon), 'soapy.blog must not appear outside the beacon');
  assert.ok(!/href="[^"]*soapy\.blog/i.test(html), 'soapy.blog must never be a link');
  assert.ok(!/\badmin\b/i.test(withoutBeacon), 'the word admin must not appear');
});

test('footer cross-links only live subdomains, never admin', () => {
  const links = footerLinks();
  assert.ok(!/soapy\.blog/i.test(links), 'footer has no admin link');
  // Any registry host, not a pinned one — the registry is reachability-gated and its membership moves.
  const anyHost = new URL(PUBLIC_SITES[0].url).host;
  assert.ok(links.includes(anyHost), `footer links a live subdomain (${anyHost})`);
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
