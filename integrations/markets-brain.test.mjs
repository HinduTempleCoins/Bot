// markets-brain.test.mjs — OFFLINE tests for the stocks/bonds/futures brain extension.
// One URL-routed fake fetch feeds BOTH the new sections (Yahoo + Stooq) and the composed
// markets-surface side (crypto/FX/metals/commodities), through the shared __setFetch. No network is
// ever touched; every failure path is asserted to soft-fail to a safe shape, never to throw.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildExtensionView, buildBrainView, buildSubdomainView,
  renderBrainHtml, renderSubdomainHtml, handler, __setFetch,
} from './markets-brain.mjs';

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => obj });
const okText = (s) => ({ ok: true, status: 200, text: async () => s, json: async () => ({}) });
const dead = { ok: false, status: 503, json: async () => ({}), text: async () => '' };

// Yahoo decoded-symbol → mocked regularMarketPrice. Treasury indices report 10× the yield.
const YAHOO = {
  '^GSPC': 5400, '^NDX': 19000, '^DJI': 39000, 'AAPL': 210, 'MSFT': 440, 'NVDA': 1200,
  '^TNX': 42.0, '^FVX': 44.0, '^TYX': 44.5,            // 10× yields → 4.20%, 4.40%, 4.45%
  'ES=F': 5410, 'NQ=F': 19010, 'CL=F': 78.2, 'GC=F': 2350,
  // surface (markets-surface) FX/metals/commodity Yahoo symbols
  'EURUSD=X': 1.085, 'GBPUSD=X': 1.27, 'USDJPY=X': 156.4, 'SI=F': 30.5, 'NG=F': 2.6,
};
// Stooq symbol → close, chosen to AGREE with Yahoo (yields in percent directly).
const STOOQ = {
  '^spx': 5402, '^ndx': 19010, '^dji': 39020, 'aapl.us': 210.4, 'msft.us': 440.8, 'nvda.us': 1201,
  '2us.b': 4.41, '5us.b': 4.39, '10us.b': 4.21, '30us.b': 4.46,
  'es.f': 5408, 'nq.f': 19005, 'cl.f': 78.4, 'gc.f': 2351,
};

function makeFetch(over = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes('finance.yahoo.com')) {
      if (over.yahoo === 'dead') return dead;
      const sym = decodeURIComponent((u.match(/chart\/([^?]+)/) || [])[1] || '');
      const px = YAHOO[sym];
      if (px == null) return dead;
      return ok({ chart: { result: [{ meta: { regularMarketPrice: px } }] } });
    }
    if (u.includes('stooq.com')) {
      if (over.stooq === 'dead') return dead;
      const sym = decodeURIComponent((u.match(/[?&]s=([^&]+)/) || [])[1] || '');
      const px = STOOQ[sym];
      if (px == null) return okText('Symbol,Date,Time,Open,High,Low,Close,Volume\nX,N/D,N/D,N/D,N/D,N/D,N/D,N/D');
      return okText(`Symbol,Date,Time,Open,High,Low,Close,Volume\n${sym},2026-06-13,22:00:00,${px},${px},${px},${px},1000`);
    }
    // crypto sources from markets-surface — give bitcoin a 4-source cluster so the surface renders
    if (u.includes('api.coingecko.com')) {
      const id = decodeURIComponent((u.match(/ids=([^&]+)/) || [])[1] || '');
      return ok({ [id]: { usd: { bitcoin: 60000, ethereum: 3000, solana: 150, hive: 0.3 }[id] ?? 1 } });
    }
    if (u.includes('coinpaprika.com')) return ok({ quotes: { USD: { price: 60100 } } });
    if (u.includes('coincap.io')) return ok({ data: { priceUsd: '59900' } });
    if (u.includes('api.coinbase.com')) return ok({ data: { amount: '60050' } });
    if (u.includes('open.er-api.com')) {
      const base = (u.match(/latest\/([^?/]+)/) || [])[1] || '';
      return ok({ rates: base === 'EUR' ? { USD: 1.0855 } : base === 'GBP' ? { USD: 1.271 } : base === 'USD' ? { JPY: 156.5 } : {} });
    }
    if (u.includes('frankfurter')) return dead;
    return dead;
  };
}

