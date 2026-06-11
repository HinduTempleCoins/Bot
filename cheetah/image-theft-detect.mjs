// image-theft-detect.mjs — heuristic, NO-NETWORK image-theft / near-duplicate detector for Cheetah.
//
// WHY THIS EXISTS
//   The operator's canonical case (see cheetah/xplatform-theft.mjs) is a thief lifting an ORIGINAL
//   and re-posting it to harvest rewards. text-detection.js handles that for prose; THIS module is
//   the IMAGE sibling: it catches the same image (a meme, a photo, a thumbnail of a source) reposted
//   by a DIFFERENT author. It does NOT decode images and pulls NO native deps — it operates entirely
//   on the perceptual hashes produced by integrations/perceptual-hash.mjs (aHash/dHash). The caller
//   hashes the candidate and the known-originals corpus however it likes; we only compare hashes.
//
//   This module is built ON TOP of integrations/perceptual-hash.mjs (it imports hammingDistance /
//   similarity and does NOT edit it). It emits the flag-pipe-shaped { kind:'image-theft', severity,
//   reason } object so a caller can pipe it straight through fileFlag(), and it exposes the
//   detector-registry adapter shape { kind, run(content) -> flag | null } so it can join the registry.
//
// PRODUCTION NOTE
//   The real production upgrade is a reverse-image / hosted-pHash index (e.g. a vector store of every
//   original ever seen on the chain, keyed by perceptual hash, with the canonical author + URL). This
//   module is the OFFLINE FALLBACK: a deterministic Hamming-distance comparison against an in-memory
//   `known` corpus, zero network, zero keys, never blocks a request. __setFetch / __setReader /
//   __setStore are the seams where a hosted index / chain reader / shared store would plug in; they
//   are unused in the offline path.
//
// DESIGN
//   • Deterministic: same candidate + same corpus → same score/match/flag. No clock, no randomness.
//   • Soft-fail-never-throw: any internal error returns the empty/neutral result, never crashes.
//   • esc(): the `reason` we hand to flag-pipe may be rendered in a review-queue UI, so any echoed
//     fragment (author, hash) is HTML-escaped at the boundary here too (defence in depth).
//   • Credit, not accusation: like the rest of Cheetah, a flag STATES the near-duplicate fact and
//     credits the earlier/known author; Hathor resolves. Same-author reposts are NOT theft → no flag.
//   • Injectable threshold: opts.threshold (default DEFAULT_THRESHOLD) is the max Hamming distance for
//     a near-duplicate. Injectable seams: __setReader/__setStore/__setFetch (unused offline).
//
//   import { detectImageTheft } from './image-theft-detect.mjs';
//   const r = detectImageTheft(
//     { hash: candidateHash, author: '@thief' },
//     { known: [{ hash: originalHash, author: '@artist', url: 'https://…' }], threshold: 8 });
//   // r = { score:0.96, match:{…}, flag:{ kind:'image-theft', severity:4, reason:'…' } }
//   if (r.flag) fileFlag({ target: '@thief/post', reporter: 'cheetah:image-theft', ...r.flag });

import { hammingDistance, similarity } from '../integrations/perceptual-hash.mjs';

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── default near-duplicate threshold (max Hamming distance, in bits, for a 64-bit hash). ────────────
//   0      = identical hash (verbatim repost / exact crop-free copy)
//   <= ~5  = the perceptual-hash module's own isDuplicate() default (very tight)
//   <= 10  = lenient near-duplicate (light recompression / minor edits)
//   We default to 10: catch obvious reposts while staying conservative for short hashes.
export const DEFAULT_THRESHOLD = 10;

// ── injectable seams (parity with the rest of the repo; unused on the offline path) ─────────────────
// These exist so callers / tests can wire production edges (a hosted pHash index, a chain reader for
// the canonical-author roster, a shared cross-run store) without changing the call site. The detector
// itself touches none of them by default.
let _reader = null;
let _store = null;
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;

