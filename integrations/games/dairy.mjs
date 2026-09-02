// dairy.mjs — milk & fermented dairy: the bridge from ANIMALS (milk) through the MICROBE LAB (cultures +
// rennet) to yogurt, kefir, cheese, butter, ghee. Every step branches and nothing is a dead end: milk →
// cream/skim → butter/buttermilk → ghee; milk + probiotic → yogurt/kefir; milk + rennet(enzyme) →
// cheese + WHEY; whey → feeds the microbe lab (it's a substrate) + feeds livestock + makes ricotta.
//
// The microbe dependency is REAL: fermentMilk needs a 'probiotic' starter and makeCheese needs an
// 'enzyme' (rennet) — both are microbe-lab.PRODUCTS. No culture, no yogurt/cheese.
//
// Ghee carries a medicine domain (ayurvedic clarified butter) — on-theme with the Botanica/Shaiva twin.
//
// PURE + deterministic (L1-derived rng). Offline-tested.
//
//   import { DAIRY_ANIMALS, MATERIALS, milkAnimal, separate, churn, clarify, fermentMilk,
//            makeCheese, versatilityOf, dairyWeb } from './games/dairy.mjs'

import { rngFromCtx } from './plant-genetics.mjs';
import { PRODUCTS as MICROBE_PRODUCTS } from './microbe-lab.mjs';

// ---------------------------------------------------------------------------
// MATERIALS — domains drive versatility. Whey is the quiet MVP: feed + culture substrate + food.
// ---------------------------------------------------------------------------
export const MATERIALS = {
  milk:       { name: 'Milk',       domains: ['food', 'alchemy', 'trade'] },
  cream:      { name: 'Cream',      domains: ['food', 'alchemy'] },
  skim:       { name: 'Skim Milk',  domains: ['food', 'feed'] },
  yogurt:     { name: 'Yogurt',     domains: ['food', 'medicine'] },
  kefir:      { name: 'Kefir',      domains: ['food', 'medicine'] },
  cheese:     { name: 'Cheese',     domains: ['food', 'trade', 'alchemy'] },
  whey:       { name: 'Whey',       domains: ['feed', 'substrate', 'food'] },   // → microbe-lab substrate + livestock feed + ricotta
  butter:     { name: 'Butter',     domains: ['food', 'alchemy'] },
  buttermilk: { name: 'Buttermilk', domains: ['food', 'feed'] },
  ghee:       { name: 'Ghee',       domains: ['food', 'medicine', 'alchemy', 'trade'] },   // clarified butter — most versatile
  casein:     { name: 'Casein',     domains: ['craft', 'bioplastic', 'glue'] },            // milk protein → industrial
  ricotta:    { name: 'Ricotta',    domains: ['food'] },
};
export const versatilityOf = (m) => (MATERIALS[m]?.domains?.length || 0);

// Milk animals — yield (units/cycle) and fat fraction (drives how much cream separates out).
export const DAIRY_ANIMALS = {
  cow:     { name: 'Cow',     class: 'livestock', yield: 8, fat: 0.04 },
  goat:    { name: 'Goat',    class: 'livestock', yield: 3, fat: 0.04 },
  sheep:   { name: 'Sheep',   class: 'livestock', yield: 2, fat: 0.07 },
  buffalo: { name: 'Buffalo', class: 'livestock', yield: 5, fat: 0.08 },   // richest — best for ghee/cheese
};

/** milkAnimal — a milking gives milk (scaled by yield + a small deterministic daily variance). */
export function milkAnimal(animalKey, { ctx = {}, cycles = 1 } = {}) {
  const a = DAIRY_ANIMALS[animalKey];
  if (!a) return { ok: false, reason: 'not-a-dairy-animal' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: animalKey, fatherId: 'milk' });
  let milk = 0;
  for (let c = 0; c < Math.max(1, cycles); c++) milk += a.yield * (0.85 + rng() * 0.3);
  return { ok: true, animal: animalKey, milk: Math.round(milk * 10) / 10, fat: a.fat };
}

/** separate — split milk into cream + skim. Cream fraction tracks the animal's fat (default cow ~4%). */
export function separate(milk, { fat = 0.04 } = {}) {
  const cream = Math.round(milk * fat * 4 * 100) / 100;   // cream is fat-rich, ~4x the fat fraction of volume
  const skim = Math.round((milk - cream) * 100) / 100;
  return { ok: true, cream, skim };
}

