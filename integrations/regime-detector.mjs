// regime-detector.mjs — PURE, deterministic market-REGIME classifier for the adaptive trade engine.
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ────────────────────────────────────────────┐
// │ • REPO-SIDE ONLY. Nothing here trades, broadcasts, holds a key, reads env for a WIF, or does │
// │   ANY I/O. detectRegime() is a PURE function: marketState (+ optional prior/opts) → a plain   │
// │   { regime, factors, confidence } object. No fetch, no fs, no clock (Date.now), no randomness.│
// │ • This module DECIDES NOTHING about orders. It only names the market's regime so the (also    │
// │   pure) strategy-router.mjs can pick which existing trade-strategies.mjs family to run. It is  │
// │   consumed by the SHADOW harness + backtester only — it is NOT wired into the live loop.      │
// │ • Never throws. Junk / missing / contradictory input soft-fails to the safe 'UNCERTAIN'       │
// │   regime (do-nothing), exactly like the loop's dead-book reject would.                         │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// THE 8 REGIMES (per .local/ADAPTIVE_TRADEBOT_DESIGN.md STEP 3):
//   DEAD           — thin/suspect/one-sided book → do nothing (the anti-rug gate, first-class regime)
//   PEG_DISLOCATED — |arb edge| ≥ threshold with real executable depth and NOT suspect
//   THIN_BOOK      — a genuine two-sided book, but executable depth below MIN_EXEC_HIVE (defend, don't chase)
//   HIGH_VOL       — ATR / Bollinger-band-width spike (widen or stand down; don't quote tight into chaos)
//   TREND_UP       — ADX ≥ 25 and price above the slow MA
//   TREND_DOWN     — ADX ≥ 25 and price below the slow MA (the falling-knife guard)
//   RANGE          — ADX ≤ 18 / low band-width (the safest non-dead default: earn the chop)
//   UNCERTAIN      — no usable data / an error → hold (the safe default for junk)
//
// INPUT marketState (all fields optional; tolerant of partial data — nothing is fabricated):
//   {
//     symbol,                                   // informational
//     candles: [{ t, open, high, low, close, volume }],  // from backtest.loadHistory (past bars)
//     buyBook:  [{ price, quantity }],          // bids  (highest price = best bid)
//     sellBook: [{ price, quantity }],          // asks  (lowest price  = best ask)
//     arb: { edge, execHive, suspect },         // one arb-scanner row for this symbol (peg edge)
//     drawdown,                                 // profit-tracker.maxDrawdown().pct (0..1) — carried, not a trigger here
//     skew,                                     // inventory skew (execute.inventorySkew) — informational
//     hiveUsd, realUsd,                         // optional, informational
//     prior: { regime, dwell, candidate, candidateStreak },  // anti-whipsaw state (or pass via opts.prior)
//   }
//
// ANTI-WHIPSAW (design STEP 3a): the classifier is stateless per call, but detectRegime applies
// HYSTERESIS using an injected prior regime + dwell counter: a NEW non-safety candidate must persist
// `minDwell` consecutive reads before the active regime switches. The two SAFETY regimes — DEAD (anti-rug)
// and UNCERTAIN (no data) — bypass hysteresis and take effect immediately. The returned `hysteresis`
// object is fed straight back in as the next call's prior.
//
//   import { detectRegime, REGIMES } from './regime-detector.mjs';
//   node integrations/regime-detector.mjs        # print a demo classification of a few fixtures

import { loadTradeConfig } from './trade-config.mjs';

// ── the canonical regime set ────────────────────────────────────────────────────────────────────
export const REGIMES = Object.freeze([
  'DEAD', 'PEG_DISLOCATED', 'THIN_BOOK', 'HIGH_VOL', 'TREND_UP', 'TREND_DOWN', 'RANGE', 'UNCERTAIN',
]);
// Safety regimes bypass hysteresis (must engage/leave immediately).
const SAFETY = new Set(['DEAD', 'UNCERTAIN']);

// ── tiny pure helpers (no I/O) ───────────────────────────────────────────────────────────────────
const num = (n, d = NaN) => (Number.isFinite(+n) ? +n : d);
const round = (n, dp = 6) => +(+n).toFixed(dp);
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

function sma(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN; }
function stddev(xs) {
  if (xs.length < 2) return 0;
  const mu = sma(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1));
}

// True Range series (needs prevClose). Returns [] when < 2 candles.
function trueRanges(candles) {
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return tr;
}

