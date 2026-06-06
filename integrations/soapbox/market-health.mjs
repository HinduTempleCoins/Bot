// market-health.mjs — "Health of the Market" gauge (operator task #196): the stock-market analog of the
// crypto Fear & Greed index. It blends real, KEYLESS Yahoo-Finance inputs into one composite 0–100
// "market health" score, and — because the operator asked to be able to dial history down — exposes a
// TIME SERIES of that score across windows from 1H all the way to 100Y (Yahoo's ^GSPC history runs to
// 1927, so 50Y/100Y windows reach back through the Great Depression; older-than-data windows just
// return what exists, with the real coverage noted).
//
// Inputs (all from Yahoo's keyless v8/finance/chart):
//   ^GSPC  S&P 500   — the market itself: trend vs its 50/200-day moving averages, and drawdown from peak
//   ^VIX   Volatility— the "fear gauge": high VIX = stress (inverted into the score). VIX exists from 1990.
//   ^TNX   US 10Y    — a macro tilt: a fast spike in long rates is a headwind (it pressures valuations)
//   breadth/momentum — recent S&P momentum (1m & 3m trailing return) as a proxy for participation
//
// The single-point score is the live blend. The SERIES recomputes the price-driven components at each
// historical bar so the gauge can be drawn as a GRAPH (VIX/rates are folded in where their history
// overlaps; before VIX exists we fall back to realized volatility from the index itself).
//
// INFORMATIONAL MARKET DATA — NOT FINANCIAL ADVICE.
//
//   import { healthScore, healthSeries, healthData, renderHealthGauge, renderHealthData } from './market-health.mjs'
//   const h = await healthScore('1Y');           // { score, classification, components, ... }
//   const s = await healthSeries('20Y');         // { timeframe, coverage, points:[{t,score}], ... }
//
// CLI:  node market-health.mjs 20Y

import { cached, TTL } from './cache.mjs';
import { marketBreadth, __setFetch as __setStocksFetch } from './stocks.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
// Setting the fetch here ALSO routes the breadth lookup (which lives in stocks.mjs) through the same
// injected fetch, so offline tests of the gauge get a deterministic breadth component too.
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); __setStocksFetch(fn); }

const SP = '^GSPC';   // S&P 500
const VIX = '^VIX';   // volatility index (from 1990)
const TNX = '^TNX';   // US 10-year treasury yield

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// ── Timeframes ────────────────────────────────────────────────────────────────────────────────────
// Each timeframe → how to ask Yahoo for it. Long windows use period1/period2 with a daily/weekly/monthly
// interval (range=max caps at ~1985 for monthly, so we drive long history off period1 + a 1d/1wk bar
// which reaches 1927). Short windows use range+intraday intervals. years:null = "as far back as data goes".
const YEAR = 365.25 * 24 * 3600;
export const TIMEFRAMES = {
  // Yahoo caps the 1mo interval at ~1985; the 1wk interval reaches ^GSPC's 1927 inception, so the deep
  // windows use weekly bars to actually cover the Depression era.
  '100Y': { label: '100 Years', years: 100, interval: '1wk', bar: 'period' },
  '50Y': { label: '50 Years', years: 50, interval: '1wk', bar: 'period' },
  '40Y': { label: '40 Years', years: 40, interval: '1wk', bar: 'period' },
  '30Y': { label: '30 Years', years: 30, interval: '1wk', bar: 'period' },
  '25Y': { label: '25 Years', years: 25, interval: '1wk', bar: 'period' },
  '20Y': { label: '20 Years', years: 20, interval: '1wk', bar: 'period' },
  '15Y': { label: '15 Years', years: 15, interval: '1wk', bar: 'period' },
  '10Y': { label: '10 Years', years: 10, interval: '1wk', bar: 'period' },
  '5Y': { label: '5 Years', years: 5, interval: '1d', bar: 'range', range: '5y' },
  '1Y': { label: '1 Year', years: 1, interval: '1d', bar: 'range', range: '1y' },
  '1M': { label: '1 Month', years: 1 / 12, interval: '1d', bar: 'range', range: '1mo' },
  '1D': { label: '1 Day', years: 1 / 365, interval: '5m', bar: 'range', range: '1d' },
  '1H': { label: '1 Hour', years: 1 / 8760, interval: '2m', bar: 'range', range: '1d' },
};
export const TIMEFRAME_KEYS = Object.keys(TIMEFRAMES);
const DEFAULT_TF = '1Y';

