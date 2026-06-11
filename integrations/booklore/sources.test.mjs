// sources.test.mjs — proves the curated seed registry (sources.mjs) WITHOUT any network/fs/keys.
// sources.mjs is pure data + two pure lookup functions, so there is nothing to inject: the tests
// exercise the exported constants and functions directly. Soft-fail focus: seedsFor()/allSeedUrls()
// must return a typed empty result (null / []) for bad/empty/missing input and never throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SACRED_TEXTS,
  THEOI,
  SEEDS,
  seedsFor,
  allSeedUrls,
} from './sources.mjs';

// Shape helper: a valid index entry is { title, url } with an https URL.
function assertIndexEntry(e) {
  assert.equal(typeof e.title, 'string');
  assert.ok(e.title.length > 0, 'title non-empty');
  assert.equal(typeof e.url, 'string');
  assert.ok(/^https:\/\//.test(e.url), `url is https: ${e.url}`);
}

// --- SACRED_TEXTS / THEOI bundle shape ---------------------------------------

test('SACRED_TEXTS is a well-formed bundle', () => {
  assert.equal(SACRED_TEXTS.host, 'sacred-texts.com');
  assert.equal(typeof SACRED_TEXTS.note, 'string');
  assert.ok(SACRED_TEXTS.note.length > 0);
  assert.ok(Array.isArray(SACRED_TEXTS.indexes));
  assert.ok(SACRED_TEXTS.indexes.length > 0);
  for (const e of SACRED_TEXTS.indexes) assertIndexEntry(e);
});

test('THEOI is a well-formed bundle', () => {
  assert.equal(THEOI.host, 'theoi.com');
  assert.equal(typeof THEOI.note, 'string');
  assert.ok(THEOI.note.length > 0);
  assert.ok(Array.isArray(THEOI.indexes));
  assert.ok(THEOI.indexes.length > 0);
  for (const e of THEOI.indexes) assertIndexEntry(e);
});

test('SEEDS exposes both bundles under short keys', () => {
  assert.equal(SEEDS.sacredTexts, SACRED_TEXTS);
  assert.equal(SEEDS.theoi, THEOI);
  assert.deepEqual(Object.keys(SEEDS).sort(), ['sacredTexts', 'theoi']);
});

// --- seedsFor() happy paths ---------------------------------------------------

test('seedsFor matches by exact host', () => {
  assert.equal(seedsFor('sacred-texts.com'), SACRED_TEXTS);
  assert.equal(seedsFor('theoi.com'), THEOI);
});

test('seedsFor matches by short key (first host label)', () => {
  assert.equal(seedsFor('sacred-texts'), SACRED_TEXTS); // host.split('.')[0]
  assert.equal(seedsFor('theoi'), THEOI);
});

test('seedsFor is case-insensitive', () => {
  assert.equal(seedsFor('THEOI'), THEOI);
  assert.equal(seedsFor('Sacred-Texts.com'), SACRED_TEXTS);
  assert.equal(seedsFor('Theoi.COM'), THEOI);
});

test('seedsFor matches when key merely contains the host label', () => {
  // k.includes(bundle.host.split('.')[0]) — substring containment
  assert.equal(seedsFor('the theoi project'), THEOI);
  assert.equal(seedsFor('https://www.theoi.com/x.html'), THEOI);
});

// --- seedsFor() soft-fail / edge cases ---------------------------------------

test('seedsFor returns null for an unknown key', () => {
  assert.equal(seedsFor('wikipedia.org'), null);
  assert.equal(seedsFor('nope'), null);
});

test('seedsFor returns null for empty / missing input (default arg)', () => {
  assert.equal(seedsFor(''), null);
  assert.equal(seedsFor(), null);        // default key = ''
  assert.equal(seedsFor(undefined), null);
});

test('seedsFor coerces non-string input without throwing', () => {
  // String(key) coercion path — must not throw, just resolves to a non-match.
  assert.equal(seedsFor(null), null);
  assert.equal(seedsFor(0), null);
  assert.equal(seedsFor(123), null);
  assert.equal(seedsFor({}), null);
  assert.equal(seedsFor([]), null);
  assert.equal(seedsFor(true), null);
});

test('seedsFor never throws across a fuzz of odd inputs', () => {
  const weird = [NaN, Infinity, -1, Symbol.iterator && 'sym', '\n', '   ', '.', 'com', 'sacred', 'theoi.com.evil.com'];
  for (const w of weird) {
    assert.doesNotThrow(() => seedsFor(w));
    const r = seedsFor(w);
    assert.ok(r === null || r === SACRED_TEXTS || r === THEOI);
  }
});

// --- allSeedUrls() ------------------------------------------------------------

test('allSeedUrls flattens every bundle index with its host', () => {
  const urls = allSeedUrls();
  assert.ok(Array.isArray(urls));
  const expectedLen = SACRED_TEXTS.indexes.length + THEOI.indexes.length;
  assert.equal(urls.length, expectedLen);
  for (const u of urls) {
    assert.equal(typeof u.host, 'string');
    assertIndexEntry(u);
    assert.ok(u.host === 'sacred-texts.com' || u.host === 'theoi.com');
  }
});

test('allSeedUrls carries through both hosts', () => {
  const urls = allSeedUrls();
  const hosts = new Set(urls.map((u) => u.host));
  assert.deepEqual([...hosts].sort(), ['sacred-texts.com', 'theoi.com']);
});

test('allSeedUrls returns a fresh array of fresh objects each call', () => {
  const a = allSeedUrls();
  const b = allSeedUrls();
  assert.notEqual(a, b);                 // new array
  assert.notEqual(a[0], b[0]);           // spread makes new entry objects
  a.push({ host: 'x', title: 't', url: 'https://x' });
  assert.equal(allSeedUrls().length, SACRED_TEXTS.indexes.length + THEOI.indexes.length);
});

test('allSeedUrls takes no input and is pure (never throws)', () => {
  assert.doesNotThrow(() => allSeedUrls());
});
