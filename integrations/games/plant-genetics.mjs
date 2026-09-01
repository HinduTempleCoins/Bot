// plant-genetics.mjs — strain genetics + supply-valve breeding for the Kush Farm / Seeds game.
//
// ORIGINAL IP ONLY. The MECHANIC (Mendelian heritable stats, mutation tiers, escalating
// breed cost, cooldown) is math and free for anyone. The EXPRESSION is ours: every strain
// name and gene name here is invented for MELEK (Shaivite/temple flavor). NO real cannabis
// brand/strain trademarks (no "OG Kush", "Blue Dream", etc.) — invent, do not port.
//
// Fills the two biggest gaps in the farm design (see .local/GAME_MARKETS_AND_PLANTS_RESEARCH):
//   A5.1 no plant genetics · A5.2 no escalating breed-cost / cooldown supply valve.
//
// Combines: CryptoKitties dominant + mutation-tier, cannabis-native heritable STATS
// (potency/yield/resilience/aroma), Weedcraft "offspring inherit a SUBSET, not a 1:1 blend",
// Hempire rarity-gated breeding, and the Axie escalating-cost + hard breed cap anti-inflation
// valve. RNG is deterministic from L1 ids (blockId+txId+parent ids) — NEVER Math.random.
//
//   import { STRAINS, createStrain, phenotype, canBreed, breedStrains, tradeable, rngFromCtx }
//     from './games/plant-genetics.mjs'
//   node integrations/games/plant-genetics.mjs      # demo: breed two founder strains
//
// PURE: no network, no I/O, no clock. The caller charges `cost`, persists breedCount/readyBlock,
// and mints the offspring seed (seed-tokens.mjs / seed-mint.mjs). Cooldown is measured in L1
// blocks the caller supplies as `nowBlock` — no wall-clock here.

import { makeRng } from './creatures.mjs';

// ---------------------------------------------------------------------------
// Genome. Four numeric heritable STATS (0-100) + one categorical LINEAGE gene.
// Each gene is diploid: [alleleA, alleleB]. For numeric genes the DOMINANT (expressed)
// allele is the higher value — the stronger trait shows. Rarity/quality = sum of the
// expressed stats. Numbers are the cannabis-native part the creature model lacked.
// ---------------------------------------------------------------------------
export const STAT_GENES = ['potency', 'yield', 'resilience', 'aroma'];

// LINEAGE ordered most-dominant -> most-recessive. `ruderalis` (auto-flower, recessive)
// is the rarest and shortens grow time the most. Botanical terms are generic, not brands.
export const LINEAGE = ['hybrid', 'sativa', 'indica', 'ruderalis'];

// grow-time modifier by expressed lineage (Weedcraft: indica shorter/higher-yield lean).
// A multiplier applied by the caller to kush-farm growTier duration. 1.0 = neutral.
export const LINEAGE_GROW_MULT = { hybrid: 1.0, sativa: 1.1, indica: 0.9, ruderalis: 0.75 };

const STAT_MIN = 0;
const STAT_MAX = 100;
const clampStat = (n) => Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(n)));

// ---------------------------------------------------------------------------
// Founder strains — invented MELEK IP (Shaivite/temple/river flavor). `base` genes are
// diploid starter pairs. These are the Gen-0 lines a farm can begin from.
// ---------------------------------------------------------------------------
export const STRAINS = {
  nataraja: {
    name: 'Nataraja',
    blurb: 'A dancer-lineage sativa; tall, bright, high aroma, temperamental in cold.',
    base: { potency: [72, 60], yield: [40, 38], resilience: [30, 28], aroma: [80, 66], lineage: ['sativa', 'hybrid'] },
  },
  soma_rising: {
    name: 'Soma Rising',
    blurb: 'A balanced temple hybrid; the reliable daily workhorse of the garden.',
    base: { potency: [55, 50], yield: [58, 55], resilience: [55, 52], aroma: [50, 48], lineage: ['hybrid', 'hybrid'] },
  },
  kailash_frost: {
    name: 'Kailash Frost',
    blurb: 'A hardy indica off the cold mountain; heavy yield, short flower, calm aroma.',
    base: { potency: [58, 54], yield: [78, 70], resilience: [82, 74], aroma: [36, 34], lineage: ['indica', 'indica'] },
  },
  ganga_green: {
    name: 'Ganga Green',
    blurb: 'A river-valley auto-flower; fast and forgiving, modest but dependable.',
    base: { potency: [44, 40], yield: [50, 46], resilience: [66, 60], aroma: [42, 40], lineage: ['ruderalis', 'indica'] },
  },
};

// ---------------------------------------------------------------------------
// Breeding supply valve (the anti-inflation core).
// ---------------------------------------------------------------------------
// Axie-style escalating cost by the plant's prior breed count (index = times bred before).
// Units are abstract "breedFuel" the caller denominates in Grain/KULA/APIS and BURNS.
export const BREED_COST_SCHEDULE = [100, 200, 300, 500, 800, 1300, 2100];
// Hard cap: a plant can parent at most this many offspring, ever (Axie's 7).
export const MAX_BREEDS = 7;
// Rarity a parent must reach before it may breed a new line (Hempire gate). Tunable.
export const BREED_RARITY_GATE = 'rare';
// Cooldown doubles each breed (CryptoKitties), measured in L1 blocks. base * 2^breedCount, capped.
export const COOLDOWN_BASE_BLOCKS = 300;
export const COOLDOWN_MAX_BLOCKS = 300 * 64; // ceiling so a line is never permanently frozen

