// evm-dex-venues.test.mjs — OFFLINE tests for integrations/venues/evm-dex-venues.mjs.
//
// Drives the READ-ONLY EVM-DEX venue registry through the injected __setFetch seam (no network).
// Covers: registry shape, per-venue parse of mocked DefiLlama (dexs summary + tvl) + DexScreener,
// the edge-signal computation (incl. an implausible spread flagged as a trap), a dead source
// soft-fail, garbage input soft-fail, the collect aggregator, and the HTTP handler.
//
//   node --test integrations/venues/evm-dex-venues.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVM_DEX_VENUES, collectEvmDexVenues, edgeSignalsFromPairs, handler, __setFetch, MAX_PLAUSIBLE_EDGE,
} from './evm-dex-venues.mjs';

function ok(json) { return { ok: true, status: 200, json: async () => json }; }
function notOk(status = 500) { return { ok: false, status, json: async () => ({}) }; }

// DefiLlama /summary/dexs/<slug> response.
function dexsResp({ v24 = 1e8, v7 = 7e8, v30 = 3e9, chg = -5.5 } = {}) {
  return ok({ total24h: v24, total7d: v7, total30d: v30, totalAllTime: 1e12, change_1d: chg });
}
// DefiLlama /tvl/<slug> response — a BARE number.
function tvlResp(n = 5e8) { return ok(n); }
// DexScreener search response on a given chain/dex.
function dexScreenerResp(pairs) { return ok({ pairs }); }
function pair({ chain = 'ethereum', dex = 'uniswap', base = 'WETH', quote = 'USDC', px = 3000, liq = 5e6, vol = 2e6 } = {}) {
  return { chainId: chain, dexId: dex, baseToken: { symbol: base }, quoteToken: { symbol: quote }, priceUsd: String(px), liquidity: { usd: liq }, volume: { h24: vol } };
}

// Router: dispatch a fetch URL to the right mocked source.
function router({ summary, tvl, screener }) {
  return async (url) => {
    const u = String(url);
    if (u.includes('/summary/dexs/')) return typeof summary === 'function' ? summary() : (summary === null ? notOk() : dexsResp(summary || {}));
    if (u.includes('/tvl/')) return typeof tvl === 'function' ? tvl() : (tvl === null ? notOk() : tvlResp(tvl == null ? 5e8 : tvl));
    if (u.includes('dexscreener')) return typeof screener === 'function' ? screener() : dexScreenerResp(screener || []);
    return notOk(404);
  };
}

test('registry shape: every venue has the required fields and a read() fn', () => {
  assert.ok(Array.isArray(EVM_DEX_VENUES) && EVM_DEX_VENUES.length >= 19, 'all venues present');
  const names = EVM_DEX_VENUES.map((v) => v.name);
  for (const expect of ['Uniswap', 'PancakeSwap', 'Aerodrome', 'Curve', 'Pendle', 'Spectra']) {
    assert.ok(names.includes(expect), `registry includes ${expect}`);
  }
  for (const v of EVM_DEX_VENUES) {
    assert.equal(v.kind, 'S', `${v.name} is spot`);
    assert.equal(typeof v.name, 'string');
    assert.equal(typeof v.chain, 'string');
    assert.equal(typeof v.read, 'function', `${v.name} has read()`);
    assert.equal(typeof v.defillamaSlug, 'string', `${v.name} has a defillama slug`);
  }
});

test('per-venue parse: merges DefiLlama volume + TVL and DexScreener pairs', async () => {
  __setFetch(router({
    summary: { v24: 6e8, v7: 7e9, chg: -44.6 },
    tvl: 2.8e9,
    screener: [
      pair({ dex: 'uniswap', base: 'WETH', quote: 'USDC', px: 3000, liq: 1e7, vol: 5e6 }),
      pair({ dex: 'uniswap', base: 'WBTC', quote: 'USDC', px: 65000, liq: 8e6, vol: 3e6 }),
      pair({ chain: 'polygon', dex: 'quickswap', base: 'WETH', quote: 'USDC', px: 3001, liq: 9e9 }), // wrong chain -> filtered
    ],
  }));
  const uni = EVM_DEX_VENUES.find((v) => v.name === 'Uniswap');
  const r = await uni.read();
  __setFetch(null);
  assert.equal(r.venue, 'Uniswap');
  assert.equal(r.kind, 'S');
  assert.equal(r.volume24hUsd, 6e8);
  assert.equal(r.volume7dUsd, 7e9);
  assert.equal(r.change1dPct, -44.6);
  assert.equal(r.tvlUsd, 2.8e9);
  assert.ok(r.topPairs.length >= 2, 'parsed pairs');
  assert.ok(r.topPairs.every((p) => p.chain === 'ethereum'), 'only the venue chain survived the filter');
  assert.ok(r.topPairs[0].liqUsd >= r.topPairs[1].liqUsd, 'sorted by liquidity');
  assert.deepEqual(r.sources.sort(), ['defillama:dexs', 'defillama:tvl', 'dexscreener']);
  assert.equal(r.errors.length, 0);
});

