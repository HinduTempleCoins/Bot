// material-demand.mjs — the cross-game DEMAND mesh that gives farm materials their value.
//
// A material is worth something because MANY games consume it (versatility). This registry is where
// games declare what they take and how, so versatility is MEASURED from real demand — not guessed:
//   • craft-random  — a Mushroom-Warrior-style game: throw in random plant materials → a random item
//                     (more/rarer inputs → better odds). Fighting/crafting games.
//   • potion        — an alchemist game turns herbs/veg/seed into potions.
//   • territory     — a castle/territory map game PRODUCES wood/food/iron; farm materials feed that
//                     economy (lumber→wood, grain→food), AND an NFT can be slotted as a BOOST CARD
//                     (+% resource production for a while).
//   • consumable    — a straight sink (e.g., a pre-roll smoked in Pass a Joint).
//
// versatility(material) = the number of DISTINCT GAMES that consume it. That is the true value driver
// the operator described ("even hay is more versatile than marijuana"): a bulk cannabis flower has ~1
// game demanding it; grain/fiber feed the ranch, the alchemist, the territory game, the crafter…
// And a RARE STRAIN NFT — worthless as bulk flower — becomes valuable as a one-off boost card.
//
// PURE + deterministic (rng injected; use an L1-derived seed on-chain). Offline-tested.
//
//   import { registerDemand, demandsForMaterial, gamesForMaterial, versatility, randomCraft,
//            registerBoostCard, boostFor, applyBoost, registerBuiltIns } from './games/material-demand.mjs'

export const DEMAND_KINDS = ['craft-random', 'potion', 'territory', 'consumable', 'boost-card'];

const DEMANDS = new Map();   // id -> demand
const BOOST_CARDS = new Map(); // cardId -> { stat, pct, blocks, game }

