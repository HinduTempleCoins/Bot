// pricing.mjs — the money math for the MELEK ad market. PURE, BigInt, no float, no network.
//
// WHAT THIS IS: the single source of truth for (a) which tokens can pay for ads and their precision,
// (b) how a CPM/CPC rate + a served count → a cost in a token's base units, (c) how a budget → how many
// impressions/clicks it buys, and (d) HONEST inventory — how much real, measured impression stock a
// surface actually has to sell (from the analytics collector, with an audited static fallback). Every
// amount that touches money is a BigInt of the token's smallest unit; decimal token strings are only for
// display and for the on-wire transfer memo. No Number() arithmetic on balances (float loss = lost money).
//
// House style: ESM .mjs, soft-fail-never-throw (bad input → a safe { ok:false } / null, never an throw),
// no I/O here (inventory takes an injected `aggregate` fn so it stays offline-testable).
//
//   import { costOf, unitsAffordable, toBaseUnits, fromBaseUnits, TOKENS, estimateInventory } from './pricing.mjs'

// ── supported payment tokens (OUR currencies only — never fiat, never a third-party token) ─────────────
// precision = decimal places; chain = which settlement rail (payments.mjs builds the matching intent).
//   graphene → a MELEK L1 `transfer` op         (MELEK)
//   engine   → a MELEK L1 `custom_json` tokens.transfer envelope (APIS side-token on MELEK-Engine)
//   evm      → an ERC-20 `transfer(to,amount)` calldata intent   (PRANA / KULA on the PRANA EVM chain)
export const TOKENS = Object.freeze({
  MELEK: { symbol: 'MELEK', precision: 3, chain: 'graphene' },
  APIS: { symbol: 'APIS', precision: 3, chain: 'engine' },
  PRANA: { symbol: 'PRANA', precision: 18, chain: 'evm' },
  KULA: { symbol: 'KULA', precision: 18, chain: 'evm' },
});

/** Is `sym` a supported payment token? */
export function isSupportedToken(sym) {
  return typeof sym === 'string' && Object.prototype.hasOwnProperty.call(TOKENS, sym.toUpperCase());
}

/** The token spec ({symbol, precision, chain}) or null. */
export function tokenSpec(sym) {
  return isSupportedToken(sym) ? TOKENS[String(sym).toUpperCase()] : null;
}

// ── decimal ⇄ base-unit conversion (BigInt; no float) ─────────────────────────────────────────────────

/**
 * toBaseUnits('1.5', 3) → 1500n. Accepts a positive decimal string/number. Returns a BigInt, or null on
 * malformed input / too many decimal places. NEVER throws.
 */
export function toBaseUnits(amount, precision) {
  const p = Number(precision);
  if (!Number.isInteger(p) || p < 0 || p > 30) return null;
  const s = String(amount == null ? '' : amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > p) return null; // more precision than the token supports → reject, don't silently round
  const padded = (frac + '0'.repeat(p)).slice(0, p);
  try { return BigInt(whole) * 10n ** BigInt(p) + BigInt(padded || '0'); }
  catch { return null; }
}

/** fromBaseUnits(1500n, 3) → '1.500'. For display + the transfer amount string. '' on bad input. */
export function fromBaseUnits(base, precision) {
  const p = Number(precision);
  if (!Number.isInteger(p) || p < 0 || p > 30) return '';
  let b;
  try { b = typeof base === 'bigint' ? base : BigInt(String(base).trim()); } catch { return ''; }
  const neg = b < 0n; if (neg) b = -b;
  const div = 10n ** BigInt(p);
  const whole = b / div;
  const frac = (b % div).toString().padStart(p, '0');
  return (neg ? '-' : '') + whole.toString() + (p > 0 ? '.' + frac : '');
}

/** Format a base-unit amount with its token symbol, e.g. amountStr(1500n,'MELEK') → '1.500 MELEK'. */
export function amountStr(base, sym) {
  const spec = tokenSpec(sym);
  if (!spec) return '';
  return `${fromBaseUnits(base, spec.precision)} ${spec.symbol}`;
}

// ── the pricing models ────────────────────────────────────────────────────────────────────────────────
export const MODELS = Object.freeze(['cpm', 'cpc']);
export function isModel(m) { return MODELS.includes(String(m || '').toLowerCase()); }

/** Coerce a value to a non-negative BigInt, or null. */
export function big(v) {
  if (typeof v === 'bigint') return v >= 0n ? v : null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) { try { return BigInt(v.trim()); } catch { return null; } }
  return null;
}

/**
 * costOf({ model, rate, impressions, clicks }) → the cost so far in base units (BigInt), or null.
 *   cpm: rate is the price per 1,000 impressions → cost = rate × impressions / 1000  (floor)
 *   cpc: rate is the price per click            → cost = rate × clicks
 * `rate`, `impressions`, `clicks` are all base-unit / integer counts. Floor division favours the
 * advertiser (never overcharges by a rounding unit). NEVER throws.
 */
