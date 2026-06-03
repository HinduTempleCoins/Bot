// vehicle-value.mjs — SoapBox "derive-your-own" vehicle fair-market value index (queue task #117).
// The SoapBox-native move: instead of licensing a black-box book value (KBB/Edmunds), we COMPUTE our
// own value range from aggregated real listings. The pricing math is pure and inspectable — median
// with IQR-based outlier trimming — so anyone can see how the number was made.
//
// Listings come from a marketplace API (MarketCheck or VinAudit). Both are key-gated: with no key in
// the env the reader soft-fails to [] and valueByVin() returns a null-but-shaped result — never throws,
// just like macro.mjs. The valuation functions (fairMarketRange / mileageAdjust / conditionAdjust) are
// PURE and work on injected listings, so the offline tests exercise the math with no network at all.
//
// Same shape as macro.mjs: ESM, __setFetch hook, soft-fail (never throw), guarded CLI block.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// --- pure helpers -----------------------------------------------------------------------------------

// pull a finite, positive price out of a listing object regardless of which field the source used.
function priceOf(l) {
  if (l == null) return null;
  const raw = typeof l === 'number' ? l : (l.price ?? l.list_price ?? l.listing_price ?? l.amount);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// sorted-array percentile (linear interpolation between the two nearest ranks). xs must be sorted asc.
function percentile(xs, p) {
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/**
 * fairMarketRange(listings) → { low, median, high, n, source, fetched_at, confidence }
 *
 * Pure. Extracts prices from the listings, trims statistical outliers using the 1.5×IQR fence
 * (the standard Tukey rule), then reports:
 *   - median : the 50th percentile of the trimmed set (the headline "fair" value)
 *   - low    : the 25th percentile (Q1) of the trimmed set
 *   - high   : the 75th percentile (Q3) of the trimmed set
 *   - n      : count of trimmed (kept) listings
 *   - confidence : 'high' (n>=20) | 'medium' (n>=8) | 'low' (n>=3) | 'insufficient' (n<3)
 * Returns a null-but-shaped object (median/low/high = null) when there isn't enough data — never throws.
 */
export function fairMarketRange(listings, { source = 'aggregated', fetched_at = new Date().toISOString() } = {}) {
  const shaped = (extra) => ({ low: null, median: null, high: null, n: 0, source, fetched_at, confidence: 'insufficient', ...extra });
  if (!Array.isArray(listings)) return shaped();

  const prices = listings.map(priceOf).filter((p) => p != null).sort((a, b) => a - b);
  if (prices.length < 1) return shaped();
  if (prices.length < 4) {
    // too few to compute a meaningful IQR fence — report the raw spread, flag confidence low/insufficient.
    return shaped({
      low: round2(prices[0]), median: round2(percentile(prices, 0.5)), high: round2(prices[prices.length - 1]),
      n: prices.length, confidence: prices.length >= 3 ? 'low' : 'insufficient',
    });
  }

  // Tukey fence on the FULL set, then keep only what's inside it.
  const q1 = percentile(prices, 0.25), q3 = percentile(prices, 0.75), iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr, hiFence = q3 + 1.5 * iqr;
  const kept = prices.filter((p) => p >= loFence && p <= hiFence);
  const set = kept.length ? kept : prices; // never trim everything away

  const n = set.length;
  const confidence = n >= 20 ? 'high' : n >= 8 ? 'medium' : n >= 3 ? 'low' : 'insufficient';
  return shaped({
    low: round2(percentile(set, 0.25)),
    median: round2(percentile(set, 0.5)),
    high: round2(percentile(set, 0.75)),
    n, confidence,
  });
}

/**
 * mileageAdjust(value, miles, year) — pure. Adjusts a value for odometer reading relative to an
 * expected baseline of ~12,000 miles/year (the US average). Cars worth less the more they're driven:
 * we apply ~$0.08 of value change per mile of deviation from baseline, then clamp the total swing to
 * ±40% so a wildly off odometer can't drive the number negative or absurdly high. Missing/invalid
 * inputs return the value unchanged.
 */
export function mileageAdjust(value, miles, year, { now = new Date().getFullYear() } = {}) {
  const v = Number(value), mi = Number(miles), yr = Number(year);
  if (!Number.isFinite(v)) return value;
  if (!Number.isFinite(mi) || mi < 0) return round2(v);
  const age = Number.isFinite(yr) ? Math.max(0, now - yr) : 0;
  const expected = (age || 0.5) * 12000; // brand-new (age 0) still gets a small baseline
  const deviation = mi - expected;       // positive = MORE miles than expected → worth less
  let delta = -deviation * 0.08;
  const cap = v * 0.4;
  delta = Math.max(-cap, Math.min(cap, delta));
  return round2(Math.max(0, v + delta));
}

// condition multipliers — the standard book-value tiers. Unknown/missing condition → no change (1.0).
export const CONDITION_FACTORS = {
  excellent: 1.10, 'very good': 1.04, good: 1.00, fair: 0.88, poor: 0.72, salvage: 0.45,
};

/**
 * conditionAdjust(value, condition) — pure. Scales a value by a condition tier. Accepts a string key
 * (case/space-insensitive) or a direct numeric multiplier. Unknown condition → unchanged.
 */
export function conditionAdjust(value, condition) {
  const v = Number(value);
  if (!Number.isFinite(v)) return value;
  let factor = 1;
  if (typeof condition === 'number' && Number.isFinite(condition) && condition > 0) factor = condition;
  else if (typeof condition === 'string') factor = CONDITION_FACTORS[condition.trim().toLowerCase()] ?? 1;
  return round2(v * factor);
}

// --- listings reader (key-gated, soft-fail) ---------------------------------------------------------

// best-effort JSON GET. Returns null on any failure — never throws.
async function getJson(url, headers = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * fetchListings(vin) — pull active marketplace listings for a VIN. Tries MarketCheck first, then
 * VinAudit, depending on which key is present in the env. With NO key set, returns [] (soft-fail) so
 * the rest of the pipeline degrades to "insufficient data" instead of erroring. Never throws.
 * Normalizes each source to { price, miles, year, condition } so fairMarketRange can consume directly.
 */
export async function fetchListings(vin) {
  if (typeof vin !== 'string' || !vin.trim()) return [];
  const v = vin.trim().toUpperCase();

  const mcKey = process.env.MARKETCHECK_KEY;
  if (mcKey) {
    const j = await getJson(`https://mc-api.marketcheck.com/v2/search/car/active?api_key=${encodeURIComponent(mcKey)}&vin=${encodeURIComponent(v)}&rows=50`);
    const rows = Array.isArray(j?.listings) ? j.listings : [];
    const out = rows.map((r) => ({
      price: Number(r?.price) || null,
      miles: Number(r?.miles) || null,
      year: Number(r?.build?.year ?? r?.year) || null,
      condition: r?.inventory_type ?? null,
    })).filter((r) => r.price != null);
    if (out.length) return out;
  }

  const vaKey = process.env.VINAUDIT_KEY;
  if (vaKey) {
    const j = await getJson(`https://marketvalue.vinaudit.com/getmarketvalue.php?key=${encodeURIComponent(vaKey)}&vin=${encodeURIComponent(v)}&format=json`);
    const rows = Array.isArray(j?.listings) ? j.listings : (Array.isArray(j?.prices?.listings) ? j.prices.listings : []);
    const out = rows.map((r) => ({
      price: Number(r?.price ?? r?.listing_price) || null,
      miles: Number(r?.mileage ?? r?.miles) || null,
      year: Number(r?.year) || null,
      condition: r?.condition ?? null,
    })).filter((r) => r.price != null);
    if (out.length) return out;
  }

  return []; // no key, or both sources empty/failed
}

/**
 * valueByVin(vin) — fetch listings for a VIN then compute the fair-market range. Soft-fail: with no
 * key or no data, returns a shaped result with median/low/high = null and confidence 'insufficient'.
 * Cached 60s by VIN. Never throws.
 */
export async function valueByVin(vin) {
  const v = typeof vin === 'string' ? vin.trim().toUpperCase() : '';
  if (!v) return { vin: '', ...fairMarketRange([]) };
  return cached(`vehicle-value:${v}`, TTL.price, async () => {
    const listings = await fetchListings(v).catch(() => []);
    const src = process.env.MARKETCHECK_KEY ? 'marketcheck' : (process.env.VINAUDIT_KEY ? 'vinaudit' : 'none');
    return { vin: v, ...fairMarketRange(listings, { source: src }) };
  });
}

/** Homepage chip: which listing source (if any) is wired, plus the trim/condition factors we apply. */
export function vehicleValueSummary() {
  const haveMc = !!process.env.MARKETCHECK_KEY, haveVa = !!process.env.VINAUDIT_KEY;
  return {
    source: haveMc ? 'marketcheck' : (haveVa ? 'vinaudit' : 'none'),
    available: haveMc || haveVa,
    method: 'median + 1.5×IQR outlier trim, derived from aggregated listings',
    mileageBaselinePerYear: 12000,
    conditionFactors: CONDITION_FACTORS,
  };
}

if (process.argv[1] && process.argv[1].endsWith('vehicle-value.mjs')) {
  const vin = process.argv[2];
  if (vin) {
    const r = await valueByVin(vin);
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(JSON.stringify(vehicleValueSummary(), null, 2));
    // demo the pure math on a synthetic listing set
    const demo = [18000, 18500, 19000, 19200, 19500, 20000, 21000, 60000];
    console.log('\nDemo range from', demo.length, 'listings (one outlier):');
    console.log(fairMarketRange(demo));
  }
}
