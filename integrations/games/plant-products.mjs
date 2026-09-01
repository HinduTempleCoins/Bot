// plant-products.mjs — the farm's MATERIALS → PRODUCTS economy, organized around VERSATILITY.
//
// THE CORRECTION (operator, load-bearing): value in this economy is DEMAND-BREADTH = versatility —
// how many different games/systems can consume a material — NOT "marijuana-ness." Digital marijuana
// is deliberately near-worthless: it has ONE sink (someone smokes it). "Even hay is more versatile."
// Hay / grain / fiber / straw / lumber / feed are the BACKBONE because each feeds MANY domains: the
// RANCH (animals), building, textiles, paper, food, brew, trade. The Kush Farm is a versatile
// farm/ranch producing cross-game inputs; weed is one low-versatility niche crop for flavor.
//
// So a material's value ≈ the number of distinct DOMAINS it serves. That is computed here
// (versatilityOf), and the value table is set by it — flower sits at the bottom, grain/fiber/hay at
// the top. The farm is the PRODUCER; the ranch + the wider game suite are the CONSUMERS (the sink).
//
// Built on recipes.mjs (the recipe graph IS the economy; value-add is paid for by EFFORT/labor, never
// free-minted — validateNoMoneyPump proves it). PURE: no network. Offline-tested.
//
//   import { MATERIALS, DOMAINS, PRODUCTS, RECIPES, MATERIAL_VALUE, versatilityOf, harvestMaterials,
//            craftable, productTree, auditNoPump } from './games/plant-products.mjs'

import { canCraft, craft, validateNoMoneyPump } from './recipes.mjs';

// The economic domains a material/product can serve. Versatility = how many of these it touches.
export const DOMAINS = ['ranch', 'building', 'textile', 'paper', 'food', 'brew', 'energy', 'trade', 'lifestyle', 'wellness'];

// ---------------------------------------------------------------------------
// MATERIALS the farm produces. `domains` = where each is used (its versatility). Note how the
// backbone crops span the whole economy while cannabis flower touches only 'lifestyle'.
// ---------------------------------------------------------------------------
export const MATERIALS = [
  // ── versatile backbone (the real value) ──
  { item: 'grain',  name: 'Grain',   crop: 'cereal', domains: ['ranch', 'food', 'brew', 'trade'] },
  { item: 'fiber',  name: 'Fiber',   crop: 'hemp/flax', domains: ['textile', 'paper', 'building', 'trade'] },
  { item: 'hay',    name: 'Hay',     crop: 'grass',  domains: ['ranch', 'building', 'trade'] },
  { item: 'lumber', name: 'Lumber',  crop: 'tree',   domains: ['building', 'energy', 'trade'] },
  { item: 'seed',   name: 'Seed',    crop: 'any',    domains: ['ranch', 'food', 'trade'] },
  { item: 'straw',  name: 'Straw',   crop: 'cereal-byproduct', domains: ['ranch', 'building'] },
  { item: 'veg',    name: 'Vegetables', crop: 'garden', domains: ['food', 'trade'] },
  // ── low-versatility niche (deliberately cheap: one domain) ──
  { item: 'flower', name: 'Cannabis Flower', crop: 'cannabis', domains: ['lifestyle'] },
  { item: 'trim',   name: 'Cannabis Trim',   crop: 'cannabis', domains: ['wellness'] },
];

const MATERIAL = Object.fromEntries(MATERIALS.map((m) => [m.item, m]));

// External (bought/earned) inputs recipes may also use — cheap, not the value.
export const EXTERNAL_INPUTS = { water: 1, lime: 1, wrap: 1 };

// ---------------------------------------------------------------------------
// PRODUCTS by domain. The heavy, valuable side is ranch/building/textile/food; cannabis is a corner.
// ---------------------------------------------------------------------------
export const PRODUCTS = [
  // ranch (the biggest consumer — animals eat feed forever)
  { item: 'animal_feed', name: 'Animal Feed', domain: 'ranch', note: 'hay + grain → the ranch sink; consumed by every animal, every day' },
  { item: 'bedding',     name: 'Bedding',     domain: 'ranch' },
  // building
  { item: 'plank',       name: 'Plank',       domain: 'building' },
  { item: 'thatch',      name: 'Thatch',      domain: 'building' },
  { item: 'hempcrete',   name: 'Hempcrete Block', domain: 'building' },
  // textile / paper
  { item: 'rope',        name: 'Rope',        domain: 'textile' },
  { item: 'textile',     name: 'Textile',     domain: 'textile' },
  { item: 'sack',        name: 'Sack',        domain: 'textile' },
  { item: 'paper',       name: 'Paper',       domain: 'paper' },
  // food / brew
  { item: 'flour',       name: 'Flour',       domain: 'food' },
  { item: 'bread',       name: 'Bread',       domain: 'food' },
  { item: 'beer',        name: 'Beer',        domain: 'brew' },
  { item: 'seed_oil',    name: 'Seed Oil',    domain: 'food' },
  // cannabis niche (low value; ~one sink: smoke it in Pass a Joint)
  { item: 'preroll',     name: 'Pre-Roll',    domain: 'lifestyle', feeds: 'pass-a-joint' },
  { item: 'tincture',    name: 'Tincture',    domain: 'wellness' },
];

