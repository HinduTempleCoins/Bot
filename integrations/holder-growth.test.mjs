// holder-growth.test.mjs — offline tests for the holder-count growth + floor-rising tracker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  holderSeries,
  growthRate,
  floorTrend,
  weeklyGrowthReport,
  momentum,
  renderMarkdown,
} from './holder-growth.mjs';

// Mondays: 2026-05-04, 2026-05-11, 2026-05-18. Week A = 05-04 & 05-07; week B = 05-11; week C = 05-18.
const series = [
  { date: '2026-05-04', holders: 100, floor: 0.10 },
  { date: '2026-05-07', holders: 120, floor: 0.12 },
  { date: '2026-05-11', holders: 150, floor: 0.15 },
  { date: '2026-05-18', holders: 200, floor: 0.20 },
];

test('holderSeries sorts ascending and normalizes floorPrice/ts aliases', () => {
  const s = holderSeries([
    { ts: '2026-05-18', holders: 200, floorPrice: 0.2 },
    { date: '2026-05-04', holders: 100, floor: 0.1 },
  ]);
  assert.equal(s.length, 2);
  assert.equal(s[0].date, '2026-05-04');
  assert.equal(s[1].date, '2026-05-18');
  assert.equal(s[1].floor, 0.2); // floorPrice alias picked up
});

test('growthRate: pct and perDay over full span', () => {
  // window 30d covers all 4 points: 100 -> 200 over 14 days.
  const g = growthRate(series, { periodDays: 30 });
  assert.equal(g.absolute, 100);
  assert.equal(g.pct, 100); // (100/100)*100
  // 100 holders / 14 days
  assert.ok(Math.abs(g.perDay - 100 / 14) < 1e-3);
});

test('growthRate: windowing trims to points inside the trailing window', () => {
  // 7-day window ending 2026-05-18 (cutoff 05-11). start = 05-11 (150) -> last 200.
  const g = growthRate(series, { periodDays: 7 });
  assert.equal(g.absolute, 50);
  assert.equal(g.pct, +(50 / 150 * 100).toFixed(4));
});

test('floorTrend: rising true when floor climbs', () => {
  const f = floorTrend(series);
  assert.equal(f.firstFloor, 0.10);
  assert.equal(f.lastFloor, 0.20);
  assert.equal(f.rising, true);
  assert.equal(f.pctChange, 100);
});

test('floorTrend: rising false when floor falls', () => {
  const f = floorTrend([
    { date: '2026-05-04', holders: 100, floor: 0.20 },
    { date: '2026-05-11', holders: 105, floor: 0.15 },
  ]);
  assert.equal(f.rising, false);
  assert.ok(f.pctChange < 0);
});

test('weeklyGrowthReport: buckets across a week boundary', () => {
  const wk = weeklyGrowthReport(series);
  assert.equal(wk.length, 3); // 05-04, 05-11, 05-18 are each a Monday-anchored week
  // Week A: 05-04 (Mon) groups 05-04 & 05-07 -> 100..120
  assert.equal(wk[0].weekStart, '2026-05-04');
  assert.equal(wk[0].holdersStart, 100);
  assert.equal(wk[0].holdersEnd, 120);
  assert.equal(wk[0].deltaHolders, 20);
  assert.equal(wk[0].floorStart, 0.10);
  assert.equal(wk[0].floorEnd, 0.12);
  // Week B: 05-11 (Mon), single snapshot -> 150..150
  assert.equal(wk[1].weekStart, '2026-05-11');
  assert.equal(wk[1].holdersStart, 150);
  assert.equal(wk[1].holdersEnd, 150);
  assert.equal(wk[1].deltaHolders, 0);
  // Week C: 05-18 (Mon), single snapshot -> 200..200
  assert.equal(wk[2].weekStart, '2026-05-18');
  assert.equal(wk[2].holdersEnd, 200);
});

test('momentum: accelerating when holders and floor both rise', () => {
  const m = momentum(series);
  assert.equal(m.label, 'accelerating');
  assert.ok(m.holderSlope > 0);
  assert.ok(m.floorSlope > 0);
});

test('momentum: steady when holders rise but floor flat', () => {
  const m = momentum([
    { date: '2026-05-04', holders: 100, floor: 0.10 },
    { date: '2026-05-11', holders: 150, floor: 0.10 },
  ]);
  assert.equal(m.label, 'steady');
});

test('momentum: stalling when holders flat, floor not falling', () => {
  const m = momentum([
    { date: '2026-05-04', holders: 100, floor: 0.10 },
    { date: '2026-05-11', holders: 100, floor: 0.10 },
  ]);
  assert.equal(m.label, 'stalling');
});

test('momentum: declining when holders shrink', () => {
  const m = momentum([
    { date: '2026-05-04', holders: 200, floor: 0.20 },
    { date: '2026-05-11', holders: 150, floor: 0.18 },
  ]);
  assert.equal(m.label, 'declining');
});

test('single-point input: soft-fail zeros / empty / not rising', () => {
  const one = [{ date: '2026-05-04', holders: 100, floor: 0.10 }];
  assert.deepEqual(growthRate(one), { absolute: 0, pct: 0, perDay: 0 });
  assert.deepEqual(floorTrend(one), { firstFloor: 0, lastFloor: 0, pctChange: 0, rising: false });
  assert.equal(momentum(one).label, 'steady');
  // weekly report still buckets the single point.
  const wk = weeklyGrowthReport(one);
  assert.equal(wk.length, 1);
  assert.equal(wk[0].deltaHolders, 0);
});

test('empty / garbage input: never throws, returns zeros / empty', () => {
  assert.deepEqual(holderSeries([]), []);
  assert.deepEqual(holderSeries(null), []);
  assert.deepEqual(growthRate([]), { absolute: 0, pct: 0, perDay: 0 });
  assert.deepEqual(growthRate(undefined), { absolute: 0, pct: 0, perDay: 0 });
  assert.equal(floorTrend(null).rising, false);
  assert.deepEqual(weeklyGrowthReport([]), []);
  assert.deepEqual(weeklyGrowthReport('nope'), []);
  assert.equal(momentum([]).label, 'steady');
  // entries with no usable time are dropped
  assert.deepEqual(holderSeries([{ holders: 5 }, { ts: 'not-a-date', holders: 9 }]), []);
});

test('renderMarkdown: table for a report, soft-fail note for empty', () => {
  const md = renderMarkdown(weeklyGrowthReport(series));
  assert.match(md, /\| Week \|/);
  assert.match(md, /2026-05-04/);
  assert.match(md, /\+20/); // signed delta
  assert.equal(renderMarkdown([]), '_No holder-growth data._');
  assert.equal(renderMarkdown(null), '_No holder-growth data._');
});
