// staking-apr.test.mjs — offline tests for the staking-APR estimator. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateApr, aprFromPool } from './staking-apr.mjs';

test('estimateApr derives a known emission→APR figure', () => {
  // 1 token/block * 28,800 blocks/day = 28,800/day; * 365 = 10,512,000/year.
  // Stake exactly the annual emission → APR = 1.0 (100%).
  const r = estimateApr({ rewardPerBlock: 1, totalStaked: 10_512_000 });
  assert.equal(r.dailyReward, 28_800);
  assert.equal(r.annualReward, 10_512_000);
  assert.equal(r.apr, 1);
});

test('estimateApr splits yourAnnual pro-rata to your stake', () => {
  // You hold 10% of the pool → you earn 10% of the annual emission.
  const r = estimateApr({ rewardPerBlock: 1, totalStaked: 10_512_000, yourStake: 1_051_200 });
  assert.equal(r.annualReward, 10_512_000);
  assert.equal(r.yourAnnual, 1_051_200);
  assert.equal(r.apr, 1);
});

test('estimateApr honours a custom blocksPerDay', () => {
  const r = estimateApr({ rewardPerBlock: 2, blocksPerDay: 1000, totalStaked: 1_460_000 });
  // daily = 2*1000 = 2000; annual = 2000*365 = 730,000; apr = 730000/1,460,000 = 0.5.
  assert.equal(r.dailyReward, 2000);
  assert.equal(r.annualReward, 730_000);
  assert.equal(r.apr, 0.5);
});

test('estimateApr soft-fails to apr:0 on zero / missing totalStaked', () => {
  const zero = estimateApr({ rewardPerBlock: 1, totalStaked: 0, yourStake: 100 });
  assert.equal(zero.apr, 0);
  assert.equal(zero.yourAnnual, 0);
  // rewards still computed (pool exists), just no APR without a denominator.
  assert.equal(zero.annualReward, 10_512_000);

  const missing = estimateApr({ rewardPerBlock: 1 });
  assert.equal(missing.apr, 0);
  assert.equal(missing.yourAnnual, 0);

  // garbage / empty input never throws.
  assert.equal(estimateApr().apr, 0);
  assert.equal(estimateApr({ rewardPerBlock: 'x', totalStaked: 'y' }).apr, 0);
});

test('aprFromPool computes emission/staked and soft-fails on zero stake', () => {
  assert.equal(aprFromPool({ annualEmission: 2_000_000, totalStaked: 10_000_000 }), 0.2);
  assert.equal(aprFromPool({ annualEmission: 1_000_000, totalStaked: 0 }), 0);
  assert.equal(aprFromPool({ totalStaked: 10_000_000 }), 0);
  assert.equal(aprFromPool(), 0);
});
