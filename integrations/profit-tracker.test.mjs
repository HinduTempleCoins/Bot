// profit-tracker.test.mjs — OFFLINE. FIFO P&L math, summary aggregation, save/load round-trip.
//   node --test integrations/profit-tracker.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { record, pnl, summary, save, load, reset, entries } from './profit-tracker.mjs';

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
