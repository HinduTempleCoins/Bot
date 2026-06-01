// perceptual-hash.test.js — Cheetah's credit-giver backbone. Pure hash math +
// the earliest-poster credit index, all without network or jimp (decoder injected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  dHashFromGray, hammingDistance, imageHash, indexImage, findOriginal,
  __setDecoder, __setFetch, HAMMING_MATCH_MAX,
} from './perceptual-hash.js';

function tmp(tag) { return join(tmpdir(), `cheetah-ph-${tag}-${process.pid}.json`); }

// a 9x8 gradient that increases left->right, so every dHash bit is 0 (left < right).
function gradient(w = 9, h = 8) {
  const g = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x * 20;
  return g;
}

test('dHashFromGray returns a 16-hex (64-bit) string', () => {
  const hex = dHashFromGray(gradient());
  assert.equal(hex.length, 16);
  assert.match(hex, /^[0-9a-f]{16}$/);
  // increasing gradient => left always darker than right => all bits 0
  assert.equal(hex, '0000000000000000');
});

test('hammingDistance: identical=0, single nibble flip counts the bits', () => {
  assert.equal(hammingDistance('0000000000000000', '0000000000000000'), 0);
  assert.equal(hammingDistance('0000000000000000', '1000000000000000'), 1); // 0x1 = 1 bit
  assert.equal(hammingDistance('0000000000000000', 'f000000000000000'), 4); // 0xf = 4 bits
  assert.equal(hammingDistance('abc', 'abcd'), Infinity); // length mismatch
});

test('imageHash uses injected fetch + decoder (no jimp, no network)', async () => {
  __setFetch(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  __setDecoder(() => ({ gray: gradient(), w: 9, h: 8 }));
  const h = await imageHash('http://x/img.png');
  assert.equal(h, '0000000000000000');
  __setFetch(null); __setDecoder(null);
});

test('credit index returns the EARLIEST poster of a matching image', async () => {
  const path = tmp('credit');
  await rm(path, { force: true });
  const HASH = 'ffeeddccbbaa9988';
  // bob posts it later, alice posted it first
  await indexImage({ hash: HASH, author: 'alice', permlink: 'orig', seenAt: '2026-01-01T00:00:00Z' }, path);
  await indexImage({ hash: HASH, author: 'bob', permlink: 'repost', seenAt: '2026-03-01T00:00:00Z' }, path);
  const credit = await findOriginal(HASH, {}, path);
  assert.equal(credit.match, true);
  assert.equal(credit.original.author, 'alice'); // earliest = who credit is due
  assert.equal(credit.distance, 0);
  assert.ok(credit.confidence > 0.9);
  assert.equal(credit.appearances, 2);
  await rm(path, { force: true });
});

test('near-match within Hamming threshold credits; beyond it does not', async () => {
  const path = tmp('near');
  await rm(path, { force: true });
  await indexImage({ hash: '0000000000000000', author: 'alice', permlink: 'orig', seenAt: '2026-01-01T00:00:00Z' }, path);
  // one nibble of 'f' = 4 bits different, within default max (10)
  const near = await findOriginal('f000000000000000', {}, path);
  assert.equal(near?.match, true);
  assert.equal(near.distance, 4);
  // a wildly different hash (many bits) is beyond threshold -> no credit (this post may be original)
  const far = await findOriginal('ffffffffffffffff', { maxDistance: HAMMING_MATCH_MAX }, path);
  assert.equal(far, null);
  await rm(path, { force: true });
});

test('first-ever poster of an image gets no prior match (it IS the original)', async () => {
  const path = tmp('first');
  await rm(path, { force: true });
  const credit = await findOriginal('1234567890abcdef', {}, path);
  assert.equal(credit, null);
  await rm(path, { force: true });
});
