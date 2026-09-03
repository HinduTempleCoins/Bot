// insect-ecosystem.mjs — mini-livestock (bugs, fowl, reptiles) as a PROBLEMS→SOLUTIONS permaculture web.
//
// The operator's frame: a farm isn't just plants. It's an ECOSYSTEM. Every pest is a PROBLEM; every
// beneficial you can RAISE is a SOLUTION — and most of them also produce something versatile:
//   - Bees              → honey / wax / propolis / royal jelly / pollen  +  POLLINATION (a cross-crop yield boost)
//   - Black Soldier Fly → eats waste/manure → FRASS (fertilizer) + LARVAE (protein feed)   [bioconversion]
//   - Worms             → eat scraps → CASTINGS (fertilizer) + bait
//   - Crickets/Mealworms/Silkworms → feed protein / silk fiber
//   - Ladybug/Lacewing/Predatory-mite/Parasitic-wasp → biological pest control (the "solution" you farm)
//   - Fowl (chicken/quail/duck) & Reptiles → eat the insects → eggs/meat/manure + more pest control
//
// The loop CLOSES (permaculture): insects → feed fowl/reptiles → manure → decomposers (BSF/worms) →
// frass/castings → plants → pollinated by bees → seed/fruit → scraps → back to the decomposers.
// Value = VERSATILITY: frass, larvae, honey, wax and silk each serve many domains (see MATERIALS).
//
// PURE + deterministic (L1-derived rng; never Math.random/clock). Offline-tested. Original IP; the
// mechanic (IPM, bioconversion, trophic feed) is real agronomy, the naming/flavor is ours.
//
//   import { INSECTS, LIVESTOCK, PROBLEMS, MATERIALS, farmColony, bioconvert, pollinate,
//            solutionsFor, deployControl, feed, versatilityOf, problemSolutionWeb }
//     from './games/insect-ecosystem.mjs'

import { rngFromCtx } from './plant-genetics.mjs';

// ---------------------------------------------------------------------------
// MATERIALS — every product carries the domains it serves. versatility = distinct domains = value.
// ---------------------------------------------------------------------------
export const MATERIALS = {
  honey:         { name: 'Honey',          domains: ['food', 'medicine', 'alchemy', 'trade'] },
  beeswax:       { name: 'Beeswax',        domains: ['craft', 'cosmetic', 'alchemy', 'waterproof', 'trade'] },
  propolis:      { name: 'Propolis',       domains: ['medicine', 'alchemy'] },
  royal_jelly:   { name: 'Royal Jelly',    domains: ['medicine', 'alchemy'] },        // rare
  bee_pollen:    { name: 'Bee Pollen',     domains: ['food', 'medicine', 'feed'] },
  frass:         { name: 'Insect Frass',   domains: ['fertilizer', 'alchemy', 'trade'] },   // the agronomic backbone
  bsf_larvae:    { name: 'BSF Larvae',     domains: ['feed', 'protein', 'bait', 'trade'] },
  castings:      { name: 'Worm Castings',  domains: ['fertilizer', 'soil'] },
  bait_worm:     { name: 'Bait Worm',      domains: ['bait', 'feed'] },
  cricket_flour: { name: 'Cricket Flour',  domains: ['food', 'protein', 'feed'] },
  mealworm:      { name: 'Mealworm',       domains: ['feed', 'bait', 'protein'] },
  silk:          { name: 'Silk',           domains: ['fiber', 'textile', 'craft', 'trade'] },   // high versatility
  chitin:        { name: 'Chitin',         domains: ['alchemy', 'craft', 'bioplastic'] },       // from molts (non-lethal)
  eggs:          { name: 'Eggs',           domains: ['food', 'alchemy', 'trade'] },
  manure:        { name: 'Manure',         domains: ['fertilizer', 'bioconvert-input'] },        // works RAW as fertilizer; also decomposer feedstock
  compost:       { name: 'Compost',        domains: ['fertilizer', 'soil', 'alchemy'] },         // upgraded manure/scraps (optional step)
};

// Fertilizer grade — raw manure already fertilizes (grade 1); composting/bioconversion upgrades to 2.
// Encodes the operator's rule: "manure works as fertilizer with no composting even."
export const FERTILIZER_GRADE = { manure: 1, compost: 2, frass: 2, castings: 2 };
export const fertilizerGrade = (m) => FERTILIZER_GRADE[m] || 0;
export const versatilityOf = (m) => (MATERIALS[m]?.domains?.length || 0);