function normTf(tf) {
  const k = String(tf || '').toUpperCase();
  return TIMEFRAMES[k] ? k : DEFAULT_TF;
}

// Yahoo's earliest ^GSPC datapoint (1927-12-30). Used to report real coverage when a window predates data.
const SP_INCEPTION_MS = Date.parse('1927-12-30T00:00:00Z');

// ── Raw history fetch (keyless) ─────────────────────────────────────────────────────────────────────
// Returns { t:[unix…], c:[close…] } oldest→newest, or {t:[],c:[]} on failure. Never throws.
async function history(symbol, tfKey) {
  const tf = TIMEFRAMES[tfKey];
  let url;
  if (tf.bar === 'period') {
    const p2 = Math.floor(Date.now() / 1000);
    // ask a touch wider than the window so moving-average warmup has lead-in. Yahoo accepts a NEGATIVE
    // period1 (seconds before the 1970 epoch) and will simply clamp to the symbol's inception — so deep
    // windows (50Y/100Y) reach ^GSPC's 1927 start instead of stopping at the unix epoch.
    const p1 = tf.years ? Math.floor(p2 - (tf.years + 1) * YEAR) : -2208988800;
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=${tf.interval}`;
  } else {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${tf.range}&interval=${tf.interval}`;
  }
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) return { t: [], c: [] };
    const res = (await r.json())?.chart?.result?.[0];
    const ts = res?.timestamp || [];
    const close = res?.indicators?.quote?.[0]?.close || [];
    const t = [], c = [];
    for (let i = 0; i < ts.length; i++) if (close[i] != null && Number.isFinite(close[i])) { t.push(ts[i]); c.push(close[i]); }
    return { t, c };
  } catch { return { t: [], c: []  }; }
}

// ── Component scorers (each 0–100, higher = healthier) ──────────────────────────────────────────────
// trend: price vs its own 50- & 200-bar moving averages, with a "golden cross" tilt.
function trendScore(closes, i) {
  const upto = closes.slice(0, i + 1);
  const last = upto[upto.length - 1];
  const ma50 = upto.length >= 50 ? mean(upto.slice(-50)) : null;
  const ma200 = upto.length >= 200 ? mean(upto.slice(-200)) : (upto.length >= 50 ? mean(upto.slice(-Math.min(upto.length, 200))) : null);
  let s = 50;
  if (ma50 != null) s += last > ma50 ? 14 : -14;
  if (ma200 != null) s += last > ma200 ? 22 : -22;
  if (ma50 != null && ma200 != null) s += ma50 > ma200 ? 9 : -9;
  return clamp(s);
}
// momentum: blended trailing return over ~1 & 3 windows (in bars), mapped −20%..+20% → 0..100.
function momentumScore(closes, i, shortN, longN) {
  const ret = (n) => { if (i < n) return null; const a = closes[i - n], b = closes[i]; return a > 0 ? (b / a - 1) * 100 : null; };
  const r1 = ret(shortN), r2 = ret(longN);
  const parts = [[r1, 0.6], [r2, 0.4]].filter(([v]) => v != null);
  if (!parts.length) return 50;
  const w = parts.reduce((s, [, ww]) => s + ww, 0);
  const blended = parts.reduce((s, [v, ww]) => s + v * ww, 0) / w;
  return clamp(50 + blended * (50 / 20));
}
// drawdown-from-peak: 0% off peak → 100; −40%+ off peak → 0. (the "are we in a crash" component.)
function drawdownScore(closes, i) {
  let peak = -Infinity;
  for (let k = 0; k <= i; k++) if (closes[k] > peak) peak = closes[k];
  if (!(peak > 0)) return 50;
  const dd = (closes[i] / peak - 1) * 100; // ≤ 0
  return clamp(100 + dd * (100 / 40)); // dd=−40 → 0, dd=0 → 100
}
// realized volatility from the last ~21 bars of returns → inverted (calm = healthy). Fallback for VIX.
function realizedVolScore(closes, i) {
  const w = closes.slice(Math.max(1, i - 21), i + 1);
  if (w.length < 8) return 50;
  const r = [];
  for (let k = 1; k < w.length; k++) if (w[k - 1] > 0) r.push(Math.log(w[k] / w[k - 1]));
  if (r.length < 5) return 50;
  const m = mean(r), v = mean(r.map((x) => (x - m) ** 2));
  const annual = Math.sqrt(v) * Math.sqrt(252) * 100;
  return clamp(100 - (annual - 12) * (100 / 50)); // ~12% → 100, ~62% → 0
}
// VIX → fear/greed style inversion: VIX 12 → ~90 (calm/greed), VIX 40 → ~10 (fear).
function vixScore(vix) {
  if (vix == null) return null;
  return clamp(100 - (vix - 12) * (90 / 38));
}
// 10Y-yield "shock" tilt: a fast rise in long rates is a headwind. Score the recent change, not the level.
function ratesScore(tnxCloses, i) {
  if (i < 20) return 50;
  const now = tnxCloses[i], past = tnxCloses[i - 20];
  if (now == null || past == null) return 50;
  const chg = now - past;             // change in yield points over ~20 bars
  return clamp(50 - chg * 25);        // +1pt yield jump → −25; −1pt fall → +25
}

