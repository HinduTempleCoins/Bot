// soapcalc.mjs — the pure, offline soap-making engine behind the SoapBox Soap Calculator.
//
// This is the flagship "tool for people": a real lye/oil calculator in the SoapCalc / BrambleBerry
// tradition. Give it a set of oils (by weight or by percentage), a lye type (NaOH for bar soap,
// KOH for liquid soap), a superfat %, and a water:lye ratio, and it returns the EXACT lye amount,
// the water amount, a per-oil breakdown, and the fatty-acid quality profile (hardness, cleansing,
// conditioning, bubbly, creamy) computed from each oil's saponification value and fatty-acid makeup.
//
// WHY THIS IS SAFETY-RELEVANT: soap is lye + oils. Too much lye leaves a caustic bar that burns skin;
// the whole point of a lye calculator is to get that number right. Correct math here prevents chemical
// burns — so this module is pure, deterministic and TESTED against known recipes (a coconut-oil recipe
// at 0% superfat must return weight × SAP). No network, no state, no surprises.
//
// ── THE MATH ────────────────────────────────────────────────────────────────────────────────────────
//   SAP value here = grams of NaOH needed to saponify 1 g of that oil (the standard soapmaking "SAP").
//   KOH needs more lye per gram than NaOH by the ratio of their molar masses:
//       KOH factor = NaOH SAP × (56.1056 / 39.9971) ≈ NaOH SAP × 1.4028
//   Lye for one oil   = oil weight × SAP(for the chosen lye)
//   Total pure lye    = Σ (per-oil lye)
//   Superfatted lye   = total pure lye × (1 − superfat% / 100)      // leaves that % of oils un-saponified
//   KOH is sold impure (usually ~90%), so actual KOH to weigh = superfatted lye ÷ (purity% / 100)
//   Water             = superfatted lye × (water : lye ratio)       // e.g. 2 = "twice the lye weight in water"
//
// ── THE QUALITY PROFILE (SoapCalc-style, from fatty-acid makeup) ─────────────────────────────────────
//   Each oil carries its fatty-acid composition (%). We weight each acid by the oil's share of the
//   batch, sum across oils, then:
//       Hardness     = lauric + myristic + palmitic + stearic     (saturated → a hard, long-lasting bar)
//       Cleansing    = lauric + myristic                          (strips oils; high = can be drying)
//       Conditioning = oleic + linoleic + linolenic + ricinoleic  (leaves skin soft)
//       Bubbly       = lauric + myristic + ricinoleic             (big fluffy lather)
//       Creamy       = palmitic + stearic + ricinoleic            (stable, lotion-like lather)
//   These are descriptive indices, not percentages that sum to 100.

// ── curated oils database — PUBLIC reference data (SAP values + fatty-acid composition) ───────────────
// `sap` is the NaOH saponification value (g NaOH / g oil). `fa` is the fatty-acid profile in weight %.
// Real oils vary by source and refining; these are standard reference midpoints, the same class of
// numbers SoapCalc/BrambleBerry publish. Percentages need not sum to 100 (minor acids are omitted).
export const OILS = {
  coconut:    { name: 'Coconut oil (76°)',  sap: 0.183, fa: { lauric: 48, myristic: 19, palmitic: 9,  stearic: 3,  oleic: 8,  linoleic: 2,  linolenic: 0, ricinoleic: 0 } },
  palm:       { name: 'Palm oil',           sap: 0.141, fa: { lauric: 0,  myristic: 1,  palmitic: 44, stearic: 5,  oleic: 39, linoleic: 10, linolenic: 0, ricinoleic: 0 } },
  palmkernel: { name: 'Palm kernel oil',    sap: 0.156, fa: { lauric: 49, myristic: 16, palmitic: 8,  stearic: 2,  oleic: 15, linoleic: 3,  linolenic: 0, ricinoleic: 0 } },
  olive:      { name: 'Olive oil',          sap: 0.135, fa: { lauric: 0,  myristic: 0,  palmitic: 14, stearic: 3,  oleic: 71, linoleic: 10, linolenic: 1, ricinoleic: 0 } },
  castor:     { name: 'Castor oil',         sap: 0.128, fa: { lauric: 0,  myristic: 0,  palmitic: 0,  stearic: 0,  oleic: 4,  linoleic: 4,  linolenic: 0, ricinoleic: 90 } },
  shea:       { name: 'Shea butter',        sap: 0.128, fa: { lauric: 0,  myristic: 0,  palmitic: 5,  stearic: 45, oleic: 43, linoleic: 6,  linolenic: 0, ricinoleic: 0 } },
  cocoa:      { name: 'Cocoa butter',       sap: 0.137, fa: { lauric: 0,  myristic: 0,  palmitic: 28, stearic: 34, oleic: 35, linoleic: 3,  linolenic: 0, ricinoleic: 0 } },
  almond:     { name: 'Sweet almond oil',   sap: 0.136, fa: { lauric: 0,  myristic: 0,  palmitic: 7,  stearic: 2,  oleic: 71, linoleic: 18, linolenic: 0, ricinoleic: 0 } },
  avocado:    { name: 'Avocado oil',        sap: 0.133, fa: { lauric: 0,  myristic: 0,  palmitic: 20, stearic: 1,  oleic: 63, linoleic: 12, linolenic: 1, ricinoleic: 0 } },
  sunflower:  { name: 'Sunflower oil',      sap: 0.134, fa: { lauric: 0,  myristic: 0,  palmitic: 6,  stearic: 4,  oleic: 20, linoleic: 69, linolenic: 0, ricinoleic: 0 } },
  grapeseed:  { name: 'Grapeseed oil',      sap: 0.1265,fa: { lauric: 0,  myristic: 0,  palmitic: 8,  stearic: 4,  oleic: 16, linoleic: 70, linolenic: 0, ricinoleic: 0 } },
  ricebran:   { name: 'Rice bran oil',      sap: 0.128, fa: { lauric: 0,  myristic: 1,  palmitic: 17, stearic: 2,  oleic: 42, linoleic: 37, linolenic: 1, ricinoleic: 0 } },
  hemp:       { name: 'Hemp seed oil',      sap: 0.1345,fa: { lauric: 0,  myristic: 0,  palmitic: 6,  stearic: 2,  oleic: 12, linoleic: 57, linolenic: 21, ricinoleic: 0 } },
  lard:       { name: 'Lard (pork)',        sap: 0.138, fa: { lauric: 0,  myristic: 1,  palmitic: 28, stearic: 13, oleic: 44, linoleic: 9,  linolenic: 0, ricinoleic: 0 } },
  tallow:     { name: 'Beef tallow',        sap: 0.1405,fa: { lauric: 0,  myristic: 3,  palmitic: 26, stearic: 20, oleic: 44, linoleic: 3,  linolenic: 0, ricinoleic: 0 } },
  babassu:    { name: 'Babassu oil',        sap: 0.175, fa: { lauric: 50, myristic: 20, palmitic: 11, stearic: 4,  oleic: 10, linoleic: 3,  linolenic: 0, ricinoleic: 0 } },
};

