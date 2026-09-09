// interactions.mjs — a MECHANISM-BASED interaction engine for declared stacks.
//
// A person says what they are taking — prescriptions, supplements, plant preparations, foods,
// seasonings — and this returns the documented interactions with mechanism and citation.
//
// ⛔ THE ONE DESIGN RULE THIS MODULE EXISTS TO ENFORCE
// ────────────────────────────────────────────────────────────────────────────────────────────────
// ABSENCE OF A FLAG IS NOT A FINDING OF SAFETY. An interaction checker that looks complete is more
// dangerous than no checker at all, because it converts "we do not know" into "you are fine". So
// every single result object this module returns carries a `coverage` block stating what is and is
// not in the dataset, and `coverage.isFindingOfSafety` is hard-coded false. There is a test that
// fails if any exported result path omits it. It is structural, not a footnote.
//
// WHY MECHANISM AND NOT A PAIR TABLE — see the header of interactions-data.mjs. Short version:
// `CYP3A4 inhibition` covers grapefruit, ketoconazole, ritonavir, clarithromycin AND black pepper's
// piperine in one rule. A pairs list cannot generalise and its holes are invisible.
//
// THE LINE. Stating that two substances are documented to interact by a named mechanism, with a
// citation, is EDUCATION. Telling a named person to stop a prescription is INDIVIDUALISED MEDICAL
// ADVICE and is out of scope (BRIEF.md §6). This module describes; it does not instruct. The
// clinician export exists precisely because the interpretation belongs to a clinician — and because
// a doctor cannot check interactions against something they do not know the patient is taking,
// which is the strongest argument for the format.
//
// House style: ESM, esc() all interpolation, injectable fetch, soft-fail-never-throw, offline tests.
//
//   import { check, resolve, clinicianExport, interactionPaths, handler } from './interactions.mjs';
//   node integrations/interactions.mjs phenelzine "aged cheese" tramadol

import { SUBSTANCES, MECHANISMS, CITES, LAST_REVIEWED } from './interactions-data.mjs';

export { SUBSTANCES, MECHANISMS, CITES, LAST_REVIEWED };

/** esc — every value interpolated into HTML goes through this. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

export const BASE_URL = process.env.INTERACTIONS_BASE_URL || process.env.BASE_URL || 'https://hathor.live';

// ── coverage: the structural honesty field ────────────────────────────────────────────────────────
// This is the most important object in the file. It goes on EVERY result.

export const COVERS = Object.freeze([
  'Monoamine oxidase inhibition (prescription MAOIs, RIMAs, linezolid, methylene blue, harmala alkaloids)',
  'Serotonergic drugs and the serotonin-toxicity mechanism',
  'Dietary tyramine and L-dopa loads',
  'The major cytochrome P450 pathways: CYP3A4, CYP2D6, CYP1A2, CYP2C9, CYP2C19 — inhibition and induction',
  'P-glycoprotein inhibition and induction',
  '11β-HSD2 inhibition (the licorice mechanism) and the potassium consequences that follow it',
  'QT prolongation as an additive pharmacodynamic axis',
  'Culinary seasonings and common foods with documented pharmacological activity',
  'A selected set of narrow-therapeutic-index drugs where those shifts matter most',
]);

export const DOES_NOT_COVER = Object.freeze([
  'Any substance not named in this dataset — which is most substances. There are tens of thousands of marketed drugs and this table holds fewer than a hundred entries.',
  'Phase-2 conjugation (UGT, SULT, NAT2, COMT) except where a specific entry names it. The oilahuasca corpus turns heavily on phase 2 and this engine models it only in passing.',
  'Pharmacogenomics. CYP2D6 and CYP2C19 are strongly polymorphic; a poor metaboliser and an ultra-rapid metaboliser can have opposite outcomes from the same pair, and this engine does not know your genotype.',
  'Dose, timing, duration, formulation and route — all of which change whether a documented interaction is clinically real for you.',
  'Renal and hepatic impairment, age, pregnancy, and body composition.',
  'Additive sedation, respiratory depression, bleeding risk, hypoglycaemia and most other pharmacodynamic axes beyond the ones listed above.',
  'Herb–herb interactions outside the named entries, and essentially the whole botanical world: most plants have no interaction literature at all.',
  'Allergy, intolerance, and contamination or adulteration of unregulated products.',
  'Anything published after the last-reviewed date below.',
]);

/**
 * coverage() — attached to every result. `isFindingOfSafety` is false, always, by construction.
 */
export function coverage(extra = {}) {
  return Object.freeze({
    isFindingOfSafety: false,
    statement: 'A clean result means NO DOCUMENTED INTERACTION IN THIS DATASET. It does not mean safe, '
      + 'and it is not a clearance. Most substances are not in this dataset at all, and for many pairs '
      + 'that are, nobody has ever studied the combination.',
    absenceMeans: 'not checked / not known',
    covers: COVERS,
    doesNotCover: DOES_NOT_COVER,
    substancesInDataset: SUBSTANCES.length,
    mechanismsInDataset: Object.keys(MECHANISMS).length,
    citationsInDataset: Object.keys(CITES).length,
    lastReviewed: LAST_REVIEWED,
    sources: 'Primary literature (every DOI resolved against the Crossref API) and FDA drug labelling. '
      + 'There is no free, openly-licensed, comprehensive drug-interaction dataset to draw on; NLM retired '
      + 'its Drug Interaction API on 2024-01-02 and DrugBank\'s interaction set is a commercial licence.',
    consult: 'Consult your doctor or pharmacist. This is educational reference, not medical advice, and it '
      + 'is not a laboratory result.',
    ...extra,
  });
}

// ── name resolution ───────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();

const INDEX = (() => {
  const m = new Map();
  for (const s of SUBSTANCES) {
    for (const key of [s.id, s.name, s.slug, ...(s.aka || [])]) {
      const k = norm(key);
      if (k && !m.has(k)) m.set(k, s);
    }
  }
  return m;
})();

/** resolve(name) — a declared string to a substance, or null. Never throws. */
export function resolve(name) {
  const k = norm(name);
  if (!k) return null;
  if (INDEX.has(k)) return INDEX.get(k);
  // singular/plural and a contained-word fallback, longest key first so "black pepper" beats "pepper".
  const alt = k.endsWith('s') ? k.slice(0, -1) : `${k}s`;
  if (INDEX.has(alt)) return INDEX.get(alt);
  let best = null;
  for (const [key, sub] of INDEX) {
    if (key.length < 4) continue;
    if (k === key || k.includes(key) || key.includes(k)) {
      if (!best || key.length > best.key.length) best = { key, sub };
    }
  }
  return best ? best.sub : null;
}

// ── severity ──────────────────────────────────────────────────────────────────────────────────────

export const SEVERITY = Object.freeze(['info', 'monitor', 'moderate', 'major', 'critical']);
const rank = (s) => Math.max(0, SEVERITY.indexOf(s));
const STRENGTH = Object.freeze({ none: 0, weak: 1, variable: 2, moderate: 2, strong: 3 });
const str = (r) => STRENGTH[String(r && r.strength)] ?? 0;

/** The Hunter Serotonin Toxicity Criteria, given as the actual decision rule rather than named. */
export const HUNTER_CRITERIA = Object.freeze({
  name: 'Hunter Serotonin Toxicity Criteria',
  source: 'dunkley2003',
  precondition: 'In the presence of a serotonergic agent, serotonin toxicity is present if ANY ONE of the following holds.',
  rules: Object.freeze([
    'Spontaneous clonus.',
    'Inducible clonus AND (agitation OR diaphoresis).',
    'Ocular clonus AND (agitation OR diaphoresis).',
    'Tremor AND hyperreflexia.',
    'Hypertonia AND temperature above 38 °C AND (ocular clonus OR inducible clonus).',
  ]),
  performance: 'Reported sensitivity 84% and specificity 97% against a gold standard of clinical toxicologist diagnosis, in 2222 overdose admissions — better than the older Sternbach criteria, which are more sensitive to mild cases but far less specific.',
  whyItMatters: 'CLONUS is the discriminating sign. It is what separates serotonin toxicity from neuroleptic malignant syndrome, anticholinergic delirium and sympathomimetic toxicity, and it is more marked in the legs than the arms.',
  escalation: 'Severe cases progress over hours: rigidity, hyperthermia above 38.5 °C, rhabdomyolysis, disseminated intravascular coagulation. Hyperthermia in this setting is a medical emergency — it is muscular in origin, so antipyretics do not treat it.',
  alsoCite: Object.freeze(['boyer2005', 'sternbach1991', 'gillman2006']),
});

// ── the rules ─────────────────────────────────────────────────────────────────────────────────────
// Each rule receives an index of the declared stack by mechanism-and-role and returns findings.

const SEROTONERGIC_MECHS = ['serotonin-reuptake-inhibition', 'serotonin-release', 'serotonin-agonism'];

function rolesOf(sub, mech, role) {
  return (sub.roles || []).filter((r) => r.mech === mech && r.role === role && str(r) > 0);
}

function build(stack) {
  // by[mech][role] = [{ sub, role }]
  const by = {};
  for (const sub of stack) {
    for (const r of (sub.roles || [])) {
      if (str(r) === 0) continue;
      (by[r.mech] ||= {});
      (by[r.mech][r.role] ||= []).push({ sub, r });
    }
  }
  return by;
}

