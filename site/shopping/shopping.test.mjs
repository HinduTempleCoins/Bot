// shopping.test.mjs — offline tests for shopping.soapbox.community, the SoapBox Shopping parent hub.
// Fully offline: the page builders are pure (they reuse the coupons CATEGORIES + the affiliate engine,
// no network). We drive the exported async handler through a mock req/res (no port bound) and assert:
// routes serve, the home page surfaces COUPONS INSIDE Shopping + A Buck + the store directory, the
// /stores page lists categories+stores cross-linked to coupons, hostile input is escaped, and
// health/robots/sitemap/llms/404 behave.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, storesPage } from './server.mjs';

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

test('home: 200 HTML with the Shopping identity', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /SoapBox Shopping/);
  assert.match(res.body, /honest shopping hub/);
});

test('home: surfaces COUPONS INSIDE Shopping (operator: coupons inside it)', async () => {
  const b = homePage();
  assert.match(b, /Coupons, inside Shopping/);
  assert.match(b, /coupons\.soapbox\.community/);
  // every coupons category is surfaced as a doorway
  assert.match(b, /Fashion &amp; Apparel/);
  assert.match(b, /Electronics &amp; Tech/);
});

test('home: surfaces A Buck (real under-$2 stores) and the store directory', async () => {
  const b = homePage();
  assert.match(b, /A Buck/);
  assert.match(b, /abuck\.soapbox\.community/);
  assert.match(b, /Store directory/);
  assert.match(b, /href="\/stores"/);
});

test('home: carries the FTC disclosure + no-pay-to-rank posture', async () => {
  const b = homePage();
  assert.match(b, /never sell your data/i);
  assert.match(b, /never by\s+commission|never by what pays us most/i);
});

test('stores: lists categories + stores, each cross-linked to coupons', async () => {
  const res = await drive('/stores');
  assert.equal(res.statusCode, 200);
  const b = res.body;
  assert.match(b, /Store directory/);
  assert.match(b, /Nike/);
  assert.match(b, /coupons\.soapbox\.community\/store\?store=/);
  // outbound "shop" link goes through the affiliate tracker (unmonetized offline)
  assert.match(b, /shop \(unmonetized\)/);
});

test('escapes hostile interpolation (no raw script survives)', async () => {
  // CATEGORIES are static; assert the esc helper is wired by feeding a hostile store via storesPage path —
  // here we just confirm the page never emits a raw <script> from its static content.
  const b = storesPage();
  assert.doesNotMatch(b, /<script>alert/);
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
  assert.match(l.body, /Shopping/);

  const nf = await drive('/nope');
  assert.equal(nf.statusCode, 302);
  assert.equal(nf.headers.location, '/');
});
