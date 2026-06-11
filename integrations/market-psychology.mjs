// market-psychology.mjs — market-psychology TREND metrics over the snapshot timeline.
//
// Where market-depth.mjs / holders.mjs read a single point in time, this module reads the
// HISTORY already stored in price-snapshots.json (an object of { SYMBOL: [snapshot, ...] })
// and derives how the crowd is behaving across the timeline: are holders growing? is the
// floor rising? is concentration loosening or tightening? is it getting more expensive to push
// the price? From those signals it labels the market sentiment (ACCUMULATING / DISTRIBUTING /
// STAGNANT / DEAD).
//
// Pure, no network, soft-fail: missing fields are skipped, never throws. The CLI demo reads the
// local price-snapshots.json.
//
//   node integrations/market-psychology.mjs [path-to-price-snapshots.json]

import { readFileSync } from 'node:fs';

const DEFAULT_SNAPSHOT_FILE = 'price-snapshots.json';

// injectable reader seam (for tests / alternate sources)
let _reader = (path) => readFileSync(path, 'utf8');
export function __setReader(fn) { _reader = fn || ((path) => readFileSync(path, 'utf8')); }

// --- small pure helpers -----------------------------------------------------

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// safe nested getter: path is an array of keys
function dig(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur;
}

// pull a numeric series from the snapshots for a nested field; skips missing/non-numeric points
function series(snaps, keys) {
  const out = [];
  for (const s of snaps) {
    const v = num(dig(s, keys));
    if (v !== null) out.push(v);
  }
  return out;
}