const citesOf = (...rs) => [...new Set(rs.flatMap((r) => (r && r.cites) || []))];

function ruleSerotonin(by, stack) {
  const out = [];
  const maoi = [...(by['mao-a-inhibition']?.inhibits || [])];
  const sero = SEROTONERGIC_MECHS.flatMap((m) => [
    ...(by[m]?.inhibits || []), ...(by[m]?.agonist || []),
  ]);
  for (const a of maoi) {
    for (const b of sero) {
      if (a.sub.id === b.sub.id) continue;
      const s = Math.min(str(a.r), str(b.r));
      const severity = s >= 3 ? 'critical' : s === 2 ? 'critical' : 'major';
      out.push({
        id: `serotonin:${a.sub.id}+${b.sub.id}`,
        severity: str(a.r) === 1 ? 'moderate' : severity,
        mechanism: 'serotonin toxicity',
        mechanismIds: ['mao-a-inhibition', b.r.mech],
        participants: [a.sub.id, b.sub.id],
        headline: `${a.sub.name} + ${b.sub.name} — MAO inhibition combined with ${MECHANISMS[b.r.mech].name.toLowerCase()}`,
        what: 'MAO-A is the enzyme that destroys serotonin. Blocking it while a second agent raises serotonin '
          + 'by a different route is the combination behind the fatal cases in the serotonin-toxicity literature. '
          + 'The mechanisms multiply rather than add: one stops removal, the other increases supply.',
        recognition: HUNTER_CRITERIA,
        watchFor: 'Clonus (especially in the legs), agitation, sweating, tremor with brisk reflexes, fever. '
          + 'Onset is typically within hours of the second agent, not days.',
        participantNotes: [a.r.note || '', b.r.note || ''],
        timing: a.r.reversible
          ? 'This MAO inhibition is REVERSIBLE, so the hazard follows the drug rather than persisting for weeks after it. That lowers the washout requirement — it does not lower the risk while both are present.'
          : 'This MAO inhibition is IRREVERSIBLE. Enzyme function returns only as new enzyme is made, so the hazard persists for about two weeks after the last dose. Washout intervals are measured in weeks, and for fluoxetine about five weeks in the other direction because of norfluoxetine.',
        cites: [...citesOf(a.r, b.r), 'dunkley2003', 'boyer2005', 'gillman2006'],
      });
    }
  }
  // additive serotonergic load without an MAOI
  const strongSero = sero.filter((x) => str(x.r) >= 2);
  if (!maoi.length && strongSero.length >= 2) {
    const ids = [...new Set(strongSero.map((x) => x.sub.id))];
    if (ids.length >= 2) {
      out.push({
        id: `serotonin-additive:${ids.join('+')}`,
        severity: 'moderate',
        mechanism: 'additive serotonergic load',
        mechanismIds: SEROTONERGIC_MECHS,
        participants: ids,
        headline: `Additive serotonergic load: ${ids.map((i) => resolve(i).name).join(' + ')}`,
        what: 'More than one agent raising serotonin, without an MAO inhibitor. Serotonin toxicity from '
          + 'reuptake inhibitors alone is usually mild-to-moderate rather than life-threatening, but it is real, '
          + 'and it is more likely at higher doses and in overdose.',
        recognition: HUNTER_CRITERIA,
        participantNotes: strongSero.map((x) => x.r.note || ''),
        watchFor: 'Clonus, tremor with hyperreflexia, agitation, sweating, diarrhoea.',
        cites: [...new Set(strongSero.flatMap((x) => x.r.cites || [])), 'dunkley2003', 'gillman2006'],
      });
    }
  }
  return out;
}

/**
 * Two MAO inhibitors at once. Caught by a test that expected linezolid to flag against an MAOI and
 * found nothing, because neither is serotonergic — the rule was simply missing. It is an absolute
 * contraindication in practice and the archetypal case is nobody realising the antibiotic is an MAOI.
 */
function ruleDualMAOI(by) {
  const maoi = [...(by['mao-a-inhibition']?.inhibits || [])].filter((x) => str(x.r) >= 2);
  const out = [];
  for (let i = 0; i < maoi.length; i++) {
    for (let j = i + 1; j < maoi.length; j++) {
      const a = maoi[i]; const b = maoi[j];
      out.push({
        id: `dual-maoi:${[a.sub.id, b.sub.id].sort().join('+')}`,
        severity: 'critical',
        mechanism: 'two MAO inhibitors together',
        mechanismIds: ['mao-a-inhibition'],
        participants: [a.sub.id, b.sub.id],
        headline: `${a.sub.name} + ${b.sub.name} — two MAO inhibitors at the same time`,
        what: 'Both of these inhibit monoamine oxidase. Taken together the enzyme is blocked more completely '
          + 'than either achieves alone, and both hazards that come off that enzyme are amplified: the '
          + 'serotonergic one and the tyramine pressor one. In practice this is an absolute contraindication, '
          + 'and the way it actually happens is that one of the two was not recognised as an MAOI at all — '
          + 'an antibiotic, a surgical dye, a herbal preparation, a spice.',
        participantNotes: [a.r.note || '', b.r.note || ''],
        recognition: HUNTER_CRITERIA,
        timing: (a.r.reversible && b.r.reversible)
          ? 'Both are reversible, so the overlap ends with the drugs rather than persisting for weeks.'
          : 'At least one is IRREVERSIBLE, so the overlap persists for about two weeks after that one is stopped — '
            + 'starting the second inside that window is the same as taking them together.',
        watchFor: 'Both pictures at once: the serotonergic one (clonus, agitation, sweating, fever) and the '
          + 'pressor one (abrupt severe headache, palpitations, raised blood pressure).',
        cites: [...citesOf(a.r, b.r), 'gillman2011', 'gillman2018', 'dunkley2003'],
      });
    }
  }
  return out;
}

function ruleTyramine(by) {
  const out = [];
  const maoi = [...(by['mao-a-inhibition']?.inhibits || [])];
  const food = [...(by['tyramine-load']?.provides || [])];
  const ldopa = [...(by['ldopa-load']?.provides || [])];
  for (const a of maoi) {
    for (const b of food) {
      const irreversible = !a.r.reversible;
      const weak = str(a.r) === 1;
      let severity = 'critical';
      let modern = '';
      if (weak) {
        severity = 'monitor';
        modern = 'The MAO-inhibitory signal for this substance is weak and largely non-human. It is reported '
          + 'here because a documented signal in a kitchen spice is worth knowing about, not because it is '
          + 'equivalent to a prescribed MAOI.';
      } else if (a.sub.id === 'selegiline-transdermal') {
        severity = 'monitor';
        modern = 'The patch is the exception with a mechanism behind it: it inhibits brain MAO-A while largely '
          + 'sparing INTESTINAL MAO-A, so dietary tyramine is still destroyed in the gut wall. At 6 mg/24 h no '
          + 'tyramine diet is required, and the tyramine pressor studies support that.';
      } else if (a.r.reversible) {
        severity = 'moderate';
        modern = 'This is a REVERSIBLE inhibitor, and reversibility is the whole difference. Tyramine competes '
          + 'with it at the enzyme and displaces it, so the pressor dose is raised only a few fold rather than '
          + 'ten to fifty fold. The classic diet is generally not required at standard doses. Saying otherwise '
          + 'is its own harm: the tyramine restriction has been overstated for decades, and that overstatement '
          + 'is a documented reason effective drugs go unprescribed and unfilled.';
      }
      out.push({
        id: `tyramine:${a.sub.id}+${b.sub.id}`,
        severity,
        mechanism: 'tyramine pressor response (hypertensive reaction)',
        mechanismIds: ['mao-a-inhibition', 'tyramine-load'],
        participants: [a.sub.id, b.sub.id],
        headline: `${a.sub.name} + ${b.sub.name} — dietary tyramine with MAO-A inhibition`,
        what: 'Tyramine in aged and fermented food is normally destroyed by MAO-A in the gut wall and liver '
          + 'before it reaches the circulation. With MAO-A blocked it gets through, displaces noradrenaline '
          + 'from sympathetic nerve endings, and blood pressure rises abruptly.',
        thresholds: 'The commonly cited figures: under about 6 mg of tyramine in a meal is generally regarded '
          + 'as safe on an irreversible MAOI; around 10–25 mg produces a measurable pressor response; and 25 mg '
          + 'or more risks a hypertensive reaction. Individual sensitivity varies several-fold, and the tyramine '
          + 'content of a named food varies several-fold between samples — which is why the rule is about food '
          + 'CATEGORIES and freshness rather than a lookup table you can trust to the milligram.',
        participantNotes: [a.r.note || '', b.r.note || ''],
        modernEvidence: modern || 'For an irreversible, non-selective MAOI (phenelzine, tranylcypromine, '
          + 'isocarboxazid) the dietary restriction is real and remains standard. What modern measurement changed '
          + 'is the LIST, not the principle: many foods on the 1960s lists — bottled and canned beer, ordinary soy '
          + 'sauce in a normal serving, fresh cheeses, chocolate, caffeine, most yoghurt — turned out to carry '
          + 'little tyramine, while yeast extract, aged cheese, fermented soy pastes, dried sausage and tap beer '
          + 'held up. Over-restriction is its own harm.',
        watchFor: 'Sudden severe headache, usually occipital and described as pounding; palpitations; a stiff or '
          + 'sore neck; nausea and vomiting; sweating; visual disturbance. A hypertensive crisis is an emergency — '
          + 'the outcomes that matter are intracranial haemorrhage and cardiac.',
        cites: [...citesOf(a.r, b.r), 'blackwell1963', 'blackwell1967', 'walker1996', 'shulman1999', 'gillman2018'],
      });
    }
    for (const b of ldopa) {
      out.push({
        id: `ldopa:${a.sub.id}+${b.sub.id}`,
        severity: str(a.r) === 1 || a.r.reversible ? 'moderate' : 'major',
        participantNotes: [a.r.note || '', b.r.note || ''],
        mechanism: 'dietary L-dopa with MAO inhibition',
        mechanismIds: ['mao-a-inhibition', 'ldopa-load'],
        participants: [a.sub.id, b.sub.id],
        headline: `${a.sub.name} + ${b.sub.name} — L-dopa, not tyramine`,
        what: 'Broad-bean pods carry levodopa, which is converted to dopamine and noradrenaline. With MAO '
          + 'inhibited that conversion is not opposed, and a pressor response can follow. The distinction from '
          + 'tyramine is not pedantry: it is why the restriction is specifically about the PODS and about '
          + 'quantity, and why treating it as "a tyramine food" produces the wrong advice.',
        watchFor: 'The same picture as a tyramine reaction: abrupt headache, palpitations, raised blood pressure.',
        cites: [...citesOf(a.r, b.r), 'gillman2018', 'gardner1996'],
      });
    }
  }
  return out;
}

