// imagesearch.test.mjs — OFFLINE guards for the PURE pieces of own-it image search (queue #131):
// the in-memory cosine-kNN own-index and the pHash hamming/dup helpers. No network is touched.
// Run: node --test integrations/soapbox/imagesearch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity, createMemoryStore, indexImage, searchByVector,
  hammingDistance, isDuplicate,
} from './imagesearch.mjs';

// ── cosine similarity ───────────────────────────────────────────────────────────────────────────────

test('cosineSimilarity: identical direction = 1, opposite = -1, orthogonal = 0', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [2, 0]) - 1) < 1e-9, 'parallel vectors → 1');
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9, 'antiparallel → -1');
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0, 'orthogonal → 0');
});

test('cosineSimilarity: zero vector and length mismatch are safe (0, not NaN)', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

// ── in-memory cosine kNN store ────────────────────────────────────────────────────────────────────────

test('createMemoryStore: knn returns nearest first, honors k', () => {
  const s = createMemoryStore();
  s.upsert({ id: 'a', vector: [1, 0, 0], meta: { name: 'a' } });
  s.upsert({ id: 'b', vector: [0.9, 0.1, 0], meta: { name: 'b' } });
  s.upsert({ id: 'c', vector: [0, 1, 0], meta: { name: 'c' } });
  s.upsert({ id: 'd', vector: [-1, 0, 0], meta: { name: 'd' } });

  const top = s.knn([1, 0, 0], 2);
  assert.equal(top.length, 2, 'k caps the result count');
  assert.equal(top[0].id, 'a', 'exact match ranks first');
  assert.equal(top[1].id, 'b', 'near match ranks second');
  assert.ok(top[0].score >= top[1].score, 'scores are descending');
  assert.deepEqual(top[0].meta, { name: 'a' }, 'meta round-trips');
});

test('createMemoryStore: upsert replaces by id, size tracks unique ids', () => {
  const s = createMemoryStore();
  s.upsert({ id: 'x', vector: [1, 0] });
  s.upsert({ id: 'x', vector: [0, 1] });
  assert.equal(s.size, 1, 'same id overwrites');
  const top = s.knn([0, 1], 1);
  assert.equal(top[0].id, 'x');
  assert.ok(Math.abs(top[0].score - 1) < 1e-9, 'reflects the replaced vector');
});

test('store stores a copy of the vector (caller mutation does not corrupt the index)', () => {
  const s = createMemoryStore();
  const v = [1, 0, 0];
  s.upsert({ id: 'm', vector: v });
  v[0] = -1; // mutate after insert
  const top = s.knn([1, 0, 0], 1);
  assert.ok(Math.abs(top[0].score - 1) < 1e-9, 'index kept its own copy');
});

// ── module-level indexImage / searchByVector ──────────────────────────────────────────────────────────

test('indexImage + searchByVector: end-to-end on the default index', () => {
  indexImage({ id: 'img-galaxy', vector: [1, 0, 0, 0], meta: { caption: 'galaxy' } });
  indexImage({ id: 'img-nebula', vector: [0.8, 0.2, 0, 0], meta: { caption: 'nebula' } });
  indexImage({ id: 'img-cat', vector: [0, 0, 1, 0], meta: { caption: 'cat' } });

  const hits = searchByVector([1, 0, 0, 0], 2);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'img-galaxy');
  assert.equal(hits[0].meta.caption, 'galaxy');
  assert.equal(hits[1].id, 'img-nebula');
});

test('indexImage rejects bad input; searchByVector tolerates empty query', () => {
  assert.throws(() => indexImage({ id: 'x' }), /vector/, 'missing vector throws');
  assert.throws(() => indexImage({ vector: [1, 2] }), /id|vector/, 'missing id throws');
  assert.throws(() => indexImage({ id: 'y', vector: [] }), /vector/, 'empty vector throws');
  assert.deepEqual(searchByVector([], 5), [], 'empty query vector → []');
  assert.deepEqual(searchByVector(null, 5), [], 'null query vector → []');
});

// ── pHash hamming distance ────────────────────────────────────────────────────────────────────────────

test('hammingDistance: identical hashes = 0', () => {
  assert.equal(hammingDistance('ffffffffffffffff', 'ffffffffffffffff'), 0);
  assert.equal(hammingDistance('0000000000000000', '0000000000000000'), 0);
});

test('hammingDistance: counts differing bits correctly', () => {
  assert.equal(hammingDistance('0', '1'), 1, '0000 vs 0001 → 1 bit');
  assert.equal(hammingDistance('0', 'f'), 4, '0000 vs 1111 → 4 bits');
  assert.equal(hammingDistance('00', 'ff'), 8, 'two nibbles, all bits flipped');
  assert.equal(hammingDistance('f0f0', '0f0f'), 16, 'fully inverted 16-bit');
  assert.equal(hammingDistance('a', '5'), 4, '1010 vs 0101 → 4 bits');
});

test('hammingDistance: case-insensitive', () => {
  assert.equal(hammingDistance('ABCD', 'abcd'), 0);
  assert.equal(hammingDistance('Ff', 'fF'), 0);
});

test('hammingDistance: Infinity on length mismatch / bad input', () => {
  assert.equal(hammingDistance('ff', 'fff'), Infinity, 'length mismatch');
  assert.equal(hammingDistance('', ''), Infinity, 'empty');
  assert.equal(hammingDistance('zz', '00'), Infinity, 'non-hex char');
  assert.equal(hammingDistance(123, '00'), Infinity, 'non-string');
});

// ── isDuplicate ───────────────────────────────────────────────────────────────────────────────────────

test('isDuplicate: within / outside threshold', () => {
  const a = 'ffffffffffffffff';
  assert.equal(isDuplicate(a, a), true, 'identical is a duplicate');
  // flip exactly 4 bits (one nibble f→0): distance 4, within default 10
  assert.equal(isDuplicate('ffffffffffffffff', '0fffffffffffffff'), true);
  // flip 12 bits (three nibbles): distance 12, outside default 10
  assert.equal(isDuplicate('ffffffffffffffff', '000fffffffffffff'), false);
});

test('isDuplicate: custom threshold and length-mismatch (Infinity > threshold → false)', () => {
  assert.equal(isDuplicate('ff', '0f', 4), true, 'distance 4 within threshold 4');
  assert.equal(isDuplicate('ff', '0f', 3), false, 'distance 4 above threshold 3');
  assert.equal(isDuplicate('ff', 'fff'), false, 'mismatched length is never a duplicate');
});
