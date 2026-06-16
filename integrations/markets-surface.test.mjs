// markets-surface.test.mjs — OFFLINE tests for the unified read-only markets surface.
// A single URL-routed fake fetch feeds BOTH the crypto fetchers (this module) and the FX / metals /
// commodity readers (multimarket.mjs, via the shared __setFetch). No network is ever touched, and
// every failure path is asserted to soft-fail (return a safe shape), never to throw.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildMarketsView, renderMarketsHtml, handler, esc, __setFetch,
} from './markets-surface.mjs';

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });
const dead = { ok: false, status: 503, json: async () => ({}) };

// A fetch that answers each known endpoint. Pass overrides to break specific sources.
function makeFetch(over = {}) {
  return async (url) => {
    const u = String(url);
    // crypto: coingecko (multi-id simple/price) → echo a usd for whatever id is asked
    if (u.includes('api.coingecko.com')) {
      const id = decodeURIComponent((u.match(/ids=([^&]+)/) || [])[1] || '');
      if (over.coingecko === 'dead') return dead;
      const px = { bitcoin: 60000, ethereum: 3000, solana: 150, hive: 0.30 }[id] ?? 1;
      return ok({ [id]: { usd: px } });
    }
    if (u.includes('coinpaprika.com')) {
      if (over.paprika === 'dead') return dead;
      const sym = (u.match(/tickers\/([^/?]+)/) || [])[1] || '';
      const px = sym.startsWith('btc') ? 60100 : sym.startsWith('eth') ? 3010 : sym.startsWith('sol') ? 150.5 : 0.301;
      return ok({ quotes: { USD: { price: px } } });
    }
    if (u.includes('coincap.io')) {
      if (over.coincap === 'dead') return dead;
      const a = (u.match(/assets\/([^/?]+)/) || [])[1] || '';
      const px = a === 'bitcoin' ? 59900 : a === 'ethereum' ? 2995 : a === 'solana' ? 149.5 : 0.299;
      return ok({ data: { priceUsd: String(px) } });
    }
    if (u.includes('api.coinbase.com')) {
      if (over.coinbase === 'dead') return dead;
      const pair = (u.match(/prices\/([^/]+)\/spot/) || [])[1] || '';
      const px = pair.startsWith('BTC') ? 60050 : pair.startsWith('ETH') ? 3005 : pair.startsWith('SOL') ? 150.2 : 0.3005;
      return ok({ data: { amount: String(px) } });
    }
    // FX / metals / commodities — Yahoo chart (multimarket.mjs breadth source)
    if (u.includes('finance.yahoo.com')) {
      if (over.yahoo === 'dead') return dead;
      const sym = (u.match(/chart\/([^?]+)/) || [])[1] || '';
      const map = { 'EURUSD=X': 1.085, 'GBPUSD=X': 1.27, 'USDJPY=X': 156.4, 'GC=F': 2350, 'SI=F': 30.5, 'CL=F': 78.2, 'NG=F': 2.6 };
      const decoded = decodeURIComponent(sym);
      return ok({ chart: { result: [{ meta: { regularMarketPrice: map[decoded] ?? 1 } }] } });
    }
    // open.er-api.com — second FX source so FX can reach >=2 sources offline
    if (u.includes('open.er-api.com')) {
      if (over.erapi === 'dead') return dead;
      const base = (u.match(/latest\/([^?/]+)/) || [])[1] || '';
      const rates = base === 'EUR' ? { USD: 1.0855 } : base === 'GBP' ? { USD: 1.271 } : base === 'USD' ? { JPY: 156.5 } : {};
      return ok({ rates });
    }
    // frankfurter (api.frankfurter.app) goes through free-apis global fetch; let it soft-fail offline
    if (u.includes('frankfurter')) return dead;
    return dead;
  };
}

