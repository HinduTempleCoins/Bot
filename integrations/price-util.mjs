// price-util.mjs — PURE shared price math. No network, no keys, dependency-free.
// The median / outlier-rejection / quote-normalization logic that's currently duplicated across
// price-oracle.mjs (multi-source USD median), soapbox/he-token-metrics + hive-engine-market
// (bid/ask spread, lastPrice coercion), and chains/multichain.mjs (native-price coercion).
//
// This is the CANONICAL core those three should converge on later — it is a NON-BREAKING helper:
// it does not import or change them; sources are passed IN (you fetch, then feed the quotes here).
// robustMedian() matches price-oracle.mjs's behaviour exactly (35% drop band, re-median survivors,
// >=2 sources within 5% = confident) so adoption is a drop-in.
//
//   import { robustMedian, median, normalizeQuote } from './price-util.mjs'
//   robustMedian([100, 101, 99, 1000])  -> { price: 100, kept:[...], dropped:[1000], n:3, ... }
//   robustMedian([{price:100},{usd:101},{value:1000}])  -> normalizes objects, drops the 1000

// numeric coercion that yields null (not 0) on garbage — "missing" reads as null, not a real value.
// (mirrors the local `n()` in price-oracle / he-token-metrics / multichain, but without the >0 gate
// so non-positive values can still be inspected; callers wanting price>0 can filter.)
const finite = (x) => {
  if (x == null || x === '' || typeof x === 'boolean') return null; // +null/+''/+false are 0 — treat as junk
  const v = +x;
  return Number.isFinite(v) ? v : null;
};

/**
 * Pull a usable number out of a quote that may be a bare number or an object from any of the
 * sources we read (coingecko {usd|price}, coincap {priceUsd}, generic {value}). null if unusable.
 * Accepts: number | { price | usd | value | priceUsd | last | lastPrice | amount }
 * @returns {number|null}
 */
export function normalizeQuote(q) {
  if (q == null) return null;
  if (typeof q === 'number') return finite(q);
  if (typeof q === 'string') return finite(q);
  if (typeof q === 'object') {
    // first defined, numeric-coercible field wins (in priority order)
    for (const k of ['price', 'usd', 'priceUsd', 'value', 'last', 'lastPrice', 'amount']) {
      if (q[k] != null) { const v = finite(q[k]); if (v != null) return v; }
    }
  }
  return null;
}

