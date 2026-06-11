// permlink.test.mjs — offline tests for the permlink slug + version generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  permlink,
  versionedPermlink,
  parseVersion,
  nextVersion,
} from './permlink.mjs';

test('slugify: basic lowercase ASCII slug', () => {
  assert.equal(slugify('Hello, MELEK World!'), 'hello-melek-world');
});

test('slugify: strips diacritics best-effort', () => {
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  assert.equal(slugify('naïve résumé'), 'naive-resume');
});

test('slugify: collapses and trims hyphen runs', () => {
  assert.equal(slugify('  --- a   b --- '), 'a-b');
  assert.equal(slugify('a___b...c'), 'a-b-c');
});

test('slugify: idempotent on already-slugged input', () => {
  const once = slugify('Some Title: With Punctuation!!!');
  assert.equal(slugify(once), once);
});

test('slugify: empty / punctuation-only falls back to "post"', () => {
  assert.equal(slugify(''), 'post');
  assert.equal(slugify('   '), 'post');
  assert.equal(slugify('!!!---???'), 'post');
});

test('slugify: truncates to maxLen and trims trailing hyphen', () => {
  const long = slugify('A'.repeat(300));
  assert.equal(long.length, 255);
  // a word that would end on a hyphen after truncation gets the hyphen trimmed
  const s = slugify('ab cd', { maxLen: 3 });
  assert.equal(s, 'ab');
});

test('slugify: keeps digits', () => {
  assert.equal(slugify('Top 10 Reasons'), 'top-10-reasons');
});

test('slugify: soft-fails on non-string input', () => {
  assert.equal(slugify(null), 'post');
  assert.equal(slugify(undefined), 'post');
  assert.equal(slugify(12345), '12345');
});

test('slugify: bad maxLen falls back to 255', () => {
  const huge = 'a'.repeat(300);
  assert.equal(slugify(huge, { maxLen: 0 }).length, 255);
  assert.equal(slugify(huge, { maxLen: -5 }).length, 255);
  assert.equal(slugify(huge, { maxLen: NaN }).length, 255);
});

test('permlink: is the same as slugify', () => {
  assert.equal(permlink('Hello, MELEK World!'), slugify('Hello, MELEK World!'));
  assert.equal(permlink('A'.repeat(300)).length, 255);
});

test('versionedPermlink: n<=1 returns base unchanged', () => {
  assert.equal(versionedPermlink('intro', 1), 'intro');
  assert.equal(versionedPermlink('intro', 0), 'intro');
  assert.equal(versionedPermlink('intro', -3), 'intro');
});

test('versionedPermlink: n>1 appends -vN', () => {
  assert.equal(versionedPermlink('intro', 2), 'intro-v2');
  assert.equal(versionedPermlink('intro', 10), 'intro-v10');
});

test('versionedPermlink: floors and soft-fails non-numeric', () => {
  assert.equal(versionedPermlink('intro', 3.9), 'intro-v3');
  assert.equal(versionedPermlink('intro', 'x'), 'intro');
  assert.equal(versionedPermlink(null, 2), '-v2');
});

test('parseVersion: no suffix => version 1', () => {
  assert.deepEqual(parseVersion('intro'), { base: 'intro', version: 1 });
});

test('parseVersion: -vN suffix parsed', () => {
  assert.deepEqual(parseVersion('intro-v2'), { base: 'intro', version: 2 });
  assert.deepEqual(parseVersion('a-b-c-v12'), { base: 'a-b-c', version: 12 });
});

test('parseVersion: -v1 is not a version suffix (left in base)', () => {
  assert.deepEqual(parseVersion('intro-v1'), { base: 'intro-v1', version: 1 });
});

test('parseVersion: soft-fails on bad input', () => {
  assert.deepEqual(parseVersion(null), { base: '', version: 1 });
  assert.deepEqual(parseVersion(undefined), { base: '', version: 1 });
});

test('parseVersion round-trips with versionedPermlink', () => {
  const v = versionedPermlink('my-post', 5);
  assert.deepEqual(parseVersion(v), { base: 'my-post', version: 5 });
});

test('nextVersion: bumps version by one', () => {
  assert.equal(nextVersion('intro'), 'intro-v2');
  assert.equal(nextVersion('intro-v2'), 'intro-v3');
  assert.equal(nextVersion('intro-v9'), 'intro-v10');
});

test('nextVersion: chains correctly', () => {
  let p = slugify('Draft Post');
  p = nextVersion(p); // v2
  p = nextVersion(p); // v3
  assert.equal(p, 'draft-post-v3');
  assert.deepEqual(parseVersion(p), { base: 'draft-post', version: 3 });
});
