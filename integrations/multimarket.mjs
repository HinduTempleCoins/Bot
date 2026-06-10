// multimarket.mjs — READ-ONLY, confidence-scored quotes for the traditional markets
// (ForEx, precious metals, broad commodities). Keyless. No execution, ever.
//
// The crypto price oracle (price-oracle.mjs) already proved the pattern: instead of trusting one
// feed, pull the same number from several free sources and take an outlier-rejected median, then
// flag "confident" when enough sources agree within a tight band. That reasoning is asset-agnostic —
// a gold price or a EUR/USD rate goes through the exact same math. This module points that machinery
// at non-crypto markets via a small symbol map, so a glitchy/stale feed can't drive a phantom signal.
//
//   import { getMarketQuote, getMultiMarket } from './multimarket.mjs'
//   await getMarketQuote('EUR/USD')   -> { symbol, market, price, unit, confidence, score, sources, spreadPct, quotes }
//   await getMultiMarket(['EUR/USD','XAU/USD','XAG/USD'])
//
// Live sources on the host (all keyless today):
//   - Yahoo Finance chart API  — intraday-ish quote for FX pairs (CCYCCY=X), metal & commodity
//                                 futures (GC=F, SI=F, CL=F, …). Our breadth workhorse, unofficial.
//   - Frankfurter (ECB)        — official daily reference rates for FX. Rock-solid anchor, daily only.
//   - open.er-api.com          — open daily FX feed. Third FX redundancy.
// Freemium spot-metal cross-checks (GoldAPI / MetalpriceAPI, free key → vault) slot in later as
// extra metal sources without touching the confidence math.

import { crypto } from './free-apis.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';

