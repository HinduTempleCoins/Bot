// perceptual-hash.mjs — PURE, deterministic perceptual-image-hash helpers. Backlog 2fe68d0183.
// No image decoding, no network, no native deps, no LLM, no I/O. Input is ALREADY-DECODED
// grayscale pixel data (Array / typed-array of 0..255) plus width/height.
//
// PURPOSE:
//   Hathor / Cheetah need cheap, offline near-duplicate detection for images (e.g. catching the
//   same meme reposted, or a thumbnail vs. its source) WITHOUT pulling in an image-decode or
//   native dependency. The caller decodes to grayscale however it likes; we only do arithmetic.
//
//   Two classic hashes, both producing a 64-bit (for the default size=8) value as a 16-char hex
//   string:
//     - aHash (average hash):  downsample to size×size, threshold each cell against the mean.
//     - dHash (difference hash): downsample to size×(size+1), compare each pixel to its right
//                                neighbour (a gradient/brightness-direction hash).
//   Then hammingDistance / similarity / isDuplicate compare two hex hashes.
//
// SOFT-FAIL, NEVER THROW: malformed / missing / wrong-shape input collapses to a safe value.
//   Hashing failures return null; hammingDistance returns Infinity on length mismatch / bad hex;
//   similarity returns 0 and isDuplicate returns false when distance is non-finite.
//
//   import { aHash, dHash, hammingDistance, similarity, isDuplicate } from './integrations/perceptual-hash.mjs';
//   const h = aHash(pixels, { size: 8 });        // pixels = size*size grayscale 0..255, or larger (box-resized)
//   const g = dHash(pixels, width, height);      // raw grayscale frame, box-resized internally
//   hammingDistance(h1, h2);  similarity(h1, h2);  isDuplicate(h1, h2, { threshold: 5 });
//
// CLI:  node integrations/perceptual-hash.mjs <hexA> <hexB>   # print Hamming distance + similarity

