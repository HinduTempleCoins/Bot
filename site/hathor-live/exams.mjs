// site/hathor-live/exams.mjs — the Temple Exams: the perception battery, and the rules that bind it.
//
// ── THE FRAMING RULE, INHERITED VERBATIM ─────────────────────────────────────────────────────────
//
//   AN EXAM IS AN INSTRUMENT, NEVER A DIAGNOSIS, AND IS NEVER WORDED AS A CLEARANCE.
//   (.local/TEMPLE_EXAMS_SAFETY_GATE.md §2)
//
// That rule bites hardest here, not in the flicker gate. Aphantasia and synaesthesia are things a
// person can score into on a web page and then carry around for the rest of their life as an
// identity. So: report the measurement, name the reference class, treat consistency rather than
// confidence as the finding, and never route a result to anything consequential.
//
// ── THREE CONCLUSIONS THREE SEPARATE RESEARCH PASSES REACHED INDEPENDENTLY ────────────────────────
//
//   1. COMPARE A PERSON TO THEMSELVES, NEVER TO A POPULATION. The grapheme–colour consistency test
//      derives its validity from its own test–retest behaviour, so it needs no external norms, no
//      display calibration and no comparison group, and it is interpretable on a single individual.
//      That shape is copied everywhere in this directory.
//   2. NEVER PRODUCE A SCORE THAT BUYS SOMETHING. A score worth anything gets optimised and the data
//      dies. No tiers, no ranks, no credentials, no reward. Enforced below, not merely intended.
//   3. WITHIN-SUBJECT IS THE ENTIRE SCIENTIFIC VALUE. You sober against you tired, not you against a
//      stranger. Everything about the participant key and the State Card exists to serve that.
//
// ── THE PAYMENT BOUNDARY ─────────────────────────────────────────────────────────────────────────
//
// integrations/token-exams.mjs is the KNOWLEDGE exam module and it pays. Its rule — "pay for
// knowledge, never for perception" — is imported here rather than restated, so the two modules can
// never drift into disagreeing about which side of the line something is on. Every exam in this
// file is `kind: 'perception'`, and `assertNeverPayable()` is a hard failure, not a warning.
//
// ── AND NOTHING FROM THESE EXAMS GOES ON CHAIN ───────────────────────────────────────────────────
//
// A pseudonym on a public ledger makes every entry permanently, globally readable. See
// participant-key.mjs. The chain sees a boolean at most, and nothing here emits one.
//
// Offline, pure, no I/O. esc() everything.

import { esc, themeCSS } from '../../integrations/melek-theme.mjs';
import { KINDS, isPayableKind } from '../../integrations/token-exams.mjs';
import { consultBanner, CONSULT } from './the-line.mjs';

export { esc, KINDS, isPayableKind };

/** The kind every exam in this file is, and the only kind it may be. */
export const PERCEPTION = 'perception';

// ── OPERATOR CORRECTION, 2026-09-08: THE BAR IS TRUTH, NOT MODESTY ──────────────────────────────
//
// Rule 1 below ("report the measurement, not the category") has been over-applied, and the operator
// retired the over-application in his own words: "we don't mind the Quizes telling People they are
// 'Special', but we want it to be as True as Possible, like Perfect Pitch, the Jung Tests, or even
// Medical and Competency or IQ Type Tests."
//
// WHERE THE EVIDENCE SUPPORTS A CATEGORICAL CLAIM, MAKE IT PLAINLY. A grapheme–colour consistency
// score below the published threshold IS the finding that somebody is a synaesthete; hedging that
// into meaninglessness is the error, not the safeguard. The same holds for absolute pitch, for
// colour-vision deficiency, and for aphantasia at the extremes.
//
// AND THE SAFETY GATE'S RULE IS NARROWER THAN IT LOOKS. ".local/TEMPLE_EXAMS_SAFETY_GATE.md"'s
// "never worded as a clearance" is about PHOTOSENSITIVE EPILEPSY — a medical-risk claim that
// transfers a liability this project cannot carry. It is NOT a general ban on telling a person a
// true thing about their own perception, and the next agent to read it that way is reading it past
// its subject.
//
// What still stands, unchanged: no percentile below MIN_N_FOR_RANK, the self-selection caveat every
// time, a debrief on the same screen as the result, and no score that buys anything.
//
// A worked example of the distinction is in exam-human-or-model.mjs, which STILL refuses the
// category — but for an empirical reason (the target moves; the effect is mostly about the models,
// not the taker), not because a strong true claim is forbidden.
//
// The wording of rule 1 below is left as it stands rather than rewritten in passing: it is printed
// on every result page in this battery and its revision is the operator's call, not a side effect of
// shipping one exam.
/**
 * The four wording rules, kept as data so a result screen can render them rather than a developer
 * remembering them. They are printed on every result page in this battery.
 */
