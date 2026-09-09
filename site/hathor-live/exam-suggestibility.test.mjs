// site/hathor-live/exam-suggestibility.test.mjs — offline, no network, no fs.
//
// The tests that matter here are the REFUSALS: that the index does not call itself hypnotisability,
// that it carries no item from a licensed instrument, and that the covariate obeys the same
// no-percentile-below-100 rule as everything else in the battery.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAM_ID, CONSTRUCT, SCALE, ITEMS, ITEM_COUNT, FACETS, PROBES, PROBE_SCALE,
  MIN_SCORE, MAX_SCORE, LANDMARKS,
  buildForm, scoreForm, resultCopy, covariateNote, covariateHTML, suggestibilityPageHTML,
} from './exam-suggestibility.mjs';
import { EXAMS, examById, claimClassOf, experientialExams, CLAIM_CLASSES } from './exams.mjs';
import { claimsCheck, CONSULT } from './the-line.mjs';

// ── the shape ────────────────────────────────────────────────────────────────────────────────────

test('twelve items, four facets of three, and the scale runs 0–4', () => {
  assert.equal(ITEM_COUNT, 12);
  assert.equal(ITEMS.length, 12);
  assert.equal(MAX_SCORE, 48);
  assert.equal(MIN_SCORE, 0);
  assert.equal(SCALE.length, 5);
  assert.deepEqual(SCALE.map((s) => s.value), [0, 1, 2, 3, 4]);
  for (const f of FACETS) {
    assert.equal(ITEMS.filter((i) => i.facet === f.id).length, 3, `${f.id} should have three items`);
  }
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, 12, 'item ids must be unique');
});

test('⛔ it does not call itself hypnotisability, absorption, or a type', () => {
  const surfaces = [
    CONSTRUCT.name, CONSTRUCT.short, CONSTRUCT.full,
    ...ITEMS.map((i) => i.text),
    ...FACETS.map((f) => `${f.label} ${f.gloss}`),
  ].join(' ').toLowerCase();
  // The construct name and the items must not borrow the famous labels. `notHypnotisability` is
  // excluded from this sweep on purpose: it is the sentence that says we are NOT one, and it has to
  // use the word to deny it.
  assert.ok(!surfaces.includes('hypnotis'), 'no item or label may claim hypnotisability');
  assert.ok(!surfaces.includes('hypnotiz'), 'no item or label may claim hypnotizability');
  assert.ok(!surfaces.includes('absorption'), 'no item or label may borrow the absorption label');
  assert.ok(!surfaces.includes('trance'), 'this index does not measure trance');
  // And the denial itself must actually be present somewhere the reader sees it.
  assert.match(CONSTRUCT.notHypnotisability, /NOT a hypnotisability scale/);
  assert.match(suggestibilityPageHTML(), /cannot see your arm/);
});

test('⛔ the refusals are on the page, named, with their reasons', () => {
  const html = suggestibilityPageHTML();
  assert.match(html, /Tellegen Absorption Scale/);
  assert.match(html, /University of Minnesota Press/);
  assert.match(html, /MODTAS/);
  assert.match(html, /IPIP/);
  assert.match(html, /no Absorption entry/);
  // A page that says "we could not use X" without saying why is a hedge. These say why.
  assert.match(html, /derivative work/);
});

test('the exam is registered, is a perception exam, and is not experiential-self-report itself', () => {
  const e = examById(EXAM_ID);
  assert.ok(e, 'the exam must be in the EXAMS register');
  assert.equal(e.kind, 'perception');
  assert.equal(e.route, '/exams/suggestibility');
  assert.equal(e.neverSay, 'You are highly hypnotisable.');
  assert.equal(e.claimClass, 'percentile');
  assert.equal(e.experientialSelfReport, false);
  assert.equal(claimClassOf(e).mark, CLAIM_CLASSES.percentile.mark);
  // No reward, tier or rank — assertNeverPayable() runs at module load and would have thrown, but
  // pin it here too, because that is the rule the register exists to enforce.
  assert.equal(e.payable, undefined);
  assert.equal(e.reward, undefined);
});

