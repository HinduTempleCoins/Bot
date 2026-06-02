// markets-extra.test.js — the secondary-surface readers, with injected fetch (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fearGreed, categories, exchanges, chainsTVL, stablecoins, __setFetch } from './markets-extra.mjs';
import { invalidate } from './cache.mjs';

const res = (obj) => ({ ok: true, status: 200, json: async () => obj });

test('fearGreed parses the index', async () => {
  invalidate(); __setFetch(async () => res({ data: [{ value: '23', value_classification: 'Extreme Fear', timestamp: '1' }] }));
  const f = await fearGreed();
  assert.equal(f.value, 23); assert.equal(f.classification, 'Extreme Fear');
  __setFetch(null); invalidate();
});

test('categories sorts/limits into the shape', async () => {
  invalidate(); __setFetch(async () => res([
    { id: 'l1', name: 'Layer 1', market_cap: 5, market_cap_change_24h: 2, volume_24h: 1, top_3_coins_id: ['a', 'b', 'c', 'd'] },
  ]));
  const c = await categories({ limit: 5 });
  assert.equal(c[0].name, 'Layer 1'); assert.equal(c[0].top.length, 3);
  __setFetch(null); invalidate();
});

test('exchanges maps trust + volume', async () => {
  invalidate(); __setFetch(async () => res([{ id: 'gdax', name: 'Coinbase', country: 'US', trust_score: 10, trade_volume_24h_btc: 5 }]));
  const e = await exchanges({ limit: 5 });
  assert.equal(e[0].name, 'Coinbase'); assert.equal(e[0].trust, 10);
  __setFetch(null); invalidate();
});

test('chainsTVL filters + sorts by TVL desc', async () => {
  invalidate(); __setFetch(async () => res([
    { name: 'Small', tvl: 10, tokenSymbol: 'S', gecko_id: 's' },
    { name: 'Big', tvl: 1000, tokenSymbol: 'B', gecko_id: 'b' },
    { name: 'NoTvl' },
  ]));
  const c = await chainsTVL({ limit: 5 });
  assert.equal(c[0].name, 'Big'); assert.equal(c.length, 2); // NoTvl dropped
  __setFetch(null); invalidate();
});

test('stablecoins computes peg deviation', async () => {
  invalidate(); __setFetch(async () => res({ peggedAssets: [
    { name: 'Tether', symbol: 'USDT', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 1e9 }, price: 0.999 },
  ] }));
  const s = await stablecoins({ limit: 5 });
  assert.equal(s[0].symbol, 'USDT');
  assert.ok(Math.abs(s[0].peg_off - (-0.1)) < 0.001, `peg_off ${s[0].peg_off}`);
  __setFetch(null); invalidate();
});
