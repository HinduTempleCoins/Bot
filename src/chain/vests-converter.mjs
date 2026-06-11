/**
 * src/chain/vests-converter.mjs — VESTS <-> Mana Power converter (pure DPoS math).
 *
 * PURE math. No network, no chain client, no I/O. Graphene chains hold stake as
 * VESTS internally and display it to humans as a "power" unit (MELEK Power / Hive
 * Power / Steem Power style). The conversion is the standard global-props ratio:
 *
 *     power = vests * (total_vesting_fund_balance / total_vesting_shares)
 *     vests = power / (total_vesting_fund_balance / total_vesting_shares)
 *
 * The caller passes the two global dynamic props — this module never fetches them.
 * Both `totalVestingFund` and `totalVestingShares` may be given as numbers or as
 * Graphene asset strings like "1234.567 MELEK" / "987654321.123456 VESTS"; the
 * leading numeric part is parsed and the symbol ignored.
 *
 * Soft-fail contract: any non-finite / negative / zero shares input yields 0
 * (or "0.000 SYMBOL" for formatPower). Nothing here throws.
 */

// ---- helpers ---------------------------------------------------------------

/** Escape a string for safe HTML interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Coerce a numeric input to a finite Number. Accepts plain numbers and
 * Graphene asset strings ("123.456 MELEK") by reading the leading number.
 * Returns NaN if nothing usable is found.
 */
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string') {
    const m = v.trim().match(/^[-+]?\d*\.?\d+/);
    if (!m) return NaN;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// ---- core API --------------------------------------------------------------

/**
 * ratio(props) -> fund / shares, the per-VEST value of one VEST in power units.
 * Soft-fails to 0 when shares are missing, non-finite, or <= 0, or when fund is
 * non-finite / negative. Never divides by zero, never throws.
 */
export function ratio(props) {
  const p = props || {};
  const fund = toNum(p.totalVestingFund);
  const shares = toNum(p.totalVestingShares);
  if (!Number.isFinite(fund) || fund < 0) return 0;
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  return fund / shares;
}

/**
 * vestsToPower(vests, props) -> power (number).
 * Soft-fails to 0 on bad vests or a zero/invalid ratio.
 */
export function vestsToPower(vests, props) {
  const v = toNum(vests);
  if (!Number.isFinite(v)) return 0;
  const r = ratio(props);
  if (r === 0) return 0;
  const out = v * r;
  return Number.isFinite(out) ? out : 0;
}

/**
 * powerToVests(power, props) -> vests (number).
 * Soft-fails to 0 on bad power or a zero/invalid ratio (guards divide-by-zero).
 */
export function powerToVests(power, props) {
  const pw = toNum(power);
  if (!Number.isFinite(pw)) return 0;
  const r = ratio(props);
  if (r === 0) return 0;
  const out = pw / r;
  return Number.isFinite(out) ? out : 0;
}

/**
 * formatPower(vests, props, { decimals = 3, symbol = 'MP' }) -> string.
 * Converts VESTS to power then renders "<fixed> <symbol>". Soft-fails to
 * "0.000 SYMBOL" (at the requested decimals) on any bad input.
 */
export function formatPower(vests, props, opts = {}) {
  let decimals = Number(opts.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) decimals = 3;
  const symbol = esc(opts.symbol == null ? 'MP' : opts.symbol);
  const power = vestsToPower(vests, props);
  const safe = Number.isFinite(power) ? power : 0;
  return `${safe.toFixed(decimals)} ${symbol}`;
}
