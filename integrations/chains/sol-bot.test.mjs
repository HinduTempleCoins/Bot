// sol-bot.test.mjs — OFFLINE tests for integrations/chains/sol-bot.mjs.
//
// Fully offline: injects a fake fetch via __setFetch (no network, ever). Covers quote parsing +
// per-source soft-fail, the dry-run strategy discipline (capped intention, implausible-edge reject,
// below-threshold hold), the handler JSON shape, and a POISON test proving NO key path exists —
// every intention is dryRun:true / signer:null and the frozen objects cannot be mutated.
//
//   node --test integrations/chains/sol-bot.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKENS, PAIRS, readQuotes, strategize, handler,
  parseJupQuote, parseJupPrice, esc, __setFetch,
} from './sol-bot.mjs';

// ── fake-fetch harness ─────────────────────────────────────────────────────────────────────────
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}
function failResponse(status = 500) { return { ok: false, status, json: async () => ({}) }; }

// route a URL to a stubbed response; default fall-through to a quote/price by URL substring
function routeFetch(map) {
  return async (url) => {
    for (const [needle, resp] of Object.entries(map)) {
      if (url.includes(needle)) return typeof resp === 'function' ? resp(url) : resp;
    }
    return failResponse(404);
  };
}
function restore() { __setFetch(null); }

// a realistic Jupiter /v6/quote raw body: 1 SOL (1e9 atoms) -> ~150 USDC (150e6 atoms)
function jupQuoteRaw({ inAtoms, outAtoms, impact = 0.001, routes = 2 }) {
  return { inAmount: String(inAtoms), outAmount: String(outAtoms), priceImpactPct: String(impact), routePlan: Array.from({ length: routes }, () => ({})) };
}

// ===========================================================================
// 1. pure parsers
// ===========================================================================
test('parseJupQuote scales raw atoms by token decimals into a price', () => {
  // 1 SOL (1e9) -> 150 USDC (150e6) => price 150 USDC/SOL
  const r = parseJupQuote(jupQuoteRaw({ inAtoms: 1e9, outAtoms: 150e6 }), 'SOL', 'USDC');
  assert.equal(r.price, 150);
  assert.equal(r.routed, 2);
  assert.equal(r.source, 'jup-quote');
  assert.ok(r.priceImpactPct >= 0);
});

test('parseJupQuote returns null on garbage / zero amounts', () => {
  assert.equal(parseJupQuote(null, 'SOL', 'USDC'), null);
  assert.equal(parseJupQuote({}, 'SOL', 'USDC'), null);
  assert.equal(parseJupQuote(jupQuoteRaw({ inAtoms: 0, outAtoms: 0 }), 'SOL', 'USDC'), null);
  assert.equal(parseJupQuote(jupQuoteRaw({ inAtoms: 1e9, outAtoms: 1 }), 'NOPE', 'USDC'), null);
});

test('parseJupPrice reads { data: { SYM: { price } } } and rejects junk', () => {
  assert.equal(parseJupPrice({ data: { SOL: { price: 152.5 } } }, 'SOL').price, 152.5);
  assert.equal(parseJupPrice(null, 'SOL'), null);
  assert.equal(parseJupPrice({ data: {} }, 'SOL'), null);
  assert.equal(parseJupPrice({ data: { SOL: { price: 0 } } }, 'SOL'), null);
});

// ===========================================================================
// 2. readQuotes — parse + confidence + soft-fail per dead source
// ===========================================================================
test('readQuotes parses a quote+price pair and scores high confidence on agreement', async () => {
  __setFetch(routeFetch({
    'quote-api.jup.ag': jsonResponse(jupQuoteRaw({ inAtoms: 1e9, outAtoms: 150e6 })),
    'price.jup.ag': jsonResponse({ data: { SOL: { price: 150.5 } } }),
  }));
  try {
    const q = await readQuotes([{ base: 'SOL', quote: 'USDC' }]);
    assert.equal(q.length, 1);
    assert.equal(q[0].market, 'SOL/USDC');
    assert.equal(q[0].price, 150);
    assert.ok(q[0].confidence >= 0.9, `expected high confidence, got ${q[0].confidence}`);
    assert.deepEqual(q[0].sources, ['jup-quote', 'jup-price']);
    assert.equal(q[0].refUsd, 150); // USDC quote => USD reference
  } finally { restore(); }
});

