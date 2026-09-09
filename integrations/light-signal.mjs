// light-signal.mjs — LIGHT AS A BIOLOGICAL SIGNAL, which is a different subject from seeing.
//
// THE GAP THIS FILLS. `.local/temple-exams/colour-and-light.md` covers colour PERCEPTION — cones,
// CFF, what a browser can and cannot show you. That is image-forming vision. There is a second
// visual system and nothing in this corpus documented it: measured before this file, `OPN4` and
// `S-cone` returned ZERO hits, melanopsin five, photoperiod one.
//
// ⭐ WHY IT MATTERS HERE, and it is not a side topic.
//
// `site/hathor-live/the-line.mjs` now carries *United States v. Ghadiali*, 165 F.2d 957 (3d Cir.
// 1948) — Spectro-Chrome condemned for promising that coloured light restores "the Human
// Radio-Active And Radio-Emanative Equilibrium". That claim was false and the conviction stood.
//
// And yet: light of a particular spectrum, at a particular time, demonstrably changes human
// physiology — melatonin, alertness, circadian phase. The mechanism is **melanopsin in
// intrinsically photosensitive retinal ganglion cells**, and it was not described until around
// 2000, half a century AFTER Ghadiali was convicted. So the honest version of "colour and light
// matter" runs through a pathway nobody knew existed when the false version was tried and lost.
//
// That distinction is the entire value of this module, and it is why every number here is
// quantitative. "Blue light" is a claim. **Melanopic EDI in lux is a measurement.**
//
// ⚠️ WHAT THIS MODULE IS NOT. It does not treat, diagnose, cure or prevent anything, and it makes
// no health claim. It converts a light description into a standard quantity and compares it to a
// published consensus threshold. Everything below is education; a clinician interprets.
//
//   import { melanopicEDI, classifyExposure, MOONLIGHT, RECOMMENDATIONS } from './light-signal.mjs'
//   node integrations/light-signal.mjs moon

import { fileURLToPath } from 'node:url';

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Number(null) is 0 and Number('') is 0, and "no measurement was given" is neither of those. Left
// uncaught, a missing reading becomes 0 lux — which then classifies as comfortably WITHIN the sleep
// ceiling, i.e. a false pass on an absent measurement. The same trap `covariateNote()` and
// `repeatStatistic()` document in site/hathor-live; it is worth catching in one line every time.
const num = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// ── the two systems ─────────────────────────────────────────────────────────────────────────────
export const SYSTEMS = Object.freeze({
  'image-forming': {
    receptors: 'rods and cones',
    does: 'shape, motion, colour — what you see',
    ownedBy: '.local/temple-exams/colour-and-light.md',
  },
  'non-image-forming': {
    receptors: 'melanopsin (OPN4) in intrinsically photosensitive retinal ganglion cells, with rod and cone input',
    does: 'circadian entrainment, melatonin suppression, alertness, the pupillary light reflex',
    peakSensitivityNm: 480,
    ownedBy: 'this module',
    note: 'Described around 2000. Ghadiali was convicted in 1948, so the real mechanism postdates the '
      + 'false claim by ~50 years — which is exactly why the two must not be confused.',
  },
});

// ── CIE S 026 α-opic quantities ─────────────────────────────────────────────────────────────────
// Five photoreceptor classes, each with its own action spectrum. Melanopic EDI is the one that
// governs circadian and alerting responses, and it is referenced to D65 daylight — which is why
// D65 has a ratio of exactly 1 by construction rather than by measurement.
export const ALPHA_OPIC = Object.freeze(['rhodopic', 'melanopic', 's-cone-opic', 'm-cone-opic', 'l-cone-opic']);

/**
 * Melanopic daylight efficacy ratios (mel-DER): melanopic EDI per photopic lux, by source.
 * ⚠️ APPROXIMATE AND SOURCE-DEPENDENT. A true value requires the spectral power distribution of
 * the actual lamp; two "4000 K LEDs" from different makers differ. These are representative
 * figures for planning, and `melanopicEDI()` returns `approximate: true` for every one of them.
 * The honest use is comparing orders of magnitude, not certifying a room.
 */
