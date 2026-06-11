import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POWER_DOWN_WEEKS,
  powerDownSchedule,
  nextWithdrawal,
  vestsToTokens,
  tokensToVests,
  esc,
} from './vesting-power-down.mjs';

test('DEFAULT_POWER_DOWN_WEEKS is 13 (Steem/Hive)', () => {
  assert.equal(DEFAULT_POWER_DOWN_WEEKS, 13);
});

test('powerDownSchedule: 13 equal tranches by default', () => {
  const rows = powerDownSchedule({ totalVests: 1300 });
  assert.equal(rows.length, 13);
  for (const r of rows) assert.equal(r.vestsWithdrawn, 100);
  assert.equal(rows[0].week, 1);
  assert.equal(rows[12].week, 13);
  assert.equal(rows[12].vestsRemaining, 0);
});

test('powerDownSchedule: conserves total exactly with rounding remainder in last tranche', () => {
  const total = 1000;
  const rows = powerDownSchedule({ totalVests: total, weeks: 3 });
  assert.equal(rows.length, 3);
  const sum = rows.reduce((a, r) => a + r.vestsWithdrawn, 0);
  assert.equal(sum, total); // exact conservation
  // equal tranches floor(1000/3)=333.33..; per is total/weeks here (float),
  // but the last tranche is defined as total - withdrawnSoFar -> exact.
  assert.equal(rows[2].vestsRemaining, 0);
  // remaining is monotonically non-increasing
  assert.ok(rows[0].vestsRemaining > rows[1].vestsRemaining);
});

test('powerDownSchedule: integer remainder goes to last tranche', () => {
  // 100 over 3 weeks: tranches 33.33.. but conservation holds exactly
  const rows = powerDownSchedule({ totalVests: 100, weeks: 3 });
  const sum = rows.reduce((a, r) => a + r.vestsWithdrawn, 0);
  assert.equal(sum, 100);
});

test('powerDownSchedule: startWeek offsets the week numbers', () => {
  const rows = powerDownSchedule({ totalVests: 200, weeks: 2, startWeek: 5 });
  assert.deepEqual(rows.map((r) => r.week), [5, 6]);
});

test('powerDownSchedule: soft-fail to empty on degenerate input', () => {
  assert.deepEqual(powerDownSchedule({ totalVests: 0, weeks: 13 }), []);
  assert.deepEqual(powerDownSchedule({ totalVests: 100, weeks: 0 }), []);
  assert.deepEqual(powerDownSchedule({ totalVests: -5, weeks: 13 }), []);
  assert.deepEqual(powerDownSchedule({ totalVests: NaN, weeks: 13 }), []);
  assert.deepEqual(powerDownSchedule({}), []);
  assert.deepEqual(powerDownSchedule(), []);
});

test('powerDownSchedule: startWeek clamps to at least 1', () => {
  const rows = powerDownSchedule({ totalVests: 100, weeks: 1, startWeek: 0 });
  assert.equal(rows[0].week, 1);
  const neg = powerDownSchedule({ totalVests: 100, weeks: 1, startWeek: -3 });
  assert.equal(neg[0].week, 1);
});

test('nextWithdrawal: returns next tranche and weeks remaining', () => {
  const r0 = nextWithdrawal({ totalVests: 1300, weeks: 13, weeksElapsed: 0 });
  assert.equal(r0.vests, 100);
  assert.equal(r0.weeksRemaining, 13);

  const r3 = nextWithdrawal({ totalVests: 1300, weeks: 13, weeksElapsed: 3 });
  assert.equal(r3.vests, 100);
  assert.equal(r3.weeksRemaining, 10);
});

test('nextWithdrawal: at/after completion -> zero', () => {
  assert.deepEqual(
    nextWithdrawal({ totalVests: 1300, weeks: 13, weeksElapsed: 13 }),
    { vests: 0, weeksRemaining: 0 },
  );
  assert.deepEqual(
    nextWithdrawal({ totalVests: 1300, weeks: 13, weeksElapsed: 99 }),
    { vests: 0, weeksRemaining: 0 },
  );
});

test('nextWithdrawal: last tranche carries the remainder', () => {
  const last = nextWithdrawal({ totalVests: 100, weeks: 3, weeksElapsed: 2 });
  assert.equal(last.weeksRemaining, 1);
  // last tranche = 100 - 2*(100/3)
  assert.ok(Math.abs(last.vests - (100 - 2 * (100 / 3))) < 1e-9);
});

test('nextWithdrawal: soft-fail on degenerate input', () => {
  assert.deepEqual(nextWithdrawal({ totalVests: 0 }), { vests: 0, weeksRemaining: 0 });
  assert.deepEqual(nextWithdrawal({}), { vests: 0, weeksRemaining: 0 });
  assert.deepEqual(nextWithdrawal(), { vests: 0, weeksRemaining: 0 });
});

test('vestsToTokens: converts at the chain rate', () => {
  // rate = 250000/1000000 = 0.25 tokens per VEST
  const tokens = vestsToTokens({ vests: 1000, totalVests: 1_000_000, totalTokensBacking: 250_000 });
  assert.equal(tokens, 250);
});

test('vestsToTokens: 0 when totalVests <= 0', () => {
  assert.equal(vestsToTokens({ vests: 1000, totalVests: 0, totalTokensBacking: 250_000 }), 0);
  assert.equal(vestsToTokens({ vests: 1000, totalVests: -1, totalTokensBacking: 250_000 }), 0);
  assert.equal(vestsToTokens({}), 0);
  assert.equal(vestsToTokens(), 0);
});

test('vestsToTokens: degenerate vests/backing clamp to 0', () => {
  assert.equal(vestsToTokens({ vests: NaN, totalVests: 1000, totalTokensBacking: 100 }), 0);
  assert.equal(vestsToTokens({ vests: 100, totalVests: 1000, totalTokensBacking: NaN }), 0);
});

test('tokensToVests: inverse conversion', () => {
  const vests = tokensToVests({ tokens: 250, totalVests: 1_000_000, totalTokensBacking: 250_000 });
  assert.equal(vests, 1000);
});

test('tokensToVests: 0 when totalTokensBacking <= 0', () => {
  assert.equal(tokensToVests({ tokens: 250, totalVests: 1_000_000, totalTokensBacking: 0 }), 0);
  assert.equal(tokensToVests({ tokens: 250, totalVests: 1_000_000, totalTokensBacking: -1 }), 0);
  assert.equal(tokensToVests({}), 0);
  assert.equal(tokensToVests(), 0);
});

test('vestsToTokens / tokensToVests round-trip', () => {
  const opts = { totalVests: 1_000_000, totalTokensBacking: 333_333 };
  const tokens = vestsToTokens({ vests: 1000, ...opts });
  const back = tokensToVests({ tokens, ...opts });
  assert.ok(Math.abs(back - 1000) < 1e-6);
});

test('esc: escapes HTML-significant characters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