const ENZYME_PAIRS = Object.freeze([
  ['cyp3a4-inhibition', 'cyp3a4-induction'],
  ['cyp2d6-inhibition', null],
  ['cyp1a2-inhibition', 'cyp1a2-induction'],
  ['cyp2c9-inhibition', null],
  ['cyp2c19-inhibition', null],
  ['pgp-inhibition', 'pgp-induction'],
]);

function ruleEnzymes(by) {
  const out = [];
  for (const [inhMech, indMech] of ENZYME_PAIRS) {
    const inhibitors = by[inhMech]?.inhibits || [];
    const substrates = by[inhMech]?.substrate || [];
    for (const a of inhibitors) {
      for (const b of substrates) {
        if (a.sub.id === b.sub.id) continue;
        const s = str(a.r);
        let severity = s >= 3 ? 'major' : s === 2 ? 'moderate' : 'monitor';
        if (b.sub.nti && s >= 2) severity = 'critical';
        else if (b.sub.nti) severity = 'major';
        const prodrug = /prodrug|converts|conversion/i.test(String(b.r.note || ''));
        out.push({
          id: `${inhMech}:${a.sub.id}+${b.sub.id}`,
          severity,
          mechanism: MECHANISMS[inhMech].name,
          mechanismIds: [inhMech],
          participants: [a.sub.id, b.sub.id],
          headline: `${a.sub.name} inhibits ${MECHANISMS[inhMech].name.replace(' inhibition', '')}; ${b.sub.name} is cleared by it`,
          what: prodrug
            ? `${a.sub.name} slows the enzyme that ACTIVATES ${b.sub.name}. The interaction therefore runs backwards from the usual expectation: less active drug, not more.`
            : `${a.sub.name} slows the ${MECHANISMS[inhMech].kind === 'transporter' ? 'transporter' : 'enzyme'} that clears ${b.sub.name}, so ${b.sub.name} reaches higher blood levels than its dose implies. ${MECHANISMS[inhMech].why}`,
          substrateNote: b.r.note || '',
          inhibitorNote: a.r.note || '',
          participantNotes: [a.r.note || '', b.r.note || ''],
          nti: !!b.sub.nti,
          watchFor: b.sub.nti
            ? 'This is a narrow-therapeutic-index drug: the gap between a working level and a toxic one is small, '
              + 'and it is usually monitored by blood test for exactly that reason.'
            : 'The exaggerated version of that drug\'s own dose-related effects.',
          cites: citesOf(a.r, b.r),
        });
      }
    }
    if (!indMech) continue;
    const inducers = by[indMech]?.induces || [];
    const indSubstrates = by[indMech]?.substrate || [];
    for (const a of inducers) {
      for (const b of indSubstrates) {
        if (a.sub.id === b.sub.id) continue;
        const s = str(a.r);
        out.push({
          id: `${indMech}:${a.sub.id}+${b.sub.id}`,
          severity: b.sub.nti ? 'critical' : s >= 3 ? 'major' : 'moderate',
          mechanism: MECHANISMS[indMech].name,
          mechanismIds: [indMech],
          participants: [a.sub.id, b.sub.id],
          headline: `${a.sub.name} induces ${MECHANISMS[indMech].name.replace(' induction', '')}; ${b.sub.name} is cleared by it`,
          what: `${a.sub.name} increases the ${MECHANISMS[indMech].kind === 'transporter' ? 'transporter' : 'enzyme'} that clears ${b.sub.name}, so ${b.sub.name} is destroyed faster `
            + 'and its blood level falls. This is the mirror hazard, and the harder one to notice: nothing feels '
            + 'wrong, the medicine simply stops working. ' + MECHANISMS[indMech].why,
          substrateNote: b.r.note || '',
          inducerNote: a.r.note || '',
          participantNotes: [a.r.note || '', b.r.note || ''],
          nti: !!b.sub.nti,
          watchFor: 'Loss of effect rather than toxicity — and, when the inducer is STOPPED, the level climbing '
            + 'back up over days to weeks with no change in prescription.',
          cites: citesOf(a.r, b.r),
        });
      }
    }
  }
  return out;
}

function ruleMineralocorticoid(by) {
  const out = [];
  const inhibitors = by['11bhsd2-inhibition']?.inhibits || [];
  const others = [...(by['11bhsd2-inhibition']?.substrate || []), ...(by['11bhsd2-inhibition']?.provides || [])];
  for (const a of inhibitors) {
    out.push({
      id: `licorice:${a.sub.id}`,
      severity: 'moderate',
      mechanism: MECHANISMS['11bhsd2-inhibition'].name,
      mechanismIds: ['11bhsd2-inhibition'],
      participants: [a.sub.id],
      headline: `${a.sub.name} — pseudohyperaldosteronism on its own, before any other substance is involved`,
      what: 'Glycyrrhizin inhibits 11β-hydroxysteroid dehydrogenase type 2, the enzyme that converts cortisol '
        + 'to inactive cortisone inside the kidney. Cortisol then reaches the mineralocorticoid receptor, and the '
        + 'body behaves as if aldosterone were high while aldosterone is actually suppressed: sodium and water '
        + 'retained, potassium excreted, blood pressure up.',
      watchFor: 'Rising blood pressure, swelling, muscle weakness or cramps, and on a blood test low potassium '
        + 'with metabolic alkalosis. Reported at sustained intakes around 100 mg glycyrrhizin per day; severe '
        + 'cases have included hypokalaemic paralysis, rhabdomyolysis and arrhythmia. It resolves on stopping, '
        + 'but over weeks rather than days.',
      cites: citesOf(a.r),
    });
    for (const b of others) {
      if (a.sub.id === b.sub.id) continue;
      out.push({
        id: `hypokalaemia:${a.sub.id}+${b.sub.id}`,
        severity: b.sub.nti ? 'critical' : 'major',
        mechanism: 'potassium loss, compounded',
        mechanismIds: ['11bhsd2-inhibition'],
        participants: [a.sub.id, b.sub.id],
        headline: `${a.sub.name} + ${b.sub.name} — two routes to the same low potassium`,
        what: b.sub.id === 'digoxin'
          ? 'Digoxin toxicity is potentiated by low potassium, and this is the clearest example on this page of '
            + 'an interaction that does not change a drug level at all. The digoxin concentration can be exactly '
            + 'where it should be while the drug becomes dangerous, because the tissue it acts on has changed.'
          : 'Both lower serum potassium, by different mechanisms, and the effect is additive.',
        substrateNote: b.r.note || '',
        participantNotes: [a.r.note || '', b.r.note || ''],
        watchFor: 'Weakness, cramps, palpitations; on a blood test, potassium below range. With digoxin also '
          + 'nausea, visual disturbance (classically yellow-green haloes) and arrhythmia.',
        cites: citesOf(a.r, b.r),
      });
    }
  }
  return out;
}

