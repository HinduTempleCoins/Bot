// cheetah-embeddings.test.mjs — offline tests for the semantic source-matching engine (queue #150).
// Runs with the built-in deterministic local embedder (no injection, no network, no keys) plus one
// injected fake to prove the injection seam. Run:  node --test integrations/cheetah-embeddings.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  embed,
  localEmbed,
  cosineSimilarity,
  createStore,
  rankSources,
  bestMatch,
  __setEmbedder,
} from './cheetah-embeddings.mjs';

// Candidate texts chosen with clear word overlap so the deterministic lexical vectorizer ranks them
// correctly: the astronomy doc shares "moon orbits earth" with the query; cooking shares nothing.
const ASTRONOMY = 'the moon orbits the earth and the earth orbits the sun in space';
const COOKING = 'simmer the onions in butter until they caramelize then add stock for soup';
const FINANCE = 'the central bank raised interest rates to cool down rising inflation';

// ── cosineSimilarity math ────────────────────────────────────────────────────────────────────────

test('cosineSimilarity: identical vectors → 1', () => {
  const v = [1, 2, 3, 4];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-12);
});

test('cosineSimilarity: orthogonal vectors → 0', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 5, 0]), 0);
});

test('cosineSimilarity: parallel vectors (same direction, diff magnitude) → 1', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 1, 1], [3, 3, 3]) - 1) < 1e-12);
});

test('cosineSimilarity: zero vector / mismatch / bad input → 0 (soft)', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0); // length mismatch
  assert.equal(cosineSimilarity(null, [1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

// ── localEmbed / embed (offline, deterministic) ──────────────────────────────────────────────────

test('localEmbed: deterministic + same text → identical vector', () => {
  const a = localEmbed('the moon orbits the earth');
  const b = localEmbed('the moon orbits the earth');
  assert.deepEqual(a, b);
  assert.equal(a.length, b.length);
});

test('localEmbed: empty text → zero vector (cosine with it = 0)', () => {
  const z = localEmbed('');
  assert.ok(z.every((x) => x === 0));
  assert.equal(cosineSimilarity(z, localEmbed('anything')), 0);
});

test('embed: offline-by-default uses local embedder, related text > unrelated text', async () => {
  const q = await embed('the moon orbits the earth');
  const related = await embed(ASTRONOMY);
  const unrelated = await embed(COOKING);
  assert.ok(cosineSimilarity(q, related) > cosineSimilarity(q, unrelated));
});

// ── vector store ─────────────────────────────────────────────────────────────────────────────────

test('store: query returns the semantically closest doc', async () => {
  const store = createStore();
  await store.add('astronomy', ASTRONOMY, { topic: 'space' });
  await store.add('cooking', COOKING, { topic: 'food' });
  await store.add('finance', FINANCE, { topic: 'money' });
  assert.equal(store.size(), 3);

  const hits = await store.query('how long does the moon take to orbit the earth', { topK: 3 });
  assert.equal(hits.length, 3);
  assert.equal(hits[0].id, 'astronomy');
  assert.deepEqual(hits[0].meta, { topic: 'space' });
  // sorted descending by score
  assert.ok(hits[0].score >= hits[1].score);
  assert.ok(hits[1].score >= hits[2].score);
});

test('store: topK limits results; empty store → []', async () => {
  const empty = createStore();
  assert.deepEqual(await empty.query('anything', { topK: 5 }), []);

  const store = createStore();
  await store.add('a', ASTRONOMY);
  await store.add('b', COOKING);
  const hits = await store.query('the earth and the moon', { topK: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
});

test('store: re-adding an id replaces the doc', async () => {
  const store = createStore();
  await store.add('x', COOKING);
  await store.add('x', ASTRONOMY);
  assert.equal(store.size(), 1);
  const hits = await store.query('the moon and the sun', { topK: 1 });
  assert.equal(hits[0].id, 'x');
  assert.ok(hits[0].score > 0);
});

// ── rankSources / bestMatch ──────────────────────────────────────────────────────────────────────

test('rankSources: orders candidates by semantic match to the query', async () => {
  const candidates = [
    { id: 'cook', text: COOKING },
    { id: 'astro', text: ASTRONOMY },
    { id: 'fin', text: FINANCE },
  ];
  const ranked = await rankSources('the moon orbits the earth', candidates);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].id, 'astro');
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[1].score >= ranked[2].score);
});

test('rankSources: accepts plain strings and respects topK', async () => {
  const ranked = await rankSources('moon earth orbit', [COOKING, ASTRONOMY, FINANCE], { topK: 1 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].index, 1); // ASTRONOMY is index 1
  assert.equal(ranked[0].candidate, ASTRONOMY);
});

test('rankSources: empty / invalid candidates → []', async () => {
  assert.deepEqual(await rankSources('q', []), []);
  assert.deepEqual(await rankSources('q', null), []);
  assert.deepEqual(await rankSources('', [ASTRONOMY]), []);
});

test('bestMatch: picks the single top candidate', async () => {
  const candidates = [
    { id: 'cook', text: COOKING },
    { id: 'astro', text: ASTRONOMY },
  ];
  const top = await bestMatch('the moon and the earth in space', candidates);
  assert.ok(top);
  assert.equal(top.id, 'astro');
  assert.ok(top.score > 0);
});

test('bestMatch: empty candidates → null', async () => {
  assert.equal(await bestMatch('q', []), null);
  assert.equal(await bestMatch('q', null), null);
});

// ── injection seam (tiny fake embedder, still offline) ───────────────────────────────────────────

test('__setEmbedder: injected embedder is used, then revertible', async () => {
  // Fake embedder: 3-dim one-hot by leading keyword — fully offline, no network.
  const fake = (text) => {
    const t = String(text).toLowerCase();
    if (t.includes('moon')) return [1, 0, 0];
    if (t.includes('soup') || t.includes('onion')) return [0, 1, 0];
    return [0, 0, 1];
  };
  __setEmbedder(fake);
  try {
    const top = await bestMatch('the moon', [{ id: 'cook', text: 'onion soup' }, { id: 'astro', text: 'moon orbit' }]);
    assert.equal(top.id, 'astro');
    assert.ok(Math.abs(top.score - 1) < 1e-12); // one-hot identical → cosine 1
  } finally {
    __setEmbedder(null); // revert so the rest of the suite uses the local embedder
  }
  // after revert, local embedder is back in play
  const v = await embed('moon');
  assert.ok(v.length > 3);
});

test('embed: injected embedder that throws falls back to local (soft-fail)', async () => {
  __setEmbedder(() => { throw new Error('boom'); });
  try {
    const v = await embed('the moon orbits the earth');
    assert.ok(Array.isArray(v) && v.length > 0); // local fallback kicked in, no throw
  } finally {
    __setEmbedder(null);
  }
});
