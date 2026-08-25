// tribulum.mjs — Tribulum FARM tier: the grow → harvest → sell core loop (the first playable
// increment of the Tribulum game-line, per .local/TRIBULUM_ECONOMY_MASTER_DESIGN.md §2, §9.3).
//
// This is the FARM increment ONLY (Ranch → Prodigium come later). It COMPOSES the already-built +
// tested catalogs — it invents no crops or items of its own:
//   • kush-farm.mjs   — the strain catalog + grow tiers (grow times) + the harvest yield/seed-return math.
//   • seed-tokens.mjs — the strain.id ⇆ engine SYMBOL bridge (a planted seed = a tradable token, plant = burn).
//   • farm-items.mjs  — the shop catalog: tools (durable NFTs) + consumables, each with a boost effect (bps).
//   • economy.mjs     — the RARITY ladder + rarityWeight → the market price of a crop unit (rarer = dearer).
//
// PURE + deterministic: the clock is ALWAYS injected ({ now } in ms epoch, like crops.mjs). Nothing here
// calls Date.now() — the caller (the server / a timer) owns the clock. Soft-fail-never-throw: a bad action
// returns { ok:false, reason } instead of throwing, so a game surface can never 500 on a fat-fingered move.
// An injectable in-memory store holds per-account farm state.
//
//   import { newFarm, plant, growthStage, harvest, sell, createStore, openFarm, renderFarm } from './tribulum.mjs'
//   node integrations/games/tribulum.mjs            # tiny deterministic demo

import { getStrain, growSeconds, harvest as kushHarvest } from './kush-farm.mjs';
import { symbolForStrain } from './seed-tokens.mjs';
import { itemForSymbol, shopCatalog } from './farm-items.mjs';
import { RARITY, rarityWeight } from './economy.mjs';

const MS_PER_SEC = 1000;

// Grain — the internal stable pricing unit (§1.2). 1,000 Grain = 1 KULA at the swap surface.
export const CURRENCY = 'GRAIN';

// Map a crop's lowercase rarity (kush-farm: common|uncommon|rare|legendary) → the economy.mjs RARITY tier,
// so the market price comes straight from economy.mjs's rarityWeight (rarer = scarcer = dearer).
const RARITY_TIER = {
  common: RARITY.COMMON,
  uncommon: RARITY.UNCOMMON,
  rare: RARITY.RARE,
  epic: RARITY.EPIC,
  legendary: RARITY.LEGENDARY,
};

// Base Grain a Common crop unit clears for; scarcer tiers scale up by the inverse of their drop weight
// (economy.mjs: Common 100 … Legendary 1), so a legendary unit is worth ~100× a common one.
const GRAIN_BASE_UNIT = Number(
  (typeof process !== 'undefined' && process.env && process.env.TRIBULUM_GRAIN_BASE) || 1,
) || 1;

/** Market price (in Grain) for ONE unit of a crop of the given rarity, from economy.mjs's weight ladder. */
export function unitPrice(rarity) {
  const tier = RARITY_TIER[String(rarity || '').toLowerCase()] || RARITY.COMMON;
  const w = rarityWeight(tier) || rarityWeight(RARITY.COMMON);
  return Math.max(1, Math.round(GRAIN_BASE_UNIT * (rarityWeight(RARITY.COMMON) / w)));
}

// ── the plot / farm model ────────────────────────────────────────────────────────────────────────
export const DEFAULT_FARM_SIZE = 6;
const MAX_FARM_SIZE = 48;

/** newFarm(size) → a fresh farm of `size` empty plots. Soft-clamps size to a sane range. */
export function newFarm(size = DEFAULT_FARM_SIZE, owner = null) {
  const n = Math.max(1, Math.min(MAX_FARM_SIZE, Math.floor(Number(size) || DEFAULT_FARM_SIZE)));
  return { owner: owner || null, size: n, plots: new Array(n).fill(null) };
}

const isFarm = (f) => !!(f && Array.isArray(f.plots));
const asMs = (now) => {
  const t = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(t) ? t : NaN;
};

// Sum the bps of every equipped boost matching `effect` (growthSpeed | yield | …) from farm-items.mjs.
function boostBps(boosts, effect) {
  let bps = 0;
  for (const sym of Array.isArray(boosts) ? boosts : []) {
    const item = itemForSymbol(sym);
    if (item && item.boost && item.boost.effect === effect) bps += Number(item.boost.bps) || 0;
  }
  return bps;
}

