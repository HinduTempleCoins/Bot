import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenseBucket, canMint, canShip, SOURCES, catalogSummary, provenance, harvestPolyHaven, __setFetch } from './genai-asset-library.mjs';

test('CC0 / public domain / original → A (mint-safe)', () => {
  for (const l of ['CC0', 'cc0', 'Public Domain', 'PD', 'our own', 'original']) assert.equal(licenseBucket(l), 'A', l);
  assert.equal(canMint('CC0'), true);
});

test('permissive-with-attribution → B (product, not minted raw)', () => {
  for (const l of ['CC-BY', 'OFL', 'MIT', 'Apache-2.0', 'BSD', 'ISC']) assert.equal(licenseBucket(l), 'B', l);
  assert.equal(canMint('CC-BY'), false);
  assert.equal(canShip('CC-BY'), true);
});

test('NC / share-alike / copyleft / research / mixed → C (reference only)', () => {
  for (const l of ['CC-BY-NC', 'CC BY-NC', 'CC-BY-SA', 'GPL-2.0', 'research', 'mixed', 'ToS']) assert.equal(licenseBucket(l), 'C', l);
  assert.equal(canShip('CC-BY-NC'), false);
});

test('MINT-SAFETY: a mixed license listing (CC0|CC-BY-NC) is NOT mint-safe', () => {
  // the bug we fixed: matching "cc0" first wrongly bucketed this A
  assert.equal(licenseBucket('CC0|CC-BY|CC-BY-NC'), 'C');
  assert.equal(licenseBucket('CC0|CC-BY'), 'C'); // mixed → per-item → must read each
  assert.equal(canMint('CC0|CC-BY-NC'), false);
});

test('unknown / empty → C (safe default)', () => {
  assert.equal(licenseBucket(''), 'C');
  assert.equal(licenseBucket('some weird terms'), 'C');
});

test('provenance carries bucket + mint flag + sha256', () => {
  const p = provenance({ source: 'polyhaven', id: 'x', url: 'u', license: 'CC0', buffer: Buffer.from('abc') });
  assert.equal(p.bucket, 'A');
  assert.equal(p.mintOK, true);
  assert.equal(p.sha256.length, 64);
});

test('catalog has sources and a summary', () => {
  assert.ok(SOURCES.length >= 10);
  const s = catalogSummary();
  assert.ok(s.mintSafe >= 5);
  assert.ok(s.keyless >= 1);
});

test('harvestPolyHaven uses injected fetch (offline)', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ a: {}, b: {}, c: {} }) }));
  const r = await harvestPolyHaven('textures', 2);
  __setFetch(null);
  assert.equal(r.ok, true);
  assert.equal(r.bucket, 'A');
  assert.equal(r.ids.length, 2);
});
