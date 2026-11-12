// move-economy.test.mjs — the MELEK Move reward economy: 15% of the blog pool, stake-weighted, hourly.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  dailyEmission, blogPoolDaily, moveBudgetDaily, moveBudgetForEpoch, moveWeight, settle, economySummary,
  GEO_REWARD, stepBoost, diminishFor, STEP_BOOST_TIERS,
} from './move-economy.mjs';

test('emission + the 15%-of-blog-pool budget compute from the chain constants', () => {
  assert.equal(dailyEmission(), 21600);            // 1 MELEK/block × 21,600 blocks/day
  assert.equal(blogPoolDaily(), 21600 * 0.65);     // 14,040
  assert.equal(moveBudgetDaily(), 21600 * 0.65 * 0.15); // 2,106
  assert.equal(Math.round(moveBudgetForEpoch() * 100) / 100, 87.75); // per hour
});

test('move-weight is stake-weighted, like vote weight (more stake → more weight)', () => {
  const lo = moveWeight({ stake: 0, stepBoost: 3, diminish: 1 });
  const hi = moveWeight({ stake: 10000, stepBoost: 3, diminish: 1 });
  assert.ok(hi > lo, 'more stake earns more');
  // newbie with zero stake still has a nonzero weight (the floor → onboarding works)
  assert.ok(lo > 0);
  // activity also scales it: more steps (boost) → more weight at equal stake
  assert.ok(moveWeight({ stake: 1000, stepBoost: 15 }) > moveWeight({ stake: 1000, stepBoost: 1 }));
  // diminishing reduces it
  assert.ok(moveWeight({ stake: 1000, stepBoost: 3, diminish: 0.5 }) < moveWeight({ stake: 1000, stepBoost: 3, diminish: 1 }));
});

test('settle splits the fixed budget proportionally to weight, bounded by the budget', () => {
  const claims = [
    { player: 'a', weight: 300 },
    { player: 'b', weight: 100 },
  ];
  const r = settle(claims, 80);
  assert.equal(r.totalWeight, 400);
  const a = r.payouts.find((p) => p.player === 'a');
  const b = r.payouts.find((p) => p.player === 'b');
  assert.equal(a.amount, 60);     // 300/400 × 80
  assert.equal(b.amount, 20);     // 100/400 × 80
  const total = r.payouts.reduce((s, p) => s + p.amount, 0);
  assert.ok(total <= 80 + 1e-9, 'never exceeds the budget');
});

test('settle is empty-safe: no claims / all zero-weight → no payouts', () => {
  assert.deepEqual(settle([], 80).payouts, []);
  assert.deepEqual(settle([{ player: 'x', weight: 0 }], 80).payouts, []);
});

test('a whale and a newbie share the SAME fixed budget (no new emission)', () => {
  const claims = [
    { player: 'whale', weight: moveWeight({ stake: 10000, stepBoost: 3 }) },
    { player: 'newbie', weight: moveWeight({ stake: 0, stepBoost: 15 }) },
  ];
  const r = settle(claims, 87.75);
  const total = r.payouts.reduce((s, p) => s + p.amount, 0);
  assert.ok(Math.abs(total - 87.75) < 1e-6, 'the whole budget is distributed, never more');
  assert.ok(r.payouts.find((p) => p.player === 'whale').amount > r.payouts.find((p) => p.player === 'newbie').amount);
});

test('economySummary reports the operator-set parameters', () => {
  const s = economySummary();
  assert.equal(s.moveCarvePct, 0.15);
  assert.equal(s.moveBudgetDaily, 2106);
  assert.equal(s.stakeWeighted, true);
});


// The walk lane's reward curve moved here from site/move-miner/server.mjs, because MELEK Ride credits
// a rider's trip distance into this same lane and two copies of a reward curve drift apart.

test('the walk-lane curve lives here now: zone base, step tiers and the repeat-claim diminish', () => {
  assert.equal(GEO_REWARD(), 10);
  assert.equal(stepBoost(0), 1, 'standing still earns the base');
  assert.equal(stepBoost(999), 1);
  assert.equal(stepBoost(1000), 1.2);
  assert.equal(stepBoost(10000), 3);
  assert.equal(stepBoost(50000), 15, 'a serious walker is worth 15x');
  assert.equal(stepBoost(1e9), 15, 'the top tier is the ceiling');
  assert.equal(stepBoost('junk'), 1);
  assert.equal(STEP_BOOST_TIERS[0][0], 1000);
  assert.equal(diminishFor(0), 1);
  assert.equal(diminishFor(1), 0.5);
  assert.ok(diminishFor(9) < diminishFor(1));
  assert.equal(diminishFor(-3), 1);
});

test('a rider\'s credited ride cannot out-earn a walker on this curve', () => {
  // the cap is 25 mi x 2,000 steps/mi x 25% = 12,500 step-equivalents
  const rideWeight = moveWeight({ stake: 0, geoBase: GEO_REWARD(), stepBoost: stepBoost(12500) });
  const walkerWeight = moveWeight({ stake: 0, geoBase: GEO_REWARD(), stepBoost: stepBoost(50000) });
  assert.ok(rideWeight < walkerWeight, 'the longest credited ride is worth less than a 50k-step day');
  assert.equal(stepBoost(12500), 3);
  assert.equal(stepBoost(50000), 15);
});
