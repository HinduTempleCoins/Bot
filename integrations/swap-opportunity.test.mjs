// swap-opportunity.test.mjs — offline tests for the Swap.* pair opportunity scanner.
// Pure math, no network, no injection needed. node --test integrations/swap-opportunity.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { poolPrice, routeOut, findOpportunities, scoreRoute } from './swap-opportunity.mjs';

// ── poolPrice ────────────────────────────────────────────────────────────────
test('poolPrice: spot = quote/base', () => {
  assert.equal(poolPrice({ baseQty: 100_000, quoteQty: 250_000 }), 2.5);
  assert.equal(poolPrice({ baseQty: 1, quoteQty: 1 }), 1);
});

test('poolPrice: soft-fail on zero/missing/garbage base → 0 (no divide-by-zero)', () => {
  assert.equal(poolPrice({ baseQty: 0, quoteQty: 100 }), 0);
  assert.equal(poolPrice({ quoteQty: 100 }), 0);
  assert.equal(poolPrice({}), 0);
  assert.equal(poolPrice(), 0);
  assert.equal(poolPrice({ baseQty: -5, quoteQty: 100 }), 0);   // negative clamps to 0
  assert.equal(poolPrice({ baseQty: 'x', quoteQty: 'y' }), 0);
});

// ── routeOut ─────────────────────────────────────────────────────────────────
test('routeOut: single hop matches cp-amm getAmountOut shape', () => {
  const r = routeOut({ amountIn: 1_000, pools: [{ base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 500_000, feeBps: 30 }] });
  assert.equal(r.hops.length, 1);
  assert.ok(r.amountOut > 0);
  // 1000 in against 1M/500k pool at 0.30% is a touch under spot*amountIn (=500) due to fee+slippage
  assert.ok(r.amountOut < 500 && r.amountOut > 490);
  assert.equal(r.symbolsIn, 'A');
  assert.equal(r.symbolsOut, 'B');
});

test('routeOut: multi-hop chains output into next input', () => {
  const pools = [
    { base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 1_000_000, feeBps: 30 },
    { base: 'B', baseQty: 1_000_000, quote: 'C', quoteQty: 1_000_000, feeBps: 30 },
  ];
  const r = routeOut({ amountIn: 1_000, pools });
  assert.equal(r.hops.length, 2);
  // hop1 output feeds hop2 input
  assert.equal(r.hops[1].in, r.hops[0].out);
  assert.equal(r.symbolsIn, 'A');
  assert.equal(r.symbolsOut, 'C');
  // two 0.3% hops + slippage on equal pools → out clearly less than the 1000 nominal
  assert.ok(r.amountOut > 0 && r.amountOut < 1_000);
});

test('routeOut: empty/missing pools → amountOut 0, no hops (soft-fail)', () => {
  assert.deepEqual(routeOut({ amountIn: 1_000, pools: [] }), { amountOut: 0, hops: [], symbolsIn: '', symbolsOut: '' });
  assert.deepEqual(routeOut({ amountIn: 1_000 }), { amountOut: 0, hops: [], symbolsIn: '', symbolsOut: '' });
  assert.deepEqual(routeOut(), { amountOut: 0, hops: [], symbolsIn: '', symbolsOut: '' });
});

test('routeOut: dead reserve short-circuits the rest of the route to 0', () => {
  const pools = [
    { base: 'A', baseQty: 0, quote: 'B', quoteQty: 0, feeBps: 30 },   // dead pool → out 0
    { base: 'B', baseQty: 1_000_000, quote: 'C', quoteQty: 1_000_000, feeBps: 30 },
  ];
  const r = routeOut({ amountIn: 1_000, pools });
  assert.equal(r.amountOut, 0);
  assert.equal(r.hops.length, 1);   // stopped after the dead hop
});

test('routeOut: defaults feeBps when omitted (no throw)', () => {
  const r = routeOut({ amountIn: 1_000, pools: [{ base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 1_000_000 }] });
  assert.equal(r.hops[0].feeBps, 30);
  assert.ok(r.amountOut > 0);
});

// ── scoreRoute ───────────────────────────────────────────────────────────────
test('scoreRoute: positive edge above threshold is viable', () => {
  const s = scoreRoute({ amountIn: 1_000, expectedOut: 1_050, referenceOut: 1_000, minEdgeBps: 50 });
  assert.equal(s.edgeBps, 500);   // 5% = 500 bps
  assert.equal(s.viable, true);
});

test('scoreRoute: edge below threshold not viable', () => {
  const s = scoreRoute({ amountIn: 1_000, expectedOut: 1_003, referenceOut: 1_000, minEdgeBps: 50 });
  assert.equal(s.edgeBps, 30);    // 0.30% = 30 bps, under 50
  assert.equal(s.viable, false);
});

