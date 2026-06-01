// tokens.test.js — ERC-20 balanceOf decoding with an injected RPC (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erc20Balance, tokenBalances, __setFetch, TOKENS } from './tokens.mjs';

test('erc20Balance decodes balanceOf with correct decimals', async () => {
  // 1234.5 USDT (6 decimals) = 1234500000 = 0x4996_02a0
  __setFetch(async () => ({ ok: true, json: async () => ({ result: '0x' + (1234500000).toString(16) }) }));
  const bal = await erc20Balance(['http://rpc'], '0xtoken', '0x1111111111111111111111111111111111111111', 6);
  assert.equal(bal, 1234.5);
  __setFetch(null);
});

test('erc20Balance handles 18-decimal tokens without precision blowup', async () => {
  // 2.5 DAI (18 decimals) = 2.5 * 1e18
  const raw = 2500000000000000000n;
  __setFetch(async () => ({ ok: true, json: async () => ({ result: '0x' + raw.toString(16) }) }));
  const bal = await erc20Balance(['http://rpc'], '0xtoken', '0x2222222222222222222222222222222222222222', 18);
  assert.ok(Math.abs(bal - 2.5) < 1e-9);
  __setFetch(null);
});

test('erc20Balance pads the holder address into the call data', async () => {
  let captured;
  __setFetch(async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: '0x0' }) }; });
  await erc20Balance(['http://rpc'], '0xtoken', '0xABCdef0000000000000000000000000000000001', 6);
  const data = captured.params[0].data;
  assert.ok(data.startsWith('0x70a08231'));           // balanceOf selector
  assert.ok(data.endsWith('abcdef0000000000000000000000000000000001')); // lowercased, right-aligned
  assert.equal(data.length, 10 + 64);                  // selector + 32-byte arg
  __setFetch(null);
});

test('tokenBalances skips zero balances and returns positives', async () => {
  // USDT -> 100, USDC -> 0, DAI -> 0
  const seq = { };
  __setFetch(async (url, opts) => {
    const to = JSON.parse(opts.body).params[0].to.toLowerCase();
    const usdt = TOKENS.ethereum.USDT.address.toLowerCase();
    return { ok: true, json: async () => ({ result: to === usdt ? '0x' + (100000000).toString(16) : '0x0' }) };
  });
  const bals = await tokenBalances('ethereum', '0x3333333333333333333333333333333333333333');
  assert.equal(bals.length, 1);
  assert.equal(bals[0].symbol, 'USDT');
  assert.equal(bals[0].balance, 100);
  __setFetch(null);
});

test('tokenBalances returns [] for non-EVM or unknown chains', async () => {
  assert.deepEqual(await tokenBalances('solana', 'x'), []);
  assert.deepEqual(await tokenBalances('nope', 'x'), []);
});
