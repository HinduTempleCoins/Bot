// integrations/parity-target.mjs
// PURE parity-target pricing + sustainable-cap-at-parity calculator.
// No IO, no state, no network, never throws.
//
// Backlog item 4e2b9c6082. The queue talks about two related-but-distinct things:
//   1. a "1:1 HIVE parity MINIMUM" — the price TARGET a token aims to hold; and
//   2. whether "market cap at parity is SUSTAINABLE" — a judgement on supply×parity.
//
// This is DISTINCT from:
//   - market-cap.mjs : generic cap/FDV projection (supply × price), no judgement.
//   - wall-cost.mjs  : cost to push an order book through a price.
// Here we compute the parity TARGET (the higher of current vs parity) and JUDGE
// the cap-at-parity for sustainability against a ceiling.
//
// Caps are in the QUOTE unit (HIVE on Hive-Engine style markets) unless converted
// to USD via a quoteUsd rate. parityPrice defaults to 1.0 (literal 1:1 parity).

// --- internal: coerce to a finite number, else 0 (soft-fail) ---
function num0(x) {
  if (x === null || x === undefined || x === '') return 0;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The parity TARGET price: never below parity, never below current.
 * gapPct is how far current sits below the target, as a percentage of target
 * (0 when already at/above parity; divide-by-zero guarded).
 * @param {{currentPrice?:number, parityPrice?:number}} [opts]
 * @returns {{target:number, atOrAbove:boolean, gapPct:number}}
 */
export function parityTarget({ currentPrice, parityPrice = 1.0 } = {}) {
  const cur = num0(currentPrice);
  const par = num0(parityPrice);
  const target = Math.max(cur, par);
  const atOrAbove = cur >= par;
  const gapPct = target > 0 ? ((target - cur) / target) * 100 : 0;
  return { target, atOrAbove, gapPct };
}

/**
 * Market cap if the token held parity: supply × parityPrice, in quote and USD.
 * @param {{supply?:number, parityPrice?:number, quoteUsd?:number}} [opts]
 * @returns {{capQuote:number, capUsd:number}}
 */
export function capAtParity({ supply, parityPrice = 1.0, quoteUsd = 1 } = {}) {
  const s = num0(supply);
  const par = num0(parityPrice);
  const q = num0(quoteUsd);
  const capQuote = s * par;
  return { capQuote, capUsd: capQuote * q };
}

/**
 * Judge whether the cap-at-parity is sustainable against a USD ceiling.
 * ratio = capUsd / maxSustainableUsd. Labels:
 *   <= 1.0  -> 'sustainable'
 *   <= 1.5  -> 'stretched'
 *   >  1.5  -> 'overvalued'
 * Soft-fail: missing/NaN inputs coerce to 0 -> {sustainable:false}. A zero or
 * non-positive ceiling can't be met by any positive cap -> not sustainable.
 * @param {{supply?:number, parityPrice?:number, quoteUsd?:number, maxSustainableUsd?:number}} [opts]
 * @returns {{capUsd:number, sustainable:boolean, ratio:number, label:'sustainable'|'stretched'|'overvalued'}}
 */
export function sustainabilityVerdict({
  supply,
  parityPrice = 1.0,
  quoteUsd = 1,
  maxSustainableUsd = 1_000_000,
} = {}) {
  const { capUsd } = capAtParity({ supply, parityPrice, quoteUsd });
  const ceiling = num0(maxSustainableUsd);
  // Soft-fail: a non-positive cap means missing/NaN inputs (no real token to
  // judge). Per spec, coerced-to-0 inputs return {sustainable:false}.
  if (capUsd <= 0) {
    return { capUsd: 0, sustainable: false, ratio: 0, label: 'overvalued' };
  }
  // No usable ceiling: a positive cap can't be confirmed sustainable.
  if (ceiling <= 0) {
    return { capUsd, sustainable: false, ratio: Infinity, label: 'overvalued' };
  }
  const ratio = capUsd / ceiling;
  let label;
  if (ratio <= 1.0) label = 'sustainable';
  else if (ratio <= 1.5) label = 'stretched';
  else label = 'overvalued';
  return { capUsd, sustainable: ratio <= 1.0, ratio, label };
}

/**
 * Rank a list of tokens by their cap-at-parity, ascending (smallest first).
 * Each token: {symbol, supply, parityPrice?, quoteUsd?, maxSustainableUsd?}.
 * Soft-fail: non-array or empty -> []; bad entries coerce to 0.
 * @param {Array} list
 * @returns {Array<{symbol:string, capUsd:number, sustainable:boolean}>}
 */
export function compareTokens(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => {
      const tok = t && typeof t === 'object' ? t : {};
      const v = sustainabilityVerdict(tok);
      return {
        symbol: String(tok.symbol ?? ''),
        capUsd: v.capUsd,
        sustainable: v.sustainable,
      };
    })
    .sort((a, b) => a.capUsd - b.capUsd);
}

/**
 * Compact human formatting: '$1.9M' or '1.9M HIVE'.
 * Soft-fail: bad input coerces to 0. Negative values keep the sign.
 * @param {number} n
 * @param {{usd?:boolean}} [opts]
 * @returns {string}
 */
export function format(n, { usd = false } = {}) {
  const v = num0(n);
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

/**
 * One-line summary of a sustainability verdict.
 * @param {{capUsd:number, sustainable:boolean, ratio:number, label:string}} v
 * @returns {string}
 */
export function renderLine(v) {
  const ver = v && typeof v === 'object' ? v : {};
  const cap = format(ver.capUsd, { usd: true });
  const label = String(ver.label ?? 'overvalued');
  const ratio = num0(ver.ratio);
  const mark = ver.sustainable ? 'OK' : 'OVER';
  return `[${mark}] cap-at-parity ${cap} — ${label} (${ratio.toFixed(2)}x)`;
}
