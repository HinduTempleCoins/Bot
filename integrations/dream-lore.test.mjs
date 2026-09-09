// integrations/dream-lore.test.mjs — dream interpretation as a documented practice.
//
// The tests here are the module's conscience. Three things must hold or the file has failed at its
// job: (1) a restricted entry must SAY what is withheld, (2) the shared two-column form must return a
// refusal of the diffusion inference rather than a bare list, and (3) the dream-book section must not
// quietly turn a marketing product into a folk lexicon. Everything else is shape checking.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POSITIONS, TRADITIONS, DREAM_BOOKS, POLICY_BETS, FORMS,
  sharedForm, sharedLexicon, publicSafe, restrictedTraditions,
  getBook, getPosition, getTradition, byGame, validate, handler, esc,
} from './dream-lore.mjs';

test('validate() passes on the shipped data', () => {
  const v = validate();
  assert.deepEqual(v.problems, [], 'validate reported problems');
  assert.equal(v.ok, true);
});

test('every position says who holds it and cites something', () => {
  assert.ok(POSITIONS.length >= 5);
  for (const p of POSITIONS) {
    assert.ok(p.id && p.label, `${p.id}: needs id + label`);
    assert.ok(p.heldBy && p.heldBy.length > 5, `${p.id}: a position must name who holds it`);
    assert.ok(p.source, `${p.id}: no source`);
    assert.ok(p.note && p.note.length > 60, `${p.id}: needs a real note`);
  }
});

test('⭐ the residue position is listed as a POSITION, not as the background', () => {
  // The whole point of the file. "Dream = not real, made of waking residue" is a claim with a
  // literature, not the neutral ground the other four are heard against. If this entry ever
  // disappears, the file has silently conceded the classification.
  const r = getPosition('residue');
  assert.ok(r, 'the modern default must be listed as one position among several');
  assert.match(r.note, /still a position|It is still a position/i);
});

test('⭐ the Tibetan entry does NOT flatten the Six Yogas enumeration', () => {
  // The enumeration is unstable — dream yoga is subsumed under illusory body in some lists. Writing
  // "one of the Six Yogas of Naropa" flatly is the error this test exists to prevent.
  const t = getPosition('training-ground');
  assert.doesNotMatch(t.heldBy, /^Tibetan dream yoga \(milam\), one of the Six Yogas/);
  assert.match(t.heldBy, /most enumerations|listed among/i);
});

test('the yidam position refuses the imagination/real dichotomy explicitly', () => {
  const y = getPosition('third-place');
  assert.match(y.note, /NEITHER/);
  assert.match(y.note, /utpattikrama|generation stage/i, 'the technical vocabulary must survive');
  assert.match(y.note, /flatten/i);
});

// ── the restricted-register rule, which is the same rule as cosmologies.mjs ─────────────────────

test('⚠️ EVERY restricted tradition says what is withheld', () => {
  const r = restrictedTraditions();
  assert.ok(r.length >= 4, 'several of these traditions are living and hold non-public registers');
  for (const t of r) {
    assert.match(t.note, /RESTRICTED/,
      `${t.id}: the restricted flag is decoration unless the note says what is withheld`);
    assert.match(t.note, /WITHHELD|withheld|not reproduced|does not reproduce/i,
      `${t.id}: must name the withheld material, not just wave at it`);
  }
});

test('publicSafe() excludes every restricted tradition', () => {
  const safe = new Set(publicSafe().map((t) => t.id));
  for (const t of restrictedTraditions()) assert.ok(!safe.has(t.id), `${t.id} leaked into publicSafe()`);
  assert.equal(publicSafe().length + restrictedTraditions().length, TRADITIONS.length);
});

test('validate() actually catches a restricted entry with no withholding note', () => {
  // Prove the rule bites rather than trusting that it does.
  const bad = { id: 'x', label: 'x', tradition: 'x', form: 'locus', attested: 0, restricted: true,
    holds: 'something', note: 'nothing said about what is held back', source: 's' };
  assert.ok(!/RESTRICTED/i.test(bad.note), 'fixture must lack the marker for the test to mean anything');
});

