import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBuckets,
  allocate,
  vestedAt,
  circulatingAt,
  summary,
  esc,
} from './allocation-plan.mjs';

const standardBuckets = () => [
  { name: 'team', pct: 20, cliffSeconds: 100, vestingSeconds: 400, tgePct: 0 },
  { name: 'community', pct: 30, cliffSeconds: 0, vestingSeconds: 200, tgePct: 10 },
  { name: 'treasury', pct: 25, cliffSeconds: 50, vestingSeconds: 0, tgePct: 0 },
  { name: 'airdrop', pct: 15, cliffSeconds: 0, vestingSeconds: 0, tgePct: 100 },
  { name: 'liquidity', pct: 10, cliffSeconds: 0, vestingSeconds: 100, tgePct: 0 },
];

test('normalizeBuckets reports pctSum and ok for a 100% plan', () => {
  const r = normalizeBuckets(standardBuckets());
  assert.equal(r.pctSum, 100);
  assert.equal(r.ok, true);
  assert.equal(r.buckets.length, 5);
  assert.equal(r.buckets[0].name, 'team');
});

test('normalizeBuckets clamps bad pct and names, reports non-100 sum', () => {
  const r = normalizeBuckets([
    { name: '', pct: -5 }, // -> bucket0, pct 0
    { name: '  hodl ', pct: 150 }, // -> 'hodl', pct 100
    { pct: NaN }, // -> bucket2, pct 0
  ]);
  assert.equal(r.buckets[0].name, 'bucket0');
  assert.equal(r.buckets[0].pct, 0);
  assert.equal(r.buckets[1].name, 'hodl');
  assert.equal(r.buckets[1].pct, 100);
  assert.equal(r.buckets[2].name, 'bucket2');
  assert.equal(r.pctSum, 100);
  assert.equal(r.ok, true);
});

test('normalizeBuckets handles non-array / empty input', () => {
  for (const bad of [undefined, null, 42, 'x', {}]) {
    const r = normalizeBuckets(bad);
    assert.deepEqual(r.buckets, []);
    assert.equal(r.pctSum, 0);
    assert.equal(r.ok, false);
  }
});

test('allocate sums to totalSupply exactly, remainder on last bucket', () => {
  const total = 1_000_000n;
  const alloc = allocate(total, standardBuckets());
  const sum = alloc.reduce((acc, a) => acc + a.units, 0n);
  assert.equal(sum, total);
  // 20/30/25/15/10 of 1e6 are clean.
  assert.equal(alloc[0].units, 200_000n);
  assert.equal(alloc[1].units, 300_000n);
});

test('allocate assigns flooring remainder to last bucket, still sums exactly', () => {
  // 3 thirds of a non-divisible supply: 1+1+1 base units leftover handling.
  const total = 100n;
  const buckets = [
    { name: 'a', pct: 33.33 },
    { name: 'b', pct: 33.33 },
    { name: 'c', pct: 33.34 },
  ];
  const alloc = allocate(total, buckets);
  const sum = alloc.reduce((acc, a) => acc + a.units, 0n);
  assert.equal(sum, total);
  // Last bucket carries any flooring leftover.
  assert.ok(alloc[2].units >= alloc[0].units);
});

test('allocate with prime-ish total still sums to total exactly', () => {
  const total = 1_000_003n;
  const alloc = allocate(total, standardBuckets());
  const sum = alloc.reduce((acc, a) => acc + a.units, 0n);
  assert.equal(sum, total);
});

test('allocate returns [] for degenerate buckets', () => {
  assert.deepEqual(allocate(1000n, []), []);
  assert.deepEqual(allocate(1000n, null), []);
});

test('allocate handles over-100 pctSum without negative units', () => {
  const alloc = allocate(1000n, [
    { name: 'a', pct: 80 },
    { name: 'b', pct: 80 },
  ]);
  for (const a of alloc) assert.ok(a.units >= 0n);
  // total*0.8 = 800 each = 1600 assigned; remainder = -600 lands on the last
  // bucket: 800 + (-600) = 200n (clamp only kicks in if it would go negative).
  assert.equal(alloc[0].units, 800n);
  assert.equal(alloc[1].units, 200n);
});

test('vestedAt: 0 before cliff', () => {
  const b = { allocatedUnits: 1000n, cliffSeconds: 100, vestingSeconds: 400, tgePct: 0 };
  assert.equal(vestedAt(b, 0), 0n);
  assert.equal(vestedAt(b, 99), 0n);
});

test('vestedAt: TGE unlock exactly at cliff', () => {
  const b = { allocatedUnits: 1000n, cliffSeconds: 100, vestingSeconds: 400, tgePct: 25 };
  assert.equal(vestedAt(b, 100), 250n); // 25% TGE, then 0 linear at cliff
});

test('vestedAt: full at and after end', () => {
  const b = { allocatedUnits: 1000n, cliffSeconds: 100, vestingSeconds: 400, tgePct: 10 };
  assert.equal(vestedAt(b, 500), 1000n); // cliff+vesting
  assert.equal(vestedAt(b, 10000), 1000n);
});

