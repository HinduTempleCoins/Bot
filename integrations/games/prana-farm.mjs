// prana-farm.mjs — interface to the FARMING GAME (PRANA SeasonalFarm, an ERC-1155). A player plants a
// seed into a plot (optionally adding water to shorten growth), waits a fixed number of blocks, then
// harvests a yield. A per-season modifier scales the harvest. This module mirrors the contract's id-range
// layout + pure helpers (so a UI can label tokens without a chain call), builds the plant/harvest call
// descriptors the edge submits, and reads plot/inventory/season state through an injected reader.
//
// KEY CUSTODY: signs nothing, holds no key, no network here. Call descriptors are { contract, fn, args };
// the edge (an ethers Contract / MELEK-Signer) submits them. Reads via __setReader. Soft-fail-never-throw.
//
//   import { layout, isSeed, yieldIdForSeed, plantCall, harvestCall, readReady, readBalance, __setReader }

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const FARM_ADDRESS = () => String(env('SEASONAL_FARM_ADDRESS', '') || '').trim();

// id-range layout — EXACTLY the contract's constants (16,777,216 ids per class).
export const RANGE = 0x1000000n;
export const PLOT_BASE = 0n * RANGE;
export const SEED_BASE = 1n * RANGE;
export const WATER_BASE = 2n * RANGE;
export const YIELD_BASE = 3n * RANGE;
export const MODIFIER_DENOMINATOR = 10000n;     // 10000 bps = 1.0x season modifier
export const layout = { RANGE, PLOT_BASE, SEED_BASE, WATER_BASE, YIELD_BASE };

const B = (x) => BigInt(x);
export const isPlot = (id) => { try { const i = B(id); return i >= PLOT_BASE && i < SEED_BASE; } catch { return false; } };
export const isSeed = (id) => { try { const i = B(id); return i >= SEED_BASE && i < WATER_BASE; } catch { return false; } };
export const isWater = (id) => { try { const i = B(id); return i >= WATER_BASE && i < YIELD_BASE; } catch { return false; } };
export const isYield = (id) => { try { const i = B(id); return i >= YIELD_BASE && i < YIELD_BASE + RANGE; } catch { return false; } };
export const kindOf = (id) => (isPlot(id) ? 'plot' : isSeed(id) ? 'seed' : isWater(id) ? 'water' : isYield(id) ? 'yield' : 'unknown');

/** The deterministic yield id a seed produces (same offset within its range). Mirrors yieldIdForSeed. */
export function yieldIdForSeed(seedId) {
  const s = B(seedId);
  if (!isSeed(s)) throw new Error('not a seed id');
  return YIELD_BASE + (s - SEED_BASE);
}

const at = (opts) => (opts && opts.contract) || FARM_ADDRESS();

/** plant(seedId, plotId, waterUnits) — burns the seed (+ water) into a plot you own; starts the timer. */
export function plantCall(seedId, plotId, waterUnits = 0, opts = {}) {
  return { contract: at(opts), fn: 'plant', args: [B(seedId), B(plotId), B(waterUnits)] };
}
/** harvest(plotId) — once mature, mint the yield to you (returns yieldId + amount on-chain). */
export function harvestCall(plotId, opts = {}) {
  return { contract: at(opts), fn: 'harvest', args: [B(plotId)] };
}

// ── reads (injected; edge wires an ethers Contract / the prana-rpc-gateway) ──────────────────────────
let _reader = null;
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }
async function read(fn, args) { if (!_reader) return null; try { return await _reader(fn, args); } catch { return null; } }

/** isReady(plotId) → has the crop matured? */
export const readReady = (plotId) => read('isReady', [B(plotId)]);
/** ERC1155 balanceOf(account, id) → how many of a token a player holds (plot/seed/water/yield). */
export const readBalance = (account, id) => read('balanceOf', [account, B(id)]);
/** seasonModifier() → current harvest scale in bps (10000 = 1.0x). */
export const readSeasonModifier = () => read('seasonModifier', []);

if (process.argv[1] && process.argv[1].endsWith('prana-farm.mjs')) {
  const seed = SEED_BASE + 5n;
  console.log(JSON.stringify({
    farm: FARM_ADDRESS() || '(set SEASONAL_FARM_ADDRESS)',
    sampleSeed: seed.toString(), kind: kindOf(seed), yieldId: yieldIdForSeed(seed).toString(),
    plant: plantCall(seed, PLOT_BASE + 1n, 2),
  }, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
}
