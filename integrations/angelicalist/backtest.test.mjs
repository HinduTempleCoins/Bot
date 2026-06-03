// backtest.test.mjs — OFFLINE tests for the keyless HE-history backtester.
// No network: history is INJECTED via __setData() or passed directly to backtest(). Every assertion
// is deterministic over synthetic candles. Nothing here broadcasts or holds a key.
//   node --test integrations/angelicalist/backtest.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadHistory, simulateFill, backtest, wouldHaveCaught, report, defaultStrategy, __setData,
} from './backtest.mjs';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);

// helpers ───────────────────────────────────────────────────────────────────────────────────────
function flat(price, vol = 500, i = 0, extra = {}) {
  return { t: t0 + i * DAY, open: price, high: price * 1.02, low: price * 0.98, close: price, volume: vol, ...extra };
}
// A profitable oscillating series: a clean square-wave of LOW plateaus then HIGH plateaus. The
// trailing average sits between the two, so the discount-buy / premium-sell strategy buys on the
// cheap plateau and sells on the dear plateau — a real edge that survives fees + depth impact.
// Deep books (volume 10000) keep per-trade impact tiny (100/10000 = 1% of depth).
function oscillating() {
  const lows = [1, 1, 1, 1];      // buy here
  const highs = [2, 2, 2, 2];     // sell here
  const cycle = [...lows, ...highs];
  const out = [];
  for (let k = 0; k < 5; k++) {   // 5 cycles
    for (let j = 0; j < cycle.length; j++) {
      const price = cycle[j];
      const i = k * cycle.length + j;
      out.push({ t: t0 + i * DAY, open: price, high: price * 1.001, low: price * 0.999, close: price, volume: 10000 });
    }
  }
  return out;
}
// A one-way bleed series: relentless BUYING pressure (each bar closes above its open = the bot
// lifting the ask) while the overall price trend FALLS — the SWAP.LTC shape.
function bleedSeries(n = 20) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const price = 60 - i * 2.5;          // overall falling trend
    out.push({ t: t0 + i * DAY, open: price - 0.5, high: price + 0.2, low: price - 0.7, close: price, volume: 300 });
  }
  return out;
}

// ── loadHistory: injected source, offline ────────────────────────────────────────────────────────
test('loadHistory uses the injected source and normalizes + time-sorts (offline)', async () => {
  __setData(async ({ token }) => ([
    { timestamp: t0 + 2 * DAY, price: 3, quantity: 10 },
    { timestamp: t0 + 0 * DAY, price: 1, quantity: 5 },
    { timestamp: t0 + 1 * DAY, price: 2, quantity: 7 },
    null, { junk: true },                       // junk rows are soft-skipped
  ]));
  const h = await loadHistory({ token: 'SWAP.X', days: 7 });
  __setData(null);
  assert.equal(h.length, 3);
  assert.deepEqual(h.map((c) => c.close), [1, 2, 3]); // sorted ascending by time
  assert.ok(h.every((c) => c.open === c.close && c.high === c.close && c.low === c.close)); // degenerate candle
});

test('loadHistory soft-fails to [] when the injected source throws', async () => {
  __setData(async () => { throw new Error('boom'); });
  const h = await loadHistory({ token: 'SWAP.X' });
  __setData(null);
  assert.deepEqual(h, []);
});

// ── simulateFill: depth-aware ─────────────────────────────────────────────────────────────────────
test('simulateFill: small buy fills fully at ~intended price (low impact)', () => {
  const c = flat(1, 0, 0, { askDepth: 1000, low: 0.9, high: 1.1 });
  const f = simulateFill({ side: 'buy', symbol: 'X', quantity: 10, price: 1 }, c);
  assert.equal(f.filledQty, 10);
  assert.equal(f.partial, false);
  assert.ok(f.avgPrice >= 1 && f.avgPrice < 1.002); // 1% of depth → ~0.1% impact, negligible
  assert.ok(f.fee > 0); // fees always charged
});

test('simulateFill: oversized buy PARTIAL-fills and price WORSENS vs a small buy', () => {
  const c = flat(1, 0, 0, { askDepth: 100, low: 0.9, high: 1.1 });
  const small = simulateFill({ side: 'buy', symbol: 'X', quantity: 5, price: 1 }, c);
  const big = simulateFill({ side: 'buy', symbol: 'X', quantity: 500, price: 1 }, c);
  assert.equal(big.filledQty, 100);     // capped at depth
  assert.equal(big.partial, true);      // wanted 500, got 100
  assert.ok(big.avgPrice > small.avgPrice); // bigger order pays a worse average price
});

test('simulateFill: a sell never receives more than its intended/high price; impact lowers it', () => {
  const c = flat(2, 0, 0, { bidDepth: 50, low: 1.8, high: 2.2 });
  const f = simulateFill({ side: 'sell', symbol: 'X', quantity: 50, price: 2 }, c);
  assert.equal(f.filledQty, 50);
  assert.ok(f.avgPrice <= 2);           // never better than intended
  assert.ok(f.avgPrice < 2);            // full-depth consumption → real impact down
});

test('simulateFill: no depth → no fill', () => {
  const c = flat(1, 0, 0, { askDepth: 0 });
  const f = simulateFill({ side: 'buy', symbol: 'X', quantity: 10, price: 1 }, c);
  assert.equal(f.filledQty, 0);
});

