// microbe-lab.mjs — culture microbes & microfauna to make MEDICINE, POISONS, ENZYMES, FERMENTS and
// SOIL INOCULANTS. The living-lab tier under the plants/bugs/animals: you ISOLATE a wild strain from an
// environmental source (soil swab, moldy fruit, a pond bloom) — the only way in, same "from the world"
// rule as bug capture — then CULTURE it on a substrate to yield reagents that plug into the apothecary
// (medicine), the alchemy/necromancy labs (poisons/toxins), the industrial chains (enzymes/ferments),
// and the farm (nitrogen-fixers, mycorrhizae, beneficial nematodes → soil + feed).
//
// SAFETY / SCOPE: this is a GAME ABSTRACTION. A culture yields a tagged reagent (e.g. 'antibiotic',
// 'toxin'); there are NO real synthesis, extraction, or manufacturing methods here — consistent with the
// repo's harm-reduction-is-reference / no-manufacturing line. Poisons exist as alchemy/combat reagents,
// not instructions.
//
// PURE + deterministic (L1-derived rng; never Math.random/clock). Offline-tested.
//
//   import { CULTURES, PRODUCTS, SUBSTRATES, SOURCES, isolate, culture, productsOf,
//            versatilityOf, cultureWeb } from './games/microbe-lab.mjs'

import { rngFromCtx } from './plant-genetics.mjs';

// ---------------------------------------------------------------------------
// PRODUCTS — what cultures make. domains = the systems that consume it (versatility = value).
// ---------------------------------------------------------------------------
export const PRODUCTS = {
  ferment:       { name: 'Ferment',        domains: ['food', 'alchemy', 'trade'] },       // alcohol/bread/vinegar base → aqua_vitae
  probiotic:     { name: 'Probiotic',      domains: ['food', 'medicine'] },
  enzyme:        { name: 'Enzyme',         domains: ['craft', 'food', 'industrial'] },     // tanning, cheese, cleaning
  antibiotic:    { name: 'Antibiotic',     domains: ['medicine', 'alchemy'] },
  antifungal:    { name: 'Antifungal',     domains: ['medicine', 'fertilizer'] },          // also crop rescue
  toxin:         { name: 'Toxin',          domains: ['poison', 'alchemy'] },               // game reagent only
  antivenom:     { name: 'Antivenom',      domains: ['medicine'] },                         // the counter to toxin/venom
  nitrogen_fix:  { name: 'Nitrogen Fixer', domains: ['fertilizer', 'soil', 'plant-boost'] },
  root_symbiont: { name: 'Root Symbiont',  domains: ['fertilizer', 'plant-boost'] },        // mycorrhizae
  algae_protein: { name: 'Algae Protein',  domains: ['food', 'feed'] },
  soil_fauna:    { name: 'Soil Fauna',     domains: ['soil', 'feed'] },                      // beneficial nematodes → aeration + micro-feed
};
export const versatilityOf = (p) => (PRODUCTS[p]?.domains?.length || 0);

// Environmental sources you isolate FROM (the "capture" analog — strains come from the world, not a shop).
export const SOURCES = ['soil_swab', 'moldy_fruit', 'raw_veg', 'grain_mold', 'legume_root', 'forest_soil', 'pond_bloom', 'compost', 'spoiled_batch'];
export const SUBSTRATES = ['agar', 'grain', 'whey', 'broth', 'soil'];

