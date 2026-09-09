// site/hathor-live/exam-absorption.test.mjs — R8, absorption written from scratch.
//
// The tests that matter here are the REFUSALS and the ARITHMETIC:
//   • that no item, facet or construct string carries TAS or MODTAS lineage, and that the reason is
//     printed on the page rather than assumed;
//   • that the percentile does not exist below n = 100, and that the self-selection sentence is
//     attached whether or not a percentile appears;
//   • that the facets are called a shape and NOT established subscales — and that the page says the
//     established instrument has no settled structure either, which is what stops that from reading
//     as false modesty;
//   • that `null` is not `0` and not `undefined`, exercised with an explicit null;
//   • that this exam and the expectancy index say plainly how they differ, in both directions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAM_ID, CONSTRUCT, DIFFERENCE, SCALE, ITEMS, ITEM_COUNT, FACETS, PASSAGES, ESTIMATE_BOUNDS,
  MIN_SCORE, MAX_SCORE, LANDMARKS, FACET_HONESTY,
  buildForm, scoreForm, percentileOf, resultCopy, absorptionPageHTML, handler,
} from './exam-absorption.mjs';
import { examById, claimClassOf, CLAIM_CLASSES, MIN_N_FOR_RANK, experientialExams } from './exams.mjs';
import { claimsCheck, CONSULT } from './the-line.mjs';
import { CONSTRUCT as SUGG_CONSTRUCT, suggestibilityPageHTML } from './exam-suggestibility.mjs';

const fullAnswers = (v) => {
  const a = {};
  for (const it of ITEMS) a[it.id] = v;
  return a;
};

// ── shape ────────────────────────────────────────────────────────────────────────────────────────

test('fifteen items, five facets of three, and the scale runs 0–4', () => {
  assert.equal(ITEM_COUNT, 15);
  assert.equal(ITEMS.length, 15);
  assert.equal(MAX_SCORE, 60);
  assert.equal(MIN_SCORE, 0);
  assert.equal(SCALE.length, 5);
  assert.deepEqual(SCALE.map((s) => s.value), [0, 1, 2, 3, 4]);
  assert.equal(FACETS.length, 5);
  for (const f of FACETS) {
    assert.equal(ITEMS.filter((i) => i.facet === f.id).length, 3, `${f.id} should have three items`);
  }
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, 15, 'item ids must be unique');
  // Every item belongs to a declared facet — no orphans hiding in the total.
  const ids = new Set(FACETS.map((f) => f.id));
  for (const i of ITEMS) assert.ok(ids.has(i.facet), `${i.id}: unknown facet ${i.facet}`);
});

// ── the refusals ─────────────────────────────────────────────────────────────────────────────────

test('⛔ the licence refusal is stated, with its evidence, on the page', () => {
  const html = absorptionPageHTML();
  assert.match(html, /Tellegen Absorption Scale/);
  assert.match(html, /University of Minnesota Press/);
  assert.match(html, /MODTAS/);
  assert.match(html, /derivative work/);
  assert.match(html, /IPIP/);
  assert.match(html, /no Absorption entry at all/);
  // The evidence is an ACT OF ENFORCEMENT, not a missing permission notice. That distinction is the
  // whole reason we did not just use it.
  assert.match(html, /removed at the publisher’s request|act\s*\n?\s*of enforcement/i);
});

test('⛔ no item, facet or construct string claims to be the licensed instrument', () => {
  const surfaces = [
    CONSTRUCT.full,
    ...ITEMS.map((i) => i.text),
    ...FACETS.map((f) => `${f.label} ${f.gloss}`),
    ...PASSAGES.map((p) => p.text),
  ].join(' ').toLowerCase();
  // `notTheScale` is excluded on purpose: it is the sentence that names the instrument in order to
  // deny it, exactly as the sibling module excludes its own denial.
  assert.ok(!surfaces.includes('tellegen'));
  assert.ok(!surfaces.includes('modtas'));
  assert.ok(!surfaces.includes('tas '));
  assert.ok(!surfaces.includes('hypnotis'), 'this exam does not measure hypnotisability');
  assert.ok(!surfaces.includes('hypnotiz'));
  assert.match(CONSTRUCT.notTheScale, /NOT the Tellegen Absorption Scale/);
  assert.match(CONSTRUCT.notTheScale, /in whole, in part, or in paraphrase/);
});

