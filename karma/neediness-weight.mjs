// neediness-weight.mjs — the Neediness Weight multiplier for the SIRING model (BRIEF.md §9).
//
// The Siring model scores the act of a higher-BP account lifting a needier one. The single most
// load-bearing term in that score is the NEEDINESS WEIGHT: a 0..1 multiplier that is HIGH for a
// poor / inactive / dormant / isolated account and LOW for an already-established one. Lifting a
// newcomer counts for more than lifting a whale.
//
// karma/siring-model.mjs already ships a *minimal* needinessWeight that blends BP and an `activity`
// count. THIS module is a richer, STANDALONE helper that blends four independent signals —
// inverse-BP, inverse-activity (post count), dormancy (days since last active), and inverse-reach
// (follower count) — into a single documented weighted average. It is deliberately self-contained
// (its own constants, no imports) so it can be unit-tested in isolation AND fed into siring-model.mjs
// as the `needinessWeight` input without coupling the two files.
//
// PURE MATH: no I/O, no fetch, no network, no disk, no clock. Every export is deterministic and
// soft-fails — any missing / NaN / non-finite field defaults to a NEUTRAL value and nothing throws.

// ── numeric helpers ─────────────────────────────────────────────────────────────
// num: anything → a finite number, else the supplied fallback. (Covers undefined, null, NaN,
// Infinity, strings, objects.) The fallback is the field's documented NEUTRAL value.
const num = (x, fallback = 0) => { const v = Number(x); return Number.isFinite(v) ? v : fallback; };
const clamp01 = (x) => Math.min(1, Math.max(0, num(x)));

// ── exported tuning constants ────────────────────────────────────────────────────
// REFERENCE_BP: BP at/above which the inverse-BP signal bottoms out (account is "established").
export const REFERENCE_BP = 10000;
// REFERENCE_POSTS: post count at/above which the inverse-activity signal bottoms out ("active").
export const REFERENCE_POSTS = 100;
// REFERENCE_DORMANT_DAYS: days since last active at/above which the dormancy signal tops out
// (fully dormant). 0 days = freshly active = no dormancy.
export const REFERENCE_DORMANT_DAYS = 30;
// REFERENCE_FOLLOWERS: follower count at/above which the inverse-reach signal bottoms out
// ("well-connected").
export const REFERENCE_FOLLOWERS = 500;

// WEIGHTS: the documented blend. Each sub-signal is itself a 0..1 neediness value; the final
// weight is their WEIGHTED AVERAGE. Weights sum to 1 so the result is always in [0,1]. BP is the
// dominant signal (resources matter most), then activity, then dormancy, then reach.
export const WEIGHTS = Object.freeze({
  inverseBP: 0.4,        // poor account → high
  inverseActivity: 0.25, // few posts → high
  dormancy: 0.2,         // long since active → high
  inverseReach: 0.15,    // few followers → high
});

// THRESHOLDS: classify a weight into a need BAND. weight >= high → 'high'; >= medium → 'medium';
// else 'low'. Boundaries are inclusive on the lower edge of each band.
export const THRESHOLDS = Object.freeze({
  high: 0.66,
  medium: 0.33,
});

/**
 * needinessWeight({bp, postCount, lastActiveDaysAgo, followerCount}) → number in [0,1].
 *
 * Computes the Neediness Weight as a weighted average of four sub-signals, each normalised to 0..1:
 *
 *   inverseBP       = 1 - clamp01(bp / REFERENCE_BP)                    (BP 0 → 1, BP>=ref → 0)
 *   inverseActivity = 1 - clamp01(postCount / REFERENCE_POSTS)         (0 posts → 1, >=ref → 0)
 *   dormancy        = clamp01(lastActiveDaysAgo / REFERENCE_DORMANT_DAYS) (0 days → 0, >=ref → 1)
 *   inverseReach    = 1 - clamp01(followerCount / REFERENCE_FOLLOWERS) (0 followers → 1, >=ref → 0)
 *
 *   weight = WEIGHTS.inverseBP*inverseBP + WEIGHTS.inverseActivity*inverseActivity
 *          + WEIGHTS.dormancy*dormancy   + WEIGHTS.inverseReach*inverseReach
 *
 * Since the sub-signals are each in [0,1] and the WEIGHTS sum to 1, the result is inherently in
 * [0,1]; it is clamped anyway as a belt-and-braces guard.
 *
 * SOFT-FAIL / NEUTRAL DEFAULTS: a missing or malformed field defaults to a NEUTRAL value (the
 * midpoint of its scale), so an unknown field neither inflates nor deflates the weight:
 *   bp                → REFERENCE_BP/2        (inverseBP        → 0.5)
 *   postCount         → REFERENCE_POSTS/2     (inverseActivity  → 0.5)
 *   lastActiveDaysAgo → REFERENCE_DORMANT_DAYS/2 (dormancy       → 0.5)
 *   followerCount     → REFERENCE_FOLLOWERS/2 (inverseReach     → 0.5)
 * Passing no argument at all therefore yields exactly 0.5. Nothing throws.
 *
 * @param {object} [account]
 * @param {number} [account.bp]                 beneficiary block/behaviour power
 * @param {number} [account.postCount]          how many posts/comments the account has made
 * @param {number} [account.lastActiveDaysAgo]  days since the account was last active
 * @param {number} [account.followerCount]      how many followers the account has
 * @returns {number} weight in [0,1]
 */
export function needinessWeight(account) {
  const a = (account && typeof account === 'object') ? account : {};

  // each field defaults to the NEUTRAL midpoint of its scale when missing / non-finite
  const bp = Math.max(0, num(a.bp, REFERENCE_BP / 2));
  const postCount = Math.max(0, num(a.postCount, REFERENCE_POSTS / 2));
  const lastActiveDaysAgo = Math.max(0, num(a.lastActiveDaysAgo, REFERENCE_DORMANT_DAYS / 2));
  const followerCount = Math.max(0, num(a.followerCount, REFERENCE_FOLLOWERS / 2));

  const inverseBP = 1 - clamp01(bp / (REFERENCE_BP || 1));
  const inverseActivity = 1 - clamp01(postCount / (REFERENCE_POSTS || 1));
  const dormancy = clamp01(lastActiveDaysAgo / (REFERENCE_DORMANT_DAYS || 1));
  const inverseReach = 1 - clamp01(followerCount / (REFERENCE_FOLLOWERS || 1));

  const weight =
    WEIGHTS.inverseBP * inverseBP +
    WEIGHTS.inverseActivity * inverseActivity +
    WEIGHTS.dormancy * dormancy +
    WEIGHTS.inverseReach * inverseReach;

  return clamp01(weight);
}

/**
 * classifyNeed(weight) → 'high' | 'medium' | 'low' against the exported THRESHOLDS.
 *
 *   weight >= THRESHOLDS.high   → 'high'
 *   weight >= THRESHOLDS.medium → 'medium'
 *   else                        → 'low'
 *
 * Soft-fail: a missing / non-finite weight coerces to 0 → 'low'. Out-of-range values are handled by
 * the comparisons (anything >= high is 'high'; anything < medium incl. negatives is 'low').
 *
 * @param {number} weight  typically the output of needinessWeight()
 * @returns {'high'|'medium'|'low'}
 */
export function classifyNeed(weight) {
  const w = num(weight, 0);
  if (w >= THRESHOLDS.high) return 'high';
  if (w >= THRESHOLDS.medium) return 'medium';
  return 'low';
}
