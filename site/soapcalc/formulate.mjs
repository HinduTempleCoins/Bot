// formulate.mjs — the non-saponification half of the calculator: emulsions (lotions, creams),
// anhydrous blends (body butters, balms, salves, lotion bars), solid perfumes, and the HLB math.
//
// WHY THIS IS A SEPARATE ENGINE FROM soapcalc.mjs
//   Lye calculation is pure stoichiometry: each oil has a saponification value, so grams of NaOH
//   are determined by the oil weights. There is one right answer and a calculator can give it.
//   An emulsion is not determined that way. Whether a lotion holds depends on the EMULSIFIER and
//   its required usage rate, on HLB matching between the emulsifier and the oil phase, on process
//   (both phases heated and held, then high-shear cooled), on viscosity, and on preservative
//   efficacy against the water you just added. None of that follows from the ingredient weights
//   alone — which is why no SoapCalc equivalent exists for lotions. What a calculator CAN do, and
//   what this engine does, is enforce the arithmetic (phases summing to 100%), hold each
//   emulsifier and preservative to its real usage rate, compute required HLB, and refuse to
//   produce a water-containing formula with no preservative in it.
//
// House style: pure functions, no I/O, no fetch, soft-fail (every function returns a result object
// with `ok` and `warnings`; nothing throws on bad input).

export const PRESERVATIVE_RULE =
  'Any formula containing water — including an aloe, tea or hydrosol — requires a broad-spectrum ' +
  'preservative at the supplier\'s stated rate. Water supports bacterial, yeast and mould growth ' +
  'within days. Vitamin E and rosemary extract are ANTIOXIDANTS: they slow oil rancidity and ' +
  'preserve nothing. An anhydrous formula needs no preservative, but keep water out of it — ' +
  'including wet fingers in the jar.';

export const EMULSIFIERS = {
  ewax_nf:  { name: 'Emulsifying Wax NF',        min: 3, max: 6,  hlb: 15.5, rule: 'commonly used at about 25% of the oil-phase weight', ionic: 'non-ionic' },
  polawax:  { name: 'Polawax',                   min: 3, max: 6,  hlb: 15.5, rule: 'use at about 25% of the oil-phase weight', ionic: 'non-ionic' },
  btms50:   { name: 'BTMS-50',                   min: 2, max: 5,  hlb: null, rule: 'cationic — conditioning; favoured in hair and body creams', ionic: 'cationic' },
  olivem1000:{ name: 'Olivem 1000',              min: 3, max: 8,  hlb: 9.5,  rule: 'liquid-crystal emulsifier; gives a lighter skin feel', ionic: 'non-ionic' },
  glyceryl_stearate_peg100: { name: 'Glyceryl Stearate / PEG-100 Stearate', min: 3, max: 7, hlb: 11.2, rule: 'workhorse pair for lotions and creams', ionic: 'non-ionic' },
  lecithin: { name: 'Lecithin',                  min: 1, max: 5,  hlb: 8.0,  rule: 'natural but weak alone; usually co-emulsified', ionic: 'non-ionic' },
  borax_beeswax: { name: 'Beeswax + borax',      min: 5, max: 12, hlb: null, rule: 'the traditional cold-cream emulsion; coarse and thick, historically the oldest route', ionic: 'anionic (soap in situ)' },
};

export const PRESERVATIVES = {
  phenoxyethanol_ehg: { name: 'Phenoxyethanol + Ethylhexylglycerin', min: 0.5, max: 1.0, ph: '≤ 8', broad: true },
  liquid_germall_plus:{ name: 'Liquid Germall Plus',                 min: 0.1, max: 0.5, ph: '3–8',  broad: true },
  optiphen_plus:      { name: 'Optiphen Plus',                       min: 0.5, max: 1.5, ph: '≤ 6', broad: true },
  geogard_ect:        { name: 'Geogard ECT (Plantaserv M)',          min: 0.6, max: 1.0, ph: '≤ 6', broad: true },
  benzyl_alcohol_da:  { name: 'Benzyl Alcohol + Dehydroacetic Acid', min: 0.6, max: 1.0, ph: '≤ 6', broad: true },
};