// ── backtest: profitable series ───────────────────────────────────────────────────────────────────
test('backtest on a profitable oscillating series yields positive realizedPnl + sane equity curve', () => {
  const r = backtest({ history: { 'SWAP.OSC': oscillating() }, startingBalance: 1000 });
  assert.ok(r.trades.length > 0, 'should have traded');
  assert.ok(r.realizedPnl > 0, `expected profit, got ${r.realizedPnl}`);
  assert.equal(r.equity.length, oscillating().length);     // one equity point per candle
  assert.ok(r.equity.every((e) => Number.isFinite(e.value) && e.value > 0)); // sane curve
  assert.ok(r.finalBalance > 1000); // ended richer than it started
});

// ── backtest: bleed series triggers detection ──────────────────────────────────────────────────────
test('a one-way bleed series triggers bleedEvents and wouldHaveCaught', () => {
  const series = bleedSeries();
  const caught = wouldHaveCaught({ 'SWAP.LTC': series });
  assert.ok(caught.length >= 1, 'wouldHaveCaught should flag the bleed');
  assert.equal(caught[0].market, 'SWAP.LTC');
  assert.ok(caught[0].hiveAtRisk > 0);
  assert.ok(caught[0].priceDropPct > 0);
  assert.match(caught[0].why, /one-way/);

  const r = backtest({ history: { 'SWAP.LTC': series }, startingBalance: 1000 });
  assert.ok(r.bleedEvents.length >= 1, 'backtest result should carry the bleed event');
  assert.equal(r.bleedEvents[0].market, 'SWAP.LTC');
});

test('wouldHaveCaught is quiet on a healthy two-way market', () => {
  const healthy = oscillating();
  const caught = wouldHaveCaught({ 'SWAP.OSC': healthy });
  assert.equal(caught.length, 0);
});

// ── maxDrawdown math on a known series ──────────────────────────────────────────────────────────────
test('maxDrawdown is computed correctly on a known equity curve (no trades → pure mark-to-market)', () => {
  // strategy that never trades → equity == cash flat → drawdown 0.
  const hold = () => ({ action: 'HOLD' });
  const series = [flat(1, 500, 0), flat(1, 500, 1), flat(1, 500, 2)];
  const r = backtest({ history: { 'X': series }, strategy: hold, startingBalance: 1000 });
  assert.equal(r.maxDrawdown, 0);
  assert.ok(r.equity.every((e) => e.value === 1000));
});

test('maxDrawdown reflects a real peak-to-trough drop', () => {
  // Force a long position then a price crash so equity (cash + inventory mark) falls from a peak.
  // buy at candle 1 (dip), then price collapses → inventory mark sinks → measurable drawdown.
  const series = [
    flat(10, 1000, 0),
    { t: t0 + 1 * DAY, open: 10, high: 10, low: 5, close: 5, volume: 1000 },   // crash
    { t: t0 + 2 * DAY, open: 5, high: 5, low: 5, close: 5, volume: 1000 },
  ];
  // a strategy that buys on candle 1 unconditionally, then holds
  const buyThenHold = ({ i }) => i === 0
    ? { action: 'BUY', sym: 'X', quantity: 50, price: 10 }
    : { action: 'HOLD' };
  const r = backtest({ history: { 'X': series }, strategy: buyThenHold, startingBalance: 1000 });
  assert.ok(r.maxDrawdown > 0, 'should record a drawdown after the crash');
  assert.ok(r.maxDrawdown <= 1);
});

// ── determinism ──────────────────────────────────────────────────────────────────────────────────
test('deterministic: same input → identical output', () => {
  const hist = { 'SWAP.OSC': oscillating() };
  const a = backtest({ history: hist, startingBalance: 1000 });
  const b = backtest({ history: hist, startingBalance: 1000 });
  assert.deepEqual(a.trades, b.trades);
  assert.deepEqual(a.equity, b.equity);
  assert.equal(a.realizedPnl, b.realizedPnl);
  assert.equal(a.maxDrawdown, b.maxDrawdown);
  assert.equal(a.finalBalance, b.finalBalance);
});

// ── report: plain English ────────────────────────────────────────────────────────────────────────
test('report is plain-English and names the bleed', () => {
  const r = backtest({ history: { 'SWAP.LTC': bleedSeries() }, startingBalance: 1000 });
  const text = report(r);
  assert.match(text, /would have turned .* into .* HIVE/);
  assert.match(text, /max drawdown/i);
  assert.match(text, /bleed pattern.*detected/i);
  assert.match(text, /SWAP\.LTC/);
  // no jargon leak: no file paths or function names in the operator-facing text
  assert.doesNotMatch(text, /\.mjs|function|undefined|NaN/);
});

test('report on a clean profitable run says no bleed detected', () => {
  const r = backtest({ history: { 'SWAP.OSC': oscillating() }, startingBalance: 1000 });
  const text = report(r);
  assert.match(text, /No SWAP\.LTC-style one-way bleed detected/);
});

// ── defaultStrategy: no look-ahead ────────────────────────────────────────────────────────────────
test('defaultStrategy holds during warm-up (never peeks past the current candle)', () => {
  const strat = defaultStrategy({ token: 'X', lookback: 5 });
  const candles = oscillating();
  for (let i = 0; i < 5; i++) {
    const d = strat({ candles, i, position: { qty: 0, costHive: 0 } });
    assert.equal(d.action, 'HOLD');
  }
});