/** Seam: chain reader for a canonical-author roster (unused offline). */
export function __setReader(fn) { if (typeof fn === 'function') _reader = fn; return _reader; }
/** Seam: shared cross-run store (unused offline). */
export function __setStore(obj) { if (obj && typeof obj === 'object') _store = obj; return _store; }
/** Seam: hosted reverse-image / pHash-index fetch (unused offline). */
export function __setFetch(fn) { if (typeof fn === 'function') _fetch = fn; return _fetch; }
/** Restore seams to defaults (tests). */
export function __resetSeams() {
  _reader = null;
  _store = null;
  _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
}

// ── normalize an author handle for comparison: lowercased, leading '@' stripped, trimmed. ───────────
// "" when missing — an empty author can NEVER equal another empty author (we treat unknown authorship
// as "different", so a missing-author candidate against a known original still flags).
function normAuthor(a) {
  const s = String(a == null ? '' : a).trim().toLowerCase().replace(/^@+/, '');
  return s;
}

// ── pull a hex perceptual-hash string out of a candidate/known entry. ───────────────────────────────
// Accepts a bare hex string OR an object { hash } (the perceptual-hash module returns hex strings;
// callers commonly carry them on a record alongside author/url). null when no usable hash.
function hashOf(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') return entry || null;
  if (typeof entry === 'object') {
    const h = entry.hash;
    if (typeof h === 'string' && h) return h;
  }
  return null;
}

// ── map a Hamming distance (relative to the threshold) to a flag-pipe severity 1..5. ────────────────
// An exact-hash match (distance 0 — verbatim repost) is the gravest and pins to 5; the closer a
// near-duplicate sits to the threshold edge, the lower the severity.
function severityFromDistance(dist, threshold) {
  if (dist <= 0) return 5;
  const t = threshold > 0 ? threshold : DEFAULT_THRESHOLD;
  const ratio = dist / t; // 0 (identical) .. 1 (at the edge)
  if (ratio <= 0.2) return 4;
  if (ratio <= 0.5) return 3;
  return 2;
}

/**
 * Heuristic image-theft / near-duplicate detector.
 *
 * Flags when the candidate image's perceptual hash is within `threshold` Hamming distance of a KNOWN
 * (original) image's hash that was posted by a DIFFERENT author. The nearest qualifying original wins.
 *
 * @param {string|{hash:string, author?:string}} candidate  the suspect image: a bare perceptual-hash
 *   hex string, or an object carrying { hash, author }. The candidate's author is read from
 *   candidate.author (object form) or from opts.author.
 * @param {object} [opts]
 * @param {Array<string|{hash:string, author?:string, url?:string, permlink?:string}>} [opts.known]
 *   the corpus of known-original image hashes to compare against (each a hex string or a record).
 * @param {number} [opts.threshold]  max Hamming distance for a near-duplicate (default DEFAULT_THRESHOLD).
 * @param {string} [opts.author]  candidate author (fallback when candidate is a bare hash string).
 * @returns {{score:number, match:object|null, flag:{kind:'image-theft', severity:number, reason:string}|null}}
 *   - score  0..1 perceptual similarity to the nearest qualifying original (0 when no comparison made).
 *   - match  { hash, author, url?, permlink?, distance, similarity } of the nearest original posted by a
 *            different author within threshold, else null.
 *   - flag   a flag-pipe-shaped object when a match was found, else null. Always
 *            { kind:'image-theft', severity:1..5, reason:string }. `reason` is esc()-escaped.
 * Soft-fail: any internal error → { score:0, match:null, flag:null }.
 */
