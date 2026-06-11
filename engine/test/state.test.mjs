/**
 * state.test.mjs — OFFLINE tests for the deterministic in-memory document store.
 *
 * state.mjs is a pure, deterministic LokiJS-style store: collections in memory,
 * SHA-256 over a sorted-key serialisation, and optional JSON-file persistence.
 * There is no network, no clock, no readers and no keys to inject — the only
 * external seam is the `file` constructor argument, which we point at a temp
 * dir (mkdtemp) so the persist/_load round-trip stays fully local with no
 * fixtures and no shared state.
 *
 * Per security study §6 C the state hash must be deterministic and stable
 * across nodes, so the hash invariants (key-order independence, replay
 * equality, change-sensitivity) are tested as hard as the document API. The
 * query/soft-fail paths (empty query, missing collection, no-match) are
 * exercised to confirm they return typed-empty results ([] / null) and never
 * throw.
 *
 * Run: node --test engine/test/state.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { State } from '../lib/state.mjs';

function tmpFile(name = 'state.json') {
  const dir = mkdtempSync(join(tmpdir(), 'melek-state-'));
  return { file: join(dir, name), dir };
}

test('constructor — fresh state has empty collections and zeroed meta', () => {
  const s = new State();
  assert.deepEqual(s.collections, {});
  assert.deepEqual(s.meta, { lastBlock: 0, lastBlockId: null, stateHash: null });
  assert.equal(s.file, null);
});

test('collection — auto-creates a named array and returns the same reference', () => {
  const s = new State();
  const col = s.collection('tokens');
  assert.deepEqual(col, []);
  // second call returns the identical array (not a fresh one)
  col.push({ symbol: 'MELEK' });
  assert.equal(s.collection('tokens').length, 1);
  assert.equal(s.collection('tokens'), col);
});

test('insert — appends the doc and returns it; persists across calls', () => {
  const s = new State();
  const doc = { symbol: 'MELEK', supply: '100' };
  const returned = s.insert('tokens', doc);
  assert.equal(returned, doc);
  s.insert('tokens', { symbol: 'TBD', supply: '5' });
  assert.equal(s.collection('tokens').length, 2);
});

test('find — happy path returns all matching docs', () => {
  const s = new State();
  s.insert('bal', { acct: 'alice', sym: 'MELEK', amt: '10' });
  s.insert('bal', { acct: 'bob', sym: 'MELEK', amt: '20' });
  s.insert('bal', { acct: 'alice', sym: 'TBD', amt: '3' });

  const aliceRows = s.find('bal', { acct: 'alice' });
  assert.equal(aliceRows.length, 2);
  const melekRows = s.find('bal', { sym: 'MELEK' });
  assert.equal(melekRows.length, 2);
  // multi-key AND query
  const one = s.find('bal', { acct: 'alice', sym: 'TBD' });
  assert.equal(one.length, 1);
  assert.equal(one[0].amt, '3');
});

test('find — empty query matches every doc in the collection', () => {
  const s = new State();
  s.insert('c', { a: 1 });
  s.insert('c', { a: 2 });
  assert.equal(s.find('c', {}).length, 2);
  // default arg behaves like {}
  assert.equal(s.find('c').length, 2);
});

test('find — soft-fail: missing collection returns typed-empty [], does not throw', () => {
  const s = new State();
  const rows = s.find('never-created', { x: 1 });
  assert.deepEqual(rows, []);
  // auto-creating the collection on read is harmless and stays empty
  assert.deepEqual(s.collections['never-created'], []);
});

test('find — soft-fail: no match returns [] not null', () => {
  const s = new State();
  s.insert('c', { a: 1 });
  assert.deepEqual(s.find('c', { a: 999 }), []);
});

test('findOne — returns the first match or null (never throws on miss)', () => {
  const s = new State();
  s.insert('c', { a: 1, tag: 'first' });
  s.insert('c', { a: 1, tag: 'second' });
  assert.equal(s.findOne('c', { a: 1 }).tag, 'first');
  assert.equal(s.findOne('c', { a: 2 }), null);
  // missing collection -> null, no throw
  assert.equal(s.findOne('missing', { a: 1 }), null);
  // empty query on empty collection -> null
  assert.equal(s.findOne('empty'), null);
});

test('update — explicit no-op API returns the same doc reference', () => {
  const s = new State();
  const doc = s.insert('c', { a: 1 });
  doc.a = 99; // referenced mutation is the real update
  assert.equal(s.update('c', doc), doc);
  assert.equal(s.findOne('c', { a: 99 }), doc);
});

test('remove — deletes all matching docs and leaves the rest intact', () => {
  const s = new State();
  s.insert('c', { a: 1, id: 'x' });
  s.insert('c', { a: 1, id: 'y' });
  s.insert('c', { a: 2, id: 'z' });
  s.remove('c', { a: 1 });
  const rest = s.find('c', {});
  assert.equal(rest.length, 1);
  assert.equal(rest[0].id, 'z');
});

test('remove — soft-fail: no match and missing collection are no-ops, no throw', () => {
  const s = new State();
  s.insert('c', { a: 1 });
  assert.doesNotThrow(() => s.remove('c', { a: 999 }));
  assert.equal(s.find('c', {}).length, 1);
  assert.doesNotThrow(() => s.remove('absent', { a: 1 }));
  assert.deepEqual(s.find('absent', {}), []);
});

test('hash — empty state is a stable, well-formed sha256 hex', () => {
  const s = new State();
  const h = s.hash();
  assert.match(h, /^[0-9a-f]{64}$/);
  // independently reproducible: sha256 of the empty-collections body
  const expected = createHash('sha256')
    .update(JSON.stringify({ collections: {} }))
    .digest('hex');
  assert.equal(h, expected);
});

test('hash — deterministic regardless of insertion key order', () => {
  const a = new State();
  a.insert('c', { z: 1, a: 2, m: 3 });
  const b = new State();
  b.insert('c', { a: 2, m: 3, z: 1 }); // same data, keys inserted in another order
  assert.equal(a.hash(), b.hash());
});

test('hash — changes when any value changes (change-sensitive)', () => {
  const s = new State();
  s.insert('c', { a: 1 });
  const before = s.hash();
  s.insert('c', { a: 2 });
  assert.notEqual(before, s.hash());
});

test('hash — independent of meta (collections-only digest)', () => {
  const s = new State();
  s.insert('c', { a: 1 });
  const before = s.hash();
  s.meta.lastBlock = 42;
  s.meta.lastBlockId = 'beef';
  assert.equal(before, s.hash());
});

test('persist — no-op when no file is configured (does not throw, writes nothing)', () => {
  const s = new State();
  assert.doesNotThrow(() => s.persist());
  // meta.stateHash stays null because persist() returned early
  assert.equal(s.meta.stateHash, null);
});

test('persist + reload — round-trips collections, meta, and a verifiable hash', () => {
  const { file, dir } = tmpFile();
  try {
    const s = new State(file);
    s.insert('tokens', { symbol: 'MELEK', supply: '100' });
    s.meta.lastBlock = 7;
    s.meta.lastBlockId = 'block-7';
    const liveHash = s.hash();
    s.persist();

    // file exists and contains the computed state hash in meta
    assert.ok(existsSync(file));
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(onDisk.meta.stateHash, liveHash);
    assert.equal(onDisk.meta.lastBlock, 7);

    // a fresh State pointed at the same file reloads identical content + hash
    const reloaded = new State(file);
    assert.deepEqual(reloaded.collections, s.collections);
    assert.equal(reloaded.meta.lastBlock, 7);
    assert.equal(reloaded.meta.lastBlockId, 'block-7');
    assert.equal(reloaded.hash(), liveHash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persist — creates parent directories that do not yet exist', () => {
  const { dir } = tmpFile();
  const nested = join(dir, 'a', 'b', 'c', 'state.json');
  try {
    assert.ok(!existsSync(dirname(nested)));
    const s = new State(nested);
    s.insert('c', { a: 1 });
    s.persist();
    assert.ok(existsSync(nested));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('_load — tolerates a snapshot missing collections/meta (falls back to defaults)', () => {
  const { file, dir } = tmpFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    // a snapshot with neither key present
    writeFileSync(file, JSON.stringify({}), 'utf8');
    const s = new State(file);
    assert.deepEqual(s.collections, {});
    assert.deepEqual(s.meta, { lastBlock: 0, lastBlockId: null, stateHash: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('constructor — missing file path leaves a clean empty state (no load attempted)', () => {
  const { dir } = tmpFile();
  const absent = join(dir, 'does-not-exist.json');
  try {
    const s = new State(absent);
    assert.deepEqual(s.collections, {});
    assert.equal(s.file, absent);
    // nothing was written merely by constructing
    assert.ok(!existsSync(absent));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
