// chunk-text.test.mjs — OFFLINE unit tests for chunkText(), countWords(), runCli().
// Pure transform: fixed strings only, no network, no disk (the CLI reader is injected).
//
//   node --test tools/chunk-text.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, countWords, runCli } from './chunk-text.mjs';

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('countWords counts whitespace-tokenized words', () => {
  assert.equal(countWords('a b  c\nd'), 4);
  assert.equal(countWords('   one   '), 1);
});

test('countWords soft-fails on empty / non-string', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   \n  '), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords(42), 0);
});

test('empty / whitespace input -> [] (soft-fail, never throws)', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  \t '), []);
  assert.deepEqual(chunkText(null), []);
  assert.deepEqual(chunkText(undefined), []);
});

test('single short paragraph -> one chunk, no overlap', () => {
  const r = chunkText('hello world from melek', { wordsPerChunk: 500 });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { index: 0, text: 'hello world from melek', wordCount: 4, startWord: 0, endWord: 3 });
});

test('packs paragraphs to ~wordsPerChunk on paragraph boundaries', () => {
  const text = `${words(30)}\n\n${words(30)}\n\n${words(30)}`;
  const r = chunkText(text, { wordsPerChunk: 50, overlap: 0 });
  // 30 + (30+30>50 so split) -> [30, 30, 30] packs to chunks of <=50 = [30],[30],[30]? no:
  // pack1=30; +30=60>50 emit; pack2=30; +30=60>50 emit; pack3=30 -> 3 chunks
  assert.equal(r.length, 3);
  for (const c of r) assert.equal(c.wordCount, 30);
});

test('carries configurable word overlap between adjacent chunks', () => {
  const text = `${words(40)}\n\n${words(40)}`;
  const r = chunkText(text, { wordsPerChunk: 50, overlap: 10 });
  assert.equal(r.length, 2);
  assert.equal(r[0].wordCount, 40);
  // second chunk = 10 overlap words + 40 = 50
  assert.equal(r[1].wordCount, 50);
  const tail = r[0].text.split(' ').slice(-10).join(' ');
  assert.ok(r[1].text.startsWith(tail), 'chunk 2 begins with chunk 1 tail');
});

test('startWord/endWord are contiguous across the overlap-inclusive stream', () => {
  const text = `${words(40)}\n\n${words(40)}`;
  const r = chunkText(text, { wordsPerChunk: 50, overlap: 10 });
  assert.equal(r[0].startWord, 0);
  assert.equal(r[0].endWord, 39);
  assert.equal(r[1].startWord, 40);
  assert.equal(r[1].endWord, 89);
});

test('a single paragraph larger than the cap is word-split', () => {
  const r = chunkText(words(120), { wordsPerChunk: 50, overlap: 0 });
  assert.equal(r.length, 3); // 50 + 50 + 20
  assert.deepEqual(r.map(c => c.wordCount), [50, 50, 20]);
});

test('overlap >= wordsPerChunk is clamped so packing still advances', () => {
  const r = chunkText(words(120), { wordsPerChunk: 50, overlap: 999 });
  assert.ok(r.length >= 3);
  // never an infinite loop / zero-progress chunk
  for (const c of r) assert.ok(c.wordCount > 0);
});

test('byParagraph:false treats text as one flat stream', () => {
  const text = `${words(20)}\n\n${words(20)}`;
  const r = chunkText(text, { wordsPerChunk: 50, overlap: 0, byParagraph: false });
  assert.equal(r.length, 1); // 40 words, flat, fits one chunk
  assert.equal(r[0].wordCount, 40);
});

test('defaults: 500 words / 50 overlap / paragraph-aware', () => {
  const r = chunkText(`${words(600)}\n\n${words(600)}`);
  assert.ok(r.length >= 2);
  // first chunk capped near 500
  assert.ok(r[0].wordCount <= 500);
});

test('deterministic: same input -> identical output', () => {
  const text = `${words(300)}\n\n${words(300)}\n\n${words(300)}`;
  assert.deepEqual(chunkText(text, { wordsPerChunk: 200, overlap: 25 }),
                   chunkText(text, { wordsPerChunk: 200, overlap: 25 }));
});

test('runCli with injected reader (no disk) returns stats JSON shape', () => {
  const fakeRead = (p) => { assert.equal(p, 'book.txt'); return `${words(120)}`; };
  const stats = runCli(['book.txt', '--words', '50', '--overlap', '0'], fakeRead);
  assert.equal(stats.file, 'book.txt');
  assert.equal(stats.wordsPerChunk, 50);
  assert.equal(stats.overlap, 0);
  assert.equal(stats.totalWords, 120);
  assert.equal(stats.chunkCount, 3);
  assert.equal(stats.chunks[0].index, 0);
  assert.ok('startWord' in stats.chunks[0] && 'endWord' in stats.chunks[0]);
});

test('runCli soft-fails on unreadable file -> empty chunks', () => {
  const boom = () => { throw new Error('no such file'); };
  const stats = runCli(['missing.txt'], boom, () => '');
  assert.equal(stats.chunkCount, 0);
  assert.deepEqual(stats.chunks, []);
});

test('runCli reads stdin when no file arg', () => {
  const stats = runCli(['--words', '50'], () => '', () => words(60));
  assert.equal(stats.file, '(stdin)');
  assert.equal(stats.totalWords, 60);
  assert.ok(stats.chunkCount >= 1);
});
