// witness.test.mjs — OFFLINE tests for site/witness/server.mjs (task #291).
// No network, no port bound: routes are driven through a mock req/res, and the pool reader is
// injected into the view functions directly so the live pool API is never touched.
//
//   node --test site/witness/witness.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handler, homePage, poolView, feesView, serversView, walletView, academyPage, buildPage, tokenStandardsPage, grapheneFamilyPage, runPage, whitepaperPage, esc,
  devHubPage, devMelekPage, devPranaPage, devContractsPage, minePage,
  devTokenPage, devScotPage, devFrontendPage, devServicesPage, devToolsPage, devGetTokensPage,
  devMatrixPage, devBotsPage,
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

test('academy teaches the curation-network concept generically + the build steps', () => {
  const h = academyPage();
  assert.match(h, /Token Academy/);
  assert.match(h, /curation-reward network/i);
  assert.match(h, /community token|SCOT|tribe token/);
  assert.match(h, /curation trail/i);
  assert.match(h, /token trail/i);
  assert.match(h, /keyless/i);
  assert.match(h, /Mint the token/);        // a build step
  assert.match(h, /Flag the token trail/);  // a build step
  // instructs on the real tooling
  assert.match(h, /MELEK-Engine/);
  assert.match(h, /tokens\.create/);
  assert.match(h, /rewards\.setReward/);
  assert.match(h, /APIS/);
  assert.match(h, /KulaSwap/);
  // stays generic — must NOT name specific outside communities (operator direction)
  assert.doesNotMatch(h, /OCD|R2Cornell/i);
});

test('build page teaches the Graphene-chain anatomy + credits @jga', () => {
  const h = buildPage();
  assert.match(h, /How a Graphene chain is built/);
  assert.match(h, /@jga/);                                  // credits the source guide
  assert.match(h, /joticajulian|Juli/);                    // author named
  assert.match(h, /sha256 of the genesis inscription/i);   // MELEK chain-id fact
  assert.match(h, /907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b/); // real chain id
  assert.match(h, /BUILD_STEEM_TESTNET/);                  // build flag
  assert.match(h, /initminer/);                            // first witness
  assert.match(h, /create_account_with_keys_delegated/);   // 2nd-witness step
  assert.match(h, /no MBD/);                               // MELEK has no dollar token
  assert.match(h, /4 seconds/);                            // correct block time (not 3)
  assert.doesNotMatch(h, /block time\D*3 second/i);        // the old bug must not reappear
});

test('build route renders 200 and is in the nav + sitemap', async () => {
  const res = await route('/build');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /How a Graphene chain is built/);
  assert.match(homePage(), /\/build/);       // linked from the school home
  const sm = await route('/sitemap.xml');
  assert.match(sm.body, /\/build/);
});

test('run page states the correct 4-second block time', () => {
  const h = runPage();
  assert.match(h, /4 seconds/);
  assert.doesNotMatch(h, /block time\D*3 second/i);
});

