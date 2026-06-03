import { test } from 'node:test';
import assert from 'node:assert';
import {
  CONCEPTS,
  compare,
  learnUserInterpretation,
  getUserInterpretation,
  frameFor,
  resolveConcept,
  traditions,
} from './consciousness-framing.mjs';

test('catalog spans multiple distinct traditions (comparative, not single-tradition)', () => {
  const keys = Object.keys(CONCEPTS);
  assert.ok(keys.length >= 6, 'several concepts catalogued');
  // expected anchors from the brief are present
  for (const c of ['atman', 'ba', 'ka', 'pneuma', 'psyche', 'ruah', 'thetan', 'jiva']) {
    assert.ok(CONCEPTS[c], `${c} is in the catalog`);
  }
  assert.ok(traditions().length >= 5, 'multiple distinct traditions represented');
  // each entry carries tradition, gloss, and a source-note
  for (const [k, e] of Object.entries(CONCEPTS)) {
    assert.ok(e.tradition, `${k} has a tradition`);
    assert.ok(e.gloss, `${k} has a gloss`);
    assert.ok(e.sourceNote, `${k} has a source-note`);
  }
});

test('resolveConcept handles canonical keys and aliases', () => {
  assert.equal(resolveConcept('atman'), 'atman');
  assert.equal(resolveConcept('ATMA'), 'atman'); // alias + case-insensitive
  assert.equal(resolveConcept('ruach'), 'ruah'); // alias
  assert.equal(resolveConcept('chi'), 'qi');
  assert.equal(resolveConcept('not-a-concept'), null);
});

test('compare returns both glosses, neutrally, asserting neither', () => {
  const r = compare('atman', 'ruah');
  assert.equal(r.ok, true);
  assert.equal(r.a.concept, 'atman');
  assert.equal(r.b.concept, 'ruah');
  assert.ok(r.a.gloss && r.b.gloss, 'both glosses present');
  assert.ok(r.a.tradition !== r.b.tradition, 'two different traditions');
  // neutral framing: no claim of truth, no claim of sameness
  assert.match(r.note, /Neither is asserted as true/i);
  assert.match(r.note, /not claimed to be the same/i);
});

test('compare reports unknown concepts instead of asserting', () => {
  const r = compare('atman', 'nope');
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ['nope']);
});

test('user interpretation is stored verbatim and surfaced as the user\'s own', () => {
  const ret = learnUserInterpretation('userA', 'atman', 'for me, the quiet watcher behind every thought');
  assert.equal(ret.concept, 'atman');
  assert.equal(getUserInterpretation('userA', 'atman'), 'for me, the quiet watcher behind every thought');
  // alias-keyed lookups land on the same stored meaning
  assert.equal(getUserInterpretation('userA', 'ATMA'), 'for me, the quiet watcher behind every thought');
  // a different user has not set anything
  assert.equal(getUserInterpretation('userB', 'atman'), null);
});

test('learnUserInterpretation rejects unknown concept / empty inputs', () => {
  assert.throws(() => learnUserInterpretation('u', 'nope', 'x'), /unknown concept/);
  assert.throws(() => learnUserInterpretation('', 'atman', 'x'), /userId required/);
  assert.throws(() => learnUserInterpretation('u', 'atman', '   '), /meaning required/);
});

test('frameFor asserts nothing: comparison set present, no verdict, user meaning labeled as theirs', () => {
  // before learning: no user interpretation, still asserts nothing
  const before = frameFor('userC', 'psyche');
  assert.equal(before.ok, true);
  assert.equal(before.asserts, false, 'frameFor never asserts');
  assert.equal(before.concept.concept, 'psyche');
  assert.ok(before.comparison.length >= 5, 'other traditions offered as comparison');
  assert.ok(!before.comparison.some((c) => c.concept === 'psyche'), 'focal concept excluded from comparison set');
  assert.equal(before.userInterpretation, null, 'no user meaning yet');
  assert.match(before.note, /Nothing here is asserted as true/i);

  // after learning: user's own meaning surfaces, still asserting nothing
  learnUserInterpretation('userC', 'psyche', 'the mind that learns');
  const after = frameFor('userC', 'psyche');
  assert.equal(after.asserts, false);
  assert.equal(after.userInterpretation, 'the mind that learns');
  assert.match(after.note, /your own interpretation/i);
  assert.match(after.note, /Nothing here is asserted as true/i);
});

test('frameFor handles unknown concept without asserting', () => {
  const r = frameFor('userC', 'nope');
  assert.equal(r.ok, false);
  assert.equal(r.asserts, false);
});
