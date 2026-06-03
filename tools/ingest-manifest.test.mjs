// ingest-manifest.test.mjs — OFFLINE unit tests for buildManifest + diffManifest (added/changed/
// removed detection) plus the loadManifest/saveManifest round-trip. Uses an injected readFn for the
// pure logic and a temp dir in the OS tmp dir for the fs layer. No network, no corpus access.
//
//   node --test tools/ingest-manifest.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sha256,
  buildManifest,
  diffManifest,
  loadManifest,
  saveManifest,
} from './ingest-manifest.mjs';

// in-memory fake corpus -> readFn
const corpus = {
  'a.txt': 'alpha',
  'b.txt': 'bravo',
  'c.txt': 'charlie',
};
const readFn = (p) => {
  if (!(p in corpus)) throw new Error(`missing ${p}`);
  return corpus[p];
};

test('buildManifest returns path -> { hash, size } for each file', () => {
  const m = buildManifest(['a.txt', 'b.txt'], readFn);
  assert.deepEqual(Object.keys(m).sort(), ['a.txt', 'b.txt']);
  assert.equal(m['a.txt'].hash, sha256(Buffer.from('alpha')));
  assert.equal(m['a.txt'].size, 5);
  assert.equal(m['b.txt'].size, 5);
});

test('buildManifest accepts Buffer contents from readFn', () => {
  const m = buildManifest(['x'], () => Buffer.from('hello'));
  assert.equal(m['x'].size, 5);
  assert.equal(m['x'].hash, sha256(Buffer.from('hello')));
});

test('buildManifest is pure: same input -> identical manifest', () => {
  const a = buildManifest(['a.txt', 'c.txt'], readFn);
  const b = buildManifest(['a.txt', 'c.txt'], readFn);
  assert.deepEqual(a, b);
});

test('buildManifest throws if readFn is not a function', () => {
  assert.throws(() => buildManifest(['a.txt'], null), TypeError);
});

test('buildManifest handles empty file list', () => {
  assert.deepEqual(buildManifest([], readFn), {});
  assert.deepEqual(buildManifest(undefined, readFn), {});
});

test('diffManifest detects added files', () => {
  const old = buildManifest(['a.txt'], readFn);
  const cur = buildManifest(['a.txt', 'b.txt'], readFn);
  const d = diffManifest(old, cur);
  assert.deepEqual(d.added, ['b.txt']);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.removed, []);
});

test('diffManifest detects changed files (hash differs, same path)', () => {
  const old = buildManifest(['a.txt'], readFn);
  const cur = buildManifest(['a.txt'], () => 'ALPHA-EDITED');
  const d = diffManifest(old, cur);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.changed, ['a.txt']);
  assert.deepEqual(d.removed, []);
});

test('diffManifest detects removed files', () => {
  const old = buildManifest(['a.txt', 'b.txt'], readFn);
  const cur = buildManifest(['a.txt'], readFn);
  const d = diffManifest(old, cur);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.removed, ['b.txt']);
});

test('diffManifest detects added + changed + removed together', () => {
  const old = buildManifest(['a.txt', 'b.txt'], readFn);
  const cur = buildManifest(['b.txt', 'c.txt'], (p) =>
    p === 'b.txt' ? 'bravo-CHANGED' : corpus[p]
  );
  const d = diffManifest(old, cur);
  assert.deepEqual(d.added, ['c.txt']);
  assert.deepEqual(d.changed, ['b.txt']);
  assert.deepEqual(d.removed, ['a.txt']);
});

test('diffManifest: identical manifests yield empty delta', () => {
  const m = buildManifest(['a.txt', 'b.txt', 'c.txt'], readFn);
  const d = diffManifest(m, m);
  assert.deepEqual(d, { added: [], changed: [], removed: [] });
});

test('diffManifest tolerates null/undefined inputs (first run)', () => {
  const cur = buildManifest(['a.txt'], readFn);
  assert.deepEqual(diffManifest(null, cur).added, ['a.txt']);
  assert.deepEqual(diffManifest(cur, undefined).removed, ['a.txt']);
  assert.deepEqual(diffManifest(undefined, undefined), { added: [], changed: [], removed: [] });
});

test('saveManifest + loadManifest round-trip via OS tmp dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-manifest-'));
  try {
    const path = join(dir, 'manifest.json');
    const m = buildManifest(['a.txt', 'b.txt'], readFn);
    saveManifest(path, m);
    assert.deepEqual(loadManifest(path), m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadManifest returns {} when file is missing (not an error)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-manifest-'));
  try {
    assert.deepEqual(loadManifest(join(dir, 'does-not-exist.json')), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
