// site/hathor-live/practices.test.mjs — the no-hardware technique library.
//
// The point of these tests is the same as the point of the module: this subject attracts confident
// instruction with nothing behind it, so the grading and the citations are the product. A practice
// without a real citation, or graded better than its evidence, is the failure mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRACTICES, PRACTICE_FAMILIES, PRACTICE_IDS, byFamily, practiceGrade,
  REALITY_CHECKS, REALITY_CHECK_STATUSES, realityCheck, realityCheckStatus, folkloreChecks,
} from './practices.mjs';
import { GAMMA_PAGE } from './gamma.mjs';
import { claimsCheck } from './the-line.mjs';
import { baselineNote } from './placebo-baseline.mjs';
import { melanopicEDI } from '../../integrations/light-signal.mjs';

const GRADES = ['strong', 'moderate', 'promising', 'mixed', 'weak', 'traditional', 'not-supported'];

test('every practice is well formed and uses a known grade', () => {
  assert.ok(PRACTICES.length >= 8);
  const families = new Set(PRACTICE_FAMILIES.map((f) => f.id));
  for (const p of PRACTICES) {
    assert.ok(p.id && p.name, 'needs id + name');
    assert.ok(families.has(p.family), `${p.id}: unknown family ${p.family}`);
    assert.ok(GRADES.includes(p.grade), `${p.id}: bad grade ${p.grade}`);
    // minutes === 0 is meaningful: an adjunct or an evidence entry with no duration
    assert.ok(Number.isFinite(p.minutes) && p.minutes >= 0, `${p.id}: needs minutes`);
    assert.ok(p.summary && p.summary.length > 40, `${p.id}: needs a real summary`);
    assert.ok(Array.isArray(p.steps) && p.steps.length >= 3, `${p.id}: needs steps`);
    assert.ok(p.evidence && p.evidence.length > 60, `${p.id}: needs an evidence statement`);
  }
});

test('ids are unique', () => {
  assert.equal(new Set(PRACTICE_IDS).size, PRACTICE_IDS.length);
});