// Injectable fetch so tests stay fully offline (matches the house __setFetch convention).
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const n = (x) => { const v = +x; return Number.isFinite(v) && v > 0 ? v : null; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── confidence math (same discipline as price-oracle.robustMedian + the Clarity band idea) ──
// Drop quotes >35% from the median, re-median the survivors, score confidence by how many sources
// agree within 5%. We add a 0-100 numeric `score` and a named `confidence` band so this reads the
// same way the Clarity Score does: more agreeing/fresh sources = higher score, never a scam claim,
// just "how much can we trust this number right now."
export function scoreQuotes(values) {
  if (!values.length) return { price: 0, sources: 0, spreadPct: null, confident: false, score: 0, confidence: 'none' };
  const med = median(values);
  const kept = values.filter((v) => Math.abs(v - med) / med <= 0.35);
  const keptVals = kept.length ? kept : values;
  const price = median(keptVals);
  const spread = keptVals.length > 1 ? (Math.max(...keptVals) - Math.min(...keptVals)) / price : 0;
  const spreadPct = +(spread * 100).toFixed(2);
  const confident = keptVals.length >= 2 && spread <= 0.05;

  // 0-100 score: agreement (how many sources survived) × tightness (how close they are).
  // 1 source can never exceed "low" — a lone feed is unverifiable by definition.
  let score;
  if (keptVals.length <= 1) {
    score = 25;
  } else {
    const agree = Math.min(keptVals.length, 4) / 4;          // 2→0.5, 3→0.75, 4+→1.0
    const tight = Math.max(0, 1 - spread / 0.05);            // within 5% band → 1..0
    score = Math.round(40 + agree * 35 + tight * 25);        // 2 ok sources floor ~57, full cluster ~100
  }
  score = Math.max(0, Math.min(100, score));
  const confidence = score >= 80 ? 'high' : score >= 55 ? 'moderate' : score >= 30 ? 'limited' : 'low';
  return { price, sources: keptVals.length, spreadPct, confident, score, confidence };
}

// ── symbol map: canonical symbol → which feeds can quote it + how to read each ──
// market: forex | metal | commodity. unit is informational. For FX we cross Yahoo (intraday) with
// the two official-ish daily feeds (Frankfurter/ECB + open.er-api). For metals/commodities Yahoo
// futures is the only keyless live source today, so those read single-source until a freemium spot
// key is added — the math still applies, it just won't reach "confident" on one feed (by design).
export const SYMBOLS = {
  // ── ForEx (rate = how many units of quote currency per 1 unit of base) ──
  'EUR/USD': { market: 'forex', unit: 'USD per EUR', yahoo: 'EURUSD=X', fx: { base: 'EUR', quote: 'USD' } },
  'GBP/USD': { market: 'forex', unit: 'USD per GBP', yahoo: 'GBPUSD=X', fx: { base: 'GBP', quote: 'USD' } },
  'USD/JPY': { market: 'forex', unit: 'JPY per USD', yahoo: 'USDJPY=X', fx: { base: 'USD', quote: 'JPY' } },
  'USD/CHF': { market: 'forex', unit: 'CHF per USD', yahoo: 'USDCHF=X', fx: { base: 'USD', quote: 'CHF' } },
  'AUD/USD': { market: 'forex', unit: 'USD per AUD', yahoo: 'AUDUSD=X', fx: { base: 'AUD', quote: 'USD' } },
  'USD/CAD': { market: 'forex', unit: 'CAD per USD', yahoo: 'USDCAD=X', fx: { base: 'USD', quote: 'CAD' } },
  // ── precious metals (USD per troy ounce; copper per lb) ──
  'XAU/USD': { market: 'metal', unit: 'USD/oz', yahoo: 'GC=F' },   // gold
  'XAG/USD': { market: 'metal', unit: 'USD/oz', yahoo: 'SI=F' },   // silver
  'XPT/USD': { market: 'metal', unit: 'USD/oz', yahoo: 'PL=F' },   // platinum
  'XPD/USD': { market: 'metal', unit: 'USD/oz', yahoo: 'PA=F' },   // palladium
  'COPPER':  { market: 'metal', unit: 'USD/lb', yahoo: 'HG=F' },
  // ── broad commodities (futures reference price + unit) ──
  'WTI':     { market: 'commodity', unit: 'USD/bbl', yahoo: 'CL=F' },
  'BRENT':   { market: 'commodity', unit: 'USD/bbl', yahoo: 'BZ=F' },
  'NATGAS':  { market: 'commodity', unit: 'USD/MMBtu', yahoo: 'NG=F' },
  'WHEAT':   { market: 'commodity', unit: '¢/bu', yahoo: 'ZW=F' },
  'CORN':    { market: 'commodity', unit: '¢/bu', yahoo: 'ZC=F' },
  'COFFEE':  { market: 'commodity', unit: '¢/lb', yahoo: 'KC=F' },
};

// accept a few friendly aliases so callers don't have to know the canonical key.
const ALIASES = {
  GOLD: 'XAU/USD', SILVER: 'XAG/USD', PLATINUM: 'XPT/USD', PALLADIUM: 'XPD/USD',
  EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', USDJPY: 'USD/JPY', OIL: 'WTI', CRUDE: 'WTI',
};
function canonical(symbol) {
  const raw = String(symbol || '').trim().toUpperCase();
  if (SYMBOLS[raw]) return raw;
  const compact = raw.replace(/\s+/g, '');
  return ALIASES[compact] || (SYMBOLS[compact] ? compact : raw);
}

// ── per-source fetchers (each returns a finite positive number or null; never throws) ──
async function yahooQuote(sym) {
  try {
    const r = await _fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`, { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    return n(m?.regularMarketPrice);
  } catch { return null; }
}

// Frankfurter (ECB) FX: rate of `quote` per 1 `base`. USD/JPY → from=USD,to=JPY → rates.JPY.
async function frankfurterFx(base, quote) {
  try {
    const d = await crypto.frankfurter(base, quote);
    return n(d?.rates?.[quote]);
  } catch { return null; }
}

// open.er-api.com daily FX: returns rates relative to a base. base→quote = rates[quote].
async function openErApiFx(base, quote) {
  try {
    const r = await _fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return n(d?.rates?.[quote]);
  } catch { return null; }
}

// gather every quote we can for one canonical symbol
async function gather(spec) {
  const jobs = [];
  if (spec.yahoo) jobs.push(yahooQuote(spec.yahoo).then((p) => ['yahoo', p]));
  if (spec.market === 'forex' && spec.fx) {
    jobs.push(frankfurterFx(spec.fx.base, spec.fx.quote).then((p) => ['frankfurter', p]));
    jobs.push(openErApiFx(spec.fx.base, spec.fx.quote).then((p) => ['open.er-api', p]));
  }
  const settled = await Promise.all(jobs.map((p) => p.catch(() => null)));
  return settled.filter((r) => r && r[1] != null);
}

/**
 * One confidence-scored market quote. Soft-fails to a zeroed/unconfident result on total source
 * failure (never throws). `confidence` is the named band; `score` the 0-100 number; `confident`
 * the same boolean the crypto oracle uses (>=2 sources within 5%).
 */
export async function getMarketQuote(symbol) {
  const key = canonical(symbol);
  const spec = SYMBOLS[key];
  if (!spec) {
    return { symbol: key, market: 'unknown', price: 0, unit: null, confidence: 'none', score: 0, confident: false, sources: 0, spreadPct: null, quotes: {} };
  }
  const quotes = await gather(spec);
  const scored = scoreQuotes(quotes.map((q) => q[1]));
  return {
    symbol: key,
    market: spec.market,
    unit: spec.unit,
    price: scored.price,
    confidence: scored.confidence,
    score: scored.score,
    confident: scored.confident,
    sources: scored.sources,
    spreadPct: scored.spreadPct,
    quotes: Object.fromEntries(quotes),
  };
}

/** Several markets at once (parallel). Each entry is an independent getMarketQuote result. */
export async function getMultiMarket(symbols = ['EUR/USD', 'XAU/USD', 'XAG/USD']) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  return Promise.all(list.map((s) => getMarketQuote(s)));
}

/** The headline first-step read the design brief calls for: EUR/USD + gold + silver. */
export async function firstStepRead() {
  return getMultiMarket(['EUR/USD', 'XAU/USD', 'XAG/USD']);
}

if (process.argv[1] && process.argv[1].endsWith('multimarket.mjs')) {
  const args = process.argv.slice(2);
  const targets = args.length ? args : ['EUR/USD', 'XAU/USD', 'XAG/USD'];
  const rows = await getMultiMarket(targets);
  console.log('Multi-market read (read-only, multi-source confidence-scored)\n' + '─'.repeat(72));
  for (const r of rows) {
    const flag = r.confident ? '✓' : '⚠';
    const srcs = Object.entries(r.quotes).map(([k, v]) => `${esc(k)}:${(+v).toFixed(+v < 10 ? 4 : 2)}`).join(' ');
    console.log(`${flag} ${esc(r.symbol).padEnd(9)} ${String(r.price).padStart(11)} ${esc(r.unit || '').padEnd(12)} ${String(r.score).padStart(3)}/100 ${r.confidence.padEnd(9)} (${r.sources} src, spread ${r.spreadPct}%)  ${srcs}`);
  }
  console.log('\nScore = source agreement × tightness. Low = unverifiable right now, NOT a price claim.');
}
