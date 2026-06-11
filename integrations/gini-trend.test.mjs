// gini-trend.test.mjs — offline tests for the inequality time-series. node --test, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giniSeries, trend, weeklyReport, concentrationAlert } from './gini-trend.mjs';

const equalSnap = (ts, n = 4) => ({ ts, balances: Array(n).fill(100) });

test('giniSeries: one point per snapshot with the expected fields', () => {
  const series = giniSeries([
    equalSnap('2026-05-04'),
    { ts: '2026-05-11', balances: [900, 50, 30, 20] },
  ]);
  assert.equal(series.length, 2);
  for (const p of series) {
    assert.ok('ts' in p && 'gini' in p && 'top10' in p && 'holderCount' in p && 'herfindahl' in p);
  }
  // perfectly equal vector → gini 0
  assert.equal(series[0].gini, 0);
  assert.equal(series[0].holderCount, 4);
  // a whale snapshot is more unequal than equal
  assert.ok(series[1].gini > series[0].gini);
});

test('giniSeries: sorts snapshots ascending by ts regardless of input order', () => {
  const series = giniSeries([
    { ts: '2026-05-18', balances: [900, 50, 30, 20] },
    { ts: '2026-05-04', balances: [100, 100, 100, 100] },
  ]);
  assert.equal(series[0].ts, '2026-05-04');
  assert.equal(series[1].ts, '2026-05-18');
});

test('giniSeries: accepts object balances ({account,total})', () => {
  const series = giniSeries([
    { ts: 1, balances: [{ account: 'a', total: 100 }, { account: 'b', total: 100 }] },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0].holderCount, 2);
  assert.equal(series[0].gini, 0);
});

test('trend: rising gini reports direction rising with positive delta + pctChange', () => {
  const series = [
    { ts: 1, gini: 0.10 },
    { ts: 2, gini: 0.20 },
    { ts: 3, gini: 0.40 },
  ];
  const t = trend(series, 'gini');
  assert.equal(t.first, 0.1);
  assert.equal(t.last, 0.4);
  assert.equal(t.delta, 0.3);
  assert.equal(t.direction, 'rising');
  assert.ok(t.pctChange > 0);
});

test('trend: falling metric reports falling', () => {
  const t = trend([{ ts: 1, gini: 0.5 }, { ts: 2, gini: 0.3 }], 'gini');
  assert.equal(t.direction, 'falling');
  assert.equal(t.delta, -0.2);
});

test('trend: defaults to gini metric and supports other metrics', () => {
  const series = [{ ts: 1, gini: 0.1, holderCount: 4 }, { ts: 2, gini: 0.1, holderCount: 9 }];
  assert.equal(trend(series).direction, 'flat'); // default gini, unchanged
  const h = trend(series, 'holderCount');
  assert.equal(h.direction, 'rising');
  assert.equal(h.delta, 5);
});

test('trend: soft-fail empty/short series → flat with zero delta', () => {
  assert.deepEqual(trend([]), { first: 0, last: 0, delta: 0, pctChange: 0, direction: 'flat' });
  const single = trend([{ ts: 1, gini: 0.3 }]);
  assert.equal(single.direction, 'flat');
  assert.equal(single.delta, 0);
  assert.equal(single.first, 0.3);
  assert.equal(single.last, 0.3);
});

test('trend: first value of 0 → pctChange 0 (no divide-by-zero)', () => {
  const t = trend([{ ts: 1, gini: 0 }, { ts: 2, gini: 0.2 }], 'gini');
  assert.equal(t.pctChange, 0);
  assert.equal(t.direction, 'rising');
});

test('weeklyReport: periods + trends + a summary string', () => {
  const r = weeklyReport([
    { ts: '2026-05-04', balances: [100, 100, 100, 100] },
    { ts: '2026-05-11', balances: [120, 100, 100, 90, 50, 40] },
    { ts: '2026-05-18', balances: [900, 80, 40, 30, 25, 20] },
  ]);
  assert.equal(r.periods.length, 3);
  assert.ok(typeof r.summary === 'string' && r.summary.length > 0);
  assert.equal(r.holderGrowthTrend.direction, 'rising'); // 4 → 6 → 6 holders
  assert.ok('giniTrend' in r && 'direction' in r.giniTrend);
});

test('weeklyReport: soft-fail empty and single snapshot', () => {
  const empty = weeklyReport([]);
  assert.equal(empty.periods.length, 0);
  assert.equal(empty.giniTrend.direction, 'flat');
  assert.match(empty.summary, /No snapshots/);

  const one = weeklyReport([equalSnap('2026-05-04')]);
  assert.equal(one.periods.length, 1);
  assert.match(one.summary, /Single snapshot/);
});

test('weeklyReport: soft-fail non-array input', () => {
  const r = weeklyReport(null);
  assert.equal(r.periods.length, 0);
  assert.equal(r.giniTrend.direction, 'flat');
});

test('concentrationAlert: flags ts where gini jumps over the threshold', () => {
  const series = [
    { ts: 'w1', gini: 0.20 },
    { ts: 'w2', gini: 0.24 }, // +0.04, no alert at default 0.05
    { ts: 'w3', gini: 0.40 }, // +0.16, alert
    { ts: 'w4', gini: 0.41 }, // +0.01, no alert
  ];
  assert.deepEqual(concentrationAlert(series), ['w3']);
});

test('concentrationAlert: custom threshold', () => {
  const series = [{ ts: 'a', gini: 0.1 }, { ts: 'b', gini: 0.13 }];
  assert.deepEqual(concentrationAlert(series, { giniJump: 0.02 }), ['b']);
  assert.deepEqual(concentrationAlert(series, { giniJump: 0.05 }), []);
});

test('concentrationAlert: soft-fail empty/short series → []', () => {
  assert.deepEqual(concentrationAlert([]), []);
  assert.deepEqual(concentrationAlert([{ ts: 1, gini: 0.5 }]), []);
  assert.deepEqual(concentrationAlert(null), []);
});

test('end-to-end: giniSeries feeds concentrationAlert (whale week flagged)', () => {
  const series = giniSeries([
    { ts: '2026-05-04', balances: [100, 100, 100, 100] },
    { ts: '2026-05-11', balances: [110, 100, 100, 90] },
    { ts: '2026-05-18', balances: [9000, 60, 40, 30] }, // whale → big gini jump
  ]);
  const alerts = concentrationAlert(series, { giniJump: 0.05 });
  assert.ok(alerts.includes('2026-05-18'));
});