// Rarity ladder from summed expressed stats (0-400). Mirrors the Hempire quality gate.
export const RARITY_TIERS = [
  { name: 'common', min: 0 },
  { name: 'uncommon', min: 160 },
  { name: 'rare', min: 220 },
  { name: 'epic', min: 280 },
  { name: 'legendary', min: 340 },
];
const RARITY_RANK = Object.fromEntries(RARITY_TIERS.map((t, i) => [t.name, i]));

export function rarityTier(statSum) {
  let tier = RARITY_TIERS[0].name;
  for (const t of RARITY_TIERS) if (statSum >= t.min) tier = t.name;
  return tier;
}

export function breedCost(breedCount = 0) {
  const i = Math.max(0, Math.min(BREED_COST_SCHEDULE.length - 1, breedCount));
  return BREED_COST_SCHEDULE[i];
}

export function cooldownBlocks(breedCount = 0) {
  return Math.min(COOLDOWN_MAX_BLOCKS, COOLDOWN_BASE_BLOCKS * 2 ** Math.max(0, breedCount));
}

// ---------------------------------------------------------------------------
// Deterministic RNG from L1 ids. FNV-1a over the concatenated ids -> 32-bit seed -> mulberry32.
// Same (block, tx, parents) => same offspring, on every node. Never Math.random.
// ---------------------------------------------------------------------------
export function rngFromCtx({ blockId = '', txId = '', motherId = '', fatherId = '' } = {}) {
  const s = `${blockId}|${txId}|${motherId}|${fatherId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return makeRng(h >>> 0);
}

// ---------------------------------------------------------------------------
// createStrain — build a plant from a founder strain + optional explicit genes.
// ---------------------------------------------------------------------------
export function createStrain({ strain, genes = {}, id } = {}) {
  const spec = STRAINS[strain];
  if (!spec) throw new Error(`unknown strain: ${strain}`);
  const genome = {};
  for (const g of STAT_GENES) {
    const pair = genes[g] || spec.base[g];
    genome[g] = [clampStat(pair[0]), clampStat(pair[1])];
  }
  const lin = genes.lineage || spec.base.lineage;
  for (const allele of lin) if (!LINEAGE.includes(allele)) throw new Error(`unknown lineage "${allele}"`);
  genome.lineage = [lin[0], lin[1]];
  return { strain, name: spec.name, genome, generation: 0, breedCount: 0, readyBlock: 0, id };
}

function dominantLineage(pair) {
  return LINEAGE.indexOf(pair[0]) <= LINEAGE.indexOf(pair[1]) ? pair[0] : pair[1];
}

// ---------------------------------------------------------------------------
// phenotype — the EXPRESSED plant: dominant (higher) stat per gene + lineage + rarity.
// ---------------------------------------------------------------------------
export function phenotype(plant) {
  const out = { strain: plant.strain };
  let statSum = 0;
  for (const g of STAT_GENES) {
    const [a, b] = plant.genome[g];
    const expressed = Math.max(a, b); // dominant allele = higher value
    out[g] = expressed;
    statSum += expressed;
  }
  out.lineage = dominantLineage(plant.genome.lineage);
  out.growMult = LINEAGE_GROW_MULT[out.lineage];
  out.statSum = statSum;
  out.rarity = rarityTier(statSum);
  return out;
}

// ---------------------------------------------------------------------------
// canBreed — the gate. Returns { ok, reasons[] }. Pure; caller supplies nowBlock.
// ---------------------------------------------------------------------------
export function canBreed(mother, father, { nowBlock = 0 } = {}) {
  const reasons = [];
  if (!mother?.genome || !father?.genome) return { ok: false, reasons: ['missing-genome'] };
  if (mother === father || (mother.id != null && mother.id === father.id)) reasons.push('self-breed');
  if ((mother.breedCount || 0) >= MAX_BREEDS) reasons.push('mother-breed-cap');
  if ((father.breedCount || 0) >= MAX_BREEDS) reasons.push('father-breed-cap');
  if (nowBlock < (mother.readyBlock || 0)) reasons.push('mother-cooldown');
  if (nowBlock < (father.readyBlock || 0)) reasons.push('father-cooldown');
  const gate = RARITY_RANK[BREED_RARITY_GATE];
  const motherRank = RARITY_RANK[phenotype(mother).rarity];
  const fatherRank = RARITY_RANK[phenotype(father).rarity];
  if (Math.max(motherRank, fatherRank) < gate) reasons.push('rarity-gate');
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// breedStrains — deterministic cross producing one offspring seed. PURE.
// Returns { ok, reasons?, offspring, cost, motherAfter, fatherAfter }.
// The caller BURNS `cost`, persists the *After plants (breedCount++/readyBlock), and mints
// the offspring as a seed. mutationRate: per-allele chance of drift; fireChance: chance a
// "fire" mutation (big upward jump = the rare legendary lift) fires when both parent alleles
// are already strong (CryptoKitties "matching genes mutate up a tier", capped at 25%).
// ---------------------------------------------------------------------------
export function breedStrains(mother, father, {
  ctx = {}, nowBlock = 0, mutationRate = 0.12, fireChance = 0.25, fireThreshold = 70, driftStep = 8,
} = {}) {
  const gate = canBreed(mother, father, { nowBlock });
  if (!gate.ok) return { ok: false, reasons: gate.reasons };

  const rng = rngFromCtx({
    blockId: ctx.blockId, txId: ctx.txId,
    motherId: mother.id ?? mother.strain, fatherId: father.id ?? father.strain,
  });

  const genome = {};
  for (const g of STAT_GENES) {
    // Mendelian: one allele from each parent (subset, not a 1:1 blend — Weedcraft).
    let fromM = mother.genome[g][rng() < 0.5 ? 0 : 1];
    let fromF = father.genome[g][rng() < 0.5 ? 0 : 1];
    // "fire" mutation tier: both parent alleles already strong -> chance of an upward jump.
    if (fromM >= fireThreshold && fromF >= fireThreshold && rng() < fireChance) {
      const lift = 5 + Math.floor(rng() * 12); // +5..+16
      fromM = clampStat(fromM + lift);
    }
    // ordinary drift: each allele may wander, biased slightly upward so lines can climb.
    const drift = (allele) => {
      if (rng() >= mutationRate) return allele;
      const up = rng() < 0.6;
      const delta = 1 + Math.floor(rng() * driftStep);
      return clampStat(allele + (up ? delta : -delta));
    };
    genome[g] = [drift(fromM), drift(fromF)];
  }
  // lineage: Mendelian pick one from each parent; small chance to shift toward a neighbor.
  {
    let lm = mother.genome.lineage[rng() < 0.5 ? 0 : 1];
    let lf = father.genome.lineage[rng() < 0.5 ? 0 : 1];
    if (rng() < mutationRate) {
      const i = LINEAGE.indexOf(lm);
      const j = Math.max(0, Math.min(LINEAGE.length - 1, i + (rng() < 0.5 ? 1 : -1)));
      lm = LINEAGE[j];
    }
    genome.lineage = [lm, lf];
  }

  // offspring inherits the mother's founder strain label (name lineage), new generation.
  const offspring = {
    strain: mother.strain,
    name: STRAINS[mother.strain].name,
    genome,
    generation: Math.max(mother.generation || 0, father.generation || 0) + 1,
    breedCount: 0,
    readyBlock: 0,
    parents: [mother.id ?? mother.strain, father.id ?? father.strain],
  };

  const cost = breedCost(mother.breedCount || 0);
  const motherAfter = {
    ...mother,
    breedCount: (mother.breedCount || 0) + 1,
    readyBlock: nowBlock + cooldownBlocks((mother.breedCount || 0) + 1),
  };
  const fatherAfter = {
    ...father,
    breedCount: (father.breedCount || 0) + 1,
    readyBlock: nowBlock + cooldownBlocks((father.breedCount || 0) + 1),
  };

  return { ok: true, offspring, cost, motherAfter, fatherAfter };
}

// ---------------------------------------------------------------------------
// tradeable — NFT-ready metadata for a seed/plant. Plugs into economy.mjs rarity and the
// seed-tokens NFT path (rare/legendary strains mint as trait-bearing ERC-1155 seeds).
// ---------------------------------------------------------------------------
export function tradeable(plant) {
  const p = phenotype(plant);
  return {
    kind: 'melek-strain-seed',
    strain: plant.strain,
    name: STRAINS[plant.strain]?.name || plant.strain,
    generation: plant.generation || 0,
    breedCount: plant.breedCount || 0,
    attributes: [
      ...STAT_GENES.map((g) => ({ trait_type: g, value: p[g] })),
      { trait_type: 'lineage', value: p.lineage },
    ],
    rarity: p.rarity,
    statSum: p.statSum,
    growMult: p.growMult,
    genomeFingerprint: [...STAT_GENES, 'lineage']
      .map((g) => `${g}:${plant.genome[g].join('/')}`)
      .join('|'),
  };
}

// ---------------------------------------------------------------------------
// CLI demo (guarded) — original IP only; mechanic free, expression ours.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('plant-genetics.mjs')) {
  const mother = createStrain({ strain: 'kailash_frost', id: 'm1' });
  const father = createStrain({ strain: 'nataraja', id: 'f1' });
  console.log('mother:', tradeable(mother));
  console.log('father:', tradeable(father));
  const res = breedStrains(mother, father, { ctx: { blockId: '0xabc', txId: '0x001' }, nowBlock: 1000 });
  console.log('breed:', res.ok, 'cost:', res.cost);
  console.log('offspring:', tradeable(res.offspring));
  console.log('mother after:', { breedCount: res.motherAfter.breedCount, readyBlock: res.motherAfter.readyBlock });
}
