// site/hathor-live/exam-human-or-model.mjs — X7, the Voight-Kampff, part one: human or model.
//
// ── THE FICTION IS THE HOOK, NEVER THE FRAME OF THE RESULT ───────────────────────────────────────
//
// Philip K. Dick built the Voight-Kampff apparatus in "Do Androids Dream of Electric Sheep?" (1968);
// Ridley Scott put it on screen in 1982. It measures respiration, heart rate, blush response and
// pupillary dilation while the subject is asked provocative questions, and it sorts people from
// androids. That is a legitimate reason to care about this measurement. It is NOT a description of
// anybody who takes it, and no output of this file says "you scored in the replicant range."
//
// The machine half of the fiction is wrong and the interview half turned out to be right, which is a
// better story than either. See LANDMARKS.
//
// ── WHY THIS EXAM EXISTS HERE AND NOT SOMEWHERE ELSE ─────────────────────────────────────────────
//
// This institute runs an AI witness that posts publicly on the MELEK chain under the account name
// `hathor`. Of the twenty-two exams in the SF-derived paper, four of the highest-ranked are blocked on
// whether the project may lawfully display somebody else's photographs. This one is not blocked on
// anything: the model half of its stimulus set is a by-product of what the project already does, it
// costs nothing to license, and it can be regenerated every time the model behind Hathor changes.
// That is the strategic point of building this one, and it should not be lost in a refactor.
//
// ── WHAT MAY AND MAY NOT BE SAID ABOUT A TAKER — READ THIS BEFORE ADDING A HEDGE ─────────────────
//
// OPERATOR CORRECTION, 2026-09-08, and it overrides the reflex: "we don't mind the Quizes telling
// People they are 'Special', but we want it to be as True as Possible, like Perfect Pitch, the Jung
// Tests, or even Medical and Competency or IQ Type Tests." THE BAR IS TRUTH, NOT MODESTY. Where the
// evidence supports a categorical claim, the exam makes it plainly — a grapheme–colour consistency
// score below the published threshold IS the finding that somebody is a synaesthete, and hedging that
// into meaninglessness is the error, not the safeguard. The safety gate's "never worded as a
// clearance" is about PHOTOSENSITIVE EPILEPSY, a medical-risk claim the project cannot carry the
// liability for. It is not a blanket ban on telling a person a true thing about their perception, and
// the next agent to read it that way is reading it past its subject.
//
// AND YET THIS EXAM STILL REFUSES THE CATEGORY — for an empirical reason, not a house rule:
//
//   1. THE TARGET MOVES. Absolute pitch is a property of the listener and it is the same property in
//      2028. "Can tell a model from a person" is a property of the listener AND of the models, and the
//      models change every few months. Jones & Bergen's un-prompted GPT-4o was identified as a machine
//      more often than chance; the same architecture with a persona prompt beat actual humans. A d′
//      measured against one vintage of one stimulus set does not describe the taker next year. There
//      is no stable trait here to be categorical about.
//   2. THE EFFECT IS MOSTLY ABOUT THE MODELS. In the published three-party test the biggest single
//      determinant of the verdict was the PROMPT given to the machine, not the interrogator. A high
//      score here is substantially a fact about which passages were in the set.
//   3. THE CALIBRATION FINDING IS THE POINT AND IT CUTS THE OTHER WAY. The near-universal result is
//      that people's confidence in this ability is not justified. An exam that then handed out
//      "you're one of the ones who can tell" would be contradicting its own headline measurement.
//
// So: report d′, report the calibration, name the vintage, and let the number be as flattering as it
// honestly is. What is refused here is the IDENTITY, not the compliment — and it is refused because
// of what the measurement is, not because saying a true strong thing is forbidden.
//
// ── THE DESIGN ───────────────────────────────────────────────────────────────────────────────────
//
// Forced choice, two passages per trial, one human-authored and one model-authored, matched for topic
// and length. The taker picks the model, rates confidence 50–100 (50 is a coin flip, because a
// two-alternative guess is already half right), and says whether they RECOGNISED either passage.
//
// Scoring is d′ and calibration, never raw percent correct on its own. Percent correct confounds
// sensitivity with willingness to say "model"; d′ = √2·z(pc) is the two-alternative forced-choice
// formula and it is the one used here (see signal-detection.mjs for why the yes/no formula is wrong
// for this design and inflates the number by ~41%).
//
// STATELESS ANSWER KEY. The trials endpoint returns a seed; the client posts the seed back with its
// choices; the server rebuilds the identical trial order and side assignment from that seed and grades
// against it. No session store, no cookie. The mapping is deterministic and this file is public, so a
// determined person could compute the key — which costs them nothing, because nothing here pays
// anything, ranks anything or unlocks anything. That is not a gap in the security model; it is the
// payment boundary doing the work security would otherwise have to.
//
// ── DEBRIEF (§D.2) ───────────────────────────────────────────────────────────────────────────────
//
// This exam does not deceive: the taker is told up front that every pair is exactly one human passage
// and one model passage, and that is true of every trial. There are no catch trials and no lies.
// The debrief ships anyway, on the same screen as the result, before any navigation is offered —
// per-trial provenance, who wrote what, when the model half was generated, and the two confounds the
// seed set carries. A person is entitled to know what they were just tested on.
//
// Pure and offline apart from the corpus loader. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import { FRAMING, examShell, referenceClass, retestPair, examById } from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';
import { loadPairs, vintage, SEED_PAIRS, SET_NOTES } from './human-or-model-corpus.mjs';
import { dPrime2AFC, binomialTailP, calibration } from './signal-detection.mjs';

