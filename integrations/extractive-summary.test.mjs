// extractive-summary.test.mjs — offline, no-network tests for the extractive summarizer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sentences, wordFreq, scoreSentences, summarize, keywords, esc, STOPWORDS,
} from './extractive-summary.mjs';

test('sentences: basic splitting on . ! ?', () => {
  const out = sentences('Hello world. How are you? I am fine!');
  assert.deepEqual(out, ['Hello world.', 'How are you?', 'I am fine!']);
});

test('sentences: "e.g." does not split a sentence', () => {
  const out = sentences('Use small tokens, e.g. words and digits, for the index. Then score them.');
  assert.equal(out.length, 2);
  assert.match(out[0], /e\.g\. words/);
});

test('sentences: "Dr." abbreviation does not split', () => {
  const out = sentences('Dr. Smith arrived early. He brought notes.');
  assert.equal(out.length, 2);
  assert.match(out[0], /^Dr\. Smith arrived early\.$/);
});

test('sentences: i.e. and U.S. abbreviations stay intact', () => {
  const out = sentences('The plan, i.e. the roadmap, ships in the U.S. soon. Done.');
  assert.equal(out.length, 2);
});

test('sentences: empty / whitespace / non-string -> []', () => {
  assert.deepEqual(sentences(''), []);
  assert.deepEqual(sentences('   \n\t  '), []);
  assert.deepEqual(sentences(null), []);
  assert.deepEqual(sentences(undefined), []);
  assert.deepEqual(sentences(42), []);
});

test('wordFreq: counts content words, drops stopwords, lowercases', () => {
  const f = wordFreq('The cat sat on the cat mat. The Cat ran.');
  assert.equal(f.cat, 3);
  assert.equal(f.mat, 1);
  assert.equal(f.ran, 1);
  assert.equal(f.the, undefined); // stopword removed
  assert.equal(f.on, undefined);
});

test('wordFreq: custom stopwords (array or Set) honored', () => {
  const f = wordFreq('alpha beta beta gamma', { stopwords: new Set(['beta']) });
  assert.equal(f.beta, undefined);
  assert.equal(f.alpha, 1);
  assert.equal(f.gamma, 1);
});

test('wordFreq: empty input -> no terms', () => {
  assert.deepEqual(Object.keys(wordFreq('')), []);
  assert.deepEqual(Object.keys(wordFreq(null)), []);
});

test('scoreSentences: returns one entry per sentence in original order', () => {
  const text = 'Cats love fish. Dogs love bones. Cats and dogs are pets.';
  const scored = scoreSentences(text);
  assert.equal(scored.length, 3);
  assert.deepEqual(scored.map((s) => s.index), [0, 1, 2]);
  for (const s of scored) assert.ok(Number.isFinite(s.score));
});

test('summarize: top-N selection preserves ORIGINAL order', () => {
  // Make sentence about "melek" most repeated so it scores high, but place it later.
  const text =
    'An unrelated opening line about weather and clouds. '
    + 'Witness melek witness melek produces blocks. '
    + 'A filler middle sentence with little signal here. '
    + 'The melek witness melek melek runs the feed.';
  const out = summarize(text, { maxSentences: 2 });
  // both high-signal melek sentences chosen; sentence 2 must appear before sentence 4 (original order).
  const idx2 = out.indexOf('Witness melek');
  const idx4 = out.indexOf('The melek witness');
  assert.ok(idx2 >= 0 && idx4 >= 0, `both sentences present: ${out}`);
  assert.ok(idx2 < idx4, 'original order preserved');
});

test('summarize: respects maxSentences count', () => {
  const text = 'One alpha. Two beta. Three gamma. Four delta. Five epsilon.';
  const out = summarize(text, { maxSentences: 2 });
  // should contain at most 2 sentence-terminators
  const terms = (out.match(/[.!?]/g) || []).length;
  assert.ok(terms <= 2, `expected <=2 sentences, got summary: ${out}`);
});

test('summarize: maxChars cap respected', () => {
  const text =
    'Alpha alpha alpha is the most important repeated topic here today. '
    + 'Beta beta covers a secondary subject in the document. '
    + 'Gamma is a third minor point worth a mention.';
  const out = summarize(text, { maxSentences: 3, maxChars: 70 });
  assert.ok(out.length <= 70, `summary length ${out.length} should be <= 70`);
  assert.ok(out.length > 0, 'summary should not be empty');
});

test('summarize: maxChars smaller than first sentence -> truncated, non-empty', () => {
  const text = 'A very long first sentence that exceeds the tiny character cap easily. Next one here.';
  const out = summarize(text, { maxSentences: 3, maxChars: 20 });
  assert.ok(out.length <= 20);
  assert.ok(out.length > 0);
});

test('summarize: empty / whitespace input -> empty string', () => {
  assert.equal(summarize(''), '');
  assert.equal(summarize('    \n  '), '');
  assert.equal(summarize(null), '');
  assert.equal(summarize(undefined), '');
});

test('keywords: returns top-N content terms by frequency', () => {
  const text = 'witness witness witness chain chain block. The witness signs the chain.';
  const kw = keywords(text, { n: 2 });
  assert.deepEqual(kw, ['witness', 'chain']);
});

test('keywords: default n=8 and empty input -> []', () => {
  assert.deepEqual(keywords(''), []);
  const many = keywords('a b c d e f g h i j k l m n o p alpha beta gamma delta epsilon zeta eta theta iota');
  assert.ok(many.length <= 8);
});

test('does not throw on adversarial input', () => {
  assert.doesNotThrow(() => summarize('!!! ??? ... '));
  assert.doesNotThrow(() => summarize('.'.repeat(1000)));
  assert.doesNotThrow(() => scoreSentences({}));
  assert.doesNotThrow(() => keywords([]));
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('STOPWORDS is a populated Set', () => {
  assert.ok(STOPWORDS instanceof Set);
  assert.ok(STOPWORDS.has('the'));
});
