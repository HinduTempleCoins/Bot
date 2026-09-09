// the-line.test.mjs — the intended-use line, tested. Offline, no network.
//
// The point of these tests is that the doctrine is mechanical: intended use is shown through CLAIMS, so
// the claims are what get checked. The verbatim court-ordered disclaimer is pinned character-for-character
// because a paraphrase of a quoted judicial order is not the order.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, EMETER, SPECTRO_CHROME, THE_PAIR, disclaimer, CONTEXTS, claimsCheck, THE_LINE_HTML, handler,
  CONSULT, consultBanner, THE_PAIR_HTML, FAILED_DEFENCES, FAILED_DEFENCES_HTML,
  theLinePageHTML, PAGE_CONTEXTS,
  FDA_GUIDANCE, GENERAL_WELLNESS, CLINICAL_DECISION_SUPPORT, SAMD_CLINICAL_EVALUATION,
  GUIDANCE_CHECKED, guidance, withdrawnGuidance, GUIDANCE_HTML,
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

// ── ⭐ THE PAIR, MADE REACHABLE TO A READER (PR: wire the `colour` context) ───────────────────────
//
// SPECTRO_CHROME and THE_PAIR landed in #986 as data structures. A frozen constant nobody can read is
// not a published doctrine, and the pair is the clearest statement of the intended-use rule in this
// repo. These tests pin that it is now on a page, and that the colour surfaces carry the `colour`
// wording rather than only the general one.

test('consultBanner can carry a second doctrine, and drops duplicates and junk', () => {
  const both = consultBanner('exams', { also: ['colour'] });
  // The exams wording (who may interpret a number) AND the colour wording (no colour matched to a
  // condition). Neither substitutes for the other.
  assert.match(both, /that reading is theirs to make, not ours/);
  assert.match(both, /no colour is matched to a condition/);
  assert.equal((both.match(/<p>/g) || []).length, 2, 'one line per doctrine, plus the notALab muted line');

  // A repeat of the primary context is dropped rather than printed twice.
  const dup = consultBanner('colour', { also: ['colour'] });
  assert.equal((dup.match(/no colour is matched to a condition/g) || []).length, 1);

  // Unknown contexts are dropped, not rendered as the strict fallback — a surface that asks for
  // nonsense should get the doctrine it named, not an extra paragraph it did not ask for.
  const junk = consultBanner('exams', { also: ['nonsense', '', null, 'colour', 'colour'] });
  assert.equal((junk.match(/no colour is matched to a condition/g) || []).length, 1);
  assert.doesNotThrow(() => consultBanner('exams', { also: 'colour' }));
  assert.doesNotThrow(() => consultBanner('exams', { also: null }));
  // The default is unchanged: no `also` means exactly one doctrine, as before.
  assert.equal((consultBanner('exams').match(/<p>/g) || []).length, 1);
});

test('⭐ THE_PAIR_HTML renders both sentences side by side, with the outcomes', () => {
  const html = THE_PAIR_HTML();
  assert.match(html, /Two lamps/);
  assert.ok(html.includes(esc(EMETER.orderedDisclaimer)));
  assert.ok(html.includes(esc(SPECTRO_CHROME.labelClaim)));
  assert.match(html, /released/);
  assert.match(html, /condemned/);
  assert.match(html, /The devices are not what differ. The sentences differ/);
  // Both citations reach the reader.
  assert.ok(html.includes(esc(EMETER.cite)));
  assert.ok(html.includes(esc(SPECTRO_CHROME.cite)));
  // The em dashes and quotation marks in the condemned label must not smuggle markup.
  assert.ok(!/<script/i.test(html));
});

test('the three failed defences are rendered, not left in a comment', () => {
  assert.equal(FAILED_DEFENCES.length, 3);
  const html = FAILED_DEFENCES_HTML();
  assert.match(html, /He was religious, and it is in the record/);
  assert.match(html, /only lecturing/);
  assert.match(html, /Sincerity was never the question/);
  assert.match(html, /the lecture was the practice/);
  // The operative rule, stated where the reflex is.
  assert.match(THE_PAIR_HTML() + html, /A court may not decide whether a religious practice is true/);
});