// classification bands (mirrors the crypto Fear & Greed vocabulary).
export function classify(score) {
  if (score >= 75) return 'Extreme Greed';
  if (score >= 60) return 'Greed';
  if (score >= 45) return 'Neutral';
  if (score >= 30) return 'Fear';
  return 'Extreme Fear';
}

// Plain-English health band for the gauge label (task #196): healthy / cautious / stressed. A simpler,
// non-trading vocabulary than the Fear/Greed bands above, for the at-a-glance gauge.
export function plainClassify(score) {
  if (score == null || Number.isNaN(score)) return { label: 'no data', tone: 'unknown' };
  if (score >= 60) return { label: 'healthy', tone: 'healthy' };
  if (score >= 40) return { label: 'cautious', tone: 'cautious' };
  return { label: 'stressed', tone: 'stressed' };
}
const PLAIN_COLOR = { healthy: '#3fb950', cautious: '#d29922', stressed: '#f85149', unknown: '#8b949e' };

// ── Historical-depth store (ring buffer, ~365 entries) ───────────────────────────────────────────
// Persists a daily snapshot of the live health score to disk so the page can show how market health
// has trended over the last year — independent of the in-window Yahoo history (which is recomputed,
// not recorded). Bounded to MAX_HISTORY newest entries (a ring buffer). fs is injectable for tests.
const __dir = (() => { try { return path.dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); } })();
const HISTORY_STORE = process.env.MARKET_HEALTH_HISTORY || path.join(__dir, 'data', 'market-health-history.json');
const MAX_HISTORY = 365;

let _fs = fs;
/** Test seam: inject an fs-like impl ({ readFileSync, writeFileSync, mkdirSync }); pass nothing to restore. */
export function __setFs(impl) { _fs = impl || fs; }

function loadHistory() {
  try {
    const raw = JSON.parse(_fs.readFileSync(HISTORY_STORE, 'utf8'));
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.score === 'number') : [];
  } catch { return []; }
}
function saveHistory(arr) {
  try { _fs.mkdirSync(path.dirname(HISTORY_STORE), { recursive: true }); } catch { /* in-memory fs may not need dirs */ }
  _fs.writeFileSync(HISTORY_STORE, JSON.stringify(arr, null, 2));
}

/**
 * Record one health snapshot into the ring buffer. Idempotent per UTC day: a second record() on the
 * same day overwrites that day's entry rather than appending. Bounded to MAX_HISTORY newest entries.
 * @param {{score:number, classification?:string, t?:number}} snap
 * @returns {Array} the (bounded) history after recording, oldest→newest.
 */
export function record(snap = {}) {
  const score = Number(snap.score);
  if (!Number.isFinite(score)) return loadHistory(); // never store a null/NaN snapshot
  const t = Number.isFinite(snap.t) ? snap.t : Date.now();
  const day = new Date(t).toISOString().slice(0, 10);
  const entry = {
    day, t,
    score: Math.round(clamp(score) * 10) / 10,
    classification: snap.classification || classify(score),
    plain: plainClassify(score).label,
  };
  const arr = loadHistory().filter((e) => e.day !== day); // one entry per UTC day
  arr.push(entry);
  arr.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const bounded = arr.slice(-MAX_HISTORY); // ring buffer: keep newest MAX_HISTORY
  saveHistory(bounded);
  return bounded;
}