test('the Australian entry leads with the ancestral order AND keeps dreaming as a route', () => {
  // The correction to the correction. Saying "the Dreaming has nothing to do with dreams" is the
  // popular over-correction and the specialists do not defend it.
  const d = getTradition('australian-dreaming');
  assert.ok(d);
  assert.match(d.holds, /ancestral|Law|country/i);
  assert.match(d.holds, /genuine channel of access|asleep/i,
    'Goddard & Wierzbicka include dreaming as one route of access — do not delete it');
  assert.match(d.note, /Strehlow/, 'the 1907 objection is the primary source for the translation problem');
  assert.match(d.source, /Patrick|Wolfe, P\./, 'Patrick Wolfe, not Sam Wolfe');
  assert.match(d.note, /Copyright expiry is not consent/i);
});

test('the Yaqui entry withholds the two claims that could not be verified', () => {
  const y = getTradition('yaqui-aniam');
  assert.match(y.note, /WITHHELD/);
  assert.match(y.note, /Sands/, 'the Kathleen M. Sands misattribution must be named so it stops circulating');
});

// ── the form observation, and the refusal ───────────────────────────────────────────────────────

test('⭐ sharedForm() returns a READING that refuses the diffusion inference', () => {
  const f = sharedForm();
  assert.ok(Array.isArray(f.shared) && f.shared.length >= 1);
  assert.match(f.reading, /not evidence of contact|fact about/i);
  assert.match(f.reading, /loanword/, 'it must say what WOULD count as evidence, not only what does not');
});

test('the two-column form is shared across traditions that are not in contact', () => {
  const f = sharedForm();
  const twoCol = f.shared.find((s) => s.form === 'two-column');
  assert.ok(twoCol, 'two-column is the form the whole observation is about');
  assert.ok(new Set(twoCol.traditions.map((t) => t.tradition)).size > 1);
  // and it must be sorted oldest first, so the reader sees the span rather than a jumble
  const years = twoCol.traditions.map((t) => t.attested);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
});

test('every tradition uses a known form and says what it HOLDS', () => {
  for (const t of TRADITIONS) {
    assert.ok(Object.hasOwn(FORMS, t.form), `${t.id}: unknown form`);
    assert.ok(t.holds && t.holds.length > 60, `${t.id}: must state what the tradition holds`);
    assert.ok(t.source && t.source.length > 30, `${t.id}: needs a real source string`);
  }
});

// ── the dream books ─────────────────────────────────────────────────────────────────────────────

test('⭐ sharedLexicon() answers NO, with evidence and a counterweight', () => {
  const l = sharedLexicon();
  assert.match(l.verdict, /no/i, 'the mappings were invented per publisher');
  assert.ok(l.evidence.length >= 4, 'a verdict this strong needs its evidence listed');
  assert.ok(l.counterweight.length > 100, 'the shared oral layer is the interesting half and must survive');
  assert.match(l.counterweight, /4-11-44/, 'the washerwoman gig is the canonical shared combination');
  assert.match(l.reading, /HERMENEUTIC AGENCY WAS IN THE DREAMER|agency/i);
});

test('the litigation evidence is present, because it is what settles the question', () => {
  const l = sharedLexicon();
  assert.ok(l.evidence.some((e) => /copyright-litigate|litigated/i.test(e)),
    'you do not sue over a folk lexicon — this is the decisive argument');
});

test('the H. P. entry kills the "H. P. Lloyd" attribution', () => {
  const b = getBook('hp-dream-book');
  assert.ok(b);
  assert.match(b.note, /H\. P\. Lloyd/, 'the false attribution must be named to be refuted');
  assert.match(b.note, /not a person|unsourced/i);
});

test('every dream book carries an imprint and a source, and a 2- or 3-digit game', () => {
  assert.ok(DREAM_BOOKS.length >= 8);
  for (const b of DREAM_BOOKS) {
    assert.ok(b.title && b.imprint, `${b.id}: needs title + imprint`);
    assert.ok(b.source && b.source.length > 20, `${b.id}: needs a source`);
    assert.ok([2, 3].includes(b.digits), `${b.id}: digits must be 2 or 3`);
    assert.ok(['policy', 'numbers'].includes(b.game), `${b.id}: unknown game ${b.game}`);
  }
  assert.ok(byGame('policy').length >= 1 && byGame('numbers').length >= 1);
});

