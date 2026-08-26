// arb-scanner.test.mjs — OFFLINE tests. No network, no keys. Deterministic over injected snapshots.
//   node --test integrations/trade/arb-scanner.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanArb, spotArb, outcomeArb, triangleArb } from './arb-scanner.mjs';

test('spot: detects a real cross-exchange arb net of fees', () => {
  // buy 61200 on A, sell 62000 on B → ~1.3% gross; small fees keep it positive.
  const r = spotArb('SWAP.BTC', [
    { venue: 'A', bid: 61000, ask: 61200, takerFee: 0.001 },
    { venue: 'B', bid: 62000, ask: 62100, takerFee: 0.001 },
  ], { sizeUsd: 1000 });
  assert.ok(r);
  assert.equal(r.buy.venue, 'A');
  assert.equal(r.sell.venue, 'B');
  assert.equal(r.isArb, true);
  assert.ok(r.netEdgePct > 0);
});

test('spot: flat withdrawal fee kills the arb on tiny size, survives on large size', () => {
  const venues = [
    { venue: 'A', bid: 100, ask: 100, takerFee: 0 },
    { venue: 'B', bid: 101, ask: 101, takerFee: 0, withdrawFeeUsd: 5 },
  ];
  const small = spotArb('T', venues, { sizeUsd: 10 });    // 1% edge, $5 fee on $10 → negative
  const large = spotArb('T', venues, { sizeUsd: 10000 }); // fee amortized to nothing → positive
  assert.equal(small.isArb, false);
  assert.equal(large.isArb, true);
  assert.ok(large.breakevenSizeUsd > 0);
});

test('spot: no arb when best bid < best ask (normal spread)', () => {
  const r = spotArb('T', [
    { venue: 'A', bid: 99, ask: 100, takerFee: 0.001 },
    { venue: 'B', bid: 99.5, ask: 100.5, takerFee: 0.001 },
  ]);
  assert.equal(r.isArb, false);
  assert.ok(r.netEdgePct < 0);
});

test('outcome: two-way surebet detected via gambling.arbitrage', () => {
  // both sides at 2.10 → 1/2.1 + 1/2.1 = 0.952 < 1 → arb.
  const r = outcomeArb('UP-DOWN', [
    { outcome: 'UP', decimalOdds: 2.10 },
    { outcome: 'DOWN', decimalOdds: 2.10 },
  ]);
  assert.equal(r.isArb, true);
  assert.ok(r.guaranteedProfitPct > 0);
  const s = r.legs.reduce((a, l) => a + l.stakeFraction, 0);
  assert.ok(Math.abs(s - 1) < 1e-6);  // stakes sum to 1
});

test('outcome: normal vigged book is NOT an arb', () => {
  const r = outcomeArb('m', [{ decimalOdds: 1.9 }, { decimalOdds: 1.9 }]);
  assert.equal(r.isArb, false);
  assert.ok(r.bookMarginPct > 0);
});

test('triangular: consistent cross-rates ⇒ no arb; a gap ⇒ arb', () => {
  const flat = triangleArb({ name: 't', ab: 1.2, bc: 1.0, ac: 1.2 }); // ratio 1.0
  assert.equal(flat.isArb, false);
  const gap = triangleArb({ name: 't', ab: 1.30, bc: 1.0, ac: 1.2 });  // ratio ~1.083
  assert.equal(gap.isArb, true);
  assert.ok(gap.profitPct > 0);
});

test('scanArb: fuses + ranks; soft-fails on junk snapshot', () => {
  const r = scanArb({
    spot: { T: [{ venue: 'A', bid: 100, ask: 100 }, { venue: 'B', bid: 103, ask: 103 }] },
    outcomes: [{ market: 'm', legs: [{ decimalOdds: 2.2 }, { decimalOdds: 2.2 }] }],
    triangles: [{ name: 'x', ab: 1.3, bc: 1.0, ac: 1.2 }],
  }, { sizeUsd: 1000 });
  assert.ok(r.opportunities.length >= 3);
  // sorted descending by profitPct
  for (let i = 1; i < r.opportunities.length; i++) {
    assert.ok(r.opportunities[i - 1].profitPct >= r.opportunities[i].profitPct);
  }
  assert.ok(r.best);
});

test('soft-fail: garbage inputs return null / empty, never throw', () => {
  assert.equal(spotArb('T', null), null);
  assert.equal(spotArb('T', [{ venue: 'A', bid: 'x', ask: 'y' }]), null);
  assert.equal(outcomeArb('m', [{ decimalOdds: 0.5 }, { decimalOdds: 2 }]), null); // odds ≤ 1 invalid
  assert.equal(triangleArb({ ab: -1, bc: 1, ac: 1 }), null);
  const r = scanArb(null);
  assert.deepEqual(r.opportunities, []);
  assert.equal(r.best, null);
});
