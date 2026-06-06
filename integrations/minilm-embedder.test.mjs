// minilm-embedder.test.mjs — OFFLINE tests for the shared MiniLM embedder.
// These NEVER load the real model or touch the network: a fake pipeline is injected via
// __setPipelineFactory, so embed()/embedOne() are exercised end-to-end with ZERO download. The real
// model is only ever exercised by the opt-in --smoke run.
//   node --test integrations/minilm-embedder.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { makeEmbedder, embed, embedOne, __setPipelineFactory } from './minilm-embedder.mjs';

// A fake feature-extraction pipeline: returns a deterministic 4-dim Float32Array per text. Mirrors the
// transformers.js return shape ({ data: Float32Array }). No network, no model, no disk.
const fakeFactory = () => async (text) => {
  const t = String(text).toLowerCase();
  const data = Float32Array.from([
    t.includes('cat') || t.includes('kitten') ? 1 : 0,
    t.includes('window') || t.includes('ledge') ? 1 : 0,
    t.includes('bank') || t.includes('rate') ? 1 : 0,
  ]);
  return { data };
};

afterEach(() => { __setPipelineFactory(null); }); // never leak a fake into another test/the real loader

// ── module shape ─────────────────────────────────────────────────────────────────────────────────

test('exports: makeEmbedder / embed / embedOne are functions', () => {
  assert.equal(typeof makeEmbedder, 'function');
  assert.equal(typeof embed, 'function');
  assert.equal(typeof embedOne, 'function');
});

test('makeEmbedder returns an async (text) => Promise function', async () => {
  __setPipelineFactory(fakeFactory);
  const fn = makeEmbedder();
  assert.equal(typeof fn, 'function');
  const r = fn('hello');
  assert.ok(r && typeof r.then === 'function');
  const v = await r;
  assert.ok(Array.isArray(v));
});

// ── embed: batch → Float32Array[] ──────────────────────────────────────────────────────────────────

test('embed: returns one Float32Array per input', async () => {
  __setPipelineFactory(fakeFactory);
  const out = await embed(['the cat on the window', 'the bank raised the rate']);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 2);
  assert.ok(out[0] instanceof Float32Array);
  assert.ok(out[0].length > 0);
});

test('embed: accepts a single string (wrapped to a one-element batch)', async () => {
  __setPipelineFactory(fakeFactory);
  const out = await embed('just one');
  assert.equal(out.length, 1);
  assert.ok(out[0] instanceof Float32Array);
});

// ── embedOne: plain number[] (Array.isArray) — seam contract ───────────────────────────────────────

test('embedOne: returns a plain number[], never a Float32Array', async () => {
  __setPipelineFactory(fakeFactory);
  const v = await embedOne('a single sentence to embed');
  assert.ok(Array.isArray(v));            // seams gate on Array.isArray
  assert.ok(!(v instanceof Float32Array));
  assert.ok(v.every((x) => typeof x === 'number'));
});

// ── soft-fail: model can't load → null, never throws ───────────────────────────────────────────────

test('embed / embedOne soft-fail to null when the pipeline cannot load', async () => {
  __setPipelineFactory(async () => { throw new Error('no model / offline'); });
  assert.equal(await embed(['x']), null);
  assert.equal(await embedOne('x'), null);
  const fn = makeEmbedder();
  assert.equal(await fn('x'), null); // seam sees null → keeps its word-bag fallback
});

test('embed: soft-fails to null when a call inside the pipeline throws mid-batch', async () => {
  __setPipelineFactory(() => async () => { throw new Error('boom'); });
  assert.equal(await embed(['a', 'b']), null);
});

// ── injected fake plugs into the cheetah seam end-to-end (offline) ─────────────────────────────────

test('makeEmbedder output is usable as a cheetah __setEmbedder embedder', async () => {
  __setPipelineFactory(fakeFactory);
  const { __setEmbedder, bestMatch } = await import('./cheetah-embeddings.mjs');
  __setEmbedder(makeEmbedder());
  try {
    const top = await bestMatch('a cat by the window', [
      { id: 'finance', text: 'the central bank raised the rate' },
      { id: 'pets', text: 'a kitten on the ledge' },
    ]);
    assert.ok(top);
    assert.equal(top.id, 'pets'); // shares cat/window dims with the query under the fake embedder
  } finally {
    __setEmbedder(null);
  }
});
