// holder-growth.mjs — PURE holder-count growth + floor-rising time-series. No network, no keys, no IO.
//
// Distinct from its siblings in integrations/:
//   - holder-inequality.mjs : point-in-time gini / Nakamoto / topNShare on ONE snapshot
//   - holders.mjs           : live fetch of the current holder set
//   - gini-trend.mjs        : INEQUALITY (gini) measured over a series
//   - snapshot-delta.mjs    : generic two-point balance diff
// This module asks a different question: is the HOLDER COUNT growing and is the FLOOR PRICE
// rising across a run of snapshots? — backlog 57ff9b1a48 ("holder growth + floor-rising").
//
// Snapshot shape: { ts | date, holders:int, floor | floorPrice:number, supply?:number }.
//
//   holderSeries(snapshots)                 — [{date, holders, floor}] sorted ascending by time
//   growthRate(series, {periodDays=7})      — {absolute, pct, perDay} holder change over the window
//   floorTrend(series)                      — {firstFloor, lastFloor, pctChange, rising:boolean}
//   weeklyGrowthReport(series)              — [{weekStart, holdersStart, holdersEnd, deltaHolders, floorStart, floorEnd}]
//   momentum(series)                        — {label, holderSlope, floorSlope} from simple linear slopes
//   renderMarkdown(report)                  — Markdown table for a weeklyGrowthReport
//
// Soft-fail: fewer than 2 usable points returns zeros / [] with rising:false; never throws; no network.
//
//   node integrations/holder-growth.mjs     — demo against a built-in synthetic snapshot series
//   import { holderSeries, growthRate, floorTrend, weeklyGrowthReport, momentum, renderMarkdown } from './holder-growth.mjs'

const DAY_MS = 86400000;

