// server.test.mjs — offline tests for The KULA Paper page. node --test, no network.
// Asserts: the page renders 200 with the Alpha badge; the honest-tone / no-price-promise disclaimer is
// present; the load-bearing economic facts (see-saw, 45/35/10/10 split, cap 11M, emission-only) appear;
// every canonical mainnet address renders and is escaped; robots/sitemap/health work; unknown → 404;
// the handler never throws and does ZERO request-time network (global fetch is made to throw).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, safeHref, ADDR, ADDR_ROWS, SPLIT, sitemapXml, robotsTxt } from './server.mjs';

// Prove no request-time network: any fetch attempt throws.
globalThis.fetch = () => { throw new Error('no network allowed in tests'); };

function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('GET / renders 200 HTML with the Alpha badge', async () => {
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /class=alpha>Alpha</, 'missing Alpha badge');
});

test('honest-tone / no-price-promise disclaimer present', async () => {
  const res = await get('/');
  assert.match(res.body, /not a forecast/i);
  assert.match(res.body, /price\s+promise/i);
  assert.match(res.body, /investment advice/i);
});

test('load-bearing economic facts appear', async () => {
  const res = await get('/');
  const b = res.body;
  assert.match(b, /see-saw/i, 'see-saw compute model');
  assert.match(b, /45% miners \/ 35% LPs \/ 10% lottery \/ 10% stakers/, 'emission split');
  assert.match(b, /cap of 11M|cap 11M/, 'hard cap 11M');
  assert.match(b, /[Ee]mission-only/, 'emission-only');
  assert.match(b, /[Pp]roof-of-[Ll]iquidity/, 'MWALI PoL');
  assert.match(b, /APIS-Hash/, 'APIS forever-lock');
  assert.match(b, /non-cashable/i, 'arcade non-cashable');
  assert.match(b, /DAO Timelock/, 'timelock governance');
});

test('every canonical mainnet address renders on the page', async () => {
  const res = await get('/');
  for (const [, key] of ADDR_ROWS) {
    assert.ok(res.body.includes(ADDR[key]), `address for ${key} missing from page`);
  }
});

test('the split table sums to 100%', () => {
  const sum = SPLIT.reduce((a, [, pct]) => a + pct, 0);
  assert.equal(sum, 100);
});

test('robots.txt + sitemap.xml + health', async () => {
  const rob = await get('/robots.txt');
  assert.equal(rob.statusCode, 200);
  assert.match(rob.body, /Sitemap:/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset/);
  const h = await get('/health');
  assert.equal(h.statusCode, 200);
  assert.deepEqual(JSON.parse(h.body), { ok: true });
});

test('unknown path → 404, noindex', async () => {
  const res = await get('/does-not-exist');
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /404/);
});

test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('safeHref rejects non-http(s) and passes https', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://pranascan.soapbox.community'), 'https://pranascan.soapbox.community/');
});

test('pure sitemap/robots helpers are strings', () => {
  assert.equal(typeof sitemapXml(), 'string');
  assert.equal(typeof robotsTxt(), 'string');
});

test('handler never throws on malformed input', async () => {
  const res = mockRes();
  await assert.doesNotReject(handler({ url: '///%%%bad', method: 'GET' }, res));
});
