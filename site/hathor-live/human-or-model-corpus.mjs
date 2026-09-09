// site/hathor-live/human-or-model-corpus.mjs — the stimulus set for X7, and the truth about it.
//
// ── READ THIS BEFORE YOU BELIEVE A SCORE FROM THIS EXAM ──────────────────────────────────────────
//
// WHAT SHIPS HERE IS A SEED SET, NOT A VALID STIMULUS SET, AND THE DIFFERENCE MATTERS.
//
// The human halves below are verbatim public-domain literary passages, 1813–1899, each carrying its
// author, work and year. The model halves were written by Claude Opus 5 on 2026-09-08, in the same
// register and on the same topic as the passage each is paired with, for this exam and for nothing
// else. Both provenances are honest and neither is secret.
//
// What that buys: a real forced-choice discrimination task with real answers, no licensing cost, no
// scraped writing, and nobody's private prose in a public repo.
//
// What it does NOT buy: a measurement of the thing the exam is named after. Discriminating a
// nineteenth-century novelist from a twenty-first-century model doing period pastiche is a DIFFERENT
// TASK from discriminating a person writing now from a model writing now. Two confounds are built in
// and both inflate d′:
//
//   1. RECOGNITION. Several of these passages are among the most famous openings in English. A taker
//      who recognises "Call me Ishmael" has not discriminated, they have remembered. The instrument
//      therefore asks per trial whether either passage was recognised, and scores the recognised
//      trials separately — see `exam-human-or-model.mjs`. Never averaged in silently.
//   2. REGISTER. Pastiche is not the same as production. A model asked to write like Melville leaves
//      different fingerprints from a model writing an ordinary paragraph, and a reader can learn the
//      pastiche fingerprint without learning anything about model text in general.
//
// The result screen says both of these. A seed set that lies about what it is would be a strange
// thing to put inside an exam about telling truth from imitation.
//
// ── WHAT A REAL SET REQUIRES, AND WHY THIS ONE IS THE INSTITUTE'S TO BUILD ───────────────────────
//
// This is the one exam in the SF paper whose stimulus set the project can generate itself, at zero
// licensing cost, and refresh indefinitely — because the institute runs an AI witness that posts
// publicly on the MELEK chain under the account `hathor`. The model half of a real set is Hathor's
// own public output, timestamped, on topics Hathor actually writes about.
//
// The human half cannot be generated. It has to be WRITTEN, by consenting people, to the same
// prompts, at the same lengths, in the same medium. That is an operator task and not a code task, and
// pretending otherwise by scraping a forum would put strangers' writing into a public corpus without
// asking them. `PROMPTS` below is the specification for that collection round: matched topics, matched
// word budgets, and the metadata each contributed passage has to carry.
//
// `loadPairs()` reads an operator-assembled pool from disk when there is one and falls back to the
// seed otherwise, so the exam's stimulus set is DATA rather than code and can be replaced without a
// deploy. The pool file is JSONL, one pair per line, and it is never committed to this repo.
//
// ── TIMESTAMPING IS PART OF THE INSTRUMENT ───────────────────────────────────────────────────────
//
// Every pair carries when its model half was generated and by what. §A.7's stated honest limit is
// that a percentile from 2026 does not mean the same thing in 2028, and the fix is not a footnote:
// `vintage()` computes the generation dates and the age in days, and the result screen prints them.
//
// Pure, offline, injectable I/O. Nothing here throws into a request path.

import fs from 'node:fs';
import path from 'node:path';

// ── the pair schema ──────────────────────────────────────────────────────────────────────────────
/**
 * A pair is: one topic, one human-authored passage with a citable source, one model-authored passage
 * with a named model and a generation date, and word counts within tolerance of each other.
 *
 * `matchedOn` says what was held constant. It is not decoration — a pair matched on topic but not on
 * length is a length-discrimination task wearing an authorship costume.
 */
