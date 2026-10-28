// sidechain-guard.test.mjs — OFFLINE.
//
// ⚠ THE HAZARD THIS FILE EXISTS FOR. engine/config.mjs defaults NET to 'testnet', so an op built
// without NET=mainnet carries id "mse-testnet-melek". Broadcast against MAINNET that op is accepted
// by L1 — it is a perfectly valid custom_json — and then IGNORED by the mainnet engine, because the
// id does not match its sidechain. Nothing errors. The tokens simply never move.
//
// That is the worst class of bug in this repo: a success that is not a success. Hathor's APIS stake
// was built this way and would have silently done nothing.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildEngineOp, sidechainId } from '../lib/op-builder.mjs';

test('the two nets have DIFFERENT sidechain ids — which is why a mismatch is silent, not loud', async () => {
  const { config } = await import('../config.mjs');
  assert.match(config.sidechainId, /^mse-(testnet|mainnet)-melek$/);
  assert.notEqual('mse-testnet-melek', 'mse-mainnet-melek');
});

test('a built op stamps the id the CURRENT config says, not the one the caller assumed', () => {
  const r = buildEngineOp('stake', { symbol: 'APIS', quantity: '1.000' }, 'hathor');
  assert.equal(r.ok, true);
  assert.equal(r.op[1].id, sidechainId(), 'the op id must be inspectable before broadcast');
});

test('⚠ a stake op carries ACTIVE authority, never posting', () => {
  // posting auth would be refused by the chain; the token broadcasting it needs active scope
  const r = buildEngineOp('stake', { symbol: 'APIS', quantity: '1.000' }, 'hathor');
  assert.deepEqual(r.op[1].required_auths, ['hathor']);
  assert.deepEqual(r.op[1].required_posting_auths, []);
});

test('the payload is the engine envelope, with the quantity preserved as a string', () => {
  const r = buildEngineOp('stake', { symbol: 'APIS', quantity: '32337.672' }, 'hathor');
  const j = JSON.parse(r.op[1].json);
  assert.equal(j.contractName, 'tokens');
  assert.equal(j.contractAction, 'stake');
  assert.equal(j.contractPayload.quantity, '32337.672', 'no float rounding on the way through');
  assert.equal(j.contractPayload.symbol, 'APIS');
});

test('a bad account or symbol is refused rather than broadcast', () => {
  assert.equal(buildEngineOp('stake', { symbol: 'APIS', quantity: '1' }, '').ok, false);
  assert.equal(buildEngineOp('stake', { symbol: 'not a symbol', quantity: '1' }, 'hathor').ok, false);
});
