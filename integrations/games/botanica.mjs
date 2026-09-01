// botanica.mjs — Botanica: the in-game apothecary/bazaar, and the digital twin of the real company.
//
// Three things at once (operator, 2026-09-01):
//   1. A LOCATION/BRAND in the farm game — the Botanica: roastery + tea bench + distillation &
//      perfumery lab + apothecary. Built from the broad plant catalog (plant-catalog.mjs), NOT a weed shop.
//   2. The bootstrap for the REAL company (Botanica Coffee Co. — see .local business plan): the game
//      version proves the brand/lines and funnels toward the real botanical business.
//   3. A "black-market-but-not" BAZAAR: a mystical-curiosities market for FUNCTIONAL ITEMS —
//      talismans, charms, potions, elixirs, oils — that DO THINGS (buffs) in the farm game and OTHER
//      games (grow speed, yield, breed luck, craft luck, territory boosts, vibes). Legit, not illicit:
//      game items with game effects; no real-world medical claims. Cannabis (Delta) is one low-value
//      apothecary corner (carts/dabs to gift a friend).
//
// Functional items are TERMINAL sinks (equip a talisman / drink a potion → the materials leave
// circulation) — deflation by design. Built on recipes.mjs value=labor law + plant-catalog values.
// PURE, deterministic, offline-tested.
//
//   import { ITEMS, ITEM_TYPES, EFFECT_STATS, craftItem, canCraftItem, applyEffect, isGiftable,
//            bazaar, auditNoPump } from './games/botanica.mjs'

import { valueOf } from './plant-catalog.mjs';
import { canCraft, craft, validateNoMoneyPump } from './recipes.mjs';

export const ITEM_TYPES = ['talisman', 'charm', 'potion', 'elixir', 'oil', 'cart', 'dab', 'colloid'];
// stats the items buff — each maps to a real game system (this is the cross-game versatility).
export const EFFECT_STATS = {
  'grow-speed': 'kush-farm / plant grow time',
  'yield': 'harvest yield',
  'breed-luck': 'plant-genetics fire/mutation odds',
  'craft-luck': 'material-demand randomCraft (Mushroom Warrior) quality',
  'territory': 'territory game (Ironhold) resource production',
  'vibes': 'Pass a Joint social score',
  'wellness': 'player wellness/energy (Prana)',
};
// persistent = equip (stays until unequipped); consumable = one-shot (optional block duration).
const EXTERNAL = { silver: 3, water: 1, wrap: 1 };

// ---------------------------------------------------------------------------
// The Botanica item catalog. recipe inputs are plant-catalog materials; effect is the cross-game buff.
// flavor references the REAL Botanica lines (imphepho, kava, coffee, attar, colloidal silver…).
// ---------------------------------------------------------------------------
export const ITEMS = [
  { id: 'talisman_verdant', name: 'Verdant Ward', type: 'talisman', rarity: 'rare',
    recipe: [{ item: 'essential_oil', qty: 1 }, { item: 'resin', qty: 1 }], effort: 6,
    effect: { stat: 'grow-speed', pct: 12, kind: 'persistent' }, flavor: 'Imphepho-oil ward; hangs over the plot, hastening every grow.' },
  { id: 'talisman_abundance', name: 'Abundance Charm', type: 'talisman', rarity: 'rare',
    recipe: [{ item: 'oil', qty: 2 }, { item: 'grain', qty: 1 }], effort: 6,
    effect: { stat: 'yield', pct: 12, kind: 'persistent' }, flavor: 'Pressed-oil talisman; fatter harvests.' },
  { id: 'charm_fortune', name: 'Fortune Charm', type: 'charm', rarity: 'uncommon',
    recipe: [{ item: 'dye', qty: 1 }, { item: 'flower', qty: 1 }], effort: 3,
    effect: { stat: 'craft-luck', pct: 8, kind: 'persistent' }, flavor: 'A dyed bloom-charm — better rolls at the crafting bench.' },
  { id: 'elixir_vigor', name: 'Vigor Elixir', type: 'elixir', rarity: 'rare',
    recipe: [{ item: 'herb', qty: 2 }, { item: 'beverage_bean', qty: 1 }], effort: 6,
    effect: { stat: 'breed-luck', pct: 15, kind: 'consumable' }, flavor: 'Adaptogen elixir (kava/mucuna) — a better shot at a "fire" strain.' },
  { id: 'potion_haste', name: 'Haste Potion', type: 'potion', rarity: 'common',
    recipe: [{ item: 'beverage_bean', qty: 1 }, { item: 'sugar', qty: 1 }], effort: 3,
    effect: { stat: 'grow-speed', pct: 25, kind: 'consumable', blocks: 300 }, flavor: 'Cold-brew shot — a burst of grow speed.' },
  { id: 'tonic_calm', name: 'Calm Tonic', type: 'oil', rarity: 'common',
    recipe: [{ item: 'herb', qty: 1 }, { item: 'essential_oil', qty: 1 }], effort: 3,
    effect: { stat: 'wellness', pct: 10, kind: 'consumable' }, flavor: 'Chamomile + lavender hydrosol.' },
  { id: 'oil_ward', name: 'Warding Oil', type: 'oil', rarity: 'epic',
    recipe: [{ item: 'essential_oil', qty: 1 }, { item: 'resin', qty: 1 }, { item: 'water', qty: 1 }], effort: 8,
    effect: { stat: 'territory', pct: 20, kind: 'consumable', blocks: 600 }, flavor: 'Sandalwood + frankincense — a boost card in the castle game.' },
  // cannabis niche — lifestyle gifts, low value
  { id: 'cart', name: 'Vape Cart', type: 'cart', rarity: 'common',
    recipe: [{ item: 'cannabis_flower', qty: 1 }, { item: 'oil', qty: 1 }], effort: 3,
    effect: { stat: 'vibes', pct: 5, kind: 'consumable' }, giftable: true, flavor: 'Delta cart — pass one to a friend.' },
  { id: 'dab', name: 'Dab', type: 'dab', rarity: 'uncommon',
    recipe: [{ item: 'cannabis_flower', qty: 2 }], effort: 4,
    effect: { stat: 'vibes', pct: 8, kind: 'consumable' }, giftable: true, flavor: 'A concentrate dab — a stronger share.' },
  { id: 'colloid_silver', name: 'Silver Colloid', type: 'colloid', rarity: 'uncommon',
    recipe: [{ item: 'silver', qty: 1 }, { item: 'water', qty: 1 }], effort: 4,
    effect: { stat: 'wellness', pct: 8, kind: 'consumable' }, flavor: 'A curiosity from the apothecary shelf.' },
];
const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// value table (materials from plant-catalog + external), items priced input+effort (value=labor).
const VALUES = { ...EXTERNAL };
for (const m of ['grain', 'oil', 'fiber', 'dye', 'resin', 'essential_oil', 'herb', 'beverage_bean',
  'flower', 'spice', 'sugar', 'cannabis_flower', 'timber', 'gum', 'tannin', 'wax', 'mushroom']) VALUES[m] = valueOf(m);