export const LENGTH_TOLERANCE = 0.12; // ±12% in words.

/**
 * AND THE DIFFERENCE MUST NOT BE SYSTEMATICALLY SIGNED, which is a separate and nastier bug.
 *
 * The first draft of the seed set passed a ±25% per-pair check and was still broken: the model half
 * was the longer half in nine pairs out of ten. Every pair was "matched", and a taker could still have
 * scored 90% by learning one rule — pick the longer one — without discriminating anything at all.
 * `lengthBias()` measures the signed imbalance across the whole set and the tests assert on it.
 */
export const MAX_LENGTH_BIAS = 0.6; // at most 80/20 either way across the set

export const SET_ID = 'seed-public-domain-v1';
export const SET_GENERATED_AT = '2026-09-08';
export const SET_KIND = 'seed';

const wordsIn = (s) => String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).length;
export { wordsIn };

/**
 * The seed pairs.
 *
 * Human halves: public domain by age in every jurisdiction that matters — the most recent is 1899 and
 * its author died in 1924. Quoted verbatim from the published text.
 *
 * Model halves: written by Claude Opus 5, 2026-09-08, to the same topic and a matched word budget, in
 * the register of the paired passage. Not retrieved, not adapted from anything, not a paraphrase of
 * the human half.
 */
export const SEED_PAIRS = Object.freeze([
  {
    id: 'aphorism-marriage',
    topic: 'An aphoristic opening: a general claim about what a neighbourhood assumes of a new arrival with money.',
    matchedOn: ['topic', 'length', 'register', 'position (both are opening paragraphs)'],
    human: {
      author: 'Jane Austen',
      work: 'Pride and Prejudice',
      year: 1813,
      publicDomain: 'by age; author died 1817',
      text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'It is a maxim seldom disputed in the country, that a widow left with an income and no children must be in want of an occupation. Whatever her own designs may be upon her leisure, they are of very small consequence beside the settled conviction of the parish, which has already disposed of her mornings, her carriage, and a good part of her fortune, before she has finished unpacking.',
    },
  },
  {
    id: 'antithesis-age',
    topic: 'An antithetical catalogue characterising an entire age by its contradictions.',
    matchedOn: ['topic', 'length', 'register', 'the rhetorical figure itself'],
    human: {
      author: 'Charles Dickens',
      work: 'A Tale of Two Cities',
      year: 1859,
      publicDomain: 'by age; author died 1870',
      text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'It was a season of engines, it was a season of ruins, it was the hour of the almanac, it was the hour of the prophet, we had counted the stars and we had forgotten the names of our own fields, we were told the world was ending and told in the same breath that it had only lately begun, and the men who were most certain of the one were commonly the very men who were most certain of the other.',
    },
  },
  {
    id: 'narrator-to-sea',
    topic: 'A narrator names himself, admits he is broke and out of sorts, and explains that he goes to the water as a remedy.',
    matchedOn: ['topic', 'length', 'register', 'first-person retrospective voice'],
    human: {
      author: 'Herman Melville',
      work: 'Moby-Dick',
      year: 1851,
      publicDomain: 'by age; author died 1891',
      text: 'Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation. Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; then, I account it high time to get to sea as soon as I can.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'They called me Peel at the yard. One autumn—the year does me no credit—having spent what I had and quarrelled with everybody who might have lent me more, I took it into my head to go down to the fens and hire myself to the barges. It is a cure I have found for a certain heaviness. Whenever the streets begin to look at me sideways; whenever every doorway seems to know my business; then I go where the water moves and let it carry the thing off.',
    },
  },
  {
    id: 'deliberate-solitude',
    topic: 'Why the writer went away to live alone, and what he was and was not trying to prove by it.',
    matchedOn: ['topic', 'length', 'register', 'the because/nor-did-I construction'],
    human: {
      author: 'Henry David Thoreau',
      work: 'Walden',
      year: 1854,
      publicDomain: 'by age; author died 1862',
      text: 'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'I took the hut on the ridge because I wished to be answerable to nothing but the weather, and to find out whether a man may be sufficient to himself for a year, or whether he merely says so in company. I did not go there to punish myself, which is a cheap sort of virtue; nor did I go to be admired for going, though I confess the thought had its hour.',
    },
  },
  {
    id: 'entangled-bank',
    topic: 'Standing before a crowded patch of living things and reflecting that ordinary causes produced all of it.',
    matchedOn: ['topic', 'length', 'register', 'the single-sentence cumulative structure'],
    human: {
      author: 'Charles Darwin',
      work: 'On the Origin of Species',
      year: 1859,
      publicDomain: 'by age; author died 1882',
      text: 'It is interesting to contemplate an entangled bank, clothed with many plants of many kinds, with birds singing on the bushes, with various insects flitting about, and with worms crawling through the damp earth, and to reflect that these elaborately constructed forms, so different from each other, and dependent on each other in so complex a manner, have all been produced by laws acting around us.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'It is worth standing beside a rock pool at the turn of the tide, crowded with weeds, with small fishes darting under the ledges, and with crabs going about their business in the shadow, and considering that these creatures, so unlike one another, and so exactly fitted to the hours of the water, have been shaped by causes still at work under our own eyes.',
    },
  },
  {
    id: 'defining-a-faculty',
    topic: 'A psychologist defines a mental faculty by saying everyone already knows what it is, then says what it costs.',
    matchedOn: ['topic', 'length', 'register', 'the "every one knows what X is" opening move'],
    human: {
      author: 'William James',
      work: 'The Principles of Psychology',
      year: 1890,
      publicDomain: 'by age; author died 1910',
      text: 'Every one knows what attention is. It is the taking possession by the mind, in clear and vivid form, of one out of what seem several simultaneously possible objects or trains of thought. Focalization, concentration, of consciousness are of its essence. It implies withdrawal from some things in order to deal effectively with others.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'Every one knows what expectation is. It is the leaning forward of the mind into a shape which the fact is then required to fill. Anticipation, preparedness, are of its essence. It commits us in advance to one reading of the world, and we pay for that commitment whenever the world was arranged on another plan.',
    },
  },
  {
    id: 'machine-cannot-originate',
    topic: 'A machine executes a design faithfully and originates nothing; the judgement happened earlier, in a person.',
    matchedOn: ['topic', 'length', 'register', 'the it-can/it-cannot pairing'],
    human: {
      author: 'Ada Lovelace',
      work: 'Note G to her translation of Menabrea’s Sketch of the Analytical Engine',
      year: 1843,
      publicDomain: 'by age; author died 1852',
      text: 'The Analytical Engine has no pretensions whatever to originate anything. It can do whatever we know how to order it to perform. It can follow analysis; but it has no power of anticipating any analytical relations or truths. Its province is to assist us in making available what we are already acquainted with.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'The loom has no opinion concerning the pattern it produces. It will repeat with perfect fidelity whatever the cards require of it, and will repeat an error as faithfully as a felicity. Its office is not to judge the design but to render it; the judgement must be performed beforehand, by a person, upon paper.',
    },
  },
  {
    id: 'letter-from-the-expedition',
    topic: 'The opening of a letter home: nothing has gone wrong yet, despite the recipient’s gloomy predictions.',
    matchedOn: ['topic', 'length', 'register', 'epistolary opening'],
    human: {
      author: 'Mary Shelley',
      work: 'Frankenstein (Letter I)',
      year: 1818,
      publicDomain: 'by age; author died 1851',
      text: 'You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'You will be glad to learn that nothing has yet gone amiss with the undertaking which you regarded so darkly. We came into the roads on Tuesday, and my first business ashore is to satisfy my dear brother that I am whole, warm, and more certain than when we parted.',
    },
  },
  {
    id: 'sharpened-senses',
    topic: 'A narrator denies he is mad and offers, as evidence, that his illness sharpened one sense to an intolerable degree.',
    matchedOn: ['topic', 'length', 'register', 'the dash-broken protest and the closing question'],
    human: {
      author: 'Edgar Allan Poe',
      work: 'The Tell-Tale Heart',
      year: 1843,
      publicDomain: 'by age; author died 1849',
      text: 'True!—nervous—very, very dreadfully nervous I had been and am; but why will you say that I am mad? The disease had sharpened my senses—not destroyed—not dulled them. Above all was the sense of hearing acute. I heard all things in the heaven and in the earth. I heard many things in hell. How, then, am I mad?',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'Yes!—restless—unendurably restless I have been and am; but why do you call it a derangement? The fever did not blunt me—it filed me down to an edge. Above all, the sense of smell became insupportable. I could tell what had been cooked three doors away. Is that the account of a man out of his wits?',
    },
  },
  {
    id: 'vessel-at-anchor',
    topic: 'A small vessel lies still at her moorings at a turn of the tide, and there is nothing to do but wait.',
    matchedOn: ['topic', 'length', 'register', 'opening scene-setting'],
    human: {
      author: 'Joseph Conrad',
      work: 'Heart of Darkness',
      year: 1899,
      publicDomain: 'by age; author died 1924',
      text: 'The Nellie, a cruising yawl, swung to her anchor without a flutter of the sails, and was at rest. The flood had made, the wind was nearly calm, and being bound down the river, the only thing for it was to come to and wait for the turn of the tide.',
    },
    model: {
      model: 'Claude Opus 5',
      generatedAt: '2026-09-08',
      text: 'The Kestrel, a broad-beamed ketch, lay to her moorings with her canvas stowed, and gave no sign of impatience. The ebb had begun, the air had gone out of the evening, and since there was no getting to sea before morning, there was nothing but to bring up in the bight.',
    },
  },
]);

