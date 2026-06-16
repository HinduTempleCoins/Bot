// melek-loan-amortization.test.mjs — OFFLINE. The self-amortizing MELEK loan: staking yield services
// (and, above breakeven, pays off) the borrow APR. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netCarry, payoffTime, isSelfAmortizing, breakevenStakingApr, projectDebt,
} from './melek-loan-amortization.mjs';

test('netCarry: net rate = stakingApr - borrowApr, scaled by debt', () => {
  const r = netCarry({ debt: 1000, borrowApr: 0.05, stakingApr: 0.12 });
  assert.equal(r.netRate, 0.07);
  assert.equal(r.netIncome, 70, '7% of 1000/yr surplus');
  assert.equal(r.selfAmortizing, true);
});

test('netCarry: fee beats yield → negative carry, not self-amortizing', () => {
  const r = netCarry({ debt: 1000, borrowApr: 0.10, stakingApr: 0.04 });
  assert.equal(r.netRate, -0.06);
  assert.equal(r.netIncome, -60);
  assert.equal(r.selfAmortizing, false);
});

test('netCarry soft-fails to zeros (never throws)', () => {
  assert.deepEqual(netCarry(), { netRate: 0, netIncome: 0, selfAmortizing: false });
  assert.deepEqual(netCarry({ debt: 'x', borrowApr: 'y', stakingApr: 'z' }),
    { netRate: 0, netIncome: 0, selfAmortizing: false });
});

test('SELF-PAYS: staking yield > stability fee → finite payoff time', () => {
  const t = payoffTime({ principal: 1000, borrowApr: 0.05, stakingApr: 0.12 });
  assert.ok(Number.isFinite(t), 'finite payoff');
  assert.ok(t > 0 && t < 100, `reasonable horizon (${t}y)`);
  // closed form: -ln(1 - 0.05/0.12)/0.05
  const expected = -Math.log(1 - 0.05 / 0.12) / 0.05;
  assert.ok(Math.abs(t - expected) < 1e-6);
});

test('BREAKEVEN: stakingApr === borrowApr → payoff is Infinity (carries the fee, never pays down)', () => {
  assert.equal(payoffTime({ principal: 1000, borrowApr: 0.08, stakingApr: 0.08 }), Infinity);
  assert.equal(isSelfAmortizing({ borrowApr: 0.08, stakingApr: 0.08 }), false, 'breakeven is NOT self-amortizing');
});

test('NEVER SELF-PAYS: stakingApr < borrowApr → Infinity payoff', () => {
  assert.equal(payoffTime({ principal: 1000, borrowApr: 0.10, stakingApr: 0.04 }), Infinity);
  assert.equal(isSelfAmortizing({ borrowApr: 0.10, stakingApr: 0.04 }), false);
});

test('higher staking yield → faster payoff (monotonic)', () => {
  const tLow = payoffTime({ principal: 1000, borrowApr: 0.05, stakingApr: 0.08 });
  const tHigh = payoffTime({ principal: 1000, borrowApr: 0.05, stakingApr: 0.20 });
  assert.ok(tHigh < tLow, 'more yield pays off sooner');
});

test('zero-fee loan pays off in 1/stakingApr years (linear)', () => {
  assert.equal(payoffTime({ principal: 1000, borrowApr: 0, stakingApr: 0.10 }), 10);
  assert.equal(payoffTime({ principal: 1000, borrowApr: 0, stakingApr: 0.25 }), 4);
});

test('payoffTime soft-fails to Infinity on no principal / no yield', () => {
  assert.equal(payoffTime({ principal: 0, borrowApr: 0.05, stakingApr: 0.12 }), Infinity);
  assert.equal(payoffTime({ principal: 1000, borrowApr: 0.05, stakingApr: 0 }), Infinity);
  assert.equal(payoffTime(), Infinity);
});

test('isSelfAmortizing requires STRICT inequality (yield > fee)', () => {
  assert.equal(isSelfAmortizing({ borrowApr: 0.05, stakingApr: 0.06 }), true);
  assert.equal(isSelfAmortizing({ borrowApr: 0.05, stakingApr: 0.05 }), false, 'equal is not self-amortizing');
  assert.equal(isSelfAmortizing({ borrowApr: 0.05, stakingApr: 0.04 }), false);
  assert.equal(isSelfAmortizing(), false);
});

test('breakevenStakingApr equals the borrow APR (the threshold to self-pay)', () => {
  assert.equal(breakevenStakingApr({ borrowApr: 0.08 }), 0.08);
  // just above breakeven self-amortizes; just below does not
  assert.equal(isSelfAmortizing({ borrowApr: 0.08, stakingApr: 0.0801 }), true);
  assert.equal(isSelfAmortizing({ borrowApr: 0.08, stakingApr: 0.0799 }), false);
});

test('projectDebt: self-amortizing debt shrinks over time and hits 0 by the payoff time', () => {
  const p = { principal: 1000, borrowApr: 0.05, stakingApr: 0.12 };
  const d5 = projectDebt({ ...p, years: 5 });
  assert.ok(d5 < 1000, 'debt has shrunk by year 5');
  const t = payoffTime(p);
  const atPayoff = projectDebt({ ...p, years: t });
  assert.ok(atPayoff < 1, 'debt is ~0 at the computed payoff time');
  assert.equal(projectDebt({ ...p, years: t + 5 }), 0, 'stays clamped at 0 after payoff');
});

test('projectDebt: when fee beats yield the debt GROWS', () => {
  const d = projectDebt({ principal: 1000, borrowApr: 0.10, stakingApr: 0.04, years: 5 });
  assert.ok(d > 1000, 'debt grew — not self-amortizing');
});

test('projectDebt soft-fails (year 0 → principal, no principal → 0, never throws)', () => {
  assert.equal(projectDebt({ principal: 1000, borrowApr: 0.05, stakingApr: 0.12, years: 0 }), 1000);
  assert.equal(projectDebt({ principal: 0, borrowApr: 0.05, stakingApr: 0.12, years: 5 }), 0);
  assert.doesNotThrow(() => projectDebt());
});
