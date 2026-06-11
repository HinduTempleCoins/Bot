// integrations/market-cap.test.mjs — offline, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketCap, fdv, inUsd, project, format } from './market-cap.mjs';

test('marketCap: VKBT 1.93M @ 1 HIVE', () => {
  assert.equal(marketCap({ supply: 1_930_000, price: 1 }), 1_930_000);
});

test('marketCap: CURE 55K @ 1 HIVE', () => {
  assert.equal(marketCap({ supply: 55_000, price: 1 }), 55_000);
});

test('marketCap: arbitrary supply×price', () => {
  assert.equal(marketCap({ supply: 1000, price: 0.5 }), 500);
});

test('fdv: maxSupply×price', () => {
  assert.equal(fdv({ maxSupply: 2_000_000, price: 1 }), 2_000_000);
});

test('inUsd: quote→USD conversion', () => {
  // 579K HIVE at $0.30/HIVE ≈ $173.7K
  assert.equal(inUsd(579_000, 0.3), 173_700);
  assert.equal(inUsd(16_700, 1), 16_700);
});

test('project: full happy path with hiveUsd', () => {
  const r = project({
    circulatingSupply: 1_930_000,
    maxSupply: 2_000_000,
    currentPrice: 0.3,
    targetPrice: 1,
    hiveUsd: 0.3,
  });
  assert.equal(r.currentCapHive, 579_000);
  assert.ok(Math.abs(r.currentCapUsd - 173_700) < 1e-6);
  assert.equal(r.targetCapHive, 1_930_000);
  assert.equal(r.targetCapUsd, 579_000);
  assert.equal(r.fdvAtTargetHive, 2_000_000);
  assert.equal(r.fdvAtTargetUsd, 600_000);
  assert.ok(Math.abs(r.multipleToTarget - 1 / 0.3) < 1e-9);
});

test('project: 1:1 HIVE current = supply, USD null without rate', () => {
  const r = project({
    circulatingSupply: 55_000,
    maxSupply: 100_000,
    currentPrice: 1,
    targetPrice: 1,
  });
  assert.equal(r.currentCapHive, 55_000);
  assert.equal(r.currentCapUsd, null);
  assert.equal(r.multipleToTarget, 1);
  assert.equal(r.fdvAtTargetHive, 100_000);
  assert.equal(r.fdvAtTargetUsd, null);
});

test('format: compact USD', () => {
  assert.equal(format(579_000, { usd: true }), '$579.0K');
  assert.equal(format(16_700, { usd: true }), '$16.7K');
  assert.equal(format(1_930_000, { usd: true }), '$1.9M');
  assert.equal(format(500, { usd: true }), '$500.0');
});

test('format: compact HIVE (default)', () => {
  assert.equal(format(579_000), '579.0K HIVE');
  assert.equal(format(1_930_000), '1.9M HIVE');
  assert.equal(format(2_500_000_000), '2.5B HIVE');
  assert.equal(format(3.4e12), '3.4T HIVE');
});

test('format: negative keeps sign', () => {
  assert.equal(format(-579_000, { usd: true }), '-$579.0K');
  assert.equal(format(-1_000), '-1.0K HIVE');
});

// --- soft-fail / edge ---
test('marketCap: missing/NaN => null', () => {
  assert.equal(marketCap(), null);
  assert.equal(marketCap({ supply: 1000 }), null);
  assert.equal(marketCap({ supply: 'abc', price: 1 }), null);
  assert.equal(marketCap({ supply: NaN, price: 1 }), null);
});

test('fdv: missing/NaN => null', () => {
  assert.equal(fdv(), null);
  assert.equal(fdv({ maxSupply: 1 }), null);
  assert.equal(fdv({ maxSupply: Infinity, price: 1 }), null);
});

test('inUsd: bad input => null', () => {
  assert.equal(inUsd(null, 1), null);
  assert.equal(inUsd(100, null), null);
  assert.equal(inUsd('x', 1), null);
});

test('project: empty/garbage => all null, never throws', () => {
  const r = project();
  for (const k of Object.keys(r)) assert.equal(r[k], null, k);
  const r2 = project({ circulatingSupply: 'x', currentPrice: 'y' });
  assert.equal(r2.currentCapHive, null);
});

test('project: zero current price => multiple null (no divide-by-zero)', () => {
  const r = project({
    circulatingSupply: 1000,
    currentPrice: 0,
    targetPrice: 5,
  });
  assert.equal(r.multipleToTarget, null);
  assert.equal(r.currentCapHive, 0);
});

test('format: bad input => null', () => {
  assert.equal(format(NaN), null);
  assert.equal(format(undefined), null);
  assert.equal(format('nope'), null);
  assert.equal(format(Infinity), null);
});

test('format: zero', () => {
  assert.equal(format(0, { usd: true }), '$0.0');
  assert.equal(format(0), '0.0 HIVE');
});
