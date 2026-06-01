// arb-watchlist.test.js — the opportunity ranking (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankOpportunities } from './arb-watchlist.mjs';

const RESULTS = [
  { query: 'WETH', opportunity: { spreadPct: 5.2, buyOn: 'base/uni', sellOn: 'arb/sushi', buyUsd: 1, sellUsd: 1.05, executableLiqUsd: 50000 } },
  { query: 'USDC', opportunity: null },                                   // no spread
  { query: 'PEPE', opportunity: { spreadPct: 1.1, buyOn: 'a', sellOn: 'b', buyUsd: 1, sellUsd: 1, executableLiqUsd: 100 } }, // below threshold
  { query: 'LINK', opportunity: { spreadPct: 9.8, buyOn: 'c', sellOn: 'd', buyUsd: 1, sellUsd: 1.1, executableLiqUsd: 9000 } },
  null,                                                                    // failed scan
];

test('keeps only real opportunities above the min spread, ranked desc', () => {
  const ranked = rankOpportunities(RESULTS, { minSpread: 3 });
  assert.equal(ranked.length, 2);                  // WETH + LINK (USDC null, PEPE too small, null dropped)
  assert.equal(ranked[0].token, 'LINK');           // 9.8% ranks first
  assert.equal(ranked[1].token, 'WETH');
});

test('threshold is configurable', () => {
  assert.equal(rankOpportunities(RESULTS, { minSpread: 1 }).length, 3); // now PEPE 1.1% qualifies
  assert.equal(rankOpportunities(RESULTS, { minSpread: 10 }).length, 0);
});

test('empty / all-null input yields no opportunities', () => {
  assert.deepEqual(rankOpportunities([null, { opportunity: null }]), []);
});
