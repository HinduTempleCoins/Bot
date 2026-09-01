// plant-catalog.mjs — the BROAD plant catalog. The farm game grows ALL KINDS of plants, not weed.
//
// CORRECTION (operator, load-bearing): this is NOT PotFarm. Digital marijuana has little value — it is
// ONE low-value fiber/medicinal plant among dozens. The value of the farm economy is the BREADTH of
// materials real plants yield: fiber, oils, dyes, resins, latex, gums, tannins, waxes, spices,
// beverages, medicines, timber, food. Grounded in economic botany (cotton/flax/jute/sisal fibers;
// palm/coconut/castor/sesame oils; indigo/madder/woad dyes; pine/gum-arabic/rubber resins & latex;
// oak/wattle tannins; jojoba/carnauba waxes; pepper/turmeric spices; tea/coffee/cocoa; timber).
//
// value ≈ VERSATILITY = how many economic DOMAINS a material serves. Fiber, oil, grain, timber, dye
// serve many; cannabis flower serves one (lifestyle) → it sits at the bottom, by design.
//
// This is the SOURCE OF TRUTH for plants. plant-genetics (breeding), plant-products (crafting) and
// material-demand (cross-game sinks) apply to ANY plant here, not just cannabis. PURE, offline-tested.
//
//   import { PLANTS, MATERIALS, CATEGORIES, DOMAINS, plantsByCategory, materialsForPlant,
//            plantsForMaterial, versatilityOf, valueOf } from './games/plant-catalog.mjs'

export const CATEGORIES = [
  'cereal', 'legume', 'vegetable', 'fruit', 'tuber', 'fiber', 'oilseed', 'dye', 'resin', 'latex',
  'gum', 'spice', 'beverage', 'medicinal', 'aromatic', 'timber', 'tannin', 'wax', 'fungus', 'ornamental',
];

// Economic domains a MATERIAL can serve. Versatility = distinct domains touched.
export const DOMAINS = [
  'food', 'brew', 'ranch', 'textile', 'paper', 'building', 'energy', 'cosmetic', 'perfume', 'art',
  'medicine', 'incense', 'industrial', 'leather', 'trade', 'lifestyle', 'craft', 'decor', 'dye',
];

// ---------------------------------------------------------------------------
// MATERIALS — the diverse outputs. `domains` drives versatility → value.
// ---------------------------------------------------------------------------
export const MATERIALS = [
  { item: 'grain',       name: 'Grain',          domains: ['food', 'brew', 'ranch', 'trade'] },
  { item: 'flour',       name: 'Flour',          domains: ['food', 'trade'] },
  { item: 'straw',       name: 'Straw',          domains: ['ranch', 'building', 'trade'] },
  { item: 'legume',      name: 'Legume',         domains: ['food', 'ranch', 'trade'] },
  { item: 'vegetable',   name: 'Vegetable',      domains: ['food', 'trade'] },
  { item: 'fruit',       name: 'Fruit',          domains: ['food', 'brew', 'trade'] },
  { item: 'tuber',       name: 'Tuber',          domains: ['food', 'brew', 'trade'] },
  { item: 'fiber',       name: 'Plant Fiber',    domains: ['textile', 'paper', 'building', 'trade'] },
  { item: 'oil',         name: 'Plant Oil',      domains: ['food', 'energy', 'cosmetic', 'industrial', 'trade'] },
  { item: 'dye',         name: 'Dye Pigment',    domains: ['textile', 'art', 'trade'] },
  { item: 'resin',       name: 'Resin',          domains: ['building', 'medicine', 'incense', 'trade'] },
  { item: 'latex',       name: 'Latex',          domains: ['industrial', 'trade'] },
  { item: 'gum',         name: 'Gum',            domains: ['food', 'industrial', 'medicine', 'trade'] },
  { item: 'spice',       name: 'Spice',          domains: ['food', 'trade', 'medicine'] },
  { item: 'beverage_bean', name: 'Beverage Bean', domains: ['brew', 'trade'] },
  { item: 'herb',        name: 'Medicinal Herb', domains: ['medicine', 'brew', 'trade'] },
  { item: 'essential_oil', name: 'Essential Oil', domains: ['cosmetic', 'perfume', 'medicine', 'trade'] },
  { item: 'timber',      name: 'Timber',         domains: ['building', 'energy', 'trade'] },
  { item: 'tannin',      name: 'Tannin',         domains: ['leather', 'medicine', 'trade'] },
  { item: 'wax',         name: 'Plant Wax',      domains: ['cosmetic', 'trade'] },
  { item: 'mushroom',    name: 'Mushroom',       domains: ['food', 'medicine', 'craft', 'trade'] },
  { item: 'flower',      name: 'Ornamental Flower', domains: ['decor', 'dye', 'trade'] },
  { item: 'sugar',       name: 'Sugar',          domains: ['food', 'brew', 'trade'] },
  // the cannabis niche — deliberately ONE domain (lifestyle). Lowest value in the whole catalog.
  { item: 'cannabis_flower', name: 'Cannabis Flower', domains: ['lifestyle'] },
];
const MAT = Object.fromEntries(MATERIALS.map((m) => [m.item, m]));

