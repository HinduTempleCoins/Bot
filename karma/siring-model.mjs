// siring-model.mjs — the Witness's SIRING-MODEL merit-score math (BRIEF.md §9, karma dialogue tree).
//
// "Siring" is the act of a higher-BP account lending its weight to bring a newcomer's content forward —
// the Witness, or any established member, voting on / sponsoring an account that has little of its own.
// This module computes a MERIT score for that act: an act that lifts a needy account counts for more
// than the same act aimed at an already-powerful one. It is the rank math by which the Witness decides
// whom to sire next and credits those who sire well.
//
// The formula is stated VERBATIM in the karma dialogue tree:
//
//     score = (usersVoted * bpGained) * needinessWeight
//
//   • usersVoted     — how many distinct accounts the siring act drew in (reach of the lift)
//   • bpGained       — block/"behaviour" power the beneficiary gained from it (effect of the lift)
//   • needinessWeight— a 0..1 multiplier, HIGHER for low-BP / low-activity beneficiaries (whom does
//                       the lift actually help?). A lift aimed at a whale is worth less than the same
//                       lift aimed at a newcomer.
//
// This is DISTINCT from karma/karma.mjs: that module scores an account's own ongoing ACTIVITY against a
// KARMA_WEIGHTS scheme; this module scores a single siring ACT and ranks sires by merit. No overlap.
//
// PURE MATH: no I/O, no fetch, no network, no disk, no clock. Every export is deterministic and
// soft-fails — missing / NaN / non-finite inputs coerce to 0, nothing ever throws.

// ── numeric helpers ─────────────────────────────────────────────────────────────
// num: anything → a finite number, else 0. (Covers undefined, null, NaN, Infinity, strings, objects.)
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, num(x)));

// ── exported constants ──────────────────────────────────────────────────────────
// REFERENCE_BP: the BP level at which a beneficiary is considered "established" — at/above it the
// neediness weight bottoms out at MIN_WEIGHT. Below it the weight rises toward 1 as BP → 0.
export const REFERENCE_BP = 10000;
// MIN_WEIGHT: the floor for needinessWeight. A well-resourced beneficiary still counts a little (>0),
// so siring is never scored as completely worthless.
export const MIN_WEIGHT = 0.1;

/**
 * needinessWeight(beneficiary) → 0..1, HIGHER for low-BP / low-activity accounts.
 *
 *   weight = clamp(1 - beneficiaryBP / REFERENCE_BP, MIN_WEIGHT, 1)
 *
 * A fresh account (BP 0) gets ~1.0; an account at/above REFERENCE_BP gets MIN_WEIGHT. An optional
 * `activity` signal (own posts/comments count) nudges the weight DOWN for already-active accounts,
 * since activity, like BP, is evidence the account needs less of a lift. Soft-fail: a missing /
 * malformed beneficiary is treated as maximally needy (weight 1) — the conservative direction, since
 * an unknown account is more likely a newcomer than a whale, but never below MIN_WEIGHT or above 1.
 *
 * @param {object|number} beneficiary  account-like {bp|beneficiaryBP, activity} OR a raw BP number
 * @returns {number} weight in [MIN_WEIGHT, 1]
 */
export function needinessWeight(beneficiary) {
  let bp, activity;
  if (typeof beneficiary === 'number' || typeof beneficiary === 'string') {
    bp = num(beneficiary);
    activity = 0;
  } else {
    const b = beneficiary || {};
    bp = num(b.beneficiaryBP ?? b.bp ?? b.bpGained ?? 0);
    activity = num(b.activity ?? b.activityCount ?? 0);
  }
  const ref = REFERENCE_BP > 0 ? REFERENCE_BP : 1;
  // base neediness from BP (the verbatim form), then a small activity discount (activity ~ REFERENCE_BP/10).
  const fromBP = 1 - Math.max(0, bp) / ref;
  const activityDiscount = Math.max(0, activity) / (REFERENCE_BP / 10);
  return clamp(fromBP - activityDiscount, MIN_WEIGHT, 1);
}

/**
 * sireScore({usersVoted, bpGained, needinessWeight}) → number, the verbatim formula:
 *
 *     score = (usersVoted * bpGained) * needinessWeight
 *
 * Soft-fail: each input is coerced through num() (missing/NaN/non-finite → 0), so an absent field
 * simply zeroes the term it belongs to and the call never throws. If `needinessWeight` is omitted it
 * defaults to 1 (no weighting) rather than 0, so an un-weighted call still reflects raw reach×effect.
 *
 * @param {object} rec
 * @param {number} [rec.usersVoted]
 * @param {number} [rec.bpGained]
 * @param {number} [rec.needinessWeight]  pass the output of needinessWeight() here
 * @returns {number}
 */
export function sireScore({ usersVoted, bpGained, needinessWeight: w } = {}) {
  const u = num(usersVoted);
  const bp = num(bpGained);
  // default weight to 1 when truly absent (undefined/null); an explicit 0 stays 0.
  const weight = (w === undefined || w === null) ? 1 : num(w);
  return (u * bp) * weight;
}

/**
 * rankSires(records[]) → array of {account, score} sorted DESC by score.
 *
 * Each record may carry an explicit `needinessWeight`, OR a `beneficiary`/`bp`/`activity` from which
 * the weight is derived via needinessWeight(). Non-array / empty / malformed input soft-fails to [].
 * Records with no usable account fall back to a stable empty-string account; scores never throw.
 *
 * @param {Array<object>} records  [{account, usersVoted, bpGained, needinessWeight?|beneficiary?}, ...]
 * @returns {Array<{account:string, score:number}>}
 */
export function rankSires(records) {
  if (!Array.isArray(records)) return [];
  const rows = records.map((r) => {
    const rec = r || {};
    const account = typeof rec.account === 'string' ? rec.account : (rec.account != null ? String(rec.account) : '');
    let weight;
    if (rec.needinessWeight !== undefined && rec.needinessWeight !== null) {
      weight = num(rec.needinessWeight);
    } else if (rec.beneficiary !== undefined || rec.bp !== undefined || rec.activity !== undefined) {
      weight = needinessWeight(rec.beneficiary !== undefined ? rec.beneficiary : rec);
    } else {
      weight = 1; // un-weighted: raw reach×effect
    }
    const score = sireScore({ usersVoted: rec.usersVoted, bpGained: rec.bpGained, needinessWeight: weight });
    return { account, score };
  });
  return rows.sort((a, b) => b.score - a.score);
}
