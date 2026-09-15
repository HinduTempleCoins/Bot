// temple-plate.mjs — THE TEMPLE PLATE
//
// The Temple's own dietary frame. It is NOT a competitor to MyPlate and it does not restate
// macronutrients — that guidance exists, it is free, and repeating it adds nothing.
//
// What no official plate does, and what this one is for: ORGANISE FOOD BY WHAT IT INTERACTS WITH.
// A person's diet is not only protein and fibre. It is also the enzyme their medicine blocks, the
// fast their practice asks for, and the amine their supper carries. Those are the axes here.
//
// Three layers, in order of how much they matter on a given day:
//   1. STATE   — what the body is doing right now (ordinary, fasting, dieta, on an MAOI, pregnant…)
//   2. TIERS   — the plate itself, ordered by how much of it a day should be
//   3. GUARDS  — the things a STATE removes from the plate, and why, with the mechanism named
//
// Pure data + pure functions. No I/O, no network, no fetch seam needed.
// Interaction mechanisms are deliberately NOT restated here — they live in interactions-data.mjs
// with their citations, and this module points at them by slug so there is one source of truth.

export const NOT_ADVICE =
  'Educational only. This is a frame for thinking about food, not medical or dietary advice, and it ' +
  'does not replace a clinician or a pharmacist. Where a state names a drug interaction, the mechanism ' +
  'and its citations live in interactions-data.mjs — read those before relying on any of it.';

/** The plate, coarse to fine. `share` is a rough proportion of a day's food, not a prescription. */
export const TIERS = Object.freeze([
  { id: 'ground', name: 'Ground', share: 0.35,
    holds: ['whole grains', 'tubers', 'legumes', 'roots'],
    note: 'The base. Cheap, storable, and what almost every tradition actually built its table on.' },
  { id: 'garden', name: 'Garden', share: 0.30,
    holds: ['leaves', 'vegetables', 'fruit', 'alliums', 'mushrooms'],
    note: 'Fresh matter. The tier most often lost first when money is short, which is why the free-food programmes matter here.' },
  { id: 'protein', name: 'Protein', share: 0.20,
    holds: ['pulses', 'eggs', 'dairy', 'fish', 'meat', 'nuts', 'seeds'],
    note: 'Sourced however the practitioner sources it. The Temple takes no position on flesh; it takes a position on knowing what is in it.' },
  { id: 'fat', name: 'Fat and oil', share: 0.10,
    holds: ['olive', 'seed oils', 'butter', 'ghee', 'animal fat'],
    note: 'Carrier for fat-soluble compounds, which is why it appears in preparation traditions far more than in nutrition charts.' },
  { id: 'ferment', name: 'Ferment and age', share: 0.05,
    holds: ['aged cheese', 'cured meat', 'soy sauce', 'miso', 'yeast extract', 'unpasteurised beer', 'kimchi', 'sauerkraut'],
    note: 'Set apart deliberately. Nutritionally small, pharmacologically the loudest tier on the plate — see the MAOI state.' },
]);

/** A STATE is a condition that changes the plate. Each names which tiers it guards and why. */
export const STATES = Object.freeze([
  { id: 'ordinary', name: 'Ordinary days', guards: [],
    note: 'No restriction. The plate as given.' },
  { id: 'maoi', name: 'On a monoamine oxidase inhibitor',
    guards: [
      { tier: 'ferment', rule: 'restrict', mechanism: 'tyramine-load',
        why: 'Aged, cured and fermented food carries TYRAMINE, produced by bacterial decarboxylation of tyrosine. Normally gut and liver MAO-A destroy it. With that enzyme blocked it is absorbed intact and displaces noradrenaline — the hypertensive "cheese reaction".' },
      { tier: 'garden', rule: 'partial', mechanism: 'ldopa-load',
        why: 'Broad bean PODS specifically, and the mechanism is L-dopa rather than tyramine. The distinction matters because it changes which part of the plant is the problem.' },
    ],
    note: 'Severity depends entirely on WHICH inhibitor. A reversible RIMA or a low-dose transdermal patch is not the same as an irreversible oral MAOI. Read interactions-data.mjs before assuming the classic diet applies.' },
  { id: 'fast', name: 'Fasting', guards: [{ tier: 'all', rule: 'suspend', mechanism: null, why: 'By intention, for a bounded period.' }],
    note: 'A practice, not a deficiency. Bounded, chosen, and ended deliberately.' },
  { id: 'dieta', name: 'Dieta — preparation before a rite',
    guards: [
      { tier: 'ferment', rule: 'restrict', mechanism: 'tyramine-load', why: 'The same amine hazard, for the same enzymatic reason, where the preparation involves an MAO inhibitor.' },
      { tier: 'fat', rule: 'partial', mechanism: null, why: 'Traditionally reduced. The Temple records the tradition without asserting a mechanism it cannot cite.' },
    ],
    note: 'Traditional preparatory restriction. Where a tradition and a pharmacology agree, both are recorded; where only the tradition speaks, it is labelled as tradition.' },
  { id: 'scarcity', name: 'No money this week',
    guards: [{ tier: 'garden', rule: 'at-risk', mechanism: null, why: 'Fresh matter is the first tier lost when money is short, and the one the food programmes most directly restore.' }],
    note: 'Not a dietary state — a circumstance. The right response is the benefits navigator, not a food rule.' },
]);

const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const TIER_BY = byId(TIERS);
const STATE_BY = byId(STATES);

/** plateFor(stateId) -> the tiers with any guard for that state attached. */
export function plateFor(stateId = 'ordinary') {
  const st = STATE_BY[String(stateId || 'ordinary')] || STATE_BY.ordinary;
  const all = st.guards.find((g) => g.tier === 'all');
  return {
    state: st.id,
    stateName: st.name,
    note: st.note,
    tiers: TIERS.map((t) => {
      const g = all || st.guards.find((x) => x.tier === t.id) || null;
      return { ...t, guard: g ? { rule: g.rule, mechanism: g.mechanism, why: g.why } : null };
    }),
  };
}

/** guardsOn(tierId) -> every state that constrains this tier, so a food page can show its own warnings. */
export function guardsOn(tierId) {
  const t = TIER_BY[String(tierId || '')];
  if (!t) return { ok: false, tier: String(tierId || ''), guards: [] };
  const out = [];
  for (const st of STATES) {
    for (const g of st.guards) {
      if (g.tier === t.id || g.tier === 'all') out.push({ state: st.id, stateName: st.name, ...g });
    }
  }
  return { ok: true, tier: t.id, name: t.name, guards: out };
}

/** mechanismSlugs() -> every interactions-data slug this frame depends on, for a link check. */
export function mechanismSlugs() {
  return [...new Set(STATES.flatMap((s) => s.guards.map((g) => g.mechanism).filter(Boolean)))].sort();
}

/** shareCheck() -> the tier shares should sum to 1. Guards against silent drift when tiers are edited. */
export function shareCheck() {
  const sum = Math.round(TIERS.reduce((a, t) => a + t.share, 0) * 1000) / 1000;
  return { ok: sum === 1, sum };
}

export const STATE_IDS = STATES.map((s) => s.id);
export const TIER_IDS = TIERS.map((t) => t.id);
