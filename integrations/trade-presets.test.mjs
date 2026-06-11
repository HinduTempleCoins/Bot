// trade-presets.test.mjs — OFFLINE tests for the DRY-RUN preset trade engine.
//
// trade-presets.mjs is READ-ONLY: it defines deterministic rule-based strategies and a
// `simulate()` that SAYS what each would do against the live market. It never trades, holds
// no keys, broadcasts nothing. So the test surface is two layers:
//
//   1. PRESETS[*].decide(ctx) — PURE functions (plain ctx in, typed action out, no I/O).
//      Tested exhaustively: happy path, edge boundaries, and the soft-fail paths where a
//      missing/zero/empty price returns a HOLD (typed, never throws).
//   2. simulate() — driven FULLY OFFLINE by injecting both upstream seams:
//        • the HE-market side (market.metrics → he-client) via he-client.__setFetch
//        • the USD-oracle side (priceUsd / hiveUsd → free-apis) via a stubbed globalThis.fetch
//      No real network, no fs, no keys. We also assert its soft-fail contract: when no
//      confident real price is available the symbol is skipped, and the result is always a
//      typed array — simulate() never throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, simulate } from './trade-presets.mjs';
import { __setFetch as setHeFetch } from './he-client.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// 1. PURE: PRESETS[*].decide(ctx)
// ─────────────────────────────────────────────────────────────────────────────

const sellRule = PRESETS['swap-sell-on-premium'];
const buyRule  = PRESETS['swap-buy-on-discount'];
const guardRule = PRESETS['no-one-way-accumulation'];

// helper: build a ctx the way simulate() does (base fields + the preset's own params)
const ctx = (base, rule) => ({ sym: 'SWAP.X', p: rule.params, ...base });

test('PRESETS: registry shape — three named presets, each pure config + decide()', () => {
  assert.deepEqual(
    Object.keys(PRESETS).sort(),
    ['no-one-way-accumulation', 'swap-buy-on-discount', 'swap-sell-on-premium'],
  );
  for (const [name, p] of Object.entries(PRESETS)) {
    assert.equal(typeof p.desc, 'string', `${name} has a human desc`);
    assert.equal(typeof p.params, 'object', `${name} has a params object`);
    assert.equal(typeof p.decide, 'function', `${name} has a decide()`);
  }
  assert.equal(sellRule.params.edge, 0.03);
  assert.equal(buyRule.params.edge, 0.03);
});

// ── swap-sell-on-premium ─────────────────────────────────────────────────────
test('sell: HE bid comfortably over real by >edge → SELL with a reason', () => {
  // bid 1.10 vs real 1.00 = +10% >= 3% edge
  const d = sellRule.decide(ctx({ bidUsd: 1.10, realUsd: 1.00 }, sellRule));
  assert.equal(d.action, 'SELL');
  assert.equal(d.sym, 'SWAP.X');
  assert.match(d.reason, /10\.0% over/);
  assert.match(d.reason, /\$1\.1000/);
  assert.match(d.reason, /\$1\.0000/);
});

test('sell: edge is inclusive at exactly the threshold → SELL', () => {
  // bid 1.03 vs real 1.00 = exactly +3% — `>=` makes the boundary a SELL
  const d = sellRule.decide(ctx({ bidUsd: 1.03, realUsd: 1.00 }, sellRule));
  assert.equal(d.action, 'SELL');
});

test('sell: just under the edge → HOLD (no reason field needed)', () => {
  // bid 1.029 vs real 1.00 = +2.9% < 3%
  const d = sellRule.decide(ctx({ bidUsd: 1.029, realUsd: 1.00 }, sellRule));
  assert.equal(d.action, 'HOLD');
  assert.equal(d.sym, 'SWAP.X');
  assert.equal(d.reason, undefined);
});

test('sell: bid below real (would be a loss) → HOLD', () => {
  const d = sellRule.decide(ctx({ bidUsd: 0.90, realUsd: 1.00 }, sellRule));
  assert.equal(d.action, 'HOLD');
});

// ── swap-sell-on-premium: soft-fail on missing/zero inputs (never throws) ─────
test('sell: zero/missing bid → HOLD, never throws', () => {
  for (const bidUsd of [0, undefined, null, NaN]) {
    const d = sellRule.decide(ctx({ bidUsd, realUsd: 1.00 }, sellRule));
    assert.equal(d.action, 'HOLD', `bidUsd=${bidUsd}`);
  }
});

test('sell: zero/missing real price → HOLD (no phantom signal), never throws', () => {
  for (const realUsd of [0, undefined, null, NaN]) {
    const d = sellRule.decide(ctx({ bidUsd: 1.50, realUsd }, sellRule));
    assert.equal(d.action, 'HOLD', `realUsd=${realUsd}`);
  }
});

