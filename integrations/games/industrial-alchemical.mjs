// industrial-alchemical.mjs — the DEEP production chains: base materials → intermediates → goods,
// across two branches. This is the "more like Industrial and Alchemical Things" the operator asked
// for — where "paper" is really a chain (wood → ash → lye; fiber → pulp → paper), not a single item.
//
// Grounded in real process history (economic botany + alchemy):
//   INDUSTRIAL
//     • Papermaking: fiber + LYE → pulp → (+ sizing from rosin) → paper.
//     • Wood-ash chemistry: timber → ash → potash → lye (the alkali behind soap, glass, pulp).
//     • Naval stores: pine resin → rosin + turpentine → pitch (rosin+charcoal), sizing, printing ink.
//     • Tanning: bark tannin + hide → leather. Iron-gall ink: tannin + iron.
//     • Soap: oil + lye (saponification). Glass: potash + sand. Charcoal: pyrolyzed wood.
//   ALCHEMICAL (spagyric: separate & recombine the three principles)
//     • Sulfur = essential oil (distillation). Mercury = tincture (macerate in aqua vitae).
//       Salt = plant_salt (calcined ash, leached). Recombine all three → SPAGYRIC ELIXIR (the capstone).
//     • Aqua vitae (distilled spirit), hydrosol + essence, vinegar, alum (mordant) → colorfast mordant-dye.
//
// The value=labor law (recipes.mjs) means a deep chain's output is worth the accumulated LABOR of every
// step — which is exactly why processed goods (paper, elixirs) are valuable and raw plant matter is not.
// Also the education layer: chainFor() traces the full "how it's made," e.g. how a spagyric elixir or
// a Delta cart is produced. PURE, offline-tested.
//
//   import { RECIPES, MATERIALS, VALUES, INDUSTRIAL, ALCHEMICAL, chainFor, familyOf, auditNoPump }
//     from './games/industrial-alchemical.mjs'

import { valueOf } from './plant-catalog.mjs';
import { canCraft, craft, validateNoMoneyPump } from './recipes.mjs';

// Non-plant base inputs (mined/gathered/animal) — cheap; not the value.
export const EXTERNAL = { water: 1, sand: 2, iron: 3, hide: 4 };

// Intermediate/product materials + the DOMAINS each serves (for the UI/versatility view).
export const MATERIALS = {
  // industrial intermediates
  ash: ['industrial'], potash: ['industrial', 'building', 'trade'], lye: ['industrial'],
  charcoal: ['energy', 'industrial', 'art', 'medicine'], pulp: ['paper'], sizing: ['paper'],
  rosin: ['building', 'art', 'trade'], turpentine: ['industrial', 'energy'], pitch: ['building', 'trade'],
  // industrial products
  paper: ['paper', 'art', 'trade'], soap: ['cosmetic', 'trade'], glass: ['building', 'trade'],
  leather: ['craft', 'trade'], iron_gall_ink: ['art', 'trade'], printing_ink: ['art', 'trade'],
  varnish: ['building', 'art'],
  // alchemical intermediates
  aqua_vitae: ['medicine', 'brew', 'alchemy', 'trade'], tincture: ['medicine', 'alchemy'],
  plant_salt: ['alchemy', 'medicine'], hydrosol: ['cosmetic', 'medicine'], vinegar: ['food', 'alchemy'],
  alum: ['dye', 'alchemy', 'leather'],
  // alchemical products
  spagyric_elixir: ['medicine', 'alchemy', 'trade'], essence: ['perfume', 'medicine'],
  mordant_dye: ['textile', 'art'],
  // extended chains
  starch: ['food', 'industrial'], bioplastic: ['industrial', 'building', 'trade'],
  paint: ['art', 'building', 'trade'], perfume: ['perfume', 'trade'], syrup: ['medicine', 'food'],
};

