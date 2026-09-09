// site/hathor-live/placebo-baseline.mjs — what the comparison group actually was, and what that lets
// a result say.
//
// WHY THIS FILE EXISTS. `practices.mjs` grades every entry strong / moderate / promising / weak /
// traditional, and `the-line.mjs` states the position that produced those grades: "we publish what the
// studies found, including where they found nothing." Both are honest about the SIZE of an effect.
// Neither says anything about the BASELINE it was measured against — and the baseline is where almost
// all of the misreading happens, in both directions.
//
// ⭐ THE POINT, in one sentence: the placebo ARM OF A TRIAL IS NOT A NO-TREATMENT ARM.
//
// When somebody says "it's just placebo" they almost always mean "it did nothing." Those are different
// claims and the difference is measurable, because a placebo arm contains at least four things stacked
// on top of each other:
//
//   1. natural history        — the condition would have changed on its own over the trial period
//   2. regression to the mean — people enrol when they are at their worst, and worst is not typical
//   3. research participation — being watched, measured, attended to, and asked how you are
//   4. response bias          — reporting improvement to a kind experimenter who plainly wants it
//   ... and only THEN, underneath all of that, any true placebo response.
//
// You cannot separate them without a design that contains an actual UNTREATED arm. That design exists
// and it has been meta-analysed: Krogsbøll, Hróbjartsson & Gøtzsche (2009) pooled the 37 trials that
// randomised to all three of no treatment, placebo, and active. The answer is in THREE_ARM below, and
// it settles the argument in both directions at once — placebo is measurably more than nothing, and
// nothing is measurably more than zero.
//
// WHAT THIS MODULE IS NOT. It makes no claim that anything in this library works, and it is not a
// grading scheme — `practices.mjs` grades effect size, this grades DESIGN. A practice can be honestly
// graded `moderate` on a trial with a weak comparator, and honestly graded `traditional` with no trial
// at all. Both are stated; neither is fixed by this file. All this does is make the sentence a reader
// is entitled to say out loud after reading a grade explicit instead of implied.
//
// Every number below carries a DOI resolved against the Crossref API and an abstract read this session.
// Nothing here is rounded, softened, or reported half.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, offline, no network, no clock.
//
//   import { COMPONENTS, COMPARATORS, THREE_ARM, LANDMARKS, CEILING,
//            comparatorFor, baselineNote, baselineHTML, coverage, handler } from './placebo-baseline.mjs';

