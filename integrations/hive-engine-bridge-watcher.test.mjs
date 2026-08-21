import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  heQuantityToBase, deriveDeposit, readDeposits, buildAttestations, loadConfig,
} from './hive-engine-bridge-watcher.mjs';

const VKBT_ID = '0x' + '11'.repeat(32); // stand-in for ethers.id("VKBT")
const CURE_ID = '0x' + '22'.repeat(32);
const PRANA = '0x' + 'ab'.repeat(20);
const cfg = {
  custody: 'melekbridge',
  historyUrl: 'https://history.hive-engine.com/accountHistory',
  symbols: ['VKBT', 'CURE'],
  tokenIds: { VKBT: VKBT_ID, CURE: CURE_ID },
  limit: 100,
};

test('heQuantityToBase parses 8dp quantities to base units', () => {
  assert.equal(heQuantityToBase('100.00000000'), '10000000000');
  assert.equal(heQuantityToBase('100'), '10000000000');
  assert.equal(heQuantityToBase('0.00000001'), '1');
  assert.equal(heQuantityToBase('1.5'), '150000000');
  assert.equal(heQuantityToBase('abc'), null);
  assert.equal(heQuantityToBase(''), null);
});

test('deriveDeposit accepts a valid inbound deposit', () => {
  const d = deriveDeposit(
    { operation: 'tokens_transfer', to: 'melekbridge', from: 'alice', symbol: 'VKBT', quantity: '100.00000000', memo: PRANA, transactionId: 'abc123' },
    cfg,
  );
  assert.ok(d);
  assert.equal(d.tokenId, VKBT_ID);
  assert.equal(d.recipient, PRANA);
  assert.equal(d.amount, '10000000000');
  assert.equal(d.from, 'alice');
  assert.ok(d.depositRef.startsWith('0x') && d.depositRef.length === 66);
});

test('deriveDeposit rejects non-deposits', () => {
  const base = { operation: 'tokens_transfer', to: 'melekbridge', from: 'a', symbol: 'VKBT', quantity: '1', memo: PRANA, transactionId: 't' };
  assert.equal(deriveDeposit({ ...base, to: 'someoneelse' }, cfg), null);       // not to custody
  assert.equal(deriveDeposit({ ...base, symbol: 'BEER' }, cfg), null);          // unregistered symbol
  assert.equal(deriveDeposit({ ...base, memo: '' }, cfg), null);                // no memo
  assert.equal(deriveDeposit({ ...base, memo: 'not-an-address' }, cfg), null);  // bad memo
  assert.equal(deriveDeposit({ ...base, quantity: '0' }, cfg), null);           // zero amount
  assert.equal(deriveDeposit({ ...base, operation: 'tokens_issue' }, cfg), null); // not a transfer
  assert.equal(deriveDeposit({ ...base, transactionId: '' }, cfg), null);       // no txid
});

function mockFetch(byUrl) {
  return async (url) => {
    const rows = byUrl(url);
    return rows == null ? { ok: false } : { ok: true, json: async () => rows };
  };
}

test('readDeposits reads both symbols, dedups by txId, soft-fails a bad response', async () => {
  const fetchImpl = mockFetch((url) => {
    if (url.includes('symbol=VKBT')) {
      return [
        { operation: 'tokens_transfer', to: 'melekbridge', from: 'a', symbol: 'VKBT', quantity: '100', memo: PRANA, transactionId: 'v1' },
        { operation: 'tokens_transfer', to: 'melekbridge', from: 'a', symbol: 'VKBT', quantity: '100', memo: PRANA, transactionId: 'v1' }, // dup
        { operation: 'tokens_transfer', to: 'other', from: 'a', symbol: 'VKBT', quantity: '5', memo: PRANA, transactionId: 'v2' },        // not custody
      ];
    }
    if (url.includes('symbol=CURE')) return null; // simulate a failed read → soft-fail, no throw
    return [];
  });
  const deposits = await readDeposits(cfg, fetchImpl);
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0].symbol, 'VKBT');
  assert.equal(deposits[0].amount, '10000000000');
});

test('buildAttestations yields unsigned attestDeposit calls', async () => {
  const fetchImpl = mockFetch((url) =>
    url.includes('symbol=VKBT')
      ? [{ operation: 'tokens_transfer', to: 'melekbridge', from: 'a', symbol: 'VKBT', quantity: '50', memo: PRANA, transactionId: 'v9' }]
      : []);
  const calls = await buildAttestations(cfg, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'attestDeposit');
  assert.equal(calls[0].unsigned, true);
  assert.deepEqual(calls[0].args, [calls[0].args[0], VKBT_ID, PRANA, '5000000000']);
});

test('loadConfig reads env + token-id map', () => {
  const c = loadConfig({ HE_BRIDGE_CUSTODY: 'MelekBridge', HE_BRIDGE_TOKEN_IDS: JSON.stringify({ VKBT: VKBT_ID }) });
  assert.equal(c.custody, 'melekbridge');
  assert.deepEqual(c.symbols, ['VKBT']);
  assert.equal(c.tokenIds.VKBT, VKBT_ID);
});
