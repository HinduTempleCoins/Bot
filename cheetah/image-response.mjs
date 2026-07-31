// image-response.mjs — Cheetah's "there's a picture in this post" responder.
//
// WHY THIS EXISTS
//   The existing image path (image-scan.js / image-detection.js / image-theft-detect.mjs) is the
//   heavy, keyed pipeline (Gemini vision, reverse-image APIs, the shared pHash credit index). THIS
//   module is the small, self-contained "a post arrived with an image — recognize it and say
//   something" seam: extract the image URLs, perceptually fingerprint each via an INJECTED fetch,
//   look each fingerprint up in an INJECTED match index, and hand back Cheetah's credit-first note.
//
//   Credit-first, never moralizing (CHEETAH_ADVANCED.md §2): a match STATES where the image was seen
//   before and links the source; no match is a neutral acknowledgement, not an accusation. Hathor
//   resolves; Cheetah only states facts.
//
// HOUSE STYLE
//   • ESM .mjs, soft-fail-never-throw: every public fn collapses to a safe value, never crashes.
//   • Injectable fetch (__setFetch) + injectable match index (__setIndex) so it is fully OFFLINE
//     testable — no network, no keys, no native image-decode dependency.
//   • Reuses the pure hash lib (integrations/perceptual-hash.mjs: aHash / hammingDistance / similarity),
//     the near-duplicate threshold (image-theft-detect.mjs: DEFAULT_THRESHOLD), and the credit-first
//     comment templates (compose.js: composeImageCreditNote / footer). It adds no new hashing scheme.
//   • esc() any value echoed into the (HTML-renderable) neutral note.
//
//   import { extractImages, fingerprint, respondToPost } from './image-response.mjs';
//   const r = await respondToPost(post, { index: myMatchIndex });
//   // r = { ok:true, images:[{ url, phash, match }], reply } | { ok:false, reason:'no-image' }

import { aHash, hammingDistance, similarity } from '../integrations/perceptual-hash.mjs';
import { DEFAULT_THRESHOLD } from './image-theft-detect.mjs';
import { composeImageCreditNote, footer } from './compose.js';

// ── esc(): HTML-escape any value that may be rendered in a review UI / condenser comment box. ───────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── injectable seams (parity with the rest of Cheetah; both default to "offline / none"). ───────────
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
let _index = null;

/** Seam: image-byte fetch. In production the real fetch; in tests a stub returning fake bytes. */
export function __setFetch(fn) { _fetch = (typeof fn === 'function') ? fn : _fetch; return _fetch; }
/** Seam: default match index (function / {lookup} / array of records). Overridable per-call via opts.index. */
export function __setIndex(idx) { _index = idx != null ? idx : _index; return _index; }
/** Restore seams to defaults (tests). */
export function __resetSeams() {
  _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
  _index = null;
}

