// trade-strategies-registry.test.mjs — OFFLINE tests for the NEW registry entries added in the trade
// consolidation: `nudge` (wraps price-nudge.nudgePlan) and `wall` (wraps wall-bot.wallStrategy).
// Both must be pure (no network/fs/key) and emit frozen dryRun:true/signer:null orders like the rest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, STRATEGIES, listStrategies } from './trade-strategies.mjs';

const NOW = 1_700_000_000_000;
const INC = 0.00000010;

test('registry now contains all seven strategies including nudge + wall', () => {
  const names = listStrategies().map((s) => s.name);
  for (const n of ['peg-arb', 'market-make', 'grid', 'dca', 'momentum', 'nudge', 'wall']) {
    assert.ok(names.includes(n), `registry must include ${n}`);
  }
  assert.ok(typeof STRATEGIES.nudge.decide === 'function');
  assert.ok(typeof STRATEGIES.wall.decide === 'function');
});

// ── NUDGE ──────────────────────────────────────────────────────────────────────────────────────
test('nudge: competitor above us → one frozen dryRun BUY one increment above, with a ceiling set', () => {
  const snap = {
    symbol: 'VKBT',
    buyBook: [{ price: 0.00000200, quantity: 1000, account: 'trollbot', _id: 1 }],
    sellBook: [{ price: 0.00000500, quantity: 1000, account: 'seller' }],
    ourAccounts: ['angelicalist'],
  };
  const { orders, reason } = decide('nudge', snap, { ceiling: 0.001 }, { lastNudge: 0, dailyCount: 0, now: NOW });
  assert.equal(orders.length, 1);
  const o = orders[0];
  assert.equal(o.side, 'buy');
  assert.equal(o.symbol, 'VKBT');
  assert.equal(o.price, +(0.00000200 + INC).toFixed(8), 'one increment above the troll');
  assert.equal(o.dryRun, true);
  assert.equal(o.signer, null);
  assert.ok(Object.isFrozen(o));
  assert.equal(o.strategy, 'nudge');
  assert.match(reason, /ratchet/);
});

test('nudge: NO ceiling configured → HOLD (refuses to ratchet unbounded), no orders', () => {
  const snap = {
    symbol: 'VKBT',
    buyBook: [{ price: 0.00000200, quantity: 1000, account: 'trollbot', _id: 1 }],
    sellBook: [{ price: 0.00000500, quantity: 1000, account: 'seller' }],
    ourAccounts: ['angelicalist'],
  };
  const { orders, reason } = decide('nudge', snap, {}, { lastNudge: 0, dailyCount: 0, now: NOW });
  assert.deepEqual(orders, []);
  assert.match(reason, /ceiling/i);
});

test('nudge: empty books → HOLD, no throw', () => {
  const { orders } = decide('nudge', { symbol: 'VKBT', buyBook: [], sellBook: [] }, { ceiling: 0.001 });
  assert.deepEqual(orders, []);
});

test('nudge: reports the cancel of a stale bid in its reason', () => {
  const snap = {
    symbol: 'VKBT',
    buyBook: [
      { price: 0.00000200, quantity: 1000, account: 'trollbot', _id: 1 },
      { price: 0.00000150, quantity: 25, account: 'angelicalist', _id: 2 }, // our stale lower bid
    ],
    sellBook: [{ price: 0.00000500, quantity: 1000, account: 'seller' }],
    ourAccounts: ['angelicalist'],
  };
  const { orders, reason } = decide('nudge', snap, { ceiling: 0.001 }, { lastNudge: 0, dailyCount: 0, now: NOW });
  assert.equal(orders.length, 1);
  assert.match(reason, /cancel 1 stale bid/);
});

// ── WALL ─────────────────────────────────────────────────────────────────────────────────────
test('wall: no buy wall defending the floor → frozen dryRun BUY wall at the floor', () => {
  const snap = {
    symbol: 'VKBT',
    buyBook: [{ price: 0.005, quantity: 10, account: 'a' }, { price: 0.004, quantity: 12, account: 'b' }],
    sellBook: [],
  };
  const { orders } = decide('wall', snap, { floor: 0.01, wallSize: 1000 });
  assert.equal(orders.length, 1);
  const o = orders[0];
  assert.equal(o.side, 'buy');
  assert.equal(o.price, 0.01);
  assert.equal(o.qtyToken, 1000);
  assert.equal(o.dryRun, true);
  assert.equal(o.signer, null);
  assert.ok(Object.isFrozen(o));
  assert.equal(o.strategy, 'wall');
});

test('wall: no ceiling → frozen dryRun SELL wall at the ceiling when none caps it', () => {
  const snap = {
    symbol: 'VKBT',
    buyBook: [],
    sellBook: [{ price: 0.02, quantity: 10, account: 'a' }, { price: 0.03, quantity: 12, account: 'b' }],
  };
  const { orders } = decide('wall', snap, { ceiling: 0.05, wallSize: 500 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'sell');
  assert.equal(orders[0].price, 0.05);
});

test('wall: an existing big buy wall defends the floor → HOLD (no order)', () => {
  const snap = {
    symbol: 'VKBT',
    // one conspicuously large bid (>=3x median) sitting at/above the floor → already defending
    buyBook: [
      { price: 0.011, quantity: 5000, account: 'whale' },
      { price: 0.010, quantity: 10, account: 'a' },
      { price: 0.009, quantity: 12, account: 'b' },
    ],
    sellBook: [],
  };
  const { orders, reason } = decide('wall', snap, { floor: 0.01, wallSize: 1000 });
  assert.deepEqual(orders, []);
  assert.match(reason, /hold/);
});

test('wall: no floor/ceiling params → HOLD, no throw', () => {
  const { orders } = decide('wall', { symbol: 'VKBT', buyBook: [], sellBook: [] }, {});
  assert.deepEqual(orders, []);
});
