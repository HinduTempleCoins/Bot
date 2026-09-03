// strains-catalog.mjs — real cannabis strain NAMING data for the Kush Farm / Seeds breeding game.
//
// Purpose: give the breeding game authentic strain names + lineage, so a player breeding
// landrace roots up through classic hybrids gets recognizable, real-genetics names.
//
// PROVENANCE (honest): the LANDRACE roster is confirmed from SeedFinder.eu's "original strains"
// genealogy (https://seedfinder.eu/en/strain-info/indica-sativa/original-strains/genealogy,
// pulled 2026-09-01). The HYBRID lineages below are compiled from SeedFinder's genealogy database
// plus long-established, widely-published strain genetics; they are cross-checkable on SeedFinder
// but were NOT each individually re-fetched here. Contested parentages are marked `disputed:true`.
//
// IP NOTE: cannabis strain names are largely generic folk names (not federally trademarkable while
// federally illegal). A few ARE brand-controlled — those carry `brand:{owner,reason,alt}` with a
// MELEK-original alternative. `namingPolicy()` lets the operator choose: 'real', 'safe' (swap
// brand-flagged for the alt), or 'melek' (use only invented names from plant-genetics STRAINS).
//
//   import { LANDRACES, HYBRIDS, allStrains, byType, pickStrainName, lineageOf, BRAND_FLAGGED }
//     from './data/strains-catalog.mjs'
//   node integrations/games/data/strains-catalog.mjs      # demo counts + a sampling

// type: 'indica' | 'sativa' | 'hybrid' | 'ruderalis'
// era:  'landrace' | 'classic' | 'modern'

// ---------------------------------------------------------------------------
// LANDRACES — foundational roots (SeedFinder original-strains, confirmed). These are the Gen-0
// founder pool: breeding starts here. `region` is the geographic origin.
// ---------------------------------------------------------------------------
export const LANDRACES = [
  { key: 'afghani', name: 'Afghani', region: 'Afghanistan', type: 'indica', era: 'landrace' },
  { key: 'hindu_kush', name: 'Hindu Kush', region: 'Afghanistan/Pakistan', type: 'indica', era: 'landrace' },
  { key: 'pakistan', name: 'Pakistan Landrace', region: 'Pakistan', type: 'indica', era: 'landrace' },
  { key: 'balochistan', name: 'Balochistan Landrace', region: 'Balochistan', type: 'indica', era: 'landrace' },
  { key: 'north_indian', name: 'North Indian Landrace', region: 'North India', type: 'indica', era: 'landrace' },
  { key: 'south_indian', name: 'South Indian Landrace', region: 'South India', type: 'indica', era: 'landrace' },
  { key: 'nepalese', name: 'Nepalese', region: 'Nepal', type: 'sativa', era: 'landrace' },
  { key: 'thai', name: 'Thai', region: 'Thailand', type: 'sativa', era: 'landrace' },
  { key: 'vietnamese', name: 'Vietnamese Landrace', region: 'Vietnam', type: 'sativa', era: 'landrace' },
  { key: 'colombian', name: 'Colombian Gold', region: 'Colombia', type: 'sativa', era: 'landrace' },
  { key: 'acapulco', name: 'Acapulco Gold', region: 'Mexico', type: 'sativa', era: 'landrace' },
  { key: 'mexican', name: 'Mexican', region: 'Mexico', type: 'sativa', era: 'landrace' },
  { key: 'durban', name: 'Durban Poison', region: 'South Africa', type: 'sativa', era: 'landrace' },
  { key: 'south_african', name: 'South African', region: 'South Africa', type: 'sativa', era: 'landrace' },
  { key: 'syrian', name: 'Syrian Landrace', region: 'Syria', type: 'indica', era: 'landrace' },
  { key: 'mexican_ruderalis', name: 'Mexican Ruderalis', region: 'Mexico', type: 'ruderalis', era: 'landrace' },
];