export const MEL_DER = Object.freeze({
  d65: 1.00,              // by definition — the reference illuminant
  daylight: 0.95,
  overcast: 1.05,         // more short-wavelength than direct sun
  'blue-sky': 1.20,
  'led-6500k': 1.00,
  'led-4000k': 0.75,
  'led-3000k': 0.55,
  'led-2700k': 0.45,
  incandescent: 0.45,     // CIE Illuminant A, 2856 K
  candle: 0.30,
  'screen-white': 0.75,
  moonlight: 0.80,        // sunlight reflected off regolith — slightly reddened, still broadband
});

/**
 * Melanopic equivalent daylight illuminance from photopic lux and a source id.
 * Soft-fails to a shaped result; never throws.
 */
export function melanopicEDI(photopicLux, source = 'd65') {
  const lux = num(photopicLux);
  const key = String(source || '').trim().toLowerCase();
  const der = MEL_DER[key];
  if (!Number.isFinite(lux) || lux < 0) {
    return { ok: false, mEDI: null, reason: 'photopic lux must be a non-negative number' };
  }
  if (der == null) {
    return { ok: false, mEDI: null, reason: `unknown source "${key}" — known: ${Object.keys(MEL_DER).join(', ')}` };
  }
  return {
    ok: true,
    mEDI: Math.round(lux * der * 1000) / 1000,
    photopicLux: lux,
    source: key,
    melDER: der,
    approximate: true,
    note: 'mel-DER is source-dependent; a true melanopic EDI needs the lamp’s measured spectrum.',
  };
}

// ── the consensus thresholds ────────────────────────────────────────────────────────────────────
// Brown TM, Brainard GC, Cajochen C, et al. (2022), "Recommendations for daytime, evening, and
// nighttime indoor light exposure to best support physiology, sleep, and wakefulness in healthy
// adults", PLOS Biology 20(3):e3001571, doi:10.1371/journal.pbio.3001571.
// Verified against Crossref: title, journal, volume and year all match.
export const RECOMMENDATIONS = Object.freeze([
  { phase: 'daytime', minMEDI: 250, maxMEDI: null, why: 'at least 250 lx melanopic EDI at the eye, to support entrainment and daytime alertness' },
  { phase: 'evening', minMEDI: null, maxMEDI: 10, why: 'below 10 lx melanopic EDI in the three hours before bed' },
  { phase: 'sleep', minMEDI: null, maxMEDI: 1, why: 'below 1 lx melanopic EDI in the sleep environment' },
]);

/** Where an exposure sits against the consensus for a given phase. Never throws. */
export function classifyExposure(mEDI, phase = 'sleep') {
  const v = num(mEDI);
  const rec = RECOMMENDATIONS.find((r) => r.phase === String(phase || '').toLowerCase());
  if (!rec) return { ok: false, reason: `unknown phase — known: ${RECOMMENDATIONS.map((r) => r.phase).join(', ')}` };
  if (!Number.isFinite(v) || v < 0) return { ok: false, reason: 'melanopic EDI must be a non-negative number' };
  if (rec.minMEDI != null) {
    return { ok: true, phase: rec.phase, mEDI: v, meets: v >= rec.minMEDI,
      verdict: v >= rec.minMEDI ? 'meets the daytime recommendation' : `below the ${rec.minMEDI} lx daytime recommendation`, rec: rec.why };
  }
  return { ok: true, phase: rec.phase, mEDI: v, meets: v <= rec.maxMEDI,
    verdict: v <= rec.maxMEDI ? `within the ${rec.maxMEDI} lx ${rec.phase} ceiling` : `ABOVE the ${rec.maxMEDI} lx ${rec.phase} ceiling`, rec: rec.why };
}

// ── ⭐ the lunar question, computed rather than argued ───────────────────────────────────────────
export const MOONLIGHT = Object.freeze({
  fullMoonLuxRange: [0.1, 0.3],
  note: 'Full-moon ground illuminance under a clear sky, the commonly cited range.',
  studies: Object.freeze([
    { cite: 'Cajochen et al. (2013), Current Biology 23(15), doi:10.1016/j.cub.2013.06.029 — "Evidence that the Lunar Cycle Influences Human Sleep"',
      what: 'A retrospective analysis of laboratory sleep where NO moonlight could reach the participants. Widely reported; replication record is poor and the authors themselves later qualified it.',
      bears: 'If no light reached them, a light mechanism cannot explain it — which is what makes the replication failures important rather than incidental.' },
    { cite: 'Casiraghi et al. (2021), Science Advances 7(5), doi:10.1126/sciadv.abe0465 — "Moonstruck sleep: Synchronization of human sleep with the moon cycle under field conditions"',
      what: 'Field study across communities with and without access to electric light, plus an urban student sample.',
      bears: '⭐ The effect was largest where artificial light was ABSENT. That is what a LIGHT mechanism predicts and a FORCE mechanism does not, so the design discriminates between them.' },
  ]),
});

