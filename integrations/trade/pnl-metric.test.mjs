// pnl-metric.test.mjs — OFFLINE tests. No network, no keys. Deterministic.
//   node --test integrations/trade/pnl-metric.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTripPnl, scorecard } from './pnl-metric.mjs';

test('roundTripPnl nets out fees', () => {
  const r = roundTripPnl({ entry: 1.0, exit: 1.1, qty: 100, feeIn: 0.25, feeOut: 0.28 });
  // gross = 0.1*100 = 10; net = 10 - 0.53 = 9.47
  assert.ok(Math.abs(r.gross - 10) < 1e-9);
  assert.ok(Math.abs(r.net - 9.47) < 1e-9);
  assert.ok(Math.abs(r.retFrac - 0.1) < 1e-9);
});

test('scorecard on pre-paired round-trips: hit-rate, expectancy, profitFactor', () => {
  const rt = [
    { entry: 1, exit: 1.1, qty: 100 },  // +10
    { entry: 1, exit: 1.2, qty: 100 },  // +20
    { entry: 1, exit: 0.9, qty: 100 },  // -10
  ];
  const s = scorecard(rt, { benchmarkPnl: 5 });
  assert.equal(s.roundTrips, 3);
  assert.ok(Math.abs(s.netPnl - 20) < 1e-9);
  assert.ok(Math.abs(s.hitRate - (2 / 3)) < 1e-6);
  assert.ok(Math.abs(s.avgWin - 15) < 1e-9);
  assert.ok(Math.abs(s.avgLoss - 10) < 1e-9);
  assert.ok(Math.abs(s.profitFactor - 3) < 1e-9); // 30 wins / 10 losses
  assert.ok(Math.abs(s.vsBenchmark - 15) < 1e-9); // 20 - 5
  assert.equal(s.profitable, true);
});

test('FIFO matches a buy/sell log into round-trips', () => {
  const log = [
    { symbol: 'X', side: 'buy', qty: 100, price: 1.00, fee: 0, ts: 1 },
    { symbol: 'X', side: 'sell', qty: 100, price: 1.10, fee: 0, ts: 2 },
  ];
  const s = scorecard(log);
  assert.equal(s.roundTrips, 1);
  assert.ok(Math.abs(s.netPnl - 10) < 1e-9);
});

test('naked sell is excluded from netPnl and recorded as dumpPnl', () => {
  const log = [
    { symbol: 'X', side: 'buy', qty: 100, price: 1.00, ts: 1 },
    { symbol: 'X', side: 'sell', qty: 100, price: 1.10, ts: 2 },  // real round-trip +10
    { symbol: 'Z', side: 'sell', qty: 1000, price: 0.05, ts: 3 }, // dump, no buy → NOT profit
  ];
  const s = scorecard(log);
  assert.equal(s.roundTrips, 1);
  assert.ok(Math.abs(s.netPnl - 10) < 1e-9);       // dump excluded
  assert.ok(Math.abs(s.dumpPnl - 50) < 1e-9);      // 1000 * 0.05 recorded separately
});

test('partial sell against a buy lot closes proportionally, leaves an open buy', () => {
  const log = [
    { symbol: 'X', side: 'buy', qty: 100, price: 1.00, ts: 1 },
    { symbol: 'X', side: 'sell', qty: 40, price: 1.50, ts: 2 }, // close 40 → +20
  ];
  const s = scorecard(log);
  assert.equal(s.roundTrips, 1);
  assert.ok(Math.abs(s.netPnl - 20) < 1e-9);
  assert.ok(Math.abs(s.openBuyCost - 60) < 1e-9); // 60 units @1.00 still open
});

test('profitable requires BOTH netPnl>0 AND beating the benchmark', () => {
  const rt = [{ entry: 1, exit: 1.05, qty: 100 }]; // +5 net
  assert.equal(scorecard(rt, { benchmarkPnl: 0 }).profitable, true);
  assert.equal(scorecard(rt, { benchmarkPnl: 10 }).profitable, false); // beaten by hold
});

test('soft-fail: junk rows skipped, empty log gives zeroed scorecard, never throws', () => {
  assert.equal(roundTripPnl({ entry: 0, exit: 1, qty: 1 }), null);
  assert.equal(roundTripPnl(null), null);
  const s = scorecard([{ junk: true }, { side: 'buy', qty: 'x', price: 1 }]);
  assert.equal(s.roundTrips, 0);
  assert.equal(s.netPnl, 0);
  assert.equal(s.profitable, false);
  assert.deepEqual(scorecard(null).roundTrips, 0);
});