/** The recorded health history, oldest→newest, optionally limited to the last `limit` entries.
 *  (Named healthHistory to avoid colliding with the private per-symbol Yahoo `history` fetcher.) */
export function healthHistory({ limit = MAX_HISTORY } = {}) {
  const arr = loadHistory();
  const n = Math.max(1, Math.min(MAX_HISTORY, Number(limit) || MAX_HISTORY));
  return arr.slice(-n);
}

// ── healthSeries ────────────────────────────────────────────────────────────────────────────────────
/**
 * A time series of the market-health score across the chosen window, for drawing as a graph.
 * @returns {Promise<{timeframe,label,interval,coverage,points:Array<{t,score}>,score,classification}>}
 */
export async function healthSeries(timeframe = DEFAULT_TF) {
  const tfKey = normTf(timeframe);
  const tf = TIMEFRAMES[tfKey];
  return cached(`mh:series:${tfKey}`, TTL.ohlcv, async () => {
    const [sp, vix, tnx] = await Promise.all([history(SP, tfKey), history(VIX, tfKey), history(TNX, tfKey)]);
    const closes = sp.c, ts = sp.t;
    if (closes.length < 5) {
      return { timeframe: tfKey, label: tf.label, interval: tf.interval, coverage: null, points: [], score: null, classification: null, note: 'no data' };
    }
    // align VIX & TNX onto the S&P timeline by nearest-prior timestamp (they share Yahoo's daily grid
    // for most windows; intraday/long windows may not overlap — those components then fall back).
    const lookup = (other) => {
      const map = new Map();
      let j = 0;
      for (let i = 0; i < ts.length; i++) {
        while (j + 1 < other.t.length && other.t[j + 1] <= ts[i]) j++;
        map.set(ts[i], other.t.length && other.t[j] <= ts[i] + 7 * 24 * 3600 ? other.c[j] : null);
      }
      return map;
    };
    const vixAt = lookup(vix), tnxByIndex = tnx.c; // tnx aligned roughly by index for the rates-change calc

    // bar windows for momentum scale with the interval (so "short/long" mean ~1m/3m regardless of bar size).
    const barsPerMonth = tf.interval === '1mo' ? 1 : tf.interval === '1wk' ? 4 : tf.interval === '1d' ? 21 : 30;
    const shortN = Math.max(1, Math.round(barsPerMonth));
    const longN = Math.max(2, Math.round(barsPerMonth * 3));

    const points = [];
    // warm-up: skip the first few bars where MAs are meaningless, but keep at least the tail.
    const warm = Math.min(Math.floor(closes.length * 0.1), 30);
    for (let i = warm; i < closes.length; i++) {
      const trend = trendScore(closes, i);
      const mom = momentumScore(closes, i, shortN, longN);
      const dd = drawdownScore(closes, i);
      const vx = vixScore(vixAt.get(ts[i])) ?? realizedVolScore(closes, i);
      const rt = ratesScore(tnxByIndex.length === closes.length ? tnxByIndex : closes.map(() => null), i);
      // blend: trend & drawdown anchor the "health"; momentum & vol are the mood; rates a light tilt.
      const score = clamp(trend * 0.30 + dd * 0.22 + mom * 0.20 + vx * 0.20 + rt * 0.08);
      points.push({ t: ts[i], score: Math.round(score * 10) / 10 });
    }

    const firstMs = ts[0] * 1000;
    const requestedMs = tf.years ? Date.now() - tf.years * YEAR * 1000 : SP_INCEPTION_MS;
    const coverage = {
      from: new Date(firstMs).toISOString().slice(0, 10),
      to: new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10),
      requestedFrom: new Date(requestedMs).toISOString().slice(0, 10),
      // true if the data doesn't reach as far back as the window asked for (e.g. 100Y but data starts 1927).
      truncated: tf.years ? firstMs > requestedMs + 90 * 24 * 3600 * 1000 : false,
      points: points.length,
    };
    const last = points[points.length - 1]?.score ?? null;
    return { timeframe: tfKey, label: tf.label, interval: tf.interval, coverage, points, score: last, classification: last == null ? null : classify(last) };
  });
}

// ── healthScore (single point) ──────────────────────────────────────────────────────────────────────
/**
 * The current composite market-health score (0–100) for the timeframe's mood window, with components.
 * @returns {Promise<{score,classification,timeframe,components,asOf}|null>}
 */
