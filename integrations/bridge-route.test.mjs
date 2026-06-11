// bridge-route.test.mjs — offline tests for the pure cross-chain routing planner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, defaultLegs, breakEven, describe } from './bridge-route.mjs';

test('planRoute: happy path HIVE→USDC→ETH conserves notional net of fees', () => {
  const legs = defaultLegs({ hiveToUsdc: 0.30, usdcToEth: 0.0004 });
  const plan = planRoute({ amountHive: 1000, hiveUsd: 0.30, legs });
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].from, 'HIVE');
  assert.equal(plan.steps[0].to, 'USDC');
  assert.equal(plan.finalAsset, 'ETH');
  assert.ok(plan.finalAmount > 0, 'produces positive ETH out');
  assert.ok(plan.totalFeeUsd > 0, 'fees accumulate across legs');
  assert.ok(plan.effectiveRate > 0);
  // every step ok
  assert.ok(plan.steps.every((s) => s.ok === true));
});

test('planRoute: fees reduce the surviving notional (more fee → less out)', () => {
  const cheap = planRoute({
    amountHive: 1000, hiveUsd: 0.30,
    legs: [{ from: 'HIVE', to: 'USDC', rate: 0.30, feeBps: 0, fixedFee: 0 }],
  });
  const pricey = planRoute({
    amountHive: 1000, hiveUsd: 0.30,
    legs: [{ from: 'HIVE', to: 'USDC', rate: 0.30, feeBps: 100, fixedFee: 10 }],
  });
  assert.ok(pricey.finalAmount < cheap.finalAmount);
  assert.ok(pricey.totalFeeUsd > cheap.totalFeeUsd);
});

test('planRoute: zero amount → finalAmount 0, no steps', () => {
  const plan = planRoute({ amountHive: 0, hiveUsd: 0.30, legs: defaultLegs() });
  assert.equal(plan.finalAmount, 0);
  assert.equal(plan.steps.length, 0);
});

test('planRoute: negative amount → finalAmount 0', () => {
  const plan = planRoute({ amountHive: -50, hiveUsd: 0.30, legs: defaultLegs() });
  assert.equal(plan.finalAmount, 0);
});

test('planRoute: missing rate on a leg → step flagged ok:false, chain halts, never throws', () => {
  const legs = [
    { from: 'HIVE', to: 'USDC', rate: 0.30, feeBps: 25, fixedFee: 0.5 },
    { from: 'USDC', to: 'ETH', feeBps: 30, fixedFee: 2.0 }, // no rate
  ];
  const plan = planRoute({ amountHive: 1000, hiveUsd: 0.30, legs });
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].ok, true);
  assert.equal(plan.steps[1].ok, false);
  assert.equal(plan.steps[1].out, 0);
  assert.equal(plan.finalAmount, 0);
  assert.equal(plan.finalAsset, 'ETH');
});

test('planRoute: empty legs → empty plan, no throw', () => {
  const plan = planRoute({ amountHive: 1000, hiveUsd: 0.30, legs: [] });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.finalAmount, 0);
});

test('planRoute: missing args object → soft empty', () => {
  const plan = planRoute();
  assert.equal(plan.finalAmount, 0);
  assert.equal(plan.steps.length, 0);
});

test('defaultLegs: shape is HIVE→USDC→ETH and rates are overridable', () => {
  const legs = defaultLegs({ hiveToUsdc: 0.5, usdcToEth: 0.001 });
  assert.equal(legs.length, 2);
  assert.equal(legs[0].from, 'HIVE');
  assert.equal(legs[0].to, 'USDC');
  assert.equal(legs[0].rate, 0.5);
  assert.equal(legs[1].to, 'ETH');
  assert.equal(legs[1].rate, 0.001);
});

test('breakEven: returns a positive break-even price for a viable route', () => {
  const legs = defaultLegs({ hiveToUsdc: 0.30, usdcToEth: 0.0004 });
  const be = breakEven({ amountHive: 1000, hiveUsd: 0.30, legs });
  assert.equal(be.ok, true);
  assert.equal(be.finalAsset, 'ETH');
  assert.ok(be.breakEvenPrice > 0);
  assert.ok(be.startUsd > 0);
  // sanity: finalAmount * breakEvenPrice ≈ startUsd
  assert.ok(Math.abs(be.finalAmount * be.breakEvenPrice - be.startUsd) < 1);
});

test('breakEven: zero amount → ok:false', () => {
  const be = breakEven({ amountHive: 0, hiveUsd: 0.30, legs: defaultLegs() });
  assert.equal(be.ok, false);
  assert.equal(be.breakEvenPrice, 0);
});

test('breakEven: missing hiveUsd anchor → ok:false (no notional)', () => {
  const be = breakEven({ amountHive: 1000, legs: defaultLegs() });
  assert.equal(be.ok, false);
});

test('describe: multi-line string, escapes interpolation, no throw on empty', () => {
  const plan = planRoute({ amountHive: 1000, hiveUsd: 0.30, legs: defaultLegs() });
  const out = describe(plan);
  assert.ok(typeof out === 'string');
  assert.ok(out.includes('\n'));
  assert.ok(out.includes('Final:'));
  assert.ok(out.includes('Total fees:'));
  // empty plan path
  const emptyOut = describe(planRoute({ amountHive: 0, hiveUsd: 0.3, legs: [] }));
  assert.ok(emptyOut.includes('no executable steps'));
  // describe with nothing at all
  assert.ok(typeof describe() === 'string');
});

test('describe: html-bearing asset names are escaped', () => {
  const plan = planRoute({
    amountHive: 100, hiveUsd: 0.3,
    legs: [{ from: '<b>HIVE</b>', to: 'USDC', rate: 0.3, feeBps: 0, fixedFee: 0 }],
  });
  const out = describe(plan);
  assert.ok(out.includes('&lt;b&gt;HIVE&lt;/b&gt;'));
  assert.ok(!out.includes('<b>HIVE</b>'));
});
