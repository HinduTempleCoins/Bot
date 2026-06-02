// macro.mjs — traditional-markets data for SoapBox (operator 2026-06-02): metals, US + global stock
// indexes, rates/yields, energy, volatility/currency — "things people need to know before going into
// a market." Source: Yahoo Finance's keyless chart API (one source for all of it). Cached 60s.
// Fed Funds target rate isn't on Yahoo — add FRED (free key) later; the 10Y yield is the live proxy.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// category → [ [yahoo symbol, label, kind] ]. kind: usd|index|pct|fx
export const SYMBOLS = {
  'Metals': [['GC=F', 'Gold', 'usd'], ['SI=F', 'Silver', 'usd'], ['PL=F', 'Platinum', 'usd'], ['PA=F', 'Palladium', 'usd'], ['HG=F', 'Copper', 'usd']],
  'US Indices': [['^DJI', 'Dow Jones', 'index'], ['^GSPC', 'S&P 500', 'index'], ['^IXIC', 'Nasdaq', 'index'], ['^RUT', 'Russell 2000', 'index']],
  'Global Indices': [['^FTSE', 'FTSE 100 (UK)', 'index'], ['^GDAXI', 'DAX (DE)', 'index'], ['^FCHI', 'CAC 40 (FR)', 'index'], ['^N225', 'Nikkei (JP)', 'index'], ['^HSI', 'Hang Seng (HK)', 'index'], ['000001.SS', 'Shanghai (CN)', 'index'], ['^BSESN', 'Sensex (IN)', 'index']],
  'Rates & Bonds': [['^TNX', 'US 10Y Yield', 'pct'], ['^FVX', 'US 5Y Yield', 'pct'], ['^TYX', 'US 30Y Yield', 'pct'], ['^IRX', 'US 13wk (short rate)', 'pct']],
  'Energy': [['CL=F', 'WTI Crude Oil', 'usd'], ['BZ=F', 'Brent Crude', 'usd'], ['NG=F', 'Natural Gas', 'usd']],
  'Risk & Currency': [['^VIX', 'VIX (volatility)', 'index'], ['DX-Y.NYB', 'Dollar Index (DXY)', 'index'], ['EURUSD=X', 'EUR/USD', 'fx'], ['GBPUSD=X', 'GBP/USD', 'fx']],
};

async function quote(symbol) {
  try {
    const r = await _fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    if (!m || m.regularMarketPrice == null) return null;
    const prev = m.chartPreviousClose || m.previousClose;
    return { price: m.regularMarketPrice, change: prev ? (m.regularMarketPrice / prev - 1) * 100 : null, currency: m.currency || 'USD' };
  } catch { return null; }
}

/** Full macro snapshot, all categories. Cached 60s. Symbols that fail are dropped (best-effort). */
export async function macro() {
  return cached('macro:all', TTL.price, async () => {
    const out = {};
    for (const [cat, rows] of Object.entries(SYMBOLS)) {
      const vals = await Promise.all(rows.map(async ([sym, label, kind]) => {
        const q = await quote(sym);
        return q ? { symbol: sym, label, kind, ...q } : null;
      }));
      out[cat] = vals.filter(Boolean);
    }
    return out;
  });
}

/** A few headline numbers for the homepage chip: gold, Dow, 10Y, VIX. */
export async function macroSummary() {
  const m = await macro().catch(() => ({}));
  const find = (cat, label) => (m[cat] || []).find((x) => x.label.startsWith(label));
  return {
    gold: find('Metals', 'Gold'), dow: find('US Indices', 'Dow'),
    tenY: find('Rates & Bonds', 'US 10Y'), vix: find('Risk & Currency', 'VIX'),
  };
}

if (process.argv[1] && process.argv[1].endsWith('macro.mjs')) {
  const m = await macro();
  for (const [cat, rows] of Object.entries(m)) { console.log(`\n${cat}`); for (const r of rows) console.log(`  ${r.label.padEnd(22)} ${r.price}  ${r.change != null ? (r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%' : ''}`); }
}