test('⭐ the experiential exams are flagged and the behavioural ones are not', () => {
  // The VVIQ asks how vivid an image WAS; the Thread Protocol asks how much each of sixteen stimuli
  // did to you. Both are reports of an experience, so both print the covariate.
  assert.deepEqual(experientialExams().map((e) => e.id).sort(), ['thread', 'vviq']);
  // Said explicitly, because the interesting half is the exams that are EXEMPT and why: the grapheme
  // test is scored on reproducing a colour, not on reporting a feeling.
  assert.equal(examById('grapheme').experientialSelfReport, false);
  assert.equal(examById('human-or-model').experientialSelfReport, false);
  assert.equal(examById('colour-naming').experientialSelfReport, false);
  for (const e of EXAMS) {
    assert.ok(typeof e.experientialSelfReport === 'boolean', `${e.id} must answer the question`);
    assert.ok(claimClassOf(e), `${e.id} must declare a valid claim class`);
  }
});

// ── administration ───────────────────────────────────────────────────────────────────────────────

test('the form shuffles items and probes, and the same seed gives the same order', () => {
  const a = buildForm({ seed: 'seed-one' });
  const b = buildForm({ seed: 'seed-one' });
  const c = buildForm({ seed: 'seed-two' });
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  assert.equal(a.items.length, 12);
  assert.equal(a.probes.length, 2);
  assert.notDeepEqual(a.items.map((i) => i.id), c.items.map((i) => i.id));
  // Every item survives the shuffle exactly once.
  assert.deepEqual([...a.items.map((i) => i.id)].sort(), [...ITEMS.map((i) => i.id)].sort());
  // A probe's `suggests` flag is NOT sent to the browser — it would tell the taker which passage is
  // the suggestion, and that is the one thing that would wreck the difference.
  for (const p of a.probes) assert.equal(p.suggests, undefined);
});

test('the two probes are matched in shape and only one of them suggests anything', () => {
  assert.equal(PROBES.length, 2);
  assert.equal(PROBES.filter((p) => p.suggests).length, 1);
  const [sug, ctl] = [PROBES.find((p) => p.suggests), PROBES.find((p) => !p.suggests)];
  // Matched for the act of reading: same instruction, same closing sentence, comparable length.
  assert.equal(sug.heading, ctl.heading);
  assert.match(sug.text, /Take a few seconds before you answer\.$/);
  assert.match(ctl.text, /Take a few seconds before you answer\.$/);
  assert.ok(Math.abs(sug.text.length - ctl.text.length) < 80, 'the passages must be comparable in length');
  // The control passage must not suggest a sensation.
  assert.ok(!/warmth|heaviness|tingl/i.test(ctl.text));
});

// ── scoring, hand-checked ────────────────────────────────────────────────────────────────────────

test('scoring is the plain sum, and the facet totals are hand-checkable', () => {
  const answers = {};
  for (const it of ITEMS) answers[it.id] = 2;
  const r = scoreForm(answers, { suggested: 70, unsuggested: 40 });
  assert.equal(r.answered, 12);
  assert.equal(r.complete, true);
  assert.equal(r.score.total, 24); // 12 items × 2
  for (const f of FACETS) assert.equal(r.byFacet[f.id], 6); // 3 items × 2
  assert.equal(r.score.probeDifference, 30);
  assert.equal(r.probes.difference, 30);
  assert.equal(r.allSameAnswer, true);
});

test('a maximum sitting is 48 and a floor sitting is 0, and neither is a category', () => {
  const max = {}; const min = {};
  for (const it of ITEMS) { max[it.id] = 4; min[it.id] = 0; }
  assert.equal(scoreForm(max, {}).score.total, 48);
  assert.equal(scoreForm(min, {}).score.total, 0);
  const copy = resultCopy(scoreForm(max, {}), { n: 3 });
  assert.match(copy.headline, /48 of 48/);
  // Even at the ceiling there is no type in the copy.
  const prose = copy.lines.join(' ');
  assert.ok(!/you are (a|an|highly)/i.test(prose), prose);
});