// ── numeric coercion: anything non-finite collapses to 0, clamped to a byte ─────────────────────
function byte(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

function posInt(v, fallback) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── coerce input pixels into a flat numeric array of length >= 1, or null ───────────────────────
function toPixelArray(pixels) {
  if (pixels == null) return null;
  // typed arrays and plain arrays both have a numeric length and index access.
  const len = pixels.length;
  if (!Number.isFinite(len) || len < 1) return null;
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = byte(pixels[i]);
  return out;
}

// ── box-resize a (srcW × srcH) grayscale frame to (dstW × dstH) by block averaging ──────────────
// Deterministic nearest-block average. If src can't be interpreted as a w×h frame we fall back to
// treating the flat array as a square grid where possible.
function boxResize(flat, srcW, srcH, dstW, dstH) {
  const out = new Array(dstW * dstH).fill(0);
  if (!flat || flat.length < 1) return out;
  // Defensive: clamp the implied frame to the data we actually have.
  const usableH = srcW > 0 ? Math.min(srcH, Math.floor(flat.length / srcW)) : 0;
  if (srcW < 1 || usableH < 1) return out;
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor((dy * usableH) / dstH);
    let sy1 = Math.floor(((dy + 1) * usableH) / dstH);
    if (sy1 <= sy0) sy1 = sy0 + 1;
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor((dx * srcW) / dstW);
      let sx1 = Math.floor(((dx + 1) * srcW) / dstW);
      if (sx1 <= sx0) sx1 = sx0 + 1;
      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        const row = sy * srcW;
        for (let sx = sx0; sx < sx1; sx++) {
          sum += flat[row + sx];
          count++;
        }
      }
      out[dy * dstW + dx] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

// ── pack an array of booleans (MSB first) into a lowercase hex string ───────────────────────────
function bitsToHex(bits) {
  // pad up to a multiple of 4 so every hex nibble is well-defined.
  const n = bits.length;
  const padded = n % 4 === 0 ? n : n + (4 - (n % 4));
  let hex = '';
  for (let i = 0; i < padded; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) {
      nibble = (nibble << 1) | (bits[i + b] ? 1 : 0);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

// ── average hash ────────────────────────────────────────────────────────────────────────────────
// Caller may pass an already-downsampled size*size grid, OR a larger grayscale frame with
// {width,height} for us to box-resize. Returns a hex string (size*size bits) or null on bad input.
export function aHash(pixels, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const size = posInt(o.size, 8);
  const flat = toPixelArray(pixels);
  if (!flat) return null;

  const want = size * size;
  let grid;
  if (flat.length === want) {
    grid = flat;
  } else {
    // Need dimensions to resize. Accept width/height from opts; else assume a square frame.
    const w = posInt(o.width, 0);
    const h = posInt(o.height, 0);
    if (w > 0 && h > 0) {
      grid = boxResize(flat, w, h, size, size);
    } else {
      const side = Math.round(Math.sqrt(flat.length));
      if (side > 0 && side * side === flat.length) {
        grid = boxResize(flat, side, side, size, size);
      } else {
        return null; // ambiguous shape — soft-fail.
      }
    }
  }

  let sum = 0;
  for (let i = 0; i < grid.length; i++) sum += grid[i];
  const mean = sum / grid.length;
  const bits = new Array(grid.length);
  for (let i = 0; i < grid.length; i++) bits[i] = grid[i] >= mean ? 1 : 0;
  return bitsToHex(bits);
}

// ── difference (gradient) hash ──────────────────────────────────────────────────────────────────
// Box-resizes the raw (width×height) grayscale frame to (size+1)×size, then for each row compares
// each pixel with its right neighbour: bit = left > right. Yields size*size bits. Returns hex or null.
export function dHash(pixels, width, height, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const size = posInt(o.size, 8);
  const flat = toPixelArray(pixels);
  if (!flat) return null;

  const w = posInt(width, 0);
  const h = posInt(height, 0);
  let grid;
  const cols = size + 1;
  const rows = size;
  if (w > 0 && h > 0) {
    grid = boxResize(flat, w, h, cols, rows);
  } else if (flat.length === cols * rows) {
    grid = flat;
  } else {
    const side = Math.round(Math.sqrt(flat.length));
    if (side > 0 && side * side === flat.length) {
      grid = boxResize(flat, side, side, cols, rows);
    } else {
      return null;
    }
  }

  const bits = new Array(size * size);
  let k = 0;
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < size; x++) {
      bits[k++] = grid[row + x] > grid[row + x + 1] ? 1 : 0;
    }
  }
  return bitsToHex(bits);
}

// ── popcount lookup for one hex nibble ──────────────────────────────────────────────────────────
const NIBBLE_BITS = (() => {
  const t = new Array(16);
  for (let i = 0; i < 16; i++) t[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1);
  return t;
})();

function isHexString(s) {
  return typeof s === 'string' && s.length > 0 && /^[0-9a-fA-F]+$/.test(s);
}

// ── Hamming distance between two equal-length hex hashes; Infinity on mismatch / bad hex ────────
export function hammingDistance(hexA, hexB) {
  if (!isHexString(hexA) || !isHexString(hexB)) return Infinity;
  if (hexA.length !== hexB.length) return Infinity;
  const a = hexA.toLowerCase();
  const b = hexB.toLowerCase();
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += NIBBLE_BITS[diff];
  }
  return dist;
}

// ── similarity 0..1 = 1 - dist/bits; 0 when distance is non-finite ──────────────────────────────
export function similarity(hexA, hexB) {
  const dist = hammingDistance(hexA, hexB);
  if (!Number.isFinite(dist)) return 0;
  const bits = hexA.length * 4;
  if (bits <= 0) return 0;
  const s = 1 - dist / bits;
  if (s < 0) return 0;
  if (s > 1) return 1;
  return s;
}

// ── duplicate test: distance <= threshold (default 5); false on non-finite distance ─────────────
export function isDuplicate(hexA, hexB, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const threshold = Number.isFinite(Number(o.threshold)) ? Number(o.threshold) : 5;
  const dist = hammingDistance(hexA, hexB);
  if (!Number.isFinite(dist)) return false;
  return dist <= threshold;
}

// ── CLI demo (guarded; stdout only) ─────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [hexA, hexB] = process.argv.slice(2);
  if (!hexA || !hexB) {
    console.log('usage: node integrations/perceptual-hash.mjs <hexA> <hexB>');
  } else {
    const dist = hammingDistance(hexA, hexB);
    const sim = similarity(hexA, hexB);
    console.log(`distance=${dist} similarity=${sim.toFixed(4)} duplicate=${isDuplicate(hexA, hexB)}`);
  }
}
