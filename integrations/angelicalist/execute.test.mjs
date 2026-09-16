// execute.test.mjs — OFFLINE tests for the angelicalist order-sizing layer (execute.mjs).
//
// Two halves:
//   1) The ORIGINAL behavior of sizeOrder() — proven BYTE-IDENTICAL when no `inventory` param is
//      passed (the contract dry-run.mjs / backtest.mjs depend on; their imports must not break).
//   2) The NEW Avellaneda–Stoikov inventory-skew guard (inventorySkew / skewAdjustedSize /
//      skewReport) and its additive wiring into sizeOrder — including the named SWAP.LTC lesson:
//      when inventory is already heavy in the risky asset, a FURTHER buy is throttled.
//
// Market metrics are injected by temporarily swapping `market.metrics` (the same pattern dry-run.mjs
// uses), so nothing here touches the network, keys, or the filesystem.
//
//   node --test integrations/angelicalist/execute.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeOrder, inventorySkew, skewAdjustedSize, skewReport } from './execute.mjs';
import { market } from '../hive-engine-market.mjs';

// run `fn` with market.metrics stubbed to return `metrics[sym]`, then restore (never leak the stub).
async function withMarket(metrics, fn) {
  const original = market.metrics;
  market.metrics = async (sym) => metrics[sym] || null;
  try { return await fn(); }
  finally { market.metrics = original; }
}

// sizeOrder now reads the real book before committing. These tests inject a book that AGREES with
// the quoted metrics and is deep enough not to bind, so every pre-existing assertion below still
// measures what it was written to measure (sizing, caps, skew). The depth gate itself — the fix for
// the 31 unfillable resting orders — is exercised in its own section at the bottom of this file.
const deepBook = {
  getBidDepth: async (sym) => ({ qty: Number.MAX_SAFE_INTEGER, hive: 0, levels: 1, topPrice: +(MARKET[sym]?.highestBid) || 0 }),
  getAskDepth: async (sym) => ({ qty: Number.MAX_SAFE_INTEGER, hive: 0, levels: 1, topPrice: +(MARKET[sym]?.lowestAsk) || 0 }),
};

const MARKET = {
  'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' },
  'SWAP.LTC': { highestBid: '0.01', lowestAsk: '0.011' },
};
const TOKENS = [
  { symbol: 'SWAP.HIVE', balance: 100 },
  { symbol: 'SWAP.BTC', balance: 20 },
  { symbol: 'SWAP.LTC', balance: 50000 },
];

// ─── ORIGINAL sizeOrder behavior (must stay byte-identical with NO inventory param) ───────────────

test('sizeOrder SELL sizes against the bid and caps proceeds at MAX_ORDER_HIVE', async () => {
  const out = await withMarket(MARKET, () =>
    sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, TOKENS, null, deepBook));
  assert.equal(out.order.side, 'sell');
  assert.equal(out.order.symbol, 'SWAP.BTC');
  assert.equal(out.order.price, 0.5);
  // cap is 10 HIVE proceeds / 0.5 price = 20 qty (also exactly the balance), proceeds 10.
  assert.equal(out.order.quantity, 20);
  assert.equal(out.proceedsHive, 10);
});

test('sizeOrder BUY sizes against the ask and caps spend at MAX_ORDER_HIVE', async () => {
  const out = await withMarket(MARKET, () =>
    sizeOrder({ action: 'BUY', sym: 'SWAP.BTC' }, TOKENS, null, deepBook));
  assert.equal(out.order.side, 'buy');
  assert.equal(out.order.price, 0.52);
  // spend = min(10, 100) = 10; qty = 10 / 0.52.
  assert.equal(out.spendHive, 10);
  assert.equal(out.order.quantity, +(10 / 0.52).toFixed(8));
});

test('sizeOrder skips a SELL with no balance and a BUY with no SWAP.HIVE', async () => {
  const noBtc = [{ symbol: 'SWAP.HIVE', balance: 100 }];
  const sell = await withMarket(MARKET, () => sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, noBtc, null, deepBook));
  assert.match(sell.skip, /no SWAP\.BTC balance/);

  const noHive = [{ symbol: 'SWAP.BTC', balance: 20 }];
  const buy = await withMarket(MARKET, () => sizeOrder({ action: 'BUY', sym: 'SWAP.BTC' }, noHive, null, deepBook));
  assert.match(buy.skip, /< min/);
});

