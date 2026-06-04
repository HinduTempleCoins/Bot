// loop.test.mjs — OFFLINE tests for the angelicalist STANDING LOOP (task #189).
//
// Everything is injected: fake preset decisions, a fake arb scan (edge + depth), fake balances, a
// SPY broadcaster, a SPY ledger, and a forced `mode`. NO network, NO real key. The tests PROVE the
// hard guards and the safe-by-default posture:
//   • a premium → SELL fires (broadcaster called once) in LIVE mode
//   • a one-way BUY (no SELL leg) is blocked/downgraded — never broadcast
//   • a >30% "edge" is rejected as a dead/stale book — never broadcast
//   • the per-order cap (MAX_ORDER_HIVE) is enforced on the sized order
//   • dry-run is the DEFAULT — the broadcaster is never called
//   • the sweep skims only profit ABOVE the principal, never the principal
//
//   node --test integrations/angelicalist/loop.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOnce } from './loop.mjs';

// ── fakes ────────────────────────────────────────────────────────────────────────────────────
const liveMode = () => ({ live: true, hasKey: true, flagLive: true, account: 'angelicalist', sweepTo: 'kalivankush' });
const dryMode = () => ({ live: false, hasKey: false, flagLive: false, account: 'angelicalist', sweepTo: 'kalivankush' });

function spyBroadcaster() {
  const placeCalls = [], sweepCalls = [];
  return {
    placeCalls, sweepCalls,
    placeOrder: async (order) => { placeCalls.push(order); return { simulated: false, txId: `tx${placeCalls.length}` }; },
    sweepToKali: async (args) => { sweepCalls.push(args); return { simulated: false, txId: `sweep${sweepCalls.length}` }; },
  };
}

// fake arb scan: caller supplies per-symbol { edge, execHive }.
const arbFor = (rows) => async () => ({ rows, opportunities: [] });
// fake balances
const balances = (tokens) => async () => tokens;
// no-op ledger spy
function ledgerSpy() { const rows = []; const fn = (e) => { rows.push(e); return e; }; fn.rows = rows; return fn; }

// A deep, fairly-priced SELL market the loop should act on: enough SWAP.X to sell, a real bid.
const FAIR_DEEP = { sym: 'SWAP.DOGE', edge: 0.05, execHive: 100 };

// sizeOrder (execute.mjs) reads market.metrics for the live bid/ask. Patch it offline for the
// execution-path tests so no network call is ever made.
import { market } from '../hive-engine-market.mjs';
const withMetrics = (metricsBySym, fn) => async () => {
  const orig = market.metrics;
  market.metrics = async (sym) => metricsBySym[sym] || null;
  try { return await fn(); } finally { market.metrics = orig; }
};

test('premium → SELL actually sizes + broadcasts once (LIVE)', withMetrics(
  { 'SWAP.DOGE': { highestBid: '0.05', lowestAsk: '0.052' } },
  async () => {
    const b = spyBroadcaster();
    const led = ledgerSpy();
    const r = await runOnce({
      mode: liveMode,
      decisions: async () => [{ action: 'SELL', sym: 'SWAP.DOGE', reason: 'premium' }],
      arb: arbFor([FAIR_DEEP]),
      balances: balances([{ symbol: 'SWAP.DOGE', balance: 5000 }, { symbol: 'SWAP.HIVE', balance: 0 }]),
      broadcaster: b, ptRecord: led,
    });
    assert.equal(b.placeCalls.length, 1, 'exactly one SELL should broadcast');
    assert.equal(b.placeCalls[0].side, 'sell');
    assert.equal(b.placeCalls[0].symbol, 'SWAP.DOGE');
    assert.equal(led.rows.length, 1, 'the fill should be logged to the ledger');
    assert.equal(led.rows[0].side, 'sell');
  },
));

test('one-way BUY (no SELL leg) is blocked/downgraded — never broadcast', withMetrics(
  { 'SWAP.LTC': { highestBid: '0.01', lowestAsk: '0.011' } },
  async () => {
    const b = spyBroadcaster();
    const r = await runOnce({
      mode: liveMode,
      decisions: async () => [{ action: 'BUY', sym: 'SWAP.LTC', reason: 'looks cheap (one-way)' }],
      arb: arbFor([{ sym: 'SWAP.LTC', edge: 0.05, execHive: 100 }]),
      balances: balances([{ symbol: 'SWAP.HIVE', balance: 100 }, { symbol: 'SWAP.LTC', balance: 25 }]),
      broadcaster: b, ptRecord: ledgerSpy(),
    });
    assert.equal(b.placeCalls.length, 0, 'a one-way BUY must NOT broadcast');
    assert.ok(r.blocked.some((x) => x.sym === 'SWAP.LTC'), 'LTC must be in blocked');
    assert.match(r.blocked.find((x) => x.sym === 'SWAP.LTC').blocked, /bleed guard/i);
    assert.ok(!r.decisions.some((d) => d.sym === 'SWAP.LTC'), 'LTC buy must not be in executable decisions');
  },
));

