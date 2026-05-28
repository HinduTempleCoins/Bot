/**
 * Tests for cheetah/text-detection.js — the similarity engine that gates
 * every Cheetah comment. Wrong threshold = noise; wrong shingle = misses.
 * These tests lock the core math + the corpus-mode integration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { shingles, jaccard, findSimilarOnChain, detectText } from './text-detection.js';

test('shingles: exact-match strings produce identical sets', () => {
  const a = shingles('the quick brown fox jumps over the lazy dog');
  const b = shingles('the quick brown fox jumps over the lazy dog');
  assert.equal(a.size, b.size);
  assert.equal(jaccard(a, b), 1);
});

test('shingles: very short text falls back to whole-text hash', () => {
  // 3 words < default shingle size 5 → single-hash fallback
  const s = shingles('hello there friend');
  assert.equal(s.size, 1);
});

test('shingles: empty text returns empty set', () => {
  const s = shingles('');
  assert.equal(s.size, 0);
});

test('shingles: case + punctuation normalized', () => {
  const a = shingles('The Quick, brown FOX jumps over the LAZY dog!');
  const b = shingles('the quick brown fox jumps over the lazy dog');
  // Should match because tokenize lowercases + strips punctuation
  assert.equal(jaccard(a, b), 1);
});

test('jaccard: disjoint sets return 0', () => {
  const a = new Set(['x', 'y', 'z']);
  const b = new Set(['p', 'q', 'r']);
  assert.equal(jaccard(a, b), 0);
});

test('jaccard: half-overlap returns ~0.33 (|A∩B|/|A∪B|)', () => {
  const a = new Set(['x', 'y', 'z']);
  const b = new Set(['y', 'p', 'q']);
  // intersection = 1, union = 5, 1/5 = 0.2
  assert.equal(jaccard(a, b), 0.2);
});

test('jaccard: identical sets return 1', () => {
  const a = new Set(['x', 'y']);
  const b = new Set(['x', 'y']);
  assert.equal(jaccard(a, b), 1);
});

test('jaccard: one empty set returns 0', () => {
  assert.equal(jaccard(new Set(), new Set(['x'])), 0);
});

test('findSimilarOnChain: empty corpus returns no matches', async () => {
  const r = await findSimilarOnChain('any text', { corpus: [] });
  assert.equal(r.matches.length, 0);
  assert.match(r.note, /no corpus|offline/);
});

test('findSimilarOnChain: ranks by jaccard descending', async () => {
  const corpus = [
    { author: 'a', permlink: 'p1', body: 'lorem ipsum dolor sit amet consectetur adipiscing' },
    { author: 'b', permlink: 'p2', body: 'completely unrelated text about gardening and bees' },
    { author: 'c', permlink: 'p3', body: 'lorem ipsum dolor sit amet thing different ending' },
  ];
  const r = await findSimilarOnChain(
    'lorem ipsum dolor sit amet consectetur adipiscing elit',
    { corpus, limit: 3 }
  );
  assert.equal(r.matches.length, 3);
  // strongest match (a) ranks first; weakest (b, gardening) ranks last
  assert.equal(r.matches[0].author, 'a');
  assert.equal(r.matches[2].author, 'b');
  // confidence is the jaccard score
  assert.ok(r.matches[0].confidence > r.matches[1].confidence);
  assert.ok(r.matches[1].confidence > r.matches[2].confidence);
});

test('detectText: no match when confidence below threshold', async () => {
  const corpus = [
    { author: 'a', permlink: 'p1', body: 'completely unrelated text about gardening' },
  ];
  // Default SIMILARITY_THRESHOLD = 0.5; the gardening text shares almost
  // nothing with the query.
  const r = await detectText('quantum physics quantum chromodynamics QFT calculations', { corpus });
  assert.equal(r.match, false);
  assert.equal(r.source, null);
});

test('detectText: match when confidence above threshold', async () => {
  const original = 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule.';
  const borrowed = 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule. I find this interesting.';
  const r = await detectText(borrowed, { corpus: [{ author: 'orig', permlink: 'p1', body: original }] });
  assert.equal(r.match, true);
  assert.equal(r.source.kind, 'on-chain');
  assert.equal(r.source.author, 'orig');
  assert.ok(r.confidence >= 0.5);
});

test('detectText: returns all_matches even when no match passes threshold', async () => {
  const corpus = [
    { author: 'a', permlink: 'p1', body: 'word1 word2 word3 word4 word5 word6' },
    { author: 'b', permlink: 'p2', body: 'completely unrelated' },
  ];
  const r = await detectText('something different entirely', { corpus });
  // all_matches still populated (for diagnostic / debug)
  assert.ok(Array.isArray(r.all_matches));
});
