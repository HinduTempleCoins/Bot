// temple-mycin.mjs — A MYCIN-SHAPED SCREENER FOR COMMON DEFICIENCIES
//
// MYCIN (Shortliffe, Stanford, 1970s) was a backward-chaining production system with CERTAINTY
// FACTORS in [-1, +1] and a WHY/HOW explanation facility. It was never deployed clinically.
// Both of those facts are why the architecture fits here:
//
//   • A certainty factor is natively "how strongly does this point somewhere" — NOT "you have X".
//     That is the only output this project is permitted to produce. See .local/TEMPLE_EXAMS_SAFETY_GATE.md
//     and .local/temple-exams/functional-documentation-and-benefits.md — "Measure. Format for a
//     clinician. Never interpret."
//   • Every conclusion here therefore terminates in a TEST TO ASK FOR, never in a finding.
//
// The output of a run is a clinician-facing handout: what was observed, what it may point toward, how
// strongly, why, and which specific laboratory test would settle it.

export const NOT_A_DIAGNOSIS =
  'This is a screener, not a diagnosis, and it cannot establish any medically determinable impairment. ' +
  'It produces a list of questions and specific tests to bring to a clinician. Nothing here is a finding, ' +
  'a clearance, or a result. If any page renders this as a conclusion about a person, that page is wrong.';

/** Certainty-factor combination, as MYCIN did it. Two positives reinforce without ever reaching 1. */
export function combineCF(a, b) {
  if (a > 0 && b > 0) return a + b * (1 - a);
  if (a < 0 && b < 0) return a + b * (1 + a);
  return (a + b) / (1 - Math.min(Math.abs(a), Math.abs(b)));
}

/** The things a person can report or a Temple Exam can measure. Deliberately observable, not clinical. */
export const SIGNS = Object.freeze({
  fatigue: 'Persistent tiredness not explained by sleep',
  pallor: 'Unusual paleness noted by the person or others',
  pica: 'Craving ice, dirt, starch or other non-food',
  numb_hands_feet: 'Numbness, tingling or pins-and-needles in hands or feet',
  balance_off: 'Balance noticeably worse, or unsteady in the dark',
  sore_tongue: 'Sore, smooth or beefy-red tongue',
  bruises_easy: 'Bruises from knocks that would not normally bruise',
  bone_ache: 'Deep aching in bones, hips, ribs or shins',
  low_sun: 'Little or no direct midday sun for months',
  dark_skin: 'Darker skin, which raises the sun exposure needed',
  covered: 'Usually covered when outdoors',
  cramps: 'Muscle cramps or twitching',
  palpitations: 'Fluttering or racing heartbeat',
  hair_loss: 'Hair thinning or falling out',
  slow_wounds: 'Cuts and grazes heal slowly',
  taste_dull: 'Food tastes flat or smells faint',
  night_vision_poor: 'Notably poor vision in low light',
  heavy_periods: 'Heavy or prolonged menstrual bleeding',
  vegan_diet: 'No animal foods at all',
  alcohol_heavy: 'Regular heavy alcohol use',
  metformin: 'Takes metformin',
  ppi: 'Takes a proton-pump inhibitor long term',
  diuretic: 'Takes a loop or thiazide diuretic',
  bariatric: 'Has had bariatric surgery',
  pregnant: 'Pregnant or planning pregnancy',
  low_food: 'Regularly short of food or skipping meals',
});

/**
 * Rules. Each: signs that fire it, the deficiency it points AT, a certainty factor, the reason, and
 * the TEST that would settle it. `cf` is a pointer strength, not a probability of disease.
 */