test('edgeSignalsFromPairs: same pair on two dexes yields a spread; implausible -> trap', () => {
  const pairs = [
    { pair: 'WETH/USDC', priceUsd: 3000, dex: 'uniswap' },
    { pair: 'WETH/USDC', priceUsd: 3030, dex: 'sushiswap' }, // 1% -> plausible edge
    { pair: 'SCAM/USDC', priceUsd: 1, dex: 'a' },
    { pair: 'SCAM/USDC', priceUsd: 2, dex: 'b' },             // 100% -> trap
    { pair: 'LONE/USDC', priceUsd: 5, dex: 'x' },             // single venue -> no signal
  ];
  const sigs = edgeSignalsFromPairs(pairs);
  const weth = sigs.find((s) => s.pair === 'WETH/USDC');
  const scam = sigs.find((s) => s.pair === 'SCAM/USDC');
  assert.ok(weth && weth.edgePct === 1, 'WETH spread is 1%');
  assert.equal(weth.plausible, true);
  assert.ok(scam && scam.plausible === false, 'SCAM 100% spread flagged as a trap');
  assert.ok(scam.edgePct > MAX_PLAUSIBLE_EDGE * 100);
  assert.ok(!sigs.some((s) => s.pair === 'LONE/USDC'), 'single-venue pair produces no signal');
});

test('dead source soft-fail: DefiLlama down -> still returns DexScreener pairs, no throw', async () => {
  __setFetch(router({ summary: null, tvl: null, screener: [pair({ dex: 'aerodrome', base: 'AERO', chain: 'base', px: 0.36, liq: 2e7 })] }));
  const aero = EVM_DEX_VENUES.find((v) => v.name === 'Aerodrome');
  const r = await aero.read();
  __setFetch(null);
  assert.equal(r.volume24hUsd, null, 'volume absent');
  assert.equal(r.tvlUsd, null, 'tvl absent');
  assert.ok(r.topPairs.length >= 1, 'dexscreener still returned a pair');
  assert.ok(r.sources.includes('dexscreener'));
  assert.ok(!r.sources.includes('defillama:dexs'));
});

test('DefiLlama unknown-slug {message} is treated as a miss, not a number', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('/summary/dexs/')) return ok({ message: 'protocol not found' });
    if (u.includes('/tvl/')) return ok('Protocol not found'); // bare string, not a number
    return ok({ pairs: [] });
  });
  const v = EVM_DEX_VENUES.find((x) => x.name === 'Pendle');
  const r = await v.read();
  __setFetch(null);
  assert.equal(r.volume24hUsd, null);
  assert.equal(r.tvlUsd, null);
  assert.equal(r.topPairs.length, 0);
});

test('garbage / total network failure soft-fails to a stub, never throws', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  const v = EVM_DEX_VENUES.find((x) => x.name === 'Curve');
  const r = await v.read();
  __setFetch(null);
  assert.equal(r.venue, 'Curve');
  assert.equal(r.volume24hUsd, null);
  assert.equal(r.tvlUsd, null);
  assert.deepEqual(r.topPairs, []);
  assert.ok(Array.isArray(r.errors));
});

test('collectEvmDexVenues: aggregates all venues and supports a name filter', async () => {
  __setFetch(router({ summary: { v24: 1e8 }, tvl: 1e8, screener: [pair()] }));
  const all = await collectEvmDexVenues();
  assert.equal(all.count, EVM_DEX_VENUES.length);
  assert.ok(all.venues.every((v) => v.venue && 'volume24hUsd' in v));
  const subset = await collectEvmDexVenues({ venues: ['uniswap', 'aerodrome'] });
  __setFetch(null);
  assert.equal(subset.count, 2);
  assert.deepEqual(subset.venues.map((v) => v.venue).sort(), ['Aerodrome', 'Uniswap']);
});

test('handler: GET /api/venues/evm-dex returns read-only JSON, soft-fails to 200', async () => {
  __setFetch(router({ summary: { v24: 5e8 }, tvl: 4e8, screener: [pair()] }));
  let code, headers, body;
  const res = { writeHead: (c, h) => { code = c; headers = h; }, end: (b) => { body = b; } };
  await handler({ url: '/api/venues/evm-dex?venue=uniswap' }, res);
  __setFetch(null);
  assert.equal(code, 200);
  assert.match(headers['content-type'], /application\/json/);
  const j = JSON.parse(body);
  assert.equal(j.surface, 'evm-dex');
  assert.equal(j.readOnly, true);
  assert.equal(j.signer, null);
  assert.equal(j.count, 1);
  assert.equal(j.venues[0].venue, 'Uniswap');
});
