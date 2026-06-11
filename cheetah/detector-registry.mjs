// cheetah/detector-registry.mjs — ONE bundle of Cheetah's detector adapters.
//
// WHY THIS EXISTS
//   Cheetah has several independent detector modules — toxicity-detect.mjs,
//   scam-detect.mjs, impersonation-detect.mjs — each exposing its own
//   `detect…(…) -> { score, …, flag }` shape with a DIFFERENT call signature
//   (toxicity takes a bare string; scam takes (text, {links}); impersonation
//   takes (account, {displayName, bio, knownAccounts, accountAgeDays})).
//
//   The live-loop (live-loop.mjs) and the moderation/policing runners want ONE
//   uniform array of detectors they can iterate without knowing each module's
//   call convention. THIS module is that bundle: it wraps every existing detector
//   into a single shape —
//
//       { kind, run(content) -> flag | null }
//
//   where `content` is the unified envelope
//
//       { text, account, links, displayName, bio, knownAccounts, accountAgeDays }
//
//   and `flag` is the flag-pipe-shaped { kind, severity, reason } each detector
//   already returns (or null when nothing fires). This module does NOT edit the
//   detectors; it only adapts their inputs/outputs.
//
// HARD INVARIANTS
//   • SOFT-FAIL-NEVER-THROW: a detector that throws yields null for that detector
//     and never breaks the batch. registry() / DETECTORS are inert and offline.
//   • READ-ONLY / NO NETWORK / NO KEYS: this file imports pure heuristic detectors
//     and emits advisory flags only. Resolution is Hathor's job.
//   • esc(): the only string we ever build here for possible UI rendering is
//     HTML-escaped (defence in depth; the detectors and the flag-pipe escape too).
//
// USAGE
//   import { DETECTORS, registry } from './cheetah/detector-registry.mjs';
//   // live-loop wants {kind, detect(text)} — adapt at the call site, or feed run():
//   const dets = registry();                 // all of them
//   const onlyText = registry({ except: ['impersonation'] });
//   for (const d of dets) {
//     const flag = d.run({ text: post.body, account: post.author, links });
//     if (flag) fileFlag({ target: `@${post.author}`, reporter: `cheetah:${d.kind}`, ...flag });
//   }

import { detectToxicity } from './toxicity-detect.mjs';
import { detectScam } from './scam-detect.mjs';
import { detectImpersonation } from './impersonation-detect.mjs';

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── injectable seams (parity with the rest of the repo; unused on the offline path) ──
// These exist so callers / tests can wire production edges without changing the
// call site. The registry itself touches none of them by default.
let _reader = null;   // a chain reader (e.g. verified-account roster) for impersonation
let _store = null;    // a shared store for cross-run memory
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;

/** Seam: chain reader (unused offline). */
export function __setReader(fn) { if (typeof fn === 'function') _reader = fn; return _reader; }
/** Seam: shared store (unused offline). */
export function __setStore(obj) { if (obj && typeof obj === 'object') _store = obj; return _store; }
/** Seam: hosted-API fetch (unused offline). */
export function __setFetch(fn) { if (typeof fn === 'function') _fetch = fn; return _fetch; }
/** Restore seams to defaults (tests). */
export function __resetSeams() {
  _reader = null;
  _store = null;
  _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;
}

// ── content normalization ───────────────────────────────────────────────────
// Every run() takes the unified `content` envelope. Callers may also pass a bare
// string (treated as the text), so the registry is forgiving at its edge.
function asContent(content) {
  if (typeof content === 'string') return { text: content };
  if (!content || typeof content !== 'object') return {};
  return content;
}

