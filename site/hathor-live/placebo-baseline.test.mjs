// placebo-baseline.test.mjs — offline, no network, no clock.
//
// The tests that matter here are not "does the function return a string". They are:
//   (1) the numbers are pinned, because a meta-analytic SMD that drifts is a fabricated citation;
//   (2) BOTH HALVES of Hróbjartsson & Gøtzsche are present, because quoting one half is the
//       characteristic failure of this topic in both directions;
//   (3) the module's own rendered prose passes claimsCheck() from the-line.mjs — this file is one
//       careless sentence from "placebo treats your condition", so the linter is pointed at it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, COMPONENTS, COMPONENT_IDS, COMPARATORS, COMPARATOR_IDS, comparatorFor,
  THREE_ARM, LANDMARKS, LANDMARK_IDS, OPEN_LABEL, NOCEBO, MECHANISM, CEILING,
  RESPONDER_TRAIT, PRACTICE_COMPARATORS, baselineNote, baselineHTML, coverage,
  PLACEBO_BASELINE_HTML, handler,
} from './placebo-baseline.mjs';
import { claimsCheck } from './the-line.mjs';
import { PRACTICE_IDS } from './practices.mjs';

// --- the numbers -------------------------------------------------------------

test('the three-arm decomposition is pinned to Krogsbøll 2009', () => {
  const byArm = Object.fromEntries(THREE_ARM.arms.map((a) => [a.arm, a]));
  assert.equal(byArm['no treatment'].smd, -0.24);
  assert.deepEqual(byArm['no treatment'].ci, [-0.36, -0.12]);
  assert.equal(byArm.placebo.smd, -0.44);
  assert.deepEqual(byArm.placebo.ci, [-0.61, -0.28]);
  assert.equal(byArm.active.smd, -1.01);
  assert.deepEqual(byArm.active.ci, [-1.16, -0.86]);
  assert.equal(THREE_ARM.contributionOfSpontaneousImprovement, 0.24);
  assert.equal(THREE_ARM.contributionOfPlacebo, 0.20);
});

test('the arms are ordered so that a reader meets the untreated arm first', () => {
  assert.equal(THREE_ARM.arms[0].arm, 'no treatment');
  // and the ordering is monotone, which is the finding
  const smds = THREE_ARM.arms.map((a) => a.smd);
  for (let i = 1; i < smds.length; i += 1) assert.ok(smds[i] < smds[i - 1], 'arms must be ordered smallest effect first');
});

test('both halves of the argument are stated, never one', () => {
  assert.equal(THREE_ARM.bothHalves.length, 2);
  assert.match(THREE_ARM.bothHalves[0], /Placebo is not nothing/);
  assert.match(THREE_ARM.bothHalves[1], /Nothing is not zero/);
});

// --- Hróbjartsson & Gøtzsche, reported whole ---------------------------------

test('H&G 2001 carries the null half AND the positive half', () => {
  const s = LANDMARKS.find((l) => l.id === 'hg-2001');
  assert.ok(s, 'the 2001 NEJM analysis must be present');
  assert.equal(s.doi, '10.1056/NEJM200105243442106');
  const all = s.findings.join(' ');
  // the null half
  assert.match(all, /no significant effect/i);
  assert.match(all, /0\.95/);
  assert.match(all, /Objective outcomes: not significant/);
  // the positive half
  assert.match(all, /−0\.28/);
  assert.match(all, /6\.5 mm on a 100-mm visual-analogue scale/);
});

test('H&G 2010 carries the authors’ conclusion verbatim, including the biased-reporting clause', () => {
  const s = LANDMARKS.find((l) => l.id === 'hg-2010');
  assert.equal(s.doi, '10.1002/14651858.CD003974.pub3');
  assert.match(s.conclusionVerbatim, /^We did not find that placebo interventions have important clinical effects in general\./);
  assert.match(s.conclusionVerbatim, /difficult to distinguish patient-reported effects of placebo from biased reporting\.$/);
  // and the heterogeneity that makes a single pain number misleading
  assert.match(s.findings.join(' '), /−0\.68/);
  assert.match(s.findings.join(' '), /−0\.13/);
});

test('every landmark states both halves where the study found in both directions', () => {
  for (const l of LANDMARKS) {
    assert.ok(l.doi && /^10\./.test(l.doi), `${l.id}: needs a DOI`);
    assert.ok(l.design && l.design.length > 30, `${l.id}: needs a stated design`);
    assert.ok(Array.isArray(l.findings) && l.findings.length >= 3, `${l.id}: needs findings`);
    assert.ok(l.bothHalves && l.bothHalves.length > 40, `${l.id}: must state what quoting half of it would get wrong`);
  }
  assert.equal(new Set(LANDMARK_IDS).size, LANDMARK_IDS.length);
});