// ---------------------------------------------------------------------------
// HYBRIDS — classic + modern, with lineage (parent names). `disputed` flags contested parentage.
// `brand` marks names entangled with a real trademark, with a MELEK-original `alt`.
// ---------------------------------------------------------------------------
export const HYBRIDS = [
  // --- classic foundation hybrids ---
  { key: 'northern_lights', name: 'Northern Lights', type: 'indica', era: 'classic', lineage: ['Afghani'] },
  { key: 'skunk_1', name: 'Skunk #1', type: 'hybrid', era: 'classic', lineage: ['Afghani', 'Acapulco Gold', 'Colombian Gold'] },
  { key: 'haze', name: 'Haze', type: 'sativa', era: 'classic', lineage: ['Colombian Gold', 'Mexican', 'Thai', 'South Indian Landrace'] },
  { key: 'hash_plant', name: 'Hash Plant', type: 'indica', era: 'classic', lineage: ['Afghani', 'Northern Lights'], disputed: true },
  { key: 'master_kush', name: 'Master Kush', type: 'indica', era: 'classic', lineage: ['Hindu Kush', 'Skunk #1'], disputed: true },
  { key: 'purple_kush', name: 'Purple Kush', type: 'indica', era: 'classic', lineage: ['Hindu Kush', 'Purple Afghani'] },
  { key: 'blueberry', name: 'Blueberry', type: 'indica', era: 'classic', lineage: ['Afghani', 'Thai', 'Purple Thai'] },
  { key: 'white_widow', name: 'White Widow', type: 'hybrid', era: 'classic', lineage: ['Brazilian Sativa', 'South Indian Landrace'] },
  { key: 'ak47', name: 'AK-47', type: 'hybrid', era: 'classic', lineage: ['Colombian Gold', 'Mexican', 'Thai', 'Afghani'] },
  { key: 'jack_herer', name: 'Jack Herer', type: 'hybrid', era: 'classic', lineage: ['Haze', 'Northern Lights', 'Shiva Skunk'] },
  { key: 'super_silver_haze', name: 'Super Silver Haze', type: 'sativa', era: 'classic', lineage: ['Skunk #1', 'Northern Lights', 'Haze'] },
  { key: 'trainwreck', name: 'Trainwreck', type: 'sativa', era: 'classic', lineage: ['Mexican', 'Thai', 'Afghani'] },
  { key: 'chemdawg', name: 'Chemdawg', type: 'hybrid', era: 'classic', lineage: ['Nepalese', 'Thai'], disputed: true },
  { key: 'sour_diesel', name: 'Sour Diesel', type: 'sativa', era: 'classic', lineage: ['Chemdawg', 'Super Skunk', 'Northern Lights'], disputed: true },
  { key: 'og_kush', name: 'OG Kush', type: 'hybrid', era: 'classic', lineage: ['Chemdawg', 'Hindu Kush'], disputed: true },
  { key: 'bubba_kush', name: 'Bubba Kush', type: 'indica', era: 'classic', lineage: ['OG Kush', 'Northern Lights'], disputed: true },
  { key: 'amnesia_haze', name: 'Amnesia Haze', type: 'sativa', era: 'classic', lineage: ['Haze', 'Afghani', 'Skunk #1'] },

  // --- modern (some brand-entangled → flagged with an alt) ---
  { key: 'gsc', name: 'GSC', type: 'hybrid', era: 'modern', lineage: ['OG Kush', 'Durban Poison'],
    brand: { owner: 'Girl Scouts of the USA', reason: 'the full name "Girl Scout Cookies" drew a C&D; industry uses "GSC"', alt: 'Temple Cookies' } },
  { key: 'gg4', name: 'GG4 (Original Glue)', type: 'hybrid', era: 'modern', lineage: ['Chems Sister', 'Sour Dubb', 'Chocolate Diesel'],
    brand: { owner: 'Gorilla Glue Co.', reason: 'adhesive maker sued; strain renamed from "Gorilla Glue" to "GG4/Original Glue"', alt: 'Kailash Glue' } },
  { key: 'granddaddy_purple', name: 'Granddaddy Purple', type: 'indica', era: 'modern', lineage: ['Purple Urkle', 'Big Bud'],
    brand: { owner: 'Ken Estes / GDP brand', reason: 'associated with a specific breeder brand', alt: 'Grandfather Ganga' } },
  { key: 'green_crack', name: 'Green Crack', type: 'sativa', era: 'modern', lineage: ['Skunk #1'],
    brand: { owner: '(cultural)', reason: 'name references crack cocaine; many catalogs prefer "Green Cush"', alt: 'Green Cush' } },
  { key: 'gelato', name: 'Gelato', type: 'hybrid', era: 'modern', lineage: ['Sunset Sherbet', 'Thin Mint GSC'],
    brand: { owner: 'Cookies (Berner)', reason: 'closely tied to the Cookies brand family', alt: 'Soma Gelato' } },
  { key: 'wedding_cake', name: 'Wedding Cake', type: 'hybrid', era: 'modern', lineage: ['Triangle Kush', 'Animal Mints'] },
  { key: 'zkittlez', name: 'Zkittlez', type: 'indica', era: 'modern', lineage: ['Grape Ape', 'Grapefruit'],
    brand: { owner: 'Wrigley (Skittles)', reason: 'stylized to dodge the candy trademark; still risky', alt: 'Prasad Drops' } },
];

