import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTag,
  validateTags,
  isMainTagValid,
  dedupe,
  summarize,
  esc,
  MAX_TAG_LEN,
  MAX_TAGS,
} from './scot-tag-config.mjs';

test('normalizeTag: strips #, lowercases, keeps [a-z0-9-]', () => {
  assert.equal(normalizeTag('#VanKush'), 'vankush');
  assert.equal(normalizeTag('  PunicWax  '), 'punicwax');
  assert.equal(normalizeTag('#crypt0logy'), 'crypt0logy');
  assert.equal(normalizeTag('Van Kush!'), 'vankush');
});

test('normalizeTag: collapses hyphen runs, trims edge hyphens', () => {
  assert.equal(normalizeTag('crypt--ology'), 'crypt-ology');
  assert.equal(normalizeTag('-leading-'), 'leading');
  assert.equal(normalizeTag('a---b---c'), 'a-b-c');
  assert.equal(normalizeTag('#--vankush--'), 'vankush');
});

test('normalizeTag: accepts number/boolean scalars', () => {
  assert.equal(normalizeTag(123), '123');
  assert.equal(normalizeTag(true), 'true');
});

test('normalizeTag: soft-fails to "" on invalid/over-length', () => {
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag(undefined), '');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag('   '), '');
  assert.equal(normalizeTag('!!!'), ''); // nothing survives the filter
  assert.equal(normalizeTag('#'), '');
  assert.equal(normalizeTag({}), '');
  assert.equal(normalizeTag(['a']), '');
  assert.equal(normalizeTag(() => {}), '');
  assert.equal(normalizeTag('x'.repeat(MAX_TAG_LEN + 1)), '');
});

test('normalizeTag: exactly MAX_TAG_LEN is kept', () => {
  const t = 'a'.repeat(MAX_TAG_LEN);
  assert.equal(normalizeTag(t), t);
});

test('isMainTagValid: must start with a letter after normalization', () => {
  assert.equal(isMainTagValid('#VanKush'), true);
  assert.equal(isMainTagValid('punicwax'), true);
  assert.equal(isMainTagValid('7coins'), false); // leading digit
});

test('isMainTagValid: leading hyphen normalizes away then is fine', () => {
  // '-hyphen' -> 'hyphen' which starts with a letter, so it IS a valid main tag.
  assert.equal(isMainTagValid('-hyphen'), true);
  // '-7' -> '7' which starts with a digit -> invalid main tag.
  assert.equal(isMainTagValid('-7'), false);
});

test('isMainTagValid: soft-fails to false on junk', () => {
  assert.equal(isMainTagValid(''), false);
  assert.equal(isMainTagValid(null), false);
  assert.equal(isMainTagValid('###'), false);
  assert.equal(isMainTagValid({}), false);
});

test('dedupe: ordered unique normalized tags', () => {
  assert.deepEqual(dedupe(['#VanKush', 'vankush', 'PunicWax']), ['vankush', 'punicwax']);
  assert.deepEqual(dedupe(['#a', 'a', 'b', 'B']), ['a', 'b']);
});

test('dedupe: drops empties, soft-fails non-array to []', () => {
  assert.deepEqual(dedupe(['', '   ', '!!!', 'ok']), ['ok']);
  assert.deepEqual(dedupe(null), []);
  assert.deepEqual(dedupe('vankush'), []); // string is not an array
  assert.deepEqual(dedupe(undefined), []);
});

test('validateTags: happy path with the queue example tags', () => {
  const r = validateTags(['#vankush', '#punicwax', '#cryptology']);
  assert.deepEqual(r.valid, ['vankush', 'punicwax', 'cryptology']);
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(r.duplicates, []);
});

test('validateTags: detects duplicates by normalized form', () => {
  const r = validateTags(['#VanKush', 'vankush', 'punicwax']);
  assert.deepEqual(r.valid, ['vankush', 'punicwax']);
  assert.deepEqual(r.duplicates, ['vankush']);
  assert.deepEqual(r.invalid, []);
});

test('validateTags: invalid entries reported by raw label', () => {
  const r = validateTags(['#vankush', '!!!', null, {}]);
  assert.deepEqual(r.valid, ['vankush']);
  assert.deepEqual(r.invalid, ['!!!', '', '[object]']);
});

test('validateTags: leading non-letter main tag is rejected, search continues', () => {
  // '7coins' cannot be the main tag; 'vankush' becomes main instead.
  const r = validateTags(['7coins', 'vankush', 'punicwax']);
  assert.deepEqual(r.valid, ['vankush', 'punicwax']);
  assert.deepEqual(r.invalid, ['7coins']);
});

test('validateTags: enforces MAX_TAGS cap, overflow -> invalid', () => {
  const r = validateTags(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(r.valid.length, MAX_TAGS);
  assert.deepEqual(r.valid, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(r.invalid, ['f', 'g']);
});

test('validateTags: over-length tag normalizes to "" -> invalid', () => {
  const big = 'z'.repeat(MAX_TAG_LEN + 5);
  const r = validateTags(['vankush', big]);
  assert.deepEqual(r.valid, ['vankush']);
  // big normalizes to '' so its raw label is the original long string.
  assert.deepEqual(r.invalid, [big]);
});

test('validateTags: soft-fails non-array to empty buckets', () => {
  assert.deepEqual(validateTags(null), { valid: [], invalid: [], duplicates: [] });
  assert.deepEqual(validateTags('vankush'), { valid: [], invalid: [], duplicates: [] });
  assert.deepEqual(validateTags(undefined), { valid: [], invalid: [], duplicates: [] });
});

test('validateTags: all entries fail main-tag rule -> all invalid', () => {
  const r = validateTags(['7a', '8b', '9c']);
  assert.deepEqual(r.valid, []);
  assert.deepEqual(r.invalid, ['7a', '8b', '9c']);
});

test('summarize: renders report and esc()s interpolation', () => {
  const md = summarize(['#vankush', '#punicwax', '#cryptology']);
  assert.match(md, /# SCOT\/SMT tag-config validation/);
  assert.match(md, /main tag: \*\*vankush\*\*/);
  assert.match(md, /valid \(3\/5\): vankush, punicwax, cryptology/);
});

test('summarize: empty/invalid input renders an empty report', () => {
  const md = summarize(null);
  assert.match(md, /main tag: \*\*\(none\)\*\*/);
  assert.match(md, /valid \(0\/5\): \(none\)/);
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

test('no function throws on hostile input', () => {
  const hostile = [Symbol('x'), NaN, Infinity, -1, [], {}, () => {}];
  for (const h of hostile) {
    assert.doesNotThrow(() => normalizeTag(h));
    assert.doesNotThrow(() => isMainTagValid(h));
    assert.doesNotThrow(() => dedupe(h));
    assert.doesNotThrow(() => validateTags(h));
    assert.doesNotThrow(() => summarize(h));
  }
});