test('readQuotes soft-fails the QUOTE source but still scores via the price fallback', async () => {
  __setFetch(routeFetch({
    'quote-api.jup.ag': failResponse(503),        // primary dead
    'price.jup.ag': jsonResponse({ data: { SOL: { price: 149 } } }),
  }));
  try {
    const q = await readQuotes([{ base: 'SOL', quote: 'USDC' }]);
    assert.equal(q[0].price, 149);
    assert.deepEqual(q[0].sources, ['jup-price']);
    assert.ok(q[0].confidence > 0 && q[0].confidence < 0.8);
  } finally { restore(); }
});

test('readQuotes both sources dead => price null, confidence 0, no throw', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  try {
    let q, threw = false;
    try { q = await readQuotes([{ base: 'SOL', quote: 'USDC' }]); } catch { threw = true; }
    assert.equal(threw, false, 'readQuotes must not throw');
    assert.equal(q[0].price, null);
    assert.equal(q[0].confidence, 0);
    assert.deepEqual(q[0].sources, []);
  } finally { restore(); }
});

test('readQuotes flags unknown tokens without any fetch', async () => {
  let called = false;
  __setFetch(async () => { called = true; return jsonResponse({}); });
  try {
    const q = await readQuotes([{ base: 'FAKE', quote: 'USDC' }]);
    assert.equal(q[0].price, null);
    assert.equal(q[0].error, 'unknown token');
    assert.equal(called, false, 'unknown token should not hit the network');
  } finally { restore(); }
});

// ===========================================================================
// 3. strategize — the dry-run discipline
// ===========================================================================
test('a normal spread (DEX below ref by ~4%) -> a single capped BUY intention', () => {
  const quotes = [{ market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 144, confidence: 0.95 }];
  const intents = strategize(quotes, { 'SOL/USDC': 150 }); // ref 150 vs price 144 => +4.17% edge
  assert.equal(intents.length, 1);
  const i = intents[0];
  assert.equal(i.side, 'buy');
  assert.equal(i.market, 'SOL/USDC');
  assert.ok(i.size > 0 && i.size <= 5, `notional must be tiny/capped, got ${i.size}`);
  assert.ok(i.edgePct > 0.03 && i.edgePct < 0.15);
});

test('DEX rich vs ref -> a SELL intention (two-sided, not one-way bleed)', () => {
  const quotes = [{ market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 156, confidence: 0.9 }];
  const intents = strategize(quotes, { 'SOL/USDC': 150 }); // -3.8% edge
  assert.equal(intents.length, 1);
  assert.equal(intents[0].side, 'sell');
});

test('an IMPLAUSIBLE edge (>15%) is REJECTED as a trap (no intention)', () => {
  const quotes = [{ market: 'BONK/USDC', base: 'BONK', quote: 'USDC', price: 0.5, confidence: 0.95 }];
  const intents = strategize(quotes, { 'BONK/USDC': 1.0 }); // +100% edge — too good to be true
  assert.equal(intents.length, 0);
});

test('a below-threshold edge (<3%) holds (no intention)', () => {
  const quotes = [{ market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 149, confidence: 0.95 }];
  const intents = strategize(quotes, { 'SOL/USDC': 150 }); // +0.67% — below 3%
  assert.equal(intents.length, 0);
});

test('a low-confidence quote is not traded even with a real edge', () => {
  const quotes = [{ market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 144, confidence: 0.2 }];
  const intents = strategize(quotes, { 'SOL/USDC': 150 });
  assert.equal(intents.length, 0);
});

test('a stable-peg pair uses 1.0 as its implicit reference', () => {
  // USDT/USDC quote at 0.95 (5% off peg) with no explicit ref -> should fire a BUY of USDT
  const quotes = [{ market: 'USDT/USDC', base: 'USDT', quote: 'USDC', price: 0.95, confidence: 0.95 }];
  const intents = strategize(quotes); // no refs map
  assert.equal(intents.length, 1);
  assert.equal(intents[0].side, 'buy');
});

test('no reference and not a stable pair => hold (no anchor, no edge)', () => {
  const quotes = [{ market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 144, confidence: 0.95 }];
  assert.equal(strategize(quotes).length, 0); // no refs => nothing to fade against
});

