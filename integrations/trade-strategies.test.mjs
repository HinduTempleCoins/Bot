// trade-strategies.test.mjs — OFFLINE tests for the strategy layer (queue #189).
// Pure decision functions: no network, no keys, no fs. Every order must be dryRun:true/signer:null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, STRATEGIES, listStrategies } from './trade-strategies.mjs';

// ── universal safety invariant: NO order can ever be live or signer-attached ──────────────────
test('every order from every strategy is dryRun:true / signer:null (frozen)', () => {
  const snaps = {
    'peg-arb': { symbol: 'X', hePrice: 0.10, realUsd: 0.085, hiveUsd: 0.30 }, // any decision
    'grid': { symbol: 'X', hePrice: 0.09, mid: 0.09 },
    'market-make': { symbol: 'X', hePrice: 0.10, bid: 0.099, ask: 0.101 },
    'dca': { symbol: 'X', hePrice: 0.10 },
    'momentum': { symbol: 'X', hePrice: 0.10, fast: 0.11, slow: 0.10 },
  };
  const state = { inventoryToken: 100, inventoryHive: 10, spentHive: 0 };
  for (const name of Object.keys(STRATEGIES)) {
    const { orders } = decide(name, snaps[name], { center: 0.10 }, state);
    for (const o of orders) {
      assert.equal(o.dryRun, true, `${name} order must be dryRun`);
      assert.equal(o.signer, null, `${name} order must have no signer`);
      assert.ok(Object.isFrozen(o), `${name} order must be frozen`);
      assert.equal(o.strategy, name);
    }
  }
});

test('attempts to set dryRun:false or attach a signer via params are overridden', () => {
  // even if a snapshot/params field tried to smuggle dryRun/signer, freezeOrder wins.
  const snap = { symbol: 'X', hePrice: 0.05, realUsd: 0.085, hiveUsd: 0.30, dryRun: false, signer: 'WIF' };
  const { orders } = decide('peg-arb', snap, { dryRun: false, signer: 'WIF' });
  assert.ok(orders.length > 0);
  for (const o of orders) { assert.equal(o.dryRun, true); assert.equal(o.signer, null); }
});

test('unknown strategy soft-fails to a hold, no throw', () => {
  const r = decide('nope', { symbol: 'X' });
  assert.deepEqual(r.orders, []);
  assert.match(r.reason, /unknown strategy/);
});

test('listStrategies marks peg-arb as the proven family', () => {
  const all = listStrategies();
  const peg = all.find((s) => s.name === 'peg-arb');
  assert.ok(peg && peg.proven === true, 'peg-arb must be flagged proven');
  assert.ok(all.every((s) => typeof s.label === 'string'));
});