export const FRAMING = Object.freeze([
  {
    id: 'measurement-not-category',
    rule: 'Report the measurement, not the category.',
    why: '"Your VVIQ score was 19 out of 80. Scores at or below 24 are the range in which most published aphantasia research recruits participants." Never "you have aphantasia."',
  },
  {
    id: 'name-the-reference-class',
    rule: 'Name the reference class, every time.',
    why: 'A percentile is meaningless without saying among whom. Ours is: among people who found this page and chose to take the test. That group is systematically enriched for exactly the traits being measured, because people who suspect something about themselves go looking.',
  },
  {
    id: 'consistency-not-confidence',
    rule: 'Consistency, not confidence.',
    why: 'For every instrument the second administration is part of the instrument. A one-shot result is a reading, not a finding.',
  },
  {
    id: 'no-consequence',
    rule: 'Never route a result to anything consequential.',
    why: 'No credential tier, no karma weight, no grant eligibility, no payment. The moment a score buys something, people optimise it and the data dies.',
  },
]);

/**
 * What a browser cannot do, stated on the page rather than in a comment.
 *
 * These are not disclaimers bolted on at the end. Each one changed what got built: the colour exams
 * that need absolute chromaticity are absent, and the ones that survive are here because both sides
 * of their measurement are sampled inside one observer on one display.
 */
export const BROWSER_LIMITS = Object.freeze([
  {
    id: 'calibration',
    limit: 'Your display is not calibrated and cannot be.',
    detail: 'sRGB is a standard, not a description of your panel. Its actual primaries and transfer curve are unknown and unknowable from JavaScript, and auto-brightness means the display can change itself mid-session. Every exam here is therefore built as a within-person, within-display measurement.',
  },
  {
    id: 'gamut',
    limit: 'Your screen cannot show every colour.',
    detail: 'An sRGB panel cannot display a saturated spectral green; where a stimulus falls outside the triangle the browser silently clips it to the edge. Clipping is not noise — it is a systematic compression that makes different people’s settings look more similar than they are.',
  },
  {
    id: 'ambient',
    limit: 'The room you are in is part of the stimulus.',
    detail: 'A screen in a bright room has a grey veil over it: contrast falls, the black point rises, and your adaptation is set by the room rather than by anything we sent you.',
  },
  {
    id: 'wavelength',
    limit: 'We will never print a wavelength.',
    detail: 'Converting a screen colour to nanometres requires the display’s primaries, which we do not have. Any site that gives you a nanometre figure from a browser is making it up.',
  },
  {
    id: 'tetrachromacy',
    limit: 'No web page can test for tetrachromacy, including this one.',
    detail: 'A three-primary device cannot present a stimulus that needs a fourth primary to match. This is arithmetic about the display, not a calibration problem, and no amount of calibration fixes it. Every online "how many colours do you see" test is measuring banding, bit depth and patience.',
  },
  {
    id: 'diagnosis',
    limit: 'None of this is a diagnosis, and none of it is a clearance.',
    detail: 'These are instruments. They measure something real and they measure it imperfectly. A result here is not a medical finding, does not clear you for anything, and buys you nothing on this site or any other.',
  },
]);

/** Below this many completions for an instrument, we show the raw score and the count, never a rank. */
export const MIN_N_FOR_RANK = 100;

/**
 * ⭐ THE CLAIM CLASSES, from `.local/temple-exams/identity-grade-instruments.md` §0.
 *
 * A result's honesty is decided by which of these it is entitled to be, and until now that was a
 * judgement each exam made in its own prose. Making it a field means a result screen can print it,
 * and means a new exam has to answer the question before it ships.
 *
 * ① is the one that needs an argument. `identity-grade-instruments.md`'s rule is that the
 * TEST–RETEST COEFFICIENT decides: a category needs a coefficient that supports one, and the
 * absence of a published one is a reason to refuse the category, not a reason to guess.
 */
export const CLAIM_CLASSES = Object.freeze({
  categorical: Object.freeze({
    id: 'categorical', mark: '\u2460',
    label: 'Categorical — a claim that you are a member of a class',
    needs: 'A published test\u2013retest coefficient that supports a category, and a threshold somebody else established.',
  }),
  percentile: Object.freeze({
    id: 'percentile', mark: '\u2461',
    label: 'Percentile against a stated reference class',
    needs: `A reference group named out loud, and at least ${MIN_N_FOR_RANK} people in it before any rank is printed.`,
  }),
  withinPerson: Object.freeze({
    id: 'within-person', mark: '\u2462',
    label: 'Within-person — you against you',
    needs: 'Two administrations. Needs no norms, no calibration and no comparison group, which is why it is the grade this battery trusts most.',
  }),
  demonstration: Object.freeze({
    id: 'demonstration', mark: '\u2463',
    label: 'Demonstration only — it shows you something, it does not measure you',
    needs: 'Nothing, except that the page never lets the demonstration be read as a finding.',
  }),
});

