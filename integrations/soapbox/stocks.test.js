// stocks.test.js — the stock data layer + Stock Index hardening + market breadth (tasks #195/#196),
// with an injected fetch so it's fully offline and deterministic. Builds synthetic Yahoo chart/quote
// responses keyed off the requested symbol so each name in the universe can be shaped independently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stockSearch, stockQuote, stockChart, indexScore, stockIndex,
  assessIndexQuality, breadthScore, marketBreadth, __setFetch,
} from './stocks.mjs';
import { invalidate } from './cache.mjs';

// extract the symbol from a Yahoo chart/quote/search URL (URL-encoded ^ stays %5E).
function symOf(url) {
  const m = String(url).match(/\/chart\/([^?]+)/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : null;
}
// a rising/falling daily close series for `n` bars; `slope` sets the daily step.
function chartFor(n, start, slope) {
  const now = Math.floor(Date.now() / 1000);
  const t = [], c = [];
  for (let i = 0; i < n; i++) { t.push(now - (n - i) * 86400); c.push(Math.max(1, start + i * slope)); }
  return { t, c };
}
function ok(json) { return { ok: true, status: 200, json: async () => json }; }

// A universe where AAPL/MSFT rise strongly, KO drifts, INTC falls hard. Quote meta carries the live
// price (= last close) + 52w bounds so position/breadth are well-defined.
const SHAPES = {
  AAPL: { n: 400, start: 100, slope: 0.6 },
  MSFT: { n: 400, start: 100, slope: 0.5 },
  NVDA: { n: 400, start: 100, slope: 0.7 },
  KO:   { n: 400, start: 100, slope: 0.02 },
  INTC: { n: 400, start: 200, slope: -0.3 },
  SHORT: { n: 10, start: 50, slope: 1 }, // too little history to score → drives coverage < 100%
};
function stub() {
  return async (url) => {
    const sym = symOf(url);
    const shape = SHAPES[sym] || SHAPES.AAPL;
    const { t, c } = chartFor(shape.n, shape.start, shape.slope);
    const last = c[c.length - 1], prev = c[c.length - 2] || last;
    const isSearch = String(url).includes('/v1/finance/search');
    if (isSearch) return ok({ quotes: [{ symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchDisp: 'NASDAQ' }] });
    // a bare chart (no range param, the quote path) still returns meta + a short series.
    return ok({ chart: { result: [{
      meta: { regularMarketPrice: last, chartPreviousClose: prev, currency: 'USD', longName: sym + ' Inc.',
        fiftyTwoWeekHigh: Math.max(...c), fiftyTwoWeekLow: Math.min(...c), regularMarketVolume: 5_000_000, instrumentType: 'EQUITY' },
      timestamp: t, indicators: { quote: [{ close: c }] } }] } });
  };
}

test('stockSearch filters out crypto and normalizes rows', async () => {
  invalidate(); __setFetch(stub());
  const r = await stockSearch('apple');
  assert.ok(Array.isArray(r) && r.length >= 1);
  assert.equal(r[0].symbol, 'AAPL');
  assert.equal(r[0].typeLabel, 'Stock');
  __setFetch(null); invalidate();
});

test('stockQuote + stockChart return live + history', async () => {
  invalidate(); __setFetch(stub());
  const q = await stockQuote('AAPL');
  assert.ok(q && q.price > 0 && q.currency === 'USD');
  const h = await stockChart('AAPL', '365d');
  assert.ok(Array.isArray(h) && h.length > 30);
  __setFetch(null); invalidate();
});

test('indexScore produces a 0–100 composite with component breakdown', async () => {
  invalidate(); __setFetch(stub());
  const s = await indexScore('AAPL');
  assert.ok(s && s.score >= 0 && s.score <= 100);
  for (const k of ['momentum', 'trend', 'position', 'stability', 'liquidity']) {
    assert.ok(s.components[k] >= 0 && s.components[k] <= 100, `${k} in range`);
  }
  assert.equal(typeof s.goldenCross, 'boolean');
  __setFetch(null); invalidate();
});

test('indexScore returns null for too-short history', async () => {
  invalidate(); __setFetch(stub());
  assert.equal(await indexScore('SHORT'), null);
  __setFetch(null); invalidate();
});

test('assessIndexQuality computes coverage, median, outliers, confidence', () => {
  // 6 of 8 scored → 75% coverage; 95 is a clear MAD outlier among a tight cluster.
  const scored = [40, 41, 42, 43, 44, 95].map((score, i) => ({ symbol: 'S' + i, score }));
  const q = assessIndexQuality(scored, 8);
  assert.equal(q.requested, 8);
  assert.equal(q.scored, 6);
  assert.equal(q.coverage, 75);
  assert.ok(q.confident, 'coverage ≥60 with ≥3 scored → confident');
  assert.ok(q.outliers.includes('S5'), 'the 95 is flagged as an outlier');
  assert.ok(typeof q.median === 'number');
});

test('assessIndexQuality is not confident on thin coverage', () => {
  const scored = [50].map((score, i) => ({ symbol: 'X' + i, score }));
  const q = assessIndexQuality(scored, 30);
  assert.equal(q.confident, false);
  assert.deepEqual(q.outliers, []);
});

test('stockIndex ranks, dedupes, tags outliers, and carries a quality block', async () => {
  invalidate(); __setFetch(stub());
  const idx = await stockIndex({ symbols: ['AAPL', 'aapl', 'MSFT', 'NVDA', 'KO', 'INTC', 'SHORT'], limit: 10 });
  // 'AAPL' and 'aapl' dedupe to one; SHORT fails to score.
  assert.equal(idx.requested, 6, 'deduped universe');
  assert.ok(idx.count >= 4);
  // sorted descending by score, ranks assigned 1..n.
  for (let i = 1; i < idx.rows.length; i++) assert.ok(idx.rows[i - 1].score >= idx.rows[i].score);
  assert.equal(idx.rows[0].rank, 1);
  assert.ok('outlier' in idx.rows[0]);
  assert.ok(idx.quality && typeof idx.quality.coverage === 'number');
  assert.ok(idx.quality.coverage < 100, 'SHORT lowers coverage below 100%');
  __setFetch(null); invalidate();
});

test('breadthScore blends shares into a 0–100 (and tolerates missing inputs)', () => {
  assert.equal(breadthScore({ pctUp: 100, pctAbove50: 100, pctAbove200: 100, newHighsShare: 100 }), 100);
  assert.equal(breadthScore({ pctUp: 0, pctAbove50: 0, pctAbove200: 0, newHighsShare: 0 }), 0);
  const partial = breadthScore({ pctUp: 60, pctAbove50: null, pctAbove200: null, newHighsShare: null });
  assert.equal(partial, 60, 'with only pctUp present it is the weighted result of that one input');
  assert.equal(breadthScore({ pctUp: null, pctAbove50: null, pctAbove200: null, newHighsShare: null }), null);
});

test('marketBreadth computes advance-decline + trend breadth over a universe', async () => {
  invalidate(); __setFetch(stub());
  const b = await marketBreadth({ symbols: ['AAPL', 'MSFT', 'NVDA', 'KO', 'INTC'] });
  assert.equal(b.universe, 5);
  assert.ok(b.scored >= 4);
  assert.equal(b.advancers + b.decliners + b.unchanged, b.scored);
  assert.ok(b.advancers >= 3, 'most of the rising universe advances');
  assert.ok(b.decliners >= 1, 'INTC declines');
  assert.ok(b.pctUp >= 0 && b.pctUp <= 100);
  assert.ok(b.pctAbove50 >= 0 && b.pctAbove50 <= 100);
  assert.ok(b.breadthScore >= 0 && b.breadthScore <= 100);
  assert.equal(typeof b.confident, 'boolean');
  __setFetch(null); invalidate();
});

test('marketBreadth soft-fails to nulls when nothing scores', async () => {
  invalidate(); __setFetch(stub());
  const b = await marketBreadth({ symbols: ['SHORT'] });
  assert.equal(b.scored, 0);
  assert.equal(b.breadthScore, null);
  assert.equal(b.confident, false);
  __setFetch(null); invalidate();
});
