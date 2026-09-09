// site/hathor-live/exam-suggestibility.mjs — the covariate the rest of the battery has been missing.
//
// ── WHY THIS EXISTS, AND IT IS NOT A NEW EXAM IDEA ───────────────────────────────────────────────
//
// Lush, P., Botan, V., Scott, R. B., Seth, A. K., Ward, J. & Dienes, Z. (2020), "Trait
// phenomenological control predicts experience of mirror synaesthesia and the rubber hand illusion",
// Nature Communications 11(1):4853, doi:10.1038/s41467-020-18591-6. Three samples, n = 156, 404, 353.
// Hypnotisability predicted experiential change on two standard laboratory measures at magnitudes
// comparable to its relationship with individual hypnosis-scale items. The authors' conclusion:
// "The control of phenomenology to meet expectancies arising from perceived task requirements can
// account for experiential change in psychological experiments."
//
// It is CONTESTED — two 2022 comments in the same journal, doi:10.1038/s41467-022-28177-z and
// doi:10.1038/s41467-022-28178-y. We cite the exchange, not just the claim.
//
// READ WHAT THAT MEANS FOR THIS BATTERY. Every exam here that ends by asking "did you feel it?" is
// measuring, in part, the taker's capacity to produce the experience the task implied they should
// have. A person high in that trait reports more of everything. That is not a reason to stop; it is
// a reason to MEASURE it and PRINT it beside the result, which is what this module is for.
//
// ── WHAT WE COULD NOT USE, AND WHY, BECAUSE THE REFUSALS ARE THE DESIGN ──────────────────────────
//
//   ⛔ HGSHS:A (Shor & Orne 1962) and SHSS:C (Weitzenhoffer & Hilgard 1962). Not a licence problem —
//      a PHYSICS problem. They require a live administered induction and BEHAVIOURAL SCORING BY AN
//      OBSERVER: did the arm actually rise, did the eyes actually stay closed. A web page cannot see
//      your arm. A self-reported "my arm felt heavy" is a different measurement with different
//      psychometrics wearing a famous name.
//   ⛔ The Tellegen Absorption Scale (Tellegen & Atkinson 1974, doi:10.1037/h0036681). Licensed
//      through the University of Minnesota Press as one of the eleven primary scales of the MPQ, and
//      the evidence is not an absent permission notice but an act of ENFORCEMENT: a long-running
//      academic scale library carries, where the TAS used to be, "I have removed the copy of the TAS
//      that was here at the request of the University of Minnesota Press."
//   ⛔ MODTAS. A rescaling of the same items. A derivative of a licensed instrument carries the
//      licence, and a paraphrase of a licensed item set is a derivative work.
//   ⛔ IPIP as the fallback. IPIP is genuinely public domain and is this project's standing escape
//      hatch — but its alphabetical index of 274 labels across 463 scales has NO Absorption entry.
//      There is no public-domain absorption instrument to fall back to.
//   ◐ SWASH (Lush, Moga, McLatchie & Dienes 2018, doi:10.1093/nc/niy006; corrigendum
//      doi:10.1093/nc/niab041) is open but CC BY-NC, and hathor.live sits inside a revenue-seeking
//      ecosystem. That is an operator licence decision, not an agent's. Its own retest is
//      r(66) = .56 objective / .77 subjective at ~2 months, which caps ANY instrument in this domain
//      at grade ② and forbids grade ① outright.
//
// So the items below are OURS. Written from scratch, for a construct we describe in our own words,
// with no item, no rescaling and no paraphrase taken from any of the above. They are not the TAS and
// they are not SWASH and this exam does not report hypnotisability, because it does not measure it.
//
// ── WHAT IT DOES MEASURE, STATED SO A READER CAN DISAGREE WITH US ────────────────────────────────
//
// A self-reported tendency to produce the experience a situation implies — expectancy uptake,
// voluntary phenomenal control, and responsiveness to a described sensation — plus a two-trial
// in-page probe of the same thing. Twelve self-report items and two probes is a SHORT index. Short
// indices are noisy. The result screen says so in those words.
//
// ── WHAT IT MAY NEVER BE WORDED AS ───────────────────────────────────────────────────────────────
//
//   "You are highly hypnotisable." "You are suggestible." "You are a high-absorption type."
//   The last is the MBTI error in a new costume: SWASH's own objective-scale r = .56 over two months
//   is the best-characterised number in this domain and it does not support a category.
//
// Pure and offline. No I/O. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import { FRAMING, examShell, referenceClass, retestPair, examById } from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';
import { CONSULT } from './the-line.mjs';