/**
 * \u2b50 EXPERIENTIAL SELF-REPORT, and the reason it is a separate flag from the claim class.
 *
 * Lush et al. (2020), Nature Communications 11(1):4853, doi:10.1038/s41467-020-18591-6, n = 156/404/353:
 * trait phenomenological control predicts experiential change on the rubber-hand illusion and mirror
 * synaesthesia at magnitudes comparable to its relationship with individual hypnosis-scale items.
 * (Contested \u2014 two 2022 comments in the same journal, doi:10.1038/s41467-022-28177-z and
 * doi:10.1038/s41467-022-28178-y. Cite the exchange.)
 *
 * So: an exam whose datum is WHAT THE TAKER SAYS THEY EXPERIENCED is partly measuring that trait.
 * An exam whose datum is what the taker DID \u2014 reproduced a colour, picked the model, typed a word
 * \u2014 is not, or is far less. That distinction is what this flag records, and it is finer than
 * "demonstration-class": the grapheme test is scored on REPRODUCTION rather than report and is
 * therefore largely immune, which is worth saying out loud rather than blanket-flagging everything.
 *
 * Every exam with this flag prints the expectancy-uptake covariate beside its result.
 */
export const EXPERIENTIAL_SELF_REPORT_WHY =
  'The datum here is what you say you experienced, not what you did. Lush et al. (2020) found that the '
  + 'capacity to produce an experience a task implies predicts experiential change on standard laboratory '
  + 'measures, so a result of this kind is partly a measure of that capacity. We measure it separately '
  + 'and print it beside this result rather than leaving it out.';

// ── the register ─────────────────────────────────────────────────────────────────────────────────
/**
 * Each entry declares what it measures, what its result may and may not be worded as, and when the
 * retest falls due. `retestDays` is part of the instrument, not a nag: two administrations are what
 * turn a score into a measurement.
 */
