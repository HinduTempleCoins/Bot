// impersonation-detect.mjs — heuristic, NO-NETWORK impersonation / sybil detector for Cheetah.
//
// WHY THIS EXISTS
//   The flag-pipe (integrations/flag-pipe.mjs) is the ONE unified moderation spine; it does no
//   detection itself. This module is one of its detector adapters: it inspects an account and,
//   if it looks like it is impersonating an established/verified identity, emits a flag in the
//   EXACT shape fileFlag() wants — a { kind:'impersonation', severity, reason } object — so a
//   caller can pipe it straight through.
//
// PRODUCTION NOTE
//   A real upgrade pulls the verified-account roster + account ages + reputation from the chain
//   (via __setReader) and a maintained brand/identity list. This module is the OFFLINE FALLBACK:
//   a deterministic name-similarity + homoglyph + zero-width + brand-new-account heuristic that
//   runs with zero network, zero keys, and never blocks a request. __setFetch / __setReader are
//   the seams where the chain reader / a hosted verifier plug in (unused offline).
//
// DESIGN
//   • Deterministic: same inputs in → same score/signals out. No clock (the "age" comes from the
//     caller as a field), no randomness.
//   • Soft-fail-never-throw: any internal error returns the empty/neutral result, never crashes.
//   • esc(): the `reason` we hand to flag-pipe may be rendered in a review-queue UI, so any echoed
//     fragment (the impersonated handle / display name) is HTML-escaped at the boundary here too
//     (defence in depth — flag-pipe also escapes).
//   • Injectable seams: __setReader(fn) / __setFetch(fn) / __setStore(obj) / __setClient(obj) /
//     __setCrypto(obj) — present so callers can wire production without changing the call site.
//
//   import { detectImpersonation } from './impersonation-detect.mjs';
//   const r = detectImpersonation('hath0r', {
//     knownAccounts: [{ account: 'hathor', displayName: 'Hathor', verified: true }],
//     displayName: 'Hathor', bio: 'the official witness', accountAgeDays: 0,
//   });
//   if (r.flag) fileFlag({ target: '@hath0r', reporter: 'cheetah:impersonation', ...r.flag });

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── injectable seams (present for parity / production wiring; unused in the offline path) ───────────
let _reader = null;  // a chain reader: () => [{ account, displayName, verified }] roster
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
let _store = null;   // a shared store for cross-run memory
let _client = null;  // a chain client
let _crypto = null;  // a crypto provider

