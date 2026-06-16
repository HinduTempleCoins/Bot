// cdp-loop-safety.test.mjs — OFFLINE. ADVERSARIAL loop-safety proof. Proves the recursive CDP loop
// (a) terminates with bounded leverage and (b) stays overcollateralized at every hop, and that the
// market graph is a DAG with no cycle. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxLeverage, hopsToConverge, simulateLoop, analyzeGraph, DEFAULT_MARKETS,
} from './cdp-loop-safety.mjs';

test('maxLeverage = 1/(1-LTV): the geometric leverage ceiling', () => {
  assert.equal(maxLeverage(0.5), 2);
  assert.equal(maxLeverage(0.4), 1.6666666667);
  assert.equal(maxLeverage(0), 1, 'no LTV → no leverage');
  assert.equal(maxLeverage(1), Infinity, 'LTV=1 → unbounded (the forbidden degenerate case)');
  assert.equal(maxLeverage(-3), 1, 'clamps');
});

test('hopsToConverge is finite for LTV<1 and capped for LTV>=1', () => {
  assert.ok(hopsToConverge(0.5) > 0 && hopsToConverge(0.5) < 100);
  assert.ok(hopsToConverge(0.66) > hopsToConverge(0.5), 'higher LTV → more hops to dust');
  assert.equal(hopsToConverge(0), 0);
  assert.equal(hopsToConverge(1), 10000, 'LTV=1 never converges → hard cap');
});

test('PROOF (a) termination: the loop converges in bounded hops for every valid LTV', () => {
  for (const ltv of [0.1, 0.4, 0.5, 0.66, 0.9]) {
    const r = simulateLoop({ startCapital: 1000, ltvs: ltv });
    assert.equal(r.terminates, true, `LTV ${ltv} terminates`);
    assert.ok(r.maxHops > 0 && r.maxHops < 10000, `LTV ${ltv} bounded hop count (${r.maxHops})`);
  }
});

test('PROOF (a) bounded leverage: total leverage never exceeds 1/(1-LTV)', () => {
  for (const ltv of [0.1, 0.4, 0.5, 0.66, 0.9]) {
    const r = simulateLoop({ startCapital: 1000, ltvs: ltv });
    assert.equal(r.boundedLeverage, true, `LTV ${ltv} bounded`);
    assert.ok(r.leverage <= r.theoreticalMaxLeverage + 1e-6,
      `actual ${r.leverage} ≤ theoretical ${r.theoreticalMaxLeverage}`);
    // and it actually approaches the ceiling (within 0.1%) — the loop is maximally aggressive
    assert.ok(r.leverage >= r.theoreticalMaxLeverage * 0.999, 'converges to the ceiling');
  }
});

test('PROOF (b) overcollateralization: total collateral ≥ total debt at EVERY hop', () => {
  for (const ltv of [0.1, 0.4, 0.5, 0.66, 0.9]) {
    const r = simulateLoop({ startCapital: 1000, ltvs: ltv });
    assert.equal(r.alwaysOvercollateralized, true, `LTV ${ltv} stays overcollateralized`);
    for (const s of r.steps) {
      assert.ok(s.collateral >= s.debt, `hop ${s.hop} @ LTV ${ltv}: collateral ${s.collateral} ≥ debt ${s.debt}`);
      assert.ok(s.ratio >= 1, 'collateral/debt ratio ≥ 1');
    }
    // aggregate ratio = 1/LTV (each hop borrows LTV of what it locks) — strictly > 1 for LTV < 1
    assert.ok(r.totalCollateral / r.totalDebt >= 1 / ltv - 1e-6, 'aggregate ratio ≈ 1/LTV');
  }
});

test('headline: safe=true for all valid LTVs (both invariants hold)', () => {
  for (const ltv of [0.1, 0.4, 0.5, 0.66, 0.9]) {
    assert.equal(simulateLoop({ startCapital: 1000, ltvs: ltv }).safe, true);
  }
});

