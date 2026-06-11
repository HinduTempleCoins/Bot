// strategy-effectiveness.mjs — PURE weekly strategy-effectiveness scorer. No network, no keys, no IO.
//
// Distinct from its siblings: gini-trend.mjs tracks INEQUALITY over time, holder-growth.mjs counts
// HOLDERS, profit-tracker.mjs reports raw PnL. This module sits on top — it scores whether the
// overall STRATEGY is working week-over-week: are holders/floor trending up, is net (revenue-cost)
// trending up, when does cumulative net break even, and is the project self-sustaining
// (revenue > costs) for the recent run? Items: 'Assess strategy effectiveness',
// 'Compare trends over weeks', 'self-sustaining by Month 3 (revenue > costs)'.
//
// A weekly snapshot is { weekStart, holders, floor, revenueHive, costHive }. weekStart is any
// sortable value (epoch ms/s, ISO string, or Date). All numeric fields coerce; missing → 0.
//
//   weekly(snapshots)               — sorted [{weekStart, holders, floor, revenueHive, costHive, net}]
//   trendOf(series, metric)         — {slope, direction:'up'|'flat'|'down', firstVal, lastVal, pctChange}
//   breakevenWeek(series)           — weekStart of first week where CUMULATIVE net >= 0, or null
//   selfSustaining(series, {sinceWeeks}) — boolean: net > 0 for the last N weeks
//   scorecard(series)               — {holdersTrend, floorTrend, netTrend, breakevenWeek,
//                                       selfSustaining, grade:'A'|'B'|'C'|'D'}
//   renderMarkdown(scorecard)       — markdown summary string (esc()'d)
//
// Soft-fail: <2 weeks → direction 'flat', grade 'D', breakevenWeek null. Never throws.
//
//   node integrations/strategy-effectiveness.mjs   — demo against a built-in synthetic week series
//   import { weekly, trendOf, breakevenWeek, selfSustaining, scorecard, renderMarkdown } from './strategy-effectiveness.mjs'

// Coerce weekStart to a comparable, sortable value. Accepts numbers, ISO strings, or Date.
// Falls back to 0 so sorting never throws.
function weekKey(weekStart) {
  if (weekStart == null) return 0;
  if (typeof weekStart === 'number' && Number.isFinite(weekStart)) return weekStart;
  const t = Date.parse(weekStart);
  return Number.isFinite(t) ? t : 0;
}

// Coerce any field to a finite number, else 0.
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Minimal HTML/markdown escaper for interpolated values in renderMarkdown.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Normalize + sort weekly snapshots ascending by weekStart. Drops non-object entries, computes net.
export function weekly(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots
    .filter(s => s != null && typeof s === 'object')
    .map(s => {
      const revenueHive = num(s.revenueHive);
      const costHive = num(s.costHive);
      return {
        weekStart: s.weekStart,
        holders: num(s.holders),
        floor: num(s.floor),
        revenueHive,
        costHive,
        net: +(revenueHive - costHive).toFixed(8),
      };
    })
    .sort((a, b) => weekKey(a.weekStart) - weekKey(b.weekStart));
}

// Direction label from a numeric slope, with a small epsilon so float noise reads as 'flat'.
function dirOf(slope, eps = 1e-9) {
  if (!Number.isFinite(slope) || Math.abs(slope) <= eps) return 'flat';
  return slope > 0 ? 'up' : 'down';
}