// ATR% over the last `period` bars (simple mean of TR / last close). null if too few candles.
function atrPct(candles, period) {
  if (candles.length < 2) return null;
  const tr = trueRanges(candles);
  const win = tr.slice(-period);
  if (!win.length) return null;
  const last = candles[candles.length - 1].close;
  if (!(last > 0)) return null;
  return round(sma(win) / last, 6);
}

// Bollinger band width = 2·k·stddev(close) / SMA(close), over the last `period` closes. null if too few.
function bandWidth(candles, period, k = 2) {
  if (candles.length < 2) return null;
  const closes = candles.slice(-period).map((c) => c.close).filter((x) => Number.isFinite(x));
  if (closes.length < 2) return null;
  const mid = sma(closes);
  if (!(mid > 0)) return null;
  return round((2 * k * stddev(closes)) / mid, 6);
}

// ADX-style directional strength (0..100). Simplified, deterministic: +DM/−DM/TR averaged with a
// simple (not Wilder) mean over the last `period` bars, then DX = 100·|+DI−−DI|/(+DI+−DI), and ADX =
// mean(DX) over the same window. Pattern-only (not copied) — good enough to separate trend from range.
// Returns null when there are too few candles to measure.
function adx(candles, period) {
  if (candles.length < period + 1) return null;
  const c = candles.slice(-(period + 1));
  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  const atr = sma(tr);
  if (!(atr > 0)) return 0;
  const pDI = 100 * (sma(plusDM) / atr);
  const mDI = 100 * (sma(minusDM) / atr);
  const denom = pDI + mDI;
  if (!(denom > 0)) return 0;
  return round(100 * Math.abs(pDI - mDI) / denom, 4);
}

// Sum executable HIVE within `band` of the touch on one book side. Bids: price ≥ best·(1−band);
// asks: price ≤ best·(1+band). Returns HIVE (= Σ price·qty of qualifying levels).
function sideDepthHive(levels, best, band, side) {
  if (!Array.isArray(levels) || !(best > 0)) return 0;
  let hive = 0;
  for (const lvl of levels) {
    const price = num(lvl?.price), qty = num(lvl?.quantity);
    if (!(price > 0) || !(qty > 0)) continue;
    const ok = side === 'bid' ? price >= best * (1 - band) : price <= best * (1 + band);
    if (ok) hive += price * qty;
  }
  return round(hive, 6);
}

// ── regime thresholds (env-overridable via opts.config; pure read, defaults documented) ──────────
export function regimeConfig(overrides = {}) {
  const cfg = loadTradeConfig();
  return {
    adxTrend: num(overrides.adxTrend, 25),          // ADX ≥ this ⇒ trending
    adxRange: num(overrides.adxRange, 18),          // ADX ≤ this ⇒ ranging
    adxPeriod: num(overrides.adxPeriod, 14),
    atrPeriod: num(overrides.atrPeriod, 14),
    bandPeriod: num(overrides.bandPeriod, 20),
    bandK: num(overrides.bandK, 2),
    fastMA: num(overrides.fastMA, 7),
    slowMA: num(overrides.slowMA, 25),
    highVolBandWidth: num(overrides.highVolBandWidth, 0.12),  // band-width fraction ≥ this ⇒ HIGH_VOL
    highVolAtrPct: num(overrides.highVolAtrPct, 0.06),        // ATR% ≥ this ⇒ HIGH_VOL
    rangeBandWidthMax: num(overrides.rangeBandWidthMax, 0.06),// tighter band-width supports RANGE (confidence only)
    depthBand: num(overrides.depthBand, 0.05),               // count depth within 5% of the touch
    pegEdge: num(overrides.pegEdge, cfg.arb.threshold),      // |edge| ≥ this ⇒ dislocated (default 3%)
    minExecHive: num(overrides.minExecHive, cfg.arb.minExecHive), // depth floor (default 20 HIVE)
  };
}

/**
 * computeFactors — PURE. Derive every observable factor from marketState. Never throws; any missing
 * input yields a null/neutral factor (never a fabricated number).
 */