test('⚠️ the 1974 definition is PARAPHRASED and labelled as one, not quoted', () => {
  // We could not obtain the primary PDF and secondary sources render the authors' definitional
  // sentence two different ways. An unverified quotation from the source paper of a licensed
  // instrument is the exact wrong thing to put in this file, so it is not there.
  const l = LANDMARKS.find((x) => /Tellegen/.test(x.source));
  assert.ok(l, 'the construct landmark must exist');
  assert.match(l.source, /our paraphrase/i);
  assert.match(l.source, /did NOT obtain the primary PDF/);
  assert.match(l.source, /Crossref-verified/);
});

test('⭐ the context dispute is reported from BOTH sides, not one', () => {
  const l = LANDMARKS.find((x) => /Council/.test(x.source));
  assert.ok(l, 'the context landmark must exist');
  // Council: the correlation appeared only in the hypnotic context (64 + 64).
  assert.match(l.text, /only when assessed\s+in the hypnotic context/);
  // Nadon: two much larger studies failed to replicate it and one reversed it.
  assert.match(l.text, /475/);
  assert.match(l.text, /434/);
  assert.match(l.text, /weak and variable/);
  assert.match(l.text, /REVERSED/);
  assert.match(l.text, /reaffirm the construct validity/);
  assert.match(l.source, /10\.1037\/0022-3514\.60\.1\.144/);
});

test('no single correlation number is printed, because no meta-analysis was found', () => {
  const prose = LANDMARKS.map((l) => `${l.text} ${l.source}`).join(' ');
  assert.match(prose, /no meta-analysis of the\s+absorption–hypnotisability relationship was found/);
  // The one r in the whole module belongs to somebody else's instrument and is labelled as the
  // ceiling, not as ours.
  const rs = prose.match(/r\(?\d*\)? ?= ?\.\d+/g) || [];
  assert.deepEqual(rs, ['r(66) = .56'], `unexpected correlation coefficients printed: ${rs.join(', ')}`);
});