/**
 * ⭐ Is full moonlight bright enough to matter to the melanopsin system, by the published standard?
 * Computes rather than asserts, and reports the arithmetic so a reader can check it.
 */
export function lunarVerdict() {
  const [lo, hi] = MOONLIGHT.fullMoonLuxRange;
  const der = MEL_DER.moonlight;
  const mLo = Math.round(lo * der * 1000) / 1000;
  const mHi = Math.round(hi * der * 1000) / 1000;
  const ceiling = RECOMMENDATIONS.find((r) => r.phase === 'sleep').maxMEDI;
  return {
    fullMoonPhotopicLux: [lo, hi],
    melDER: der,
    fullMoonMEDI: [mLo, mHi],
    sleepCeilingMEDI: ceiling,
    belowCeiling: mHi < ceiling,
    factorBelow: Math.round((ceiling / mHi) * 10) / 10,
    verdict: mHi < ceiling
      ? `Full moonlight is roughly ${Math.round((ceiling / mHi) * 10) / 10}× BELOW the melanopic level the consensus already calls acceptable during sleep. On that standard it is too dim to be a strong zeitgeber — which is consistent with the mostly null human literature.`
      : 'Full moonlight reaches or exceeds the sleep ceiling.',
    // The distinction the operator drew, kept in code so it cannot be lost in a summary.
    andYet: 'This does not make lunar timing useless. It makes it a SCHEDULING variable rather than a '
      + 'physiological one. Scheduling a rite by the moon is honest and needs no mechanism; "the full '
      + 'moon changes your sleep architecture" is a claim that needs evidence and does not currently '
      + 'have it. Those are two different claims and must never be merged.',
    caveat: 'Casiraghi\'s result — larger effects without electric light — is compatible with CONTRAST '
      + 'mattering rather than absolute level. A 0.2 lx moon against a 0.001 lx night is a large '
      + 'relative change; against a lit bedroom it is nothing.',
  };
}

// ── photoperiod ─────────────────────────────────────────────────────────────────────────────────
export const PHOTOPERIOD = Object.freeze({
  signal: 'Night length is encoded in the DURATION of nocturnal melatonin secretion, not in its amplitude.',
  consequence: 'That is why a species can read the season from the sky, and why indoor light — which '
    + 'shortens the biological night at both ends — attenuates the seasonal signal a person receives.',
  honest: 'Human seasonality is real but far weaker and less consistent than the animal literature. '
    + 'Do not import a hamster result into a person.',
});

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'light-signal',
    systems: Object.keys(SYSTEMS), alphaOpic: ALPHA_OPIC,
    recommendations: RECOMMENDATIONS, lunar: lunarVerdict(),
    note: 'Light as a biological signal, in melanopic EDI. Not a health claim, not a diagnosis, and '
        + 'not a treatment — a quantity and a published threshold. A clinician interprets.',
  }, null, 2));
}

export default { SYSTEMS, ALPHA_OPIC, MEL_DER, RECOMMENDATIONS, MOONLIGHT, PHOTOPERIOD, melanopicEDI, classifyExposure, lunarVerdict, handler };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'moon') {
    const v = lunarVerdict();
    console.log(`full moon: ${v.fullMoonPhotopicLux.join('–')} photopic lux × mel-DER ${v.melDER} = ${v.fullMoonMEDI.join('–')} lx melanopic EDI`);
    console.log(`sleep ceiling: ${v.sleepCeilingMEDI} lx mEDI\n`);
    console.log(v.verdict, '\n');
    console.log(v.andYet, '\n');
    console.log('CAVEAT:', v.caveat);
  } else {
    for (const [k, d] of Object.entries(MEL_DER)) {
      const e = melanopicEDI(100, k);
      console.log(`${k.padEnd(14)} mel-DER ${String(d).padEnd(6)} → 100 lx photopic = ${String(e.mEDI).padStart(6)} lx mEDI`);
    }
  }
}