// HTML/Markdown escape for any interpolated value (house rule: esc() all interpolation).
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Coerce a snapshot's time field (ts or date) to epoch ms. Accepts numbers (epoch ms),
// ISO strings, or Date. Returns NaN when unparseable so callers can drop the point.
function tsKey(v) {
  if (v == null) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Render an epoch-ms back to a YYYY-MM-DD UTC date string for stable, sortable labels.
function isoDate(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

// Normalize the raw snapshot list into clean, time-sorted points carrying the parsed epoch
// (_ms) alongside the friendly date label. Drops entries with no usable time. Never throws.
function normSnapshots(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  const out = [];
  for (const s of snapshots) {
    if (s == null || typeof s !== 'object') continue;
    const ms = tsKey(s.ts != null ? s.ts : s.date);
    if (!Number.isFinite(ms)) continue;
    const holders = num(s.holders);
    const floor = num(s.floor != null ? s.floor : s.floorPrice);
    out.push({
      _ms: ms,
      date: isoDate(ms),
      holders: Number.isFinite(holders) ? holders : 0,
      floor: Number.isFinite(floor) ? floor : 0,
    });
  }
  return out.sort((a, b) => a._ms - b._ms);
}

// Public series: time-sorted {date, holders, floor} points (drops the internal _ms key).
export function holderSeries(snapshots) {
  return normSnapshots(snapshots).map(p => ({ date: p.date, holders: p.holders, floor: p.floor }));
}

// Re-derive normalized+sorted points (with _ms) from EITHER raw snapshots or an already-built
// series, so every exported function tolerates being handed either form.
function asPoints(seriesOrSnaps) {
  const pts = normSnapshots(seriesOrSnaps);
  return pts;
}

// Holder-count change over a trailing window of `periodDays`. We compare the last point to the
// earliest point that is still within the window (last - periodDays). absolute = raw count change,
// pct = percent vs the window-start count, perDay = absolute / actual days spanned.
// Soft-fail: <2 usable points → all zeros.
export function growthRate(series, { periodDays = 7 } = {}) {
  const pts = asPoints(series);
  const zero = { absolute: 0, pct: 0, perDay: 0 };
  if (pts.length < 2) return zero;

  const days = num(periodDays);
  const win = Number.isFinite(days) && days > 0 ? days : 7;
  const last = pts[pts.length - 1];
  const cutoff = last._ms - win * DAY_MS;

  // Earliest point within the window; fall back to the very first point if none qualify.
  let start = pts[0];
  for (const p of pts) {
    if (p._ms >= cutoff) { start = p; break; }
  }
  if (start._ms === last._ms) {
    // Window collapsed onto a single point — widen to the first available point.
    start = pts[0];
  }

  const absolute = last.holders - start.holders;
  const pct = start.holders !== 0 ? +((absolute / Math.abs(start.holders)) * 100).toFixed(4) : 0;
  const spanDays = (last._ms - start._ms) / DAY_MS;
  const perDay = spanDays > 0 ? +(absolute / spanDays).toFixed(4) : 0;
  return { absolute, pct, perDay };
}

// Floor-price trend across the whole series: first vs last floor, percent change, and whether
// the floor is rising (last > first, with a tiny epsilon to ignore float noise).
export function floorTrend(series) {
  const pts = asPoints(series);
  if (pts.length < 2) return { firstFloor: 0, lastFloor: 0, pctChange: 0, rising: false };
  const firstFloor = pts[0].floor;
  const lastFloor = pts[pts.length - 1].floor;
  const delta = lastFloor - firstFloor;
  const pctChange = firstFloor !== 0 ? +((delta / Math.abs(firstFloor)) * 100).toFixed(4) : 0;
  const rising = delta > 1e-12;
  return { firstFloor, lastFloor, pctChange, rising };
}

// Monday-anchored (UTC) start-of-week epoch for a given ms. ISO weeks start Monday.
function weekStartMs(ms) {
  const d = new Date(ms);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = (dow + 6) % 7; // days since Monday
  const wk = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY_MS;
  return wk;
}

// Bucket snapshots into ISO weeks and report holder/floor start→end per week. Within each week
// the first and last (by time) snapshots define start/end. Soft-fail: empty/none → [].
export function weeklyGrowthReport(series) {
  const pts = asPoints(series);
  if (pts.length === 0) return [];
  const buckets = new Map();
  for (const p of pts) {
    const wk = weekStartMs(p._ms);
    if (!buckets.has(wk)) buckets.set(wk, []);
    buckets.get(wk).push(p);
  }
  const weeks = [...buckets.keys()].sort((a, b) => a - b);
  return weeks.map(wk => {
    const group = buckets.get(wk); // already time-sorted (pts was sorted)
    const s = group[0];
    const e = group[group.length - 1];
    return {
      weekStart: isoDate(wk),
      holdersStart: s.holders,
      holdersEnd: e.holders,
      deltaHolders: e.holders - s.holders,
      floorStart: s.floor,
      floorEnd: e.floor,
    };
  });
}

// Simple least-squares slope of `ys` against x = day-offset from the first point. Returns 0 on
// degenerate input (constant x, <2 points). Pure helper for momentum().
function linearSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return 0;
  return (n * sxy - sx * sy) / denom;
}

// Momentum from per-day linear slopes of holder count and floor price.
//   accelerating — holders growing AND floor rising
//   steady       — holders growing, floor flat/falling
//   stalling     — holders flat, floor not falling
//   declining    — holders shrinking
// Soft-fail: <2 usable points → 'steady' with zero slopes.
export function momentum(series) {
  const pts = asPoints(series);
  if (pts.length < 2) return { label: 'steady', holderSlope: 0, floorSlope: 0 };
  const base = pts[0]._ms;
  const xs = pts.map(p => (p._ms - base) / DAY_MS);
  const holderSlope = +linearSlope(xs, pts.map(p => p.holders)).toFixed(6);
  const floorSlope = +linearSlope(xs, pts.map(p => p.floor)).toFixed(6);

  const HE = 1e-9;
  let label;
  if (holderSlope < -HE) label = 'declining';
  else if (holderSlope > HE) label = floorSlope > HE ? 'accelerating' : 'steady';
  else label = floorSlope < -HE ? 'declining' : 'stalling';

  return { label, holderSlope, floorSlope };
}

// Render a weeklyGrowthReport (array of week rows) as a Markdown table. Accepts the array
// directly. Soft-fail: empty/non-array → a one-line "no data" note. esc() every cell.
export function renderMarkdown(report) {
  const rows = Array.isArray(report) ? report : [];
  if (rows.length === 0) return '_No holder-growth data._';
  const header =
    '| Week | Holders start | Holders end | Δ holders | Floor start | Floor end |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: |';
  const body = rows.map(r => {
    const d = Number(r && r.deltaHolders) || 0;
    const dStr = (d >= 0 ? '+' : '') + d;
    return `| ${esc(r && r.weekStart)} | ${esc(r && r.holdersStart)} | ${esc(r && r.holdersEnd)} | ` +
      `${esc(dStr)} | ${esc(r && r.floorStart)} | ${esc(r && r.floorEnd)} |`;
  });
  return [header, ...body].join('\n');
}

// ── CLI demo (guarded) ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('holder-growth.mjs')) {
  const snapshots = [
    { date: '2026-05-04', holders: 100, floor: 0.10 },
    { date: '2026-05-07', holders: 118, floor: 0.11 },
    { date: '2026-05-11', holders: 140, floor: 0.13 },
    { date: '2026-05-18', holders: 175, floor: 0.16 },
    { date: '2026-05-25', holders: 210, floor: 0.20 },
  ];
  console.log('Holder-count growth + floor-rising tracker (pure)\n' + '─'.repeat(64));
  console.log('  series:', holderSeries(snapshots));
  console.log('\n  growthRate (7d):', growthRate(snapshots, { periodDays: 7 }));
  console.log('  floorTrend:     ', floorTrend(snapshots));
  console.log('  momentum:       ', momentum(snapshots));
  console.log('\n' + renderMarkdown(weeklyGrowthReport(snapshots)));
}