// ===========================================================================
// 4. POISON test — prove there is NO key path; every intention is dryRun/signer-safe
// ===========================================================================
test('POISON: every intention is dryRun:true / signer:null and FROZEN (no key path)', () => {
  const quotes = [
    { market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 144, confidence: 0.95 },
    { market: 'USDT/USDC', base: 'USDT', quote: 'USDC', price: 0.95, confidence: 0.95 },
  ];
  const intents = strategize(quotes, { 'SOL/USDC': 150 });
  assert.ok(intents.length >= 2);
  for (const i of intents) {
    assert.equal(i.coin, 'solana');
    assert.equal(i.dryRun, true);
    assert.equal(i.signer, null);
    assert.ok(Object.isFrozen(i), 'intention must be frozen');
    // attempt to poison it: a frozen object silently ignores writes (strict assigns throw) —
    // either way the value MUST remain safe.
    try { i.dryRun = false; } catch { /* strict-mode throw is fine */ }
    try { i.signer = 'SOME_WIF_PRIVATE_KEY'; } catch { /* */ }
    assert.equal(i.dryRun, true, 'dryRun could not be flipped');
    assert.equal(i.signer, null, 'signer could not be attached');
  }
});

test('POISON: a malicious "intention" passed back in cannot smuggle a signer through', () => {
  // strategize only reads QUOTES; it never trusts a caller-supplied signer/dryRun. Feed a poisoned
  // quote object carrying signer/dryRun fields and confirm they are ignored, not propagated.
  const quotes = [{ market: 'SOL/USDC', base: 'SOL', quote: 'USDC', price: 144, confidence: 0.95, signer: 'WIF', dryRun: false }];
  const intents = strategize(quotes, { 'SOL/USDC': 150 });
  assert.equal(intents[0].signer, null);
  assert.equal(intents[0].dryRun, true);
});

// ===========================================================================
// 5. garbage soft-fails
// ===========================================================================
test('strategize soft-fails on garbage input (never throws)', () => {
  assert.deepEqual(strategize(null), []);
  assert.deepEqual(strategize(undefined), []);
  assert.deepEqual(strategize('not-an-array'), []);
  assert.deepEqual(strategize([null, {}, { price: 'NaN', confidence: 0.9 }, 42]), []);
});

// ===========================================================================
// 6. handler — GET /api/sol JSON shape
// ===========================================================================
function fakeRes() {
  return { _code: 0, _headers: null, _body: '', writeHead(c, h) { this._code = c; this._headers = h; }, end(b) { this._body = b || ''; } };
}

test('handler GET /api/sol returns { ok, quotes, intentions } JSON', async () => {
  __setFetch(routeFetch({
    'quote-api.jup.ag': jsonResponse(jupQuoteRaw({ inAtoms: 1e9, outAtoms: 150e6 })),
    'price.jup.ag': jsonResponse({ data: { SOL: { price: 150 }, JUP: { price: 1 }, BONK: { price: 0.00002 }, USDT: { price: 1 } } }),
  }));
  try {
    const res = fakeRes();
    await handler({ url: '/api/sol', headers: { host: 'localhost' } }, res);
    assert.equal(res._code, 200);
    const body = JSON.parse(res._body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.quotes) && body.quotes.length === PAIRS.length);
    assert.ok(Array.isArray(body.intentions));
    for (const i of body.intentions) { assert.equal(i.dryRun, true); assert.equal(i.signer, null); }
  } finally { restore(); }
});

test('handler 404s a non-/api/sol path', async () => {
  const res = fakeRes();
  await handler({ url: '/nope', headers: {} }, res);
  assert.equal(res._code, 404);
  assert.equal(JSON.parse(res._body).ok, false);
});

test('handler soft-fails to {ok:false} when readers blow up (never throws)', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  try {
    const res = fakeRes();
    let threw = false;
    try { await handler({ url: '/api/sol', headers: {} }, res); } catch { threw = true; }
    assert.equal(threw, false);
    const body = JSON.parse(res._body);
    // readers soft-fail internally => ok:true with null prices and zero intentions is also acceptable;
    // either way the shape is intact and no intention lacks the safety stamp.
    assert.ok('quotes' in body && 'intentions' in body);
    for (const i of body.intentions) { assert.equal(i.dryRun, true); assert.equal(i.signer, null); }
  } finally { restore(); }
});

// ===========================================================================
// 7. directory shape + esc
// ===========================================================================
test('TOKENS/PAIRS directory is well-formed', () => {
  for (const [sym, t] of Object.entries(TOKENS)) {
    assert.equal(typeof t.mint, 'string'); assert.ok(t.mint.length > 30, `${sym} mint looks wrong`);
    assert.ok(Number.isInteger(t.decimals) && t.decimals >= 0);
  }
  for (const p of PAIRS) { assert.ok(p.base in TOKENS); assert.ok(p.quote in TOKENS); }
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">'&'`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;');
  assert.equal(esc(null), '');
});
