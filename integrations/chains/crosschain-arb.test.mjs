// crosschain-arb.test.mjs — OFFLINE tests for integrations/chains/crosschain-arb.mjs.
//
// Drives the cross-chain spread detector through the injected __setFetch seam (no network).
// Covers: schema mapping, the min-liquidity floor, the anti-scam median cluster filter,
// the spread/opportunity threshold, and soft handling of empty results.
//
//   node --test integrations/chains/crosschain-arb.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossChainSpread, checkLegsAgainstSpot, __setFetch } from './crosschain-arb.mjs';

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

test('spot guard DROPS a poisoned pair whose leg prices far off the reference spot', async () => {
  // A fake-WETH pair at $1.50 sits INSIDE the median cluster (so the internal median filter passes
  // it) and manufactures a 50% "profit" signal. An external spot of $1.00 must catch + drop it.
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', sym: 'WETH', price: 1.00, liq: 200000 }),
    mkPair({ chain: 'evilchain', dex: 'rugswap', sym: 'WETH', price: 1.50, liq: 200000 }), // poisoned
  ]));
  const r = await crossChainSpread('WETH', { spotUsd: 1.00 });
  __setFetch(null);
  assert.equal(r.opportunity, null, 'poisoned signal must be dropped, not reported as profit');
  assert.ok(r.suspicious, 'a dropped poisoned signal is surfaced as suspicious');
  assert.equal(r.suspicious.dropped, true);
  assert.ok(/poisoned pair/.test(r.suspicious.reason));
  assert.ok(r.suspicious.offending.some((l) => l.dex === 'rugswap'), 'the off-spot leg is named');
});

test('spot guard PASSES a normal arb whose legs sit within tolerance of spot', async () => {
  // Two legitimate venues ~10% apart, both within 20% of a $1.00 spot — a real, verified opportunity.
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', sym: 'WETH', price: 1.00, liq: 200000 }),
    mkPair({ chain: 'bsc', dex: 'pancake', sym: 'WETH', price: 1.10, liq: 150000 }),
  ]));
  const r = await crossChainSpread('WETH', { spotUsd: 1.05 });
  __setFetch(null);
  assert.ok(r.opportunity, 'a normal in-tolerance spread is reported');
  assert.equal(r.opportunity.verified, true, 'verified against spot');
  assert.equal(r.suspicious, null);
  assert.equal(r.opportunity.spreadPct, 10);
});

test('soft-fail: no reference spot -> opportunity returned but marked unverified (not dropped)', async () => {
  __setFetch(async () => pairsResponse([
    mkPair({ chain: 'ethereum', dex: 'uniswap', sym: 'WETH', price: 1.00, liq: 200000 }),
    mkPair({ chain: 'bsc', dex: 'pancake', sym: 'WETH', price: 1.10, liq: 150000 }),
  ]));
  const r = await crossChainSpread('WETH'); // no spotUsd
  __setFetch(null);
  assert.ok(r.opportunity, 'never dropped silently when no reference is available');
  assert.equal(r.opportunity.verified, false, 'marked unverified instead');
  assert.equal(r.suspicious, null);
});

test('checkLegsAgainstSpot is pure, configurable, and never throws on junk', () => {
  const legs = [{ chain: 'a', dex: 'x', priceUsd: 1.0 }, { chain: 'b', dex: 'y', priceUsd: 1.5 }];
  assert.equal(checkLegsAgainstSpot(legs, 1.0).dropped, true, '50% off > 20% default -> dropped');
  assert.equal(checkLegsAgainstSpot(legs, 1.0, 0.60).ok, true, 'wider tolerance accepts it');
  assert.equal(checkLegsAgainstSpot(legs, 0).verified, false, 'no spot -> unverified, ok:true');
  assert.doesNotThrow(() => checkLegsAgainstSpot([null, {}], NaN));
});

test('__setFetch(null) restores the default seam without throwing', () => {
  assert.doesNotThrow(() => __setFetch(null));
});
