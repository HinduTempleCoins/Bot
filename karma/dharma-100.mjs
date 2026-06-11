// dharma-100.mjs — the Witness's 100/100 Dharma merit-balance math (BRIEF.md §9, karma dialogue tree).
//
// The "100/100 Dharma model" frames an account's standing on TWO axes, each scored on a 0..100 scale:
//
//   • GIVEN    — what the account has put into the commons (votes cast, content offered, accounts sired,
//                value transferred out). The generosity axis.
//   • RECEIVED — what the account has drawn from the commons (votes earned, rewards, lifts received).
//                The benefit axis.
//
// A "100/100" account is one that both gives and receives at the top of the scale — fully engaged on
// both sides. The model's distinctive claim is that DHARMA is not just a high score on either axis but
// the SYMMETRY between them: an account that takes a great deal and gives nothing back (or pours value
// out and never participates) is OUT OF BALANCE, however large one number is. `balance` measures that
// symmetry directly (100 = perfectly balanced, 0 = maximally lopsided).
//
// This is DISTINCT from:
//   • karma/karma.mjs        — scores an account's own ongoing ACTIVITY against a KARMA_WEIGHTS scheme.
//   • karma/siring-model.mjs — scores a single siring ACT and ranks sires; (usersVoted*bpGained)*weight.
// dharma-100 is a standalone two-axis BALANCE calculator. It complements siring-model (which only looks
// at the giving side of a lift) by also weighing what an account has received. No overlap.
//
// PURE MATH: no I/O, no fetch, no network, no disk, no clock. Every export is deterministic and
// soft-fails — missing / NaN / non-finite inputs coerce to 0, nothing ever throws.

// ── numeric helpers ─────────────────────────────────────────────────────────────
// num: anything → a finite number, else 0. (Covers undefined, null, NaN, Infinity, strings, objects.)
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, num(x)));
// clamp01x100: any number → the 0..100 band.
const clamp100 = (x) => clamp(x, 0, 100);

// ── exported constants ──────────────────────────────────────────────────────────
// FULL_SCALE: the top of each axis. The model is named for it — "100/100".
export const FULL_SCALE = 100;
// REFERENCE_UNITS: the raw input level that maps to a full 100 on an axis. An account that has given
// (or received) REFERENCE_UNITS worth of activity sits at the top of that axis; below it scales
// linearly toward 0. Above it simply clamps at 100. This makes the axes comparable so `balance` is
// meaningful regardless of the absolute magnitude of either side.
export const REFERENCE_UNITS = 100;

// DHARMA_TIERS: ordered HIGH→LOW bands keyed off a single 0..100 score (used by tier()). Each band is
// [minInclusive, label]; the first band whose min the score meets/exceeds wins. Names follow the
// dialogue-tree's dharma vocabulary (a fully-balanced, fully-engaged account is "Bodhi").
export const DHARMA_TIERS = Object.freeze([
  { min: 90, label: 'Bodhi' },      // 90..100 — awakened balance
  { min: 70, label: 'Dharmika' },   // 70..89  — righteous
  { min: 50, label: 'Grihastha' },  // 50..69  — householder, carrying weight
  { min: 30, label: 'Shishya' },    // 30..49  — student, finding footing
  { min: 0,  label: 'Atithi' },     // 0..29   — guest, newly arrived
]);

/**
 * normalizeAxis(raw) → 0..100.
 *
 *   axis = clamp( (raw / REFERENCE_UNITS) * FULL_SCALE , 0, 100 )
 *
 * Linear up to REFERENCE_UNITS, then clamped at FULL_SCALE. Negative / NaN / non-finite raw → 0.
 *
 * @param {number} raw  raw activity units on one axis (given or received)
 * @returns {number} normalized score in [0, 100]
 */
export function normalizeAxis(raw) {
  const r = num(raw);
  if (REFERENCE_UNITS <= 0) return 0; // defensive; REFERENCE_UNITS is a positive constant
  return clamp100((r / REFERENCE_UNITS) * FULL_SCALE);
}

/**
 * dharmaScore({given, received}) → {givenScore, receivedScore, balance}.
 *
 *   givenScore    = normalizeAxis(given)      // 0..100
 *   receivedScore = normalizeAxis(received)   // 0..100
 *   balance       = 100 - |givenScore - receivedScore|   // 0..100, symmetry of the two axes
 *
 * `balance` is 100 when the two normalized axes are equal (perfect give/receive symmetry) and falls
 * toward 0 as they diverge — a hoarder (high received, low given) and a martyr (high given, low
 * received) both score low on balance, however large one axis is.
 *
 * Soft-fail: a missing / malformed argument is treated as {given:0, received:0} → {0,0,balance:100}
 * (two zeros ARE symmetric — a brand-new account is trivially balanced, just at the bottom of both
 * axes). Never throws.
 *
 * @param {{given?:number, received?:number}} [input]
 * @returns {{givenScore:number, receivedScore:number, balance:number}}
 */
export function dharmaScore(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const givenScore = normalizeAxis(src.given);
  const receivedScore = normalizeAxis(src.received);
  const balance = clamp100(FULL_SCALE - Math.abs(givenScore - receivedScore));
  return { givenScore, receivedScore, balance };
}

/**
 * isBalanced(score, tolerance=10) → boolean.
 *
 * Accepts either a number (interpreted as a balance value 0..100) OR a dharmaScore() result object
 * (its `.balance` is used). True when the score is within `tolerance` of a perfect FULL_SCALE — i.e.
 * the give/receive gap is no wider than `tolerance` points.
 *
 *   balanced ⇔ balance >= (FULL_SCALE - tolerance)
 *
 * Soft-fail: malformed score → its balance coerces to 0 (not balanced); a negative / NaN tolerance
 * coerces to 0 (strictest — only a perfect 100 passes). Never throws.
 *
 * @param {number|{balance:number}} score
 * @param {number} [tolerance=10]
 * @returns {boolean}
 */
export function isBalanced(score, tolerance = 10) {
  let balance;
  if (score && typeof score === 'object') {
    balance = clamp100(score.balance);
  } else {
    balance = clamp100(score);
  }
  const tol = clamp(tolerance, 0, FULL_SCALE);
  return balance >= (FULL_SCALE - tol);
}

/**
 * tier(score) → label from DHARMA_TIERS.
 *
 * Accepts a number (0..100) OR a dharmaScore() result object (its `.balance` is used as the headline
 * score). Returns the label of the first (highest) band whose `min` the score meets/exceeds.
 *
 * Soft-fail: malformed / negative / NaN score coerces to 0 → the lowest band ('Atithi'). Never throws.
 *
 * @param {number|{balance:number}} score
 * @returns {string} tier label
 */
export function tier(score) {
  let s;
  if (score && typeof score === 'object') {
    s = clamp100(score.balance);
  } else {
    s = clamp100(score);
  }
  for (const band of DHARMA_TIERS) {
    if (s >= band.min) return band.label;
  }
  // DHARMA_TIERS always ends at min:0, so this is unreachable in practice — defensive fallback.
  return DHARMA_TIERS[DHARMA_TIERS.length - 1].label;
}
