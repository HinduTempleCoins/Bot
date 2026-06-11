import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vestedAt,
  lockedAt,
  unlockFraction,
  daysUntilFullyVested,
  esc,
} from './vesting-cliff.mjs';

const base = { total: 1000, cliffDays: 100, vestingDays: 400 }; // full at day 500

test('vestedAt: zero before the cliff', () => {
  assert.equal(vestedAt({ ...base, elapsedDays: 0 }), 0n);
  assert.equal(vestedAt({ ...base, elapsedDays: 99 }), 0n);
});

test('vestedAt: at the cliff still zero (linear progress = 0)', () => {
  assert.equal(vestedAt({ ...base, elapsedDays: 100 }), 0n);
});

test('vestedAt: linear midpoint of the vesting window', () => {
  // day 300 -> 200 of 400 vesting days elapsed -> half
  assert.equal(vestedAt({ ...base, elapsedDays: 300 }), 500n);
});

test('vestedAt: quarter point', () => {
  // day 200 -> 100/400 -> 1/4
  assert.equal(vestedAt({ ...base, elapsedDays: 200 }), 250n);
});

test('vestedAt: full at and after the end horizon', () => {
  assert.equal(vestedAt({ ...base, elapsedDays: 500 }), 1000n);
  assert.equal(vestedAt({ ...base, elapsedDays: 99999 }), 1000n);
});

test('vestedAt: never exceeds total, never negative', () => {
  for (const d of [-50, 0, 150, 300, 600]) {
    const v = vestedAt({ ...base, elapsedDays: d });
    assert.ok(v >= 0n && v <= 1000n);
  }
});

test('vestingDays = 0 is an instant unlock at the cliff (no divide-by-zero)', () => {
  const g = { total: 1000, cliffDays: 100, vestingDays: 0 };
  assert.equal(vestedAt({ ...g, elapsedDays: 99 }), 0n);
  assert.equal(vestedAt({ ...g, elapsedDays: 100 }), 1000n);
  assert.equal(vestedAt({ ...g, elapsedDays: 1000 }), 1000n);
});

test('conservation: locked + vested === clamped total exactly', () => {
  for (const d of [0, 100, 250, 333, 500, 700]) {
    const args = { ...base, elapsedDays: d };
    assert.equal(lockedAt(args) + vestedAt(args), 1000n);
  }
});

test('lockedAt: full before cliff, zero after full vest', () => {
  assert.equal(lockedAt({ ...base, elapsedDays: 0 }), 1000n);
  assert.equal(lockedAt({ ...base, elapsedDays: 500 }), 0n);
});

test('floor rounding stays locked (no over-vest on partial day)', () => {
  // total 10, vesting 3 days, day 1 -> floor(10*1/3)=3, not 3.33
  const g = { total: 10, cliffDays: 0, vestingDays: 3 };
  assert.equal(vestedAt({ ...g, elapsedDays: 1 }), 3n);
  assert.equal(lockedAt({ ...g, elapsedDays: 1 }), 7n);
});

test('unlockFraction: 0 before cliff, 0.5 at midpoint, 1 at end', () => {
  assert.equal(unlockFraction({ ...base, elapsedDays: 50 }), 0);
  assert.equal(unlockFraction({ ...base, elapsedDays: 300 }), 0.5);
  assert.equal(unlockFraction({ ...base, elapsedDays: 500 }), 1);
  assert.equal(unlockFraction({ ...base, elapsedDays: 9999 }), 1);
});

test('unlockFraction: independent of total (works with total unset)', () => {
  assert.equal(unlockFraction({ cliffDays: 100, vestingDays: 400, elapsedDays: 300 }), 0.5);
});

test('unlockFraction: never NaN on degenerate input', () => {
  const f = unlockFraction({ cliffDays: 0, vestingDays: 0, elapsedDays: 0 });
  assert.equal(Number.isFinite(f), true);
  assert.equal(f, 1); // vesting 0 -> instant at cliff (day 0)
});

test('daysUntilFullyVested: counts down to zero', () => {
  assert.equal(daysUntilFullyVested({ ...base, elapsedDays: 0 }), 500);
  assert.equal(daysUntilFullyVested({ ...base, elapsedDays: 100 }), 400);
  assert.equal(daysUntilFullyVested({ ...base, elapsedDays: 500 }), 0);
  assert.equal(daysUntilFullyVested({ ...base, elapsedDays: 9999 }), 0);
});

test('daysUntilFullyVested: never negative', () => {
  assert.ok(daysUntilFullyVested({ ...base, elapsedDays: 100000 }) >= 0);
});

test('PUCO 900-day shape: cliff 90, vesting 810, full at 900', () => {
  const g = { total: 900000, cliffDays: 90, vestingDays: 810 };
  assert.equal(vestedAt({ ...g, elapsedDays: 89 }), 0n);
  assert.equal(vestedAt({ ...g, elapsedDays: 900 }), 900000n);
  assert.equal(daysUntilFullyVested({ ...g, elapsedDays: 90 }), 810);
  // midpoint of vesting: day 495 -> 405/810 -> half
  assert.equal(vestedAt({ ...g, elapsedDays: 495 }), 450000n);
});

// ---- soft-fail / edge inputs: clamp to 0, never throw ----

test('soft-fail: no args object', () => {
  assert.equal(vestedAt(), 0n);
  assert.equal(lockedAt(), 0n);
  assert.equal(unlockFraction(), 1); // cliff 0 / vesting 0 / elapsed 0 -> instant
  assert.equal(daysUntilFullyVested(), 0);
});

test('soft-fail: NaN / negative / non-finite clamp to 0', () => {
  const bad = { total: NaN, cliffDays: -5, vestingDays: Infinity, elapsedDays: 'x' };
  assert.equal(vestedAt(bad), 0n);
  assert.equal(lockedAt(bad), 0n);
  assert.doesNotThrow(() => unlockFraction(bad));
  assert.doesNotThrow(() => daysUntilFullyVested(bad));
});

test('soft-fail: total accepts BigInt and digit strings', () => {
  assert.equal(vestedAt({ total: 1000n, cliffDays: 0, vestingDays: 0, elapsedDays: 0 }), 1000n);
  assert.equal(vestedAt({ total: '1000', cliffDays: 0, vestingDays: 0, elapsedDays: 0 }), 1000n);
  assert.equal(vestedAt({ total: 'oops', cliffDays: 0, vestingDays: 0, elapsedDays: 0 }), 0n);
});

test('total = 0 yields zero everywhere with conservation holding', () => {
  const g = { total: 0, cliffDays: 10, vestingDays: 20, elapsedDays: 15 };
  assert.equal(vestedAt(g), 0n);
  assert.equal(lockedAt(g), 0n);
  assert.equal(lockedAt(g) + vestedAt(g), 0n);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