test('the asthma trial keeps the objective and subjective rows together', () => {
  const w = LANDMARKS.find((l) => l.id === 'wechsler-2011');
  const all = w.findings.join(' ');
  assert.match(all, /albuterol \+20%/);
  assert.match(all, /21% for no intervention/);
  assert.match(w.design, /NO INTERVENTION/);
});

// --- the ceiling -------------------------------------------------------------

test('the boundary is stated and is not padding', () => {
  assert.match(CEILING.headline, /does not change tissue/);
  assert.ok(CEILING.doesNot.length >= 6);
  const all = CEILING.doesNot.join(' ');
  assert.match(all, /tumour/i);
  assert.match(all, /mortality/i);
  assert.match(all, /fracture/i);
  assert.match(all, /FEV/);
});

// --- open-label, reported with its caveat ------------------------------------

test('open-label placebo is reported with the effect size AND the reason to distrust it', () => {
  assert.match(OPEN_LABEL.claimItRefutes, /only works by deception/);
  assert.match(OPEN_LABEL.metaAnalysis.result, /0\.72/);
  assert.match(OPEN_LABEL.metaAnalysis.result, /I² = 76%/);
  assert.match(OPEN_LABEL.metaAnalysis.caveat, /cannot be blinded/);
  // a null must be in the trial list, or the section is a sales pitch
  const nulls = OPEN_LABEL.trials.filter((t) => /No significant|did not/i.test(t.result));
  assert.ok(nulls.length >= 1, 'the open-label section must include a null result');
  for (const t of OPEN_LABEL.trials) assert.ok(/^10\./.test(t.doi), `${t.id}: needs a DOI`);
});

// --- nocebo ------------------------------------------------------------------

test('SAMSON keeps its three arms and its no-tablet baseline', () => {
  assert.match(NOCEBO.samson.design, /NO TABLET/);
  assert.match(NOCEBO.samson.result, /8\.0/);
  assert.match(NOCEBO.samson.result, /15\.4/);
  assert.match(NOCEBO.samson.result, /16\.3/);
  assert.match(NOCEBO.samson.result, /0\.90/);
  assert.match(NOCEBO.samson.reading, /no-tablet/);
});

test('the informed-consent cost of full disclosure is named rather than skipped', () => {
  assert.match(NOCEBO.informedConsent.evidence.join(' '), /SIXFOLD/);
  assert.match(NOCEBO.informedConsent.ourPosition, /smaller than the cost of a person proceeding/);
});

// --- mechanism ---------------------------------------------------------------

test('mechanism entries are physiological measurements, each with a DOI', () => {
  const ids = MECHANISM.map((m) => m.id);
  assert.ok(ids.includes('levine-1978'));
  assert.ok(ids.includes('dlff-2001'));
  for (const m of MECHANISM) {
    assert.ok(/^10\./.test(m.doi), `${m.id}: needs a DOI`);
    assert.ok(m.whyItMatters && m.whyItMatters.length > 30, `${m.id}: needs the "why this is not self-report" line`);
  }
  // the dissociation is the interesting result and must not be lost
  assert.match(MECHANISM.find((m) => m.id === 'amanzio-1999').finding, /naloxone-INSENSITIVE/);
});

// --- the responder-trait verdict ---------------------------------------------

test('the responder-trait question is answered no, with the study that answered it', () => {
  assert.match(RESPONDER_TRAIT.verdict, /^No/);
  const w = RESPONDER_TRAIT.evidence.find((e) => /Whalley/.test(e.cite));
  assert.ok(w, 'the direct test must be cited');
  assert.equal(w.doi, '10.1016/j.jpsychores.2007.11.007');
  assert.match(w.finding, /NOT significantly correlated/);
  assert.match(w.authorsConclusion, /will not be consistent across contexts/);
  assert.match(RESPONDER_TRAIT.doNotBuild, /Do not build/);
});

// --- comparators and coverage ------------------------------------------------