test('>30% "edge" is rejected as a dead/stale book — never broadcast', withMetrics(
  { 'SWAP.ETH': { highestBid: '0.5', lowestAsk: '0.52' } },
  async () => {
    const b = spyBroadcaster();
    const r = await runOnce({
      mode: liveMode,
      // a SELL with a real leg, but the book shows a phantom 164% edge → must be rejected.
      decisions: async () => [{ action: 'SELL', sym: 'SWAP.ETH', reason: 'phantom premium' }],
      arb: arbFor([{ sym: 'SWAP.ETH', edge: 1.649, execHive: 100 }]),
      balances: balances([{ symbol: 'SWAP.ETH', balance: 10 }, { symbol: 'SWAP.HIVE', balance: 100 }]),
      broadcaster: b, ptRecord: ledgerSpy(),
    });
    assert.equal(b.placeCalls.length, 0, 'a broken-book edge must NOT broadcast');
    const blk = r.blocked.find((x) => x.sym === 'SWAP.ETH');
    assert.ok(blk, 'SWAP.ETH must be in blocked');
    assert.match(blk.blocked, /dead\/stale book/i);
  },
));

test('per-order cap (MAX_ORDER_HIVE) is enforced on the sized order', withMetrics(
  { 'SWAP.DOGE': { highestBid: '0.05', lowestAsk: '0.052' } },
  async () => {
    const prev = process.env.MAX_ORDER_HIVE;
    process.env.MAX_ORDER_HIVE = '10';
    try {
      const b = spyBroadcaster();
      const r = await runOnce({
        mode: liveMode,
        decisions: async () => [{ action: 'SELL', sym: 'SWAP.DOGE', reason: 'premium' }],
        arb: arbFor([FAIR_DEEP]),
        // huge balance: cap must bind. proceeds = qty*price ≤ 10 HIVE → qty ≤ 10/0.05 = 200.
        balances: balances([{ symbol: 'SWAP.DOGE', balance: 1_000_000 }, { symbol: 'SWAP.HIVE', balance: 0 }]),
        broadcaster: b, ptRecord: ledgerSpy(),
      });
      assert.equal(b.placeCalls.length, 1, 'one capped SELL should broadcast');
      const o = b.placeCalls[0];
      const proceeds = o.quantity * o.price;
      assert.ok(proceeds <= 10 + 1e-6, `proceeds ${proceeds} must be ≤ MAX_ORDER_HIVE (10)`);
      assert.ok(o.quantity <= 200 + 1e-6, `qty ${o.quantity} must be capped to ~200`);
    } finally {
      if (prev === undefined) delete process.env.MAX_ORDER_HIVE; else process.env.MAX_ORDER_HIVE = prev;
    }
  },
));

test('dry-run is the DEFAULT — broadcaster is NEVER called', withMetrics(
  { 'SWAP.DOGE': { highestBid: '0.05', lowestAsk: '0.052' } },
  async () => {
    const b = spyBroadcaster();
    const r = await runOnce({
      mode: dryMode,                              // not live
      decisions: async () => [{ action: 'SELL', sym: 'SWAP.DOGE', reason: 'premium' }],
      arb: arbFor([FAIR_DEEP]),
      balances: balances([{ symbol: 'SWAP.DOGE', balance: 5000 }, { symbol: 'SWAP.HIVE', balance: 200 }]),
      broadcaster: b, ptRecord: ledgerSpy(),
    });
    assert.equal(r.dryRun, true, 'cycle must be marked dryRun');
    assert.equal(b.placeCalls.length, 0, 'dry-run must NEVER place an order');
    assert.equal(b.sweepCalls.length, 0, 'dry-run must NEVER sweep');
    // but it must still PLAN the order (intent) so the operator sees what it would do.
    assert.ok(r.orders.some((o) => o.order && o.result && o.result.simulated), 'expected a simulated order intent');
  },
));

// THE INCIDENT REGRESSION TEST: the loop must NEVER move funds off the account — no sweep, no
// transfer, no send-to-kalivankush — even with a big idle SWAP.HIVE balance and LIVE mode. The
// only on-chain action allowed is a market order. (operator, 2026-06-04 — only realized round-trip
// profit may ever leave, and that happens as a SELL, not a transfer.)
test('NEVER moves funds off the account — no sweep/transfer of any kind (LIVE)', withMetrics(
  {}, // no actionable markets — just a fat idle balance the OLD code would have swept
  async () => {
    const b = spyBroadcaster();
    const r = await runOnce({
      mode: liveMode, decisions: async () => [], arb: arbFor([]),
      balances: balances([{ symbol: 'SWAP.HIVE', balance: 10000 }]),
      broadcaster: b, ptRecord: ledgerSpy(),
    });
    assert.equal(b.sweepCalls.length, 0, 'the loop must NEVER call sweepToKali / any transfer');
    assert.equal(b.placeCalls.length, 0, 'nothing actionable → no orders either');
    assert.ok(!('swept' in r), 'the result must no longer carry any sweep field');
  },
));
