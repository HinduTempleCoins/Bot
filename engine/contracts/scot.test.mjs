/**
 * scot.test.mjs — offline unit test for the SCOT BOT MINT (scot.mjs).
 * Run: node --test engine/contracts/scot.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { scot } from './scot.mjs';
import { tokens } from './tokens.mjs';
import { config } from '../config.mjs';

function fresh() { const s = new State(null); bootstrapGenesis(s); return s; }
const ctx = (sender, blockNum = 1) => ({ sender, blockNum, blockId: 'b', txId: 't', authLevel: 'active' });
const apis = (s, a) => { const r = s.findOne('balances', { account: a, symbol: 'APIS' }); return r ? BigInt(r.balance) : 0n; };
// hathor holds genesis APIS for the creation + upgrade fees.

test('enable: add a Scot Bot to an EXISTING token (APIS-gated, issuer-only)', () => {
  const s = fresh();
  assert.ok(tokens.create(s, ctx('hathor'), { symbol: 'MYTOK', name: 'My Token', precision: 0, maxSupply: '1000000' }).ok);
  const before = apis(s, 'hathor');
  const en = scot.enable(s, ctx('hathor'), { symbol: 'MYTOK', emissionPerWindow: '5', windowBlocks: 100, authorBps: 6000 });
  assert.ok(en.ok, en.error);
  assert.equal(en.charged, config.scotFee);
  assert.ok(s.findOne('rewardRules', { symbol: 'MYTOK' }), 'reward rule wired');
  // the scot fee was burned from APIS (creation fee already taken by tokens.create above)
  const feeBase = BigInt(config.scotFee) * 1000n; // APIS precision 3
  assert.equal(before - apis(s, 'hathor'), feeBase);
  // re-configuring an already-SCOT token is free (charged 0)
  const again = scot.enable(s, ctx('hathor'), { symbol: 'MYTOK', emissionPerWindow: '7', windowBlocks: 50 });
  assert.equal(again.charged, '0');
  // non-issuer cannot enable; unknown token rejected
  assert.equal(scot.enable(s, ctx('mallory'), { symbol: 'MYTOK', emissionPerWindow: '1', windowBlocks: 1 }).ok, false);
  assert.equal(scot.enable(s, ctx('hathor'), { symbol: 'GHOST', emissionPerWindow: '1', windowBlocks: 1 }).ok, false);
});

test('createTribe mints a tribe: token + reward rule + founder issue, in one op', () => {
  const s = fresh();
  const r = scot.createTribe(s, ctx('hathor'), {
    symbol: 'SCROLL', name: 'Scroll', precision: 3, maxSupply: '1000000',
    emissionPerWindow: '10', windowBlocks: 100, authorBps: 6000, curve: 'sqrt', initialIssue: '500',
  });
  assert.ok(r.ok, r.error);
  assert.equal(r.tribe, 'SCROLL');
  assert.ok(s.findOne('tokens', { symbol: 'SCROLL' }), 'token created');
  const rule = s.findOne('rewardRules', { symbol: 'SCROLL' });
  assert.ok(rule, 'reward rule wired');
  assert.equal(rule.authorBps, 6000);
  assert.equal(rule.curve, 'sqrt');
  assert.equal(rule.tag, 'scroll'); // default tag = symbol lowercased
  assert.equal(s.findOne('balances', { account: 'hathor', symbol: 'SCROLL' }).balance, '500000'); // 500 @ prec 3
});

test('createTribe defaults: 50/50 author split, linear curve, no founder issue', () => {
  const s = fresh();
  const r = scot.createTribe(s, ctx('hathor'), { symbol: 'REEL', precision: 0, maxSupply: '1000', emissionPerWindow: '1', windowBlocks: 50 });
  assert.ok(r.ok, r.error);
  const rule = s.findOne('rewardRules', { symbol: 'REEL' });
  assert.equal(rule.authorBps, 5000);
  assert.equal(rule.curve, 'linear');
  assert.equal(r.initialIssue, null);
});

test('bad reward params are rejected BEFORE the token is created (atomic — no orphan token)', () => {
  const s = fresh();
  const r = scot.createTribe(s, ctx('hathor'), { symbol: 'BAD', precision: 3, maxSupply: '1000', emissionPerWindow: '0', windowBlocks: 10 });
  assert.equal(r.ok, false);
  assert.equal(s.findOne('tokens', { symbol: 'BAD' }), null, 'no orphan token left behind');
  const r2 = scot.createTribe(s, ctx('hathor'), { symbol: 'BAD', precision: 3, maxSupply: '1000', emissionPerWindow: '1', windowBlocks: 10, curve: 'cubic' });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /curve/);
  assert.equal(s.findOne('tokens', { symbol: 'BAD' }), null);
});

test('scot.mint issues more of a tribe; refuses a non-tribe token', () => {
  const s = fresh();
  scot.createTribe(s, ctx('hathor'), { symbol: 'SCROLL', precision: 0, maxSupply: '1000000', emissionPerWindow: '1', windowBlocks: 10 });
  const m = scot.mint(s, ctx('hathor'), { symbol: 'SCROLL', to: 'bob', quantity: '42' });
  assert.ok(m.ok, m.error);
  assert.equal(s.findOne('balances', { account: 'bob', symbol: 'SCROLL' }).balance, '42');
  // APIS exists but is NOT a tribe → scot.mint refuses
  const notTribe = scot.mint(s, ctx('hathor'), { symbol: 'APIS', to: 'bob', quantity: '1' });
  assert.equal(notTribe.ok, false);
  assert.match(notTribe.error, /not a SCOT tribe/);
});

test('only the issuer can scot.mint their tribe', () => {
  const s = fresh();
  scot.createTribe(s, ctx('hathor'), { symbol: 'SCROLL', precision: 0, maxSupply: '1000000', emissionPerWindow: '1', windowBlocks: 10 });
  assert.equal(scot.mint(s, ctx('mallory'), { symbol: 'SCROLL', to: 'mallory', quantity: '1' }).ok, false);
});

test('soft-fail: duplicate symbol rejected', () => {
  const s = fresh();
  scot.createTribe(s, ctx('hathor'), { symbol: 'SCROLL', precision: 0, maxSupply: '1000', emissionPerWindow: '1', windowBlocks: 10 });
  const dup = scot.createTribe(s, ctx('hathor'), { symbol: 'SCROLL', precision: 0, maxSupply: '1', emissionPerWindow: '1', windowBlocks: 10 });
  assert.equal(dup.ok, false);
});