// ---------------------------------------------------------------------------
// INSECTS you can farm. role: producer | pollinator | decomposer | predator (biological control).
//   products = materials a healthy colony yields per cycle.  eats = its feedstock / prey.
// ---------------------------------------------------------------------------
export const INSECTS = {
  honeybee:        { name: 'Honeybee',         role: 'pollinator', products: ['honey', 'beeswax', 'propolis', 'bee_pollen'], eats: ['nectar'] },
  royal_hive:      { name: 'Royal Hive',       role: 'pollinator', products: ['honey', 'beeswax', 'royal_jelly'], eats: ['nectar'] }, // rare
  mason_bee:       { name: 'Mason Bee',        role: 'pollinator', products: [], eats: ['nectar'] },      // solitary; pure pollination
  black_soldier_fly:{ name: 'Black Soldier Fly', role: 'decomposer', products: ['bsf_larvae', 'frass'], eats: ['manure', 'food-waste'] },
  earthworm:       { name: 'Earthworm',        role: 'decomposer', products: ['castings', 'bait_worm'], eats: ['food-waste', 'manure'] },
  dung_beetle:     { name: 'Dung Beetle',      role: 'collector',  products: [], eats: ['manure'] },   // gathers dung into piles + buries some (in-place fertilizer)
  cricket:         { name: 'Cricket',          role: 'producer',   products: ['cricket_flour', 'chitin'], eats: ['grain', 'veg'] },
  mealworm_beetle: { name: 'Mealworm Beetle',  role: 'producer',   products: ['mealworm', 'frass', 'chitin'], eats: ['grain'] },
  silkworm:        { name: 'Silkworm',         role: 'producer',   products: ['silk'], eats: ['mulberry'] },
  ladybug:         { name: 'Ladybug',          role: 'predator',   products: [], eats: ['aphids'] },
  lacewing:        { name: 'Lacewing',         role: 'predator',   products: [], eats: ['aphids', 'mites', 'caterpillars'] },
  predatory_mite:  { name: 'Predatory Mite',   role: 'predator',   products: [], eats: ['spider_mites', 'fungus_gnats'] },
  parasitic_wasp:  { name: 'Parasitic Wasp',   role: 'predator',   products: [], eats: ['caterpillars', 'aphids'] },
};

// Livestock (from the fowl/reptile post) — eat insects, close the trophic loop.
export const LIVESTOCK = {
  chicken: { name: 'Chicken', eats: ['bsf_larvae', 'mealworm', 'cricket_flour', 'grain', 'pests'], products: ['eggs', 'manure'], controls: ['pests'] },
  quail:   { name: 'Quail',   eats: ['bsf_larvae', 'mealworm', 'grain'],                            products: ['eggs', 'manure'], controls: [] },
  duck:    { name: 'Duck',    eats: ['bsf_larvae', 'slugs', 'grain'],                               products: ['eggs', 'manure'], controls: ['slugs'] },
  reptile: { name: 'Reptile', eats: ['cricket_flour', 'mealworm', 'bsf_larvae'],                    products: ['manure'],         controls: ['pests'] }, // pest-control + companion; spirit on natural death (spirits-and-parts)
};

// ---------------------------------------------------------------------------
// PROBLEMS → SOLUTIONS web. Each pest/condition names the agents that resolve it (bugs you farm,
// or fowl you keep). This is Integrated Pest Management as a game graph — and a teaching layer.
// ---------------------------------------------------------------------------
export const PROBLEMS = {
  aphids:        { name: 'Aphid Infestation',    solvedBy: ['ladybug', 'lacewing', 'parasitic_wasp', 'chicken'] },
  spider_mites:  { name: 'Spider Mites',         solvedBy: ['predatory_mite', 'lacewing'] },
  caterpillars:  { name: 'Caterpillars',         solvedBy: ['parasitic_wasp', 'lacewing', 'chicken'] },
  slugs:         { name: 'Slugs & Snails',       solvedBy: ['duck'] },
  fungus_gnats:  { name: 'Fungus Gnats',         solvedBy: ['predatory_mite'] },
  poor_pollination: { name: 'Poor Pollination',  solvedBy: ['honeybee', 'royal_hive', 'mason_bee'] },
  manure_buildup: { name: 'Manure / Waste Buildup', solvedBy: ['dung_beetle', 'black_soldier_fly', 'earthworm'] },
  depleted_soil: { name: 'Depleted Soil',        solvedBy: ['earthworm', 'black_soldier_fly'] }, // via castings/frass
};

