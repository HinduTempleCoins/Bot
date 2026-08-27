// strategy-router.test.mjs — OFFLINE tests for the PURE regime→strategy router.
// No network, no keys, no fs. Each regime routes to the documented trade-strategies family; unknown
// regimes route to the safe do-nothing HOLD; planWithRouter composes detect→route→decide (shadow only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeStrategy, planWithRouter, ROUTES, DO_NOTHING } from './strategy-router.mjs';
import { STRATEGIES } from './trade-strategies.mjs';

const DAY = 86_400_000, t0 = Date.UTC(2026, 0, 1);
const bars = (fn, n = 30) => Array.from({ length: n }, (_, i) => fn(i));
const deepBook = { buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [{ price: 1.01, quantity: 500 }] };
const FLAT = bars((i) => ({ t: t0 + i * DAY, open: 1, high: 1.004, low: 0.996, close: 1, volume: 100 }));

// ── the documented mapping ──────────────────────────────────────────────────────────────────────
test('PEG_DISLOCATED → peg-arb', () => {
  assert.equal(routeStrategy('PEG_DISLOCATED').strategy, 'peg-arb');
  assert.equal(routeStrategy('PEG_DISLOCATED').hold, false);
});

test('RANGE splits by token tier: issued → nudge (troll-down), liquid → grid', () => {
  assert.equal(routeStrategy('RANGE', { isIssuedToken: true }).strategy, 'nudge');
  assert.equal(routeStrategy('RANGE', { isIssuedToken: false }).strategy, 'grid');
});

test('TREND_UP → momentum, but HOLD when already long (no pyramiding)', () => {
  assert.equal(routeStrategy('TREND_UP').strategy, 'momentum');
  const long = routeStrategy('TREND_UP', { alreadyLong: true });
  assert.equal(long.strategy, DO_NOTHING);
  assert.equal(long.hold, true);
});

test('TREND_DOWN → HOLD (falling-knife guard); issued token keeps support-only nudge', () => {
  assert.equal(routeStrategy('TREND_DOWN', { isIssuedToken: false }).strategy, DO_NOTHING);
  const issued = routeStrategy('TREND_DOWN', { isIssuedToken: true });
  assert.equal(issued.strategy, 'nudge');
  assert.equal(issued.params.supportOnly, true);
});

test('HIGH_VOL → market-make with a WIDER spread for our token, HOLD otherwise', () => {
  const issued = routeStrategy('HIGH_VOL', { isIssuedToken: true });
  assert.equal(issued.strategy, 'market-make');
  assert.ok(issued.params.spread > 0.02, 'spread should be widened beyond the 2% base');
  assert.equal(routeStrategy('HIGH_VOL', { isIssuedToken: false }).strategy, DO_NOTHING);
});

test('THIN_BOOK → wall (issued) / HOLD (liquid)', () => {
  assert.equal(routeStrategy('THIN_BOOK', { isIssuedToken: true }).strategy, 'wall');
  assert.equal(routeStrategy('THIN_BOOK', { isIssuedToken: false }).strategy, DO_NOTHING);
});

test('DEAD → do-nothing (the anti-rug hard stop)', () => {
  const r = routeStrategy('DEAD', { isIssuedToken: true });
  assert.equal(r.strategy, DO_NOTHING);
  assert.equal(r.hold, true);
});

test('UNCERTAIN and any unknown regime → safe HOLD', () => {
  assert.equal(routeStrategy('UNCERTAIN').strategy, DO_NOTHING);
  assert.equal(routeStrategy('NONSENSE_REGIME').strategy, DO_NOTHING);
  assert.equal(routeStrategy(undefined).strategy, DO_NOTHING);
});

test('every non-hold route names a strategy that actually exists in the registry', () => {
  for (const regime of Object.keys(ROUTES).concat(['TREND_UP', 'HIGH_VOL', 'THIN_BOOK'])) {
    for (const issued of [true, false]) {
      const r = routeStrategy(regime, { isIssuedToken: issued });
      if (!r.hold) assert.ok(STRATEGIES[r.strategy], `${regime}/${issued} → ${r.strategy} must be a real strategy`);
    }
  }
});

test('explicit per-token params override the tuned params', () => {
  const r = routeStrategy('RANGE', { isIssuedToken: false, params: { center: 0.5, step: 0.03 } });
  assert.equal(r.params.center, 0.5);
  assert.equal(r.params.step, 0.03);
});

test('router never throws', () => {
  for (const junk of [null, undefined, 42, {}, 'x']) {
    assert.doesNotThrow(() => routeStrategy(junk));
  }
});

// ── planWithRouter — SHADOW composition detect → route → decide ──────────────────────────────────
test('planWithRouter: PEG_DISLOCATED composes into a peg-arb BUY decision (dryRun orders)', () => {
  const plan = planWithRouter(
    { symbol: 'SWAP.DOGE', candles: FLAT, ...deepBook, arb: { edge: 0.06, execHive: 120, suspect: false } },
    { snapshot: { hePrice: 0.24, realUsd: 0.085, hiveUsd: 0.30 } }, // real peg data for decide()
  );
  assert.equal(plan.regime, 'PEG_DISLOCATED');
  assert.equal(plan.route.strategy, 'peg-arb');
  assert.ok(plan.decision.orders.length >= 1);
  for (const o of plan.decision.orders) {
    assert.equal(o.dryRun, true, 'every order stays dryRun');
    assert.equal(o.signer, null, 'every order stays keyless');
  }
});

test('planWithRouter: a HOLD regime yields an empty decision, no orders', () => {
  const plan = planWithRouter({ symbol: 'X', candles: FLAT, buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [] });
  assert.equal(plan.regime, 'DEAD');
  assert.equal(plan.route.hold, true);
  assert.deepEqual(plan.decision.orders, []);
  assert.match(plan.decision.reason, /HOLD/);
});

test('planWithRouter never throws on junk', () => {
  for (const junk of [null, undefined, 42, {}, { candles: 'x' }]) {
    assert.doesNotThrow(() => planWithRouter(junk));
  }
});
