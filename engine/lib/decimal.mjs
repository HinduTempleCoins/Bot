/**
 * decimal.mjs — safe fixed-precision token arithmetic.
 *
 * Security study §6 item 6 ("Integer/precision discipline"): token contracts
 * bleed value when balances are stored as JS floats. We store every quantity
 * internally as a BigInt count of the smallest unit (10^-precision), and only
 * format to a decimal string at the API boundary. No float ever touches a
 * balance.
 *
 * A token has a `precision` (0..8). A quantity string like "1.5" at precision 3
 * is 1500 base units. maxSupply is capped at Number.MAX_SAFE_INTEGER worth of
 * *whole* units to mirror Hive-Engine's ceiling and keep API JSON lossless.
 */

export const MAX_PRECISION = 8;
// Hive-Engine ceiling: maxSupply (whole units) <= Number.MAX_SAFE_INTEGER.
export const MAX_SUPPLY_WHOLE = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991

/** Validate a precision value (integer 0..8). */
export function isValidPrecision(p) {
  return Number.isInteger(p) && p >= 0 && p <= MAX_PRECISION;
}

/**
 * Parse a decimal quantity string into BigInt base units at `precision`.
 * Rejects: non-strings, signs, exponents, NaN, too many decimal places.
 * Returns a BigInt (>= 0n). Throws on malformed input.
 */
export function toBaseUnits(qty, precision) {
  if (!isValidPrecision(precision)) throw new Error(`bad precision ${precision}`);
  if (typeof qty !== 'string') {
    if (typeof qty === 'number' && Number.isInteger(qty)) qty = String(qty);
    else throw new Error('quantity must be a string');
  }
  qty = qty.trim();
  if (!/^\d+(\.\d+)?$/.test(qty)) throw new Error(`malformed quantity "${qty}"`);
  const [whole, frac = ''] = qty.split('.');
  if (frac.length > precision) throw new Error(`quantity "${qty}" exceeds precision ${precision}`);
  const padded = frac.padEnd(precision, '0');
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt(padded || '0');
}

/** Format BigInt base units back to a fixed-precision decimal string. */
export function fromBaseUnits(base, precision) {
  if (!isValidPrecision(precision)) throw new Error(`bad precision ${precision}`);
  if (typeof base !== 'bigint') base = BigInt(base);
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const div = 10n ** BigInt(precision);
  const whole = abs / div;
  const frac = abs % div;
  let out = whole.toString();
  if (precision > 0) out += '.' + frac.toString().padStart(precision, '0');
  return (neg ? '-' : '') + out;
}

/** True if `qty` (string) is strictly > 0 at `precision`. */
export function isPositive(qty, precision) {
  return toBaseUnits(qty, precision) > 0n;
}

/** maxSupply ceiling in base units for a given precision. */
export function maxSupplyBaseUnits(precision) {
  return MAX_SUPPLY_WHOLE * 10n ** BigInt(precision);
}