export function computeFactors(marketState = {}, cfg = regimeConfig()) {
  const candles = Array.isArray(marketState.candles)
    ? marketState.candles.filter((c) => c && Number.isFinite(+c.close))
    : [];
  const closes = candles.map((c) => +c.close);
  const price = closes.length ? closes[closes.length - 1] : num(marketState.price, NaN);

  const fastMA = closes.length ? sma(closes.slice(-cfg.fastMA)) : NaN;
  const slowMA = closes.length ? sma(closes.slice(-cfg.slowMA)) : NaN;
  const adxVal = adx(candles, cfg.adxPeriod);
  const atr = atrPct(candles, cfg.atrPeriod);
  const bw = bandWidth(candles, cfg.bandPeriod, cfg.bandK);

  // order book
  const bids = Array.isArray(marketState.buyBook) ? marketState.buyBook : null;
  const asks = Array.isArray(marketState.sellBook) ? marketState.sellBook : null;
  const bookProvided = bids != null || asks != null;
  const bestBid = bids && bids.length ? Math.max(...bids.map((l) => num(l?.price, 0))) : 0;
  const bestAsk = asks && asks.length ? Math.min(...asks.map((l) => num(l?.price, Infinity))) : 0;
  const haveBid = bestBid > 0, haveAsk = bestAsk > 0 && Number.isFinite(bestAsk);
  const oneSided = bookProvided && (haveBid !== haveAsk);           // exactly one side present
  const twoSided = haveBid && haveAsk;
  const mid = twoSided ? (bestBid + bestAsk) / 2 : NaN;
  const spread = twoSided && mid > 0 ? round((bestAsk - bestBid) / mid, 6) : null;
  const bidDepthHive = sideDepthHive(bids, bestBid, cfg.depthBand, 'bid');
  const askDepthHive = sideDepthHive(asks, bestAsk, cfg.depthBand, 'ask');
  const depthHive = twoSided ? round(Math.min(bidDepthHive, askDepthHive), 6) : (bookProvided ? 0 : null);
  const imbalance = (bidDepthHive + askDepthHive) > 0
    ? round((bidDepthHive - askDepthHive) / (bidDepthHive + askDepthHive), 4) : null;

  // peg / arb
  const arb = marketState.arb || {};
  const pegEdge = Number.isFinite(+arb.edge) ? round(+arb.edge, 6) : null;
  const pegExecHive = Number.isFinite(+arb.execHive) ? round(+arb.execHive, 6) : null;
  const suspect = arb.suspect === true;

  return {
    symbol: marketState.symbol || null,
    candleCount: candles.length,
    price: Number.isFinite(price) ? round(price, 8) : null,
    fastMA: Number.isFinite(fastMA) ? round(fastMA, 8) : null,
    slowMA: Number.isFinite(slowMA) ? round(slowMA, 8) : null,
    adx: adxVal,
    atrPct: atr,
    bandWidth: bw,
    bookProvided, oneSided, twoSided,
    bestBid: round(bestBid, 8), bestAsk: haveAsk ? round(bestAsk, 8) : null,
    spread, depthHive, bidDepthHive, askDepthHive, imbalance,
    pegEdge, pegExecHive, suspect,
    drawdown: Number.isFinite(+marketState.drawdown) ? round(+marketState.drawdown, 4) : null,
    skew: Number.isFinite(+marketState.skew) ? round(+marketState.skew, 4) : null,
  };
}

// Is there enough to classify anything at all? (no candles, no book, no peg) → UNCERTAIN.
function hasUsableData(f) {
  return f.candleCount > 0 || f.bookProvided || f.pegEdge != null;
}

/**
 * classifyRaw — PURE priority-ladder classifier (no hysteresis). Returns { regime, confidence, scores }.
 * Order matters: safety first (DEAD/UNCERTAIN), then peg, then thin-book defense, then vol, then trend,
 * then the RANGE default. `scores` exposes the deciding discriminants for the shadow display.
 */
