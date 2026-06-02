// steemd.test.js — the query layer's routing + formatting. Routing is deterministic (no network);
// one data command (price) is covered with an injected adapter fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, COMMANDS } from './steemd.mjs';
import { __setFetch as cgSetFetch } from './adapters/coingecko.mjs';
import { invalidate } from './cache.mjs';

test('empty input → help', async () => {
  const r = await runCommand('');
  assert.equal(r.ok, true);
  assert.match(r.text, /steemd/i);
});

test('unknown verb → not ok with guidance', async () => {
  const r = await runCommand('frobnicate XYZ');
  assert.equal(r.ok, false);
  assert.match(r.text, /unknown command/i);
});

test('registry exposes the core verbs (grows from here)', () => {
  for (const v of ['price', 'clarity', 'holders', 'markets', 'chains', 'global', 'trending', 'help']) {
    assert.equal(typeof COMMANDS[v], 'function', `missing ${v}`);
  }
});

test('price with a missing arg explains usage', async () => {
  const r = await runCommand('price');
  assert.equal(r.ok, false);
  assert.match(r.text, /usage/);
});

test('price routes through the condenser and formats (injected fetch)', async () => {
  invalidate();
  cgSetFetch(async () => ({ ok: true, status: 200, json: async () => ({
    id: 'bitcoin', symbol: 'btc', name: 'Bitcoin',
    market_data: { current_price: { usd: 70000 }, market_cap: { usd: 1.3e12 }, total_volume: { usd: 5e10 }, price_change_percentage_24h: 2.5 },
    platforms: {}, links: { homepage: ['https://bitcoin.org'] },
  }) }));
  const r = await runCommand('price bitcoin');
  assert.equal(r.ok, true);
  assert.match(r.text, /Bitcoin/);
  assert.match(r.text, /\$70,000/);
  assert.equal(r.data.symbol, 'BTC');
  cgSetFetch(null); invalidate();
});
