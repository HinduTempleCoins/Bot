// polygon-bot.test.mjs — OFFLINE tests for integrations/chains/polygon-bot.mjs.
//
// Drives the READ + DRY-RUN Polygon bot through the injected __setFetch seam (no network).
// Covers: 0x + DexScreener quote parsing, per-source soft-fail, confidence scoring, a normal
// spread -> a CAPPED dry-run intention, an implausible edge -> REJECTED, the poison test (every
// intention is dryRun:true / signer:null with no key path), and garbage input soft-fails.
//
//   node --test integrations/chains/polygon-bot.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  polygonQuotes, dryRunIntentions, intentionFromQuote, scoreQuote, capNotional,
  handler, __setFetch, TOKENS, MAX_PLAUSIBLE_EDGE, MAX_NOTIONAL_USD, MIN_NOTIONAL_USD,
} from './polygon-bot.mjs';

// ── fetch mock router: dispatches on URL to a 0x or DexScreener response ──────────────────────
function ok(json) { return { ok: true, status: 200, json: async () => json }; }
function notOk(status = 500) { return { ok: false, status, json: async () => ({}) }; }

// 0x price endpoint: buyAmount is USDC base units (6dp) received for 1 whole TOKEN -> the USD price.
function zeroxResp(priceUsd) { return ok({ buyAmount: String(Math.round(priceUsd * 1e6)) }); }
// DexScreener search: a Polygon pair with a USD price + liquidity.
function dexResp(priceUsd, { liq = 500000, sym = 'TKN' } = {}) {
  return ok({ pairs: [{ chainId: 'polygon', dexId: 'quickswap', baseToken: { symbol: sym }, quoteToken: { symbol: 'USDC' }, priceUsd: String(priceUsd), liquidity: { usd: liq } }] });
}

// Build a router that returns a 0x price and a DexScreener price (or lets either fail).
function router({ zerox, dex }) {
  return async (url) => {
    if (String(url).includes('0x.org') || String(url).includes('/swap/')) {
      return typeof zerox === 'function' ? zerox() : (zerox == null ? notOk() : zeroxResp(zerox));
    }
    if (String(url).includes('dexscreener')) {
      return typeof dex === 'function' ? dex() : (dex == null ? notOk() : dexResp(dex));
    }
    return notOk(404);
  };
}

test('parses both sources and confidence-scores a tight agreement as high', async () => {
  __setFetch(router({ zerox: 0.50, dex: 0.501 })); // ~0.2% apart
  const { quotes } = await polygonQuotes({ tokens: ['POL'] });
  __setFetch(null);
  const q = quotes[0];
  assert.equal(q.symbol, 'POL');
  assert.ok(q.priceUsd > 0.49 && q.priceUsd < 0.51, 'midpoint price');
  assert.deepEqual(q.sources.sort(), ['0x', 'dexscreener']);
  assert.equal(q.confidence, 'high', 'two sources within 2% -> high');
  assert.equal(q.perSource['0x'], 0.5);
  assert.ok(q.perSource.dexscreener > 0);
});

test('per-source soft-fail: 0x dead -> still returns the DexScreener price at low confidence', async () => {
  __setFetch(router({ zerox: null, dex: 0.48 })); // 0x HTTP 500
  const { quotes } = await polygonQuotes({ tokens: ['POL'] });
  __setFetch(null);
  const q = quotes[0];
  assert.equal(q.perSource['0x'], null, '0x absent');
  assert.equal(q.perSource.dexscreener, 0.48);
  assert.equal(q.confidence, 'low', 'single source -> low confidence');
  assert.deepEqual(q.sources, ['dexscreener']);
});

test('both sources dead -> price null, confidence none, never throws', async () => {
  __setFetch(router({ zerox: null, dex: null }));
  const { quotes } = await polygonQuotes({ tokens: ['WETH'] });
  __setFetch(null);
  assert.equal(quotes[0].priceUsd, null);
  assert.equal(quotes[0].confidence, 'none');
  assert.deepEqual(quotes[0].sources, []);
});