export function classifyRaw(f, cfg = regimeConfig()) {
  const scores = {};

  if (!hasUsableData(f)) return { regime: 'UNCERTAIN', confidence: 0.1, scores };

  // 1. DEAD — the anti-rug / dead-book gate (first-class). Suspect edge, one-sided book, or zero depth.
  if (f.suspect || f.oneSided || (f.bookProvided && f.twoSided === false && f.oneSided === false && f.depthHive === 0)) {
    scores.DEAD = 1;
    const why = f.suspect ? 'arb-scanner flagged suspect (phantom/stale)'
      : f.oneSided ? 'one-sided HE book (missing bid or ask)'
      : 'no executable depth';
    return { regime: 'DEAD', confidence: 0.95, scores, why };
  }
  if (f.bookProvided && f.twoSided && f.depthHive === 0) {
    scores.DEAD = 1;
    return { regime: 'DEAD', confidence: 0.9, scores, why: 'book present but zero executable depth' };
  }

  // 2. PEG_DISLOCATED — real, executable, non-suspect edge.
  if (f.pegEdge != null && Math.abs(f.pegEdge) >= cfg.pegEdge && !f.suspect
      && (f.pegExecHive == null || f.pegExecHive >= cfg.minExecHive)) {
    const conf = clamp01(0.5 + ((Math.abs(f.pegEdge) - cfg.pegEdge) / (2 * cfg.pegEdge)) * 0.5);
    scores.PEG_DISLOCATED = round(conf, 4);
    return { regime: 'PEG_DISLOCATED', confidence: round(conf, 4), scores,
      why: `peg edge ${(f.pegEdge * 100).toFixed(1)}% ≥ ${(cfg.pegEdge * 100).toFixed(1)}% with real depth` };
  }

  // 3. THIN_BOOK — a genuine two-sided book but executable depth below the floor. Defend, don't chase.
  if (f.twoSided && f.depthHive != null && f.depthHive > 0 && f.depthHive < cfg.minExecHive) {
    const conf = clamp01(0.5 + ((cfg.minExecHive - f.depthHive) / cfg.minExecHive) * 0.5);
    scores.THIN_BOOK = round(conf, 4);
    return { regime: 'THIN_BOOK', confidence: round(conf, 4), scores,
      why: `depth ${f.depthHive} HIVE < ${cfg.minExecHive} min executable` };
  }

  // 4. HIGH_VOL — ATR / band-width spike WITHOUT a clear direction (chop/chaos). A strong trend also
  //    widens the Bollinger bands, so we only call HIGH_VOL when ADX is NOT in trend territory —
  //    otherwise the wide-band trend below claims it (ride it, don't treat it as chaos).
  const notTrending = f.adx == null || f.adx < cfg.adxTrend;
  const volHits = [];
  if (notTrending && f.bandWidth != null && f.bandWidth >= cfg.highVolBandWidth) volHits.push((f.bandWidth / cfg.highVolBandWidth));
  if (notTrending && f.atrPct != null && f.atrPct >= cfg.highVolAtrPct) volHits.push((f.atrPct / cfg.highVolAtrPct));
  if (volHits.length) {
    const conf = clamp01(0.5 + (Math.max(...volHits) - 1) * 0.5);
    scores.HIGH_VOL = round(conf, 4);
    return { regime: 'HIGH_VOL', confidence: round(conf, 4), scores,
      why: `volatility spike (bandWidth ${f.bandWidth}, atrPct ${f.atrPct})` };
  }

  // 5. TREND_UP / TREND_DOWN — ADX ≥ trend threshold, direction from price vs slow MA.
  if (f.adx != null && f.adx >= cfg.adxTrend && f.slowMA != null && f.price != null) {
    const conf = clamp01(0.5 + (f.adx - cfg.adxTrend) / 50);
    const up = f.price >= f.slowMA;
    const regime = up ? 'TREND_UP' : 'TREND_DOWN';
    scores[regime] = round(conf, 4);
    return { regime, confidence: round(conf, 4), scores,
      why: `ADX ${f.adx} ≥ ${cfg.adxTrend}, price ${up ? 'above' : 'below'} slow MA` };
  }

  // 6. RANGE — the safest non-dead default (explicitly stronger confidence when ADX/band-width confirm).
  let conf = 0.45;
  if (f.adx != null && f.adx <= cfg.adxRange) conf = clamp01(0.5 + (cfg.adxRange - f.adx) / (cfg.adxRange * 2));
  if (f.bandWidth != null && f.bandWidth <= cfg.rangeBandWidthMax) conf = clamp01(conf + 0.1);
  scores.RANGE = round(conf, 4);
  return { regime: 'RANGE', confidence: round(conf, 4), scores,
    why: f.adx != null ? `ADX ${f.adx} (ranging / no strong trend)` : 'no strong trend signal — default' };
}

const emptyPrior = () => ({ regime: null, dwell: 0, candidate: null, candidateStreak: 0 });

/**
 * detectRegime — PURE. Classify the market state, then apply anti-whipsaw HYSTERESIS against an
 * injected prior regime + dwell counter. Never throws (junk → UNCERTAIN).
 *
 * @param {object} marketState  see the header (may also carry `.prior`)
 * @param {object} [opts]        { prior, minDwell, config }
 *   prior:    { regime, dwell, candidate, candidateStreak } — feed back the previous call's `hysteresis`
 *   minDwell: consecutive reads a NEW non-safety candidate must persist before the active regime switches (default 2)
 *   config:   regimeConfig() overrides (thresholds)
 * @returns {{ regime, confidence, factors, scores, candidate, dwell, switched, hysteresis, why }}
 */
