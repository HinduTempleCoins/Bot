// dyes.mjs — natural dyes from FLOWERS, roots, FUNGUS/lichen, INSECTS (cochineal/lac) and hulls.
// The craft twist real dyers know: the same pigment gives DIFFERENT colors depending on the MORDANT —
// alum keeps it true & bright, iron "saddens" (darkens) it, copper shifts it green, no mordant = a
// fugitive (fast-fading) color. So one flower is several dyes. Finished dye colors silk/wool/leather
// (from the other modules) → higher value; the `dye` domain already exists in the plant catalog.
//
// Sources span the living stack: flowers/roots (plant catalog), fungus & lichen (new), and the
// cochineal/lac INSECTS (the dye thread off insect-ecosystem). Mordants tie to industrial-alchemical's
// mordant_dye step (alum/iron/copper/tannin).
//
// PURE + deterministic (L1-derived rng). Offline-tested.
//
//   import { DYE_SOURCES, COLORS, MORDANTS, MATERIALS, extractPigment, applyMordant, dye,
//            sourcesForColor, byKind, versatilityOf, dyeWeb } from './games/dyes.mjs'

import { rngFromCtx } from './plant-genetics.mjs';

export const MATERIALS = {
  pigment: { name: 'Pigment', domains: ['dye', 'art', 'craft'] },
  dye:     { name: 'Dye',     domains: ['dye', 'textile', 'craft', 'art', 'cosmetic', 'trade'] }, // finished, very versatile
};
export const versatilityOf = (m) => (MATERIALS[m]?.domains?.length || 0);

export const COLORS = ['yellow', 'orange', 'red', 'crimson', 'pink', 'purple', 'blue', 'green', 'brown', 'black'];
export const MORDANTS = ['none', 'alum', 'iron', 'copper', 'tannin'];

// ---------------------------------------------------------------------------
// DYE_SOURCES — kind ∈ flower | root | fungus | lichen | insect | hull. color = the alum-mordanted base.
// potency = pigment yield. Insect sources note origin; they come via insect-ecosystem, from the cycle.
// ---------------------------------------------------------------------------
export const DYE_SOURCES = {
  // flowers
  marigold:   { name: 'Marigold',      kind: 'flower', color: 'yellow', potency: 6 },
  coreopsis:  { name: 'Coreopsis',     kind: 'flower', color: 'orange', potency: 5 },
  hibiscus:   { name: 'Hibiscus',      kind: 'flower', color: 'pink',   potency: 4 },
  safflower:  { name: 'Safflower',     kind: 'flower', color: 'red',    potency: 5 },
  weld:       { name: 'Weld',          kind: 'flower', color: 'yellow', potency: 8 },   // the classic bright yellow
  // roots / plants
  madder:     { name: 'Madder Root',   kind: 'root',   color: 'red',    potency: 9 },
  turmeric:   { name: 'Turmeric',      kind: 'root',   color: 'yellow', potency: 7 },
  indigo:     { name: 'Indigo',        kind: 'root',   color: 'blue',   potency: 9 },   // vat dye (no mordant needed)
  // fungus & lichen
  dyer_polypore: { name: "Dyer's Polypore", kind: 'fungus', color: 'brown', potency: 5 },
  orchil_lichen: { name: 'Orchil Lichen',   kind: 'lichen', color: 'purple', potency: 6 },
  // insects (from the cycle — cochineal on cactus, lac on trees)
  cochineal:  { name: 'Cochineal',     kind: 'insect', color: 'crimson', potency: 9 },  // the prized scarlet
  lac_insect: { name: 'Lac Insect',    kind: 'insect', color: 'red',     potency: 6 },  // also shellac (industrial)
  // hulls / galls
  walnut_hull:{ name: 'Walnut Hull',   kind: 'hull',   color: 'brown',  potency: 7 },
  logwood:    { name: 'Logwood',       kind: 'hull',   color: 'purple', potency: 8 },
  oak_gall:   { name: 'Oak Gall',      kind: 'hull',   color: 'black',  potency: 6 },   // tannin-rich; with iron → true black
};
export const byKind = (kind) => Object.entries(DYE_SOURCES).filter(([, s]) => s.kind === kind).map(([k]) => k);

