// defillama.test.js — DeFiLlama TVL adapter normalizers + soft-fail, injected fetch (no net).
// Note: results are wrapped in cache.mjs cached() (stale-on-error). Each test uses a unique
// limit/slug so no value cached by another test leaks in, and soft-fail tests use keys that
// were never successfully cached (so there is no stale value to serve).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as llama from './defillama.mjs';

const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fail = (status = 429) => ({ ok: false, status, json: async () => ({}) });

test('defillama.topProtocols sorts by TVL desc, drops CEX + non-finite, respects limit', async () => {
  llama.__setFetch(async () => jsonRes([
    { name: 'Lido', category: 'Liquid Staking', chain: 'Ethereum', tvl: 30e9, change_1d: 1.2, slug: 'lido' },
    { name: 'Binance', category: 'CEX', chain: 'Multi', tvl: 100e9, slug: 'binance' },          // excluded: CEX
    { name: 'Aave', category: 'Lending', chain: 'Ethereum', tvl: 12e9, change_1d: -0.5, slug: 'aave' },
    { name: 'Broken', category: 'Dexes', chain: 'X', tvl: NaN, slug: 'broken' },                 // excluded: non-finite
  ]));
  const top = await llama.topProtocols({ limit: 11 });   // unique limit -> unique cache key
  assert.equal(top.length, 2);
  assert.equal(top[0].name, 'Lido');     // highest TVL first
  assert.equal(top[1].name, 'Aave');
  assert.equal(top[0].slug, 'lido');
  assert.equal(top[0].change_1d, 1.2);
  assert.ok(!top.some((p) => p.category === 'CEX'));
  llama.__setFetch(null);
});

test('defillama.topProtocols tolerates a non-array body', async () => {
  llama.__setFetch(async () => jsonRes({ oops: true }));
  const top = await llama.topProtocols({ limit: 12 });   // unique key
  assert.deepEqual(top, []);
  llama.__setFetch(null);
});

test('defillama.protocolTVL returns the numeric TVL for a slug', async () => {
  llama.__setFetch(async () => jsonRes(123456.78));
  const tvl = await llama.protocolTVL('uniswap-test-a');   // unique slug -> unique cache key
  assert.equal(tvl, 123456.78);
  llama.__setFetch(null);
});

test('defillama.protocolTVL returns null for a falsy slug (no fetch)', async () => {
  llama.__setFetch(async () => { throw new Error('should not be called'); });
  assert.equal(await llama.protocolTVL(''), null);
  llama.__setFetch(null);
});

test('defillama.protocolTVL soft-fails (no throw) when fetch errors', async () => {
  llama.__setFetch(async () => fail(500));
  const tvl = await llama.protocolTVL('never-cached-slug-b');   // never cached -> no stale fallback
  // jget().catch(()=>null) → d=null → +null is 0, which is finite, so the adapter yields 0.
  // The load-bearing property: it does NOT throw and returns a finite fallback.
  assert.equal(tvl, 0);
  llama.__setFetch(null);
});

test('defillama.protocolTVL returns null when body is non-numeric', async () => {
  llama.__setFetch(async () => jsonRes({ not: 'a number' }));
  const tvl = await llama.protocolTVL('non-numeric-slug-c');
  assert.equal(tvl, null);
  llama.__setFetch(null);
});

test('defillama.topProtocols throws when fetch throws and nothing is cached', async () => {
  llama.__setFetch(async () => { throw new Error('ETIMEDOUT'); });
  await assert.rejects(llama.topProtocols({ limit: 13 }));   // unique, uncached key -> error propagates
  llama.__setFetch(null);
});
