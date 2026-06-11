// perceptual-hash.test.mjs — offline, deterministic. node --test integrations/perceptual-hash.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aHash,
  dHash,
  hammingDistance,
  similarity,
  isDuplicate,
} from './perceptual-hash.mjs';

// helper: build a flat size*size grid
function grid(size, fn) {
  const out = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + x] = fn(x, y);
  }
  return out;
}

test('aHash: stable hex for a known 8x8 grid', () => {
  // left half dark (0), right half bright (255) -> deterministic split.
  const px = grid(8, (x) => (x < 4 ? 0 : 255));
  const h = aHash(px, { size: 8 });
  assert.equal(typeof h, 'string');
  assert.equal(h.length, 16); // 64 bits / 4 = 16 hex chars
  // recomputing gives the identical hash (deterministic)
  assert.equal(aHash(px, { size: 8 }), h);
});

test('aHash: identical inputs => distance 0', () => {
  const px = grid(8, (x, y) => (x + y) * 4);
  const h1 = aHash(px);
  const h2 = aHash(px.slice());
  assert.equal(hammingDistance(h1, h2), 0);
  assert.equal(similarity(h1, h2), 1);
  assert.equal(isDuplicate(h1, h2), true);
});

test('aHash: single-cell flip across the mean => distance 1', () => {
  // Bimodal grid: half the cells at 0, half at 200, so the mean sits ~100 and is robust to one
  // cell moving. Flip exactly one 0-cell up to 200: only that bit crosses the mean.
  const base = grid(8, (x, y) => ((y * 8 + x) % 2 === 0 ? 0 : 200));
  const h1 = aHash(base);
  const flipped = base.slice();
  flipped[0] = 200; // index 0 was a 0-cell (below mean); now above mean -> exactly one bit flips
  const h2 = aHash(flipped);
  assert.equal(hammingDistance(h1, h2), 1);
});

test('aHash: box-resizes a larger square frame', () => {
  // 16x16 -> resized to 8x8; should produce a valid 16-char hash.
  const big = grid(16, (x) => (x < 8 ? 0 : 255));
  const h = aHash(big);
  assert.equal(typeof h, 'string');
  assert.equal(h.length, 16);
});

test('aHash: width/height opts drive a non-square resize', () => {
  // 12 wide x 4 tall, left dark / right bright
  const w = 12, ht = 4;
  const px = new Array(w * ht);
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) px[y * w + x] = x < 6 ? 0 : 255;
  const h = aHash(px, { size: 8, width: w, height: ht });
  assert.equal(typeof h, 'string');
  assert.equal(h.length, 16);
});

test('dHash: stable hex + deterministic', () => {
  // horizontal gradient -> each pixel < its right neighbour -> all "left>right" false
  const w = 9, ht = 8; // already (size+1) x size for size=8
  const px = new Array(w * ht);
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) px[y * w + x] = x * 20;
  const h = dHash(px, w, ht, { size: 8 });
  assert.equal(typeof h, 'string');
  assert.equal(h.length, 16);
  assert.equal(dHash(px, w, ht, { size: 8 }), h);
  // strictly increasing rows means no "left>right" bit set -> all zeros
  assert.equal(h, '0'.repeat(16));
});

test('dHash: identical => distance 0; reversed gradient differs', () => {
  const w = 9, ht = 8;
  const inc = new Array(w * ht);
  const dec = new Array(w * ht);
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) {
    inc[y * w + x] = x * 20;
    dec[y * w + x] = (w - 1 - x) * 20;
  }
  const hInc = dHash(inc, w, ht);
  const hInc2 = dHash(inc.slice(), w, ht);
  const hDec = dHash(dec, w, ht);
  assert.equal(hammingDistance(hInc, hInc2), 0);
  assert.ok(hammingDistance(hInc, hDec) > 0);
});

test('hammingDistance: known pairs', () => {
  assert.equal(hammingDistance('00', '00'), 0);
  assert.equal(hammingDistance('00', '01'), 1); // 0000 0000 vs 0000 0001
  assert.equal(hammingDistance('0f', 'f0'), 8);
  assert.equal(hammingDistance('ff', 'ff'), 0);
  assert.equal(hammingDistance('ABCD', 'abcd'), 0); // case-insensitive
});

test('hammingDistance: length mismatch / bad hex => Infinity (soft-fail)', () => {
  assert.equal(hammingDistance('00', '000'), Infinity);
  assert.equal(hammingDistance('xy', '00'), Infinity);
  assert.equal(hammingDistance('', '00'), Infinity);
  assert.equal(hammingDistance(null, '00'), Infinity);
  assert.equal(hammingDistance(undefined, undefined), Infinity);
});

test('similarity: 0..1 range and edge cases', () => {
  assert.equal(similarity('ff', 'ff'), 1);
  assert.equal(similarity('00', 'ff'), 0); // 8/8 bits differ
  assert.equal(similarity('0f', 'ff'), 0.5); // 4 of 8 bits differ
  assert.equal(similarity('00', '000'), 0); // mismatch -> non-finite -> 0
});

test('isDuplicate: threshold behaviour', () => {
  assert.equal(isDuplicate('ff', 'ff'), true); // dist 0
  assert.equal(isDuplicate('00', '01'), true); // dist 1 <= 5
  assert.equal(isDuplicate('00', 'ff'), false); // dist 8 > 5
  assert.equal(isDuplicate('00', 'ff', { threshold: 8 }), true);
  assert.equal(isDuplicate('00', '000'), false); // non-finite -> false
});

test('malformed pixel input soft-fails to null', () => {
  assert.equal(aHash(null), null);
  assert.equal(aHash(undefined), null);
  assert.equal(aHash([]), null);
  assert.equal(aHash('not pixels'), null);
  // non-square, no dims -> ambiguous -> null
  assert.equal(aHash([1, 2, 3, 4, 5]), null);
  assert.equal(dHash(null, 8, 8), null);
  assert.equal(dHash([1, 2, 3], 0, 0), null);
});

test('non-numeric pixel values are coerced (NaN -> 0), still hashes', () => {
  const px = grid(8, () => 'x'); // all NaN -> all 0
  const h = aHash(px);
  assert.equal(typeof h, 'string');
  assert.equal(h.length, 16);
});