export const EXAMS = Object.freeze([
  {
    id: 'grapheme',
    kind: PERCEPTION,
    claimClass: 'within-person',
    // Scored on REPRODUCTION, not on report: the taker has to hit the same colour again without
    // warning. That is a behaviour, so the expectancy covariate has far less purchase here.
    experientialSelfReport: false,
    name: 'Letters and colours',
    route: '/exams/grapheme',
    duration: '12–18 minutes',
    measures: 'Whether your letter and digit colour associations are consistent when you are asked again without warning.',
    why: 'This is the methodological exemplar of the whole battery. Its validity criterion IS its own test–retest behaviour, so it needs no external norms, no calibration and no comparison group. You are compared to yourself, and the result is interpretable on one person.',
    neverSay: 'You have synaesthesia.',
    retestDays: 14,
    citations: [
      'Eagleman et al. (2007), J Neurosci Methods 159(1):139–145 — the standardised battery.',
      'Rothen, Seth, Witzel & Ward (2013), J Neurosci Methods 215(1):156–160 — colour spaces compared.',
      'Carmichael et al. (2015), Consciousness and Cognition 33:375–385 — the failure modes.',
      'Simner et al. (2019), Atten Percept Psychophys — pairings can change in adulthood.',
    ],
  },
  {
    id: 'vviq',
    kind: PERCEPTION,
    claimClass: 'percentile',
    // \u2b50 The clearest case in the battery. Every item asks how vivid an image WAS, and the only
    // evidence is the taker's own say-so. The covariate belongs beside it more than anywhere else.
    experientialSelfReport: true,
    name: 'The mind’s eye',
    route: '/exams/vviq',
    duration: '5–8 minutes',
    measures: 'How vivid your voluntary visual imagery is, on the scale the whole modern aphantasia literature is built on.',
    why: 'The highest revelation-per-minute of anything in the battery. Most people assume everyone else’s inner life looks like theirs. It does not, and the range is enormous at both ends.',
    neverSay: 'You have aphantasia.',
    retestDays: 14,
    citations: [
      'Marks, D.F. (1973), British Journal of Psychology 64(1):17–24 — the VVIQ.',
      'Marks, D.F. (1995) — VVIQ-2, which reversed the scale direction.',
      'Zeman et al. (2020), Cortex 130:426–440 — the imagery-extremes study.',
      'Zeman, A. (2024), Trends in Cognitive Sciences 28(5) — the current review.',
    ],
  },
  {
    id: 'human-or-model',
    kind: PERCEPTION,
    claimClass: 'percentile',
    // Accuracy against a known ground truth. Nothing here is a report of an experience.
    experientialSelfReport: false,
    name: 'Human or model',
    route: '/exams/human-or-model',
    duration: '8–12 minutes',
    measures: 'Whether you can tell a passage written by a person from one written by a model — and, from the confidence you attach to each answer, whether your belief that you can is justified.',
    why: 'The institute-native one. This project runs an AI witness that posts publicly on the chain, so it is the single exam in the battery whose stimulus set it can generate itself, at no licensing cost, and refresh every time the models change. Four higher-ranked exams are blocked on whether we may lawfully display somebody else’s photographs; this one is blocked on nothing.',
    neverSay: 'You scored in the replicant range.',
    retestDays: 30,
    citations: [
      'Jones CR & Bergen BK (2026), Large language models pass a standard three-party Turing test, PNAS 123(21), doi:10.1073/pnas.2524472123 — GPT-4.5 with a persona prompt judged human 73% of the time; preprint arXiv:2503.23674 (2025).',
      'National Research Council (2003), The Polygraph and Lie Detection, National Academies Press — why the apparatus half of the Voight-Kampff was always wrong.',
      'Macmillan NA & Creelman CD (2005), Detection Theory: A User’s Guide, 2nd ed. — d′ = √2·z(pc) for two-alternative forced choice, and the extreme-cell correction.',
      'Murphy AH (1973), Journal of Applied Meteorology 12(4):595–600 — the Brier-score decomposition the calibration curve is read against.',
      'Philip K. Dick (1968), Do Androids Dream of Electric Sheep? — the hook, and never the frame of the result.',
    ],
  },
  {
    id: 'colour-naming',
    kind: PERCEPTION,
    claimClass: 'demonstration',
    // A typed word for a shown swatch is a behaviour, not a report of an inner event.
    experientialSelfReport: false,
    name: 'What you call a colour',
    route: '/exams/colour-naming',
    duration: '4 minutes, or as long as you like',
    measures: 'Your own colour lexicon: we show a colour, you type what you call it.',
    why: 'The most browser-honest colour exam there is. The question is about the mapping from appearance to word, and BOTH SIDES of that mapping are sampled inside one observer on one screen — so the display’s errors largely cancel instead of accumulating. The exam is native to the medium; the xkcd colour survey collected ~3.4 million responses this way.',
    neverSay: 'This tells you something about your eyes.',
    retestDays: 14,
    citations: [
      'Lindsey & Brown (2014), Journal of Vision 14(2):17 — the colour lexicon of American English.',
      'Berlin & Kay (1969), Basic Color Terms.',
      'Munroe (2010), the xkcd Color Survey — crowdsourced, blog-published, not peer-reviewed.',
      'Zaslavsky et al. (2019), Topics in Cognitive Science — naming reflects communicative need, not only perceptual structure.',
    ],
  },
  {
    id: 'thread',
    kind: PERCEPTION,
    claimClass: 'within-person',
    // \u2b50 The purest case in the battery: sixteen sliders, each answering "how much did that do to
    // you?". The expectancy covariate belongs beside this result as much as beside the VVIQ.
    experientialSelfReport: true,
    name: 'The Thread Protocol',
    route: '/exams/thread',
    duration: '10\u201314 minutes',
    measures: 'Whether your response across an enumerated set of sixteen rhythms \u2014 or sixteen hues \u2014 has a shape, and whether that shape comes back when the set is presented again without warning.',
    why: 'The design is not ours. In the Egyptian zar the thread \u2014 khayt \u2014 is the distinctive drum '
      + 'rhythm of each spirit, and the kodia performs each in turn and watches for a differential '
      + 'reaction. A fixed stimulus set, serial presentation, a response criterion, classification by '
      + 'maximal differential response: a within-person psychophysical protocol built centuries before '
      + 'anybody wrote a method section. We borrow the method and not the cosmology.',
    neverSay: 'This is your Thread.',
    retestDays: 14,
    citations: [
      'El Hadidi, H. (2016), Zar: Spirit Possession, Music, and Healing Rituals in Egypt, American University in Cairo Press, doi:10.5743/cairo/9789774166976.001.0001 \u2014 the scholarly source for the khayt material. [PARTIALLY VERIFIED: not read in full.]',
      'Boddy, J. (1989), Wombs and Alien Spirits: Women, Men, and the Z\u0101r Cult in Northern Sudan, University of Wisconsin Press, ISBN 9780299123147 \u2014 the standard ethnography. Boddy reads possession as an allegorical discourse on women\u2019s subordination; this project\u2019s own corpus holds the Threads to be real entities. The disagreement is stated rather than smoothed over.',
      'Eagleman, D.M. et al. (2007), J Neurosci Methods 159(1):139\u2013145 \u2014 the repeat-without-warning design this exam borrows its scoring logic from.',
      'Rouget, G. (1985), Music and Trance, University of Chicago Press \u2014 why a stimulus does not cause a state, and why this exam claims no mechanism.',
    ],
  },
  {
    id: 'absorption',
    kind: PERCEPTION,
    claimClass: 'percentile',
    // ⭐ It IS an experiential self-report, and unlike the expectancy index it is not circular to
    // print the covariate beside it: expectancy uptake and absorption are different constructs, and
    // that is the whole reason both exist. See DIFFERENCE in exam-absorption.mjs.
    experientialSelfReport: true,
    name: 'Being taken',
    route: '/exams/absorption',
    duration: '6–8 minutes',
    measures: 'How completely a thing in front of you can take your attention over — attentional narrowing, imaginative involvement, responsiveness to engrossing stimuli, and what happens to time and to the sense of being a separate observer while it lasts.',
    why: 'The construct this battery keeps running into, and there was nothing to administer. The '
      + 'Tellegen Absorption Scale is licensed through the University of Minnesota Press and the '
      + 'licence has been ENFORCED — a research site removed its copy at the publisher’s request. '
      + 'MODTAS is a rescaling of the same items and inherits it. A paraphrase of a licensed item set is '
      + 'a derivative work. And the IPIP, this project’s standing public-domain fallback, has no '
      + 'Absorption scale among its 274 labels and 463 scales. Nothing to license and nothing to fall '
      + 'back on, so the fifteen items are ours, written from the published description of the construct '
      + 'rather than from the instrument, with our own norms and no percentile until a hundred people '
      + 'have sat it.',
    neverSay: 'You are a high-absorption type.',
    retestDays: 14,
    citations: [
      'Tellegen, A. & Atkinson, G. (1974), Openness to absorbing and self-altering experiences ("absorption"), a trait related to hypnotic susceptibility, J Abnorm Psychol 83(3):268–277, doi:10.1037/h0036681 — the construct. The scale published with it is LICENSED and is NOT reproduced here, in whole, in part, or in paraphrase.',
      'Roche, S.M. & McConkey, K.M. (1990), Absorption: Nature, assessment, and correlates, J Pers Soc Psychol 59(1):91–101, doi:10.1037/0022-3514.59.1.91.',
      'Council, J.R., Kirsch, I. & Hafner, L.P. (1986), Expectancy versus absorption in the prediction of hypnotic responding, J Pers Soc Psychol 50(1):182–189, doi:10.1037/0022-3514.50.1.182 — the context critique.',
      'Nadon, R., Hoyt, I.P., Register, P.A. & Kihlstrom, J.F. (1991), Absorption and hypnotizability: context effects reexamined, J Pers Soc Psychol 60(1):144–153, doi:10.1037/0022-3514.60.1.144 — N = 475 and N = 434, the pushback. We cite the exchange, not one side.',
      'Glisky, M.L., Tataryn, D.J., Tobias, B.A., Kihlstrom, J.F. & McConkey, K.M. (1991), Absorption, openness to experience, and hypnotizability, J Pers Soc Psychol 60(2):263–272, doi:10.1037/0022-3514.60.2.263.',
      'O’Grady, K.E. (1980), The absorption scale: A factor-analytic assessment, Int J Clin Exp Hypn 28(3):281–288, doi:10.1080/00207148008409853; and Radtke, H.L. & Stam, H.J. (1991), Int J Clin Exp Hypn 39(1):39–56, doi:10.1080/00207149108409617 — why the factor structure of the established instrument is still disputed.',
      'Studerus, E., Gamma, A., Kometer, M. & Vollenweider, F.X. (2012), Prediction of psilocybin response in healthy volunteers, PLoS ONE 7(2):e30800, doi:10.1371/journal.pone.0030800 — 23 studies, 409 administrations, 261 volunteers; and Haijen, E.C.H.M. et al. (2018), Front Pharmacol 9:897, doi:10.3389/fphar.2018.00897.',
      'Lush, P., Moga, G., McLatchie, N. & Dienes, Z. (2018), Neurosci Conscious 2018(1):niy006, doi:10.1093/nc/niy006 — CC BY-NC, NOT used here. Its r(66) = .56 objective retest is the ceiling on what anything in this domain may claim.',
    ],
  },
  {
    id: 'suggestibility',
    kind: PERCEPTION,
    claimClass: 'percentile',
    // It is itself a self-report, and says so. Printing its own covariate beside itself would be a
    // circular sentence, so it carries the caveat in its own copy instead.
    experientialSelfReport: false,
    name: 'Meeting the task halfway',
    route: '/exams/suggestibility',
    duration: '4\u20136 minutes',
    measures: 'How far you meet a task halfway \u2014 a short index of the tendency to produce the experience a situation implies you should be having.',
    why: '\u2b50 The covariate the rest of this battery was missing. Lush et al. (2020) found that trait '
      + 'phenomenological control predicts experiential change on the rubber-hand illusion and mirror '
      + 'synaesthesia, which means every exam ending in "did you feel it?" is partly measuring it. So we '
      + 'measure it on purpose and print it beside those results. It makes the other numbers more honest '
      + 'rather than less, and as far as we can tell nobody else running tests like these does it.',
    neverSay: 'You are highly hypnotisable.',
    retestDays: 14,
    citations: [
      'Lush, P., Botan, V., Scott, R.B., Seth, A.K., Ward, J. & Dienes, Z. (2020), Trait phenomenological control predicts experience of mirror synaesthesia and the rubber hand illusion, Nature Communications 11(1):4853, doi:10.1038/s41467-020-18591-6 \u2014 n = 156, 404, 353.',
      'Contested: two 2022 comments in the same journal, doi:10.1038/s41467-022-28177-z and doi:10.1038/s41467-022-28178-y. The exchange is the citation, not the claim alone.',
      'Lush, P., Moga, G., McLatchie, N. & Dienes, Z. (2018), the Sussex-Waterloo Scale of Hypnotizability, Neuroscience of Consciousness 2018(1):niy006, doi:10.1093/nc/niy006; corrigendum 2021(1):niab041, doi:10.1093/nc/niab041 \u2014 CC BY-NC, and NOT used here. Its retest of r(66) = .56 objective / .77 subjective is why nothing in this domain may be a category.',
      'Tellegen, A. & Atkinson, G. (1974), J Abnorm Psychol 83(3):268\u2013277, doi:10.1037/h0036681 \u2014 the Tellegen Absorption Scale, licensed through the University of Minnesota Press and NOT reproduced here, in whole, in part or in paraphrase.',
      'Maurer, R.L., Kumar, V.K., Woodside, L. & Pekala, R.J. (1997), Am J Clin Hypn 40(2):130\u2013145, doi:10.1080/00029157.1997.10403417 \u2014 n = 206: drumming trance tracked hypnotic susceptibility, not the drum.',
    ],
  },
]);