// ---------------------------------------------------------------------------
// PLANTS — a broad, real catalog. yields = the materials this plant produces at harvest.
// ---------------------------------------------------------------------------
export const PLANTS = [
  // cereals
  { id: 'wheat', name: 'Wheat', category: 'cereal', yields: ['grain', 'straw'] },
  { id: 'rice', name: 'Rice', category: 'cereal', yields: ['grain', 'straw'] },
  { id: 'maize', name: 'Maize', category: 'cereal', yields: ['grain', 'straw'] },
  { id: 'barley', name: 'Barley', category: 'cereal', yields: ['grain'] },
  { id: 'sugarcane', name: 'Sugarcane', category: 'cereal', yields: ['sugar', 'straw'] },
  // legumes
  { id: 'bean', name: 'Bean', category: 'legume', yields: ['legume'] },
  { id: 'lentil', name: 'Lentil', category: 'legume', yields: ['legume'] },
  { id: 'soybean', name: 'Soybean', category: 'legume', yields: ['legume', 'oil'] },
  // vegetables / fruit / tuber
  { id: 'cabbage', name: 'Cabbage', category: 'vegetable', yields: ['vegetable'] },
  { id: 'tomato', name: 'Tomato', category: 'vegetable', yields: ['vegetable', 'fruit'] },
  { id: 'apple', name: 'Apple Tree', category: 'fruit', yields: ['fruit', 'timber'] },
  { id: 'grape', name: 'Grape Vine', category: 'fruit', yields: ['fruit'] },
  { id: 'potato', name: 'Potato', category: 'tuber', yields: ['tuber'] },
  { id: 'cassava', name: 'Cassava', category: 'tuber', yields: ['tuber'] },
  // fiber
  { id: 'cotton', name: 'Cotton', category: 'fiber', yields: ['fiber', 'oil'] },
  { id: 'flax', name: 'Flax', category: 'fiber', yields: ['fiber', 'oil'] },
  { id: 'jute', name: 'Jute', category: 'fiber', yields: ['fiber'] },
  { id: 'sisal', name: 'Sisal (Agave)', category: 'fiber', yields: ['fiber'] },
  { id: 'ramie', name: 'Ramie', category: 'fiber', yields: ['fiber'] },
  { id: 'bamboo', name: 'Bamboo', category: 'fiber', yields: ['fiber', 'timber'] },
  { id: 'hemp', name: 'Hemp', category: 'fiber', yields: ['fiber', 'oil'] },
  // oilseed / palm
  { id: 'sunflower', name: 'Sunflower', category: 'oilseed', yields: ['oil'] },
  { id: 'sesame', name: 'Sesame', category: 'oilseed', yields: ['oil'] },
  { id: 'castor', name: 'Castor', category: 'oilseed', yields: ['oil'] },
  { id: 'olive', name: 'Olive Tree', category: 'oilseed', yields: ['oil', 'fruit', 'timber'] },
  { id: 'coconut', name: 'Coconut Palm', category: 'oilseed', yields: ['oil', 'fiber', 'fruit'] },
  { id: 'oil_palm', name: 'Oil Palm', category: 'oilseed', yields: ['oil'] },
  // dye
  { id: 'indigo', name: 'Indigo', category: 'dye', yields: ['dye'] },
  { id: 'madder', name: 'Madder', category: 'dye', yields: ['dye'] },
  { id: 'woad', name: 'Woad', category: 'dye', yields: ['dye'] },
  { id: 'turmeric', name: 'Turmeric', category: 'spice', yields: ['spice', 'dye'] },
  // resin / gum / latex
  { id: 'pine', name: 'Pine', category: 'resin', yields: ['resin', 'timber'] },
  { id: 'acacia', name: 'Acacia (Gum Arabic)', category: 'gum', yields: ['gum', 'tannin'] },
  { id: 'rubber_tree', name: 'Rubber Tree', category: 'latex', yields: ['latex'] },
  { id: 'frankincense', name: 'Frankincense', category: 'resin', yields: ['resin'] },
  // spice / beverage
  { id: 'pepper', name: 'Pepper', category: 'spice', yields: ['spice'] },
  { id: 'cinnamon', name: 'Cinnamon', category: 'spice', yields: ['spice'] },
  { id: 'tea', name: 'Tea', category: 'beverage', yields: ['beverage_bean'] },
  { id: 'coffee', name: 'Coffee', category: 'beverage', yields: ['beverage_bean'] },
  { id: 'cocoa', name: 'Cocoa', category: 'beverage', yields: ['beverage_bean'] },
  // medicinal / aromatic
  { id: 'lavender', name: 'Lavender', category: 'aromatic', yields: ['essential_oil', 'flower'] },
  { id: 'mint', name: 'Mint', category: 'aromatic', yields: ['herb', 'essential_oil'] },
  { id: 'chamomile', name: 'Chamomile', category: 'medicinal', yields: ['herb', 'flower'] },
  { id: 'aloe', name: 'Aloe', category: 'medicinal', yields: ['herb'] },
  { id: 'sandalwood', name: 'Sandalwood', category: 'aromatic', yields: ['essential_oil', 'timber'] },
  // timber / tannin / wax / fungus / ornamental
  { id: 'oak', name: 'Oak', category: 'timber', yields: ['timber', 'tannin'] },
  { id: 'teak', name: 'Teak', category: 'timber', yields: ['timber'] },
  { id: 'jojoba', name: 'Jojoba', category: 'wax', yields: ['wax', 'oil'] },
  { id: 'carnauba', name: 'Carnauba Palm', category: 'wax', yields: ['wax'] },
  { id: 'mushroom', name: 'Mushroom', category: 'fungus', yields: ['mushroom'] },
  { id: 'marigold', name: 'Marigold', category: 'ornamental', yields: ['flower', 'dye'] },
  // the niche
  { id: 'cannabis', name: 'Cannabis', category: 'medicinal', yields: ['fiber', 'oil', 'cannabis_flower'] },
];