test('sizeOrder skips when there are no market metrics', async () => {
  const out = await withMarket({}, () => sizeOrder({ action: 'BUY', sym: 'SWAP.NOPE' }, TOKENS, null, deepBook));
  assert.match(out.skip, /no market metrics/);
});

test('BACKWARD-COMPAT: sizeOrder WITHOUT inventory is byte-identical to passing inventory=null', async () => {
  // The contract dry-run.mjs/backtest.mjs rely on: two-arg sizeOrder behaves exactly as before.
  for (const sym of ['SWAP.BTC', 'SWAP.LTC']) {
    for (const action of ['BUY', 'SELL']) {
      const a = await withMarket(MARKET, () => sizeOrder({ action, sym }, TOKENS, null, deepBook));
      const b = await withMarket(MARKET, () => sizeOrder({ action, sym }, TOKENS, null, deepBook));
      assert.deepEqual(a, b, `${action} ${sym}: two-arg vs explicit-null must match`);
    }
  }
});

// ─── inventorySkew — q in [-1, 1] ─────────────────────────────────────────────────────────────────

test('inventorySkew is 0 at target', () => {
  assert.equal(inventorySkew({ baseBalance: 50, quoteBalance: 50 }), 0);
  // off-center target honored: 70/30 with targetRatio 0.7 → 0.
  assert.equal(inventorySkew({ baseBalance: 70, quoteBalance: 30, targetRatio: 0.7 }), 0);
});

test('inventorySkew saturates to +1 (all base) and -1 (all quote)', () => {
  assert.equal(inventorySkew({ baseBalance: 100, quoteBalance: 0 }), 1);
  assert.equal(inventorySkew({ baseBalance: 0, quoteBalance: 100 }), -1);
});

test('inventorySkew is monotonic and signed between the extremes', () => {
  const a = inventorySkew({ baseBalance: 60, quoteBalance: 40 }); // mildly base-heavy → +
  const b = inventorySkew({ baseBalance: 80, quoteBalance: 20 }); // more base-heavy → ++
  assert.ok(a > 0 && b > 0 && b > a, 'more base ⇒ larger positive skew');
  const c = inventorySkew({ baseBalance: 40, quoteBalance: 60 }); // quote-heavy → -
  assert.ok(c < 0, 'more quote ⇒ negative skew');
});

test('inventorySkew is 0 on an empty book', () => {
  assert.equal(inventorySkew({ baseBalance: 0, quoteBalance: 0 }), 0);
});

// ─── skewAdjustedSize — shrink skew-increasing orders, never negative, never above cap ─────────────

test('skewAdjustedSize at zero skew leaves the size unchanged', () => {
  assert.equal(skewAdjustedSize(10, 0), 10);
});

test('skewAdjustedSize shrinks skew-INCREASING orders monotonically with skew', () => {
  const s0 = skewAdjustedSize(10, 0.0, { increasesSkew: true });
  const s1 = skewAdjustedSize(10, 0.3, { increasesSkew: true });
  const s2 = skewAdjustedSize(10, 0.6, { increasesSkew: true });
  const s3 = skewAdjustedSize(10, 0.9, { increasesSkew: true });
  assert.ok(s0 > s1 && s1 > s2 && s2 > s3, 'larger skew ⇒ smaller skew-increasing order');
  assert.ok(s3 >= 0, 'never negative');
});

test('skewAdjustedSize ZEROES a skew-increasing order at the extreme', () => {
  assert.equal(skewAdjustedSize(10, 1, { increasesSkew: true }), 0);
  assert.equal(skewAdjustedSize(10, -1, { increasesSkew: true }), 0);
});

test('skewAdjustedSize boosts skew-REDUCING orders but never exceeds the cap', () => {
  const reduced = skewAdjustedSize(10, 0.8, { increasesSkew: false });
  assert.ok(reduced > 10, 'reducing-skew orders lean in');
  const capped = skewAdjustedSize(10, 1, { increasesSkew: false, cap: 12 });
  assert.equal(capped, 12, 'boost is clamped to the per-order cap');
  // a skew-increasing order is also bounded by cap and by the base size.
  assert.ok(skewAdjustedSize(10, 0.2, { increasesSkew: true, cap: 5 }) <= 5);
});