export function costOf(o = {}) {
  const { model, rate, impressions = 0, clicks = 0 } = o || {};
  if (!isModel(model)) return null;
  const r = big(rate); if (r == null) return null;
  const imp = big(impressions); const clk = big(clicks);
  if (imp == null || clk == null) return null;
  return String(model).toLowerCase() === 'cpm' ? (r * imp) / 1000n : r * clk;
}

/**
 * unitsAffordable({ model, rate, budget }) → how many billable units a budget buys (BigInt count), or null.
 *   cpm → number of impressions = floor(budget × 1000 / rate)
 *   cpc → number of clicks      = floor(budget / rate)
 */
export function unitsAffordable(o = {}) {
  const { model, rate, budget } = o || {};
  if (!isModel(model)) return null;
  const r = big(rate); const b = big(budget);
  if (r == null || r === 0n || b == null) return null;
  return String(model).toLowerCase() === 'cpm' ? (b * 1000n) / r : b / r;
}

// ── HONEST inventory (never oversell) ──────────────────────────────────────────────────────────────────
//
// Audited real traffic from `.local/incoming/SURFACES_USERS_ANALYTICS.md` (2026-09-22, Caddy logs over a
// ~3-month window). realPageviews is the real-content 200s count over that window; uniqueIps the distinct
// IPs. We sell IMPRESSIONS, so realPageviews (≈ one slot render per page load) is the inventory ceiling.
// These are the honest numbers to quote against — we do NOT invent traffic. A surface not listed here has
// no measured inventory (sell nothing) until the analytics collector shows real pageviews for it.
export const AUDITED_TRAFFIC = Object.freeze({
  // surface            : { realPageviews (per window), uniqueIps, windowDays }
  law: { realPageviews: 26787, uniqueIps: 12947, windowDays: 95 },
  wiki: { realPageviews: 66304, uniqueIps: 7768, windowDays: 95 },
  stocks: { realPageviews: 57635, uniqueIps: 7646, windowDays: 95 },
  credentials: { realPageviews: 16111, uniqueIps: 2648, windowDays: 95 },
  directory: { realPageviews: 15598, uniqueIps: 2099, windowDays: 95 },
  data: { realPageviews: 13539, uniqueIps: 1796, windowDays: 95 },
  hemp: { realPageviews: 5474, uniqueIps: 1516, windowDays: 95 },
  move: { realPageviews: 4503, uniqueIps: 1020, windowDays: 95 },
});

/** The surface name behind a placement key: 'law-top' → 'law', 'stocks-mid' → 'stocks'. */
export function surfaceOf(placement) {
  const s = String(placement || '').toLowerCase();
  const dash = s.indexOf('-');
  return dash === -1 ? s : s.slice(0, dash);
}

/**
 * estimateInventory(placement, opts) → { surface, monthlyImpressions, dailyImpressions, source }.
 * Prefers LIVE measured pageviews from the analytics collector (opts.aggregate — inject
 * `(o)=>aggregate(o)`); falls back to the audited static table; 0 for an unknown surface (sell nothing).
 * Monthly = normalised to 30 days. NEVER throws.
 */
export function estimateInventory(placement, opts = {}) {
  const surface = surfaceOf(placement);
  // 1) live analytics, if an aggregate fn is injected and returns pageviews for this surface's paths.
  try {
    if (typeof opts.aggregate === 'function') {
      const days = Number(opts.days) > 0 ? Number(opts.days) : 30;
      const agg = opts.aggregate({ type: 'pageview' }) || {};
      // match by host prefix OR path prefix — surfaces are hosted as <surface>.soapbox.community.
      let pv = 0;
      for (const [host, c] of agg.topHosts || []) if (String(host).startsWith(surface + '.')) pv += c;
      if (!pv) for (const [path, c] of agg.topPaths || []) if (String(path).startsWith('/' + surface)) pv += c;
      if (pv > 0) {
        const daily = pv / days;
        return { surface, monthlyImpressions: Math.round(daily * 30), dailyImpressions: Math.round(daily), source: 'analytics' };
      }
    }
  } catch { /* fall through to static */ }
  // 2) audited static fallback.
  const t = AUDITED_TRAFFIC[surface];
  if (t) {
    const daily = t.realPageviews / (t.windowDays || 95);
    return { surface, monthlyImpressions: Math.round(daily * 30), dailyImpressions: Math.round(daily), source: 'audited' };
  }
  // 3) unknown surface — no measured inventory.
  return { surface, monthlyImpressions: 0, dailyImpressions: 0, source: 'none' };
}

// ── CLI — offline demo ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('pricing.mjs')) {
  console.log('admarket/pricing — token money math + honest inventory\n' + '─'.repeat(64));
  const rate = toBaseUnits('2.000', 3); // 2 MELEK CPM
  console.log('rate 2.000 MELEK CPM →', rate, 'base units');
  console.log('cost of 5000 impressions (cpm):', amountStr(costOf({ model: 'cpm', rate, impressions: 5000 }), 'MELEK'));
  console.log('impressions a 50 MELEK budget buys:', unitsAffordable({ model: 'cpm', rate, budget: toBaseUnits('50', 3) }).toString());
  for (const s of ['law-top', 'stocks-mid', 'unknown-x']) console.log('inventory', s, '→', JSON.stringify(estimateInventory(s)));
}