test('EVERY practice cites something real — no bare assertions', () => {
  for (const p of PRACTICES) {
    assert.ok(Array.isArray(p.citations) && p.citations.length >= 1, `${p.id}: no citation`);
    for (const c of p.citations) {
      assert.ok(c.label, `${p.id}: citation needs a label`);
      assert.match(c.url, /^https:\/\//, `${p.id}: citation needs an https url`);
    }
  }
});

test('counting sheep is graded WEAK and says what to do instead', () => {
  // The whole reason it is in the library: the folk technique is famous and the one study that
  // tested its shape found it did not work. Downgrading it quietly would defeat the purpose.
  assert.equal(practiceGrade('counting-sheep'), 'weak');
  const sheep = PRACTICES.find((p) => p.id === 'counting-sheep');
  assert.match(sheep.summary + sheep.steps.join(' '), /imagery/i,
    'it must point the reader at the technique that did work');
});

test('imagery distraction outranks counting sheep, which is the finding', () => {
  const order = (g) => GRADES.indexOf(g);
  assert.ok(order(practiceGrade('imagery-distraction')) < order(practiceGrade('counting-sheep')));
});

test('WILD is graded traditional — dramatic technique, thin controlled evidence', () => {
  assert.equal(practiceGrade('wild'), 'traditional');
});

test('MILD and SSILD carry the SAME grade, because the study found them comparable', () => {
  // ILDIS (N=355) found MILD and SSILD similarly effective. Ranking one above the other would be
  // inventing a result the study did not produce.
  assert.equal(practiceGrade('mild'), practiceGrade('ssild'));
});

test('the techniques that fragment sleep carry a caution', () => {
  for (const id of ['wbtb', 'wild']) {
    const p = PRACTICES.find((x) => x.id === id);
    assert.ok(p.caution && p.caution.length > 20, `${id} must carry a caution`);
  }
});

test('the B6 entry carries the neuropathy warning and the five-night limit', () => {
  // 240 mg pyridoxine is far above dietary intake, and chronic high-dose B6 causes peripheral
  // sensory neuropathy. The trial ran five nights. Shipping the dose without that is the harm.
  const b6 = PRACTICES.find((p) => p.id === 'b6-recall');
  assert.ok(b6, 'b6-recall must exist');
  assert.match(b6.caution, /neuropathy/i);
  assert.match(b6.caution + b6.steps.join(' '), /five|5 /i, 'must state the duration studied');
});

test('the B6 entry does NOT claim vividness — the trial found recall only', () => {
  const b6 = PRACTICES.find((p) => p.id === 'b6-recall');
  assert.match(b6.summary + b6.steps.join(' '), /did not|not.*vivid/i,
    'the negative half of the result must be stated, since vividness is what it is sold for');
});

test('applying current during sleep is not handed over as a recipe', () => {
  const t = PRACTICES.find((p) => p.id === 'gamma-tacs-rem');
  assert.ok(t, 'gamma-tacs-rem must exist');
  assert.equal(t.family, 'cueing');
  assert.match(t.caution, /do not improvise|not something we are handing/i);
  assert.match(t.steps.join(' '), /laboratory finding|not a home protocol/i);
});

test('the 40Hz tension is stated rather than resolved in our favour', () => {
  // Voss found frequency decisive; the 2026 chamber study found it did not matter. Both are on the
  // page. Quietly dropping the inconvenient one is the thing this whole library exists not to do.
  const t = PRACTICES.find((p) => p.id === 'gamma-tacs-rem');
  assert.match(t.note, /chamber/i);
  assert.match(t.note, /equivalent|not/i);
});

test('trauma-linked nightmares are routed to a clinician', () => {
  const n = PRACTICES.find((p) => p.id === 'lucid-nightmares');
  assert.match(n.caution, /clinician|PTSD/i);
});

test('meditation is graded on induction, and says the 8-week RCT was negative', () => {
  assert.equal(practiceGrade('meditation-lucid'), 'weak');
  const m = PRACTICES.find((p) => p.id === 'meditation-lucid');
  assert.match(m.evidence, /did not increase|not increase/i);
});

test('byFamily partitions the catalogue with nothing orphaned', () => {
  let n = 0;
  for (const f of PRACTICE_FAMILIES) {
    const items = byFamily(f.id);
    assert.ok(items.length >= 1, `${f.id} has no practices`);
    n += items.length;
  }
  assert.equal(n, PRACTICES.length, 'every practice belongs to exactly one listed family');
});

test('practiceGrade soft-fails on an unknown id', () => {
  assert.equal(practiceGrade('nope'), null);
  assert.equal(practiceGrade(''), null);
  assert.doesNotThrow(() => practiceGrade(undefined));
});

test('the /40hz page renders every practice, escaped, with its grade', () => {
  for (const p of PRACTICES) {
    assert.ok(GAMMA_PAGE.includes(p.name.replace(/&/g, '&amp;').replace(/—/g, '—')),
      `${p.id} missing from the page`);
  }
  assert.match(GAMMA_PAGE, /Practices — the half that needs no hardware/);
  assert.ok(!GAMMA_PAGE.includes('${'), 'no unresolved template expressions');
});

test('the page states plainly that none of this treats insomnia', () => {
  assert.match(GAMMA_PAGE, /(none of this is|not) a treatment for (chronic )?insomnia/i);
  // and it must say where to go instead, rather than only disclaiming
  assert.match(GAMMA_PAGE, /clinical matter/i);
});

// ── the verification layer, added 2026-09-09 ─────────────────────────────────────────────────────
// The corpus shipped an induction library with ZERO occurrences of "LaBerge" — the equivalent of a
// chemistry shelf with no mention of the balance. These tests exist so it cannot happen again.

test('the eye-signal paradigm is present and carries the DOI', () => {
  const p = PRACTICES.find((x) => x.id === 'lrlr-signalling');
  assert.ok(p, 'lrlr-signalling must exist — it is the foundation of everything else here');
  assert.equal(p.family, 'verified');
  assert.equal(p.grade, 'strong');
  assert.match(p.evidence, /La ?Berge/i);
  assert.ok(p.citations.some((c) => /10\.2466\/pms\.1981\.52\.3\.727/.test(c.url + c.label)));
  // Hearne's 1975 priority is part of the record, not a footnote to be dropped.
  assert.match(p.evidence, /Hearne/);
});

test('LRLR states what it does NOT establish', () => {
  const p = PRACTICES.find((x) => x.id === 'lrlr-signalling');
  assert.match(p.note, /does not adjudicate|not adjudicate/i,
    'the boundary of the claim is the whole point of the entry');
});

test('Konkoly reports the 60.8% no-response rate, not only the wins', () => {
  const p = PRACTICES.find((x) => x.id === 'two-way-dialogue');
  assert.ok(p, 'two-way-dialogue must exist');
  assert.match(p.evidence, /60\.8/, 'the unflattering number must be on the page');
  assert.match(p.evidence, /18\.4/);
  assert.match(p.evidence, /four laborator/i);
  assert.ok(p.citations.some((c) => /10\.1016\/j\.cub\.2021\.01\.026/.test(c.url + c.label)));
});

test('Konkoly is not allowed to become a seance claim', () => {
  const p = PRACTICES.find((x) => x.id === 'two-way-dialogue');
  assert.match(p.note, /interface, not a seance|not a seance/i);
});

// ── reality checks, graded one at a time ────────────────────────────────────────────────────────

test('REALITY_CHECKS is well formed and every check names its status', () => {
  assert.ok(REALITY_CHECKS.length >= 6);
  for (const c of REALITY_CHECKS) {
    assert.ok(c.id && c.name, 'needs id + name');
    assert.ok(REALITY_CHECK_STATUSES.includes(c.status), `${c.id}: bad status ${c.status}`);
    assert.ok(c.how && c.how.length > 30, `${c.id}: needs a how`);
    assert.ok(c.verdict && c.verdict.length > 80, `${c.id}: needs a real verdict`);
    assert.ok(Array.isArray(c.citations) && c.citations.length >= 1, `${c.id}: no citation`);
    for (const cit of c.citations) assert.match(cit.url, /^https:\/\//, `${c.id}: https citation`);
  }
  assert.equal(new Set(REALITY_CHECKS.map((c) => c.id)).size, REALITY_CHECKS.length, 'ids unique');
});

test('⭐ the light switch is CONTESTED — named paper, named refutation, no verdict in its favour', () => {
  // The operator suspected folklore. It is not folklore: Hearne 1981 is a real paper with n=8, and
  // Moss 1989 in the same journal found the opposite. Grading it either "works" or "folklore" would
  // both be false. Contested is the true answer and the test pins it.
  const c = realityCheck('light-switch');
  assert.ok(c, 'light-switch must be in the list');
  assert.equal(c.status, 'contested');
  assert.match(c.verdict, /Hearne/);
  assert.match(c.verdict, /Moss/);
  assert.match(c.verdict, /1981/);
  assert.match(c.verdict, /1989/);
  assert.match(c.verdict, /do not rely|not established/i);
});

test('the re-reading test says out loud that NightLight is not peer-reviewed', () => {
  const c = realityCheck('re-reading');
  assert.equal(c.status, 'tested');
  assert.match(c.verdict, /not peer-reviewed|NOT peer-reviewed/i,
    'the strongest evidence in the whole reality-check menu is a subscriber newsletter and the page must say so');
  assert.match(c.verdict, /46/, 'the sample size is part of the claim');
});

test('digital clocks are extrapolated, and admit no study isolated them', () => {
  const c = realityCheck('digital-clock');
  assert.equal(c.status, 'extrapolated');
  assert.match(c.verdict, /no study|No study/);
});

test('the folklore checks are labelled folklore rather than quietly omitted', () => {
  const ids = folkloreChecks().map((c) => c.id);
  assert.ok(ids.includes('nose-pinch'));
  assert.ok(ids.includes('count-fingers'));
  for (const c of folkloreChecks()) {
    assert.match(c.verdict, /[Nn]o study/, `${c.id}: a folklore grade must say there is no study`);
  }
});

test('reality-check lookups soft-fail', () => {
  assert.equal(realityCheck('nope'), null);
  assert.equal(realityCheckStatus('nope'), null);
  assert.doesNotThrow(() => realityCheckStatus(undefined));
});

test('the DILD entry now carries the Stumbrys verdict rather than softening it', () => {
  const p = PRACTICES.find((x) => x.id === 'dild-reality-testing');
  assert.match(p.evidence, /reliably and consistently/,
    'the 2012 review sentence still stands and the library does not get to soften it');
  assert.match(p.note, /ATTEMPTS|attempts/, 'the 46% figure must carry its qualifier');
});

// ── galantamine: the drug entry, and the label that comes with it ───────────────────────────────

test('galantamine states that the placebo arm was NOT inert', () => {
  const p = PRACTICES.find((x) => x.id === 'galantamine');
  assert.ok(p, 'galantamine must exist');
  assert.equal(p.grade, 'moderate', 'one unreplicated trial with a self-report endpoint is moderate');
  assert.match(p.steps.join(' '), /ON TOP of|on top of/,
    'the 42% is galantamine plus WBTB plus MILD, and reporting it as standalone is the common lie');
  assert.match(p.evidence, /not been independently replicated|not.*replicated/i);
});

test('galantamine carries the real label cautions, not a vague one', () => {
  const p = PRACTICES.find((x) => x.id === 'galantamine');
  for (const re of [/bradycardia/i, /asthma/i, /seizure/i, /succinylcholine/i]) {
    assert.match(p.caution, re, `caution must cover ${re}`);
  }
  // interactions are described here and cross-referenced, not silently duplicated into another module
  assert.match(p.note, /anticholinergic/i);
  assert.match(p.note, /paroxetine/i);
  assert.match(p.note, /interactions\.mjs/);
});

// ── sleep paralysis: taught, not warned about ───────────────────────────────────────────────────

test('sleep paralysis is taught with prevalence and with how it ends', () => {
  const p = PRACTICES.find((x) => x.id === 'sleep-paralysis');
  assert.ok(p, 'sleep-paralysis must exist — WILD is on this page and this is what WILD delivers');
  assert.match(p.evidence, /7\.6/, 'the general-population prevalence is the number that calms people');
  assert.match(p.evidence, /36,533|36533/);
  assert.match(p.steps.join(' '), /ends on its own|end.*on its own/i);
  assert.match(p.steps.join(' '), /diaphragm|breathing is automatic/i,
    'the single most reassuring physiological fact must be stated');
  assert.match(p.caution, /clinician/i);
});

test('WILD points the reader at the sleep-paralysis entry BEFORE the attempt', () => {
  const w = PRACTICES.find((x) => x.id === 'wild');
  assert.match(w.caution, /sleep-paralysis entry|before your first attempt/i);
});

// ── R4: light, graded ────────────────────────────────────────────────────────────────────────────
//
// The shelf where the grading matters most, because this is the domain in which a project of this
// shape has already been prosecuted once. Six entries, six grades, and the NOT-SUPPORTED row sits in
// the same list as the strong ones rather than in a footnote.

test('the light family exists, carries the colour disclaimer context, and has six graded entries', () => {
  const fam = PRACTICE_FAMILIES.find((f) => f.id === 'light');
  assert.ok(fam, 'the light family must exist');
  assert.equal(fam.disclaimerContext, 'colour',
    'this family sits under the Ghadiali doctrine and must print the colour wording');
  assert.equal(byFamily('light').length, 6);
});

test('each light entry carries its OWN grade, and the six are not all the same', () => {
  const grades = {
    'iprgc-circadian': 'strong',
    'bright-light-sad': 'strong',
    'light-preventing-sad': 'weak',
    'blue-enriched-alertness': 'moderate',
    'transcranial-pbm': 'mixed',
    'colour-matched-to-organ': 'not-supported',
  };
  for (const [id, g] of Object.entries(grades)) {
    assert.equal(practiceGrade(id), g, `${id} should be graded ${g}`);
  }
  assert.equal(new Set(Object.values(grades)).size, 5, 'five distinct grades across six entries');
});

test('⭐ the SAD entry prints the NULL half, not only the 0.84', () => {
  const p = PRACTICES.find((x) => x.id === 'bright-light-sad');
  // The positive half.
  assert.match(p.evidence, /0\.84/, 'Golden 2005 bright light in SAD');
  assert.match(p.evidence, /−0\.37|-0\.37/, 'Pjrek 2020 SMD — the smaller, newer estimate');
  assert.match(p.evidence, /1\.42/, 'Pjrek response risk ratio');
  // The null half, each row named. Dropping any of these is the failure this test exists to catch.
  assert.match(p.evidence, /−0\.01|-0\.01/, 'the adjunct row in non-seasonal depression');
  assert.match(p.evidence, /no differences among the 3 groups/, 'Eastman’s own sentence, verbatim');
  assert.match(p.evidence, /neither main effects of treatment nor interactions/, 'Flory 2010, verbatim');
  assert.match(p.evidence, /no significant group × time effect/i, 'the 2024 JAMA Psychiatry null');
  assert.match(p.evidence, /NO Cochrane review/, 'the structural absence must be stated');
  // And the honest reading of the disagreement.
  assert.match(p.note, /factor of two/, 'the magnitude dispute is the headline, not a footnote');
});

test('⭐ morning-versus-evening is reported as criterion-dependent, not as folklore', () => {
  const p = PRACTICES.find((x) => x.id === 'bright-light-sad');
  assert.match(p.note, /WITH NO OTHER GROUP DIFFERENCES/,
    'Terman’s own abstract sentence must be quoted, because it is the inconvenient half');
  assert.match(p.note, /[Ss]tringent remission criteria/);
  assert.match(p.note, /CRITERION-DEPENDENT/);
});

test('⭐ the dose is given in melanopic terms as well as lux, and the device spread is stated', () => {
  const p = PRACTICES.find((x) => x.id === 'bright-light-sad');
  const prose = p.steps.join(' ');
  assert.match(prose, /10,000 lux/);
  assert.match(prose, /2,500 lux/);
  // Oldham et al. measured 24 commercial devices. Two boxes both labelled "10,000 lux" differ by
  // more than a factor of two in the quantity the receptor answers to. That is the whole reason a
  // colour name is not a dose.
  assert.match(prose, /0\.52/);
  assert.match(prose, /1\.11/);
  assert.match(prose, /factor of two/);
  assert.match(prose, /SEVEN of the 24/);
});

test('preventing SAD is graded weak and says why weak is not the same as not-supported', () => {
  const p = PRACTICES.find((x) => x.id === 'light-preventing-sad');
  assert.equal(p.grade, 'weak');
  assert.match(p.summary + p.evidence, /46 people/);
  assert.match(p.evidence, /3745 citations/);
  assert.match(p.evidence, /very low-quality evidence/i);
  assert.match(p.note, /not-supported means the claim has been examined/);
});

test('⛔ the chromotherapy claims are graded NOT SUPPORTED, in the same list as the strong ones', () => {
  const p = PRACTICES.find((x) => x.id === 'colour-matched-to-organ');
  assert.equal(p.grade, 'not-supported');
  assert.equal(p.family, 'light', 'it must sit in the same family, not in a footnote');
  assert.match(p.evidence, /165 F\.2d 957/);
  assert.match(p.evidence, /twelve counts/);
  // And the near-miss is stated fairly rather than triumphantly.
  assert.match(p.steps.join(' '), /real variable and the wrong reason/);
  // The symbolic system is NOT gated. It is a claim about tissue that is refused, not a body of
  // knowledge. This assertion exists so a future edit cannot quietly turn a claims grade into a
  // scope guard.
  assert.match(p.steps.join(' '), /symbolic correspondence system/i);
  assert.match(p.steps.join(' '), /in scope in full/i);
});

test('the photobiomodulation entry refuses to become a scope guard on neurostim build detail', () => {
  const p = PRACTICES.find((x) => x.id === 'transcranial-pbm');
  assert.equal(p.grade, 'mixed');
  assert.match(p.note, /construction, current regulation, failure modes/);
  assert.match(p.note, /in scope in full detail/);
  assert.match(p.note, /CLAIMS constraint/);
});

test('the light entries reuse light-signal.mjs rather than restating its numbers', () => {
  const light = byFamily('light');
  const prose = light.map((p) => `${p.summary} ${p.evidence} ${p.steps.join(' ')} ${p.note || ''}`).join(' ');
  // The consensus thresholds live in integrations/light-signal.mjs with their source. This shelf
  // points at them; it does not re-key them, because two copies of a number drift.
  assert.match(prose, /integrations\/light-signal\.mjs/);
  assert.match(prose, /250 lx mEDI/);
});

test('⭐ claimsCheck over every light-entry field, and every flag is a known, inspected one', () => {
  // The rule is REPORT, not silence. claimsCheck cannot see negation and cannot see quotation
  // marks, so it fires on (a) a factual statement about what the literature contains, (b) the
  // sentence that routes a reader to a clinician, (c) the prohibition itself, and (d) the verbatim
  // condemned label, which is the exhibit the matcher was built from. All four are correct
  // behaviour by the matcher and correct prose by us. Pinned exactly, so a NEW claim fails here.
  const expected = new Set([
    'bright-light-sad|evidence|treatment for',
    'bright-light-sad|steps|diagnosis',
    'transcranial-pbm|note|treats',
    'transcranial-pbm|steps|treats',
    'colour-matched-to-organ|evidence|Restoration Of The Human Radio-Active And Radio-Emanative Equilibrium',
    'colour-matched-to-organ|evidence|Attuned Color Waves',
  ]);
  const found = new Set();
  for (const p of byFamily('light')) {
    const fields = {
      name: p.name, summary: p.summary, evidence: p.evidence,
      note: p.note || '', caution: p.caution || '', steps: p.steps.join(' '),
    };
    for (const [field, text] of Object.entries(fields)) {
      for (const hit of claimsCheck(text).hits) found.add(`${p.id}|${field}|${hit.phrase}`);
    }
  }
  assert.deepEqual([...found].sort(), [...expected].sort(),
    'a new claimsCheck flag appeared, or a known one vanished — inspect it, do not silence it');
});

test('every light entry is classified by comparator — the test that broke main last time', () => {
  for (const p of byFamily('light')) {
    const note = baselineNote(p.id);
    assert.equal(note.known, true, `${p.id} has no comparator classification`);
    assert.ok(note.why.length > 40, `${p.id}: the comparator needs a real why`);
  }
  // And the one that is honestly unclassifiable says so rather than guessing.
  assert.equal(baselineNote('transcranial-pbm').comparator, 'unstated');
  assert.match(baselineNote('transcranial-pbm').note, /genuine absence of a common design/);
});

test('⚠️ null is not zero and not undefined — the trap found five times in this repo', () => {
  // `Number(null) === 0` would make a missing lux reading classify as darkness, and `= {}` as a
  // destructuring default fires only for `undefined`, so an explicit `null` sails past it. Both are
  // exercised with an EXPLICIT null rather than by omitting the argument.
  assert.equal(practiceGrade(null), null);
  assert.deepEqual(byFamily(null), []);
  assert.doesNotThrow(() => baselineNote(null));
  assert.equal(baselineNote(null).known, false);
  assert.equal(melanopicEDI(null, 'led-4000k').ok, false, 'a null lux must not become 0 lux');
  assert.equal(melanopicEDI(null, 'led-4000k').mEDI, null);
  // 0 stays valid: it is a real measurement of darkness, not a missing one.
  assert.equal(melanopicEDI(0, 'led-4000k').ok, true);
  assert.equal(melanopicEDI(0, 'led-4000k').mEDI, 0);
});

test('the light shelf appears on the /40hz page with its own colour disclaimer', () => {
  assert.match(GAMMA_PAGE, /Light as an intervention/);
  // the `colour` disclaimer wording, printed for this family specifically
  assert.match(GAMMA_PAGE, /no colour is matched to a condition/);
  for (const p of byFamily('light')) {
    assert.ok(GAMMA_PAGE.includes(p.name.replace(/&/g, '&amp;')), `${p.id} missing from /40hz`);
  }
  assert.match(GAMMA_PAGE, /g-not-supported/, 'the not-supported grade must render as its own class');
});