function pct(from, to) {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

function round(v, dp = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// sign of (last - first) with a tiny epsilon dead-band so float noise reads as flat
function trendOf(vals, eps = 0) {
  if (!vals || vals.length < 2) return { direction: 'FLAT', delta: 0, first: vals && vals.length ? vals[0] : null, last: vals && vals.length ? vals[vals.length - 1] : null };
  const first = vals[0], last = vals[vals.length - 1];
  const delta = last - first;
  let direction = 'FLAT';
  if (delta > eps) direction = 'RISING';
  else if (delta < -eps) direction = 'FALLING';
  return { direction, delta: round(delta, 8), first: round(first, 8), last: round(last, 8) };
}

// least-squares slope over an index axis (0..n-1) — sign tells the dominant direction even
// when first/last happen to be equal. Deterministic.
function slopeOf(vals) {
  const n = vals.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += vals[i]; sxx += i * i; sxy += i * vals[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

// --- core API ---------------------------------------------------------------

// psychology(snapshots) — snapshots is an array of per-symbol records (the value side of one
// price-snapshots.json entry). Returns deterministic trend metrics + a sentiment label, or a
// soft-fail shell when there is not enough data.
export function psychology(snapshots) {
  const snaps = Array.isArray(snapshots) ? snapshots : [];
  // keep only object-shaped records, ordered by timestampMs when present (stable otherwise)
  const clean = snaps
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => ({ s, i, t: num(dig(s, ['timestampMs'])) }))
    .sort((a, b) => {
      if (a.t !== null && b.t !== null && a.t !== b.t) return a.t - b.t;
      return a.i - b.i;
    })
    .map((x) => x.s);

  const symbol = (clean.find((s) => typeof s.symbol === 'string') || {}).symbol || null;
  const points = clean.length;

  const base = {
    symbol,
    points,
    holderGrowth: null,
    floorTrend: null,
    concentrationTrend: null,
    costToPushTrend: null,
    aliveRatio: null,
    sentiment: 'DEAD',
  };

  if (points === 0) return { ...base, sentiment: 'DEAD', note: 'no snapshots' };

  // --- holder growth (first→last unique delta + pct) ---
  const holders = series(clean, ['holders', 'unique']);
  let holderGrowth = null;
  if (holders.length >= 1) {
    const first = holders[0];
    const last = holders[holders.length - 1];
    holderGrowth = {
      first,
      last,
      delta: last - first,
      pct: round(pct(first, last), 4),
      direction: holders.length < 2 ? 'FLAT' : (last > first ? 'RISING' : last < first ? 'FALLING' : 'FLAT'),
    };
  }

  // --- floor trend (sign + slope of price.current) ---
  const prices = series(clean, ['price', 'current']);
  let floorTrend = null;
  if (prices.length >= 1) {
    floorTrend = { ...trendOf(prices), slope: round(slopeOf(prices), 10) };
  }

  // --- concentration trend (gini delta; RISING gini = MORE concentrated) ---
  const gini = series(clean, ['holders', 'giniCoefficient']);
  const top10 = series(clean, ['holders', 'top10Percent']);
  let concentrationTrend = null;
  if (gini.length >= 1) {
    const t = trendOf(gini, 1e-9);
    concentrationTrend = {
      ...t,
      giniDelta: t.delta,
      top10Delta: top10.length >= 2 ? round(top10[top10.length - 1] - top10[0], 6) : null,
      // RISING gini = whales tightening grip; FALLING = distribution spreading out
      meaning: t.direction === 'RISING' ? 'CONCENTRATING' : t.direction === 'FALLING' ? 'DISPERSING' : 'STABLE',
    };
  }

  // --- cost-to-push trend ---
  const ctp = series(clean, ['wall', 'costToPush']);
  let costToPushTrend = null;
  if (ctp.length >= 1) {
    costToPushTrend = { ...trendOf(ctp, 1e-9), slope: round(slopeOf(ctp), 10) };
  }

  // --- alive ratio over the window ---
  let aliveSeen = 0, aliveTrue = 0;
  for (const s of clean) {
    const v = dig(s, ['market', 'isAlive']);
    if (typeof v === 'boolean') { aliveSeen++; if (v) aliveTrue++; }
  }
  const aliveRatio = aliveSeen ? round(aliveTrue / aliveSeen, 4) : null;

  const sentiment = sentimentLabel({ holderGrowth, floorTrend, concentrationTrend, costToPushTrend, aliveRatio });

  return { symbol, points, holderGrowth, floorTrend, concentrationTrend, costToPushTrend, aliveRatio, sentiment };
}

// derive a sentiment label from the computed signals. Deterministic, order-independent.
//  DEAD         — nothing is alive across the window
//  ACCUMULATING — holders growing and/or floor rising and/or cost-to-push rising (demand building)
//  DISTRIBUTING — holders shrinking or floor falling while concentration disperses (exit/dump)
//  STAGNANT     — alive but flat on every axis
export function sentimentLabel(m) {
  m = m || {};
  // DEAD: explicit no-life signal across the whole window
  if (m.aliveRatio !== null && m.aliveRatio !== undefined && m.aliveRatio === 0) return 'DEAD';

  const hg = m.holderGrowth;
  const ft = m.floorTrend;
  const ct = m.concentrationTrend;
  const cp = m.costToPushTrend;

  const holdersUp = hg && hg.delta > 0;
  const holdersDown = hg && hg.delta < 0;
  const floorUp = ft && ft.direction === 'RISING';
  const floorDown = ft && ft.direction === 'FALLING';
  const costUp = cp && cp.direction === 'RISING';
  const costDown = cp && cp.direction === 'FALLING';
  const dispersing = ct && ct.meaning === 'DISPERSING';

  // bullish/bearish vote tally — pure and symmetric
  let bull = 0, bear = 0;
  if (holdersUp) bull++; if (holdersDown) bear++;
  if (floorUp) bull++; if (floorDown) bear++;
  if (costUp) bull++; if (costDown) bear++;

  if (bull > bear) return 'ACCUMULATING';
  if (bear > bull) return 'DISTRIBUTING';
  // tie: a dispersing cap-table with no demand reads as distribution; otherwise stagnant
  if (bull === 0 && bear === 0) {
    if (dispersing && (holdersDown || floorDown)) return 'DISTRIBUTING';
    return 'STAGNANT';
  }
  // equal non-zero votes — let concentration break the tie
  if (dispersing) return 'DISTRIBUTING';
  return 'STAGNANT';
}

// weeklyReport(historyBySymbol) — maps the object-of-arrays in price-snapshots.json to one
// psychology summary per symbol. Soft-fails on a per-symbol basis; never throws.
export function weeklyReport(historyBySymbol) {
  const out = {};
  if (!historyBySymbol || typeof historyBySymbol !== 'object') return out;
  for (const sym of Object.keys(historyBySymbol)) {
    try {
      const arr = historyBySymbol[sym];
      out[sym] = psychology(Array.isArray(arr) ? arr : []);
    } catch {
      out[sym] = { symbol: sym, points: 0, sentiment: 'DEAD', note: 'error' };
    }
  }
  return out;
}

// load history from a JSON file via the injectable reader (soft-fail → {})
export function loadHistory(path = DEFAULT_SNAPSHOT_FILE) {
  try {
    const raw = _reader(path);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// --- CLI demo ---------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('market-psychology.mjs')) {
  const path = process.argv[2] || DEFAULT_SNAPSHOT_FILE;
  const history = loadHistory(path);
  const report = weeklyReport(history);
  const syms = Object.keys(report);
  if (!syms.length) {
    console.log(`no snapshots found in ${path}`);
  } else {
    console.log(`\n════════ market psychology — ${syms.length} symbol(s) from ${path} ════════`);
    for (const sym of syms) {
      const r = report[sym];
      const hg = r.holderGrowth;
      const ft = r.floorTrend;
      const ct = r.concentrationTrend;
      const cp = r.costToPushTrend;
      console.log(`\n  ${sym}  [${r.points} pts]  →  ${r.sentiment}`);
      if (hg) console.log(`    holders : ${hg.first} → ${hg.last}  (${hg.delta >= 0 ? '+' : ''}${hg.delta}, ${hg.pct === null ? '—' : hg.pct + '%'}, ${hg.direction})`);
      if (ft) console.log(`    floor   : ${ft.first} → ${ft.last}  (${ft.direction}, slope ${ft.slope})`);
      if (ct) console.log(`    gini    : ${ct.first} → ${ct.last}  (${ct.meaning})`);
      if (cp) console.log(`    cost↑   : ${cp.first} → ${cp.last}  (${cp.direction})`);
      if (r.aliveRatio !== null) console.log(`    alive   : ${(r.aliveRatio * 100).toFixed(0)}% of window`);
    }
  }
}