test('normal spread -> a CAPPED, tiny-notional dry-run intention', async () => {
  // POL: 0x $0.50, DexScreener $0.52 -> 4% edge (plausible, clears the ~0.6% round-trip).
  __setFetch(router({ zerox: 0.50, dex: 0.52 }));
  const payload = await polygonQuotes({ tokens: ['POL'] });
  __setFetch(null);
  const { intentions, rejected } = dryRunIntentions(payload);
  assert.equal(rejected.length, 0);
  assert.equal(intentions.length, 1);
  const it = intentions[0];
  assert.equal(it.coin, 'polygon');
  assert.equal(it.market, 'POL/USDC');
  assert.equal(it.side, 'buy');
  assert.equal(it.buyOn, '0x', 'buy on the cheaper source');
  assert.equal(it.sellOn, 'dexscreener');
  assert.equal(it.price, 0.50, 'entry at the cheaper price');
  assert.ok(it.edgePct >= 3.9 && it.edgePct <= 4.1, `~4% edge, got ${it.edgePct}`);
  // notional is clamped to the tiny test band ($1–$5)
  assert.ok(it.notionalUsd >= MIN_NOTIONAL_USD && it.notionalUsd <= MAX_NOTIONAL_USD, 'capped notional');
  assert.ok(it.size > 0 && it.size <= MAX_NOTIONAL_USD / 0.5, 'size in token units within cap');
  assert.equal(it.dryRun, true);
  assert.equal(it.signer, null);
});

test('implausible edge -> REJECTED as a trap, no intention emitted', async () => {
  // 0x $0.50 vs DexScreener $1.00 = 100% edge >> 15% cap -> a trap, never free money.
  __setFetch(router({ zerox: 0.50, dex: 1.00 }));
  const payload = await polygonQuotes({ tokens: ['POL'] });
  __setFetch(null);
  const { intentions, rejected } = dryRunIntentions(payload);
  assert.equal(intentions.length, 0, 'no intention on an implausible edge');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].market, 'POL/USDC');
  assert.ok(/trap|implausible/.test(rejected[0].reason));
  assert.ok(rejected[0].edgePct > MAX_PLAUSIBLE_EDGE * 100);
});

test('tiny edge that does not clear the round-trip -> no intention (no one-way bleed)', async () => {
  // 0.2% apart: below MIN_EDGE / does not net positive after fees+gas.
  __setFetch(router({ zerox: 0.500, dex: 0.501 }));
  const payload = await polygonQuotes({ tokens: ['POL'] });
  __setFetch(null);
  const { intentions, rejected } = dryRunIntentions(payload);
  assert.equal(intentions.length, 0, 'sub-fee edge is not worth a round trip');
  assert.equal(rejected.length, 0, 'not a trap, just not worth acting on');
});

test('POISON TEST: every emitted intention is dryRun:true / signer:null with NO key field', async () => {
  // Several plausible-edge tokens at once; assert the invariant on all of them.
  __setFetch(async (url) => {
    if (String(url).includes('0x.org') || String(url).includes('/swap/')) return zeroxResp(0.50);
    if (String(url).includes('dexscreener')) return dexResp(0.53); // ~6% edge, plausible
    return notOk(404);
  });
  const payload = await polygonQuotes({ tokens: ['POL', 'WETH', 'WBTC'] });
  __setFetch(null);
  const { intentions } = dryRunIntentions(payload);
  assert.ok(intentions.length >= 1, 'at least one intention to check');
  for (const it of intentions) {
    assert.equal(it.dryRun, true, 'dryRun must be true');
    assert.equal(it.signer, null, 'signer must be null — no key path');
    assert.ok(!('wif' in it), 'no wif field');
    assert.ok(!('key' in it), 'no key field');
    assert.ok(!('privateKey' in it), 'no privateKey field');
  }
});

test('USDC (the unit token) never produces a self-trade intention', () => {
  const q = { symbol: 'USDC', priceUsd: 1, perSource: { '0x': 1, dexscreener: 1 } };
  assert.equal(intentionFromQuote(q).intention, null);
});

