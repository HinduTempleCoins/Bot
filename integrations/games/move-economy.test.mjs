// move-economy.test.mjs — the MELEK Move reward economy: 15% of the blog pool, stake-weighted, hourly.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  dailyEmission, blogPoolDaily, moveBudgetDaily, moveBudgetForEpoch, moveWeight, settle, economySummary,
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
