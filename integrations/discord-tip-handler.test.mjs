import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTip, parseTip, tokenTipOp } from './discord-tip-handler.mjs';
import { makeTipLedger } from './discord-chain-bridge.mjs';

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

test('a file-backed (persisted) ledger keeps the rate-limit across fresh subprocess-style instances', async () => {
  // Simulate the discord-tip-cli.mjs spawn-per-tip model: a store that survives across ledger rebuilds.
  let store = null;
  const ledger = () => makeTipLedger({ load: () => store, save: (e) => { store = e; } });
  const deps = (l) => ({ tipFrom: 'hathor', ledger: l, broadcast: async () => ({ id: 'tx' }) });
  const now = 1_000_000_000_000;

  // first tip on a fresh process records into the store
  const a = await handleTip('/tip @alice 5 MANNA', { from: 'bob', deps: { ...deps(ledger()), now } });
  assert.equal(a.ok, true);
  assert.ok(store && store.length, 'the tip was persisted');

  // a brand-new ledger (new process) rehydrates from the store and the rate-limit now bites
  const b = await handleTip('/tip @alice 5 MANNA', { from: 'bob', deps: { ...deps(ledger()), now: now + 1000 } });
  assert.equal(b.ok, false);
  assert.match(b.reply, /rate-limited/i);
});
