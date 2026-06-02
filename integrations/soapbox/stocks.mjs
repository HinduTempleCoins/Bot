// stocks.mjs — the stock-market data layer for SoapBox Data (operator 2026-06-02). Same idea as the
// CoinGecko crypto pages, but for equities/ETFs/indices: search, live quote, and history — all from
// Yahoo Finance's KEYLESS endpoints (v1/finance/search + v8/finance/chart). Independent of CoinGecko,
// so it's also a non-crypto backbone. The /stocks/:symbol page layers in news/research via the scraper.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
const jget = async (url) => { const r = await _fetch(url, { headers: { 'user-agent': UA } }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); };

const TYPE_LABEL = { EQUITY: 'Stock', ETF: 'ETF', INDEX: 'Index', MUTUALFUND: 'Fund', CURRENCY: 'FX', FUTURE: 'Future', CRYPTOCURRENCY: 'Crypto' };

/** Search stocks / ETFs / indices by name or symbol. Keyless. Returns normalized rows. */
export async function stockSearch(q, { limit = 8 } = {}) {
  const query = String(q || '').trim();
  if (query.length < 1) return [];
  return cached(`stk:search:${query.toLowerCase()}:${limit}`, TTL.list, async () => {
    const d = await jget(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${limit}&newsCount=0&listsCount=0`).catch(() => ({}));
    return (d.quotes || [])
      .filter((x) => x.symbol && (x.quoteType !== 'CRYPTOCURRENCY')) // crypto handled by the condenser side
      .slice(0, limit)
      .map((x) => ({
        symbol: x.symbol,
        name: x.shortname || x.longname || x.symbol,
        exchange: x.exchDisp || x.exchange || '',
        type: x.quoteType || 'EQUITY',
        typeLabel: TYPE_LABEL[x.quoteType] || (x.quoteType || '').toLowerCase(),
      }));
  });
}

/** Live quote for one symbol via the keyless chart endpoint's meta block. */
export async function stockQuote(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return null;
  return cached(`stk:q:${sym}`, TTL.price, async () => {
    const d = await jget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`).catch(() => null);
    const m = d?.chart?.result?.[0]?.meta;
    if (!m || m.regularMarketPrice == null) return null;
    const prev = m.chartPreviousClose || m.previousClose;
    return {
      symbol: sym, name: m.longName || m.shortName || sym,
      price: m.regularMarketPrice, currency: m.currency || 'USD',
      change: prev ? (m.regularMarketPrice / prev - 1) * 100 : null,
      exchange: m.fullExchangeName || m.exchangeName || '',
      type: m.instrumentType || 'EQUITY',
      dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow,
      fiftyTwoHigh: m.fiftyTwoWeekHigh, fiftyTwoLow: m.fiftyTwoWeekLow,
      volume: m.regularMarketVolume,
    };
  });
}

// chart range-key → Yahoo {range, interval}. Mirrors the crypto CHART_RANGES so the UI is identical.
const STOCK_RANGE = { '1h': ['1d', '2m'], '1d': ['1d', '5m'], '7d': ['5d', '15m'], '30d': ['1mo', '1h'], '365d': ['1y', '1d'], 'max': ['max', '1wk'] };

/** Price history for a stock range-key (1h|1d|7d|30d|365d|max). {t,p} series, keyless. */
export async function stockChart(symbol, range = '7d') {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return [];
  const [rng, interval] = STOCK_RANGE[range] || STOCK_RANGE['7d'];
  return cached(`stk:chart:${sym}:${range}`, TTL.ohlcv, async () => {
    const d = await jget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${rng}&interval=${interval}`).catch(() => null);
    const res = d?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const close = res?.indicators?.quote?.[0]?.close || [];
    const out = [];
    for (let i = 0; i < ts.length; i++) if (close[i] != null) out.push({ t: ts[i], p: close[i] });
    if (range === '1h' && out.length) { const last = out[out.length - 1].t; const w = out.filter((x) => x.t >= last - 3600); return w.length >= 2 ? w : out.slice(-12); }
    return out;
  });
}

if (process.argv[1] && process.argv[1].endsWith('stocks.mjs')) {
  const q = process.argv[2] || 'tesla';
  console.log('search:', JSON.stringify(await stockSearch(q), null, 0));
  const top = (await stockSearch(q))[0];
  if (top) { console.log('quote:', JSON.stringify(await stockQuote(top.symbol))); console.log('chart 7d points:', (await stockChart(top.symbol, '7d')).length); }
}
