// profit-circles.test.js — network-free unit tests for the pure logic of the profit-circle /
// volatility-scalp engine (#191). Proves the depth band, the oscillation metric, and the
// keep-capital/skim model behave, without touching Hive-Engine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandHive, oscillation, skimPlan } from './profit-circles.mjs';

test('bandHive sums only liquidity inside the working [bid, ask] band', () => {
  const bid = 100, ask = 110;
  const levels = [
    { price: 105, quantity: 2 },   // in band → 210 HIVE
    { price: 110, quantity: 1 },   // at the edge → 110 HIVE (inclusive)
    { price: 130, quantity: 50 },  // far above the band → ignored (phantom wall)
    { price: 90, quantity: 50 },   // below the band → ignored
  ];
  const { hive } = bandHive(levels, bid, ask);
  assert.equal(hive, 105 * 2 + 110 * 1);
});

test('bandHive ignores zero/negative levels and empty books', () => {
  assert.equal(bandHive([], 1, 2).hive, 0);
  assert.equal(bandHive([{ price: 0, quantity: 5 }, { price: 1.5, quantity: 0 }], 1, 2).hive, 0);
});

test('oscillation: a flat tape reads near-zero, a swinging tape reads high', () => {
  const t = (price, ts) => ({ price, qty: 1, ts });
  const flat = oscillation([t(10, 1), t(10, 2), t(10, 3), t(10, 4)]);
  assert.ok(flat.rangePct < 0.001, `flat tape should not oscillate (was ${flat.rangePct})`);

  const swingy = oscillation([t(10, 1), t(12, 2), t(9, 3), t(11, 4), t(8, 5)]);
  assert.ok(swingy.rangePct > 20, `swinging tape should show real range (was ${swingy.rangePct})`);
  assert.ok(swingy.cvPct > 0, 'coefficient of variation is positive on a swinging tape');
});

test('oscillation needs enough samples to be meaningful', () => {
  assert.equal(oscillation([{ price: 1, qty: 1, ts: 1 }]), null);
});

test('skimPlan PRESERVES principal and banks only the skim to the war chest', () => {
  const plan = skimPlan([{ source: 'NEX', hive: 3 }, { source: 'DEC', hive: 2 }]);
  assert.equal(plan.skimmedThisBatch, 5);
  assert.equal(plan.bankedToWarChest, 5);                 // skimRate 1.0 → all skim banked
  assert.match(plan.principalPolicy, /PRESERVED/);
  assert.match(plan.warChest.purpose, /never from principal/i);
});

test('skimPlan accepts a bare list of HIVE gains and never throws on junk', () => {
  const plan = skimPlan([1, 2, NaN, 3]);
  assert.equal(plan.skimmedThisBatch, 6);                 // NaN filtered out
  assert.equal(skimPlan().skimmedThisBatch, 0);           // no input → zeroed, no throw
});

test('skimPlan war-chest target gates readiness', () => {
  assert.equal(skimPlan([10], { warChestUsdTarget: 5 }).warChest.readyToDeploy, true);
  assert.equal(skimPlan([3], { warChestUsdTarget: 5 }).warChest.readyToDeploy, false);
});