test('worked example LTV=0.5: 2x leverage, ratio exactly 2, never drained', () => {
  const r = simulateLoop({ startCapital: 1000, ltvs: 0.5 });
  assert.equal(r.theoreticalMaxLeverage, 2);
  assert.ok(Math.abs(r.leverage - 2) < 1e-3);
  assert.ok(Math.abs(r.totalCollateral / r.totalDebt - 2) < 1e-3, 'collateral is 2x the debt — half is cushion');
  // the system is NEVER "all locked, nothing left": debt is always strictly less than collateral
  assert.ok(r.totalDebt < r.totalCollateral);
});

test('cross-market loop (Market 1 LTV then Market 2 LTV) is safe and bounded', () => {
  // walk KULA→wMELEK at 0.5, then wMELEK→ALTI at 0.4, then clamp to last
  const r = simulateLoop({ startCapital: 1000, ltvs: [0.5, 0.4] });
  assert.equal(r.safe, true);
  assert.equal(r.terminates, true);
  assert.equal(r.alwaysOvercollateralized, true);
  // mixed-LTV leverage bounded by the worst (highest) LTV's ceiling
  assert.ok(r.leverage <= maxLeverage(0.5) + 1e-6);
});

test('ATTACK: LTV=1 cannot spin an infinite cycle — bounded by the hard cap, reported unsafe', () => {
  const r = simulateLoop({ startCapital: 1000, ltvs: 1 });
  assert.equal(r.terminates, false, 'LTV=1 does not converge');
  assert.equal(r.safe, false, 'reported unsafe — the degenerate case is forbidden, not silently allowed');
  assert.ok(r.maxHops <= 10000, 'still BOUNDED by HARD_HOP_CAP — never an actual infinite loop');
  assert.equal(r.theoreticalMaxLeverage, Infinity);
});

test('ATTACK: huge explicit hop count is still capped and stays overcollateralized', () => {
  const r = simulateLoop({ startCapital: 1000, ltvs: 0.5, hops: 1e9 });
  assert.ok(r.maxHops <= 10000, 'hop budget hard-capped');
  assert.equal(r.alwaysOvercollateralized, true, 'still never drained');
  assert.equal(r.safe, true);
});

test('zero / bad capital → vacuously safe, terminated, never throws', () => {
  const r = simulateLoop({ startCapital: 0, ltvs: 0.5 });
  assert.equal(r.safe, true);
  assert.equal(r.terminates, true);
  assert.equal(r.maxHops, 0);
  assert.doesNotThrow(() => simulateLoop());
  assert.doesNotThrow(() => simulateLoop({ startCapital: 'x', ltvs: 'y' }));
});

test('GRAPH PROOF: the market graph is a DAG with no cycle, terminating at ALTI', () => {
  const g = analyzeGraph();
  assert.equal(g.isDag, true, 'KULA→wMELEK→ALTI is acyclic');
  assert.equal(g.hasCycle, false, 'no cycle exists to spin');
  assert.deepEqual(g.terminal, ['ALTI'], 'ALTI is the terminal node — collateral for nothing');
  assert.deepEqual(g.order, ['KULA', 'wMELEK', 'ALTI'], 'topological order of the DAG');
});

test('GRAPH PROOF: an injected back-edge (ALTI→KULA) IS detected as a cycle', () => {
  const looped = [...DEFAULT_MARKETS, { market: 99, collateral: 'ALTI', debt: 'KULA' }];
  const g = analyzeGraph(looped);
  assert.equal(g.isDag, false, 'a back-edge breaks the DAG property');
  assert.equal(g.hasCycle, true, 'cycle detected — this is the configuration the design forbids');
});

test('analyzeGraph soft-fails on garbage input (never throws)', () => {
  assert.doesNotThrow(() => analyzeGraph());
  assert.doesNotThrow(() => analyzeGraph(null));
  assert.doesNotThrow(() => analyzeGraph([{ junk: true }]));
});
