// condenser.test.mjs — offline coverage for the chain-relevance path of relatedCoins() (#254).
// Proves: (a) a coin with a known curated chain hint gets chain-relevant siblings, (b) an unknown
// coin still falls back to top-by-market-cap (non-empty, never regresses to []), (c) the curated
// CHAIN_HINTS map is well-formed. All network is injected — no live calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN_HINTS, chainHintsFor, topCoins, relatedCoins, __setFetch } from './condenser.mjs';
import { __setFetch as heSetFetch } from '../he-client.mjs';
import { invalidate } from './cache.mjs';

// A small CoinGecko /coins/markets fixture: ethereum + two ETH-ecosystem coins + two unrelated L1s.
// Order is market-cap descending (as the real endpoint returns), so a top-by-cap fallback is testable.
const MARKETS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap: 1.2e12, market_cap_rank: 1 },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', market_cap: 4e11, market_cap_rank: 2 },
  { id: 'tron', symbol: 'trx', name: 'TRON', market_cap: 1.5e10, market_cap_rank: 9 },
  { id: 'uniswap', symbol: 'uni', name: 'Uniswap', market_cap: 6e9, market_cap_rank: 20 },
  { id: 'chainlink', symbol: 'link', name: 'Chainlink', market_cap: 9e9, market_cap_rank: 14 },
  { id: 'solana', symbol: 'sol', name: 'Solana', market_cap: 7e10, market_cap_rank: 5 },
];

function mockMarkets() {
  __setFetch(async () => ({ ok: true, status: 200, json: async () => MARKETS }));
  // ourCoins() runs inside relatedCoins via Promise.all; stub Hive-Engine to return nothing fast,
  // keeping the test fully offline and deterministic (the Tier-1 branch never uses `ours` anyway).
  heSetFetch(async () => ({ ok: true, status: 200, json: async () => [] }));
  invalidate();
}
function reset() { __setFetch(null); heSetFetch(null); invalidate(); }

test('CHAIN_HINTS curated map is well-formed', () => {
  assert.ok(CHAIN_HINTS && typeof CHAIN_HINTS === 'object');
  assert.ok(Object.isFrozen(CHAIN_HINTS), 'CHAIN_HINTS should be frozen (auditable, immutable)');
  const keys = Object.keys(CHAIN_HINTS);
  assert.ok(keys.length >= 20, 'map should carry a meaningful set of curated coins');
  for (const [k, v] of Object.entries(CHAIN_HINTS)) {
    assert.equal(k, k.toLowerCase(), `key "${k}" must be lowercase (matched case-insensitively)`);
    assert.ok(Array.isArray(v) && v.length > 0, `value for "${k}" must be a non-empty array`);
    for (const chain of v) {
      assert.equal(typeof chain, 'string', `chain in "${k}" must be a string`);
      assert.ok(chain.length > 0, `chain in "${k}" must be non-empty`);
    }
  }
  // a couple of clearly-correct spot checks
  assert.ok(CHAIN_HINTS.ethereum.includes('ethereum'));
  assert.ok(CHAIN_HINTS.uni.includes('ethereum'));
  assert.ok(CHAIN_HINTS.sol.includes('solana'));
});

test('chainHintsFor resolves by id and symbol, merges explicit chains, lowercases', () => {
  assert.deepEqual(chainHintsFor({ id: 'ethereum' }), ['ethereum']);
  assert.deepEqual(chainHintsFor({ symbol: 'UNI' }), ['ethereum']); // symbol, uppercased input
  assert.deepEqual(chainHintsFor({ id: 'totally-unknown-coin' }), []);
  // an ERC-20 carrying explicit platforms-derived chains still yields hints
  assert.deepEqual(chainHintsFor({ id: 'unknown', chains: ['Ethereum'] }), ['ethereum']);
  assert.deepEqual(chainHintsFor(null), []);
});

test('topCoins attaches a chainsHint to each row (curated, may be [])', async () => {
  mockMarkets();
  try {
    const rows = await topCoins({ limit: 50 });
    const eth = rows.find((r) => r.id === 'ethereum');
    assert.ok(eth, 'ethereum present');
    assert.deepEqual(eth.chainsHint, ['ethereum'], 'ethereum tagged with its ecosystem');
    const uni = rows.find((r) => r.id === 'uniswap');
    assert.deepEqual(uni.chainsHint, ['ethereum'], 'uniswap tagged as Ethereum-ecosystem');
    for (const r of rows) assert.ok(Array.isArray(r.chainsHint), `${r.id} has an array chainsHint`);
  } finally { reset(); }
});

test('(a) a coin with a known chain hint returns chain-relevant related coins', async () => {
  mockMarkets();
  try {
    const related = await relatedCoins({ id: 'ethereum', symbol: 'ETH', source_tier: 1 }, { limit: 6 });
    assert.ok(related.length > 0, 'non-empty');
    const ids = related.map((c) => c.id);
    // every returned sibling must actually share the Ethereum ecosystem (chain-relevant, not top-by-cap)
    for (const c of related) {
      assert.ok((c.chainsHint || []).includes('ethereum'), `${c.id} is Ethereum-ecosystem`);
    }
    assert.ok(ids.includes('uniswap') && ids.includes('chainlink'), 'surfaces ETH ecosystem siblings');
    // it must NOT have just returned the top-by-cap leaders (bitcoin/solana/tron are not ETH-ecosystem)
    assert.ok(!ids.includes('bitcoin'), 'bitcoin (top by cap, different ecosystem) excluded');
    assert.ok(!ids.includes('solana'), 'solana (different ecosystem) excluded');
  } finally { reset(); }
});

test('(b) an unknown coin still falls back to top-by-cap (non-empty)', async () => {
  mockMarkets();
  try {
    const related = await relatedCoins({ id: 'some-obscure-token', symbol: 'OBSC', source_tier: 1 }, { limit: 6 });
    assert.ok(related.length > 0, 'fallback is non-empty — never regresses to []');
    // fallback preserves the upstream (market-cap descending) ordering, target excluded
    assert.equal(related[0].id, 'bitcoin', 'top-by-cap leader first');
    assert.ok(!related.some((c) => c.id === 'some-obscure-token'), 'target excluded from its own related');
  } finally { reset(); }
});

test('Tier-2 (hive-engine) coin path is unchanged (ecosystem siblings, no throw)', async () => {
  mockMarkets();
  try {
    // ourCoins is stubbed empty here, so this just proves the branch is taken and soft-fails cleanly.
    const related = await relatedCoins({ id: 'hive-engine:vkbt', symbol: 'VKBT', source: 'hive-engine', source_tier: 2 });
    assert.ok(Array.isArray(related), 'returns an array, never throws');
  } finally { reset(); }
});

test('relatedCoins(null) returns [] (soft-fail)', async () => {
  assert.deepEqual(await relatedCoins(null), []);
});
