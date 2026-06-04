// crosschain-arb.test.mjs — OFFLINE tests for integrations/chains/crosschain-arb.mjs.
//
// Drives the cross-chain spread detector through the injected __setFetch seam (no network).
// Covers: schema mapping, the min-liquidity floor, the anti-scam median cluster filter,
// the spread/opportunity threshold, and soft handling of empty results.
//
//   node --test integrations/chains/crosschain-arb.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossChainSpread, __setFetch } from './crosschain-arb.mjs';

function pairsResponse(pairs) {
  return { ok: true, status: 200, json: async () => ({ pairs }) };
}
function mkPair({ chain, dex, sym = 'TKN', quote = 'USDC', price, liq, vol = 100000 }) {
  return {
    chainId: chain, dexId: dex,
    baseToken: { symbol: sym }, quoteToken: { symbol: quote },
    priceUsd: String(price), liquidity: { usd: liq }, volume: { h24: vol },
  };
}

test('maps liquid venues into the schema and finds a real cross-chain spread', async () => {
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', price: 1.00, liq: 200000 }),
    mkPair({ chain: 'bsc', dex: 'pancake', price: 1.10, liq: 150000 }),
  ]));
  const r = await crossChainSpread('TKN');
  __setFetch(null);
  assert.equal(r.query, 'TKN');
  assert.equal(r.venues.length, 2);
  assert.equal(r.venues[0].chain, 'ethereum');
  assert.ok(r.opportunity, 'a ~10% spread should be flagged');
  assert.equal(r.opportunity.spreadPct, 10);
  assert.equal(r.opportunity.buyOn, 'ethereum/uniswap');
  assert.equal(r.opportunity.sellOn, 'bsc/pancake');
  assert.equal(r.opportunity.executableLiqUsd, 150000); // min of the two
});

test('drops venues below the min-liquidity floor (anti phantom-pair)', async () => {
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', price: 1.00, liq: 200000 }),
    mkPair({ chain: 'fake', dex: 'rug', price: 5.00, liq: 100 }), // below MIN_LIQ_USD default 5000
  ]));
  const r = await crossChainSpread('TKN');
  __setFetch(null);
  assert.equal(r.venues.length, 1, 'illiquid pair excluded');
  assert.equal(r.opportunity, null, 'need >=2 venues for an opportunity');
});

test('anti-scam median filter rejects a look-alike token outside the price cluster', async () => {
  // Three real venues clustered near $1; one impostor at $100 must NOT manufacture a spread.
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', price: 1.00, liq: 200000 }),
    mkPair({ chain: 'bsc', dex: 'pancake', price: 1.02, liq: 200000 }),
    mkPair({ chain: 'polygon', dex: 'quickswap', price: 0.99, liq: 200000 }),
    mkPair({ chain: 'scamchain', dex: 'honeypot', price: 100.00, liq: 200000 }),
  ]));
  const r = await crossChainSpread('TKN');
  __setFetch(null);
  // opportunity (if any) must be computed from the real cluster, not the $100 impostor.
  if (r.opportunity) {
    assert.ok(r.opportunity.sellUsd < 2, 'spread must come from the ~$1 cluster, not the impostor');
  }
});

test('no opportunity when the spread is below threshold', async () => {
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', price: 1.000, liq: 200000 }),
    mkPair({ chain: 'bsc', dex: 'pancake', price: 1.005, liq: 200000 }), // 0.5% < 3%
  ]));
  const r = await crossChainSpread('TKN');
  __setFetch(null);
  assert.equal(r.opportunity, null);
});

test('empty / single-venue results return a null opportunity, never throw', async () => {
  __setFetch(async () => pairsResponse([]));
  const r1 = await crossChainSpread('NOTHING');
  assert.deepEqual(r1.venues, []);
  assert.equal(r1.opportunity, null);

  __setFetch(async () => pairsResponse([mkPair({ chain: 'ethereum', dex: 'uniswap', price: 1, liq: 200000 })]));
  const r2 = await crossChainSpread('LONELY');
  __setFetch(null);
  assert.equal(r2.venues.length, 1);
  assert.equal(r2.opportunity, null);
});

test('__setFetch(null) restores the default seam without throwing', () => {
  assert.doesNotThrow(() => __setFetch(null));
});