/** Median of an array, ignoring non-finite values. Pure. Returns null on an empty/all-junk input. */
export function median(nums) {
  const s = (Array.isArray(nums) ? nums : []).map(finite).filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Percentage difference of a from b, relative to b: (a-b)/b*100. null if b is 0/unusable. */
export function pctDiff(a, b) {
  const x = finite(a), y = finite(b);
  if (x == null || y == null || y === 0) return null;
  return (x - y) / y * 100;
}

/**
 * Drop values more than `tolPct` away from the median (the outlier rejection from price-oracle:
 * default 35%). Returns the survivors. If everything would be dropped, returns the originals
 * (a single source can't be an "outlier" against itself). Pure; ignores non-finite input.
 * @param {number[]} nums
 * @param {{tolPct?:number}} [opts] tolPct as a percentage (35 = 35%)
 * @returns {number[]}
 */
export function rejectOutliers(nums, { tolPct = 35 } = {}) {
  const vals = (Array.isArray(nums) ? nums : []).map(finite).filter((v) => v != null);
  if (!vals.length) return [];
  const med = median(vals);
  if (med == null || med === 0) return vals;
  const tol = tolPct / 100;
  const kept = vals.filter((v) => Math.abs(v - med) / Math.abs(med) <= tol);
  return kept.length ? kept : vals;
}

/**
 * THE canonical robust price: normalize a heterogeneous set of quotes (numbers OR
 * {price|usd|value|priceUsd|...} objects), reject outliers beyond `tolPct` of the median,
 * and return the median of the survivors plus which inputs were kept vs dropped.
 *
 * Matches price-oracle.mjs's robustMedian: 35% drop band, re-median survivors, confident when
 * >=2 survivors agree within `confidentPct` (5%). spreadPct is the survivor max/min spread.
 *
 * @param {(number|object)[]} quotes
 * @param {{tolPct?:number, confidentPct?:number}} [opts]
 * @returns {{ price:number|null, kept:number[], dropped:number[], n:number, spreadPct:number|null, confident:boolean }}
 */
export function robustMedian(quotes, { tolPct = 35, confidentPct = 5 } = {}) {
  const vals = (Array.isArray(quotes) ? quotes : [])
    .map(normalizeQuote)
    .filter((v) => v != null);
  if (!vals.length) return { price: null, kept: [], dropped: [], n: 0, spreadPct: null, confident: false };

  const kept = rejectOutliers(vals, { tolPct });
  const keptSet = new Set();
  const dropped = [];
  // partition originals against kept (multiset-aware so dup values aren't both swallowed)
  const keptCount = new Map();
  for (const v of kept) keptCount.set(v, (keptCount.get(v) || 0) + 1);
  for (const v of vals) {
    const c = keptCount.get(v) || 0;
    if (c > 0) { keptCount.set(v, c - 1); keptSet.add(v); }
    else dropped.push(v);
  }

  const price = median(kept);
  const spread = (kept.length > 1 && price) ? (Math.max(...kept) - Math.min(...kept)) / price : 0;
  const spreadPct = price ? +(spread * 100).toFixed(2) : null;
  const confident = kept.length >= 2 && spread <= confidentPct / 100;
  return { price, kept, dropped, n: kept.length, spreadPct, confident };
}

/**
 * Optional weighted robust median: if quotes carry a weight (volume/liquidity), the median is the
 * value at which cumulative weight crosses half the total. Outliers are rejected on price first.
 * Accepts: [{ price|usd|value, weight|volume|vol }] (bare numbers get weight 1).
 * @returns {{ price:number|null, kept:Array<{price:number,weight:number}>, dropped:number[], n:number }}
 */
export function weightedMedian(quotes, { tolPct = 35 } = {}) {
  const rows = (Array.isArray(quotes) ? quotes : [])
    .map((q) => {
      const price = normalizeQuote(q);
      if (price == null) return null;
      let weight = 1;
      if (q && typeof q === 'object') {
        for (const k of ['weight', 'volume', 'vol', 'volume24h']) {
          if (q[k] != null) { const w = finite(q[k]); if (w != null && w > 0) { weight = w; break; } }
        }
      }
      return { price, weight };
    })
    .filter(Boolean);
  if (!rows.length) return { price: null, kept: [], dropped: [], n: 0 };

  const keptPrices = new Set(rejectOutliers(rows.map((r) => r.price), { tolPct }));
  const kept = rows.filter((r) => keptPrices.has(r.price));
  const dropped = rows.filter((r) => !keptPrices.has(r.price)).map((r) => r.price);
  const pool = kept.length ? kept : rows;

  const sorted = [...pool].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, r) => s + r.weight, 0);
  let cum = 0, price = sorted[sorted.length - 1].price;
  for (const r of sorted) { cum += r.weight; if (cum >= total / 2) { price = r.price; break; } }
  return { price, kept: pool, dropped, n: pool.length };
}

if (process.argv[1] && process.argv[1].endsWith('price-util.mjs')) {
  const sample = [100, 101, 99, 100.5, 1000]; // last is a 10x outlier
  const r = robustMedian(sample);
  console.log('price-util — shared pure price math (no network)\n' + '─'.repeat(56));
  console.log('input   ', sample.join(', '));
  console.log('median  ', median(sample));
  console.log('robust  ', JSON.stringify(r));
  console.log('mixed   ', JSON.stringify(robustMedian([{ usd: 100 }, { price: 101 }, 99, { value: 1000 }])));
  console.log('weighted', JSON.stringify(weightedMedian([{ price: 100, volume: 5 }, { price: 110, volume: 1 }])));
}
