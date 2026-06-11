// gematria.test.mjs — offline tests for the Hebrew/Greek gematria calculator (backlog 85b5ad36fb).
//
// Fully offline, no network, no IO. Covers happy paths against canonical textbook values plus
// edge / soft-fail behavior (empty, garbage, unknown system, non-letters, non-array).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEBREW_VALUES, GREEK_VALUES, gematria, ordinal, reduce, matches, esc,
} from './gematria.mjs';

test('tables are frozen and hold canonical values', () => {
  assert.ok(Object.isFrozen(HEBREW_VALUES));
  assert.ok(Object.isFrozen(GREEK_VALUES));
  assert.equal(HEBREW_VALUES['א'], 1);
  assert.equal(HEBREW_VALUES['ת'], 400);
  // final forms equal their base under mispar hechrachi
  assert.equal(HEBREW_VALUES['ך'], HEBREW_VALUES['כ']);
  assert.equal(HEBREW_VALUES['ם'], 40);
  assert.equal(GREEK_VALUES['α'], 1);
  assert.equal(GREEK_VALUES['ω'], 800);
  assert.equal(GREEK_VALUES['ς'], GREEK_VALUES['σ']); // final sigma
});

test('attempting to mutate a frozen table has no effect', () => {
  // ESM is strict mode, so writing to a frozen object throws; either way the value is unchanged.
  try { HEBREW_VALUES['א'] = 999; } catch { /* frozen */ }
  assert.equal(HEBREW_VALUES['א'], 1);
});

test('gematria Hebrew — canonical chai = 18', () => {
  assert.equal(gematria('חי', { system: 'hebrew' }), 18); // 8 + 10
});

test('gematria Hebrew — YHWH = 26', () => {
  assert.equal(gematria('יהוה', { system: 'hebrew' }), 26); // 10+5+6+5
});

test('gematria Greek isopsephy — canonical', () => {
  // alpha=1, omega=800
  assert.equal(gematria('αω', { system: 'greek' }), 801);
  // logos: λ30 ο70 γ3 ο70 ς200 = 373
  assert.equal(gematria('λογος', { system: 'greek' }), 373);
});

test("gematria 'standard' is an alias for the Greek table", () => {
  assert.equal(gematria('αω', { system: 'standard' }), gematria('αω', { system: 'greek' }));
});

test('gematria ignores spaces, punctuation, and unrecognized characters', () => {
  assert.equal(gematria('חי!! 123 חי', { system: 'hebrew' }), 36); // two chai, junk ignored
});

test('gematria is case-aware for Greek (uppercase keyed too)', () => {
  assert.equal(gematria('ΑΩ', { system: 'greek' }), 801);
});

test('ordinal — mispar siduri positions', () => {
  // het is the 8th letter, yod the 10th -> 18
  assert.equal(ordinal('חי', 'hebrew'), 18);
  // alef(1)+tav(22) = 23
  assert.equal(ordinal('את', 'hebrew'), 23);
  // greek: alpha is 1st, omega is the highest value -> last position (27 with archaic letters)
  assert.equal(ordinal('α', 'greek'), 1);
});

test('reduce — digital root 1-9', () => {
  assert.equal(reduce(18), 9);
  assert.equal(reduce(26), 8); // 2+6
  assert.equal(reduce(9), 9);
  assert.equal(reduce(100), 1);
  assert.equal(reduce(0), 0);
  assert.equal(reduce(-18), 9); // magnitude
});

test('matches — groups words by equal value, sorted ascending', () => {
  // both chai words = 18; YHWH = 26
  const groups = matches(['חי', 'יהוה', 'חי'], 'hebrew');
  assert.ok(Array.isArray(groups));
  assert.ok(Object.isFrozen(groups));
  const eighteen = groups.find(g => g.value === 18);
  assert.deepEqual(eighteen.words, ['חי']); // de-duplicated
  const twentySix = groups.find(g => g.value === 26);
  assert.deepEqual(twentySix.words, ['יהוה']);
  // ascending order
  const vals = groups.map(g => g.value);
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b));
});

test('matches — distinct words sharing a value are grouped together', () => {
  // both 'את' (alef+tav=401) and a contrived equal pair? use simple equal-value words:
  // 'אבג' = 1+2+3 = 6 ; 'ו' = 6
  const groups = matches(['אבג', 'ו'], 'hebrew');
  const six = groups.find(g => g.value === 6);
  assert.deepEqual(six.words, ['אבג', 'ו']);
});

// --- edge / soft-fail: never throws ---------------------------------------------------------

test('soft-fail — empty / null / undefined inputs return 0', () => {
  assert.equal(gematria('', { system: 'hebrew' }), 0);
  assert.equal(gematria(null, { system: 'hebrew' }), 0);
  assert.equal(gematria(undefined, { system: 'greek' }), 0);
  assert.equal(ordinal('', 'hebrew'), 0);
  assert.equal(ordinal(null, 'greek'), 0);
});

test('soft-fail — unknown system returns 0 / []', () => {
  assert.equal(gematria('חי', { system: 'klingon' }), 0);
  assert.equal(gematria('חי', {}), 0);
  assert.equal(gematria('חי'), 0);
  assert.equal(ordinal('חי', 'klingon'), 0);
  assert.deepEqual(matches(['חי'], 'klingon'), []);
});

test('soft-fail — pure garbage / non-letters returns 0', () => {
  assert.equal(gematria('!!! 12345 ??? ', { system: 'hebrew' }), 0);
  assert.equal(gematria('hello world', { system: 'greek' }), 0); // latin not in table
});

test('soft-fail — reduce on garbage / non-finite returns 0', () => {
  assert.equal(reduce(NaN), 0);
  assert.equal(reduce(Infinity), 0);
  assert.equal(reduce('not a number'), 0);
  assert.equal(reduce(undefined), 0);
  assert.equal(reduce(null), 0);
});

test('soft-fail — matches on non-array / empty returns []', () => {
  assert.deepEqual(matches(null, 'hebrew'), []);
  assert.deepEqual(matches('חי', 'hebrew'), []); // string is not an array
  assert.deepEqual(matches([], 'hebrew'), []);
});

test('matches — array with garbage entries groups them under value 0', () => {
  const groups = matches(['!!!', null, ''], 'hebrew');
  const zero = groups.find(g => g.value === 0);
  assert.ok(zero, 'should have a value-0 group');
  // all coerced to strings; '' and null -> '' deduped, '!!!' distinct
  assert.ok(zero.words.includes('!!!'));
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
