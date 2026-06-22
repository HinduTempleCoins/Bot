// farm-items.mjs — the in-game SEED SHOP catalog. The shop sells three categories, all minted by US
// (minter-gated, in-game — never an open public mint; see engine/contracts/seeds.mjs + shop.mjs):
//   • seeds       — the Kush Farm strains (from seed-tokens.mjs), priced by scarcity.
//   • tools       — durable NFTs that BOOST grows (watering can, greenhouse, golden hoe…).
//   • consumables — fungible Compost / Fertilizer, applied for a one-time grow boost (the compost sink's
//                   output becomes a buyable boost — closing the loop).
//
// Each item declares its engine asset kind (token = fungible, nft = durable/collectable), a boost effect,
// a shop price (in the shop currency), and rarity. Minting SOURCE is flexible (operator: "we might make them
// in another game, or elsewhere on the Farm/Ranch") — this catalog names WHAT the shop sells; where each is
// minted is a stocking decision. House style: ESM, pure, soft-fail, env-overridable.

import { seedCatalog } from './seed-tokens.mjs';

// boost.effect ∈ growthSpeed | yield | seasonExtend | seedReturn | producesFertilizer ; bps = basis points.
// Tools are NFTs (durable — you keep the tool); their boost applies while equipped/used.
const TOOLS = [
  { id: 'watering-can', symbol: 'WATERCAN', name: 'Watering Can', rarity: 'common', boost: { effect: 'growthSpeed', bps: 1000 }, price: '50',
    blurb: 'Water a plot to speed its grow (+10%).' },
  { id: 'compost-bin', symbol: 'COMPOSTBIN', name: 'Compost Bin', rarity: 'uncommon', boost: { effect: 'producesFertilizer', bps: 2000 }, price: '250',
    blurb: 'Turns composted plant matter into Fertilizer over time (the sink → boost loop).' },
  { id: 'greenhouse', symbol: 'GREENHOUSE', name: 'Greenhouse', rarity: 'rare', boost: { effect: 'seasonExtend', bps: 0 }, price: '1500',
    blurb: 'Grow some season-gated strains out of their season.' },
  { id: 'golden-hoe', symbol: 'GOLDHOE', name: 'Golden Hoe', rarity: 'legendary', boost: { effect: 'yield', bps: 2500 }, price: '8000',
    blurb: 'A prestige tool — +25% harvest yield.' },
];

// Consumables are fungible tokens (spent on use); Compost is the sink's output, Fertilizer the refined boost.
const CONSUMABLES = [
  { id: 'compost', symbol: 'COMPOST', name: 'Compost', rarity: 'common', boost: { effect: 'yield', bps: 500 }, price: '5',
    blurb: 'Spread on a plot for a small yield bump (+5%). Made by composting plant matter.' },
  { id: 'fertilizer', symbol: 'FERTILIZER', name: 'Fertilizer', rarity: 'uncommon', boost: { effect: 'growthSpeed', bps: 1500 }, price: '15',
    blurb: 'Refined compost — a stronger one-time grow-speed boost (+15%).' },
];

const PRICE_BY_RARITY = { common: '2', uncommon: '8', rare: '50', legendary: '500' };
/** Seeds are sold by scarcity — the market is primary, the shop is the (currency-sink) fallback for rares. */
export function priceForSeed(seed) { return PRICE_BY_RARITY[seed.rarity] || '5'; }

const norm = (it, category, kind) => ({
  id: it.id, symbol: it.symbol, name: it.name, category, kind,
  rarity: it.rarity || 'common', boost: it.boost || null, price: String(it.price),
  blurb: it.blurb || '',
});

/** The full shop catalog: seeds + tools + consumables, each priced + tagged with its engine kind. */
export function shopCatalog() {
  const seeds = seedCatalog().map((s) => ({
    id: s.id, symbol: s.symbol, name: s.name, category: 'seed', kind: s.kind,
    rarity: s.rarity, boost: null, price: priceForSeed(s), blurb: '',
    growTier: s.growTier, tierLabel: s.tierLabel, season: s.season,
    multiHarvest: s.multiHarvest, volunteer: s.volunteer, flower: s.flower, festival: s.festival,
  }));
  const tools = TOOLS.map((t) => norm(t, 'tool', 'nft'));            // tools are durable NFTs
  const consumables = CONSUMABLES.map((c) => norm(c, 'consumable', 'token')); // compost/fertilizer are fungible
  return [...seeds, ...tools, ...consumables];
}

/** Just the non-seed items the shop also mints (tools + consumables) — the "Boosts" half. */
export function boostItems() { return shopCatalog().filter((i) => i.category !== 'seed'); }

export function itemForSymbol(symbol) {
  const want = String(symbol || '').toUpperCase();
  return shopCatalog().find((i) => i.symbol === want) || null;
}
export function isShopItem(symbol) { return !!itemForSymbol(symbol); }

/** Group the catalog for display: { seed:[…], tool:[…], consumable:[…] }. */
export function byCategory() {
  const out = { seed: [], tool: [], consumable: [] };
  for (const i of shopCatalog()) (out[i.category] || (out[i.category] = [])).push(i);
  return out;
}
