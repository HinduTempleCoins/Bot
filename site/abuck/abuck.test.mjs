// abuck.test.mjs — offline tests for abuck.soapbox.community, the A Buck true-dollar-store site.
// Fully offline: the locator soft-fails to [] without network, so the homepage always renders its
// curated chain truth table. We drive the exported async handler through a mock req/res (no port bound)
// and assert: routes serve, the homepage carries its A Buck identity + the chain truth table + the
// locator form + the shared ecosystem nav (current=abuck), every interpolated value is escaped, and
// health/robots/sitemap/404 work.

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
async function drive(urlPath) {
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

test('home: 200 HTML with the A Buck identity and lede', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  assert.match(b, /<title>A Buck — real under-\$2 stores<\/title>/);
  assert.match(b, /A <span class=buck>Buck<\/span>/);
  assert.match(b, /Dollar Tree model/);
});

test('home: carries the chain truth table with honest verdicts', async () => {
  const b = await homePage();
  assert.match(b, /cheap-stores-table/);
  assert.match(b, /Dollar Tree/);
  assert.match(b, /Daiso/);
  // the not-actually-cheap chains are listed honestly
  assert.match(b, /Dollar General/);
  assert.match(b, /Family Dollar/);
  assert.match(b, /truly under \$2/);
  assert.match(b, /dollar in name only/);
});

test('home: has the locator form (posts back to /)', async () => {
  const b = await homePage();
  assert.match(b, /<form method=get action=\//);
  assert.match(b, /name=q/);
  assert.match(b, /ZIP, city, or lat,lng/);
});

test('home: a non-geocodable query soft-fails to a clean empty result', async () => {
  // offline → geocode fails → origin null → the "couldn't find" path renders, page still 200s
  const res = await drive('/?q=' + encodeURIComponent('zzzznowhereplace12345'));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Stores near/);
  assert.match(res.body, /cheap-stores-table/); // table still present below the empty result
});

test('home: escapes a hostile locator query', async () => {
  const b = await homePage('<script>alert(1)</script>');
  assert.doesNotMatch(b, /<script>alert\(1\)<\/script>/);
  assert.match(b, /&lt;script&gt;/);
});

test('home: carries the shared ecosystem family nav (current=abuck)', async () => {
  const b = await homePage();
  assert.match(b, /class=enav/);
  assert.match(b, /aria-current="page"/); // A Buck highlighted as current
  assert.match(b, /A Buck/);
});

test('home: canonical + OpenGraph + robots meta', async () => {
  const b = await homePage();
  assert.match(b, /<link rel=canonical href="https:\/\/abuck\.soapbox\.community\/">/);
  assert.match(b, /og:title/);
  assert.match(b, /name=robots/);
});

test('routes: /health, /robots.txt, /sitemap.xml, 404', async () => {
  const h = await drive('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');

  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/plain/);

  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.headers['content-type'], /xml/);
  assert.match(s.body, /abuck\.soapbox\.community/);

  const nf = await drive('/nope');
  assert.equal(nf.statusCode, 404);
});