// Least-squares slope of the metric across the series (x = week index 0..n-1). Plus first/last
// values, percent change, and a direction label. Soft-fail: <2 points → slope 0, direction 'flat'.
export function trendOf(series, metric) {
  const arr = Array.isArray(series) ? series.filter(p => p != null && typeof p === 'object') : [];
  if (arr.length < 2) {
    const only = arr.length === 1 ? num(arr[0][metric]) : 0;
    return { slope: 0, direction: 'flat', firstVal: only, lastVal: only, pctChange: 0 };
  }
  const n = arr.length;
  const ys = arr.map(p => num(p[metric]));
  const firstVal = ys[0];
  const lastVal = ys[n - 1];
  // x = 0..n-1, so mean(x) = (n-1)/2.
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let numr = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    numr += (i - meanX) * (ys[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  const slope = den === 0 ? 0 : +(numr / den).toFixed(8);
  const pctChange = firstVal !== 0 ? +(((lastVal - firstVal) / Math.abs(firstVal)) * 100).toFixed(4) : 0;
  return { slope, direction: dirOf(slope), firstVal, lastVal, pctChange };
}

// First week where CUMULATIVE net (running sum of revenue - cost) is >= 0. Returns that week's
// weekStart, or null if it never crosses (or empty series). Soft-fail.
export function breakevenWeek(series) {
  const arr = Array.isArray(series) ? series.filter(p => p != null && typeof p === 'object') : [];
  let cum = 0;
  for (let i = 0; i < arr.length; i++) {
    cum += num(arr[i].net);
    if (cum >= 0) return arr[i].weekStart;
  }
  return null;
}

// True when net > 0 for each of the last N weeks. Needs at least N weeks of data. Soft-fail:
// fewer than N weeks (or empty) → false.
export function selfSustaining(series, { sinceWeeks = 1 } = {}) {
  const arr = Array.isArray(series) ? series.filter(p => p != null && typeof p === 'object') : [];
  const nWanted = Number.isFinite(Number(sinceWeeks)) && Number(sinceWeeks) > 0 ? Math.floor(Number(sinceWeeks)) : 1;
  if (arr.length < nWanted) return false;
  const tail = arr.slice(arr.length - nWanted);
  return tail.every(p => num(p.net) > 0);
}

// Roll the trends + breakeven + sustaining into a single scorecard with a letter grade.
// Grade from how many of the three trends point 'up' plus the self-sustaining bonus:
//   score = (#up trends, 0..3) + (selfSustaining ? 1 : 0)  → 0..4
//   4 → A, 3 → B, 2 → C, else D.
// Soft-fail: <2 weeks → all directions 'flat', breakevenWeek null, selfSustaining false, grade 'D'.
export function scorecard(series) {
  const arr = Array.isArray(series) ? series.filter(p => p != null && typeof p === 'object') : [];
  const holdersTrend = trendOf(arr, 'holders');
  const floorTrend = trendOf(arr, 'floor');
  const netTrend = trendOf(arr, 'net');
  const be = breakevenWeek(arr);
  const sustaining = selfSustaining(arr);

  let grade = 'D';
  if (arr.length >= 2) {
    const ups = [holdersTrend, floorTrend, netTrend].filter(t => t.direction === 'up').length;
    const score = ups + (sustaining ? 1 : 0);
    grade = score >= 4 ? 'A' : score === 3 ? 'B' : score === 2 ? 'C' : 'D';
  }

  return {
    holdersTrend,
    floorTrend,
    netTrend,
    breakevenWeek: be,
    selfSustaining: sustaining,
    grade,
  };
}

// Plain-language markdown rendering of a scorecard. All interpolated values are esc()'d.
export function renderMarkdown(card) {
  const c = card && typeof card === 'object' ? card : {};
  const t = (x) => (x && typeof x === 'object' ? x : { slope: 0, direction: 'flat', firstVal: 0, lastVal: 0, pctChange: 0 });
  const h = t(c.holdersTrend);
  const f = t(c.floorTrend);
  const n = t(c.netTrend);
  const line = (label, tr) =>
    `- **${esc(label)}**: ${esc(tr.direction)} (${esc(tr.firstVal)} → ${esc(tr.lastVal)}, ` +
    `${tr.pctChange >= 0 ? '+' : ''}${esc(tr.pctChange)}%, slope ${esc(tr.slope)})`;
  const be = c.breakevenWeek == null ? 'not yet' : esc(c.breakevenWeek);
  return [
    `## Strategy effectiveness — grade ${esc(c.grade || 'D')}`,
    '',
    line('Holders', h),
    line('Floor', f),
    line('Net (revenue − cost)', n),
    `- **Breakeven week**: ${be}`,
    `- **Self-sustaining**: ${c.selfSustaining ? 'yes' : 'no'}`,
  ].join('\n');
}

// ── CLI demo (guarded) ─────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('strategy-effectiveness.mjs')) {
  // Synthetic weekly snapshots: holders + floor grow, costs flat, revenue overtakes cost by week 4.
  const snapshots = [
    { weekStart: '2026-05-04', holders: 40, floor: 0.10, revenueHive: 5, costHive: 20 },
    { weekStart: '2026-05-11', holders: 70, floor: 0.12, revenueHive: 12, costHive: 20 },
    { weekStart: '2026-05-18', holders: 110, floor: 0.15, revenueHive: 24, costHive: 20 },
    { weekStart: '2026-05-25', holders: 160, floor: 0.20, revenueHive: 38, costHive: 20 },
  ];
  console.log('Strategy effectiveness over weekly snapshots (pure)\n' + '─'.repeat(64));
  const series = weekly(snapshots);
  for (const w of series) {
    console.log(`  ${w.weekStart}  holders ${w.holders}  floor ${w.floor}  rev ${w.revenueHive}  cost ${w.costHive}  net ${w.net}`);
  }
  const card = scorecard(series);
  console.log('\n  breakeven week:', breakevenWeek(series));
  console.log('  self-sustaining (last 1):', selfSustaining(series));
  console.log('  self-sustaining (last 2):', selfSustaining(series, { sinceWeeks: 2 }));
  console.log('\n' + renderMarkdown(card));
}