const PRODUCT = Object.fromEntries(PRODUCTS.map((p) => [p.item, p]));

// ---------------------------------------------------------------------------
// versatilityOf — distinct domains an item touches: its OWN domain(s) + the domains of every product
// it is an input to. This is the value driver. flower ≈ 1 (only lifestyle); grain/fiber high.
// ---------------------------------------------------------------------------
export function versatilityOf(item, recipes = RECIPES) {
  const dom = new Set(MATERIAL[item]?.domains || (PRODUCT[item] ? [PRODUCT[item].domain] : []));
  for (const r of recipes) {
    if (r.inputs.some((i) => i.item === item)) {
      const out = PRODUCT[r.output.item];
      if (out) dom.add(out.domain);
    }
  }
  return dom.size;
}

// ---------------------------------------------------------------------------
// RECIPES (recipes.mjs shape). effort covers value-add so no money pump exists. The backbone recipes
// carry real value; the cannabis recipes are cheap.
// ---------------------------------------------------------------------------
export const RECIPES = [
  // ranch
  { id: 'mix-feed',    inputs: [{ item: 'hay', qty: 2 }, { item: 'grain', qty: 1 }], output: { item: 'animal_feed', qty: 1 }, station: 'ranch', effort: 4 },
  { id: 'lay-bedding', inputs: [{ item: 'straw', qty: 3 }], output: { item: 'bedding', qty: 1 }, station: 'ranch', effort: 3 },
  // building
  { id: 'saw-plank',   inputs: [{ item: 'lumber', qty: 2 }], output: { item: 'plank', qty: 1 }, station: 'sawmill', effort: 4 },
  { id: 'bind-thatch', inputs: [{ item: 'straw', qty: 2 }, { item: 'hay', qty: 1 }], output: { item: 'thatch', qty: 1 }, station: 'roofer', effort: 4 },
  { id: 'mix-hempcrete', inputs: [{ item: 'fiber', qty: 2 }, { item: 'lime', qty: 2 }], output: { item: 'hempcrete', qty: 2 }, station: 'mixer', effort: 4 },
  // textile / paper
  { id: 'twist-rope',  inputs: [{ item: 'fiber', qty: 3 }], output: { item: 'rope', qty: 1 }, station: 'ropewalk', effort: 4 },
  { id: 'weave-textile', inputs: [{ item: 'fiber', qty: 5 }], output: { item: 'textile', qty: 1 }, station: 'loom', effort: 6 },
  { id: 'sew-sack',    inputs: [{ item: 'fiber', qty: 2 }], output: { item: 'sack', qty: 1 }, station: 'loom', effort: 3 },
  { id: 'pulp-paper',  inputs: [{ item: 'fiber', qty: 4 }], output: { item: 'paper', qty: 3 }, station: 'mill', effort: 4 },
  // food / brew
  { id: 'mill-flour',  inputs: [{ item: 'grain', qty: 3 }], output: { item: 'flour', qty: 2 }, station: 'mill', effort: 3 },
  { id: 'bake-bread',  inputs: [{ item: 'flour', qty: 2 }, { item: 'water', qty: 1 }], output: { item: 'bread', qty: 2 }, station: 'kitchen', effort: 4 },
  { id: 'brew-beer',   inputs: [{ item: 'grain', qty: 4 }, { item: 'water', qty: 2 }], output: { item: 'beer', qty: 2 }, station: 'brewery', effort: 6 },
  { id: 'press-oil',   inputs: [{ item: 'seed', qty: 5 }], output: { item: 'seed_oil', qty: 1 }, station: 'oil-press', effort: 4 },
  // cannabis niche (cheap: flower is worth ~nothing until rolled, and its only sink is smoking it)
  { id: 'roll-preroll', inputs: [{ item: 'flower', qty: 1 }, { item: 'wrap', qty: 1 }], output: { item: 'preroll', qty: 1 }, station: 'roll-table', effort: 3 },
  { id: 'make-tincture', inputs: [{ item: 'trim', qty: 4 }], output: { item: 'tincture', qty: 1 }, station: 'apothecary', effort: 5 },
];

