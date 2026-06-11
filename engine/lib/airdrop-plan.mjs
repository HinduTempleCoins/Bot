/**
 * airdrop-plan.mjs — pure airdrop allocation calculator.
 *
 * For token-launch itinerary items: from a balance/eligibility snapshot of
 * holders, compute per-recipient airdrop allocations under a selectable
 * scheme. Three schemes:
 *   - 'proportional' : units split in proportion to each holder's weight.
 *   - 'equal'        : every eligible holder gets the same share.
 *   - 'quadratic'    : weight is replaced by its integer square root before
 *                      proportional split (whale-dampening, à la quadratic
 *                      funding). isqrt is exact integer BigInt sqrt.
 *
 * Distinct from its siblings:
 *   - emission-schedule.mjs : steady emission of a single pool over time.
 *   - allocation-plan.mjs   : split a supply into named vesting buckets.
 *   - reward-split.mjs       : split a per-event reward by role weights.
 * This module is the *per-recipient snapshot airdrop* — many accounts, one
 * fixed pool, exact largest-remainder rounding.
 *
 * All math is integer base-unit BigInt math in the spirit of decimal.mjs and
 * emission-schedule.mjs. allocate() floor-divides the pool by each holder's
 * effective weight, then distributes the leftover dust one unit at a time to
 * the holders with the largest fractional remainder (largest-remainder /
 * Hamilton method), so the per-holder units sum to totalAirdrop *exactly*.
 *
 * Soft-fail by construction: an empty/garbage snapshot yields empty
 * allocations and returns the whole pool as undistributed `dust`; NaN /
 * negative / non-finite weights clamp to 0 (and are dropped as ineligible);
 * a missing/unknown scheme falls back to 'proportional'. The module performs
 * no IO and has no chain side effects — it is a calculator, not a mint.
 */

/** Coerce a quantity to a non-negative BigInt count of base units.
 * NaN/negative/non-finite/fractional-noise -> 0n. Accepts BigInt, integer
 * Number, or an all-digits string. */
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

