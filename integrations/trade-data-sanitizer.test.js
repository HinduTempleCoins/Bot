// trade-data-sanitizer.test.js — offline tests for the trade-bot sanitization valve (#229).
// node:test, fully offline, all sources injected. Run:
//   node --test integrations/trade-data-sanitizer.test.js
//
// Secret-shaped strings used in the leak tests are ASSEMBLED FROM FRAGMENTS so no literal
// secret lives in this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ingestRaw,
  sanitizeForAi,
  twoViews,
  aiBrief,
  assertNoPrivateLeak,
  redactText,
  SECRET_SHAPES,
  PRIVATE_FIELD_PATTERNS,
} from './trade-data-sanitizer.mjs';

// ── fixtures ─────────────────────────────────────────────────────────────────

// fragment-assembled secret shapes (never literal in source)
const FAKE_WIF = '5' + 'J'.repeat(2) + 'q'.repeat(48);                 // base58 WIF shape (~51)
const FAKE_PRIVATE_PATH = '/' + ['var', 'melek' + '-bot', 'state', 'wif.json'].join('/'); // private-path shape
const FAKE_BEARER = ['eyJabc1234567', 'payload89XYZdef', 'sigQRS456tuv'].join('.');         // jwt/token shape

function rawRecord(over = {}) {
  return {
    statePath: '/opt/app/trade/state.json', // generic
    operatorAccount: 'kalivankush',
    activeKey: FAKE_WIF,
    apiToken: FAKE_BEARER,
    balance: '4231.55 HIVE',
    token: 'SWAP.DOGE',
    operation: 'market_buy',
    quantity: 1000,
    quantityHive: 12.5,
    netHive: -3.2,
    timestamp: '2026-06-04T00:00:00Z',
    marketContext: { spread: '0.4%', vol24h: 880 },
    ...over,
  };
}

// injected offline readers
const heMarketOK = {
  async metrics(sym) {
    return { lastPrice: 0.012, highestBid: 0.011, lowestAsk: 0.013, volume: 880, priceChangePercent: -2.1, symbol: sym };
  },
};
const explorerOK = {
  async chain() {
    return { label: 'HIVE (dev)', headBlock: 1234567, currentWitness: 'somewitness', time: '2026-06-04T00:00:00' };
  },
};

// ── ingestRaw ────────────────────────────────────────────────────────────────

test('ingestRaw normalizes raw server data to an operator-tier record', () => {
  const rec = ingestRaw(rawRecord());
  assert.equal(rec.tier, 'operator');
  assert.equal(rec.token, 'SWAP.DOGE');
  assert.equal(rec.action, 'market_buy');
  assert.equal(rec.outcome, 'loss'); // derived from negative netHive
  assert.equal(rec.ts, '2026-06-04T00:00:00Z');
  assert.equal(rec.hive, 12.5);
  // private detail is retained on the OPERATOR record (in the operatorPrivate bucket)
  assert.ok('activeKey' in rec.operatorPrivate);
  assert.ok('operatorAccount' in rec.operatorPrivate);
  assert.ok('balance' in rec.operatorPrivate);
});

test('ingestRaw soft-fails on garbage input', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const rec = ingestRaw(bad);
    assert.equal(rec.tier, 'operator');
    assert.equal(rec.token, null);
  }
});

// ── sanitizeForAi ─────────────────────────────────────────────────────────────

test('sanitizeForAi keeps ONLY token/action/outcome/ts/marketContext', () => {
  const ai = sanitizeForAi(ingestRaw(rawRecord()));
  assert.deepEqual(
    Object.keys(ai).sort(),
    ['action', 'marketContext', 'outcome', 'tier', 'token', 'ts'].sort(),
  );
  assert.equal(ai.tier, 'ai');
  assert.equal(ai.token, 'SWAP.DOGE');
});

test('sanitizeForAi strips key / server-path / operator-tagged / account / exact-balance (values ABSENT)', () => {
  const ai = sanitizeForAi(ingestRaw(rawRecord()));
  const blob = JSON.stringify(ai);
  // none of the private VALUES survive anywhere in the output
  assert.ok(!blob.includes(FAKE_WIF), 'WIF must be absent');
  assert.ok(!blob.includes(FAKE_BEARER), 'bearer token must be absent');
  assert.ok(!blob.includes('kalivankush'), 'account name must be absent');
  assert.ok(!blob.includes('/opt/app/trade/state.json'), 'server path must be absent');
  assert.ok(!blob.includes('4231.55'), 'exact balance must be absent');
  // no operatorPrivate bucket leaks through
  assert.ok(!('operatorPrivate' in ai));
  // and the sanitized output itself passes the leak gate
  assert.equal(assertNoPrivateLeak(ai), true);
});

test('sanitizeForAi scrubs private sub-fields out of marketContext', () => {
  const rec = ingestRaw(rawRecord());
  rec.marketContext = { spread: '0.4%', operatorNote: 'secret', apiKey: FAKE_WIF, depth: { nested: 1 } };
  const ai = sanitizeForAi(rec);
  assert.ok('spread' in ai.marketContext);
  assert.ok(!('operatorNote' in ai.marketContext));
  assert.ok(!('apiKey' in ai.marketContext));
  assert.ok(!('depth' in ai.marketContext)); // nested objects dropped (kept flat/scalar)
});