export const ANTIOXIDANTS = {
  vitamin_e:  { name: 'Vitamin E (tocopherol)', min: 0.1, max: 1.0 },
  rosemary_oe:{ name: 'Rosemary oleoresin (ROE)', min: 0.02, max: 0.1 },
};

// Required HLB of common oil-phase components. Blend by weight to get the oil phase's required HLB,
// then pick an emulsifier (or pair) whose HLB matches it.
export const REQUIRED_HLB = {
  coconut: 8, olive: 7, sweetalmond: 7, jojoba: 6.5, castor: 14, shea: 8, cocoabutter: 6,
  mango: 8, avocado: 7, sunflower: 7, ricebran: 7, beeswax: 12, mineral_oil: 10.5, stearic: 15,
};

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Required HLB of an oil phase given {component: weightOrPercent}. */
export function requiredHlb(oilPhase = {}) {
  let tot = 0, acc = 0, unknown = [];
  for (const [k, v] of Object.entries(oilPhase)) {
    const w = num(v);
    if (w <= 0) continue;
    tot += w;
    if (REQUIRED_HLB[k] == null) { unknown.push(k); continue; }
    acc += w * REQUIRED_HLB[k];
  }
  if (tot <= 0) return { ok: false, hlb: null, warnings: ['oil phase is empty'] };
  const known = tot - Object.entries(oilPhase).filter(([k, v]) => unknown.includes(k)).reduce((s, [, v]) => s + num(v), 0);
  const warnings = unknown.length ? [`no required-HLB figure for: ${unknown.join(', ')} — excluded from the average`] : [];
  return { ok: known > 0, hlb: known > 0 ? round(acc / known, 1) : null, warnings };
}

/**
 * Emulsion (lotion / cream). Percentages of the total batch.
 * Enforces: phases sum to 100, emulsifier within its real rate, preservative present and in range.
 */
export function lotion(input = {}) {
  const batch = num(input.batchGrams, 100);
  const water = num(input.waterPct, 0);
  const oil = num(input.oilPct, 0);
  const emKey = input.emulsifier || 'ewax_nf';
  const em = EMULSIFIERS[emKey] || EMULSIFIERS.ewax_nf;
  const emPct = num(input.emulsifierPct, 0);
  const prKey = input.preservative || 'phenoxyethanol_ehg';
  const pr = PRESERVATIVES[prKey] || PRESERVATIVES.phenoxyethanol_ehg;
  const prPct = num(input.preservativePct, 0);
  const humectant = num(input.humectantPct, 0);
  const thickener = num(input.thickenerPct, 0);
  const extras = num(input.extrasPct, 0);

  const total = round(water + oil + emPct + prPct + humectant + thickener + extras, 3);
  const warnings = [];
  const errors = [];

  if (Math.abs(total - 100) > 0.05) errors.push(`phases total ${total}% — a formula must sum to exactly 100%`);
  if (water > 0 && prPct <= 0) errors.push('water-containing formula with no preservative — this will grow mould. ' + PRESERVATIVE_RULE);
  if (prPct > 0 && (prPct < pr.min || prPct > pr.max)) warnings.push(`${pr.name} is normally used at ${pr.min}–${pr.max}%; you have ${prPct}%`);
  if (emPct > 0 && (emPct < em.min || emPct > em.max)) warnings.push(`${em.name} is normally used at ${em.min}–${em.max}%; you have ${emPct}%`);
  if (oil > 0 && emPct > 0 && (emKey === 'ewax_nf' || emKey === 'polawax')) {
    const want = round(oil * 0.25, 2);
    if (Math.abs(emPct - want) > Math.max(0.5, want * 0.4)) {
      warnings.push(`${em.name} ${em.rule} — for a ${oil}% oil phase that is about ${want}%`);
    }
  }
  if (water > 0 && water < 50) warnings.push('water phase under 50% makes a heavy cream rather than a lotion — intended?');
  if (thickener > 1) warnings.push('gum or carbomer thickeners are normally 0.1–0.5%; above 1% is usually gummy');

  const hlb = requiredHlb(input.oilPhase || {});
  if (hlb.ok && em.hlb != null && Math.abs(hlb.hlb - em.hlb) > 3) {
    warnings.push(`oil phase wants HLB about ${hlb.hlb}; ${em.name} is HLB ${em.hlb} — consider a co-emulsifier`);
  }

  const g = (p) => round((p / 100) * batch, 2);
  return {
    ok: errors.length === 0,
    errors, warnings,
    totalPct: total,
    requiredHlb: hlb.hlb,
    emulsifier: em.name,
    preservative: pr.name,
    grams: {
      waterPhase: g(water), oilPhase: g(oil), emulsifier: g(emPct),
      preservative: g(prPct), humectant: g(humectant), thickener: g(thickener), extras: g(extras),
      batch: round(batch, 2),
    },
    method: [
      'Weigh the water phase and the oil phase into separate heatproof containers.',
      'Heat both to 70–75 °C and hold 20 minutes (heat-and-hold) to melt the emulsifier fully and reduce microbial load.',
      'Pour the water phase into the oil phase and mix with high shear (stick blender) 1–3 minutes.',
      'Cool with gentle stirring. Below 40 °C add the cool-down phase: preservative, any heat-sensitive extract, fragrance.',
      'Check pH if your preservative has a pH ceiling. Jar into sanitised containers.',
    ],
    note: PRESERVATIVE_RULE,
  };
}

