// token-price-roi.mjs — pure price-change / ROI arithmetic (queue task: "Track SMT prices").
//
// A small, dependency-free calculator that derives change and ROI metrics from price points
// the CALLER supplies. This module ingests nothing: it does not fetch, read disk, or hold keys.
// Pair it with the ingestion layer (integrations/crowdsource-prices.mjs) and any infra tracker —
// those produce the numbers; this turns them into metrics.
//
// DESIGN INVARIANTS (strict):
//   • ESM .mjs, pure functions, soft-fail — never throw out of a public fn.
//   • Never divides by zero; bad / missing inputs degrade to 0 or null.
//   • No network, no disk, no keys, no clock. Fully deterministic → 100% offline tests.
//   • esc() guards the one rendered string (CLI worked example only).
//
//   import { pctChange, roi, movingAverage, volatility, summarize } from './token-price-roi.mjs'

// ── tiny helpers ────────────────────────────────────────────────────────────────────────
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

// Coerce an array-ish of price points to a clean array of finite numbers (drops nulls).
function cleanPrices(prices) {
  if (!Array.isArray(prices)) return [];
  const out = [];
  for (const p of prices) { const n = num(p); if (n !== null) out.push(n); }
  return out;
}

// HTML-escape for the rendered worked example (matches sibling integrations modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── pctChange ───────────────────────────────────────────────────────────────────────────
// Fractional change from `from` to `to` (e.g. 0.25 = +25%, -0.5 = -50%).
// Soft-fail to 0 when `from` is non-positive / non-finite or `to` is non-finite.
export function pctChange(from, to) {
  const f = num(from), t = num(to);
  if (f === null || t === null || f <= 0) return 0;
  return (t - f) / f;
}

// ── roi ─────────────────────────────────────────────────────────────────────────────────
// Position ROI from an entry price, current price, and quantity.
//   { costBasis, value, pnl, pct }  — pct is a fraction (gain/loss over cost basis).
// All fields soft-fail to 0 on bad input; pct never divides by zero.
export function roi({ entryPrice, currentPrice, qty } = {}) {
  const e = num(entryPrice), c = num(currentPrice);
  let q = num(qty);
  if (q === null) q = 0;
  if (e === null || c === null || q < 0) {
    return { costBasis: 0, value: 0, pnl: 0, pct: 0 };
  }
  const costBasis = round2(e * q);
  const value = round2(c * q);
  const pnl = round2(value - costBasis);
  const pct = costBasis > 0 ? round4((value - costBasis) / costBasis) : 0;
  return { costBasis, value, pnl, pct };
}

// ── movingAverage ───────────────────────────────────────────────────────────────────────
// Trailing simple moving average over `window` points. Returns an array the same length as
// the cleaned input; entries are null until the window has filled. Soft-fail: bad window or
// no usable prices → []. Window is floored to an integer and must be >= 1.
export function movingAverage(prices, window) {
  const xs = cleanPrices(prices);
  let w = num(window);
  if (w === null) return [];
  w = Math.floor(w);
  if (w < 1 || xs.length === 0) return [];
  const out = new Array(xs.length).fill(null);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= w) sum -= xs[i - w];
    if (i >= w - 1) out[i] = round4(sum / w);
  }
  return out;
}

// ── volatility ──────────────────────────────────────────────────────────────────────────
// Population standard deviation of period-over-period fractional returns. Needs >= 2 points;
// fewer (or no positive base prices) → 0. Skips returns whose base price is non-positive so
// we never divide by zero.
export function volatility(prices) {
  const xs = cleanPrices(prices);
  if (xs.length < 2) return 0;
  const rets = [];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i - 1] > 0) rets.push((xs[i] - xs[i - 1]) / xs[i - 1]);
  }
  if (rets.length === 0) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
  return round4(Math.sqrt(varc));
}

// ── summarize ───────────────────────────────────────────────────────────────────────────
// One-shot snapshot over a price series:
//   { first, last, high, low, pctChange, ma7, vol }
// pctChange is first→last; ma7 is the last trailing 7-window average (null until filled);
// vol is volatility(prices). Empty / unusable input → all-null/zero shape (never throws).
export function summarize(prices) {
  const xs = cleanPrices(prices);
  if (xs.length === 0) {
    return { first: null, last: null, high: null, low: null, pctChange: 0, ma7: null, vol: 0 };
  }
  const first = xs[0];
  const last = xs[xs.length - 1];
  const high = Math.max(...xs);
  const low = Math.min(...xs);
  const maArr = movingAverage(xs, 7);
  const ma7 = maArr.length ? maArr[maArr.length - 1] : null;
  return {
    first,
    last,
    high,
    low,
    pctChange: round4(pctChange(first, last)),
    ma7,
    vol: volatility(xs),
  };
}

// ── CLI worked example (guarded; no IO beyond stdout) ─────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const series = [1.00, 1.10, 1.05, 1.20, 1.15, 1.30, 1.25, 1.40];
  const s = summarize(series);
  const pos = roi({ entryPrice: 1.00, currentPrice: 1.40, qty: 500 });
  const lines = [
    'token-price-roi — worked example',
    `series: [${series.join(', ')}]`,
    `pctChange(first,last): ${(s.pctChange * 100).toFixed(2)}%`,
    `high/low: ${s.high} / ${s.low}`,
    `ma7 (last): ${s.ma7}`,
    `volatility (stddev of returns): ${s.vol}`,
    `roi(entry 1.00 → 1.40 x500): cost ${pos.costBasis}, value ${pos.value}, ` +
      `pnl ${pos.pnl}, pct ${(pos.pct * 100).toFixed(2)}%`,
  ];
  // esc() each line so the example is safe even if a future series carried markup.
  for (const l of lines) console.log(esc(l));
}
