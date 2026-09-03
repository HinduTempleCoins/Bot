// farmville-plants.test.mjs — offline, deterministic. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FV_CROPS, getCrop, growBlocks, maturesAtBlock, withersAtBlock, plantState,
  harvestWindowLeft, harvestFV, unwitherCost, revive, catalog, WITHER_MULT,
} from './farmville-plants.mjs';

const BS = 12; // pass block seconds explicitly so tests don't depend on env

test('FV_CROPS are well-formed', () => {
  assert.ok(FV_CROPS.length >= 5);
  for (const c of FV_CROPS) {
    assert.ok(c.id && c.name);
    assert.ok(c.growSeconds > 0 && c.coins > 0 && c.seedCost > 0);
  }
  assert.ok(FV_CROPS.some((c) => c.cannabis), 'at least one fast cannabis auto in the layer');
});

test('growBlocks converts grow seconds at the given block time', () => {
  assert.equal(growBlocks('wheat', BS), Math.ceil((2 * 60) / BS));      // 10
  assert.equal(growBlocks('tomatoes', BS), Math.ceil((30 * 60) / BS));  // 150
  assert.equal(growBlocks('nope', BS), 0);
});

test('mature and wither blocks follow the FarmVille 2x window', () => {
  const gb = growBlocks('tomatoes', BS); // 150
  assert.equal(maturesAtBlock(0, 'tomatoes', BS), gb);
  assert.equal(withersAtBlock(0, 'tomatoes', BS), gb + gb * WITHER_MULT); // 450
});

test('plantState transitions growing -> ready -> withered', () => {
  const gb = growBlocks('tomatoes', BS);           // 150
  const wither = withersAtBlock(0, 'tomatoes', BS); // 450
  assert.equal(plantState(0, gb - 1, 'tomatoes', BS), 'growing');
  assert.equal(plantState(0, gb, 'tomatoes', BS), 'ready');
  assert.equal(plantState(0, wither - 1, 'tomatoes', BS), 'ready');
  assert.equal(plantState(0, wither, 'tomatoes', BS), 'withered');
});

test('harvestWindowLeft is the blocks until wither while ready, else 0', () => {
  const gb = growBlocks('tomatoes', BS);
  assert.equal(harvestWindowLeft(0, gb, 'tomatoes', BS), gb * WITHER_MULT); // full window at maturity
  assert.equal(harvestWindowLeft(0, gb - 5, 'tomatoes', BS), 0);           // still growing
  assert.equal(harvestWindowLeft(0, withersAtBlock(0, 'tomatoes', BS), 'tomatoes', BS), 0); // withered
});

test('harvestFV pays only in the ready window', () => {
  const gb = growBlocks('tomatoes', BS);
  assert.deepEqual(harvestFV(0, gb - 1, 'tomatoes', BS), { ok: false, state: 'growing', coins: 0, seedsBack: 0 });
  const ok = harvestFV(0, gb, 'tomatoes', BS);
  assert.equal(ok.ok, true);
  assert.equal(ok.coins, getCrop('tomatoes').coins);
  assert.equal(ok.seedsBack, 1);
  const withered = harvestFV(0, withersAtBlock(0, 'tomatoes', BS), 'tomatoes', BS);
  assert.equal(withered.ok, false);
  assert.equal(withered.state, 'withered');
});

test('unwitherCost defaults to 30% of the coin value (rounded up)', () => {
  assert.equal(unwitherCost('tomatoes'), Math.ceil((18 * 3000) / 10000)); // 6
  assert.equal(unwitherCost('pumpkins'), Math.ceil((60 * 3000) / 10000)); // 18
});

test('revive only works on a withered crop and returns a cost + fresh window', () => {
  const gb = growBlocks('tomatoes', BS);
  assert.deepEqual(revive(0, gb, 'tomatoes', BS), { ok: false, reason: 'not-withered' });
  const wither = withersAtBlock(0, 'tomatoes', BS);
  const r = revive(0, wither, 'tomatoes', BS);
  assert.equal(r.ok, true);
  assert.equal(r.state, 'ready');
  assert.equal(r.cost, unwitherCost('tomatoes'));
  assert.equal(r.readyUntil, wither + gb * WITHER_MULT);
});

test('catalog exposes grow/wither windows and profit-per-block', () => {
  const c = catalog(BS).find((x) => x.id === 'tomatoes');
  assert.equal(c.growBlocks, growBlocks('tomatoes', BS));
  assert.equal(c.witherWindowBlocks, growBlocks('tomatoes', BS) * WITHER_MULT);
  assert.equal(c.unwitherCost, unwitherCost('tomatoes'));
  assert.ok(c.profitPerBlock > 0);
});
