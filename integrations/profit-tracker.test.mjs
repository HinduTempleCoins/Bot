// profit-tracker.test.mjs — OFFLINE. FIFO P&L math, summary aggregation, save/load round-trip.
//   node --test integrations/profit-tracker.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import {
  record, pnl, summary, save, load, reset, entries,
  maxDrawdown, sharpe, sortino, profitFactor, winRate, expectancy, performanceReport,
} from './profit-tracker.mjs';

beforeEach(() => reset());

test('buy then higher sell yields positive P&L net of fees', () => {
  record({ account: 'bot', market: 'SWAP.DOGE', side: 'buy', qty: 100, price: 0.04, feeHive: 0.1 });
  record({ account: 'bot', market: 'SWAP.DOGE', side: 'sell', qty: 100, price: 0.05, feeHive: 0.1 });
  const p = pnl();
  // gross = 100 * (0.05 - 0.04) = 1.0 ; fees = 0.2 ; realized = 0.8
  assert.ok(Math.abs(p.markets['SWAP.DOGE'].gross - 1.0) < 1e-9);
  assert.ok(Math.abs(p.markets['SWAP.DOGE'].fees - 0.2) < 1e-9);
  assert.ok(Math.abs(p.markets['SWAP.DOGE'].realized - 0.8) < 1e-9);
  assert.ok(p.markets['SWAP.DOGE'].realized > 0);
});

test('buy then lower sell yields a loss', () => {
  record({ account: 'bot', market: 'SWAP.LTC', side: 'buy', qty: 2, price: 60 });
  record({ account: 'bot', market: 'SWAP.LTC', side: 'sell', qty: 2, price: 50 });
  const p = pnl();
  assert.ok(Math.abs(p.markets['SWAP.LTC'].realized - (-20)) < 1e-9);
});

test('FIFO: partial fills consume oldest lots first', () => {
  // two buy lots at different prices, then a sell that spans both
  record({ account: 'bot', market: 'X', side: 'buy', qty: 10, price: 1 });   // lot 1 (oldest)
  record({ account: 'bot', market: 'X', side: 'buy', qty: 10, price: 2 });   // lot 2
  record({ account: 'bot', market: 'X', side: 'sell', qty: 15, price: 3 });  // consumes 10@1 + 5@2
  const p = pnl();
  // gain = 10*(3-1) + 5*(3-2) = 20 + 5 = 25 ; openQty = 5 left from lot 2
  assert.ok(Math.abs(p.markets['X'].realized - 25) < 1e-9);
  assert.ok(Math.abs(p.markets['X'].openQty - 5) < 1e-9);
  assert.ok(Math.abs(p.markets['X'].openCost - 10) < 1e-9); // 5 units * price 2
});

test('partial sell leaves remaining buy inventory open', () => {
  record({ account: 'bot', market: 'Y', side: 'buy', qty: 100, price: 0.5 });
  record({ account: 'bot', market: 'Y', side: 'sell', qty: 40, price: 0.6 });
  const p = pnl();
  assert.ok(Math.abs(p.markets['Y'].realized - 40 * 0.1) < 1e-9);
  assert.ok(Math.abs(p.markets['Y'].openQty - 60) < 1e-9);
});

test('pnl scopes by account and market', () => {
  record({ account: 'a', market: 'M1', side: 'buy', qty: 1, price: 10 });
  record({ account: 'a', market: 'M1', side: 'sell', qty: 1, price: 12 });
  record({ account: 'b', market: 'M2', side: 'buy', qty: 1, price: 10 });
  record({ account: 'b', market: 'M2', side: 'sell', qty: 1, price: 8 });
  assert.ok(Math.abs(pnl({ account: 'a' }).total.realized - 2) < 1e-9);
  assert.ok(Math.abs(pnl({ account: 'b' }).total.realized - (-2)) < 1e-9);
  assert.ok(Math.abs(pnl({ market: 'M1' }).total.realized - 2) < 1e-9);
});

