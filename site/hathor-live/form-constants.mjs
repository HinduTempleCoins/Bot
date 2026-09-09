// form-constants.mjs — WHAT PEOPLE ACTUALLY SEE UNDER FLICKER, AND WHOSE THE MEANING IS.
//
// WHY THIS EXISTS. The operator recalled Timothy Leary saying, on Space Ghost Coast to Coast, that he
// could get people to see angels and hallucinations with light. He was describing something real, and
// this corpus was half-covering it: `dreamachine` is a session in the 40 Hz library and `time-flicker-body.md`
// §5.4 covers Ganzflicker and phosphenes — but **"Klüver" and "form constants" returned ZERO hits**,
// and they are the part that answers the question.
//
// ⭐ THE FINDING, and it is the reason this belongs next to who-says.mjs rather than in a curiosity file.
//
// Heinrich Klüver, working with mescaline in the 1920s, observed that the GEOMETRY reported by
// different people is not idiosyncratic. He grouped it into four recurring types — the **form
// constants** — and the same four turn up under flicker, migraine aura, hypnagogia, pressure
// phosphenes and several drugs. The geometry is stereotyped across people and across causes.
//
// That is a fact about the visual system, not about the stimulus and not about the person. Which means
// the honest reading of Leary's claim splits cleanly in two:
//
//   • **the light reliably produces the geometry** — true, replicable, and the mechanism is understood
//     well enough to be a standard demonstration
//   • **"angels" is the interpretation the viewer brings** — and it is theirs, not the lamp's
//
// This is row 4 of `/exams/who-says` stated in a phenomenon: the instrument produces the stimulus, the
// person keeps the meaning. It is also the Thread Protocol's design line, arrived at from the other end.
//
// ⚠️ SAFETY, AND IT IS NOT INCIDENTAL. Flicker in this band is the exact stimulus class the
// photosensitive-epilepsy gate exists for (`.local/TEMPLE_EXAMS_SAFETY_GATE.md`, and the refusals in
// chamber.mjs that will not put a high-risk program in a strapped viewer at ANY consent setting).
// Leary was describing the one thing in this whole library that can put somebody in hospital.
//
//   import { FORM_CONSTANTS, LEARY, whoseMeaning, formConstantsHTML } from './form-constants.mjs'

import { esc } from './the-line.mjs';
export { esc };

/** Klüver's four types. The names are his groupings, not a taxonomy anyone has since fixed. */
export const FORM_CONSTANTS = Object.freeze([
  Object.freeze({ id: 'tunnels', name: 'Tunnels and funnels', also: 'cones, vessels, alleys',
    note: 'Often reported with a sense of motion inward or outward. The "tunnel" of near-death report is the same geometry, which is a fact about the visual system rather than about death.' }),
  Object.freeze({ id: 'spirals', name: 'Spirals', also: 'helices',
    note: 'Rotational, frequently with apparent expansion or contraction.' }),
  Object.freeze({ id: 'lattices', name: 'Lattices, gratings and honeycombs', also: 'chequerboards, filigree',
    note: 'The most commonly reported class under flicker. Hexagonal and grid arrangements dominate.' }),
  Object.freeze({ id: 'cobwebs', name: 'Cobwebs', also: 'webs, nets',
    note: 'Irregular radial networks; the least sharply distinguished of the four from the other three.' }),
]);

export const getConstant = (id) => FORM_CONSTANTS.find((f) => f.id === String(id || '').toLowerCase()) || null;

/** The causes that produce the same four. This is the observation that makes them interesting. */
export const CAUSES = Object.freeze([
  'stroboscopic flicker (including the Dreamachine and Ganzflicker)',
  'migraine aura',
  'hypnagogic and hypnopompic imagery',
  'pressure phosphenes (rubbing closed eyes)',
  'several classes of psychoactive substance',
  'sensory deprivation',
]);

/**
 * ⭐ The split that the whole file exists to make. Given a report, which half is the stimulus and
 * which half is the viewer's? Never throws.
 */
