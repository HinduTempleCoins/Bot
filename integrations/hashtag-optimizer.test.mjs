// hashtag-optimizer.test.mjs — OFFLINE, deterministic. No network, no LLM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalTag, suggestHashtags, formatHashtags, hashtagsFor, optimize, PLATFORM_TAG_STYLE,
} from './hashtag-optimizer.mjs';

const POST = {
  title: 'Hathor joins MELEK as a founding Witness',
  body: 'The MELEK blockchain welcomes Hathor. We publish free legal reference at SoapBox Law and run a '
      + 'harm-reduction library covering cannabis and hemp. Crypto that earns, not speculation. Cannabis again.',
  tags: ['melek', 'witness'],
};

test('canonicalTag normalises to hyphen-joined lowercase word form', () => {
  assert.equal(canonicalTag('#MELEK'), 'melek');
  assert.equal(canonicalTag('Free Law Project'), 'free-law-project');
  assert.equal(canonicalTag('  Caselaw   Access  '), 'caselaw-access');
  assert.equal(canonicalTag('web3!!!'), 'web3');
  assert.equal(canonicalTag(''), '');
});

test('suggestHashtags ranks explicit + brand + proper-noun tags first, de-duplicated', () => {
  const tags = suggestHashtags(POST);
  assert.ok(Array.isArray(tags) && tags.length > 0);
  // explicit tags rank at the very top
  assert.equal(tags[0], 'melek');
  assert.ok(tags.includes('witness'));
  // a proper noun in the text is captured as a tag
  assert.ok(tags.includes('hathor'), 'proper-noun captured');
  // brand terms that appear in the text are present
  assert.ok(tags.includes('cannabis'));
  assert.ok(tags.includes('soapbox'));
  // no duplicates
  assert.equal(new Set(tags).size, tags.length);
});

test('suggestHashtags soft-fails to [] on junk input', () => {
  assert.deepEqual(suggestHashtags(null), []);
  assert.deepEqual(suggestHashtags(42), []);
  assert.deepEqual(suggestHashtags({}), []);
});

test('platform cap: X gets at most 3, Instagram more', () => {
  const x = suggestHashtags(POST, { platform: 'x' });
  const ig = suggestHashtags(POST, { platform: 'instagram' });
  assert.ok(x.length <= PLATFORM_TAG_STYLE.x.max);
  assert.ok(ig.length > x.length);
  assert.ok(ig.length <= PLATFORM_TAG_STYLE.instagram.max);
});

test('formatHashtags: CamelCase + # for social, ACRONYMS upper-cased', () => {
  const s = formatHashtags(['melek', 'free-law-project', 'cannabis'], 'x');
  assert.equal(s, '#MELEK #FreeLawProject #Cannabis');
});

test('formatHashtags: Hive-family renders bare hyphenated lowercase, no #', () => {
  const s = formatHashtags(['melek', 'free-law-project'], 'hive');
  assert.equal(s, 'melek free-law-project');
  assert.doesNotMatch(s, /#/);
});

test('formatHashtags: BitcoinTalk uses no hashtags', () => {
  assert.equal(formatHashtags(['melek', 'crypto'], 'bitcointalk'), '');
});

test('formatHashtags de-dupes and caps to the platform budget', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'a', 'b'];
  const s = formatHashtags(many, 'x'); // max 3
  assert.equal(s.split(' ').length, 3);
});

test('formatHashtags soft-fails to "" on junk', () => {
  assert.equal(formatHashtags(null, 'x'), '');
  assert.equal(formatHashtags(['x'], 'nope-platform').startsWith('#'), true); // unknown -> default camel
});

test('hashtagsFor: end-to-end suggest+render for one platform', () => {
  const s = hashtagsFor(POST, 'x');
  assert.match(s, /^#MELEK #Witness/);
  assert.ok(s.split(' ').length <= 3);
});

test('optimize returns per-platform tags + rendered hashtags', () => {
  const r = optimize(POST, { platforms: ['x', 'hive', 'bitcointalk'] });
  assert.ok(Array.isArray(r.suggested) && r.suggested.length > 0);
  assert.ok(r.platforms.x.hashtags.startsWith('#'));
  assert.doesNotMatch(r.platforms.hive.hashtags, /#/);
  assert.equal(r.platforms.bitcointalk.hashtags, '');
  // deterministic: same input -> same output
  const r2 = optimize(POST, { platforms: ['x', 'hive', 'bitcointalk'] });
  assert.deepEqual(r, r2);
});

test('brandTags force-injects a tag even if absent from the text', () => {
  const tags = suggestHashtags({ title: 'Plain title', body: 'nothing special here' }, { brandTags: ['prana'] });
  assert.ok(tags.includes('prana'));
});
