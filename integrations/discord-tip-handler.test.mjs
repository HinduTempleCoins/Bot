import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTip, parseTip, tokenTipOp } from './discord-tip-handler.mjs';

test('parseTip pulls recipient, amount, and token symbol (/ or ! prefix)', () => {
  assert.deepEqual(parseTip('/tip @alice 5 MANNA'), { to: 'alice', amount: 5, symbol: 'MANNA' });
  assert.deepEqual(parseTip('!tip @bob 10'), { to: 'bob', amount: 10, symbol: 'TESTS' });
  assert.equal(parseTip('/price BTC'), null);
});

test('tokenTipOp builds the engine custom_json transfer (active auth)', () => {
  const [name, op] = tokenTipOp({ from: 'hathor', to: 'alice', symbol: 'MANNA', amount: 5 });
  assert.equal(name, 'custom_json');
  assert.deepEqual(op.required_auths, ['hathor']);
  assert.equal(op.id, 'mse-testnet-melek');
  const j = JSON.parse(op.json);
  assert.equal(j.contractAction, 'transfer');
  assert.deepEqual(j.contractPayload, { symbol: 'MANNA', to: 'alice', quantity: '5' });
});

test('handleTip broadcasts the tip and confirms', async () => {
  const calls = [];
  const out = await handleTip('/tip @alice 5 MANNA', { from: 'bob', deps: { broadcast: async (op) => { calls.push(op); return { id: 'trx-abc123' }; } } });
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.match(out.reply, /tipped \*\*5 MANNA\*\* to @alice/);
});

test('handleTip enforces the per-tip cap (anti-drain)', async () => {
  const out = await handleTip('/tip @alice 9999 MANNA', { from: 'bob', deps: { broadcast: async () => ({ id: 'x' }) } });
  assert.equal(out.ok, false);
  assert.match(out.reply, /cap|max|limit/i);
});

test('handleTip is a no-op on a non-tip message', async () => {
  const out = await handleTip('hello hathor', { from: 'bob', deps: {} });
  assert.equal(out.kind, 'noop');
});

test('handleTip soft-fails (no throw) when the broadcast errors', async () => {
  const out = await handleTip('/tip @alice 5 MANNA', { from: 'bob', deps: { broadcast: async () => ({ error: 'Missing Active Authority' }) } });
  assert.equal(out.ok, false);
  assert.match(out.reply, /Tip failed/);
});