/** Seam: chain reader for the verified-account roster (unused offline). */
export function __setReader(fn) { if (typeof fn === 'function') _reader = fn; return _reader; }
/** Seam: hosted verifier fetch (unused offline). */
export function __setFetch(fn) { if (typeof fn === 'function') _fetch = fn; return _fetch; }
/** Seam: shared store (unused offline). */
export function __setStore(obj) { if (obj && typeof obj === 'object') _store = obj; return _store; }
/** Seam: chain client (unused offline). */
export function __setClient(obj) { if (obj && typeof obj === 'object') _client = obj; return _client; }
/** Seam: crypto provider (unused offline). */
export function __setCrypto(obj) { if (obj && typeof obj === 'object') _crypto = obj; return _crypto; }
/** Restore seams to defaults (tests). */
export function __resetSeams() {
  _reader = null;
  _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
  _store = null; _client = null; _crypto = null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  NORMALIZATION & TRICK DETECTION
//
//  Impersonators rely on the eye not the bytes: визуально-identical glyphs (Cyrillic 'а' for Latin
//  'a'), zero-width joiners splitting a name, full-width forms, leetspeak digit-for-letter swaps,
//  and decorative separators. We fold all of that to a canonical skeleton, then compare skeletons.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// Zero-width / invisible formatting characters that get spliced INTO a name to dodge exact-match.
// (ZWSP, ZWNJ, ZWJ, word-joiner, BOM/ZWNBSP, soft hyphen, LTR/RTL marks.)
const ZERO_WIDTH_RE = /[​‌‍⁠﻿­‎‏]/g;

// A small, conservative confusable map: common homoglyphs → their Latin skeleton letter. Covers
// Cyrillic/Greek look-alikes, full-width latin, and leetspeak digit swaps. PUBLIC-SAFE (no slurs).
const CONFUSABLE = Object.freeze({
  // Cyrillic look-alikes
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h',
  // Greek look-alikes
  'ο': 'o', 'α': 'a', 'ρ': 'p', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'τ': 't',
  // leetspeak digit-for-letter
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
});

// Apply NFKC-style folding via Unicode normalization (full-width → ascii, ligatures) then map
// remaining confusables and strip non-alphanumerics. The result is a comparison "skeleton".
function skeleton(name) {
  let s = String(name == null ? '' : name);
  s = s.replace(ZERO_WIDTH_RE, '');
  try { s = s.normalize('NFKC'); } catch { /* normalize may throw on bad input; ignore */ }
  s = s.toLowerCase();
  s = [...s].map((ch) => CONFUSABLE[ch] || ch).join('');
  // drop everything that is not a basic latin letter or digit (separators, emoji, punctuation)
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
}

// Does the RAW name carry a visual trick (zero-width chars or non-latin confusables)? Used as a
// strong signal: a name that LOOKS like a known one only after un-tricking it is deliberate.
function hasZeroWidth(name) {
  return ZERO_WIDTH_RE.test(String(name == null ? '' : name));
}
function hasConfusable(name) {
  const s = String(name == null ? '' : name).toLowerCase();
  for (const ch of s) {
    // any non-ascii letter that maps to a latin skeleton char, or a leet digit inside a wordish run
    if (CONFUSABLE[ch] && ch.charCodeAt(0) > 127) return true;
  }
  return false;
}

// ── Levenshtein distance + normalized similarity (1 = identical, 0 = totally different) ─────────────
function levenshtein(a, b) {
  a = String(a || ''); b = String(b || '');
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
function similarity(a, b) {
  a = String(a || ''); b = String(b || '');
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

// Map a 0..1 score to a flag-pipe severity 1..5. Conservative.
function severityFromScore(score) {
  if (score >= 0.85) return 5;
  if (score >= 0.7) return 4;
  if (score >= 0.5) return 3;
  if (score >= 0.3) return 2;
  return 1;
}

// The threshold above which we EMIT a flag (below = scored but no flag).
export const FLAG_THRESHOLD = 0.5;
// How close two skeletons must be to count as a near-duplicate (Levenshtein-based similarity).
export const NEAR_DUP_THRESHOLD = 0.8;
// An account younger than this (in days) is "brand-new" — a strong impersonation co-signal.
export const BRAND_NEW_DAYS = 7;

/**
 * Heuristic impersonation / sybil detector.
 *
 * @param {string} account  the handle under inspection (e.g. 'hath0r').
 * @param {object} [opts]
 *   @param {Array<string|{account?:string, displayName?:string, verified?:boolean}>} [opts.knownAccounts]
 *     the roster of known/verified identities to compare against. Strings are treated as account names.
 *   @param {string} [opts.displayName]  the inspected account's display name (compared too).
 *   @param {string} [opts.bio]          the inspected account's bio (scanned for impersonation claims).
 *   @param {number} [opts.accountAgeDays]  age of the account in days (younger = stronger signal).
 * @returns {{score:number, signals:string[], flag:{kind:'impersonation', severity:number, reason:string}|null}}
 *   - score   0..1 impersonation estimate.
 *   - signals which heuristics fired (e.g. ['near-duplicate-name','homoglyph','brand-new']).
 *   - flag    a flag-pipe-shaped object when score >= FLAG_THRESHOLD, else null. Always
 *             { kind:'impersonation', severity:1..5, reason:string }. `reason` is esc()-escaped.
 * Soft-fail: any internal error → { score:0, signals:[], flag:null }.
 */
export function detectImpersonation(account, opts = {}) {
  try {
    const {
      knownAccounts = [],
      displayName = '',
      bio = '',
      accountAgeDays = null,
    } = (opts && typeof opts === 'object') ? opts : {};

    const acct = String(account == null ? '' : account).trim();
    if (!acct) return { score: 0, signals: [], flag: null };

    // Normalize the roster into { account, displayName, verified } records.
    const roster = (Array.isArray(knownAccounts) ? knownAccounts : [])
      .map((k) => {
        if (typeof k === 'string') return { account: k, displayName: '', verified: false };
        if (k && typeof k === 'object') {
          return {
            account: String(k.account || ''),
            displayName: String(k.displayName || ''),
            verified: !!k.verified,
          };
        }
        return null;
      })
      .filter((k) => k && k.account);

    const signals = [];
    let score = 0;

    // The inspected account's own visual tricks are a signal regardless of any match.
    const acctZW = hasZeroWidth(account);
    const acctConf = hasConfusable(account) || hasConfusable(displayName);
    const acctSkel = skeleton(acct);
    const dispSkel = skeleton(displayName);

    // brand-new account: a numeric co-signal that AMPLIFIES a name match (not on its own).
    const isBrandNew = Number.isFinite(accountAgeDays) && accountAgeDays >= 0 && accountAgeDays <= BRAND_NEW_DAYS;

    // Find the closest known identity to either the handle skeleton or the display-name skeleton.
    let best = null; // { known, kind:'handle'|'display', sim, exactSkeleton }
    for (const k of roster) {
      const kSkelAcct = skeleton(k.account);
      const kSkelDisp = skeleton(k.displayName);
      // never flag an account against ITSELF (identical raw handle)
      if (k.account.toLowerCase() === acct.toLowerCase()) continue;

      const candidates = [
        { kind: 'handle', a: acctSkel, b: kSkelAcct },
        // a display name colliding with a known HANDLE or a known DISPLAY NAME
        { kind: 'display', a: dispSkel, b: kSkelAcct },
        { kind: 'display', a: dispSkel, b: kSkelDisp },
      ];
      for (const c of candidates) {
        if (!c.a || !c.b) continue;
        const sim = similarity(c.a, c.b);
        const exactSkeleton = c.a === c.b; // skeletons identical → pure homoglyph/zero-width copy
        if (!best || sim > best.sim || (sim === best.sim && exactSkeleton && !best.exactSkeleton)) {
          best = { known: k, kind: c.kind, sim, exactSkeleton };
        }
      }
    }

    if (best && (best.sim >= NEAR_DUP_THRESHOLD || best.exactSkeleton)) {
      // a near-duplicate of a known identity
      signals.push(best.kind === 'handle' ? 'near-duplicate-name' : 'near-duplicate-display-name');
      // base weight scales with closeness; an exact skeleton match (visually identical) is gravest.
      score += best.exactSkeleton ? 0.6 : 0.3 + (best.sim - NEAR_DUP_THRESHOLD) * 0.5;

      // impersonating a VERIFIED identity is worse than colliding with an unverified one.
      if (best.known.verified) { signals.push('targets-verified-account'); score += 0.2; }

      // visual tricks that only make sense to fool the eye toward THIS known name.
      if (acctZW) { signals.push('zero-width-trick'); score += 0.2; }
      if (acctConf) { signals.push('homoglyph'); score += 0.2; }

      // a brand-new account that already looks like an established identity is the classic pattern.
      if (isBrandNew) { signals.push('brand-new-account'); score += 0.2; }

      // bio explicitly claiming to BE / be the official version of the known identity.
      if (claimsIdentity(bio, best.known)) { signals.push('claims-established-identity'); score += 0.2; }
    } else {
      // No name collision. A lone visual trick on the handle is suspicious but weak on its own.
      if (acctZW) { signals.push('zero-width-trick'); score += 0.25; }
      if (acctConf) { signals.push('homoglyph'); score += 0.25; }
    }

    score = clamp01(score);

    if (score < FLAG_THRESHOLD || signals.length === 0) {
      return { score: Number(score.toFixed(3)), signals, flag: null };
    }

    const severity = severityFromScore(score);
    const targetName = best ? (best.known.account || best.known.displayName) : '(none)';
    const reason = esc(
      `heuristic impersonation (offline fallback): @${acct} resembles ` +
      `${best ? '"' + targetName + '"' : 'no known account'} ` +
      `[${signals.join(', ')}] (score ${score.toFixed(2)})`
    );

    return {
      score: Number(score.toFixed(3)),
      signals,
      flag: { kind: 'impersonation', severity, reason },
    };
  } catch {
    return { score: 0, signals: [], flag: null }; // soft-fail-never-throw
  }
}

// Does the bio assert it IS the known identity ("the real X", "official X", "this is X")?
function claimsIdentity(bio, known) {
  try {
    const b = String(bio == null ? '' : bio).toLowerCase();
    if (!b) return false;
    const names = [known.account, known.displayName]
      .map((n) => String(n || '').toLowerCase().trim())
      .filter(Boolean);
    if (names.length === 0) return false;
    const claimPhrases = ['the real', 'official', 'the official', 'this is the', 'verified', 'the one and only'];
    for (const name of names) {
      if (!b.includes(name)) continue;
      for (const p of claimPhrases) {
        if (b.includes(p)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ── CLI: score a handle from argv (read-only; files nothing). ────────────────────────────────────────
//   node cheetah/impersonation-detect.mjs hath0r hathor
//   (first arg = suspect handle; remaining args = known account names to compare against)
if (process.argv[1] && process.argv[1].endsWith('impersonation-detect.mjs')) {
  const [suspect, ...known] = process.argv.slice(2);
  const out = detectImpersonation(suspect, {
    knownAccounts: known.map((a) => ({ account: a, verified: true })),
  });
  console.log(JSON.stringify(out, null, 2));
}
