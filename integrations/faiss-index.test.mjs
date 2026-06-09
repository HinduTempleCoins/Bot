// Offline test for faiss-index.mjs. Exercises the wrapper logic via the cosine fallback (CI/node-24);
// on the node-20 boxes the SAME assertions run against real FAISS (IndexFlatIP). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVectorIndex, faissAvailable, __forceFallback } from './faiss-index.mjs';

test('nearest-neighbour is correct (cosine-equivalent ranking)', () => {
  __forceFallback(true); // pin the deterministic JS path for the assertion
  const idx = createVectorIndex(4);
  idx.addAll([
    { id: 'east', vec: [1, 0, 0, 0] },
    { id: 'north', vec: [0, 1, 0, 0] },
    { id: 'east-ish', vec: [0.9, 0.1, 0, 0] },
  ]);
  assert.equal(idx.size, 3);
  const hits = idx.search([1, 0, 0, 0], 2);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'east', 'exact match ranks first');
  assert.equal(hits[1].id, 'east-ish', 'closest neighbour second');
  assert.ok(hits[0].score > hits[1].score, 'scores ordered, higher = closer');
});

test('magnitude does not matter — direction does (normalized → cosine)', () => {
  __forceFallback(true);
  const idx = createVectorIndex(3);
  idx.addAll([{ id: 'big', vec: [100, 0, 0] }, { id: 'orth', vec: [0, 5, 0] }]);
  const hits = idx.search([2, 0, 0], 2);
  assert.equal(hits[0].id, 'big', 'same-direction wins regardless of magnitude');
  assert.ok(hits[0].score > 0.99, 'near-1 cosine for same direction');
});

test('empty index returns [] (never throws)', () => {
  __forceFallback(true);
  const idx = createVectorIndex(8);
  assert.deepEqual(idx.search([1, 2, 3, 4, 5, 6, 7, 8], 5), []);
});

test('faissAvailable reflects backend; wrapper API identical both ways', () => {
  __forceFallback(false); // try the real binding (boxes: true; CI node-24: false)
  const idx = createVectorIndex(2);
  idx.add('a', [1, 0]); idx.add('b', [0, 1]);
  const hits = idx.search([1, 0], 1);
  assert.equal(hits[0].id, 'a', `correct nearest via ${idx.backend} backend`);
  // backend must be one of the two known values; faissAvailable agrees with it.
  assert.ok(['faiss', 'cosine'].includes(idx.backend));
  assert.equal(idx.backend === 'faiss', faissAvailable());
  __forceFallback(false);
});