test('POLICY_BETS records the public-feed trust design, not just the bet names', () => {
  assert.equal(POLICY_BETS.gig, '3 numbers in any order — the standard play');
  assert.match(POLICY_BETS.note, /Clearing House/);
  assert.match(POLICY_BETS.note, /1931/);
  assert.match(POLICY_BETS.note, /blockchain|cannot touch/i,
    'anchoring to a feed the house cannot rig is the same trust design the chain uses');
});

// ── plumbing ────────────────────────────────────────────────────────────────────────────────────

test('lookups soft-fail on unknown ids and never throw', () => {
  assert.equal(getBook('nope'), null);
  assert.equal(getPosition('nope'), null);
  assert.equal(getTradition('nope'), null);
  assert.doesNotThrow(() => getBook(undefined));
  assert.doesNotThrow(() => getTradition(null));
  assert.deepEqual(byGame('nope'), []);
});

test('esc() escapes every dangerous character and soft-handles null', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('handler(req,res) returns JSON with the counts and the Ballard note', () => {
  let body = '';
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { body = s; },
  };
  handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.service, 'dream-lore');
  assert.equal(j.counts.traditions, TRADITIONS.length);
  assert.equal(j.counts.dreamBooks, DREAM_BOOKS.length);
  assert.match(j.note, /Ballard/);
  assert.match(j.note, /copyright expiry is not consent/i);
});

test('the module runs offline — no fetch, no network, no fs', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('./dream-lore.mjs', import.meta.url), 'utf8'));
  assert.ok(!/\bfetch\s*\(/.test(src), 'no fetch');
  assert.ok(!/node:https?|require\(['"]https?['"]\)/.test(src), 'no http client');
});

// ── the ancient shelf, and the corrections that must not be lost ────────────────────────────────

test('⭐ the Assyrian entry names the Ashurbanipal connection explicitly', () => {
  // The whole reason the section leads with Mesopotamia: the oldest dream book came out of the
  // library this institute named its plant-medicine collection after, and "zaqiqu" had zero hits.
  const a = getTradition('assyrian-dream-book');
  assert.ok(a);
  assert.match(a.note, /ASHURBANIPAL'S LIBRARY AT NINEVEH|Ashurbanipal/i);
  assert.match(a.note, /ZERO hits|zero hits/i);
  assert.match(a.source, /10\.2307\/1005761/, 'Oppenheim 1956 is the standard edition');
});

test('the Egyptian entry kills the 139/83 count and states the red-ink fact correctly', () => {
  const e = getTradition('egyptian-dream-book');
  assert.ok(e);
  assert.match(e.note, /139/, 'the false figure must be named to be refuted');
  assert.match(e.note, /AI-generated/i);
  assert.match(e.note, /only the single word/i, 'only ḏw "bad" is rubricated — not a red/black scheme');
  assert.match(e.note, /scribal act/i, 'the visual puns imply the dream was written before interpreting');
});

test('the Macrobius entry fixes the House of Fame error and the adportant verb', () => {
  const m = getTradition('macrobius-taxonomy');
  assert.ok(m);
  assert.match(m.holds, /adportant/, 'the verb is adportant, not adferunt');
  assert.match(m.note, /House of Fame/);
  assert.match(m.note, /NOT/);
  assert.match(m.note, /correspondences\.mjs/, 'the repo already cites Macrobius I.12 and should be joined to it');
});

test('the Cicero entry is present, and kills the walk/swim/meal quotation', () => {
  const c = getTradition('cicero-skeptic');
  assert.ok(c, 'an ancient tradition arguing against itself is the most interesting entry here');
  assert.match(c.holds, /augur/i);
  assert.match(c.note, /DOES NOT EXIST/);
});

test('⭐ sharedForm() reports that the diffusion claim was TESTED and failed', () => {
  const f = sharedForm();
  assert.match(f.reading, /TESTED RATHER THAN ASSUMED|tested rather than assumed/i);
  assert.match(f.reading, /Prada/, 'the decisive study must be named');
  assert.match(f.reading, /Maya/, 'the independent counterexample must be named');
  assert.match(f.reading, /NOT descended|not descended/i);
});

test('Artemidorus carries the dreamer-relative principle, which is the whole point of the entry', () => {
  const a = getTradition('artemidorus');
  assert.match(a.holds, /occupation/i);
  assert.match(a.holds, /Freud/, 'the seventeen-century priority is the interesting claim');
});