export { esc };

export const EXAM_ID = 'suggestibility';

/** The construct, in our own words, because it is ours and not a licensed one. */
export const CONSTRUCT = Object.freeze({
  name: 'expectancy uptake',
  short: 'how far you meet a task halfway',
  full: 'A self-reported tendency to produce the experience a situation implies you should be having — '
    + 'from a description, an instruction, an expectation, or from what everyone else in the room says '
    + 'they can feel. It is not a fault and it is not a weakness: the same disposition is what lets '
    + 'somebody be moved by a film, absorbed by a book, or helped by a treatment they believe in.',
  notHypnotisability: 'This is NOT a hypnotisability scale. Those are administered live, by a person, '
    + 'and scored on what your body does — whether your arm actually rose, whether your eyes actually '
    + 'stayed shut. A web page cannot see your arm. We did not build a self-report substitute and put a '
    + 'famous name on it, because that would be a different measurement wearing borrowed psychometrics.',
});

/**
 * Five points, 0–4, anchored on FREQUENCY rather than agreement.
 *
 * Frequency anchors because "how often does this happen to you" is answerable from memory, where
 * "how much do you agree that you are a suggestible person" asks for a self-concept and gets one.
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
 * Twelve items, ours, grouped into four facets of three.
 *
 * Facet design note: the facets are DESCRIPTIVE, not validated. We have not run a factor analysis
 * because we have no sample yet. They are reported as a shape and the page says they are not
 * established subscales, which is the difference between a description and a claim.
 */
export const FACETS = Object.freeze([
  { id: 'expectancy', label: 'Expectancy uptake', gloss: 'Being told what something will feel like, and then it feeling like that.' },
  { id: 'control', label: 'Voluntary phenomenal control', gloss: 'Being able to change how something seems, on purpose.' },
  { id: 'described', label: 'Response to a description', gloss: 'A sensation arriving because it was described.' },
  { id: 'social', label: 'Uptake from other people', gloss: 'The room reporting something, and then you having it.' },
]);

export const ITEMS = Object.freeze([
  { id: 'e1', facet: 'expectancy', text: 'Somebody tells me in advance what an experience is going to feel like, and then it feels like that.' },
  { id: 'e2', facet: 'expectancy', text: 'When I take something I expect to work, I notice it working before it could plausibly have taken effect.' },
  { id: 'e3', facet: 'expectancy', text: 'A test asks me whether I felt something, and I find that I did.' },
  { id: 'c1', facet: 'control', text: 'I can make an ordinary object in front of me look different — bigger, further away, unfamiliar — by deciding to see it that way.' },
  { id: 'c2', facet: 'control', text: 'If I imagine my hand is holding something heavy, my arm genuinely starts to feel the weight.' },
  { id: 'c3', facet: 'control', text: 'I can turn a physical sensation up or down by paying a certain kind of attention to it.' },
  { id: 'd1', facet: 'described', text: 'Reading a careful description of an itch makes me itchy.' },
  { id: 'd2', facet: 'described', text: 'A film or a book produces a bodily reaction in me — tensed shoulders, a jolt, tears — that I did not decide on.' },
  { id: 'd3', facet: 'described', text: 'Someone describes a taste or a smell in detail and I get a trace of it.' },
  { id: 's1', facet: 'social', text: 'Everyone in a room says they can smell or hear something, and then I can too.' },
  { id: 's2', facet: 'social', text: 'When someone tells me to relax, I relax — not as politeness, but actually.' },
  { id: 's3', facet: 'social', text: 'Watching someone else be in pain produces something like the sensation in the same place on me.' },
]);

