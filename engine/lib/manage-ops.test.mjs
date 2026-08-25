/**
 * manage-ops.test.mjs — offline tests for the token-MANAGEMENT op-builders added
 * to op-builder.mjs: burnOp, scotEnableOp, bridgeOutOp. Each must emit a correct
 * client-signable custom_json (contract/action/payload, ACTIVE auth), NEVER hold
 * or return a key, and soft-fail (return {ok:false,error}) on user error rather
 * than throw. Fully offline — no network, no state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  burnOp,
  scotEnableOp,
  bridgeOutOp,
  isValidPranaAddress,
} from './op-builder.mjs';
import { config } from '../config.mjs';

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';

/** Assert a built op is a well-formed client-signable custom_json with ACTIVE auth and no key. */
function assertSignableCustomJson(r, account, contractAction) {
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  const [opName, opBody] = r.op;
  assert.equal(opName, 'custom_json');
  // ACTIVE auth = required_auths carries the signer; posting auth stays empty.
  assert.deepEqual(opBody.required_auths, [account]);
  assert.deepEqual(opBody.required_posting_auths, []);
  assert.equal(opBody.id, config.sidechainId);
  const json = JSON.parse(opBody.json);
  assert.equal(json.contractAction, contractAction);
  // No key material anywhere in the emitted op.
  const blob = JSON.stringify(r);
  assert.ok(!/wif|posting_key|active_key|private|"key"|seed/i.test(blob), 'op must contain no key material');
  return json;
}

// ── burnOp ────────────────────────────────────────────────────────────────
test('burnOp emits a tokens.burn custom_json with active auth', () => {
  const r = burnOp('hathor', { symbol: 'MYTOK', quantity: '100' });
  const json = assertSignableCustomJson(r, 'hathor', 'burn');
  assert.equal(json.contractName, 'tokens');
  assert.equal(json.contractPayload.symbol, 'MYTOK');
  assert.equal(json.contractPayload.quantity, '100');
  assert.equal(r.action, 'burn');
});

test('burnOp lowercases-in / uppercases the symbol', () => {
  const r = burnOp('hathor', { symbol: 'mytok', quantity: '1' });
  assert.equal(JSON.parse(r.op[1].json).contractPayload.symbol, 'MYTOK');
});

test('burnOp summary frames deflation, never a price promise', () => {
  const r = burnOp('hathor', { symbol: 'MYTOK', quantity: '5' });
  assert.match(r.summary, /deflation/i);
  assert.ok(!/price floor|guaranteed|moon|appreciat/i.test(r.summary));
});

test('burnOp rejects a bad account (soft-fail, no throw)', () => {
  const r = burnOp('NotAnAccount!', { symbol: 'MYTOK', quantity: '1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid account/);
});

test('burnOp rejects a bad symbol and a bad quantity', () => {
  assert.equal(burnOp('hathor', { symbol: 'toolongsymbol', quantity: '1' }).ok, false);
  assert.equal(burnOp('hathor', { symbol: 'MYTOK', quantity: '-3' }).ok, false);
  assert.equal(burnOp('hathor', { symbol: 'MYTOK', quantity: 'abc' }).ok, false);
});

test('burnOp throws only on a caller bug (non-object params)', () => {
  assert.throws(() => burnOp('hathor', null), TypeError);
});

// ── scotEnableOp ────────────────────────────────────────────────────────────
test('scotEnableOp emits a scot.enable custom_json with the 65/35 default split', () => {
  const r = scotEnableOp('hathor', {
    symbol: 'MYTOK',
    config: { emissionPerWindow: '10', windowBlocks: 1200 },
  });
  const json = assertSignableCustomJson(r, 'hathor', 'enable');
  assert.equal(json.contractName, 'scot');
  assert.equal(json.contractPayload.symbol, 'MYTOK');
  assert.equal(json.contractPayload.emissionPerWindow, '10');
  assert.equal(json.contractPayload.windowBlocks, 1200);
  assert.equal(json.contractPayload.authorBps, 6500, 'default author split is 65%');
  assert.equal(json.contractPayload.curve, 'linear');
});

test('scotEnableOp honours explicit authorBps/curve/tag', () => {
  const r = scotEnableOp('hathor', {
    symbol: 'MYTOK',
    config: { emissionPerWindow: '10', windowBlocks: 100, authorBps: 5000, curve: 'sqrt', tag: 'mytribe' },
  });
  const p = JSON.parse(r.op[1].json).contractPayload;
  assert.equal(p.authorBps, 5000);
  assert.equal(p.curve, 'sqrt');
  assert.equal(p.tag, 'mytribe');
});

test('scotEnableOp rejects bad emission / window / bps / curve', () => {
  assert.equal(scotEnableOp('hathor', { symbol: 'MYTOK', config: { emissionPerWindow: '0', windowBlocks: 1 } }).ok, false);
  assert.equal(scotEnableOp('hathor', { symbol: 'MYTOK', config: { emissionPerWindow: '1', windowBlocks: 0 } }).ok, false);
  assert.equal(scotEnableOp('hathor', { symbol: 'MYTOK', config: { emissionPerWindow: '1', windowBlocks: 1, authorBps: 99999 } }).ok, false);
  assert.equal(scotEnableOp('hathor', { symbol: 'MYTOK', config: { emissionPerWindow: '1', windowBlocks: 1, curve: 'exp' } }).ok, false);
});

test('scotEnableOp summary carries no appreciation/APY promise', () => {
  const r = scotEnableOp('hathor', { symbol: 'MYTOK', config: { emissionPerWindow: '10', windowBlocks: 100 } });
  assert.ok(!/price floor|guaranteed|moon|APY|appreciat/i.test(r.summary));
});

// ── bridgeOutOp ────────────────────────────────────────────────────────────
test('bridgeOutOp emits a tokens.transfer to custody with the 0x memo', () => {
  const r = bridgeOutOp('hathor', { symbol: 'MYTOK', quantity: '50', toPrana: ADDR });
  const json = assertSignableCustomJson(r, 'hathor', 'transfer');
  assert.equal(json.contractName, 'tokens');
  assert.equal(json.contractPayload.symbol, 'MYTOK');
  assert.equal(json.contractPayload.to, config.bridge.custody);
  assert.equal(json.contractPayload.memo, ADDR);
});

test('bridgeOutOp rejects a non-0x/short PRANA recipient', () => {
  assert.equal(bridgeOutOp('hathor', { symbol: 'MYTOK', quantity: '1', toPrana: 'nothex' }).ok, false);
  assert.equal(bridgeOutOp('hathor', { symbol: 'MYTOK', quantity: '1', toPrana: '0x123' }).ok, false);
});

test('isValidPranaAddress accepts 0x+40hex only', () => {
  assert.equal(isValidPranaAddress(ADDR), true);
  assert.equal(isValidPranaAddress('0xZZ'), false);
  assert.equal(isValidPranaAddress(''), false);
});