export const RULES = Object.freeze([
  { id: 'b12-vegan',    if: ['vegan_diet'],                    points: 'b12',      cf: 0.55, why: 'B12 occurs essentially only in animal foods and in fortified products; a diet with neither is the classic route to depletion.' },
  { id: 'b12-metformin',if: ['metformin'],                     points: 'b12',      cf: 0.45, why: 'Long-term metformin interferes with B12 absorption in the ileum. This is well described and routinely missed.' },
  { id: 'b12-ppi',      if: ['ppi'],                           points: 'b12',      cf: 0.35, why: 'Stomach acid is needed to free B12 from food protein; long-term acid suppression reduces that step.' },
  { id: 'b12-neuro',    if: ['numb_hands_feet', 'balance_off'],points: 'b12',      cf: 0.60, why: 'Peripheral numbness with unsteadiness is the pattern that matters most, because B12-related nerve damage can become permanent while blood counts still look normal.' },
  { id: 'b12-tongue',   if: ['sore_tongue', 'fatigue'],        points: 'b12',      cf: 0.35, why: 'Glossitis with fatigue is a recognised presentation.' },
  { id: 'b12-bariatric',if: ['bariatric'],                     points: 'b12',      cf: 0.50, why: 'Surgery that bypasses stomach or ileum removes the machinery B12 absorption depends on.' },

  { id: 'iron-pica',    if: ['pica'],                          points: 'iron',     cf: 0.65, why: 'Craving ice or non-food is strongly associated with iron depletion and is often the first thing anyone notices.' },
  { id: 'iron-periods', if: ['heavy_periods', 'fatigue'],      points: 'iron',     cf: 0.60, why: 'Menstrual loss is the most common cause of iron depletion in menstruating people, and heavy bleeding is under-reported.' },
  { id: 'iron-pallor',  if: ['pallor', 'fatigue'],             points: 'iron',     cf: 0.40, why: 'Pallor with fatigue is non-specific but points here often enough to test.' },
  { id: 'iron-hair',    if: ['hair_loss'],                     points: 'iron',     cf: 0.25, why: 'Low iron stores are a recognised contributor to diffuse hair shedding, often at ferritin levels still called normal.' },

  { id: 'vitd-sun',     if: ['low_sun'],                       points: 'vitamin_d',cf: 0.50, why: 'Skin synthesis from midday sun is the main source for most people; months without it is the main route to deficiency.' },
  { id: 'vitd-skin',    if: ['dark_skin', 'low_sun'],          points: 'vitamin_d',cf: 0.60, why: 'Melanin lengthens the exposure needed, so the same latitude and season produce less.' },
  { id: 'vitd-covered', if: ['covered', 'low_sun'],            points: 'vitamin_d',cf: 0.55, why: 'Covering reduces the skin area available regardless of how sunny it is.' },
  { id: 'vitd-bone',    if: ['bone_ache'],                     points: 'vitamin_d',cf: 0.40, why: 'Deep bone ache is the classic osteomalacia presentation and is frequently mistaken for something else for years.' },

  { id: 'mag-cramps',   if: ['cramps'],                        points: 'magnesium',cf: 0.30, why: 'Cramping and twitching are consistent with low magnesium, though many other things cause them.' },
  { id: 'mag-diuretic', if: ['diuretic'],                      points: 'magnesium',cf: 0.40, why: 'Loop and thiazide diuretics increase urinary magnesium and potassium loss.' },
  { id: 'mag-palps',    if: ['palpitations', 'cramps'],        points: 'magnesium',cf: 0.35, why: 'Palpitations with cramping raises the question of magnesium and potassium together.' },
  { id: 'pot-diuretic', if: ['diuretic', 'cramps'],            points: 'potassium',cf: 0.45, why: 'Potassium loss on diuretics is common and is measured on an ordinary panel.' },

  { id: 'zinc-wounds',  if: ['slow_wounds', 'taste_dull'],     points: 'zinc',     cf: 0.45, why: 'Slow healing with blunted taste or smell is the recognised pairing for zinc.' },
  { id: 'thia-alcohol', if: ['alcohol_heavy'],                 points: 'thiamine', cf: 0.55, why: 'Heavy alcohol use impairs thiamine absorption and storage. This one is urgent — untreated deficiency can cause permanent neurological harm.' },
  { id: 'thia-confuse', if: ['alcohol_heavy', 'balance_off'],  points: 'thiamine', cf: 0.70, why: 'Unsteadiness alongside heavy alcohol use is the pattern clinicians treat FIRST and investigate afterwards.' },
  { id: 'fol-preg',     if: ['pregnant'],                      points: 'folate',   cf: 0.50, why: 'Folate need rises in pregnancy and adequate intake before conception is what matters for neural tube development.' },
  { id: 'vita-night',   if: ['night_vision_poor'],             points: 'vitamin_a',cf: 0.40, why: 'Poor dark adaptation is the earliest recognised sign of vitamin A deficiency.' },
  { id: 'multi-food',   if: ['low_food'],                      points: 'general',  cf: 0.50, why: 'Going short of food does not produce one deficiency; it produces several at once, quietly.' },
]);