/** esc — every value interpolated into HTML goes through this. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 1. What is inside a placebo arm ────────────────────────────────────────────────────────────
//
// Ordered by how much of the observed change each one typically accounts for, worst-understood last.
// The `separableBy` field is the whole contribution: it names the design feature that removes this
// component, which is how you read backwards from a study to what its result can support.

export const COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'natural-history',
    name: 'Natural history',
    what: 'The condition changes on its own. Most complaints that bring people into a trial are episodic, and episodes end.',
    separableBy: 'an untreated arm followed for the same period',
    evidence:
      'Across 37 three-armed trials the untreated arms improved by SMD −0.24 from baseline — about a '
      + 'quarter of the change seen in the active arms, with nothing given at all.',
    cite: 'krogsboll-2009',
  }),
  Object.freeze({
    id: 'regression-to-the-mean',
    name: 'Regression to the mean',
    what: 'People enrol when they feel worst. A measurement taken at a personal extreme is followed, on average, by a less extreme one — with or without an intervention. This is arithmetic, not biology.',
    separableBy: 'an untreated arm, or repeated baseline measurement before randomisation',
    evidence:
      'McDonald, Mazzuca & McCabe put the question in their title in 1983 — "How much of the placebo '
      + '‘effect’ is really statistical regression?" — and the answer has been non-zero ever since.',
    cite: 'mcdonald-1983',
  }),
  Object.freeze({
    id: 'research-participation',
    name: 'Research participation effects',
    what: 'Being enrolled, observed, measured and asked about your symptoms changes what you do and what you report. The Hawthorne label is older than the evidence for it.',
    separableBy: 'an untreated arm that is still assessed on the same schedule — untreated is not unobserved',
    evidence:
      'A systematic review of 19 purpose-designed studies found consequences of research participation '
      + 'do exist, but that "little can be securely known about the conditions under which they operate, '
      + 'their mechanisms of effects, or their magnitudes." Real, and not yet quantified.',
    cite: 'mccambridge-2014',
  }),
  Object.freeze({
    id: 'response-bias',
    name: 'Response bias and demand characteristics',
    what: 'What a participant tells a friendly experimenter who is visibly hoping for improvement. This is a reporting effect, not an experience effect, and the two are very hard to tell apart from the outside.',
    separableBy: 'blinding, and objective outcomes measured by an instrument rather than by a person',
    evidence:
      'The Cochrane review’s own conclusion names this as the limit of its positive finding: placebo '
      + 'interventions can influence patient-reported outcomes, "though it is difficult to distinguish '
      + 'patient-reported effects of placebo from biased reporting."',
    cite: 'hg-2010',
  }),
  Object.freeze({
    id: 'true-placebo',
    name: 'True placebo response',
    what: 'What is left when the four above are removed: a change produced by expectation, conditioning, ritual and the encounter itself. It is real, it is physiological, and it is smaller than the folklore.',
    separableBy: 'nothing simpler than a three-armed trial — this is the residual, and it is only ever measured by subtraction',
    evidence:
      'Placebo arms improved by SMD −0.44 against −0.24 for untreated arms in the same trials. The gap '
      + 'is the residual, and it is about a fifth of the active-arm change.',
    cite: 'krogsboll-2009',
  }),
]);

export const COMPONENT_IDS = Object.freeze(COMPONENTS.map((c) => c.id));

// ── 2. The three-arm decomposition ─────────────────────────────────────────────────────────────
//
// ⭐ This is the operator's argument in numbers, and it cuts both ways in the same table. Read the
// first row before deciding the second row is small.

export const THREE_ARM = Object.freeze({
  source: 'krogsboll-2009',
  design: '37 trials (2,900 patients, 8 clinical conditions) that had randomised patients to all three of no treatment, placebo, and an active intervention',
  interventionMix: '17 psychological, 15 physical, 5 pharmacological',
  arms: Object.freeze([
    Object.freeze({ arm: 'no treatment', smd: -0.24, ci: [-0.36, -0.12], reads: 'What happens with nothing given. Not zero — and this is the number that gets left out of the argument.' }),
    Object.freeze({ arm: 'placebo', smd: -0.44, ci: [-0.61, -0.28], reads: 'Nothing given, framed as something. Almost twice the untreated change.' }),
    Object.freeze({ arm: 'active', smd: -1.01, ci: [-1.16, -0.86], reads: 'The intervention under test, which also contains both of the rows above.' }),
  ]),
  // The authors' own arithmetic, quoted rather than recomputed.
  contributionOfSpontaneousImprovement: 0.24,
  contributionOfPlacebo: 0.20,
  authorsCaveat:
    'The authors state the relative contributions as "24% and 20%, respectively, but with some '
    + 'uncertainty, as indicated by the confidence intervals for the three SMDs."',
  // The two sentences the table licenses. Both, or neither.
  bothHalves: Object.freeze([
    'Placebo is not nothing: the placebo arms moved roughly twice as far as the untreated arms in the same trials.',
    'Nothing is not zero: the untreated arms moved a quarter as far as the active arms while receiving no intervention at all.',
  ]),
});

// ── 3. Study designs, and what each one licenses ───────────────────────────────────────────────
//
// `licenses` is the sentence a reader may say after a POSITIVE result on this design. `withholds` is
// the sentence they may not. Ranked strongest first; `rank` is used by coverage reporting and nothing
// else — it is not a quality score for the practice, only for the comparison.

export const COMPARATORS = Object.freeze([
  Object.freeze({
    id: 'three-arm',
    rank: 7,
    name: 'Three-armed: untreated, placebo, and active',
    removes: ['natural-history', 'regression-to-the-mean', 'research-participation', 'response-bias'],
    licenses: 'The effect is larger than doing nothing AND larger than an inert version of the same ritual. This is the only design that separates those two.',
    withholds: 'Nothing much — but a subjective outcome is still a report, and blinding is what protects that, not the third arm.',
    rarity: 'Rare. The pooled evidence base is 37 trials across the whole of medicine.',
  }),
  Object.freeze({
    id: 'placebo',
    rank: 6,
    name: 'Placebo- or sham-controlled, no untreated arm',
    removes: ['natural-history', 'regression-to-the-mean', 'research-participation', 'response-bias'],
    licenses: 'The effect is larger than an inert version of the same ritual, delivered with the same attention.',
    withholds: 'Any statement about how much of the placebo arm’s own improvement was the placebo rather than the condition running its course. That question is not in this design.',
    rarity: 'The standard for drug trials; uncommon for behavioural techniques, where a convincing sham is hard to build.',
  }),
  Object.freeze({
    id: 'no-treatment',
    rank: 5,
    name: 'Untreated or waiting-list control, no inert arm',
    removes: ['natural-history', 'regression-to-the-mean'],
    licenses: 'The effect is larger than leaving the person alone for the same period.',
    withholds: '⭐ Any claim that the specific technique did it. Attention, expectation and ritual are all still inside the result, and an inert procedure delivered as convincingly might have matched it.',
    rarity: 'Common in behavioural research, because it is the cheapest honest control.',
  }),
  Object.freeze({
    id: 'active-comparator',
    rank: 4,
    name: 'Technique against technique, nothing inert and nobody untreated',
    removes: ['response-bias'],
    licenses: 'One technique did better than, worse than, or the same as another. That is all.',
    withholds: '⭐ Any claim that EITHER of them beat doing nothing. Two techniques performing "comparably" is fully consistent with both performing exactly as well as an empty room.',
    rarity: 'Very common, and the single most over-read design in this library.',
  }),
  Object.freeze({
    id: 'within-subject',
    rank: 3,
    name: 'Before-and-after in the same people, no separate comparison group',
    removes: [],
    licenses: 'Something changed over the study period in the people studied.',
    withholds: 'Every component in COMPONENTS. Natural history and regression to the mean are entirely unaddressed by this design.',
    rarity: 'The usual shape of a proof-of-concept or pilot.',
  }),
  Object.freeze({
    id: 'observational',
    rank: 2,
    name: 'Association measured, nothing randomised',
    removes: [],
    licenses: 'Two things travel together in this sample.',
    withholds: 'Direction and cause, both. The clean demonstration is in this library already: long-term meditators report more lucid dreams, and an eight-week course did not produce them.',
    rarity: 'Common, and useful — as a place to point a trial, not as a result.',
  }),
  Object.freeze({
    id: 'none',
    rank: 1,
    name: 'No comparison group at all',
    removes: [],
    licenses: 'People report this happening. That is a real thing to know and it is not an effect size.',
    withholds: 'That the practice caused it, that it beats doing nothing, or that it beats a convincing imitation of itself. With no comparison group there is nothing to subtract, so every component above stays in the number.',
    rarity: 'Most of the folk-technique literature. Graded `traditional` here for exactly this reason.',
  }),
  Object.freeze({
    id: 'unstated',
    rank: 0,
    name: 'Controlled, but we have not established against what',
    removes: [],
    licenses: 'Nothing yet. This is a gap in our reading, not a verdict on the study.',
    withholds: 'Everything, until someone reads the methods section and changes this entry.',
    rarity: 'Reported rather than hidden. `coverage()` prints these.',
  }),
]);

export const COMPARATOR_IDS = Object.freeze(COMPARATORS.map((c) => c.id));

const COMPARATOR_BY_ID = Object.freeze(Object.fromEntries(COMPARATORS.map((c) => [c.id, c])));

/** comparatorFor(id) — the design record, or null. Unknown ids return null rather than throwing. */
export function comparatorFor(id) {
  const key = String(id == null ? '' : id).trim().toLowerCase();
  return COMPARATOR_BY_ID[key] || null;
}