test('every comparator states both what it licenses and what it withholds', () => {
  assert.equal(new Set(COMPARATOR_IDS).size, COMPARATOR_IDS.length);
  const ranks = COMPARATORS.map((c) => c.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a), 'comparators must be ordered strongest first');
  for (const c of COMPARATORS) {
    assert.ok(c.licenses && c.licenses.length > 20, `${c.id}: needs a licenses sentence`);
    assert.ok(c.withholds && c.withholds.length > 20, `${c.id}: needs a withholds sentence`);
    for (const r of c.removes) assert.ok(COMPONENT_IDS.includes(r), `${c.id}: unknown component ${r}`);
  }
  // the weakest designs must remove nothing — a design that removes a component is not `none`
  assert.deepEqual(comparatorFor('none').removes, []);
  assert.deepEqual(comparatorFor('within-subject').removes, []);
});

test('comparatorFor is soft — junk in, null out, never a throw', () => {
  assert.equal(comparatorFor('nope'), null);
  assert.equal(comparatorFor(null), null);
  assert.equal(comparatorFor(undefined), null);
  assert.equal(comparatorFor({}), null);
  assert.equal(comparatorFor('  PLACEBO  ').id, 'placebo');
});

test('every classified practice points at a real practice id and a real comparator', () => {
  for (const [id, e] of Object.entries(PRACTICE_COMPARATORS)) {
    assert.ok(PRACTICE_IDS.includes(id), `${id}: not a practice in practices.mjs`);
    assert.ok(COMPARATOR_IDS.includes(e.comparator), `${id}: unknown comparator ${e.comparator}`);
    assert.ok(e.why && e.why.length > 30, `${id}: the design must be quoted, not asserted`);
  }
});

test('coverage reports the backlog rather than hiding it', () => {
  const c = coverage(PRACTICE_IDS);
  assert.equal(c.total, PRACTICE_IDS.length);
  assert.equal(c.classified + c.missing.length, c.total);
  assert.deepEqual(c.stale, [], 'no classification may point at a practice that no longer exists');
  // and the honest gap is declared as `unstated`, not guessed
  assert.ok(Object.prototype.hasOwnProperty.call(c.byComparator, 'unstated'));
});

test('coverage is soft — junk in, empty report out', () => {
  assert.equal(coverage(null).total, 0);
  assert.equal(coverage('practices').total, 0);
  assert.deepEqual(coverage([1, 2, {}]).missing, []);
});

test('the whole catalogue is classified — every practice knows what it was compared against', () => {
  const c = coverage(PRACTICE_IDS);
  assert.deepEqual(c.missing, [], `unclassified practices: ${c.missing.join(', ')}`);
});

// --- the rendered note -------------------------------------------------------

test('baselineNote resolves a known practice to its design and its two sentences', () => {
  const n = baselineNote('mild');
  assert.equal(n.known, true);
  assert.equal(n.comparator, 'active-comparator');
  assert.match(n.withholds, /beat doing nothing/);
  assert.match(n.why, /five technique combinations/);
});

test('baselineNote is soft and honest about an unknown id', () => {
  for (const junk of ['not-a-practice', null, undefined, 42, {}]) {
    const n = baselineNote(junk);
    assert.equal(n.known, false);
    assert.equal(n.comparator, 'unstated');
    assert.match(n.why, /Not yet classified/);
  }
});

test('baselineHTML renders for a known practice and renders nothing for an unknown one', () => {
  const html = baselineHTML('imagery-distraction');
  assert.match(html, /Compared against/);
  assert.match(html, /Untreated or waiting-list control/);
  assert.equal(baselineHTML('not-a-practice'), '');
  assert.equal(baselineHTML(null), '');
});

test('esc escapes, and every interpolated value in the rendered note goes through it', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  const html = baselineHTML('lucid-nightmares') + PLACEBO_BASELINE_HTML();
  // ⭐ every < in the output must open a tag we wrote — no raw < from data
  const stray = html.replace(/<\/?[a-z][a-z0-9-]*(\s[^<>]*)?>/gi, '');
  assert.ok(!stray.includes('<'), 'unescaped < survived into the output');
});

test('the page renders the untreated row and the boundary section', () => {
  const html = PLACEBO_BASELINE_HTML();
  assert.match(html, /The placebo arm of a trial is not a no-treatment arm/);
  assert.match(html, /no treatment/);
  assert.match(html, /-0\.24/);
  assert.match(html, /Where it does not work/);
  // the boundary must come before the design table, not be appended at the end
  assert.ok(html.indexOf('Where it does not work') < html.indexOf('What a study design lets a result say'));
});

// --- ⭐ the module's own prose, linted against the intended-use line -----------

