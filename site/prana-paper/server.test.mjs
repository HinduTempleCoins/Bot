// server.test.mjs — offline tests for The PRANA Paper page. node --test, no network.
// Asserts: the page renders 200 with the Alpha badge; the honest-tone / no-price-promise disclaimer is
// present; the load-bearing chain facts (Etchash, chainId, 2 PRANA/block, 2% Hathor fee, the see-saw,
// all three lanes) appear; the honest pinned-vs-design-intent distinction is drawn; every REF value
// renders and is escaped; robots/sitemap/health work; unknown → 404; the handler never throws and does
// ZERO request-time network (global fetch is made to throw).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handler, esc, safeHref, PINNED, DESIGN_INTENT, COMPUTE_PARAMS, LANES, REF,
  CHAIN_ID, PRANA_TOKEN, sitemapXml, robotsTxt,
} from './server.mjs';

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

test('load-bearing chain facts appear', async () => {
  const res = await get('/');
  const b = res.body;
  assert.match(b, /Etchash/, 'Etchash PoW');
  assert.match(b, /712217/, 'chainId');
  assert.match(b, /2 PRANA\s*\/\s*block/, 'base block reward');
  assert.match(b, /2\.00%|200 bps/, 'Hathor fee');
  assert.match(b, /un-bypassable/i, 'consensus-level fee');
  assert.match(b, /see-saw/i, 'see-saw model');
  assert.match(b, /UnifiedSharesLedger/, 'the unified ledger');
  assert.match(b, /the chain IS the pool/i, 'chain-as-pool framing');
  assert.match(b, /EIP-1559/, 'fee market');
  assert.match(b, /no premine|empty <code>alloc/i, 'fair launch no premine');
});

test('all three lanes (HASH, TASK, BURN) render', async () => {
  const res = await get('/');
  for (const [lane] of LANES) {
    assert.ok(res.body.includes(`${lane} lane`), `${lane} lane missing`);
  }
});

test('honest pinned-vs-design-intent distinction is drawn', async () => {
  const res = await get('/');
  const b = res.body;
  // The ~10%/yr decay must be flagged as NOT pinned, not stated as a live guarantee.
  assert.match(b, /not\s+pinned|NOT YET PINNED|design intent/i, 'decay must be flagged as design-intent');
  assert.match(b, /~13.?15\s*s|~13–15 s/, 'block time band');
  assert.match(b, /class="tag pin"/, 'Pinned tag');
  assert.match(b, /class="tag di"/, 'Design-intent tag');
});

test('every REF value renders on the page', async () => {
  const res = await get('/');
  for (const [, val] of REF) {
    assert.ok(res.body.includes(esc(val)), `REF value ${val} missing from page`);
  }
});

test('exported constants are the grounded values', () => {
  assert.equal(CHAIN_ID, 712217);
  assert.match(PRANA_TOKEN, /^0x[0-9a-fA-F]{40}$/);
  assert.ok(PINNED.length >= 5);
  assert.ok(DESIGN_INTENT.length >= 2);
  assert.ok(COMPUTE_PARAMS.length >= 4);
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
  assert.match(res.body, /noindex/);
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