// How a mordant transforms a base color (real dyer behavior). iron saddens, copper greens.
const IRON_SHIFT = { yellow: 'brown', orange: 'brown', red: 'purple', crimson: 'purple', pink: 'purple', blue: 'black', green: 'green', brown: 'black', purple: 'black', black: 'black' };
const COPPER_SHIFT = { yellow: 'green', orange: 'green', red: 'brown', crimson: 'brown', pink: 'purple', blue: 'green', green: 'green', brown: 'green', purple: 'blue', black: 'black' };

/** applyMordant — final color + fastness for a base color under a mordant. */
export function applyMordant(baseColor, mordant = 'alum') {
  if (mordant === 'iron')   return { color: IRON_SHIFT[baseColor] || baseColor, fastness: 'high' };
  if (mordant === 'copper') return { color: COPPER_SHIFT[baseColor] || baseColor, fastness: 'high' };
  if (mordant === 'tannin') return { color: baseColor, fastness: 'medium' };
  if (mordant === 'alum')   return { color: baseColor, fastness: 'high' };
  return { color: baseColor, fastness: 'fugitive' };   // none → fades fast
}

/** extractPigment — cook a source into raw pigment (amount scales with potency; deterministic). */
export function extractPigment(sourceKey, { ctx = {}, amount = 1 } = {}) {
  const s = DYE_SOURCES[sourceKey];
  if (!s) return { ok: false, reason: 'not-a-dye-source' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: sourceKey, fatherId: 'extract' });
  const pigment = Math.round(s.potency * Math.max(1, amount) * (0.7 + rng() * 0.6) * 10) / 10;
  return { ok: true, source: sourceKey, kind: s.kind, baseColor: s.color, pigment };
}

/**
 * dye — the full step: extract a source's pigment and set it with a mordant → a finished DYE of a
 * final color + fastness. Indigo is a vat dye (works with no mordant). Same source + different mordant
 * = a different dye, so one flower is several colors.
 */
export function dye(sourceKey, { mordant = 'alum', ctx = {}, amount = 1 } = {}) {
  const ext = extractPigment(sourceKey, { ctx, amount });
  if (!ext.ok) return ext;
  const vat = sourceKey === 'indigo';
  const m = vat ? { color: 'blue', fastness: 'high' } : applyMordant(ext.baseColor, mordant);
  return { ok: true, source: sourceKey, mordant: vat ? 'vat' : mordant, color: m.color, fastness: m.fastness, dye: ext.pigment };
}

/** sourcesForColor — which sources (alum-base) give a color (before mordant shifting). */
export const sourcesForColor = (color) => Object.entries(DYE_SOURCES).filter(([, s]) => s.color === color).map(([k]) => k);

/** dyeWeb — every source → its base color + the palette its mordants unlock (UI/education). */
export function dyeWeb() {
  return Object.entries(DYE_SOURCES).map(([key, s]) => ({
    source: key, name: s.name, kind: s.kind, base: s.color,
    withIron: applyMordant(s.color, 'iron').color, withCopper: applyMordant(s.color, 'copper').color,
  }));
}

if (process.argv[1] && process.argv[1].endsWith('dyes.mjs')) {
  const ctx = { blockId: '0xdye', txId: '0x1' };
  console.log('marigold + alum →', dye('marigold', { mordant: 'alum', ctx }));
  console.log('marigold + iron (saddened) →', dye('marigold', { mordant: 'iron', ctx }));
  console.log('cochineal + alum (scarlet) →', dye('cochineal', { mordant: 'alum', ctx }));
  console.log('indigo (vat, no mordant) →', dye('indigo', { ctx }));
  console.log('fungus dyes:', byKind('fungus'), '| lichen:', byKind('lichen'));
  console.log('who gives red:', sourcesForColor('red'));
}