// ── 4. The practice catalogue, classified by comparator ────────────────────────────────────────
//
// Kept HERE rather than added as a field to practices.mjs, so that the design classification and the
// evidence grade stay separable and one can be revised without touching the other. `why` quotes the
// design from the study's own abstract; where the abstract does not say, the entry is `unstated` and
// says so. There is no default: an unlisted practice returns `unstated` and appears in coverage().

export const PRACTICE_COMPARATORS = Object.freeze({
  'imagery-distraction': Object.freeze({
    comparator: 'no-treatment',
    why: 'Harvey & Payne (2002) randomised 41 people with insomnia to one of three instructional sets: imagery distraction, general distraction, or NO INSTRUCTIONS. The third is an untreated arm.',
    note: '⭐ The strongest comparator anywhere in this catalogue. The result cleared an untreated arm — and there was still no inert arm, so attention and expectation remain inside it.',
  }),
  'counting-sheep': Object.freeze({
    comparator: 'no-treatment',
    why: 'Same trial, same untreated arm. The general-distraction arm is the counting-sheep shape.',
    note: 'The negative result is as well-controlled as the positive one, which is why it is worth listing.',
  }),
  mild: Object.freeze({
    comparator: 'active-comparator',
    why: 'The 2020 induction study compared five technique combinations against each other. No inert arm and no untreated arm.',
    note: '⭐ "MILD and SSILD came out similarly effective" is a between-technique statement. It does not establish that either beat doing nothing.',
  }),
  ssild: Object.freeze({
    comparator: 'active-comparator',
    why: 'The same 2020 induction study, in which SSILD was one of the five technique combinations. Nothing inert, nobody untreated.',
    note: 'Two mechanistically different techniques performing comparably is a useful practical finding and a weak causal one.',
  }),
  wbtb: Object.freeze({
    comparator: 'within-subject',
    why: 'Sleep-laboratory work on the wake-then-return structure, plus a 2022 study of interruption timing. Neither is an inert-controlled trial of WBTB against a comparison group.',
  }),
  'dild-reality-testing': Object.freeze({
    comparator: 'active-comparator',
    why: 'Reality testing appeared inside the technique combinations of the 2020 trial rather than as an isolated arm.',
    note: 'The module already grades this weak on the grounds that it was never the isolated variable. The comparator says the same thing from the design side.',
  }),
  wild: Object.freeze({ comparator: 'none', why: 'Rich instructional and first-person literature; no controlled data specific to WILD as a discrete technique, so there is no comparison group to speak of.' }),
  fild: Object.freeze({ comparator: 'none', why: 'Zero published trials. A large body of community anecdote, which is a report rather than a comparison, and cannot separate any of the components above.' }),
  deild: Object.freeze({ comparator: 'none', why: 'No controlled trials of DEILD as a discrete technique. The underlying wake-then-return observation is supported; the technique built on it has never had a comparison group.' }),
  'ada-cat': Object.freeze({ comparator: 'none', why: 'Neither all-day awareness nor cycle adjustment has controlled data of any kind; both are habit-formation proposals rather than tested interventions.' }),
  'dream-journal': Object.freeze({
    comparator: 'observational',
    why: 'Superior dream recall was identified as a PREDICTOR of successful induction within the 2020 trial. Predictor, not randomised arm.',
    note: '⭐ Recall was not randomised, so "recall is the prerequisite" is an association. It may be that people who recall dreams were going to succeed anyway.',
  }),
  'olfactory-cue': Object.freeze({
    comparator: 'within-subject',
    why: 'A 2020 proof-of-concept. The module already says "proof of concept means exactly that."',
  }),
  tlr: Object.freeze({
    comparator: 'within-subject',
    why: 'A clinical pilot combining cognitive behavioural work with targeted lucidity reactivation. Pilot design, no inert arm reported.',
  }),
  'gamma-tacs-rem': Object.freeze({
    comparator: 'placebo',
    why: 'Voss et al. (2014) applied frontal current during REM and report that OTHER STIMULATION FREQUENCIES WERE NOT EFFECTIVE. Inactive frequencies are the sham arm.',
    note: '⭐ The best comparator in the cueing family, and the reason this entry is graded promising rather than traditional. Frequency-specificity is a hard thing to fake.',
  }),
  'b6-recall': Object.freeze({
    comparator: 'placebo',
    why: 'Aspy et al. (2018) ran a randomised, double-blind, placebo-controlled trial in 100 participants, with a third B-complex arm.',
    note: 'Inert-controlled and blinded, with no untreated arm — so the increase in recalled content is against placebo, which is the right comparison for a pill.',
  }),
  'lucid-nightmares': Object.freeze({
    comparator: 'no-treatment',
    why: 'The 2006 pilot randomised 23 nightmare sufferers to individual sessions, group sessions, or a WAITING LIST. A waiting list is an untreated arm.',
    note: '⭐ The pilot’s own conclusion is a component finding worth more than its effect size: "Lucidity was not necessary for a reduction in nightmare frequency." The active ingredient was not the one in the name.',
  }),
  'meditation-lucid': Object.freeze({
    comparator: 'unstated',
    why: 'Baird et al. (2019) describe a "blinded randomized-controlled design" for the 8-week course but the abstract does not name the control condition, and we have not read the methods section.',
    note: 'Listed as unstated rather than guessed. The result being reported is a NULL, and a null is weakened by a weak comparator rather than strengthened, so this gap matters less than it would the other way round.',
  }),

  // ── the verification family, added with the dream work ────────────────────────────────────────
  // These two are the reason "no comparator" is not automatically a criticism. They are EXISTENCE
  // demonstrations, not efficacy trials: the claim is "this happened at all", and the evidence is a
  // physiological record, not a difference between groups. Asking what they were compared against is
  // a category error, and saying so is more useful than filing them under a design they never had.
  'lrlr-signalling': Object.freeze({
    comparator: 'none',
    why: 'LaBerge, Nagel, Dement & Zarcone (1981) verified prearranged eye signals during polysomnographically unequivocal REM in five selected subjects. There is no comparison group because none is required: a voluntary signal either appears in the EOG during verified REM or it does not.',
    note: '⭐ An existence proof, and the strongest evidence in this catalogue for anything — because it does not depend on report at all. This is what separates lucid dreaming from every other entry here: the datum crossed out of the dream and onto an instrument. Five selected subjects establishes that it CAN happen, not how often or in whom.',
  }),
  'two-way-dialogue': Object.freeze({
    comparator: 'none',
    why: 'Konkoly et al. (2021), 36 participants across four independent laboratories, 158 trials in signal-verified lucid REM. Again an existence demonstration: a sleeping brain perceived an external signal, computed on it, and answered.',
    note: '⚠️ The honest number is the silence. 29 correct (18.4%), 5 incorrect, 28 ambiguous, and 96 NO RESPONSE (60.8%). Four labs replicating an effect that fails to appear three times in five is a real result and a hard ceiling. Any protocol claiming a richer channel than this owes an explanation.',
  }),

  'galantamine': Object.freeze({
    comparator: 'placebo',
    why: 'LaBerge, LaMarca & Baird (2018), PLOS ONE 13(8):e0201246 — double-blind, placebo-controlled, crossover, N=121, with a dose–response relationship.',
    note: '⭐ THE ONLY INERT-CONTROLLED ENTRY IN THE LUCID FAMILY. Every induction technique in this catalogue is compared against another technique or against nothing at all; this is the one place a placebo arm exists, and it is a pill rather than a practice — which is exactly why it was blindable. Still no untreated arm, so natural variation in lucid frequency sits inside both arms equally.',
  }),

  'sleep-paralysis': Object.freeze({
    comparator: 'observational',
    why: 'Sharpless & Barber (2011) aggregated 35 studies, total N=36,533, reporting lifetime prevalence. This is an epidemiological estimate, not a trial of anything.',
    note: 'Nothing is being tested, so nothing is being controlled. It is here because it is a thing that HAPPENS to people attempting WILD, and a prevalence figure is the right kind of evidence for that claim — the wrong kind would be a comparator.',
  }),
});

