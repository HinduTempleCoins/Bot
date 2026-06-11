// book-chunker.test.mjs — offline unit tests for the smart paragraph chunker.
// node:test, node:assert/strict, no network, no model. Asserts word-count bounds, overlap
// continuity, and whole-paragraph integrity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, estimateChunks } from './book-chunker.mjs';

// Build a paragraph of N distinct words: "p<tag>w0 p<tag>w1 ...".
function para(tag, n) {
  const w = [];
  for (let i = 0; i < n; i++) w.push(`${tag}w${i}`);
  return w.join(' ');
}

const wc = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

test('soft-fail: empty / non-string / whitespace input returns []', () => {
  for (const bad of ['', '   \n\n  ', null, undefined, 42, {}, [], NaN]) {
    assert.deepEqual(chunkText(bad), []);
    assert.equal(estimateChunks(bad), 0);
  }
});

test('short single paragraph -> exactly one chunk, no overlap remnant', () => {
  const text = para('a', 10);
  const chunks = chunkText(text, { targetWords: 500, overlapWords: 50 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[0].wordCount, 10);
  assert.equal(chunks[0].startWord, 0);
  assert.equal(chunks[0].endWord, 10);
  assert.equal(estimateChunks(text, { targetWords: 500, overlapWords: 50 }), 1);
});

test('packs whole paragraphs up to the word target', () => {
  // 6 paras of 100 words, target 250 -> packs 2 per chunk (200) since a 3rd (300) overflows.
  const text = [0, 1, 2, 3, 4, 5].map((i) => para(`p${i}`, 100)).join('\n\n');
  const chunks = chunkText(text, { targetWords: 250, overlapWords: 0 });
  // With overlap 0 and 600 words at 200/chunk -> 3 chunks.
  assert.equal(chunks.length, 3);
  for (const c of chunks) {
    assert.equal(c.wordCount, 200, 'each chunk holds two whole 100-word paragraphs');
  }
});

test('word-count bound: no chunk exceeds the target (paragraphs that fit)', () => {
  const text = [...Array(20)].map((_, i) => para(`p${i}`, 80)).join('\n\n');
  const target = 500;
  const chunks = chunkText(text, { targetWords: target, overlapWords: 40 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.wordCount <= target, `chunk ${c.index} has ${c.wordCount} <= ${target}`);
    assert.ok(c.wordCount > 0);
    assert.equal(c.wordCount, wc(c.text), 'wordCount matches actual text');
  }
});

test('over-long single paragraph is split at word boundaries into target-sized pieces', () => {
  const target = 100;
  const text = para('big', 1000); // one giant paragraph, no blank lines
  const chunks = chunkText(text, { targetWords: target, overlapWords: 0 });
  // 1000 words / 100 = 10 pieces.
  assert.equal(chunks.length, 10);
  for (const c of chunks) {
    assert.equal(c.wordCount, target);
    // no word was split mid-token: every token still starts with the tag
    for (const tok of c.text.split(' ')) assert.ok(tok.startsWith('bigw'));
  }
  // contiguous, no gaps (overlap 0)
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(chunks[i].startWord, chunks[i - 1].endWord);
  }
});

test('overlap continuity: each chunk after the first repeats the prior tail words', () => {
  const target = 120;
  const overlap = 30;
  const text = para('seq', 1000);
  const chunks = chunkText(text, { targetWords: target, overlapWords: overlap });
  assert.ok(chunks.length >= 2);
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1].text.split(' ');
    const cur = chunks[i].text.split(' ');
    const prevTail = prev.slice(prev.length - overlap);
    const curHead = cur.slice(0, overlap);
    assert.deepEqual(curHead, prevTail, `chunk ${i} head equals chunk ${i - 1} tail`);
    // absolute offsets reflect the overlap
    assert.equal(chunks[i].startWord, chunks[i - 1].endWord - overlap);
  }
});

test('overlap continuity covers every original word with no gaps', () => {
  const target = 200;
  const overlap = 25;
  const total = 1337;
  const text = para('cov', total);
  const chunks = chunkText(text, { targetWords: target, overlapWords: overlap });
  // First chunk starts at 0; chunks fully cover [0, total).
  assert.equal(chunks[0].startWord, 0);
  assert.equal(chunks[chunks.length - 1].endWord, total);
  for (let i = 1; i < chunks.length; i++) {
    // contiguous coverage: next start is within the previous chunk (overlap), never beyond its end
    assert.ok(chunks[i].startWord <= chunks[i - 1].endWord, `no gap before chunk ${i}`);
  }
});

test('paragraph integrity: a paragraph that fits is never split across chunks', () => {
  // Two 200-word paragraphs, target 250. Para 1 fits alone; adding para 2 (->400) overflows,
  // so para 2 must move WHOLE to the next chunk, not be split.
  const text = [para('one', 200), para('two', 200)].join('\n\n');
  const chunks = chunkText(text, { targetWords: 250, overlapWords: 0 });
  assert.equal(chunks.length, 2);
  // chunk 0 is entirely para "one"
  for (const tok of chunks[0].text.split(' ')) assert.ok(tok.startsWith('onew'));
  // chunk 1 is entirely para "two"
  for (const tok of chunks[1].text.split(' ')) assert.ok(tok.startsWith('twow'));
});

test('estimateChunks matches chunkText length across configs', () => {
  const text = [...Array(15)].map((_, i) => para(`p${i}`, 73)).join('\n\n');
  for (const opts of [
    {},
    { targetWords: 100, overlapWords: 10 },
    { targetWords: 500, overlapWords: 50 },
    { targetWords: 50, overlapWords: 49 },
  ]) {
    assert.equal(estimateChunks(text, opts), chunkText(text, opts).length);
  }
});

test('clamped opts never throw and still make forward progress', () => {
  const text = para('x', 300);
  // overlap >= target gets clamped; garbage numbers fall back to defaults.
  const a = chunkText(text, { targetWords: 50, overlapWords: 999 });
  assert.ok(a.length >= 1);
  const b = chunkText(text, { targetWords: -5, overlapWords: 'nope', splitOn: 7 });
  assert.ok(b.length >= 1);
  // indices are dense and sequential
  a.forEach((c, i) => assert.equal(c.index, i));
  b.forEach((c, i) => assert.equal(c.index, i));
});

test('custom splitOn delimiter is honored', () => {
  const text = `${para('a', 100)}|||${para('b', 100)}|||${para('c', 100)}`;
  const chunks = chunkText(text, { targetWords: 250, overlapWords: 0, splitOn: '|||' });
  assert.equal(chunks.length, 2); // 100+100 then 100
  assert.equal(chunks[0].wordCount, 200);
  assert.equal(chunks[1].wordCount, 100);
});
