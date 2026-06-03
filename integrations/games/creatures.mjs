// creatures.mjs — original-IP creature collector (queue #188).
//
// ORIGINAL IP ONLY. The MECHANIC (Mendelian-ish breeding, mutation, rarity) is free for
// anyone to use — game genetics are math, not property. The EXPRESSION must be ours: every
// species name, trait name, and flavor here is invented for MELEK. NO Pokemon / Nintendo /
// any other franchise's names, species, types, or trademarks. If you add a creature, invent
// it; do not port one.
//
// PURE genetics: no network, no I/O, no clock. Deterministic given an injected seedable rng,
// so tests and on-chain reproducibility hold. NFTs are the economy — `tradeable()` emits
// metadata that plugs straight into economy.mjs rarity (see RARITY_TIERS).
//
//   import { SPECIES, createCreature, breed, traits, tradeable, makeRng } from './games/creatures.mjs'
//   node integrations/games/creatures.mjs            # demo: breed two and print offspring

// ---------------------------------------------------------------------------
// Seedable RNG (mulberry32) — deterministic, injectable. Pure, no Math.random.
// ---------------------------------------------------------------------------
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Trait genome. Each gene is diploid: an [alleleA, alleleB] pair. Dominance is
// alphabetical-by-rank within the allele list (index 0 = most dominant).
// All names below are original to MELEK.
// ---------------------------------------------------------------------------

// Allele lists ordered most-dominant -> most-recessive.
export const GENES = {
  hue: ['ember', 'verdant', 'cobalt', 'ashen', 'prism'],   // prism = rarest, recessive
  hide: ['scaled', 'furred', 'chitin', 'glassine'],         // glassine = rare
  aura: ['none', 'glimmer', 'corona', 'umbra'],             // umbra = rare
  size: ['small', 'medium', 'large', 'colossal'],           // colossal = rare
};

// Rarer alleles contribute more "rarity weight". Index in the list = base score
// (recessive/late = rarer). A handful of standout alleles get a bonus.
const ALLELE_BONUS = { prism: 6, glassine: 4, umbra: 4, colossal: 5, corona: 2 };