test('intentionFromQuote needs two sources for an edge', () => {
  const oneSource = { symbol: 'POL', priceUsd: 0.5, perSource: { '0x': 0.5, dexscreener: null } };
  assert.equal(intentionFromQuote(oneSource).intention, null);
});

test('capNotional clamps into the $1–$5 test band, even on junk', () => {
  assert.equal(capNotional(1000), MAX_NOTIONAL_USD);
  assert.equal(capNotional(0.01), MIN_NOTIONAL_USD);
  assert.equal(capNotional(3), 3);
  assert.equal(capNotional(NaN), MIN_NOTIONAL_USD);
  assert.equal(capNotional(-5), MIN_NOTIONAL_USD);
});

test('scoreQuote is pure and handles disagreement / empties', () => {
  assert.equal(scoreQuote(null, null).confidence, 'none');
  assert.equal(scoreQuote({ source: '0x', priceUsd: 1 }, null).confidence, 'low');
  assert.equal(scoreQuote({ source: '0x', priceUsd: 1 }, { source: 'dexscreener', priceUsd: 1.005 }).confidence, 'high');
  assert.equal(scoreQuote({ source: '0x', priceUsd: 1 }, { source: 'dexscreener', priceUsd: 1.05 }).confidence, 'medium');
  assert.equal(scoreQuote({ source: '0x', priceUsd: 1 }, { source: 'dexscreener', priceUsd: 2 }).confidence, 'low'); // >15% gap
});

test('garbage input soft-fails everywhere, never throws', () => {
  assert.deepEqual(dryRunIntentions(null), { intentions: [], rejected: [] });
  assert.deepEqual(dryRunIntentions({}), { intentions: [], rejected: [] });
  assert.deepEqual(dryRunIntentions({ quotes: [null, {}, { symbol: 'X' }] }), { intentions: [], rejected: [] });
  assert.equal(intentionFromQuote(undefined).intention, null);
  assert.equal(intentionFromQuote({ symbol: 'POL', priceUsd: null }).intention, null);
});

test('handler GET /api/polygon returns { quotes, intentions } JSON, dryRun, no 500', async () => {
  __setFetch(router({ zerox: 0.50, dex: 0.52 }));
  let code, headers, bodyStr;
  const res = {
    writeHead(c, h) { code = c; headers = h; },
    end(b) { bodyStr = b; },
  };
  await handler({ url: '/api/polygon' }, res);
  __setFetch(null);
  assert.equal(code, 200);
  assert.match(headers['content-type'], /application\/json/);
  const body = JSON.parse(bodyStr);
  assert.equal(body.chain, 'polygon');
  assert.equal(body.dryRun, true);
  assert.equal(body.signer, null);
  assert.ok(Array.isArray(body.quotes));
  assert.ok(Array.isArray(body.intentions));
  for (const it of body.intentions) { assert.equal(it.dryRun, true); assert.equal(it.signer, null); }
});

test('handler soft-fails to a 200 JSON envelope when the fetch seam throws', async () => {
  __setFetch(() => { throw new Error('network exploded'); });
  let code, bodyStr;
  const res = { writeHead(c) { code = c; }, end(b) { bodyStr = b; } };
  await handler({ url: '/api/polygon' }, res);
  __setFetch(null);
  assert.equal(code, 200, 'never 500 the caller');
  const body = JSON.parse(bodyStr);
  assert.equal(body.dryRun, true);
  assert.equal(body.signer, null);
  assert.deepEqual(body.intentions, []);
});

test('TOKENS exposes the expected top Polygon majors', () => {
  for (const s of ['POL', 'WMATIC', 'WETH', 'WBTC', 'USDC']) assert.ok(TOKENS[s], `${s} present`);
  assert.equal(TOKENS.USDC.decimals, 6);
  assert.equal(TOKENS.POL.decimals, 18);
});

test('__setFetch(null) restores the default seam without throwing', () => {
  assert.doesNotThrow(() => __setFetch(null));
});
