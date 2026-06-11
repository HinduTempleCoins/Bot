import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cliffUnlock,
  linearVest,
  scheduleTable,
  esc,
} from './lockup-schedule.mjs';

test('cliffUnlock: nothing unlocks before the cliff', () => {
  const r = cliffUnlock({ total: 1000n, lockDays: 900, elapsedDays: 899 });
  assert.equal(r.unlocked, 0n);
  assert.equal(r.locked, 1000n);
});

test('cliffUnlock: boundary — exactly at the cliff fully unlocks', () => {
  const r = cliffUnlock({ total: 1000n, lockDays: 900, elapsedDays: 900 });
  assert.equal(r.unlocked, 1000n);
  assert.equal(r.locked, 0n);
});

test('cliffUnlock: past the cliff stays fully unlocked', () => {
  const r = cliffUnlock({ total: 1000n, lockDays: 900, elapsedDays: 5000 });
  assert.equal(r.unlocked, 1000n);
  assert.equal(r.locked, 0n);
});

test('cliffUnlock: conservation holds at every probe', () => {
  for (let d = 0; d <= 20; d++) {
    const r = cliffUnlock({ total: 777n, lockDays: 10, elapsedDays: d });
    assert.equal(r.locked + r.unlocked, 777n);
  }
});

test('linearVest: nothing before start', () => {
  const r = linearVest({ total: 1000n, startDay: 100, durationDays: 200, currentDay: 50 });
  assert.equal(r.vested, 0n);
  assert.equal(r.remaining, 1000n);
});

test('linearVest: midpoint vests half (floor)', () => {
  const r = linearVest({ total: 1000n, startDay: 0, durationDays: 200, currentDay: 100 });
  assert.equal(r.vested, 500n);
  assert.equal(r.remaining, 500n);
});

test('linearVest: midpoint of odd total floors toward remaining', () => {
  const r = linearVest({ total: 1001n, startDay: 0, durationDays: 200, currentDay: 100 });
  assert.equal(r.vested, 500n); // floor(1001*100/200) = floor(500.5)
  assert.equal(r.remaining, 501n);
  assert.equal(r.vested + r.remaining, 1001n);
});

test('linearVest: fully vested at and past end', () => {
  const at = linearVest({ total: 1000n, startDay: 0, durationDays: 200, currentDay: 200 });
  assert.equal(at.vested, 1000n);
  assert.equal(at.remaining, 0n);
  const past = linearVest({ total: 1000n, startDay: 0, durationDays: 200, currentDay: 99999 });
  assert.equal(past.vested, 1000n);
  assert.equal(past.remaining, 0n);
});

test('linearVest: zero duration is an instantaneous unlock at start', () => {
  const before = linearVest({ total: 500n, startDay: 10, durationDays: 0, currentDay: 9 });
  assert.equal(before.vested, 0n);
  const after = linearVest({ total: 500n, startDay: 10, durationDays: 0, currentDay: 10 });
  assert.equal(after.vested, 500n);
});

test('linearVest: conservation across the whole curve', () => {
  for (let d = 0; d <= 250; d++) {
    const r = linearVest({ total: 9973n, startDay: 25, durationDays: 200, currentDay: d });
    assert.equal(r.vested + r.remaining, 9973n);
    assert.ok(r.vested >= 0n && r.remaining >= 0n);
  }
});

test('scheduleTable: deterministic milestones, monotonic, ends at total', () => {
  const rows = scheduleTable({ total: 1000n, durationDays: 900, steps: 9 });
  assert.ok(rows.length >= 2);
  // sorted by day, non-decreasing cumulative
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].day > rows[i - 1].day);
    assert.ok(rows[i].cumulativeUnlocked >= rows[i - 1].cumulativeUnlocked);
  }
  const last = rows[rows.length - 1];
  assert.equal(last.day, 900);
  assert.equal(last.cumulativeUnlocked, 1000n);
  // determinism: same inputs -> identical output
  const again = scheduleTable({ total: 1000n, durationDays: 900, steps: 9 });
  assert.deepEqual(rows, again);
});

test('scheduleTable: zero steps -> single fully-unlocked endpoint row', () => {
  const rows = scheduleTable({ total: 1000n, durationDays: 900, steps: 0 });
  assert.deepEqual(rows, [{ day: 900, cumulativeUnlocked: 1000n }]);
});

test('soft-fail: NaN / negative / undefined inputs clamp to 0, never throw', () => {
  assert.deepEqual(cliffUnlock(), { locked: 0n, unlocked: 0n });
  assert.deepEqual(
    cliffUnlock({ total: NaN, lockDays: -5, elapsedDays: 'x' }),
    { locked: 0n, unlocked: 0n },
  );
  const lv = linearVest({ total: -100, startDay: NaN, durationDays: -1, currentDay: Infinity });
  assert.equal(lv.vested, 0n);
  assert.equal(lv.remaining, 0n);
  const st = scheduleTable({ total: -1, durationDays: NaN, steps: -3 });
  assert.equal(st[0].cumulativeUnlocked, 0n);
});

test('soft-fail: string and bigint totals accepted', () => {
  const r = cliffUnlock({ total: '1000000000000', lockDays: 1, elapsedDays: 1 });
  assert.equal(r.unlocked, 1000000000000n);
  const b = linearVest({ total: 2n, startDay: 0, durationDays: 4, currentDay: 2 });
  assert.equal(b.vested, 1n);
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