// Coerce a flag-ish detector return into a clean flag | null. The underlying
// detectors already return { score, …, flag } envelopes OR a bare flag; we accept
// either and always hand back { kind, severity, reason } | null. NEVER throws.
function asFlag(out, fallbackKind) {
  if (out == null) return null;
  let flag = out;
  // unwrap the { score, signals/labels, flag } envelope if present
  if (typeof flag === 'object' && 'flag' in flag && !('severity' in flag)) {
    flag = flag.flag;
  }
  if (flag == null) return null;
  if (typeof flag !== 'object') return { kind: fallbackKind, severity: 1, reason: esc(String(flag)) };
  // ensure a kind is present so a downstream sink can route it.
  return flag.kind ? flag : { ...flag, kind: fallbackKind };
}

// ── the detector adapters ─────────────────────────────────────────────────────
// Each entry: { kind, run(content) -> flag | null }. run() slices the unified
// `content` envelope into the argument shape the wrapped detector expects, calls
// it, and normalizes the result to a flag | null. A throw inside run() is caught
// here and yields null — one bad detector never sinks the batch.
function safeRun(fn) {
  return (content) => {
    try {
      return fn(asContent(content));
    } catch {
      return null; // soft-fail-never-throw: this detector contributes nothing
    }
  };
}

export const DETECTORS = Object.freeze([
  {
    kind: 'toxicity',
    run: safeRun((c) => {
      const text = c.text != null ? String(c.text) : '';
      if (!text) return null;
      return asFlag(detectToxicity(text), 'harassment');
    }),
  },
  {
    kind: 'scam',
    run: safeRun((c) => {
      const text = c.text != null ? String(c.text) : '';
      const links = Array.isArray(c.links) ? c.links : [];
      if (!text && links.length === 0) return null;
      return asFlag(detectScam(text, { links }), 'scam');
    }),
  },
  {
    kind: 'impersonation',
    run: safeRun((c) => {
      const account = c.account != null ? String(c.account) : '';
      if (!account) return null;
      return asFlag(detectImpersonation(account, {
        knownAccounts: Array.isArray(c.knownAccounts) ? c.knownAccounts : [],
        displayName: c.displayName != null ? String(c.displayName) : '',
        bio: c.bio != null ? String(c.bio) : '',
        accountAgeDays: Number.isFinite(c.accountAgeDays) ? c.accountAgeDays : null,
      }), 'impersonation');
    }),
  },
]);

/**
 * Return the detector array, optionally filtered by kind.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.only]    if given, keep ONLY detectors whose kind is in this list.
 * @param {string[]} [opts.except]  if given, drop detectors whose kind is in this list.
 *   `only` is applied first, then `except`. Unknown kinds are ignored. Both falsy → all.
 * @returns {Array<{kind:string, run:(content:object)=>object|null}>}
 * Soft-fail: any internal error → the full DETECTORS array.
 */
export function registry({ only, except } = {}) {
  try {
    let list = DETECTORS.slice();
    if (Array.isArray(only) && only.length) {
      const keep = new Set(only.map((k) => String(k)));
      list = list.filter((d) => keep.has(d.kind));
    }
    if (Array.isArray(except) && except.length) {
      const drop = new Set(except.map((k) => String(k)));
      list = list.filter((d) => !drop.has(d.kind));
    }
    return list;
  } catch {
    return DETECTORS.slice(); // soft-fail: never deny the caller a usable array
  }
}

/** Convenience: the kinds the registry knows about (diagnostics / tests). */
export function detectorKinds() { return DETECTORS.map((d) => d.kind); }

// ── CLI (guarded): run every detector over an argv string of content. ─────────
// Read-only self-check; files nothing, broadcasts nothing.
//   node cheetah/detector-registry.mjs "send 1 ETH and get 2 ETH back, DM me"
if (process.argv[1] && /detector-registry\.mjs$/.test(process.argv[1])) {
  const text = process.argv.slice(2).join(' ');
  const content = { text, account: 'demo-account', links: [] };
  const out = registry().map((d) => ({ kind: d.kind, flag: d.run(content) }));
  console.log(JSON.stringify(out, null, 2));
}