/**
 * baselineNote(practiceId) — the explainer a practice page renders under its evidence grade.
 * Returns a plain object; never throws; an unknown id yields the `unstated` record with `known:false`.
 */
export function baselineNote(practiceId) {
  const key = String(practiceId == null ? '' : practiceId).trim();
  const entry = Object.prototype.hasOwnProperty.call(PRACTICE_COMPARATORS, key)
    ? PRACTICE_COMPARATORS[key] : null;
  const id = entry ? entry.comparator : 'unstated';
  const design = comparatorFor(id) || comparatorFor('unstated');
  return {
    practiceId: key,
    known: Boolean(entry),
    comparator: id,
    designName: design.name,
    licenses: design.licenses,
    withholds: design.withholds,
    why: entry ? entry.why : 'Not yet classified in placebo-baseline.mjs.',
    note: (entry && entry.note) || '',
    components: design.removes.slice(),
  };
}

/**
 * coverage(ids) — which practices have no comparator classification yet.
 * Same discipline as pantheon-map's registryGap(): print the backlog rather than hide it.
 * Pass PRACTICE_IDS from practices.mjs; a junk argument yields an empty report rather than an error.
 */
export function coverage(ids) {
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  const classified = list.filter((id) => Object.prototype.hasOwnProperty.call(PRACTICE_COMPARATORS, id));
  const missing = list.filter((id) => !Object.prototype.hasOwnProperty.call(PRACTICE_COMPARATORS, id));
  const stale = Object.keys(PRACTICE_COMPARATORS).filter((id) => list.length > 0 && !list.includes(id));
  const byComparator = {};
  for (const id of classified) {
    const c = PRACTICE_COMPARATORS[id].comparator;
    byComparator[c] = (byComparator[c] || 0) + 1;
  }
  return { total: list.length, classified: classified.length, missing, stale, byComparator };
}

// ── 5. The landmark studies ────────────────────────────────────────────────────────────────────
//
// Every entry: what was compared to what, and the finding reported in BOTH directions where the study
// found in both directions. Hróbjartsson & Gøtzsche is the case in point — it is simultaneously the
// strongest evidence that placebo is not nothing and the strongest evidence against overclaiming it,
// and quoting either half alone is a misquotation.

