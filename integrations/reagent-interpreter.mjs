// reagent-interpreter.mjs — presumptive REAGENT-TEST interpreter (harm reduction, educational). Pairs
// with the identifier's CLIP color detection: a photo of the reaction -> an observed color -> the
// candidate substances that color implies for that reagent. Across several reagents it narrows the field
// (e.g. Marquis purple + Simon's blue => MDMA, not MDA). Deterministic data + lookups, no network, no keys.
//
// HARD RULE baked into every answer: this is PRESUMPTIVE and EDUCATIONAL — a color is a clue, never an
// identity or a purity/dose. Nothing here tells anyone a substance is "safe." Confirm with lab testing
// (e.g. GC-MS); use multiple reagents; test a scraping, not your whole sample. This matches the wiki's
// "Colorimetric Reagents & Presumptive Chemical Testing" scope (education + harm reduction).
//
//   import { interpret, interpretMulti, REAGENTS } from './reagent-interpreter.mjs';
//   interpret('marquis', 'purple')         -> { reagent, color, candidates:[{substance, note}], caveat }
//   interpretMulti([{reagent:'marquis',color:'purple'},{reagent:'simon',color:'blue'}]) -> ranked substances

export const CAVEAT =
  'Presumptive only — a color is a clue, not an identity, purity, or dose, and never a sign a substance is '
  + 'safe. Use several reagents, test a small scraping, and confirm with lab analysis (GC-MS). '
  + 'Reactions vary with light, timing, binders and adulterants.';

// reagent -> [{ substance, color (normalized keyword), note }]. Standard, widely-published reactions.
export const REAGENTS = {
  marquis: [
    { substance: 'MDMA / MDA (and amphetamines)', color: 'purple', note: 'purple→black for MDxx; amphetamine/meth orange→brown' },
    { substance: 'Amphetamine / Methamphetamine', color: 'orange', note: 'orange→brown' },
    { substance: 'Opioids (heroin, morphine, codeine)', color: 'purple', note: 'deep purple/violet' },
    { substance: '2C-x phenethylamines', color: 'green', note: 'green→yellow varies by compound' },
    { substance: 'DXM', color: 'gray', note: 'gray→black (can mask/confuse MDxx)' },
    { substance: 'Aspirin / salicylates', color: 'pink', note: 'pink→red (common cut/decoy)' },
    { substance: 'Sugar / no active (or many RCs)', color: 'none', note: 'no reaction — NOT proof of nothing; many substances do not react' },
  ],
  mecke: [
    { substance: 'Opioids', color: 'green', note: 'green→blue' },
    { substance: 'MDMA / MDA', color: 'blue', note: 'blue→green→black' },
    { substance: '2C-B', color: 'green', note: 'yellow→green' },
  ],
  mandelin: [
    { substance: 'MDMA / MDA', color: 'blue', note: 'blue→black' },
    { substance: 'Ketamine', color: 'orange', note: 'orange→brown (a key ketamine indicator)' },
    { substance: 'Amphetamine', color: 'green', note: 'green' },
    { substance: 'PMA / PMMA', color: 'green', note: 'green→blue (dangerous MDMA adulterant)' },
  ],
  simon: [
    { substance: 'MDMA (secondary amine)', color: 'blue', note: 'blue — DISTINGUISHES MDMA from MDA' },
    { substance: 'MDA / amphetamine (primary amine)', color: 'none', note: 'no reaction — primary amines do not turn blue' },
  ],
  froehde: [
    { substance: 'Opioids', color: 'purple', note: 'purple/violet' },
    { substance: 'MDMA', color: 'green', note: 'yellow→green→black' },
    { substance: '2C-B', color: 'green', note: 'green' },
  ],
  ehrlich: [
    { substance: 'Indoles — LSD, DMT, psilocin, tryptamines', color: 'purple', note: 'purple/pink = an indole present (NOT dose; LSD is active at microgram scale)' },
    { substance: 'Non-indole (e.g. NBOMe, DOx on blotter)', color: 'none', note: 'no reaction on blotter is a RED FLAG for a potent non-LSD like NBOMe' },
  ],
  hofmann: [
    { substance: 'LSD', color: 'blue', note: 'blue — supports LSD alongside a positive Ehrlich' },
  ],
  liebermann: [
    { substance: 'MDMA', color: 'black', note: 'orange→black' },
    { substance: 'Cocaine', color: 'yellow', note: 'yellow' },
    { substance: 'Amphetamine', color: 'orange', note: 'orange' },
  ],
};

const norm = (s) => String(s || '').toLowerCase().trim()
  .replace(/\b(dark|light|deep|pale|bright)\b/g, '').trim()
  .replace(/.*\b(purple|violet|blue|green|yellow|orange|brown|black|pink|red|gray|grey|none|clear|no change|no reaction)\b.*/, '$1')
  .replace('violet', 'purple').replace('grey', 'gray').replace(/clear|no change|no reaction/, 'none');

/** One reagent + observed color -> candidate substances. */
export function interpret(reagent, color) {
  const r = norm(reagent) in REAGENTS ? norm(reagent) : String(reagent || '').toLowerCase().trim();
  const table = REAGENTS[r];
  if (!table) return { reagent: r, color, candidates: [], caveat: CAVEAT, known: false };
  const c = norm(color);
  const candidates = table.filter((e) => e.color === c).map((e) => ({ substance: e.substance, note: e.note }));
  return { reagent: r, color: c, candidates, caveat: CAVEAT, known: true };
}

// Canonical substance key so the same substance tallies across reagents despite different label wording
// ("MDMA / MDA (and amphetamines)" and "MDMA (secondary amine)" both key to MDMA). Priority order matters.
const CANON = ['PMA', 'MDMA', 'MDA', 'Methamphetamine', 'Amphetamine', 'Ketamine', 'Cocaine', '2C-B',
  'NBOMe', 'Opioids', 'LSD', 'DMT', 'psilocin', 'DXM', 'Aspirin', 'Sugar'];
export function canonSubstance(s) {
  const t = String(s || '');
  for (const k of CANON) if (new RegExp(k.replace('2C-B', '2C-?B'), 'i').test(t)) return k === 'psilocin' ? 'Psilocin/tryptamines' : k;
  return t.split(/[\/(]/)[0].trim();
}

/** Several reagent results -> substances ranked by how many reagents agree (tallied by canonical key). */
export function interpretMulti(observations = []) {
  const tally = new Map(); // key -> { substance, count, notes:Set, reagents:Set }
  for (const o of observations) {
    const res = interpret(o.reagent, o.color);
    for (const c of res.candidates) {
      const key = canonSubstance(c.substance);
      const t = tally.get(key) || { substance: key, count: 0, reagents: new Set(), notes: new Set() };
      t.count++; t.reagents.add(res.reagent); if (c.note) t.notes.add(`${res.reagent}: ${c.note}`);
      tally.set(key, t);
    }
  }
  const ranked = [...tally.values()]
    .map((t) => ({ substance: t.substance, agree: t.count, reagents: [...t.reagents], notes: [...t.notes] }))
    .sort((a, b) => b.agree - a.agree);
  return { observations, ranked, caveat: CAVEAT };
}

export function reagentList() { return Object.keys(REAGENTS); }