export function whoseMeaning(report) {
  const s = String(report == null ? '' : report).toLowerCase();
  const geometry = /tunnel|funnel|spiral|lattice|grid|honeycomb|chequer|checker|web|net|geometr|pattern/.test(s);
  const figurative = /angel|demon|face|person|being|entity|god|spirit|animal|creature|voice|message/.test(s);
  return {
    ok: true,
    geometryReported: geometry,
    figurativeReported: figurative,
    stimulusProduces: geometry ? 'the geometry — that part is the light and the visual system, and it replicates' : 'nothing this module can attribute to the stimulus from the words given',
    viewerSupplies: figurative
      ? 'the figure. A lattice is not an angel until somebody recognises one, and the recognition is theirs'
      : 'no figurative content was reported',
    // The rule, stated the same way every time so it cannot drift into an interpretation.
    rule: 'The light produces the geometry. The person supplies the meaning. We do not tell anyone what '
      + 'they met — see /exams/who-says.',
  };
}

export const LEARY = Object.freeze({
  claim: 'That light alone can produce angels and hallucinations.',
  trueHalf: 'Flicker in roughly the alpha band, through closed eyelids, reliably produces vivid geometric '
    + 'visual phenomena in most people. This is not marginal and it is not a drug claim — Brion Gysin\'s '
    + 'Dreamachine (1959) is a cylinder with cut slots spinning in front of a bulb, and Leary knew it.',
  overreachedHalf: 'The figurative content — angels — is not produced by the lamp. The four form constants '
    + 'are what the stimulus reliably delivers; a person recognising an angel in a lattice is doing the '
    + 'recognising. Attributing that to the light is the step this library does not take.',
  safety: '⚠️ This is also the exact stimulus class the photosensitive-epilepsy gate exists for. See '
    + '.local/TEMPLE_EXAMS_SAFETY_GATE.md and the refusals in chamber.mjs, which will not put a high-risk '
    + 'program in a strapped viewer at any consent setting, because during a seizure it cannot be removed.',
});

export function formConstantsHTML() {
  const rows = FORM_CONSTANTS.map((f) => `<div class=card>
    <h3 style="margin-top:0">${esc(f.name)}</h3>
    <p class=prov>${esc(f.also)}</p>
    <p class=muted>${esc(f.note)}</p>
  </div>`).join('');
  const causes = CAUSES.map((c) => `<li>${esc(c)}</li>`).join('');
  return `<h1>The form constants</h1>
<p class=muted>What people actually see under flicker — and the reason the answer is the same for
almost everybody.</p>

<div class=card>
  <h2 style="margin-top:0">Four shapes, many causes</h2>
  <p>Working in the 1920s, Heinrich Klüver noticed that the geometry people report is not personal.
  He grouped it into four recurring types, and the same four turn up under:</p>
  <ul class=limits>${causes}</ul>
  <p class=muted>The geometry is stereotyped across people <b>and across causes</b>. That makes it a
  fact about the visual system rather than about the stimulus or about you.</p>
</div>

${rows}

<div class=card>
  <h2 style="margin-top:0">⭐ The light produces the geometry. You supply the meaning.</h2>
  <p>${esc(LEARY.trueHalf)}</p>
  <p>${esc(LEARY.overreachedHalf)}</p>
  <p class=muted>This is the same rule as everywhere else here: an instrument produces a stimulus, and
  what it meant is yours. See <a href="/exams/who-says">who is authorised to say what is happening to
  you</a>.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">⚠️ Safety</h2>
  <p>${esc(LEARY.safety)}</p>
</div>`;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'form-constants',
    constants: FORM_CONSTANTS.map((f) => ({ id: f.id, name: f.name })),
    causes: CAUSES,
    rule: whoseMeaning('').rule,
    note: 'Klüver\'s four form constants. The stimulus reliably produces the geometry; the figurative '
        + 'content is the viewer\'s. Flicker in this band is gated for photosensitive epilepsy.',
  }, null, 2));
}

export default { FORM_CONSTANTS, CAUSES, LEARY, getConstant, whoseMeaning, formConstantsHTML, handler };
