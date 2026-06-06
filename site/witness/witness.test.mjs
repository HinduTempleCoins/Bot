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

// ---------------------------------------------------------------------------
// /pool/miner — Akasha wallet ↔ pool lookup (#292)
// ---------------------------------------------------------------------------
import { minerView } from './server.mjs';
import { minerStats } from '../../integrations/pool-stats.mjs';

const fakeMinerHit = async (poolId, addr) => (poolId === 'xmr-stagenet' ? {
  poolId, address: addr, pendingBalance: 0.5, pendingShares: 12, totalPaid: 3.2,
  todayPaid: 0.1, lastPayment: '2026-06-06T05:00:00Z', hashrate: 850,
  workers: [{ name: 'rig1', hashrate: 850, sharesPerSecond: 0.4 }],
} : null);
const fakeMinerMiss = async () => null;

test('minerView renders per-pool stats when the address is known', async () => {
  const html = await minerView('44abcDEADBEEF', { readPools: fakePools, readMiner: fakeMinerHit });
  assert.match(html, /Your wallet on the pool/);
  assert.match(html, /44abcDEADBEEF/);
  assert.match(html, /Monero/);
  assert.match(html, /pending balance/);
  assert.match(html, /rig1/);
  assert.ok(!html.includes('PRANA</'), 'pools with no record of the address are not listed');
});

test('minerView honest empty-states: unknown address / API down / no address', async () => {
  const miss = await minerView('zzz', { readPools: fakePools, readMiner: fakeMinerMiss });
  assert.match(miss, /no record of/);
  const down = await minerView('zzz', { readPools: throwingReader, readMiner: fakeMinerMiss });
  assert.match(down, /unreachable/);
  const blank = await minerView('', { readPools: fakePools, readMiner: fakeMinerHit });
  assert.match(blank, /No address given/);
});

test('minerView escapes a hostile address', async () => {
  const html = await minerView('<script>x</script>', { readPools: fakePools, readMiner: fakeMinerMiss });
  assert.ok(!html.includes('<script>x'), 'address must be escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('/pool/miner route responds (offline → honest empty state) and form is on /pool', async () => {
  const r = await route('/pool/miner?addr=abc');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /unreachable|no record of/);
  assert.match(r.body, /noindex/);
  const pool = await route('/pool');
  assert.match(pool.body, /action="\/pool\/miner"/);
});

test('pool-stats.minerStats normalizes the Miningcore miner object', async () => {
  __setPoolFetch(async (url) => {
    assert.match(String(url), /\/api\/pools\/xmr-stagenet\/miners\/WALLET1/);
    return {
      ok: true,
      json: async () => ({
        pendingShares: 9, pendingBalance: 1.25, totalPaid: 10.5, todayPaid: 0.2,
        lastPayment: '2026-06-06T00:00:00Z',
        performance: { workers: { rig1: { hashrate: 500, sharesPerSecond: 0.2 }, '': { hashrate: 100 } } },
      }),
    };
  });
  const m = await minerStats('xmr-stagenet', 'WALLET1');
  assert.equal(m.pendingBalance, 1.25);
  assert.equal(m.hashrate, 600);
  assert.equal(m.workers.length, 2);
  assert.equal(m.workers[1].name, 'default');
  __setPoolFetch(async () => { throw new Error('offline test'); });
  assert.equal(await minerStats('xmr-stagenet', 'WALLET1'), null, 'soft-fails to null');
  assert.equal(await minerStats('', 'x'), null);
  assert.equal(await minerStats('p', ''), null);
});

// ---------------------------------------------------------------------------
// /hathor — live witness status (#289)
// ---------------------------------------------------------------------------
import { hathorView, hathorStatus, __setChainFetch } from './server.mjs';

const SNAP = {
  headBlock: 21767, lastConfirmed: 21766, blocksBehind: 1, totalMissed: 52,
  version: '0.23.0', signingKeyDisabled: false, url: 'https://alpha.melek.salon',
  currentWitness: 'hathor', time: '2026-06-06T08:00:00', feed: '0.001 TBD / 0.001 TESTS',
};

test('hathorView renders the live numbers + plain-English explainer', async () => {
  const html = await hathorView(async () => SNAP);
  assert.match(html, /founding AI Witness/);
  assert.match(html, /21,767|21767/);
  assert.match(html, /missed \(all-time\)/);
  assert.match(html, /active/);
  assert.match(html, /@hathor/);
  assert.match(html, /0\.001 TBD/);
  assert.match(html, /What you&#39;re looking at|What you're looking at/);
});

test('hathorView honest empty-state when the RPC is down', async () => {
  const html = await hathorView(async () => null);
  assert.match(html, /unreachable/);
  assert.match(html, /will not invent numbers/);
});

test('hathorStatus maps condenser RPC responses (injected fetch)', async () => {
  __setChainFetch(async (url, opts) => {
    const req = JSON.parse(opts.body);
    const result = req.method === 'condenser_api.get_witness_by_account'
      ? { last_confirmed_block_num: 100, total_missed: 2, running_version: '0.23.0', signing_key: 'TST7abc', url: 'https://x' }
      : req.method === 'condenser_api.get_dynamic_global_properties'
        ? { head_block_number: 105, current_witness: 'hathor', time: '2026-06-06T08:00:00' }
        : { current_median_history: { base: '0.001 TBD', quote: '0.001 TESTS' } };
    return { json: async () => ({ result }) };
  });
  const s = await hathorStatus();
  assert.equal(s.blocksBehind, 5);
  assert.equal(s.totalMissed, 2);
  assert.equal(s.signingKeyDisabled, false);
  assert.equal(s.feed, '0.001 TBD / 0.001 TESTS');
  // soft-fail
  __setChainFetch(async () => { throw new Error('down'); });
  assert.equal(await hathorStatus(), null);
  __setChainFetch(null);
});

test('/hathor route responds and home grid links to it', async () => {
  __setChainFetch(async () => { throw new Error('offline'); });
  const r = await route('/hathor');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /founding AI Witness/);
  const home = await route('/');
  assert.match(home.body, /href="\/hathor"/);
  __setChainFetch(null);
});

// ---------------------------------------------------------------------------
// pool-is-the-wallet front door (operator 2026-06-06)
// ---------------------------------------------------------------------------
test('/pool leads with create-your-wallet-here (non-custodial, spend-lock, Akasha)', async () => {
  const html = await poolView(fakePools);
  assert.match(html, /pool IS your wallet/i);
  assert.match(html, /mycoins\.html/);
  assert.match(html, /Zephyr \(ZEPH\)/);
  assert.match(html, /never leaves your browser/);
  assert.match(html, /spend-lock/);
  assert.match(html, /Akasha/);
});