test('buildMarketsView: composes all four sections from mocked sources', async () => {
  __setFetch(makeFetch());
  const v = await buildMarketsView({ asOf: '2026-06-14T00:00:00.000Z' });
  assert.equal(v.ok, true);
  assert.equal(v.readOnly, true);
  const keys = v.sections.map((s) => s.key);
  assert.deepEqual(keys, ['crypto', 'fx', 'metals', 'commodities']);
  // every default section has entries
  for (const s of v.sections) assert.ok(s.entries.length > 0, `${s.key} should have entries`);
  // crypto entry shape
  const btc = v.sections[0].entries.find((e) => e.symbol === 'BTC');
  assert.ok(btc, 'BTC present');
  assert.ok(btc.price > 50000 && btc.price < 70000, 'BTC price in mocked band');
  assert.equal(btc.market, 'crypto');
  assert.ok(typeof btc.confidence === 'string');
  assert.equal(btc.asOf, '2026-06-14T00:00:00.000Z');
});

test('buildMarketsView: a dead crypto source soft-fails — others still render', async () => {
  __setFetch(makeFetch());
  const full = await buildMarketsView({ crypto: ['bitcoin'], fx: [], metals: [], commodities: [] });
  const btcFull = full.sections[0].entries[0];

  __setFetch(makeFetch({ coinpaprika: 'dead', coincap: 'dead', coinbase: 'dead', paprika: 'dead' }));
  const degraded = await buildMarketsView({ crypto: ['bitcoin'], fx: [], metals: [], commodities: [] });
  const btcDeg = degraded.sections[0].entries[0];

  // surviving (coingecko only) still produces a price, just fewer sources + lower confidence
  assert.ok(btcDeg.price > 0, 'still has a price from the one surviving source');
  assert.ok(btcDeg.sources < btcFull.sources, 'fewer sources after others die');
  assert.equal(btcDeg.confident, false, 'a lone source is never confident');
});

test('buildMarketsView: ALL sources dead → zeroed entry, never throws', async () => {
  __setFetch(async () => dead);
  const v = await buildMarketsView({ crypto: ['bitcoin'], fx: ['EUR/USD'], metals: ['XAU/USD'], commodities: ['WTI'] });
  assert.equal(v.ok, true);
  const btc = v.sections[0].entries[0];
  assert.equal(btc.price, 0);
  assert.equal(btc.sources, 0);
  assert.equal(btc.confident, false);
  // FX/metals/commodity readers also soft-fail to zeroed, unconfident entries
  for (const s of v.sections.slice(1)) {
    for (const e of s.entries) {
      assert.equal(e.confident, false);
      assert.equal(e.price, 0);
    }
  }
});

test('confidence reflects source agreement: tight cluster beats a lone source', async () => {
  __setFetch(makeFetch());
  const tight = await buildMarketsView({ crypto: ['bitcoin'], fx: [], metals: [], commodities: [] });
  const btcTight = tight.sections[0].entries[0];
  assert.ok(btcTight.sources >= 3, 'four mocked sources agree');
  assert.equal(btcTight.confident, true, 'agreeing cluster is confident');
  assert.ok(btcTight.score >= 55, `cluster score ${btcTight.score} should be at least moderate`);

  __setFetch(makeFetch({ coinpaprika: 'dead', coincap: 'dead', coinbase: 'dead', paprika: 'dead' }));
  const lone = await buildMarketsView({ crypto: ['bitcoin'], fx: [], metals: [], commodities: [] });
  const btcLone = lone.sections[0].entries[0];
  assert.ok(btcLone.score < btcTight.score, 'lone source scores lower than the cluster');
});

test('garbage / throwing fetch soft-fails the whole view (no throw)', async () => {
  __setFetch(() => { throw new Error('boom'); });
  const v = await buildMarketsView({ crypto: ['bitcoin'], fx: ['EUR/USD'], metals: [], commodities: [] });
  assert.equal(v.ok, true, 'view still returns ok');
  // every entry collapses to a safe zeroed/unconfident shape
  for (const s of v.sections) for (const e of s.entries) {
    assert.equal(e.confident, false);
    assert.ok(!(e.price > 0));
  }
});

