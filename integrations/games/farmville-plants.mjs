// farmville-plants.mjs — the casual FAST-crop layer with the FarmVille WITHER mechanic.
//
// The Kush Farm's genetics/breeding side (plant-genetics.mjs) is the prestige/scarcity game; THIS is
// the opposite pole the research (B1.2) called for: quick, minutes-to-hours crops with the FarmVille
// urgency loop — a crop is harvestable only for a WINDOW after it matures (FarmVille: ~2x the grow
// time), then it WITHERS and is lost unless you revive it with an Unwither Spray (a premium sink).
// That "come back in time or lose it" tension is the retention/monetization hook; the spray + the
// lost-crop are both sinks.
//
// Compliance/econ: coins here are the EARNED soft currency (non-cashable); the spray is bought with a
// soft/premium currency, never fiat-out. Layers on kush-farm.mjs without changing it (block-based,
// deterministic). No wall-clock — the caller passes head block.
//
//   import { FV_CROPS, getCrop, growBlocks, maturesAtBlock, withersAtBlock, plantState,
//            harvestFV, unwitherCost, revive, catalog } from './games/farmville-plants.mjs'
//   node integrations/games/farmville-plants.mjs

import { BLOCK_SEC } from './kush-farm.mjs';

const MIN = 60;
const HR = 3600;

// FarmVille "harvestable window = ~2x grow time" before it withers.
export const WITHER_MULT = 2;

// Fast crops — quick timers, small coin yields, seed cost to replant (a direct sink). A couple of
// fast cannabis "autos" sit alongside the vegetables so the layer ties back to the weed theme.
export const FV_CROPS = [
  { id: 'wheat',     name: 'Wheat',      growSeconds: 2 * MIN,  coins: 3,  seedCost: 1 },
  { id: 'corn',      name: 'Corn',       growSeconds: 5 * MIN,  coins: 5,  seedCost: 2 },
  { id: 'carrots',   name: 'Carrots',    growSeconds: 10 * MIN, coins: 8,  seedCost: 3 },
  { id: 'quick-auto', name: 'Quick Auto', growSeconds: 20 * MIN, coins: 12, seedCost: 4, cannabis: true },
  { id: 'tomatoes',  name: 'Tomatoes',   growSeconds: 30 * MIN, coins: 18, seedCost: 6 },
  { id: 'cotton',    name: 'Cotton',     growSeconds: 1 * HR,   coins: 26, seedCost: 9 },
  { id: 'pumpkins',  name: 'Pumpkins',   growSeconds: 2 * HR,   coins: 60, seedCost: 20 },
];

export const getCrop = (id) => FV_CROPS.find((c) => c.id === String(id || '').toLowerCase()) || null;
const cropOf = (c) => (typeof c === 'string' ? getCrop(c) : c);

export function growBlocks(crop, blockSec = BLOCK_SEC()) {
  const c = cropOf(crop);
  const b = Number(blockSec) || 1;
  return c ? Math.ceil(c.growSeconds / b) : 0;
}

export function maturesAtBlock(plantedAtBlock, crop, blockSec = BLOCK_SEC()) {
  return Number(plantedAtBlock) + growBlocks(crop, blockSec);
}

/** The block at which an un-harvested mature crop withers (mature + 2x grow window). */
export function withersAtBlock(plantedAtBlock, crop, blockSec = BLOCK_SEC()) {
  return maturesAtBlock(plantedAtBlock, crop, blockSec) + growBlocks(crop, blockSec) * WITHER_MULT;
}

/** 'growing' | 'ready' | 'withered' for the given head block. */
export function plantState(plantedAtBlock, headBlock, crop, blockSec = BLOCK_SEC()) {
  const c = cropOf(crop);
  if (!c) return 'unknown';
  const head = Number(headBlock);
  if (head < maturesAtBlock(plantedAtBlock, c, blockSec)) return 'growing';
  if (head < withersAtBlock(plantedAtBlock, c, blockSec)) return 'ready';
  return 'withered';
}