export { esc };

export const EXAM_ID = 'human-or-model';

/** Confidence floor. A two-alternative guess is already 50% right, so 50 is "no information". */
export const CONFIDENCE_MIN = 50;
export const CONFIDENCE_MAX = 100;

/** Below this many gradable trials there is no d′ worth printing, and the copy says so instead. */
export const MIN_TRIALS_FOR_DPRIME = 6;

export const LANDMARKS = Object.freeze([
  {
    text: 'In a pre-registered three-party Turing test with five-minute conversations, GPT-4.5 given a humanlike '
      + 'persona prompt was judged to be the human 73% of the time — significantly more often than the actual '
      + 'human it was competing against. LLaMa-3.1 with the same prompt: 56%. ELIZA: 23%. GPT-4o with no persona '
      + 'prompt: 21%, significantly BELOW chance. The prompt mattered more than the interrogator did.',
    source: 'Jones CR & Bergen BK (2026), Large language models pass a standard three-party Turing test, '
      + 'PNAS 123(21), 19 May 2026, doi:10.1073/pnas.2524472123 (preprint arXiv:2503.23674, 2025).',
  },
  {
    text: 'The apparatus half of the Voight-Kampff is a polygraph, and the polygraph does not do what the film '
      + 'needs it to do. The National Research Council reviewed 57 studies and found a median accuracy index of '
      + '0.86 (IQR 0.81–0.91) under laboratory conditions, while concluding that the physiological states '
      + 'polygraphy measures arise in the absence of deception too — which makes the technique "intrinsically '
      + 'susceptible to producing erroneous results", and specifically inadequate for screening. The machine was '
      + 'wrong. The interview turned out to be right.',
    source: 'National Research Council (2003), The Polygraph and Lie Detection, National Academies Press. '
      + 'https://nap.nationalacademies.org/read/10420',
  },
  {
    text: 'A Brier score of 0.25 is what a person scores by answering "50%" to every trial. That is the honest '
      + 'score of somebody who knows they cannot do this, and it beats a confident person who is wrong.',
    source: 'Brier GW (1950), Verification of forecasts expressed in terms of probability, Monthly Weather Review '
      + '78(1):1–3. Decomposition: Murphy AH (1973), J. Applied Meteorology 12(4):595–600.',
  },
]);

// ── trial construction ───────────────────────────────────────────────────────────────────────────

function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the trial list for one sitting.
 *
 * The returned trials carry NO provenance — `a` and `b` are just text — because the whole task is to
 * work out which is which. `answerKey()` recomputes the same assignment from the same seed on the way
 * back in, so nothing about the answer is ever sent to the browser before the sitting is scored.
 */
export function buildTrials({ seed = 'anon', pairs = null } = {}) {
  const loaded = pairs ? { pairs, kind: 'given', source: 'given', note: '' } : loadPairs();
  const rand = rng(seedFrom(String(seed)) ^ 0x7A5C11E5);
  const order = loaded.pairs.slice();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const trials = order.map((p, position) => {
    const modelOnA = rand() < 0.5;
    return {
      id: p.id,
      position,
      topic: p.topic,
      a: modelOnA ? p.model.text : p.human.text,
      b: modelOnA ? p.human.text : p.model.text,
    };
  });
  return {
    seed: String(seed),
    kind: loaded.kind,
    source: loaded.source,
    setNote: loaded.note || '',
    trials,
  };
}

/** Rebuild the seed→(which side is the model) mapping. Server-side only. */
export function answerKey({ seed = 'anon', pairs = null } = {}) {
  const built = buildTrials({ seed, pairs });
  const source = pairs || loadPairs().pairs;
  const byId = new Map(source.map((p) => [p.id, p]));
  const key = new Map();
  for (const t of built.trials) {
    const p = byId.get(t.id);
    if (!p) continue;
    key.set(t.id, { modelSide: t.a === p.model.text ? 'a' : 'b', pair: p });
  }
  return key;
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

const clampConfidence = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Math.round(n)));
};