test('buildExtensionView: builds stocks, bonds and futures from mocked Yahoo + Stooq', async () => {
  __setFetch(makeFetch());
  const v = await buildExtensionView({ asOf: '2026-06-14T00:00:00.000Z' });
  assert.equal(v.ok, true);
  assert.equal(v.readOnly, true);
  assert.deepEqual(v.sections.map((s) => s.key), ['stocks', 'bonds', 'futures']);
  for (const s of v.sections) {
    assert.ok(s.entries.length > 0, `${s.key} has entries`);
    assert.ok(typeof s.note === 'string' && s.note.length > 0, `${s.key} has a bot note`);
  }
  // a stock entry shape
  const spx = v.sections[0].entries.find((e) => e.symbol === 'SPX');
  assert.ok(spx && spx.price > 5000 && spx.price < 6000, 'SPX in mocked band');
  assert.equal(spx.market, 'stocks');
  assert.equal(spx.asOf, '2026-06-14T00:00:00.000Z');
  // a bond entry: Yahoo ^TNX (42.0) scaled to 4.20% agrees with Stooq 4.21%
  const us10 = v.sections[1].entries.find((e) => e.symbol === 'US10Y');
  assert.ok(us10.price > 4 && us10.price < 5, 'US10Y yield read as a percent, not 10×');
  assert.equal(us10.unit, '% yield');
});

test('confidence reflects agreement: two agreeing sources reach confident', async () => {
  __setFetch(makeFetch());
  const v = await buildExtensionView({ stocks: ['SPX'], bonds: [], futures: [] });
  const spx = v.sections[0].entries[0];
  assert.equal(spx.sources, 2, 'yahoo + stooq both answered');
  assert.equal(spx.confident, true, 'two agreeing sources are confident');
  assert.ok(spx.score >= 55, `clustered score ${spx.score} should be at least moderate`);
});

test('a dead source soft-fails — the other still renders, confidence falls', async () => {
  __setFetch(makeFetch());
  const full = await buildExtensionView({ stocks: ['SPX'], bonds: [], futures: [] });
  const spxFull = full.sections[0].entries[0];

  __setFetch(makeFetch({ stooq: 'dead' }));
  const degraded = await buildExtensionView({ stocks: ['SPX'], bonds: [], futures: [] });
  const spxDeg = degraded.sections[0].entries[0];

  assert.ok(spxDeg.price > 0, 'surviving Yahoo source still produces a price');
  assert.ok(spxDeg.sources < spxFull.sources, 'fewer sources after one dies');
  assert.equal(spxDeg.confident, false, 'a lone surviving source is never confident');
  assert.ok(spxDeg.score < spxFull.score, 'lone source scores lower than the agreeing pair');
});

test('ALL sources dead → zeroed entries, section still renders, never throws', async () => {
  __setFetch(async () => dead);
  const v = await buildExtensionView({ stocks: ['SPX'], bonds: ['US10Y'], futures: ['ES'] });
  assert.equal(v.ok, true);
  for (const s of v.sections) {
    for (const e of s.entries) {
      assert.equal(e.price, 0);
      assert.equal(e.sources, 0);
      assert.equal(e.confident, false);
    }
    // note degrades gracefully to the "no live reads" message
    assert.ok(s.note.includes('No live reads'), `${s.key} note reflects the dead feeds`);
  }
});

test('garbage / throwing fetch soft-fails the whole extension (no throw)', async () => {
  __setFetch(() => { throw new Error('boom'); });
  const v = await buildExtensionView({ stocks: ['SPX'], bonds: ['US10Y'], futures: ['ES'] });
  assert.equal(v.ok, true);
  for (const s of v.sections) for (const e of s.entries) {
    assert.equal(e.confident, false);
    assert.ok(!(e.price > 0));
  }
});

test('unknown symbol soft-fails to a zeroed entry', async () => {
  __setFetch(makeFetch());
  const v = await buildExtensionView({ stocks: ['NOTASTOCK'], bonds: [], futures: [] });
  const e = v.sections[0].entries[0];
  assert.equal(e.market, 'stocks');
  assert.equal(e.price, 0);
  assert.equal(e.confident, false);
  assert.equal(e.confidence, 'none');
});

test('buildBrainView: composes surface (crypto/fx/metals/commodities) + new sections', async () => {
  __setFetch(makeFetch());
  const v = await buildBrainView({ asOf: '2026-06-14T00:00:00.000Z' });
  assert.equal(v.ok, true);
  const keys = v.sections.map((s) => s.key);
  for (const k of ['crypto', 'fx', 'metals', 'commodities', 'stocks', 'bonds', 'futures']) {
    assert.ok(keys.includes(k), `brain has ${k} section`);
  }
  // every section carries a plain-language note in the same voice
  for (const s of v.sections) assert.ok(typeof s.note === 'string' && s.note.length > 0, `${s.key} has a note`);
  assert.ok(v.summary.entries > 7, 'instruments across all sections');
});

test('buildSubdomainView: returns the right section per subdomain', async () => {
  __setFetch(makeFetch());
  for (const [sub, expect] of [['stocks', 'stocks'], ['equities', 'stocks'], ['bonds', 'bonds'],
    ['treasuries', 'bonds'], ['futures', 'futures'], ['crypto', 'crypto'], ['forex', 'fx'], ['metals', 'metals']]) {
    const b = await buildSubdomainView(sub);
    assert.equal(b.ok, true, `${sub} ok`);
    assert.equal(b.section, expect, `${sub} → ${expect}`);
    assert.ok(b.entries.length > 0, `${sub} has entries`);
    assert.ok(typeof b.note === 'string' && b.note.length > 0, `${sub} has a what-the-bots-see note`);
  }
});