// ---------------------------------------------------------------------------
// Values — set BY VERSATILITY for materials (value = 2 × distinct domains served, floor 2), then
// products = inputs + effort (the value=labor law). flower/trim land at the bottom.
// ---------------------------------------------------------------------------
export const MATERIAL_VALUE = Object.fromEntries(
  MATERIALS.map((m) => [m.item, Math.max(2, versatilityOf(m.item) * 2)]),
);
// products priced at input+effort (proven below); external inputs cheap.
export const PRODUCT_VALUE = { ...EXTERNAL_INPUTS, ...MATERIAL_VALUE };
for (const r of RECIPES) {
  const inVal = r.inputs.reduce((n, i) => n + (PRODUCT_VALUE[i.item] || 0) * i.qty, 0);
  // per-unit output value = (inputs + effort) / output qty, floored — exactly the value=labor ceiling.
  PRODUCT_VALUE[r.output.item] = Math.max(1, Math.floor((inVal + r.effort) / r.output.qty));
}

// ---------------------------------------------------------------------------
// harvestMaterials — a PLOT's harvest. `crop` picks what it yields; cannabis plots also carry a
// phenotype (plant-genetics) for the niche flower quality, but the ECONOMIC yield is the versatile
// backbone. Returns { materials, quality? }.
// ---------------------------------------------------------------------------
export function harvestMaterials({ crop = 'cereal', phenotype = null, size = 1 } = {}) {
  const s = Math.max(0, Number(size) || 1);
  const q = (n) => Math.max(1, Math.round(n * s));
  let materials;
  switch (crop) {
    case 'cereal': materials = { grain: q(6), straw: q(4), seed: q(2) }; break;
    case 'hemp':   materials = { fiber: q(6), seed: q(2), straw: q(2) }; break;
    case 'grass':  materials = { hay: q(8) }; break;
    case 'tree':   materials = { lumber: q(5), seed: q(1) }; break;
    case 'garden': materials = { veg: q(6), seed: q(2) }; break;
    case 'cannabis': {
      const y = Math.max(0, Number(phenotype?.yield) || 40);
      materials = { flower: q(y / 12), trim: q(y / 16), fiber: q(2), seed: q(1) };
      return { materials, quality: { potency: Number(phenotype?.potency) || 50, aroma: Number(phenotype?.aroma) || 50 } };
    }
    default: materials = { grain: q(4) };
  }
  return { materials };
}

export function craftable(inventory = {}) { return RECIPES.filter((r) => canCraft(r, inventory)); }

// productTree — grouped by domain + a versatility ranking so the value story is visible.
export function productTree() {
  const byDomain = {};
  for (const p of PRODUCTS) (byDomain[p.domain] ||= []).push(p.item);
  const ranking = MATERIALS.map((m) => ({ item: m.item, versatility: versatilityOf(m.item), value: MATERIAL_VALUE[m.item] }))
    .sort((a, b) => b.versatility - a.versatility);
  return { domains: byDomain, versatilityRanking: ranking };
}

export function auditNoPump() { return validateNoMoneyPump(RECIPES, PRODUCT_VALUE); }

export { canCraft, craft } from './recipes.mjs';

if (process.argv[1] && process.argv[1].endsWith('plant-products.mjs')) {
  console.log('no-money-pump audit:', auditNoPump().ok ? 'PASS' : 'FAIL');
  console.log('\nversatility ranking (value follows versatility — flower is LAST):');
  for (const r of productTree().versatilityRanking) console.log(`  ${r.item.padEnd(8)} domains=${r.versatility}  value=${r.value}`);
  console.log('\nflower vs hay:', { flower: MATERIAL_VALUE.flower, hay: MATERIAL_VALUE.hay, grain: MATERIAL_VALUE.grain, fiber: MATERIAL_VALUE.fiber });
  console.log('cereal harvest:', harvestMaterials({ crop: 'cereal' }).materials);
  console.log('cannabis harvest:', harvestMaterials({ crop: 'cannabis', phenotype: { yield: 78, potency: 72, aroma: 66 } }));
}
