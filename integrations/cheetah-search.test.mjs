// cheetah-search.test.mjs — OFFLINE tests. Run ONLY:
//   node --test integrations/cheetah-search.test.mjs
//
// No network: the PURE functions (similarityScore / bestMatch / tokenize) need none, and findSources is
// exercised with INJECTED fake source-finders via the `sources` param. Nothing here touches scraper /
// library-catalog / nft-search at runtime.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findSources, similarityScore, bestMatch, tokenize } from './cheetah-search.mjs';

// ── similarityScore: PURE ───────────────────────────────────────────────────────────────────────
test('similarityScore: identical text scores high (=1)', () => {
  const t = 'The Phoenix Protocol describes a method for recovery and continuity over time';
  assert.equal(similarityScore(t, t), 1);
});

test('similarityScore: disjoint text scores low (~0)', () => {
  const a = 'quantum entanglement photons decoherence interferometer';
  const b = 'banana smoothie pancake breakfast kitchen recipe';
  const s = similarityScore(a, b);
  assert.ok(s < 0.05, `expected ~0, got ${s}`);
});

test('similarityScore: partial overlap lands in the middle', () => {
  const original = 'the phoenix protocol describes a method for recovery and continuity';
  const partial = 'the phoenix protocol explains a process for recovery and growth';
  const s = similarityScore(original, partial);
  assert.ok(s > 0.1 && s < 0.9, `expected mid-range, got ${s}`);
});

test('similarityScore: near-verbatim ranks above topic-only overlap', () => {
  const suspect = 'cryptography secures messages using mathematical one-way functions';
  const verbatim = 'cryptography secures messages using mathematical one-way functions today';
  const topical = 'mathematical functions appear in many cryptography textbooks and courses';
  assert.ok(similarityScore(suspect, verbatim) > similarityScore(suspect, topical));
});

test('similarityScore: empty/whitespace input → 0', () => {
  assert.equal(similarityScore('', 'anything here'), 0);
  assert.equal(similarityScore('anything here', ''), 0);
  assert.equal(similarityScore('   ', '   '), 0);
});

test('similarityScore: bounded in [0,1] and symmetric', () => {
  const a = 'alpha beta gamma delta epsilon';
  const b = 'gamma delta epsilon zeta eta';
  const s = similarityScore(a, b);
  assert.ok(s >= 0 && s <= 1);
  assert.equal(similarityScore(a, b), similarityScore(b, a));
});

test('tokenize: lowercases, drops stopwords and short tokens', () => {
  assert.deepEqual(tokenize('The cat IS on a Mat'), ['cat', 'mat']);
});

// ── bestMatch: PURE ─────────────────────────────────────────────────────────────────────────────
test('bestMatch: picks the closest candidate (strings)', () => {
  const text = 'the phoenix protocol describes a method for recovery';
  const candidates = [
    'a totally unrelated essay about gardening and soil',
    'the phoenix protocol describes a method for recovery and renewal',
    'phoenix the bird in ancient mythology',
  ];
  const m = bestMatch(text, candidates);
  assert.equal(m.index, 1);
  assert.ok(m.similarity > 0.5);
  assert.equal(m.candidate, candidates[1]);
});

test('bestMatch: picks the closest candidate (objects with title/snippet)', () => {
  const text = 'on-chain attribution for reposted articles';
  const candidates = [
    { title: 'unrelated', snippet: 'weather report for tuesday' },
    { title: 'on-chain attribution for reposted articles', snippet: 'a guide' },
  ];
  const m = bestMatch(text, candidates);
  assert.equal(m.index, 1);
});

test('bestMatch: empty inputs → null', () => {
  assert.equal(bestMatch('', ['x']), null);
  assert.equal(bestMatch('x', []), null);
  assert.equal(bestMatch('x', null), null);
});

// ── findSources: fusion with INJECTED fakes (no network) ─────────────────────────────────────────
const suspect = 'the phoenix protocol describes a method for recovery and continuity over time';

function fakeSources() {
  return {
    web: async () => [
      { url: 'https://example.com/phoenix', title: 'the phoenix protocol describes a method for recovery and continuity over time', snippet: 'verbatim copy', source: 'web' },
      { url: 'https://example.com/unrelated', title: 'gardening tips for spring', snippet: 'soil and seeds', source: 'web' },
    ],
    library: async () => [
      { url: 'https://doi.org/10.1/x', title: 'A study of recovery and continuity methods', snippet: 'Author A · 2024', source: 'library:scholarly' },
    ],
    onchain: async () => [
      { url: 'ipfs://CID/phoenix', title: 'Phoenix Protocol', snippet: 'minted document', source: 'onchain:nft' },
    ],
  };
}

test('findSources: fuses all injected sources and ranks verbatim match first', async () => {
  const out = await findSources(suspect, { max: 10, sources: fakeSources() });
  assert.ok(out.length >= 4, `expected >=4 results, got ${out.length}`);
  // the verbatim web copy should rank #1 by similarity.
  assert.equal(out[0].url, 'https://example.com/phoenix');
  assert.ok(out[0].similarity > out[out.length - 1].similarity);
  // every result carries the contract shape.
  for (const r of out) {
    assert.ok('url' in r && 'title' in r && 'snippet' in r && 'source' in r && 'similarity' in r);
    assert.ok(r.similarity >= 0 && r.similarity <= 1);
  }
  // sources from all three backends are represented.
  const srcs = new Set(out.map((r) => r.source));
  assert.ok(srcs.has('web') && srcs.has('library:scholarly') && srcs.has('onchain:nft'));
});

test('findSources: respects max', async () => {
  const out = await findSources(suspect, { max: 2, sources: fakeSources() });
  assert.equal(out.length, 2);
});

test('findSources: empty text → []', async () => {
  assert.deepEqual(await findSources('', { sources: fakeSources() }), []);
  assert.deepEqual(await findSources('   ', { sources: fakeSources() }), []);
});

test('findSources: soft-fails — a throwing source never sinks the others', async () => {
  const sources = {
    boom: async () => { throw new Error('backend down'); },
    web: async () => [{ url: 'https://ok.com/a', title: suspect, snippet: 'good', source: 'web' }],
  };
  const out = await findSources(suspect, { sources });
  assert.equal(out.length, 1);
  assert.equal(out[0].url, 'https://ok.com/a');
});

test('findSources: dedups by url, combining/keeping richer snippet', async () => {
  const sources = {
    a: async () => [{ url: 'https://dup.com/x/', title: 'Title', snippet: 'short', source: 'web' }],
    b: async () => [{ url: 'https://dup.com/x', title: 'Title', snippet: 'a much longer snippet wins', source: 'library:scholarly' }],
  };
  const out = await findSources('Title here', { sources });
  assert.equal(out.length, 1);
  assert.equal(out[0].snippet, 'a much longer snippet wins');
});

test('findSources: never throws even with garbage rows', async () => {
  const sources = {
    junk: async () => [null, undefined, {}, { url: 'https://x.com', title: 'ok', snippet: '', source: 'web' }],
  };
  const out = await findSources('ok content', { sources });
  assert.ok(Array.isArray(out));
  assert.ok(out.some((r) => r.url === 'https://x.com'));
});