// ── twoViews ──────────────────────────────────────────────────────────────────

test('twoViews returns both views from injected readers', async () => {
  const v = await twoViews({ raw: rawRecord() }, { heMarket: heMarketOK, explorer: explorerOK });
  assert.equal(v.heDiagnostics.ok, true);
  assert.equal(v.heDiagnostics.data.symbol, 'SWAP.DOGE');
  assert.equal(v.heDiagnostics.data.last, 0.012);
  assert.equal(v.explorer.ok, true);
  assert.equal(v.explorer.data.headBlock, 1234567);
});

test('twoViews soft-fails ONE view without taking down the other', async () => {
  const heBroken = { async metrics() { throw new Error('he node down'); } };
  const v = await twoViews({ raw: rawRecord() }, { heMarket: heBroken, explorer: explorerOK });
  assert.equal(v.heDiagnostics.ok, false);
  assert.match(v.heDiagnostics.error, /he node down/);
  assert.equal(v.explorer.ok, true); // the other view still succeeds
});

test('twoViews soft-fails when a reader is missing entirely', async () => {
  const v = await twoViews({ raw: rawRecord() }, {}); // no readers
  assert.equal(v.heDiagnostics.ok, false);
  assert.equal(v.explorer.ok, false);
});

// ── aiBrief ───────────────────────────────────────────────────────────────────

test('aiBrief produces markdown with NO private data', async () => {
  const md = await aiBrief(ingestRaw(rawRecord()), { heMarket: heMarketOK, explorer: explorerOK });
  assert.match(md, /## Trade-bot activity/);
  assert.match(md, /SWAP\.DOGE/);
  assert.match(md, /HIVE-Engine: last 0\.012/);
  // no private values
  assert.ok(!md.includes(FAKE_WIF));
  assert.ok(!md.includes(FAKE_BEARER));
  assert.ok(!md.includes('kalivankush'));
  assert.ok(!md.includes('/opt/app/trade/state.json'));
  assert.ok(!md.includes('4231.55'));
  // and it self-validates
  assert.equal(assertNoPrivateLeak(md), true);
});

test('aiBrief still renders when a reader is down (soft-fail)', async () => {
  const md = await aiBrief(ingestRaw(rawRecord()), { heMarket: null, explorer: explorerOK });
  assert.match(md, /HIVE-Engine: unavailable/);
  assert.match(md, /Chain explorer: HIVE \(dev\)/);
});

// ── assertNoPrivateLeak ────────────────────────────────────────────────────────

test('assertNoPrivateLeak passes a sanitized record', () => {
  const ai = sanitizeForAi(ingestRaw(rawRecord()));
  assert.equal(assertNoPrivateLeak(ai), true);
});

test('assertNoPrivateLeak THROWS on an injected WIF shape', () => {
  const leaked = `the bot used active key ${FAKE_WIF} to sign`;
  assert.throws(() => assertNoPrivateLeak(leaked), /private data would leak|secret-shape/);
});

test('assertNoPrivateLeak THROWS on an injected private server path', () => {
  const leaked = `state lives at ${FAKE_PRIVATE_PATH}`;
  assert.throws(() => assertNoPrivateLeak(leaked), /private data would leak|secret-shape 'serverPath'/);
});

test('assertNoPrivateLeak THROWS on an injected bearer/token shape', () => {
  const leaked = `Authorization: Bearer ${FAKE_BEARER}`;
  assert.throws(() => assertNoPrivateLeak(leaked), /private data would leak|secret-shape 'bearerToken'/);
});

test('assertNoPrivateLeak THROWS on an object carrying a private field name', () => {
  assert.throws(() => assertNoPrivateLeak({ token: 'SWAP.DOGE', activeKey: 'whatever' }), /private field 'activeKey'/);
  assert.throws(() => assertNoPrivateLeak({ operatorAccount: 'x' }), /private field/);
  assert.throws(() => assertNoPrivateLeak({ balance: '1 HIVE' }), /private field 'balance'/);
});

// ── redactText / catalogs ───────────────────────────────────────────────────────

test('redactText replaces secret-shaped substrings, returns no secret', () => {
  const out = redactText(`key=${FAKE_WIF} path=${FAKE_PRIVATE_PATH}`);
  assert.ok(!out.includes(FAKE_WIF));
  assert.match(out, /\[redacted:wif\]/);
  assert.equal(redactText(null), ''); // soft on non-strings
});

test('catalogs are frozen and non-empty', () => {
  assert.ok(Array.isArray(SECRET_SHAPES) && SECRET_SHAPES.length > 0);
  assert.ok(Array.isArray(PRIVATE_FIELD_PATTERNS) && PRIVATE_FIELD_PATTERNS.length > 0);
  assert.ok(Object.isFrozen(SECRET_SHAPES));
  assert.ok(Object.isFrozen(PRIVATE_FIELD_PATTERNS));
});
