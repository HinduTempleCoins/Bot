// site/hathor-live/exam-absorption.mjs — absorption, written from scratch.
//
// ── WHY THIS FILE EXISTS AT ALL, AND IT IS A LICENCE STORY BEFORE IT IS A PSYCHOMETRIC ONE ───────
//
// Absorption is the construct this whole battery keeps running into. It is the classic personality
// correlate of hypnotic responding, it is the thing people mean when they say a book "took them
// over", and it is very likely part of what the Thread Protocol and the VVIQ are measuring
// underneath their own constructs. The obvious build was to administer the standard instrument.
//
// That route is closed, and the closure is documented rather than assumed:
//
//   ⛔ The Tellegen Absorption Scale (Tellegen & Atkinson 1974, J Abnorm Psychol 83(3):268–277,
//      doi:10.1037/h0036681). Thirty-four items, and one of the eleven primary scales of the
//      Multidimensional Personality Questionnaire, which the University of Minnesota Press licenses.
//      The evidence that it is not free is not a missing permission notice — it is an act of
//      ENFORCEMENT. A long-running academic scale library that hosts the Harvard, Stanford and
//      Waterloo hypnosis scales for download carries, where the TAS used to be, the line: "I have
//      removed the copy of the TAS that was here at the request of the University of Minnesota Press."
//      A publisher asked a research site to take it down and the site complied.
//   ⛔ MODTAS. The Modified Tellegen Absorption Scale is a rescaling of the SAME items. A derivative
//      of a licensed instrument carries the licence.
//   ⛔ A paraphrase. Rewriting a licensed item set in fresh words is a derivative work, and calling
//      the result "ours" would be a lie about provenance as well as a licence problem.
//   ⛔ IPIP as the fallback. The International Personality Item Pool is genuinely public domain and
//      is this project's standing escape hatch for licensed instruments. Its alphabetical index of
//      274 scale labels covering 463 scales was read again in the session that wrote this file, and
//      it contains NO Absorption entry — the "A" labels run Achievement-striving, Activity-level,
//      Adaptability, ADHD, Adventurousness, Aesthetic Appreciation, Affective Lability,
//      Agreeableness, Altruism, Ambition, Amiability, Anger, Anhedonia, Anxiety,
//      Appearance-Consciousness, Artistic Interests, Assertiveness, Attention to Emotions,
//      Attractiveness, Authenticity, and stop. There is no public-domain absorption instrument to
//      fall back to.
//
// So: nothing to license and nothing to fall back on. The only honest route left is to write our own
// items FROM THE CONSTRUCT DEFINITION IN THE LITERATURE — not from the instrument — and to collect
// our own norms. That is slower and it is correct, and the slowness is stated on the page rather
// than hidden behind a percentile we do not have yet.
//
// ── WHAT THE CONSTRUCT IS, IN THE LITERATURE'S TERMS ─────────────────────────────────────────────
//
// Absorption was introduced under the title "openness to absorbing and self-altering experiences":
// a disposition for episodes of total attention that engage a person's whole representational
// capacity — perceptual, imaginative, ideational together — and that leave them relatively
// impervious to distraction while they last. That description is OUR PARAPHRASE and is deliberately
// not a quotation: we did not obtain the 1974 primary PDF, secondary sources render the authors'
// definitional sentence two different ways, and an unverified quotation from a licensed
// instrument's source paper is exactly the wrong thing to put in this file. The landmark on the
// page says so in those words.
//
// The items below are ours, written against that description: attentional narrowing, imaginative
// involvement, responsiveness to engrossing stimuli, and the altered sense of time and self that
// goes with them.
//
// ── HOW THIS DIFFERS FROM /exams/suggestibility, WHICH IS THE COORDINATION THIS FILE OWES ────────
//
// `exam-suggestibility.mjs` measures EXPECTANCY UPTAKE: the tendency to produce the experience a
// situation implies you should be having. That is a response to a CUE about what to expect.
// Absorption is a response to a STIMULUS — how completely a thing that is actually in front of you
// can take you over — and it does not require anybody to have told you what to feel. They are
// correlated in the literature and they are not the same thing, and the two exams say so to each
// other rather than quietly overlapping. See DIFFERENCE below; it is printed on both result screens.
//
// ── WHAT THIS MAY NEVER BE WORDED AS ─────────────────────────────────────────────────────────────
//
//   "You are a high-absorption type." "You are highly hypnotisable." "This is why rituals work on
//   you." Claim class ② and nothing above it: a percentile against a stated reference class, our own,
//   with the self-selection caveat attached, and no percentile at all below n = 100.
//
// Pure and offline. No I/O. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import {
  FRAMING, examShell, referenceClass, retestPair, examById, MIN_N_FOR_RANK,
} from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';
import { CONSULT } from './the-line.mjs';

export { esc };

export const EXAM_ID = 'absorption';