test('summary aggregates trades, volume, net P&L, best/worst market', () => {
  record({ account: 'bot', market: 'WIN', side: 'buy', qty: 10, price: 1 });
  record({ account: 'bot', market: 'WIN', side: 'sell', qty: 10, price: 2 });   // +10
  record({ account: 'bot', market: 'LOSE', side: 'buy', qty: 10, price: 5 });
  record({ account: 'bot', market: 'LOSE', side: 'sell', qty: 10, price: 4 });  // -10
  const s = summary();
  assert.equal(s.trades, 4);
  assert.equal(s.markets, 2);
  // volume = 10 + 20 + 50 + 40 = 120
  assert.ok(Math.abs(s.volume - 120) < 1e-9);
  assert.ok(Math.abs(s.netPnl - 0) < 1e-9);
  assert.equal(s.best.market, 'WIN');
  assert.equal(s.worst.market, 'LOSE');
});

test('record validates required fields and side', () => {
  assert.throws(() => record({ market: 'X', side: 'buy', qty: 1, price: 1 }), /account/);
  assert.throws(() => record({ account: 'a', side: 'buy', qty: 1, price: 1 }), /market/);
  assert.throws(() => record({ account: 'a', market: 'X', side: 'hold', qty: 1, price: 1 }), /side/);
  assert.throws(() => record({ account: 'a', market: 'X', side: 'buy', qty: 0, price: 1 }), /qty/);
});

// --- performance metrics ---------------------------------------------------

test('maxDrawdown on a known curve: peak 100 → trough 60 = 40%', () => {
  const equity = [
    { t: 0, value: 80 },
    { t: 1, value: 100 },  // peak
    { t: 2, value: 90 },
    { t: 3, value: 60 },   // trough
    { t: 4, value: 75 },
  ];
  const dd = maxDrawdown(equity);
  assert.equal(dd.ok, true);
  assert.ok(Math.abs(dd.pct - 0.4) < 1e-9);
  assert.equal(dd.peak, 100);
  assert.equal(dd.trough, 60);
  assert.equal(dd.peakAt, 1);
  assert.equal(dd.troughAt, 3);
});

test('maxDrawdown on a monotonically rising curve is 0', () => {
  const dd = maxDrawdown([{ t: 0, value: 10 }, { t: 1, value: 20 }, { t: 2, value: 30 }]);
  assert.equal(dd.ok, true);
  assert.equal(dd.pct, 0);
});

test('sharpe on a known return series (hand-computed)', () => {
  const returns = [0.01, 0.02, -0.01, 0.03, 0.00];
  // mean = 0.01 ; sample stddev (n-1) = sqrt(0.001/4) = 0.0158113883 ; sharpe = 0.6324555
  const s = sharpe(returns);
  assert.equal(s.ok, true);
  assert.ok(Math.abs(s.mean - 0.01) < 1e-12);
  assert.ok(Math.abs(s.stddev - 0.0158113883) < 1e-9);
  assert.ok(Math.abs(s.value - 0.6324555320) < 1e-9);
});

test('sharpe respects riskFreeRate', () => {
  const returns = [0.01, 0.02, -0.01, 0.03, 0.00];
  const base = sharpe(returns).value;
  const withRf = sharpe(returns, { riskFreeRate: 0.005 }).value;
  // subtracting a constant lowers the mean but keeps stddev → lower ratio
  assert.ok(withRf < base);
});

test('sortino on a known return series (hand-computed)', () => {
  const returns = [0.01, 0.02, -0.01, 0.03, 0.00];
  // mean = 0.01 ; only negative excess = -0.01 ; dd = sqrt(0.0001/5) = 0.004472136 ; sortino = 2.236068
  const s = sortino(returns);
  assert.equal(s.ok, true);
  assert.ok(Math.abs(s.downsideDeviation - 0.0044721360) < 1e-9);
  assert.ok(Math.abs(s.value - 2.2360679775) < 1e-9);
});

test('sortino ignores upside volatility: big-wins series beats symmetric one', () => {
  // both have positive mean; symmetric has downside swings, upside-heavy has fewer/smaller downs
  const symmetric = [-0.05, 0.05, -0.04, 0.06, -0.03, 0.06]; // mean = 0.00833...
  const upsideHeavy = [0.20, 0.30, -0.01, 0.25, -0.01, 0.10]; // big wins, tiny losses
  const a = sortino(symmetric).value;
  const b = sortino(upsideHeavy).value;
  assert.ok(b > a, `expected upside-heavy ${b} > symmetric ${a}`);
});

test('sortino with no downside returns ok:false (no NaN/Infinity)', () => {
  const s = sortino([0.01, 0.02, 0.03]);
  assert.equal(s.ok, false);
  assert.equal(s.value, 0);
  assert.ok(Number.isFinite(s.value));
});