/** solutionsFor — the biological controls (and what each yields), best/general-purpose first. */
export function solutionsFor(problemKey) {
  const p = PROBLEMS[problemKey];
  if (!p) return [];
  return p.solvedBy.map((agent) => {
    const src = INSECTS[agent] || LIVESTOCK[agent] || {};
    return { agent, name: src.name || agent, role: src.role || 'livestock', yields: src.products || [] };
  });
}

// ---------------------------------------------------------------------------
// farmColony — a colony produces its materials over `cycles`. Non-lethal: bees/worms/crickets PRODUCE.
// Deterministic yield scaled by colony `strength` (0..1) and cycles.
// ---------------------------------------------------------------------------
export function farmColony(insectKey, { ctx = {}, cycles = 1, strength = 0.7 } = {}) {
  const ins = INSECTS[insectKey];
  if (!ins) return { ok: false, reason: 'unknown-insect' };
  if (!ins.products.length) return { ok: true, insect: insectKey, role: ins.role, products: {}, note: 'beneficial: value is pest-control / pollination, not a harvest' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: insectKey, fatherId: 'colony' });
  const products = {};
  for (let c = 0; c < Math.max(1, cycles); c++) {
    for (const m of ins.products) {
      // base 1-3 per cycle, weighted by strength; rare products (royal_jelly) come out thin
      const rare = m === 'royal_jelly' || m === 'propolis';
      const base = 1 + Math.floor(rng() * 3);
      const q = Math.max(rare ? 0 : 1, Math.round(base * (0.5 + strength) * (rare ? 0.4 : 1)));
      if (q > 0) products[m] = (products[m] || 0) + q;
    }
  }
  return { ok: true, insect: insectKey, role: ins.role, products };
}

/**
 * bioconvert — the Black Soldier Fly (or worm) eats waste and returns FRASS + LARVAE/CASTINGS.
 * This is the explicit "soldierflies for frass" mechanic AND the manure/waste PROBLEM's solution.
 * amount = kg of feedstock; returns fertilizer + feed. Deterministic split.
 */
export function bioconvert(wasteKind, { agent = 'black_soldier_fly', amount = 10, ctx = {} } = {}) {
  const dec = INSECTS[agent];
  if (!dec || dec.role !== 'decomposer') return { ok: false, reason: 'not-a-decomposer' };
  if (!dec.eats.includes(wasteKind)) return { ok: false, reason: 'wont-eat-that' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: agent, fatherId: wasteKind });
  const eff = 0.35 + rng() * 0.15;                     // ~35-50% mass → products (rest is CO2/water)
  const converted = Math.round(amount * eff * 10) / 10;
  const out = {};
  if (agent === 'black_soldier_fly') {
    out.bsf_larvae = Math.round(converted * 0.4 * 10) / 10;   // protein feed
    out.frass = Math.round(converted * 0.6 * 10) / 10;        // fertilizer
  } else { // earthworm
    out.castings = Math.round(converted * 0.8 * 10) / 10;
    out.bait_worm = Math.round(converted * 0.2 * 10) / 10;
  }
  return { ok: true, agent, ate: wasteKind, products: out, solves: 'manure_buildup' };
}

/**
 * collectDung — the DUNG BEETLE's job: gather scattered manure into piles and bury some in place.
 * Buried dung fertilizes the soil directly (no composting needed); piles are ready to compost or
 * spread raw. More beetles = higher gather efficiency. Deterministic.
 */
export function collectDung({ ctx = {}, scattered = 10, beetles = 1 } = {}) {
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: 'dung_beetle', fatherId: 'collect' });
  const eff = Math.min(1, 0.5 + beetles * 0.1 + rng() * 0.1);
  const gathered = Math.round(scattered * eff * 10) / 10;
  const buried = Math.round(gathered * 0.3 * 10) / 10;                 // buried → in-place soil fertility
  const piles = Math.round((gathered - buried) * 10) / 10;            // ready to compost OR spread raw
  return { ok: true, agent: 'dung_beetle', gathered, piles, buried, soilBoost: buried,
    note: 'buried dung fertilizes in place; piled manure spreads raw (grade 1) or composts to grade 2', solves: 'manure_buildup' };
}