export async function healthScore(timeframe = DEFAULT_TF) {
  const tfKey = normTf(timeframe);
  return cached(`mh:score:${tfKey}`, TTL.price, async () => {
    const series = await healthSeries(tfKey);
    if (!series || series.score == null) return { score: null, classification: null, timeframe: tfKey, components: null, asOf: Date.now() };
    // recompute the component breakdown at the latest bar for transparency on the gauge.
    const [sp, vix, tnx, breadth] = await Promise.all([
      history(SP, tfKey), history(VIX, tfKey), history(TNX, tfKey),
      // breadth is a point-in-time measure (today's universe), so it only modifies the LIVE score,
      // not the historical series. Soft-fail to null so the gauge still renders index-only if it's down.
      marketBreadth().catch(() => null),
    ]);
    const closes = sp.c; const i = closes.length - 1;
    const tf = TIMEFRAMES[tfKey];
    const barsPerMonth = tf.interval === '1mo' ? 1 : tf.interval === '1wk' ? 4 : tf.interval === '1d' ? 21 : 30;
    const vixNow = vix.c[vix.c.length - 1] ?? null;
    const breadthVal = breadth && breadth.breadthScore != null ? breadth.breadthScore : null;
    const components = i < 1 ? null : {
      trend: trendScore(closes, i),
      drawdown: drawdownScore(closes, i),
      momentum: momentumScore(closes, i, Math.max(1, barsPerMonth), Math.max(2, barsPerMonth * 3)),
      volatility: vixScore(vixNow) ?? realizedVolScore(closes, i),
      rates: ratesScore(tnx.c, tnx.c.length - 1),
      // breadth: % of the Stock-Index universe advancing / above its MAs (advance-decline). Labeled
      // distinct so the gauge can show it's an index-breadth input, not an S&P-only one.
      breadth: breadthVal,
    };
    // when breadth is available, blend it in as a light tilt on top of the series score (it shifts the
    // LIVE gauge toward/away from the index-only reading by up to ±~6 pts) — honest, narrow, labeled.
    let score = series.score;
    if (breadthVal != null) score = clamp(series.score * 0.85 + breadthVal * 0.15);
    score = Math.round(score * 10) / 10;
    return {
      score, classification: classify(score), timeframe: tfKey, label: tf.label, vix: vixNow,
      indexScore: series.score, components, breadth: breadth || null, asOf: Date.now(),
    };
  });
}

// ── healthData (the supporting "market health data" panel) ──────────────────────────────────────────
function pctReturn(closes, fromIdx, toIdx) {
  if (fromIdx < 0 || toIdx >= closes.length || closes[fromIdx] <= 0) return null;
  return (closes[toIdx] / closes[fromIdx] - 1) * 100;
}
// index of the first bar whose timestamp is >= cutoff.
function idxAtOrAfter(ts, cutoff) { for (let i = 0; i < ts.length; i++) if (ts[i] >= cutoff) return i; return -1; }

/**
 * Extra supporting stats alongside the gauge: window return, MTD/YTD, 5y/10y returns, max drawdown,
 * realized volatility, best/worst bar, and current price vs its 52-week high/low. Keyless.
 */