test('the rendered page makes no efficacy claim', () => {
  const r = claimsCheck(PLACEBO_BASELINE_HTML());
  assert.deepEqual(r.hits, [], `claimsCheck flagged: ${JSON.stringify(r.hits)}`);
  assert.equal(r.ok, true);
});

test('every practice note we would render passes claimsCheck', () => {
  for (const id of Object.keys(PRACTICE_COMPARATORS)) {
    const r = claimsCheck(baselineHTML(id));
    assert.deepEqual(r.hits, [], `${id}: claimsCheck flagged ${JSON.stringify(r.hits)}`);
  }
});

test('the module’s own data strings pass claimsCheck where they are our words', () => {
  // Our sentences, not quoted study titles or authors' conclusions.
  const ours = [
    CEILING.headline, CEILING.soWhat, ...CEILING.doesNot,
    RESPONDER_TRAIT.verdict, RESPONDER_TRAIT.doNotBuild,
    OPEN_LABEL.honestSummary, OPEN_LABEL.metaAnalysis.caveat,
    NOCEBO.informedConsent.ourPosition, NOCEBO.samson.reading,
    ...THREE_ARM.bothHalves,
    ...COMPARATORS.map((c) => `${c.licenses} ${c.withholds}`),
    ...COMPONENTS.map((c) => c.what),
  ].join('\n');
  const r = claimsCheck(ours);
  assert.deepEqual(r.hits, [], `claimsCheck flagged our own prose: ${JSON.stringify(r.hits)}`);
});

// --- handler -----------------------------------------------------------------

test('handler serves JSON and never throws', () => {
  let status = 0; let headers = null; let body = '';
  const res = {
    writeHead(s, h) { status = s; headers = h; },
    end(b) { body = b; },
  };
  handler({ url: '/api/placebo-baseline' }, res);
  assert.equal(status, 200);
  assert.match(headers['content-type'], /application\/json/);
  const j = JSON.parse(body);
  assert.equal(j.threeArm.arms.length, 3);
  assert.ok(j.landmarks.length >= 4);
  assert.ok(j.responderTrait.verdict.startsWith('No'));
  assert.ok(Object.keys(j.practices).length >= 15);
});

// --- immutability ------------------------------------------------------------

test('the citation data is frozen — a DOI must not be mutable at runtime', () => {
  assert.ok(Object.isFrozen(THREE_ARM));
  assert.ok(Object.isFrozen(LANDMARKS));
  assert.ok(Object.isFrozen(CEILING));
  assert.ok(Object.isFrozen(RESPONDER_TRAIT));
  assert.ok(Object.isFrozen(PRACTICE_COMPARATORS));
  for (const l of LANDMARKS) assert.ok(Object.isFrozen(l), `${l.id} not frozen`);
  for (const c of COMPARATORS) assert.ok(Object.isFrozen(c), `${c.id} not frozen`);
});

// --- ⭐ the wiring — dead code is not a deliverable -----------------------------
//
// The sibling failure this guards against is recorded in server.mjs: chamber.mjs was "written
// 2026-09-06, tested, and unreachable until now." A module that renders correctly and is imported by
// nothing has not shipped.

test('the 40Hz page actually renders the explainer and the per-practice notes', async () => {
  const { GAMMA_PAGE } = await import('./gamma.mjs');
  assert.match(GAMMA_PAGE, /id=placebo-baseline/);
  assert.match(GAMMA_PAGE, /The placebo arm of a trial is not a no-treatment arm/);
  // one note per classified practice, rendered inside the cards
  const notes = GAMMA_PAGE.match(/class="baseline-note"/g) || [];
  assert.equal(notes.length, Object.keys(PRACTICE_COMPARATORS).length);
  // and the strongest and weakest comparators both reach the page
  assert.match(GAMMA_PAGE, /Untreated or waiting-list control/);
  assert.match(GAMMA_PAGE, /No comparison group at all/);
});

test('the rendered 40Hz page still makes no efficacy claim after the insertion', async () => {
  const { GAMMA_PAGE } = await import('./gamma.mjs');
  const before = claimsCheck(PLACEBO_BASELINE_HTML());
  assert.deepEqual(before.hits, []);
  // the page as a whole is not clean — it is a page about entrainment research and quotes study
  // titles — so the assertion that matters is that WE did not add anything to its flag list.
  const ours = Object.keys(PRACTICE_COMPARATORS).map((id) => baselineHTML(id)).join('\n')
    + PLACEBO_BASELINE_HTML();
  assert.deepEqual(claimsCheck(ours).hits, []);
});
