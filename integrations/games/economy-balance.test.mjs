import { test } from 'node:test';
import assert from 'node:assert';
import {
  createLedger,
  registerFaucet,
  registerDrain,
  project,
  assertBalanced,
} from './economy-balance.mjs';

test('project sums emission vs sink and scales by period', () => {
  const l = createLedger();
  registerFaucet('crops', { rate: 100, drainCategory: 'recipe' }, l);
  registerDrain('recipe-burn', { rate: 80, category: 'recipe' }, l);

  const one = project({ period: 1 }, l);
  assert.equal(one.totalEmission, 100);
  assert.equal(one.totalSink, 80);

  const ten = project({ period: 10 }, l);
  assert.equal(ten.totalEmission, 1000);
  assert.equal(ten.totalSink, 800);
  assert.equal(ten.realIncome, 0);
});

test('healthy when emission is covered by sinks (net <= 0)', () => {
  const l = createLedger();
  registerFaucet('crops', { rate: 100, drainCategory: 'recipe' }, l);
  registerDrain('recipe-burn', { rate: 120, category: 'recipe' }, l);

  const p = project({ period: 1 }, l);
  assert.equal(p.net, -20, 'sinks exceed emission');
  assert.equal(p.healthy, true);
});

test('unhealthy when a faucet has no drain (pure mint inflates the token)', () => {
  const l = createLedger();
  registerFaucet('crops', { rate: 100, drainCategory: 'recipe' }, l); // no recipe drain registered

  const p = project({ period: 1 }, l);
  assert.equal(p.totalSink, 0);
  assert.equal(p.net, 100);
  assert.equal(p.healthy, false);
});

test('arcade/offerwall faucet is real income (advertiser fiat), not emission — stays healthy', () => {
  const l = createLedger();
  registerFaucet('arcade', { rate: 200, realIncome: true }, l); // backed by advertiser fiat, no drain

  const p = project({ period: 1 }, l);
  assert.equal(p.totalEmission, 200);
  assert.equal(p.realIncome, 200);
  assert.equal(p.totalSink, 0);
  assert.equal(p.net, 0, 'real income offsets its own emission');
  assert.equal(p.healthy, true);
});

test('assertBalanced flags a faucet with no matching drain', () => {
  const l = createLedger();
  registerFaucet('gacha', { rate: 30, drainCategory: 'consumable' }, l); // no consumable drain

  const res = assertBalanced({ throwOnFail: false }, l);
  assert.equal(res.ok, false);
  assert.deepEqual(res.unmatched, ['gacha']);

  assert.throws(() => assertBalanced({ throwOnFail: true }, l), /no matching drain/);
});

test('assertBalanced passes when every faucet is matched or real-income exempt', () => {
  const l = createLedger();
  registerFaucet('crops', { rate: 100, drainCategory: 'recipe' }, l);
  registerFaucet('arcade', { rate: 50, realIncome: true }, l); // exempt
  registerDrain('recipe-burn', { rate: 90, category: 'recipe' }, l);

  const res = assertBalanced({ throwOnFail: false }, l);
  assert.equal(res.ok, true);
  assert.deepEqual(res.unmatched, []);
});
