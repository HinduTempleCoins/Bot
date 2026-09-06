// the-line.test.mjs — the intended-use line, tested. Offline, no network.
//
// The point of these tests is that the doctrine is mechanical: intended use is shown through CLAIMS, so
// the claims are what get checked. The verbatim court-ordered disclaimer is pinned character-for-character
// because a paraphrase of a quoted judicial order is not the order.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, EMETER, disclaimer, CONTEXTS, claimsCheck, THE_LINE_HTML, handler,
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
