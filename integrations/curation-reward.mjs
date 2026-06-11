// curation-reward.mjs — Backlog 1355f4658f (queue ids 343 + 348):
//   "Curation reward calculator (Hive-style stake-weighted, pure)".
//
// A PURE math module. It splits a single post's curation-reward pool among the voters
// who curated it, the Hive way: each voter's claim is proportional to their stake-weight
// TIMES a reverse-auction "curation window" multiplier that penalizes voting too early.
// No IO, no network, no chain, no keys — give it numbers, get numbers back.
//
// DISTINCT FROM the two sibling reward modules in this dir:
//   • staked-vote-weight.mjs — scores ONE vote's weight / tallies a for/against outcome.
//   • hashtag-reward.mjs      — splits a CAMPAIGN budget across authors by tag/engagement.
// This module does neither: it answers "given the voters on ONE post and a reward pool,
// who earns what, with the early-voter penalty applied?"
//
// THE CURATION WINDOW (Hive's reverse auction): a vote cast at the instant of posting earns
// only `floor` of its stake-weight; that multiplier ramps LINEARLY up to 1.0 by the end of
// the window (default 300s on Hive). Voting later within the window is rewarded; sniping the
// post at t=0 is penalized. After the window closes the multiplier is a flat 1.0.
//
// SOFT-FAIL, never throws: empty/garbage votes -> []; non-finite or negative stakes are
// dropped; totalReward <= 0 (or non-finite) -> every share is 0; shares always sum to
// totalReward via largest-remainder rounding at 8 decimal places.
//
//   import { esc, curationWindowFactor, splitCurationReward, renderCurationTable }
//     from './curation-reward.mjs'
//   node integrations/curation-reward.mjs demo

/** HTML-escape any interpolated string. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DP = 8;                 // share precision (Hive money is high-precision)
const SCALE = 1e8;            // 10^DP, the integer-unit scale for exact remainder math

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
/** Clamp to [0, +inf); non-finite / negative -> 0. */
function nonNeg(v) {
  const n = num(v, 0);
  return n > 0 ? n : 0;
}
/** Round to DP decimals without binary drift. */
function round8(n) {
  return Math.round((num(n, 0) + Number.EPSILON) * SCALE) / SCALE;
}

/**
 * curationWindowFactor(secondsSincePost, { windowSec=300, floor=0.15 }) -> number in [floor, 1]
 *
 * Hive's reverse-auction multiplier. At t=0 the factor is `floor` (max early-vote penalty);
 * it ramps LINEARLY to 1.0 at t = windowSec, and stays 1.0 thereafter. Pure, soft-fail:
 *   - non-finite / negative time -> treated as 0 (full penalty).
 *   - windowSec <= 0 -> the window is degenerate, so the factor is a flat 1.0 (no penalty).
 *   - floor is clamped into [0, 1]; a floor > 1 collapses to 1 (no penalty).
 */
export function curationWindowFactor(secondsSincePost, { windowSec = 300, floor = 0.15 } = {}) {
  const w = num(windowSec, 0);
  let f = num(floor, 0);
  if (f < 0) f = 0;
  if (f > 1) f = 1;
  if (!(w > 0)) return 1;                 // degenerate window → no penalty
  const t = nonNeg(secondsSincePost);
  if (t >= w) return 1;                    // window closed → full weight
  const frac = t / w;                      // 0..1 across the window
  return f + (1 - f) * frac;               // floor at t=0, 1.0 at t=w
}

/**
 * splitCurationReward({ totalReward, votes, windowSec?, floor? }) -> [{ voter, share }]
 *
 * votes = [{ voter, stake, secondsSincePost }]. Each voter's claim weight is
 *   stake * curationWindowFactor(secondsSincePost, {windowSec, floor}).
 * The pool `totalReward` is divided proportionally to those weights. Shares are produced at
 * DP (8) decimal places and the rounding remainder is allocated by the largest-remainder
 * method so that sum(share) === round8(totalReward) exactly.
 *
 * Soft-fail, never throws:
 *   - non-array / empty votes -> [].
 *   - votes with non-finite or non-positive stake are DROPPED (not in the output).
 *   - totalReward <= 0 / non-finite -> every surviving voter gets share 0.
 *   - if every surviving weight is 0 (e.g. all stakes valid but window factor 0 — not
 *     reachable since factor >= floor >= 0, but defensively) -> all zero.
 * Output order matches the surviving input order (stable).
 */