// ── 1. peg-arb (the proven one) ───────────────────────────────────────────────────────────────
// fair HE price = realUsd / hiveUsd. 0.085/0.30 = 0.2833.
test('peg-arb BUYS when HE is cheap vs the real peg (winning case)', () => {
  const { orders, reason } = decide('peg-arb', { symbol: 'SWAP.DOGE', hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'buy');
  assert.ok(orders[0].qtyHive > 0);
  assert.match(reason, /BUY/);
});

test('peg-arb SELLS when HE is rich vs the real peg AND we hold inventory', () => {
  const { orders } = decide('peg-arb', { symbol: 'SWAP.DOGE', hePrice: 0.33, realUsd: 0.085, hiveUsd: 0.30 },
    {}, { inventoryToken: 500 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'sell');
});

test('peg-arb will NOT sell what it does not hold (no shorting)', () => {
  const { orders, reason } = decide('peg-arb', { symbol: 'SWAP.DOGE', hePrice: 0.33, realUsd: 0.085, hiveUsd: 0.30 },
    {}, { inventoryToken: 0 });
  assert.deepEqual(orders, []);
  assert.match(reason, /no inventory|no shorting/);
});

test('peg-arb HOLDS inside the threshold band', () => {
  const { orders, reason } = decide('peg-arb', { symbol: 'SWAP.DOGE', hePrice: 0.285, realUsd: 0.085, hiveUsd: 0.30 });
  assert.deepEqual(orders, []);
  assert.match(reason, /threshold|hold/);
});

test('peg-arb stops buying at the inventory cap — the bleed guard (losing case bounded)', () => {
  // already at the cap → no buy even with a big edge
  const { orders, reason } = decide('peg-arb', { symbol: 'SWAP.LTC', hePrice: 0.15, realUsd: 0.085, hiveUsd: 0.30 },
    { maxInventoryHive: 150 }, { inventoryHive: 150 });
  assert.deepEqual(orders, []);
  assert.match(reason, /cap/);
});

test('peg-arb soft-fails with missing price data', () => {
  const { orders, reason } = decide('peg-arb', { symbol: 'X', hePrice: 0.1 }); // no realUsd/hiveUsd
  assert.deepEqual(orders, []);
  assert.match(reason, /insufficient/);
});

// ── 2. grid ───────────────────────────────────────────────────────────────────────────────────
test('grid BUYS on a rung below center', () => {
  const { orders } = decide('grid', { symbol: 'V', hePrice: 0.096, mid: 0.096 },
    { center: 0.10, step: 0.02, rungs: 5, tradeHivePerRung: 20 }, {});
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'buy');
});

test('grid SELLS on a rung above center when holding', () => {
  const { orders } = decide('grid', { symbol: 'V', hePrice: 0.108, mid: 0.108 },
    { center: 0.10, step: 0.02 }, { inventoryToken: 1000 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'sell');
});

test('grid does not re-fill an already-filled rung', () => {
  const { orders, reason } = decide('grid', { symbol: 'V', hePrice: 0.096, mid: 0.096 },
    { center: 0.10, step: 0.02 }, { filledRungs: ['b-2'] });
  assert.deepEqual(orders, []);
  assert.match(reason, /no unfilled rung/);
});

test('grid will not sell with empty inventory', () => {
  const { orders } = decide('grid', { symbol: 'V', hePrice: 0.108, mid: 0.108 },
    { center: 0.10, step: 0.02 }, { inventoryToken: 0 });
  assert.deepEqual(orders, []);
});

// ── 3. market-make (sell-biased) ───────────────────────────────────────────────────────────────
test('market-make quotes both sides when holding inventory and under cap', () => {
  const { orders } = decide('market-make', { symbol: 'C', hePrice: 0.05, bid: 0.0495, ask: 0.0505 },
    { spread: 0.02, sellBias: 0.6 }, { inventoryToken: 500, inventoryHive: 25 });
  const sides = orders.map((o) => o.side).sort();
  assert.deepEqual(sides, ['buy', 'sell']);
});

test('market-make is sell-biased: ask sits closer to mid than bid', () => {
  const mid = 0.05;
  const { orders } = decide('market-make', { symbol: 'C', hePrice: mid },
    { spread: 0.02, sellBias: 0.6 }, { inventoryToken: 500, inventoryHive: 25 });
  const ask = orders.find((o) => o.side === 'sell').price;
  const bid = orders.find((o) => o.side === 'buy').price;
  assert.ok(ask - mid < mid - bid, 'ask should be tighter to mid than bid (sell lean)');
});

test('market-make suppresses the bid at the inventory cap (anti-bleed)', () => {
  const { orders } = decide('market-make', { symbol: 'C', hePrice: 0.05 },
    { spread: 0.02, maxInventoryHive: 100 }, { inventoryToken: 500, inventoryHive: 100 });
  assert.ok(orders.every((o) => o.side === 'sell'), 'no bid once at/over the cap');
});

test('market-make with no inventory and at cap → no quotes', () => {
  const { orders } = decide('market-make', { symbol: 'C', hePrice: 0.05 },
    { maxInventoryHive: 50 }, { inventoryToken: 0, inventoryHive: 50 });
  assert.deepEqual(orders, []);
});

// ── 4. dca ──────────────────────────────────────────────────────────────────────────────────
test('dca buys a fixed amount when budget remains', () => {
  const { orders } = decide('dca', { symbol: 'L', hePrice: 0.2 }, { buyHive: 20, totalBudgetHive: 100 }, { spentHive: 40 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].qtyHive, 20);
});

test('dca stops dead when budget exhausted (hard anti-bleed cap)', () => {
  const { orders, reason } = decide('dca', { symbol: 'L', hePrice: 0.2 }, { totalBudgetHive: 100 }, { spentHive: 100 });
  assert.deepEqual(orders, []);
  assert.match(reason, /exhausted|done/);
});

test('dca respects the interval guard when timestamps are supplied', () => {
  const { orders, reason } = decide('dca', { symbol: 'L', hePrice: 0.2, ts: 1000 },
    { intervalMs: 5000 }, { lastBuyTs: 500, spentHive: 0 });
  assert.deepEqual(orders, []);
  assert.match(reason, /interval/);
});

test('dca clamps the last buy to the remaining budget', () => {
  const { orders } = decide('dca', { symbol: 'L', hePrice: 0.2 }, { buyHive: 50, totalBudgetHive: 100 }, { spentHive: 80 });
  assert.equal(orders[0].qtyHive, 20); // only 20 left
});

// ── 5. momentum ───────────────────────────────────────────────────────────────────────────────
test('momentum ENTERS long when fast leads slow past the enter threshold', () => {
  const { orders } = decide('momentum', { symbol: 'B', hePrice: 0.04, fast: 0.0385, slow: 0.033 },
    { enter: 0.02 }, { inventoryToken: 0 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'buy');
});

test('momentum EXITS when the signal crosses back down', () => {
  const { orders } = decide('momentum', { symbol: 'B', hePrice: 0.031, fast: 0.032, slow: 0.0345 },
    { exit: 0.0 }, { inventoryToken: 500 });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].side, 'sell');
});

test('momentum does NOT pyramid: no second buy while already long', () => {
  const { orders, reason } = decide('momentum', { symbol: 'B', hePrice: 0.04, fast: 0.0385, slow: 0.033 },
    { enter: 0.02 }, { inventoryToken: 500 });
  assert.deepEqual(orders, []);
  assert.match(reason, /hold long/);
});

test('momentum stays flat without a signal', () => {
  const { orders } = decide('momentum', { symbol: 'B', hePrice: 0.03, fast: 0.0301, slow: 0.030 },
    { enter: 0.02 }, { inventoryToken: 0 });
  assert.deepEqual(orders, []);
});

test('momentum soft-fails without fast/slow', () => {
  const { orders, reason } = decide('momentum', { symbol: 'B', hePrice: 0.03 }, {}, {});
  assert.deepEqual(orders, []);
  assert.match(reason, /need fast/);
});

// ── edge cases ────────────────────────────────────────────────────────────────────────────────
test('all strategies tolerate an empty snapshot without throwing', () => {
  for (const name of Object.keys(STRATEGIES)) {
    const r = decide(name, {}, {}, {});
    assert.ok(Array.isArray(r.orders));
    assert.equal(typeof r.reason, 'string');
  }
});

test('all strategies tolerate undefined params/state', () => {
  for (const name of Object.keys(STRATEGIES)) {
    const r = decide(name, { symbol: 'X', hePrice: 0.1, realUsd: 0.085, hiveUsd: 0.30, fast: 0.11, slow: 0.10, mid: 0.1 });
    assert.ok(Array.isArray(r.orders));
  }
});