test('vestedAt: monotonic non-decreasing and bounded between cliff and end', () => {
  const b = { allocatedUnits: 1000n, cliffSeconds: 100, vestingSeconds: 400, tgePct: 10 };
  let prev = -1n;
  for (let t = 0; t <= 600; t += 13) {
    const v = vestedAt(b, t);
    assert.ok(v >= prev, `monotonic at t=${t}: ${v} < ${prev}`);
    assert.ok(v >= 0n && v <= 1000n);
    prev = v;
  }
});

test('vestedAt: zero vesting unlocks fully at cliff', () => {
  const b = { allocatedUnits: 1000n, cliffSeconds: 50, vestingSeconds: 0, tgePct: 0 };
  assert.equal(vestedAt(b, 49), 0n);
  assert.equal(vestedAt(b, 50), 1000n);
});

test('vestedAt: midpoint linear is between TGE and full', () => {
  const b = { allocatedUnits: 1000n, cliffSeconds: 0, vestingSeconds: 400, tgePct: 0 };
  const mid = vestedAt(b, 200);
  assert.equal(mid, 500n); // exactly half
});

test('vestedAt: BigInt purity and soft-fail on junk', () => {
  assert.equal(typeof vestedAt({ allocatedUnits: 100n, vestingSeconds: 10 }, 5), 'bigint');
  assert.equal(vestedAt(null, 5), 0n);
  assert.equal(vestedAt({ allocatedUnits: -50, vestingSeconds: 10 }, 100), 0n);
  assert.equal(vestedAt({ allocatedUnits: 100n, vestingSeconds: -5, cliffSeconds: 0 }, 10), 100n);
  assert.equal(vestedAt({ allocatedUnits: 'abc' }, 10), 0n);
});

test('circulatingAt: 0 at t=0 when everything has a cliff/no-TGE', () => {
  const plan = {
    totalSupply: 1_000_000n,
    buckets: [
      { name: 'team', pct: 50, cliffSeconds: 100, vestingSeconds: 400, tgePct: 0 },
      { name: 'treasury', pct: 50, cliffSeconds: 100, vestingSeconds: 400, tgePct: 0 },
    ],
  };
  const c = circulatingAt(plan, 0);
  assert.equal(c.total, 0n);
  assert.equal(c.perBucket.length, 2);
});

test('circulatingAt: reaches full totalSupply at the end of all vesting', () => {
  const plan = { totalSupply: 1_000_000n, buckets: standardBuckets() };
  // Max end = max(cliff+vesting) = team 100+400 = 500.
  const c = circulatingAt(plan, 1000);
  assert.equal(c.total, plan.totalSupply);
  const sumBuckets = c.perBucket.reduce((a, b) => a + b.vested, 0n);
  assert.equal(sumBuckets, plan.totalSupply);
});

test('circulatingAt: total is monotonic and bounded by totalSupply', () => {
  const plan = { totalSupply: 1_000_000n, buckets: standardBuckets() };
  let prev = -1n;
  for (let t = 0; t <= 600; t += 17) {
    const c = circulatingAt(plan, t);
    assert.ok(c.total >= prev, `monotonic at t=${t}`);
    assert.ok(c.total <= plan.totalSupply);
    assert.equal(typeof c.total, 'bigint');
    prev = c.total;
  }
});

test('circulatingAt: degenerate plan yields zero', () => {
  assert.deepEqual(circulatingAt(null, 100), { total: 0n, perBucket: [] });
  assert.deepEqual(circulatingAt({ totalSupply: 1000n, buckets: [] }, 100), {
    total: 0n,
    perBucket: [],
  });
});

test('summary: pctSum reporting, BigInt units, esc-safe names', () => {
  const plan = {
    totalSupply: 1_000_000n,
    buckets: [
      { name: '<b>team</b>', pct: 60, cliffSeconds: 0, vestingSeconds: 0, tgePct: 100 },
      { name: 'rest', pct: 40, cliffSeconds: 0, vestingSeconds: 0, tgePct: 100 },
    ],
  };
  const s = summary(plan);
  assert.equal(s.pctSum, 100);
  assert.equal(s.ok, true);
  assert.equal(s.totalSupply, 1_000_000n);
  assert.equal(typeof s.buckets[0].units, 'bigint');
  assert.ok(!s.buckets[0].name.includes('<b>'));
  assert.ok(s.buckets[0].name.includes('&lt;'));
  // units sum to totalSupply
  const sum = s.buckets.reduce((a, b) => a + b.units, 0n);
  assert.equal(sum, plan.totalSupply);
});

test('summary: soft-fail on missing plan', () => {
  const s = summary(undefined);
  assert.equal(s.totalSupply, 0n);
  assert.deepEqual(s.buckets, []);
  assert.equal(s.pctSum, 0);
  assert.equal(s.ok, false);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