/** Anhydrous whipped body butter. No water, therefore no preservative — but an antioxidant. */
export function bodyButter(input = {}) {
  const batch = num(input.batchGrams, 100);
  const butters = num(input.buttersPct, 0);
  const oils = num(input.liquidOilPct, 0);
  const wax = num(input.waxPct, 0);
  const powder = num(input.powderPct, 0);
  const extras = num(input.extrasPct, 0);
  const total = round(butters + oils + wax + powder + extras, 3);
  const errors = [], warnings = [];

  if (Math.abs(total - 100) > 0.05) errors.push(`components total ${total}% — must sum to 100%`);
  if (butters < 40) warnings.push('under about 40% solid butter the blend usually will not hold a whip');
  if (butters > 80) warnings.push('over about 80% butter whips stiff and can feel waxy');
  if (oils > 45) warnings.push('over about 45% liquid oil tends to weep or stay soft');
  if (wax > 10) warnings.push('wax above about 10% stops it being a whipped butter and makes it a balm');
  if (powder > 12) warnings.push('arrowroot or tapioca above about 12% goes chalky');
  if (powder === 0 && oils > 25) warnings.push('5–10% arrowroot or tapioca starch cuts the greasy feel of a high-oil butter');

  const g = (p) => round((p / 100) * batch, 2);
  return {
    ok: errors.length === 0, errors, warnings, totalPct: total,
    grams: { butters: g(butters), liquidOils: g(oils), wax: g(wax), powder: g(powder), extras: g(extras), batch: round(batch, 2) },
    method: [
      'Melt butters and wax together gently; do not overheat shea or it goes grainy.',
      'Stir in the liquid oils, then chill until opaque and just starting to set.',
      'Whip with a mixer 3–5 minutes, rest, whip again.',
      'Add antioxidant and any fragrance at the end. Jar without tapping down.',
      'Anhydrous: no preservative needed. Keep water out — water in the jar means spoilage.',
    ],
    antioxidantNote: 'Vitamin E 0.1–1%, or rosemary oleoresin 0.02–0.1%, to slow rancidity. Neither is a preservative.',
  };
}