export async function healthData(timeframe = DEFAULT_TF) {
  const tfKey = normTf(timeframe);
  return cached(`mh:data:${tfKey}`, TTL.price, async () => {
    // pull the selected window for the window-return/best-worst, plus a long daily history for the
    // longer fixed lookbacks (MTD/YTD/5y/10y/52w) which the selected window may be too short to cover.
    const [win, longSp, vix] = await Promise.all([
      history(SP, tfKey),
      history(SP, '20Y'),
      history(VIX, '1Y'),
    ]);
    const out = { timeframe: tfKey, label: TIMEFRAMES[tfKey].label, asOf: Date.now() };

    // window return + best/worst single bar within the selected window.
    if (win.c.length >= 2) {
      out.windowReturn = pctReturn(win.c, 0, win.c.length - 1);
      let best = -Infinity, worst = Infinity, bi = 0, wi = 0;
      for (let k = 1; k < win.c.length; k++) {
        if (win.c[k - 1] > 0) { const r = (win.c[k] / win.c[k - 1] - 1) * 100; if (r > best) { best = r; bi = k; } if (r < worst) { worst = r; wi = k; } }
      }
      out.bestBar = Number.isFinite(best) ? { pct: Math.round(best * 100) / 100, date: new Date(win.t[bi] * 1000).toISOString().slice(0, 10) } : null;
      out.worstBar = Number.isFinite(worst) ? { pct: Math.round(worst * 100) / 100, date: new Date(win.t[wi] * 1000).toISOString().slice(0, 10) } : null;
      // realized annualized vol over the window.
      const r = [];
      for (let k = 1; k < win.c.length; k++) if (win.c[k - 1] > 0) r.push(Math.log(win.c[k] / win.c[k - 1]));
      if (r.length > 4) { const m = mean(r), v = mean(r.map((x) => (x - m) ** 2)); const iv = TIMEFRAMES[tfKey].interval; const perYear = iv === '1mo' ? 12 : iv === '1wk' ? 52 : iv === '1d' ? 252 : 252 * 78; out.volatility = Math.round(Math.sqrt(v) * Math.sqrt(perYear) * 1000) / 10; }
      // max drawdown across the window.
      let peak = -Infinity, mdd = 0;
      for (const c of win.c) { if (c > peak) peak = c; if (peak > 0) mdd = Math.min(mdd, c / peak - 1); }
      out.maxDrawdown = Math.round(mdd * 1000) / 10;
    }

    // fixed lookbacks off the long daily history.
    if (longSp.c.length > 2) {
      const ts = longSp.t, c = longSp.c, lastI = c.length - 1, now = Date.now() / 1000;
      const lastDate = new Date(ts[lastI] * 1000);
      const monthStart = Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), 1) / 1000;
      const yearStart = Date.UTC(lastDate.getUTCFullYear(), 0, 1) / 1000;
      const at = (cut) => { const i = idxAtOrAfter(ts, cut); return i > 0 ? i - 1 : (i === 0 ? 0 : -1); };
      out.current = Math.round(c[lastI] * 100) / 100;
      out.mtd = pctReturn(c, Math.max(0, at(monthStart)), lastI);
      out.ytd = pctReturn(c, Math.max(0, at(yearStart)), lastI);
      out.return5y = pctReturn(c, Math.max(0, at(now - 5 * YEAR)), lastI);
      out.return10y = pctReturn(c, Math.max(0, at(now - 10 * YEAR)), lastI);
      // 52-week high/low + position.
      const wk52 = c.slice(Math.max(0, at(now - YEAR)));
      if (wk52.length) {
        const hi = Math.max(...wk52), lo = Math.min(...wk52);
        out.high52w = Math.round(hi * 100) / 100; out.low52w = Math.round(lo * 100) / 100;
        out.pctFromHigh = Math.round((c[lastI] / hi - 1) * 1000) / 10;
        out.position52w = hi > lo ? Math.round((c[lastI] - lo) / (hi - lo) * 1000) / 10 : null;
      }
    }
    out.vix = vix.c.length ? Math.round(vix.c[vix.c.length - 1] * 100) / 100 : null;
    // round the percent fields for display.
    for (const k of ['windowReturn', 'mtd', 'ytd', 'return5y', 'return10y']) if (out[k] != null) out[k] = Math.round(out[k] * 100) / 100;
    return out;
  });
}

// ── Render helpers (exported; the server drops these into the page — no server edits) ────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLOR = (s) => s == null ? '#8b949e' : s >= 75 ? '#3fb950' : s >= 60 ? '#7ee787' : s >= 45 ? '#d29922' : s >= 30 ? '#f0883e' : '#f85149';

/**
 * Inline SVG "Health of the Market" gauge + a sparkline of the health series + a timeframe selector.
 * Self-contained: ships its own data via the API the server already proxies, or you can hardcode a
 * default series. The selector buttons call /api/health?tf=… which the parent should wire (see report).
 * @param {object} score   result of healthScore()
 * @param {object} series  result of healthSeries() (for the sparkline)
 */