test('sell: wholly empty ctx (only sym/p) → HOLD, never throws', () => {
  const d = sellRule.decide({ sym: 'SWAP.X', p: sellRule.params });
  assert.equal(d.action, 'HOLD');
  assert.equal(d.sym, 'SWAP.X');
});

// ── swap-buy-on-discount ─────────────────────────────────────────────────────
test('buy: HE ask comfortably under real by >edge → BUY with a depth caveat', () => {
  // ask 0.90 vs real 1.00 → (1.00-0.90)/0.90 = +11.1% >= 3%
  const d = buyRule.decide(ctx({ askUsd: 0.90, realUsd: 1.00 }, buyRule));
  assert.equal(d.action, 'BUY');
  assert.equal(d.sym, 'SWAP.X');
  assert.match(d.reason, /under real/);
  assert.match(d.reason, /executable depth/);
});

test('buy: edge inclusive at the threshold → BUY', () => {
  // ask 1.00, real 1.03 → (1.03-1.00)/1.00 = exactly 3%
  const d = buyRule.decide(ctx({ askUsd: 1.00, realUsd: 1.03 }, buyRule));
  assert.equal(d.action, 'BUY');
});

test('buy: discount too small → HOLD', () => {
  // ask 1.00, real 1.02 → +2% < 3%
  const d = buyRule.decide(ctx({ askUsd: 1.00, realUsd: 1.02 }, buyRule));
  assert.equal(d.action, 'HOLD');
});

test('buy: ask above real (no discount) → HOLD', () => {
  const d = buyRule.decide(ctx({ askUsd: 1.10, realUsd: 1.00 }, buyRule));
  assert.equal(d.action, 'HOLD');
});

test('buy: zero/missing ask or real → HOLD, never throws', () => {
  for (const askUsd of [0, undefined, null, NaN]) {
    assert.equal(buyRule.decide(ctx({ askUsd, realUsd: 1.00 }, buyRule)).action, 'HOLD', `askUsd=${askUsd}`);
  }
  for (const realUsd of [0, undefined, null, NaN]) {
    assert.equal(buyRule.decide(ctx({ askUsd: 0.50, realUsd }, buyRule)).action, 'HOLD', `realUsd=${realUsd}`);
  }
});

// ── no-one-way-accumulation (the SWAP.LTC-bleed guard) ───────────────────────
test('guard: always returns GUARD — a buy-only strategy is a HIVE drain', () => {
  const d = guardRule.decide({ sym: 'SWAP.LTC' });
  assert.equal(d.action, 'GUARD');
  assert.equal(d.sym, 'SWAP.LTC');
  assert.match(d.reason, /selling leg/);
});

