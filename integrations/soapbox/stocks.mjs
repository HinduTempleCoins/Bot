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

// ── The Stock Index (ranking) ───────────────────────────────────────────────────────────────────
// A real, keyless ranking of a universe of names. Fundamentals (market cap, P/E) require Yahoo's
// crumb-authenticated quoteSummary; the keyless chart endpoint does NOT expose them. So the index is
// a TECHNICAL / momentum composite from price history — the same family of signals a relative-strength
// screen uses. Each component is normalized 0–100 and blended into one composite "index score".
//
// Components (per symbol, from 1y of daily closes + the live quote):
//   momentum    blended trailing return: 1-month, 3-month, 6-month, 12-month (weighted toward recent)
//   trend       price above its 50-day and 200-day moving averages, and 50d above 200d ("golden")
//   position    where price sits in its own 52-week range (1.0 = at the high)
//   stability   inverse of annualized volatility (calmer = higher), capped so it can't dominate
//   liquidity   a light log-scaled volume tilt so thinly-traded names don't top the board
//
// The blend is deliberately momentum-and-trend heavy (that's what a "stock index ranking" connotes),
// with position as a tiebreaker and stability/liquidity as modifiers. Informational, not advice.

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// trailing % return over the last `n` closes (n bars back → now).
function trailingReturn(closes, n) {
  if (closes.length <= n) return null;
  const a = closes[closes.length - 1 - n], b = closes[closes.length - 1];
  return a > 0 ? (b / a - 1) * 100 : null;
}
function sma(closes, n) { return closes.length >= n ? mean(closes.slice(-n)) : null; }
// annualized volatility from daily log returns (%).
function annualVol(closes) {
  if (closes.length < 20) return null;
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 10) return null;
  const m = mean(r), v = mean(r.map((x) => (x - m) ** 2));
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

/** Score ONE symbol into a composite Stock Index score (0–100) + component breakdown. Keyless. */
export async function indexScore(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return null;
  return cached(`stk:idx:${sym}`, TTL.ohlcv, async () => {
    const [q, hist] = await Promise.all([
      stockQuote(sym).catch(() => null),
      stockChart(sym, '365d').catch(() => []),
    ]);
    const closes = (hist || []).map((d) => d.p).filter((p) => Number.isFinite(p) && p > 0);
    if (!q || closes.length < 30) return null;

    // momentum: blend of trailing returns (≈21/63/126/252 trading days), recent-weighted.
    const r1 = trailingReturn(closes, 21), r3 = trailingReturn(closes, 63), r6 = trailingReturn(closes, 126), r12 = trailingReturn(closes, 252);
    const parts = [[r1, 0.4], [r3, 0.3], [r6, 0.2], [r12, 0.1]].filter(([v]) => v != null);
    const wsum = parts.reduce((s, [, w]) => s + w, 0) || 1;
    const blendedRet = parts.reduce((s, [v, w]) => s + v * w, 0) / wsum;
    // map a blended return of −30%..+30% onto 0..100.
    const momentum = clamp(50 + blendedRet * (50 / 30));

    // trend: above 50d (+) and 200d (++), with a golden-cross bonus.
    const last = closes[closes.length - 1];
    const ma50 = sma(closes, 50), ma200 = sma(closes, 200);
    let trend = 50;
    if (ma50 != null) trend += last > ma50 ? 12 : -12;
    if (ma200 != null) trend += last > ma200 ? 20 : -20;
    if (ma50 != null && ma200 != null) trend += ma50 > ma200 ? 8 : -8;
    trend = clamp(trend);

    // position in the 52-week range (live quote's bounds preferred, else from the history window).
    const hi = q.fiftyTwoHigh || Math.max(...closes), lo = q.fiftyTwoLow || Math.min(...closes);
    const position = hi > lo ? clamp(((q.price ?? last) - lo) / (hi - lo) * 100) : 50;

    // stability: lower annualized vol = higher score. ~15% vol → ~75; ~60% vol → ~0.
    const vol = annualVol(closes);
    const stability = vol == null ? 50 : clamp(100 - (vol - 12) * (100 / 60));

    // liquidity tilt: log-scaled dollar-ish volume, gentle (0..100, but only ±10 in the blend).
    const liq = q.volume ? clamp((Math.log10(Math.max(1, q.volume)) - 4) * 20) : 50;

    // composite blend — momentum & trend dominate; position tiebreaks; stability/liquidity modify.
    const score = clamp(
      momentum * 0.34 + trend * 0.30 + position * 0.16 + stability * 0.10 + liq * 0.10
    );

    return {
      symbol: sym, name: q.name, price: q.price, change: q.change, currency: q.currency,
      score: Math.round(score * 10) / 10,
      components: {
        momentum: Math.round(momentum), trend: Math.round(trend), position: Math.round(position),
        stability: Math.round(stability), liquidity: Math.round(liq),
      },
      returns: { m1: r1, m3: r3, m6: r6, m12: r12 },
      ma50, ma200, vol: vol == null ? null : Math.round(vol * 10) / 10,
      goldenCross: ma50 != null && ma200 != null ? ma50 > ma200 : null,
    };
  });
}

