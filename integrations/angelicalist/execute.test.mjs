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
    sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, TOKENS));
  assert.equal(out.order.side, 'sell');
  assert.equal(out.order.symbol, 'SWAP.BTC');
  assert.equal(out.order.price, 0.5);
  // cap is 10 HIVE proceeds / 0.5 price = 20 qty (also exactly the balance), proceeds 10.
  assert.equal(out.order.quantity, 20);
  assert.equal(out.proceedsHive, 10);
});

test('sizeOrder BUY sizes against the ask and caps spend at MAX_ORDER_HIVE', async () => {
  const out = await withMarket(MARKET, () =>
    sizeOrder({ action: 'BUY', sym: 'SWAP.BTC' }, TOKENS));
  assert.equal(out.order.side, 'buy');
  assert.equal(out.order.price, 0.52);
  // spend = min(10, 100) = 10; qty = 10 / 0.52.
  assert.equal(out.spendHive, 10);
  assert.equal(out.order.quantity, +(10 / 0.52).toFixed(8));
});

test('sizeOrder skips a SELL with no balance and a BUY with no SWAP.HIVE', async () => {
  const noBtc = [{ symbol: 'SWAP.HIVE', balance: 100 }];
  const sell = await withMarket(MARKET, () => sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, noBtc));
  assert.match(sell.skip, /no SWAP\.BTC balance/);

  const noHive = [{ symbol: 'SWAP.BTC', balance: 20 }];
  const buy = await withMarket(MARKET, () => sizeOrder({ action: 'BUY', sym: 'SWAP.BTC' }, noHive));
  assert.match(buy.skip, /< min/);
});

test('sizeOrder skips when there are no market metrics', async () => {
  const out = await withMarket({}, () => sizeOrder({ action: 'BUY', sym: 'SWAP.NOPE' }, TOKENS));
  assert.match(out.skip, /no market metrics/);
});

test('BACKWARD-COMPAT: sizeOrder WITHOUT inventory is byte-identical to passing inventory=null', async () => {
  // The contract dry-run.mjs/backtest.mjs rely on: two-arg sizeOrder behaves exactly as before.
  for (const sym of ['SWAP.BTC', 'SWAP.LTC']) {
    for (const action of ['BUY', 'SELL']) {
      const a = await withMarket(MARKET, () => sizeOrder({ action, sym }, TOKENS));
      const b = await withMarket(MARKET, () => sizeOrder({ action, sym }, TOKENS, null));
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
    sizeOrder({ action: 'BUY', sym: 'SWAP.LTC' }, TOKENS));            // no inventory → full size

  const heavyLtc = { baseBalance: 95000, quoteBalance: 5000 };         // ~95% SWAP.LTC
  const throttled = await withMarket(MARKET, () =>
    sizeOrder({ action: 'BUY', sym: 'SWAP.LTC' }, TOKENS, heavyLtc));

  assert.ok(baseline.order, 'baseline LTC buy is sized');
  assert.ok(throttled.order || throttled.skip, 'throttled call returns an order or a skip');
  const throttledQty = throttled.order ? throttled.order.quantity : 0;
  assert.ok(throttledQty < baseline.order.quantity, 'LTC buy is throttled when LTC-heavy');
  assert.ok(throttledQty <= baseline.order.quantity * 0.2, 'heavy LTC ⇒ buy shrunk to a small fraction');
});

test('an inventory-reducing SELL of the over-held asset is NOT throttled (it rebalances)', async () => {
  const heavyBtc = { baseBalance: 95, quoteBalance: 5 };               // base(BTC)-heavy
  const sell = await withMarket(MARKET, () =>
    sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, TOKENS, heavyBtc));
  const baseline = await withMarket(MARKET, () =>
    sizeOrder({ action: 'SELL', sym: 'SWAP.BTC' }, TOKENS));
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
