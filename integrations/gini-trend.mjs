// gini-trend.mjs — PURE inequality time-series over holder snapshots. No network, no keys, no IO.
//
// holder-inequality.mjs computes single-snapshot measures (gini / topNShare / herfindahl).
// snapshot-delta.mjs only diffs raw balances between two snapshots. Neither tracks an inequality
// measure OVER TIME. This module builds that series and reads its trend — items 105/106/99
// ('Compare trends over weeks/months', 'Track holder growth, floor rising', 'Gini coefficient').
//
//   giniSeries(snapshots)                  — [{ts, gini, top10, holderCount, herfindahl}] per snapshot
//   trend(series, metric='gini')           — {first, last, delta, pctChange, direction}
//   weeklyReport(snapshots)                — {periods, giniTrend, holderGrowthTrend, summary}
//   concentrationAlert(series, {giniJump}) — [ts] where gini rose > threshold vs the prior snapshot
//
// A snapshot is {ts, balances:[...]} where balances is any array holder-inequality accepts
// (plain numbers or {account,total}/{percentOfSupply} objects). Snapshots are sorted by ts
// ascending before analysis. Soft-fail: empty/short series return zeros / 'flat', never throws.
//
//   node integrations/gini-trend.mjs       — demo against a built-in synthetic snapshot series
//   import { giniSeries, trend, weeklyReport, concentrationAlert } from './gini-trend.mjs'

import { gini, topNShare, herfindahl } from './holder-inequality.mjs';

// Coerce a snapshot's ts to a comparable, sortable value. Accepts numbers (epoch ms/s),
// ISO strings, or Date. Falls back to the original (or 0) so sorting never throws.
function tsKey(ts) {
  if (ts == null) return 0;
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : 0;
}

// Normalize + sort the snapshot list ascending by ts. Drops non-object entries.
function normSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .filter(s => s != null && typeof s === 'object')
    .map(s => ({ ts: s.ts, balances: Array.isArray(s.balances) ? s.balances : [] }))
    .sort((a, b) => tsKey(a.ts) - tsKey(b.ts));
}

// Build the per-snapshot inequality time-series. Each point reuses the holder-inequality
// pure functions, so the numbers match the single-snapshot module exactly.
export function giniSeries(snapshots) {
  const snaps = normSnapshots(snapshots);
  return snaps.map(s => ({
    ts: s.ts,
    gini: +gini(s.balances).toFixed(6),
    top10: topNShare(s.balances, 10),
    holderCount: s.balances.length,
    herfindahl: herfindahl(s.balances),
  }));
}

// Direction label from a numeric delta, with a small epsilon so float noise reads as 'flat'.
function dirOf(delta, eps = 1e-9) {
  if (!Number.isFinite(delta) || Math.abs(delta) <= eps) return 'flat';
  return delta > 0 ? 'rising' : 'falling';
}

// Read the trend of one metric across the series: first → last value, absolute delta,
// percent change, and a direction label. Soft-fail: empty/single-point series is 'flat'.
export function trend(series, metric = 'gini') {
  const arr = Array.isArray(series) ? series.filter(p => p != null && typeof p === 'object') : [];
  if (arr.length < 2) {
    const only = arr.length === 1 ? Number(arr[0][metric]) || 0 : 0;
    return { first: only, last: only, delta: 0, pctChange: 0, direction: 'flat' };
  }
  const first = Number(arr[0][metric]) || 0;
  const last = Number(arr[arr.length - 1][metric]) || 0;
  const delta = +(last - first).toFixed(6);
  const pctChange = first !== 0 ? +((delta / Math.abs(first)) * 100).toFixed(4) : 0;
  return { first: +first.toFixed(6), last: +last.toFixed(6), delta, pctChange, direction: dirOf(delta) };
}

// Weekly-style narrative over a snapshot series: the full per-period table plus the gini and
// holder-growth trends and a one-line plain-language summary. ("Floor rising" in spirit = more
// holders + falling/flat concentration; this reports the inequality + growth direction.)
export function weeklyReport(snapshots) {
  const periods = giniSeries(snapshots);
  const giniTrend = trend(periods, 'gini');
  const holderGrowthTrend = trend(periods, 'holderCount');

  let summary;
  if (periods.length < 2) {
    summary = periods.length === 0
      ? 'No snapshots: nothing to trend.'
      : `Single snapshot: gini ${periods[0].gini}, ${periods[0].holderCount} holders — need 2+ to trend.`;
  } else {
    const gWord = giniTrend.direction === 'rising' ? 'concentrating'
      : giniTrend.direction === 'falling' ? 'distributing' : 'steady';
    const hWord = holderGrowthTrend.direction === 'rising' ? 'growing'
      : holderGrowthTrend.direction === 'falling' ? 'shrinking' : 'flat';
    summary =
      `Over ${periods.length} snapshots: holder base ${hWord} ` +
      `(${holderGrowthTrend.first}→${holderGrowthTrend.last}, ${holderGrowthTrend.delta >= 0 ? '+' : ''}${holderGrowthTrend.delta}); ` +
      `wealth ${gWord} (gini ${giniTrend.first}→${giniTrend.last}, ${giniTrend.pctChange >= 0 ? '+' : ''}${giniTrend.pctChange}%).`;
  }

  return { periods, giniTrend, holderGrowthTrend, summary };
}

// Flag every snapshot whose gini rose by more than `giniJump` versus the immediately prior
// snapshot — a concentration spike worth a human look. Returns the ts of each flagged snapshot.
export function concentrationAlert(series, { giniJump = 0.05 } = {}) {
  const arr = Array.isArray(series) ? series.filter(p => p != null && typeof p === 'object') : [];
  const thr = Number(giniJump);
  const threshold = Number.isFinite(thr) ? thr : 0.05;
  const out = [];
  for (let i = 1; i < arr.length; i++) {
    const prev = Number(arr[i - 1].gini) || 0;
    const cur = Number(arr[i].gini) || 0;
    if (cur - prev > threshold) out.push(arr[i].ts);
  }
  return out;
}

// ── CLI demo (guarded) ─────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('gini-trend.mjs')) {
  // Synthetic weekly snapshots: holder base grows, then one whale concentrates supply in week 4.
  const snapshots = [
    { ts: '2026-05-04', balances: [100, 100, 100, 100] },
    { ts: '2026-05-11', balances: [120, 100, 100, 90, 50, 40] },
    { ts: '2026-05-18', balances: [140, 100, 95, 90, 60, 50, 30, 20] },
    { ts: '2026-05-25', balances: [900, 80, 40, 30, 25, 20, 15, 10] }, // whale appears
  ];
  console.log('Gini trend over holder snapshots (pure)\n' + '─'.repeat(64));
  const series = giniSeries(snapshots);
  for (const p of series) {
    console.log(`  ${p.ts}  gini ${p.gini}  top10 ${p.top10}%  holders ${p.holderCount}  HHI ${p.herfindahl}`);
  }
  const report = weeklyReport(snapshots);
  console.log('\n  gini trend:   ', report.giniTrend);
  console.log('  holder growth:', report.holderGrowthTrend);
  console.log('\n  ' + report.summary);
  console.log('\n  concentration alerts (>0.05 gini jump):', concentrationAlert(series));
}
