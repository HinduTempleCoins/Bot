// coinpaprika.test.js — CoinPaprika adapter normalizers + soft-fail, injected fetch (no net).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as coinpaprika from './coinpaprika.mjs';

const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fail = (status = 429) => ({ ok: false, status, json: async () => ({}) });

test('coinpaprika.fetchTokens normalizes the tickers list', async () => {
  coinpaprika.__setFetch(async () => jsonRes([
    { id: 'btc-bitcoin', symbol: 'btc', name: 'Bitcoin', rank: 1,
      quotes: { USD: { price: 69000, market_cap: 1e12, volume_24h: 4e10, percent_change_24h: 2.5 } } },
    { id: 'eth-ethereum', symbol: 'eth', name: 'Ethereum', rank: 2,
      quotes: { USD: { price: 3500, market_cap: 4e11, volume_24h: 2e10, percent_change_24h: -1.1 } } },
  ]));
  const rows = await coinpaprika.fetchTokens({ limit: 1 });
  assert.equal(rows.length, 1);          // limit respected
  assert.equal(rows[0].symbol, 'BTC');   // upper-cased
  assert.equal(rows[0].price_usd, 69000);
  assert.equal(rows[0].change_24h, 2.5);
  assert.equal(rows[0].rank, 1);
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchTokens tolerates a non-array body', async () => {
  coinpaprika.__setFetch(async () => jsonRes({ not: 'an array' }));
  const rows = await coinpaprika.fetchTokens();
  assert.deepEqual(rows, []);
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchToken normalizes price + team (id already a paprika id)', async () => {
  coinpaprika.__setFetch(async (url) => {
    if (url.includes('/tickers/')) return jsonRes({ id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin',
      circulating_supply: 19e6, total_supply: 19e6, max_supply: 21e6,
      quotes: { USD: { price: 69000, market_cap: 1e12, volume_24h: 4e10 } } });
    if (url.includes('/coins/')) return jsonRes({ team: [{ name: 'Satoshi', position: 'creator' }],
      links: { website: ['https://bitcoin.org'], twitter: [{ url: 'https://twitter.com/btc' }] } });
    return jsonRes({});
  });
  const c = await coinpaprika.fetchToken('btc-bitcoin');
  assert.equal(c.source, 'coinpaprika');
  assert.equal(c.source_tier, 1);
  assert.equal(c.price_usd, 69000);
  assert.equal(c.team[0].name, 'Satoshi');
  assert.equal(c.team[0].role, 'creator');
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchToken resolves a loose id via /search first', async () => {
  const seen = [];
  coinpaprika.__setFetch(async (url) => {
    seen.push(url);
    if (url.includes('/search')) return jsonRes({ currencies: [{ id: 'btc-bitcoin' }] });
    if (url.includes('/tickers/')) return jsonRes({ id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin',
      quotes: { USD: { price: 69000, market_cap: 1e12, volume_24h: 4e10 } } });
    return jsonRes({});                       // /coins meta optional
  });
  const c = await coinpaprika.fetchToken('bitcoin');
  assert.ok(seen.some((u) => u.includes('/search')), 'loose id triggers /search resolve');
  assert.equal(c.price_usd, 69000);
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchToken: optional meta failing does NOT fail the price fetch', async () => {
  coinpaprika.__setFetch(async (url) => {
    if (url.includes('/tickers/')) return jsonRes({ id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin',
      quotes: { USD: { price: 69000, market_cap: 1e12, volume_24h: 4e10 } } });
    if (url.includes('/coins/')) return fail(500);   // team/meta call is down
    return jsonRes({});
  });
  const c = await coinpaprika.fetchToken('btc-bitcoin');
  assert.equal(c.price_usd, 69000);                  // price still served
  assert.deepEqual(c.team, []);                      // team soft-falls to empty
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchTeam soft-fails to [] when meta unavailable', async () => {
  coinpaprika.__setFetch(async () => fail(500));
  const team = await coinpaprika.fetchTeam('btc-bitcoin');
  assert.deepEqual(team, []);
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchTokens rejects when the network throws (caller catches)', async () => {
  coinpaprika.__setFetch(async () => { throw new Error('ECONNRESET'); });
  await assert.rejects(coinpaprika.fetchTokens());
  coinpaprika.__setFetch(null);
});

test('coinpaprika.fetchOHLCV is a stub returning []', async () => {
  assert.deepEqual(await coinpaprika.fetchOHLCV('btc-bitcoin'), []);
});