// ---------------------------------------------------------------------------
// Brand-flagged index + helpers
// ---------------------------------------------------------------------------
export const BRAND_FLAGGED = HYBRIDS.filter((s) => s.brand);

export function allStrains() {
  return [...LANDRACES, ...HYBRIDS];
}

export function byType(type) {
  return allStrains().filter((s) => s.type === type);
}

export function lineageOf(nameOrKey) {
  const s = allStrains().find((x) => x.key === nameOrKey || x.name === nameOrKey);
  return s?.lineage || null;
}

// Map the game's 5-tier rarity onto strain era (deeper lineage = rarer/more prestigious name).
const RARITY_POOL = {
  common: ['landrace'],
  uncommon: ['landrace', 'classic'],
  rare: ['classic'],
  epic: ['classic', 'modern'],
  legendary: ['modern', 'classic'],
};

// pickStrainName — choose an authentic name for an offspring by rarity/type. Deterministic given
// an injected rng (use plant-genetics rngFromCtx so on-chain naming is reproducible). `policy`:
// 'real' (as-is) | 'safe' (swap brand-flagged for their MELEK alt) | 'melek' (caller should use
// plant-genetics invented STRAINS instead — returns null so the caller falls back).
export function pickStrainName({ rng = Math.random, rarity = 'common', type = null, policy = 'safe' } = {}) {
  if (policy === 'melek') return null;
  const eras = RARITY_POOL[rarity] || ['landrace'];
  let pool = allStrains().filter((s) => eras.includes(s.era) && (!type || s.type === type));
  if (pool.length === 0) pool = allStrains().filter((s) => eras.includes(s.era));
  if (pool.length === 0) pool = allStrains();
  const pick = pool[Math.floor(rng() * pool.length)];
  if (policy === 'safe' && pick.brand) return { name: pick.brand.alt, from: pick.name, swapped: true, key: pick.key };
  return { name: pick.name, from: pick.name, swapped: false, key: pick.key };
}

export function namingPolicies() {
  return {
    real: 'Use authentic strain names as-is (brand-flagged included). Highest authenticity, highest IP risk.',
    safe: 'Use authentic names but swap the few brand-entangled ones for MELEK-original alternates. Recommended default.',
    melek: 'Use only invented MELEK strain names (plant-genetics STRAINS). Zero IP risk, lower authenticity.',
  };
}

// ---------------------------------------------------------------------------
// CLI demo (guarded)
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('strains-catalog.mjs')) {
  console.log(`landraces: ${LANDRACES.length} · hybrids: ${HYBRIDS.length} · brand-flagged: ${BRAND_FLAGGED.length}`);
  console.log('by type:', {
    indica: byType('indica').length, sativa: byType('sativa').length,
    hybrid: byType('hybrid').length, ruderalis: byType('ruderalis').length,
  });
  console.log('brand-flagged →', BRAND_FLAGGED.map((s) => `${s.name} → ${s.brand.alt}`));
  let seed = 7;
  const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  console.log('sample names (safe policy):', ['common', 'rare', 'legendary'].map((r) => pickStrainName({ rng, rarity: r }).name));
  console.log('Skunk #1 lineage:', lineageOf('skunk_1'));
}
