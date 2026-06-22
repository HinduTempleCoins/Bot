// scot-mint.test.mjs — OFFLINE. The off-chain SCOT mint op-builders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateTribeOp, buildScotMintOp, buildScotEnableOp } from './scot-mint.mjs';
import { config } from '../config.mjs';

const parse = (op) => ({ name: op[0], payload: op[1], json: JSON.parse(op[1].json) });

test('buildCreateTribeOp: valid custom_json envelope for scot.createTribe', () => {
  const r = buildCreateTribeOp('hathor', { symbol: 'scroll', precision: 3, maxSupply: '1000000', emissionPerWindow: '10', windowBlocks: 100, authorBps: 6000, curve: 'sqrt', initialIssue: '500', tag: 'scroll' });
  assert.ok(r.ok, r.error);
  const { name, payload, json } = parse(r.op);
  assert.equal(name, 'custom_json');
  assert.equal(payload.id, config.sidechainId);
  assert.deepEqual(payload.required_auths, ['hathor']);
  assert.equal(json.contractName, 'scot');
  assert.equal(json.contractAction, 'createTribe');
  assert.equal(json.contractPayload.symbol, 'SCROLL');
  assert.equal(json.contractPayload.authorBps, 6000);
  assert.equal(json.contractPayload.initialIssue, '500');
});

test('buildCreateTribeOp: defaults + validation', () => {
  const ok = buildCreateTribeOp('hathor', { symbol: 'REEL', precision: 0, maxSupply: '1000', emissionPerWindow: '1', windowBlocks: 50 });
  assert.ok(ok.ok);
  assert.equal(parse(ok.op).json.contractPayload.authorBps, 5000);
  assert.equal(parse(ok.op).json.contractPayload.curve, 'linear');
  assert.equal(buildCreateTribeOp('hathor', { symbol: 'X', precision: 9, maxSupply: '1', emissionPerWindow: '1', windowBlocks: 1 }).ok, false); // bad precision
  assert.equal(buildCreateTribeOp('hathor', { symbol: 'X', precision: 0, maxSupply: '0', emissionPerWindow: '1', windowBlocks: 1 }).ok, false); // bad maxSupply
  assert.equal(buildCreateTribeOp('hathor', { symbol: 'X', precision: 0, maxSupply: '1', emissionPerWindow: '0', windowBlocks: 1 }).ok, false); // emission 0
  assert.equal(buildCreateTribeOp('hathor', { symbol: 'X', precision: 0, maxSupply: '1', emissionPerWindow: '1', windowBlocks: 0 }).ok, false); // window 0
  assert.equal(buildCreateTribeOp('hathor', { symbol: 'X', precision: 0, maxSupply: '1', emissionPerWindow: '1', windowBlocks: 1, curve: 'cubic' }).ok, false); // bad curve
  assert.equal(buildCreateTribeOp('BAD UPPER', { symbol: 'X', precision: 0, maxSupply: '1', emissionPerWindow: '1', windowBlocks: 1 }).ok, false); // bad account
});

test('buildScotEnableOp: add-Scot-Bot-to-existing-token op', () => {
  const r = buildScotEnableOp('hathor', { symbol: 'MYTOK', emissionPerWindow: '5', windowBlocks: 100, authorBps: 6000 });
  assert.ok(r.ok, r.error);
  const j = parse(r.op).json;
  assert.equal(j.contractName, 'scot');
  assert.equal(j.contractAction, 'enable');
  assert.equal(j.contractPayload.symbol, 'MYTOK');
  assert.equal(j.contractPayload.authorBps, 6000);
  assert.equal(buildScotEnableOp('hathor', { symbol: 'X', emissionPerWindow: '0', windowBlocks: 1 }).ok, false);
  assert.equal(buildScotEnableOp('hathor', { symbol: 'X', emissionPerWindow: '1', windowBlocks: 1, curve: 'cubic' }).ok, false);
});

test('buildScotMintOp: valid mint op + validation', () => {
  const m = buildScotMintOp('hathor', { symbol: 'SCROLL', to: 'bob', quantity: '42' });
  assert.ok(m.ok);
  assert.equal(parse(m.op).json.contractAction, 'mint');
  assert.equal(parse(m.op).json.contractPayload.quantity, '42');
  assert.equal(buildScotMintOp('hathor', { symbol: 'SCROLL', to: 'BAD', quantity: '1' }).ok, false);
  assert.equal(buildScotMintOp('hathor', { symbol: 'SCROLL', to: 'bob', quantity: '0' }).ok, false);
});
