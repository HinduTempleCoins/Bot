// multimarket.test.mjs — OFFLINE tests for the multi-market (FX / metals / commodities) reader.
// The pure confidence math (median / scoreQuotes) is tested with crafted inputs. The end-to-end
// getMarketQuote / getMultiMarket paths are tested with an injected fetch (module __setFetch + a
// stubbed crypto.frankfurter via global fetch) so NO network is ever touched. Everything soft-fails.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  median, scoreQuotes, getMarketQuote, getMultiMarket, firstStepRead, SYMBOLS, __setFetch,
} from './multimarket.mjs';

// ── pure: median ─────────────────────────────────────────────────────────────
test('median: odd-length picks the middle (order-independent)', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1.2345]), 1.2345);
});
test('median: even-length averages the two middle elements', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

// ── pure: scoreQuotes (confidence math) ──────────────────────────────────────
test('scoreQuotes: empty input → zeroed, not confident, no confidence', () => {
  assert.deepEqual(scoreQuotes([]), { price: 0, sources: 0, spreadPct: null, confident: false, score: 0, confidence: 'none' });
});

test('scoreQuotes: a lone source is never confident and capped at "low"', () => {
  const r = scoreQuotes([1.085]);
  assert.equal(r.price, 1.085);
  assert.equal(r.sources, 1);
  assert.equal(r.confident, false);
  assert.equal(r.score, 25);
  assert.equal(r.confidence, 'low');
});

test('scoreQuotes: tight cluster of 3 → confident, high score', () => {
  const r = scoreQuotes([1.085, 1.086, 1.0855]); // all within 5%
  assert.equal(r.sources, 3);
  assert.equal(r.confident, true);
  assert.ok(r.spreadPct <= 5);
  assert.ok(r.score >= 80, `score ${r.score} should land in the high band`);
  assert.equal(r.confidence, 'high');
});

test('scoreQuotes: a gross outlier is rejected outside the 35% band', () => {
  // median of [100,101,102,1000] is 101.5; 1000 dropped → survivors re-median to 101.
  const r = scoreQuotes([100, 101, 102, 1000]);
  assert.equal(r.sources, 3, 'the 1000 outlier is dropped');
  assert.equal(r.price, 101);
  assert.equal(r.confident, true);
});

test('scoreQuotes: two sources too far apart → kept but not confident, lower score', () => {
  const r = scoreQuotes([100, 130]); // both within 35% band, but spread ~26%
  assert.equal(r.sources, 2);
  assert.equal(r.confident, false);
  assert.ok(r.spreadPct > 5);
  assert.ok(r.score < 80, `score ${r.score} should not be high with a wide spread`);
});

test('scoreQuotes: more agreeing sources scores higher than fewer (monotonic in agreement)', () => {
  const two = scoreQuotes([100, 100]);
  const four = scoreQuotes([100, 100, 100, 100]);
  assert.ok(four.score > two.score, `four (${four.score}) should beat two (${two.score})`);
});

test('scoreQuotes: when everything is far from the median, falls back to all values', () => {
  const r = scoreQuotes([50, 150]); // both 50% off median 100 → kept empty → fall back
  assert.equal(r.sources, 2);
  assert.equal(r.price, 100);
  assert.equal(r.confident, false);
});

// ── integration: injected fetch (module + global, both offline) ──────────────
// getMarketQuote uses the module's _fetch for Yahoo + open.er-api, and crypto.frankfurter (which
// uses the global fetch) for the ECB anchor. We stub both. crypto.frankfurter(base, quote) hits
// api.frankfurter.app and reads .rates[quote].

function installModuleFetch(routes) {
  __setFetch(async (url) => {
    const u = String(url);
    for (const [needle, body] of routes) {
      if (u.includes(needle)) return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    throw new Error(`unexpected module fetch in offline test: ${u}`);
  });
}
function installGlobalFetch(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [needle, body] of routes) {
      if (u.includes(needle)) return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    throw new Error(`unexpected global fetch in offline test: ${u}`);
  };
  return () => { globalThis.fetch = real; };
}
const yahoo = (price) => ({ chart: { result: [{ meta: { regularMarketPrice: price } }] } });
const frank = (quote, rate) => ({ rates: { [quote]: rate } });
const erapi = (quote, rate) => ({ rates: { [quote]: rate } });

test('getMarketQuote: EUR/USD aggregates Yahoo + ECB + open.er-api → confident', async () => {
  installModuleFetch([
    ['finance.yahoo.com', yahoo(1.0850)],
    ['open.er-api.com/v6/latest/EUR', erapi('USD', 1.0858)],
  ]);
  const restoreGlobal = installGlobalFetch([
    ['api.frankfurter.app', frank('USD', 1.0846)],
  ]);
  try {
    const r = await getMarketQuote('EUR/USD');
    assert.equal(r.market, 'forex');
    assert.equal(r.sources, 3, 'yahoo + frankfurter + open.er-api');
    assert.equal(r.confident, true);
    assert.ok(r.price >= 1.084 && r.price <= 1.086, `median ${r.price}`);
    assert.ok('yahoo' in r.quotes && 'frankfurter' in r.quotes && 'open.er-api' in r.quotes);
    assert.equal(r.confidence, 'high');
  } finally { __setFetch(null); restoreGlobal(); }
});

test('getMarketQuote: gold (XAU/USD via GOLD alias) single Yahoo source → not confident', async () => {
  installModuleFetch([['finance.yahoo.com', yahoo(2345.6)]]);
  try {
    const r = await getMarketQuote('GOLD'); // alias → XAU/USD
    assert.equal(r.symbol, 'XAU/USD');
    assert.equal(r.market, 'metal');
    assert.equal(r.unit, 'USD/oz');
    assert.equal(r.sources, 1);
    assert.equal(r.price, 2345.6);
    assert.equal(r.confident, false, 'one feed can never be confident by design');
    assert.equal(r.confidence, 'low');
  } finally { __setFetch(null); }
});

test('getMarketQuote: silver XAG/USD reads the silver futures symbol', async () => {
  assert.equal(SYMBOLS['XAG/USD'].yahoo, 'SI=F');
  installModuleFetch([['finance.yahoo.com', yahoo(29.85)]]);
  try {
    const r = await getMarketQuote('XAG/USD');
    assert.equal(r.market, 'metal');
    assert.equal(r.price, 29.85);
    assert.equal(r.sources, 1);
  } finally { __setFetch(null); }
});

test('getMarketQuote: an FX feed diverging wildly is outlier-rejected', async () => {
  installModuleFetch([
    ['finance.yahoo.com', yahoo(1.0850)],
    ['open.er-api.com/v6/latest/EUR', erapi('USD', 9.99)], // broken/stale feed
  ]);
  const restoreGlobal = installGlobalFetch([['api.frankfurter.app', frank('USD', 1.0846)]]);
  try {
    const r = await getMarketQuote('EUR/USD');
    assert.equal(r.sources, 2, 'the 9.99 quote is dropped from the median');
    assert.ok(r.price >= 1.084 && r.price <= 1.086, `survivor median ${r.price}`);
    assert.equal(r.confident, true);
    assert.equal(+r.quotes['open.er-api'], 9.99, 'bad quote still reported in raw quotes');
  } finally { __setFetch(null); restoreGlobal(); }
});

test('getMarketQuote: total network failure soft-fails (never throws)', async () => {
  installModuleFetch([]); // module fetch throws
  const restoreGlobal = installGlobalFetch([]); // frankfurter throws too
  try {
    const r = await getMarketQuote('EUR/USD');
    assert.equal(r.price, 0);
    assert.equal(r.sources, 0);
    assert.equal(r.confident, false);
    assert.equal(r.score, 0);
    assert.deepEqual(r.quotes, {});
  } finally { __setFetch(null); restoreGlobal(); }
});

test('getMarketQuote: unknown symbol → unknown market, soft result (no throw)', async () => {
  const r = await getMarketQuote('NOT-A-MARKET');
  assert.equal(r.market, 'unknown');
  assert.equal(r.price, 0);
  assert.equal(r.confident, false);
  assert.equal(r.sources, 0);
});

test('getMultiMarket / firstStepRead: EUR/USD + gold + silver in one call', async () => {
  // Yahoo symbols are URL-encoded in the request path (= → %3D), so route on the encoded form.
  installModuleFetch([
    ['EURUSD%3DX', yahoo(1.0850)],
    ['open.er-api.com/v6/latest/EUR', erapi('USD', 1.0858)],
    ['GC%3DF', yahoo(2345.6)],
    ['SI%3DF', yahoo(29.85)],
  ]);
  const restoreGlobal = installGlobalFetch([['api.frankfurter.app', frank('USD', 1.0846)]]);
  try {
    const rows = await firstStepRead();
    assert.equal(rows.length, 3);
    const [fx, gold, silver] = rows;
    assert.equal(fx.symbol, 'EUR/USD');
    assert.equal(fx.confident, true);
    assert.equal(gold.symbol, 'XAU/USD');
    assert.equal(gold.price, 2345.6);
    assert.equal(silver.symbol, 'XAG/USD');
    assert.equal(silver.price, 29.85);

    // getMultiMarket accepts a single symbol too (normalized to a one-element array).
    const one = await getMultiMarket('GOLD');
    assert.equal(one.length, 1);
    assert.equal(one[0].symbol, 'XAU/USD');
  } finally { __setFetch(null); restoreGlobal(); }
});