const UA = 'MELEK-Cheetah/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// ── extractImages(post) → de-duped array of image URLs in the post body. ────────────────────────────
// Accepts a post object ({ body }) or a bare body string. Catches markdown ![alt](url), raw <img src>,
// and bare image links. Same shape as image-scan.js's extractImageUrls (kept local so this module is
// self-contained), including the prefix de-dupe that drops a bare-URL match truncated at the extension
// when the full (query-string-carrying) URL was also captured.
export function extractImages(post) {
  try {
    const body = typeof post === 'string' ? post : String((post && post.body) || '');
    const urls = new Set();
    const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
    const img = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
    const bare = /(https?:\/\/[^\s)"'<>]+\.(?:png|jpe?g|gif|webp|bmp))/gi;
    let m;
    while ((m = md.exec(body))) urls.add(m[1]);
    while ((m = img.exec(body))) urls.add(m[1]);
    while ((m = bare.exec(body))) urls.add(m[1]);
    const all = [...urls];
    return all.filter((u) => !all.some((v) => v !== u && v.startsWith(u)));
  } catch {
    return []; // soft-fail
  }
}

// ── read the raw image bytes from the injected fetch, as a Uint8Array (or null). ────────────────────
async function fetchBytes(url, fetchFn) {
  const f = typeof fetchFn === 'function' ? fetchFn : _fetch;
  if (typeof f !== 'function' || !url) return null;
  const r = await f(url, { headers: { 'user-agent': UA } });
  if (!r) return null;
  if ('ok' in r && !r.ok) return null;               // soft-fail on non-2xx when a status is present
  const buf = await r.arrayBuffer();                 // Node fetch / undici Response shape
  return new Uint8Array(buf);
}

// ── box-average a raw byte stream into `cells` buckets (a keyless, decode-free luminance proxy). ────
// We have no image decoder here (by design — no native deps), so the byte stream itself is treated as
// a 1-D signal and averaged into size*size buckets; aHash() then thresholds against the mean. Same
// image bytes → same buckets → same hash (stable/deterministic), which is all the near-duplicate
// comparison needs.
function bucketBytes(bytes, cells) {
  const out = new Array(cells).fill(0);
  const n = bytes.length;
  if (n < 1) return out;
  for (let c = 0; c < cells; c++) {
    const lo = Math.floor((c * n) / cells);
    let hi = Math.floor(((c + 1) * n) / cells);
    if (hi <= lo) hi = lo + 1;
    let sum = 0;
    let count = 0;
    for (let i = lo; i < hi && i < n; i++) { sum += bytes[i]; count++; }
    out[c] = count > 0 ? sum / count : 0;
  }
  return out;
}

// ── fingerprint(url, opts) → a perceptual (average) hash hex string, or null. Never throws. ─────────
// opts.size (default 8 → a 64-bit / 16-hex hash), opts.fetch to override the injected fetch.
export async function fingerprint(url, opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const size = Number.isFinite(Number(o.size)) && Number(o.size) > 0 ? Math.trunc(Number(o.size)) : 8;
    const bytes = await fetchBytes(url, o.fetch);
    if (!bytes || bytes.length < 1) return null;
    // Reuse the pure lib: feed size*size averaged "pixels" to aHash (which thresholds against the mean).
    const cells = bucketBytes(bytes, size * size);
    const h = aHash(cells, { size });
    return h || null;
  } catch {
    return null; // soft-fail-never-throw
  }
}

// ── hashOf(): pull a hex hash out of an index record (bare string or { hash | phash }). ─────────────
function hashOf(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') return entry || null;
  if (typeof entry === 'object') {
    const h = entry.hash || entry.phash;
    if (typeof h === 'string' && h) return h;
  }
  return null;
}

// ── normalize any index record into a source-shaped match { url?, author?, permlink?, title? }. ─────
function toSource(rec) {
  const r = rec && typeof rec === 'object' ? rec : {};
  const s = {};
  if (r.author != null) s.author = String(r.author).replace(/^@+/, '');
  if (r.permlink != null) s.permlink = String(r.permlink);
  if (r.url != null) s.url = String(r.url);
  if (r.title != null) s.title = String(r.title);
  return s;
}

// ── nearest record in an array whose hash is within threshold of phash, with distance/similarity. ──
function nearestInArray(phash, arr, threshold) {
  let best = null;
  for (const rec of arr) {
    const h = hashOf(rec);
    if (!h) continue;
    const dist = hammingDistance(phash, h);
    if (!Number.isFinite(dist) || dist > threshold) continue;
    if (best === null || dist < best.distance) {
      best = { ...toSource(rec), hash: h, distance: dist, similarity: similarity(phash, h) };
      if (dist === 0) break;
    }
  }
  return best;
}