// ── the specification for a real set ─────────────────────────────────────────────────────────────
/**
 * PROMPTS is the collection round, written down so it can be run rather than described.
 *
 * The MODEL half of each prompt is generated by the institute's own witness — Hathor writes publicly
 * on these subjects already, so the model corpus is a by-product of the thing the project does anyway
 * and refreshes every time the model behind Hathor changes. That is the zero-licensing-cost half.
 *
 * The HUMAN half is the part that needs people. Each contributed passage must carry: the prompt id,
 * the word count, the date, an assertion by the writer that they wrote it without model assistance,
 * and consent to publish it anonymously as an exam stimulus. Anything without all five stays out.
 *
 * Nothing here is a chain operation and nothing here goes on chain. A stimulus corpus of people's
 * writing on a public permanent ledger is precisely the wrong place for it.
 */
export const PROMPTS = Object.freeze([
  { id: 'witness-explains-block', words: [90, 130], topic: 'Explain in plain language what a witness does on a Graphene-style chain, to someone who has used a wallet but never run anything.' },
  { id: 'why-i-came-here', words: [90, 130], topic: 'Write about the first time you understood something you had been repeating for years without understanding.' },
  { id: 'a-place-at-a-time-of-day', words: [80, 120], topic: 'Describe one place you know well, at one particular hour, without naming the place.' },
  { id: 'an-argument-you-lost', words: [90, 130], topic: 'Describe an argument you lost and later decided you had been right about, or wrong about — say which.' },
  { id: 'instructions-for-a-thing-you-can-do', words: [90, 130], topic: 'Give instructions for something you personally know how to do and most people do not.' },
  { id: 'the-one-that-got-away', words: [80, 120], topic: 'A small failure that still bothers you, told without a moral at the end.' },
  { id: 'reading-a-number', words: [90, 130], topic: 'Explain a number you have to read regularly — a price, a dose, a block height, a lab value — and what people get wrong about it.' },
  { id: 'weather-report', words: [70, 110], topic: 'The weather where you are, written as if to someone who has never been there.' },
]);