// molar-mass ratio KOH:NaOH — how much more KOH than NaOH saponifies the same oil.
export const KOH_FACTOR = 56.1056 / 39.9971; // ≈ 1.40275

export const FATTY_ACIDS = ['lauric', 'myristic', 'palmitic', 'stearic', 'oleic', 'linoleic', 'linolenic', 'ricinoleic'];

// Typical "good bar" target ranges for the quality profile — shown to guide, never to gate.
export const PROFILE_RANGES = {
  hardness:     { min: 29, max: 54, label: 'Hardness' },
  cleansing:    { min: 12, max: 22, label: 'Cleansing' },
  conditioning: { min: 44, max: 69, label: 'Conditioning' },
  bubbly:       { min: 14, max: 46, label: 'Bubbly' },
  creamy:       { min: 16, max: 48, label: 'Creamy' },
};

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};
const num = (v, dflt = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

/**
 * Compute a full soap recipe.
 *
 * @param {object} recipe
 * @param {Array<{id?:string, oil?:string, weight?:number, percent?:number, sap?:number, fa?:object}>} recipe.oils
 * @param {'NaOH'|'KOH'} [recipe.lyeType='NaOH']
 * @param {number} [recipe.superfat=5]        superfat / lye-discount, percent
 * @param {number} [recipe.waterRatio=2]      water : lye by weight (2 = twice the lye weight)
 * @param {number} [recipe.kohPurity=90]      KOH purity %, only used when lyeType='KOH'
 * @param {number} [recipe.batchWeight]       total oil weight, when oils are given as percentages
 * @param {'weight'|'percent'} [recipe.mode]  inferred from the oils if omitted
 * @returns {{ok:boolean, ...}} deterministic result; soft-fails (ok:false + warnings) rather than throwing.
 */
export function calculate(recipe = {}) {
  const warnings = [];
  const lyeType = recipe.lyeType === 'KOH' ? 'KOH' : 'NaOH';
  const superfat = Math.max(0, Math.min(100, num(recipe.superfat, 5)));
  const waterRatio = Math.max(0, num(recipe.waterRatio, 2));
  const kohPurity = Math.max(1, Math.min(100, num(recipe.kohPurity, 90)));

  const rawOils = Array.isArray(recipe.oils) ? recipe.oils : [];
  const mode = recipe.mode || (rawOils.some((o) => o && o.percent != null && o.weight == null) ? 'percent' : 'weight');
  const batchWeight = num(recipe.batchWeight, 0);

  // resolve every oil to { id, name, weight, sap, fa }
  const resolved = [];
  for (const o of rawOils) {
    if (!o) continue;
    const id = o.id || o.oil || '';
    const db = OILS[id];
    const sap = num(o.sap, db ? db.sap : NaN);
    const fa = o.fa || (db ? db.fa : null);
    const name = o.name || (db ? db.name : id || 'Custom oil');
    if (!Number.isFinite(sap)) { warnings.push(`Unknown oil "${id}" (no SAP value) — skipped.`); continue; }
    let weight;
    if (mode === 'percent') {
      const pct = num(o.percent, 0);
      weight = batchWeight > 0 ? (pct / 100) * batchWeight : 0;
      resolved.push({ id, name, sap, fa, percent: pct, weight });
    } else {
      weight = num(o.weight, 0);
      resolved.push({ id, name, sap, fa, weight });
    }
  }

  const totalOil = round(resolved.reduce((s, o) => s + o.weight, 0), 3);
  if (!resolved.length) warnings.push('No usable oils in the recipe.');
  if (mode === 'percent') {
    const pctSum = round(resolved.reduce((s, o) => s + (o.percent || 0), 0), 2);
    if (resolved.length && Math.abs(pctSum - 100) > 0.5) warnings.push(`Oil percentages add up to ${pctSum}%, not 100%.`);
    if (batchWeight <= 0) warnings.push('Set a total batch weight to convert percentages into weights.');
  }

  const lyeFactor = lyeType === 'KOH' ? KOH_FACTOR : 1;
  const perOil = resolved.map((o) => {
    const share = totalOil > 0 ? o.weight / totalOil : 0;
    const oilLye = o.weight * o.sap * lyeFactor;
    return { id: o.id, name: o.name, weight: round(o.weight, 2), percent: round(share * 100, 1), sap: o.sap, lye: round(oilLye, 2) };
  });

  const pureLye = resolved.reduce((s, o) => s + o.weight * o.sap * lyeFactor, 0);
  const lye = pureLye * (1 - superfat / 100);
  // KOH is sold impure → weigh more of it to get the pure-KOH amount the math wants.
  const lyeToWeigh = lyeType === 'KOH' ? lye / (kohPurity / 100) : lye;
  const water = lye * waterRatio;
  const totalBatch = totalOil + lyeToWeigh + water;

  // fatty-acid profile: batch-weighted sum of each acid, then the five quality indices.
  const acid = Object.fromEntries(FATTY_ACIDS.map((a) => [a, 0]));
  let faCoverage = 0;
  for (const o of resolved) {
    const share = totalOil > 0 ? o.weight / totalOil : 0;
    if (!o.fa) { if (o.weight > 0) faCoverage += 0; continue; }
    faCoverage += share;
    for (const a of FATTY_ACIDS) acid[a] += share * num(o.fa[a], 0);
  }
  for (const a of FATTY_ACIDS) acid[a] = round(acid[a], 1);
  if (resolved.length && faCoverage < 0.999) warnings.push('Some oils have no fatty-acid data — the quality profile is approximate.');

  const profile = {
    hardness:     round(acid.lauric + acid.myristic + acid.palmitic + acid.stearic, 0),
    cleansing:    round(acid.lauric + acid.myristic, 0),
    conditioning: round(acid.oleic + acid.linoleic + acid.linolenic + acid.ricinoleic, 0),
    bubbly:       round(acid.lauric + acid.myristic + acid.ricinoleic, 0),
    creamy:       round(acid.palmitic + acid.stearic + acid.ricinoleic, 0),
  };

  if (superfat === 0) warnings.push('0% superfat leaves no safety margin — a small mis-measure can make a lye-heavy, caustic bar. Most recipes use 5–8%.');
  if (superfat > 20) warnings.push('Very high superfat (>20%) — the bar may be soft and go rancid faster.');

  return {
    ok: resolved.length > 0,
    lyeType,
    superfat: round(superfat, 2),
    waterRatio: round(waterRatio, 3),
    kohPurity: lyeType === 'KOH' ? round(kohPurity, 1) : null,
    totalOil,
    lye: round(lye, 2),              // pure lye the saponification math needs
    lyeToWeigh: round(lyeToWeigh, 2),// what to actually put on the scale (KOH purity-adjusted)
    water: round(water, 2),
    totalBatch: round(totalBatch, 2),
    perOil,
    fattyAcids: acid,
    profile,
    warnings,
  };
}

// The standard, non-negotiable lye-handling safety note. Every surface that shows a result shows this.
export const SAFETY_NOTE =
  'Lye (sodium or potassium hydroxide) is caustic and can cause serious chemical burns and blindness. '
  + 'Always add lye TO water (never water to lye), in a ventilated space, wearing goggles and gloves. '
  + 'Weigh every ingredient by mass on a scale — never by volume. Keep vinegar and running water nearby. '
  + 'These figures are a calculation aid, not a substitute for a tested recipe and your own judgement.';

export default { OILS, KOH_FACTOR, FATTY_ACIDS, PROFILE_RANGES, calculate, SAFETY_NOTE };
