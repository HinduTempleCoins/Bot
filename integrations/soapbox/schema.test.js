// schema.test.js — the SoapBox condenser contract. Proves normalize fills defaults, validate
// catches bad coins, and the condenser maps a Tier-1 (CoinGecko) payload into the schema with
// an injected fetch (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCoin, normalizeCoin, validateCoin } from './schema.mjs';
import { getCoin, fromCoinGecko, __setFetch, __setClock } from './condenser.mjs';

test('emptyCoin has every schema field', () => {
  const c = emptyCoin();
  for (const f of ['id', 'symbol', 'name', 'source_tier', 'source', 'price_usd', 'market_cap_usd', 'volume_24h_usd', 'supply', 'chains', 'contracts', 'links', 'team', 'ohlcv', 'clarity_score', 'comments_ref', 'updated_at']) {
    assert.ok(f in c, `missing ${f}`);
  }
});

test('normalizeCoin fills defaults from a thin (price-only) feed', () => {
  const c = normalizeCoin({ symbol: 'abc', price: 1.5 }, { tier: 1, source: 'coingecko', updatedAt: 'T' });
  assert.equal(c.id, 'abc');
  assert.equal(c.symbol, 'ABC');
  assert.equal(c.price_usd, 1.5);
  assert.equal(c.source_tier, 1);
  assert.equal(c.comments_ref, 'coin:abc'); // derived
  assert.deepEqual(c.supply, { circulating: 0, total: 0, max: 0 });
});

test('normalizeCoin coerces bad numbers to 0 (never NaN in the schema)', () => {
  const c = normalizeCoin({ symbol: 'x', price: 'not-a-number' }, { tier: 1, source: 's' });
  assert.equal(c.price_usd, 0);
});

test('validateCoin flags missing id/symbol/tier', () => {
  const bad = emptyCoin();
  const { valid, errors } = validateCoin(bad);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /id is required/.test(e)));
  assert.ok(errors.some((e) => /source_tier/.test(e)));
});

test('validateCoin passes a normalized coin', () => {
  const c = normalizeCoin({ symbol: 'btc', name: 'Bitcoin', price: 60000 }, { tier: 1, source: 'coingecko', updatedAt: 'T' });
  assert.equal(validateCoin(c).valid, true);
});

test('condenser maps a CoinGecko payload into the schema (injected fetch)', async () => {
  __setClock(() => '2026-06-01T00:00:00Z');
  __setFetch(async () => ({ ok: true, json: async () => ({
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin',
    market_data: { current_price: { usd: 60000 }, market_cap: { usd: 1.2e12 }, total_volume: { usd: 3e10 }, circulating_supply: 19e6, total_supply: 21e6, max_supply: 21e6 },
    platforms: {}, links: { homepage: ['https://bitcoin.org'], blockchain_site: ['https://blockchair.com/bitcoin'], twitter_screen_name: 'bitcoin' },
  }) }));
  const coin = await getCoin('bitcoin');
  assert.equal(coin.symbol, 'BTC');
  assert.equal(coin.price_usd, 60000);
  assert.equal(coin.source_tier, 1);
  assert.equal(coin.source, 'coingecko');
  assert.equal(coin.updated_at, '2026-06-01T00:00:00Z');
  assert.equal(coin.links.website, 'https://bitcoin.org');
  assert.equal(coin._valid, true);
  __setFetch(null); __setClock(null);
});
