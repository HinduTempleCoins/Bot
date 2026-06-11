// image-theft-detect.test.mjs — OFFLINE tests for the image-theft / near-duplicate detector.
// node --test cheetah/image-theft-detect.test.mjs   (no network, no native deps).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectImageTheft,
  detector,
  esc,
  DEFAULT_THRESHOLD,
  __setReader,
  __setStore,
  __setFetch,
  __resetSeams,
} from './image-theft-detect.mjs';
import { aHash, hammingDistance } from '../integrations/perceptual-hash.mjs';

// ── helpers ─────────────────────────────────────────────────────────────────────
// Real 16-hex-char (64-bit) perceptual hashes, hand-picked so the Hamming distances are exact and
// obvious. aHash() over a checkerboard-ish 8x8 yields these shapes; we assert the relationships
// directly via the real hammingDistance() so the fixtures are self-checking below.
const ORIGINAL = 'f0f0f0f0f0f0f0f0';          // a known-original image hash
const NEAR     = 'f0f0f0f0f0f0f0f4';          // 2 bits different from ORIGINAL (light recompress)
const OTHER    = '0f0f0f0f0f0f0f0f';          // every bit flipped — a clearly-different image

// Self-check the fixture distances so the rest of the suite rests on solid ground.
test('fixture sanity: distances are as assumed', () => {
  assert.equal(hammingDistance(ORIGINAL, ORIGINAL), 0);
  const dNear = hammingDistance(NEAR, ORIGINAL);
  assert.ok(dNear > 0 && dNear <= DEFAULT_THRESHOLD, `NEAR distance ${dNear} in (0, ${DEFAULT_THRESHOLD}]`);
  assert.ok(hammingDistance(OTHER, ORIGINAL) > DEFAULT_THRESHOLD, 'OTHER must be far from ORIGINAL');
  // aHash is exercised too: a real hash is a 16-char hex string.
  assert.match(aHash([...Array(64)].map((_, i) => (i % 2) * 255)), /^[0-9a-f]{16}$/);
});

test('exact-hash repost by a different author flags at severity 5', () => {
  const r = detectImageTheft(
    { hash: ORIGINAL, author: '@thief' },
    { known: [{ hash: ORIGINAL, author: '@artist', url: 'https://melek.salon/@artist/post' }] });
  assert.ok(r.flag, 'expected a flag for an identical repost');
  assert.equal(r.flag.kind, 'image-theft');
  assert.equal(r.flag.severity, 5);
  assert.equal(r.match.distance, 0);
  assert.equal(r.score, 1);
  assert.match(r.flag.reason, /melek\.salon/);
});

test('near-duplicate within threshold flags; credits the original author', () => {
  const dist = hammingDistance(NEAR, ORIGINAL);
  assert.ok(dist > 0 && dist <= DEFAULT_THRESHOLD, `precondition: ${dist} in (0, ${DEFAULT_THRESHOLD}]`);
  const r = detectImageTheft(
    { hash: NEAR, author: '@thief' },
    { known: [{ hash: ORIGINAL, author: '@artist' }] });
  assert.ok(r.flag, 'expected a flag for a near-duplicate');
  assert.equal(r.flag.kind, 'image-theft');
  assert.ok(r.flag.severity >= 2 && r.flag.severity <= 5);
  assert.equal(r.match.author, '@artist');
  assert.match(r.flag.reason, /@artist/);
});

test('same author reposting their OWN image is NOT theft (no flag)', () => {
  const r = detectImageTheft(
    { hash: ORIGINAL, author: '@artist' },
    { known: [{ hash: ORIGINAL, author: '@artist' }] });
  assert.equal(r.flag, null);
  assert.equal(r.match, null);
});

test('a clearly-different image does not flag', () => {
  const r = detectImageTheft(
    { hash: OTHER, author: '@thief' },
    { known: [{ hash: ORIGINAL, author: '@artist' }] });
  assert.equal(r.flag, null);
  assert.equal(r.score, 0);
});

test('injectable threshold: tightening below the distance suppresses the flag', () => {
  const dist = hammingDistance(NEAR, ORIGINAL);
  const tight = detectImageTheft(
    { hash: NEAR, author: '@thief' },
    { known: [{ hash: ORIGINAL, author: '@artist' }], threshold: Math.max(0, dist - 1) });
  assert.equal(tight.flag, null, 'distance above threshold → no flag');
  const loose = detectImageTheft(
    { hash: NEAR, author: '@thief' },
    { known: [{ hash: ORIGINAL, author: '@artist' }], threshold: dist });
  assert.ok(loose.flag, 'distance at threshold → flag');
});

test('bare hex-string candidate + opts.author works; nearest original wins', () => {
  const r = detectImageTheft(ORIGINAL, {
    author: '@thief',
    known: [
      { hash: OTHER, author: '@someone' },
      { hash: NEAR, author: '@artist' },     // closer than OTHER
      { hash: ORIGINAL, author: '@source' }, // identical — nearest of all
    ],
  });
  assert.ok(r.flag);
  assert.equal(r.match.author, '@source');
  assert.equal(r.match.distance, 0);
});