test('junk answers are dropped, not clamped — a partial sitting is visibly partial', () => {
  const r = scoreForm({ e1: 9, e2: -1, e3: 2.5, c1: 3, c2: 'x', d1: 1 }, {});
  assert.equal(r.answered, 2, 'only c1 and d1 are valid');
  assert.equal(r.score.total, 4);
  assert.equal(r.complete, false);
  assert.equal(r.byFacet.expectancy, null, 'an incomplete facet reports null, never a partial sum');
  const copy = resultCopy(r, { n: 0 });
  assert.match(copy.lines.join(' '), /2 of 12 items/);
  assert.match(copy.lines.join(' '), /partial sitting/);
});

test('an out-of-range or missing probe gives no difference rather than a wrong one', () => {
  const answers = {}; for (const it of ITEMS) answers[it.id] = 1;
  assert.equal(scoreForm(answers, { suggested: 50 }).score.probeDifference, null);
  assert.equal(scoreForm(answers, { suggested: 500, unsuggested: 10 }).score.probeDifference, null);
  assert.equal(scoreForm(answers, { suggested: 0, unsuggested: 100 }).score.probeDifference, -100);
  const copy = resultCopy(scoreForm(answers, { suggested: 50 }), { n: 0 });
  assert.match(copy.lines.join(' '), /not both answered/);
});

test('nothing answered scores nothing, and says so rather than printing a zero', () => {
  const r = scoreForm({}, {});
  assert.equal(r.score.total, null);
  assert.match(resultCopy(r, {}).headline, /nothing to score/i);
});

// ── the covariate, which is the point ────────────────────────────────────────────────────────────

test('⭐ the covariate refuses a percentile below n = 100 and prints the raw score instead', () => {
  const under = covariateNote({ total: 30, n: 99, distribution: new Array(99).fill(20), examName: 'the VVIQ' });
  assert.equal(under.hasIndex, true);
  assert.equal(under.percentile, null);
  assert.match(under.lines.join(' '), /30 out of 48/);
  assert.match(under.lines.join(' '), /too few to place you among them/);
});

test('⭐ at n = 100 the percentile appears, is hand-checkable, and carries the self-selection caveat', () => {
  // 100 people: 40 scored 10, 59 scored 20, and our taker scored 20 too.
  // below = 40, equal = 60 → (40 + 30) / 100 = 70th percentile.
  const dist = [...new Array(40).fill(10), ...new Array(60).fill(20)];
  assert.equal(dist.length, 100);
  const note = covariateNote({ total: 20, n: 100, distribution: dist, examName: 'the VVIQ' });
  assert.equal(note.percentile, 70);
  assert.match(note.lines.join(' '), /70th\s+percentile/);
  assert.match(note.lines.join(' '), /not a random sample of anybody/);
});

test('the covariate with no index on file invites the sitting instead of assuming a middle value', () => {
  const none = covariateNote({ total: null, n: 500, examName: 'the VVIQ' });
  assert.equal(none.hasIndex, false);
  assert.equal(none.ok, false);
  assert.match(none.headline, /have not sat/);
  assert.match(covariateHTML(none), /href="\/exams\/suggestibility"/);
  // And it must not fabricate a number for somebody who has not taken it.
  assert.equal(none.total, undefined);
  assert.equal(none.percentile, undefined);
});

test('the covariate names the study, the sample sizes AND the fact that it is contested', () => {
  const note = covariateNote({ total: 20, n: 4 });
  assert.match(note.source, /10\.1038\/s41467-020-18591-6/);
  assert.match(note.source, /156, 404, 353/);
  assert.match(note.source, /contested/i);
  assert.match(note.source, /10\.1038\/s41467-022-28177-z/);
  // It says what is shared, not that the other result is wrong.
  assert.match(note.lines.join(' '), /does not make the result false/);
});

