// chain-data.test.mjs — offline, injected fetch. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evmBalance, evmGasPrice, solBalance, solTokenAccounts, duneLatest, providersConfigured, __setFetch } from './chain-data.mjs';

const okJson = (body) => async () => ({ ok: true, json: async () => body });

test('evmBalance via Alchemy → wei + ether', async () => {
  process.env.ALCHEMY_API_KEY = 'k';
  __setFetch(okJson({ result: '0x' + (2n * 10n ** 18n).toString(16) }));
  const r = await evmBalance('0x' + '1'.repeat(40), 'base');
  __setFetch(); delete process.env.ALCHEMY_API_KEY;
  assert.equal(r.ok, true);
  assert.equal(r.ether, 2);
  assert.equal(r.chain, 'base-mainnet');
});

test('evmBalance soft-fails on bad address + missing key', async () => {
  process.env.ALCHEMY_API_KEY = 'k';
  assert.equal((await evmBalance('nope')).reason, 'bad-address');
  delete process.env.ALCHEMY_API_KEY;
  assert.equal((await evmBalance('0x' + '1'.repeat(40))).reason, 'no-alchemy');
});

test('evmGasPrice → gwei', async () => {
  process.env.ALCHEMY_API_KEY = 'k';
  __setFetch(okJson({ result: '0x' + (3n * 10n ** 9n).toString(16) }));
  const r = await evmGasPrice('eth');
  __setFetch(); delete process.env.ALCHEMY_API_KEY;
  assert.equal(r.ok, true);
  assert.equal(r.gwei, 3);
});

test('solBalance via Helius → lamports + sol', async () => {
  process.env.HELIUS_API_KEY = 'k';
  __setFetch(okJson({ result: { value: 1500000000 } }));
  const r = await solBalance('So11111111111111111111111111111111111111112');
  __setFetch(); delete process.env.HELIUS_API_KEY;
  assert.equal(r.ok, true);
  assert.equal(r.sol, 1.5);
});

test('solTokenAccounts parses SPL balances', async () => {
  process.env.HELIUS_API_KEY = 'k';
  __setFetch(okJson({ result: { value: [
    { account: { data: { parsed: { info: { mint: 'MintAAA', tokenAmount: { uiAmount: 42 } } } } } },
  ] } }));
  const r = await solTokenAccounts('OwnerXYZ');
  __setFetch(); delete process.env.HELIUS_API_KEY;
  assert.equal(r.ok, true);
  assert.equal(r.tokens[0].mint, 'MintAAA');
  assert.equal(r.tokens[0].amount, 42);
});

test('duneLatest → rows; soft-fails without key', async () => {
  process.env.DUNE_API_KEY = 'k';
  __setFetch(async () => ({ ok: true, json: async () => ({ result: { rows: [{ a: 1 }, { a: 2 }] } }) }));
  const r = await duneLatest('123456');
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  delete process.env.DUNE_API_KEY;
  assert.equal((await duneLatest('123')).reason, 'no-dune');
});

test('network error never throws', async () => {
  process.env.ALCHEMY_API_KEY = 'k';
  __setFetch(async () => { throw new Error('down'); });
  const r = await evmBalance('0x' + '1'.repeat(40));
  __setFetch(); delete process.env.ALCHEMY_API_KEY;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'rpc-failed');
});

test('providersConfigured reflects env', () => {
  process.env.HELIUS_API_KEY = 'x';
  const p = providersConfigured();
  delete process.env.HELIUS_API_KEY;
  assert.equal(p.helius, true);
});