/**
 * compost — OPTIONAL upgrade step: turn manure/scraps into grade-2 compost. You never have to — raw
 * manure already fertilizes (fertilizerGrade('manure')===1) — composting just makes it richer.
 */
export function compost(amount = 10, { ctx = {}, method = 'pile' } = {}) {
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: 'compost', fatherId: method });
  const rate = method === 'hot' ? 0.6 : 0.45;                          // hot piles convert more mass
  const out = Math.round(amount * (rate + rng() * 0.1) * 10) / 10;
  return { ok: true, input: 'manure/scraps', output: 'compost', amount: out, grade: 2, solves: 'depleted_soil' };
}

/**
 * pollinate — bees turn into a YIELD BOOST on a crop (the real reason bees are versatile).
 * Returns the boosted yield + the multiplier. `colony` picks the pollinator; strength scales it.
 */
export function pollinate(baseYield, { colony = 'honeybee', strength = 0.7 } = {}) {
  const ins = INSECTS[colony];
  const isPollinator = ins && ins.role === 'pollinator';
  const mult = isPollinator ? 1 + 0.5 * Math.max(0, Math.min(1, strength)) : 1; // up to +50%
  return { ok: isPollinator, colony, multiplier: mult, yield: Math.round(baseYield * mult * 100) / 100, solves: 'poor_pollination' };
}

/**
 * deployControl — release a farmed beneficial (or fowl) against a pest PROBLEM.
 * Returns whether it's a valid control, the reduction (0..1), and any byproduct (fowl → eggs/manure).
 */
export function deployControl(problemKey, agentKey, { ctx = {}, count = 1 } = {}) {
  const sols = solutionsFor(problemKey).map((s) => s.agent);
  if (!sols.includes(agentKey)) return { ok: false, reason: 'not-a-control-for-this-problem' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: problemKey, fatherId: agentKey });
  const reduction = Math.min(1, (0.4 + rng() * 0.4) * Math.max(1, count) / 1); // per release; caps at eradication
  const live = LIVESTOCK[agentKey];
  const byproduct = live ? live.products.slice() : [];    // fowl also lay eggs / make manure while they patrol
  return { ok: true, problem: problemKey, agent: agentKey, reduction: Math.round(reduction * 100) / 100, resolved: reduction >= 0.75, byproduct };
}

/** feed — give a farmed feed material to livestock; validates the animal actually eats it. */
export function feed(livestockKey, material) {
  const a = LIVESTOCK[livestockKey];
  if (!a) return { ok: false, reason: 'unknown-livestock' };
  if (!a.eats.includes(material)) return { ok: false, reason: 'wont-eat-that' };
  return { ok: true, livestock: livestockKey, ate: material, produces: a.products.slice() };
}

/** problemSolutionWeb — the full graph for the UI / education layer (IPM teaching). */
export function problemSolutionWeb() {
  return Object.entries(PROBLEMS).map(([key, p]) => ({
    problem: key, name: p.name, solutions: solutionsFor(key),
  }));
}

// ---------------------------------------------------------------------------
// THE FOOD WEB — the bugs (and their larvae/pupae/worms) are FEED for many other animals, not just fowl.
// Each edible carries a nutrition score and the animal CLASSES that eat it. Fish tie straight into
// aquatic-farm; reptiles/amphibians/songbirds/small-mammals broaden the web. Insects also eat insects
// (the pest → predator edges above). Live pest bugs are prey too — nature's own feed.
// ---------------------------------------------------------------------------
export const ANIMAL_CLASSES = ['fowl', 'fish', 'reptile', 'amphibian', 'songbird', 'small-mammal', 'insect', 'carnivore', 'scavenger'];