// ---------------------------------------------------------------------------
// Species — a few invented creatures. `base` genes are diploid homozygous
// starters; `affinity` nudges which genes a wild specimen of this species favors.
// ---------------------------------------------------------------------------
export const SPECIES = {
  pyrelisk: {
    name: 'Pyrelisk',
    blurb: 'A coil-spined ridge-runner that banks heat in its plates.',
    base: { hue: ['ember', 'ember'], hide: ['scaled', 'scaled'], aura: ['glimmer', 'none'], size: ['medium', 'small'] },
  },
  mossquill: {
    name: 'Mossquill',
    blurb: 'A soft-quilled bog-dweller; its fur greens over with the seasons.',
    base: { hue: ['verdant', 'verdant'], hide: ['furred', 'furred'], aura: ['none', 'none'], size: ['small', 'medium'] },
  },
  tidewren: {
    name: 'Tidewren',
    blurb: 'A shore-skimming glider that hums on the cobalt edge of a wave.',
    base: { hue: ['cobalt', 'cobalt'], hide: ['glassine', 'scaled'], aura: ['glimmer', 'glimmer'], size: ['small', 'small'] },
  },
  cinderox: {
    name: 'Cinderox',
    blurb: 'A slab-shouldered ash-walker; rare lines run colossal and crowned.',
    base: { hue: ['ashen', 'ember'], hide: ['chitin', 'scaled'], aura: ['corona', 'none'], size: ['large', 'medium'] },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dominantOf(geneName, pair) {
  const order = GENES[geneName];
  // most dominant = lowest index in the allele list
  const [a, b] = pair;
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

function alleleRarity(geneName, allele) {
  const idx = GENES[geneName].indexOf(allele);
  const base = idx < 0 ? 0 : idx; // later in list => rarer
  return base + (ALLELE_BONUS[allele] || 0);
}

// ---------------------------------------------------------------------------
// createCreature — build a creature from a species + optional explicit genes.
// genes: { gene: [alleleA, alleleB], ... }. Missing genes fall back to species base.
// ---------------------------------------------------------------------------
export function createCreature({ species, genes = {} } = {}) {
  const spec = SPECIES[species];
  if (!spec) throw new Error(`unknown species: ${species}`);
  const genome = {};
  for (const g of Object.keys(GENES)) {
    const pair = genes[g] || spec.base[g] || [GENES[g][0], GENES[g][0]];
    for (const allele of pair) {
      if (!GENES[g].includes(allele)) throw new Error(`unknown allele "${allele}" for gene "${g}"`);
    }
    genome[g] = [pair[0], pair[1]];
  }
  return { species, name: spec.name, genome, generation: 0 };
}

// ---------------------------------------------------------------------------
// traits — the EXPRESSED phenotype (dominant allele per gene) + derived rarity.
// ---------------------------------------------------------------------------
export function traits(creature) {
  const out = { species: creature.species };
  let rarityWeight = 0;
  for (const g of Object.keys(GENES)) {
    const pair = creature.genome[g];
    const expressed = dominantOf(g, pair);
    out[g] = expressed;
    // rarity counts BOTH alleles (carried recessives still add latent value)
    rarityWeight += alleleRarity(g, pair[0]) + alleleRarity(g, pair[1]);
  }
  out.rarityWeight = rarityWeight;
  out.rarity = rarityTier(rarityWeight);
  return out;
}

// rarity tiers — used by economy.mjs / NFT minting.
export const RARITY_TIERS = [
  { name: 'common', min: 0 },
  { name: 'uncommon', min: 10 },
  { name: 'rare', min: 18 },
  { name: 'epic', min: 26 },
  { name: 'mythic', min: 34 },
];

export function rarityTier(weight) {
  let tier = RARITY_TIERS[0].name;
  for (const t of RARITY_TIERS) if (weight >= t.min) tier = t.name;
  return tier;
}

// ---------------------------------------------------------------------------
// breed — deterministic Mendelian-ish cross. Each offspring allele is drawn from
// one parent's pair via the injected rng. A small mutation chance can flip an
// allele to a neighbor (or rarer) allele, which is how rarity can RISE over a line.
// ---------------------------------------------------------------------------
export function breed(parentA, parentB, { rng = makeRng(1), mutationRate = 0.08 } = {}) {
  if (!parentA?.genome || !parentB?.genome) throw new Error('breed requires two creatures with genomes');
  // offspring species inherits from a parent (rng-chosen); both should be compatible.
  const species = rng() < 0.5 ? parentA.species : parentB.species;
  const genome = {};

  for (const g of Object.keys(GENES)) {
    const fromA = parentA.genome[g][rng() < 0.5 ? 0 : 1];
    const fromB = parentB.genome[g][rng() < 0.5 ? 0 : 1];
    let pair = [fromA, fromB];

    // mutation: each allele independently may shift. Bias slightly toward rarer
    // (later in the list) so collector lines can climb in rarity over generations.
    pair = pair.map((allele) => {
      if (rng() >= mutationRate) return allele;
      const list = GENES[g];
      const i = list.indexOf(allele);
      const up = rng() < 0.6; // 60% toward rarer, 40% toward more common
      const j = Math.max(0, Math.min(list.length - 1, i + (up ? 1 : -1)));
      return list[j];
    });

    genome[g] = pair;
  }

  return {
    species,
    name: SPECIES[species].name,
    genome,
    generation: Math.max(parentA.generation || 0, parentB.generation || 0) + 1,
    parents: [parentA.species, parentB.species],
  };
}

// ---------------------------------------------------------------------------
// tradeable — NFT-ready metadata. The economy is the NFTs; this is the bridge.
// Plugs into economy.mjs rarity via { rarity, rarityWeight }.
// ---------------------------------------------------------------------------
export function tradeable(creature) {
  const t = traits(creature);
  const spec = SPECIES[creature.species];
  return {
    kind: 'melek-creature',
    species: creature.species,
    name: spec.name,
    generation: creature.generation || 0,
    attributes: Object.keys(GENES).map((g) => ({ trait_type: g, value: t[g] })),
    rarity: t.rarity,
    rarityWeight: t.rarityWeight,
    genomeFingerprint: Object.keys(GENES)
      .map((g) => `${g}:${creature.genome[g].join('/')}`)
      .join('|'),
  };
}

// ---------------------------------------------------------------------------
// CLI demo (guarded) — original IP only; the mechanic is free, the expression is ours.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('creatures.mjs')) {
  const rng = makeRng(42);
  const a = createCreature({ species: 'pyrelisk' });
  const b = createCreature({ species: 'cinderox' });
  const child = breed(a, b, { rng });
  console.log('parent A:', tradeable(a));
  console.log('parent B:', tradeable(b));
  console.log('offspring:', tradeable(child));
  console.log('offspring traits:', traits(child));
}
