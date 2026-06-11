// vector-store.test.mjs — Memory vector store via injected fake DB + fake embedder (fully offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemory, makeFakeDb, cosineSim, toVectorLiteral, parseVectorLiteral,
} from './vector-store.mjs';

// A toy deterministic "embedder": maps text → a 3-dim bag-of-keywords vector. No model, no network.
const KEYS = ['cat', 'dog', 'chain'];
const fakeEmbed = async (texts) =>
  texts.map((t) => {
    const lo = String(t).toLowerCase();
    return KEYS.map((k) => (lo.includes(k) ? 1 : 0));
  });

const newMem = () => createMemory({ db: makeFakeDb(), embed: fakeEmbed, dim: 3 });

test('cosineSim: identical=1, orthogonal=0, soft-fail on bad input', () => {
  assert.equal(cosineSim([1, 0], [1, 0]), 1);
  assert.equal(cosineSim([1, 0], [0, 1]), 0);
  assert.equal(cosineSim([0, 0], [1, 1]), 0);
  assert.equal(cosineSim(null, [1]), 0);
  assert.equal(cosineSim([1, 2], [1]), 0);
});

test('toVectorLiteral / parseVectorLiteral round-trip', () => {
  assert.equal(toVectorLiteral([0.5, 1, 2]), '[0.5,1,2]');
  assert.deepEqual(parseVectorLiteral('[0.5,1,2]'), [0.5, 1, 2]);
  assert.deepEqual(parseVectorLiteral('[]'), []);
  assert.equal(toVectorLiteral('nope'), '[]');
});

test('ddl: emits CREATE TABLE + HNSW index with the configured dim', () => {
  const sql = newMem().ddl();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS memory_vectors/);
  assert.match(sql, /vector\(3\)/);
  assert.match(sql, /USING hnsw \(embedding vector_cosine_ops\)/);
});

test('upsert then search returns the nearest record', async () => {
  const mem = newMem();
  await mem.upsert([
    { id: 'a', text: 'the cat sat', meta: { src: 'x' } },
    { id: 'b', text: 'a dog ran' },
    { id: 'c', text: 'the chain produces blocks' },
  ]);
  assert.equal(await mem.count(), 3);
  const hits = await mem.search('cat', { k: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');
  assert.equal(hits[0].score, 1); // exact keyword match → cosine 1
  assert.deepEqual(hits[0].meta, { src: 'x' });
});

test('search: k limits results, ordered by score desc', async () => {
  const mem = newMem();
  await mem.upsert([
    { id: 'a', text: 'cat' },
    { id: 'b', text: 'cat and dog' },
    { id: 'c', text: 'chain' },
  ]);
  const hits = await mem.search('cat dog', { k: 2 });
  assert.equal(hits.length, 2);
  assert.ok(hits[0].score >= hits[1].score);
});

test('upsert: id collision updates in place (no duplicate)', async () => {
  const mem = newMem();
  await mem.upsert({ id: 'a', text: 'cat' });
  await mem.upsert({ id: 'a', text: 'dog', meta: { v: 2 } });
  assert.equal(await mem.count(), 1);
  const hits = await mem.search('dog', { k: 1 });
  assert.equal(hits[0].meta.v, 2);
});

test('remove deletes a record', async () => {
  const mem = newMem();
  await mem.upsert({ id: 'a', text: 'cat' });
  assert.equal((await mem.remove('a')).ok, true);
  assert.equal(await mem.count(), 0);
});

test('soft-fail: not configured → safe results, never throws', async () => {
  const mem = createMemory({}); // no db, no embed
  assert.equal((await mem.upsert({ id: 'a', text: 'x' })).ok, false);
  assert.deepEqual(await mem.search('x'), []);
  assert.equal(await mem.count(), 0);
});

test('soft-fail: empty/garbage inputs', async () => {
  const mem = newMem();
  assert.equal((await mem.upsert([])).upserted, 0);
  assert.equal((await mem.upsert({ id: null, text: 'x' })).upserted, 0);
  assert.deepEqual(await mem.search(''), []);
  assert.deepEqual(await mem.search(123), []);
});

test('search survives a throwing db (returns [])', async () => {
  const mem = createMemory({ db: { async query() { throw new Error('db down'); } }, embed: fakeEmbed, dim: 3 });
  assert.deepEqual(await mem.search('cat'), []);
});

test('table name is sanitized against injection', () => {
  const mem = createMemory({ db: makeFakeDb(), embed: fakeEmbed, table: 'foo; DROP TABLE bar;--' });
  assert.equal(mem.table, 'fooDROPTABLEbar');
});
