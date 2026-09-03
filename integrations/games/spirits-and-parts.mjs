// spirits-and-parts.mjs — animal SPIRITS (stored, cross-game) + obscure random PARTS (used in labs/rituals).
//
// When an animal completes its natural cycle (aquatic-farm / ranch / combat), it leaves two things:
//   1. A SPIRIT — sometimes capturable into a vessel/soul-gem (an NFT). Stored, tradeable, and usable in
//      OTHER games: summon a familiar/thrall, fuel a ritual, or grant an affinity boon. This is the
//      Well-of-Souls / soul-gem idea as cross-game portable asset.
//   2. Obscure PARTS — NOT a readable genome. The creature's genetics are HIDDEN and expressed only as a
//      random draw of parts (bone, gland, ichor, essence…), each with uses you don't know until you
//      IDENTIFY them (Oblivion-style discovery). Parts feed the LAB (alchemy) and the RITUAL (necromancy).
//
// The respectful line (from the sacrifice research): remains come ONLY from the natural cycle / combat —
// the game never rewards harming an animal for its parts. harvestRemains() requires a natural death.
//
// PURE + deterministic (L1-derived rng; never Math.random/clock). Offline-tested.
//
//   import { PARTS, SPIRIT_TIERS, harvestRemains, captureSpirit, identifyPart, usesOfPart,
//            useSpirit, partKind } from './games/spirits-and-parts.mjs'

import { rngFromCtx } from './plant-genetics.mjs';

// ---------------------------------------------------------------------------
// PARTS — obscure by default. `uses` are HIDDEN until a part is identified (skill/experiment).
// Each use is a tag a lab or ritual consumes. weight = base draw-likelihood (rarer = lower).
// ---------------------------------------------------------------------------
export const PARTS = {
  bone:    { name: 'Bone',    weight: 30, uses: ['ritual-necromancy', 'craft-tool', 'lab-calcify'] },
  marrow:  { name: 'Marrow',  weight: 18, uses: ['lab-tincture', 'ritual-vigor'] },
  sinew:   { name: 'Sinew',   weight: 20, uses: ['craft-binding', 'craft-bowstring'] },
  hide:    { name: 'Hide',    weight: 22, uses: ['craft-leather', 'craft-armor'] },
  gland:   { name: 'Gland',   weight: 12, uses: ['lab-poison', 'lab-potion', 'alchemy-reagent'] },
  tooth:   { name: 'Tooth',   weight: 14, uses: ['craft-charm', 'ritual-ward'] },
  scale:   { name: 'Scale',   weight: 14, uses: ['craft-decor', 'alchemy-reagent'] },
  ash:     { name: 'Ash',     weight: 16, uses: ['ritual-necromancy', 'lab-salt'] },
  ichor:   { name: 'Ichor',   weight: 5,  uses: ['lab-elixir', 'ritual-anima'] },   // rare
  essence: { name: 'Essence', weight: 3,  uses: ['alchemy-magnum-opus', 'ritual-soul'] }, // rarest
};
export const partKind = (k) => PARTS[k] || null;
export const usesOfPart = (k) => PARTS[k]?.uses || [];

export const SPIRIT_TIERS = ['faint', 'lesser', 'greater', 'grand'];
// affinity = the domain a spirit empowers when used in another game.
export const SPIRIT_AFFINITIES = ['growth', 'tide', 'war', 'fortune', 'ward'];

// A creature's obscured "genetics": traits (0-100) weight the draw. Higher rarity/traits => more &
// rarer parts and a higher spirit tier — but the player never sees a genome, only the outcomes.
function creatureBudget(animal) {
  const t = animal.traits || {};
  const q = (Number(t.size) || 50) + (Number(t.hardiness) || 50) + (Number(t.fertility) || 50); // 0-300
  const rarityBoost = ({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[animal.rarity] || 0);
  return { count: 2 + Math.floor(q / 90) + rarityBoost, quality: q / 300 + rarityBoost / 8 }; // ~2-6 parts
}

function weightedDraw(rng, quality) {
  // rarer parts get a boost proportional to creature quality (obscured genetics expressed as luck)
  const entries = Object.entries(PARTS).map(([k, p]) => [k, p.weight * (1 + (10 - p.weight / 3) * quality / 10)]);
  const total = entries.reduce((n, [, w]) => n + Math.max(0.1, w), 0);
  let r = rng() * total;
  for (const [k, w] of entries) { if (r < w) return k; r -= w; }
  return entries[0][0];
}

// ---------------------------------------------------------------------------
// harvestRemains — from a NATURALLY-deceased animal: obscure parts + maybe a spirit. Requires natural death.
// ---------------------------------------------------------------------------
export function harvestRemains(animal, { ctx = {}, natural = false } = {}) {
  if (!natural && animal?.cause !== 'natural' && animal?.cause !== 'combat') {
    return { ok: false, reason: 'not-natural-death' }; // the game never rewards killing for parts
  }
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: animal.id ?? animal.species, fatherId: 'remains' });
  const { count, quality } = creatureBudget(animal);
  const parts = {}; // kind -> qty (obscure; uses unknown until identified)
  for (let i = 0; i < count; i++) { const k = weightedDraw(rng, quality); parts[k] = (parts[k] || 0) + 1; }
  const spirit = maybeSpirit(animal, rng, quality);
  return { ok: true, parts, spirit };
}