test('guard: ignores price context entirely (pure refusal), never throws', () => {
  const d = guardRule.decide({ sym: 'SWAP.X', bidUsd: NaN, askUsd: undefined, realUsd: 0 });
  assert.equal(d.action, 'GUARD');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. simulate() — fully offline via both upstream seams
// ─────────────────────────────────────────────────────────────────────────────
//
// SWAP_PAIRS maps e.g. 'SWAP.BTC' -> 'bitcoin'. simulate() does, per symbol:
//   realUsd  ← priceUsd(coingeckoId)        (free-apis via globalThis.fetch)
//   ask/bid  ← market.metrics(sym) * hiveUsd (he-client via __setFetch)
// We control both. The USD-oracle side needs >=2 agreeing sources to be `confident`
// (otherwise realUsd is 0 and the symbol is skipped) — so we feed coinbase+coincap+paprika.

// oracle response shapes (mirror price-oracle/free-apis destructuring)
const paprika  = (price)  => ({ quotes: { USD: { price } } });
const coincap  = (price)  => ({ data: { priceUsd: String(price) } });
const coinbase = (amount) => ({ data: { amount: String(amount) } });

// Install a globalThis.fetch that answers the USD-oracle calls. `prices` maps a coingecko
// id to the USD figure we want every source to report (so robustMedian is confident).
function installOracleFetch(prices) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [id, usd] of Object.entries(prices)) {
      // coinpaprika ids look like 'btc-bitcoin'; coincap/coinbase use the id/ticker directly.
      // We key loosely on the coingecko id appearing in the URL OR a known ticker fragment.
      const frags = ORACLE_FRAGMENTS[id] || [id];
      if (frags.some((f) => u.includes(f))) {
        let body;
        if (u.includes('coinpaprika')) body = paprika(usd);
        else if (u.includes('coincap')) body = coincap(usd);
        else if (u.includes('coinbase')) body = coinbase(usd);
        else body = { usd };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    // anything we didn't route → as if the source had no data (oracle tolerates this)
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  };
  return () => { globalThis.fetch = real; };
}

// URL fragments per coingecko id that the oracle's XREF will hit (paprika/cap/coinbase).
const ORACLE_FRAGMENTS = {
  bitcoin:  ['btc-bitcoin', '/bitcoin', 'BTC-USD'],
  litecoin: ['ltc-litecoin', '/litecoin', 'LTC-USD'],
  hive:     ['hive-hive', '/hive', 'HIVE-USD'],
};

// Install he-client fetch: answer the contracts JSON-RPC `find`/`findOne` with a metrics row.
// metrics carries highestBid/lowestAsk in HIVE; simulate multiplies by hiveUsd.
function installMarketFetch(rowsBySymbol) {
  setHeFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const sym = body?.params?.query?.symbol;
    const row = rowsBySymbol[sym];
    const result = row ? [row] : [];
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  return () => setHeFetch(null); // restore default (global fetch)
}

test('simulate: SELL fires when the HE bid (in USD) beats real by > edge', async () => {
  // hiveUsd = 1.0 (so bid in HIVE == bid in USD). bitcoin real = 100; bid 110 → +10% → SELL.
  const restoreOracle = installOracleFetch({ bitcoin: 100, hive: 1.0 });
  const restoreMarket = installMarketFetch({
    'SWAP.BTC': { highestBid: '110', lowestAsk: '120' },
  });
  try {
    const out = await simulate({ presets: ['swap-sell-on-premium'] });
    assert.ok(Array.isArray(out), 'always returns an array');
    const sell = out.find((d) => d.preset === 'swap-sell-on-premium' && d.sym === 'SWAP.BTC');
    assert.ok(sell, 'a SELL row for SWAP.BTC');
    assert.equal(sell.action, 'SELL');
    assert.match(sell.reason, /over real/);
    // HOLDs are filtered out of simulate()'s output entirely
    assert.ok(!out.some((d) => d.action === 'HOLD'), 'HOLDs are not emitted');
  } finally { restoreMarket(); restoreOracle(); }
});

test('simulate: BUY fires when the HE ask (in USD) is under real by > edge', async () => {
  // hiveUsd=1.0; litecoin real=100; ask 80 → (100-80)/80=+25% → BUY.
  const restoreOracle = installOracleFetch({ litecoin: 100, hive: 1.0 });
  const restoreMarket = installMarketFetch({
    'SWAP.LTC': { highestBid: '70', lowestAsk: '80' },
  });
  try {
    const out = await simulate({ presets: ['swap-buy-on-discount'] });
    const buy = out.find((d) => d.preset === 'swap-buy-on-discount' && d.sym === 'SWAP.LTC');
    assert.ok(buy, 'a BUY row for SWAP.LTC');
    assert.equal(buy.action, 'BUY');
    assert.match(buy.reason, /executable depth/);
  } finally { restoreMarket(); restoreOracle(); }
});

test('simulate: no confident real price → symbol is skipped (typed skip row), never throws', async () => {
  // Route NOTHING for the oracle → every source returns {} → no confident price → skip.
  const restoreOracle = installOracleFetch({ hive: 1.0 }); // only hiveUsd resolves
  const restoreMarket = installMarketFetch({ 'SWAP.BTC': { highestBid: '110', lowestAsk: '120' } });
  try {
    const out = await simulate({ presets: ['swap-sell-on-premium'] });
    assert.ok(Array.isArray(out));
    // Every emitted row for a real symbol with no price is a {sym, skip} row, not an action.
    assert.ok(out.length > 0, 'skips are emitted, not swallowed');
    assert.ok(out.every((d) => 'skip' in d), 'all rows are typed skip rows');
    assert.match(out[0].skip, /no confident real price/);
  } finally { restoreMarket(); restoreOracle(); }
});

test('simulate: unknown preset name is ignored, not fatal', async () => {
  const restoreOracle = installOracleFetch({ bitcoin: 100, hive: 1.0 });
  const restoreMarket = installMarketFetch({ 'SWAP.BTC': { highestBid: '110', lowestAsk: '120' } });
  try {
    const out = await simulate({ presets: ['does-not-exist', 'swap-sell-on-premium'] });
    assert.ok(Array.isArray(out));
    // the bogus name contributes nothing; the real one still fires
    assert.ok(out.some((d) => d.preset === 'swap-sell-on-premium'));
    assert.ok(!out.some((d) => d.preset === 'does-not-exist'));
  } finally { restoreMarket(); restoreOracle(); }
});

test('simulate: returns an array and never throws even when the market read yields nothing', async () => {
  const restoreOracle = installOracleFetch({ bitcoin: 100, hive: 1.0 });
  const restoreMarket = installMarketFetch({}); // metrics → [] (null) for every symbol
  try {
    const out = await simulate({ presets: ['swap-sell-on-premium', 'swap-buy-on-discount'] });
    assert.ok(Array.isArray(out), 'typed array result');
    // With realUsd present but ask/bid = 0 (no metrics), every preset HOLDs → filtered out.
    // BTC has a confident price so it is NOT skipped; it simply produces no action rows.
    assert.ok(!out.some((d) => d.preset && d.action && d.action !== 'HOLD' && d.sym === 'SWAP.BTC'));
  } finally { restoreMarket(); restoreOracle(); }
});