test('bare hex-string known entries are accepted (no author → treated as different)', () => {
  const r = detectImageTheft({ hash: ORIGINAL, author: '@thief' }, { known: [ORIGINAL] });
  assert.ok(r.flag, 'a bare known hash with no author still compares and flags');
  assert.equal(r.match.distance, 0);
  // credit falls back to a generic phrase when no author/url is known
  assert.match(r.flag.reason, /known original/);
});

// ── edge / soft-fail cases ────────────────────────────────────────────────────────
test('soft-fail: null / missing candidate hash → neutral result, no throw', () => {
  assert.deepEqual(detectImageTheft(null, { known: [{ hash: ORIGINAL }] }), { score: 0, match: null, flag: null });
  assert.deepEqual(detectImageTheft({}, { known: [{ hash: ORIGINAL }] }), { score: 0, match: null, flag: null });
  assert.deepEqual(detectImageTheft({ hash: '' }, { known: [{ hash: ORIGINAL }] }), { score: 0, match: null, flag: null });
});

test('soft-fail: empty / missing / non-array known corpus → no flag, no throw', () => {
  assert.equal(detectImageTheft({ hash: ORIGINAL, author: '@x' }, { known: [] }).flag, null);
  assert.equal(detectImageTheft({ hash: ORIGINAL, author: '@x' }, {}).flag, null);
  assert.equal(detectImageTheft({ hash: ORIGINAL, author: '@x' }, { known: 'nope' }).flag, null);
  assert.equal(detectImageTheft({ hash: ORIGINAL, author: '@x' }, null).flag, null);
});

test('soft-fail: bad-hex / mismatched-length hashes are skipped (Infinity distance)', () => {
  // hammingDistance returns Infinity on bad hex or length mismatch → never within threshold.
  const r = detectImageTheft(
    { hash: ORIGINAL, author: '@thief' },
    { known: [{ hash: 'zzzz', author: '@a' }, { hash: 'abc', author: '@b' }] });
  assert.equal(r.flag, null);
  assert.equal(r.match, null);
});

test('reason is HTML-escaped (defence in depth)', () => {
  const r = detectImageTheft(
    { hash: ORIGINAL, author: '@thief' },
    { known: [{ hash: ORIGINAL, author: '<b>artist</b>' }] });
  assert.ok(r.flag);
  assert.ok(!r.flag.reason.includes('<b>'), 'raw markup must not survive into the reason');
  assert.match(r.flag.reason, /&lt;b&gt;/);
});

test('esc() escapes the five HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── registry adapter shape ──────────────────────────────────────────────────────
test('detector adapter has the registry { kind, run } shape', () => {
  assert.equal(detector.kind, 'image-theft');
  assert.equal(typeof detector.run, 'function');
});

test('detector.run() flags via the unified content envelope', () => {
  const flag = detector.run({
    image: { hash: ORIGINAL, author: '@thief' },
    knownImages: [{ hash: ORIGINAL, author: '@artist', url: 'https://melek.salon/x' }],
  });
  assert.ok(flag);
  assert.equal(flag.kind, 'image-theft');
  assert.equal(flag.severity, 5);
});

test('detector.run() reads imageHash + account + threshold; same author → null', () => {
  // candidate posted by the same account as the original → not theft
  assert.equal(detector.run({
    imageHash: ORIGINAL,
    account: '@artist',
    knownImages: [{ hash: ORIGINAL, author: '@artist' }],
  }), null);
  // different account → flag
  const flag = detector.run({
    imageHash: ORIGINAL,
    account: '@thief',
    knownImages: [{ hash: ORIGINAL, author: '@artist' }],
    threshold: 0,
  });
  assert.ok(flag);
});

test('detector.run() soft-fails on junk content → null', () => {
  assert.equal(detector.run(null), null);
  assert.equal(detector.run('not an object'), null);
  assert.equal(detector.run({ image: { hash: '' } }), null);
  assert.equal(detector.run({}), null);
});

// ── seams are inert / restorable ──────────────────────────────────────────────────
test('injectable seams are settable and resettable without affecting the offline path', () => {
  assert.equal(typeof __setReader, 'function');
  assert.equal(typeof __setStore, 'function');
  assert.equal(typeof __setFetch, 'function');
  __setReader(() => ['@artist']);
  __setStore({ note: 'x' });
  __setFetch(async () => ({ ok: true }));
  // offline detection is unchanged by the seams
  const r = detectImageTheft({ hash: ORIGINAL, author: '@thief' }, { known: [{ hash: ORIGINAL, author: '@a' }] });
  assert.ok(r.flag);
  __resetSeams(); // must not throw
});
