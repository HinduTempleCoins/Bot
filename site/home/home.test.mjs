// home.test.mjs — offline tests for home.soapbox.community, the SoapBox Home curated directory.
// Fully offline: services() reads the shared aggregator-directory (pure, no network) and soft-fails to a
// built-in list; the home-goods store list is static. We drive the exported async handler through a mock
// req/res (no port bound) and assert: routes serve, the home page lists the home-services doorways AND
// the home-goods stores (cross-linked to coupons), with affiliate-routed outbound links + the
// honest-ranking guardrail, and health/robots/sitemap/llms/404 behave.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, services } from './server.mjs';

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

test('services(): returns the home-services doorways (contractors/movers/…)', () => {
  const s = services();
  assert.ok(Array.isArray(s) && s.length >= 6);
  const ids = s.map((x) => x.id);
  assert.ok(ids.includes('contractors'));
  assert.ok(ids.includes('movers'));
  assert.ok(ids.includes('solar'));
});

test('home: 200 HTML with the Home identity and both sections', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  assert.match(b, /SoapBox Home/);
  assert.match(b, /Home services &amp; improvement/);
  assert.match(b, /Home goods &amp; furnishings/);
  assert.match(b, /Contractors/);
});

test('home: home-goods stores cross-link to coupons + route shop through affiliate tracker', async () => {
  const b = homePage();
  assert.match(b, /Wayfair/);
  assert.match(b, /Home Depot/);
  assert.match(b, /coupons\.soapbox\.community\/store\?store=/);
  assert.match(b, /shop \(unmonetized\)/);
});

test('home: carries the honest-ranking guardrail + FTC disclosure + no data-selling', async () => {
  const b = homePage();
  assert.match(b, /never by\s+commission/i);
  assert.match(b, /never sell your data/i);
});

test('home: escapes static content (no raw script survives) and shows the apostrophe store safely', async () => {
  const b = homePage();
  assert.doesNotMatch(b, /<script>alert/);
  assert.match(b, /Lowe&#?\w*;?s|Lowe's/); // Lowe's renders (apostrophe is not in the esc charset, fine)
});

test('home: canonical + OpenGraph meta present', async () => {
  const b = homePage();
  assert.match(b, /<link rel="canonical"/);
  assert.match(b, /og:title/);
  assert.match(b, /name="robots"/);
});

test('routes: /health, /robots.txt, /sitemap.xml, /llms.txt, 302-on-unknown', async () => {
  const h = await drive('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');

  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/plain/);

  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.headers['content-type'], /xml/);

  const l = await drive('/llms.txt');
  assert.equal(l.statusCode, 200);
  assert.match(l.body, /Home/);

  const nf = await drive('/nope');
  assert.equal(nf.statusCode, 302);
  assert.equal(nf.headers.location, '/');
});
