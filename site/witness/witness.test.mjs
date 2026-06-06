// witness.test.mjs — OFFLINE tests for site/witness/server.mjs (task #291).
// No network, no port bound: routes are driven through a mock req/res, and the pool reader is
// injected into the view functions directly so the live pool API is never touched.
//
//   node --test site/witness/witness.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handler, homePage, poolView, feesView, serversView, walletView, esc,
} from './server.mjs';
import { __setFetch as __setPoolFetch } from '../../integrations/pool-stats.mjs';

// Keep the full-handler routes (/pool, /fees) fully offline: the pool API soft-fails to [] when
// fetch throws, so those routes render their honest empty-state without touching the network.
__setPoolFetch(async () => { throw new Error('offline test'); });

// A fake reader returning two normalized pools (the shape pool-stats.pools() yields).
const fakePools = async () => ([
  {
    id: 'xmr-stagenet', coin: 'Monero', symbol: 'XMR', algorithm: 'RandomX',
    connectedMiners: 2, hashrate: 1500, networkHashrate: 1e9, blockHeight: 10,
    feePercent: 1.0, paymentScheme: 'PPLNS', minimumPayment: 0.01,
    ports: [{ port: 4444, tls: false, difficulty: 0.02 }, { port: 4445, tls: true, difficulty: 5 }],
  },
  {
    id: 'prana', coin: 'PRANA', symbol: 'PRANA', algorithm: 'Etchash',
    connectedMiners: 0, hashrate: 0, networkHashrate: 0, blockHeight: null,
    feePercent: 0.5, paymentScheme: 'PROP', minimumPayment: null,
    ports: [{ port: 5550, tls: false, difficulty: null }],
  },
]);
const emptyReader = async () => [];
const throwingReader = async () => { throw new Error('ECONNREFUSED'); };

// Minimal mock res that captures status, headers, and body.
function mockReq(path) { return { url: path, method: 'GET' }; }
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, h) { this.statusCode = code; this.headers = h; },
    end(s) { if (s != null) this.body += s; },
  };
}
async function route(path) {
  const res = mockRes();
  await handler(mockReq(path), res);
  return res;
}

// ---------------------------------------------------------------------------
// esc
// ---------------------------------------------------------------------------
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
});

// ---------------------------------------------------------------------------
// each route renders
// ---------------------------------------------------------------------------
test('home renders the witness school + Hathor founding witness', () => {
  const h = homePage();
  assert.match(h, /Witness School/);
  assert.match(h, /Hathor/);
  assert.match(h, /Delegated Proof of Stake|DPoS/);
  assert.match(h, /ordinary stake-weighted election/);
  assert.match(h, /learn|Learn/);
  assert.match(h, /Run a node/);
  assert.match(h, /Register/);
  assert.match(h, /Get votes/);
});

test('home links the tutorial and alpha.melek.salon', () => {
  const h = homePage();
  assert.match(h, /alpha\.melek\.salon/);
  assert.match(h, /tutorial/i);
});

test('pool view renders live cards with stratum lines', async () => {
  const h = await poolView(fakePools);
  assert.match(h, /Monero/);
  assert.match(h, /PRANA/);
  assert.match(h, /RandomX/);
  assert.match(h, /stratum\+tcp:\/\/.*:4444/);
  assert.match(h, /stratum\+ssl:\/\/.*:4445/);
  assert.match(h, /wallet\.worker/);
  assert.match(h, /Mine right now|browser/i);
});

test('pool view shows honest empty-state when API unreachable', async () => {
  const h = await poolView(emptyReader);
  assert.match(h, /unreachable/i);
  assert.doesNotMatch(h, /stratum\+tcp/);
});

test('pool view soft-fails (does not throw) when reader throws', async () => {
  const h = await poolView(throwingReader);
  assert.match(h, /unreachable/i);
});

test('fees view: fee goes to Hathor, NOT to PRANA, DAO note', async () => {
  const h = await feesView(fakePools);
  assert.match(h, /Hathor/);
  assert.match(h, /NOT.{0,30}PRANA/s);
  assert.match(h, /DAO/);
  // per-coin live fee shown
  assert.match(h, /1%|1\.0|0\.5/);
});

test('fees view contains the exact "NOT to" + "PRANA" disclosure literally', async () => {
  const h = await feesView(fakePools);
  assert.ok(h.includes('Hathor'), 'mentions Hathor');
  assert.ok(/NOT.{0,30}PRANA/s.test(h), 'states NOT to PRANA');
});

test('fees view still names Hathor when API unreachable', async () => {
  const h = await feesView(emptyReader);
  assert.match(h, /Hathor/);
  assert.match(h, /NOT.{0,30}PRANA/s);
});

test('servers view names witness-node + mining-rig specs, rentals disabled by default', () => {
  const h = serversView();
  assert.match(h, /witness node/i);
  assert.match(h, /24\/7|always-on/);
  assert.match(h, /RandomX/);
  assert.match(h, /GPU/);
  assert.match(h, /disabled by default/i);
});

test('wallet view: Akasha + EIP-3085 PRANA params with 0x1a751', () => {
  const h = walletView();
  assert.match(h, /Akasha/);
  assert.match(h, /0x1a751/);
  assert.match(h, /108369/);
  assert.match(h, /wallet_addEthereumChain|EIP-3085/);
  assert.match(h, /MetaMask|TronLink/);
});

// ---------------------------------------------------------------------------
// admin portal is never present
// ---------------------------------------------------------------------------
test('no route exposes the admin portal (soapy.blog) or an admin link', async () => {
  for (const p of ['/', '/pool', '/fees', '/servers', '/wallet']) {
    const r = await route(p);
    assert.equal(r.statusCode, 200, `${p} should 200`);
    assert.doesNotMatch(r.body, /soapy\.blog/, `${p} must not link admin`);
    assert.doesNotMatch(r.body, /\badmin\b/i, `${p} must not say admin`);
  }
});

// ---------------------------------------------------------------------------
// routing + infra endpoints
// ---------------------------------------------------------------------------
test('health/robots/sitemap/llms respond', async () => {
  assert.equal((await route('/health')).body, 'ok');
  assert.match((await route('/robots.txt')).body, /User-agent|Sitemap/i);
  assert.match((await route('/sitemap.xml')).body, /<urlset|<\?xml/);
  assert.match((await route('/llms.txt')).body, /Witness School|pool/i);
});

test('sitemap lists all five routes', async () => {
  const xml = (await route('/sitemap.xml')).body;
  for (const p of ['/pool', '/fees', '/servers', '/wallet']) {
    assert.ok(xml.includes(p), `sitemap missing ${p}`);
  }
});

test('unknown path redirects home', async () => {
  const r = await route('/nope');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/');
});

test('test-currency note (TESTS) appears in the footer', async () => {
  const r = await route('/');
  assert.match(r.body, /TESTS/);
  assert.match(r.body, /test-only|test currency|no monetary value/i);
});
