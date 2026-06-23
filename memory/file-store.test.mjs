// file-store.test.mjs — OFFLINE. Persistent file-backed compartment store (injected in-memory fs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFileStore } from './file-store.mjs';

// tiny in-memory fs shim implementing the bits makeFileStore uses
function memFs() {
  const files = new Map();
  return {
    files,
    async readFile(p) { if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(p); },
    async appendFile(p, data) { files.set(p, (files.get(p) || '') + data); },
    async mkdir() { /* noop */ },
  };
}

test('ingest persists to a per-compartment file; recall keyword-scores', async () => {
  const fs = memFs();
  const make = makeFileStore('/brain', { fs });
  const game = make('game');
  await game.ingestRecords([{ id: 'g1', text: 'VanKushFam built a cobblestone tower by the river', meta: { person: 'VanKushFam' } }]);
  await game.ingestRecords([{ id: 'g2', text: 'a desert pyramid was raised', meta: { person: 'Bob' } }]);
  assert.ok([...fs.files.keys()].some((k) => k.endsWith('game.jsonl')), 'wrote game.jsonl');
  const hits = await game.recall('river tower', { k: 5 });
  assert.equal(hits[0].id, 'g1');
  assert.ok(hits[0].score > 0);
});

test('memory survives a "restart" — a fresh store over the same fs reloads the records', async () => {
  const fs = memFs();
  await makeFileStore('/brain', { fs })('melek').ingestRecords([{ id: 'm1', text: 'asked about the welcome grant', meta: { person: 'Ann' } }]);
  // brand-new store instance (simulates a process restart) reading the same backing fs
  const reborn = makeFileStore('/brain', { fs })('melek');
  const hits = await reborn.recall('welcome grant', { k: 3 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'm1');
});

test('soft-fails: empty ingest, no-match recall, missing file', async () => {
  const fs = memFs();
  const s = makeFileStore('/brain', { fs })('prana');
  assert.deepEqual(await s.recall('anything', {}), []);   // no file yet
  assert.equal((await s.ingestRecords([])).ingested, 0);
  await s.ingestRecords([{ id: 'p1', text: 'pranascan explorer' }]);
  assert.deepEqual(await s.recall('zzz nonexistent', {}), []);
});