/** The construct, in our words, written against the published definition and not against the scale. */
export const CONSTRUCT = Object.freeze({
  name: 'absorption',
  short: 'how completely a thing can take you over',
  full: 'A disposition for episodes of total attention, in which whatever you are attending to — a '
    + 'piece of music, a landscape, a piece of work, a memory, an image in your head — engages your '
    + 'full representational capacity, and while it lasts the rest of the world is relatively unable '
    + 'to get at you. It is not concentration, which is effortful and deliberate. It is closer to '
    + 'being taken, and it is ordinary: most people have had it, and people differ a great deal in '
    + 'how often and how far.',
  // The refusal, stated in the construct itself so it travels with every use of the object.
  notTheScale: 'This is NOT the Tellegen Absorption Scale and contains none of its items, in whole, '
    + 'in part, or in paraphrase. The TAS is licensed through the University of Minnesota Press as one '
    + 'of the eleven primary scales of the Multidimensional Personality Questionnaire, the MODTAS is a '
    + 'rescaling of the same items and inherits that licence, and a paraphrase of a licensed item set '
    + 'is a derivative work. The public-domain fallback this project normally uses, the IPIP, has no '
    + 'Absorption scale at all. So these items were written from the published definition of the '
    + 'construct, and the norms are ours and do not exist yet.',
});

/**
 * ⭐ The coordination sentence. Printed here, on the result screen, and on the sibling exam.
 *
 * Two adjacent constructs get merged by readers unless somebody separates them explicitly, and the
 * merge would be ours to answer for: we shipped both. So the distinction is a first-class export
 * rather than a paragraph somebody might delete.
 */
export const DIFFERENCE = Object.freeze({
  other: 'expectancy uptake',
  otherRoute: '/exams/suggestibility',
  short: 'Absorption is about the stimulus taking you. Expectancy uptake is about the cue telling you '
    + 'what to feel.',
  full: 'The sibling exam at /exams/suggestibility measures expectancy uptake — how far you produce '
    + 'the experience a situation implies you should be having, when something or someone has told you '
    + 'what to expect. This one measures absorption — how completely something actually in front of '
    + 'you can take your attention over, with nobody having said anything about it. The difference is '
    + 'where the content comes from: from a suggestion, or from the thing itself. They are related in '
    + 'the literature, and relatedness is not identity: they are separable enough that a body of work '
    + 'exists arguing about how much of one is really the other, which would be a strange argument to '
    + 'have about a single construct.',
  whyBothExist: 'Both are printed beside experiential results for the same reason: an exam that ends '
    + 'by asking "did you feel it?" is partly measuring the person’s disposition to have felt it. '
    + 'Expectancy uptake is the part of that driven by what the task implied. Absorption is the part '
    + 'driven by how far the person goes in when something engages them. Reporting one and not the '
    + 'other would give half a caveat.',
});

/**
 * Five points, 0–4, anchored on FREQUENCY.
 *
 * Same reasoning as the sibling exam: "how often does this happen to you" is answerable from memory,
 * where "how much do you agree that you are an absorbed person" asks for a self-concept and gets one.
 */
export const SCALE = Object.freeze([
  { value: 0, label: 'Never — I do not recognise this at all' },
  { value: 1, label: 'Rarely' },
  { value: 2, label: 'Sometimes' },
  { value: 3, label: 'Often' },
  { value: 4, label: 'Almost always — this is just how it is for me' },
]);

export const MIN_SCORE = 0;

/**
 * Five facets of three items each.
 *
 * ⚠️ THE FACETS ARE A SHAPE, NOT ESTABLISHED SUBSCALES. We have run no factor analysis, because we
 * have no sample to run one on, and we will not have one for a long time. They are how the items
 * were WRITTEN, which is a fact about us, not a finding about the construct. The page says this in
 * those words and a test pins it.
 */
export const FACETS = Object.freeze([
  { id: 'narrowing', label: 'Attentional narrowing', gloss: 'The rest of the room going away while something has you.' },
  { id: 'imaginal', label: 'Imaginative involvement', gloss: 'Something imagined or remembered becoming detailed enough to stand in for the room.' },
  { id: 'engrossment', label: 'Responsiveness to engrossing things', gloss: 'How readily a particular kind of thing — music, weather, a face, a piece of work — takes you.' },
  { id: 'selfaltering', label: 'Time and self during it', gloss: 'The clock and the sense of being a separate observer going odd while it lasts.' },
  { id: 'unbidden', label: 'Arriving unasked', gloss: 'Whether these episodes are something you do, or something that happens to you.' },
]);

/**
 * FIFTEEN ITEMS, OURS.
 *
 * Written against the construct definition — total attention, full engagement of representational
 * resources, relative imperviousness to distraction, and the self-altering quality Tellegen and
 * Atkinson named in their title. Deliberately concrete and situational rather than dispositional,
 * because a situational item is answerable and a dispositional one invites a self-image.
 *
 * ⛔ No item here is taken from, adapted from, or paraphrased from any published absorption
 *    instrument. Where an obvious phrasing would have collided with a known item's territory, the
 *    item was written about a different situation instead.
 */
