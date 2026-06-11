// integrations/market-cap.mjs
// PURE market-cap / FDV projection helper. No IO, no state, never throws.
//
// Itinerary item 129: "at 1:1 HIVE: $579K and $16.7K market caps".
// market-universe.mjs computes one inline `marketCap: supply * lastPrice` field
// inside a network reader; there is no reusable pure helper. This is that helper.
//
// All caps are expressed in the QUOTE unit (HIVE on Hive-Engine style markets)
// unless converted to USD via a hiveUsd / quoteUsd rate. Everything is supply×price.

// --- internal: coerce to a finite number or null (soft-fail) ---
function num(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Market cap in quote units: circulating supply × price.
 * @returns {number|null} cap in quote units, or null on bad input.
 */
export function marketCap({ supply, price } = {}) {
  const s = num(supply);
  const p = num(price);
  if (s === null || p === null) return null;
  return s * p;
}

/**
 * Fully-diluted valuation: max supply × price.
 * @returns {number|null} FDV in quote units, or null on bad input.
 */
export function fdv({ maxSupply, price } = {}) {
  const m = num(maxSupply);
  const p = num(price);
  if (m === null || p === null) return null;
  return m * p;
}

/**
 * Convert a quote-unit cap to USD given the quote→USD rate.
 * @returns {number|null} cap in USD, or null on bad input.
 */
export function inUsd(capQuote, quoteUsd) {
  const c = num(capQuote);
  const q = num(quoteUsd);
  if (c === null || q === null) return null;
  return c * q;
}

/**
 * Full projection: current + target caps, FDV, and the multiple to the target.
 * `hiveUsd` is the quote(HIVE)→USD rate; omit/NaN it and the *Usd fields are null.
 * @returns {{
 *   currentCapHive:number|null, currentCapUsd:number|null,
 *   targetCapHive:number|null, targetCapUsd:number|null,
 *   fdvAtTargetHive:number|null, fdvAtTargetUsd:number|null,
 *   multipleToTarget:number|null
 * }}
 */
export function project({
  circulatingSupply,
  maxSupply,
  currentPrice,
  targetPrice,
  hiveUsd,
} = {}) {
  const circ = num(circulatingSupply);
  const max = num(maxSupply);
  const cur = num(currentPrice);
  const tgt = num(targetPrice);
  const rate = num(hiveUsd);

  const currentCapHive = circ !== null && cur !== null ? circ * cur : null;
  const targetCapHive = circ !== null && tgt !== null ? circ * tgt : null;
  const fdvAtTargetHive = max !== null && tgt !== null ? max * tgt : null;

  return {
    currentCapHive,
    currentCapUsd: inUsd(currentCapHive, rate),
    targetCapHive,
    targetCapUsd: inUsd(targetCapHive, rate),
    fdvAtTargetHive,
    fdvAtTargetUsd: inUsd(fdvAtTargetHive, rate),
    // multiple is price-only (supply cancels); guard divide-by-zero.
    multipleToTarget:
      cur !== null && tgt !== null && cur !== 0 ? tgt / cur : null,
  };
}

/**
 * Compact human formatting: '$579.0K' or '579.0K HIVE'.
 * Soft-fail: bad input => null. Negative values keep the sign.
 * @param {number} n
 * @param {{usd?:boolean}} [opts]
 * @returns {string|null}
 */
export function format(n, { usd = false } = {}) {
  const v = num(n);
  if (v === null) return null;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);

  let value, suffix;
  if (abs >= 1e12) { value = abs / 1e12; suffix = 'T'; }
  else if (abs >= 1e9) { value = abs / 1e9; suffix = 'B'; }
  else if (abs >= 1e6) { value = abs / 1e6; suffix = 'M'; }
  else if (abs >= 1e3) { value = abs / 1e3; suffix = 'K'; }
  else { value = abs; suffix = ''; }

  const body = `${value.toFixed(1)}${suffix}`;
  return usd ? `${sign}$${body}` : `${sign}${body} HIVE`;
}