// ── look phash up in an injected index. Supports: fn(phash,{threshold}), {lookup}, or an array. ─────
// Returns a normalized match { ...source, distance?, similarity? } or null. Never throws.
async function lookupMatch(phash, index, threshold) {
  if (!phash || index == null) return null;
  try {
    let r = index;
    if (typeof index === 'function') r = await index(phash, { threshold });
    else if (typeof index.lookup === 'function') r = await index.lookup(phash, { threshold });
    else if (Array.isArray(index)) return nearestInArray(phash, index, threshold);
    else if (Array.isArray(index.images)) return nearestInArray(phash, index.images, threshold);
    else if (Array.isArray(index.known)) return nearestInArray(phash, index.known, threshold);
    else return null;

    if (r == null) return null;
    if (Array.isArray(r)) return nearestInArray(phash, r, threshold);
    // A record: attach distance/similarity when it carries a comparable hash.
    const src = toSource(r);
    const h = hashOf(r);
    if (h) {
      const dist = hammingDistance(phash, h);
      if (Number.isFinite(dist) && dist > threshold) return null;
      src.hash = h;
      if (Number.isFinite(dist)) { src.distance = dist; src.similarity = similarity(phash, h); }
    }
    if (Number.isFinite(Number(r.similarity))) src.similarity = Number(r.similarity);
    if (Number.isFinite(Number(r.confidence))) src.similarity = Number(r.confidence);
    return src;
  } catch {
    return null;
  }
}

// ── confidence 0..1 for a match: its similarity if present, else 1 (the index asserted a hit). ─────
function confidenceOf(match) {
  return Number.isFinite(Number(match.similarity)) ? Number(match.similarity) : 1;
}

// ── neutral (no-match) acknowledgement — states a fact, credits nothing, accuses nothing. ──────────
function neutralReply(count, seed) {
  const n = count === 1 ? 'this image' : `these ${count} images`;
  return esc(
    `Noted ${n}. No earlier appearance on record — nothing to credit yet. ` +
    `If it's original here, it's now on file so future reposts can be credited to you.`) + footer(seed);
}

/**
 * respondToPost(post, opts) — Cheetah's response to a post that may contain image(s).
 *
 * @param {{author?:string, permlink?:string, body?:string}|string} post
 * @param {object} [opts]
 * @param {Function|object|Array} [opts.index]  match index: fn(phash,{threshold}) | {lookup} | array of
 *   { hash|phash, url?, author?, permlink?, title? } records. Falls back to the __setIndex default.
 * @param {number} [opts.threshold]  max Hamming distance for a near-duplicate (default DEFAULT_THRESHOLD).
 * @param {number} [opts.size]  fingerprint size (default 8).
 * @param {Function} [opts.fetch]  per-call fetch override.
 * @returns {Promise<{ok:true, images:Array<{url,phash,match}>, reply:string}
 *                   | {ok:false, reason:'no-image'}>}
 *   Soft-fail: any internal error → { ok:false, reason:'error' }. Never throws.
 */
export async function respondToPost(post, opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const index = o.index != null ? o.index : _index;
    const threshold = Number.isFinite(Number(o.threshold)) && Number(o.threshold) >= 0
      ? Number(o.threshold) : DEFAULT_THRESHOLD;

    const urls = extractImages(post);
    if (urls.length === 0) return { ok: false, reason: 'no-image' };

    const seed = (post && typeof post === 'object')
      ? `${post.author || ''}/${post.permlink || ''}` : '';

    const images = [];
    const sources = []; // matched sources for the credit note
    for (const url of urls) {
      const phash = await fingerprint(url, { size: o.size, fetch: o.fetch });
      const match = phash ? await lookupMatch(phash, index, threshold) : null;
      images.push({ url, phash, match: match || null });
      if (match) sources.push({ ...match, confidence: confidenceOf(match) });
    }

    let reply;
    if (sources.length) {
      // Reuse the canonical credit-first image note (single or multi-source), which links each source.
      reply = composeImageCreditNote({ match: true, sources }, seed);
    } else {
      reply = neutralReply(urls.length, seed);
    }

    return { ok: true, images, reply };
  } catch {
    return { ok: false, reason: 'error' }; // soft-fail-never-throw
  }
}

// ── CLI: fingerprint image URL(s) from argv using the platform fetch (read-only; files nothing). ────
//   node cheetah/image-response.mjs <imageUrl> [imageUrl ...]
if (process.argv[1] && process.argv[1].endsWith('image-response.mjs')) {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.log('usage: node cheetah/image-response.mjs <imageUrl> [imageUrl ...]');
  } else {
    for (const u of urls) {
      // eslint-disable-next-line no-await-in-loop
      const h = await fingerprint(u);
      console.log(`${h || '(no-hash)'}  ${u}`);
    }
  }
}