export function splitCurationReward({ totalReward, votes, windowSec = 300, floor = 0.15 } = {}) {
  const arr = Array.isArray(votes) ? votes : [];
  if (arr.length === 0) return [];

  // Survivors: a finite, positive stake. Compute each one's claim weight.
  const survivors = [];
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue;
    const stake = num(v.stake, NaN);
    if (!Number.isFinite(stake) || stake <= 0) continue;   // drop garbage / non-positive
    const factor = curationWindowFactor(v.secondsSincePost, { windowSec, floor });
    const weight = stake * factor;
    survivors.push({
      voter: v.voter == null ? '' : String(v.voter),
      weight: weight > 0 ? weight : 0,
    });
  }
  if (survivors.length === 0) return [];

  const pool = num(totalReward, 0);
  if (!(pool > 0)) return survivors.map((s) => ({ voter: s.voter, share: 0 }));

  const totalWeight = survivors.reduce((a, s) => a + s.weight, 0);
  if (!(totalWeight > 0)) return survivors.map((s) => ({ voter: s.voter, share: 0 }));

  // Work in integer units of 1/SCALE to make the largest-remainder split exact.
  const poolUnits = Math.round(round8(pool) * SCALE);
  const ideal = survivors.map((s) => (poolUnits * s.weight) / totalWeight);
  const floors = ideal.map((x) => Math.floor(x));
  let assigned = floors.reduce((a, b) => a + b, 0);
  let remainder = poolUnits - assigned;   // >= 0, < survivors.length

  // Hand out the leftover units to the largest fractional parts (largest-remainder method).
  // Ties broken by original index for determinism.
  const order = ideal
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  const units = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) {
    units[order[k].i] += 1;
    remainder -= 1;
  }

  return survivors.map((s, i) => ({ voter: s.voter, share: round8(units[i] / SCALE) }));
}

/**
 * renderCurationTable(result) -> markdown table string.
 * result = the array returned by splitCurationReward (or anything; soft-fail to a header-only
 * table). Every interpolated field is esc()'d so the output is safe to embed in HTML/markdown.
 */
export function renderCurationTable(result) {
  const rows = Array.isArray(result) ? result : [];
  const head = '| voter | share |\n|---|---:|';
  if (rows.length === 0) return `${head}\n| _(none)_ | 0.00000000 |`;
  let total = 0;
  const body = rows.map((r) => {
    const voter = esc(r && r.voter);
    const n = num(r && r.share, 0);
    total += n;
    return `| ${voter} | ${esc(n.toFixed(DP))} |`;
  }).join('\n');
  return `${head}\n${body}\n| **total** | **${esc(round8(total).toFixed(DP))}** |`;
}

// ── CLI demo (guarded) ───────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const votes = [
    { voter: 'alice', stake: 1000, secondsSincePost: 5 },    // very early → big penalty
    { voter: 'bob',   stake: 1000, secondsSincePost: 150 },   // mid-window
    { voter: 'carol', stake: 1000, secondsSincePost: 300 },   // at window close → full
    { voter: 'dave',  stake: 1000, secondsSincePost: 9000 },  // after close → full
    { voter: 'eve',   stake: NaN,  secondsSincePost: 60 },    // garbage stake → dropped
  ];
  const out = splitCurationReward({ totalReward: 100, votes });
  process.stdout.write(renderCurationTable(out) + '\n');
  process.stdout.write('sum = ' + out.reduce((a, r) => a + r.share, 0).toFixed(DP) + '\n');
}