/** Blocks left in the harvest window before wither (0 if not yet ready or already withered). */
export function harvestWindowLeft(plantedAtBlock, headBlock, crop, blockSec = BLOCK_SEC()) {
  const state = plantState(plantedAtBlock, headBlock, crop, blockSec);
  if (state !== 'ready') return 0;
  return withersAtBlock(plantedAtBlock, crop, blockSec) - Number(headBlock);
}

/**
 * Harvest — only pays out if the crop is 'ready' (in-window). Returns coins + seedsBack (1, so
 * replant costs net seedCost-1) and the state. A withered or still-growing crop pays nothing.
 */
export function harvestFV(plantedAtBlock, headBlock, crop, blockSec = BLOCK_SEC()) {
  const c = cropOf(crop);
  if (!c) return { ok: false, state: 'unknown', coins: 0, seedsBack: 0 };
  const state = plantState(plantedAtBlock, headBlock, c, blockSec);
  if (state !== 'ready') return { ok: false, state, coins: 0, seedsBack: 0 };
  return { ok: true, state, coins: c.coins, seedsBack: 1 };
}

/** Cost of an Unwither Spray for a crop (premium sink) — scales with the crop's value. */
export const UNWITHER_BPS = () => Number((typeof process !== 'undefined' && process.env?.FV_UNWITHER_BPS) || '3000') || 3000;
export function unwitherCost(crop) {
  const c = cropOf(crop);
  if (!c) return 0;
  return Math.max(1, Math.ceil((c.coins * UNWITHER_BPS()) / 10000)); // default 30% of coin value
}

/**
 * Revive a WITHERED crop with an Unwither Spray. Returns the cost (a sink) and a fresh readyUntil
 * window so the caller can persist it back to 'ready'. No-op unless the crop is actually withered.
 */
export function revive(plantedAtBlock, headBlock, crop, blockSec = BLOCK_SEC()) {
  const c = cropOf(crop);
  if (!c) return { ok: false, reason: 'unknown-crop' };
  if (plantState(plantedAtBlock, headBlock, c, blockSec) !== 'withered') {
    return { ok: false, reason: 'not-withered' };
  }
  const head = Number(headBlock);
  return {
    ok: true,
    cost: unwitherCost(c),                 // BURN this (premium sink)
    state: 'ready',
    // revived crop is ready now, with a fresh wither window from here.
    readyUntil: head + growBlocks(c, blockSec) * WITHER_MULT,
  };
}

/** UI catalog for the fast-crop page. */
export function catalog(blockSec = BLOCK_SEC()) {
  return FV_CROPS.map((c) => ({
    id: c.id, name: c.name, cannabis: !!c.cannabis,
    growBlocks: growBlocks(c, blockSec),
    witherWindowBlocks: growBlocks(c, blockSec) * WITHER_MULT,
    coins: c.coins, seedCost: c.seedCost, unwitherCost: unwitherCost(c),
    profitPerBlock: +(c.coins / Math.max(1, growBlocks(c, blockSec))).toFixed(4),
  }));
}

if (process.argv[1] && process.argv[1].endsWith('farmville-plants.mjs')) {
  console.log(JSON.stringify(catalog(), null, 2));
  const bs = BLOCK_SEC();
  const gb = growBlocks('tomatoes', bs);
  console.log('tomatoes: grow', gb, 'blocks; mature@', maturesAtBlock(0, 'tomatoes', bs), 'wither@', withersAtBlock(0, 'tomatoes', bs));
  console.log('state @grow/2:', plantState(0, Math.floor(gb / 2), 'tomatoes', bs));
  console.log('state @mature:', plantState(0, gb, 'tomatoes', bs));
  console.log('state @wither:', plantState(0, withersAtBlock(0, 'tomatoes', bs), 'tomatoes', bs));
  console.log('revive @wither:', revive(0, withersAtBlock(0, 'tomatoes', bs), 'tomatoes', bs));
}