export const EDIBLE = {
  bsf_larvae:    { nutrition: 9, eatenBy: ['fowl', 'fish', 'reptile', 'amphibian', 'songbird'] },
  mealworm:      { nutrition: 8, eatenBy: ['fowl', 'reptile', 'amphibian', 'songbird', 'small-mammal'] },
  cricket_flour: { nutrition: 7, eatenBy: ['fowl', 'fish', 'reptile'] },
  live_cricket:  { nutrition: 8, eatenBy: ['reptile', 'amphibian', 'songbird', 'fowl'] },
  bait_worm:     { nutrition: 6, eatenBy: ['fish', 'fowl', 'amphibian'] },
  silk_pupae:    { nutrition: 8, eatenBy: ['fish', 'reptile', 'fowl'] },
  aphids:        { nutrition: 3, eatenBy: ['insect', 'songbird', 'fowl'] },   // live pest = free prey
  slugs:         { nutrition: 4, eatenBy: ['fowl', 'amphibian'] },
  // Animal PARTS (keys match spirits-and-parts PARTS) are food for carnivores/scavengers — from the
  // natural cycle only, same respectful line: remains feed the next animal, they aren't a kill reward.
  bone:          { nutrition: 5, eatenBy: ['carnivore', 'scavenger', 'reptile', 'small-mammal'] },
  marrow:        { nutrition: 7, eatenBy: ['carnivore', 'scavenger'] },
  hide:          { nutrition: 2, eatenBy: ['carnivore', 'scavenger'] },   // rawhide
  sinew:         { nutrition: 3, eatenBy: ['carnivore'] },
  fish_scraps:   { nutrition: 5, eatenBy: ['fish', 'scavenger', 'fowl'] },
  carrion:       { nutrition: 4, eatenBy: ['scavenger', 'reptile'] },
};
export const nutritionOf = (item) => (EDIBLE[item]?.nutrition || 0);
/** predatorsOf — which animal classes eat this bug/feed item. */
export const predatorsOf = (item) => (EDIBLE[item]?.eatenBy || []).slice();

// Companion / wild / aquatic consumers keyed by class (fish link to aquatic-farm's stock).
export const ANIMALS = {
  chicken: { class: 'fowl' }, quail: { class: 'fowl' }, duck: { class: 'fowl' },
  koi: { class: 'fish' }, catfish: { class: 'fish' }, tilapia: { class: 'fish' }, // → aquatic-farm
  gecko: { class: 'reptile' }, skink: { class: 'reptile' }, turtle: { class: 'reptile' },
  frog: { class: 'amphibian' }, newt: { class: 'amphibian' },
  songbird: { class: 'songbird' }, hedgehog: { class: 'small-mammal' },
  dog: { class: 'carnivore' }, ferret: { class: 'carnivore' },
  crab: { class: 'scavenger' }, vulture: { class: 'scavenger' }, raccoon: { class: 'scavenger' }, // crab → aquatic-farm
};

/** classOf — resolve an animal (key in LIVESTOCK/ANIMALS, or a {class}/{diet} descriptor) to its class. */
function classOf(animal) {
  if (animal && typeof animal === 'object') return animal.class || null;
  return ANIMALS[animal]?.class || (LIVESTOCK[animal] ? 'fowl' : null);
}

/**
 * feedTo — GENERALIZED feeding: any farmed bug/feed item to any animal that eats its class.
 * Returns the deterministic growth gain (nutrition-scaled) or a refusal. This is the food web made
 * playable — larvae to a koi, mealworms to a gecko, crickets to a frog, worms to a catfish.
 */
export function feedTo(animal, material, { ctx = {}, amount = 1 } = {}) {
  const cls = classOf(animal);
  const e = EDIBLE[material];
  if (!e) return { ok: false, reason: 'not-a-feed-item' };
  if (!cls || !e.eatenBy.includes(cls)) return { ok: false, reason: 'class-wont-eat-that', class: cls };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: String(animal), fatherId: material });
  const growth = Math.round(e.nutrition * Math.max(1, amount) * (0.8 + rng() * 0.4) * 10) / 10;
  return { ok: true, animal, class: cls, ate: material, nutrition: e.nutrition, growth };
}

/** foodWeb — every bug/feed item → the animal classes that consume it (for UI + education). */
export function foodWeb() {
  return Object.entries(EDIBLE).map(([item, e]) => ({ feed: item, nutrition: e.nutrition, eatenBy: e.eatenBy.slice() }));
}

