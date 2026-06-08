// travel.test.mjs — offline tests for travel.soapbox.community, the SoapBox Travel curated directory.
// Fully offline: doorways() reads the shared aggregator-directory (pure, no network) and soft-fails to a
// built-in list. We drive the exported async handler through a mock req/res (no port bound) and assert:
// routes serve, the home page lists the travel doorways with affiliate-routed outbound links + the
// honest-ranking guardrail, the search box is keyless, and health/robots/sitemap/llms/404 behave.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, doorways } from './server.mjs';

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

test('doorways(): returns the travel comparison doorways (flights/hotels/…)', () => {
  const d = doorways();
  assert.ok(Array.isArray(d) && d.length >= 6);
  const ids = d.map((x) => x.id);
  assert.ok(ids.includes('flights'));
  assert.ok(ids.includes('hotels'));
  assert.ok(ids.includes('car-rentals'));
});

test('home: 200 HTML with the Travel identity and every doorway', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  assert.match(b, /SoapBox Travel/);
  assert.match(b, /Flights/);
  assert.match(b, /Hotels/);
  assert.match(b, /Car rentals/);
});

test('home: outbound doorway links route through the affiliate tracker (unmonetized offline)', async () => {
  const b = homePage();
  assert.match(b, /rel="sponsored nofollow noopener"/);
  assert.match(b, /\(unmonetized\)/);
});

test('home: carries the honest-ranking guardrail + FTC disclosure + no data-selling', async () => {
  const b = homePage();
  assert.match(b, /never by\s+commission/i);
  assert.match(b, /never sell your data/i);
});

test('home: keyless destination search box (no API key)', async () => {
  const b = homePage();
  assert.match(b, /Where to\?/);
  assert.match(b, /www\.google\.com\/search/);
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
  assert.match(l.body, /Travel/);

  const nf = await drive('/nope');
  assert.equal(nf.statusCode, 302);
  assert.equal(nf.headers.location, '/');
});
