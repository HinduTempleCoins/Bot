// aquatic-farm.mjs — the Underwater Farm area, and where ANIMALS first show up (aquaculture).
//
// A themed biome (like the RS3 Dinosaur-Island crossing model in the design docs): the surface farm
// grows plants; the UNDERWATER area introduces the animal/ranch layer through aquaculture — fish,
// shrimp, oysters, crabs, clams — plus aquatic plants (kelp, algae, rice paddy, lotus, mangrove).
//
// The animal lifecycle is the ranch spine the roadmap specced: STOCK → FEED (animals eat the versatile
// backbone — algae / animal-feed — so grain/hay/algae stay in demand) → AGE (juvenile → adult/breedable
// → elder/declining) → HARVEST (fish protein/oil, oyster PEARLS = the scarce prize) → BREED (deterministic
// genetics + a cooldown valve). Pearls are the versatile premium output (decor/perfume/craft/trade) — the
// underwater area's "gold," and a Botanica perfumery/jewelry input.
//
// PURE + deterministic (nowBlock + L1-derived rng injected; never Math.random/clock). Offline-tested.
//
//   import { AREA, AQUATIC_PLANTS, AQUATIC_ANIMALS, AQUATIC_MATERIALS, materialValue, stockAnimal,
//            animalState, feedAnimal, harvestAnimal, canBreedAnimals, breedAnimals } from './games/aquatic-farm.mjs'

import { rngFromCtx } from './plant-genetics.mjs';

export const AREA = {
  id: 'underwater', name: 'Underwater Farm', biome: 'aquatic',
  unlock: 'reached after the surface farm (plot/level gate)',
  intro: 'the area where animals first show up — aquaculture starts the ranch layer',
};

// Aquatic materials (animal + a few plant outputs) with domains → versatility → value.
export const AQUATIC_MATERIALS = [
  { item: 'pearl',        name: 'Pearl',        domains: ['decor', 'perfume', 'craft', 'trade'] },  // the prize
  { item: 'fish_protein', name: 'Fish Protein', domains: ['food', 'ranch', 'trade'] },
  { item: 'roe',          name: 'Roe',          domains: ['food', 'trade'] },
  { item: 'shell',        name: 'Shell',        domains: ['craft', 'decor', 'building'] },
  { item: 'iodine',       name: 'Iodine',       domains: ['medicine', 'trade'] },
];
const AMAT = Object.fromEntries(AQUATIC_MATERIALS.map((m) => [m.item, m]));
export const materialValue = (item) => Math.max(2, (AMAT[item]?.domains.length || 1) * 2);

// Aquatic plants → materials (reusing the plant-catalog material ids where they fit).
export const AQUATIC_PLANTS = [
  { id: 'kelp', name: 'Kelp', yields: ['fiber', 'iodine'] },
  { id: 'algae', name: 'Algae', yields: ['oil'] },           // also the base animal feed
  { id: 'rice_paddy', name: 'Rice Paddy', yields: ['grain', 'straw'] },
  { id: 'lotus', name: 'Lotus', yields: ['flower', 'vegetable'] },
  { id: 'watercress', name: 'Watercress', yields: ['vegetable'] },
  { id: 'seagrass', name: 'Seagrass', yields: ['fiber'] },
  { id: 'mangrove', name: 'Mangrove', yields: ['timber'] },
];

// Aquatic animals. matureBlocks → becomes an adult (breedable, best harvest); primeBlocks after that →
// then it declines (elder). feed = what it eats (the ranch sink). pearlChance = per-harvest drop odds.
export const AQUATIC_ANIMALS = [
  { id: 'fish',   name: 'Fish',   yields: ['fish_protein', 'oil'], feed: ['algae', 'animal_feed'], matureBlocks: 400, primeBlocks: 1600, pearlChance: 0 },
  { id: 'shrimp', name: 'Shrimp', yields: ['fish_protein'],        feed: ['algae'],                matureBlocks: 200, primeBlocks: 800,  pearlChance: 0 },
  { id: 'crab',   name: 'Crab',   yields: ['fish_protein', 'shell'], feed: ['algae'],              matureBlocks: 600, primeBlocks: 2400, pearlChance: 0 },
  { id: 'oyster', name: 'Oyster', yields: ['shell'],               feed: ['algae'],                matureBlocks: 1200, primeBlocks: 4000, pearlChance: 0.25 },
  { id: 'clam',   name: 'Clam',   yields: ['shell'],               feed: ['algae'],                matureBlocks: 900,  primeBlocks: 3600, pearlChance: 0.15 },
];
const ANIMAL = Object.fromEntries(AQUATIC_ANIMALS.map((a) => [a.id, a]));

const BREED_COOLDOWN_BLOCKS = 500;
const MAX_ANIMAL_BREEDS = 6;

// ---------------------------------------------------------------------------
// stockAnimal — add an animal to the pond at a block. `traits` are its heritable stats (bred lines).
// ---------------------------------------------------------------------------
export function stockAnimal({ species, stockedAtBlock = 0, id, traits } = {}) {
  const spec = ANIMAL[species];
  if (!spec) throw new Error(`unknown aquatic animal: ${species}`);
  return {
    species, name: spec.name, id, stockedAtBlock: Number(stockedAtBlock) || 0,
    traits: traits || { size: 50, hardiness: 50, fertility: 50 },
    generation: 0, breedCount: 0, readyBlock: 0, fed: false,
  };
}

