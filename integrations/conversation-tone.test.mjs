// integrations/conversation-tone.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TONES,
  selectTone,
  toneGuidance,
  describe,
} from './conversation-tone.mjs';

const IDS = ['welcoming', 'friendly', 'intellectual', 'cautious', 'balanced'];

test('TONES is a frozen list with the five backlog labels', () => {
  assert.ok(Object.isFrozen(TONES));
  assert.deepEqual(TONES.map((t) => t.id).sort(), [...IDS].sort());
  for (const t of TONES) {
    assert.ok(Object.isFrozen(t));
    assert.equal(typeof t.id, 'string');
    assert.equal(typeof t.label, 'string');
    assert.equal(typeof t.guidance, 'string');
    assert.ok(t.guidance.length > 0);
  }
});

test('guidance is a disposition note, NOT a scripted greeting (BRIEF.md §3)', () => {
  // No tone's guidance should read as a canned line of dialogue addressed to
  // the user (a greeting / second-person opener). It must describe HOW to speak.
  const greetingTells = [
    /^\s*hello\b/i,
    /^\s*hi\b/i,
    /^\s*hey\b/i,
    /^\s*greetings\b/i,
    /^\s*welcome\b/i,
    /^\s*good (morning|afternoon|evening)\b/i,
  ];
  for (const t of TONES) {
    for (const re of greetingTells) {
      assert.ok(!re.test(t.guidance), `${t.id} guidance looks like a scripted greeting`);
    }
    // It should read as instruction/style, not first-person witness speech.
    assert.ok(!/\bi am\b/i.test(t.guidance), `${t.id} guidance speaks in-character instead of advising`);
  }
});

test('low trust => cautious (dominates other signals)', () => {
  assert.equal(selectTone({ trust: 0.1, warmth: 0.9, familiarity: 0.9, respect: 0.9 }), 'cautious');
  assert.equal(selectTone({ trust: 0.29 }), 'cautious');
});

test('high warmth + high familiarity => welcoming', () => {
  assert.equal(selectTone({ trust: 0.7, warmth: 0.9, familiarity: 0.9 }), 'welcoming');
});

test('warm + familiar but not maxed => friendly', () => {
  assert.equal(selectTone({ trust: 0.6, warmth: 0.65, familiarity: 0.65 }), 'friendly');
  assert.equal(selectTone({ trust: 0.6, warmth: 0.7, familiarity: 0.4 }), 'friendly');
});

test('high respect + intellectual interest => intellectual', () => {
  assert.equal(
    selectTone({ trust: 0.6, respect: 0.8, interests: ['philosophy'] }),
    'intellectual',
  );
  // case-insensitive + mixed list
  assert.equal(
    selectTone({ trust: 0.5, respect: 0.7, interests: ['cooking', 'ESOTERIC'] }),
    'intellectual',
  );
});

test('high respect WITHOUT intellectual interest does NOT go intellectual', () => {
  assert.equal(
    selectTone({ trust: 0.6, respect: 0.9, interests: ['cooking'] }),
    'balanced',
  );
});

test('nothing strong => balanced (trust above the cautious floor)', () => {
  assert.equal(selectTone({ trust: 0.5, warmth: 0.4, respect: 0.4, familiarity: 0.3 }), 'balanced');
  // trust 0.5 alone, no other strong signal
  assert.equal(selectTone({ trust: 0.5 }), 'balanced');
});

test('selectTone soft-fails to balanced on bad input', () => {
  assert.equal(selectTone(), 'balanced');
  assert.equal(selectTone(null), 'balanced');
  assert.equal(selectTone('nope'), 'balanced');
  assert.equal(selectTone([]), 'balanced');
  assert.equal(selectTone(42), 'balanced');
  // junk scalar values clamp/coerce to no-signal => balanced, do not throw
  assert.equal(selectTone({ trust: 'high', warmth: NaN, interests: 'oops' }), 'balanced');
  // an empty object is no-signal => balanced (not cautious)
  assert.equal(selectTone({}), 'balanced');
});

test('out-of-range scalars clamp to [0,1]', () => {
  // trust 5 -> 1 (not low), warmth/fam 9 -> 1 -> welcoming
  assert.equal(selectTone({ trust: 5, warmth: 9, familiarity: 9 }), 'welcoming');
  // negative trust -> 0 -> cautious
  assert.equal(selectTone({ trust: -3, warmth: 1, familiarity: 1 }), 'cautious');
});

test('toneGuidance returns the matching style note; unknown id soft-fails to balanced', () => {
  for (const t of TONES) {
    assert.equal(toneGuidance(t.id), t.guidance);
  }
  const balanced = TONES.find((t) => t.id === 'balanced');
  assert.equal(toneGuidance('does-not-exist'), balanced.guidance);
  assert.equal(toneGuidance(undefined), balanced.guidance);
});

test('describe returns tone, label, guidance, and normalized scores', () => {
  const d = describe({ trust: 0.9, warmth: 0.85, familiarity: 0.9, respect: 0.2, interests: ['Philosophy'] });
  assert.equal(d.tone, 'welcoming');
  assert.equal(d.label, 'Welcoming');
  assert.equal(typeof d.guidance, 'string');
  assert.deepEqual(d.scores, {
    trust: 0.9,
    warmth: 0.85,
    respect: 0.2,
    familiarity: 0.9,
    interests: ['philosophy'],
  });
});

test('describe soft-fails to balanced with zeroed scores on bad input', () => {
  const d = describe(null);
  assert.equal(d.tone, 'balanced');
  assert.deepEqual(d.scores, { trust: 0, warmth: 0, respect: 0, familiarity: 0, interests: [] });
});

test('describe output guidance is not a fixed greeting', () => {
  const d = describe({ trust: 0.9, warmth: 0.9, familiarity: 0.9 });
  assert.ok(!/^\s*(hello|hi|welcome)\b/i.test(d.guidance));
});