test('covariateHTML escapes everything and survives a junk note', () => {
  const html = covariateHTML({ headline: '<script>x</script>', lines: ['a & b'], source: '"q"', hasIndex: true });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
  assert.doesNotThrow(() => covariateHTML(null));
  assert.doesNotThrow(() => covariateHTML('nonsense'));
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

test('the page carries consultBanner and CONSULT.notALab through examShell', () => {
  const html = suggestibilityPageHTML();
  assert.match(html, /class="consult"/);
  assert.ok(html.includes(CONSULT.short));
  assert.ok(html.includes(CONSULT.notALab.slice(0, 60)));
  assert.match(html, /<title>/);
});

test('no participant key, sitting id or seed appears anywhere in the page', () => {
  const html = suggestibilityPageHTML();
  // The keygen script is present (the browser makes the key) but no key VALUE is baked in.
  assert.match(html, /teKey\(\)/);
  assert.ok(!/[0-9A-HJ-NP-TV-Z]{25}/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')),
    'no 25-symbol key-shaped string may appear in the rendered body');
});

test('the result copy never says the taker is a type, and always says the index is short', () => {
  const answers = {}; for (const it of ITEMS) answers[it.id] = 3;
  const copy = resultCopy(scoreForm(answers, { suggested: 60, unsuggested: 55 }), { n: 12 });
  const prose = copy.lines.join(' ');
  assert.match(prose, /short indices are noisy/);
  assert.match(prose, /not a finding about you/);
  assert.match(prose, /Only the difference is reported/);
  assert.ok(!/high-absorption|highly suggestible|you are highly/i.test(prose));
  assert.equal(copy.neverSay, 'You are highly hypnotisable.');
  assert.equal(copy.landmarks.length, LANDMARKS.length);
});

test('the facet totals are labelled a shape, not subscales', () => {
  const answers = {}; for (const it of ITEMS) answers[it.id] = 1;
  const copy = resultCopy(scoreForm(answers, {}), { n: 0 });
  assert.match(copy.lines.join(' '), /not established subscales/);
  assert.equal(copy.facets.length, 4);
  for (const f of copy.facets) assert.equal(f.total, 3);
});

// ── the linter, run on our own prose ─────────────────────────────────────────────────────────────

test('claimsCheck on every line of the page copy, and what it flags is inspected', () => {
  const prose = [
    CONSTRUCT.full, CONSTRUCT.notHypnotisability,
    ...ITEMS.map((i) => i.text),
    ...PROBES.map((p) => `${p.text} ${p.question}`),
    ...LANDMARKS.map((l) => l.text),
  ];
  const flagged = [];
  for (const line of prose) {
    const c = claimsCheck(line);
    if (!c.ok) flagged.push({ line, hits: c.hits });
  }
  // ZERO. Reported as a number rather than asserted loosely, so that a future edit which introduces a
  // claim pattern fails this test instead of quietly passing it. Note what this does NOT mean: a clean
  // claimsCheck is the absence of the phrases the matcher knows, not a clearance. The module's own
  // header says the same thing.
  assert.equal(flagged.length, 0, JSON.stringify(flagged, null, 2));
});

test('the probe passages assert no effect in their own voice', () => {
  for (const p of PROBES) {
    assert.equal(claimsCheck(p.text).ok, true, p.id);
    // The suggested passage says what OTHER PEOPLE notice, hedged, and never that the reader will.
    if (p.suggests) {
      assert.match(p.text, /Many people/);
      assert.ok(!/you will (feel|notice)/i.test(p.text));
    }
  }
});

test('PROBE_SCALE is a 0–100 visual analogue with both ends named', () => {
  assert.equal(PROBE_SCALE.min, 0);
  assert.equal(PROBE_SCALE.max, 100);
  assert.ok(PROBE_SCALE.lowLabel && PROBE_SCALE.highLabel);
});
