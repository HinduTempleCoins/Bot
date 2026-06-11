// triangular-arb.test.mjs — offline, pure. Happy path + fee-eaten + no-cycle + soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCycles, bestCycle, buildGraph } from './triangular-arb.mjs';

// A profitable triangle: 0.90 × 0.88 × 1.30 = 1.0296 → +2.96% gross.
const PROFITABLE = [
  { from: 'USD', to: 'EUR', price: 0.90 },
  { from: 'EUR', to: 'GBP', price: 0.88 },
  { from: 'GBP', to: 'USD', price: 1.30 },
];

test('finds a profitable 3-leg cycle and reports the multiples', () => {
  const cycles = findCycles(PROFITABLE);
  assert.equal(cycles.length, 1);
  const c = cycles[0];
  assert.deepEqual(c.path, ['USD', 'EUR', 'GBP', 'USD']);
  assert.equal(c.legs.length, 3);
  assert.ok(Math.abs(c.grossMultiple - 1.0296) < 1e-9, `gross ${c.grossMultiple}`);
  assert.ok(Math.abs(c.netMultiple - 1.0296) < 1e-9, 'net == gross at 0 fee');
  assert.ok(Math.abs(c.profitPct - 2.96) < 1e-6, `profit ${c.profitPct}`);
  assert.equal(bestCycle(PROFITABLE).path.join('>'), 'USD>EUR>GBP>USD');
});

test('rotations dedup to a single cycle regardless of start asset', () => {
  // same triangle, rows in a rotated order
  const rotated = [
    { from: 'GBP', to: 'USD', price: 1.30 },
    { from: 'USD', to: 'EUR', price: 0.90 },
    { from: 'EUR', to: 'GBP', price: 0.88 },
  ];
  assert.equal(findCycles(rotated).length, 1);
});

test('a fee-eaten triangle is filtered out', () => {
  // 2.96% gross gain, but 1%/leg fee ≈ -3% over three legs wipes it below break-even.
  const cycles = findCycles(PROFITABLE, { feePct: 1 });
  assert.equal(cycles.length, 0, 'fee should eat the thin edge');
  // and minProfitPct demands a margin: even 0-fee, a 5% floor rejects the 2.96% trip.
  assert.equal(findCycles(PROFITABLE, { minProfitPct: 5 }).length, 0);
  assert.equal(bestCycle(PROFITABLE, { feePct: 1 }), null);
});

test('no-cycle set yields []', () => {
  const noClose = [
    { from: 'A', to: 'B', price: 2 },
    { from: 'B', to: 'C', price: 2 },
    { from: 'C', to: 'D', price: 2 }, // never returns to A
  ];
  assert.deepEqual(findCycles(noClose), []);
  assert.equal(bestCycle(noClose), null);
  // a closing cycle that simply loses money (product < 1) is also excluded at default floor 0.
  const losing = [
    { from: 'A', to: 'B', price: 0.5 },
    { from: 'B', to: 'C', price: 0.5 },
    { from: 'C', to: 'A', price: 0.5 }, // product 0.125
  ];
  assert.deepEqual(findCycles(losing), []);
});

test('startAssets restricts the starting asset', () => {
  const r = [
    ...PROFITABLE,
    // a second profitable triangle on different assets
    { from: 'X', to: 'Y', price: 2 },
    { from: 'Y', to: 'Z', price: 2 },
    { from: 'Z', to: 'X', price: 0.3 }, // 1.2 → +20%
  ];
  const all = findCycles(r);
  assert.equal(all.length, 2);
  assert.equal(all[0].path[0], 'X', 'higher-profit cycle ranks first');
  const onlyUsd = findCycles(r, { startAssets: 'USD' });
  assert.equal(onlyUsd.length, 1);
  assert.equal(onlyUsd[0].path[0], 'USD');
  // array form + an asset with no cycle
  assert.equal(findCycles(r, { startAssets: ['USD', 'NOPE'] }).length, 1);
});

test('soft-fail: malformed rates ignored, never throws; empty => []', () => {
  assert.deepEqual(findCycles([]), []);
  assert.deepEqual(findCycles(null), []);
  assert.deepEqual(findCycles(undefined), []);
  assert.deepEqual(findCycles('garbage'), []);
  assert.deepEqual(findCycles([null, 42, {}, { from: 'A' }, { from: 'A', to: 'A', price: 2 }]), []);
  // negative/NaN/zero prices dropped; only the valid triangle survives.
  const messy = [
    { from: 'USD', to: 'EUR', price: 0.90 },
    { from: 'EUR', to: 'GBP', price: 0.88 },
    { from: 'GBP', to: 'USD', price: 1.30 },
    { from: 'USD', to: 'BAD', price: -1 },
    { from: 'BAD', to: 'USD', price: NaN },
    { from: 'USD', to: 'ZERO', price: 0 },
  ];
  assert.equal(findCycles(messy).length, 1);
});

test('feePct >= 100 does not crash and yields no profit', () => {
  assert.deepEqual(findCycles(PROFITABLE, { feePct: 100 }), []);
  assert.deepEqual(findCycles(PROFITABLE, { feePct: 250 }), []);
});

test('buildGraph is reusable and last-write-wins per directed pair', () => {
  const g = buildGraph(PROFITABLE);
  assert.deepEqual([...g.assets].sort(), ['EUR', 'GBP', 'USD']);
  assert.equal(g.edges.get('USD').get('EUR').price, 0.90);
  const g2 = buildGraph([
    { from: 'USD', to: 'EUR', price: 1 },
    { from: 'USD', to: 'EUR', price: 0.95 }, // overwrites
  ]);
  assert.equal(g2.edges.get('USD').get('EUR').price, 0.95);
  assert.deepEqual(buildGraph(null).assets, []);
});
