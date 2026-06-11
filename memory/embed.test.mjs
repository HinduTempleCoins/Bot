// embed.test.mjs — the Memory embedder façade (hash fallback + injected fn/http backends), offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbedder, hashEmbed, pickVector } from './embed.mjs';
import { cosineSim } from './vector-store.mjs';

test('hashEmbed: deterministic, fixed-dim, L2-normalized', () => {
  const a = hashEmbed('the cat sat', 384);
  const b = hashEmbed('the cat sat', 384);
  assert.equal(a.length, 384);
  assert.deepEqual(a, b); // deterministic
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9); // unit length
});

test('hashEmbed: shared tokens → higher cosine than disjoint texts', () => {
  const cat1 = hashEmbed('the cat sat on the mat');
  const cat2 = hashEmbed('a cat on a mat');
  const dog = hashEmbed('quantum bridge ledger emission');
  assert.ok(cosineSim(cat1, cat2) > cosineSim(cat1, dog));
});

test('hashEmbed: empty / null → zero vector, no throw', () => {
  assert.equal(hashEmbed('').every((x) => x === 0), true);
  assert.equal(hashEmbed(null).length, 384);
});

test('createEmbedder hash backend: one vector per input', async () => {
  const embed = createEmbedder({ backend: 'hash', dim: 64 });
  const out = await embed(['a', 'b', 'c']);
  assert.equal(out.length, 3);
  assert.equal(out[0].length, 64);
  assert.equal(embed.dim, 64);
});

test('createEmbedder: empty input → []', async () => {
  const embed = createEmbedder();
  assert.deepEqual(await embed([]), []);
  assert.deepEqual(await embed('not-an-array'), []);
});

test('createEmbedder fn backend: wraps a local model fn', async () => {
  const fn = async (texts) => texts.map((t) => [t.length, 0, 1]);
  const embed = createEmbedder({ backend: 'fn', fn });
  const out = await embed(['ab', 'abc']);
  assert.deepEqual(out, [[2, 0, 1], [3, 0, 1]]);
});

test('createEmbedder fn backend: throwing fn falls back to hash (never throws)', async () => {
  const embed = createEmbedder({ backend: 'fn', fn: async () => { throw new Error('model down'); }, dim: 32 });
  const out = await embed(['x', 'y']);
  assert.equal(out.length, 2);
  assert.equal(out[0].length, 32); // hash fallback dim
});

test('createEmbedder ollama backend: parses /api/embeddings response via injected fetch', async () => {
  const fakeFetch = async (url, opts) => {
    assert.match(url, /embeddings/);
    const body = JSON.parse(opts.body);
    return { json: async () => ({ embedding: [body.prompt.length, 1, 2] }) };
  };
  const embed = createEmbedder({ backend: 'ollama', url: 'http://x/api/embeddings', model: 'granite-embedding:97m', fetch: fakeFetch });
  const out = await embed(['hi', 'hello']);
  assert.deepEqual(out, [[2, 1, 2], [5, 1, 2]]);
});

test('createEmbedder http backend: failed fetch falls back to hash for that item', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new Error('net'); return { json: async () => ({ embedding: [9, 9] }) }; };
  const embed = createEmbedder({ backend: 'http', url: 'http://x', fetch: flaky, dim: 16 });
  const out = await embed(['a', 'b']);
  assert.equal(out[0].length, 16); // first failed → hash fallback
  assert.deepEqual(out[1], [9, 9]); // second succeeded
});

test('pickVector: handles ollama / openai / raw shapes', () => {
  assert.deepEqual(pickVector({ embedding: [1, 2] }), [1, 2]);
  assert.deepEqual(pickVector({ data: [{ embedding: [3, 4] }] }), [3, 4]);
  assert.deepEqual(pickVector({ embeddings: [[5, 6]] }), [5, 6]);
  assert.deepEqual(pickVector([7, 8]), [7, 8]);
  assert.equal(pickVector({ nope: 1 }), null);
  assert.equal(pickVector(null), null);
});

test('embedder output plugs straight into the Memory vector store', async () => {
  const { createMemory, makeFakeDb } = await import('./vector-store.mjs');
  const embed = createEmbedder({ backend: 'hash', dim: 64 });
  const mem = createMemory({ db: makeFakeDb(), embed, dim: 64 });
  await mem.upsert([
    { id: '1', text: 'hive engine token staking rewards' },
    { id: '2', text: 'greek pantheon zeus athena' },
  ]);
  const hits = await mem.search('token staking', { k: 1 });
  assert.equal(hits[0].id, '1'); // the crypto doc is nearest the crypto query
});