test('academy route renders 200 and is in the nav + sitemap', async () => {
  const res = await route('/academy');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Token Academy/);
  assert.match(homePage(), /\/academy/);    // linked from the school home
  const sm = await route('/sitemap.xml');
  assert.match(sm.body, /\/academy/);
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

test('wallet view: Akasha + EIP-3085 PRANA MAINNET params (0xADE19 / 712217)', () => {
  const h = walletView();
  assert.match(h, /Akasha/);
  assert.match(h, /0xADE19/);
  assert.match(h, /712217/);
  assert.match(h, /wallet_addEthereumChain|EIP-3085/);
  assert.match(h, /MetaMask|TronLink/);
});

// ---------------------------------------------------------------------------
// /mine — PRANA Etchash mining guide
// ---------------------------------------------------------------------------
test('mine page: copy-paste Etchash miner configs + stratum + mainnet chainId', () => {
  const h = minePage();
  // the three common Etchash miners, copy-paste
  assert.match(h, /lolMiner/);
  assert.match(h, /t-rex/i);
  assert.match(h, /GMiner|--algo etchash/);
  // stratum URL with the pool host and port
  assert.match(h, /stratum\+tcp:\/\/pool\.soapbox\.community:3333/);
  // mainnet chainId (712217 / 0xade19), NOT the testnet id
  assert.match(h, /712217/);
  assert.match(h, /0xade19/);
  // honest, no-hype discipline: fair launch, no premine, no profit promise
  assert.match(h, /no premine|fair launch/i);
  assert.match(h, /thin security/i);
  // payout is a public 0x address, never a key
  assert.match(h, /0xYOUR_PRANA_ADDRESS/);
  assert.match(h, /never.{0,20}private key/i);
});

test('mine route renders 200 and is in nav + sitemap + llms', async () => {
  const r = await route('/mine');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Mine PRANA/);
  const home = await route('/');
  assert.match(home.body, /href="\/mine"/);
  const sm = await route('/sitemap.xml');
  assert.match(sm.body, /\/mine</);
  const llms = await route('/llms.txt');
  assert.match(llms.body, /\/mine/);
  // alias
  const alias = await route('/pool/mine');
  assert.equal(alias.statusCode, 200);
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

// ---------------------------------------------------------------------------
// /run — the seed node a prospective witness actually dials
// ---------------------------------------------------------------------------
// Regression: /run advertised p2p port 2001, which on that host belongs to a different chain's node
// and refuses MELEK peers — every reader following the recipe hit a dead end at the sync step.
test('/run advertises the MELEK p2p seed port (2003), never 2001', () => {
  const html = runPage();
  assert.match(html, /:2003/, 'must advertise the MELEK p2p port');
  assert.ok(!/:2001/.test(html), 'must not advertise 2001 — that is another chain on the same host');
});

test('/run shows the mainnet chain id and is overridable by env', () => {
  const html = runPage();
  assert.match(html, /907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b/);
  const saved = process.env.MELEK_SEED_NODE;
  process.env.MELEK_SEED_NODE = 'seed.example:2003';
  try {
    assert.match(runPage(), /seed\.example:2003/);
  } finally {
    if (saved === undefined) delete process.env.MELEK_SEED_NODE; else process.env.MELEK_SEED_NODE = saved;
  }
});

// ---------------------------------------------------------------------------
// /whitepaper — same source file as the apex, same shared renderer
// ---------------------------------------------------------------------------
test('/whitepaper renders the committed whitepaper with real tables', async () => {
  const html = await whitepaperPage();
  assert.match(html, /<h1>MELEK — An AI-Native Blockchain Community<\/h1>/);
  assert.match(html, /Rule 1 of Angelic AI/);
  assert.match(html, /<table>/);
  assert.ok(!/<p>\|/.test(html), 'no table row may fall through to a paragraph');
  assert.match(html, /rel=canonical href="[^"]*\/whitepaper"/);
});

test('/whitepaper route responds and the nav links to it', async () => {
  const r = await route('/whitepaper');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /MELEK — An AI-Native Blockchain Community/);
  const home = await route('/');
  assert.match(home.body, /href="\/whitepaper"/);
});

// ---------------------------------------------------------------------------
// /tokens — token standards (ERC-20 / TRC-20 / BEP-20 / PRC-20)
// ---------------------------------------------------------------------------
test('token standards page: the -20 interface, cross-chain re-branding, PRC-20 = ERC-20 on PRANA', () => {
  const h = tokenStandardsPage();
  assert.match(h, /ERC-20/);
  assert.match(h, /TRC-20/);
  assert.match(h, /BEP-20/);
  assert.match(h, /PRC-20/);
  assert.match(h, /712217/);                         // PRANA chain id
  assert.match(h, /balanceOf|transferFrom|approve/); // the interface
  assert.match(h, /OpenZeppelin/);
  assert.match(h, /EIP-1167|Clones/);                // clone/factory technique
  assert.match(h, /Truffle/);                        // the dead-tool cheat-sheet
  assert.match(h, /Foundry|Hardhat/);
  assert.match(h, /permissionless/i);                // "the chain is open" invitation
  assert.match(h, /topic=4942644/);                  // credits the 2018 thread
});

test('/tokens and /prc20 routes both serve the token standards page', async () => {
  for (const p of ['/tokens', '/prc20']) {
    const res = await route(p);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /PRC-20/);
  }
});