export function detectRegime(marketState = {}, opts = {}) {
  try {
    const cfg = regimeConfig(opts.config || {});
    const minDwell = Math.max(1, Math.floor(num(opts.minDwell, 2)));
    const prior = { ...emptyPrior(), ...(opts.prior || marketState.prior || {}) };

    const factors = computeFactors(marketState || {}, cfg);
    const raw = classifyRaw(factors, cfg);
    const candidate = raw.regime;

    let regime, dwell, candidateStreak, switched;

    if (prior.regime == null) {
      // first observation — adopt the candidate straight away.
      regime = candidate; dwell = 1; candidateStreak = 1; switched = true;
    } else if (candidate === prior.regime) {
      // steady state — the active regime is confirmed again.
      regime = candidate; dwell = prior.dwell + 1; candidateStreak = 0; switched = false;
    } else if (SAFETY.has(candidate)) {
      // safety regimes (DEAD / UNCERTAIN) engage IMMEDIATELY — never delayed by hysteresis.
      regime = candidate; dwell = 1; candidateStreak = 1; switched = true;
    } else {
      // a new non-safety candidate — it must persist minDwell reads before we switch.
      const streak = candidate === prior.candidate ? prior.candidateStreak + 1 : 1;
      if (streak >= minDwell) {
        regime = candidate; dwell = 1; candidateStreak = 0; switched = true;
      } else {
        regime = prior.regime; dwell = prior.dwell + 1; candidateStreak = streak; switched = false;
      }
    }

    const held = !switched && candidate !== regime;
    const confidence = held ? round(raw.confidence * 0.5, 4) : raw.confidence;

    return {
      regime,
      confidence,
      factors,
      scores: raw.scores,
      candidate,
      dwell,
      switched,
      why: held ? `holding ${regime} — ${candidate} pending (${candidateStreak}/${minDwell})` : (raw.why || ''),
      hysteresis: { regime, dwell, candidate, candidateStreak },
    };
  } catch (e) {
    // never throw — soft-fail to the safe default.
    return {
      regime: 'UNCERTAIN', confidence: 0, factors: {}, scores: {}, candidate: 'UNCERTAIN',
      dwell: 1, switched: true, why: `error ${e && e.message ? e.message : e} — soft-fail to UNCERTAIN`,
      hysteresis: { regime: 'UNCERTAIN', dwell: 1, candidate: 'UNCERTAIN', candidateStreak: 1 },
    };
  }
}

// ── CLI (guarded) — offline demo over a few crafted fixtures, no network, no keys ────────────────
if (process.argv[1] && process.argv[1].endsWith('regime-detector.mjs')) {
  const DAY = 86_400_000, t0 = Date.UTC(2026, 0, 1);
  const flat = []; for (let i = 0; i < 30; i++) flat.push({ t: t0 + i * DAY, open: 1, high: 1.004, low: 0.996, close: 1, volume: 100 });
  const rip = []; for (let i = 0; i < 30; i++) { const p = 1 + i * 0.08; rip.push({ t: t0 + i * DAY, open: p - 0.02, high: p + 0.02, low: p - 0.03, close: p, volume: 100 }); }
  const book = { buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [{ price: 1.01, quantity: 500 }] };
  const fixtures = {
    'RANGE (flat book)': { symbol: 'SWAP.OSC', candles: flat, ...book },
    'TREND_UP (rip)': { symbol: 'SWAP.RIP', candles: rip, ...book },
    'PEG_DISLOCATED': { symbol: 'SWAP.DOGE', candles: flat, ...book, arb: { edge: 0.06, execHive: 120, suspect: false } },
    'DEAD (suspect)': { symbol: 'SWAP.ETH', candles: flat, ...book, arb: { edge: 1.39, execHive: 3, suspect: true } },
    'THIN_BOOK': { symbol: 'SWAP.THIN', candles: flat, buyBook: [{ price: 0.99, quantity: 3 }], sellBook: [{ price: 1.01, quantity: 3 }] },
    'DEAD (one-sided)': { symbol: 'SWAP.ORPH', candles: flat, buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [] },
    'UNCERTAIN (junk)': { symbol: 'SWAP.NIL' },
  };
  console.log('Regime detector — PURE, deterministic, keyless. Offline fixture demo.\n' + '─'.repeat(80));
  for (const [label, ms] of Object.entries(fixtures)) {
    const r = detectRegime(ms);
    console.log(`\n[${label}]  → ${r.regime}  (confidence ${r.confidence})`);
    console.log(`  why: ${r.why}`);
    console.log(`  factors: adx=${r.factors.adx} atrPct=${r.factors.atrPct} bandWidth=${r.factors.bandWidth} depthHive=${r.factors.depthHive} pegEdge=${r.factors.pegEdge} suspect=${r.factors.suspect}`);
  }
  console.log('\nEvery classification above is a pure function of its input. No orders, no keys, no I/O.');
}