function ruleAdditivePD(by) {
  const out = [];
  const qt = by['qt-prolongation']?.agonist || [];
  if (qt.length >= 2) {
    out.push({
      id: `qt:${qt.map((x) => x.sub.id).join('+')}`,
      severity: 'major',
      mechanism: MECHANISMS['qt-prolongation'].name,
      mechanismIds: ['qt-prolongation'],
      participants: qt.map((x) => x.sub.id),
      headline: `Additive QT prolongation: ${qt.map((x) => x.sub.name).join(' + ')}`,
      what: 'Each of these delays cardiac repolarisation, and the effect adds. The risk that matters is torsades '
        + 'de pointes. It is amplified by low potassium and low magnesium, by bradycardia, by female sex, and by '
        + 'anything that raises the blood level of one of the agents — which is how a CYP interaction on this same '
        + 'page becomes a cardiac one.',
      watchFor: 'Palpitations, fainting or near-fainting, especially on exertion or startle.',
      cites: [...new Set(qt.flatMap((x) => x.r.cites || []))],
    });
  }
  const hep = by.hepatotoxicity?.provides || [];
  if (hep.length >= 2) {
    out.push({
      id: `hepato:${hep.map((x) => x.sub.id).join('+')}`,
      severity: 'moderate',
      mechanism: MECHANISMS.hepatotoxicity.name,
      mechanismIds: ['hepatotoxicity'],
      participants: hep.map((x) => x.sub.id),
      headline: `Additive liver signal: ${hep.map((x) => x.sub.name).join(' + ')}`,
      what: 'More than one agent here carries a documented hepatotoxicity signal. This is additivity at the organ '
        + 'rather than a pharmacokinetic interaction.',
      watchFor: 'Fatigue, nausea, right-upper-abdominal discomfort, dark urine, yellowing of skin or eyes.',
      cites: [...new Set(hep.flatMap((x) => x.r.cites || []))],
    });
  }
  const sz = by['seizure-threshold']?.agonist || [];
  if (sz.length >= 2) {
    out.push({
      id: `seizure:${sz.map((x) => x.sub.id).join('+')}`,
      severity: 'major',
      mechanism: MECHANISMS['seizure-threshold'].name,
      mechanismIds: ['seizure-threshold'],
      participants: sz.map((x) => x.sub.id),
      headline: `Additive seizure risk: ${sz.map((x) => x.sub.name).join(' + ')}`,
      what: 'Each of these lowers the seizure threshold and the effect adds. It is worth reading alongside the '
        + 'CYP findings above: an inhibitor that raises the blood level of one of them raises the seizure risk '
        + 'too, which is how a metabolic interaction becomes a neurological event.',
      watchFor: 'Myoclonic jerks, confusion, and seizure. Risk rises with dose and with anything that raises '
        + 'peak concentration.',
      cites: [...new Set(sz.flatMap((x) => x.r.cites || []))],
    });
  }
  return out;
}

const RULES = [ruleSerotonin, ruleDualMAOI, ruleTyramine, ruleEnzymes, ruleMineralocorticoid, ruleAdditivePD];

// ── check() — the entry point ─────────────────────────────────────────────────────────────────────

/**
 * check(declared) — declared is an array of strings (or one comma/newline separated string).
 * Returns { ok, declared, recognised, unrecognised, findings, worst, coverage, ... }. Never throws.
 */
export function check(declared) {
  try {
    const list = Array.isArray(declared)
      ? declared
      : String(declared == null ? '' : declared).split(/[,\n;]+/);
    const items = list.map((x) => String(x == null ? '' : x).trim()).filter(Boolean).slice(0, 100);

    const recognised = [];
    const unrecognised = [];
    const seen = new Set();
    for (const raw of items) {
      const sub = resolve(raw);
      if (!sub) { unrecognised.push(raw); continue; }
      if (seen.has(sub.id)) continue;
      seen.add(sub.id);
      recognised.push({ declared: raw, id: sub.id, name: sub.name, kind: sub.kind, slug: sub.slug });
    }
    const stack = recognised.map((r) => resolve(r.id)).filter(Boolean);
    const by = build(stack);

    const findings = [];
    for (const rule of RULES) {
      try { findings.push(...rule(by, stack)); } catch { /* a broken rule must not take the page down */ }
    }
    // de-duplicate and sort worst-first
    const byId = new Map();
    for (const f of findings) if (!byId.has(f.id)) byId.set(f.id, f);
    const sorted = [...byId.values()]
      .map((f) => ({ ...f, cites: [...new Set(f.cites || [])].filter((c) => CITES[c]) }))
      .sort((a, b) => rank(b.severity) - rank(a.severity) || a.id.localeCompare(b.id));

    const substanceWarnings = stack
      .filter((s) => s.toxicity)
      .map((s) => ({ id: s.id, name: s.name, toxicity: s.toxicity, cites: s.toxicityCites || [] }));

    return {
      ok: true,
      declared: items,
      recognised,
      unrecognised,
      findings: sorted,
      worst: sorted.length ? sorted[0].severity : null,
      counts: SEVERITY.reduce((a, s) => (a[s] = sorted.filter((f) => f.severity === s).length, a), {}),
      substanceWarnings,
      coverage: coverage({
        unrecognisedMeans: unrecognised.length
          ? `${unrecognised.length} of the ${items.length} things you named are NOT in this dataset and were not `
            + 'checked at all: ' + unrecognised.join(', ') + '. Nothing below covers them.'
          : 'Everything you named was recognised. That is not the same as everything being checked — see what '
            + 'this dataset does not cover.',
      }),
    };
  } catch {
    return {
      ok: false, declared: [], recognised: [], unrecognised: [], findings: [], worst: null,
      counts: {}, substanceWarnings: [], error: 'check failed',
      coverage: coverage({ unrecognisedMeans: 'Nothing was checked — the check itself failed.' }),
    };
  }
}

/** pairCheck(a, b) — the two-substance case, used to decide whether a pair page has real content. */
export function pairCheck(a, b) {
  const r = check([a, b]);
  return { ...r, a: resolve(a), b: resolve(b) };
}

// ── the clinician export ──────────────────────────────────────────────────────────────────────────
// Legible like a lab report. NOT a lab report — CONSULT.notALab says so and it is repeated here rather
// than imported, because this module must stand alone if the site module ever moves.

export const NOT_A_LAB =
  'This is not a laboratory result. No specimen was taken and no clinical assay was run. It is a record of '
  + 'what the patient states they are taking, with documented interactions from a curated literature dataset '
  + 'attached, laid out so a clinician can read it quickly.';

/**
 * clinicianExport(declared, opts) — the declared stack plus findings, formatted for a doctor.
 * The whole point: a clinician cannot check interactions against something they do not know the
 * patient is taking. Supplements, plant preparations, foods and seasonings are exactly what does not
 * get mentioned in the visit, and exactly what is in this table.
 */
export function clinicianExport(declared, { date = new Date().toISOString().slice(0, 10), patient = '' } = {}) {
  const r = check(declared);
  const lines = [];
  lines.push('DECLARED SUBSTANCE RECORD — interaction screen');
  lines.push(`Prepared ${date}${patient ? ` for ${patient}` : ''}. Dataset last reviewed ${LAST_REVIEWED}.`);
  lines.push('');
  lines.push('NOT A LABORATORY RESULT');
  lines.push(NOT_A_LAB);
  lines.push('');
  lines.push('DECLARED BY PATIENT (self-report, not verified)');
  if (!r.recognised.length && !r.unrecognised.length) lines.push('  (nothing declared)');
  for (const x of r.recognised) lines.push(`  • ${x.declared} → ${x.name} [${x.kind}]`);
  for (const x of r.unrecognised) lines.push(`  • ${x} → NOT IN DATASET — not screened`);
  lines.push('');
  lines.push('DOCUMENTED INTERACTIONS IN THIS DATASET');
  if (!r.findings.length) {
    lines.push('  NONE FOUND. Read the coverage statement before treating that as reassurance.');
  }
  for (const f of r.findings) {
    lines.push(`  [${f.severity.toUpperCase()}] ${f.headline}`);
    lines.push(`      mechanism: ${f.mechanism}`);
    lines.push(`      ${f.what}`);
    if (f.thresholds) lines.push(`      thresholds: ${f.thresholds}`);
    if (f.watchFor) lines.push(`      watch for: ${f.watchFor}`);
    if (f.timing) lines.push(`      timing: ${f.timing}`);
    if (f.recognition) {
      lines.push(`      recognition — ${f.recognition.name}: ${f.recognition.precondition}`);
      for (const rule of f.recognition.rules) lines.push(`          · ${rule}`);
      lines.push(`          ${f.recognition.whyItMatters}`);
      lines.push(`          ${f.recognition.escalation}`);
    }
    lines.push(`      refs: ${f.cites.map(citeShort).join('; ')}`);
  }
  if (r.substanceWarnings.length) {
    lines.push('');
    lines.push('SUBSTANCE-SPECIFIC TOXICITY NOTES');
    for (const w of r.substanceWarnings) lines.push(`  • ${w.name}: ${w.toxicity}`);
  }
  lines.push('');
  lines.push('COVERAGE — READ THIS BEFORE INTERPRETING THE ABOVE');
  lines.push(`  ${r.coverage.statement}`);
  lines.push(`  ${r.coverage.unrecognisedMeans}`);
  lines.push('  NOT covered by this screen:');
  for (const d of r.coverage.doesNotCover) lines.push(`    – ${d}`);
  lines.push('');
  lines.push(`  ${r.coverage.consult}`);
  return { ...r, date, text: lines.join('\n'), notALab: NOT_A_LAB };
}

export function citeShort(id) {
  const c = CITES[id];
  if (!c) return `[UNVERIFIED: ${id}]`;
  const handle = c.doi ? `doi:${c.doi}` : c.pmid ? `PMID ${c.pmid}` : c.url || '';
  const mark = c.verified ? '' : ' [UNVERIFIED]';
  return `${c.authors} (${c.year}) ${c.journal}. ${handle}${mark}`;
}