test('scoreRoute: negative edge (worse than reference) not viable', () => {
  const s = scoreRoute({ amountIn: 1_000, expectedOut: 990, referenceOut: 1_000 });
  assert.equal(s.edgeBps, -100);
  assert.equal(s.viable, false);
});

test('scoreRoute: zero/missing reference → edge 0, not viable (no divide-by-zero)', () => {
  assert.deepEqual(scoreRoute({ expectedOut: 1_000, referenceOut: 0 }), { edgeBps: 0, viable: false });
  assert.deepEqual(scoreRoute({ expectedOut: 1_000 }), { edgeBps: 0, viable: false });
  assert.deepEqual(scoreRoute({}), { edgeBps: 0, viable: false });
  assert.deepEqual(scoreRoute(), { edgeBps: 0, viable: false });
});

test('scoreRoute: zero expectedOut → not viable', () => {
  assert.deepEqual(scoreRoute({ expectedOut: 0, referenceOut: 1_000 }), { edgeBps: 0, viable: false });
});

// ── findOpportunities ──────────────────────────────────────────────────────────
test('findOpportunities: surfaces a pool richer than its reference', () => {
  const pools = [
    // spot 2.5 quote/base; reference 2.0 → realised out beats reference → opportunity
    { base: 'SWAP.HIVE', baseQty: 1_000_000, quote: 'X', quoteQty: 2_500_000, feeBps: 30 },
  ];
  const opps = findOpportunities({
    pools,
    referencePrices: { 'SWAP.HIVE:X': 2.0 },
    minEdgeBps: 50,
    amountIn: 1_000,
  });
  assert.equal(opps.length, 1);
  assert.ok(opps[0].edgeBps >= 50);
  assert.equal(opps[0].amountIn, 1_000);
  assert.ok(opps[0].expectedOut > 0);
  assert.equal(opps[0].path, 'SWAP.HIVE→X');
});

test('findOpportunities: pool at reference (own spot) yields no edge', () => {
  const pools = [{ base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 1_000_000, feeBps: 30 }];
  // no referencePrices → falls back to the pool's own spot; realised < spot (fee+slippage) → no opportunity
  const opps = findOpportunities({ pools, minEdgeBps: 50, amountIn: 1_000 });
  assert.equal(opps.length, 0);
});

test('findOpportunities: results sorted by edge descending', () => {
  const pools = [
    { base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 1_100_000, feeBps: 30 },   // small edge vs ref 1.0
    { base: 'C', baseQty: 1_000_000, quote: 'D', quoteQty: 2_000_000, feeBps: 30 },   // big edge vs ref 1.0
  ];
  const opps = findOpportunities({
    pools,
    referencePrices: { 'A:B': 1.0, 'C:D': 1.0 },
    minEdgeBps: 50,
    amountIn: 100,
  });
  assert.equal(opps.length, 2);
  assert.ok(opps[0].edgeBps >= opps[1].edgeBps);
  assert.equal(opps[0].path, 'C→D');   // bigger edge first
});

test('findOpportunities: explicit multi-hop routes are scored', () => {
  const pools = [
    { base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 2_000_000, feeBps: 30 },
    { base: 'B', baseQty: 1_000_000, quote: 'C', quoteQty: 2_000_000, feeBps: 30 },
  ];
  const opps = findOpportunities({
    pools,
    routes: [[pools[0], pools[1]]],
    referencePrices: { 'A:B': 1.0, 'B:C': 1.0 },   // realised ~4x vs reference 1x → strong edge
    minEdgeBps: 50,
    amountIn: 100,
  });
  assert.equal(opps.length, 1);
  assert.equal(opps[0].path, 'A→B→C');
  assert.ok(opps[0].edgeBps >= 50);
});

test('findOpportunities: empty/missing pools → [] (soft-fail)', () => {
  assert.deepEqual(findOpportunities({ pools: [] }), []);
  assert.deepEqual(findOpportunities({}), []);
  assert.deepEqual(findOpportunities(), []);
});

test('findOpportunities: garbage minEdgeBps falls back to default, no throw', () => {
  const pools = [{ base: 'A', baseQty: 1_000_000, quote: 'B', quoteQty: 2_000_000, feeBps: 30 }];
  const opps = findOpportunities({ pools, referencePrices: { 'A:B': 1.0 }, minEdgeBps: 'nope', amountIn: 100 });
  assert.ok(Array.isArray(opps));
  assert.ok(opps.length >= 0);
});