test('unverifiable material is marked [UNVERIFIED] rather than dressed up', () => {
  const prose = LANDMARKS.map((l) => `${l.text} ${l.source}`).join(' ')
    + FACET_HONESTY.citations.join(' ');
  assert.ok(prose.includes('[UNVERIFIED'), 'at least one honest gap must be marked');
  // Jamieson 2005 has no resolvable DOI, so its NUMBERS are not quoted anywhere.
  const jam = FACET_HONESTY.citations.find((c) => /Jamieson/.test(c));
  assert.match(jam, /\[UNVERIFIED/);
  assert.match(jam, /NOT quoted here because we could not read it/);
});

// ── the facets, and why "a shape" is not modesty ─────────────────────────────────────────────────

test('⭐ the facets are a shape, NOT established subscales — both halves', () => {
  assert.match(FACET_HONESTY.ours, /No factor analysis has been run/);
  assert.match(FACET_HONESTY.ours, /not a finding about the construct/);
  // The half that stops it reading as a hedge: the established instrument has no settled structure
  // either, after fifty years on the same item set.
  assert.match(FACET_HONESTY.theirs, /has not produced one\s+agreed structure/);
  assert.match(FACET_HONESTY.theirs, /two subscales/);
  assert.ok(FACET_HONESTY.citations.length >= 3);

  const copy = resultCopy(scoreForm(fullAnswers(1), {}), { n: 0 });
  const prose = copy.lines.join(' ');
  assert.match(prose, /A SHAPE, NOT ESTABLISHED SUBSCALES/);
  assert.match(prose, /agreed structure/);
  assert.equal(copy.facets.length, 5);
  for (const f of copy.facets) assert.equal(f.total, 3);

  assert.match(absorptionPageHTML(), /a shape, not established subscales/i);
});

// ── the coordination with /exams/suggestibility ──────────────────────────────────────────────────

test('⭐ the two constructs say how they differ, in both directions', () => {
  assert.equal(DIFFERENCE.otherRoute, '/exams/suggestibility');
  assert.match(DIFFERENCE.short, /stimulus taking you/);
  assert.match(DIFFERENCE.short, /cue telling you/);
  assert.match(DIFFERENCE.full, /from a suggestion, or from the thing itself/);
  assert.match(DIFFERENCE.whyBothExist, /half a caveat/);
  // Our page links to theirs...
  assert.match(absorptionPageHTML(), /href="\/exams\/suggestibility"/);
  // ...and theirs links to ours, which is the half that is easy to forget.
  assert.match(suggestibilityPageHTML(), /href="\/exams\/absorption"/);
  // And the sibling's own denial is untouched: it still refuses the absorption label for ITSELF.
  assert.match(SUGG_CONSTRUCT.notHypnotisability, /NOT a hypnotisability scale/);
});

test('the difference is printed on the result screen, not only on the landing page', () => {
  const copy = resultCopy(scoreForm(fullAnswers(2), {}), { n: 5 });
  assert.equal(copy.difference, DIFFERENCE.full);
  assert.ok(copy.lines.some((l) => l === DIFFERENCE.full));
});

// ── the register ─────────────────────────────────────────────────────────────────────────────────

test('the exam is registered as claim class ② and IS an experiential self-report', () => {
  const e = examById(EXAM_ID);
  assert.ok(e, 'the exam must be in the EXAMS register');
  assert.equal(e.kind, 'perception');
  assert.equal(e.route, '/exams/absorption');
  assert.equal(e.claimClass, 'percentile');
  assert.equal(claimClassOf(e).mark, CLAIM_CLASSES.percentile.mark);
  assert.equal(e.neverSay, 'You are a high-absorption type.');
  // Unlike the expectancy index, printing the covariate beside THIS is a disclosure and not a
  // tautology, because the two measure different things.
  assert.equal(e.experientialSelfReport, true);
  assert.ok(experientialExams().map((x) => x.id).includes('absorption'));
  // Never payable, never ranked, never a tier.
  assert.equal(e.payable, undefined);
  assert.equal(e.reward, undefined);
  assert.ok(e.citations.length >= 6);
});

// ── administration ───────────────────────────────────────────────────────────────────────────────

test('items and passages shuffle, and the same seed gives the same order', () => {
  const a = buildForm({ seed: 'seed-one' });
  const b = buildForm({ seed: 'seed-one' });
  const c = buildForm({ seed: 'seed-two' });
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  assert.deepEqual(a.passages.map((p) => p.id), b.passages.map((p) => p.id));
  assert.equal(a.items.length, 15);
  assert.equal(a.passages.length, 2);
  assert.notDeepEqual(a.items.map((i) => i.id), c.items.map((i) => i.id));
  // Positions are contiguous, so the client cannot silently drop one.
  assert.deepEqual(a.items.map((i) => i.position), [...Array(15).keys()]);
  // No answer key or facet label leaks to the client — the facet grouping is ours, not theirs.
  for (const i of a.items) assert.equal(i.facet, undefined);
});

test('the two passages are matched in shape and only one of them is a continuous scene', () => {
  assert.equal(PASSAGES.length, 2);
  const [cont] = PASSAGES.filter((p) => p.engrossing);
  const [list] = PASSAGES.filter((p) => !p.engrossing);
  assert.ok(cont && list);
  // Matched for reading demand within a reasonable band; a length confound would be the difference.
  const ratio = cont.text.length / list.text.length;
  assert.ok(ratio > 0.8 && ratio < 1.25, `passage lengths differ too much: ratio ${ratio}`);
  // Neither passage tells the reader what to experience. That is the sibling exam's job, on purpose.
  for (const p of PASSAGES) {
    assert.ok(!/you will (feel|notice|find)/i.test(p.text));
    assert.equal(claimsCheck(p.text).ok, true, p.id);
  }
});

// ── scoring ──────────────────────────────────────────────────────────────────────────────────────

test('scoring is the plain sum, and the facet totals are hand-checkable', () => {
  const r = scoreForm(fullAnswers(3), {});
  assert.equal(r.score.total, 45);
  assert.equal(r.complete, true);
  assert.equal(r.answered, 15);
  for (const f of FACETS) assert.equal(r.byFacet[f.id], 9);
  assert.equal(r.allSameAnswer, true);
});

test('a maximum sitting is 60 and a floor sitting is 0, and neither is a category', () => {
  assert.equal(scoreForm(fullAnswers(4), {}).score.total, MAX_SCORE);
  assert.equal(scoreForm(fullAnswers(0), {}).score.total, MIN_SCORE);
  const top = resultCopy(scoreForm(fullAnswers(4), {}), { n: 3 });
  assert.ok(!/you are|high-absorption|a type/i.test(top.headline));
  assert.match(top.lines.join(' '), /not a type you belong to/);
});

test('junk answers are dropped, not clamped — a partial sitting is visibly partial', () => {
  const a = fullAnswers(2);
  a.n1 = 9; a.i1 = -1; a.g1 = 2.5; a.t1 = 'three'; a.u1 = null;
  const r = scoreForm(a, {});
  assert.equal(r.answered, 10);
  assert.equal(r.complete, false);
  assert.equal(r.score.total, 20);
  // A facet with a dropped item reports null rather than a smaller-looking total.
  assert.equal(r.byFacet.narrowing, null);
  assert.equal(r.byFacet.engrossment, null);
  const copy = resultCopy(r, { n: 0 });
  assert.match(copy.lines[0], /cannot be read against anything/);
});

test('nothing answered scores nothing, and says so rather than printing a zero', () => {
  const r = scoreForm({}, {});
  assert.equal(r.score.total, null);
  const copy = resultCopy(r, { n: 400, distribution: Array.from({ length: 400 }, (_, i) => i % 61) });
  assert.match(copy.headline, /nothing to score/i);
  assert.equal(copy.percentile, null, 'no percentile may be computed from no answers');
  assert.deepEqual(copy.lines, []);
});

// ── the reading probe ────────────────────────────────────────────────────────────────────────────

test('the ratio is estimate ÷ clock, and only the DIFFERENCE between passages is reported', () => {
  const r = scoreForm(fullAnswers(2), {
    continuous: { ms: 40000, estimateSeconds: 20 },
    list: { ms: 40000, estimateSeconds: 40 },
  });
  assert.equal(r.passages.continuous.actualSeconds, 40);
  assert.equal(r.passages.continuous.ratio, 0.5);
  assert.equal(r.passages.list.ratio, 1);
  assert.equal(r.passages.ratioDifference, -0.5);
  const copy = resultCopy(r, { n: 0 });
  const prose = copy.lines.join(' ');
  assert.match(prose, /Two passages is two passages/);
  assert.match(prose, /single\s+observation and not a measurement/);
  assert.match(prose, /Only the DIFFERENCE between the two is reported/);
});

test('an out-of-range, missing or absurd estimate gives no ratio rather than a wrong one', () => {
  const bad = scoreForm(fullAnswers(2), {
    continuous: { ms: 40000, estimateSeconds: 99999 },   // above the bound
    list: { ms: 0, estimateSeconds: 30 },                 // no clock reading
  });
  assert.equal(bad.passages.continuous.ratio, null);
  assert.equal(bad.passages.list.ratio, null);
  assert.equal(bad.passages.ratioDifference, null);
  const copy = resultCopy(bad, { n: 0 });
  assert.match(copy.lines.join(' '), /no time-estimation difference to report/);
  assert.ok(ESTIMATE_BOUNDS.minSeconds >= 1 && ESTIMATE_BOUNDS.maxSeconds <= 3600);
});

// ── ⚠️ the null trap, found five times in this repo in one session ───────────────────────────────

test('⚠️ null is not zero and not undefined — exercised with an EXPLICIT null', () => {
  // `= {}` as a destructuring default fires ONLY for `undefined`, so an explicit null sails past it.
  // Both scoreForm arguments are therefore guarded by a real type check, not by a default.
  assert.doesNotThrow(() => scoreForm(null, null));
  const r = scoreForm(null, null);
  assert.equal(r.score.total, null);
  assert.equal(r.answered, 0);
  assert.equal(r.passages.ratioDifference, null);

  // `Number(null) === 0`, and zero seconds is not a missing estimate — it is the most extreme value
  // on the scale. A missing estimate must read as missing.
  const miss = scoreForm(fullAnswers(2), {
    continuous: { ms: 40000, estimateSeconds: null },
    list: { ms: null, estimateSeconds: 30 },
  });
  assert.equal(miss.passages.continuous.estimateSeconds, null);
  assert.equal(miss.passages.continuous.ratio, null);
  assert.equal(miss.passages.list.actualSeconds, null);
  assert.equal(miss.passages.ratioDifference, null);

  // An explicitly null item answer is dropped, not read as a 0 response.
  const one = fullAnswers(2); one.n1 = null;
  assert.equal(scoreForm(one, {}).answered, 14);

  // And the same everywhere else a caller can pass null.
  assert.equal(percentileOf(null, [], 500), null);
  assert.equal(percentileOf(30, null, 500), null);
  assert.equal(percentileOf(30, [], null), null);
  assert.doesNotThrow(() => resultCopy(null, null));
  assert.doesNotThrow(() => resultCopy(scoreForm(fullAnswers(2), {}), null));
  assert.doesNotThrow(() => buildForm(null));
  assert.equal(buildForm(null).items.length, 15);
  // A null seed must not become the string "null" quietly — it falls back to the anon seed, which
  // is the same order buildForm() with no argument gives.
  assert.deepEqual(buildForm(null).items.map((i) => i.id), buildForm().items.map((i) => i.id));
  assert.deepEqual(buildForm({ seed: null }).items.map((i) => i.id), buildForm().items.map((i) => i.id));
  assert.match(resultCopy(null, null).headline, /nothing to score/i);
});

// ── the percentile, which mostly refuses to exist ────────────────────────────────────────────────

test('⭐ no percentile below n = 100, in either the count OR the distribution', () => {
  assert.equal(MIN_N_FOR_RANK, 100);
  const dist99 = Array.from({ length: 99 }, (_, i) => i % 61);
  const dist100 = Array.from({ length: 100 }, (_, i) => i % 61);
  // Count too small.
  assert.equal(percentileOf(30, dist100, 99), null);
  // Distribution too small, even with a large claimed count — the count is not taken on trust.
  assert.equal(percentileOf(30, dist99, 5000), null);
  // Both at the threshold: it appears.
  assert.ok(Number.isFinite(percentileOf(30, dist100, 100)));
});

test('⭐ the percentile is hand-checkable and the self-selection caveat is ALWAYS attached', () => {
  // 100 scores: 0..99. A score of 50 has 50 below it and one equal, so (50 + 0.5)/100 = 50.5 -> 51.
  const dist = Array.from({ length: 100 }, (_, i) => i);
  assert.equal(percentileOf(50, dist, 100), 51);

  const answers = fullAnswers(2); // total 30
  const withRank = resultCopy(scoreForm(answers, {}), { n: 100, distribution: dist });
  assert.equal(typeof withRank.percentile, 'number');
  assert.match(withRank.lines.join(' '), /percentile of the 100 people who have taken it here/);
  assert.match(withRank.lines.join(' '), /not a random sample of anybody/,
    'the self-selection sentence must appear WITH the percentile');

  const noRank = resultCopy(scoreForm(answers, {}), { n: 12, distribution: [] });
  assert.equal(noRank.percentile, null);
  assert.match(noRank.lines.join(' '), /too few to place you among them/);
  assert.match(noRank.lines.join(' '), /Your absorption index was 30 out of 60/);
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

test('the page carries consultBanner and CONSULT.notALab through examShell', () => {
  const html = absorptionPageHTML();
  assert.ok(html.includes(CONSULT.notALab.slice(0, 60)) || /not a laboratory result/i.test(html));
  assert.match(html, /Consult your doctor/);
  assert.match(html, /class="?consult/);
});

test('no participant key, sitting id or seed appears anywhere in the rendered body', () => {
  const html = absorptionPageHTML();
  const body = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.ok(!/[0-9A-HJ-NP-TV-Z]{25}/.test(body),
    'no 25-symbol key-shaped string may appear in the rendered body');
  assert.ok(!/seed=/.test(body));
});

test('the page states the n = 100 rule as a rule, not as a temporary state', () => {
  assert.match(absorptionPageHTML(), /No percentile below 100 takers/);
  assert.match(absorptionPageHTML(), /Claim class ②/);
});

test('handler serves the page with a 200 and an html content type', () => {
  let status = null; let headers = null; let body = '';
  handler({ url: '/exams/absorption' }, {
    writeHead(s, h) { status = s; headers = h; },
    end(b) { body = b; },
  });
  assert.equal(status, 200);
  assert.match(headers['content-type'], /text\/html/);
  assert.ok(body.length > 5000);
  assert.match(body, /Being taken/);
});

// ── the linter, run on our own prose ─────────────────────────────────────────────────────────────

test('claimsCheck over every authored string in this module, and what it flags is inspected', () => {
  const answers = fullAnswers(2);
  const copy = resultCopy(scoreForm(answers, {
    continuous: { ms: 40000, estimateSeconds: 30 },
    list: { ms: 40000, estimateSeconds: 45 },
  }), { n: 150, distribution: Array.from({ length: 150 }, (_, i) => i % 61) });
  const e = examById(EXAM_ID) || {};
  const prose = [
    CONSTRUCT.full, CONSTRUCT.notTheScale,
    DIFFERENCE.short, DIFFERENCE.full, DIFFERENCE.whyBothExist,
    FACET_HONESTY.ours, FACET_HONESTY.theirs,
    e.why, e.measures, e.neverSay,
    ...ITEMS.map((i) => i.text),
    ...FACETS.map((f) => `${f.label} ${f.gloss}`),
    ...PASSAGES.map((p) => `${p.text} ${p.question}`),
    ...LANDMARKS.map((l) => l.text),
    ...copy.lines,
  ];
  const flagged = [];
  for (const line of prose) {
    const c = claimsCheck(line);
    if (!c.ok) flagged.push({ line, hits: c.hits });
  }
  // ZERO, reported as a number so a future edit that introduces a claim pattern fails here rather
  // than passing quietly. Note what a clean result does NOT mean: it is the absence of the phrases
  // the matcher knows, not a clearance.
  assert.equal(flagged.length, 0, JSON.stringify(flagged, null, 2));
  assert.ok(prose.length >= 45, 'the sweep must actually cover the module');
});
