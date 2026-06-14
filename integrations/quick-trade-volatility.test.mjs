// quick-trade-volatility.test.mjs — offline, no network, no fetch, no keys. Pure-function tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickVol } from './quick-trade-volatility.mjs';

// A real volatility burst with a clean two-sided book and adequate depth.
const burst = {
  symbol: 'SWAP.DOGE', mid: 0.011, bid: 0.0103, ask: 0.0117, baseSpread: 0.004,
  velocity: 0.07, bidDepthHive: 40, askDepthHive: 60, issuerConcentration: 0.1, ts: 1718000000000,
};

// poison check: assert the dry-run / no-signer invariant on every emitted order.
function assertDryRun(orders) {
  for (const o of orders) {
    assert.equal(o.dryRun, true, 'every order must be dryRun:true');
    assert.equal(o.signer, null, 'every order must be signer:null');
    assert.equal(o.strategy, 'quick-vol');
    assert.ok(Object.isFrozen(o), 'orders must be frozen');
  }
}

test('real burst with a clean two-leg path → entry + matching exit intention', () => {
  const { orders, reason } = quickVol(burst, {}, {});
  assert.equal(orders.length, 2, 'exactly an entry + a paired exit');
  assertDryRun(orders);
  // up-burst → SELL entry then BUY exit; legs are opposite sides
  const sides = orders.map((o) => o.side).sort();
  assert.deepEqual(sides, ['buy', 'sell'], 'two-sided round-trip, never one-way');
  // qty is matched across the two legs (we close the SAME size we opened)
  assert.equal(orders[0].qtyToken, orders[1].qtyToken, 'entry and exit qty must match');
  assert.match(reason, /round-trip/);
});

test('paired-exit qty matches and notional is small / under the per-order cap', () => {
  const { orders } = quickVol(burst, { tradeHive: 10, perOrderCapHive: 15 }, {});
  for (const o of orders) {
    assert.ok(o.qtyHive <= 15.01, `per-leg notional ${o.qtyHive} within tight cap`);
    assert.ok(o.qtyHive > 0);
  }
});

test('one-way / no clean exit leg (book has no bid) → blocked, zero orders', () => {
  const oneWay = { symbol: 'SWAP.X', mid: 0.011, ask: 0.0117, spread: 0.013, baseSpread: 0.004,
    velocity: 0.07, bidDepthHive: 40, askDepthHive: 60 };
  const { orders, reason } = quickVol(oneWay, {}, {});
  assert.equal(orders.length, 0, 'no exit leg ⇒ no orders (never one-way)');
  assert.match(reason, /one-way|exit leg|two-sided/i);
});

test('issuer-concentrated token → rejected', () => {
  const rug = { ...burst, symbol: 'SWAP.RUG', issuerConcentration: 0.8 };
  const { orders, reason } = quickVol(rug, {}, {});
  assert.equal(orders.length, 0);
  assert.match(reason, /issuer-concentrated|rug|illiquid/i);
});

test('illiquid book (thin depth) → rejected', () => {
  const thin = { ...burst, bidDepthHive: 2, askDepthHive: 2 };
  const { orders, reason } = quickVol(thin, { tradeHive: 10 }, {});
  assert.equal(orders.length, 0);
  assert.match(reason, /illiquid|depth/i);
});

test('phantom / implausible edge (>15%) → rejected, no chasing free money', () => {
  const phantom = { symbol: 'SWAP.X', mid: 0.011, bid: 0.008, ask: 0.018, baseSpread: 0.004,
    velocity: 0.40, bidDepthHive: 40, askDepthHive: 60 };
  const { orders, reason } = quickVol(phantom, {}, {});
  assert.equal(orders.length, 0);
  assert.match(reason, /phantom|implausible/i);
});

test('flat market (velocity below trigger) → no trade', () => {
  const flat = { symbol: 'SWAP.DOGE', mid: 0.011, bid: 0.01098, ask: 0.01102, baseSpread: 0.004,
    velocity: 0.005, bidDepthHive: 40, askDepthHive: 60 };
  const { orders, reason } = quickVol(flat, {}, {});
  assert.equal(orders.length, 0);
  assert.match(reason, /flat market|below|trigger/i);
});

test('spread not widened vs base → no burst, hold', () => {
  // velocity fires but the spread is normal (not a burst) → hold
  const noWiden = { symbol: 'SWAP.DOGE', mid: 0.011, bid: 0.01098, ask: 0.01102, baseSpread: 0.004,
    velocity: 0.07, bidDepthHive: 40, askDepthHive: 60 };
  const { orders, reason } = quickVol(noWiden, {}, {});
  assert.equal(orders.length, 0);
  assert.match(reason, /widen|burst/i);
});

test('inventory cap reached → hold (bleed guard)', () => {
  const { orders, reason } = quickVol(burst, { maxInventoryHive: 30 }, { inventoryHive: 30 });
  assert.equal(orders.length, 0);
  assert.match(reason, /inventory cap/i);
});

test('down-burst → BUY entry then SELL exit, still two-sided', () => {
  const down = { ...burst, velocity: -0.07 };
  const { orders } = quickVol(down, {}, {});
  assert.equal(orders.length, 2);
  assertDryRun(orders);
  assert.equal(orders[0].side, 'buy', 'down-burst enters with a buy');
  assert.equal(orders[1].side, 'sell', 'and exits with a sell');
});

test('velocity derived from a prices[] series works', () => {
  const series = { symbol: 'SWAP.DOGE', mid: 0.011, bid: 0.0103, ask: 0.0117, baseSpread: 0.004,
    prices: [0.0103, 0.0107, 0.011, 0.0117], bidDepthHive: 40, askDepthHive: 60 };
  const { orders } = quickVol(series, {}, {});
  assert.equal(orders.length, 2, 'a >3% series move triggers the burst');
  assertDryRun(orders);
});

test('garbage / empty input soft-fails to a hold, never throws', () => {
  for (const bad of [undefined, null, {}, { symbol: 'X' }, { foo: 'bar' }, 42, 'nope', []]) {
    const r = quickVol(bad);
    assert.ok(Array.isArray(r.orders), 'always returns an orders array');
    assert.equal(r.orders.length, 0, 'garbage → no orders');
    assert.equal(typeof r.reason, 'string');
  }
});

test('poison: NO param or state can ever flip dryRun/signer', () => {
  const evil = quickVol(burst,
    { dryRun: false, signer: 'WIF-LEAK', tradeHive: 10 },
    { dryRun: false, signer: 'WIF-LEAK' });
  assert.ok(evil.orders.length > 0, 'this burst should produce orders');
  assertDryRun(evil.orders);
  for (const o of evil.orders) {
    assert.notEqual(o.signer, 'WIF-LEAK');
    assert.equal(o.dryRun, true);
  }
});