/** churn — cream → butter + buttermilk. Deterministic split. */
export function churn(cream, { ctx = {} } = {}) {
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: 'cream', fatherId: 'churn' });
  const butter = Math.round(cream * (0.45 + rng() * 0.1) * 100) / 100;
  const buttermilk = Math.round((cream - butter) * 100) / 100;
  return { ok: true, butter, buttermilk };
}

/** clarify — butter → ghee (+ milk solids). The ayurvedic step; ghee is shelf-stable + medicinal. */
export function clarify(butter) {
  const ghee = Math.round(butter * 0.8 * 100) / 100;
  const milk_solids = Math.round(butter * 0.2 * 100) / 100;
  return { ok: true, ghee, milk_solids };
}

/**
 * fermentMilk — milk + a live culture → yogurt or kefir. Requires a 'probiotic' starter (a microbe-lab
 * PRODUCT). No culture, no ferment. kind ∈ {yogurt, kefir}.
 */
export function fermentMilk(milk, { starter = 'probiotic', kind = 'yogurt', ctx = {} } = {}) {
  if (starter !== 'probiotic' || !MICROBE_PRODUCTS[starter]) return { ok: false, reason: 'need-a-probiotic-starter' };
  if (kind !== 'yogurt' && kind !== 'kefir') return { ok: false, reason: 'unknown-ferment' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: kind, fatherId: 'ferment' });
  const amount = Math.round(milk * (0.9 + rng() * 0.1) * 100) / 100;  // most of the milk sets
  return { ok: true, product: kind, amount };
}

/**
 * makeCheese — milk + rennet (an 'enzyme' from the microbe lab) + a culture → curds pressed to CHEESE,
 * draining WHEY. Whey then feeds the microbe lab / livestock / a second ricotta cook.
 */
export function makeCheese(milk, { rennet = 'enzyme', culture = 'probiotic', ctx = {} } = {}) {
  if (rennet !== 'enzyme' || !MICROBE_PRODUCTS[rennet]) return { ok: false, reason: 'need-rennet-enzyme' };
  const rng = rngFromCtx({ blockId: ctx.blockId, txId: ctx.txId, motherId: 'cheese', fatherId: rennet });
  const cheese = Math.round(milk * (0.1 + rng() * 0.05) * 100) / 100;  // ~10-15% of milk becomes cheese
  const whey = Math.round((milk - cheese) * 100) / 100;
  return { ok: true, cheese, whey, culture };
}

/** dairyWeb — the full material graph for UI/education (what makes what). */
export function dairyWeb() {
  return {
    animals: Object.keys(DAIRY_ANIMALS),
    chains: [
      { from: 'milk', via: 'separate', to: ['cream', 'skim'] },
      { from: 'cream', via: 'churn', to: ['butter', 'buttermilk'] },
      { from: 'butter', via: 'clarify', to: ['ghee', 'milk_solids'] },
      { from: 'milk', via: 'fermentMilk (probiotic)', to: ['yogurt', 'kefir'] },
      { from: 'milk', via: 'makeCheese (rennet enzyme)', to: ['cheese', 'whey'] },
      { from: 'whey', via: 're-use', to: ['microbe-substrate', 'livestock-feed', 'ricotta'] },
    ],
  };
}

if (process.argv[1] && process.argv[1].endsWith('dairy.mjs')) {
  const ctx = { blockId: '0xcow', txId: '0x1' };
  const m = milkAnimal('buffalo', { ctx, cycles: 2 });
  console.log('milk a buffalo x2 →', m);
  const sep = separate(m.milk, { fat: m.fat });
  console.log('separate →', sep);
  const b = churn(sep.cream, { ctx });
  console.log('churn cream →', b, '→ ghee:', clarify(b.butter));
  console.log('ferment milk → yogurt:', fermentMilk(m.milk, { kind: 'yogurt', ctx }));
  console.log('make cheese (rennet) →', makeCheese(m.milk, { ctx }));
  console.log('cheese without rennet:', makeCheese(m.milk, { rennet: 'none', ctx }));
}