export const ITEM_VALUE = { ...VALUES };
// recipes.mjs Recipe shape for the audit + crafting.
export const ITEM_RECIPES = ITEMS.map((i) => ({ id: i.id, inputs: i.recipe, output: { item: i.id, qty: 1 }, station: 'botanica', effort: i.effort }));
for (const r of ITEM_RECIPES) {
  const inVal = r.inputs.reduce((n, i) => n + (VALUES[i.item] || 2) * i.qty, 0);
  ITEM_VALUE[r.output.item] = Math.max(1, Math.floor(inVal + r.effort));
}

// ---------------------------------------------------------------------------
// Craft / effects / market
// ---------------------------------------------------------------------------
export function canCraftItem(itemId, inventory = {}) {
  const r = ITEM_RECIPES.find((x) => x.id === itemId);
  return !!r && canCraft(r, inventory);
}
export function craftItem(itemId, inventory = {}) {
  const r = ITEM_RECIPES.find((x) => x.id === itemId);
  if (!r) throw new Error(`unknown Botanica item: ${itemId}`);
  return craft(r, inventory); // consumes materials (terminal sink), mints the item
}

/** applyEffect — buff a base game stat with an item's effect. Returns the modified value + meta. */
export function applyEffect(baseValue, itemId) {
  const it = ITEM[itemId];
  if (!it) return { value: baseValue, applied: false };
  const e = it.effect;
  return { value: baseValue * (1 + e.pct / 100), applied: true, stat: e.stat, kind: e.kind, blocks: e.blocks || null };
}

export const isGiftable = (itemId) => !!ITEM[itemId]?.giftable;

/** The bazaar listing — the "black-market-but-not" shelf, grouped by type, with effect + price. */
export function bazaar() {
  return ITEMS.map((i) => ({
    id: i.id, name: i.name, type: i.type, rarity: i.rarity,
    effect: `${i.effect.pct > 0 ? '+' : ''}${i.effect.pct}% ${i.effect.stat} (${i.effect.kind})`,
    system: EFFECT_STATS[i.effect.stat], price: ITEM_VALUE[i.id], giftable: !!i.giftable, flavor: i.flavor,
  }));
}

/** Prove the item recipes obey value=labor (no money pump). Items are terminal sinks anyway. */
export function auditNoPump() { return validateNoMoneyPump(ITEM_RECIPES, ITEM_VALUE); }

if (process.argv[1] && process.argv[1].endsWith('botanica.mjs')) {
  console.log('no-money-pump audit:', auditNoPump().ok ? 'PASS' : 'FAIL');
  console.log('\nBOTANICA BAZAAR — functional items and what they DO:');
  for (const b of bazaar()) console.log(`  ${b.name.padEnd(16)} [${b.type}/${b.rarity}] ${b.effect.padEnd(28)} → ${b.system}  (₭${b.price})${b.giftable ? ' 🎁' : ''}`);
  console.log('\nequip Verdant Ward on a 100-block grow:', applyEffect(100, 'talisman_verdant'));
}