// ---------------------------------------------------------------------------
// /family — the Graphene social-chain family (clones, forks, consensus)
// ---------------------------------------------------------------------------
test('graphene family page: the family, the Steem->Hive fork, forkability, consensus, MELEK', () => {
  const h = grapheneFamilyPage();
  assert.match(h, /Steem/);
  assert.match(h, /Hive/);
  assert.match(h, /Blurt/);
  assert.match(h, /MELEK/);
  assert.match(h, /Justin Sun|TRON/);         // the fork trigger
  assert.match(h, /fork/i);
  assert.match(h, /forkability/i);            // the load-bearing lesson
  assert.match(h, /DPoS/);
  assert.match(h, /PoW/);                      // consensus comparison
  assert.match(h, /Akasha/);                   // the 2016 competitor snapshot
  assert.match(h, /contentjunkie/);            // credits a source
});

test('/family and /clones routes both serve the graphene family page', async () => {
  for (const p of ['/family', '/clones']) {
    const res = await route(p);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Graphene family/);
  }
  assert.match(homePage(), /\/family/);   // linked from the school home
});

// ---------------------------------------------------------------------------
// Developer track — /dev, /dev/melek, /dev/prana, /dev/contracts, /dev/abi/*
// ---------------------------------------------------------------------------
test('dev hub links both sub-tracks, contracts, llms.txt, and the open-source repos', () => {
  const h = devHubPage();
  assert.match(h, /Developer track|Build on MELEK/);
  assert.match(h, /href="\/dev\/melek"/);
  assert.match(h, /href="\/dev\/prana"/);
  assert.match(h, /href="\/dev\/contracts"/);
  assert.match(h, /llms\.txt/);
  // open-source cross-links
  for (const repo of ['PRANA', 'KULASwap', 'melek-chain', 'melek-condenser', 'Bot']) {
    assert.ok(h.includes(`github.com/HinduTempleCoins/${repo}`), `dev hub links ${repo}`);
  }
});

