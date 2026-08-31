import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategyDecisions, recommendedCapHive, momentumTokens } from './strategy-feed.mjs';

test('DEFAULT OFF: no MOMENTUM_TOKENS → empty decisions (loop unchanged)', async () => {
  delete process.env.MOMENTUM_TOKENS;
  assert.deepEqual(momentumTokens(), []);
  assert.deepEqual(await strategyDecisions(), []);
});

test('momentum SELL (exit held inventory) becomes a loop decision in the right shape', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS'], strategy: 'momentum',
    // fast below slow → exit signal; inventory present → sell the position (round-trip close)
    getSnapshot: async () => ({ fast: 0.019, slow: 0.021, hePrice: 0.02, mid: 0.02 }),
    getState: async () => ({ inventoryToken: 500 }),
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'SELL');
  assert.equal(decisions[0].sym, 'SPS');
  assert.equal(decisions[0].strategy, 'momentum');
});

test('momentum ENTER emits a BUY (loop bleed-guard will gate it downstream)', async () => {
  const decisions = await strategyDecisions({
    tokens: ['DEC'], strategy: 'momentum',
    getSnapshot: async () => ({ fast: 0.0022, slow: 0.002, hePrice: 0.0021, mid: 0.0021 }),
    getState: async () => ({ inventoryToken: 0 }),
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'BUY');
});

test('flat signal → no decision', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS'], strategy: 'momentum',
    getSnapshot: async () => ({ fast: 0.02, slow: 0.02, hePrice: 0.02, mid: 0.02 }),
    getState: async () => ({ inventoryToken: 0 }),
  });
  assert.deepEqual(decisions, []);
});

test('unknown strategy name → empty (soft)', async () => {
  const d = await strategyDecisions({ tokens: ['SPS'], strategy: 'nonesuch', getSnapshot: async () => ({ fast: 1, slow: 1, mid: 1 }) });
  assert.deepEqual(d, []);
});

test('a bad snapshot for one token never breaks the tick', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS', 'DEC'], strategy: 'momentum',
    getSnapshot: async (s) => (s === 'SPS' ? null : { fast: 0.0022, slow: 0.002, mid: 0.0021 }),
    getState: async () => ({ inventoryToken: 0 }),
  });
  assert.equal(decisions.length, 1, 'DEC still produced a decision despite SPS snapshot failing');
});

test('recommendedCapHive computes a fee-clearing size (advisory)', () => {
  const r = recommendedCapHive({ hiveUsd: 0.05, edgePct: 5, roundTripFeePct: 2, targetNetUsd: 1 });
  assert.ok(r.capHive > 0);
  assert.ok(/HIVE/.test(r.note));
  // no net edge after fees → no size clears
  assert.equal(recommendedCapHive({ hiveUsd: 0.05, edgePct: 1, roundTripFeePct: 2 }).capHive, null);
});