export const claimClassOf = (exam) => {
  const id = String((exam && exam.claimClass) || '').trim();
  for (const c of Object.values(CLAIM_CLASSES)) if (c.id === id) return c;
  return null;
};

/** Every exam whose datum is a report of an experience rather than a behaviour. */
export const experientialExams = (list = EXAMS) => list.filter((e) => e.experientialSelfReport === true);

export const examById = (id) => EXAMS.find((e) => e.id === String(id || '').toLowerCase()) || null;

/**
 * The enforcement of conclusion 2, as a throw rather than a comment.
 *
 * Called at module load below, so the process refuses to start if anybody ever marks one of these
 * payable. That is deliberate: a soft-fail here would let a wrong build serve traffic.
 */
export function assertNeverPayable(list = EXAMS) {
  for (const e of list) {
    if (e.kind !== PERCEPTION) {
      throw new Error(`exams.mjs: ${e.id} declares kind '${e.kind}' — every exam here must be '${PERCEPTION}'`);
    }
    if (isPayableKind(e.kind)) {
      throw new Error(`exams.mjs: ${e.id} is payable, and a perception exam may never be — ${KINDS[PERCEPTION].why}`);
    }
    if (e.payable === true || e.reward != null || e.tier != null || e.rank != null) {
      throw new Error(`exams.mjs: ${e.id} carries a reward, tier or rank. A score that buys something gets optimised and the data dies.`);
    }
  }
  return true;
}
assertNeverPayable();

