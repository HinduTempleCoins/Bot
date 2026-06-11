import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  num, minedAmount, emissionSchedule, shareOfEpoch, halvingRate,
} from './pob-emission.mjs';

// ---- num() coercion ----

test('num coerces strings and clamps non-finite to 0', () => {
  assert.equal(num(5), 5);
  assert.equal(num('3.5'), 3.5);
  assert.equal(num('abc'), 0);
  assert.equal(num(NaN), 0);
  assert.equal(num(Infinity), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num(null), 0);
});

// ---- minedAmount ----

test('minedAmount at epoch 0 with decay applies full rate', () => {
  // decay^0 = 1, so minted = burned * rate
  assert.equal(minedAmount({ burned: 10, rate: 2, decayPerEpoch: 0.5, epoch: 0 }), 20);
});

test('minedAmount decays with epoch', () => {
  // 10 * 2 * 0.5^2 = 20 * 0.25 = 5
  assert.equal(minedAmount({ burned: 10, rate: 2, decayPerEpoch: 0.5, epoch: 2 }), 5);
});

test('minedAmount is deterministic for the same epoch (no wall-clock)', () => {
  const a = minedAmount({ burned: 7, rate: 3, decayPerEpoch: 0.9, epoch: 4 });
  const b = minedAmount({ burned: 7, rate: 3, decayPerEpoch: 0.9, epoch: 4 });
  assert.equal(a, b);
});

test('minedAmount default decay 0 mints nothing after epoch 0', () => {
  // 0^1 = 0
  assert.equal(minedAmount({ burned: 10, rate: 2, epoch: 1 }), 0);
  // but epoch 0: 0^0 = 1 => full rate
  assert.equal(minedAmount({ burned: 10, rate: 2, epoch: 0 }), 20);
});

test('minedAmount floors fractional epochs', () => {
  const frac = minedAmount({ burned: 10, rate: 2, decayPerEpoch: 0.5, epoch: 2.9 });
  const floored = minedAmount({ burned: 10, rate: 2, decayPerEpoch: 0.5, epoch: 2 });
  assert.equal(frac, floored);
});

// ---- minedAmount soft-fail ----

test('minedAmount clamps negative / non-finite inputs to 0', () => {
  assert.equal(minedAmount({ burned: -10, rate: 2, decayPerEpoch: 0.5, epoch: 0 }), 0);
  assert.equal(minedAmount({ burned: 10, rate: -2, decayPerEpoch: 0.5, epoch: 0 }), 0);
  assert.equal(minedAmount({ burned: NaN, rate: 2, epoch: 0 }), 0);
  assert.equal(minedAmount({ burned: 10, rate: 'x', epoch: 0 }), 0);
});

test('minedAmount never throws on empty / missing args', () => {
  assert.equal(minedAmount(), 0);
  assert.equal(minedAmount({}), 0);
});

test('minedAmount clamps negative epoch to 0', () => {
  assert.equal(minedAmount({ burned: 10, rate: 2, decayPerEpoch: 0.5, epoch: -5 }), 20);
});

// ---- emissionSchedule ----

test('emissionSchedule returns epoch/rate/cumulative rows', () => {
  const s = emissionSchedule({ initialRate: 100, decayPerEpoch: 0.5, epochs: 3 });
  assert.equal(s.length, 3);
  assert.deepEqual(s[0], { epoch: 0, rate: 100, cumulative: 100 });
  assert.deepEqual(s[1], { epoch: 1, rate: 50, cumulative: 150 });
  assert.deepEqual(s[2], { epoch: 2, rate: 25, cumulative: 175 });
});

test('emissionSchedule default decay 1 is flat', () => {
  const s = emissionSchedule({ initialRate: 10, epochs: 4 });
  assert.equal(s[3].rate, 10);
  assert.equal(s[3].cumulative, 40);
});

test('emissionSchedule cumulative is monotonic non-decreasing', () => {
  const s = emissionSchedule({ initialRate: 100, decayPerEpoch: 0.7, epochs: 10 });
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].cumulative >= s[i - 1].cumulative);
  }
});

test('emissionSchedule is deterministic (no time dependence)', () => {
  const a = emissionSchedule({ initialRate: 100, decayPerEpoch: 0.9, epochs: 5 });
  const b = emissionSchedule({ initialRate: 100, decayPerEpoch: 0.9, epochs: 5 });
  assert.deepEqual(a, b);
});

// ---- emissionSchedule soft-fail ----

test('emissionSchedule zero / negative epochs => empty array', () => {
  assert.deepEqual(emissionSchedule({ initialRate: 100, epochs: 0 }), []);
  assert.deepEqual(emissionSchedule({ initialRate: 100, epochs: -3 }), []);
});

test('emissionSchedule never throws on empty / bad args', () => {
  assert.deepEqual(emissionSchedule(), []);
  assert.deepEqual(emissionSchedule({}), []);
  const s = emissionSchedule({ initialRate: 'bad', decayPerEpoch: 'bad', epochs: 2 });
  assert.equal(s.length, 2);
  assert.equal(s[0].rate, 0);
  assert.equal(s[1].cumulative, 0);
});

// ---- shareOfEpoch ----

test('shareOfEpoch is pro-rata', () => {
  assert.equal(shareOfEpoch({ yourBurn: 25, totalBurn: 100, epochReward: 1000 }), 250);
  assert.equal(shareOfEpoch({ yourBurn: 50, totalBurn: 100, epochReward: 1000 }), 500);
});

test('shareOfEpoch caps your burn at the total (never > 100%)', () => {
  assert.equal(shareOfEpoch({ yourBurn: 200, totalBurn: 100, epochReward: 1000 }), 1000);
});

test('shareOfEpoch totalBurn <= 0 => 0 (no divide-by-zero)', () => {
  assert.equal(shareOfEpoch({ yourBurn: 10, totalBurn: 0, epochReward: 1000 }), 0);
  assert.equal(shareOfEpoch({ yourBurn: 10, totalBurn: -5, epochReward: 1000 }), 0);
});

test('shareOfEpoch soft-fails on bad / missing args', () => {
  assert.equal(shareOfEpoch(), 0);
  assert.equal(shareOfEpoch({}), 0);
  assert.equal(shareOfEpoch({ yourBurn: 'x', totalBurn: 100, epochReward: 1000 }), 0);
  assert.equal(shareOfEpoch({ yourBurn: 10, totalBurn: 100, epochReward: -5 }), 0);
});

// ---- halvingRate ----

test('halvingRate halves every N epochs', () => {
  assert.equal(halvingRate({ initialRate: 50, halvingEvery: 10, epoch: 0 }), 50);
  assert.equal(halvingRate({ initialRate: 50, halvingEvery: 10, epoch: 9 }), 50);
  assert.equal(halvingRate({ initialRate: 50, halvingEvery: 10, epoch: 10 }), 25);
  assert.equal(halvingRate({ initialRate: 50, halvingEvery: 10, epoch: 25 }), 12.5);
});

test('halvingRate with halvingEvery <= 0 => no halving', () => {
  assert.equal(halvingRate({ initialRate: 50, halvingEvery: 0, epoch: 100 }), 50);
  assert.equal(halvingRate({ initialRate: 50, halvingEvery: -1, epoch: 100 }), 50);
});

test('halvingRate soft-fails on bad / missing args', () => {
  assert.equal(halvingRate(), 0);
  assert.equal(halvingRate({}), 0);
  assert.equal(halvingRate({ initialRate: -50, halvingEvery: 10, epoch: 5 }), 0);
  assert.equal(halvingRate({ initialRate: 'x', halvingEvery: 10, epoch: 5 }), 0);
});
