/**
 * proof-of-burn.mjs — pure Proof-of-Burn mining reward math.
 *
 * The public-safe, well-scoped slice of the "fix the Burn Mining contract"
 * itinerary block. No Solidity, no deploy, no chain calls — just the deterministic
 * arithmetic of how a miner's burn translates into a share of a per-period reward.
 *
 * Conceptually: a Proof-of-Burn miner provably destroys tokens to earn the right
 * to a share of newly emitted rewards, proportional to their burn weight relative
 * to the total burn weight in the same period. Some PoB designs decay older burns
 * over time so a one-time burn does not earn forever; the old contract got that
 * time-decay wrong (it could go negative / NaN and let stale burns dominate).
 * Here decay is explicit, monotone-non-increasing, and never NaN/negative.
 *
 * This is distinct from burn-model.mjs, which models supply-side deflation (how
 * many tokens remain after burns); this module models the *miner reward share*.
 *
 * Soft-fail discipline (per spec): bad / negative / missing / non-finite inputs
 * coerce to 0 (or a sensible neutral). Nothing throws. No fetch, no I/O, no LLM.
 */

/**
 * esc(s) — minimal HTML escaper for any display interpolation.
 * Coerces non-strings to string first; never throws.
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Coerce x to a finite number >= 0; anything else (NaN/Inf/neg/bool/missing) -> 0. */
function nn(x) {
  if (typeof x === 'boolean') return 0;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Coerce x to a finite integer >= 0; anything else -> 0. */
function nnInt(x) {
  return Math.floor(nn(x));
}

/**
 * burnWeight({ amount, decayHalfLifeBlocks, ageBlocks }) -> number
 *
 * Effective burn weight after optional time-decay.
 *
 *   weight = amount * 2 ^ ( -ageBlocks / halfLife )
 *
 * - `amount` is the burned amount (>= 0; coerced).
 * - `ageBlocks` is how many blocks ago the burn happened (>= 0; coerced).
 * - `decayHalfLifeBlocks` is the half-life in blocks. If omitted, <= 0, or
 *   non-finite, decay is DISABLED and the full amount is returned (no decay).
 *
 * The decay factor is in (0, 1]: it is 1 at age 0 and strictly decreasing in
 * age, never negative, never NaN, never > the original amount. This is the
 * fixed, monotone form of the time-based behavior the old contract botched.
 */
export function burnWeight({ amount, decayHalfLifeBlocks, ageBlocks } = {}) {
  const amt = nn(amount);
  if (amt === 0) return 0;

  const half = nn(decayHalfLifeBlocks);
  const age = nn(ageBlocks);

  // No (or invalid) half-life => no decay.
  if (half <= 0) return amt;
  // No age => no decay.
  if (age === 0) return amt;

  const factor = Math.pow(2, -age / half); // in (0, 1]
  // Defensive: factor is mathematically in (0,1], but clamp anyway.
  const safe = Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 0;
  return amt * safe;
}

/**
 * minerShare({ yourBurnWeight, totalBurnWeight }) -> number in [0, 1]
 *
 * Fraction of the period reward this miner is entitled to. Clamped to [0,1].
 * Returns 0 when totalBurnWeight <= 0 (no burns => no shares to divide).
 * Your weight is clamped to never exceed the total (share never > 1).
 */
export function minerShare({ yourBurnWeight, totalBurnWeight } = {}) {
  const total = nn(totalBurnWeight);
  if (total <= 0) return 0;
  const yours = Math.min(nn(yourBurnWeight), total);
  const share = yours / total;
  if (!Number.isFinite(share)) return 0;
  return Math.min(1, Math.max(0, share));
}

/**
 * rewardFor({ yourBurnWeight, totalBurnWeight, rewardPerPeriod }) -> number
 *
 * Tokens this miner earns for a single period: share * rewardPerPeriod.
 * Soft-fails to 0 on bad/missing inputs.
 */
export function rewardFor({ yourBurnWeight, totalBurnWeight, rewardPerPeriod } = {}) {
  const reward = nn(rewardPerPeriod);
  if (reward === 0) return 0;
  const share = minerShare({ yourBurnWeight, totalBurnWeight });
  const out = share * reward;
  return Number.isFinite(out) ? out : 0;
}

/**
 * projectRewards({ yourBurnWeight, totalBurnWeight, rewardPerPeriod, periods })
 *   -> [{ period, payout, runningTotal }]
 *
 * Per-period payouts with a running cumulative total, for `periods` periods
 * (coerced to an integer >= 0). With constant inputs the payout is constant
 * each period; the array is still produced so callers can render a schedule.
 * Returns [] when periods <= 0. Never throws.
 */
export function projectRewards({ yourBurnWeight, totalBurnWeight, rewardPerPeriod, periods } = {}) {
  const n = nnInt(periods);
  if (n === 0) return [];
  const payout = rewardFor({ yourBurnWeight, totalBurnWeight, rewardPerPeriod });
  const out = [];
  let running = 0;
  for (let i = 1; i <= n; i++) {
    running += payout;
    out.push({ period: i, payout, runningTotal: running });
  }
  return out;
}

/**
 * hashrateEquivalent(burnWeight, unitsPerWeight = 1) -> number
 *
 * Nominal "virtual hashrate" for display: a PoB miner has no real hashrate, so
 * we present their burn weight as an equivalent hashrate at `unitsPerWeight`
 * virtual hashes per unit of weight. Soft-fails to 0. `unitsPerWeight` defaults
 * to 1 and is coerced (bad/missing -> 0, which yields 0 hashrate).
 */
export function hashrateEquivalent(burnWeight, unitsPerWeight = 1) {
  const w = nn(burnWeight);
  const u = unitsPerWeight === undefined ? 1 : nn(unitsPerWeight);
  const out = w * u;
  return Number.isFinite(out) ? out : 0;
}

/**
 * summarize(projection) -> { periods, total, avgPerPeriod }
 *
 * Deterministic plain-object summary of a projectRewards() array (or any array
 * of { payout } / { runningTotal } objects). Non-array or empty input yields
 * { periods: 0, total: 0, avgPerPeriod: 0 }. Never throws.
 */
export function summarize(projection) {
  if (!Array.isArray(projection) || projection.length === 0) {
    return { periods: 0, total: 0, avgPerPeriod: 0 };
  }
  let total = 0;
  for (const row of projection) {
    if (row && typeof row === 'object') total += nn(row.payout);
  }
  const periods = projection.length;
  const avgPerPeriod = periods > 0 ? total / periods : 0;
  return {
    periods,
    total,
    avgPerPeriod: Number.isFinite(avgPerPeriod) ? avgPerPeriod : 0,
  };
}

// No CLI side effects: this is a pure library. Guarded no-op so importing as a
// script does nothing surprising.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // Pure module; nothing to run.
}
