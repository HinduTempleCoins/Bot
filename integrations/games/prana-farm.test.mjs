// prana-farm.test.mjs — OFFLINE. Pure layout + call descriptors + injected reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SEASONAL_FARM_ADDRESS = '0x' + 'fa'.repeat(20);
const {
  RANGE, SEED_BASE, YIELD_BASE, isPlot, isSeed, isWater, isYield, kindOf,
  yieldIdForSeed, plantCall, harvestCall, readReady, readBalance, __setReader,
} = await import('./prana-farm.mjs');

test('id-range layout mirrors the contract (16,777,216 per class)', () => {
  assert.equal(RANGE, 0x1000000n);
  assert.equal(isPlot(0n), true); assert.equal(isPlot(SEED_BASE), false);
  assert.equal(isSeed(SEED_BASE + 5n), true);
  assert.equal(isWater(RANGE * 2n + 1n), true);
  assert.equal(isYield(YIELD_BASE + 9n), true);
  assert.equal(kindOf(SEED_BASE + 1n), 'seed');
  assert.equal(kindOf(YIELD_BASE), 'yield');
  assert.equal(kindOf(-1), 'unknown');
});

test('yieldIdForSeed maps a seed to its deterministic crop (same offset)', () => {
  assert.equal(yieldIdForSeed(SEED_BASE + 7n), YIELD_BASE + 7n);
  assert.throws(() => yieldIdForSeed(0n));   // a plot id is not a seed
});

test('plant/harvest call descriptors target SeasonalFarm with the right args', () => {
  const p = plantCall(SEED_BASE + 2n, 1, 3);
  assert.equal(p.fn, 'plant'); assert.equal(p.contract, '0x' + 'fa'.repeat(20));
  assert.deepEqual(p.args, [SEED_BASE + 2n, 1n, 3n]);
  const h = harvestCall(1);
  assert.equal(h.fn, 'harvest'); assert.deepEqual(h.args, [1n]);
});

test('reads go through the injected reader; soft-null without one', async () => {
  assert.equal(await readReady(1), null);
  __setReader(async (fn, args) => ({ fn, args }));
  assert.equal((await readReady(1)).fn, 'isReady');
  assert.equal((await readBalance('0xabc', SEED_BASE)).args[1], SEED_BASE);
  __setReader(null);
});