export const LANDMARKS = Object.freeze([
  Object.freeze({
    id: 'hg-2001',
    label: 'Hróbjartsson & Gøtzsche 2001 — the study that compared placebo with no treatment',
    cite: 'N Engl J Med 344(21):1594-1602',
    doi: '10.1056/NEJM200105243442106',
    design: '130 trials that randomised patients to placebo or to no treatment',
    findings: Object.freeze([
      'Binary outcomes (32 trials, 3,795 patients): no significant effect. Pooled RR 0.95 (95% CI 0.88 to 1.02), "regardless of whether these outcomes were subjective or objective."',
      'Continuous outcomes (82 trials, 4,730 patients): a beneficial effect, SMD −0.28 (95% CI −0.38 to −0.19) — "but the effect decreased with increasing sample size, indicating a possible bias related to the effects of small trials."',
      'Subjective continuous outcomes: SMD −0.36 (95% CI −0.47 to −0.25). Objective outcomes: not significant.',
      'Pain (27 trials): SMD −0.27 (95% CI −0.40 to −0.15) — "a reduction in the intensity of pain of 6.5 mm on a 100-mm visual-analogue scale."',
    ]),
    bothHalves: '6.5 mm on a 100 mm scale is a real number and a small one. Quoting the significance without the magnitude, or the magnitude without the significance, gets it wrong in opposite directions.',
  }),
  Object.freeze({
    id: 'hg-2010',
    label: 'Hróbjartsson & Gøtzsche 2010 — the Cochrane update',
    cite: 'Cochrane Database Syst Rev (1):CD003974',
    doi: '10.1002/14651858.CD003974.pub3',
    design: '202 of 234 included trials with usable data, across 60 clinical conditions. Risk of bias judged low in only 16 trials (8%).',
    findings: Object.freeze([
      'Binary outcomes (44 trials, 6,041 patients): RR 0.93 (95% CI 0.88 to 0.99).',
      'Continuous outcomes (158 trials, 10,525 patients): SMD −0.23 (95% CI −0.28 to −0.17), with an asymmetrical funnel plot the authors call "a questionable procedure to pool".',
      'Patient-reported: SMD −0.26 (−0.32 to −0.19). Observer-reported: SMD −0.13 (−0.24 to −0.02).',
      'Pain: SMD −0.28 (−0.36 to −0.19). Nausea: −0.25 (−0.46 to −0.04).',
      '⭐ The pain result is not one number. Four similarly-designed acupuncture trials by an overlapping group of authors reported SMD −0.68 (−0.85 to −0.50); three other pain trials reported −0.13 (−0.28 to 0.03). Same outcome, same review, opposite conclusions.',
      'Larger placebo effects went with physical placebos (e.g. sham acupuncture), patient-involved outcomes, small trials, trials whose explicit purpose was to study placebo, and trials that did not tell patients a placebo might be given.',
    ]),
    conclusionVerbatim:
      'We did not find that placebo interventions have important clinical effects in general. However, in '
      + 'certain settings placebo interventions can influence patient-reported outcomes, especially pain '
      + 'and nausea, though it is difficult to distinguish patient-reported effects of placebo from biased '
      + 'reporting.',
    bothHalves: 'Both halves of that sentence are the finding. A library that quotes the second clause and drops the first is doing the thing this module exists to prevent.',
  }),
  Object.freeze({
    id: 'krogsboll-2009',
    label: 'Krogsbøll, Hróbjartsson & Gøtzsche 2009 — the three-arm decomposition',
    cite: 'BMC Med Res Methodol 9:1',
    doi: '10.1186/1471-2288-9-1',
    design: '37 trials (2,900 patients, 8 conditions) randomising to all three of no treatment, placebo and active',
    findings: Object.freeze([
      'No treatment: SMD −0.24 (−0.36 to −0.12).',
      'Placebo: SMD −0.44 (−0.61 to −0.28).',
      'Active: SMD −1.01 (−1.16 to −0.86).',
      'Relative contributions of spontaneous improvement and of placebo to the active-arm change: 24% and 20%.',
    ]),
    bothHalves: 'This is the single table that answers the question in both directions. Placebo ≠ nothing, and nothing ≠ zero.',
  }),
  Object.freeze({
    id: 'wechsler-2011',
    label: 'Wechsler et al. 2011 — the four-arm asthma trial, and the clearest teaching case in the field',
    cite: 'N Engl J Med 365(2):119-126',
    doi: '10.1056/NEJMoa1103319',
    design: '46 patients randomised, 39 completed. Each received, in randomised order across 12 visits: albuterol inhaler, placebo inhaler, sham acupuncture, and NO INTERVENTION.',
    findings: Object.freeze([
      'Objective outcome (maximum FEV₁): albuterol +20%, versus approximately 7% for each of the other three — including the no-intervention arm. P < 0.001.',
      'Self-reported improvement: albuterol 50%, placebo inhaler 45%, sham acupuncture 46% — no significant difference between them — versus 21% for no intervention. P < 0.001.',
      '⭐ Read the two rows together. Subjectively, the inert interventions matched the drug. Objectively, only the drug moved the lungs. And the untreated arm still gained ~7% FEV₁ and 21% reported improvement, with nothing done at all.',
    ]),
    bothHalves:
      'The authors: "Placebo effects can be clinically meaningful and can rival the effects of active '
      + 'medication ... However, from a clinical-management and research-design perspective, patient '
      + 'self-reports can be unreliable."',
  }),
]);

export const LANDMARK_IDS = Object.freeze(LANDMARKS.map((l) => l.id));

// ── 6. Open-label placebo — the finding that matters most to an institution intending to be honest ─

