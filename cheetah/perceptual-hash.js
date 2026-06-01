/**
 * perceptual-hash.js — Cheetah's image credit-giver backbone (keyless).
 *
 * Per the operator's own spec (2026-06-01, confirmed from the repo conversations):
 * Cheetah exists to make the platform LEGAL by always giving credit where credit is
 * due — the chronic Steem/HIVE/BLURT problem is uncredited reposts. The image engine
 * the conversations describe is pHash + CLIP + FAISS, modeled on RepostSleuthBot:
 * STATE the fact ("this image first appeared at @original/permlink"), never accuse.
 *
 * This module is TIER 0 — the perceptual-hash layer, which needs NO API and is the
 * legally-meaningful "same / near-same image" detector:
 *   1. fingerprint each on-chain image with a difference-hash (dHash).
 *   2. index (hash -> earliest author/permlink that posted it).
 *   3. on a new post, hash its image and find the EARLIEST prior poster within a small
 *      Hamming distance. That earliest poster is who credit is due.
 *
 * The HASH MATH is pure JS over a grayscale matrix (testable with no image/network).
 * The DECODE (url -> grayscale) uses jimp when available, and degrades gracefully so
 * the rest of Cheetah keeps working if jimp isn't installed.
 *
 * Higher tiers live elsewhere: reverse-image API (open web) + Gemini watermark/source
 * extraction are in image-detection.js; CLIP semantic "this is like" is the future
 * tier (needs an embedding model — design hook: storeEmbedding/findSimilarEmbedding).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

const HASH_PATH = process.env.CHEETAH_IMAGE_HASH_STORE || './cheetah/.image-hashes.json';
// max Hamming distance (out of 64 bits) to count as "the same image". 0-2 = essentially
// identical; ~10 tolerates recompression/resize. Tunable: lower = stricter credit.
export const HAMMING_MATCH_MAX = parseInt(process.env.CHEETAH_HAMMING_MAX || '10', 10);

// ---- the hash math (pure, testable) ---------------------------------------

/**
 * difference-hash from a grayscale matrix. Expects a flat array of length
 * (w)*(h) row-major, where w = size+1 and h = size (default 9x8 -> 64 bits).
 * Each output bit = (left pixel brighter than its right neighbour). Returns a
 * 16-char hex string (64 bits).
 */
export function dHashFromGray(gray, w = 9, h = 8) {
  if (!Array.isArray(gray) && !ArrayBuffer.isView(gray)) throw new Error('gray must be an array');
  if (gray.length < w * h) throw new Error(`gray length ${gray.length} < ${w}*${h}`);
  let bits = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const left = gray[y * w + x];
      const right = gray[y * w + x + 1];
      bits += left > right ? '1' : '0';
    }
  }
  // pack 64 bits -> 16 hex chars
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Hamming distance between two equal-length hex hashes (number of differing bits). */
export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

// ---- decode (jimp when available, graceful otherwise) ---------------------

let _decoder = null; // injectable for tests: (Buffer) -> { gray, w, h }
export function __setDecoder(fn) { _decoder = fn; }

async function decodeToGray(buf, size = 8) {
  if (_decoder) return _decoder(buf, size);
  let Jimp;
  try { ({ default: Jimp } = await import('jimp')); }
  catch { return null; } // jimp not installed — caller treats as "can't hash here"
  const img = await Jimp.read(buf);
  img.resize(size + 1, size).greyscale();
  const w = size + 1, h = size, gray = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // greyscale: r==g==b, read the red channel
    gray[y * w + x] = img.bitmap.data[(y * w + x) * 4];
  }
  return { gray, w, h };
}

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** url -> dHash hex, or null if it can't be decoded (no jimp / fetch failed). */
export async function imageHash(imageUrl) {
  try {
    const r = await _fetch(imageUrl, { headers: { 'user-agent': 'MELEK-Cheetah/1.0' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const decoded = await decodeToGray(buf, 8);
    if (!decoded) return null;
    return dHashFromGray(decoded.gray, decoded.w, decoded.h);
  } catch { return null; }
}

// ---- the credit index (hash -> earliest poster) ----------------------------

async function loadIndex(path = HASH_PATH) {
  if (!existsSync(path)) return { images: [] };
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return { images: [] }; }
}
async function saveIndex(state, path = HASH_PATH) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Record that an image (by hash) appeared in a post. Idempotent per (hash, author,
 * permlink). first_seen is preserved — the index is a record of WHO posted WHEN, so
 * the earliest poster of a given image can be credited.
 */
export async function indexImage({ hash, author, permlink, seenAt }, path = HASH_PATH) {
  if (!hash) return { indexed: false, reason: 'no-hash' };
  const state = await loadIndex(path);
  const dup = state.images.find((i) => i.hash === hash && i.author === author && i.permlink === permlink);
  if (dup) return { indexed: false, deduplicated: true };
  state.images.push({ hash, author, permlink, seen_at: seenAt || new Date().toISOString() });
  await saveIndex(state, path);
  return { indexed: true };
}

/**
 * Find who credit is due for an image: the EARLIEST-seen prior post whose image hash
 * is within HAMMING_MATCH_MAX of this one. Returns null if no prior match (i.e. this
 * post may itself be the original). States a fact; the resolution layer decides intent.
 */
export async function findOriginal(hash, { maxDistance = HAMMING_MATCH_MAX, before } = {}, path = HASH_PATH) {
  if (!hash) return null;
  const state = await loadIndex(path);
  const matches = state.images
    .map((i) => ({ ...i, distance: hammingDistance(hash, i.hash) }))
    .filter((i) => i.distance <= maxDistance)
    .filter((i) => (before ? i.seen_at < before : true))
    .sort((a, b) => (a.seen_at < b.seen_at ? -1 : 1)); // earliest first
  if (!matches.length) return null;
  const original = matches[0];
  return {
    match: true,
    original: { author: original.author, permlink: original.permlink, seen_at: original.seen_at },
    distance: original.distance,
    confidence: original.distance === 0 ? 0.98 : Math.max(0.6, 1 - original.distance / 64),
    appearances: matches.length,
  };
}

export const _internal = { loadIndex, saveIndex, HASH_PATH };