// ---------------------------------------------------------------------------
// BIOPROCESS — animal-mediated REFINEMENT: an animal turns a raw input into a higher-value output.
// The flagship is the civet + coffee cherry → "civet coffee" (kopi luwak) — niche as an item, but the
// PATTERN generalizes (this is the same shape as BSF, bees, silkworm, the lac insect). Ties the Botanica
// Coffee twin into the animal layer. Respectful line, same as spirits-and-parts: the refined good is
// COLLECTED from what the animal naturally passes — never force-fed, never harmed.
// ---------------------------------------------------------------------------
export const BIOPROCESS = {
  civet_coffee:  { animal: 'civet',    input: 'coffee_cherry', output: 'civet_coffee', yield: 0.5, uplift: 6, domains: ['food', 'luxury', 'trade'] },
  muntjac_musk:  { animal: 'civet',    input: 'botanicals',    output: 'civet_musk',  yield: 0.2, uplift: 5, domains: ['cosmetic', 'alchemy'] },     // civet musk (perfumery), collected
  shellac:       { animal: 'lac_insect', input: 'sap',         output: 'shellac',     yield: 0.4, uplift: 4, domains: ['craft', 'dye', 'waterproof', 'trade'] },
};

/**
 * bioprocess — run a raw input through an animal that refines it. Deterministic, non-lethal
 * (collected, not extracted). Returns the refined output amount + a value uplift multiplier.
 */
export function bioprocess(kind, { amount = 1, ctx = {} } = {}) {
  const b = BIOPROCESS[kind];
  if (!b) return { ok: false, reason: 'unknown-bioprocess' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: b.animal, fatherId: kind });
  const out = Math.round(amount * b.yield * (0.8 + rng() * 0.4) * 100) / 100;
  return { ok: true, animal: b.animal, from: b.input, output: b.output, amount: out, uplift: b.uplift, domains: b.domains.slice(), collected: true };
}

// ---------------------------------------------------------------------------
// ACQUISITION — the ONLY way to get bugs: FORAGE the world → CAPTURE what you find → BREED a pair into
// a colony. No store-bought mealworm tubs. What you find is grub-like but KNOWN on sight (a soil grub is
// plainly a soil grub) — no mystery-identify step. The pests you're fighting ARE breeding stock.
// ---------------------------------------------------------------------------
export const BIOMES = ['garden', 'compost', 'forest', 'field', 'pond'];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

// Wild finds. Each is a KNOWN grub/bug that maps to one species you can raise it into.
export const WILD = {
  soil_grub:    { name: 'Soil Grub',         weight: 30, biomes: ['garden', 'compost', 'forest'], species: 'black_soldier_fly' },
  compost_grub: { name: 'Compost Grub',      weight: 22, biomes: ['compost', 'garden'],           species: 'mealworm_beetle' },
  leaf_larva:   { name: 'Leaf Larva',        weight: 18, biomes: ['garden', 'forest'],            species: 'silkworm' },
  field_cricket:{ name: 'Field Cricket',     weight: 16, biomes: ['field', 'garden'],             species: 'cricket' },
  pond_worm:    { name: 'Pond Worm',         weight: 18, biomes: ['pond', 'compost'],             species: 'earthworm' },
  aphid_colony: { name: 'Aphid Colony',      weight: 22, biomes: ['garden'], pest: true,          species: 'aphids' },   // capture the PEST → breed as prey/feed
  ladybug_find: { name: 'Wandering Ladybug', weight: 10, biomes: ['garden', 'field'],             species: 'ladybug' },  // a beneficial you stumble on
  dung_roller:  { name: 'Dung Beetle',       weight: 12, biomes: ['field', 'compost'],            species: 'dung_beetle' },
  wild_swarm:   { name: 'Wild Bee Swarm',    weight: 5,  biomes: ['forest', 'field'], rare: true, species: 'honeybee' },
  royal_swarm:  { name: 'Royal Swarm',       weight: 2,  biomes: ['forest'],          rare: true, species: 'royal_hive' }, // jackpot
};

const CATCH_GEAR = { hands: 0.5, net: 0.8, trap: 0.95 };

