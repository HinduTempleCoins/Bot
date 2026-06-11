/**
 * allocation-plan.mjs — pure token allocation + vesting roll-up calculator.
 *
 * For designing a Van Kush SMT / Polygon token launch: split a total supply
 * into named percentage buckets (team / community / treasury / airdrop /
 * liquidity), give each bucket its own cliff + linear vesting (with an optional
 * TGE unlock at the cliff), then roll the whole thing up into a
 * circulating-supply-over-time curve.
 *
 * Distinct from its siblings:
 *   - emission-schedule.mjs : steady 1/min emission of a single pool.
 *   - lockup-schedule.mjs   : a single lock with one cliff + linear release.
 * This module is the *multi-bucket* allocation split plus the aggregation of
 * each bucket's vesting into one circulating total.
 *
 * All math is integer base-unit BigInt math in the spirit of decimal.mjs and
 * emission-schedule.mjs. allocate() floor-divides the total by each bucket's
 * percentage and assigns the leftover remainder to the last bucket, so the
 * per-bucket units always sum to totalSupply *exactly*. Vesting per bucket is
 * computed in BigInt and is monotonic non-decreasing in elapsed time.
 *
 * Soft-fail by construction: NaN / negative / non-finite / out-of-range pct,
 * reversed or zero-length vesting intervals, and missing fields all clamp to a
 * safe zero rather than throwing. The module performs no IO and has no chain
 * side effects — it is a calculator.
 */

const PCT_SCALE = 10000n; // basis points: pct is a percentage (0..100) of supply

/** Coerce any input to a non-negative integer; NaN/negative/non-finite -> 0. */
function clampNonNegInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/** Coerce a percentage to a number in [0, 100]; NaN/negative/non-finite -> 0. */
function clampPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v >= 100) return 100;
  return v;
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

/** Convert a clamped pct (0..100) to integer basis points (0..10000). */
function pctToBips(pct) {
  return BigInt(Math.round(clampPct(pct) * 100));
}

/**
 * Validate + normalize a list of allocation buckets.
 *
 *   normalizeBuckets(buckets) -> { buckets: [{ name, pct, cliffSeconds,
 *     vestingSeconds, tgePct }], pctSum, ok }
 *
 * - Each bucket name is coerced to a non-empty string (falls back to
 *   `bucket{index}`); pct/tgePct are clamped to [0, 100]; cliff/vesting to
 *   non-negative integer seconds.
 * - pctSum is the sum of the clamped percentages. ok is true iff pctSum is
 *   within a tiny epsilon of 100 (a well-formed plan), but a non-100 sum is
 *   still returned, never thrown — the caller decides.
 * - A non-array / empty input yields an empty plan with pctSum 0.
 */
export function normalizeBuckets(buckets) {
  const list = Array.isArray(buckets) ? buckets : [];
  let pctSum = 0;
  const out = list.map((b, i) => {
    const src = b && typeof b === 'object' ? b : {};
    const rawName = src.name;
    const name =
      typeof rawName === 'string' && rawName.trim()
        ? rawName.trim()
        : `bucket${i}`;
    const pct = clampPct(src.pct);
    pctSum += pct;
    return {
      name,
      pct,
      cliffSeconds: clampNonNegInt(src.cliffSeconds),
      vestingSeconds: clampNonNegInt(src.vestingSeconds),
      tgePct: clampPct(src.tgePct),
    };
  });
  // Round pctSum to dodge float noise (e.g. 0.1+0.2).
  pctSum = Math.round(pctSum * 1e6) / 1e6;
  const ok = Math.abs(pctSum - 100) < 1e-6 && out.length > 0;
  return { buckets: out, pctSum, ok };
}

/**
 * Split totalSupply into per-bucket base-unit allocations by percentage.
 *
 *   allocate(totalSupply, buckets) -> [{ name, units: BigInt, pct }]
 *
 * Each bucket gets floor(totalSupply * pctBips / 10000). Any remainder left by
 * the floor divisions is assigned to the LAST bucket, so the per-bucket units
 * sum to totalSupply *exactly*. An empty/degenerate bucket list returns [].
 */
export function allocate(totalSupply, buckets) {
  const total = clampBaseUnits(totalSupply);
  const { buckets: norm } = normalizeBuckets(buckets);
  if (norm.length === 0) return [];

  const out = [];
  let assigned = 0n;
  for (const b of norm) {
    const bips = pctToBips(b.pct);
    const units = (total * bips) / PCT_SCALE; // floor division on BigInt
    assigned += units;
    out.push({ name: b.name, units, pct: b.pct });
  }
  // Remainder (from flooring, and from a pctSum != 100) goes to the last
  // bucket so the split is conservative and sums to exactly totalSupply.
  const remainder = total - assigned;
  if (remainder !== 0n && out.length > 0) {
    const last = out[out.length - 1];
    let u = last.units + remainder;
    if (u < 0n) u = 0n; // never negative (over-allocated pctSum > 100)
    last.units = u;
  }
  return out;
}