/**
 * plant({ farm, plotIndex, seedId, now, boosts }) → { ok, plot } | { ok:false, reason }.
 * Plants the strain `seedId` (a kush-farm strain id) on an EMPTY plot. Grow time comes from the crop's
 * tier in kush-farm.mjs; equipped growthSpeed tools/consumables (farm-items.mjs) shorten it. Records
 * plantedAt + a precomputed readyAt so growth is a pure function of the injected clock.
 */
export function plant(opts) {
  const { farm, plotIndex, seedId, now, boosts } = opts || {};
  if (!isFarm(farm)) return { ok: false, reason: 'no farm' };
  const idx = Math.floor(Number(plotIndex));
  if (!Number.isInteger(idx) || idx < 0 || idx >= farm.plots.length) return { ok: false, reason: 'bad plot index' };
  if (farm.plots[idx]) return { ok: false, reason: 'plot occupied' };
  const strain = getStrain(seedId);
  if (!strain) return { ok: false, reason: `unknown seed "${seedId}"` };
  const t = asMs(now);
  if (!Number.isFinite(t)) return { ok: false, reason: 'bad clock' };

  const growMsRaw = Math.max(0, growSeconds(strain)) * MS_PER_SEC;
  // growthSpeed boost shortens the grow (clamped to a 90% max speed-up so a plot can never be instant).
  const speedBps = Math.min(9000, boostBps(boosts, 'growthSpeed'));
  const growMs = Math.floor(growMsRaw * (1 - speedBps / 10000));
  const yieldBps = boostBps(boosts, 'yield'); // applied at harvest

  const plot = {
    plotIndex: idx,
    seedId: strain.id,
    symbol: symbolForStrain(strain.id) || strain.id.toUpperCase(),
    name: strain.name,
    rarity: strain.rarity || 'common',
    plantedAt: t,
    growMs,
    readyAt: t + growMs,
    yieldBps,
    boosts: Array.isArray(boosts) ? [...boosts] : [],
    harvested: false,
  };
  farm.plots[idx] = plot;
  return { ok: true, plot };
}

// The growth ladder — five buckets from planting to ripe. Time-based ticks off the crop's grow time.
export const STAGES = ['seedling', 'sprout', 'growing', 'budding', 'ripe'];

/**
 * growthStage({ plot, now }) → { ok, stage, fraction, ripe, remainingMs } | { ok:false, reason }.
 * Deterministic: `fraction` = elapsed / grow-time (0…1), and the stage bucket follows from it.
 */
export function growthStage(opts) {
  const { plot, now } = opts || {};
  if (!plot || !plot.seedId) return { ok: false, reason: 'empty plot' };
  const t = asMs(now);
  if (!Number.isFinite(t)) return { ok: false, reason: 'bad clock' };
  const grow = Math.max(0, Number(plot.growMs) || 0);
  const elapsed = Math.max(0, t - Number(plot.plantedAt));
  const fraction = grow <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / grow));
  const ripe = t >= Number(plot.readyAt);
  // buckets: [0,.25)=seedling [.25,.5)=sprout [.5,.75)=growing [.75,1)=budding [1]=ripe
  let stage;
  if (ripe || fraction >= 1) stage = 'ripe';
  else if (fraction >= 0.75) stage = 'budding';
  else if (fraction >= 0.5) stage = 'growing';
  else if (fraction >= 0.25) stage = 'sprout';
  else stage = 'seedling';
  return { ok: true, stage, fraction, ripe, remainingMs: Math.max(0, Number(plot.readyAt) - t) };
}

/**
 * harvest({ farm, plotIndex, now }) → { ok, item, yield, seedsBack } | { ok:false, reason }.
 * Rejects (soft) an empty or not-yet-ripe plot. Yield = kush-farm.mjs's tier math × equipped yield boosts;
 * seedsBack = the tier's inverse-inflation seed return. Clears the plot (annual — the plot frees for replant).
 * The returned `item` is exactly the shape `sell()` consumes.
 */
