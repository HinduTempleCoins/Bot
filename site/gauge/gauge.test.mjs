// gauge.test.mjs — offline tests for the KULA Gauge vertical server. No network: the gauge module's
// fetch is injected. Asserts the home page renders (200) with both forms, the JSON APIs build the right
// unsigned txs, soft-fail renders "gauge data unavailable" when the RPC is empty, XSS is escaped, and the
// handler never throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, page, SITEMAP_PATHS } from './server.mjs';
import { __setFetch, SEL } from '../../kulaswap/kula-gauge.mjs';

// ── a tiny mock res that captures what the handler wrote ──────────────────────────────────────────
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const WAD = 10n ** 18n;

// A fetch stub that answers gaugeWeights: n_gauges=1, gauges(0)=GAUGE, weight=40%.
const GAUGE = '0x' + '11'.repeat(20);
function liveGaugeFetch() {
  return async (_url, opts) => {
    const data = JSON.parse(opts.body).params[0].data;
    const sel = data.slice(0, 10);
    let result = null;
    if (sel === SEL.n_gauges) result = '0x' + word(1n);
    else if (sel === SEL.gauges) result = '0x' + GAUGE.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    else if (sel === SEL.gauge_relative_weight) result = '0x' + word((WAD * 4000n) / 10000n);
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}
// A fetch stub that returns nothing (empty RPC) for every call.
const emptyFetch = () => async () => ({ json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) });

// ── home page ─────────────────────────────────────────────────────────────────────────────────────
test('home / renders 200 and shows both the lock form and the vote form', async () => {
  __setFetch(emptyFetch());
  const res = await get('/');
  __setFetch(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Lock KULA for veKULA/);
  assert.match(res.body, /Vote your gauge weights/);
  assert.match(res.body, /Build Lock Tx/);
  assert.match(res.body, /Build Vote Tx/);
  assert.match(res.body, /class=alpha/); // Alpha badge on the live surface
});

test('home soft-fails to "gauge data unavailable" when the RPC returns nothing', async () => {
  __setFetch(emptyFetch());
  const res = await get('/');
  __setFetch(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Gauge data unavailable/i);
});

test('home renders live gauge weights when the RPC has them', async () => {
  __setFetch(liveGaugeFetch());
  const res = await get('/');
  __setFetch(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /40%/);          // the 4000-bps weight rendered as a pct
  assert.match(res.body, /4000 bps/);
});

// ── page() unit — soft-fail + XSS ─────────────────────────────────────────────────────────────────
test('page() renders with no weights (empty array) and marks status', () => {
  const html = page({ weights: [], live: false });
  assert.match(html, /Gauge data unavailable/i);
  assert.match(html, /not yet wired/);
});

test('page() escapes XSS in a gauge address', () => {
  const html = page({ weights: [{ gauge: '<script>alert(1)</script>', bps: 100, pct: 1 }], live: true });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ── /api/gauge ──────────────────────────────────────────────────────────────────────────────────
test('/api/gauge returns resolved addresses + weights (soft-fail [])', async () => {
  __setFetch(emptyFetch());
  const res = await get('/api/gauge');
  __setFetch(null);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(j.voteEscrow && j.gaugeController);
  assert.deepEqual(j.weights, []);
});

// ── /api/lock-tx ──────────────────────────────────────────────────────────────────────────────────
test('/api/lock-tx builds an unsigned create_lock descriptor + a projection', async () => {
  const unlock = Math.floor(Date.now() / 1000) + 208 * 7 * 86400;
  const res = await get(`/api/lock-tx?amount=1000000000000000000000&unlockTime=${unlock}`);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(j.tx.data.startsWith(SEL.create_lock));
  assert.equal(j.tx.value, '0x0');
  assert.equal(j.tx.chainId, 108369);
  assert.ok(j.projection && j.projection.boost >= 1);
});

test('/api/lock-tx rejects a zero amount', async () => {
  const res = await get('/api/lock-tx?amount=0');
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.match(j.error, /bad amount|not deployed/);
});

// ── /api/vote-tx ──────────────────────────────────────────────────────────────────────────────────
test('/api/vote-tx builds an unsigned vote_for_gauge_weights descriptor', async () => {
  const res = await get(`/api/vote-tx?gauge=${GAUGE}&weightBps=2500`);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(j.tx.data.startsWith(SEL.vote_for_gauge_weights));
  assert.match(j.tx.data, new RegExp(word(2500n) + '$'));
});

test('/api/vote-tx rejects a bad gauge address', async () => {
  const res = await get('/api/vote-tx?gauge=notanaddress&weightBps=100');
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
});

// ── /api/ve ───────────────────────────────────────────────────────────────────────────────────────
test('/api/ve soft-fails to null ve on empty RPC (still 200)', async () => {
  __setFetch(emptyFetch());
  const res = await get('/api/ve?account=0x' + '99'.repeat(20));
  __setFetch(null);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.ve, null);
});

// ── infra routes ────────────────────────────────────────────────────────────────────────────────
test('/health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('robots / sitemap / llms render and sitemap has the home path', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.statusCode, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.body, /<urlset/);
  const llms = await get('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /veKULA/);
  assert.deepEqual(SITEMAP_PATHS, ['/']);
});

test('unknown path → 404, handler never throws', async () => {
  const res = await get('/nope');
  assert.equal(res.statusCode, 404);
  // a weird URL must not throw
  const res2 = mockRes();
  await handler({ url: '/api/lock-tx?amount=%', method: 'GET' }, res2);
  assert.ok(res2.statusCode);
});