export function citeUrl(id) {
  const c = CITES[id];
  if (!c) return '';
  return c.doi ? `https://doi.org/${c.doi}` : c.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/` : (c.url || '');
}

// ── openFDA: an ADDITIONAL source, never the coverage story ────────────────────────────────────────
// Public domain, no key required for low volume. It only has FDA-approved products — no label exists
// for nutmeg, grapefruit, harmala or any plant preparation, which is precisely the gap the curated
// table above fills.

export const OPENFDA_LABEL = 'https://api.fda.gov/drug/label.json';

/** labelInteractions(name) — the FDA's own DRUG INTERACTIONS / CONTRAINDICATIONS label sections. */
export async function labelInteractions(name) {
  const q = String(name == null ? '' : name).trim().toLowerCase();
  const miss = (reason) => ({
    query: q, checked: false, sections: null, reason,
    warning: 'NOT CHECKED — this is not a finding of "no interactions". Do not present it as one.',
  });
  if (!q) return miss('empty query');
  try {
    const search = `(openfda.generic_name:"${q}" OR openfda.brand_name:"${q}")`;
    const r = await _fetch(`${OPENFDA_LABEL}?search=${encodeURIComponent(search)}&limit=1`, {
      headers: { 'User-Agent': 'MELEK-Hathor/1.0 (+https://hathor.live)' },
    });
    if (!r || !r.ok) return miss(`openFDA returned no usable response for "${q}"`);
    const j = await r.json();
    const rec = Array.isArray(j?.results) ? j.results[0] : null;
    if (!rec) return miss(`no FDA drug label found for "${q}". Many substances — every plant preparation, `
      + 'every seasoning, every research chemical — have no FDA label at all. That is UNKNOWN, not safe.');
    const sect = (k) => {
      const v = rec[k];
      const arr = Array.isArray(v) ? v : (v ? [v] : []);
      return arr.map((x) => String(x).trim()).filter(Boolean);
    };
    const sections = {
      drug_interactions: sect('drug_interactions'),
      contraindications: sect('contraindications'),
      boxed_warning: sect('boxed_warning'),
      warnings: sect('warnings'),
    };
    const any = Object.values(sections).some((a) => a.length);
    if (!any) return miss(`a label exists for "${q}" but carries none of the interaction sections. An absent `
      + 'section is not an all-clear.');
    return {
      query: q, checked: true, sections,
      brand: (rec.openfda?.brand_name || [])[0] || null,
      source: 'FDA Structured Product Labeling via openFDA (public domain)',
      sourceUrl: 'https://open.fda.gov/apis/drug/label/',
      note: 'FDA-approved labelling for an approved product. It covers that product only, and it is not a '
        + 'complete interaction check.',
    };
  } catch {
    return miss('openFDA request failed');
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CRAWLABLE SURFACE
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ A FORM IS NOT A PAGE. An interaction checker that only exists behind "type your medications into
// a box" generates zero organic traffic: nothing is at a crawlable URL until a human submits a query,
// so there is nothing for a crawler to index. This repo already made that mistake once (the
// /gamer-hub vertical, fixed in PR #977). The interactive checker below sits ON TOP OF a static
// corpus, not instead of one.
//
// ⚠️ AND THIN CONTENT IS PENALISED. Auto-generating the cross-product of 72 substances would be 2,556
// near-identical pages and would harm the whole domain. So pair pages pass TWO gates, in code, not by
// habit — see PAIR_GATE below. A pair that fails is folded into the substance page and never gets a
// URL of its own.
//
// ⚠️ AND THIS IS YMYL. Health pages from an unknown domain rank only if they are genuinely good. The
// citation discipline is therefore not merely honesty, it is the ranking strategy: every claim carries
// an author, a year and a DOI that resolves, and the last-reviewed date is on the page in the visible
// text and in MedicalWebPage.lastReviewed. Schema property names below were checked against the live
// schema.org vocabulary on 2026-09-09 (schemaorg-current-https.jsonld), not recalled — `lastReviewed`
// and `reviewedBy` are WebPage properties, `medicalAudience` is MedicalWebPage, and `interactingDrug`
// and `foodWarning` are Drug properties. `significance` was checked and REJECTED: its only domain is
// SuperficialAnatomy.

export const PAIR_GATE = Object.freeze({
  minSeverity: 'moderate',
  minCitations: 2,
  // Counted over SUBSTANCE-SPECIFIC prose only — the shared mechanism boilerplate that appears on every
  // page of a family is excluded on purpose, because counting it would let the gate pass pages that say
  // nothing new. This is the number that decides whether a URL exists.
  minSpecificWords: 50,
  // Gate B, the one that stops programmatic sameness: a pair page must carry material specific to BOTH
  // participants, or to one participant plus a threshold/timing block. Otherwise it is the mechanism
  // page with two names swapped in, and it belongs on the mechanism page.
  minParticipantNotes: 2,
  maxPerSubstance: 8,
  // Gate B, the one that stops programmatic sameness: a pair page must say something a reader could
  // not get from the mechanism page alone — a substance-specific note, a threshold, a toxicity line.
  requiresDistinctDetail: true,
});

/** A substance needs this many words of material specific to IT before it earns a URL. */
export const SUBSTANCE_MIN_SPECIFIC_WORDS = 25;

const uniq = (a) => [...new Set(a)];
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

/** Every substance that earns its own page, keyed by slug (several entries share a slug on purpose). */
export function substancePages() {
  const bySlug = new Map();
  for (const s of SUBSTANCES) {
    if (!bySlug.has(s.slug)) bySlug.set(s.slug, []);
    bySlug.get(s.slug).push(s);
  }
  const out = [];
  for (const [slug, group] of bySlug) {
    const cites = uniq(group.flatMap((s) => [...(s.roles || []).flatMap((r) => r.cites || []), ...(s.toxicityCites || [])]));
    // Specific prose only: the summary, the per-role notes, the toxicity paragraph. The mechanism
    // descriptions also render on the page but are shared boilerplate, so they do not count here.
    const prose = group.map((s) => `${s.summary || ''} ${(s.roles || []).map((r) => r.note || '').join(' ')} ${s.toxicity || ''}`).join(' ');
    if (!cites.length || words(prose) < SUBSTANCE_MIN_SPECIFIC_WORDS) continue; // thin — folded into its mechanism page
    out.push({
      path: `/interactions/${slug}`,
      kind: 'substance',
      slug,
      group,
      title: `${group[0].name} — drug and food interactions`,
      description: (group[0].summary || `Documented interactions for ${group[0].name}, by mechanism, with citations.`).slice(0, 300),
      cites,
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** One page per mechanism slug. These are the pages that hold the pairs we refuse to generate. */
export function mechanismPages() {
  const bySlug = new Map();
  for (const [id, m] of Object.entries(MECHANISMS)) {
    if (!bySlug.has(m.slug)) bySlug.set(m.slug, []);
    bySlug.get(m.slug).push({ id, ...m });
  }
  return [...bySlug.entries()].map(([slug, group]) => ({
    path: `/interactions/${slug}`,
    kind: 'mechanism',
    slug,
    group,
    title: `${group[0].name} — what it is and what it changes`,
    description: group[0].short,
  })).sort((a, b) => a.slug.localeCompare(b.slug));
}

const pairSlug = (a, b) => [a.slug, b.slug].sort()[0] + '-and-' + [a.slug, b.slug].sort()[1];

/**
 * pairPages() — the long-tail landing pages, "can I take X with Y", which is where the search volume
 * is. Returns { pages, refused } so the refusal count is a reportable number rather than a claim.
 */
export function pairPages() {
  const pages = new Map();
  const refused = [];
  const list = SUBSTANCES;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      if (a.slug === b.slug) continue;
      const slug = pairSlug(a, b);
      if (pages.has(slug)) continue;
      const r = check([a.id, b.id]);
      const findings = r.findings.filter((f) => f.participants.length >= 2 && rank(f.severity) >= rank(PAIR_GATE.minSeverity));
      if (!findings.length) { refused.push({ slug, why: 'no documented interaction at moderate or above' }); continue; }
      const cites = uniq(findings.flatMap((f) => f.cites));
      if (cites.length < PAIR_GATE.minCitations) { refused.push({ slug, why: `only ${cites.length} citation(s)` }); continue; }
      const notes = uniq(findings.flatMap((f) => f.participantNotes || []).filter(Boolean));
      const distinct = notes.length >= PAIR_GATE.minParticipantNotes;
      if (PAIR_GATE.requiresDistinctDetail && !distinct) {
        refused.push({ slug, why: `nothing specific to both participants — ${notes.length} participant note(s)` });
        continue;
      }
      // Counted over the substance-specific paragraphs ONLY. `what`, `watchFor` and the Hunter criteria
      // are templates shared by every page in a family, so counting them would let the gate pass a page
      // whose only unique content is two names.
      const prose = uniq(findings.flatMap((f) => [
        f.thresholds, f.modernEvidence, f.substrateNote, f.inhibitorNote, f.inducerNote, ...(f.participantNotes || []),
      ]).filter(Boolean)).join(' ');
      if (words(prose) < PAIR_GATE.minSpecificWords) { refused.push({ slug, why: `only ${words(prose)} words specific to this pair` }); continue; }
      pages.set(slug, {
        path: `/interactions/${slug}`,
        kind: 'pair',
        slug, a, b, findings, cites,
        title: `${a.name} and ${b.name} — is there an interaction?`,
        description: findings[0].headline.slice(0, 300),
      });
    }
  }
  // Gate C — no single substance may carry more than PAIR_GATE.maxPerSubstance pages. Without this, one
  // well-documented substance (grapefruit, phenelzine) generates a long tail of pages that differ only in
  // the partner's name, which is the programmatic-sameness pattern the other gates are too local to see.
  const kept = [...pages.values()].sort((x, y) =>
    rank(y.findings[0].severity) - rank(x.findings[0].severity) || y.cites.length - x.cites.length || x.slug.localeCompare(y.slug));
  const perSub = new Map();
  const final = [];
  for (const pg of kept) {
    const a = perSub.get(pg.a.id) || 0; const b = perSub.get(pg.b.id) || 0;
    if (a >= PAIR_GATE.maxPerSubstance || b >= PAIR_GATE.maxPerSubstance) {
      refused.push({ slug: pg.slug, why: `per-substance cap (${PAIR_GATE.maxPerSubstance}) already reached — folded into the substance page` });
      continue;
    }
    perSub.set(pg.a.id, a + 1); perSub.set(pg.b.id, b + 1);
    final.push(pg);
  }
  return { pages: final.sort((x, y) => x.slug.localeCompare(y.slug)), refused };
}

let _pages = null;
/** allPages() — index + substances + mechanisms + gated pairs. Computed once. */
export function allPages() {
  if (_pages) return _pages;
  const { pages: pairs, refused } = pairPages();
  const index = {
    path: '/interactions', kind: 'index', slug: '', title: 'Drug, food and seasoning interactions — by mechanism',
    description: 'A mechanism-based interaction reference: what you are taking, what it does to the enzymes and '
      + 'transporters that clear everything else, and what is documented to follow. With citations.',
  };
  _pages = { index, substances: substancePages(), mechanisms: mechanismPages(), pairs, refused };
  return _pages;
}

/** interactionPaths() — for the host site's sitemap.xml. Every generated page, no others. */
export function interactionPaths() {
  const p = allPages();
  return [p.index.path, ...p.mechanisms.map((x) => x.path), ...p.substances.map((x) => x.path), ...p.pairs.map((x) => x.path)];
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────

const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

/**
 * A REFERENCE page is an article about substances; the CHECKER output is a record about a person. A
 * page that looks personalised invites a different mistake from one that does not, so it gets the
 * stronger sentence. The index is both, because it is an article that hosts the form.
 */
export const NOT_A_SCREEN =
  'This is a reference article, not a screen of anything you are taking. It describes what is documented '
  + 'about these substances in general. It knows nothing about your dose, your other medicines, your '
  + 'genotype, your kidneys or your liver — all of which decide whether any of it applies to you.';

/** The consult block. The same words in the same place on every page, so it is recognised, not re-read. */
export function consultBlock(kind = 'reference') {
  const lines = kind === 'record' ? [NOT_A_LAB] : kind === 'both' ? [NOT_A_SCREEN, NOT_A_LAB] : [NOT_A_SCREEN];
  return `<aside class="consult" role="note">
  <p><b>Consult your doctor or pharmacist.</b> This is educational reference, not medical advice. It does not
  diagnose, treat, cure or prevent anything, and it does not tell you what to do about your own prescriptions.</p>
  ${lines.map((l) => `<p class="muted">${esc(l)}</p>`).join('\n  ')}
</aside>`;
}

/** The coverage block, rendered. It is on every page, above the fold of the findings, not in a footer. */
export function coverageBlock() {
  const c = coverage();
  return `<section class="coverage" id="coverage">
  <h2>What a clean result means here</h2>
  <p class="loud">${esc(c.statement)}</p>
  <div class="cols">
    <div><h3>In this dataset</h3><ul>${COVERS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div><h3>Not in this dataset</h3><ul>${DOES_NOT_COVER.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>
  <p class="muted">${esc(c.substancesInDataset)} substances, ${esc(c.mechanismsInDataset)} mechanisms,
  ${esc(c.citationsInDataset)} citations. Last reviewed <time datetime="${esc(LAST_REVIEWED)}">${esc(LAST_REVIEWED)}</time>.
  ${esc(c.sources)}</p>
</section>`;
}

export function citeList(ids) {
  const seen = uniq(ids).filter((id) => CITES[id]);
  if (!seen.length) return '';
  return `<section class="refs"><h2>References</h2><ol>${seen.map((id) => {
    const c = CITES[id];
    const u = citeUrl(id);
    const handle = c.doi ? `doi:${c.doi}` : c.pmid ? `PMID ${c.pmid}` : (c.url || '');
    const mark = c.verified ? '' : ' <b>[UNVERIFIED]</b>';
    return `<li id="ref-${esc(id)}">${esc(c.authors)} (${esc(c.year)}). <i>${esc(c.title)}</i>. ${esc(c.journal)}. `
      + (u ? `<a href="${esc(u)}" rel="nofollow noopener">${esc(handle)}</a>` : esc(handle)) + mark + '</li>';
  }).join('')}</ol>
  <p class="muted">Every DOI above was resolved against the Crossref API on ${esc(LAST_REVIEWED)} and the returned
  title checked against the one printed here. Three DOIs in the first draft resolved to real but <em>different</em>
  papers and were corrected before publication.</p></section>`;
}

const SEV_LABEL = Object.freeze({
  critical: 'Critical', major: 'Major', moderate: 'Moderate', monitor: 'Worth knowing', info: 'Note',
});

export function findingHTML(f) {
  const cites = uniq(f.cites).filter((id) => CITES[id]);
  return `<article class="finding sev-${esc(f.severity)}">
  <h3><span class="sev">${esc(SEV_LABEL[f.severity] || f.severity)}</span> ${esc(f.headline)}</h3>
  <p class="mech">Mechanism: <b>${esc(f.mechanism)}</b></p>
  <p>${esc(f.what)}</p>
  ${f.thresholds ? `<p><b>Thresholds.</b> ${esc(f.thresholds)}</p>` : ''}
  ${f.modernEvidence ? `<p><b>What the modern evidence changed.</b> ${esc(f.modernEvidence)}</p>` : ''}
  ${f.timing ? `<p><b>Timing.</b> ${esc(f.timing)}</p>` : ''}
  ${f.inhibitorNote ? `<p>${esc(f.inhibitorNote)}</p>` : ''}
  ${f.inducerNote ? `<p>${esc(f.inducerNote)}</p>` : ''}
  ${f.substrateNote ? `<p>${esc(f.substrateNote)}</p>` : ''}
  ${f.watchFor ? `<p><b>What to watch for.</b> ${esc(f.watchFor)}</p>` : ''}
  ${f.recognition ? recognitionHTML(f.recognition) : ''}
  ${cites.length ? `<p class="cites">Sources: ${cites.map((id) => `<a href="#ref-${esc(id)}">${esc(CITES[id].authors.split(',')[0])} ${esc(CITES[id].year)}</a>`).join(', ')}</p>` : '<p class="cites"><b>[UNVERIFIED]</b> no citation attached to this finding.</p>'}
</article>`;
}

export function recognitionHTML(h) {
  return `<div class="recognition"><h4>${esc(h.name)}</h4>
  <p>${esc(h.precondition)}</p>
  <ol>${h.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
  <p>${esc(h.performance)}</p>
  <p><b>${esc(h.whyItMatters)}</b></p>
  <p>${esc(h.escalation)}</p></div>`;
}

const STYLE = `<style>
:root{--bg:#12101a;--fg:#e9e4f5;--muted:#a49bbd;--line:#2c2740;--card:#1a1726;--acc:#b487ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:52rem;margin:0 auto;padding:2rem 1.1rem 5rem}
h1{font-size:1.9rem;line-height:1.2;margin:.2rem 0 .6rem}h2{font-size:1.25rem;margin:2.2rem 0 .6rem;border-top:1px solid var(--line);padding-top:1.2rem}
h3{font-size:1.05rem;margin:1.3rem 0 .4rem}h4{margin:1rem 0 .3rem;font-size:.95rem}
a{color:var(--acc)}.muted{color:var(--muted);font-size:.9rem}
.consult{border:1px solid var(--acc);border-radius:10px;padding:.9rem 1rem;margin:1.2rem 0;background:#1c1630}
.coverage{border:1px solid var(--line);border-radius:10px;padding:1rem;margin:1.4rem 0;background:var(--card)}
.coverage .loud{font-weight:600;color:#ffd9a0}
.cols{display:grid;gap:1rem;grid-template-columns:1fr}@media(min-width:44rem){.cols{grid-template-columns:1fr 1fr}}
.cols ul{padding-left:1.1rem;margin:.3rem 0}.cols li{font-size:.88rem;margin:.3rem 0;color:var(--muted)}
.finding{border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:.8rem 1rem;margin:1rem 0;background:var(--card)}
.sev-critical{border-left-color:#ff5c5c}.sev-major{border-left-color:#ff9f43}.sev-moderate{border-left-color:#ffd93d}
.sev-monitor{border-left-color:#5ec5ff}.sev-info{border-left-color:var(--muted)}
.sev{font-size:.7rem;letter-spacing:.09em;text-transform:uppercase;border:1px solid currentColor;border-radius:99px;padding:.1rem .5rem;margin-right:.4rem;vertical-align:middle}
.recognition{border:1px dashed var(--line);border-radius:8px;padding:.7rem .9rem;margin:.8rem 0;background:#151222}
.mech{color:var(--muted);font-size:.9rem;margin:.2rem 0 .6rem}.cites{font-size:.85rem;color:var(--muted)}
.refs ol{padding-left:1.2rem}.refs li{font-size:.86rem;margin:.45rem 0;color:var(--muted)}
nav.crumbs{font-size:.85rem;color:var(--muted);margin-bottom:.8rem}
ul.grid{list-style:none;padding:0;display:grid;gap:.5rem;grid-template-columns:1fr}@media(min-width:40rem){ul.grid{grid-template-columns:1fr 1fr}}
ul.grid li{border:1px solid var(--line);border-radius:8px;padding:.6rem .8rem;background:var(--card)}
form.check{border:1px solid var(--line);border-radius:10px;padding:1rem;background:var(--card);margin:1.2rem 0}
textarea{width:100%;min-height:6rem;background:#0f0d17;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:.6rem;font:inherit}
button{background:var(--acc);color:#150f22;border:0;border-radius:6px;padding:.55rem 1.1rem;font:inherit;font-weight:600;cursor:pointer;margin-top:.6rem}
</style>`;

function shell({ title, description, canonical, body, jsonldNodes = [], lastReviewed = LAST_REVIEWED }) {
  const nodes = [
    {
      '@context': 'https://schema.org', '@type': 'MedicalWebPage',
      name: title, description, url: canonical,
      lastReviewed,                                   // WebPage property — verified against schema.org
      reviewedBy: { '@type': 'Organization', name: 'MELEK / Hathor — Library of Ashurbanipal' },
      medicalAudience: 'Patient',                     // MedicalWebPage property — verified
      isPartOf: { '@type': 'WebSite', name: 'hathor.live', url: BASE_URL },
    },
    ...jsonldNodes,
  ].filter(Boolean);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}">
${nodes.map(jsonLd).join('\n')}
${STYLE}</head><body><main>${body}
<p class="muted">Last reviewed <time datetime="${esc(lastReviewed)}">${esc(lastReviewed)}</time>.
<a href="/interactions">All interaction pages</a>.</p>
</main></body></html>`;
}

const crumbs = (trail) => `<nav class="crumbs">${trail.map((t, i) => (i ? ' → ' : '') + (t.url ? `<a href="${esc(t.url)}">${esc(t.name)}</a>` : esc(t.name))).join('')}</nav>`;

/** The interactive checker. It sits on top of the static corpus — it does not replace it. */
function checkerForm(prefill = '') {
  return `<form class="check" method="GET" action="/interactions/check">
  <label for="taking"><b>What are you taking?</b> Prescriptions, supplements, plant preparations, foods,
  seasonings — one per line or comma separated. Nothing is stored and nothing is sent anywhere but this page.</label>
  <textarea id="taking" name="taking" placeholder="phenelzine&#10;aged cheddar&#10;tramadol&#10;black pepper">${esc(prefill)}</textarea>
  <button type="submit">Check this stack</button>
</form>`;
}

export function indexHTML() {
  const p = allPages();
  const path = '/interactions';
  const body = `<h1>Drug, food and seasoning interactions</h1>
<p>Most interaction checkers are pair lookup tables, and the pairs nobody typed in are invisible. This one is
built the other way round: on <b>mechanisms</b>. <i>CYP3A4 inhibition</i> is one rule and it covers grapefruit,
ketoconazole, ritonavir, clarithromycin <em>and</em> the piperine in black pepper. A mechanism generalises to a
substance that is not in the table yet. A pair list cannot.</p>
<p>It is also why the seasoning shelf is here rather than as a curiosity. Nutmeg, grapefruit, black pepper,
licorice, cinnamon and star anise are not folk warnings — they are documented pharmacology, and the enzymes
they move are the same ones your prescriptions are cleared by.</p>
${consultBlock('both')}
${checkerForm()}
${coverageBlock()}
<h2>By mechanism</h2>
<ul class="grid">${p.mechanisms.map((m) => `<li><a href="${esc(m.path)}">${esc(m.group[0].name)}</a><br><span class="muted">${esc(m.group[0].short)}</span></li>`).join('')}</ul>
<h2>By substance</h2>
<ul class="grid">${p.substances.map((s) => `<li><a href="${esc(s.path)}">${esc(s.group[0].name)}</a></li>`).join('')}</ul>
<h2>Specific combinations</h2>
<p class="muted">${esc(p.pairs.length)} combination pages exist because there is documented, cited, substance-specific
material to put on them. ${esc(p.refused.length)} further combinations were deliberately <b>not</b> given a page:
a page with nothing on it is worse than no page, both for the reader and for the site.</p>
<ul class="grid">${p.pairs.map((x) => `<li><a href="${esc(x.path)}">${esc(x.a.name)} + ${esc(x.b.name)}</a></li>`).join('')}</ul>`;
  return shell({ title: 'Drug, food and seasoning interactions — by mechanism', description: p.index.description, canonical: `${BASE_URL}${path}`, body });
}

export function substanceHTML(page) {
  const s = page.group[0];
  const others = page.group.slice(1);
  const p = allPages();
  const related = p.pairs.filter((x) => x.a.slug === page.slug || x.b.slug === page.slug);
  // Everything in the dataset this substance is documented to reach, by mechanism.
  const reach = [];
  for (const role of (s.roles || [])) {
    if (!['inhibits', 'induces', 'provides'].includes(role.role)) continue;
    const partners = SUBSTANCES.filter((o) => o.id !== s.id && (o.roles || []).some((r) => r.mech === role.mech && r.role === 'substrate'));
    if (partners.length) reach.push({ role, partners });
  }
  const findings = check([s.id]).findings;
  const body = `${crumbs([{ name: 'Interactions', url: '/interactions' }, { name: s.name }])}
<h1>${esc(s.name)} — interactions</h1>
${s.summary ? `<p>${esc(s.summary)}</p>` : ''}
${others.length ? `<p class="muted">Also covers: ${others.map((o) => esc(o.name)).join(', ')}.</p>` : ''}
<p class="muted">Also known as: ${esc((s.aka || []).join(', ') || '—')}. Category: ${esc(s.kind)}.${s.nti ? ' <b>Narrow therapeutic index.</b>' : ''}</p>
${consultBlock()}
<h2>What it does, mechanism by mechanism</h2>
${(s.roles || []).map((r) => `<article class="finding"><h3>${esc(MECHANISMS[r.mech].name)} — ${esc(r.role)}${r.strength ? `, ${esc(r.strength)}` : ''}</h3>
<p>${esc(MECHANISMS[r.mech].short)} ${esc(MECHANISMS[r.mech].why)}</p>
${r.note ? `<p>${esc(r.note)}</p>` : ''}
<p class="cites">Sources: ${(r.cites || []).filter((id) => CITES[id]).map((id) => `<a href="#ref-${esc(id)}">${esc(CITES[id].authors.split(',')[0])} ${esc(CITES[id].year)}</a>`).join(', ') || '<b>[UNVERIFIED]</b>'}
 · <a href="/interactions/${esc(MECHANISMS[r.mech].slug)}">more on ${esc(MECHANISMS[r.mech].name)}</a></p></article>`).join('')}
${s.fdaLabel ? `<h2>What the FDA label itself says</h2><blockquote class="finding"><p>${esc(s.fdaLabel)}</p>
<p class="cites">FDA Structured Product Labeling, retrieved via the openFDA drug/label API (CC0 1.0 Universal) on ${esc(LAST_REVIEWED)}.</p></blockquote>` : ''}
${s.toxicity ? `<h2>Toxicity in its own right</h2><article class="finding sev-major"><p>${esc(s.toxicity)}</p>
<p class="cites">Sources: ${(s.toxicityCites || []).filter((id) => CITES[id]).map((id) => `<a href="#ref-${esc(id)}">${esc(CITES[id].authors.split(',')[0])} ${esc(CITES[id].year)}</a>`).join(', ')}</p></article>` : ''}
${findings.length ? `<h2>Flagged on its own</h2>${findings.map(findingHTML).join('')}` : ''}
${reach.length ? `<h2>What it reaches in this dataset</h2>${reach.map((x) => `<h3>Via ${esc(MECHANISMS[x.role.mech].name)}</h3>
<ul class="grid">${x.partners.map((o) => `<li>${esc(o.name)}${o.nti ? ' <span class="muted">(narrow therapeutic index)</span>' : ''}</li>`).join('')}</ul>`).join('')}
<p class="muted">This list is what is IN the table. It is not the set of substances this interacts with — that set is
larger and partly unknown, and the mechanism is the thing to carry to a substance we have not listed.</p>` : ''}
${related.length ? `<h2>Specific combinations</h2><ul class="grid">${related.map((x) => `<li><a href="${esc(x.path)}">${esc(x.a.name)} + ${esc(x.b.name)}</a></li>`).join('')}</ul>` : ''}
${coverageBlock()}
${citeList(page.cites)}`;
  const drugNode = {
    '@context': 'https://schema.org', '@type': 'Drug', name: s.name,
    alternateName: s.aka || [], description: s.summary || page.description, url: `${BASE_URL}${page.path}`,
  };
  const foodWarn = findings.find((f) => f.thresholds);
  if (foodWarn) drugNode.foodWarning = foodWarn.thresholds;      // Drug property — verified
  const inter = related.map((x) => (x.a.slug === page.slug ? x.b : x.a)).map((o) => ({ '@type': 'Drug', name: o.name }));
  if (inter.length) drugNode.interactingDrug = inter;             // Drug property — verified
  return shell({ title: page.title, description: page.description, canonical: `${BASE_URL}${page.path}`, body, jsonldNodes: [drugNode] });
}

export function mechanismHTML(page) {
  const m = page.group[0];
  const ids = page.group.map((g) => g.id);
  const actors = SUBSTANCES.filter((s) => (s.roles || []).some((r) => ids.includes(r.mech) && r.role !== 'substrate'));
  const victims = SUBSTANCES.filter((s) => (s.roles || []).some((r) => ids.includes(r.mech) && r.role === 'substrate'));
  const cites = uniq(SUBSTANCES.flatMap((s) => (s.roles || []).filter((r) => ids.includes(r.mech)).flatMap((r) => r.cites || [])));
  const body = `${crumbs([{ name: 'Interactions', url: '/interactions' }, { name: m.name }])}
<h1>${esc(m.name)}</h1>
${page.group.map((g) => `<p><b>${esc(g.name)}.</b> ${esc(g.short)} ${esc(g.why)}</p>`).join('')}
${consultBlock()}
<h2>What acts on it</h2>
<ul class="grid">${actors.map((s) => {
    const r = (s.roles || []).find((x) => ids.includes(x.mech) && x.role !== 'substrate');
    const link = substancePages().find((p) => p.slug === s.slug);
    return `<li>${link ? `<a href="${esc(link.path)}">${esc(s.name)}</a>` : esc(s.name)}
    <span class="muted">— ${esc(r.role)}, ${esc(r.strength || 'unspecified')}</span>${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</li>`;
  }).join('') || '<li class="muted">Nothing in this dataset.</li>'}</ul>
<h2>What is affected by it</h2>
<ul class="grid">${victims.map((s) => {
    const link = substancePages().find((p) => p.slug === s.slug);
    return `<li>${link ? `<a href="${esc(link.path)}">${esc(s.name)}</a>` : esc(s.name)}${s.nti ? ' <span class="muted">(narrow therapeutic index)</span>' : ''}</li>`;
  }).join('') || '<li class="muted">Nothing in this dataset.</li>'}</ul>
${ids.includes('mao-a-inhibition') || page.slug === 'serotonin' ? `<h2>Recognising serotonin toxicity</h2>${recognitionHTML(HUNTER_CRITERIA)}` : ''}
${coverageBlock()}
${citeList(cites)}`;
  return shell({ title: page.title, description: page.description, canonical: `${BASE_URL}${page.path}`, body });
}

export function pairHTML(page) {
  const body = `${crumbs([{ name: 'Interactions', url: '/interactions' }, { name: `${page.a.name} + ${page.b.name}` }])}
<h1>${esc(page.a.name)} and ${esc(page.b.name)}</h1>
<p>Yes — there is a documented interaction between these two, and it has a named mechanism.
${esc(page.findings.map((f) => f.mechanism).filter((v, i, a) => a.indexOf(v) === i).join('; '))}.</p>
${consultBlock()}
${page.findings.map(findingHTML).join('')}
<h2>The mechanism, generalised</h2>
<p>Read the mechanism page and you can apply this to substances that are not on it:
${uniq(page.findings.flatMap((f) => f.mechanismIds)).filter((id) => MECHANISMS[id]).map((id) => `<a href="/interactions/${esc(MECHANISMS[id].slug)}">${esc(MECHANISMS[id].name)}</a>`).join(', ')}.</p>
<p>Substance pages: <a href="/interactions/${esc(page.a.slug)}">${esc(page.a.name)}</a> ·
<a href="/interactions/${esc(page.b.slug)}">${esc(page.b.name)}</a>.</p>
${coverageBlock()}
${citeList(page.cites)}`;
  const nodes = [{
    '@context': 'https://schema.org', '@type': 'Drug', name: page.a.name,
    url: `${BASE_URL}/interactions/${page.a.slug}`,
    interactingDrug: [{ '@type': 'Drug', name: page.b.name, url: `${BASE_URL}/interactions/${page.b.slug}` }],
  }];
  return shell({ title: page.title, description: page.description, canonical: `${BASE_URL}${page.path}`, body, jsonldNodes: nodes });
}

/** The interactive result. noindex — it is per-query and would otherwise be duplicate thin content. */
export function checkHTML(taking) {
  const r = check(taking);
  const cites = uniq(r.findings.flatMap((f) => f.cites));
  const body = `${crumbs([{ name: 'Interactions', url: '/interactions' }, { name: 'Your stack' }])}
<h1>What you told us you are taking</h1>
<ul class="grid">${r.recognised.map((x) => {
    const pg = substancePages().find((p) => p.slug === x.slug);
    return `<li>${pg ? `<a href="${esc(pg.path)}">${esc(x.name)}</a>` : esc(x.name)} <span class="muted">(${esc(x.kind)})</span></li>`;
  }).join('')}${r.unrecognised.map((x) => `<li>${esc(x)} — <b>not in this dataset, not checked</b></li>`).join('')}</ul>
${consultBlock('record')}
${r.findings.length
    ? `<h2>${esc(r.findings.length)} documented interaction${r.findings.length === 1 ? '' : 's'}</h2>${r.findings.map(findingHTML).join('')}`
    : `<h2>Nothing documented in this dataset</h2><p class="loud">That is not a finding of safety. It means no
       documented interaction <em>in this dataset</em>, which holds ${esc(SUBSTANCES.length)} substances out of the
       tens of thousands that exist, and models a handful of the mechanisms that exist. Read the coverage statement
       below before you take this as reassurance.</p>`}
${r.substanceWarnings.length ? `<h2>Toxicity notes for what you named</h2>${r.substanceWarnings.map((w) => `<article class="finding sev-major"><h3>${esc(w.name)}</h3><p>${esc(w.toxicity)}</p></article>`).join('')}` : ''}
<h2>Take this to a clinician</h2>
<p>A doctor cannot check interactions against something they do not know you are taking, and supplements, plant
preparations, foods and seasonings are exactly what does not come up in the visit. This is the plain-text version
of what you entered, laid out so it can be read quickly.</p>
<pre style="white-space:pre-wrap;border:1px solid var(--line);border-radius:8px;padding:.9rem;background:#0f0d17;font-size:.82rem">${esc(clinicianExport(taking).text)}</pre>
${coverageBlock()}
${citeList(cites)}
${checkerForm(Array.isArray(taking) ? taking.join('\n') : String(taking || ''))}`;
  return shell({ title: 'Your declared stack — interaction screen', description: 'Interaction screen for a declared stack.', canonical: `${BASE_URL}/interactions/check`, body })
    .replace('<meta name="robots" content="index,follow,max-image-preview:large">', '<meta name="robots" content="noindex,follow">');
}

/** pageFor(path) — the router's lookup. Returns null for a path we deliberately did not generate. */
export function pageFor(path) {
  const p = allPages();
  if (path === '/interactions' || path === '/interactions/') return { kind: 'index' };
  const all = [...p.mechanisms, ...p.substances, ...p.pairs];
  return all.find((x) => x.path === path) || null;
}

export function renderPath(path) {
  const pg = pageFor(path);
  if (!pg) return null;
  if (pg.kind === 'index') return indexHTML();
  if (pg.kind === 'substance') return substanceHTML(pg);
  if (pg.kind === 'mechanism') return mechanismHTML(pg);
  if (pg.kind === 'pair') return pairHTML(pg);
  return null;
}

/** The sitemap fragment, so the host can serve /interactions/sitemap.xml directly if it prefers. */
export function sitemapXmlFragment(base = BASE_URL, today = new Date().toISOString().slice(0, 10)) {
  return interactionPaths().map((u) =>
    `  <url><loc>${esc(base)}${esc(u)}</loc><lastmod>${esc(today)}</lastmod><changefreq>monthly</changefreq>`
    + `<priority>${u === '/interactions' ? '0.9' : '0.7'}</priority></url>`).join('\n');
}

// ── handler ───────────────────────────────────────────────────────────────────────────────────────

/** handler(req, res) — mountable at /interactions on any host. Returns true if it handled the request. */
export function handler(req, res) {
  try {
    const url = new URL(req.url || '/', BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/interactions' && !path.startsWith('/interactions/')) return false;

    const send = (html, code = 200, type = 'text/html; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type, 'x-robots-tag': code === 200 ? 'index,follow' : 'noindex' });
      res.end(html);
      return true;
    };
    if (path === '/interactions/sitemap.xml') {
      return send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapXmlFragment()}\n</urlset>`, 200, 'application/xml; charset=utf-8');
    }
    if (path === '/interactions/check') {
      return send(checkHTML(url.searchParams.get('taking') || ''));
    }
    if (path === '/interactions/api') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(check(url.searchParams.get('taking') || '')));
      return true;
    }
    const html = renderPath(path);
    if (html) return send(html);
    return send(indexHTML().replace('<h1>', '<h1>Not found — '), 404);
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('interactions: error'); } catch { /* ignore */ }
    return true;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--pages') {
    const p = allPages();
    console.log(`index 1 · mechanisms ${p.mechanisms.length} · substances ${p.substances.length} · pairs ${p.pairs.length} · REFUSED ${p.refused.length}`);
    for (const u of interactionPaths()) console.log(u);
  } else if (args[0] === '--refused') {
    for (const r of allPages().refused) console.log(`${r.slug}\t${r.why}`);
  } else {
    console.log(clinicianExport(args.length ? args : ['phenelzine', 'aged cheese', 'tramadol']).text);
  }
}

export default { check, resolve, clinicianExport, coverage, interactionPaths, allPages, handler, __setFetch };