/** forage — search a biome for a wild bug. Deterministic weighted draw; sometimes you find nothing. */
export function forage({ ctx = {}, biome = 'garden', season = 'summer' } = {}) {
  const pool = Object.entries(WILD).filter(([, w]) => w.biomes.includes(biome));
  if (!pool.length) return { ok: true, found: null, reason: 'nothing-here' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: biome, fatherId: season });
  if (rng() < 0.15) return { ok: true, found: null, reason: 'nothing-this-time' };
  // seasonal nudge: rare finds favor summer/autumn; light touch so behavior stays legible
  const warm = season === 'summer' || season === 'autumn';
  const weighted = pool.map(([k, w]) => [k, w.weight * (w.rare ? (warm ? 1.5 : 0.5) : 1)]);
  const total = weighted.reduce((n, [, x]) => n + x, 0);
  let r = rng() * total;
  let key = weighted[0][0];
  for (const [k, x] of weighted) { if (r < x) { key = k; break; } r -= x; }
  const w = WILD[key];
  return { ok: true, found: { id: key, name: w.name, species: w.species, pest: !!w.pest, rare: !!w.rare } };
}

/** capture — try to catch a foraged find. Success by gear + a rarity penalty. Deterministic. */
export function capture(find, { ctx = {}, gear = 'hands' } = {}) {
  if (!find || !find.id || !WILD[find.id]) return { ok: false, reason: 'nothing-to-capture' };
  const base = CATCH_GEAR[gear] ?? CATCH_GEAR.hands;
  const chance = base * (WILD[find.id].rare ? 0.5 : 1);
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: find.id, fatherId: gear });
  if (rng() > chance) return { ok: false, reason: 'it-got-away', chance: Math.round(chance * 100) / 100 };
  return { ok: true, stock: { id: find.id, species: WILD[find.id].species, sex: rng() < 0.5 ? 'f' : 'm' } };
}

/**
 * establishColony — the BREEDING gate: a female + male of the SAME species become a colony. This is the
 * sole unlock for production (farmColony/bioconvert/etc. operate on an established colony's species).
 * No pair, no colony — you must capture in the world and breed.
 */
export function establishColony(stockA, stockB) {
  const a = stockA?.species, b = stockB?.species;
  if (!a || !b) return { ok: false, reason: 'need-two-captures' };
  if (a !== b) return { ok: false, reason: 'species-mismatch' };
  if (stockA.sex && stockB.sex && stockA.sex === stockB.sex) return { ok: false, reason: 'need-a-breeding-pair' };
  return { ok: true, colony: { species: a, size: 2, founded: true } };
}

/** canFarm — production is only allowed for a species you have an established colony of. */
export const canFarm = (species, colonies = []) => colonies.some((c) => c.founded && c.species === species);

if (process.argv[1] && process.argv[1].endsWith('insect-ecosystem.mjs')) {
  const ctx = { blockId: '0xbee', txId: '0x1' };
  console.log('bee colony harvest:', farmColony('honeybee', { ctx, cycles: 3, strength: 0.8 }).products);
  console.log('soldier flies eat manure →', bioconvert('manure', { amount: 20, ctx }).products);
  console.log('dung beetles gather 20 scattered manure →', collectDung({ scattered: 20, beetles: 3, ctx }));
  console.log('raw manure already fertilizes (grade)', fertilizerGrade('manure'), '| compost is grade', fertilizerGrade('compost'));
  console.log('pollinate a 100-yield crop with bees:', pollinate(100, { strength: 0.9 }));
  console.log('aphid problem, solutions to farm:', solutionsFor('aphids').map((s) => s.name));
  console.log('release ladybugs on aphids:', deployControl('aphids', 'ladybug', { ctx, count: 2 }));
  console.log('feed BSF larvae to chickens:', feed('chicken', 'bsf_larvae'));
  console.log('same larvae feed a koi (aquatic-farm):', feedTo('koi', 'bsf_larvae', { ctx }));
  console.log('mealworms → gecko:', feedTo('gecko', 'mealworm', { ctx }));
  console.log('who eats BSF larvae:', predatorsOf('bsf_larvae'));
  const find = forage({ ctx, biome: 'compost', season: 'summer' });
  console.log('forage the compost, you find:', find.found);
  const cap = capture(find.found, { ctx, gear: 'net' });
  console.log('capture it →', cap.stock);
  const pair = cap.ok ? establishColony(cap.stock, { ...cap.stock, sex: cap.stock.sex === 'f' ? 'm' : 'f' }) : null;
  console.log('breed a pair → colony:', pair?.colony);
}