/** animalState — 'juvenile' | 'adult' | 'elder' from age (nowBlock - stockedAtBlock). */
export function animalState(animal, nowBlock = 0) {
  const spec = ANIMAL[animal.species];
  const age = Math.max(0, Number(nowBlock) - (animal.stockedAtBlock || 0));
  if (age < spec.matureBlocks) return 'juvenile';
  if (age < spec.matureBlocks + spec.primeBlocks) return 'adult';
  return 'elder';
}

/** feedAnimal — consume one feed unit (the ranch sink). Returns {ok, animal, consumed} or a reason. */
export function feedAnimal(animal, inventory = {}) {
  const spec = ANIMAL[animal.species];
  const feed = spec.feed.find((f) => (inventory[f] || 0) > 0);
  if (!feed) return { ok: false, reason: 'no-feed', needs: spec.feed };
  const inv = { ...inventory }; inv[feed] -= 1; if (inv[feed] <= 0) delete inv[feed];
  return { ok: true, animal: { ...animal, fed: true }, inventory: inv, consumed: feed };
}

/**
 * harvestAnimal — yields materials if adult (best), reduced if elder, nothing if juvenile. Oysters/clams
 * roll a PEARL on their pearlChance (deterministic from L1 ctx). Must be fed to harvest.
 */
export function harvestAnimal(animal, { nowBlock = 0, ctx = {} } = {}) {
  const spec = ANIMAL[animal.species];
  const phase = animalState(animal, nowBlock);
  if (phase === 'juvenile') return { ok: false, reason: 'too-young', phase };
  if (!animal.fed) return { ok: false, reason: 'unfed', phase };
  const mult = phase === 'adult' ? 1 : 0.5; // elders decline
  const out = {};
  for (const y of spec.yields) out[y] = Math.max(1, Math.round((1 + (animal.traits?.size || 50) / 50) * mult));
  if (spec.pearlChance > 0) {
    const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: animal.id ?? animal.species, fatherId: 'harvest' });
    if (rng() < spec.pearlChance * (phase === 'adult' ? 1 : 0.5)) out.pearl = (out.pearl || 0) + 1;
  }
  return { ok: true, phase, yields: out, animal: { ...animal, fed: false } };
}

// ---------------------------------------------------------------------------
// Breeding — the ranch valve: both parents adult, off cooldown, under the breed cap. Deterministic.
// ---------------------------------------------------------------------------
export function canBreedAnimals(a, b, { nowBlock = 0 } = {}) {
  const reasons = [];
  if (!a || !b) return { ok: false, reasons: ['missing-animal'] };
  if (a === b || (a.id != null && a.id === b.id)) reasons.push('self-breed');
  if (a.species !== b.species) reasons.push('species-mismatch');
  if (animalState(a, nowBlock) !== 'adult') reasons.push('a-not-adult');
  if (animalState(b, nowBlock) !== 'adult') reasons.push('b-not-adult');
  if (nowBlock < (a.readyBlock || 0) || nowBlock < (b.readyBlock || 0)) reasons.push('cooldown');
  if ((a.breedCount || 0) >= MAX_ANIMAL_BREEDS || (b.breedCount || 0) >= MAX_ANIMAL_BREEDS) reasons.push('breed-cap');
  return { ok: reasons.length === 0, reasons };
}

export function breedAnimals(a, b, { nowBlock = 0, ctx = {} } = {}) {
  const gate = canBreedAnimals(a, b, { nowBlock });
  if (!gate.ok) return { ok: false, reasons: gate.reasons };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: a.id ?? a.species, fatherId: b.id ?? b.species });
  const mix = (k) => {
    const from = rng() < 0.5 ? a.traits[k] : b.traits[k];
    const drift = rng() < 0.2 ? (rng() < 0.6 ? 1 : -1) * (1 + Math.floor(rng() * 6)) : 0;
    return Math.max(0, Math.min(100, from + drift));
  };
  const offspring = stockAnimal({ species: a.species, stockedAtBlock: nowBlock });
  offspring.traits = { size: mix('size'), hardiness: mix('hardiness'), fertility: mix('fertility') };
  offspring.generation = Math.max(a.generation || 0, b.generation || 0) + 1;
  const advance = (x) => ({ ...x, breedCount: (x.breedCount || 0) + 1, readyBlock: nowBlock + BREED_COOLDOWN_BLOCKS });
  return { ok: true, offspring, motherAfter: advance(a), fatherAfter: advance(b) };
}

if (process.argv[1] && process.argv[1].endsWith('aquatic-farm.mjs')) {
  console.log('AREA:', AREA.name, '—', AREA.intro);
  console.log('aquatic plants:', AQUATIC_PLANTS.map((p) => p.id).join(', '));
  console.log('animals:', AQUATIC_ANIMALS.map((a) => a.id).join(', '));
  console.log('pearl value (versatile prize):', materialValue('pearl'), 'vs roe', materialValue('roe'));
  let oyster = stockAnimal({ species: 'oyster', stockedAtBlock: 0, id: 'o1' });
  console.log('oyster @600 blocks:', animalState(oyster, 600), '(juvenile)');
  console.log('oyster @1500 blocks:', animalState(oyster, 1500), '(adult)');
  const fed = feedAnimal(oyster, { algae: 3 }); oyster = fed.animal;
  console.log('harvest adult oyster:', harvestAnimal(oyster, { nowBlock: 1500, ctx: { blockId: '0xabc', txId: '0x7' } }));
}
