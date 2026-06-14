// agg-xchain-venues.test.mjs — FULLY OFFLINE. Injects a fake fetch; asserts registry shape,
// DefiLlama + Midgard parsing, and that dead / garbage sources soft-fail (never throw).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGG_XCHAIN_VENUES,
  collectAggXchainVenues,
  handler,
  __setFetch,
} from './agg-xchain-venues.mjs';

// --- fake fetch router: matches by URL substring ---
function fakeFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, resp] of routes) {
      if (u.includes(needle)) {
        if (resp === 'throw') throw new Error('network down');
        if (resp === 'notok') return { ok: false, status: 503, json: async () => ({}) };
        if (resp === 'garbage') return { ok: true, status: 200, json: async () => { throw new Error('bad json'); } };
        return { ok: true, status: 200, json: async () => resp };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
}

// realistic-ish DefiLlama summary payload
function summary(total24h, total7d, chains = ['Ethereum', 'BSC']) {
  return { name: 'X', total24h, total7d, total30d: total7d * 4, change_1d: -10, chains };
}

const PROTOCOLS = [
  { name: 'THORChain', slug: 'thorchain', tvl: 123456789 },
  { name: 'Cetus CLMM', slug: 'cetus-clmm', tvl: 23484108 },
  { name: 'Ekubo', slug: 'ekubo', tvl: 21299854 },
  { name: 'Hyperion', slug: 'hyperion', tvl: 10889183 },
  { name: 'Osmosis DEX', slug: 'osmosis-dex', tvl: 15721518 },
  { name: 'Magma', slug: 'magma', tvl: 4378653 },
  { name: 'Hashflow', slug: 'hashflow', tvl: 2000000 },
];

const MIDGARD = { runePriceUSD: '1.25', swapCount24h: '4200', swapVolume: '500000000000000' }; // 5,000,000 RUNE

function happyRoutes() {
  return [
    ['/summary/aggregators/1inch', summary(26310868, 510318243)],
    ['/summary/aggregators/openocean', summary(7308373, 50000000)],
    ['/summary/aggregators/kyberswap-aggregator', summary(99386412, 600000000)],
    ['/summary/dexs/hashflow', summary(1995818, 14000000)],
    ['/summary/dexs/thorchain-dex', summary(0, 0, ['Thorchain'])],
    ['/summary/dexs/osmosis-dex', summary(2710882, 10974462, ['Osmosis'])],
    ['/summary/dexs/cetus-clmm', summary(9273664, 90214491, ['Sui', 'Aptos'])],
    ['/summary/dexs/ekubo', summary(15438405, 100000000, ['Starknet', 'Ethereum'])],
    ['/summary/dexs/hyperion', summary(0, 45720920, ['Aptos'])],
    ['/summary/dexs/magma', { error: 'not found' }], // magma not on dexs
    ['/midgard.ninerealms.com/v2/stats', MIDGARD],
    ['midgard', MIDGARD],
    ['open-api.openocean.finance', { code: 200, data: { outAmount: '2500000000', price_impact: '0.1%' } }],
    ['/protocols', PROTOCOLS],
  ];
}

test('registry has all 10 venues with the right shape', () => {
  assert.equal(AGG_XCHAIN_VENUES.length, 10);
  const names = AGG_XCHAIN_VENUES.map((v) => v.name);
  for (const n of ['1inch', 'OpenOcean', 'KyberSwap', 'Hashflow', 'THORChain', 'Osmosis', 'Cetus', 'Ekubo', 'Hyperion', 'Magma']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  for (const v of AGG_XCHAIN_VENUES) {
    assert.ok(typeof v.name === 'string');
    assert.ok(v.kind === 'A' || v.kind === 'S', `bad kind for ${v.name}`);
    assert.ok(typeof v.chain === 'string');
    assert.equal(typeof v.read, 'function');
  }
  const aggs = AGG_XCHAIN_VENUES.filter((v) => v.kind === 'A').map((v) => v.name);
  assert.deepEqual(aggs.sort(), ['1inch', 'Hashflow', 'KyberSwap', 'OpenOcean']);
});

test('collect parses DefiLlama volume + TVL, returns the contract shape', async () => {
  __setFetch(fakeFetch(happyRoutes()));
  const out = await collectAggXchainVenues();
  __setFetch(null);

  assert.equal(out.ok, true);
  assert.equal(out.count, 10);
  assert.equal(out.venues.length, 10);
  assert.ok(typeof out.asOf === 'string');

  const oneInch = out.venues.find((v) => v.venue === '1inch');
  assert.equal(oneInch.volume24hUsd, 26310868);
  assert.equal(oneInch.kind, 'A');
  assert.ok(oneInch.edgeSignals.activeChains >= 1);

  const cetus = out.venues.find((v) => v.venue === 'Cetus');
  assert.equal(cetus.volume24hUsd, 9273664);
  assert.equal(cetus.tvlUsd, 23484108);
  // volumeToTvl derived signal present when both numbers exist
  assert.ok(cetus.edgeSignals.volumeToTvl > 0);

  // every venue row exposes the documented keys
  for (const v of out.venues) {
    for (const k of ['venue', 'kind', 'chain', 'asOf', 'volume24hUsd', 'tvlUsd', 'edgeSignals']) {
      assert.ok(k in v, `${v.venue} missing key ${k}`);
    }
  }
});

test('THORChain prefers Midgard native stats, converts RUNE→USD', async () => {
  __setFetch(fakeFetch(happyRoutes()));
  const out = await collectAggXchainVenues();
  __setFetch(null);
  const thor = out.venues.find((v) => v.venue === 'THORChain');
  assert.equal(thor.edgeSignals.runePriceUSD, 1.25);
  assert.equal(thor.edgeSignals.swapCount24h, 4200);
  // 500000000000000 / 1e8 = 5,000,000 RUNE * 1.25 = 6,250,000 USD
  assert.equal(thor.edgeSignals.totalSwapVolumeUsd, 6250000);
  assert.equal(thor.tvlUsd, 123456789);
});

test('OpenOcean keyless quote surfaces as an edge signal', async () => {
  __setFetch(fakeFetch(happyRoutes()));
  const out = await collectAggXchainVenues();
  __setFetch(null);
  const oo = out.venues.find((v) => v.venue === 'OpenOcean');
  assert.equal(oo.edgeSignals.liveQuote, true);
  assert.equal(oo.edgeSignals.pair, 'ETH/USDC');
});

test('dead sources soft-fail: rows present, no throw, errors recorded', async () => {
  // every network call throws
  __setFetch(async () => { throw new Error('network down'); });
  const out = await collectAggXchainVenues();
  __setFetch(null);
  assert.equal(out.ok, true);
  assert.equal(out.venues.length, 10);
  for (const v of out.venues) {
    assert.equal(v.volume24hUsd, null);
    assert.equal(v.tvlUsd, null);
    assert.ok(Array.isArray(v.errors));
  }
  assert.equal(out.summary.venuesWithVolume, 0);
});

test('garbage JSON and non-OK responses soft-fail per source', async () => {
  __setFetch(fakeFetch([
    ['/summary/aggregators/1inch', 'garbage'],
    ['/summary/aggregators/openocean', 'notok'],
    ['/protocols', PROTOCOLS],
    // everything else 404s
  ]));
  const out = await collectAggXchainVenues();
  __setFetch(null);
  assert.equal(out.ok, true);
  assert.equal(out.venues.length, 10);
  const oneInch = out.venues.find((v) => v.venue === '1inch');
  assert.equal(oneInch.volume24hUsd, null);
  assert.ok(oneInch.errors.length >= 1);
});

test('handler GET /api/venues/agg-xchain returns JSON 200', async () => {
  __setFetch(fakeFetch(happyRoutes()));
  let code = 0; let body = '';
  const res = {
    writeHead: (c) => { code = c; },
    end: (b) => { body = b; },
  };
  await handler({ url: '/api/venues/agg-xchain', method: 'GET' }, res);
  __setFetch(null);
  assert.equal(code, 200);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.venues.length, 10);
});

test('handler unknown path 404s without throwing', async () => {
  let code = 0; let body = '';
  const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b; } };
  await handler({ url: '/nope', method: 'GET' }, res);
  assert.equal(code, 404);
  assert.equal(JSON.parse(body).ok, false);
});