// The chains, in DEPENDENCY ORDER (each recipe's inputs are valued before it). branch = family.
export const RECIPES = [
  // ── INDUSTRIAL ──
  { id: 'burn-ash',        branch: 'industrial', inputs: [{ item: 'timber', qty: 2 }], output: { item: 'ash', qty: 2 }, station: 'kiln', effort: 2 },
  { id: 'char-wood',       branch: 'industrial', inputs: [{ item: 'timber', qty: 2 }], output: { item: 'charcoal', qty: 1 }, station: 'kiln', effort: 3 },
  { id: 'leach-potash',    branch: 'industrial', inputs: [{ item: 'ash', qty: 3 }, { item: 'water', qty: 1 }], output: { item: 'potash', qty: 1 }, station: 'leach-tub', effort: 3 },
  { id: 'make-lye',        branch: 'industrial', inputs: [{ item: 'potash', qty: 1 }, { item: 'water', qty: 1 }], output: { item: 'lye', qty: 1 }, station: 'leach-tub', effort: 2 },
  { id: 'render-rosin',    branch: 'industrial', inputs: [{ item: 'resin', qty: 3 }], output: { item: 'rosin', qty: 2 }, station: 'still', effort: 3 },
  { id: 'make-turpentine', branch: 'industrial', inputs: [{ item: 'resin', qty: 2 }], output: { item: 'turpentine', qty: 1 }, station: 'still', effort: 3 },
  { id: 'cook-pulp',       branch: 'industrial', inputs: [{ item: 'fiber', qty: 3 }, { item: 'lye', qty: 1 }], output: { item: 'pulp', qty: 2 }, station: 'vat', effort: 4 },
  { id: 'make-sizing',     branch: 'industrial', inputs: [{ item: 'rosin', qty: 1 }, { item: 'potash', qty: 1 }], output: { item: 'sizing', qty: 1 }, station: 'vat', effort: 2 },
  { id: 'make-paper',      branch: 'industrial', inputs: [{ item: 'pulp', qty: 2 }, { item: 'sizing', qty: 1 }], output: { item: 'paper', qty: 3 }, station: 'paper-mould', effort: 4 },
  { id: 'make-pitch',      branch: 'industrial', inputs: [{ item: 'rosin', qty: 1 }, { item: 'charcoal', qty: 1 }], output: { item: 'pitch', qty: 2 }, station: 'kiln', effort: 2 },
  { id: 'make-soap',       branch: 'industrial', inputs: [{ item: 'oil', qty: 2 }, { item: 'lye', qty: 1 }], output: { item: 'soap', qty: 2 }, station: 'saponifier', effort: 3 },
  { id: 'make-glass',      branch: 'industrial', inputs: [{ item: 'potash', qty: 1 }, { item: 'sand', qty: 2 }], output: { item: 'glass', qty: 2 }, station: 'furnace', effort: 4 },
  { id: 'tan-leather',     branch: 'industrial', inputs: [{ item: 'hide', qty: 1 }, { item: 'tannin', qty: 2 }], output: { item: 'leather', qty: 1 }, station: 'tannery', effort: 5 },
  { id: 'iron-gall-ink',   branch: 'industrial', inputs: [{ item: 'tannin', qty: 1 }, { item: 'iron', qty: 1 }], output: { item: 'iron_gall_ink', qty: 1 }, station: 'ink-bench', effort: 3 },
  { id: 'printing-ink',    branch: 'industrial', inputs: [{ item: 'rosin', qty: 1 }, { item: 'charcoal', qty: 1 }], output: { item: 'printing_ink', qty: 1 }, station: 'ink-bench', effort: 3 },
  { id: 'make-varnish',    branch: 'industrial', inputs: [{ item: 'rosin', qty: 1 }, { item: 'oil', qty: 1 }], output: { item: 'varnish', qty: 1 }, station: 'ink-bench', effort: 3 },
  { id: 'mill-starch',     branch: 'industrial', inputs: [{ item: 'grain', qty: 3 }], output: { item: 'starch', qty: 2 }, station: 'mill', effort: 2 },
  { id: 'make-bioplastic', branch: 'industrial', inputs: [{ item: 'starch', qty: 2 }, { item: 'oil', qty: 1 }], output: { item: 'bioplastic', qty: 2 }, station: 'press', effort: 4 },
  { id: 'mix-paint',       branch: 'industrial', inputs: [{ item: 'dye', qty: 1 }, { item: 'oil', qty: 1 }, { item: 'water', qty: 1 }], output: { item: 'paint', qty: 2 }, station: 'ink-bench', effort: 3 },
  // ── ALCHEMICAL (spagyric) ──
  { id: 'distill-aquavitae', branch: 'alchemical', inputs: [{ item: 'fruit', qty: 4 }], output: { item: 'aqua_vitae', qty: 1 }, station: 'alembic', effort: 5 },
  { id: 'ferment-vinegar',   branch: 'alchemical', inputs: [{ item: 'fruit', qty: 3 }], output: { item: 'vinegar', qty: 1 }, station: 'crock', effort: 3 },
  { id: 'collect-hydrosol',  branch: 'alchemical', inputs: [{ item: 'herb', qty: 4 }], output: { item: 'hydrosol', qty: 1 }, station: 'alembic', effort: 4 },
  { id: 'macerate-tincture', branch: 'alchemical', inputs: [{ item: 'herb', qty: 2 }, { item: 'aqua_vitae', qty: 1 }], output: { item: 'tincture', qty: 1 }, station: 'maceration-jar', effort: 4 }, // Mercury
  { id: 'calcine-salt',      branch: 'alchemical', inputs: [{ item: 'ash', qty: 2 }, { item: 'water', qty: 1 }], output: { item: 'plant_salt', qty: 1 }, station: 'crucible', effort: 4 }, // Salt
  { id: 'refine-alum',       branch: 'alchemical', inputs: [{ item: 'ash', qty: 2 }, { item: 'water', qty: 1 }], output: { item: 'alum', qty: 1 }, station: 'crucible', effort: 3 },
  { id: 'conjoin-spagyric',  branch: 'alchemical', inputs: [{ item: 'tincture', qty: 1 }, { item: 'essential_oil', qty: 1 }, { item: 'plant_salt', qty: 1 }], output: { item: 'spagyric_elixir', qty: 1 }, station: 'alembic', effort: 8 }, // Sulfur+Mercury+Salt
  { id: 'blend-essence',     branch: 'alchemical', inputs: [{ item: 'hydrosol', qty: 1 }, { item: 'essential_oil', qty: 1 }], output: { item: 'essence', qty: 1 }, station: 'perfume-organ', effort: 4 },
  { id: 'mordant-dye',       branch: 'alchemical', inputs: [{ item: 'dye', qty: 2 }, { item: 'alum', qty: 1 }], output: { item: 'mordant_dye', qty: 2 }, station: 'dye-vat', effort: 3 },
  { id: 'make-syrup',        branch: 'alchemical', inputs: [{ item: 'herb', qty: 2 }, { item: 'sugar', qty: 1 }], output: { item: 'syrup', qty: 1 }, station: 'apothecary', effort: 4 },
  { id: 'blend-perfume',     branch: 'alchemical', inputs: [{ item: 'essence', qty: 1 }, { item: 'aqua_vitae', qty: 1 }], output: { item: 'perfume', qty: 1 }, station: 'perfume-organ', effort: 5 },
];