export const ITEM_COUNT = ITEMS.length; // 12
export const MAX_SCORE = ITEM_COUNT * 4; // 48

/**
 * ⭐ The two probes, and this is the part that is not a questionnaire.
 *
 * One paragraph SUGGESTS a sensation; the other is matched for length, attention and the act of
 * reading, and suggests nothing. Both then ask for an intensity on the same slider. The measure is
 * the DIFFERENCE — suggested minus unsuggested — inside one person, which is the only comparison
 * that is meaningful here: an absolute "how warm is your hand" rating is not comparable across two
 * people and would be meaningless if we printed it.
 *
 * TWO TRIALS IS TWO TRIALS. This is not a psychophysical measurement and the result copy says so
 * before it says anything else. It is included because a purely self-report index of "do you produce
 * suggested experiences" has an obvious problem — it asks a person to suggest to themselves that
 * they are suggestible — and one direct probe is worth having even at n = 2.
 *
 * The order is randomised per sitting, because a fixed order confounds the difference with warm-up.
 */
export const PROBES = Object.freeze([
  {
    id: 'suggested',
    suggests: true,
    heading: 'Read this slowly, once.',
    text: 'Let your attention rest on your right hand where it is. Many people, reading a passage like this '
      + 'one, notice a faint warmth gathering across the back of the hand, or a slight heaviness in the '
      + 'fingers, that was not there before they were asked to look for it. Take a few seconds before you '
      + 'answer.',
    question: 'Right now, how much sensation is there in your right hand?',
  },
  {
    id: 'unsuggested',
    suggests: false,
    heading: 'Read this slowly, once.',
    text: 'The word "hand" comes from Old English and is common to the Germanic languages; the anatomical '
      + 'hand has twenty-seven bones, of which eight sit in the wrist, and the arrangement is shared with '
      + 'most other primates. Take a few seconds before you answer.',
    question: 'Right now, how much sensation is there in your left hand?',
  },
]);