// ── honest reporting helpers ─────────────────────────────────────────────────────────────────────

/**
 * The reference-class sentence, generated rather than remembered. Returns '' when n is too small to
 * say anything about rank — and the caller must then print the score and the count instead.
 */
export function referenceClass(n) {
  const count = Number(n) || 0;
  if (count < MIN_N_FOR_RANK) {
    return `Only ${count} ${count === 1 ? 'person has' : 'people have'} completed this here, which is too few to place you among them. `
      + 'You are shown your own score and nothing else, which is the honest thing to show.';
  }
  return `Where you sit is among the ${count} people who found this page and chose to take this test. `
    + 'That is not a random sample of anybody: many arrive because they already suspect something '
    + 'about their own experience, so this group is enriched for exactly the thing being measured. '
    + 'Your rank here is not your rank in the general population, and more visitors would not fix that.';
}

/**
 * A LANDMARK cites its source and makes no claim about the reader. A percentile borrowed from
 * someone else's sample makes a claim we cannot support. This renders the former and has no way to
 * render the latter.
 */
export function landmark({ text, source }) {
  return { text: String(text || ''), source: String(source || ''), isVerdict: false };
}

/**
 * Compare two administrations of the same instrument. This — not the single score — is the result.
 *
 * Returns a plain description. It deliberately does not say whether the difference is "significant":
 * that needs the standard error of measurement from our own retest sample, which does not exist yet
 * and cannot be invented. It says so.
 */