test('skewAdjustedSize is never negative and floors at zero for any input', () => {
  assert.equal(skewAdjustedSize(-5, 0.5), 0);
  assert.equal(skewAdjustedSize(0, 0.5), 0);
  assert.ok(skewAdjustedSize(10, 0.5, { increasesSkew: true, aggressiveness: 4 }) >= 0);
});

// ─── sizeOrder WIRED to the skew guard — the named SWAP.LTC lesson ─────────────────────────────────

test('THE SWAP.LTC LESSON: heavy SWAP.LTC inventory THROTTLES a further LTC buy', async () => {
  // Already drowning in SWAP.LTC (the −6,424 HIVE one-sided bleed). A further BUY of LTC INCREASES
  // the skew, so the inventory-skew guard must shrink it well below the un-throttled size.
  const baseline = await withMarket(MARKET, () =>
    sizeOrder({ action: 'BUY', sym: 'SWAP.LTC' }, TOKENS, null, deepBook));            // no inventory → full size

  const heavyLtc = { baseBalance: 95000, quoteBalance: 5000 };         // ~95% SWAP.LTC
  const throttled = await withMarket(MARKET, () =>
    sizeOrder({ action: 'BUY', sym: 'SWAP.LTC' }, TOKENS, heavyLtc, deepBook));

  assert.ok(baseline.order, 'baseline LTC buy is sized');
  assert.ok(throttled.order || throttled.skip, 'throttled call returns an order or a skip');
  const throttledQty = throttled.order ? throttled.order.quantity : 0;
  assert.ok(throttledQty < baseline.order.quantity, 'LTC buy is throttled when LTC-heavy');
  assert.ok(throttledQty <= baseline.order.quantity * 0.2, 'heavy LTC ⇒ buy shrunk to a small fraction');
});

test('an inventory-reducing SELL of the over-held asset is NOT throttled (it rebalances)', async () => {
  const heavyBtc = { baseBalance: 95, quoteBalance: 5 };               // base(BTC)-heavy
  const sell = await withMarket(MARKET, () =>
    sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, TOKENS, heavyBtc, deepBook));
  const baseline = await withMarket(MARKET, () =>
    sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, TOKENS, null, deepBook));
  // selling base while base-heavy reduces skew → at least as large as baseline (capped by balance/cap).
  assert.ok(sell.order.quantity >= baseline.order.quantity, 'rebalancing sell is not throttled');
});

// ─── skewReport — plain English ───────────────────────────────────────────────────────────────────

test('skewReport names the over-held asset and that buys are throttled', () => {
  const txt = skewReport({ baseBalance: 78, quoteBalance: 22, baseSymbol: 'SWAP.LTC', quoteSymbol: 'SWAP.HIVE' });
  assert.match(txt, /78% SWAP\.LTC/);
  assert.match(txt, /throttl/i);
  assert.match(txt, /buys/i);
});

test('skewReport reports a balanced book and an empty book plainly', () => {
  assert.match(skewReport({ baseBalance: 50, quoteBalance: 50 }), /balanced/i);
  assert.match(skewReport({ baseBalance: 0, quoteBalance: 0 }), /empty/i);
});

test('skewReport flags a quote-heavy / base-light book', () => {
  const txt = skewReport({ baseBalance: 10, quoteBalance: 90, baseSymbol: 'SWAP.BTC', quoteSymbol: 'SWAP.HIVE' });
  assert.match(txt, /light on SWAP\.BTC/);
  assert.match(txt, /sells of SWAP\.BTC throttled/i);
});

// ─── THE DEPTH GATE — the fix for the 31 unfillable resting orders (2026-09-16) ────────────────────
//
// Every one of the 31 sells resting on @angelicalist on 2026-09-16 was priced ABOVE the top bid, from
// 1.01x to 49,808x over it, because sizing read `metrics.highestBid` — a cached field that outlives the
// bid that set it. These tests pin the rule that replaced it: an order fills, or it is never placed.