/** Coerce a fraction to a number in [0, 1]; NaN/negative/non-finite -> 0. */
function clampFraction(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/** Exact integer square root of a non-negative BigInt (floor). */
function isqrt(n) {
  if (n < 0n) return 0n;
  if (n < 2n) return n;
  // Newton's method on BigInt.
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

const SCHEMES = new Set(['proportional', 'equal', 'quadratic']);

/**
 * Validate + normalize a holder snapshot.
 *
 *   normalizeSnapshot(holders) -> [{ account, weight: BigInt }]
 *
 * - Each entry must be an object with a non-empty string `account` and a
 *   weight (balance / eligibility score). weight is coerced to a non-negative
 *   BigInt; balance fields are read from `weight`, falling back to `balance`
 *   then `amount`.
 * - Entries with a blank account or a zero/invalid weight are DROPPED (they
 *   are ineligible — there is nothing to allocate to them).
 * - A non-array / empty input yields []. Never throws.
 */
export function normalizeSnapshot(holders) {
  const list = Array.isArray(holders) ? holders : [];
  const out = [];
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const rawAccount = h.account;
    if (typeof rawAccount !== 'string') continue;
    const account = rawAccount.trim();
    if (!account) continue;
    const rawWeight =
      h.weight !== undefined
        ? h.weight
        : h.balance !== undefined
          ? h.balance
          : h.amount;
    const weight = clampBaseUnits(rawWeight);
    if (weight <= 0n) continue; // ineligible: nothing to weight by
    out.push({ account, weight });
  }
  return out;
}

/**
 * Apply a whale cap: no single holder's weight may exceed
 * maxPerHolderFraction of the total weight. Over-cap holders are clamped down
 * to the cap; the total weight is recomputed against the ORIGINAL total so the
 * cap is a stable ceiling (clamping does not chase a moving target).
 *
 *   capWeights(holders, maxPerHolderFraction) -> [{ account, weight: BigInt }]
 *
 * - maxPerHolderFraction in (0, 1]; <= 0 or NaN -> no cap applied (returns the
 *   normalized snapshot unchanged); >= 1 -> no effective cap.
 * - Input is first run through normalizeSnapshot, so this is safe on raw data.
 * - cap = floor(totalWeight * maxPerHolderFraction). A holder above the cap is
 *   set to the cap. Never throws.
 */
export function capWeights(holders, maxPerHolderFraction) {
  const norm = normalizeSnapshot(holders);
  if (norm.length === 0) return [];
  const frac = clampFraction(maxPerHolderFraction);
  if (frac <= 0 || frac >= 1) return norm;

  let total = 0n;
  for (const h of norm) total += h.weight;
  if (total <= 0n) return norm;

  // cap = floor(total * frac). Scale the fraction to integer basis points
  // (4 dp) to keep the multiplication in BigInt.
  const bips = BigInt(Math.round(frac * 10000));
  const cap = (total * bips) / 10000n;
  if (cap <= 0n) return norm;

  return norm.map((h) => ({
    account: h.account,
    weight: h.weight > cap ? cap : h.weight,
  }));
}

/**
 * Compute airdrop allocations for a snapshot under the chosen scheme.
 *
 *   allocate({ holders, totalAirdrop, scheme, minThreshold }) ->
 *     { allocations: [{ account, units: BigInt, pct }], distributed: BigInt,
 *       dust: BigInt, scheme }
 *
 * - holders: raw snapshot (run through normalizeSnapshot here).
 * - totalAirdrop: the pool of base units to distribute (BigInt-coerced).
 * - scheme: 'proportional' | 'equal' | 'quadratic'. Unknown -> 'proportional'.
 * - minThreshold (optional): after rounding, recipients receiving fewer than
 *   this many units are dropped from `allocations`; their units roll into
 *   `dust` (undistributed). 0 / omitted -> no threshold filter.
 *
 * Rounding: each holder's exact share is floored, then leftover units are
 * handed out one-at-a-time to the holders with the largest fractional
 * remainder (largest-remainder / Hamilton method). Ties break by snapshot
 * order. The surviving allocation `units` therefore sum to `distributed`, and
 * `distributed + dust === totalAirdrop` *exactly*.
 *
 * `pct` is a plain Number convenience (share of totalAirdrop, 0..100).
 *
 * Soft-fail: empty/garbage holders -> { allocations: [], distributed: 0n,
 * dust: totalAirdrop }. Never throws, no IO.
 */
export function allocate({ holders, totalAirdrop, scheme, minThreshold } = {}) {
  const pool = clampBaseUnits(totalAirdrop);
  const chosen = SCHEMES.has(scheme) ? scheme : 'proportional';
  const norm = normalizeSnapshot(holders);

  const empty = {
    allocations: [],
    distributed: 0n,
    dust: pool,
    scheme: chosen,
  };
  if (norm.length === 0 || pool <= 0n) return empty;

  // Effective weight per holder under the scheme.
  const effective = norm.map((h) => {
    if (chosen === 'equal') return 1n;
    if (chosen === 'quadratic') return isqrt(h.weight);
    return h.weight; // proportional
  });

  let totalEff = 0n;
  for (const w of effective) totalEff += w;
  // Quadratic isqrt can floor a small weight to 0 (e.g. weight 0 already
  // dropped, but isqrt of >0 weight is >=1, so this only guards degenerate
  // overrides). If everything is zero-weight, fall back to equal split.
  if (totalEff <= 0n) {
    return allocate({ holders, totalAirdrop, scheme: 'equal', minThreshold });
  }

  // Floor share + fractional remainder for largest-remainder rounding.
  const rows = norm.map((h, i) => {
    const w = effective[i];
    const product = pool * w;
    const units = product / totalEff; // floor
    const remainder = product - units * totalEff; // numerator of the fraction
    return { account: h.account, units, remainder, order: i };
  });

  let assigned = 0n;
  for (const r of rows) assigned += r.units;
  let leftover = pool - assigned; // number of single units still to hand out

  if (leftover > 0n) {
    // Largest fractional remainder first, ties by snapshot order.
    const byRemainder = [...rows].sort((a, b) => {
      if (a.remainder > b.remainder) return -1;
      if (a.remainder < b.remainder) return 1;
      return a.order - b.order;
    });
    let i = 0;
    while (leftover > 0n) {
      byRemainder[i % byRemainder.length].units += 1n;
      leftover -= 1n;
      i += 1;
    }
  }

  // minThreshold filter: drop sub-minimum recipients, roll their units to dust.
  const min = clampBaseUnits(minThreshold);
  let distributed = 0n;
  const allocations = [];
  for (const r of rows) {
    if (min > 0n && r.units < min) continue; // dropped as dust
    distributed += r.units;
    allocations.push({ account: r.account, units: r.units });
  }

  // pct convenience (share of the whole pool, never throws on pool>0).
  const poolNum = Number(pool);
  for (const a of allocations) {
    a.pct = poolNum > 0 ? (Number(a.units) / poolNum) * 100 : 0;
  }

  const dust = pool - distributed;
  return { allocations, distributed, dust, scheme: chosen };
}

/**
 * A flat, esc()-safe summary of an airdrop plan for display.
 *
 *   summary(plan) -> { scheme, recipients, distributed: BigInt, dust: BigInt,
 *     allocations: [{ account, units: BigInt, pct }] }
 *
 * `account` is esc()'d so it is safe to interpolate into HTML. `scheme` is
 * also esc()'d. `units`/`distributed`/`dust` are BigInt; `pct` is a Number.
 * A missing/degenerate plan yields a safe empty summary. Never throws.
 */
export function summary(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const list = Array.isArray(p.allocations) ? p.allocations : [];
  const allocations = list.map((a) => {
    const src = a && typeof a === 'object' ? a : {};
    return {
      account: esc(src.account),
      units: clampBaseUnits(src.units),
      pct: Number.isFinite(Number(src.pct)) ? Number(src.pct) : 0,
    };
  });
  return {
    scheme: esc(SCHEMES.has(p.scheme) ? p.scheme : 'proportional'),
    recipients: allocations.length,
    distributed: clampBaseUnits(p.distributed),
    dust: clampBaseUnits(p.dust),
    allocations,
  };
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