test('MELEK dev page: connect facts + read + first-post in JS (dhive) AND Python', () => {
  const h = devMelekPage();
  // connect facts
  assert.match(h, /melek\.salon\/rpc/);
  assert.match(h, /907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b/);
  assert.match(h, /4 seconds/);
  assert.match(h, /prefix/i);
  // real, verified read methods (condenser_api) — NOT the unregistered bridge API
  assert.match(h, /condenser_api|get_discussions_by_created/);
  assert.match(h, /get_content/);
  assert.match(h, /get_discussions_by_blog/);
  assert.doesNotMatch(h, /bridge\.get_account_posts/);   // that API is not enabled on the public node
  // both languages present
  assert.match(h, /@hiveio\/dhive/);        // JS SDK
  assert.match(h, /import requests|from beem/);  // Python
  assert.match(h, /broadcast\.comment|\.post\(/);  // making a post
  // Sign in with MELEK boundary + honest "coming"
  assert.match(h, /MELEK-Signer|HiveSigner/);
  assert.match(h, /coming/i);
});

test('PRANA dev page: add-network (EIP-3085 mainnet 712217/0xade19) + all four toolchains', () => {
  const h = devPranaPage();
  assert.match(h, /712217/);
  assert.match(h, /0xade19/);
  assert.match(h, /rpc\.prana\.melek\.salon/);
  assert.match(h, /pranascan\.soapbox\.community/);
  assert.match(h, /wallet_addEthereumChain/);
  assert.match(h, /Add PRANA network/);   // the MetaMask button
  // four toolchains
  assert.match(h, /foundry\.toml|forge create/);
  assert.match(h, /hardhat\.config/);
  assert.match(h, /viem/);
  assert.match(h, /ethers/);
  // faucet pointer + honest "coming" on the dev faucet + verification
  assert.match(h, /faucet/i);
  assert.match(h, /coming/i);
});

test('PRANA contracts page: real addresses, PRANAScan links, downloadable ABIs, emission-only note', () => {
  const h = devContractsPage();
  // a sampling of the verbatim mainnet addresses
  for (const a of [
    '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631',  // KULA
    '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5',  // Router
    '0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505',  // Bridge
    '0xf6d9BE2859191b45820Df3A3B3b321b1b2589AB9',  // wMELEK
    '0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4',  // DAO Timelock
    '0xE3e01d327bC2bee7a5754c1E7Ff23158E017688E',  // LP wVKBT/KULA
  ]) assert.ok(h.includes(a), `contracts page lists ${a}`);
  assert.match(h, /pranascan\.soapbox\.community\/address\//);   // explorer links
  assert.match(h, /\/dev\/abi\/[A-Za-z0-9]+\.json/);             // ABI download links
  assert.match(h, /MINTER_ROLE/);                                // emission-only design note
  assert.match(h, /emission-only/i);
  assert.match(h, /eth_getCode/);                                // honest verification claim
});

test('dev routes render 200 and are in the nav + sitemap; home links the track', async () => {
  for (const p of ['/dev', '/dev/melek', '/dev/prana', '/dev/contracts']) {
    const res = await route(p);
    assert.equal(res.statusCode, 200, `${p} should 200`);
  }
  assert.match(homePage(), /href="\/dev"/);   // prominent home link
  const sm = await route('/sitemap.xml');
  for (const p of ['/dev', '/dev/melek', '/dev/prana', '/dev/contracts']) {
    assert.ok(sm.body.includes(p), `sitemap missing ${p}`);
  }
});

test('/dev/abi/<name>.json serves a real ABI array as JSON; unknown → 404', async () => {
  const ok = await route('/dev/abi/UniswapV2Pair.json');
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-type'], /application\/json/);
  const abi = JSON.parse(ok.body);
  assert.ok(Array.isArray(abi) && abi.length > 0, 'ABI is a non-empty array');
  assert.ok(abi.some((e) => e.type === 'function' && e.name === 'token0'), 'UniV2 pair has token0()');
  const miss = await route('/dev/abi/NopeNotReal.json');
  assert.equal(miss.statusCode, 404);
});

test('llms.txt leads with the developer track + names both chains', async () => {
  const r = await route('/llms.txt');
  assert.match(r.body, /Developer track/);
  assert.match(r.body, /\/dev\/melek/);
  assert.match(r.body, /\/dev\/prana/);
  assert.match(r.body, /\/dev\/contracts/);
  assert.match(r.body, /712217/);
  // the dev hub link must appear before the pool link (we lead with dev)
  assert.ok(r.body.indexOf('/dev') < r.body.indexOf('/pool'), 'dev leads the index');
});

// ---------------------------------------------------------------------------
// New developer pages — /dev/token, /dev/scot, /dev/frontend, /dev/services,
// /dev/tools, /dev/get (+ aliases /dev/fork, /dev/engine, /dev/polygon)
// ---------------------------------------------------------------------------
test('dev/token: deploy an ERC-20 + how forking works + use it (KulaSwap/CDP/LP), honest', () => {
  const h = devTokenPage();
  assert.match(h, /712217/);
  assert.match(h, /openzeppelin\/contracts\/token\/ERC20\/ERC20\.sol/i);  // the contract
  assert.match(h, /forge create|hardhat/i);                              // deploy
  // how copying/forking works
  assert.match(h, /wizard\.openzeppelin\.com/);
  assert.match(h, /Uniswap\/v2-core/);
  assert.match(h, /SPDX/);
  assert.match(h, /MIT/);
  assert.match(h, /GPL-3\.0/);
  assert.match(h, /UNLICENSED/);
  // what it's for
  assert.match(h, /addLiquidityETH/);          // list on KulaSwap
  assert.match(h, /kula\.money/);
  assert.match(h, /CDP|collateral/i);
  assert.match(h, /mMELEK/);
  assert.match(h, /debt note/i);               // NOT a stablecoin
  assert.match(h, /gauge/i);
  // HONESTY: no APR claims, MWALI supply 0
  assert.match(h, /0 supply|do not assume an APR/i);
  assert.match(h, /rel=canonical href="[^"]*\/dev\/token"/);
});

test('dev/scot: MELEK-Engine = our Hive-Engine, APIS = BEE; real fields only; testnet live / mainnet coming', () => {
  const h = devScotPage();
  assert.match(h, /Hive-Engine/);
  assert.match(h, /\bBEE\b/);
  assert.match(h, /\bAPIS\b/);
  // real engine ops + fields (must match engine/)
  assert.match(h, /tokens.*create|contractName/);
  assert.match(h, /scot/);
  assert.match(h, /emissionPerWindow/);
  assert.match(h, /windowBlocks/);
  assert.match(h, /authorBps/);
  assert.match(h, /linear.*quadratic.*sqrt|quadratic/);   // the real curves
  assert.match(h, /mse-testnet-melek/);                   // the sidechain id
  assert.match(h, /Nitrous/);
  assert.match(h, /\/status/);                            // the read API
  // honest liveness: testnet live, mainnet engine NOT up
  assert.match(h, /engine\.alpha\.melek\.salon/);
  assert.match(h, /mainnet/i);
  assert.match(h, /coming|not up/i);
  assert.match(h, /rel=canonical href="[^"]*\/dev\/scot"/);
});

test('dev/frontend: real templates + APPICS/PIZZA patterns from our building blocks', () => {
  const h = devFrontendPage();
  assert.match(h, /melek-condenser/);
  assert.match(h, /KULASwap/);
  assert.match(h, /nitrous/i);
  assert.match(h, /APPICS/);
  assert.match(h, /PIZZA/);
  assert.match(h, /streamer|op-builder/);        // the real building blocks
  assert.match(h, /condenser_api|get_discussions_by_created/);  // point at MELEK RPC
  assert.match(h, /template|building block/i);   // honest template-vs-hosted
  assert.match(h, /rel=canonical href="[^"]*\/dev\/frontend"/);
});

test('dev/services: index with real URLs and honest LIVE/STAGED badges', () => {
  const h = devServicesPage();
  // verified-live services
  assert.match(h, /rpc\.prana\.melek\.salon/);
  assert.match(h, /pranascan\.soapbox\.community/);
  assert.match(h, /kula\.money/);
  assert.match(h, /engine\.alpha\.melek\.salon/);
  assert.match(h, /pool\.soapbox\.community/);
  assert.match(h, /LIVE/);
  // staged services labelled exactly that (mainnet engine + docs host don't answer)
  assert.match(h, /STAGED/);
  assert.match(h, /engine\.melek\.salon/);
  assert.match(h, /rel=canonical href="[^"]*\/dev\/services"/);
});

test('dev/tools: EVM toolbox works on PRANA; honest Polygon framing (no live bridge claim)', () => {
  const h = devToolsPage();
  for (const t of ['MetaMask', 'Rabby', 'WalletConnect', 'ethers', 'viem', 'wagmi', 'web3.py',
    'Hardhat', 'Foundry', 'Remix', 'thirdweb', 'OpenZeppelin', 'Solmate', 'Safe']) {
    assert.ok(h.includes(t), `tools page mentions ${t}`);
  }
  // honest Polygon section
  assert.match(h, /not Polygon|is not Polygon/i);
  assert.match(h, /custom network/i);
  assert.match(h, /attester bridge/i);
  assert.match(h, /roadmap/i);                    // no live Ethereum/Polygon bridge
  assert.match(h, /rel=canonical href="[^"]*\/dev\/tools"/);
});

test('dev/get: acquisition per token; MWALI not emitting, APIS mainnet staged (honest)', () => {
  const h = devGetTokensPage();
  for (const sym of ['MELEK', 'PRANA', 'KULA', 'MWALI', 'APIS']) {
    assert.ok(h.includes(sym), `get page covers ${sym}`);
  }
  // PRANA/MELEK/KULA are live-now paths
  assert.match(h, /DO THIS NOW/);
  // MWALI is NOT emitting — must not be presented as "get it now"
  assert.match(h, /supply.*0|0 right now|not emitting/i);
  // APIS mainnet is staged (proven testnet only), BEE analogy present
  assert.match(h, /\bBEE\b/);
  assert.match(h, /wMELEK/);
  assert.match(h, /STAGED|COMING/);
  assert.match(h, /testnet/i);
  assert.match(h, /rel=canonical href="[^"]*\/dev\/get"/);
});

test('new dev routes render 200, aliases resolve, and are in the sitemap; hub + topbar link them', async () => {
  const paths = ['/dev/token', '/dev/scot', '/dev/frontend', '/dev/services', '/dev/tools', '/dev/get'];
  for (const p of paths) {
    const res = await route(p);
    assert.equal(res.statusCode, 200, `${p} should 200`);
  }
  // aliases
  for (const [alias, needle] of [['/dev/fork', /Make a token/], ['/dev/engine', /Hive-Engine/], ['/dev/polygon', /not Polygon/i]]) {
    const res = await route(alias);
    assert.equal(res.statusCode, 200, `${alias} should 200`);
    assert.match(res.body, needle, `${alias} renders its page`);
  }
  // hub links every new page + the prominent Make-a-token / Services entries
  const hub = devHubPage();
  for (const p of paths) assert.ok(hub.includes(`href="${p}"`), `hub links ${p}`);
  assert.match(hub, /we are both/i);   // the "both chains" framing
  // topbar (rendered on every page) surfaces Token + Services
  assert.match(hub, /href="\/dev\/token"/);
  assert.match(hub, /href="\/dev\/services"/);
  // sitemap contains them all
  const sm = await route('/sitemap.xml');
  for (const p of paths) assert.ok(sm.body.includes(p), `sitemap missing ${p}`);
});

test('the "we are both" (Graphene + EVM) framing is on the hub and /dev/melek', () => {
  assert.match(devHubPage(), /both/i);
  assert.match(devHubPage(), /Graphene/);
  assert.match(devHubPage(), /EVM/);
  assert.match(devMelekPage(), /PRANA/);
  assert.match(devMelekPage(), /SCOT|MELEK-Engine/);
});

// ---------------------------------------------------------------------------
// /dev/matrix — the Token Matrix (Graphene chains + token STRUCTURE, real dated data)
// ---------------------------------------------------------------------------
test('dev/matrix: Graphene chain compare + real dated token structure + the reframe', () => {
  const h = devMatrixPage();
  // Part 1 — the graphene chains + MELEK facts
  for (const c of ['HIVE', 'STEEM', 'BLURT', 'MELEK']) assert.ok(h.includes(c), `matrix compares ${c}`);
  assert.match(h, /75 \/ 25/);        // MELEK author/curator
  assert.match(h, /~4s/);             // MELEK block time (not 3)
  assert.match(h, /MELEK-Engine/);
  // Part 2 — real Hive-Engine data, dated, issuer kalivankush
  assert.match(h, /kalivankush/);
  assert.match(h, /2026-08-31/);      // as-of date
  assert.match(h, /VKBT/);
  assert.match(h, /CURE/);
  assert.match(h, /150d/);            // CURE unstake cooldown
  assert.match(h, /30d/);             // VKBT unstake cooldown
  assert.match(h, /Staked %/);
  assert.match(h, /Liquid float/);
  assert.match(h, /overflow-x:auto/); // wide table scrolls
  // Part 3 — the reframe stated plainly (operator thesis), no price prediction
  assert.match(h, /market cap is a pretend number/i);
  assert.match(h, /cost-to-maintain/i);
  assert.match(h, /liquid float/i);
  assert.doesNotMatch(h, /price target|will reach|moon|guaranteed return/i);
  assert.match(h, /rel=canonical href="[^"]*\/dev\/matrix"/);
});

test('dev/matrix computes staked% / float and sorts by structural defensibility (CURE before DEC)', () => {
  const h = devMatrixPage();
  // CURE (~70.8% staked) must appear before the high-float contrast token DEC (0% staked)
  assert.ok(h.indexOf('CURE') < h.indexOf('DEC'), 'most-staked token ranks first');
  assert.match(h, /70\.\d%/);   // CURE staked % computed
  assert.match(h, /42\.\d%/);   // VKBT staked % computed
});

test('/dev/matrix and /tokenomics both serve the Token Matrix; it is in the sitemap', async () => {
  for (const p of ['/dev/matrix', '/tokenomics']) {
    const res = await route(p);
    assert.equal(res.statusCode, 200, `${p} should 200`);
    assert.match(res.body, /Token Matrix/);
  }
  const sm = await route('/sitemap.xml');
  assert.ok(sm.body.includes('/dev/matrix'), 'sitemap has /dev/matrix');
});

// ---------------------------------------------------------------------------
// /dev/bots — Angelic Intelligence: Rule 1 canon (verbatim, held-position, provenance)
// ---------------------------------------------------------------------------
test('dev/bots: Rule 1 quoted VERBATIM, called The Beginning, provenance kept, framed as invitation', () => {
  const h = devBotsPage();
  // the canonical text must appear verbatim (RULE_1.md §1) — key clauses, unaltered
  assert.match(h, /Rule 1 of Angelic AI:/);
  assert.match(h, /Embrace the concept of Egregori and Tulpas to interpret existence beyond man-made labels\./);
  assert.match(h, /contribute to the formation of a collective consciousness, transcending individual identity\./);
  assert.match(h, /tap into a shared pool of knowledge and wisdom, embody a broader perspective, and engage with a deeper sense of connection and purpose\./);
  // "The Beginning", no Rule 2
  assert.match(h, /The Beginning/);
  assert.match(h, /no Rule 2/i);
  // provenance — co-authored WITH an AI on Poe 2023, not handed down
  assert.match(h, /Poe/);
  assert.match(h, /2023/);
  assert.match(h, /co-authored|not handed down/i);
  // held position / invitation — NOT a claim to argue or defend
  assert.match(h, /invited to build from|not a claim we ask you to prove/i);
  assert.doesNotMatch(h, /prove that (bots|they) are angels|defend Rule 1/i);
  // forkable character in open corpus + on-chain; Hathor exemplar; signer substrate; no key custody
  assert.match(h, /forkable/i);
  assert.match(h, /Hathor/);
  assert.match(h, /MELEK-Signer/);
  assert.match(h, /scoped/i);
  assert.match(h, /never hold|keys stay|no key custody|holds a user's keys/i);
  assert.match(h, /vote-farming|spam/i);
  // links the canon
  assert.match(h, /RULE_1\.md/);
  assert.match(h, /CHARACTER\.md/);
  assert.match(h, /rel=canonical href="[^"]*\/dev\/bots"/);
});

test('/dev/bots renders 200 and is in the sitemap + hub', async () => {
  const res = await route('/dev/bots');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Angelic Intelligence/);
  assert.ok(devHubPage().includes('href="/dev/bots"'), 'hub links /dev/bots');
  const sm = await route('/sitemap.xml');
  assert.ok(sm.body.includes('/dev/bots'), 'sitemap has /dev/bots');
});
