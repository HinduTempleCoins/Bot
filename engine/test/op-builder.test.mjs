/**
 * op-builder.test.mjs — OFFLINE tests for the token-op builders.
 *
 * Asserts every builder produces a correctly-shaped op (precision, max_supply,
 * symbol/NAI, custom_json envelope) and soft-fails (never throws) on bad input.
 * No network, no keys.
 *
 * Run: node --test engine/test/op-builder.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEngineOp,
  buildSmtCreateOp,
  buildSmtSetupOp,
  isValidAccount,
  isValidSymbol,
  isValidNai,
} from '../lib/op-builder.mjs';
import { config, genesis } from '../config.mjs';

// ---- validators ------------------------------------------------------------

test('validators accept good values and reject bad ones', () => {
  assert.equal(isValidAccount('hathor'), true);
  assert.equal(isValidAccount('foo.bar'), true); // dotted segments
  assert.equal(isValidAccount('a.b'), false); // segments too short
  assert.equal(isValidAccount('AB'), false); // uppercase + too short
  assert.equal(isValidAccount('x'), false);
  assert.equal(isValidSymbol('MYTOK'), true);
  assert.equal(isValidSymbol('mytok'), false);
  assert.equal(isValidSymbol('TOOLONGSYMB'), false); // 11 chars
  assert.equal(isValidNai('@@422838704'), true);
  assert.equal(isValidNai('422838704'), false);
});

// ---- engine create ---------------------------------------------------------

test('engine create builds a valid custom_json op with correct fields', () => {
  const r = buildEngineOp('create',
    { symbol: 'mytok', name: 'My Token', precision: 3, maxSupply: '1000000', supplyCapImmutable: true },
    'hathor');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'engine');
  assert.equal(r.action, 'create');
  // op is a Graphene custom_json
  assert.equal(r.op[0], 'custom_json');
  assert.deepEqual(r.op[1].required_auths, ['hathor']);
  assert.deepEqual(r.op[1].required_posting_auths, []);
  assert.equal(r.op[1].id, config.sidechainId);
  // envelope is the engine contract shape
  const env = JSON.parse(r.op[1].json);
  assert.equal(env.contractName, 'tokens');
  assert.equal(env.contractAction, 'create');
  assert.equal(env.contractPayload.symbol, 'MYTOK'); // upcased
  assert.equal(env.contractPayload.precision, 3);
  assert.equal(env.contractPayload.maxSupply, '1000000');
  assert.equal(env.contractPayload.supplyCapImmutable, true);
  assert.match(r.summary, new RegExp(`burns ${config.tokenCreationFee} ${genesis.feeToken}`));
});

test('engine create rejects bad precision / maxSupply / symbol (soft-fail)', () => {
  assert.equal(buildEngineOp('create', { symbol: 'X', precision: 9, maxSupply: '1' }, 'hathor').ok, false);
  assert.equal(buildEngineOp('create', { symbol: 'X', precision: 3, maxSupply: '0' }, 'hathor').ok, false);
  assert.equal(buildEngineOp('create', { symbol: 'lowercase!', precision: 3, maxSupply: '1' }, 'hathor').ok, false);
  assert.equal(buildEngineOp('create', { symbol: 'X', precision: 3, maxSupply: 'abc' }, 'hathor').ok, false);
  // bad account
  assert.equal(buildEngineOp('create', { symbol: 'X', precision: 3, maxSupply: '1' }, 'BAD').ok, false);
});

// ---- engine transfer / issue ----------------------------------------------

test('engine transfer builds a valid op', () => {
  const r = buildEngineOp('transfer', { symbol: 'MYTOK', to: 'bob', quantity: '10.5' }, 'alice');
  assert.equal(r.ok, true);
  const env = JSON.parse(r.op[1].json);
  assert.equal(env.contractAction, 'transfer');
  assert.deepEqual(env.contractPayload, { symbol: 'MYTOK', to: 'bob', quantity: '10.5' });
  assert.deepEqual(r.op[1].required_auths, ['alice']);
});

test('engine transfer rejects self-send and bad quantity', () => {
  assert.equal(buildEngineOp('transfer', { symbol: 'MYTOK', to: 'alice', quantity: '1' }, 'alice').ok, false);
  assert.equal(buildEngineOp('transfer', { symbol: 'MYTOK', to: 'bob', quantity: '-1' }, 'alice').ok, false);
  assert.equal(buildEngineOp('transfer', { symbol: 'MYTOK', to: 'bob', quantity: '0' }, 'alice').ok, false);
  assert.equal(buildEngineOp('transfer', { symbol: 'MYTOK', to: 'BADNAME!', quantity: '1' }, 'alice').ok, false);
});

test('engine issue builds an issuer-signed op', () => {
  const r = buildEngineOp('issue', { symbol: 'MYTOK', to: 'carol', quantity: '500' }, 'hathor');
  assert.equal(r.ok, true);
  const env = JSON.parse(r.op[1].json);
  assert.equal(env.contractAction, 'issue');
  assert.equal(env.contractPayload.to, 'carol');
});

test('engine stake/unstake build quantity-only payloads', () => {
  const s = buildEngineOp('stake', { symbol: 'DRONE', quantity: '10' }, 'hathor');
  assert.equal(s.ok, true);
  assert.deepEqual(JSON.parse(s.op[1].json).contractPayload, { symbol: 'DRONE', quantity: '10' });
  assert.equal(buildEngineOp('unstake', { symbol: 'DRONE', quantity: '5' }, 'hathor').ok, true);
});

test('engine unknown action soft-fails', () => {
  assert.equal(buildEngineOp('frobnicate', { symbol: 'X' }, 'hathor').ok, false);
});

test('engine builder throws only on a non-object params (caller bug)', () => {
  assert.throws(() => buildEngineOp('create', null, 'hathor'), /must be an object/);
});

// ---- SMT create / setup ----------------------------------------------------

test('smt_create builds the standard op with {nai,decimals} symbol', () => {
  const r = buildSmtCreateOp({ controlAccount: 'hathor', precision: 3, nai: '@@422838704' });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'smt');
  assert.equal(r.op[0], 'smt_create');
  assert.equal(r.op[1].control_account, 'hathor');
  assert.deepEqual(r.op[1].symbol, { nai: '@@422838704', decimals: 3 });
  assert.equal(r.op[1].precision, 3);
  assert.deepEqual(r.op[1].extensions, []);
  // never invents a real fee
  assert.match(r.op[1].smt_creation_fee, /TESTS/);
});

test('smt_create rejects a non-pool NAI and bad precision', () => {
  assert.equal(buildSmtCreateOp({ controlAccount: 'hathor', precision: 3, nai: 'nope' }).ok, false);
  assert.equal(buildSmtCreateOp({ controlAccount: 'hathor', precision: 99, nai: '@@422838704' }).ok, false);
  assert.equal(buildSmtCreateOp({ controlAccount: 'BAD', precision: 3, nai: '@@422838704' }).ok, false);
});

test('smt_create accepts an explicit creation fee passthrough', () => {
  const r = buildSmtCreateOp({ controlAccount: 'hathor', precision: 0, nai: '@@642246205', smtCreationFee: '1000.000 TESTS' });
  assert.equal(r.ok, true);
  assert.equal(r.op[1].smt_creation_fee, '1000.000 TESTS');
});

test('smt_setup builds an op with integer max_supply base units', () => {
  const r = buildSmtSetupOp({ controlAccount: 'hathor', nai: '@@422838704', maxSupply: '1000000000', precision: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.op[0], 'smt_setup');
  assert.equal(r.op[1].max_supply, '1000000000');
  assert.deepEqual(r.op[1].symbol, { nai: '@@422838704', decimals: 3 });
});

test('smt_setup rejects non-integer / non-positive max_supply', () => {
  assert.equal(buildSmtSetupOp({ controlAccount: 'hathor', nai: '@@422838704', maxSupply: '1.5' }).ok, false);
  assert.equal(buildSmtSetupOp({ controlAccount: 'hathor', nai: '@@422838704', maxSupply: '0' }).ok, false);
  assert.equal(buildSmtSetupOp({ controlAccount: 'hathor', nai: '@@422838704', maxSupply: 'x' }).ok, false);
});

test('smt_setup omits decimals when precision is not given', () => {
  const r = buildSmtSetupOp({ controlAccount: 'hathor', nai: '@@422838704', maxSupply: '100' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.op[1].symbol, { nai: '@@422838704' });
});