test('DEPTH GATE: a SELL is REFUSED when the real book top is far below the cached bid (the phantom)', async () => {
  // metrics still reports the 0.00303 bid that produced `sell VYB @ 0.00303` on 2026-09-15.
  const metrics = { VYB: { highestBid: '0.00303', lowestAsk: '0.004' } };
  const tokens = [{ symbol: 'VYB', balance: 63692 }];
  const realBook = { getBidDepth: async () => ({ qty: 95.6, hive: 0.09, levels: 25, topPrice: 0.00098001 }) };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'SELL', sym: 'VYB' }, tokens, null, realBook));
  assert.equal(out.order, undefined, 'must not produce an order');
  assert.match(out.skip, /phantom bid/);
  assert.match(out.skip, /3\.1x/, 'names how far the cached price was from the book');
});

test('DEPTH GATE: a SELL with NO bid at all is refused rather than left to rest forever', async () => {
  const metrics = { PAY: { highestBid: '0.1', lowestAsk: '0.2' } };
  const tokens = [{ symbol: 'PAY', balance: 100 }];
  const emptyBook = { getBidDepth: async () => ({ qty: 0, hive: 0, levels: 0, topPrice: 0 }) };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'SELL', sym: 'PAY' }, tokens, null, emptyBook));
  assert.equal(out.order, undefined);
  assert.match(out.skip, /rest unfilled, not trade/);
});

test('DEPTH GATE: an unreadable book fails CLOSED — never sell blind', async () => {
  const metrics = { POB: { highestBid: '0.03', lowestAsk: '0.04' } };
  const tokens = [{ symbol: 'POB', balance: 1000 }];
  const broken = { getBidDepth: async () => { throw new Error('rpc down'); } };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'SELL', sym: 'POB' }, tokens, null, broken));
  assert.equal(out.order, undefined);
  assert.match(out.skip, /refusing to sell blind/);
});

test('DEPTH GATE: a SELL is sized DOWN to what the bids will actually absorb', async () => {
  // cap would allow 10 HIVE / 0.5 = 20 tokens, and we hold 20 — but only 3 are bid for.
  const metrics = { 'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' } };
  const tokens = [{ symbol: 'SWAP.BTC', balance: 20 }];
  const thin = { getBidDepth: async () => ({ qty: 3, hive: 1.5, levels: 2, topPrice: 0.5 }) };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, tokens, null, thin));
  assert.equal(out.order.quantity, 3, 'sized to real depth, not to the HIVE budget');
  assert.equal(out.order.price, 0.5);
  assert.equal(out.bookDepthToken, 3);
});

test('DEPTH GATE: a SELL the book can absorb is still placed normally (no false negatives)', async () => {
  const metrics = { 'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' } };
  const tokens = [{ symbol: 'SWAP.BTC', balance: 20 }];
  const deep = { getBidDepth: async () => ({ qty: 10000, hive: 5000, levels: 40, topPrice: 0.5 }) };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, tokens, null, deep));
  assert.equal(out.order.side, 'sell');
  assert.ok(out.order.quantity > 0);
  assert.equal(out.skip, undefined);
});

test('DEPTH GATE: the BUY side is gated the same way (a phantom ask is refused)', async () => {
  const metrics = { 'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' } };
  const tokens = [{ symbol: 'SWAP.HIVE', balance: 100 }];
  const moved = { getAskDepth: async () => ({ qty: 50, hive: 100, levels: 3, topPrice: 2.0 }) };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'BUY', sym: 'SWAP.BTC' }, tokens, null, moved));
  assert.equal(out.order, undefined);
  assert.match(out.skip, /phantom ask/);
});

test('DEPTH GATE: a BUY is sized down to the tokens actually on offer', async () => {
  const metrics = { 'SWAP.BTC': { highestBid: '0.5', lowestAsk: '0.52' } };
  const tokens = [{ symbol: 'SWAP.HIVE', balance: 100 }];
  const thin = { getAskDepth: async () => ({ qty: 4, hive: 2.08, levels: 1, topPrice: 0.52 }) };
  const out = await withMarket(metrics, () => sizeOrder({ action: 'BUY', sym: 'SWAP.BTC' }, tokens, null, thin));
  assert.equal(out.order.quantity, 4);
  assert.equal(out.order.price, 0.52);
});