export function harvest(opts) {
  const { farm, plotIndex, now, seasonModifierBps = 10000 } = opts || {};
  if (!isFarm(farm)) return { ok: false, reason: 'no farm' };
  const idx = Math.floor(Number(plotIndex));
  if (!Number.isInteger(idx) || idx < 0 || idx >= farm.plots.length) return { ok: false, reason: 'bad plot index' };
  const plot = farm.plots[idx];
  if (!plot || !plot.seedId) return { ok: false, reason: 'empty plot' };
  const t = asMs(now);
  if (!Number.isFinite(t)) return { ok: false, reason: 'bad clock' };
  if (t < Number(plot.readyAt)) {
    return { ok: false, reason: 'not ready', remainingMs: Number(plot.readyAt) - t };
  }

  const h = kushHarvest(plot.seedId, { seasonModifierBps });
  const baseUnits = Number(h.yield); // kush-farm returns a BigInt yield; safe Number for game units
  const units = Math.max(0, Math.round(baseUnits * (1 + (Number(plot.yieldBps) || 0) / 10000)));
  const item = { symbol: plot.symbol, seedId: plot.seedId, name: plot.name, rarity: plot.rarity, units };
  farm.plots[idx] = null; // annual: harvested plot clears and can be replanted
  return { ok: true, item, yield: units, seedsBack: Math.max(0, Number(h.seedsBack) || 0) };
}

/**
 * sell({ items, market }) → { ok, currency, total, lines } | { ok:false, reason }.
 * Prices each harvested item at economy.mjs's rarity-weighted unit price (or an override in `market`,
 * a { SYMBOL: grainPerUnit } map). Returns the Grain total plus a per-line breakdown. Soft-fails to a
 * zero sale on empty/garbage input rather than throwing.
 */
export function sell(opts) {
  const { items, market } = opts || {};
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  const priceMap = market && typeof market === 'object' ? market : {};
  const lines = [];
  let total = 0;
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const units = Math.max(0, Number(it.units) || 0);
    if (units <= 0) continue;
    const sym = String(it.symbol || '').toUpperCase();
    const price = Number(priceMap[sym]) > 0 ? Number(priceMap[sym]) : unitPrice(it.rarity);
    const subtotal = Math.round(units * price);
    total += subtotal;
    lines.push({ symbol: sym || (it.seedId || '').toUpperCase(), units, unitPrice: price, subtotal });
  }
  return { ok: true, currency: CURRENCY, total, lines };
}

// ── injectable per-account store (memory) ──────────────────────────────────────────────────────────
/** createStore() → an isolated in-memory farm store: { farms: Map<account, farm> }. */
export function createStore() {
  return { farms: new Map() };
}
const _default = createStore();

/**
 * openFarm(store, account, size) → the account's farm, creating one on first open. Returns the SAME
 * object reference each call, so plant()/harvest() mutations persist across actions through the store.
 */
export function openFarm(store = _default, account = 'guest', size = DEFAULT_FARM_SIZE) {
  const acct = String(account || 'guest');
  if (!store.farms.has(acct)) store.farms.set(acct, newFarm(size, acct));
  return store.farms.get(acct);
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** renderFarm(farm, now) → an escaped HTML plot grid (each plot shows its crop + growth stage, or "empty"). */
export function renderFarm(farm, now) {
  if (!isFarm(farm)) return '<div class="farm-grid empty">no farm</div>';
  const cells = farm.plots.map((plot, i) => {
    if (!plot) {
      return `<div class="plot empty" data-plot="${i}"><span class="pi">#${i}</span><span class="crop">empty</span></div>`;
    }
    const g = growthStage({ plot, now });
    const stage = g.ok ? g.stage : 'seedling';
    const pct = g.ok ? Math.round(g.fraction * 100) : 0;
    const ripe = g.ok && g.ripe ? ' ripe' : '';
    return `<div class="plot planted${ripe}" data-plot="${i}">`
      + `<span class="pi">#${i}</span>`
      + `<span class="crop">${esc(plot.name)}</span>`
      + `<span class="rarity ${esc(plot.rarity)}">${esc(plot.rarity)}</span>`
      + `<span class="stage">${esc(stage)}</span>`
      + `<span class="pct">${pct}%</span></div>`;
  }).join('');
  return `<div class="farm-grid">${cells}</div>`;
}

/** The shop's plantable seeds (from farm-items.mjs) — what the Farm page offers to plant. */
export function seedShop() {
  return shopCatalog().filter((i) => i.category === 'seed');
}

// ── CLI demo (deterministic clock) ─────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('tribulum.mjs')) {
  const store = createStore();
  const now = Date.UTC(2026, 0, 1);
  const farm = openFarm(store, 'alice', 6);
  console.log('plant:', plant({ farm, plotIndex: 0, seedId: 'auto-sour', now, boosts: ['GOLDHOE'] }));
  const day = 86400 * 1000;
  console.log('stage @ +12h:', growthStage({ plot: farm.plots[0], now: now + day / 2 }));
  const h = harvest({ farm, plotIndex: 0, now: now + day });
  console.log('harvest:', h);
  console.log('sell:', sell({ items: [h.item] }));
}