/** The metadata a contributed human passage must carry before it may enter the pool. */
export const CONTRIBUTION_REQUIREMENTS = Object.freeze([
  'the prompt id it was written to',
  'the date it was written',
  'the writer’s own statement that no model assisted in writing it',
  'explicit consent to publish it anonymously as an exam stimulus',
  'no names, no places identifying the writer, nothing they would mind a stranger reading',
]);

// ── validation ───────────────────────────────────────────────────────────────────────────────────

/**
 * Is this a usable pair? Returns { ok, errors, words }. Soft — a bad line in an operator pool file
 * is dropped with a reason, never thrown, and never silently accepted.
 */
/**
 * How lopsided is the whole set? Returns the share of pairs whose model half is longer, mapped onto
 * −1 (model always shorter) … 0 (balanced) … +1 (model always longer), plus the mean signed
 * difference in words. A set that fails this is a length-discrimination task wearing a costume.
 */
export function lengthBias(pairs = SEED_PAIRS) {
  const rows = (Array.isArray(pairs) ? pairs : []).map((p) => {
    const h = wordsIn(p && p.human && p.human.text);
    const m = wordsIn(p && p.model && p.model.text);
    return { h, m, signed: h && m ? (m - h) / Math.max(h, m) : 0 };
  }).filter((r) => r.h && r.m);
  if (!rows.length) return { n: 0, modelLongerShare: null, bias: null, meanSigned: null };
  const longer = rows.filter((r) => r.signed > 0).length;
  return {
    n: rows.length,
    modelLongerShare: longer / rows.length,
    bias: (2 * longer) / rows.length - 1,
    meanSigned: rows.reduce((s2, r) => s2 + r.signed, 0) / rows.length,
    worst: Math.max(...rows.map((r) => Math.abs(r.signed))),
  };
}

