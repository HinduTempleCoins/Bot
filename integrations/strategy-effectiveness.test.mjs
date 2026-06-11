// strategy-effectiveness.test.mjs — offline, node:test. No network, no IO.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekly,
  trendOf,
  breakevenWeek,
  selfSustaining,
  scorecard,
  renderMarkdown,
} from './strategy-effectiveness.mjs';

// A clean rising series: holders + floor grow, revenue overtakes cost by week 4.
const RISING = [
  { weekStart: '2026-05-04', holders: 40, floor: 0.10, revenueHive: 5, costHive: 20 },
  { weekStart: '2026-05-11', holders: 70, floor: 0.12, revenueHive: 12, costHive: 20 },
  { weekStart: '2026-05-18', holders: 110, floor: 0.15, revenueHive: 24, costHive: 20 },
  { weekStart: '2026-05-25', holders: 160, floor: 0.20, revenueHive: 38, costHive: 20 },
];

test('weekly() sorts ascending, computes net, coerces fields', () => {
  const out = weekly([
    { weekStart: '2026-05-18', holders: 110, floor: 0.15, revenueHive: 24, costHive: 20 },
    { weekStart: '2026-05-04', holders: 40, floor: 0.10, revenueHive: 5, costHive: 20 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].weekStart, '2026-05-04'); // sorted
  assert.equal(out[0].net, -15); // 5 - 20
  assert.equal(out[1].net, 4); // 24 - 20
});

test('weekly() drops junk and missing fields default to 0', () => {
  const out = weekly([null, 'x', { weekStart: '2026-05-04' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].holders, 0);
  assert.equal(out[0].floor, 0);
  assert.equal(out[0].net, 0);
});

test('weekly() soft-fails on non-array', () => {
  assert.deepEqual(weekly(undefined), []);
  assert.deepEqual(weekly(null), []);
  assert.deepEqual(weekly(42), []);
});

test('trendOf() slope/direction up on increasing metric', () => {
  const s = weekly(RISING);
  const t = trendOf(s, 'holders');
  assert.equal(t.direction, 'up');
  assert.ok(t.slope > 0);
  assert.equal(t.firstVal, 40);
  assert.equal(t.lastVal, 160);
});

test('trendOf() direction down on decreasing metric', () => {
  const s = [{ floor: 1 }, { floor: 0.8 }, { floor: 0.5 }];
  const t = trendOf(s, 'floor');
  assert.equal(t.direction, 'down');
  assert.ok(t.slope < 0);
});

test('trendOf() flat when constant', () => {
  const s = [{ costHive: 20 }, { costHive: 20 }, { costHive: 20 }];
  const t = trendOf(s, 'costHive');
  assert.equal(t.direction, 'flat');
  assert.equal(t.slope, 0);
});

test('trendOf() pctChange computed first→last', () => {
  const s = [{ holders: 50 }, { holders: 75 }];
  const t = trendOf(s, 'holders');
  assert.equal(t.pctChange, 50); // (75-50)/50 * 100
});

test('trendOf() pctChange is 0 when first value is 0 (no div by zero)', () => {
  const s = [{ holders: 0 }, { holders: 100 }];
  const t = trendOf(s, 'holders');
  assert.equal(t.pctChange, 0);
  assert.equal(t.direction, 'up'); // slope still positive
});

test('trendOf() single week → flat, slope 0, firstVal=lastVal', () => {
  const t = trendOf([{ holders: 42 }], 'holders');
  assert.equal(t.direction, 'flat');
  assert.equal(t.slope, 0);
  assert.equal(t.firstVal, 42);
  assert.equal(t.lastVal, 42);
});

test('trendOf() empty → flat zeros', () => {
  const t = trendOf([], 'holders');
  assert.deepEqual(t, { slope: 0, direction: 'flat', firstVal: 0, lastVal: 0, pctChange: 0 });
});

test('breakevenWeek() detects first week cumulative net >= 0', () => {
  // nets: -15, -8, +4, +18 → cumulative: -15, -23, -19, -1 ... never >= 0 here
  const s = weekly(RISING);
  // RISING cumulative: -15, (-15+ -8=-23), (-23+4=-19), (-19+18=-1) → never crosses
  assert.equal(breakevenWeek(s), null);
});

test('breakevenWeek() returns the crossing week when cumulative recovers', () => {
  const s = weekly([
    { weekStart: 'w1', revenueHive: 0, costHive: 10 }, // net -10, cum -10
    { weekStart: 'w2', revenueHive: 5, costHive: 10 }, // net -5,  cum -15
    { weekStart: 'w3', revenueHive: 30, costHive: 10 }, // net +20, cum +5 → crosses
    { weekStart: 'w4', revenueHive: 30, costHive: 10 },
  ]);
  assert.equal(breakevenWeek(s), 'w3');
});

test('breakevenWeek() week-1 already positive cumulative', () => {
  const s = weekly([{ weekStart: 'w1', revenueHive: 20, costHive: 5 }]);
  assert.equal(breakevenWeek(s), 'w1');
});

test('breakevenWeek() empty → null', () => {
  assert.equal(breakevenWeek([]), null);
  assert.equal(breakevenWeek(undefined), null);
});

test('selfSustaining() true when last N weeks all net > 0', () => {
  const s = weekly([
    { weekStart: 'w1', revenueHive: 5, costHive: 20 }, // -15
    { weekStart: 'w2', revenueHive: 25, costHive: 20 }, // +5
    { weekStart: 'w3', revenueHive: 30, costHive: 20 }, // +10
  ]);
  assert.equal(selfSustaining(s, { sinceWeeks: 1 }), true);
  assert.equal(selfSustaining(s, { sinceWeeks: 2 }), true);
  assert.equal(selfSustaining(s, { sinceWeeks: 3 }), false); // w1 negative
});

test('selfSustaining() default sinceWeeks=1 looks at last week only', () => {
  const s = weekly([
    { weekStart: 'w1', revenueHive: 30, costHive: 20 }, // +10
    { weekStart: 'w2', revenueHive: 5, costHive: 20 }, // -15 (last)
  ]);
  assert.equal(selfSustaining(s), false);
});

test('selfSustaining() false when fewer weeks than requested', () => {
  const s = weekly([{ weekStart: 'w1', revenueHive: 30, costHive: 20 }]);
  assert.equal(selfSustaining(s, { sinceWeeks: 3 }), false);
});

test('selfSustaining() empty → false', () => {
  assert.equal(selfSustaining([]), false);
});

test('scorecard() grade A: all trends up + self-sustaining', () => {
  const s = weekly([
    { weekStart: 'w1', holders: 40, floor: 0.1, revenueHive: 25, costHive: 20 }, // net +5
    { weekStart: 'w2', holders: 70, floor: 0.2, revenueHive: 35, costHive: 20 }, // net +15
    { weekStart: 'w3', holders: 110, floor: 0.3, revenueHive: 50, costHive: 20 }, // net +30
  ]);
  const card = scorecard(s);
  assert.equal(card.holdersTrend.direction, 'up');
  assert.equal(card.floorTrend.direction, 'up');
  assert.equal(card.netTrend.direction, 'up');
  assert.equal(card.selfSustaining, true);
  assert.equal(card.grade, 'A'); // 3 ups + sustaining = 4
});

test('scorecard() grade D: declining + not sustaining', () => {
  const s = weekly([
    { weekStart: 'w1', holders: 100, floor: 0.5, revenueHive: 5, costHive: 20 }, // -15
    { weekStart: 'w2', holders: 80, floor: 0.4, revenueHive: 4, costHive: 20 }, // -16
    { weekStart: 'w3', holders: 60, floor: 0.3, revenueHive: 3, costHive: 20 }, // -17
  ]);
  const card = scorecard(s);
  assert.equal(card.grade, 'D'); // 0 ups, not sustaining
  assert.equal(card.selfSustaining, false);
});

test('scorecard() grade C: two trends up, not sustaining', () => {
  // holders up, floor up, net flat/down, not sustaining → 2 ups + 0 = 2 → C
  const s = weekly([
    { weekStart: 'w1', holders: 40, floor: 0.1, revenueHive: 5, costHive: 20 }, // -15
    { weekStart: 'w2', holders: 70, floor: 0.2, revenueHive: 5, costHive: 20 }, // -15
    { weekStart: 'w3', holders: 110, floor: 0.3, revenueHive: 5, costHive: 20 }, // -15
  ]);
  const card = scorecard(s);
  assert.equal(card.holdersTrend.direction, 'up');
  assert.equal(card.floorTrend.direction, 'up');
  assert.equal(card.selfSustaining, false);
  assert.equal(card.grade, 'C');
});

test('scorecard() single week → grade D, flat trends, breakeven possibly set', () => {
  const card = scorecard(weekly([{ weekStart: 'w1', holders: 10, floor: 0.1, revenueHive: 5, costHive: 20 }]));
  assert.equal(card.grade, 'D');
  assert.equal(card.holdersTrend.direction, 'flat');
  assert.equal(card.netTrend.direction, 'flat');
  assert.equal(card.selfSustaining, false);
});

test('scorecard() empty → grade D, breakevenWeek null', () => {
  const card = scorecard([]);
  assert.equal(card.grade, 'D');
  assert.equal(card.breakevenWeek, null);
  assert.equal(card.selfSustaining, false);
});

test('renderMarkdown() includes grade and escapes interpolation, never throws', () => {
  const card = scorecard(weekly(RISING));
  const md = renderMarkdown(card);
  assert.match(md, /## Strategy effectiveness — grade [ABCD]/);
  assert.match(md, /Self-sustaining/);
  // soft-fail on garbage
  assert.doesNotThrow(() => renderMarkdown(null));
  assert.doesNotThrow(() => renderMarkdown({ grade: '<x>' }));
  const safe = renderMarkdown({ grade: '<x>' });
  assert.ok(safe.includes('&lt;x&gt;'));
});