// The default ranking universe — a broad, liquid large-cap set across sectors. The server can pass
// its own list (e.g. POPULAR) to rank.
export const INDEX_UNIVERSE = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'JPM', 'V',
  'WMT', 'XOM', 'UNH', 'MA', 'JNJ', 'PG', 'HD', 'COST', 'AVGO', 'LLY',
  'ORCL', 'NFLX', 'AMD', 'CRM', 'KO', 'PEP', 'BAC', 'DIS', 'ADBE', 'INTC',
];

// ── Data-quality helpers (mirrors price-oracle.mjs's robust-median confidence) ─────────────────────
// The index ranks a whole universe; a single mis-scored name (corrupt history, a bad split-adjust)
// shouldn't quietly sit on the leaderboard. So we treat the universe of scores like price-oracle
// treats multiple price quotes: take the median, flag rows that sit absurdly far from it, and report
// how much of the universe we could actually score (coverage) as a Clarity-style confidence signal.
const _median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const _mad = (a, med) => { if (!a.length) return 0; return _median(a.map((x) => Math.abs(x - med))); };

/**
 * Assess the data-quality of a freshly-scored universe.
 * - coverage:   how many of the requested symbols we could score (the rest had too-short/missing history).
 * - outliers:   rows whose composite score is a robust-z (MAD) outlier — kept on the board but FLAGGED,
 *               never silently dropped (per "flag, don't edit" — surfacing is the honest move).
 * - confident:  true when we scored a healthy share of the universe AND the spread isn't degenerate.
 * Returns { coverage, requested, scored, median, outliers:[symbol…], confident }.
 */
export function assessIndexQuality(scored, requestedCount) {
  const vals = scored.map((r) => r.score).filter((s) => Number.isFinite(s));
  const requested = requestedCount || scored.length;
  const coverage = requested ? +(scored.length / requested * 100).toFixed(1) : 0;
  if (vals.length < 3) {
    return { coverage, requested, scored: scored.length, median: vals.length ? _median(vals) : null, outliers: [], confident: false };
  }
  const med = _median(vals);
  const mad = _mad(vals, med) || 1e-9;
  // robust z ≈ 0.6745·(x−median)/MAD; |z|>3.5 is the conventional outlier gate.
  const outliers = scored.filter((r) => Math.abs(0.6745 * (r.score - med) / mad) > 3.5).map((r) => r.symbol);
  const confident = coverage >= 60 && vals.length >= 3;
  return { coverage, requested, scored: scored.length, median: +med.toFixed(1), outliers, confident };
}

/**
 * Build the ranked Stock Index over a universe of symbols. Scores each in parallel, drops failures,
 * sorts by composite score desc, and tags each row with its rank. Keyless + cached. Hardened: each
 * row carries a per-symbol `quality` (history coverage + whether the live quote was present), the
 * result carries a universe-level `quality` block (coverage / robust-MAD outliers / confidence), and
 * outlier rows are tagged `outlier:true` rather than dropped.
 * @returns {Promise<{asOf:number, count:number, rows:Array, quality:object}>}
 */
export async function stockIndex({ symbols = INDEX_UNIVERSE, limit = 25 } = {}) {
  const uniq = [...new Set(symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean))];
  const key = `stk:index:${uniq.slice(0, 60).join(',')}:${limit}`;
  return cached(key, TTL.ohlcv, async () => {
    const scored = (await Promise.all(uniq.map((s) => indexScore(s).catch(() => null)))).filter(Boolean);
    scored.sort((a, b) => b.score - a.score);
    const quality = assessIndexQuality(scored, uniq.length);
    const outSet = new Set(quality.outliers);
    const rows = scored.slice(0, limit).map((r, i) => ({ rank: i + 1, outlier: outSet.has(r.symbol), ...r }));
    return { asOf: Date.now(), count: rows.length, requested: uniq.length, rows, quality };
  });
}

// ── Market breadth / advance-decline (operator task #196) ─────────────────────────────────────────
// The "Health of the Market" gauge wants a BREADTH input — how broad the move is, not just where the
// big indices closed. We derive it honestly from the same universe the Stock Index already ranks:
//   advancers / decliners   share of the universe up vs down on the day (advance-decline line input)
//   adRatio                 advancers ÷ decliners (the classic A/D ratio)
//   pctUp                   % of the universe up on the day
//   pctAbove50 / pctAbove200  % trading above their own 50- / 200-day moving average (trend breadth)
//   newHighsShare           % within 2% of their 52-week high (a light new-highs proxy)
// breadthScore is a 0–100 composite of these, labeled by input so the gauge can show its work.
export function breadthScore({ pctUp, pctAbove50, pctAbove200, newHighsShare }) {
  // each sub-input is already a 0..100 share; blend trend-breadth heaviest (it's the durable signal).
  const parts = [[pctUp, 0.3], [pctAbove50, 0.3], [pctAbove200, 0.3], [newHighsShare, 0.1]].filter(([v]) => v != null);
  if (!parts.length) return null;
  const w = parts.reduce((s, [, ww]) => s + ww, 0);
  return Math.round(parts.reduce((s, [v, ww]) => s + v * ww, 0) / w);
}

