import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textStats, fleschReadingEase, fleschKincaidGrade,
  readingTimeMinutes, syllablesInWord, countSyllables,
} from './readability-stats.mjs';

// ---- textStats happy path ----

test('textStats counts words, sentences, syllables and averages', () => {
  const s = textStats('The cat sat. The dog ran fast!');
  assert.equal(s.words, 7);
  assert.equal(s.sentences, 2);
  assert.equal(s.chars, 30);
  assert.ok(s.syllables >= 7); // each one-syllable word floors at 1
  assert.equal(s.avgWordsPerSentence, 3.5);
  assert.ok(s.avgSyllablesPerWord > 0);
});

test('textStats handles a single sentence with no terminator', () => {
  const s = textStats('hello world');
  assert.equal(s.words, 2);
  assert.equal(s.sentences, 1); // segment with words counts even without "."
});

test("apostrophes keep contractions as one word", () => {
  const s = textStats("don't stop");
  assert.equal(s.words, 2);
});

test('multiple terminators do not inflate sentence count', () => {
  const s = textStats('Wow!!! Really??? Yes.');
  assert.equal(s.sentences, 3);
});

// ---- syllable heuristic (approximate) ----

test('syllablesInWord floors at 1 for any lettered word', () => {
  assert.equal(syllablesInWord('a'), 1);
  assert.equal(syllablesInWord('cat'), 1);
});

test('syllablesInWord silent-e adjustment', () => {
  assert.equal(syllablesInWord('make'), 1); // "make" -> 1, not 2
  assert.equal(syllablesInWord('cake'), 1);
});

test("syllablesInWord consonant+'le' ending adds a syllable", () => {
  assert.equal(syllablesInWord('table'), 2);
  assert.equal(syllablesInWord('candle'), 2);
});

test('syllablesInWord multi-syllable words', () => {
  assert.equal(syllablesInWord('beautiful'), 3); // beau-ti-ful (vowel groups)
  assert.ok(syllablesInWord('readability') >= 4);
});

test('countSyllables sums across the text', () => {
  assert.equal(countSyllables('cat dog'), 2);
});

// ---- Flesch metrics ----

test('fleschReadingEase is clamped to 0..100', () => {
  const easy = fleschReadingEase('The cat sat on the mat.');
  assert.ok(easy >= 0 && easy <= 100);
  // a very long dense single sentence should drive ease low but never below 0
  const dense = fleschReadingEase('Antidisestablishmentarianism characterizes unconscionable bureaucratic institutionalization perpetuating incomprehensible administrative complications.');
  assert.ok(dense >= 0 && dense <= 100);
});

test('easier text scores higher reading-ease than harder text', () => {
  const easy = fleschReadingEase('I like the dog. The dog is fun. We run a lot.');
  const hard = fleschReadingEase('The aforementioned epistemological framework necessitates comprehensive reconsideration.');
  assert.ok(easy > hard);
});

test('fleschKincaidGrade returns a finite number, not clamped', () => {
  const g = fleschKincaidGrade('The cat sat on the mat and looked around slowly.');
  assert.equal(typeof g, 'number');
  assert.ok(Number.isFinite(g));
});

// ---- reading time ----

test('readingTimeMinutes uses default 200 wpm', () => {
  const words = Array.from({ length: 400 }, () => 'word').join(' ');
  assert.equal(readingTimeMinutes(words), 2); // 400/200
});

test('readingTimeMinutes honors a custom wpm', () => {
  const words = Array.from({ length: 300 }, () => 'word').join(' ');
  assert.equal(readingTimeMinutes(words, 300), 1);
});

test('readingTimeMinutes falls back to 200 for bad wpm', () => {
  const words = Array.from({ length: 200 }, () => 'word').join(' ');
  assert.equal(readingTimeMinutes(words, 0), 1);
  assert.equal(readingTimeMinutes(words, -5), 1);
  assert.equal(readingTimeMinutes(words, NaN), 1);
});

// ---- soft-fail / edge cases (never throw) ----

test('empty string -> zeroed stats', () => {
  const s = textStats('');
  assert.equal(s.chars, 0);
  assert.equal(s.words, 0);
  assert.equal(s.sentences, 0);
  assert.equal(s.syllables, 0);
  assert.equal(s.avgWordsPerSentence, 0);
  assert.equal(s.avgSyllablesPerWord, 0);
});

test('non-string inputs -> zeroed stats, never throws', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    const s = textStats(bad);
    assert.equal(s.words, 0);
    assert.equal(fleschReadingEase(bad), 0);
    assert.equal(fleschKincaidGrade(bad), 0);
    assert.equal(readingTimeMinutes(bad), 0);
  }
});

test('whitespace / punctuation only -> zeroed metrics', () => {
  const s = textStats('   ...!!!   ');
  assert.equal(s.words, 0);
  assert.equal(s.sentences, 0);
  assert.equal(fleschReadingEase('   ...   '), 0);
  assert.equal(fleschKincaidGrade('   ...   '), 0);
});

test('syllablesInWord soft-fails on non-string', () => {
  assert.equal(syllablesInWord(null), 0);
  assert.equal(syllablesInWord(123), 0);
  assert.equal(syllablesInWord(''), 0);
});