/**
 * Grade a sitting.
 *
 * `responses` is [{ id, choice: 'a'|'b', confidence: 50..100, recognised: bool }]. Anything malformed
 * is DROPPED with the count reported, never coerced into a guess — a fabricated trial would be the
 * one kind of dishonesty this particular exam cannot afford.
 *
 * Recognised trials are scored SEPARATELY and excluded from the headline d′. A person who recognised
 * "Call me Ishmael" did not discriminate, they remembered, and averaging the two together would be
 * measuring library membership.
 */
export function scoreSitting({ seed = 'anon', responses = [], pairs = null, now = () => new Date() } = {}) {
  const key = answerKey({ seed, pairs });
  const rows = [];
  let dropped = 0;
  for (const r of Array.isArray(responses) ? responses : []) {
    const id = r && r.id != null ? String(r.id) : '';
    const entry = key.get(id);
    const choice = r && (r.choice === 'a' || r.choice === 'b') ? r.choice : null;
    const confidence = clampConfidence(r && r.confidence);
    if (!entry || !choice || confidence == null) { dropped += 1; continue; }
    if (rows.some((x) => x.id === id)) { dropped += 1; continue; } // one judgement per pair
    rows.push({
      id,
      topic: entry.pair.topic,
      choice,
      modelSide: entry.modelSide,
      correct: choice === entry.modelSide,
      confidence,
      recognised: r.recognised === true || String(r.recognised) === 'true',
    });
  }

  const graded = rows.filter((r) => !r.recognised);
  const recognised = rows.filter((r) => r.recognised);

  const build = (set) => {
    const correct = set.filter((r) => r.correct).length;
    const n = set.length;
    const d = dPrime2AFC({ correct, total: n });
    return {
      n,
      correct,
      pc: n ? correct / n : null,
      dPrime: d.dPrime,
      dPrimeCorrected: d.corrected,
      // One-sided exact binomial against a fair coin. Reported as "distinguishable from guessing or
      // not", never as a significance verdict about the person.
      pValue: n ? binomialTailP(correct, n, 0.5) : null,
      calibration: calibration(set.map((r) => ({ confidence: r.confidence, correct: r.correct }))),
    };
  };

  const main = build(graded);
  const rec = recognised.length ? build(recognised) : null;
  const vint = vintage(pairs || loadPairs().pairs, { now });

  return {
    exam: EXAM_ID,
    seed: String(seed),
    trialsAnswered: rows.length,
    dropped,
    enoughForDPrime: main.n >= MIN_TRIALS_FOR_DPRIME,
    graded: main,
    recognisedTrials: recognised.length,
    recognisedBlock: rec,
    perTrial: rows,
    vintage: vint,
    // The store's distribution reader wants a flat numeric object. Everything in here is a
    // measurement; there is no field that could be read as a rank, a tier or a category.
    score: {
      dPrime: Number.isFinite(main.dPrime) ? Math.round(main.dPrime * 1000) / 1000 : null,
      correct: main.correct,
      n: main.n,
      pc: Number.isFinite(main.pc) ? Math.round(main.pc * 1000) / 1000 : null,
      meanConfidence: main.calibration.ok ? Math.round(main.calibration.meanConfidence * 1000) / 1000 : null,
      overconfidence: main.calibration.ok ? Math.round(main.calibration.overconfidence * 1000) / 1000 : null,
      brier: main.calibration.ok ? Math.round(main.calibration.brier * 1000) / 1000 : null,
    },
  };
}

// ── the debrief, which is part of the instrument ─────────────────────────────────────────────────

/**
 * Per-trial provenance plus the two confounds. Rendered on the SAME SCREEN as the result, above any
 * link out — §D.2: "a deception exam that a person leaves without the debrief has simply lied to them",
 * and the same courtesy is owed by an exam that did not deceive.
 */
export function debrief(result, { pairs = null } = {}) {
  const source = pairs || loadPairs().pairs;
  const byId = new Map(source.map((p) => [p.id, p]));
  const lines = [
    'Every pair you saw was exactly one human-written passage and one model-written passage. There were no '
    + 'catch trials, nothing was withheld from you, and the sentence above the trials was true.',
  ];
  if (result && result.vintage && result.vintage.sentence) lines.push(result.vintage.sentence);
  const rows = ((result && result.perTrial) || []).map((t) => {
    const p = byId.get(t.id) || {};
    const h = p.human || {};
    const m = p.model || {};
    return {
      id: t.id,
      topic: t.topic || p.topic || '',
      correct: t.correct,
      confidence: t.confidence,
      recognised: t.recognised,
      humanSource: h.author ? `${h.author}, ${h.work || ''}${h.year ? ` (${h.year})` : ''}`.trim() : (h.source || 'a human writer'),
      modelSource: m.model ? `${m.model}, generated ${m.generatedAt || 'date not recorded'}` : 'a model',
      modelWasOn: t.modelSide,
    };
  });
  return { lines, rows };
}