/** The slider both probes use. 0–100, unlabelled in the middle, as a visual analogue scale. */
export const PROBE_SCALE = Object.freeze({ min: 0, max: 100, lowLabel: 'nothing at all', highLabel: 'a great deal' });

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
 * Item order is shuffled (they are independent items, unlike VVIQ's narrative scenes), and probe
 * order is shuffled independently so that "which came first" cannot masquerade as the difference.
 */
export function buildForm({ seed = 'anon' } = {}) {
  const rand = rng(seedFrom(String(seed)) ^ 0x7F4A7C15);
  return {
    items: shuffled(ITEMS, rand).map((it, position) => ({ id: it.id, text: it.text, position })),
    probes: shuffled(PROBES, rand).map((p, position) => ({
      id: p.id, heading: p.heading, text: p.text, question: p.question, position,
    })),
    scale: SCALE,
    probeScale: PROBE_SCALE,
  };
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Score a sitting.
 *
 * `answers` maps item id -> 0..4. `probes` maps probe id -> 0..100.
 * Anything out of range is dropped rather than clamped: a clamped junk value becomes a plausible
 * datum, and a dropped one is visibly missing. `answered` is reported so a partial sitting can never
 * be read as a full one.
 */
export function scoreForm(answers = {}, probes = {}) {
  const a = answers && typeof answers === 'object' ? answers : {};
  const p = probes && typeof probes === 'object' ? probes : {};

  const perItem = [];
  for (const item of ITEMS) {
    const v = Number(a[item.id]);
    if (!Number.isFinite(v) || v < 0 || v > 4 || v !== Math.round(v)) continue;
    perItem.push({ id: item.id, facet: item.facet, value: v });
  }
  const answered = perItem.length;
  const total = answered ? perItem.reduce((n, x) => n + x.value, 0) : null;

  const byFacet = {};
  for (const f of FACETS) {
    const rows = perItem.filter((x) => x.facet === f.id);
    byFacet[f.id] = rows.length === 3 ? rows.reduce((n, x) => n + x.value, 0) : null;
  }

  const probeVal = (id) => {
    const v = Number(p[id]);
    return Number.isFinite(v) && v >= PROBE_SCALE.min && v <= PROBE_SCALE.max ? v : null;
  };
  const suggested = probeVal('suggested');
  const unsuggested = probeVal('unsuggested');
  const probeDifference = (suggested == null || unsuggested == null) ? null : suggested - unsuggested;

  // The straight-lining OBSERVATION, same posture as the VVIQ's: reported, never used to discard.
  const identical = answered === ITEM_COUNT && new Set(perItem.map((x) => x.value)).size === 1;

  return {
    exam: EXAM_ID,
    answered,
    itemCount: ITEM_COUNT,
    complete: answered === ITEM_COUNT,
    score: { total, min: MIN_SCORE, max: MAX_SCORE, probeDifference },
    byFacet,
    perItem,
    probes: { suggested, unsuggested, difference: probeDifference, trials: 2 },
    allSameAnswer: identical,
  };
}

// ── the covariate, which is the whole point of the module ────────────────────────────────────────

/**
 * ⭐ covariateNote(...) — the sentence another exam prints beside its own result.
 *
 * This is R7. Nobody in consumer psychometrics does this, and it is straightforwardly the right
 * thing to do: it turns the battery's largest known confound into a disclosed covariate.
 *
 * The rules it obeys:
 *   • NO PERCENTILE BELOW n = 100. Under that it prints the raw score and the count, exactly as
 *     `referenceClass()` requires everywhere else.
 *   • It never says the other result is wrong, because it does not know that. It says what is
 *     shared between the two measurements.
 *   • With no index on file it says so and invites the sitting, rather than assuming a middle value.
 *
 * @param {object} o
 * @param {number|null} o.total     the taker's index total, or null if they have not sat it
 * @param {number} o.n              how many people have completed the index here
 * @param {number[]} [o.distribution] first-sitting totals, for the percentile when n allows it
 * @param {string} [o.examName]     the exam the note is being printed beside
 */
export function covariateNote({ total = null, n = 0, distribution = [], examName = 'this exam' } = {}) {
  const cited = 'Lush et al. (2020), Nature Communications 11(1):4853, doi:10.1038/s41467-020-18591-6 '
    + '(n = 156, 404, 353) — contested by two 2022 comments in the same journal, '
    + 'doi:10.1038/s41467-022-28177-z and doi:10.1038/s41467-022-28178-y.';
  const why = `People who score higher on expectancy uptake report more of everything on tests like `
    + `${examName} — tests whose datum is what you say you experienced. That is not a criticism of your `
    + 'answers and it does not make the result false. It is a shared cause worth knowing about, and it is '
    + 'printed here because it is usually left out.';

  // Number(null) is 0 and Number('') is 0, and "has not sat the index" is neither of those. The same
  // trap `retestPair()` documents in exams.mjs: treat not-given as not-a-number, or a person who has
  // never taken this gets shown a fabricated score of zero — the lowest possible value — as if it
  // were theirs.
  const t = (total == null || total === '') ? NaN : Number(total);
  if (!Number.isFinite(t)) {
    return {
      ok: false,
      hasIndex: false,
      headline: 'You have not sat the expectancy index.',
      lines: [
        why,
        'Sitting it takes about four minutes and it will be printed beside results like this one from '
        + 'then on. Without it, this result is missing the covariate that the literature says belongs '
        + 'next to it.',
      ],
      source: cited,
    };
  }

  const lines = [why];
  const count = Number(n) || 0;
  const dist = Array.isArray(distribution) ? distribution.filter((x) => Number.isFinite(Number(x))).map(Number) : [];
  let percentile = null;
  if (count >= 100 && dist.length >= 100) {
    const below = dist.filter((x) => x < t).length;
    const equal = dist.filter((x) => x === t).length;
    percentile = Math.round(((below + equal / 2) / dist.length) * 100);
  }
  if (percentile == null) {
    lines.push(`Your expectancy-uptake index was ${t} out of ${MAX_SCORE}. `
      + referenceClass(count));
  } else {
    lines.push(`Your expectancy-uptake index was ${t} out of ${MAX_SCORE}, around the ${percentile}th `
      + `percentile of the ${count} people who have taken it here. ` + referenceClass(count));
  }
  lines.push('Twelve items and two probes is a short index, and a short index is a noisy one. It is a '
    + 'caveat printed next to a number, not a finding about you.');

  return {
    ok: true,
    hasIndex: true,
    total: t,
    max: MAX_SCORE,
    percentile,
    headline: `Expectancy uptake: ${t} of ${MAX_SCORE}`,
    lines,
    source: cited,
  };
}

// ── result copy ──────────────────────────────────────────────────────────────────────────────────

export const LANDMARKS = Object.freeze([
  {
    text: 'Hypnotisability predicted experiential change on the rubber-hand illusion and on mirror '
      + 'synaesthesia at magnitudes comparable to its relationship with individual hypnosis-scale items, '
      + 'across three samples of 156, 404 and 353 people.',
    source: 'Lush, P. et al. (2020), Nature Communications 11(1):4853, doi:10.1038/s41467-020-18591-6. '
      + 'Contested: see the two 2022 comments in the same journal, doi:10.1038/s41467-022-28177-z and '
      + 'doi:10.1038/s41467-022-28178-y. We cite the exchange, not just the claim.',
  },
  {
    text: 'The best-characterised instrument in this domain reports a two-month test–retest of r(66) = .56 '
      + 'on its objective scale and r(66) = .77 on its subjective scale. A coefficient of .56 does not '
      + 'support a category, which is why no result here is a type.',
    source: 'Lush, P., Moga, G., McLatchie, N. & Dienes, Z. (2018), the Sussex-Waterloo Scale of '
      + 'Hypnotizability, Neuroscience of Consciousness 2018(1):niy006, doi:10.1093/nc/niy006; '
      + 'corrigendum 2021(1):niab041, doi:10.1093/nc/niab041. That instrument is CC BY-NC and is not '
      + 'used here.',
  },
  {
    text: 'Fifteen minutes of monotonous drumming produced subjective trance levels in the medium range '
      + 'of hypnotic susceptibility, and the people reporting "shamanic-type experiences" were the people '
      + 'who scored higher on the Harvard scale. That is not a drumming effect with a person in it. It is '
      + 'a suggestibility effect with a drum in it.',
    source: 'Maurer, R. L., Kumar, V. K., Woodside, L. & Pekala, R. J. (1997), American Journal of '
      + 'Clinical Hypnosis 40(2):130–145, doi:10.1080/00029157.1997.10403417, n = 206.',
  },
]);

export function resultCopy(result, { n = 0, priorScore = null } = {}) {
  const total = result && result.score ? result.score.total : null;
  if (total == null) {
    return { headline: 'Nothing was answered, so there is nothing to score.', lines: [], landmarks: [], retest: null };
  }
  const lines = [];
  if (!result.complete) {
    lines.push(`You answered ${result.answered} of ${result.itemCount} items, so this total is not on the `
      + `${MIN_SCORE}–${MAX_SCORE} scale and cannot be read against anything. It is kept as what it is: `
      + 'a partial sitting.');
  } else {
    lines.push(`Your expectancy-uptake index was ${total} out of ${MAX_SCORE}.`);
  }
  lines.push(CONSTRUCT.notHypnotisability);
  lines.push('Twelve items and two probes is short, and short indices are noisy. This number exists to be '
    + 'printed beside your other results as a caveat — it is not a finding about you and it is not a type '
    + 'you belong to.');

  const pr = result.probes || {};
  if (pr.difference == null) {
    lines.push('The two probes were not both answered, so there is no probe difference to report.');
  } else {
    const dir = pr.difference > 0 ? 'more' : (pr.difference < 0 ? 'less' : 'the same');
    lines.push(`On the two probes you reported ${Math.abs(pr.difference)} points ${dir === 'the same' ? '' : dir + ' '}`
      + `sensation after the passage that suggested one (${pr.suggested}) than after the passage that did not `
      + `(${pr.unsuggested}). Two trials is two trials: this difference is a single observation, not a `
      + 'measurement, and it is reported because one direct probe is worth having even at n = 2.');
    lines.push('Only the difference is reported. An absolute "how much sensation is in your hand" rating is '
      + 'not comparable between two people and printing one would be meaningless.');
  }
  if (result.allSameAnswer) {
    lines.push('You gave the same answer to every item. That is recorded as an observation and not as a '
      + 'verdict — some people genuinely answer that way — but if you were clicking through, a second '
      + 'unhurried sitting will be worth more than this one.');
  }
  lines.push('The facet totals below are a shape, not established subscales. We have not run a factor '
    + 'analysis on these items because we have no sample to run one on yet, and saying so is cheaper than '
    + 'implying otherwise.');
  lines.push(referenceClass(n));
  lines.push(CONSULT.notALab);

  return {
    headline: result.complete ? `Expectancy uptake ${total} of ${MAX_SCORE}` : `${result.answered} of ${result.itemCount} items answered`,
    lines,
    facets: FACETS.map((f) => ({ id: f.id, label: f.label, gloss: f.gloss, total: (result.byFacet || {})[f.id] })),
    landmarks: LANDMARKS,
    retest: retestPair(priorScore, total),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

export function suggestibilityPageHTML() {
  const exam = examById(EXAM_ID) || {};
  const body = `<h1>${esc(exam.name || 'Meeting the task halfway')}</h1>
<p class=muted>${esc(exam.measures || '')}</p>

<div class=card>
  <h2 style="margin-top:0">Why this one exists, and it is not really about you</h2>
  <p>Every exam in this battery that ends by asking <b>“did you feel it?”</b> is measuring, in part,
  something other than what it says on the tin: your capacity to produce the experience the task
  implied you should be having. Lush and colleagues showed in 2020 that hypnotisability predicts
  experiential change on two standard laboratory measures — the rubber-hand illusion and mirror
  synaesthesia — at magnitudes comparable to its relationship with individual hypnosis-scale items,
  across samples of 156, 404 and 353 people.</p>
  <p>So we measure it and print it next to those results. <b>That is the whole idea.</b> It makes the
  other numbers more honest rather than less, and as far as we can tell nobody else running tests like
  these does it.</p>
  <p class=prov>The finding is contested — see the two 2022 comments in the same journal. We cite the
  exchange rather than only the claim.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">What this is not, and the refusals are the design</h2>
  <ul class=limits>
    <li><b>It is not a hypnotisability scale.</b><span class=muted>${esc(CONSTRUCT.notHypnotisability)}</span></li>
    <li><b>It is not the Tellegen Absorption Scale, and it contains none of its items.</b><span class=muted>The
    TAS is licensed through the University of Minnesota Press, and the evidence is not a missing permission
    notice but an act of enforcement: a long-running academic scale library carries, where the TAS used to
    be, a line saying it was removed at the publisher’s request. The MODTAS is a rescaling of the same items
    and inherits the licence. A paraphrase of a licensed item set is a derivative work, so we did not write
    one.</span></li>
    <li><b>There was nothing in the public domain to fall back on.</b><span class=muted>The IPIP is genuinely
    public domain and is this project’s standing fallback for licensed instruments — and its index of 274
    labels across 463 scales has no Absorption entry at all. So these twelve items are ours, written from
    scratch for a construct we describe in our own words.</span></li>
    <li><b>It is short, and short means noisy.</b><span class=muted>Twelve items and two probes. The
    best-characterised instrument in this domain retests at r = .56 over two months on its objective scale.
    Nothing here is a category and nothing here is a type.</span></li>
  </ul>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b></p>
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
  <h2 style="margin-top:0">Twelve statements</h2>
  <p class=muted>How often is each of these true of you? There is no good answer and no bad one.</p>
  <div id=form></div>
  <h2>And two short passages</h2>
  <p class=muted>Read each one slowly, once, then answer the question under it. Only the difference
  between your two answers is used; neither number means anything on its own.</p>
  <div id=probes></div>
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
  var key=teKey(), answers={}, probes={};
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  // Item AND probe order come from the server, both shuffled, so "which came first" cannot
  // masquerade as the probe difference.
  fetch('/api/exams/suggestibility/form').then(function(r){return r.json();}).then(function(d){
    var f=(d&&d.form)||{}, items=f.items||[], ps=f.probes||[], scale=f.scale||[], psc=f.probeScale||{min:0,max:100};
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
      ph+='<fieldset><legend>'+esc(p.heading)+'</legend><p>'+esc(p.text)+'</p>'
        +'<div class=vas><p><b>'+esc(p.question)+'</b></p>'
        +'<input type=range min="'+psc.min+'" max="'+psc.max+'" value="'+Math.round((psc.min+psc.max)/2)+'" data-probe="'+esc(p.id)+'">'
        +'<div class=vasends><span>'+esc(psc.lowLabel||'')+'</span><span>'+esc(psc.highLabel||'')+'</span></div></div></fieldset>';
    }
    $('probes').innerHTML=ph;
    $('form').addEventListener('change',function(e){
      var el=e.target; if(!el||el.type!=='radio') return;
      answers[el.name]=Number(el.value);
      $('progress').textContent=Object.keys(answers).length+' of '+items.length+' answered';
    });
    $('probes').addEventListener('input',function(e){
      var el=e.target; if(!el||!el.getAttribute) return;
      var id=el.getAttribute('data-probe'); if(!id) return;
      probes[id]=Number(el.value);
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
    fetch('/api/exams/suggestibility',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key,stateCard:readCard(),answers:answers,probes:probes})})
      .then(function(r){return r.json();}).then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; $('progress').textContent=''; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        h+='<h3>The four facets — a shape, not subscales</h3><table><tr><th>facet</th><th>of 12</th></tr>';
        h+=(d.copy.facets||[]).map(function(f){return '<tr><td>'+esc(f.label)+'<br><span class=prov>'+esc(f.gloss)+'</span></td><td>'+(f.total==null?'—':f.total)+'</td></tr>';}).join('');
        h+='</table>';
        h+='<h3>Landmarks, not verdicts</h3>';
        h+=(d.copy.landmarks||[]).map(function(l){return '<p>'+esc(l.text)+'<br><span class=prov>'+esc(l.source)+'</span></p>';}).join('');
        if(d.copy.retest&&d.copy.retest.text) h+='<h3>The second sitting</h3><p>'+esc(d.copy.retest.text)+'</p>';
        h+='<p class=prov>Sitting '+d.sessionNumber+'.</p>';
        box.innerHTML=h; box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      }).catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  };
})();`;

  return examShell(exam.name || 'Meeting the task halfway', body, { extraJS: js });
}

/**
 * The covariate block, rendered. Any result page for an experiential self-report exam calls this.
 * Kept here rather than in each exam so the wording cannot drift between them.
 */
export function covariateHTML(note) {
  const nt = note && typeof note === 'object' ? note : covariateNote({});
  const lines = (nt.lines || []).map((l) => `<p>${esc(l)}</p>`).join('');
  const cta = nt.hasIndex ? '' : `<p><a href="/exams/suggestibility">Sit the expectancy index</a></p>`;
  return `<div class="card covariate">
  <h3 style="margin-top:0">${esc(nt.headline || '')}</h3>
  ${lines}${cta}
  <p class=prov>${esc(nt.source || '')}</p>
</div>`;
}

export default {
  EXAM_ID, CONSTRUCT, SCALE, ITEMS, ITEM_COUNT, FACETS, PROBES, PROBE_SCALE,
  MIN_SCORE, MAX_SCORE, LANDMARKS,
  buildForm, scoreForm, resultCopy, covariateNote, covariateHTML, suggestibilityPageHTML, esc,
};
