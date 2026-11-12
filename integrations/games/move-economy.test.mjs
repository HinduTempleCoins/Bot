// move-economy.test.mjs — the MELEK Move reward economy: the chain's own "move" fund (15% of
// EMISSION), drawn at 150.000 MELEK per closed hour and split stake-weighted.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  dailyEmission, blogPoolDaily, moveBudgetDaily, moveBudgetForEpoch, moveWeight, settle, economySummary,
  MOVE_FUND_PCT, MOVE_EPOCH_CAP, moveFundInflowPerHour, moveFundInflowDaily,
  GEO_REWARD, stepBoost, diminishFor, STEP_BOOST_TIERS,
} from './move-economy.mjs';

test('the walk budget is the CHAIN cap, not a share of the blog pool', () => {
  assert.equal(dailyEmission(), 21600);            // 1 MELEK/block × 21,600 blocks/day
  assert.equal(blogPoolDaily(), 21600 * 0.50);     // 10,800 — the live content_reward_percent is 5000
  // Move is its own fund at 15% of EMISSION (HF24), paid out at a per-hour cap (HF25).
  assert.equal(MOVE_FUND_PCT(), 0.15);
  assert.equal(moveFundInflowDaily(), 3240);
  assert.equal(moveFundInflowPerHour(), 135);
  assert.equal(MOVE_EPOCH_CAP(), 150, 'chain MELEK_MOVE_EPOCH_PAY_CAP_AMOUNT');
  assert.equal(moveBudgetForEpoch(), 150, 'what one closed hour actually splits');
  assert.equal(moveBudgetDaily(), 3600, 'the most the lane can pay in a day');
  // the old model said 87.75/hour — 41.5% under what the chain pays
  assert.notEqual(Math.round(moveBudgetForEpoch() * 100) / 100, 87.75);
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

test('economySummary reports the live split, the fund and the cap — and the flip ahead', () => {
  const s = economySummary();
  assert.equal(s.moveFundPct, 0.15);
  assert.equal(s.moveCapPerHour, 150);
  assert.equal(s.moveBudgetPerHour, 150);
  assert.equal(s.moveBudgetDaily, 3600);
  assert.equal(s.moveFundInflowPerHour, 135);
  assert.equal(s.stakeWeighted, true);
  // the live split, as the chain reports it
  assert.equal(s.split.content, 0.50);
  assert.equal(s.split.move, 0.15);
  assert.equal(s.split.proposal, 0.10);
  // and what the Drive flip makes of it — all six slices accounting for the whole emission
  const a = s.afterDriveFlip;
  assert.equal(a.content + a.move + a.vesting + a.witness + a.proposal + a.drive, 1);
  assert.equal(a.drive, 0.15);
  assert.equal(a.move, s.split.move, 'walking does not move at the flip');
  assert.equal(a.vesting, s.split.vesting, 'nor does vesting');
  assert.match(s.note, /not a share of the blog pool/);
  assert.match(s.capNote, /above the fund's inflow/);
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