test('buildSubdomainView: garbage subdomain soft-fails with the valid list', async () => {
  __setFetch(makeFetch());
  const b = await buildSubdomainView('<script>');
  assert.equal(b.ok, false);
  assert.equal(b.section, null);
  assert.ok(Array.isArray(b.validSubdomains) && b.validSubdomains.includes('stocks'));
});

test('buildSubdomainView: bond note states yields and flags inversion factually', async () => {
  // craft an inverted curve: 2Y above 10Y
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('stooq.com')) {
      const sym = decodeURIComponent((u.match(/[?&]s=([^&]+)/) || [])[1] || '');
      const px = { '2us.b': 5.10, '10us.b': 4.10, '30us.b': 4.30 }[sym];
      if (px == null) return dead;
      return okText(`Symbol,Date,Time,Open,High,Low,Close,Volume\n${sym},2026-06-13,22:00,${px},${px},${px},${px},1`);
    }
    if (u.includes('finance.yahoo.com')) {
      const sym = decodeURIComponent((u.match(/chart\/([^?]+)/) || [])[1] || '');
      const px = { '^FVX': 51.0, '^TNX': 41.0, '^TYX': 43.0 }[sym];
      if (px == null) return dead;
      return ok({ chart: { result: [{ meta: { regularMarketPrice: px } }] } });
    }
    return dead;
  });
  const b = await buildSubdomainView('bonds', { bonds: ['US2Y', 'US10Y', 'US30Y'] });
  assert.ok(b.note.includes('%'), 'note states yields in percent');
  assert.ok(/invert/i.test(b.note), 'note flags the inversion');
});

test('renderBrainHtml: escapes content and renders sections + notes', async () => {
  __setFetch(makeFetch());
  const v = await buildBrainView({ asOf: '2026-06-14T00:00:00.000Z' });
  const html = renderBrainHtml(v);
  assert.ok(html.includes('<!doctype html>'));
  assert.ok(html.includes('read-only'));
  assert.ok(html.includes('Stocks') && html.includes('Bonds') && html.includes('Futures'));
  assert.ok(/badge (high|moderate|limited|low|none)/.test(html));
  assert.ok(html.includes('botnote'), 'per-section bot note rendered');
});

test('renderSubdomainHtml: malicious content is escaped, not injected', () => {
  const bundle = {
    ok: true, subdomain: 'stocks', section: 'stocks', title: 'Stocks & indices',
    asOf: 'now', clarityNote: 'note', note: 'a note',
    entries: [{ symbol: 'X', label: '<script>alert(1)</script>', market: 'stocks', price: 1, unit: 'USD',
      confidence: 'low', score: 25, confident: false, sources: 1, sourceNames: ['a"b'], spreadPct: 0 }],
  };
  const html = renderSubdomainHtml(bundle);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script not present');
  assert.ok(html.includes('&lt;script&gt;'), 'label escaped');
  assert.ok(html.includes('a&quot;b'), 'source name escaped');
});

test('handler: GET /api/markets-brain returns the full brain JSON', async () => {
  __setFetch(makeFetch());
  const req = { url: '/api/markets-brain', headers: { host: 'localhost' } };
  let status, headers, body;
  const res = { writeHead(s, h) { status = s; headers = h; }, end(b) { body = b; } };
  await handler(req, res);
  assert.equal(status, 200);
  assert.match(headers['content-type'], /application\/json/);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.sections.some((s) => s.key === 'stocks'));
});

test('handler: GET /api/markets-brain/:subdomain returns one bundle', async () => {
  __setFetch(makeFetch());
  const req = { url: '/api/markets-brain/bonds', headers: { host: 'localhost' } };
  let status, headers, body;
  const res = { writeHead(s, h) { status = s; headers = h; }, end(b) { body = b; } };
  await handler(req, res);
  assert.equal(status, 200);
  assert.match(headers['content-type'], /application\/json/);
  const parsed = JSON.parse(body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.section, 'bonds');
});

test('handler: /stocks returns the per-subdomain HTML page; never throws', async () => {
  __setFetch(makeFetch());
  const req = { url: '/stocks', headers: { host: 'localhost' } };
  let headers, body;
  const res = { writeHead(s, h) { headers = h; }, end(b) { body = b; } };
  await handler(req, res);
  assert.match(headers['content-type'], /text\/html/);
  assert.ok(body.includes('Stocks &amp; indices'), 'subdomain section title (escaped) rendered');
});