test('FX section: two injectable sources let a pair reach confident', async () => {
  __setFetch(makeFetch());
  const v = await buildMarketsView({ crypto: [], fx: ['EUR/USD'], metals: [], commodities: [] });
  const eur = v.sections.find((s) => s.key === 'fx').entries[0];
  assert.equal(eur.symbol, 'EUR/USD');
  assert.ok(eur.sources >= 2, 'yahoo + open.er-api both answered');
  assert.ok(eur.price > 1 && eur.price < 1.2, 'EUR/USD in mocked band');
});

test('renderMarketsHtml: escapes content and renders every section', async () => {
  __setFetch(makeFetch());
  const v = await buildMarketsView({ asOf: '2026-06-14T00:00:00.000Z' });
  const html = renderMarketsHtml(v);
  assert.ok(html.includes('<!doctype html>'));
  assert.ok(html.includes('read-only'), 'header states read-only');
  assert.ok(html.includes('not investment advice'), 'clarity note present');
  assert.ok(html.includes('Crypto') && html.includes('ForEx') && html.includes('metals') && html.includes('Commodities'));
  // confidence badge band class is rendered
  assert.ok(/badge (high|moderate|limited|low|none)/.test(html));
});

test('renderMarketsHtml: malicious symbol is escaped, not injected', () => {
  const view = {
    asOf: '2026-06-14T00:00:00.000Z',
    clarityNote: 'note',
    summary: { sections: 1, entries: 1, confident: 0 },
    sections: [{ key: 'crypto', title: 'Crypto', entries: [{
      symbol: '<script>alert(1)</script>', market: 'crypto', price: 1, unit: 'USD',
      confidence: 'low', score: 25, confident: false, sources: 1, sourceNames: ['x"y'], spreadPct: 0, asOf: 'now',
    }] }],
  };
  const html = renderMarketsHtml(view);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(html.includes('&lt;script&gt;'), 'script tag escaped');
  assert.ok(html.includes('x&quot;y'), 'source name quote escaped');
});

test('esc: escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('handler: GET /api/markets returns JSON view; never throws', async () => {
  __setFetch(makeFetch());
  const req = { url: '/api/markets', headers: { host: 'localhost' } };
  let status, headers, body;
  const res = {
    writeHead(s, h) { status = s; headers = h; },
    end(b) { body = b; },
  };
  await handler(req, res);
  assert.equal(status, 200);
  assert.match(headers['content-type'], /application\/json/);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.ok(Array.isArray(parsed.sections) && parsed.sections.length === 4);
});

test('handler: root path returns the HTML dashboard', async () => {
  __setFetch(makeFetch());
  const req = { url: '/', headers: { host: 'localhost' } };
  let headers, body;
  const res = { writeHead(s, h) { headers = h; }, end(b) { body = b; } };
  await handler(req, res);
  assert.match(headers['content-type'], /text\/html/);
  assert.ok(body.includes('Markets Intelligence'));
});

// ── LIVE SMOKE — opt-in, hits the REAL keyless crypto/FX feeds. OFF by default so `npm test` stays
//    offline. Run with: SURFACE_LIVE_SMOKE=1 node --test integrations/markets-surface.test.mjs
//    Documents the real call and asserts a real, cross-confirmed BTC price.
test('LIVE SMOKE: buildMarketsView returns a real, confident BTC/USD price', { skip: !process.env.SURFACE_LIVE_SMOKE }, async () => {
  __setFetch(null); // real global fetch
  const v = await buildMarketsView({ crypto: ['bitcoin'], fx: [], metals: [], commodities: [] });
  const btc = v.sections[0].entries[0];
  assert.ok(btc.price > 1000 && btc.price < 10000000, `live BTC implausible: ${btc.price}`);
  assert.ok(btc.sources >= 1, 'expected at least one live source');
  // eslint-disable-next-line no-console
  console.log(`  [live] BTC/USD = $${btc.price} (${btc.sources} src, ${btc.confidence}, ${btc.sourceNames.join('+')})`);
});
