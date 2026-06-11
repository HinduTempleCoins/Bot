/**
 * vesting-cliff.mjs — cliff + linear-vesting maturity calculator.
 *
 * For the long lock-up token schedules in the backlog (id 6788b3b2be) — e.g.
 * the "Long-term lock-ups (PUCO 900 days)" / "Steady distribution" queues. This
 * is the *maturity-curve* model: a single grant that is fully locked until a
 * cliff, then vests linearly over a vesting window, then is fully unlocked.
 *
 *     unlocked(t) = 0                                   for t <  cliff
 *                 = total * (t - cliff) / vestingDays   for cliff <= t < cliff+vesting
 *                 = total                               for t >= cliff+vesting
 *
 * Distinct from lockup-schedule.mjs: that module exposes an instant cliff
 * (cliffUnlock) and a *separate* linear vest (linearVest) plus a tranche/
 * milestone table. This one fuses cliff-then-linear into one curve and answers
 * point-in-time maturity queries — unlocked-at-time, locked-at-time, the 0..1
 * fraction, and days-until-fully-vested — which the tranche-list module does
 * not provide.
 *
 * All math is integer base-unit math in the spirit of decimal.mjs: `total` is a
 * count of the smallest unit and every result is an exact integer (BigInt). The
 * proportional split floors (vested = floor(total * progress / vestingDays)), so
 * a partial day never over-vests and the rounding remainder stays locked, giving
 * the conservation invariant
 *
 *     lockedAt(args) + vestedAt(args) === clamp(total)   (exactly)
 *
 * Soft-fail by construction: NaN / negative / non-finite / malformed inputs
 * clamp to 0, results clamp to 0..total, vestingDays === 0 means an instant
 * unlock at the cliff (no divide-by-zero), and nothing ever throws. Pure: no IO,
 * no chain side effects.
 */

/** Coerce any input to a non-negative integer; NaN/negative/non-finite -> 0. */
function clampNonNegInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/**
 * Coerce a quantity to a non-negative BigInt count of base units.
 * NaN/negative/non-finite/fractional-noise -> 0n. Accepts BigInt, integer
 * Number, or an all-digits string.
 */
function clampBaseUnits(n) {
  if (typeof n === 'bigint') return n < 0n ? 0n : n;
  if (typeof n === 'string') {
    const s = n.trim();
    if (!/^\d+$/.test(s)) return 0n;
    return BigInt(s);
  }
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0n;
  return BigInt(Math.floor(v));
}

/**
 * Unlocked (vested) amount at `elapsedDays` for a cliff-then-linear grant.
 *
 *   vestedAt({ total, cliffDays, vestingDays, elapsedDays }) -> BigInt
 *
 * 0 before the cliff; linear from the cliff to cliff+vestingDays; the full
 * total at/after cliff+vestingDays. Clamped to 0..total. vestingDays === 0 is
 * an instant unlock at the cliff (no divide-by-zero).
 */
export function vestedAt({ total, cliffDays, vestingDays, elapsedDays } = {}) {
  const t = clampBaseUnits(total);
  const cliff = clampNonNegInt(cliffDays);
  const vesting = clampNonNegInt(vestingDays);
  const elapsed = clampNonNegInt(elapsedDays);

  if (elapsed < cliff) return 0n;
  if (vesting <= 0 || elapsed >= cliff + vesting) return t;
  const progress = BigInt(elapsed - cliff); // 1..vesting-1
  const vested = (t * progress) / BigInt(vesting); // floor toward locked
  return vested < 0n ? 0n : vested > t ? t : vested;
}

/**
 * Locked amount at `elapsedDays` — the complement of vestedAt.
 *
 *   lockedAt(args) -> BigInt   (=== clamp(total) - vestedAt(args), exactly)
 */
export function lockedAt(args = {}) {
  const t = clampBaseUnits(args.total);
  return t - vestedAt(args);
}

/**
 * Fraction unlocked at `elapsedDays`, as a Number in 0..1. Independent of
 * `total` — uses a base scale so it works even when total is 0/unset. 0 before
 * the cliff, 1 at/after full vest, clamped to 0..1. vestingDays === 0 -> 1 at
 * the cliff. Never NaN, never throws.
 */
export function unlockFraction({ cliffDays, vestingDays, elapsedDays } = {}) {
  const cliff = clampNonNegInt(cliffDays);
  const vesting = clampNonNegInt(vestingDays);
  const elapsed = clampNonNegInt(elapsedDays);

  if (elapsed < cliff) return 0;
  if (vesting <= 0 || elapsed >= cliff + vesting) return 1;
  const f = (elapsed - cliff) / vesting;
  if (!Number.isFinite(f) || f <= 0) return 0;
  return f >= 1 ? 1 : f;
}

/**
 * Whole days remaining until the grant is fully vested.
 *
 *   daysUntilFullyVested({ cliffDays, vestingDays, elapsedDays }) -> integer
 *
 * 0 once elapsed >= cliff + vestingDays. Soft-fail to 0 on bad input. Never
 * negative, never throws.
 */
export function daysUntilFullyVested({ cliffDays, vestingDays, elapsedDays } = {}) {
  const cliff = clampNonNegInt(cliffDays);
  const vesting = clampNonNegInt(vestingDays);
  const elapsed = clampNonNegInt(elapsedDays);
  const end = cliff + vesting;
  const remaining = end - elapsed;
  return remaining > 0 ? remaining : 0;
}

/** Escape a string for safe HTML interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ----------------------------------------------------------------------------
 * CLI worked example — PUCO 900-day illustration.
 * Guarded so importing this module never runs it. `node engine/lib/vesting-cliff.mjs`.
 * -------------------------------------------------------------------------- */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // 1,000,000 base units, 90-day cliff, then linear over the remaining window
  // to a 900-day full-maturity horizon ("Long-term lock-ups (PUCO 900 days)").
  const total = 1_000_000;
  const cliffDays = 90;
  const vestingDays = 810; // cliff + vesting = 900-day full maturity
  const horizon = cliffDays + vestingDays;

  console.log('PUCO 900-day lock-up — cliff+linear maturity');
  console.log(`  total=${total} base units, cliff=${cliffDays}d, vesting=${vestingDays}d, full at day ${horizon}`);
  console.log('  day      unlocked      locked   fraction   daysLeft');
  for (const d of [0, 89, 90, 91, 270, 450, 900, 1000]) {
    const u = vestedAt({ total, cliffDays, vestingDays, elapsedDays: d });
    const l = lockedAt({ total, cliffDays, vestingDays, elapsedDays: d });
    const f = unlockFraction({ cliffDays, vestingDays, elapsedDays: d });
    const left = daysUntilFullyVested({ cliffDays, vestingDays, elapsedDays: d });
    console.log(
      `  ${String(d).padStart(4)}  ${String(u).padStart(11)}  ${String(l).padStart(10)}   ${(f * 100).toFixed(2).padStart(7)}%   ${String(left).padStart(8)}`,
    );
  }
}