function spiritTierFor(quality) {
  const i = Math.min(SPIRIT_TIERS.length - 1, Math.floor(quality * SPIRIT_TIERS.length));
  return SPIRIT_TIERS[i];
}
function maybeSpirit(animal, rng, quality) {
  // a spirit lingers only SOMETIMES (chance rises with quality); can also be forced by a capture ritual.
  const chance = 0.15 + quality * 0.4;
  if (rng() >= chance) return null;
  return {
    id: null, kind: 'animal-spirit', species: animal.species,
    tier: spiritTierFor(quality),
    affinity: SPIRIT_AFFINITIES[Math.floor(rng() * SPIRIT_AFFINITIES.length)],
    stored: true,
  };
}

/** captureSpirit — a binding ritual that GUARANTEES the spirit into a vessel (the "store it" mechanic). */
export function captureSpirit(animal, { ctx = {} } = {}) {
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: animal.id ?? animal.species, fatherId: 'capture' });
  const { quality } = creatureBudget(animal);
  return {
    id: `spirit-${animal.species}-${Math.floor(rng() * 1e6)}`, kind: 'animal-spirit', species: animal.species,
    tier: spiritTierFor(quality), affinity: SPIRIT_AFFINITIES[Math.floor(rng() * SPIRIT_AFFINITIES.length)], stored: true,
  };
}

/** identifyPart — reveal a part's uses (obscure → known). Oblivion-style discovery, skill-gated count. */
export function identifyPart(kind, { skill = 100 } = {}) {
  const p = PARTS[kind];
  if (!p) return { ok: false, reason: 'unknown-part' };
  const n = Math.max(1, Math.min(p.uses.length, 1 + Math.floor((Number(skill) || 0) / 34))); // 1..all
  return { ok: true, kind, revealed: p.uses.slice(0, n), total: p.uses.length };
}

/**
 * useSpirit — the CROSS-GAME use of a stored animal spirit. `as`:
 *   'summon'  → a familiar/thrall of the spirit's tier (combat games)
 *   'ritual'  → soul-fuel for a necromancy/offering ritual
 *   'boost'   → an affinity boon (growth/tide/war/fortune/ward) in any game
 * Consumes the spirit (terminal sink). Deterministic magnitude by tier.
 */
export function useSpirit(spirit, as = 'boost') {
  if (!spirit || spirit.kind !== 'animal-spirit') throw new Error('need an animal spirit');
  const power = (SPIRIT_TIERS.indexOf(spirit.tier) + 1) * 10; // faint 10 … grand 40
  if (as === 'summon') return { kind: 'familiar', species: spirit.species, tier: spirit.tier, power, consumed: spirit.id };
  if (as === 'ritual') return { kind: 'soul-fuel', tier: spirit.tier, potency: power, consumed: spirit.id };
  return { kind: 'boon', stat: spirit.affinity, pct: power, consumed: spirit.id };
}

if (process.argv[1] && process.argv[1].endsWith('spirits-and-parts.mjs')) {
  const oyster = { species: 'oyster', id: 'o1', traits: { size: 80, hardiness: 74, fertility: 60 }, rarity: 'rare', cause: 'natural' };
  const r = harvestRemains(oyster, { ctx: { blockId: '0xabc', txId: '0x9' }, natural: true });
  console.log('remains of a rare oyster (obscure parts + maybe spirit):', r);
  console.log('identify a gland at skill 100:', identifyPart('gland', { skill: 100 }));
  const s = captureSpirit(oyster, { ctx: { blockId: '0xabc', txId: '0x9' } });
  console.log('captured spirit:', s);
  console.log('use it as a summon in another game:', useSpirit(s, 'summon'));
}
