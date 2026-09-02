// hathor-earnings.test.mjs — offline. `node --test`. Deterministic; no keys, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  positionPending, pendingRewards, harvestPlan, forwardPlan, settleHarvest, summary, HATHOR_ACCOUNT,
} from './hathor-earnings.mjs';

const T0 = 1_700_000_000_000;
const DAY = 86400000;

// Hathor's DeFi positions across KulaSwap mechanisms — farm→KULA, PoL gauge→MWALI.
const positions = () => ([
  { id: 'kula-farm-lp', mechanism: 'farm', rewardToken: 'KULA', staked: 1000, ratePerDay: 0.01, lastHarvest: T0 },
  { id: 'pol-gauge-lp', mechanism: 'gauge', rewardToken: 'MWALI', staked: 500, ratePerDay: 0.02, lastHarvest: T0 },
]);

test('pending accrues per position: staked × rate × days (token-generic)', () => {
  const p = positions();
  assert.equal(positionPending(p[0], { now: T0 + DAY }), 10);   // 1000 * 0.01 * 1
  assert.equal(positionPending(p[1], { now: T0 + 2 * DAY }), 20); // 500 * 0.02 * 2
  assert.equal(positionPending({ pending: 3.5 }, { now: T0 }), 3.5); // explicit on-chain pending
});

test('pendingRewards aggregates KULA and MWALI (she earns both)', () => {
  const r = pendingRewards(positions(), { now: T0 + DAY });
  assert.equal(r.byToken.KULA, 10);
  assert.equal(r.byToken.MWALI, 10);
  assert.equal(r.byPosition.length, 2);
});

test('harvestPlan lists claimable positions above dust with mechanism-specific tx intents', () => {
  const plan = harvestPlan(positions(), { now: T0 + DAY, dust: 0.5 });
  assert.equal(plan.harvests.length, 2);
  assert.equal(plan.harvests[0].tx.action, 'harvest');
  assert.equal(plan.byToken.KULA, 10);
  assert.equal(plan.byToken.MWALI, 10);
  // nothing above dust yet → no harvests
  assert.equal(harvestPlan(positions(), { now: T0 + 60_000, dust: 0.5 }).harvests.length, 0);
});

test('forwardPlan sends earnings to Hathor, keeping a gas reserve; keeper→Hathar supported', () => {
  const plan = forwardPlan({ KULA: 10, MWALI: 10, PRANA: 1 }, { keep: { PRANA: 1 } });
  const byTok = Object.fromEntries(plan.transfers.map((t) => [t.token, t.amount]));
  assert.equal(plan.to, HATHOR_ACCOUNT);
  assert.equal(byTok.KULA, 10);
  assert.equal(byTok.MWALI, 10);
  assert.equal(byTok.PRANA, undefined);            // fully reserved for gas → no transfer
  // a throwaway KEEPER forwards everything to Hathor
  const k = forwardPlan({ KULA: 5 }, { from: 'kula-keeper-1', to: 'hathor' });
  assert.equal(k.transfers[0].from, 'kula-keeper-1');
  assert.equal(k.transfers[0].to, 'hathor');
});

test('forwardPlan does not send to self (no-op when from === to)', () => {
  const plan = forwardPlan({ KULA: 5 }, { from: 'hathor', to: 'hathor' });
  assert.deepEqual(plan.transfers, []);
});

test('settleHarvest zeroes pending + resets the clock after a claim', () => {
  const after = settleHarvest(positions(), { now: T0 + DAY, ids: ['kula-farm-lp'] });
  assert.equal(after[0].pending, 0);
  assert.equal(after[0].lastHarvest, T0 + DAY);
  assert.equal(after[1].lastHarvest, T0);          // untouched (not in ids)
});

test('summary gives per-token pending + USD and a total for a HUD / Hathor to describe', () => {
  const s = summary(positions(), { now: T0 + DAY, prices: { KULA: 0.5, MWALI: 0.1 } });
  assert.equal(s.account, HATHOR_ACCOUNT);
  const byTok = Object.fromEntries(s.tokens.map((t) => [t.token, t.usd]));
  assert.equal(byTok.KULA, 5);    // 10 * 0.5
  assert.equal(byTok.MWALI, 1);   // 10 * 0.1
  assert.equal(s.totalUsd, 6);
});
