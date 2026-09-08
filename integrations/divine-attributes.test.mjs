// divine-attributes.test.mjs — OFFLINE, pure data. No network, no clock.
//
// The tests that matter are the ones that keep the TWO DATES apart. The whole value of this file is
// that an ancient object and a modern explanation of it cannot end up in the same undifferentiated
// row — which is precisely what every popular correspondence chart does.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTRIBUTES, KINDS, TIERS, DEITIES, TRADITIONS,
  forDeity, byKind, byTradition, kindAcrossTraditions,
  retrofitted, tracers, undated, parallels, validate, handler, esc,
} from './divine-attributes.mjs';

// --- shape -------------------------------------------------------------------

test('every attribute carries a source, a meaning, and BOTH datings', () => {
  const v = validate();
  assert.equal(v.ok, true, v.problems.join('\n'));
});

test('the tier ladder is imported from pantheon-map, not restated', async () => {
  const pm = await import('./pantheon-map.mjs');
  assert.deepEqual(TIERS, pm.TIERS, 'a second tier ladder would let the two files disagree');
});

test('every kind used is a declared kind', () => {
  for (const a of ATTRIBUTES) assert.ok(KINDS.includes(a.kind), `${a.name} has kind ${a.kind}`);
});

test('all five kinds are actually populated — the operator asked for each', () => {
  for (const k of KINDS) assert.ok(byKind(k).length > 0, `no attribute of kind ${k}`);
});

// --- the point of the file ---------------------------------------------------

test('an object and its meaning are dated SEPARATELY and can disagree', () => {
  const owl = ATTRIBUTES.find((a) => a.deity === 'athena' && /owl/.test(a.name));
  assert.ok(owl.attested < -500, 'the owl is on 6th-century BC coinage');
  assert.ok(owl.meaningAttested > 1000, '"the owl means wisdom" is a much later gloss');
  assert.notEqual(owl.tier, owl.meaningTier, 'the object is evidenced; the gloss is not');
});

test('retrofitted() finds the rows where a modern meaning rides an ancient object', () => {
  const r = retrofitted();
  assert.ok(r.length > 0);
  assert.ok(r.some((x) => x.deity === 'athena'), 'the owl is the canonical case and must appear');
  // Sorted with the widest gap first — the worst offender should be readable off the top.
  const gaps = r.map((x) => x.gapYears || 0);
  assert.deepEqual(gaps, [...gaps].sort((a, b) => b - a));
});

test('a row where object and meaning are the SAME age is not flagged', () => {
  const bolt = ATTRIBUTES.find((a) => a.deity === 'zeus' && /keraunos/.test(a.name));
  assert.equal(bolt.attested, bolt.meaningAttested, 'Hesiod gives the bolt and says what it is for');
  assert.ok(!retrofitted().some((r) => r.name === bolt.name), 'a same-age row must not be called retrofitted');
});

test('the minimum gap is tunable — a stricter threshold returns fewer dated rows', () => {
  const wide = retrofitted({ minGap: 2000 }).filter((r) => r.gapYears != null);
  const narrow = retrofitted({ minGap: 200 }).filter((r) => r.gapYears != null);
  assert.ok(wide.length < narrow.length);
  assert.ok(wide.every((r) => r.gapYears >= 2000));
});

// --- the caduceus, which is the whole argument in one row --------------------

test('the caduceus records the 1902 medical error and does not repeat it', () => {
  const k = ATTRIBUTES.find((a) => /kerykeion|caduceus/i.test(a.name));
  assert.match(k.note, /1902/, 'the date of the US Army Medical Corps adoption must be named');
  assert.match(k.note, /Asclepius/, 'the correct physician emblem must be named');
  assert.match(k.meaning, /herald|passage/i, 'the ancient meaning is heraldic, not medical');
  assert.ok(!/medicine|medical/i.test(k.meaning), 'the medical reading must never be stated as the meaning');
});

test('tracers() surfaces the nameable errors', () => {
  const t = tracers();
  assert.ok(t.length > 0);
  assert.ok(t.every((x) => String(x.note).includes('⚠️')));
});

// --- honesty about gaps ------------------------------------------------------

test('an undated attribute says so rather than carrying a guessed year', () => {
  const u = undated();
  for (const a of u) {
    assert.equal(a.attested, null, 'undated must be null, never 0 or a placeholder');
    assert.ok(a.source, 'an undated row still needs a source for the practice itself');
  }
});