export const ITEMS = Object.freeze([
  // narrowing — total attention and imperviousness to distraction
  { id: 'n1', facet: 'narrowing', text: 'Someone has to say my name more than once before I hear it, because I was inside something else.' },
  { id: 'n2', facet: 'narrowing', text: 'I look up from a piece of work and have to reassemble where I am — which room, what day, what I was going to do next.' },
  { id: 'n3', facet: 'narrowing', text: 'Noise that would normally bother me stops registering entirely while I am occupied with something.' },
  // imaginal — imaginative involvement
  { id: 'i1', facet: 'imaginal', text: 'When I remember a place I know well, I can move around inside the memory and find details I was not deliberately storing.' },
  { id: 'i2', facet: 'imaginal', text: 'While reading, the described place becomes more present to me than the actual room I am sitting in.' },
  { id: 'i3', facet: 'imaginal', text: 'I plan something by walking through it in my head in enough detail that afterwards it feels partly like a thing I already did.' },
  // engrossment — responsiveness to engrossing stimuli
  { id: 'g1', facet: 'engrossment', text: 'A piece of music takes me somewhere specific rather than just sounding good.' },
  { id: 'g2', facet: 'engrossment', text: 'Weather, light or landscape can occupy me completely, with no thought in it that I could report afterwards.' },
  { id: 'g3', facet: 'engrossment', text: 'I find myself examining the surface of an ordinary object — grain, wear, the way the light sits on it — for far longer than there is any reason to.' },
  // selfaltering — time and self
  { id: 't1', facet: 'selfaltering', text: 'Hours go by and I would have guessed at a fraction of it.' },
  { id: 't2', facet: 'selfaltering', text: 'While something has me, the sense of being a person watching it thins out, and there is mostly just the thing.' },
  { id: 't3', facet: 'selfaltering', text: 'Coming out of one of these stretches takes a moment — I am briefly not quite back yet.' },
  // unbidden — arriving unasked
  { id: 'u1', facet: 'unbidden', text: 'These states arrive on their own rather than because I set out to have one.' },
  { id: 'u2', facet: 'unbidden', text: 'Something ordinary — a smell, a stretch of road, a few notes — drops me into a whole scene without my choosing it.' },
  { id: 'u3', facet: 'unbidden', text: 'I cannot reliably produce this on purpose, even when I would like to.' },
]);

export const ITEM_COUNT = ITEMS.length; // 15
export const MAX_SCORE = ITEM_COUNT * 4; // 60

/**
 * ⭐ The two passages, and this is the part that is not a questionnaire.
 *
 * A self-report index of "do you lose track of time" has an obvious hole: it asks a person to
 * remember an experience whose defining feature is that they were not keeping records. So the page
 * also takes ONE small behavioural reading. Two passages, matched for length and reading demand:
 * one is a continuous scene, one is a list of unrelated facts. The page times how long the reader
 * actually spends on each, then asks them to estimate it. The datum is the RATIO of estimate to
 * actual, and the comparison is between the two passages INSIDE ONE PERSON — because an absolute
 * time-estimation error is not comparable between two people and printing one would be meaningless.
 *
 * TWO TRIALS IS TWO TRIALS. This is not chronometry. The result copy says so before it says anything
 * else, and the difference is reported as a single observation, never as a measurement.
 *
 * The order is randomised per sitting, because a fixed order confounds the difference with practice
 * at estimating.
 */
export const PASSAGES = Object.freeze([
  {
    id: 'continuous',
    engrossing: true,
    heading: 'Read this once, at your own pace.',
    text: 'The tide had gone out further than anyone remembered, and the flats it left behind held the '
      + 'sky in flat sheets between the ridges of sand, so that walking out on them you seemed to be '
      + 'walking on cloud with the smell of salt underneath it. Ribbon weed lay in long dark braids. A '
      + 'gull went over low and did not call. Half a mile out the sand became firmer and colder and '
      + 'began, in places, to move very slightly under the foot, and it was here that the wrecks showed '
      + 'themselves: the black ribs of a boat, arranged in the sand like something that had been laid '
      + 'down carefully rather than lost.',
    question: 'Without checking a clock: how many seconds do you think you just spent reading that?',
  },
  {
    id: 'list',
    engrossing: false,
    heading: 'Read this once, at your own pace.',
    text: 'The standard atmosphere is defined as 101,325 pascals. The metre was redefined in 1983 in '
      + 'terms of the speed of light. Tin has ten stable isotopes, more than any other element. The '
      + 'Bailey bridge was designed in 1940. A gross is a dozen dozen. The freezing point of mercury is '
      + 'about minus thirty-nine degrees Celsius. Iceland has no railways in regular passenger service. '
      + 'The word "quarantine" comes from a period of forty days. Portland cement is named after a '
      + 'building stone from Dorset. The longest side of a right triangle is called the hypotenuse.',
    question: 'Without checking a clock: how many seconds do you think you just spent reading that?',
  },
]);

/** The estimate is entered in whole seconds. Bounds are generous and out-of-range is dropped, not clamped. */
export const ESTIMATE_BOUNDS = Object.freeze({ minSeconds: 1, maxSeconds: 3600 });

// ── administration order ─────────────────────────────────────────────────────────────────────────

function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Items and passages are shuffled independently, so passage order cannot masquerade as the ratio.
 *
 * ⚠️ `opts` is NOT destructured in the signature. `= {}` fires only for `undefined`, so a caller
 * passing an explicit `null` — which happens, because `null` is what a missing value looks like
 * coming back from a store or a JSON body — would sail past the default and throw on the property
 * read. A test passes `null` here on purpose.
 */