/** Solid perfume / balm in a tin: wax, carrier, fragrance. */
export function solidPerfume(input = {}) {
  const batch = num(input.batchGrams, 30);
  const wax = num(input.waxPct, 25);
  const carrier = num(input.carrierPct, 70);
  const fragrance = num(input.fragrancePct, 5);
  const total = round(wax + carrier + fragrance, 3);
  const errors = [], warnings = [];

  if (Math.abs(total - 100) > 0.05) errors.push(`components total ${total}% — must sum to 100%`);
  if (wax < 15) warnings.push('under about 15% wax will not hold a solid in a warm pocket');
  if (wax > 35) warnings.push('over about 35% wax drags on the skin and releases scent poorly');
  if (fragrance > 10) warnings.push('fragrance above 10% is above typical leave-on skin limits for many materials — check the IFRA category for your material');
  if (fragrance < 2) warnings.push('under about 2% the scent will be faint in a solid base');

  const ratio = carrier > 0 ? round(carrier / Math.max(wax, 0.0001), 2) : null;
  const g = (p) => round((p / 100) * batch, 2);
  return {
    ok: errors.length === 0, errors, warnings, totalPct: total,
    carrierToWaxRatio: ratio,
    guidance: 'A 1:3 to 1:4 wax-to-carrier ratio by weight is the usual working range for a tin.',
    grams: { wax: g(wax), carrier: g(carrier), fragrance: g(fragrance), batch: round(batch, 2) },
    method: [
      'Melt the wax, stir in the carrier oil, remove from heat.',
      'Let it cool to just above set point before adding fragrance or essential oil, so the top notes survive.',
      'Pour into tins and leave undisturbed until fully set.',
    ],
  };
}

/** Balms, salves and lotion bars — anhydrous, by wax:butter:oil. */
export function balm(input = {}) {
  const batch = num(input.batchGrams, 100);
  const wax = num(input.waxPct, 0);
  const butter = num(input.butterPct, 0);
  const oil = num(input.oilPct, 0);
  const extras = num(input.extrasPct, 0);
  const total = round(wax + butter + oil + extras, 3);
  const errors = [], warnings = [];
  const kind = String(input.kind || 'salve');

  if (Math.abs(total - 100) > 0.05) errors.push(`components total ${total}% — must sum to 100%`);
  const want = { lipbalm: [20, 30], salve: [10, 20], lotionbar: [30, 35], stick: [25, 35] }[kind] || [10, 30];
  if (wax < want[0] || wax > want[1]) warnings.push(`for a ${kind}, wax is usually ${want[0]}–${want[1]}%; you have ${wax}%`);
  if (kind === 'lotionbar' && Math.abs(wax - butter) > 10) warnings.push('a lotion bar is classically equal parts wax, butter and oil');

  const g = (p) => round((p / 100) * batch, 2);
  return {
    ok: errors.length === 0, errors, warnings, totalPct: total,
    grams: { wax: g(wax), butter: g(butter), oil: g(oil), extras: g(extras), batch: round(batch, 2) },
    classic: 'Equal parts wax, butter and liquid oil by weight is the classic lotion-bar and hard-salve starting point.',
  };
}

/** Infusion strength for a botanical in a carrier oil — e.g. imphepho or calendula. */
export function infusion(input = {}) {
  const oilGrams = num(input.oilGrams, 0);
  const strength = num(input.herbRatio, 0.2); // herb weight as a fraction of oil weight
  const warnings = [];
  if (strength > 0.4) warnings.push('above about 1:2.5 herb-to-oil the mass absorbs more oil than it yields back');
  if (strength < 0.1) warnings.push('below about 1:10 the infusion will be weak');
  return {
    ok: oilGrams > 0,
    herbGrams: round(oilGrams * strength, 2),
    oilGrams: round(oilGrams, 2),
    ratio: `1:${round(1 / Math.max(strength, 0.0001), 1)} herb to oil by weight`,
    warnings,
    method: [
      'Dry the botanical thoroughly. Water in an infusion is what makes it go off.',
      'Warm infusion: 50–60 °C for 2–4 hours, covered, or 2–6 weeks at room temperature out of light.',
      'Strain through muslin and press. Let any settlings stand, then decant off them.',
      'Anhydrous infused oil keeps as well as the carrier; add an antioxidant, not a preservative.',
    ],
  };
}