test('no attribute claims a meaning tier stronger than its object tier without saying why', () => {
  // A meaning cannot be better evidenced than the thing it explains unless a note argues it.
  for (const a of ATTRIBUTES) {
    if (a.meaningAttested == null) continue;
    const stronger = TIERS.indexOf(a.meaningTier) > TIERS.indexOf(a.tier);
    if (stronger) assert.ok(a.note, `${a.deity}/${a.name} claims a stronger meaning tier with no note`);
  }
});

test('the Norse block carries its late-attestation caveat somewhere', () => {
  const norse = byTradition('norse');
  assert.ok(norse.length > 0);
  // Snorri is 13th century; nothing Norse may claim an ancient textual attestation.
  for (const a of norse) assert.ok(a.attested >= 800, `${a.name} claims a pre-Viking text date`);
});

// The obvious assertion here — "the vajra is the oldest attribute" — is FALSE, and the reason is
// worth keeping. Egyptian ibis and scribal-palette iconography is older (-3000, -2400) than the
// Rigveda (-1200). What the vajra is oldest at is TEXTUAL attestation: the older Egyptian rows are
// `epigraphic`, evidenced by images and objects rather than by a sentence. Those are different kinds
// of evidence and the file should not let them be compared as if they were one scale.
test('the vajra is the oldest TEXTUALLY attested attribute — but not the oldest attribute', () => {
  const v = ATTRIBUTES.find((a) => /vajra/i.test(a.name));
  const oldestTextual = Math.min(...ATTRIBUTES.filter((a) => a.attested != null && a.tier === 'attested').map((a) => a.attested));
  assert.equal(v.attested, oldestTextual, 'the Rigveda is the earliest text in the file');
  assert.match(v.note, /Indo-European/);

  const oldestOfAll = Math.min(...ATTRIBUTES.filter((a) => a.attested != null).map((a) => a.attested));
  assert.ok(oldestOfAll < v.attested, 'Egyptian iconography predates the Rigveda');
  const older = ATTRIBUTES.filter((a) => a.attested != null && a.attested < v.attested);
  assert.ok(older.every((a) => a.tier === 'epigraphic'),
    'anything older than the Rigveda here must be evidenced by objects/images, not by a text');
});

// --- lookups -----------------------------------------------------------------

test('forDeity is exact, not fuzzy — a partial name returns nothing', () => {
  assert.ok(forDeity('shiva').length >= 3);
  assert.equal(forDeity('shiv').length, 0, 'fuzzy matching would silently merge deities');
});

test('forDeity is case- and whitespace-insensitive', () => {
  assert.equal(forDeity(' SHIVA ').length, forDeity('shiva').length);
});

test('kindAcrossTraditions groups a kind by tradition', () => {
  const m = kindAcrossTraditions('weapon');
  assert.ok(m.size >= 3, 'weapons should span several traditions');
  assert.ok(m.get('greek').some((x) => /keraunos/.test(x.name)));
});

test('parallels returns the cross-tradition set for a kind', () => {
  const p = parallels('instrument');
  assert.ok(p.length >= 3);
  assert.ok(p.some((x) => x.tradition === 'egyptian'), 'the sistrum belongs in the instrument set');
});

test('DEITIES and TRADITIONS are derived, deduped and sorted', () => {
  assert.deepEqual(DEITIES, [...new Set(DEITIES)].sort());
  assert.deepEqual(TRADITIONS, [...new Set(TRADITIONS)].sort());
});

// --- robustness --------------------------------------------------------------

test('lookups never throw on junk', () => {
  for (const v of [null, undefined, 0, '', [], {}, 'nonsense']) {
    assert.doesNotThrow(() => forDeity(v));
    assert.doesNotThrow(() => byKind(v));
    assert.doesNotThrow(() => byTradition(v));
    assert.doesNotThrow(() => parallels(v));
    assert.deepEqual(forDeity(v).length >= 0, true);
  }
});

test('esc neutralises markup and never throws', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;');
  for (const v of [null, undefined, 0, {}, []]) assert.doesNotThrow(() => esc(v));
});

test('handler serves counts and states what the file is for', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.counts.attributes, ATTRIBUTES.length);
  assert.match(j.note, /dated twice/);
});
