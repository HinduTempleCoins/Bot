// snapshot-delta.mjs — holder/distribution snapshot delta tracker (pure).
//
// market-psychology.mjs LABELS sentiment over the whole window; nothing emits a concrete
// period-over-period diff. This module is that missing piece: a pure transform over the
// already-stored price-snapshots.json shape (an object of { SYMBOL: [snapshot, ...] }, each
// snapshot carrying holders{unique,whales,top10Percent,giniCoefficient},
// price{current,target,percentToTarget}, wall{costToPush,sellFloor}).
//
// It computes the signed delta + pct for each tracked field between two snapshots, walks a
// series into consecutive diffs, collapses a whole series to a first→last diff, and renders a
// one-line human summary.
//
// Pure, no network, soft-fail: a missing field => that field's delta is null; never throws.
// The CLI demo reads the local price-snapshots.json.
//
//   node integrations/snapshot-delta.mjs [path-to-price-snapshots.json]

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

// safe nested getter: keys is an array of property names
function dig(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur;
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

// build one {from,to,delta,pct} field-diff from two snapshots at a nested path.
// missing/non-numeric on either side => delta null, pct null (soft-fail).
function fieldDiff(prev, curr, keys) {
  const from = num(dig(prev, keys));
  const to = num(dig(curr, keys));
  if (from === null || to === null) {
    return { from, to, delta: null, pct: null };
  }
  return {
    from: round(from, 10),
    to: round(to, 10),
    delta: round(to - from, 10),
    pct: round(pct(from, to), 4),
  };
}

// the tracked fields, in summary order. label is for summarize().
const FIELDS = [
  { key: 'holdersUnique', path: ['holders', 'unique'], label: 'holders' },
  { key: 'whales', path: ['holders', 'whales'], label: 'whales' },
  { key: 'gini', path: ['holders', 'giniCoefficient'], label: 'gini' },
  { key: 'floor', path: ['wall', 'sellFloor'], label: 'floor' },
  { key: 'costToPush', path: ['wall', 'costToPush'], label: 'costToPush' },
  { key: 'priceCurrent', path: ['price', 'current'], label: 'price' },
];

// --- core API ---------------------------------------------------------------

// diff(prev, curr) — period-over-period field diffs between two snapshots.
// Returns an object keyed by tracked field, each value {from,to,delta,pct}.
// Soft-fail: non-object inputs are treated as empty => all deltas null; never throws.
export function diff(prev, curr) {
  const a = prev && typeof prev === 'object' ? prev : {};
  const b = curr && typeof curr === 'object' ? curr : {};
  const out = {};
  for (const f of FIELDS) {
    out[f.key] = fieldDiff(a, b, f.path);
  }
  return out;
}

// series(snapshots) — array of consecutive diffs (snap[i] → snap[i+1]).
// For N object snapshots returns N-1 diffs; fewer than 2 => []. Soft-fail, never throws.
export function series(snapshots) {
  const snaps = (Array.isArray(snapshots) ? snapshots : []).filter((s) => s && typeof s === 'object');
  const out = [];
  for (let i = 0; i + 1 < snaps.length; i++) {
    out.push(diff(snaps[i], snaps[i + 1]));
  }
  return out;
}

// firstLast(snapshots) — single diff(first, last) over the whole window.
// Fewer than 2 object snapshots => diff of empty pair (all deltas null). Never throws.
export function firstLast(snapshots) {
  const snaps = (Array.isArray(snapshots) ? snapshots : []).filter((s) => s && typeof s === 'object');
  if (snaps.length < 2) return diff(snaps[0], snaps[0]);
  return diff(snaps[0], snaps[snaps.length - 1]);
}

// signed +/- prefix for a number (null-safe)
function signed(v, dp) {
  if (v === null || v === undefined) return null;
  const r = dp === undefined ? v : round(v, dp);
  return (r >= 0 ? '+' : '') + r;
}

// summarize(diff) — one-line human string, e.g.
//   'holders +14 (+1.4%), floor +0.0001, gini -0.01'
// Skips fields whose delta is null (soft-fail). Empty diff => 'no change'.
export function summarize(d) {
  if (!d || typeof d !== 'object') return 'no change';
  const parts = [];
  for (const f of FIELDS) {
    const fd = d[f.key];
    if (!fd || fd.delta === null || fd.delta === undefined) continue;
    const sd = signed(fd.delta);
    if (sd === null) continue;
    if (fd.pct !== null && fd.pct !== undefined) {
      parts.push(`${f.label} ${sd} (${signed(fd.pct)}%)`);
    } else {
      parts.push(`${f.label} ${sd}`);
    }
  }
  return parts.length ? parts.join(', ') : 'no change';
}

// --- CLI demo ---------------------------------------------------------------

function loadHistory(path = DEFAULT_SNAPSHOT_FILE) {
  try {
    const raw = _reader(path);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

if (process.argv[1] && process.argv[1].endsWith('snapshot-delta.mjs')) {
  const path = process.argv[2] || DEFAULT_SNAPSHOT_FILE;
  const history = loadHistory(path);
  const syms = Object.keys(history);
  if (!syms.length) {
    console.log(`no snapshots found in ${path}`);
  } else {
    console.log(`\n════════ snapshot deltas — ${syms.length} symbol(s) from ${path} ════════`);
    for (const sym of syms) {
      const arr = Array.isArray(history[sym]) ? history[sym] : [];
      const fl = firstLast(arr);
      console.log(`\n  ${sym}  [${arr.length} pts]  first→last`);
      console.log(`    ${summarize(fl)}`);
      const steps = series(arr);
      steps.forEach((d, i) => console.log(`    step ${i} → ${i + 1}: ${summarize(d)}`));
    }
  }
}
