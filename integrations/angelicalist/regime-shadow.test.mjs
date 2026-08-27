// regime-shadow.test.mjs — OFFLINE tests for the READ-ONLY shadow harness.
// No network, no keys, no fs. Everything injected: the harness only OBSERVES (regime + router pick
// vs the live loop's action) and never signs, broadcasts, or drives the loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadowCompare, runShadow, buildMarketState } from './regime-shadow.mjs';

const DAY = 86_400_000, t0 = Date.UTC(2026, 0, 1);
const bars = (fn, n = 30) => Array.from({ length: n }, (_, i) => fn(i));
const deepBook = { buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [{ price: 1.01, quantity: 500 }] };
const FLAT = bars((i) => ({ t: t0 + i * DAY, open: 1, high: 1.004, low: 0.996, close: 1, volume: 100 }));

// ── shadowCompare — the pure comparison core ─────────────────────────────────────────────────────
test('shadowCompare logs regime + router pick + loop action side by side', () => {
  const sc = shadowCompare({
    marketState: { symbol: 'SWAP.DOGE', candles: FLAT, ...deepBook, arb: { edge: 0.06, execHive: 120, suspect: false } },
    snapshot: { hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 },
    loopResult: { orders: [], blocked: [{ sym: 'X' }], summary: {} }, // loop HELD this tick
  });
  assert.equal(sc.regime, 'PEG_DISLOCATED');
  assert.equal(sc.router.strategy, 'peg-arb');
  assert.ok(sc.router.orders.length >= 1);
  assert.match(sc.loop.action, /HOLD/);
  assert.ok(sc.lines.some((l) => l.startsWith('regime:')));
  assert.ok(sc.lines.some((l) => l.startsWith('router')));
  assert.ok(sc.lines.some((l) => l.startsWith('loop')));
});

test('shadowCompare surfaces the loop actually placing an order (read-only summary)', () => {
  const sc = shadowCompare({
    marketState: { symbol: 'X', candles: FLAT, ...deepBook },
    loopResult: { orders: [{ order: { side: 'buy', quantity: 10, symbol: 'SWAP.DOGE', price: 0.05 }, result: { simulated: true } }], blocked: [] },
  });
  assert.match(sc.loop.action, /BUY 10 SWAP\.DOGE @ 0\.05 \[SIM\]/);
});

test('every router order the shadow reports stays dryRun / keyless', () => {
  const sc = shadowCompare({
    marketState: { symbol: 'SWAP.DOGE', candles: FLAT, ...deepBook, arb: { edge: 0.06, execHive: 120, suspect: false } },
    snapshot: { hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 },
  });
  for (const o of sc.router.orders) { assert.equal(o.dryRun, true); assert.equal(o.signer, null); }
});

test('shadowCompare never throws on junk', () => {
  for (const junk of [null, undefined, {}, { marketState: 42 }]) {
    assert.doesNotThrow(() => shadowCompare(junk));
  }
});

// ── runShadow — injected readers + injected loop tick, all offline ───────────────────────────────
test('runShadow composes an injected market state + injected loop result', async () => {
  const r = await runShadow({
    marketState: { symbol: 'X', candles: FLAT, ...deepBook },
    route: { isIssuedToken: true },
    runLoop: async () => ({ orders: [], blocked: [], summary: {} }),
  });
  assert.equal(r.regime, 'RANGE');
  assert.equal(r.router.strategy, 'nudge'); // issued token in RANGE → troll-down ratchet
});

test('runShadow soft-fails when the injected loop throws (still returns a comparison)', async () => {
  const r = await runShadow({
    marketState: { symbol: 'X', candles: FLAT, ...deepBook },
    runLoop: async () => { throw new Error('loop boom'); },
  });
  assert.ok(r.regime);
  assert.match(r.loop.action, /loop error/);
});

test('buildMarketState assembles from injected read-only readers, soft-failing', async () => {
  const ms = await buildMarketState({
    symbol: 'VKBT',
    loadHistory: async () => FLAT,
    buyBook: async () => deepBook.buyBook,
    sellBook: async () => deepBook.sellBook,
    arbRowFor: async () => ({ edge: 0.01, execHive: 5, suspect: false }),
  });
  assert.equal(ms.symbol, 'VKBT');
  assert.equal(ms.candles.length, 30);
  assert.ok(Array.isArray(ms.buyBook));
});

test('buildMarketState never throws when a reader fails', async () => {
  const ms = await buildMarketState({
    symbol: 'VKBT',
    loadHistory: async () => { throw new Error('net down'); },
    buyBook: async () => { throw new Error('net down'); },
  });
  assert.equal(ms.symbol, 'VKBT');
});