test('profitFactor on a known win/loss set', () => {
  // wins: 10 + 5 = 15 ; losses: 4 + 1 = 5 ; pf = 3.0
  const pf = profitFactor([10, -4, 5, -1]);
  assert.equal(pf.ok, true);
  assert.ok(Math.abs(pf.grossWins - 15) < 1e-9);
  assert.ok(Math.abs(pf.grossLosses - 5) < 1e-9);
  assert.ok(Math.abs(pf.value - 3.0) < 1e-9);
});

test('profitFactor is Infinity-safe on all-wins', () => {
  const pf = profitFactor([1, 2, 3]);
  assert.equal(pf.value, Infinity);
  assert.equal(pf.ok, true);
  assert.equal(pf.grossLosses, 0);
});

test('profitFactor extracts pnl from trade objects', () => {
  const pf = profitFactor([{ pnl: 8 }, { realized: -2 }, { pnl: 2 }]);
  // wins 10, losses 2 → pf = 5
  assert.ok(Math.abs(pf.value - 5) < 1e-9);
});

test('winRate on a known set', () => {
  const wr = winRate([3, -1, 2, -2, 5]); // 3 wins, 2 losses of 5
  assert.equal(wr.wins, 3);
  assert.equal(wr.losses, 2);
  assert.ok(Math.abs(wr.rate - 0.6) < 1e-9);
});

test('expectancy on a known set', () => {
  // wins: 4, 6 (avg 5), winRate 2/4 = 0.5 ; losses: -2, -2 (avg mag 2), lossRate 0.5
  // expectancy = 5*0.5 - 2*0.5 = 2.5 - 1.0 = 1.5
  const e = expectancy([4, -2, 6, -2]);
  assert.equal(e.ok, true);
  assert.ok(Math.abs(e.avgWin - 5) < 1e-9);
  assert.ok(Math.abs(e.avgLoss - 2) < 1e-9);
  assert.ok(Math.abs(e.value - 1.5) < 1e-9);
});

test('performance metrics are NaN-free / safe on empty input', () => {
  const dd = maxDrawdown([]);
  const sh = sharpe([]);
  const so = sortino([]);
  const pf = profitFactor([]);
  const wr = winRate([]);
  const ex = expectancy([]);
  for (const r of [dd, sh, so, pf, wr, ex]) assert.equal(r.ok, false);
  for (const v of [dd.pct, sh.value, so.value, pf.value, wr.rate, ex.value]) {
    assert.ok(!Number.isNaN(v), `got NaN: ${v}`);
    assert.ok(Number.isFinite(v), `got non-finite: ${v}`);
  }
});

test('performanceReport produces a plain-English line', () => {
  const trades = [10, -4, 5, -1];
  const equity = [{ t: 0, value: 100 }, { t: 1, value: 60 }, { t: 2, value: 75 }];
  const r = performanceReport(trades, equity);
  assert.equal(r.trades, 4);
  assert.ok(Math.abs(r.netPnl - 10) < 1e-9);
  assert.ok(Math.abs(r.profitFactor.value - 3.0) < 1e-9);
  assert.match(r.english, /Profit factor 3\.00 — for every 1 lost, 3\.00 won\./);
  assert.match(r.english, /Win rate 50%/);
  assert.match(r.english, /Max drawdown 40\.0%/);
});

test('performanceReport handles empty input gracefully', () => {
  const r = performanceReport([], []);
  assert.equal(r.trades, 0);
  assert.equal(r.netPnl, 0);
  assert.match(r.english, /No trades/);
});

test('save/load round-trips the ledger via a temp file', async () => {
  record({ account: 'bot', market: 'SWAP.DOGE', side: 'buy', qty: 100, price: 0.04, feeHive: 0.1, txId: 't1' });
  record({ account: 'bot', market: 'SWAP.DOGE', side: 'sell', qty: 100, price: 0.05, feeHive: 0.1, txId: 't2' });
  const before = summary();
  const path = join(tmpdir(), `profit-tracker-test-${process.pid}-${Date.now()}.json`);
  try {
    await save(path);
    reset();
    assert.equal(entries().length, 0);
    await load(path);
    assert.equal(entries().length, 2);
    const after = summary();
    assert.deepEqual(after, before);
    assert.equal(entries()[0].txId, 't1');
  } finally {
    await unlink(path).catch(() => {});
  }
});
