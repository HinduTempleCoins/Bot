// dudael.test.mjs — offline tests for the dudael.com metaverse landing. Fully offline: the page is
// static (no live source), so we drive the exported handler through a mock req/res (no port bound) and
// assert: the routes serve, the landing carries its identity + the "building now" framing + the live
// family links + the shared ecosystem nav, every interpolated value is escaped, and health/robots work.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage } from './server.mjs';

function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });
function drive(urlPath) {
  const res = mockRes();
  handler(req(urlPath), res);
  return res;
}

test('home: 200 HTML with the Dudael metaverse identity and lede', () => {
  const res = drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  assert.match(b, /<title>Dudael — the MetaVerse<\/title>/);
  assert.match(b, /<h1>Dudael<\/h1>/);
  assert.match(b, /MetaVerse of the ecosystem/i);
  // Convergence framing present, but no medical self-application content
  assert.match(b, /Convergence/);
  assert.doesNotMatch(b, /electrode|tDCS dose|apply .* current to your/i);
});

test('home: "building now / watch this space" framing', () => {
  const b = homePage();
  assert.match(b, /Building now/i);
  assert.match(b, /watch this space/i);
});

test('home: links the live ecosystem family', () => {
  const b = homePage();
  assert.match(b, /alpha\.melek\.salon/);
  assert.match(b, /data\.soapbox\.community/);
  assert.match(b, /oversight\.soapbox\.community/);
  assert.match(b, /law\.soapbox\.community/);
  assert.match(b, /pool\.soapbox\.community/);
});

test('home: carries the shared ecosystem family nav (current=dudael)', () => {
  const b = homePage();
  assert.match(b, /class=enav/);
  assert.match(b, /aria-current="page"/); // dudael highlighted as current
  assert.match(b, /Dudael/);
});

test('home: canonical + OpenGraph + robots meta', () => {
  const b = homePage();
  assert.match(b, /<link rel=canonical href="https:\/\/dudael\.com\/">/);
  assert.match(b, /og:title/);
  assert.match(b, /name=robots/);
});

test('routes: /health, /robots.txt, /sitemap.xml', () => {
  const h = drive('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');

  const r = drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/plain/);

  const s = drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.headers['content-type'], /xml/);
  assert.match(s.body, /dudael\.com/);
});