// ── the result copy ──────────────────────────────────────────────────────────────────────────────

const pct = (x) => `${Math.round(Number(x) * 100)}%`;
const round2 = (x) => Math.round(Number(x) * 100) / 100;

export function resultCopy(result, { n = 0, priorScore = null, pairs = null } = {}) {
  const g = (result && result.graded) || {};
  if (!g.n) {
    return {
      headline: 'No trial was gradable, so there is nothing to score.',
      lines: ['Every response was missing a choice, a confidence rating, or a pair it belonged to. Nothing was measured and nothing is claimed.'],
      landmarks: [], bins: [], debrief: debrief(result || {}, { pairs }), retest: null, share: null,
    };
  }

  const cal = g.calibration || {};
  const lines = [];

  lines.push(`You picked the model correctly on ${g.correct} of ${g.n} pairs — ${pct(g.pc)}. A coin does 50%.`);

  if (Number.isFinite(g.pValue)) {
    lines.push(g.pValue <= 0.05
      ? `Under an exact binomial test against a fair coin, a score at least this good happens by chance about `
        + `${(g.pValue * 100).toFixed(1)}% of the time at ${g.n} trials, so your accuracy is distinguishable from guessing on this set.`
      : `Under an exact binomial test against a fair coin, a score at least this good happens by chance about `
        + `${(g.pValue * 100).toFixed(1)}% of the time at ${g.n} trials. At this number of trials that is not `
        + `distinguishable from guessing — which is a statement about how few trials ${g.n} is, as much as about you.`);
  }

  if (!result.enoughForDPrime) {
    lines.push(`Fewer than ${MIN_TRIALS_FOR_DPRIME} gradable trials is too few for a sensitivity estimate worth printing, `
      + 'so the number above is what you get and no d′ is quoted.');
  } else {
    lines.push(`Your sensitivity, d′, is ${round2(g.dPrime)}. That is √2 × z(${pct(g.pc)}) — the two-alternative `
      + 'forced-choice formula. d′ is reported instead of percent correct alone because percent correct confounds '
      + 'how well you can tell the two apart with how ready you are to call something a machine. 0 is no '
      + 'sensitivity at all; around 1 is a clear but unreliable signal; above 2 is strong separation.');
    if (g.dPrimeCorrected) {
      lines.push(`Your score hit the ${g.pc === 1 ? 'ceiling' : 'floor'}, and z(1) and z(0) are infinite, so the rate `
        + 'was moved by 0.5/(n+1) before taking d′ — the Macmillan & Creelman convention. '
        + (g.pc === 1
          ? 'The d′ above is therefore a lower bound on a perfect run, not an exact figure: with more trials a '
            + 'perfect run would score higher.'
          : 'The d′ above is therefore the magnitude the floor allows at this many trials, not an exact figure. '
            + 'A large negative d′ is not a worse version of a low one — getting every pair wrong means you '
            + 'discriminated them and then consistently picked the other way round.'));
    }
  }

  if (cal.ok) {
    const gap = cal.overconfidence;
    lines.push(`Your average stated confidence was ${pct(cal.meanConfidence)} and you were right ${pct(cal.accuracy)} `
      + `of the time — a gap of ${gap >= 0 ? '+' : ''}${Math.round(gap * 100)} points. `
      + (gap > 0.05
        ? 'That is overconfidence, and it is the near-universal finding on this task: people believe they can do this '
          + 'considerably better than they can. It is the calibration curve, not the accuracy, that shows it.'
        : gap < -0.05
          ? 'You were underconfident — you did better than you claimed. That is the rarer direction on this task.'
          : 'That is close to calibrated: your confidence tracked your accuracy. That is uncommon here.'));
    lines.push(`Your Brier score was ${round2(cal.brier)}. Lower is better, 0 is perfect, and 0.25 is what you get by `
      + 'saying "50%" to everything — the honest score of somebody who knows they cannot do this. A confident person '
      + 'who is wrong scores worse than that.');
  }

  if (result.recognisedTrials) {
    const rb = result.recognisedBlock || {};
    lines.push(`You marked ${result.recognisedTrials} ${result.recognisedTrials === 1 ? 'pair' : 'pairs'} as recognised, `
      + `and ${result.recognisedTrials === 1 ? 'it is' : 'they are'} scored separately and left out of the d′ above `
      + `(${rb.correct} of ${rb.n} correct there). Recognising a passage is remembering, not discriminating, and `
      + 'averaging the two together would measure what you have read rather than what you can hear.');
  }

  if (result.dropped) {
    lines.push(`${result.dropped} ${result.dropped === 1 ? 'response was' : 'responses were'} incomplete and dropped rather than guessed at.`);
  }

  lines.push(result.vintage && result.vintage.sentence ? result.vintage.sentence : '');

  lines.push('This is a skill against a moving target, not a trait. Absolute pitch is the same property of a listener '
    + 'in 2028 as it is today; "can tell a model from a person" is a property of you AND of the models, and the models '
    + 'change every few months. In the published three-party test the single biggest determinant of the verdict was '
    + 'the prompt given to the machine, not the skill of the interrogator. So this page will tell you your number '
    + 'plainly, and it will not tell you that you are one of the people who can tell — not out of modesty, but because '
    + 'there is no stable thing there to be categorical about.');

  lines.push(referenceClass(n));

  return {
    headline: result.enoughForDPrime
      ? `d′ ${round2(g.dPrime)} — ${g.correct} of ${g.n} pairs, at an average stated confidence of ${pct(cal.meanConfidence)}`
      : `${g.correct} of ${g.n} pairs correct`,
    lines: lines.filter(Boolean),
    landmarks: LANDMARKS.slice(),
    bins: (cal.bins || []).map((b) => ({
      label: `${b.lo}–${b.hi}%`,
      note: b.label,
      n: b.n,
      said: pct(b.meanConfidence),
      wasRight: pct(b.accuracy),
    })),
    calibrationNote: cal.ok
      ? 'The decomposition of the Brier score into reliability and resolution is exact only when your confidence is '
        + 'constant inside each band, which it never is, so treat the bands as a picture rather than an identity.'
      : '',
    debrief: debrief(result, { pairs }),
    retest: retestPair(priorScore, result.score ? result.score.dPrime : null, { unit: '' }),
    share: shareParams(result),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── sharing ──────────────────────────────────────────────────────────────────────────────────────
//
// OPERATOR REQUIREMENT, 2026-09-08: the result has to be shareable on social media.
//
// WHAT MAY GO IN A SHARE LINK: the numbers, the trial count, the stimulus set id and the stimulus
// generation date. That is all. NOT the participant key, not the participant id, not the state card,
// not the sitting timestamp, not the per-trial responses — a share URL is pasted into places that log
// it forever, and the whole identity model of this battery is that the institution never holds the
// mapping. `shareParams` is an allow-list, not a filter, so a future field cannot leak by being added.
//
// AND THE MOVING-TARGET LIMIT TRAVELS WITH IT. The share card and the share page both print the
// stimulus generation date, because a 2026 result pasted into a feed will still be there in 2028 and
// must not read as a 2028 claim.

const SET_ID_SAFE = /[^A-Za-z0-9._-]/g;

/** The allow-list. Nothing identifying can be in here because nothing identifying is named here. */
export function shareParams(result) {
  const g = (result && result.graded) || {};
  if (!g.n) return null;
  const cal = g.calibration || {};
  const v = (result && result.vintage) || {};
  return {
    d: Number.isFinite(g.dPrime) ? round2(g.dPrime) : null,
    k: g.correct,
    n: g.n,
    c: cal.ok ? Math.round(cal.meanConfidence * 100) : null,
    b: cal.ok ? round2(cal.brier) : null,
    v: v.newest || '',
  };
}

/** Read a share link's query back, clamped. Anything out of range becomes null, never a wrong number. */
export function parseShare(query = {}) {
  const q = query && typeof query === 'object' ? query : {};
  const numOrNull = (v, lo, hi) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= lo && x <= hi ? x : null;
  };
  const n = numOrNull(q.n, 1, 500);
  const k = n == null ? null : numOrNull(q.k, 0, n);
  return {
    d: numOrNull(q.d, -6, 6),
    k,
    n,
    c: numOrNull(q.c, 0, 100),
    b: numOrNull(q.b, 0, 1),
    v: String(q.v == null ? '' : q.v).replace(SET_ID_SAFE, '').slice(0, 32),
  };
}

export function shareQuery(params) {
  const p = params || {};
  const parts = [];
  for (const k of ['d', 'k', 'n', 'c', 'b', 'v']) {
    if (p[k] == null || p[k] === '') continue;
    parts.push(`${k}=${encodeURIComponent(String(p[k]))}`);
  }
  return parts.join('&');
}

const SHARE_HEADLINE = (p) => (p.d == null
  ? `${p.k} of ${p.n} pairs`
  : `d′ ${p.d} · ${p.k} of ${p.n}`);

const SHARE_DESCRIPTION = (p) => {
  const bits = [`Picked the model on ${p.k} of ${p.n} matched pairs`];
  if (p.d != null) bits.push(`d′ ${p.d}`);
  if (p.c != null) bits.push(`average stated confidence ${p.c}%`);
  if (p.b != null) bits.push(`Brier ${p.b} (0.25 is what you get by saying 50% to everything)`);
  const stamp = p.v ? ` Stimuli generated ${p.v} — this task gets harder every time the models change, so this number is against that vintage and no other.` : '';
  return `${bits.join(' · ')}.${stamp}`;
};

/**
 * The share card, as SVG.
 *
 * SVG is the house pattern for cards here (integrations/persona-card.mjs) and it renders correctly
 * when a person opens the link. HONEST LIMIT, stated rather than discovered later: several social
 * crawlers will not rasterise an SVG og:image, so on those platforms the preview falls back to the
 * title and description — which is why the numbers AND the vintage stamp are also in the og:description
 * and not only in the picture.
 */
export function shareCardSVG(params) {
  const p = parseShare(params || {});
  const line1 = p.d == null ? `${p.k} / ${p.n}` : `d′ ${p.d}`;
  const line2 = p.d == null ? 'pairs correct' : `${p.k} of ${p.n} pairs correct`;
  const conf = p.c == null ? '' : `said ${p.c}% sure`;
  const brier = p.b == null ? '' : `Brier ${p.b}`;
  const stamp = p.v ? `stimuli generated ${p.v}` : 'no stimulus date recorded';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(SHARE_HEADLINE(p))}">
<rect width="1200" height="630" fill="#12100c"/>
<rect x="0" y="0" width="1200" height="8" fill="#d4a13a"/>
<text x="72" y="118" font-family="Georgia,serif" font-size="34" fill="#d4a13a">Temple Exams · human or model</text>
<text x="72" y="248" font-family="Georgia,serif" font-size="128" fill="#f4f0e6">${esc(line1)}</text>
<text x="72" y="312" font-family="Georgia,serif" font-size="42" fill="#cfc7b6">${esc(line2)}</text>
<text x="72" y="386" font-family="Georgia,serif" font-size="34" fill="#cfc7b6">${esc([conf, brier].filter(Boolean).join('  ·  '))}</text>
<text x="72" y="470" font-family="Georgia,serif" font-size="27" fill="#9d9484">A forced-choice discrimination instrument. Not a diagnosis, not a clearance,</text>
<text x="72" y="508" font-family="Georgia,serif" font-size="27" fill="#9d9484">and it buys nothing here or anywhere.</text>
<text x="72" y="572" font-family="Georgia,serif" font-size="25" fill="#d4a13a">${esc(stamp)} · a score is against that vintage of model and no other</text>
</svg>`;
}

/**
 * The shareable result page. Canonical, crawlable, and carrying nothing about who took it.
 *
 * It shows the numbers and the moving-target limit, and it does not show a percentile — the honest
 * reporting rule holds on a share page exactly as it holds on the result screen.
 */
export function sharePageHTML(params, { baseUrl = '' } = {}) {
  const p = parseShare(params || {});
  if (p.n == null || p.k == null) {
    return examShell('A shared result', `<h1>Nothing to show</h1>
<p class=muted>That link does not carry a readable result. Nothing was looked up and nobody was identified —
share links from this exam contain a handful of numbers and no participant at all.</p>
<p><a href="/exams/human-or-model">Take it yourself</a></p>`);
  }
  const q = shareQuery(p);
  const canonical = `${baseUrl}/exams/human-or-model/result${q ? `?${q}` : ''}`;
  const image = `${baseUrl}/exams/human-or-model/card.svg${q ? `?${q}` : ''}`;
  const head = headTags({
    title: `Human or model — ${SHARE_HEADLINE(p)}`,
    description: SHARE_DESCRIPTION(p),
    canonical,
    siteName: 'Temple Exams',
    image,
    ogType: 'article',
    robots: 'index,follow,max-image-preview:large',
  });
  const body = `<h1>Human or model</h1>
<p class=muted>A shared result. It carries six numbers and nothing about the person who took it — no key,
no name, no account, no timestamp of the sitting.</p>

<div class=card>
  <p style="font-size:2.4rem;margin:.1em 0"><b>${esc(SHARE_HEADLINE(p))}</b></p>
  <p>Picked the model correctly on <b>${esc(String(p.k))}</b> of <b>${esc(String(p.n))}</b> matched pairs.
  ${p.c == null ? '' : `Average stated confidence <b>${esc(String(p.c))}%</b>.`}
  ${p.b == null ? '' : `Brier score <b>${esc(String(p.b))}</b> — 0.25 is what you score by saying "50%" to everything.`}</p>
  <p class=prov>${p.v ? `Stimuli generated ${esc(p.v)}.` : 'No stimulus generation date travelled with this link.'}
  This task gets harder every time the models change, so this number is against that vintage of model and no
  other, and it does not mean the same thing in two years.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">What this number is and is not</h2>
  <p>d′ is discrimination sensitivity: √2 × z(proportion correct), the two-alternative forced-choice formula.
  It is reported instead of percent correct alone because percent correct confounds how well you tell two
  things apart with how ready you are to call something a machine.</p>
  <p>It is not a diagnosis, not a clearance, and it buys nothing. It is also not an identity: this is a skill
  against a moving target rather than a stable trait, and the biggest determinant of whether a model passes
  for human in the published work was the prompt the machine was given, not the skill of the interrogator.</p>
</div>

<p><a href="/exams/human-or-model">Take it yourself</a> · <a href="/exams">the rest of the battery</a></p>`;
  return examShell(`Human or model — ${SHARE_HEADLINE(p)}`, body, { extraHead: head });
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

export function humanOrModelPageHTML() {
  const exam = examById(EXAM_ID) || {};
  const set = loadPairs();
  const setNote = set.note || SET_NOTES.seed;
  const body = `<h1>${esc(exam.name || 'Human or model')}</h1>
<p class=muted>${esc(exam.measures || '')}</p>

<div class=card>
  <h2 style="margin-top:0">The apparatus was wrong. The interview turned out to be right.</h2>
  <p>Philip K. Dick built the Voight-Kampff in <i>Do Androids Dream of Electric Sheep?</i> in 1968: a few
  provocative questions, a machine watching your breathing, your pulse, your blush and your pupils, and a
  verdict about what you are. The machine half is a polygraph, and the National Research Council's 2003
  review is blunt about what a polygraph can do — the states it measures arise without deception too.</p>
  <p>The conversational half has now been run properly, and it failed in the direction the film did not
  anticipate. In a pre-registered three-party Turing test, GPT-4.5 given a humanlike persona prompt was
  judged to be the human <b>73%</b> of the time — more often than the actual human. The same model with no
  persona prompt was picked out as a machine more often than chance. <b>The prompt mattered more than the
  interrogator did.</b></p>
  <p class=prov>Jones CR &amp; Bergen BK (2026), <i>Large language models pass a standard three-party Turing
  test</i>, PNAS 123(21), doi:10.1073/pnas.2524472123.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">What you are about to do, stated completely</h2>
  <p><b>Every pair below is exactly one passage written by a person and one passage written by a model.</b>
  Never two of one. Never a trick pair. They are matched for topic and for length. You pick the machine, you
  say how sure you are, and you tell us whether you recognised either passage.</p>
  <p>Nothing is hidden from you and nothing about this is a trap. When you are scored, you get the full
  provenance of every pair you saw, on the same screen, before there is anywhere to click away to.</p>
  <p class=prov>${esc(setNote)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Confidence, and why it starts at 50</h2>
  <p>With two passages and one answer, a coin is already right half the time — so 50% means "I have no idea"
  and 100% means "I would bet the house". The scoring cares more about whether your confidence tracks your
  accuracy than about the accuracy itself. That comparison is the finding: the usual result is that people
  believe they can do this considerably better than they can.</p>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b> — not because a test
  may never tell you something true and flattering, but because this particular measurement is a skill against
  a moving target rather than a trait. The models change every few months; your d′ is against one vintage of
  one stimulus set, and it is printed with that date attached.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Your key</h2>
  <p>Your browser made you a random key. We store a one-way hash of it, never the key. It is the only thing
  linking this sitting to your next one — <b>write it down</b>. Without it we cannot delete your entries later,
  because we will have no way to know which ones are yours.</p>
  <p><span class=key id=keyout>…</span></p>
  <p><label class=field>Already have one? <input type=text id=keyin size=32 autocomplete=off placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
     <button class=ghost type=button id=keyset>Use that key</button></p>
</div>

${stateCardHTML({ formId: 'statecard' })}

<div class=card id=runner>
  <h2 style="margin-top:0">The pairs</h2>
  <div id=trials>Loading…</div>
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
  var key=teKey(), seed='', trials=[], answers={};
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  fetch('/api/exams/human-or-model/trials').then(function(r){return r.json();}).then(function(d){
    seed=(d&&d.seed)||''; trials=(d&&d.trials)||[];
    var h='';
    for(var i=0;i<trials.length;i++){
      var t=trials[i];
      h+='<fieldset><legend>Pair '+(i+1)+' of '+trials.length+'</legend>'
        +'<p class=muted>'+esc(t.topic)+'</p>'
        +'<label class=opt><input type=radio name="c_'+esc(t.id)+'" value="a"> <span><b>A.</b> '+esc(t.a)+'</span></label>'
        +'<label class=opt><input type=radio name="c_'+esc(t.id)+'" value="b"> <span><b>B.</b> '+esc(t.b)+'</span></label>'
        +'<div class=vas><div class=rowlab>How sure are you? <output id="o_'+esc(t.id)+'">50%</output></div>'
        +'<input type=range min=50 max=100 value=50 step=1 name="f_'+esc(t.id)+'">'
        +'<div class=vasends><span>50% — a coin flip</span><span>100% — certain</span></div></div>'
        +'<label class=opt><input type=checkbox name="r_'+esc(t.id)+'"> <span>I recognised one or both of these passages</span></label>'
        +'</fieldset>';
    }
    $('trials').innerHTML=h||'<p>No pairs are available.</p>';
    $('trials').addEventListener('input',function(e){
      var el=e.target; if(!el||el.type!=='range') return;
      var o=document.getElementById('o_'+el.name.slice(2)); if(o) o.textContent=el.value+'%';
    });
    $('trials').addEventListener('change',function(){
      var done=0;
      for(var i=0;i<trials.length;i++){ if(document.querySelector('input[name="c_'+trials[i].id+'"]:checked')) done++; }
      $('progress').textContent=done+' of '+trials.length+' answered';
    });
  }).catch(function(){ $('trials').innerHTML='<p>Could not load the pairs.</p>'; });

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
    var responses=[];
    for(var i=0;i<trials.length;i++){
      var id=trials[i].id;
      var c=document.querySelector('input[name="c_'+id+'"]:checked');
      if(!c) continue;
      var f=document.querySelector('input[name="f_'+id+'"]');
      var r=document.querySelector('input[name="r_'+id+'"]');
      responses.push({id:id,choice:c.value,confidence:f?Number(f.value):50,recognised:!!(r&&r.checked)});
    }
    if(!responses.length){ $('progress').textContent='nothing answered yet.'; return; }
    $('progress').textContent='scoring…';
    fetch('/api/exams/human-or-model',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key,seed:seed,stateCard:readCard(),responses:responses})})
      .then(function(r){return r.json();}).then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; $('progress').textContent=''; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        if(d.copy.bins&&d.copy.bins.length){
          h+='<h3>Your calibration curve</h3><table><tr><th>You said</th><th>Pairs</th><th>You were right</th></tr>';
          h+=d.copy.bins.map(function(b){return '<tr><td>'+esc(b.label)+' <span class=muted>'+esc(b.note)+'</span></td><td>'+b.n+'</td><td>'+esc(b.wasRight)+'</td></tr>';}).join('');
          h+='</table>';
          if(d.copy.calibrationNote) h+='<p class=prov>'+esc(d.copy.calibrationNote)+'</p>';
        }
        // THE DEBRIEF GOES HERE — above the landmarks, above the share link, above anything clickable.
        // A person is entitled to know what they were just tested on before they are offered a way out.
        h+='<h3>What you were just shown</h3>';
        h+=d.copy.debrief.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        h+='<table><tr><th>Pair</th><th>Human half</th><th>Model half</th><th>You</th></tr>';
        h+=d.copy.debrief.rows.map(function(r){
          return '<tr><td>'+esc(r.topic)+'</td><td>'+esc(r.humanSource)+'</td><td>'+esc(r.modelSource)+'</td><td>'
            +(r.correct?'correct':'wrong')+' at '+r.confidence+'%'+(r.recognised?', recognised':'')+'</td></tr>';
        }).join('');
        h+='</table>';
        h+='<h3>Landmarks, not verdicts</h3>';
        h+=d.copy.landmarks.map(function(l){return '<p>'+esc(l.text)+'<br><span class=prov>'+esc(l.source)+'</span></p>';}).join('');
        if(d.copy.retest&&d.copy.retest.text) h+='<h3>The second sitting</h3><p>'+esc(d.copy.retest.text)+'</p>';
        if(d.shareUrl){
          h+='<h3>Share it</h3><p>This link carries six numbers and the stimulus date. It does not carry your key, '
            +'your sitting, or anything that could be traced back to you.</p>'
            +'<p><input type=text readonly value="'+esc(d.shareUrl)+'" style="width:100%" onclick="this.select()"></p>'
            +'<p><a href="'+esc(d.shareUrl)+'">open the shareable card</a></p>';
        }
        h+='<p class=prov>Sitting '+d.sessionNumber+'.</p>';
        box.innerHTML=h; box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      }).catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  };
})();`;

  return examShell(exam.name || 'Human or model', body, { extraJS: js });
}

export default {
  EXAM_ID, CONFIDENCE_MIN, CONFIDENCE_MAX, MIN_TRIALS_FOR_DPRIME, LANDMARKS, SEED_PAIRS,
  buildTrials, answerKey, scoreSitting, debrief, resultCopy,
  shareParams, parseShare, shareQuery, shareCardSVG, sharePageHTML, humanOrModelPageHTML, esc,
};