/**
 * Compute market breadth over a universe by reusing indexScore (which already has each name's
 * day-change, 50/200-day MAs and 52-week position). Keyless + cached; soft-fails to nulls.
 * @returns {Promise<{asOf,universe,scored,advancers,decliners,unchanged,adRatio,pctUp,pctAbove50,pctAbove200,newHighsShare,breadthScore,confident}>}
 */
export async function marketBreadth({ symbols = INDEX_UNIVERSE } = {}) {
  const uniq = [...new Set(symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean))];
  const key = `stk:breadth:${uniq.slice(0, 60).join(',')}`;
  return cached(key, TTL.ohlcv, async () => {
    const rows = (await Promise.all(uniq.map((s) => indexScore(s).catch(() => null)))).filter(Boolean);
    const base = { asOf: Date.now(), universe: uniq.length, scored: rows.length };
    if (!rows.length) return { ...base, advancers: 0, decliners: 0, unchanged: 0, adRatio: null, pctUp: null, pctAbove50: null, pctAbove200: null, newHighsShare: null, breadthScore: null, confident: false };
    let adv = 0, dec = 0, unch = 0, ab50 = 0, n50 = 0, ab200 = 0, n200 = 0, nh = 0;
    for (const r of rows) {
      if (r.change == null) unch++; else if (r.change > 0) adv++; else if (r.change < 0) dec++; else unch++;
      if (r.price != null && r.ma50 != null) { n50++; if (r.price > r.ma50) ab50++; }
      if (r.price != null && r.ma200 != null) { n200++; if (r.price > r.ma200) ab200++; }
      if (r.components && r.components.position != null && r.components.position >= 98) nh++; // ~within 2% of 52w high
    }
    const pct = (a, b) => (b ? +(a / b * 100).toFixed(1) : null);
    const pctUp = pct(adv, adv + dec) ?? null;
    const out = {
      ...base,
      advancers: adv, decliners: dec, unchanged: unch,
      adRatio: dec ? +(adv / dec).toFixed(2) : (adv ? Infinity : null),
      pctUp, pctAbove50: pct(ab50, n50), pctAbove200: pct(ab200, n200),
      newHighsShare: pct(nh, rows.length),
    };
    out.breadthScore = breadthScore(out);
    // confident when we actually scored a healthy share of the universe.
    out.confident = uniq.length ? rows.length / uniq.length >= 0.6 : false;
    return out;
  });
}

if (process.argv[1] && process.argv[1].endsWith('stocks.mjs')) {
  const cmd = process.argv[2] || 'tesla';
  if (cmd === '--index') {
    const idx = await stockIndex({ limit: 15 });
    console.log(`\n  SoapBox Stock Index — top ${idx.count} by composite momentum/trend score`);
    console.log(`  quality: ${idx.quality.scored}/${idx.quality.requested} scored (${idx.quality.coverage}% coverage) · confident ${idx.quality.confident}${idx.quality.outliers.length ? ' · outliers ' + idx.quality.outliers.join(',') : ''}\n`);
    for (const r of idx.rows) console.log(`  ${String(r.rank).padStart(2)}.  ${r.symbol.padEnd(6)} ${String(r.score).padStart(5)}${r.outlier ? '!' : ' '} mom${String(r.components.momentum).padStart(3)} trd${String(r.components.trend).padStart(3)} pos${String(r.components.position).padStart(3)}  ${r.name}`);
    console.log();
  } else if (cmd === '--breadth') {
    const b = await marketBreadth();
    console.log(`\n  Market breadth (${b.scored}/${b.universe} scored) — confident ${b.confident}`);
    console.log(`  advancers ${b.advancers} · decliners ${b.decliners} · A/D ${b.adRatio} · %up ${b.pctUp} · >50dma ${b.pctAbove50}% · >200dma ${b.pctAbove200}% · near-highs ${b.newHighsShare}%`);
    console.log(`  breadthScore: ${b.breadthScore}/100\n`);
  } else {
    console.log('search:', JSON.stringify(await stockSearch(cmd), null, 0));
    const top = (await stockSearch(cmd))[0];
    if (top) { console.log('quote:', JSON.stringify(await stockQuote(top.symbol))); console.log('chart 7d points:', (await stockChart(top.symbol, '7d')).length); console.log('indexScore:', JSON.stringify(await indexScore(top.symbol))); }
  }
}