export function renderHealthGauge(score, series, { apiPath = '/api/health' } = {}) {
  const s = score?.score;
  const col = COLOR(s);
  const cls = score?.classification || '—';
  // semicircular gauge: needle angle 180°(=0) → 0°(=100).
  const ang = s == null ? 90 : 180 - (s / 100) * 180;
  const rad = (ang * Math.PI) / 180, cx = 110, cy = 110, r = 90;
  const nx = cx + Math.cos(rad) * r, ny = cy - Math.sin(rad) * r;
  // arc band ticks
  const arc = (a0, a1, color) => {
    const p = (a) => [cx + Math.cos((a * Math.PI) / 180) * r, cy - Math.sin((a * Math.PI) / 180) * r];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="butt"/>`;
  };
  const bands = arc(180, 144, '#f85149') + arc(144, 108, '#f0883e') + arc(108, 72, '#d29922') + arc(72, 36, '#7ee787') + arc(36, 0, '#3fb950');
  // sparkline of the series
  const pts = (series?.points || []);
  let spark = '';
  if (pts.length > 1) {
    const W = 300, H = 64, n = pts.length;
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i / (n - 1) * W).toFixed(1)} ${(H - (p.score / 100) * H).toFixed(1)}`).join(' ');
    spark = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="64" preserveAspectRatio="none" style="margin-top:8px">
      <line x1="0" y1="${(H - 0.5 * H).toFixed(1)}" x2="${W}" y2="${(H - 0.5 * H).toFixed(1)}" stroke="#30363d" stroke-dasharray="3 3"/>
      <path d="${path}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
  }
  const buttons = TIMEFRAME_KEYS.map((k) => `<button type=button class="mh-tfb${k === (score?.timeframe || series?.timeframe) ? ' on' : ''}" data-tf="${k}">${k}</button>`).join('');
  const cov = series?.coverage;
  const covNote = cov ? `${esc(cov.from)} → ${esc(cov.to)}${cov.truncated ? ' · data begins after the requested window (coverage shown)' : ''}` : '';
  return `<div class=card id=mh-gauge data-api="${esc(apiPath)}">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px"><h2 style="margin:0">Health of the Market</h2>
      <span class=muted style="font-size:12px">· informational, not advice</span></div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:8px">
      <svg viewBox="0 0 220 130" width="220" height="130" aria-label="market health gauge">
        ${bands}
        <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#e6edf3" stroke-width="3"/>
        <circle cx="${cx}" cy="${cy}" r="6" fill="#e6edf3"/>
        <text x="${cx}" y="${cy - 26}" text-anchor="middle" font-size="34" font-weight="800" fill="${col}">${s == null ? '—' : Math.round(s)}</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="13" fill="#8b949e">${esc(cls)}</text>
      </svg>
      <div style="flex:1;min-width:220px">
        <div class=muted style="font-size:13px">Composite of S&amp;P 500 trend, drawdown, momentum, volatility (VIX), the 10-year-rate tilt${score?.components?.breadth != null ? ' &amp; market breadth (advance-decline)' : ''} — the stock-market analog of crypto Fear &amp; Greed.</div>
        ${spark}
        <div class=muted style="font-size:11px;margin-top:4px">${esc(series?.label || '')} ${covNote ? '· ' + covNote : ''}</div>
      </div>
    </div>
    <div class=mh-tf style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${buttons}</div>
    <style>.mh-tfb{cursor:pointer;background:transparent;border:1px solid #30363d;border-radius:6px;color:#8b949e;font-weight:600;font-size:11px;padding:3px 8px}.mh-tfb:hover{color:#e6edf3;border-color:#58a6ff}.mh-tfb.on{background:#58a6ff;color:#06101f;border-color:#58a6ff}</style>
    <script>(function(){var g=document.getElementById('mh-gauge');if(!g)return;var api=g.getAttribute('data-api');
      g.querySelectorAll('.mh-tfb').forEach(function(b){b.addEventListener('click',function(){
        fetch(api+'?tf='+encodeURIComponent(b.getAttribute('data-tf'))).then(function(r){return r.json()}).then(function(d){
          if(d&&d.html){var w=document.createElement('div');w.innerHTML=d.html;var n=w.querySelector('#mh-gauge');if(n)g.replaceWith(n);}
        }).catch(function(){});});});})();</script>
  </div>`;
}