export function retestPair(first, second, { unit = '', sem = null } = {}) {
  // Number(null) is 0 and Number('') is 0, and a missing second sitting is neither of those. Treat
  // "not given" as not-a-number so a person who has sat this once is told so instead of being shown
  // a fabricated change from their score to zero.
  const n = (v) => (v == null || v === '' ? NaN : Number(v));
  const a = n(first);
  const b = n(second);
  // Either way round, a single administration is a single administration. The message is the same
  // whether this is somebody's first sitting (no prior to compare) or a prior with nothing new
  // against it, because the thing being said is about the instrument, not about the bookkeeping.
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return {
      ok: false,
      text: 'One administration is a reading, not a finding. Come back with the same key — the second '
        + 'sitting is part of the instrument, and the pair is the result.',
    };
  }
  const diff = b - a;
  const base = `First sitting ${a}${unit}, second ${b}${unit} — a change of ${diff > 0 ? '+' : ''}${Math.round(diff * 1000) / 1000}${unit}.`;
  if (!Number.isFinite(n(sem))) {
    return {
      ok: true, first: a, second: b, diff,
      text: `${base} We cannot yet tell you whether a change that size is more than measurement noise: `
        + 'that needs this instrument’s own test–retest error, computed from our own repeat takers, '
        + 'and we do not have enough of them yet. When we do, it will be printed here.',
    };
  }
  const s = n(sem);
  return {
    ok: true, first: a, second: b, diff, sem: s,
    text: `${base} The measurement error of this instrument in our own repeat takers is ${s}${unit}, so a `
      + `change of ${Math.abs(diff) > 2 * s ? 'this size is larger than' : 'this size sits inside'} what we see when the same person retakes it unchanged.`,
  };
}

// ── the page shell ───────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ `alsoDisclaim` — for a page that sits under more than one doctrine at once.
 *
 * A colour exam is two things simultaneously: an INSTRUMENT that produces a number about a person
 * (the `exams` wording, which says who is allowed to interpret it), and a COLOURED LIGHT ON A SCREEN
 * — which is the exact article that was condemned in United States v. Ghadiali, 165 F.2d 957
 * (3d Cir. 1948). The `colour` context disclaims measurement and restoration BY NAME, in the register
 * of the condemned label itself, and it is not interchangeable with the exams wording. So both print.
 */
export function examShell(title, body, { extraCSS = '', extraJS = '', extraHead = '', alsoDisclaim = [] } = {}) {
  // `extraHead` is for a page that needs its own canonical/OG/Twitter tags — a shareable result card.
  // When one is supplied it OWNS the description and robots tags, because emitting both sets would
  // hand a crawler two contradictory descriptions and let it pick.
  const head = extraHead
    ? String(extraHead)
    : `<meta name=robots content="index,follow">
<meta name=description content="Temple Exams — instruments, not diagnoses. No account, no name, no score that buys anything.">`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} — Temple Exams</title>
${head}
<style>${themeCSS({ context: 'temple' })}
  body{margin:0;font:16px/1.65 -apple-system,Segoe UI,Roboto,Arial,sans-serif;
    background:var(--mk-bg);color:var(--mk-text)}
  .wrap{max-width:760px;margin:0 auto;padding:28px 18px 80px}
  h1{font-size:1.7rem;margin:0 0 6px} h2{font-size:1.15rem;margin:26px 0 8px}
  .muted{color:var(--mk-text-muted)} .prov{color:var(--mk-text-muted);font-size:13px;margin:6px 0}
  .card{border:1px solid var(--mk-border);border-radius:12px;padding:16px 18px;margin:14px 0;background:var(--mk-panel)}
  fieldset{border:1px solid var(--mk-border);border-radius:10px;margin:14px 0;padding:12px 14px}
  legend{padding:0 6px;font-weight:700}
  .opt{display:flex;gap:9px;align-items:flex-start;padding:4px 0;cursor:pointer}
  .field{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:6px 0;flex-wrap:wrap}
  .field input,.field select{background:var(--mk-bg);color:var(--mk-text);border:1px solid var(--mk-border);
    border-radius:8px;padding:7px 10px;font:inherit;min-width:8ch}
  .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:5px 0}
  .rowlab{min-width:11ch;color:var(--mk-text-muted);font-size:13px}
  .vas{margin:10px 0} .vas input[type=range]{width:100%}
  .vasends{display:flex;justify-content:space-between;font-size:12px;color:var(--mk-text-muted)}
  button{padding:10px 18px;border:1px solid var(--mk-accent);background:var(--mk-accent);color:#1a1306;
    border-radius:10px;font-weight:800;cursor:pointer;font:inherit;font-weight:800}
  button.ghost{background:transparent;color:var(--mk-text);border-color:var(--mk-border)}
  button[disabled]{opacity:.45;cursor:not-allowed}
  a{color:var(--mk-accent)}
  .limits li{margin:8px 0} .limits b{display:block}
  .key{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;letter-spacing:.06em;
    background:var(--mk-bg);border:1px dashed var(--mk-border);border-radius:8px;padding:9px 11px;
    display:inline-block;word-break:break-all}
  table{width:100%;border-collapse:collapse;font-size:14px} td,th{border-bottom:1px solid var(--mk-border);padding:6px 4px;text-align:left}
  .consult{border:1px solid var(--mk-border);border-left:3px solid var(--mk-text-muted);border-radius:8px;
    padding:10px 14px;margin:0 0 18px;background:var(--mk-panel);font-size:14px}
  .consult p{margin:4px 0}
  ${extraCSS}</style></head><body><div class=wrap>
