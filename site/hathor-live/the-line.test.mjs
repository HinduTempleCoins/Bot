// the-line.test.mjs — the intended-use line, tested. Offline, no network.
//
// The point of these tests is that the doctrine is mechanical: intended use is shown through CLAIMS, so
// the claims are what get checked. The verbatim court-ordered disclaimer is pinned character-for-character
// because a paraphrase of a quoted judicial order is not the order.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, EMETER, SPECTRO_CHROME, THE_PAIR, disclaimer, CONTEXTS, claimsCheck, THE_LINE_HTML, handler,
} from './the-line.mjs';

// --- the precedent -----------------------------------------------------------

test('the court-ordered disclaimer is pinned verbatim', () => {
  assert.equal(
    EMETER.orderedDisclaimer,
    'The E-Meter is not medically or scientifically useful for the diagnosis, treatment or prevention of '
    + 'any disease. It is not medically or scientifically capable of improving the health or bodily '
    + 'functions of anyone.',
  );
});

test('the citation is the 1971 district court order, not the 1969 appeal', () => {
  assert.match(EMETER.cite, /333 F\. Supp\. 357 \(D\.D\.C\. 1971\)/);
  assert.match(EMETER.priorCase, /409 F\.2d 1146 \(D\.C\. Cir\. 1969\)/);
});

test('the precedent object is frozen — a citation must not be mutable at runtime', () => {
  assert.throws(() => { EMETER.cite = 'nonsense'; }, TypeError);
});

test('the principle stated is intended-use-through-claims', () => {
  assert.match(EMETER.principle, /intended use/i);
  assert.match(EMETER.principle, /claims/i);
  assert.match(EMETER.principle, /not through ingredients/i);
});

// --- disclaimers -------------------------------------------------------------

test('every context yields a disclaimer that denies diagnosis, treatment, cure and prevention', () => {
  for (const c of CONTEXTS) {
    const d = disclaimer(c);
    assert.ok(d.length > 40, `${c} disclaimer too short`);
    assert.match(d, /diagnos/i, `${c} must disclaim diagnosis`);
    assert.match(d, /treat/i, `${c} must disclaim treatment`);
    assert.match(d, /cure/i, `${c} must disclaim cure`);
    assert.match(d, /prevent/i, `${c} must disclaim prevention`);
  }
});

test('an unknown context falls back to the STRICTEST wording, never to empty', () => {
  for (const junk of ['', 'nope', null, undefined, 0, {}, []]) {
    const d = disclaimer(junk);
    assert.equal(d, disclaimer('preparations'), 'fallback must be the strictest, not the first');
    assert.ok(d.length > 40);
  }
});

test('disclaimer is case- and whitespace-insensitive', () => {
  assert.equal(disclaimer('  ENTRAINMENT '), disclaimer('entrainment'));
});

// --- the claims linter -------------------------------------------------------

test('claim language is caught', () => {
  for (const bad of [
    'cures insomnia', 'treats depression', 'prevents Alzheimer\'s', 'heals the brain',
    'reverses cognitive decline', 'clinically proven', 'FDA-approved', 'guaranteed results',
    'restores memory', 'will fix your sleep', 'a diagnostic tool',
  ]) {
    const r = claimsCheck(bad);
    assert.equal(r.ok, false, `should have flagged: ${bad}`);
    assert.ok(r.hits.length > 0);
    assert.ok(r.hits[0].why, 'every hit explains why it is a claim');
  }
});

test('description and instruction are NOT claims — the practice is teachable', () => {
  for (const fine of [
    'Participants showed increased functional brain connectivity in the cited study.',
    '40Hz auditory stimulation, eyes closed, twenty minutes.',
    'Harvey & Payne (2002) found imagery distraction shortened sleep-onset latency; general distraction did not.',
    'Wire the electrodes in series and verify current before it touches skin.',
    'Graded weak: no controlled study exists for this technique.',
    'The B-complex arm reported significantly lower sleep quality.',
  ]) {
    assert.equal(claimsCheck(fine).ok, true, `should NOT have flagged: ${fine}`);
  }
});

test('claimsCheck never throws and treats junk as empty', () => {
  for (const v of [null, undefined, 0, {}, [], NaN]) {
    assert.doesNotThrow(() => claimsCheck(v));
    assert.equal(claimsCheck(v).ok, true);
  }
});