/** The supporting "market health data" panel as an HTML card. Pairs with healthData(). */
export function renderHealthData(data) {
  if (!data) return '';
  const p = (n) => n == null ? '<span class=muted>—</span>' : `<span style="color:${n >= 0 ? '#3fb950' : '#f85149'}">${n >= 0 ? '+' : ''}${(+n).toFixed(2)}%</span>`;
  const row = (k, v) => v === '' || v == null ? '' : `<tr><td class=muted>${esc(k)}</td><td>${v}</td></tr>`;
  const num = (n) => n == null ? null : (+n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `<div class=card><h2>Market health data <span class=muted style="font-size:12px;font-weight:400">· S&amp;P 500 · ${esc(data.label || '')}</span></h2>
    <table>
      ${row(`Return (${esc(data.label || 'window')})`, p(data.windowReturn))}
      ${row('Month-to-date', p(data.mtd))}
      ${row('Year-to-date', p(data.ytd))}
      ${row('5-year return', p(data.return5y))}
      ${row('10-year return', p(data.return10y))}
      ${row('Max drawdown (window)', p(data.maxDrawdown))}
      ${row('Volatility (annualized)', data.volatility == null ? null : data.volatility.toFixed(1) + '%')}
      ${row('Best day/bar', data.bestBar ? `${p(data.bestBar.pct)} <span class=muted>${esc(data.bestBar.date)}</span>` : null)}
      ${row('Worst day/bar', data.worstBar ? `${p(data.worstBar.pct)} <span class=muted>${esc(data.worstBar.date)}</span>` : null)}
      ${row('Current level', num(data.current))}
      ${row('52-week range', data.low52w != null ? `${num(data.low52w)} – ${num(data.high52w)}` : null)}
      ${row('% from 52-wk high', data.pctFromHigh == null ? null : p(data.pctFromHigh))}
      ${row('VIX (volatility)', num(data.vix))}
    </table>
    <p class=muted style="font-size:11px;margin-top:8px">Source: Yahoo Finance (keyless). Informational market data — not investment advice.</p></div>`;
}

// ── engineBlock (markdown for the brief) ────────────────────────────────────────────────────────────
/** Optional markdown summary of the gauge for the resident-AI brief. */
export async function engineBlock(timeframe = DEFAULT_TF) {
  const [h, d] = await Promise.all([healthScore(timeframe).catch(() => null), healthData(timeframe).catch(() => null)]);
  if (!h || h.score == null) return '_Market health: data unavailable._';
  const c = h.components || {};
  const f = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + (+n).toFixed(1) + '%';
  return [
    `**Health of the Market — ${h.label || timeframe}: ${Math.round(h.score)}/100 (${h.classification})**`,
    '',
    `- Trend ${c.trend ?? '—'} · Drawdown ${c.drawdown ?? '—'} · Momentum ${c.momentum ?? '—'} · Volatility ${c.volatility ?? '—'} · Rates ${c.rates ?? '—'}${c.breadth != null ? ` · Breadth ${c.breadth}` : ''}`,
    d ? `- S&P 500: YTD ${f(d.ytd)} · 5y ${f(d.return5y)} · max drawdown ${f(d.maxDrawdown)} · VIX ${d.vix ?? '—'}` : '',
    '',
    '_Composite of S&P 500 trend/drawdown/momentum, VIX and the 10-year-rate tilt. Informational market data, not financial advice._',
  ].filter((x) => x !== '').join('\n');
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const tf = process.argv[2] || DEFAULT_TF;
  const h = await healthScore(tf);
  const s = await healthSeries(tf);
  const d = await healthData(tf);
  console.log(`\n  Health of the Market — ${h.label || tf}: ${h.score == null ? '—' : Math.round(h.score)}/100 (${h.classification || '—'})`);
  if (h.components) console.log(`  components: trend ${h.components.trend} · drawdown ${h.components.drawdown} · momentum ${h.components.momentum} · vol ${h.components.volatility} · rates ${h.components.rates}${h.components.breadth != null ? ` · breadth ${h.components.breadth}` : ''}`);
  console.log(`  series: ${s.points.length} points, coverage ${s.coverage ? s.coverage.from + ' → ' + s.coverage.to + (s.coverage.truncated ? ' (truncated to data)' : '') : '—'}`);
  const fmt = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  console.log(`  data: windowRet ${fmt(d.windowReturn)} · YTD ${fmt(d.ytd)} · 5y ${fmt(d.return5y)} · maxDD ${fmt(d.maxDrawdown)} · vol ${d.volatility ?? '—'}% · VIX ${d.vix ?? '—'}`);
  console.log(`  render gauge: ${renderHealthGauge(h, s).length} bytes · render data: ${renderHealthData(d).length} bytes`);
  console.log('\n' + await engineBlock(tf) + '\n');
}