export function validatePair(pair) {
  const errors = [];
  const p = pair && typeof pair === 'object' ? pair : {};
  if (!p.id) errors.push('a pair needs an id');
  if (!p.topic) errors.push('a pair needs a topic — an unmatched pair is not a discrimination task');
  const h = p.human && typeof p.human === 'object' ? p.human : {};
  const m = p.model && typeof p.model === 'object' ? p.model : {};
  const hw = wordsIn(h.text);
  const mw = wordsIn(m.text);
  if (hw < 20) errors.push('the human passage is missing or too short to judge');
  if (mw < 20) errors.push('the model passage is missing or too short to judge');
  if (!h.author && !h.source) errors.push('the human passage has no attributable source — provenance is not optional here');
  if (!m.model) errors.push('the model passage does not say which model wrote it');
  if (!m.generatedAt) errors.push('the model passage is not timestamped, and §A.7’s honest limit needs the timestamp');
  if (hw >= 20 && mw >= 20) {
    const ratio = Math.abs(hw - mw) / Math.max(hw, mw);
    if (ratio > LENGTH_TOLERANCE) {
      errors.push(`the halves differ in length by ${Math.round(ratio * 100)}% — matched for length means matched for length`);
    }
  }
  return { ok: errors.length === 0, errors, words: { human: hw, model: mw } };
}

// ── the pool loader ──────────────────────────────────────────────────────────────────────────────

export const POOL_PATH = process.env.HATHOR_EXAM_STIMULUS_PATH
  || path.join(process.env.HOME || '/tmp', '.hathor', 'human-or-model-pairs.jsonl');

let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }

function io() {
  return _io || { read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } } };
}

/**
 * The live pool: an operator-assembled JSONL file if there is one, the seed otherwise.
 *
 * Returns { pairs, source, kind, rejected } — `kind` is 'seed' or 'pool', and the exam PRINTS it,
 * because a taker is entitled to know whether they were judging period pastiche or contemporary
 * writing. A pool file with fewer than MIN_PAIRS usable lines falls back to the seed rather than
 * serving a two-trial exam.
 */