/** What each conclusion terminates in: the test to ASK FOR. No finding is ever returned. */
export const ASK_FOR = Object.freeze({
  b12:       { label: 'Vitamin B12', tests: ['Serum B12', 'Methylmalonic acid (MMA) — more sensitive when B12 is borderline', 'Homocysteine'], note: 'Ask specifically about MMA if serum B12 comes back low-normal, because nerve damage can progress while the simple test still reads normal.' },
  iron:      { label: 'Iron stores', tests: ['Ferritin', 'Full blood count', 'Transferrin saturation', 'CRP alongside ferritin'], note: 'Ferritin rises with inflammation, so a CRP taken at the same time tells you whether a normal ferritin can be trusted.' },
  vitamin_d: { label: 'Vitamin D', tests: ['25-hydroxyvitamin D'], note: 'The 25-OH form is the storage marker. The 1,25 form is not the right test for this question.' },
  magnesium: { label: 'Magnesium', tests: ['Serum magnesium', 'RBC magnesium where available'], note: 'Serum magnesium can look normal while stores are low; say that when you ask.' },
  potassium: { label: 'Potassium', tests: ['Basic metabolic panel'], note: 'Already on the ordinary panel — no special request needed.' },
  zinc:      { label: 'Zinc', tests: ['Plasma zinc, fasting'], note: 'Affected by inflammation and by time of day; fasting morning draw is the usable one.' },
  thiamine:  { label: 'Thiamine (B1)', tests: ['Whole blood thiamine or erythrocyte transketolase'], note: 'URGENT where alcohol is involved. Clinicians treat first and test afterwards; do not wait on a result.' },
  folate:    { label: 'Folate', tests: ['Serum folate', 'RBC folate'], note: 'Check alongside B12 — treating folate alone while B12 is low can mask the nerve damage.' },
  vitamin_a: { label: 'Vitamin A', tests: ['Serum retinol'], note: 'Supplementation carries real toxicity risk; this is one to confirm before taking anything.' },
  general:   { label: 'Broad nutritional screen', tests: ['Full blood count', 'Ferritin', 'B12', 'Folate', '25-OH vitamin D', 'Basic metabolic panel'], note: 'Where food has been short, ask for the panel rather than one test.' },
});

/**
 * run(signs) -> the handout. `signs` is an array of SIGNS keys.
 * Returns conclusions sorted by strength, each with its firing rules and the tests to ask for.
 * No conclusion is ever phrased as a finding.
 */
export function run(signs = []) {
  const have = new Set((signs || []).filter((s) => s in SIGNS));
  const acc = new Map();
  for (const r of RULES) {
    if (!r.if.every((s) => have.has(s))) continue;
    const prev = acc.get(r.points);
    const cf = prev ? combineCF(prev.cf, r.cf) : r.cf;
    acc.set(r.points, { cf, fired: [...(prev ? prev.fired : []), { rule: r.id, cf: r.cf, why: r.why, from: r.if }] });
  }
  const conclusions = [...acc.entries()]
    .map(([k, v]) => ({
      points_at: k,
      label: ASK_FOR[k].label,
      strength: Math.round(v.cf * 100) / 100,
      band: v.cf >= 0.7 ? 'strong pointer' : v.cf >= 0.4 ? 'worth asking about' : 'weak pointer',
      ask_for: ASK_FOR[k].tests,
      note: ASK_FOR[k].note,
      because: v.fired,
    }))
    .sort((a, b) => b.strength - a.strength);
  return {
    disclaimer: NOT_A_DIAGNOSIS,
    observed: [...have].map((s) => ({ sign: s, text: SIGNS[s] })),
    conclusions,
    next: conclusions.length
      ? 'Take this page to a clinician and ask for the tests listed. Nothing above is a result.'
      : 'Nothing here points anywhere specific. That is not a clearance — it means these questions did not fire.',
  };
}

/** why(ruleId) — MYCIN's explanation facility, kept because the reasoning must be inspectable. */
export function why(ruleId) {
  const r = RULES.find((x) => x.id === ruleId);
  if (!r) return { ok: false, rule: String(ruleId || '') };
  return { ok: true, rule: r.id, fires_on: r.if.map((s) => SIGNS[s]), points_at: ASK_FOR[r.points].label, strength: r.cf, why: r.why };
}

export const SIGN_IDS = Object.keys(SIGNS);
