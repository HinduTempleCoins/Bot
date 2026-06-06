// stocks.test.mjs — the keyless Yahoo equities layer + the technical Stock Index ranking, with
// injected fetch (no network). Verifies graceful soft-fail, input validation, and that the index
// sanitizes / bounds its universe rather than trusting caller-supplied symbols.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockSearch, stockQuote, stockChart, indexScore, stockIndex, __setFetch } from './stocks.mjs';
import { invalidate } from './cache.mjs';

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });

// rising daily closes so the index math is well-defined and deterministic.
function chartJson(n = 400, start = 100, step = 0.4) {
  const now = Math.floor(Date.now() / 1000);
  const t = [], c = [];
  for (let i = 0; i < n; i++) { t.push(now - (n - i) * 86400); c.push(start + i * step); }
  return { chart: { result: [{ timestamp: t, indicators: { quote: [{ close: c }] }, meta: {
    regularMarketPrice: start + (n - 1) * step, chartPreviousClose: start + (n - 2) * step,
    longName: 'Test Co', currency: 'USD', fullExchangeName: 'NMS',
    fiftyTwoWeekHigh: start + (n - 1) * step, fiftyTwoWeekLow: start, regularMarketVolume: 5e7,
  } }] } };
}

function fetchStub() {
  return async (url) => {
    const u = String(url);
    if (u.includes('/v1/finance/search')) {
      return ok({ quotes: [
        { symbol: 'AAPL', shortname: 'Apple Inc.', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
        { symbol: 'BTC-USD', shortname: 'Bitcoin', quoteType: 'CRYPTOCURRENCY' }, // must be filtered out
      ] });
    }
    if (u.includes('/v8/finance/chart/')) return ok(chartJson());
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('stockSearch filters out crypto and normalizes rows', async () => {
  invalidate(); __setFetch(fetchStub());
  const r = await stockSearch('apple');
  assert.ok(r.length === 1 && r[0].symbol === 'AAPL', 'crypto dropped');
  assert.equal(r[0].typeLabel, 'Stock');
  __setFetch(null); invalidate();
});

test('stockSearch returns [] for empty query (no fetch)', async () => {
  invalidate();
  assert.deepEqual(await stockSearch('  '), []);
});

test('stockQuote returns a normalized quote', async () => {
  invalidate(); __setFetch(fetchStub());
  const q = await stockQuote('aapl');
  assert.equal(q.symbol, 'AAPL');
  assert.equal(typeof q.price, 'number');
  assert.equal(q.currency, 'USD');
  __setFetch(null); invalidate();
});

test('stockQuote null symbol → null, no throw', async () => {
  invalidate();
  assert.equal(await stockQuote(''), null);
});

test('indexScore yields a composite 0–100 score with component breakdown', async () => {
  invalidate(); __setFetch(fetchStub());
  const s = await indexScore('aapl');
  assert.ok(s && s.score >= 0 && s.score <= 100, `score ${s?.score} in range`);
  for (const k of ['momentum', 'trend', 'position', 'stability', 'liquidity']) {
    assert.ok(s.components[k] >= 0 && s.components[k] <= 100, `${k} in range`);
  }
  __setFetch(null); invalidate();
});

test('stockIndex ranks a universe and tags rank', async () => {
  invalidate(); __setFetch(fetchStub());
  const idx = await stockIndex({ symbols: ['AAPL', 'MSFT'], limit: 5 });
  assert.ok(idx.count >= 1);
  assert.equal(idx.rows[0].rank, 1);
  assert.ok(idx.rows.every((r) => r.score >= 0 && r.score <= 100));
  __setFetch(null); invalidate();
});

test('stockIndex sanitizes a garbage/oversized universe — dedupes, drops junk, bounds limit', async () => {
  invalidate(); __setFetch(fetchStub());
  // mix of dupes, lowercase, blanks, an injection-ish string, and a too-long ticker
  const dirty = ['aapl', 'AAPL', '', '   ', '<script>', 'TOOLONGSYMBOL123', 'MSFT'];
  const idx = await stockIndex({ symbols: dirty, limit: 999 });
  // only AAPL + MSFT survive the filter; both resolved → at most 2 rows
  assert.ok(idx.count <= 2, `count ${idx.count} bounded`);
  assert.ok(idx.rows.every((r) => /^[A-Z0-9.\-^=]{1,12}$/.test(r.symbol)));
  __setFetch(null); invalidate();
});

test('stockIndex with no valid symbols returns an empty, well-formed result', async () => {
  invalidate(); __setFetch(fetchStub());
  const idx = await stockIndex({ symbols: ['', '<x>', null], limit: 5 });
  assert.equal(idx.count, 0);
  assert.deepEqual(idx.rows, []);
  assert.equal(typeof idx.asOf, 'number');
  __setFetch(null); invalidate();
});

test('stockChart soft-fails to [] on upstream error', async () => {
  invalidate();
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.deepEqual(await stockChart('AAPL', '7d'), []);
  __setFetch(null); invalidate();
});
