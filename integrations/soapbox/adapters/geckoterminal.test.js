// geckoterminal.test.js — GeckoTerminal (DEX/on-chain) normalizers + soft-fail, injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gt from './geckoterminal.mjs';

const jsonRes = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fail = (status = 429) => ({ ok: false, status, json: async () => ({}) });

test('geckoterminal.newPools normalizes newest pools + respects limit', async () => {
  gt.__setFetch(async () => jsonRes({ data: [
    { attributes: { name: 'PEPE / WETH', fdv_usd: '1000000', volume_usd: { h24: '50000' }, base_token_price_usd: '0.0001', address: '0xpool1' },
      relationships: { network: { data: { id: 'eth' } } } },
    { attributes: { name: 'DOGE / USDC', fdv_usd: '2000000', volume_usd: { h24: '70000' }, base_token_price_usd: '0.2', address: '0xpool2' },
      relationships: { network: { data: { id: 'base' } } } },
  ] }));
  const pools = await gt.newPools({ limit: 1 });
  assert.equal(pools.length, 1);
  assert.equal(pools[0].name, 'PEPE / WETH');
  assert.equal(pools[0].network, 'eth');
  assert.equal(pools[0].fdv, 1000000);   // coerced to number
  assert.equal(pools[0].vol24, 50000);
  assert.equal(pools[0].address, '0xpool1');
  gt.__setFetch(null);
});

test('geckoterminal.newPools soft-fails to [] when fetch errors', async () => {
  gt.__setFetch(async () => fail(429));
  assert.deepEqual(await gt.newPools(), []);
  gt.__setFetch(null);
});

test('geckoterminal.fetchToken normalizes a gt:<network>:<address> id', async () => {
  gt.__setFetch(async () => jsonRes({ data: { attributes: {
    symbol: 'PEPE', name: 'Pepe', price_usd: '0.0001', fdv_usd: '5000000',
    market_cap_usd: '4000000', volume_usd: { h24: '60000' }, total_supply: '420000000000',
  } } }));
  const c = await gt.fetchToken('gt:eth:0xabc');
  assert.equal(c.source, 'geckoterminal');
  assert.equal(c.source_tier, 1);
  assert.equal(c.symbol, 'PEPE');
  assert.equal(c.price_usd, 0.0001);
  assert.equal(c.market_cap_usd, 4000000);
  assert.deepEqual(c.chains, ['eth']);
  assert.equal(c.contracts[0].address, '0xabc');
  gt.__setFetch(null);
});

test('geckoterminal.fetchToken rejects a malformed id (no network/address)', async () => {
  gt.__setFetch(async () => jsonRes({}));
  await assert.rejects(gt.fetchToken('gt:onlyone'), /gt:<network>:<address>/);
  gt.__setFetch(null);
});

test('geckoterminal.fetchToken falls back fdv when market_cap_usd missing', async () => {
  gt.__setFetch(async () => jsonRes({ data: { attributes: {
    symbol: 'NEW', name: 'New', price_usd: '1', fdv_usd: '999', volume_usd: { h24: '1' },
  } } }));
  const c = await gt.fetchToken('gt:base:0xdef');
  assert.equal(c.market_cap_usd, 999);   // uses fdv when market_cap absent
  gt.__setFetch(null);
});

test('geckoterminal.fetchOHLCV resolves top pool then candles, newest-last', async () => {
  gt.__setFetch(async (url) => {
    if (url.includes('/tokens/') && url.includes('/pools')) return jsonRes({ data: [{ attributes: { address: '0xpool' } }] });
    if (url.includes('/ohlcv/')) return jsonRes({ data: { attributes: { ohlcv_list: [
      [200, 0, 0, 0, 11], [100, 0, 0, 0, 10],   // API returns newest-first; adapter reverses
    ] } } });
    return jsonRes({ data: { attributes: {} } });
  });
  const s = await gt.fetchOHLCV('gt:eth:0xabc', { days: 7 });
  assert.equal(s.length, 2);
  assert.equal(s[0].t, 100);   // reversed -> oldest first
  assert.equal(s[0].p, 10);
  assert.equal(s[1].p, 11);
  gt.__setFetch(null);
});

test('geckoterminal.fetchOHLCV soft-fails to [] when no pool found', async () => {
  gt.__setFetch(async () => jsonRes({ data: [] }));   // no pools
  assert.deepEqual(await gt.fetchOHLCV('gt:eth:0xabc'), []);
  gt.__setFetch(null);
});

test('geckoterminal.fetchTokens is empty (address-keyed source)', async () => {
  assert.deepEqual(await gt.fetchTokens(), []);
});