test('the standalone page carries the banner, the pair and the defences', () => {
  const html = theLinePageHTML('colour');
  assert.match(html, /<title>/);
  assert.match(html, /class="consult"/);
  assert.ok(html.includes(CONSULT.short));
  assert.ok(html.includes(CONSULT.notALab));
  assert.match(html, /no colour is matched to a condition/);
  assert.match(html, /Two lamps/);
  assert.ok(html.includes(esc(SPECTRO_CHROME.labelClaim)));
  assert.match(html, /He was religious/);
  // Self-contained: nothing the BROWSER FETCHES is external — no script, no stylesheet, no
  // @import, no url(). That was always the point of this assertion; it used to be written as
  // "no https:// anywhere", which is a different and stricter thing, and it forbade the one
  // external reference this page is obliged to carry: a link to the guidance on fda.gov. A
  // citation you cannot click is not auditable, so the invariant is retargeted rather than
  // relaxed — outbound anchors are allowed, fetched subresources are not, and the anchors are
  // additionally pinned to fda.gov below.
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<link\b/i.test(html));
  assert.ok(!/\bsrc\s*=/i.test(html));
  assert.ok(!/@import|url\(/i.test(html));
  const external = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(external.length > 0, 'the dated FDA citations must be clickable');
  for (const u of external) {
    assert.match(u, /^https:\/\/www\.fda\.gov\//, `only fda.gov may be linked out to: ${u}`);
  }
});

test('the page context is an allow-list — junk falls back to colour rather than erroring', () => {
  for (const c of PAGE_CONTEXTS) {
    const html = theLinePageHTML(c);
    assert.ok(html.includes(esc(disclaimer(c))), c);
  }
  const junk = theLinePageHTML('<script>alert(1)</script>');
  assert.ok(!junk.includes('<script>alert'));
  assert.ok(junk.includes(esc(disclaimer('colour'))));
  assert.doesNotThrow(() => theLinePageHTML(null));
  assert.doesNotThrow(() => theLinePageHTML(undefined));
});

test('claimsCheck over the new prose, and every flag is inspected', () => {
  const flagged = [];
  for (const d of FAILED_DEFENCES) {
    for (const [k, v] of Object.entries(d)) {
      const c = claimsCheck(v);
      if (!c.ok) flagged.push({ k, v, hits: c.hits });
    }
  }
  // ONE flag, and it is correct behaviour. The line is "a religious frame is not a shield you can
  // raise after the fact over a sentence that promises a cure" — the word "cure" appears inside a
  // statement of the RULE AGAINST making one. The matcher has no model of negation, which this
  // module's own test file already documents, so the right response is to inspect the flag rather
  // than reword the rule to please a regex.
  assert.equal(flagged.length, 1, JSON.stringify(flagged, null, 2));
  assert.match(flagged[0].v, /is not a shield you can raise after the fact/);
  assert.deepEqual(flagged[0].hits.map((h) => h.why), ['asserts a cure']);
});

// --- the FDA guidance, dated ------------------------------------------------
//
// Every fact asserted here was read off fda.gov on 2026-09-09: the General Wellness guidance PDF
// (fda.gov/media/90652/download), the Clinical Decision Support guidance PDF
// (fda.gov/media/109618/download), CDRH's 11 February 2026 town-hall deck
// (fda.gov/media/100032/download) and CDRH's "Withdrawn or Expired Guidance" table. The dates and
// document numbers are pinned character-for-character for the same reason the court order is: a
// regulatory citation that drifts is worse than no citation, because it still looks authoritative.

test('⭐ the General Wellness guidance is the 6 January 2026 reissue, and it says what it superseded', () => {
  assert.equal(GENERAL_WELLNESS.issued, '2026-01-06');
  assert.equal(GENERAL_WELLNESS.status, 'final');
  assert.match(GENERAL_WELLNESS.supersedes, /September 27, 2019/);
  // Pinned exactly. A wrong docket or document number is a fabricated citation, not a typo.
  assert.equal(GENERAL_WELLNESS.docket, 'FDA-2014-N-1039');
  assert.equal(GENERAL_WELLNESS.documentNumber, '1300013');
  assert.match(GENERAL_WELLNESS.url, /^https:\/\/www\.fda\.gov\//);
});

test('⚠️ the module records that the SUBSTANCE did not move — no invented doctrinal shift', () => {
  // The whole risk in a citation refresh is narrating a change that did not happen. FDA states the
  // purpose of the reissue in one line, and that line is about wearable sensing, not about
  // intended use. Both halves are asserted so neither can be quietly rewritten into a shift.
  assert.match(GENERAL_WELLNESS.substanceUnchanged, /unchanged from/i);
  assert.match(GENERAL_WELLNESS.whatChanged, /non-invasive sensing/i);
  assert.ok(!/doctrine (?:changed|shifted|narrowed|broadened)/i.test(GENERAL_WELLNESS.substanceUnchanged));
  // The two-factor test and the two categories still read as they did.
  assert.equal(GENERAL_WELLNESS.twoFactors.length, 2);
  assert.equal(GENERAL_WELLNESS.categories.length, 2);
  assert.match(GENERAL_WELLNESS.categories[0], /maintaining or encouraging a general state of health/);
});

test('⭐ the affirmative half is carried: what the guidance ALLOWS, in its own words', () => {
  // Every other string in this module is a negation. These are not.
  const claims = GENERAL_WELLNESS.firstCategoryClaims;
  for (const want of ['relaxation or stress management', 'sleep management', 'mental acuity']) {
    assert.ok(claims.includes(want), `missing the general wellness claim area: ${want}`);
  }
  assert.match(GENERAL_WELLNESS.qiExample, /flow of qi/);
  // And the sentence that matches this library's posture — inclusion is not a finding of efficacy.
  assert.match(GENERAL_WELLNESS.notAnEfficacyFinding, /does not establish/);
  assert.match(GENERAL_WELLNESS.notAnEfficacyFinding, /safe and\/or effective/);
});

test('the Clinical Decision Support guidance was reported unverified — it is verified, and dated', () => {
  assert.equal(CLINICAL_DECISION_SUPPORT.verified, true);
  assert.equal(CLINICAL_DECISION_SUPPORT.issued, '2026-01-29');
  assert.match(CLINICAL_DECISION_SUPPORT.supersedes, /January 6, 2026/);
  assert.equal(CLINICAL_DECISION_SUPPORT.docket, 'FDA-2017-D-6569');
  assert.equal(CLINICAL_DECISION_SUPPORT.documentNumber, 'GUI01400062');
  // And it must say plainly that it is not our guidance, so nobody cites it as if it were.
  assert.match(CLINICAL_DECISION_SUPPORT.appliesToUs, /^No\./);
});

test('the withdrawn SaMD guidance is recorded AS withdrawn, with both dates', () => {
  assert.equal(SAMD_CLINICAL_EVALUATION.status, 'withdrawn');
  assert.equal(SAMD_CLINICAL_EVALUATION.issued, '2017-12-08');
  assert.equal(SAMD_CLINICAL_EVALUATION.withdrawn, '2026-01-06');
  assert.deepEqual(withdrawnGuidance().map((g) => g.id), ['samd-clinical-evaluation']);
  // A withdrawn document is a live hazard precisely because it stays online and reads current.
  assert.match(SAMD_CLINICAL_EVALUATION.note, /current thinking/i);
});

test('every tracked guidance carries a date, a checked-on date and an fda.gov URL', () => {
  assert.ok(FDA_GUIDANCE.length >= 3);
  assert.match(GUIDANCE_CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  for (const g of FDA_GUIDANCE) {
    assert.match(g.issued, /^\d{4}-\d{2}-\d{2}$/, g.id);
    assert.match(g.checked, /^\d{4}-\d{2}-\d{2}$/, g.id);
    assert.match(g.url, /^https:\/\/www\.fda\.gov\//, g.id);
    assert.ok(['final', 'withdrawn'].includes(g.status), g.id);
    assert.ok(Object.isFrozen(g), `${g.id} must be frozen — a citation must not be mutable`);
  }
  assert.ok(Object.isFrozen(FDA_GUIDANCE));
});

test('guidance(id) returns the document or null — never a nearest match, and never throws', () => {
  assert.equal(guidance('general-wellness'), GENERAL_WELLNESS);
  assert.equal(guidance('  General-Wellness  '), GENERAL_WELLNESS);
  // A near miss on a regulatory id must be a refusal. The nearest match to a citation is a wrong one.
  for (const junk of ['general', 'wellness', 'gener', 'cds', '', '   ']) {
    assert.equal(guidance(junk), null, JSON.stringify(junk));
  }
});

test('⚠️ null is passed EXPLICITLY to everything that takes an argument — nothing throws', () => {
  // `= {}` as a destructuring default fires only for `undefined`, and `Number(null) === 0`. This
  // module is soft-fail-never-throw, and consultBanner('exams', null) used to throw a TypeError
  // out of the function that renders the SAFETY COPY — a page would have rendered with no
  // disclaimer on it. Explicit null, not omission, is the test that catches that.
  assert.doesNotThrow(() => consultBanner('exams', null));
  assert.doesNotThrow(() => consultBanner(null, null));
  assert.doesNotThrow(() => consultBanner('exams', { also: null }));
  assert.doesNotThrow(() => consultBanner('exams', { also: 'colour' }));
  assert.doesNotThrow(() => consultBanner('exams', 'nonsense'));
  assert.doesNotThrow(() => consultBanner('exams', 0));
  assert.doesNotThrow(() => guidance(null));
  assert.doesNotThrow(() => guidance(undefined));
  assert.doesNotThrow(() => disclaimer(null));
  assert.doesNotThrow(() => claimsCheck(null));
  assert.doesNotThrow(() => theLinePageHTML(null));
  assert.doesNotThrow(() => THE_LINE_HTML(null));
  // And a null options bag must still produce the banner, not an empty string.
  const banner = consultBanner('exams', null);
  assert.match(banner, /class="consult"/);
  assert.ok(banner.includes(CONSULT.short));
  // A single non-array `also` is honoured rather than silently dropped.
  assert.ok(consultBanner('exams', { also: 'colour' }).includes(esc(disclaimer('colour'))));
});

test('GUIDANCE_HTML renders the dates, escapes its content, and cannot be injected into', () => {
  const html = GUIDANCE_HTML();
  assert.match(html, /2026-01-06/);
  assert.match(html, /2026-01-29/);
  assert.match(html, /withdrawn 2026-01-06/);
  assert.match(html, /FDA-2014-N-1039/);
  assert.match(html, /1300013/);
  assert.ok(html.includes(esc(GENERAL_WELLNESS.notAnEfficacyFinding)));
  assert.ok(!/<script/i.test(html));
  // The curly quotes in the FDA strings must arrive escaped, not as raw markup.
  assert.ok(!html.includes('<b>test</b>'));
});

test('the standalone page carries the dated guidance, not only the 1948 and 1971 cases', () => {
  const html = theLinePageHTML('exams');
  assert.match(html, /The guidance this rests on, with its dates/);
  assert.match(html, /2026-01-06/);
  // The stale-citation failure this change fixes: the page must now mention 2026 at all.
  assert.ok(html.includes('2026'));
});

test('⭐ claimsCheck over the new guidance prose — one flag, reported and NOT reworded', () => {
  // The rendered section is clean.
  const rendered = GUIDANCE_HTML().replace(/<[^>]+>/g, ' ');
  assert.deepEqual(claimsCheck(rendered).hits, [], 'the rendered guidance section must be clean');

  // The DATA carries exactly one flag, and it is the name of a statute.
  const hits = claimsCheck(JSON.stringify(FDA_GUIDANCE)).hits;
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0].phrase, /^Cures$/);
  // "21st Century Cures Act" — the Act that created the exclusion this whole policy rests on,
  // quoted verbatim from CDRH's own town-hall deck. The linter cannot tell a statute's name from a
  // promise of a cure. The protocol is report and explain; a library that edits its citations to
  // please its own linter has broken the linter.
  assert.ok(FDA_GUIDANCE.some((g) => (g.lineage || []).some((l) => /Cures Act/.test(l))),
    'the flag must be the Cures Act and nothing else');
});