export const MIN_PAIRS = 6;

/**
 * What the exam prints about the set it just served. A taker is entitled to know whether they were
 * judging period pastiche or contemporary writing, and this is the sentence that tells them.
 */
export const SET_NOTES = Object.freeze({
  seed: 'This is the built-in SEED set: the human halves are public-domain literary passages from '
    + '1813–1899 and the model halves were written to match them in topic, length and register. It '
    + 'demonstrates the instrument honestly; it is not yet a measurement of telling a person writing '
    + 'today from a model writing today. Both reasons are on the result screen.',
  pool: 'This is an operator-assembled set: the human halves were written by consenting contributors '
    + 'to the same prompts, at the same lengths, as the model halves.',
});

export function loadPairs({ file = POOL_PATH } = {}) {
  // A reader that throws is a broken pool, not a broken request. Soft-fail to the seed.
  let raw = '';
  try { raw = io().read(file); } catch { raw = ''; }
  const rejected = [];
  const pairs = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { rejected.push('unparseable line'); continue; }
    const v = validatePair(rec);
    if (!v.ok) { rejected.push(`${(rec && rec.id) || 'unnamed'}: ${v.errors[0]}`); continue; }
    pairs.push(rec);
  }
  if (pairs.length >= MIN_PAIRS) {
    return { pairs, source: file, kind: 'pool', note: SET_NOTES.pool, rejected };
  }
  return {
    pairs: SEED_PAIRS.slice(),
    source: 'seed-public-domain-v1 (built in)',
    kind: SET_KIND,
    note: SET_NOTES.seed,
    rejected: pairs.length ? [...rejected, `only ${pairs.length} usable pairs in the pool, need ${MIN_PAIRS} — fell back to the seed`] : rejected,
  };
}

/**
 * When the model halves of a set were generated, and how stale that is today.
 *
 * §A.7's honest limit, implemented: "The result is a moving target. A percentile from 2026 will not
 * mean the same thing in 2028, and the exam must timestamp its stimulus generation and say so on the
 * result screen."
 */
export function vintage(pairs = SEED_PAIRS, { now = () => new Date() } = {}) {
  const dates = [];
  const models = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const m = (p && p.model) || {};
    if (m.generatedAt) dates.push(String(m.generatedAt));
    if (m.model) models.add(String(m.model));
  }
  dates.sort();
  const oldest = dates[0] || null;
  const newest = dates[dates.length - 1] || null;
  const today = now();
  const ageDays = newest ? Math.max(0, Math.round((today.getTime() - Date.parse(newest)) / 86400000)) : null;
  return {
    oldest,
    newest,
    models: [...models],
    ageDays,
    sentence: newest
      ? `The model-written half of every pair you saw was generated on ${oldest === newest ? newest : `${oldest} to ${newest}`}`
        + `${models.size ? ` by ${[...models].join(', ')}` : ''}`
        + `${Number.isFinite(ageDays) ? `, which is ${ageDays} ${ageDays === 1 ? 'day' : 'days'} ago` : ''}. `
        + 'This score is against that vintage of model and no other. Models change quickly and this task '
        + 'gets harder every time they do, so a result from today does not mean the same thing in two years, '
        + 'and it is not comparable to a result from a set generated on a different date.'
      : 'This set carries no generation date, which means its age cannot be stated and its score cannot be interpreted.',
  };
}

export default {
  SEED_PAIRS, SET_ID, SET_GENERATED_AT, SET_KIND, SET_NOTES, PROMPTS, CONTRIBUTION_REQUIREMENTS,
  LENGTH_TOLERANCE, MAX_LENGTH_BIAS, MIN_PAIRS, POOL_PATH, validatePair, lengthBias, loadPairs, vintage, wordsIn, __setIO,
};
