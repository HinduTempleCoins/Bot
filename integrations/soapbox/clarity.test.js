// clarity.test.js — the Tier-1 (external) Clarity proxy is pure (no network), so we test the
// data-completeness scoring + banding directly. The Hive-Engine path is integration-covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clarityFromCoin } from './clarity.mjs';

test('a richly-documented external coin scores higher than a bare one', async () => {
  const rich = await clarityFromCoin({
    source: 'coingecko', source_tier: 1,
    links: { website: 'x', explorer: 'y' }, contracts: [{ chain: 'eth', address: '0x' }],
    supply: { circulating: 100, total: 100, max: 100 }, market_cap_usd: 1000,
  });
  const bare = await clarityFromCoin({ source: 'coingecko', source_tier: 1, links: {}, supply: {} });
  assert.ok(rich.value > bare.value, `rich ${rich.value} should beat bare ${bare.value}`);
  assert.equal(rich.method, 'data-completeness-v1');
});

test('band thresholds map value → label', async () => {
  const full = await clarityFromCoin({
    source: 'coingecko', source_tier: 1,
    links: { website: 'x', explorer: 'y' }, contracts: [{ chain: 'eth', address: '0x' }],
    supply: { circulating: 1, total: 1, max: 1 }, market_cap_usd: 1,
  });
  assert.ok(['high', 'moderate'].includes(full.band));
  const empty = await clarityFromCoin({ source: 'coingecko', source_tier: 1, links: {}, supply: {} });
  assert.equal(empty.band, 'opaque');
});

test('external listings carry the "needs first-party node data" note', async () => {
  const c = await clarityFromCoin({ source: 'coingecko', source_tier: 1, links: {}, supply: {} });
  assert.match(c.notes.tier, /first-party node data/);
});

test('null coin → null', async () => {
  assert.equal(await clarityFromCoin(null), null);
});
