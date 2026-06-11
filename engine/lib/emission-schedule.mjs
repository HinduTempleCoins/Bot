/**
 * emission-schedule.mjs — pure steady-emission / distribution-rate calculator.
 *
 * For steady-distribution token designs in the backlog (e.g. the PUTI
 * "1/min" / "64-year distribution" schedules, ids a12c8fc0cc, bf782c1665).
 * A fixed number of base units is emitted every period; this computes how
 * many units land across an arbitrary time interval, how much supply is
 * left, and how long the schedule runs.
 *
 * All math is integer base-unit math in the spirit of decimal.mjs and
 * lockup-schedule.mjs. Counts are BigInt; the number of whole periods that
 * fall inside [startTs, endTs] is floor((endTs - startTs) / periodSeconds),
 * so a partial trailing period never emits early. Soft-fail by construction:
 * NaN / negative / non-finite / reversed-interval inputs clamp to 0, emission
 * is optionally capped at totalSupply, and nothing ever throws.
 *
 * This is a calculator, not a mint mechanism — it performs no IO and has no
 * chain side effects.
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

/** Coerce a timestamp (seconds) to a finite integer; non-finite -> 0. */
function clampTs(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.floor(v);
}

/**
 * Units emitted across the half-open-ish interval [startTs, endTs], counting
 * only whole periods that complete within the interval.
 *
 *   emittedBetween({ ratePerPeriod, periodSeconds, startTs, endTs, totalSupply }) -> BigInt
 *
 * - emitted = ratePerPeriod * floor((endTs - startTs) / periodSeconds)
 * - endTs < startTs -> 0n
 * - periodSeconds <= 0 -> 0n (no defined cadence)
 * - if totalSupply is provided (> 0), the result is capped so emission never
 *   exceeds totalSupply.
 */
export function emittedBetween({
  ratePerPeriod,
  periodSeconds,
  startTs,
  endTs,
  totalSupply,
} = {}) {
  const rate = clampBaseUnits(ratePerPeriod);
  const period = clampNonNegInt(periodSeconds);
  const start = clampTs(startTs);
  const end = clampTs(endTs);

  if (period <= 0) return 0n;
  if (end <= start) return 0n;

  const periods = BigInt(Math.floor((end - start) / period));
  let emitted = rate * periods;

  // Optional cap: emission can never exceed the configured total supply.
  if (totalSupply !== undefined && totalSupply !== null) {
    const cap = clampBaseUnits(totalSupply);
    if (cap > 0n && emitted > cap) emitted = cap;
  }
  return emitted;
}

/**
 * Non-negative remainder of supply after `emitted` units have gone out.
 *
 *   remainingSupply({ totalSupply, emitted }) -> BigInt
 *
 * Clamps to 0n if emitted >= totalSupply (never negative).
 */
export function remainingSupply({ totalSupply, emitted } = {}) {
  const total = clampBaseUnits(totalSupply);
  const out = clampBaseUnits(emitted);
  const remainder = total - out;
  return remainder < 0n ? 0n : remainder;
}

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60; // 31536000

/**
 * How many years until the whole supply is emitted at the steady rate.
 *
 *   yearsToExhaust({ totalSupply, ratePerPeriod, periodSeconds }) -> number
 *
 * Returns a (possibly fractional) number of years. Returns 0 when there is no
 * supply, and Infinity when the rate or period is non-positive (never drains).
 */
export function yearsToExhaust({
  totalSupply,
  ratePerPeriod,
  periodSeconds,
} = {}) {
  const total = clampBaseUnits(totalSupply);
  const rate = clampBaseUnits(ratePerPeriod);
  const period = clampNonNegInt(periodSeconds);

  if (total <= 0n) return 0;
  if (rate <= 0n || period <= 0) return Infinity;

  // periods needed = ceil(total / rate); seconds = periods * period.
  const periodsNeeded = Number(total) / Number(rate);
  const seconds = periodsNeeded * period;
  return seconds / SECONDS_PER_YEAR;
}

/** Map a period length in seconds to a short human label, when it is a known unit. */
function periodLabel(periodSeconds) {
  const known = {
    1: 'sec',
    60: 'min',
    3600: 'hr',
    86400: 'day',
    604800: 'wk',
    [SECONDS_PER_YEAR]: 'yr',
  };
  return known[periodSeconds] || `${periodSeconds}s`;
}

/**
 * Human-readable rate summary, e.g. '1/min ~= 525600/yr'.
 *
 *   renderRateSummary({ ratePerPeriod, periodSeconds }) -> string
 *
 * Always returns a string (never throws). A non-positive period yields a
 * degenerate but safe summary.
 */
export function renderRateSummary({ ratePerPeriod, periodSeconds } = {}) {
  const rate = clampBaseUnits(ratePerPeriod);
  const period = clampNonNegInt(periodSeconds);
  const label = periodLabel(period);

  if (period <= 0) {
    return `${rate}/${label}`;
  }
  const perYear = (rate * BigInt(SECONDS_PER_YEAR)) / BigInt(period);
  return `${rate}/${label} ~= ${perYear}/yr`;
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