test('every hit reports the phrase actually matched, so a caller can find it', () => {
  const r = claimsCheck('this treats and cures everything');
  const phrases = r.hits.map((h) => h.phrase.toLowerCase());
  assert.ok(phrases.includes('treats'));
  assert.ok(phrases.includes('cures'));
});

// --- our own copy has to pass its own linter ---------------------------------

test('the disclaimers themselves are not claims in disguise', () => {
  // They contain "cure"/"treat" only inside a denial, so the linter WILL flag them — which is correct
  // and is why this test asserts the shape rather than ok:true. What matters is that no disclaimer
  // asserts an effect.
  for (const c of CONTEXTS) {
    assert.doesNotMatch(disclaimer(c), /\bwill (fix|repair|restore)\b/i);
    assert.doesNotMatch(disclaimer(c), /\bclinically proven\b/i);
    assert.doesNotMatch(disclaimer(c), /\bFDA[- ]approved\b/i);
  }
});

// --- rendering ---------------------------------------------------------------

test('the block renders the precedent, the quote and the position', () => {
  const html = THE_LINE_HTML('entrainment');
  assert.match(html, /Not even an E-Meter/);
  assert.match(html, /333 F\. Supp\. 357/);
  assert.match(html, /not medically or scientifically useful/);
  assert.match(html, /intended use/i);
  assert.match(html, /start further back/);
});

test('the block renders for every context and never throws on junk', () => {
  for (const c of [...CONTEXTS, null, undefined, 'nonsense', 0]) {
    assert.doesNotThrow(() => THE_LINE_HTML(c));
    assert.match(THE_LINE_HTML(c), /<section class="the-line">/);
  }
});