export const OPEN_LABEL = Object.freeze({
  claimItRefutes: 'Placebo only works by deception.',
  status: 'Refuted as an absolute; the size of what remains is genuinely unsettled.',
  trials: Object.freeze([
    Object.freeze({
      id: 'kaptchuk-2010',
      cite: 'Kaptchuk et al. 2010, PLoS ONE 5(12):e15591',
      doi: '10.1371/journal.pone.0015591',
      what: '80 patients with irritable bowel syndrome, 3 weeks. Pills described to their faces as "placebo pills made of an inert substance, like sugar pills". Comparator: no-treatment control WITH MATCHED patient-provider interaction — which is the design detail that makes it worth anything.',
      result: 'IBS Global Improvement Scale 5.0 ± 1.5 versus 3.9 ± 1.3 at day 21, p = .002.',
    }),
    Object.freeze({
      id: 'carvalho-2016',
      cite: 'Carvalho et al. 2016, Pain 157(12):2766-2772',
      doi: '10.1097/j.pain.0000000000000700',
      what: '97 randomised, 83 completed, chronic low back pain, 3 weeks of open-label placebo added to usual care versus usual care alone.',
      result: 'Composite 0–10 pain reduction 1.5 (95% CI 1.0 to 2.0) versus 0.2 (−0.3 to 0.8). Disability 2.9 (1.7 to 4.0) versus 0.0 (−1.1 to 1.2).',
    }),
    Object.freeze({
      id: 'kleine-borgmann-2019',
      cite: 'Kleine-Borgmann et al. 2019, Pain 160(12):2891-2897',
      doi: '10.1097/j.pain.0000000000001683',
      what: '122 patients with chronic back pain, 3-week open-label placebo versus treatment as usual.',
      result:
        'Pain intensity d = −0.44, disability d = −0.45, depression d = −0.50 — and ⭐ "open-label placebo '
        + 'treatment did not affect objective mobility parameters, anxiety and stress." Subjective moved; '
        + 'the objective measure of the spine did not. The same split Hróbjartsson & Gøtzsche found.',
    }),
    Object.freeze({
      id: 'paediatric-null-2026',
      cite: 'Frontiers in Pediatrics 2026, DRKS00029938',
      doi: '10.3389/fped.2026.1720751',
      what: '47 children aged 8–14, open-label placebo juice before venipuncture versus standard care.',
      result: 'No significant change in pain, anxiety or salivary cortisol. The authors: "The discrepancy between these initial pilot data and those of experimental studies suggests that numerous real-world factors may influence the placebo effect."',
    }),
  ]),
  metaAnalysis: Object.freeze({
    cite: 'von Wernsdorff, Loef, Tuschen-Caffier & Schmidt 2021, Scientific Reports 11:3855',
    doi: '10.1038/s41598-021-83148-6',
    result: '13 studies reviewed, 11 meta-analysed. Overall SMD 0.72 (95% CI 0.39 to 1.05), p < 0.0001, I² = 76%.',
    // ⭐ The caveat is the analysis, not a hedge attached to it.
    caveat:
      'That effect is roughly three times the concealed-placebo effect Hróbjartsson & Gøtzsche measured, '
      + 'which should stop a careful reader rather than excite them. An open-label placebo trial cannot be '
      + 'blinded — the participant is told what they are getting, by construction — so every response-bias '
      + 'and demand-characteristic component that blinding exists to remove is back inside the estimate. '
      + 'The authors say it themselves: risk of bias moderate among all studies, heterogeneity 76%, and '
      + '"the respective research is in its infancy."',
  }),
  honestSummary:
    'Deception is not required. That is established and it matters. How much effect survives without it, '
    + 'in whom, and for how long, is not established, and the largest published effect size in this '
    + 'literature is the one with the weakest protection against reporting bias.',
});

// ── 7. Nocebo — the same machinery, pointed the other way ──────────────────────────────────────

export const NOCEBO = Object.freeze({
  definition: 'Adverse symptoms produced by expectation rather than by pharmacology. It is the same mechanism and it is clinically expensive.',
  samson: Object.freeze({
    cite: 'Wood et al. 2020, N Engl J Med 383(22):2182-2184 (SAMSON)',
    doi: '10.1056/NEJMc2031173',
    design: '60 patients who had previously stopped a statin because of side effects. Twelve one-month periods each: four on atorvastatin 20 mg, four on placebo, four on NO TABLET. Daily symptom scores 0–100.',
    result: 'Mean symptom intensity 8.0 in no-tablet months, 15.4 in placebo months, 16.3 in statin months. The nocebo ratio — placebo symptom burden over statin symptom burden, both above the no-tablet baseline — was 0.90.',
    reading:
      '⭐ Note what the third arm does here. Without the no-tablet months you would compare 15.4 to 16.3 '
      + 'and conclude the tablets caused almost nothing. The no-tablet baseline of 8.0 is what shows that '
      + 'roughly half the symptom burden was there anyway, and that of the half the tablets added, 90% was '
      + 'added by the placebo too. This is the placebo-baseline argument in its negative form.',
    afterwards: 'Half the participants had restarted a statin six months later, having seen their own data.',
  }),
  informedConsent: Object.freeze({
    tension: 'Telling people about possible side effects causes some of them. This is a genuine ethical conflict, not a reason to withhold information.',
    evidence: Object.freeze([
      'Myers, Cairns & Singer (1987): in a multicentre trial of aspirin or sulfinpyrazone, adding a statement about possible gastrointestinal side effects to the consent form in two of three centres produced a SIXFOLD increase (p < 0.001) in withdrawals for subjective minor gastrointestinal symptoms. Major complications diagnosed by study physicians were similar across all three centres.',
      'Mondaini et al. (2007): 120 men prescribed finasteride for benign prostatic hyperplasia, randomised to be counselled or not counselled about sexual side effects, drug otherwise identical.',
      'Barsky et al. (2002) name the factors: prior expectation of harm, conditioning from previous experience, anxiety and somatisation, and situational context.',
    ]),
    // Stated because the library's own position is full disclosure, and full disclosure has this cost.
    ourPosition:
      'This library publishes dose ranges, interactions, contraindications and failure modes in full. '
      + 'The nocebo literature says plainly that doing so will cause some readers to experience some of '
      + 'what they read about. That is a real cost and it is smaller than the cost of a person proceeding '
      + 'without the information. Naming the cost is part of paying it honestly.',
  }),
});

// ── 8. The neurobiology — the hardest evidence that something happens rather than gets reported ─