export const INDUSTRIAL = RECIPES.filter((r) => r.branch === 'industrial');
export const ALCHEMICAL = RECIPES.filter((r) => r.branch === 'alchemical');
const RECIPE_FOR = Object.fromEntries(RECIPES.map((r) => [r.output.item, r]));
export const familyOf = (item) => RECIPE_FOR[item]?.branch || 'base';

// ── values: plant-catalog base (versatility) + external, then produced = floor(inputs + effort) ──
const PLANT_BASE = ['fiber', 'oil', 'resin', 'tannin', 'herb', 'essential_oil', 'dye', 'fruit', 'grain', 'timber', 'sugar'];
export const VALUES = { ...EXTERNAL };
for (const m of PLANT_BASE) VALUES[m] = valueOf(m);
for (const r of RECIPES) {
  if (VALUES[r.output.item] != null) continue; // keep base values (e.g. essential_oil)
  const inVal = r.inputs.reduce((n, i) => n + (VALUES[i.item] ?? 2) * i.qty, 0);
  VALUES[r.output.item] = Math.max(1, Math.floor((inVal + r.effort) / r.output.qty));
}

export function auditNoPump() { return validateNoMoneyPump(RECIPES, VALUES); }
export { canCraft, craft } from './recipes.mjs';

/** chainFor — trace a product back through its recipes to base materials (the "how it's made" tree). */
export function chainFor(item, depth = 0) {
  const r = RECIPE_FOR[item];
  if (!r || depth > 12) return { item, base: true, value: VALUES[item] ?? valueOf(item) };
  return {
    item, branch: r.branch, station: r.station, effort: r.effort, value: VALUES[item],
    from: r.inputs.map((i) => ({ qty: i.qty, ...chainFor(i.item, depth + 1) })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('industrial-alchemical.mjs')) {
  console.log('no-money-pump audit:', auditNoPump().ok ? 'PASS' : 'FAIL');
  console.log(`\nINDUSTRIAL products: ${INDUSTRIAL.map((r) => r.output.item).join(', ')}`);
  console.log(`ALCHEMICAL products: ${ALCHEMICAL.map((r) => r.output.item).join(', ')}`);
  console.log('\nPAPER is a chain (value = accumulated labor):');
  console.log(JSON.stringify(chainFor('paper'), null, 1));
  console.log('\nSPAGYRIC ELIXIR = Sulfur + Mercury + Salt recombined:');
  console.log(JSON.stringify(chainFor('spagyric_elixir'), null, 1));
}