function seededRng(seed = 1) { // mulberry32, deterministic (never Math.random on-chain)
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Register a game's demand for materials. demand = { id, game, kind, materials:[items], note?, produces? } */
export function registerDemand(demand) {
  if (!demand?.id || !demand.game) throw new Error('demand needs id + game');
  if (!DEMAND_KINDS.includes(demand.kind)) throw new Error(`bad demand kind ${demand.kind}`);
  if (!Array.isArray(demand.materials) || demand.materials.length === 0) throw new Error('demand needs materials');
  DEMANDS.set(demand.id, { note: '', produces: null, ...demand });
  return demand.id;
}

export const demandsForMaterial = (item) => [...DEMANDS.values()].filter((d) => d.materials.includes(item));
export const gamesForMaterial = (item) => [...new Set(demandsForMaterial(item).map((d) => d.game))];

/** versatility = how many distinct GAMES consume this material. The value driver. */
export function versatility(item) { return gamesForMaterial(item).length; }

// ---------------------------------------------------------------------------
// craft-random (Mushroom Warrior): consume input materials → a random item. More inputs and rarer
// inputs tilt toward a better roll. Deterministic given a seed (L1 blockId+txId on-chain).
// ---------------------------------------------------------------------------
export const CRAFT_RARITY = [
  { tier: 'common', weight: 60 }, { tier: 'uncommon', weight: 25 },
  { tier: 'rare', weight: 10 }, { tier: 'epic', weight: 4 }, { tier: 'legendary', weight: 1 },
];
export function randomCraft({ inputs = {}, seed = 1, quality = 0 } = {}) {
  const count = Object.values(inputs).reduce((n, q) => n + (Number(q) || 0), 0);
  if (count <= 0) return { ok: false, reason: 'no-inputs' };
  const rng = seededRng(seed);
  // luck rises with how much/what you throw in (versatility in action) — shift weight toward rarer.
  const luck = Math.min(40, count + Math.max(0, Number(quality) || 0) / 5);
  const table = CRAFT_RARITY.map((r, i) => ({ ...r, weight: r.weight + (i >= 2 ? luck : -luck / 3) }))
    .map((r) => ({ ...r, weight: Math.max(0.1, r.weight) }));
  const total = table.reduce((n, r) => n + r.weight, 0);
  let roll = rng() * total;
  let tier = table[0].tier;
  for (const r of table) { if (roll < r.weight) { tier = r.tier; break; } roll -= r.weight; }
  const itemRoll = Math.floor(rng() * 1000);
  return { ok: true, item: `item-${tier}-${itemRoll}`, rarity: tier, consumed: { ...inputs } };
}

// ---------------------------------------------------------------------------
// boost-card: register an NFT (e.g., a rare strain) as a consumable boost in a territory game. Even a
// low-versatility item gains value this way. boostFor/applyBoost read the effect.
// ---------------------------------------------------------------------------
export function registerBoostCard(cardId, { stat = 'wood', pct = 10, blocks = 300, game = 'ironhold' } = {}) {
  if (!cardId) throw new Error('boost card needs an id');
  BOOST_CARDS.set(cardId, { stat, pct, blocks, game });
  return cardId;
}
export const boostFor = (cardId) => BOOST_CARDS.get(cardId) || null;
/** Apply a boost card to a base production rate → boosted rate (for `blocks` blocks). */
export function applyBoost(baseRate, cardId) {
  const b = boostFor(cardId);
  if (!b) return { rate: baseRate, boosted: false };
  return { rate: baseRate * (1 + b.pct / 100), boosted: true, stat: b.stat, forBlocks: b.blocks };
}

// ---------------------------------------------------------------------------
// Built-in demand registrations — the diverse portfolio that makes farm materials versatile.
// ---------------------------------------------------------------------------
export function registerBuiltIns() {
  DEMANDS.clear(); BOOST_CARDS.clear();
  // Mushroom Warrior — random crafting from the USEFUL plant materials (you don't forge gear from weed).
  registerDemand({ id: 'mw-craft', game: 'mushroom-warrior', kind: 'craft-random',
    materials: ['grain', 'fiber', 'hay', 'seed', 'veg', 'lumber', 'straw'],
    note: 'throw in plant materials → a random gear/item; more & rarer inputs → better roll' });
  // Alchemist — potions from herbs/veg/seed/trim (not premium flower).
  registerDemand({ id: 'alch-potion', game: 'alchemist', kind: 'potion',
    materials: ['veg', 'seed', 'trim'], produces: 'potion', note: 'herbs → potions' });
  // Ironhold — territory/castle map producing wood/food/iron; farm feeds it + accepts boost cards.
  registerDemand({ id: 'iron-wood', game: 'ironhold', kind: 'territory', materials: ['lumber', 'hay', 'fiber'], produces: 'wood' });
  registerDemand({ id: 'iron-food', game: 'ironhold', kind: 'territory', materials: ['grain', 'veg'], produces: 'food' });
  registerDemand({ id: 'iron-boost', game: 'ironhold', kind: 'boost-card', materials: ['strain-nft'],
    note: 'a rare strain NFT slots as a +% production boost card' });
  // Ranch — animal feed (the everyday sink).
  registerDemand({ id: 'ranch-feed', game: 'ranch', kind: 'consumable', materials: ['hay', 'grain', 'straw'], produces: 'animal-growth' });
  // Pass a Joint — the ONE sink for bulk flower (why it's low-value).
  registerDemand({ id: 'joint-smoke', game: 'pass-a-joint', kind: 'consumable', materials: ['preroll', 'flower'], produces: 'vibes' });
  return DEMANDS.size;
}
registerBuiltIns();

if (process.argv[1] && process.argv[1].endsWith('material-demand.mjs')) {
  console.log('versatility by real cross-game demand (games that consume each):');
  for (const m of ['grain', 'fiber', 'hay', 'lumber', 'seed', 'veg', 'straw', 'flower', 'trim']) {
    console.log(`  ${m.padEnd(8)} v=${versatility(m)}  games=[${gamesForMaterial(m).join(', ')}]`);
  }
  console.log('\nMushroom-Warrior craft from a fat bag:', randomCraft({ inputs: { grain: 3, fiber: 2, seed: 4 }, seed: 42, quality: 60 }));
  registerBoostCard('strain-legendary-001', { stat: 'iron', pct: 25, blocks: 600 });
  console.log('legendary strain NFT as a boost card → +25% iron:', applyBoost(100, 'strain-legendary-001'));
}
