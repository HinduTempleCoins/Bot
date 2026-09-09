import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAM_ID, MIN_TRIALS_FOR_DPRIME, LANDMARKS,
  buildTrials, answerKey, scoreSitting, debrief, resultCopy,
  shareParams, parseShare, shareQuery, shareCardSVG, sharePageHTML, humanOrModelPageHTML,
} from './exam-human-or-model.mjs';
import { SEED_PAIRS } from './human-or-model-corpus.mjs';
import { probit } from './signal-detection.mjs';
import { examById, MIN_N_FOR_RANK } from './exams.mjs';

const copyLines = (copy) => [copy.headline, ...copy.lines, ...copy.debrief.lines];

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} got ${a}, wanted ${b} ±${tol}`);

/** Answer every trial: `right` of them correctly, the rest wrong, all at the given confidence. */
function answerAll(seed, { right, confidence = 80, recognise = 0 } = {}) {
  const key = answerKey({ seed });
  const trials = buildTrials({ seed }).trials;
  const flip = (s) => (s === 'a' ? 'b' : 'a');
  return trials.map((t, i) => ({
    id: t.id,
    choice: i < right ? key.get(t.id).modelSide : flip(key.get(t.id).modelSide),
    confidence,
    recognised: i >= trials.length - recognise,
  }));
}

// ── trial construction ───────────────────────────────────────────────────────────────────────────

test('trials carry the two passages and NO hint of which is which', () => {
  const built = buildTrials({ seed: 'a-seed' });
  assert.equal(built.trials.length, SEED_PAIRS.length);
  const json = JSON.stringify(built.trials);
  assert.ok(!/author|Austen|Melville|Claude|generatedAt|modelSide|human/i.test(json),
    'the trial payload leaked provenance to the browser');
  for (const t of built.trials) {
    assert.ok(t.a && t.b && t.a !== t.b);
    assert.ok(t.topic);
  }
});

test('the same seed rebuilds the same trials and the same answer key; different seeds differ', () => {
  const a = buildTrials({ seed: 's1' });
  const b = buildTrials({ seed: 's1' });
  assert.deepEqual(a.trials, b.trials);
  const orders = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => buildTrials({ seed: s }).trials.map((t) => t.id).join(',')));
  assert.ok(orders.size > 1, 'pair order never varied between seeds');
  const sides = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => [...answerKey({ seed: s }).values()].map((v) => v.modelSide).join('')));
  assert.ok(sides.size > 1, 'which side holds the model never varied between seeds');
});

test('the model is not always on the same side within a sitting', () => {
  // A taker who noticed the model was always B would score 100% without reading anything.
  const seen = { a: 0, b: 0 };
  for (const s of ['q1', 'q2', 'q3', 'q4', 'q5']) {
    for (const v of answerKey({ seed: s }).values()) seen[v.modelSide] += 1;
  }
  assert.ok(seen.a > 0 && seen.b > 0);
  const share = seen.a / (seen.a + seen.b);
  assert.ok(share > 0.3 && share < 0.7, `the model sat on side A ${Math.round(share * 100)}% of the time`);
});

test('the answer key really points at the model-written passage', () => {
  const key = answerKey({ seed: 'k' });
  for (const t of buildTrials({ seed: 'k' }).trials) {
    const { modelSide, pair } = key.get(t.id);
    assert.equal(t[modelSide], pair.model.text);
    assert.equal(t[modelSide === 'a' ? 'b' : 'a'], pair.human.text);
  }
});

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

test("a perfect sitting is scored, corrected rather than infinite, and says so", () => {
  const r = scoreSitting({ seed: 'p', responses: answerAll('p', { right: SEED_PAIRS.length, confidence: 95 }) });
  assert.equal(r.graded.n, SEED_PAIRS.length);
  assert.equal(r.graded.correct, SEED_PAIRS.length);
  assert.equal(r.graded.pc, 1);
  assert.equal(r.graded.dPrimeCorrected, true);
  assert.ok(Number.isFinite(r.graded.dPrime));
  near(r.graded.dPrime, Math.SQRT2 * probit(10.5 / 11), 1e-9, "corrected d' on a 10/10");
  const copy = resultCopy(r, { n: 5 });
  assert.ok(copy.lines.some((l) => /lower bound on a perfect run/.test(l)));
  // And the floor is not described as a ceiling — a large negative d' is a reversed observer.
  const floor = resultCopy(scoreSitting({ seed: 'p', responses: answerAll('p', { right: 0 }) }), { n: 5 });
  assert.ok(floor.lines.some((l) => /consistently picked the other way round/.test(l)), floor.lines.join(' | '));
  assert.ok(!floor.lines.some((l) => /ceiling/.test(l)));
});

test('chance performance is d′ zero, and is reported as not distinguishable from guessing', () => {
  const r = scoreSitting({ seed: 'c', responses: answerAll('c', { right: 5, confidence: 85 }) });
  assert.equal(r.graded.correct, 5);
  assert.equal(r.graded.dPrime, 0);
  near(r.graded.pValue, 0.623046875, 1e-9, 'P(X ≥ 5 | n=10, p=.5)');
  const copy = resultCopy(r, { n: 5 });
  assert.ok(copy.lines.some((l) => /not\s+distinguishable from guessing/.test(l)), copy.lines.join(' | '));
});

test("a d' is computed from a hand-checked count", () => {
  // 8 of 10 → pc = 0.8, d' = √2 · z(0.8) = 1.41421356 × 0.84162123 = 1.19023.
  const r = scoreSitting({ seed: 'h', responses: answerAll('h', { right: 8, confidence: 70 }) });
  near(r.graded.pc, 0.8, 1e-12);
  near(r.graded.dPrime, 1.190232, 1e-5, "d' at 8/10");
  assert.equal(r.graded.dPrimeCorrected, false);
  // P(X ≥ 8 | 10, .5) = (45 + 10 + 1)/1024 = 56/1024.
  near(r.graded.pValue, 56 / 1024, 1e-12);
  assert.equal(r.score.dPrime, 1.19);
});

test('confidence is clamped into 50–100 and a missing choice is dropped, never guessed', () => {
  const key = answerKey({ seed: 'd' });
  const ids = buildTrials({ seed: 'd' }).trials.map((t) => t.id);
  const r = scoreSitting({
    seed: 'd',
    responses: [
      { id: ids[0], choice: key.get(ids[0]).modelSide, confidence: 5 },      // clamped up to 50
      { id: ids[1], choice: key.get(ids[1]).modelSide, confidence: 900 },    // clamped down to 100
      { id: ids[2], choice: 'z', confidence: 70 },                           // no valid choice
      { id: ids[3], confidence: 70 },                                        // no choice at all
      { id: ids[4], choice: 'a' },                                           // no confidence
      { id: 'not-a-pair', choice: 'a', confidence: 70 },                     // not in the set
      { id: ids[0], choice: 'a', confidence: 70 },                           // duplicate judgement
    ],
  });
  assert.equal(r.trialsAnswered, 2);
  assert.equal(r.dropped, 5);
  assert.deepEqual(r.perTrial.map((t) => t.confidence), [50, 100]);
  assert.equal(r.enoughForDPrime, false, `${MIN_TRIALS_FOR_DPRIME} gradable trials is the floor`);
  const copy = resultCopy(r, { n: 5 });
  assert.ok(copy.lines.some((l) => /too few for a sensitivity estimate/.test(l)));
  assert.ok(copy.lines.some((l) => /dropped rather than guessed at/.test(l)));
  assert.ok(!/d′ \d/.test(copy.headline), copy.headline);
});

test('nothing gradable produces no score at all rather than a zero', () => {
  const r = scoreSitting({ seed: 'e', responses: [] });
  assert.equal(r.graded.n, 0);
  assert.equal(r.graded.dPrime, null);
  assert.equal(r.score.dPrime, null);
  const copy = resultCopy(r, { n: 5 });
  assert.match(copy.headline, /nothing to score/);
  assert.equal(scoreSitting({ seed: 'e', responses: 'nope' }).graded.n, 0);
});

// ── recognition, the seed set's first confound ───────────────────────────────────────────────────

test('recognised pairs are scored separately and left out of the headline d′', () => {
  // 10 pairs: the first 7 answered correctly. The last 3 are marked recognised and are wrong.
  const r = scoreSitting({ seed: 'r', responses: answerAll('r', { right: 7, confidence: 80, recognise: 3 }) });
  assert.equal(r.recognisedTrials, 3);
  assert.equal(r.graded.n, 7, 'recognised trials must not be in the graded block');
  assert.equal(r.graded.correct, 7);
  assert.equal(r.recognisedBlock.n, 3);
  assert.equal(r.recognisedBlock.correct, 0);
  const copy = resultCopy(r, { n: 5 });
  const note = copy.lines.find((l) => /recognised/.test(l));
  assert.match(note, /0 of 3 correct/);
  assert.match(note, /remembering, not discriminating/);
});

// ── calibration, which is the contribution ───────────────────────────────────────────────────────

test('the overconfident pattern is named as overconfidence and the Brier baseline is stated', () => {
  const r = scoreSitting({ seed: 'o', responses: answerAll('o', { right: 5, confidence: 90 }) });
  near(r.score.meanConfidence, 0.9, 1e-9);
  near(r.score.overconfidence, 0.4, 1e-9);
  near(r.score.brier, 0.41, 1e-9);
  const copy = resultCopy(r, { n: 5 });
  const gap = copy.lines.find((l) => /average stated confidence/.test(l));
  assert.match(gap, /90% and you were right 50%/);
  assert.match(gap, /overconfidence/);
  assert.match(gap, /near-universal finding/);
  assert.ok(copy.lines.some((l) => /0\.25 is what you get by/.test(l)));
  assert.ok(copy.bins.length, 'the calibration curve must be returned for rendering');
  assert.equal(copy.bins[0].label, '90–100%');
  assert.equal(copy.bins[0].wasRight, '50%');
});

test('a calibrated taker is told they were calibrated, and an underconfident one is told that', () => {
  const cal = resultCopy(scoreSitting({ seed: 'c2', responses: answerAll('c2', { right: 5, confidence: 50 }) }), { n: 5 });
  assert.ok(cal.lines.some((l) => /close to calibrated/.test(l)), cal.lines.join(' | '));
  const under = resultCopy(scoreSitting({ seed: 'u', responses: answerAll('u', { right: 9, confidence: 55 }) }), { n: 5 });
  assert.ok(under.lines.some((l) => /underconfident/.test(l)), under.lines.join(' | '));
});

// ── the wording rules ────────────────────────────────────────────────────────────────────────────

test('no output hands the taker an identity', () => {
  for (const right of [0, 3, 5, 8, 10]) {
    const copy = resultCopy(scoreSitting({ seed: `w${right}`, responses: answerAll(`w${right}`, { right }) }), { n: 5 });
    const text = [copy.headline, ...copy.lines, ...copy.landmarks.map((l) => `${l.text} ${l.source}`),
      ...copy.debrief.lines].join(' ');
    assert.ok(!/replicant/i.test(text), `"replicant" appeared at ${right}/10`);
    assert.ok(!/human range|machine range|android/i.test(text));
    // Identity phrasings are checked LINE BY LINE, and a line is exempt only when it is the sentence
    // that refuses the identity. "it will not tell you that you are one of the people who can tell"
    // is the refusal; the same clause without the refusal would be the failure.
    for (const l of copyLines(copy)) {
      const claims = /you are (a|an|one of the) (human|machine|model|android|detector|people who can)\b/i.test(l)
        || /you (have|possess) (a|an|the) (gift|knack|ability|talent)/i.test(l);
      if (claims) assert.match(l, /will not tell you/, `an unrefused identity claim: ${l}`);
    }
    assert.ok(!/\bdiagnos/i.test(text));
  }
  assert.equal(resultCopy(scoreSitting({ seed: 'n', responses: answerAll('n', { right: 9 }) }), { n: 5 }).neverSay,
    'You scored in the replicant range.');
});

test('the fiction is the hook and not the frame — Dick is on the page, never in the verdict', () => {
  const html = humanOrModelPageHTML();
  assert.match(html, /Philip K. Dick/);
  assert.match(html, /1968/);
  // The page DOES print the phrase once — inside "this result will never be worded as ...", which is
  // the house pattern. It may appear nowhere else.
  assert.equal((html.match(/You scored in the replicant range/g) || []).length, 1);
  const at = html.indexOf('You scored in the replicant range');
  assert.match(html.slice(at - 120, at), /never be worded as/);
  const copy = resultCopy(scoreSitting({ seed: 'f', responses: answerAll('f', { right: 9 }) }), { n: 5 });
  assert.ok(!/Voight|Dick|Blade Runner|replicant/i.test([copy.headline, ...copy.lines].join(' ')));
});

test('the refusal of the category is justified EMPIRICALLY, not as a house rule', () => {
  // Operator correction 2026-09-08: the bar is truth, not modesty. This exam still refuses the
  // category, and the copy has to say why — because the target moves — rather than just hedging.
  const copy = resultCopy(scoreSitting({ seed: 'j', responses: answerAll('j', { right: 10 }) }), { n: 5 });
  const line = copy.lines.find((l) => /moving target/.test(l));
  assert.ok(line, copy.lines.join(' | '));
  assert.match(line, /Absolute pitch is the same property of a listener in 2028/);
  assert.match(line, /the prompt given to the machine, not the skill of the interrogator/);
  assert.match(line, /not out of modesty/);
});

test('the stimulus timestamp is on the result, because a 2026 score is not a 2028 score', () => {
  const copy = resultCopy(scoreSitting({ seed: 't', responses: answerAll('t', { right: 6 }) }), { n: 5 });
  const line = copy.lines.find((l) => /2026-09-08/.test(l));
  assert.ok(line, 'the generation date is not on the result screen');
  assert.match(line, /Claude Opus 5/);
  assert.match(line, /against that vintage of model and no other/);
});

test('no percentile below the house floor, and the self-selection caveat every time', () => {
  const low = resultCopy(scoreSitting({ seed: 'l', responses: answerAll('l', { right: 7 }) }), { n: 12 });
  assert.ok(low.lines.some((l) => /too few to place you among them/.test(l)));
  assert.ok(!low.lines.some((l) => /percentile|top \d|better than \d+%/i.test(l)));
  const high = resultCopy(scoreSitting({ seed: 'l', responses: answerAll('l', { right: 7 }) }), { n: MIN_N_FOR_RANK + 40 });
  assert.ok(high.lines.some((l) => /found this page and chose to take this test/.test(l)));
  assert.ok(high.lines.some((l) => /enriched for exactly the thing being measured/.test(l)));
});

test('the exam is registered as a perception exam and can never be payable', () => {
  const e = examById(EXAM_ID);
  assert.ok(e, 'the exam is not in the register');
  assert.equal(e.kind, 'perception');
  assert.equal(e.payable, undefined);
  assert.equal(e.reward, undefined);
  assert.equal(e.tier, undefined);
  assert.match(e.route, /^\/exams\/human-or-model$/);
  assert.ok(e.citations.some((c) => /10\.1073\/pnas\.2524472123/.test(c)), 'the PNAS DOI must be cited');
  assert.ok(e.citations.some((c) => /Polygraph/.test(c)));
});

// ── the debrief, §D.2 ────────────────────────────────────────────────────────────────────────────

test('the debrief carries per-trial provenance and ships with the result, not after it', () => {
  const r = scoreSitting({ seed: 'db', responses: answerAll('db', { right: 6, recognise: 1 }) });
  const copy = resultCopy(r, { n: 5 });
  assert.ok(copy.debrief.lines.length);
  assert.match(copy.debrief.lines[0], /exactly one human-written passage and one model-written passage/);
  assert.ok(copy.debrief.lines.some((l) => /2026-09-08/.test(l)), 'the vintage rides with the debrief too');
  assert.equal(copy.debrief.rows.length, r.perTrial.length);
  for (const row of copy.debrief.rows) {
    assert.match(row.humanSource, /\(\d{4}\)$/, `no year on ${row.id}`);
    assert.match(row.modelSource, /generated 2026-09-08/);
    assert.ok(row.modelWasOn === 'a' || row.modelWasOn === 'b');
    assert.equal(typeof row.correct, 'boolean');
  }
  // Rendered above anything clickable, which is the §D.2 requirement.
  const html = humanOrModelPageHTML();
  assert.ok(html.indexOf('What you were just shown') < html.indexOf('Share it'),
    'the debrief must render before the share link');
  assert.ok(html.indexOf('What you were just shown') < html.indexOf('Landmarks, not verdicts'));
});

test('the landmarks cite Jones & Bergen with the right numbers and the NRC polygraph review', () => {
  const jb = LANDMARKS.find((l) => /Jones/.test(l.source));
  assert.match(jb.text, /73%/);
  assert.match(jb.text, /56%/);
  assert.match(jb.text, /23%/);
  assert.match(jb.text, /21%/);
  assert.match(jb.text, /BELOW chance/);
  assert.match(jb.source, /PNAS 123\(21\)/);
  assert.match(jb.source, /10\.1073\/pnas\.2524472123/);
  assert.match(jb.source, /arXiv:2503\.23674/);
  const nrc = LANDMARKS.find((l) => /National Research Council/.test(l.source));
  assert.match(nrc.text, /0\.86/);
  assert.match(nrc.text, /0\.81–0\.91/);
  assert.match(nrc.text, /57 studies/);
  assert.match(nrc.text, /The machine was wrong. The interview turned out to be right./);
});

// ── sharing ──────────────────────────────────────────────────────────────────────────────────────

test('a share link carries six numbers and nothing that could identify anybody', () => {
  const r = scoreSitting({ seed: 'sh', responses: answerAll('sh', { right: 7, confidence: 85 }) });
  const p = shareParams(r);
  assert.deepEqual(Object.keys(p).sort(), ['b', 'c', 'd', 'k', 'n', 'v']);
  assert.equal(p.k, 7);
  assert.equal(p.n, 10);
  assert.equal(p.c, 85);
  assert.equal(p.v, '2026-09-08');
  const q = shareQuery(p);
  // The allow-list, asserted from the other side: nothing about the sitting or the person may appear.
  assert.ok(!/key|pid|seed|participant|state|time|at=/i.test(q), q);
  assert.ok(!/[A-Z0-9]{25}/.test(q), 'a participant key could never be in here');
  assert.equal(shareParams(scoreSitting({ seed: 'sh', responses: [] })), null);
});

test('a share link is clamped on the way back in, so a hand-edited URL cannot print a lie', () => {
  assert.deepEqual(parseShare({ d: '99', k: '50', n: '10', c: '900', b: '-3', v: '../../etc/passwd' }),
    { d: null, k: null, n: 10, c: null, b: null, v: '....etcpasswd' });
  assert.deepEqual(parseShare({}), { d: null, k: null, n: null, c: null, b: null, v: '' });
  assert.equal(parseShare({ n: '10', k: '11' }).k, null, 'more correct than trials is not a result');
});

test('the share card and share page carry the numbers AND the moving-target stamp', () => {
  const p = shareParams(scoreSitting({ seed: 'sc', responses: answerAll('sc', { right: 7, confidence: 85 }) }));
  const svg = shareCardSVG(p);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630"/);
  assert.match(svg, /7 of 10 pairs correct/);
  assert.match(svg, /said 85% sure/);
  assert.match(svg, /stimuli generated 2026-09-08/);
  assert.match(svg, /Not a diagnosis, not a clearance/);
  assert.ok(!/replicant/i.test(svg));

  const html = sharePageHTML(p, { baseUrl: 'https://hathor.live' });
  assert.match(html, /<meta property="og:image" content="https:\/\/hathor\.live\/exams\/human-or-model\/card\.svg\?/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/hathor\.live\/exams\/human-or-model\/result\?/);
  // The vintage has to be in the description, because several crawlers will not rasterise an SVG.
  assert.match(html, /<meta property="og:description" content="[^"]*Stimuli generated 2026-09-08/);
  assert.match(html, /<meta property="og:description" content="[^"]*Brier/);
  assert.ok(!/percentile|top \d+%/i.test(html));
  // And exactly one description tag, not the shell's plus its own.
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
});

test('a share link with no readable result says so instead of inventing one', () => {
  const html = sharePageHTML({ n: 'x' });
  assert.match(html, /does not carry a readable result/);
  assert.ok(!/d′/.test(html));
});

test('every interpolation in the card and the page is escaped', () => {
  const nasty = { d: '1', k: '5', n: '10', c: '80', b: '0.2', v: '<script>alert(1)</script>' };
  const svg = shareCardSVG(nasty);
  assert.ok(!/<script>/.test(svg), svg);
  const html = sharePageHTML(nasty, { baseUrl: 'https://x' });
  assert.ok(!/<script>alert/.test(html));
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

test('the page states the design completely before the taker starts', () => {
  const html = humanOrModelPageHTML();
  assert.match(html, /exactly one passage written by a person and one passage written by a model/);
  assert.match(html, /Never a trick pair/);
  assert.match(html, /matched for topic and for length/);
  assert.match(html, /50% means "I have no idea"/);
  assert.match(html, /the full\s+provenance of every pair you saw, on the same screen/);
});

test('the page says the seed set is a seed and does not pretend it is contemporary writing', () => {
  const html = humanOrModelPageHTML();
  assert.match(html, /built-in SEED set/);
  assert.match(html, /public-domain literary passages from 1813–1899/);
  assert.match(html, /not yet a measurement of telling a person writing today from a model writing today/);
});

test('the page never asks for a name, an email or an account, and carries the state card', () => {
  const html = humanOrModelPageHTML();
  assert.ok(!/type=email|name="email"|name="name"|password/i.test(html));
  assert.match(html, /Karolinska/);
  assert.match(html, /one-way hash of it, never the key/);
});