export const MECHANISM = Object.freeze([
  Object.freeze({
    id: 'levine-1978',
    cite: 'Levine, Gordon & Fields 1978, Lancet 312(8091):654-657',
    doi: '10.1016/S0140-6736(78)92762-9',
    finding:
      'Dental post-operative pain, randomised double-blind naloxone. Naloxone raised reported pain — and '
      + '"the enhancement of reported pain produced by naloxone can be entirely accounted for by its effect '
      + 'on placebo responders." Non-responders were unaffected by it.',
    whyItMatters: 'An opioid antagonist can only reverse something opioid-mediated. Reporting bias is not naloxone-reversible.',
  }),
  Object.freeze({
    id: 'amanzio-1999',
    cite: 'Amanzio & Benedetti 1999, J Neurosci 19(1):484-494',
    doi: '10.1523/JNEUROSCI.19-01-00484.1999',
    finding:
      'Expectation-induced placebo analgesia was completely blocked by naloxone. Conditioning with a '
      + 'non-opioid drug (ketorolac) produced placebo responses that were naloxone-INSENSITIVE. '
      + '"Expectation triggers endogenous opioids, whereas conditioning activates specific subsystems."',
    whyItMatters: '⭐ There is no single placebo mechanism. Expectancy and conditioning are pharmacologically distinguishable, which means "the placebo effect" is a category, not a thing.',
  }),
  Object.freeze({
    id: 'dlff-2001',
    cite: 'de la Fuente-Fernández et al. 2001, Science 293(5532):1164-1166',
    doi: '10.1126/science.1060937',
    finding: 'PET with [¹¹C]raclopride in Parkinson’s disease: placebo produced substantial release of endogenous dopamine in the striatum, measured by competitive displacement of the tracer.',
    whyItMatters: 'A ligand displacement measured by a scanner is not a questionnaire. Whatever the clinical size of the effect, the release happened.',
  }),
  Object.freeze({
    id: 'eippert-2009',
    cite: 'Eippert, Finsterbusch, Bingel & Büchel 2009, Science 326(5951):404',
    doi: '10.1126/science.1180142',
    finding: 'Placebo analgesia reduced pain-related activity in the dorsal horn of the SPINAL CORD, imaged directly.',
    whyItMatters: 'Modulation at the first synapse of the pain pathway, below the brain. Companion paper: Eippert et al. 2009, Neuron 63(4):533-543, DOI 10.1016/j.neuron.2009.07.014.',
  }),
]);

// ── 9. The boundary — where it does not work, stated first rather than last ────────────────────
//
// This section is what makes the rest credible. It is placed here in the file deliberately, and it is
// rendered ABOVE the mechanism section on the page.

export const CEILING = Object.freeze({
  headline: 'Expectation changes what a person feels and reports. It does not change tissue.',
  doesNot: Object.freeze([
    'It does not shrink tumours. Chvetzoff & Tannock (2003) reviewed the placebo arms of 37 randomised trials in oncology: no tumour response attributable to placebo, no improvement in average quality of life across 10 trials, none in performance status across 9, none in weight across 6.',
    'It does not set a fracture, clear an infection, or replace insulin.',
    'It does not change mortality. There is no meta-analytic evidence that placebo arms live longer than untreated arms.',
    'It did not move FEV₁ in the asthma trial. 20% for the drug; ~7% for the placebo inhaler, the sham acupuncture, and the empty chair alike.',
    'It did not move objective spine mobility in the open-label back pain trial, in the same patients whose reported pain fell.',
    'On binary outcomes — did this happen or not — the 2001 analysis found no significant effect at all, subjective or objective.',
  ]),
  soWhat:
    'The pattern is consistent across four decades and it is the honest headline: the effect is on '
    + 'continuous, subjective, patient-reported measures, and it does not appear on objective or binary '
    + 'ones. Anyone arguing the strong version of this — that expectation reorganises the body — has to '
    + 'get past a literature that has looked for exactly that and not found it.',
});

// ── 10. The trait question, answered rather than assumed ───────────────────────────────────────
//
// ⭐ Reported here because an exam battery is one honest question away from shipping a "placebo
// responder" score, and the answer is that it should not.

export const RESPONDER_TRAIT = Object.freeze({
  question: 'Is "placebo responder" a stable property of a person, the way absolute pitch is?',
  verdict: 'No — not as a cross-context trait. It reproduces within an identical procedure and does not survive changing the procedure.',
  evidence: Object.freeze([
    Object.freeze({
      cite: 'Whalley, Hyland & Kirsch 2008, J Psychosom Res 64(5):537-541',
      doi: '10.1016/j.jpsychores.2007.11.007',
      finding:
        '⭐ The direct test, and the decisive one. Two placebo creams with DIFFERENT LABELS, administered '
        + 'to matching fingers, then repeated 1–8 days later. Placebo effects correlated r = .60 and .77 '
        + 'across sessions when the placebo bore the SAME NAME, and were NOT significantly correlated when '
        + 'the placebo had a different name. Response expectancy predicted the effect; acquiescence and '
        + 'absorption did not.',
      authorsConclusion: '"Context-specific predictions of placebo response (e.g., expectancy) are possible, but personality predictors will not be consistent across contexts."',
    }),
    Object.freeze({
      cite: 'Morton, Watson, El-Deredy & Jones 2009, Pain 146(1-2):194-198',
      doi: '10.1016/j.pain.2009.07.026',
      finding: 'Reproducibility of R² = 0.55 across two sessions — of the SAME sham-anaesthetic-cream procedure. Dispositional optimism and low state anxiety predicted response.',
      caveat: 'Same procedure twice. This is the retest coefficient people cite for a trait, and it is a within-procedure number, exactly the condition under which Whalley et al. also found high correlation.',
    }),
    Object.freeze({
      cite: 'Kern, Kramm, Witt & Barth 2020, J Psychosom Res 128:109866',
      doi: '10.1016/j.jpsychores.2019.109866',
      finding: '24 studies systematically reviewed. "Several studies found a positive association between optimism and the placebo response ... higher anxiety was associated with increased nocebo responses." The conclusion is worded as "a possible association" warranting further investigation — which is what a weak literature looks like when it is described accurately.',
    }),
    Object.freeze({
      cite: 'Hall, Loscalzo & Kaptchuk 2015, Trends Mol Med 21(5):285-294',
      doi: '10.1016/j.molmed.2015.02.009',
      finding: 'The "placebome" proposal — that genetic variants (COMT val158met among them) predict placebo response. Candidate-gene work, and candidate-gene work in behavioural phenotypes has a poor replication record generally.',
      caveat: 'Held as a hypothesis. A single-polymorphism predictor of a context-dependent response would be surprising given the Whalley result above.',
    }),
  ]),
  // The design consequence, which is the reason this section is in a code module and not only a paper.
  doNotBuild:
    '⭐ Do not build a "placebo responder" score into the exam battery. The identity-grade rubric asks '
    + 'whether a category survives a second sitting; this one survives a second sitting of the SAME '
    + 'procedure and disappears when the procedure changes, which is the signature of a state measurement '
    + 'wearing a trait’s clothes. What is measurable and worth measuring is RESPONSE EXPECTANCY for a '
    + 'specific procedure at a specific time — a state, reported as a state, on the State Card.',
});