test('esc neutralises the five characters, and the block cannot be injected into', () => {
  assert.equal(esc(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
  const html = THE_LINE_HTML('entrainment');
  assert.ok(!html.includes('<script>'), 'no raw script tag');
});

test('esc never throws on non-strings', () => {
  for (const v of [null, undefined, 0, {}, [], NaN]) assert.doesNotThrow(() => esc(v));
  assert.equal(esc(null), '');
});

// --- handler -----------------------------------------------------------------

test('handler serves the framing as JSON', () => {
  let code = 0; let headers = null; let body = '';
  handler({}, { writeHead(c, h) { code = c; headers = h; }, end(b) { body = b; } }, 'practices');
  assert.equal(code, 200);
  assert.match(headers['content-type'], /application\/json/);
  const j = JSON.parse(body);
  assert.equal(j.context, 'practices');
  assert.equal(j.disclaimer, disclaimer('practices'));
  assert.equal(j.precedent.cite, EMETER.cite);
});

test('handler defaults its context rather than serving nothing', () => {
  let body = '';
  handler({}, { writeHead() {}, end(b) { body = b; } });
  assert.equal(JSON.parse(body).context, 'entrainment');
});

// ── "Consult your doctor" — the affirmative half ───────────────────────────────────────────────────
//
// Every other line in this module is a NEGATION: not a device, not advice, does not diagnose. Those
// keep the surface on the right side of the intended-use line and are useless to a reader holding a
// number. These tests exist because the operator asked for the referral to be everywhere, and because
// the export is deliberately formatted to be clinically legible — which is exactly what invites the
// mistake that it IS a clinical result.

test('the exams context exists and routes interpretation to a clinician', async () => {
  const { CONTEXTS, disclaimer } = await import('./the-line.mjs');
  assert.ok(CONTEXTS.includes('exams'), 'the exam battery had no context of its own');
  const d = disclaimer('exams');
  assert.match(d, /clinician/i, 'must name who does the interpreting');
  assert.match(d, /not.*diagnos/i);
  assert.match(d, /reference group/i, 'a score is meaningless without its reference class');
});

test('CONSULT says the affirmative thing, not only the negative one', async () => {
  const { CONSULT } = await import('./the-line.mjs');
  assert.match(CONSULT.short, /consult your doctor/i);
  assert.match(CONSULT.line, /bring|take this record/i, 'the record must be described as portable');
  assert.match(CONSULT.full, /before changing anything/i);
});

test('⭐ the export is explicitly NOT a lab result — legible like one, never claiming to be one', async () => {
  const { CONSULT } = await import('./the-line.mjs');
  assert.match(CONSULT.notALab, /not a laboratory result/i);
  assert.match(CONSULT.notALab, /no specimen/i, 'the reason must be given, not just asserted');
  assert.match(CONSULT.notALab, /sleep diary|blood-pressure/i, 'name the category it actually belongs to');
});

test('the banner carries both halves and escapes its content', async () => {
  const { consultBanner } = await import('./the-line.mjs');
  const h = consultBanner('exams');
  assert.match(h, /Consult your doctor/);
  assert.match(h, /not a laboratory result/);
  assert.match(h, /role="note"/);
  assert.ok(!/<script/i.test(h));
});

test('an unknown context still yields a banner, falling back strictly rather than to nothing', async () => {
  const { consultBanner } = await import('./the-line.mjs');
  for (const c of [undefined, null, '', 'nonsense', 0, {}]) {
    const h = consultBanner(c);
    assert.match(h, /Consult your doctor/, `context ${JSON.stringify(c)} produced no referral`);
  }
});

test('the referral text itself passes claimsCheck — it must not become the claim it prevents', async () => {
  const { CONSULT, claimsCheck, disclaimer } = await import('./the-line.mjs');
  // "diagnoses" appears in the disclaimers as a NEGATION, so those are expected to trip the linter.
  // CONSULT is prose we author freely, so it must be clean.
  for (const [k, v] of Object.entries(CONSULT)) {
    const r = claimsCheck(v);
    assert.equal(r.ok, true, `CONSULT.${k} contains a claim phrase: ${JSON.stringify(r.hits)}`);
  }
  assert.ok(disclaimer('exams'));
});


// --- the counterfactual: Spectro-Chrome ---------------------------------------
//
// These exist because the pair is the argument. A single precedent that says "released" teaches the
// wrong lesson on its own, and the case that says "condemned" happens to be a coloured lamp — which is
// the exact article this library is about to write a colour paper around.

test('the Spectro-Chrome citation is the Third Circuit affirmance, with its cert denial', () => {
  assert.equal(SPECTRO_CHROME.case, 'United States v. Ghadiali');
  assert.match(SPECTRO_CHROME.cite, /165 F\.2d 957 \(3d Cir\. 1948\)/);
  assert.match(SPECTRO_CHROME.cert, /334 U\.S\. 821 \(1948\)/);
  assert.match(SPECTRO_CHROME.statute, /Federal Food, Drug, and Cosmetic Act/);
});

test('the condemned label claim is pinned verbatim — it is the exhibit, not a paraphrase', () => {
  assert.equal(
    SPECTRO_CHROME.labelClaim,
    'Measurement And Restoration Of The Human Radio-Active And Radio-Emanative Equilibrium '
    + 'By Attuned Color Waves — No Diagnosis — No Drugs — No Manipulation — No Surgery',
  );
});

test('the precedent object and its related-cases list are both frozen', () => {
  assert.throws(() => { SPECTRO_CHROME.cite = 'nonsense'; }, TypeError);
  assert.throws(() => { SPECTRO_CHROME.related.push('made up'); }, TypeError);
});

test('the related cases carry the Delaware line, including the 1943 free-speech holding', () => {
  const joined = SPECTRO_CHROME.related.join(' | ');
  assert.match(joined, /175 A\. 315/);
  assert.match(joined, /292 U\.S\. 653 \(1934\)/);
  assert.match(joined, /48 F\. Supp\. 789 \(D\. Del\. 1943\)/);
  assert.match(joined, /lecturing/i);
});

test('religion is recorded as present-but-unreached, not as a defence that worked', () => {
  assert.match(SPECTRO_CHROME.religionInTheRecord, /Parsee Zoroastrian/);
  assert.match(SPECTRO_CHROME.religionInTheRecord, /never reached religion/i);
});

test('⭐ THE_PAIR is released-then-condemned, and the two cases disagree in outcome', () => {
  assert.equal(THE_PAIR.length, 2);
  assert.deepEqual(THE_PAIR.map((p) => p.outcome), ['released', 'condemned']);
  assert.equal(THE_PAIR[0].cite, EMETER.cite);
  assert.equal(THE_PAIR[1].cite, SPECTRO_CHROME.cite);
  for (const p of THE_PAIR) assert.throws(() => { p.outcome = 'x'; }, TypeError);
});

test('⭐ the pair is the argument, and the linter can tell the two sentences apart', () => {
  // Both trip claimsCheck, because it is a word matcher and cannot see negation — the same limitation
  // the existing "disclaimers are not claims in disguise" test documents. So this asserts the SHAPE of
  // the hits, which is where the released and the condemned sentence actually differ:
  //   the ordered disclaimer trips only on words it is NEGATING (diagnosis, treatment, prevention);
  //   the condemned label trips on an affirmative claim of restoration, which no disclaimer contains.
  const released = THE_PAIR.find((p) => p.outcome === 'released');
  const condemned = THE_PAIR.find((p) => p.outcome === 'condemned');

  const releasedWhys = claimsCheck(released.sentence).hits.map((h) => h.why);
  assert.ok(releasedWhys.length > 0, 'the matcher is word-based; the denial contains the words');
  assert.ok(!releasedWhys.some((w) => /restoration|rebalancing|Spectro-Chrome/i.test(w)),
    'the ordered disclaimer must not trip an affirmative-effect pattern');

  const condemnedWhys = claimsCheck(condemned.sentence).hits.map((h) => h.why);
  assert.ok(condemnedWhys.some((w) => /restoration or rebalancing/i.test(w)),
    'the condemned label asserts restoration of the body, and the linter must see it');
  assert.ok(condemnedWhys.some((w) => /Spectro-Chrome label claim, verbatim/i.test(w)),
    '"attuned color waves" is pinned as its own pattern');
});

// --- the colour context -------------------------------------------------------

test('there is a colour context, and it disclaims measurement and restoration by name', () => {
  assert.ok(CONTEXTS.includes('colour'));
  const d = disclaimer('colour');
  assert.match(d, /measures? or restores?/i);
  assert.match(d, /no colou?r is matched to a condition/i);
  // Same shape rule as the sibling disclaimers: negated words are allowed, asserted effects are not.
  assert.doesNotMatch(d, /\bclinically proven\b/i);
  assert.doesNotMatch(d, /\bwill (fix|repair|restore)\b/i);
  assert.doesNotMatch(d, /\battuned colou?r waves?\b/i);
});

// --- the Ghadiali claim patterns ----------------------------------------------

test('the Spectro-Chrome vocabulary is linted, not just the modern vocabulary', () => {
  const shouldTrip = [
    'restores the body',
    'rebalances your energy',
    'balances the system',
    'normalises your field',
    'delivered by attuned color waves',
    'attuned colour wave sessions',
    'colour therapy for insomnia',
    'the healing frequency for anxiety',
  ];
  for (const s2 of shouldTrip) {
    assert.equal(claimsCheck(s2).ok, false, `should have flagged: ${s2}`);
  }
});

test('describing the history is not making the claim — the linter must not eat the scholarship', () => {
  const shouldPass = [
    'Babbitt published Principles of Light and Color in 1878.',
    'Blue light suppresses melatonin, and the action spectrum peaks near 460 to 480 nm.',
    'The Cochrane review found the evidence limited and of very low quality.',
    'Ghadiali read Babbitt in a Theosophical Society library in Bombay.',
    'Bright light was compared with dawn simulation in seasonal affective disorder.',
  ];
  for (const s2 of shouldPass) {
    const r = claimsCheck(s2);
    assert.equal(r.ok, true, `false positive on: ${s2} -> ${JSON.stringify(r.hits)}`);
  }
});

// --- the rendered block and the handler ---------------------------------------

test('the block renders both precedents and both quoted sentences', () => {
  const html = THE_LINE_HTML('colour');
  assert.match(html, /United States v\. Ghadiali/);
  assert.match(html, /165 F\.2d 957/);
  assert.match(html, /Attuned Color Waves/);
  assert.match(html, /333 F\. Supp\. 357/);
  assert.match(html, /the sentences differ/i);
});

test('the block still escapes — the em dashes in the label must not smuggle markup', () => {
  const html = THE_LINE_HTML('colour');
  assert.ok(!/<script/i.test(html));
  // The label contains no angle brackets, but the escaping habit is what is under test.
  assert.equal(esc(SPECTRO_CHROME.labelClaim), SPECTRO_CHROME.labelClaim);
});

test('handler serves the pair alongside the single precedent', async () => {
  let body = '';
  const res = { writeHead() {}, end(b) { body = b; } };
  handler({}, res, 'colour');
  const json = JSON.parse(body);
  assert.equal(json.context, 'colour');
  assert.equal(json.counterfactual.cite, SPECTRO_CHROME.cite);
  assert.equal(json.pair.length, 2);
  assert.equal(json.precedent.cite, EMETER.cite);
});
