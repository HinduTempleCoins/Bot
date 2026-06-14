// perps-venues.test.mjs — FULLY OFFLINE. Injected fetch only; no network, ever.
// Asserts registry shape, the Hyperliquid metaAndAssetCtxs parse, a DefiLlama-style parse,
// dead-source soft-fail, and garbage soft-fail — all via the safe (never-throw) shapes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERPS_VENUES, collectPerpsVenues, handler, __setFetch,
  readHyperliquid, readDydx, readParadex, readDefiLlamaDerivs, readVertex,
} from './perps-venues.mjs';

// A fake Response with the .ok/.text() shape the module's getJson expects.
function resp(body, ok = true) {
  return { ok, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
// Build a router fetch that answers by URL substring; unknown URLs → dead (network error).
function routerFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts });
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) {
        if (body === '__throw__') throw new Error('network down');
        if (body === '__notok__') return resp('err', false);
        return resp(typeof body === 'function' ? body(url, opts) : body);
      }
    }
    throw new Error('unrouted: ' + url);
  };
  fn.calls = calls;
  return fn;
}

test('registry shape: every entry is {name, kind:P, chain, read()}', () => {
  assert.ok(Array.isArray(PERPS_VENUES) && PERPS_VENUES.length >= 10);
  for (const v of PERPS_VENUES) {
    assert.equal(typeof v.name, 'string');
    assert.equal(v.kind, 'P');
    assert.equal(typeof v.chain, 'string');
    assert.equal(typeof v.read, 'function');
  }
  // the headline venues are present
  const names = PERPS_VENUES.map((v) => v.name);
  for (const n of ['Hyperliquid', 'dYdX', 'GMX', 'Vertex', 'Aster', 'Lighter', 'edgeX', 'ApeX', 'Paradex', 'Bluefin']) {
    assert.ok(names.includes(n), `missing venue ${n}`);
  }
});

test('Hyperliquid metaAndAssetCtxs parse → per-market mark/funding/oi/vol + oiUsd', async () => {
  const meta = { universe: [
    { name: 'BTC', szDecimals: 5 },
    { name: 'ETH', szDecimals: 4 },
    { name: 'GONE', szDecimals: 2, isDelisted: true },
  ] };
  const ctxs = [
    { markPx: '64434.0', oraclePx: '64458.0', funding: '0.0000125', openInterest: '32636.05', dayNtlVlm: '1307816218.3' },
    { markPx: '3500.0', oraclePx: '3501.0', funding: '-0.0000200', openInterest: '100000.0', dayNtlVlm: '900000000.0' },
    { markPx: '1.0', oraclePx: '1.0', funding: '0', openInterest: '0', dayNtlVlm: '0' },
  ];
  __setFetch(routerFetch({ 'api.hyperliquid.xyz/info': [meta, ctxs] }));
  const r = await readHyperliquid();
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.venue, 'Hyperliquid');
  // delisted dropped
  assert.equal(r.markets.length, 2);
  const btc = r.markets.find((m) => m.symbol === 'BTC');
  assert.equal(btc.markPrice, 64434);
  assert.equal(btc.indexPrice, 64458);
  assert.equal(btc.funding, 0.0000125);
  assert.ok(Math.abs(btc.oiUsd - 32636.05 * 64434) < 1);
  assert.equal(btc.vol24h, 1307816218.3);
  // aggregate volume = sum of dayNtlVlm
  assert.ok(Math.abs(r.volume24hUsd - (1307816218.3 + 900000000)) < 1);
  // edge signals derived
  assert.ok(r.edgeSignals && r.edgeSignals.crowdedLongs);
  assert.equal(r.edgeSignals.crowdedLongs.symbol, 'BTC');   // most-positive funding
  assert.equal(r.edgeSignals.crowdedShorts.symbol, 'ETH');  // most-negative funding
});

test('dYdX v4 perpetualMarkets parse', async () => {
  const body = { markets: {
    'BTC-USD': { ticker: 'BTC-USD', status: 'ACTIVE', oraclePrice: '64436.5', nextFundingRate: '-0.00001', openInterest: '312.9', volume24H: '17236963.5' },
    'OLD-USD': { ticker: 'OLD-USD', status: 'FINAL_SETTLEMENT', oraclePrice: '1', nextFundingRate: '0', openInterest: '0', volume24H: '0' },
  } };
  __setFetch(routerFetch({ 'indexer.dydx.trade': body }));
  const r = await readDydx();
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.markets.length, 1);                  // settled market dropped
  assert.equal(r.markets[0].symbol, 'BTC-USD');
  assert.equal(r.markets[0].markPrice, 64436.5);
  assert.equal(r.markets[0].funding, -0.00001);
  assert.ok(Math.abs(r.markets[0].oiUsd - 312.9 * 64436.5) < 1);
});

