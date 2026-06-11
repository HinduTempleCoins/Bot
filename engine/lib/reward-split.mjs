/**
 * reward-split.mjs — pure author/curator reward-split math for SCOT-style payouts.
 *
 * No chain, no I/O. Given a total payout (in the smallest indivisible unit — an
 * integer count of base units, mirroring decimal.mjs), split it between the
 * author and the curation pool by configurable percentages, then distribute the
 * curation pool across the voters proportional to each vote's weight*stake.
 *
 * Conservation invariant: the parts always sum *exactly* to the input pool.
 * Any rounding remainder accrues to the author on the top-level split, and to
 * the largest curation share (deterministic tie-break by voter name) on the
 * curation distribution. Nothing is created or destroyed.
 *
 * Soft-fail discipline: non-numeric / negative / NaN / Infinity inputs clamp to
 * 0 and the functions never throw. validateSplit() reports configuration
 * problems without throwing so callers can surface them.
 */

/** Coerce x to a finite, non-negative integer; everything else clamps to 0. */
function toCount(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Floor to an integer base-unit count; never negative.
  return Math.floor(n);
}

/** Coerce x to a finite, non-negative number (percentages / weights). */
function toNonNegNumber(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * validateSplit({authorPct, curationPct}) -> {ok, errors}
 * Pure check; never throws. Valid when both are finite, >= 0, and sum to 100.
 */
export function validateSplit({ authorPct = 50, curationPct = 50 } = {}) {
  const errors = [];
  const a = Number(authorPct);
  const c = Number(curationPct);
  if (!Number.isFinite(a) || a < 0) errors.push('authorPct must be a non-negative number');
  if (!Number.isFinite(c) || c < 0) errors.push('curationPct must be a non-negative number');
  if (errors.length === 0 && Math.abs(a + c - 100) > 1e-9) {
    errors.push('authorPct + curationPct must equal 100');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * splitReward(totalPayout, {authorPct=50, curationPct=50}) -> {author, curators}
 *
 * Integer-safe. totalPayout is a base-unit count. The curation pool is computed
 * by flooring (curationPct/100)*total; the author receives the remainder, so the
 * two always sum to the (clamped, integer) total. Bad percentages soft-fall back
 * to the 50/50 default so the function still conserves and never throws.
 */
export function splitReward(totalPayout, { authorPct = 50, curationPct = 50 } = {}) {
  const total = toCount(totalPayout);

  let aPct = toNonNegNumber(authorPct);
  let cPct = toNonNegNumber(curationPct);
  const denom = aPct + cPct;
  // Normalise to a 0..1 curation fraction. If both are 0 (or non-numeric),
  // fall back to an even 50/50 split rather than sending everything one way.
  let cFrac;
  if (denom <= 0) cFrac = 0.5;
  else cFrac = cPct / denom;

  // Floor the curation pool; author absorbs the rounding remainder.
  const curators = Math.floor(total * cFrac);
  const author = total - curators;
  return { author, curators };
}

/**
 * distributeCuration(curatorPool, votes[]) -> [{voter, share}, ...]
 *
 * votes: array of { voter, weight, stake } (weight/stake default to 1, 0).
 * Each voter's claim is weight*stake. The pool is divided proportionally with
 * integer-safe largest-remainder rounding so the shares sum *exactly* to the
 * (clamped, integer) pool. Output order matches input order; the remainder
 * tie-break and the all-zero-weight fallback are deterministic, ordered by
 * voter name (then original index) so the result is reproducible.
 *
 * Soft-fail: a non-array votes, empty votes, or a zero/negative pool yields an
 * empty distribution (or zero shares) and never throws.
 */
export function distributeCuration(curatorPool, votes) {
  const pool = toCount(curatorPool);
  const list = Array.isArray(votes) ? votes : [];

  // Build claim weights, preserving original index for stable output.
  const entries = list.map((v, i) => {
    const voter = v && v.voter != null ? String(v.voter) : '';
    const weight = toNonNegNumber(v && v.weight != null ? v.weight : 1);
    const stake = toNonNegNumber(v && v.stake != null ? v.stake : 0);
    return { voter, claim: weight * stake, i, share: 0 };
  });

  if (entries.length === 0 || pool === 0) {
    return entries.map((e) => ({ voter: e.voter, share: 0 }));
  }

  const totalClaim = entries.reduce((s, e) => s + e.claim, 0);

  if (totalClaim <= 0) {
    // No usable weight: split the pool as evenly as possible, deterministically.
    // Give the +1 remainders to the earliest voters by (name, index).
    const base = Math.floor(pool / entries.length);
    let rem = pool - base * entries.length;
    for (const e of entries) e.share = base;
    const order = [...entries].sort(cmpByName);
    for (let k = 0; k < rem; k++) order[k].share += 1;
    return entries.map((e) => ({ voter: e.voter, share: e.share }));
  }

  // Proportional shares via largest-remainder (Hamilton) apportionment.
  let allocated = 0;
  for (const e of entries) {
    const exact = (pool * e.claim) / totalClaim;
    e.floor = Math.floor(exact);
    e.frac = exact - e.floor;
    e.share = e.floor;
    allocated += e.floor;
  }

  let remainder = pool - allocated; // 0..entries.length-1, integer
  // Distribute the remaining units to the largest fractional parts.
  // Tie-break: larger frac first, then by voter name, then original index —
  // all deterministic.
  const order = [...entries].sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return cmpByName(a, b);
  });
  for (let k = 0; k < remainder; k++) order[k].share += 1;

  return entries.map((e) => ({ voter: e.voter, share: e.share }));
}

/** Deterministic ordering by voter name, then original index. */
function cmpByName(a, b) {
  if (a.voter < b.voter) return -1;
  if (a.voter > b.voter) return 1;
  return a.i - b.i;
}