${consultBanner('exams', { also: alsoDisclaim })}
${body}
<footer class=muted style="margin-top:44px;font-size:13px;border-top:1px solid var(--mk-border);padding-top:14px">
  ${esc(CONSULT.line)}<br>
  <a href="/exams">Temple Exams</a> · <a href="/40hz">the entrainment library</a> · <a href="/reports">the report archive</a> · <a href="/the-line">where the line is</a><br>
  No account, no name, no email. Nothing here goes on the chain. Nothing here pays anything, and that is on purpose.
</footer>
</div>${extraJS ? `<script>${extraJS}</script>` : ''}</body></html>`;
}

/** The battery's front page. */
export function examsIndexHTML({ counts = {} } = {}) {
  const cards = EXAMS.map((e) => `<div class=card>
    <h2 style="margin-top:0"><a href="${esc(e.route)}">${esc(e.name)}</a></h2>
    <p>${esc(e.measures)}</p>
    <p class=muted>${esc(e.why)}</p>
    <p class=prov>${esc(e.duration)} · retest after ${esc(String(e.retestDays))} days · completed here ${esc(String(counts[e.id] || 0))} ${(counts[e.id] || 0) === 1 ? 'time' : 'times'}<br>
      <b>This result will never be worded as:</b> “${esc(e.neverSay)}”</p>
  </div>`).join('');

  return examShell('Temple Exams', `<h1>Temple Exams</h1>
<p class=muted>Instruments for looking at your own experience. Not diagnoses, not clearances, and not
worth anything to anybody but you.</p>

<div class=card>
  <h2 style="margin-top:0">Four rules, and they are the whole design</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
</div>

${cards}

<div class=card>
  <h2 style="margin-top:0">What a browser cannot do, said out loud</h2>
  <ul class=limits>${BROWSER_LIMITS.map((l) => `<li><b>${esc(l.limit)}</b><span class=muted>${esc(l.detail)}</span></li>`).join('')}</ul>
</div>

<div class=card>
  <h2 style="margin-top:0">And one page that measures nothing at all</h2>
  <p><a href="/the-256">The 256</a> — If\u00e1's divination system has a structure that is public,
  well described and genuinely remarkable: eight binary marks, 2\u2078 = 256 addresses, and several
  hundred memorised verses at each. The page demonstrates the structure and then <b>declines to
  divine</b>, and the declining is the teaching. It makes no claim about you whatsoever.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Who you are to us</h2>
  <p>Nobody. There is no account, no name, no email address and no password. Your browser makes a
  random key, keeps it, and that key is the only thing that links one sitting of yours to the next —
  which is the point, because the comparison worth making is <b>you against you</b>: you sober
  against you tired, not you against a stranger.</p>
  <p class=muted>We store a one-way hash of that key, not the key. If you keep it you can delete
  everything you ever submitted. <b>If you lose it we cannot delete your entries, because we have no
  way to know which ones are yours.</b> That is said here, in advance, rather than promised and then
  not done.</p>
  <p class=muted>None of this goes on the MELEK chain. A pseudonym on a public ledger is permanent
  and readable by everyone forever, and these are the wrong entries for that.</p>
</div>`);
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    service: 'temple-exams',
    kind: PERCEPTION,
    payable: isPayableKind(PERCEPTION),
    rule: 'an exam is an instrument, never a diagnosis, and is never worded as a clearance',
    onChain: false,
    exams: EXAMS,
    framing: FRAMING,
    browserLimits: BROWSER_LIMITS,
  }, null, 2));
}

export default {
  PERCEPTION, EXAMS, FRAMING, BROWSER_LIMITS, MIN_N_FOR_RANK,
  examById, assertNeverPayable, referenceClass, landmark, retestPair,
  CLAIM_CLASSES, claimClassOf, experientialExams, EXPERIENTIAL_SELF_REPORT_WHY,
  examShell, examsIndexHTML, handler, esc,
};
