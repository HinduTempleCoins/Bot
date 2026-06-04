// integrations/repo-registry.test.mjs — OFFLINE tests for the ecosystem repo catalog.
//
//   node --test integrations/repo-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listRepos, getRepo, statusFor } from './repo-registry.mjs';

// the real manifest path (default) — used by the no-arg loader tests.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_MANIFEST = join(HERE, '..', 'site', 'admin', 'data', 'repo-manifest.json');

test('loads the real manifest and lists all six ecosystem repos', () => {
  const repos = listRepos({ manifestPath: REAL_MANIFEST });
  const slugs = repos.map((r) => r.slug);
  for (const s of ['Bot', 'PRANA', 'melek-chain', 'melek-condenser', 'MELEK', 'KULASwap']) {
    assert.ok(slugs.includes(s), `manifest should include ${s}`);
  }
  // public shape present on each
  for (const r of repos) {
    for (const k of ['slug', 'name', 'url', 'description', 'language', 'fileCount', 'topLevel', 'status']) {
      assert.ok(k in r, `${r.slug} missing ${k}`);
    }
    assert.ok(Array.isArray(r.topLevel));
  }
});

test('status derivation: live-codebase vs in-progress vs scaffold/empty', () => {
  assert.equal(statusFor(7265), 'live-codebase');   // Bot
  assert.equal(statusFor(2875), 'live-codebase');   // melek-chain
  assert.equal(statusFor(34), 'in-progress');       // KULASwap
  assert.equal(statusFor(5), 'scaffold/empty');     // MELEK (<=5)
  assert.equal(statusFor(1), 'scaffold/empty');     // PRANA (README only)
  assert.equal(statusFor(501), 'live-codebase');    // boundary just over
  assert.equal(statusFor(500), 'in-progress');      // boundary at 500
});

test('derived status matches the real manifest repos', () => {
  const bySlug = Object.fromEntries(listRepos({ manifestPath: REAL_MANIFEST }).map((r) => [r.slug, r]));
  assert.equal(bySlug.Bot.status, 'live-codebase');
  assert.equal(bySlug['melek-chain'].status, 'live-codebase');
  assert.equal(bySlug['melek-condenser'].status, 'live-codebase');
  assert.equal(bySlug.PRANA.status, 'scaffold/empty');
  assert.equal(bySlug.MELEK.status, 'scaffold/empty');
  assert.equal(bySlug.KULASwap.status, 'in-progress');
});

test('getRepo finds a repo case-insensitively, else null', () => {
  assert.equal(getRepo('PRANA', { manifestPath: REAL_MANIFEST }).slug, 'PRANA');
  assert.equal(getRepo('prana', { manifestPath: REAL_MANIFEST }).slug, 'PRANA');
  assert.equal(getRepo('melek-chain', { manifestPath: REAL_MANIFEST }).slug, 'melek-chain');
  assert.equal(getRepo('nope', { manifestPath: REAL_MANIFEST }), null);
  assert.equal(getRepo('', { manifestPath: REAL_MANIFEST }), null);
});

test('soft-fails to the built-in default on a missing manifest (never throws)', () => {
  const missing = join(tmpdir(), 'definitely-not-a-real-manifest-xyz.json');
  let repos;
  assert.doesNotThrow(() => { repos = listRepos({ manifestPath: missing }); });
  assert.ok(repos.length >= 6, 'default catalog still has the ecosystem repos');
  assert.ok(repos.find((r) => r.slug === 'PRANA'));
  // status is still derived on the defaults
  assert.equal(getRepo('PRANA', { manifestPath: missing }).status, 'scaffold/empty');
});

test('soft-fails to the default on garbage / wrong-shape manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-reg-'));
  const garbage = join(dir, 'garbage.json');
  writeFileSync(garbage, '{ not valid json');
  let repos;
  assert.doesNotThrow(() => { repos = listRepos({ manifestPath: garbage }); });
  assert.ok(repos.length >= 6);

  const wrongShape = join(dir, 'wrong.json');
  writeFileSync(wrongShape, JSON.stringify({ something: 'else' }));
  const repos2 = listRepos({ manifestPath: wrongShape });
  assert.ok(repos2.length >= 6);
});

test('tolerates a custom manifest with partial entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-reg-'));
  const custom = join(dir, 'custom.json');
  writeFileSync(custom, JSON.stringify({
    repos: [
      { slug: 'Foo', fileCount: 1000 },            // missing most fields
      { name: 'Bar', url: 'https://x/bar' },        // no slug → falls back to name
      { description: 'no slug or name' },           // dropped
    ],
  }));
  const repos = listRepos({ manifestPath: custom });
  assert.equal(repos.length, 2);
  const foo = getRepo('Foo', { manifestPath: custom });
  assert.equal(foo.name, 'Foo');           // name defaults to slug
  assert.equal(foo.language, '—');         // defaulted
  assert.deepEqual(foo.topLevel, []);      // defaulted
  assert.equal(foo.status, 'live-codebase');
});