/**
 * Units vested from a single bucket after `elapsedSeconds`.
 *
 *   vestedAt({ allocatedUnits, cliffSeconds, vestingSeconds, tgePct },
 *            elapsedSeconds) -> BigInt
 *
 * Semantics:
 *   - elapsed < cliff           -> 0n (nothing released before the cliff)
 *   - elapsed >= cliff          -> a TGE unlock of floor(allocated * tgePct/100)
 *                                  is released at the cliff, then the remainder
 *                                  releases linearly over vestingSeconds.
 *   - elapsed >= cliff+vesting   -> full allocatedUnits.
 *   - vestingSeconds <= 0       -> the whole allocation unlocks at the cliff.
 * Always BigInt, always in [0, allocatedUnits], monotonic in elapsed.
 */
export function vestedAt(bucket, elapsedSeconds) {
  const b = bucket && typeof bucket === 'object' ? bucket : {};
  const allocated = clampBaseUnits(b.allocatedUnits);
  const cliff = clampNonNegInt(b.cliffSeconds);
  const vesting = clampNonNegInt(b.vestingSeconds);
  const elapsed = clampNonNegInt(elapsedSeconds);

  if (allocated <= 0n) return 0n;
  if (elapsed < cliff) return 0n;

  // TGE chunk unlocked at the cliff.
  const tgeBips = pctToBips(b.tgePct);
  let tge = (allocated * tgeBips) / PCT_SCALE;
  if (tge > allocated) tge = allocated;

  // No linear tail (or already past the end): everything is unlocked.
  if (vesting <= 0) return allocated;
  const sinceCliff = elapsed - cliff;
  if (sinceCliff >= vesting) return allocated;

  // Linear release of the post-TGE remainder across the vesting window.
  const remainder = allocated - tge;
  const linear = (remainder * BigInt(sinceCliff)) / BigInt(vesting);
  let vested = tge + linear;
  if (vested > allocated) vested = allocated;
  if (vested < 0n) vested = 0n;
  return vested;
}

/**
 * Roll the whole plan up into a circulating total at `elapsedSeconds`.
 *
 *   circulatingAt(plan, elapsedSeconds) -> { total: BigInt,
 *     perBucket: [{ name, vested: BigInt, allocated: BigInt }] }
 *
 * `plan` is { totalSupply, buckets } (the same shape buildPlan() returns).
 * Allocation is recomputed from totalSupply + buckets so callers can pass a
 * raw spec. A missing/degenerate plan yields { total: 0n, perBucket: [] }.
 */
export function circulatingAt(plan, elapsedSeconds) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const { buckets: norm } = normalizeBuckets(p.buckets);
  const allocations = allocate(p.totalSupply, p.buckets);
  if (allocations.length === 0) return { total: 0n, perBucket: [] };

  let total = 0n;
  const perBucket = allocations.map((a, i) => {
    const cfg = norm[i] || {};
    const vested = vestedAt(
      {
        allocatedUnits: a.units,
        cliffSeconds: cfg.cliffSeconds,
        vestingSeconds: cfg.vestingSeconds,
        tgePct: cfg.tgePct,
      },
      elapsedSeconds,
    );
    total += vested;
    return { name: a.name, vested, allocated: a.units };
  });
  return { total, perBucket };
}

/**
 * A flat, esc()-safe summary of a plan for display.
 *
 *   summary(plan) -> { pctSum, ok, totalSupply: BigInt,
 *     buckets: [{ name, pct, units, cliffSeconds, vestingSeconds, tgePct }] }
 *
 * `name` is esc()'d so it is safe to interpolate into HTML. `units` and
 * `totalSupply` are BigInt; numeric fields are plain numbers. Never throws.
 */
export function summary(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const { buckets: norm, pctSum, ok } = normalizeBuckets(p.buckets);
  const totalSupply = clampBaseUnits(p.totalSupply);
  const allocations = allocate(p.totalSupply, p.buckets);
  const buckets = norm.map((b, i) => ({
    name: esc(b.name),
    pct: b.pct,
    units: allocations[i] ? allocations[i].units : 0n,
    cliffSeconds: b.cliffSeconds,
    vestingSeconds: b.vestingSeconds,
    tgePct: b.tgePct,
  }));
  return { pctSum, ok, totalSupply, buckets };
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