export function detectImageTheft(candidate, opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const candHash = hashOf(candidate);
    if (!candHash) return { score: 0, match: null, flag: null };

    const candAuthor = normAuthor(
      (candidate && typeof candidate === 'object' && candidate.author != null)
        ? candidate.author
        : o.author);

    const threshold = Number.isFinite(Number(o.threshold)) && Number(o.threshold) >= 0
      ? Number(o.threshold)
      : DEFAULT_THRESHOLD;

    const known = Array.isArray(o.known) ? o.known : [];

    let best = null; // nearest qualifying original

    for (const entry of known) {
      const knownHash = hashOf(entry);
      if (!knownHash) continue;

      // Same author reposting their own image is NOT theft — skip.
      const knownAuthor = normAuthor(entry && typeof entry === 'object' ? entry.author : null);
      // Only skip when BOTH authors are known AND equal. Unknown ('') authorship never matches an
      // unknown, so a hashless-author candidate still gets compared.
      if (candAuthor && knownAuthor && candAuthor === knownAuthor) continue;

      const dist = hammingDistance(candHash, knownHash);
      if (!Number.isFinite(dist) || dist > threshold) continue;

      if (best === null || dist < best.distance) {
        best = {
          hash: knownHash,
          author: (entry && typeof entry === 'object' && entry.author != null) ? String(entry.author) : '',
          url: (entry && typeof entry === 'object' && entry.url != null) ? String(entry.url) : undefined,
          permlink: (entry && typeof entry === 'object' && entry.permlink != null) ? String(entry.permlink) : undefined,
          distance: dist,
          similarity: similarity(candHash, knownHash),
        };
        if (dist === 0) break; // can't get closer than an identical hash
      }
    }

    if (best === null) return { score: 0, match: null, flag: null };

    const severity = severityFromDistance(best.distance, threshold);
    const credit = best.url
      ? `original at ${best.url}`
      : (normAuthor(best.author) ? `original by ${best.author}` : 'a known original');
    const reason = esc(
      `near-duplicate image (Hamming distance ${best.distance}/${threshold}, ` +
      `${(best.similarity * 100).toFixed(0)}% perceptual match) of ${credit}`);

    return {
      score: Number(best.similarity.toFixed(3)),
      match: best,
      flag: { kind: 'image-theft', severity, reason },
    };
  } catch {
    return { score: 0, match: null, flag: null }; // soft-fail-never-throw
  }
}

/**
 * Detector-registry adapter for this detector. Shape: { kind, run(content) -> flag | null }.
 * `content` is the unified envelope; this detector reads:
 *   content.imageHash        — the candidate perceptual hash (hex string), OR
 *   content.image            — a { hash, author } object for the candidate, AND
 *   content.account / .author — candidate author (fallback), AND
 *   content.knownImages      — the known-originals corpus (array of hashes / records).
 * Returns the flag | null. NEVER throws (soft-fail).
 */
export const detector = Object.freeze({
  kind: 'image-theft',
  run(content) {
    try {
      const c = (content && typeof content === 'object') ? content : {};
      const cand = c.image != null ? c.image : c.imageHash;
      if (!hashOf(cand)) return null;
      const known = Array.isArray(c.knownImages) ? c.knownImages
        : (Array.isArray(c.known) ? c.known : []);
      const author = c.author != null ? c.author : c.account;
      const r = detectImageTheft(cand, {
        known,
        threshold: Number.isFinite(Number(c.threshold)) ? Number(c.threshold) : undefined,
        author,
      });
      return r.flag;
    } catch {
      return null;
    }
  },
});

// ── CLI: compare a candidate hash against known-original hashes from argv (read-only; files nothing).
//   node cheetah/image-theft-detect.mjs <candidateHex> <knownHexA> [knownHexB ...]
if (process.argv[1] && process.argv[1].endsWith('image-theft-detect.mjs')) {
  const [cand, ...rest] = process.argv.slice(2);
  if (!cand) {
    console.log('usage: node cheetah/image-theft-detect.mjs <candidateHex> <knownHexA> [knownHexB ...]');
  } else {
    // CLI treats every known hash as a DIFFERENT author so a match always surfaces for inspection.
    const known = rest.map((h, i) => ({ hash: h, author: `known-${i}` }));
    const out = detectImageTheft({ hash: cand, author: 'candidate' }, { known });
    console.log(JSON.stringify(out, null, 2));
  }
}
