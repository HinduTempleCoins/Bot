// trade-backtest.test.mjs — OFFLINE tests for the replay harness (queue #189).
// Pure simulation: snapshots are inline arrays (no fs needed for the core cases); the bundled
// fixtures are loaded once to confirm the on-disk shape parses and replays.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { backtest, loadFixture, verdictLine } from './trade-backtest.mjs';

const FX = (name) => fileURLToPath(new URL(`./fixtures/trade-snapshots.${name}.json`, import.meta.url));

// ── core accounting ───────────────────────────────────────────────────────────────────────────
test('backtest is pure: same inputs → same verdict', () => {
  const snaps = [
    { symbol: 'X', hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 },
    { symbol: 'X', hePrice: 0.33, realUsd: 0.085, hiveUsd: 0.30 },
  ];
  const a = backtest('peg-arb', snaps, { startHive: 1000 });
  const b = backtest('peg-arb', snaps, { startHive: 1000 });
  assert.deepEqual(a, b);
});

test('a buy then a sell at a higher fair price yields positive realized PnL', () => {
  // cheap then rich → peg-arb buys then sells; net should be positive after fees
  const snaps = [
    { symbol: 'X', hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 }, // buy (HE cheap)
    { symbol: 'X', hePrice: 0.34, realUsd: 0.085, hiveUsd: 0.30 }, // sell (HE rich)
  ];
  const v = backtest('peg-arb', snaps, { startHive: 1000, fees: 0.0025, slippage: 0.001 });
  assert.equal(v.buys, 1);
  assert.equal(v.sells, 1);
  assert.ok(v.realizedPnl > 0, `expected positive realized PnL, got ${v.realizedPnl}`);
  assert.ok(v.feesPaid > 0, 'fees must be charged');
});

test('backtest never spends HIVE it does not have', () => {
  const snaps = [
    { symbol: 'X', hePrice: 0.10, realUsd: 0.085, hiveUsd: 0.30 },
    { symbol: 'X', hePrice: 0.09, realUsd: 0.085, hiveUsd: 0.30 },
    { symbol: 'X', hePrice: 0.08, realUsd: 0.085, hiveUsd: 0.30 },
  ];
  const v = backtest('peg-arb', snaps, { startHive: 30, params: { tradeHive: 50, maxInventoryHive: 10000 } });
  assert.ok(v.hive >= 0, `HIVE balance went negative: ${v.hive}`);
});

test('backtest never sells tokens it does not hold', () => {
  // start flat; rich market → peg-arb tries to sell but has nothing
  const snaps = [{ symbol: 'X', hePrice: 0.40, realUsd: 0.085, hiveUsd: 0.30 }];
  const v = backtest('peg-arb', snaps, { startHive: 1000, startToken: 0 });
  assert.equal(v.sells, 0);
  assert.equal(v.token, 0);
});

test('fees + slippage reduce PnL vs a frictionless run', () => {
  const snaps = [
    { symbol: 'X', hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 },
    { symbol: 'X', hePrice: 0.34, realUsd: 0.085, hiveUsd: 0.30 },
  ];
  const frictionless = backtest('peg-arb', snaps, { startHive: 1000, fees: 0, slippage: 0 });
  const withCosts = backtest('peg-arb', snaps, { startHive: 1000, fees: 0.01, slippage: 0.01 });
  assert.ok(withCosts.totalPnl < frictionless.totalPnl, 'costs must lower PnL');
});

test('unknown strategy returns an error verdict, no throw', () => {
  const v = backtest('nope', [{ symbol: 'X', hePrice: 0.1 }]);
  assert.match(v.error, /unknown strategy/);
  assert.equal(v.fills, 0);
});

test('empty snapshots → flat verdict (no fills, equity = start)', () => {
  const v = backtest('peg-arb', [], { startHive: 500 });
  assert.equal(v.fills, 0);
  assert.equal(v.totalEquity, 500);
  assert.equal(v.totalPnl, 0);
});

// ── the bleed scenario: the inventory cap bounds the loss ──────────────────────────────────────
test('peg-arb bleed fixture: a one-way fall is bounded by the inventory cap', () => {
  const fx = loadFixture(FX('peg-arb-bleed'));
  const v = backtest('peg-arb', fx.snapshots, { params: fx.params, ...fx.start });
  // it does lose (the token kept falling) but the cap bounds the damage to a small fraction.
  assert.ok(v.totalPnl < 0, 'a one-way drop should lose money');
  // the loss is BOUNDED and small — single-digit %, not the -6,424 HIVE (-640%) historical drain.
  // (the cap throttles new buys whenever marked inventory value is at/over maxInventoryHive HIVE.)
  assert.ok(v.returnPct > -15, `loss must stay bounded, got ${v.returnPct}%`);
  // marked inventory at the end never blew past the cap by much — the throttle held.
  assert.ok(v.tokenValueHive <= fx.params.maxInventoryHive + 1,
    `marked inventory ${v.tokenValueHive} must be bounded by the cap ${fx.params.maxInventoryHive}`);
});

// ── every bundled fixture parses and replays cleanly ──────────────────────────────────────────
for (const name of ['peg-arb', 'grid', 'market-make', 'dca', 'momentum']) {
  test(`fixture '${name}' loads and produces a profitable-or-flat verdict on its favorable case`, () => {
    const fx = loadFixture(FX(name));
    assert.ok(Array.isArray(fx.snapshots) && fx.snapshots.length > 0);
    const v = backtest(name, fx.snapshots, { params: fx.params, ...fx.start });
    assert.ok(!v.error, v.error);
    assert.ok(v.fills > 0, `${name} should produce fills on its fixture`);
    // these fixtures are the FAVORABLE case for each family → non-negative PnL expected
    assert.ok(v.totalPnl >= 0, `${name} favorable fixture should not lose: ${v.totalPnl}`);
  });
}

test('verdictLine renders a string for a normal and an error verdict', () => {
  const v = backtest('peg-arb', [{ symbol: 'X', hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 }], { startHive: 1000 });
  assert.equal(typeof verdictLine(v), 'string');
  assert.match(verdictLine({ strategy: 'z', error: 'boom' }), /ERROR/);
});

test('grid replay advances filledRungs so it does not re-fill the same rung', () => {
  // the same below-center price repeated should only buy once
  const snaps = [
    { symbol: 'V', hePrice: 0.096, mid: 0.096 },
    { symbol: 'V', hePrice: 0.096, mid: 0.096 },
    { symbol: 'V', hePrice: 0.096, mid: 0.096 },
  ];
  const v = backtest('grid', snaps, { params: { center: 0.10, step: 0.02, tradeHivePerRung: 20 }, startHive: 1000 });
  assert.equal(v.buys, 1, 'same rung should fill only once across the replay');
});
