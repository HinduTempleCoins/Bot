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

test('convert needs amount + symbol', async () => {
  const r = await runCommand('convert 100');
  assert.equal(r.ok, false);
  assert.match(r.text, /usage/);
});

test('registry includes the expanded verbs', () => {
  for (const v of ['convert', 'compare', 'gainers', 'losers', 'ecosystem', 'dapps', 'learn']) {
    assert.equal(typeof COMMANDS[v], 'function', `missing ${v}`);
  }
});

test('learn returns the wiki/learn link without a network call', async () => {
  const r = await runCommand('learn');
  assert.equal(r.ok, true);
  assert.match(r.text, /learn/i);
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

// ── MELEK chain commands (testnet-labeled, via melek-chain.mjs) ──────────────

test('registry exposes the MELEK chain verbs', () => {
  for (const v of ['hathor', 'block', 'witness', 'account', 'feed']) {
    assert.equal(typeof COMMANDS[v], 'function', `missing ${v}`);
  }
});

test('hathor command renders the testnet-labeled status from an injected RPC', async () => {
  const mc = await import('../melek-chain.mjs');
  const prevRpc = process.env.MELEK_RPC_URL;
  process.env.MELEK_RPC_URL = 'http://example.invalid:8090';
  mc.__setFetch(async (url, opts) => {
    const m = JSON.parse(opts.body).method;
    const result = m === 'condenser_api.get_dynamic_global_properties'
      ? { head_block_number: 222000, time: 't', current_witness: 'hathor' }
      : { owner: 'hathor', last_confirmed_block_num: 221990, total_missed: 1,
          sbd_exchange_rate: { base: '1.000 TBD', quote: '1.000 TESTS' }, url: 'https://witness.melek.salon/hathor' };
    return { ok: true, json: async () => ({ result }) };
  });
  try {
    const r = await runCommand('hathor');
    assert.equal(r.ok, true);
    assert.match(r.text, /\[TestNet not MELEK\]/);
    assert.match(r.text, /222,000/);
    assert.match(r.text, /confirming/);
  } finally {
    mc.__setFetch(null);
    if (prevRpc === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = prevRpc;
  }
});

test('chain commands soft-fail when the reader is unconfigured', async () => {
  const prevRpc = process.env.MELEK_RPC_URL;
  delete process.env.MELEK_RPC_URL;
  try {
    for (const cmd of ['hathor', 'block', 'witness hathor', 'feed']) {
      const r = await runCommand(cmd);
      assert.equal(r.ok, false, cmd);
      assert.ok(r.text.length > 0);
    }
    const r = await runCommand('account hathor');
    assert.equal(r.ok, false);
  } finally {
    if (prevRpc !== undefined) process.env.MELEK_RPC_URL = prevRpc;
  }
});

test('help mentions the MELEK chain section with the testnet label', async () => {
  const r = await runCommand('help');
  assert.match(r.text, /\[TestNet not MELEK\]/);
  assert.match(r.text, /`hathor`/);
});

test('search returns the engine link (works with no args too)', async () => {
  const r = await runCommand('search');
  assert.equal(r.ok, true);
  assert.match(r.text, /search\.soapbox\.community/);
  const r2 = await runCommand('search melek witness');
  assert.equal(r2.ok, true);
  assert.match(r2.text, /\?q=melek%20witness/);
});