export function buildForm(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const seed = o.seed == null || o.seed === '' ? 'anon' : o.seed;
  const rand = rng(seedFrom(String(seed)) ^ 0x1B873593);
  return {
    items: shuffled(ITEMS, rand).map((it, position) => ({ id: it.id, text: it.text, position })),
    passages: shuffled(PASSAGES, rand).map((p, position) => ({
      id: p.id, heading: p.heading, text: p.text, question: p.question, position,
    })),
    scale: SCALE,
    estimateBounds: ESTIMATE_BOUNDS,
  };
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ The null trap, twice over, and it is the reason this helper exists.
 *
 * `Number(null) === 0` and `Number('') === 0`, so a missing reading silently becomes a real one — and
 * a time estimate of zero seconds is not merely wrong, it is the most extreme value on the scale. A
 * destructuring default (`= {}`) does not help either: it fires only for `undefined`, so an explicit
 * `null` sails straight past it into a property read. Five instances of this family were found across
 * this repo in one session. Both halves are guarded here and both are tested with an explicit `null`.
 */
const numOrNull = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * Score a sitting.
 *
 * `answers` maps item id -> 0..4.
 * `timing` maps passage id -> { ms, estimateSeconds } — `ms` measured by the page, `estimateSeconds`
 * given by the reader. Out-of-range values are DROPPED rather than clamped: a clamped junk value
 * becomes a plausible datum and a dropped one is visibly missing.
 */
export function scoreForm(answers, timing) {
  const a = obj(answers);
  const t = obj(timing);

  const perItem = [];
  for (const item of ITEMS) {
    const v = numOrNull(a[item.id]);
    if (v == null || v < 0 || v > 4 || v !== Math.round(v)) continue;
    perItem.push({ id: item.id, facet: item.facet, value: v });
  }
  const answered = perItem.length;
  const total = answered ? perItem.reduce((n, x) => n + x.value, 0) : null;

  const byFacet = {};
  for (const f of FACETS) {
    const rows = perItem.filter((x) => x.facet === f.id);
    byFacet[f.id] = rows.length === 3 ? rows.reduce((n, x) => n + x.value, 0) : null;
  }

  const readings = {};
  for (const p of PASSAGES) {
    const row = obj(t[p.id]);
    const ms = numOrNull(row.ms);
    const est = numOrNull(row.estimateSeconds);
    const actualSeconds = ms == null || ms <= 0 ? null : Math.round(ms) / 1000;
    const estimate = est == null || est < ESTIMATE_BOUNDS.minSeconds || est > ESTIMATE_BOUNDS.maxSeconds
      ? null : est;
    const ratio = (actualSeconds == null || estimate == null || actualSeconds <= 0)
      ? null : Math.round((estimate / actualSeconds) * 1000) / 1000;
    readings[p.id] = { actualSeconds, estimateSeconds: estimate, ratio, engrossing: p.engrossing };
  }
  const cont = readings.continuous || {};
  const list = readings.list || {};
  const ratioDifference = (cont.ratio == null || list.ratio == null)
    ? null : Math.round((cont.ratio - list.ratio) * 1000) / 1000;

  // Straight-lining is an OBSERVATION, never grounds for discarding a sitting. Same posture as the
  // sibling exams: recorded, reported, and left to the reader.
  const identical = answered === ITEM_COUNT && new Set(perItem.map((x) => x.value)).size === 1;

  return {
    exam: EXAM_ID,
    answered,
    itemCount: ITEM_COUNT,
    complete: answered === ITEM_COUNT,
    score: { total, min: MIN_SCORE, max: MAX_SCORE, ratioDifference },
    byFacet,
    perItem,
    passages: { ...readings, ratioDifference, trials: PASSAGES.length },
    allSameAnswer: identical,
  };
}

// ── the percentile, which mostly refuses to exist ────────────────────────────────────────────────

/**
 * percentileOf(total, distribution, n) — claim class ②, and the refusal is the feature.
 *
 * Returns null unless BOTH the completion count and the distribution reach MIN_N_FOR_RANK (100).
 * Below that there is a raw score and a reference-class sentence and nothing else, which is the
 * honest thing to show. Never throws; a junk distribution yields null rather than a fabricated rank.
 */
export function percentileOf(total, distribution, n) {
  const t = numOrNull(total);
  const count = numOrNull(n) || 0;
  const dist = Array.isArray(distribution)
    ? distribution.map(numOrNull).filter((x) => x != null) : [];
  if (t == null) return null;
  if (count < MIN_N_FOR_RANK || dist.length < MIN_N_FOR_RANK) return null;
  const below = dist.filter((x) => x < t).length;
  const equal = dist.filter((x) => x === t).length;
  return Math.round(((below + equal / 2) / dist.length) * 100);
}

// ── result copy ──────────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ THE FACTOR-STRUCTURE POINT, HOISTED OUT OF THE LANDMARKS BECAUSE IT IS LOAD-BEARING.
 *
 * Our facets are labelled "a shape, not established subscales" everywhere they appear. That could
 * read as a hedge — as if a proper instrument would have settled subscales and we merely lack the
 * sample. It is not a hedge. FIFTY YEARS ON THE SAME PUBLISHED INSTRUMENT, THE FACTOR STRUCTURE OF
 * ABSORPTION IS STILL DISPUTED: factor-analytic accounts in the literature have proposed
 * arrangements ranging from a small number of oblique primary factors with a single higher-order
 * factor, through six-to-nine content clusters, down to two subscales in the MPQ revision. Naming
 * that is more useful to a reader than our modesty is.
 */
export const FACET_HONESTY = Object.freeze({
  ours: 'The five facets below are how the fifteen items were WRITTEN. They are a description of our '
    + 'intentions, not a finding about the construct. No factor analysis has been run on them, because '
    + 'there is no sample to run one on, and there will not be one for a long time.',
  theirs: 'And the established instrument does not have a settled answer either. Factor-analytic work '
    + 'on the published absorption scale has proposed a small number of oblique primary factors with a '
    + 'single higher-order factor, six to nine content clusters, and — in the questionnaire revision '
    + 'that carries it — two subscales. Fifty years of work on the same item set has not produced one '
    + 'agreed structure. So "a shape, not established subscales" is not us being coy about a solved '
    + 'problem. It is an unsolved problem, and we are on the honest side of it.',
  citations: Object.freeze([
    'O’Grady, K.E. (1980), The absorption scale: A factor-analytic assessment, International Journal '
    + 'of Clinical and Experimental Hypnosis 28(3):281–288, doi:10.1080/00207148008409853. '
    + 'Crossref-verified this session.',
    'Radtke, H.L. & Stam, H.J. (1991), The relationship between absorption, openness to experience, '
    + 'anhedonia, and susceptibility, International Journal of Clinical and Experimental Hypnosis '
    + '39(1):39–56, doi:10.1080/00207149108409617 — factor analyses across two samples reached a '
    + 'conclusion that did not reduce to hypnotic susceptibility. Crossref-verified this session.',
    'Jamieson, G.A. (2005), The Modified Tellegen Absorption Scale, Australian Journal of Clinical and '
    + 'Experimental Hypnosis 33(2):119–139 — reports oblique primary factors plus a higher-order '
    + 'factor. [UNVERIFIED: no DOI could be resolved for this article in Crossref, and the journal is '
    + 'not PubMed-indexed. The citation is corroborated across independent bibliographic listings; the '
    + 'numbers in it are NOT quoted here because we could not read it.]',
  ]),
});

export const LANDMARKS = Object.freeze([
  {
    text: 'The construct was introduced under the title "openness to absorbing and self-altering '
      + 'experiences" — a disposition for episodes of total attention that engage a person’s whole '
      + 'representational capacity, perceptual and imaginative and ideational together, and that leave '
      + 'them relatively impervious to distraction while they last. Our items were written against '
      + 'that description. The instrument published with it is licensed and is not used here.',
    source: 'Tellegen, A. & Atkinson, G. (1974), Journal of Abnormal Psychology 83(3):268–277, '
      + 'doi:10.1037/h0036681. Crossref-verified this session (title, journal, volume, issue, pages, '
      + 'authors, year). ⚠️ The description above is our paraphrase. We did NOT obtain the primary PDF '
      + 'and we do not quote the authors’ definitional sentence, because the exact wording could not be '
      + 'verified against the original page — secondary sources render it two different ways.',
  },
  {
    text: 'Absorption is a real correlate of hypnotic responding and a modest one. There is no '
      + 'meta-analytic estimate of how large: we looked, and no meta-analysis of the '
      + 'absorption–hypnotisability relationship was found. Reported correlations vary widely across '
      + 'studies, and the variation is attributed to how and where the measurement was taken rather '
      + 'than to sampling noise alone. No single number is printed here because none is supportable.',
    source: 'Roche, S.M. & McConkey, K.M. (1990), Absorption: Nature, assessment, and correlates, '
      + 'Journal of Personality and Social Psychology 59(1):91–101, doi:10.1037/0022-3514.59.1.91. '
      + 'Crossref-verified this session. [UNVERIFIED: characterisation of magnitude taken from '
      + 'secondary summaries; the primary full text was not read.]',
  },
  {
    text: '⭐ THE DISPUTE THIS PAGE IS OBLIGED TO REPORT, BECAUSE IT IS ABOUT THE MEASUREMENT AND NOT '
      + 'ABOUT THE TRAIT. Council, Kirsch and Hafner gave the absorption scale to 64 people inside a '
      + 'hypnosis experiment and to 64 more in a context unrelated to hypnosis. In their words: '
      + '"Absorption was correlated with hypnotic responsivity and expectancy, but only when assessed '
      + 'in the hypnotic context." If that is right, a score can be partly an artefact of the room it '
      + 'was collected in — and this one was collected on a site that also runs exams about trance, '
      + 'colour and dreams. AND IT IS CONTESTED. Nadon, Hoyt, Register and Kihlstrom ran two much '
      + 'larger studies (N = 475 and N = 434) and found the context effect "weak and variable" in the '
      + 'first and REVERSED in the second, concluding that the results "reaffirm the construct validity '
      + 'of absorption as both a major dimension of personality and as a predictor of hypnotic '
      + 'responsiveness." We cite the exchange, not one side of it.',
    source: 'Council, J.R., Kirsch, I. & Hafner, L.P. (1986), Journal of Personality and Social '
      + 'Psychology 50(1):182–189, doi:10.1037/0022-3514.50.1.182; and Nadon, R., Hoyt, I.P., Register, '
      + 'P.A. & Kihlstrom, J.F. (1991), Absorption and hypnotizability: context effects reexamined, '
      + 'Journal of Personality and Social Psychology 60(1):144–153, doi:10.1037/0022-3514.60.1.144. '
      + 'Both Crossref-verified and both abstracts read in full this session.',
  },
  {
    text: 'Absorption sits close to Openness to Experience without being the same thing as it. The '
      + 'reported pattern is specific: it tracks the imaginative and aesthetic side of Openness and not '
      + 'the social-political side. If you have taken a personality inventory and scored high on '
      + 'Openness, that is a related fact about you and not a duplicate of this one.',
    source: 'Glisky, M.L., Tataryn, D.J., Tobias, B.A., Kihlstrom, J.F. & McConkey, K.M. (1991), '
      + 'Absorption, openness to experience, and hypnotizability, Journal of Personality and Social '
      + 'Psychology 60(2):263–272, doi:10.1037/0022-3514.60.2.263. Crossref-verified this session; the '
      + 'abstract reports that "absorption was related to imaginative involvement, but not to '
      + 'social-political liberalism". [UNVERIFIED: no correlation coefficient is stated in the '
      + 'abstract and the full text was not read, so no number is printed.]',
  },
  {
    text: 'Where the trait has been used as a predictor rather than described, it holds up. Pooling 23 '
      + 'controlled experiments — 409 psilocybin administrations to 261 healthy volunteers, against 24 '
      + 'candidate predictors — dose was by far the most important variable, and after dose, "having a '
      + 'high score in the personality trait of Absorption, being in an emotionally excitable and '
      + 'active state immediately before drug intake, and having experienced few psychological problems '
      + 'in past weeks were most strongly associated with pleasant and mystical-type experiences". A '
      + 'prospective survey of people taking psychedelics on their own initiative found the same '
      + 'direction: "The baseline trait absorption and higher drug doses promoted all aspects of the '
      + 'acute experience."',
    source: 'Studerus, E., Gamma, A., Kometer, M. & Vollenweider, F.X. (2012), Prediction of psilocybin '
      + 'response in healthy volunteers, PLoS ONE 7(2):e30800, doi:10.1371/journal.pone.0030800; and '
      + 'Haijen, E.C.H.M. et al. (2018), Predicting responses to psychedelics: a prospective study, '
      + 'Frontiers in Pharmacology 9:897, doi:10.3389/fphar.2018.00897 (N = 654, 535, 379, 315, 212 '
      + 'across five time points). Both Crossref-verified and both abstracts read in full this session. '
      + '⚠️ Note what this does NOT license: it is a group-level prediction from a trait measured with '
      + 'a licensed instrument that is not ours, and it says nothing about what YOUR score predicts.',
  },
  {
    text: 'The best-characterised instrument in the neighbouring domain retests at r(66) = .56 on its '
      + 'objective scale over about two months. A coefficient of that size does not support a category. '
      + 'That is the ceiling on what anything in this corner of the battery may claim — and it belongs '
      + 'to somebody else’s instrument. We have no retest coefficient at all yet, and saying so is '
      + 'cheaper than implying otherwise.',
    source: 'Lush, P., Moga, G., McLatchie, N. & Dienes, Z. (2018), Neuroscience of Consciousness '
      + '2018(1):niy006, doi:10.1093/nc/niy006. CC BY-NC, and not used here. Crossref-verified this session.',
  },
]);

/**
 * ⚠️ Same trap as `buildForm`, and this one was caught by a test rather than by reading: the
 * options bag is validated, not destructured with a default. `= {}` fires only for `undefined`.
 */
export function resultCopy(result, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const { n = 0, distribution = [], priorScore = null } = o;
  const r = result && typeof result === 'object' ? result : {};
  const total = r.score ? r.score.total : null;
  if (total == null) {
    return {
      headline: 'Nothing was answered, so there is nothing to score.',
      lines: [], facets: [], landmarks: [], retest: null, percentile: null,
      difference: DIFFERENCE.full, neverSay: (examById(EXAM_ID) || {}).neverSay || '',
    };
  }
  const count = numOrNull(n) || 0;
  const pct = percentileOf(total, distribution, count);
  const lines = [];

  if (!r.complete) {
    lines.push(`You answered ${r.answered} of ${r.itemCount} items, so this total is not on the `
      + `${MIN_SCORE}–${MAX_SCORE} scale and cannot be read against anything. It is kept as what it `
      + 'is: a partial sitting.');
  } else if (pct == null) {
    lines.push(`Your absorption index was ${total} out of ${MAX_SCORE}.`);
  } else {
    lines.push(`Your absorption index was ${total} out of ${MAX_SCORE}, around the ${pct}th percentile `
      + `of the ${count} people who have taken it here.`);
  }
  // The reference-class sentence is ALWAYS attached, percentile or no percentile. Below n = 100 it
  // explains why there is no rank; at or above it, it explains what the rank is a rank among.
  lines.push(referenceClass(count));
  lines.push(CONSTRUCT.notTheScale);
  lines.push(DIFFERENCE.full);
  lines.push('Fifteen items is a short index and a short index is a noisy one. This number is a '
    + 'measurement of what you reported on one occasion. It is not a type you belong to, it is not a '
    + 'trait we have established you have, and it does not predict what any practice will do to you.');

  const ps = r.passages || {};
  if (ps.ratioDifference == null) {
    lines.push('The two reading passages were not both completed with an estimate, so there is no '
      + 'time-estimation difference to report.');
  } else {
    const d = ps.ratioDifference;
    const dir = d > 0 ? 'over' : (d < 0 ? 'under' : 'the same as');
    lines.push(`On the two passages, your estimate of how long you spent ran ${Math.abs(d)} `
      + `${dir === 'the same as' ? '' : dir + ' '}on the continuous scene relative to the list of facts `
      + `(scene ratio ${(ps.continuous || {}).ratio}, list ratio ${(ps.list || {}).ratio}, where 1.00 `
      + 'means your estimate matched the clock). Two passages is two passages: this is a single '
      + 'observation and not a measurement, and it is reported because one direct reading is worth '
      + 'having even at n = 2.');
    lines.push('Only the DIFFERENCE between the two is reported. An absolute time-estimation error is '
      + 'not comparable between two people and printing one would be meaningless.');
  }

  if (r.allSameAnswer) {
    lines.push('You gave the same answer to every item. That is recorded as an observation and not as '
      + 'a verdict — some people genuinely answer that way — but if you were clicking through, '
      + 'a second unhurried sitting will be worth more than this one.');
  }
  // "A shape, not established subscales" — said in full, both halves, because the second half is the
  // half that stops it reading as false modesty.
  lines.push(`A SHAPE, NOT ESTABLISHED SUBSCALES. ${FACET_HONESTY.ours}`);
  lines.push(FACET_HONESTY.theirs);
  lines.push(CONSULT.notALab);

  return {
    headline: r.complete
      ? `Absorption ${total} of ${MAX_SCORE}`
      : `${r.answered} of ${r.itemCount} items answered`,
    lines,
    percentile: pct,
    facets: FACETS.map((f) => ({
      id: f.id, label: f.label, gloss: f.gloss, total: (r.byFacet || {})[f.id],
    })),
    landmarks: LANDMARKS,
    difference: DIFFERENCE.full,
    retest: retestPair(priorScore, total),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

export function absorptionPageHTML() {
  const exam = examById(EXAM_ID) || {};
  const body = `<h1>${esc(exam.name || 'Being taken')}</h1>
<p class=muted>${esc(exam.measures || '')}</p>

<div class=card>
  <h2 style="margin-top:0">What this measures</h2>
  <p>${esc(CONSTRUCT.full)}</p>
  <p><b>${esc(DIFFERENCE.short)}</b> ${esc(DIFFERENCE.full)}</p>
  <p class=prov>${esc(DIFFERENCE.whyBothExist)}
  <a href="${esc(DIFFERENCE.otherRoute)}">Sit the ${esc(DIFFERENCE.other)} index</a>.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Why the items are ours, and the refusals are the design</h2>
  <ul class=limits>
    <li><b>It is not the Tellegen Absorption Scale and it contains none of its items.</b><span class=muted>The
    TAS is licensed through the University of Minnesota Press as one of the eleven primary scales of the
    Multidimensional Personality Questionnaire. The evidence is not a missing permission notice but an act
    of enforcement: a long-running academic scale library that hosts the Harvard, Stanford and Waterloo
    hypnosis scales carries, where the TAS used to be, a line saying it was removed at the publisher’s
    request.</span></li>
    <li><b>MODTAS is not a workaround.</b><span class=muted>It is a rescaling of the same items, and a
    derivative of a licensed instrument carries the licence.</span></li>
    <li><b>We did not paraphrase our way around it.</b><span class=muted>A paraphrase of a licensed item
    set is a derivative work. It would also be a lie about provenance, which is the worse of the two
    problems.</span></li>
    <li><b>There was nothing in the public domain to fall back on.</b><span class=muted>The IPIP is
    genuinely public domain and is this project’s standing fallback — and its index of 274 labels across
    463 scales has no Absorption entry at all. So these fifteen items were written from the published
    definition of the construct, and the norms are ours and do not exist yet.</span></li>
    <li><b>No percentile below 100 takers.</b><span class=muted>Claim class ② is a percentile against a
    stated reference class. Under a hundred completed sittings there is no reference class worth the
    name, so you are shown your raw score and the count and nothing else.</span></li>
  </ul>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b></p>
</div>

<div class=card>
  <h2 style="margin-top:0">The five facets are a shape, not established subscales</h2>
  <p>${esc(FACET_HONESTY.ours)}</p>
  <p><b>And this is not us being coy about a solved problem.</b> ${esc(FACET_HONESTY.theirs)}</p>
  <ul class=prov>${FACET_HONESTY.citations.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>

<div class=card>
  <h2 style="margin-top:0">Your key</h2>
  <p>Your browser made you a random key. We store a one-way hash of it, never the key. It is the only
  thing linking this sitting to your next one — <b>write it down</b>. Without it we cannot delete your
  entries later, because we will have no way to know which ones are yours.</p>
  <p><span class=key id=keyout>…</span></p>
  <p><label class=field>Already have one? <input type=text id=keyin size=32 autocomplete=off placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
     <button class=ghost type=button id=keyset>Use that key</button></p>
</div>

${stateCardHTML({ formId: 'statecard' })}

<div class=card id=runner>
  <h2 style="margin-top:0">Fifteen statements</h2>
  <p class=muted>How often is each of these true of you? There is no good answer and no bad one.</p>
  <div id=form></div>
  <h2>And two short passages</h2>
  <p class=muted>Read each one once, at your own pace, then answer the question under it. The page
  times how long you spend; only the difference between your two estimates is used, and neither number
  means anything on its own.</p>
  <div id=passages></div>
  <p><button type=button id=submit>Score it</button> <span class=muted id=progress></span></p>
</div>

<div class=card id=result style="display:none"></div>

<div class=card>
  <h2 style="margin-top:0">Where this comes from</h2>
  <ul>${(exam.citations || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>

<div class=card>
  <h2 style="margin-top:0">The rules this page is bound by</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
</div>`;

  const js = `${KEYGEN_JS}
(function(){
  var key=teKey(), answers={}, timing={}, shown={};
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function now(){ try{ return Math.round(performance.now()); }catch(e){ return Date.now(); } }

  fetch('/api/exams/absorption/form').then(function(r){return r.json();}).then(function(d){
    var f=(d&&d.form)||{}, items=f.items||[], ps=f.passages||[], scale=f.scale||[];
    var h='';
    for(var i=0;i<items.length;i++){
      var it=items[i];
      h+='<fieldset><legend>'+(i+1)+' of '+items.length+'</legend><p><b>'+esc(it.text)+'</b></p>';
      for(var k=0;k<scale.length;k++){
        h+='<label class=opt><input type=radio name="'+esc(it.id)+'" value="'+scale[k].value+'"> <span>'
          +esc(scale[k].label)+'</span></label>';
      }
      h+='</fieldset>';
    }
    $('form').innerHTML=h;
    var ph='';
    for(var j=0;j<ps.length;j++){
      var p=ps[j];
      ph+='<fieldset data-passage="'+esc(p.id)+'"><legend>'+esc(p.heading)+'</legend>'
        +'<p class=passage>'+esc(p.text)+'</p>'
        +'<p><b>'+esc(p.question)+'</b></p>'
        +'<label class=field><input type=number min="1" max="3600" step="1" size="6" data-est="'+esc(p.id)+'"> seconds</label>'
        +'</fieldset>';
    }
    $('passages').innerHTML=ph;
    // The reading clock starts when a passage first becomes visible to the reader and stops when the
    // estimate box for it is touched. Crude, honest, and reported as crude.
    var fs=$('passages').querySelectorAll('fieldset');
    for(var q=0;q<fs.length;q++){ shown[fs[q].getAttribute('data-passage')]=now(); }
    $('form').addEventListener('change',function(e){
      var el=e.target; if(!el||el.type!=='radio') return;
      answers[el.name]=Number(el.value);
      $('progress').textContent=Object.keys(answers).length+' of '+items.length+' answered';
    });
    $('passages').addEventListener('focusin',function(e){
      var el=e.target; if(!el||!el.getAttribute) return;
      var id=el.getAttribute('data-est'); if(!id) return;
      if(!timing[id]) timing[id]={};
      if(timing[id].ms==null) timing[id].ms=now()-(shown[id]||now());
    });
    $('passages').addEventListener('input',function(e){
      var el=e.target; if(!el||!el.getAttribute) return;
      var id=el.getAttribute('data-est'); if(!id) return;
      if(!timing[id]) timing[id]={};
      timing[id].estimateSeconds = el.value===''?null:Number(el.value);
    });
  }).catch(function(){ $('form').innerHTML='<p>Could not load the questions.</p>'; });

  function readCard(){
    var f=document.getElementById('statecard'), out={deq5:{},classes:[],practices:[]};
    if(!f) return out;
    var els=f.querySelectorAll('input');
    for(var i=0;i<els.length;i++){
      var el=els[i], n=el.name; if(!n) continue;
      if(el.type==='radio'){ if(el.checked) out[n]=el.value; }
      else if(el.type==='checkbox'){ if(!el.checked) continue;
        if(n==='classes'||n==='practices') out[n].push(el.value); else out[n]=true; }
      else if(n.indexOf('deq5.')===0){ out.deq5[n.slice(5)]=el.value; }
      else if(el.value!=='') out[n]=el.value;
    }
    out.localTime=new Date().toISOString();
    try{ out.tz=Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    out.tzOffsetMin=new Date().getTimezoneOffset();
    return out;
  }

  $('submit').onclick=function(){
    $('progress').textContent='scoring…';
    fetch('/api/exams/absorption',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key,stateCard:readCard(),answers:answers,timing:timing})})
      .then(function(r){return r.json();}).then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; $('progress').textContent=''; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        h+='<h3>The five facets — a shape, not subscales</h3><table><tr><th>facet</th><th>of 12</th></tr>';
        h+=(d.copy.facets||[]).map(function(f){return '<tr><td>'+esc(f.label)+'<br><span class=prov>'+esc(f.gloss)+'</span></td><td>'+(f.total==null?'—':f.total)+'</td></tr>';}).join('');
        h+='</table>';
        h+='<h3>Landmarks, not verdicts</h3>';
        h+=(d.copy.landmarks||[]).map(function(l){return '<p>'+esc(l.text)+'<br><span class=prov>'+esc(l.source)+'</span></p>';}).join('');
        if(d.copy.retest&&d.copy.retest.text) h+='<h3>The second sitting</h3><p>'+esc(d.copy.retest.text)+'</p>';
        if(d.covariate) h+=d.covariate;
        h+='<p class=prov>Sitting '+d.sessionNumber+'.</p>';
        box.innerHTML=h; box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      }).catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  };
})();`;

  return examShell(exam.name || 'Being taken', body, {
    extraJS: js,
    extraCSS: '.passage{max-width:38rem;line-height:1.6}',
  });
}

/** GET handler for the page, so the route can be driven without the whole server. */
export function handler(req, res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(absorptionPageHTML());
}

const isMain = process.argv[1] && process.argv[1].endsWith('exam-absorption.mjs');
if (isMain) {
  const form = buildForm({ seed: 'cli' });
  console.log(`${EXAM_ID}: ${ITEM_COUNT} items, ${FACETS.length} facets, max ${MAX_SCORE}`);
  console.log('first three items in this order:', form.items.slice(0, 3).map((i) => i.id).join(', '));
  const answers = {};
  for (const it of ITEMS) answers[it.id] = 2;
  const scored = scoreForm(answers, { continuous: { ms: 40000, estimateSeconds: 25 }, list: { ms: 40000, estimateSeconds: 40 } });
  console.log('all-2s sitting ->', JSON.stringify(scored.score));
  console.log('percentile with n = 12 ->', percentileOf(scored.score.total, [], 12));
}

export default {
  EXAM_ID, CONSTRUCT, DIFFERENCE, SCALE, ITEMS, ITEM_COUNT, FACETS, PASSAGES, ESTIMATE_BOUNDS,
  MIN_SCORE, MAX_SCORE, LANDMARKS, FACET_HONESTY,
  buildForm, scoreForm, percentileOf, resultCopy, absorptionPageHTML, handler, esc,
};