// ── 11. Rendering ──────────────────────────────────────────────────────────────────────────────

/** A compact note for a practice card. Returns '' for an unknown id rather than an empty box. */
export function baselineHTML(practiceId) {
  const n = baselineNote(practiceId);
  if (!n.known) return '';
  return `<aside class="baseline-note" role="note">
  <p class="baseline-design"><b>Compared against:</b> ${esc(n.designName)}</p>
  <p class="baseline-why">${esc(n.why)}</p>
  <p class="baseline-licenses"><b>A positive result here says:</b> ${esc(n.licenses)}</p>
  <p class="baseline-withholds"><b>It does not say:</b> ${esc(n.withholds)}</p>${
  n.note ? `\n  <p class="baseline-extra">${esc(n.note)}</p>` : ''}
</aside>`;
}

/** The standalone explainer page section. Self-contained; no external assets. */
export function PLACEBO_BASELINE_HTML() {
  const rows = THREE_ARM.arms.map((a) => `    <tr><th scope="row">${esc(a.arm)}</th><td>${esc(a.smd.toFixed(2))}</td><td>${esc(a.ci[0].toFixed(2))} to ${esc(a.ci[1].toFixed(2))}</td><td>${esc(a.reads)}</td></tr>`).join('\n');
  const comps = COMPONENTS.map((c) => `    <li><b>${esc(c.name)}.</b> ${esc(c.what)} <i>Separated only by: ${esc(c.separableBy)}.</i></li>`).join('\n');
  const ceiling = CEILING.doesNot.map((d) => `    <li>${esc(d)}</li>`).join('\n');
  const designs = COMPARATORS.filter((c) => c.id !== 'unstated').map((c) => `    <tr><th scope="row">${esc(c.name)}</th><td>${esc(c.licenses)}</td><td>${esc(c.withholds)}</td></tr>`).join('\n');
  return `<section class="placebo-baseline">
  <h2>The placebo baseline</h2>
  <p><b>The placebo arm of a trial is not a no-treatment arm.</b> When someone says a thing is "just
  placebo" they usually mean it did nothing, and those are different claims. A placebo arm has at least
  four things stacked inside it before any placebo response is reached:</p>
  <ul>
${comps}
  </ul>
  <p>Separating them needs a design with an actual untreated arm. ${esc(THREE_ARM.design)} — pooled by
  Krogsbøll, Hróbjartsson and Gøtzsche in 2009:</p>
  <table class="three-arm">
    <caption>Standardised change from baseline, by arm</caption>
    <thead><tr><th scope="col">Arm</th><th scope="col">SMD</th><th scope="col">95% CI</th><th scope="col">What it reads as</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p><b>Both rows at once.</b> ${esc(THREE_ARM.bothHalves[0])} ${esc(THREE_ARM.bothHalves[1])}
  ${esc(THREE_ARM.authorsCaveat)}</p>

  <h3>Where it does not work — read this before the rest</h3>
  <p>${esc(CEILING.headline)}</p>
  <ul>
${ceiling}
  </ul>
  <p>${esc(CEILING.soWhat)}</p>

  <h3>What a study design lets a result say</h3>
  <table class="comparators">
    <thead><tr><th scope="col">Design</th><th scope="col">A positive result says</th><th scope="col">It does not say</th></tr></thead>
    <tbody>
${designs}
    </tbody>
  </table>
  <p class="muted">Every practice in this library carries the design its evidence came from, including
  the entries whose answer is "no comparison group at all".</p>
</section>`;
}

/** handler(req,res) — serve the framing as JSON for other surfaces. Never throws. */
export function handler(req, res) {
  const body = {
    components: COMPONENTS,
    comparators: COMPARATORS,
    threeArm: THREE_ARM,
    landmarks: LANDMARKS,
    openLabel: OPEN_LABEL,
    nocebo: NOCEBO,
    mechanism: MECHANISM,
    ceiling: CEILING,
    responderTrait: RESPONDER_TRAIT,
    practices: PRACTICE_COMPARATORS,
  };
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('placebo-baseline.mjs');
if (isMain) {
  console.log('THE THREE-ARM DECOMPOSITION —', THREE_ARM.design, '\n');
  for (const a of THREE_ARM.arms) console.log(`  ${a.arm.padEnd(14)} SMD ${a.smd.toFixed(2)}  [${a.ci[0]}, ${a.ci[1]}]`);
  console.log('\n  ' + THREE_ARM.bothHalves.join('\n  '));
  console.log('\nCEILING —', CEILING.headline);
  for (const d of CEILING.doesNot) console.log('  -', d);
  console.log('\nRESPONDER TRAIT —', RESPONDER_TRAIT.verdict);
  console.log('\nPRACTICE COMPARATORS');
  for (const [id, e] of Object.entries(PRACTICE_COMPARATORS)) console.log(`  ${id.padEnd(22)} ${e.comparator}`);
}

export default PLACEBO_BASELINE_HTML;