test('Paradex markets/summary parse → -PERP only, options dropped', async () => {
  const body = { results: [
    { symbol: 'BTC-USD-PERP', mark_price: '64458.8', underlying_price: '64418.5', funding_rate: '0.00015', open_interest: '78.1', volume_24h: '1194238.1' },
    { symbol: 'BTC-USD-31JUL26-72000-P', mark_price: '8413.7', open_interest: '5', volume_24h: '100' }, // option → dropped
  ] };
  __setFetch(routerFetch({ 'api.prod.paradex.trade': body }));
  const r = await readParadex();
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.markets.length, 1);
  assert.equal(r.markets[0].symbol, 'BTC-USD-PERP');
  assert.equal(r.markets[0].indexPrice, 64418.5);
});

test('DefiLlama derivatives: paywall plaintext → soft-fail (not throw)', async () => {
  __setFetch(routerFetch({ 'api.llama.fi': 'Upgrade to the paid API plan at https://defillama.com/subscription' }));
  const r = await readDefiLlamaDerivs();
  __setFetch();
  assert.equal(r.ok, false);            // plaintext is not JSON → soft-null → fail shape
  assert.deepEqual(r.markets, []);
  assert.equal(r.volume24hUsd, 0);
});

test('DefiLlama derivatives: valid JSON parses to protocol-level rows', async () => {
  const body = { total24h: 5e9, protocols: [
    { name: 'Hyperliquid', total24h: 3e9, openInterestAtEnd: 4e9 },
    { name: 'dYdX', total24h: 1e9, totalOpenInterest: 5e8 },
  ] };
  __setFetch(routerFetch({ 'api.llama.fi': body }));
  const r = await readDefiLlamaDerivs();
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.volume24hUsd, 5e9);
  assert.equal(r.markets.length, 2);
  assert.equal(r.markets[0].symbol, 'Hyperliquid');     // top by vol
});

test('dead source (network throw) soft-fails to the safe shape', async () => {
  __setFetch(routerFetch({ 'gateway.prod.vertexprotocol.com': '__throw__' }));
  const r = await readVertex();
  __setFetch();
  assert.equal(r.ok, false);
  assert.equal(r.venue, 'Vertex');
  assert.deepEqual(r.markets, []);
  assert.equal(r.volume24hUsd, 0);
  assert.ok(typeof r.note === 'string');
});

test('garbage body soft-fails (no throw)', async () => {
  __setFetch(routerFetch({ 'indexer.dydx.trade': '<<<not json at all>>>' }));
  const r = await readDydx();
  __setFetch();
  assert.equal(r.ok, false);
  assert.deepEqual(r.markets, []);
});

test('non-ok HTTP response soft-fails', async () => {
  __setFetch(routerFetch({ 'api.hyperliquid.xyz/info': '__notok__' }));
  const r = await readHyperliquid();
  __setFetch();
  assert.equal(r.ok, false);
});

test('collectPerpsVenues: one live + rest dead → snapshot still valid, never throws', async () => {
  // Only Hyperliquid is routed live; everything else throws (unrouted) → each soft-fails.
  const meta = { universe: [{ name: 'BTC' }] };
  const ctxs = [{ markPx: '100', oraclePx: '100', funding: '0.001', openInterest: '10', dayNtlVlm: '5000' }];
  __setFetch(async (url) => {
    if (String(url).includes('api.hyperliquid.xyz/info')) return resp([meta, ctxs]);
    throw new Error('dead: ' + url);
  });
  const snap = await collectPerpsVenues();
  __setFetch();
  assert.equal(snap.readOnly, true);
  assert.equal(snap.venueCount, PERPS_VENUES.length);
  assert.ok(snap.liveCount >= 1);
  const hl = snap.venues.find((v) => v.venue === 'Hyperliquid');
  assert.equal(hl.ok, true);
  assert.ok(snap.totalVolume24hUsd >= 5000);
});

test('collectPerpsVenues(only) filters by name', async () => {
  __setFetch(async () => { throw new Error('dead'); });
  const snap = await collectPerpsVenues(['hyperliquid', 'dydx']);
  __setFetch();
  assert.equal(snap.venueCount, 2);
});

test('handler GET /api/venues/perps returns JSON snapshot; wrong method/path 4xx', async () => {
  __setFetch(async () => { throw new Error('dead'); });   // all soft-fail; handler still 200
  const mk = () => { const o = { code: 0, body: '', writeHead(c) { o.code = c; }, end(b) { o.body = b; } }; return o; };

  let res = mk();
  await handler({ method: 'GET', url: '/api/venues/perps' }, res);
  __setFetch();
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.venues));

  res = mk();
  await handler({ method: 'POST', url: '/api/venues/perps' }, res);
  assert.equal(res.code, 405);

  res = mk();
  await handler({ method: 'GET', url: '/nope' }, res);
  assert.equal(res.code, 404);
});
