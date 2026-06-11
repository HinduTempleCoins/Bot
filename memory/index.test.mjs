// index.test.mjs — Memory orchestrator end-to-end via the real three pieces, fully OFFLINE.
// Uses makeFakeDb() (no Postgres) + createEmbedder({backend:'hash'}) (no model, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryIndex, esc, __setStore, __setDoclingTools } from './index.mjs';
import { makeFakeDb } from './vector-store.mjs';
import { createEmbedder } from './embed.mjs';

const newIndex = () =>
  createMemoryIndex({ db: makeFakeDb(), embed: createEmbedder({ backend: 'hash' }) });

const DOC_MD = [
  '# The Phoenix Protocol',
  '',
  'The Phoenix Protocol describes how a witness account is reborn after a model change.',
  '',
  '## Salamander notes',
  '',
  'Salamanders are entirely unrelated and live in cold streams far from any blockchain.',
  '',
  '## Hathor and the chain',
  '',
  'Hathor is the founding witness account on the MELEK blockchain, producing blocks.',
].join('\n');

test('ingestDoc -> recall round-trip: the right chunk comes back', async () => {
  const mem = newIndex();
  const res = await mem.ingestDoc(DOC_MD, { source: 'phoenix-protocol.md' });
  assert.ok(res.ingested >= 3, `expected >=3 ingested, got ${res.ingested}`);

  const hits = await mem.recall('which witness account produces blocks on the MELEK blockchain?', { k: 1 });
  assert.equal(hits.length, 1);
  // hash embedder shares tokens (hathor/witness/melek/blockchain/blocks) → the Hathor chunk wins.
  assert.match(hits[0].text, /Hathor is the founding witness account/);
  assert.equal(hits[0].meta.source, 'phoenix-protocol.md');
  assert.ok(typeof hits[0].score === 'number');
});

test('recall respects k and returns store hit shape', async () => {
  const mem = newIndex();
  await mem.ingestDoc(DOC_MD, { source: 'phoenix-protocol.md' });
  const hits = await mem.recall('phoenix protocol witness rebirth', { k: 2 });
  assert.equal(hits.length, 2);
  for (const h of hits) {
    assert.ok('id' in h && 'text' in h && 'meta' in h && 'score' in h);
  }
});

test('ingestRecords: pre-shaped records path', async () => {
  const mem = newIndex();
  const res = await mem.ingestRecords([
    { id: 'a#1', text: 'the cat sat on the temple mat', meta: { source: 'rec' } },
    { id: 'b#1', text: 'a dog ran along the riverbank', meta: { source: 'rec' } },
  ]);
  assert.equal(res.ingested, 2);

  const hits = await mem.recall('cat temple', { k: 1 });
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /cat sat on the temple/);
  assert.equal(hits[0].meta.source, 'rec');
});

test('ingestDoc accepts canonical Docling JSON ({texts:[...]})', async () => {
  const mem = newIndex();
  const docling = {
    name: 'Convergence',
    texts: [
      { label: 'title', text: 'The Convergence' },
      { label: 'section_header', text: 'Temple technology' },
      { label: 'paragraph', text: 'tDCS and TENS reconstruct ancient temple practice.' },
    ],
  };
  const res = await mem.ingestDoc(docling, { source: 'convergence.json' });
  assert.ok(res.ingested >= 1);
  const hits = await mem.recall('temple technology tDCS', { k: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].meta.source, 'convergence.json');
});

test('empty / garbage input soft-fails (never throws)', async () => {
  const mem = newIndex();
  assert.deepEqual(await mem.ingestDoc(null, {}), { ingested: 0 });
  assert.deepEqual(await mem.ingestDoc('', {}), { ingested: 0 });
  assert.deepEqual(await mem.ingestDoc(12345, {}), { ingested: 0 });
  assert.deepEqual(await mem.ingestDoc({ nope: true }, {}), { ingested: 0 });
  assert.deepEqual(await mem.ingestRecords(null), { ingested: 0 });
  assert.deepEqual(await mem.ingestRecords([]), { ingested: 0 });
  assert.deepEqual(await mem.ingestRecords([{ id: null, text: '' }]), { ingested: 0 });

  // recall on bad input
  assert.deepEqual(await mem.recall('', { k: 3 }), []);
  assert.deepEqual(await mem.recall(null), []);
  assert.deepEqual(await mem.recall(123), []);
});

test('recall on empty store returns []', async () => {
  const mem = newIndex();
  assert.deepEqual(await mem.recall('anything at all', { k: 5 }), []);
});

test('soft-fail when store.upsert / store.search throw (injected throwing store)', async () => {
  __setStore(() => ({
    async upsert() { throw new Error('boom'); },
    async search() { throw new Error('boom'); },
  }));
  try {
    const mem = createMemoryIndex({ db: makeFakeDb(), embed: createEmbedder({ backend: 'hash' }) });
    assert.deepEqual(await mem.ingestRecords([{ id: 'x', text: 'y' }]), { ingested: 0 });
    assert.deepEqual(await mem.ingestDoc('# h\n\nbody text here', { source: 's' }), { ingested: 0 });
    assert.deepEqual(await mem.recall('q', { k: 1 }), []);
  } finally {
    __setStore(null);
  }
});

test('__setDoclingTools swaps the ingest adapter', async () => {
  let seen = null;
  __setDoclingTools({
    normalizeDocling: (input, opts) => { seen = { input, opts }; return { stub: true }; },
    toAnnalRecords: () => [{ id: 'stub#1', text: 'stub record text', meta: { source: 'swapped' } }],
    chunkForEmbedding: (recs) => recs,
  });
  try {
    const mem = createMemoryIndex({ db: makeFakeDb(), embed: createEmbedder({ backend: 'hash' }) });
    const res = await mem.ingestDoc('ignored', { source: 'swapped' });
    assert.equal(res.ingested, 1);
    assert.equal(seen.opts.source, 'swapped');
    const hits = await mem.recall('stub record text', { k: 1 });
    assert.equal(hits[0].meta.source, 'swapped');
  } finally {
    __setDoclingTools(null);
  }
});

test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
