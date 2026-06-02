// adapters.test.js — the uniform adapter interface + Tier-1 failover, with injected fetch (no net).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as coingecko from './coingecko.mjs';
import * as coinpaprika from './coinpaprika.mjs';
import { fetchTokenFailover } from './index.mjs';

const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fail = (status = 429) => ({ ok: false, status, json: async () => ({}) });

test('coingecko adapter normalizes a coin into the schema', async () => {
  coingecko.__setFetch(async () => jsonRes({
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin',
    market_data: { current_price: { usd: 70000 }, market_cap: { usd: 1e12 }, total_volume: { usd: 5e10 }, circulating_supply: 19e6, max_supply: 21e6 },
    platforms: {}, links: { homepage: ['https://bitcoin.org'] },
  }));
  const c = await coingecko.fetchToken('bitcoin');
  assert.equal(c.symbol, 'BTC');
  assert.equal(c.price_usd, 70000);
  assert.equal(c.source, 'coingecko');
  assert.equal(c.source_tier, 1);
  coingecko.__setFetch(null);
});

test('failover: CoinGecko 429 → CoinPaprika serves the coin', async () => {
  coingecko.__setFetch(async () => fail(429));               // primary down
  coinpaprika.__setFetch(async (url) => {
    if (url.includes('/tickers/')) return jsonRes({ id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin', circulating_supply: 19e6, max_supply: 21e6, quotes: { USD: { price: 69000, market_cap: 1e12, volume_24h: 4e10 } } });
    if (url.includes('/coins/')) return jsonRes({ team: [{ name: 'Satoshi', position: 'creator' }], links: {} });
    return jsonRes({});                                       // resolveId passthrough (id has a dash)
  });
  const c = await fetchTokenFailover('btc-bitcoin');
  assert.equal(c.source, 'coinpaprika');
  assert.equal(c.price_usd, 69000);
  assert.equal(c.team[0].name, 'Satoshi');
  coingecko.__setFetch(null); coinpaprika.__setFetch(null);
});

test('failover throws only when ALL providers fail', async () => {
  coingecko.__setFetch(async () => fail(500));
  coinpaprika.__setFetch(async () => fail(500));
  await assert.rejects(fetchTokenFailover('btc-bitcoin'));
  coingecko.__setFetch(null); coinpaprika.__setFetch(null);
});