// ---------------------------------------------------------------------------
// Queries + the versatility-driven value.
// ---------------------------------------------------------------------------
export const plantsByCategory = (cat) => PLANTS.filter((p) => p.category === cat);
export const materialsForPlant = (id) => (PLANTS.find((p) => p.id === id)?.yields || []);
export const plantsForMaterial = (item) => PLANTS.filter((p) => p.yields.includes(item)).map((p) => p.id);

/** versatility = distinct economic domains a material serves. The value driver. */
export function versatilityOf(item) { return (MAT[item]?.domains || []).length; }
/** value ≈ versatility (floor 2). cannabis_flower → 1 domain → the floor. */
export function valueOf(item) { return Math.max(2, versatilityOf(item) * 2); }

/** Materials ranked by versatility (the value story — cannabis flower is last). */
export function versatilityRanking() {
  return MATERIALS.map((m) => ({ item: m.item, versatility: versatilityOf(m.item), value: valueOf(m.item) }))
    .sort((a, b) => b.versatility - a.versatility || a.item.localeCompare(b.item));
}

if (process.argv[1] && process.argv[1].endsWith('plant-catalog.mjs')) {
  console.log(`plants: ${PLANTS.length} across ${new Set(PLANTS.map((p) => p.category)).size} categories`);
  console.log(`materials: ${MATERIALS.length}`);
  console.log('\nmost → least versatile material (value follows; cannabis_flower LAST):');
  for (const r of versatilityRanking()) console.log(`  ${r.item.padEnd(15)} domains=${r.versatility} value=${r.value}`);
  console.log('\ncannabis is one plant:', PLANTS.find((p) => p.id === 'cannabis'));
}