// ---------------------------------------------------------------------------
// CULTURES — original-IP-flavored strains. `from` = where you isolate it; `substrate` = what it grows on;
// `products` = reagents a healthy culture yields; hazard:true gates it behind lab safety (bio-hazard line).
// ---------------------------------------------------------------------------
export const CULTURES = {
  yeast:        { name: 'Wild Yeast',        from: 'moldy_fruit', substrate: 'grain',  products: ['ferment'] },
  lacto:        { name: 'Lactobacillus',     from: 'raw_veg',     substrate: 'whey',   products: ['probiotic'] },
  koji:         { name: 'Koji Mold',         from: 'grain_mold',  substrate: 'grain',  products: ['enzyme', 'ferment'] },
  bluemold:     { name: 'Blue Mold',         from: 'moldy_fruit', substrate: 'agar',   products: ['antibiotic'] },        // penicillium-like
  soil_actino:  { name: 'Soil Actinomycete', from: 'soil_swab',   substrate: 'agar',   products: ['antibiotic', 'antifungal'] }, // streptomyces-like
  rhizobia:     { name: 'Rhizobia',          from: 'legume_root', substrate: 'soil',   products: ['nitrogen_fix'] },
  mycorrhiza:   { name: 'Mycorrhizae',       from: 'forest_soil', substrate: 'soil',   products: ['root_symbiont'] },
  spirulina:    { name: 'Spirulina',         from: 'pond_bloom',  substrate: 'broth',  products: ['algae_protein'] },
  nematode:     { name: 'Beneficial Nematode', from: 'compost',   substrate: 'soil',   products: ['soil_fauna'] },        // "other purposes": soil + feed, NOT gnat control
  toxigen:      { name: 'Toxigenic Culture', from: 'spoiled_batch', substrate: 'broth', products: ['toxin'], hazard: true }, // poison reagent (abstract)
  antivenin:    { name: 'Antivenin Culture', from: 'broth',       substrate: 'broth',  products: ['antivenom'], hazard: false },
};
export const productsOf = (key) => (CULTURES[key]?.products || []).slice();

/** isolate — pull a wild strain from an environmental source. Deterministic; sometimes nothing grows. */
export function isolate({ ctx = {}, source = 'soil_swab' } = {}) {
  const pool = Object.entries(CULTURES).filter(([, c]) => c.from === source);
  if (!pool.length) return { ok: true, strain: null, reason: 'nothing-culturable-here' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: source, fatherId: 'isolate' });
  if (rng() < 0.2) return { ok: true, strain: null, reason: 'contaminated' };
  const [key] = pool[Math.floor(rng() * pool.length)];
  return { ok: true, strain: { id: key, name: CULTURES[key].name, hazard: !!CULTURES[key].hazard } };
}

/**
 * culture — propagate an isolated strain on a substrate to yield its reagents. Requires the RIGHT
 * substrate. Hazardous strains (toxins) require `bsl:true` (a lab-safety gate). Deterministic yield.
 */
export function culture(strainId, { ctx = {}, substrate = 'agar', days = 3, bsl = false } = {}) {
  const c = CULTURES[strainId];
  if (!c) return { ok: false, reason: 'unknown-strain' };
  if (c.substrate !== substrate) return { ok: false, reason: 'wrong-substrate', wants: c.substrate };
  if (c.hazard && !bsl) return { ok: false, reason: 'needs-biosafety-lab' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: strainId, fatherId: substrate });
  const yields = {};
  for (const p of c.products) {
    const q = Math.max(1, Math.round((1 + rng() * 2) * Math.min(3, Math.max(1, days)) * (0.6 + rng() * 0.4)));
    yields[p] = q;
  }
  return { ok: true, strain: strainId, hazard: !!c.hazard, products: yields };
}

/** cultureWeb — every strain → what it makes and where it plugs in (UI + education layer). */
export function cultureWeb() {
  return Object.entries(CULTURES).map(([key, c]) => ({
    strain: key, name: c.name, from: c.from, hazard: !!c.hazard,
    products: c.products.map((p) => ({ product: p, domains: PRODUCTS[p].domains.slice() })),
  }));
}

if (process.argv[1] && process.argv[1].endsWith('microbe-lab.mjs')) {
  const ctx = { blockId: '0xcell', txId: '0x1' };
  const iso = isolate({ ctx, source: 'soil_swab' });
  console.log('swab the soil, isolate:', iso.strain);
  console.log('culture soil actinomycete on agar →', culture('soil_actino', { ctx, substrate: 'agar', days: 3 }).products);
  console.log('blue mold → antibiotic:', culture('bluemold', { ctx, substrate: 'agar' }).products);
  console.log('rhizobia → nitrogen fixer (soil):', culture('rhizobia', { ctx, substrate: 'soil' }).products);
  console.log('toxin culture WITHOUT a biosafety lab:', culture('toxigen', { ctx, substrate: 'broth' }));
  console.log('toxin culture WITH one:', culture('toxigen', { ctx, substrate: 'broth', bsl: true }).products);
}
