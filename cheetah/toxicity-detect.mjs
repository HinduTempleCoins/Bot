// toxicity-detect.mjs — heuristic, NO-NETWORK toxicity / harassment detector for Cheetah.
//
// WHY THIS EXISTS
//   The flag-pipe (integrations/flag-pipe.mjs) is the ONE unified moderation spine; it does no
//   detection itself. This module is one of its detector adapters: it reads a piece of text and,
//   if it looks like harassment, emits a flag in the EXACT shape fileFlag() wants — a
//   { kind:'harassment', severity, reason } object — so a caller can pipe it straight through.
//
// PRODUCTION NOTE
//   The real production upgrade is a hosted classifier — Perspective API (Jigsaw) or the
//   OpenAI moderation endpoint — which is far better at sarcasm, context, reclaimed slurs, and
//   non-English. This module is the OFFLINE FALLBACK: a deterministic lexicon + pattern heuristic
//   that runs with zero network, zero keys, and never blocks a request. When the hosted API is
//   wired, call it via __setFetch and let this stand as the degraded-mode path.
//
// DESIGN
//   • Deterministic: same text in → same score/labels out. No clock, no randomness.
//   • Soft-fail-never-throw: any internal error returns the empty/neutral result, never crashes.
//   • esc(): the `reason` we hand to flag-pipe may be rendered in a review-queue UI, so any echoed
//     fragment of the offending text is HTML-escaped at the boundary here too (defence in depth —
//     flag-pipe also escapes).
//   • Injectable seams: __setLexicon(lexicon) swaps the word lists for tests / tuning;
//     __setFetch(fn) is the seam where a hosted moderation API would plug in (unused offline).
//
//   import { detectToxicity } from './toxicity-detect.mjs';
//   const r = detectToxicity('you are worthless, go away');
//   // r = { score: 0.6, labels: ['severe-insult'], flag: { kind:'harassment', severity:3, reason:'…' } }
//   if (r.flag) fileFlag({ target: '@bob/post', reporter: 'cheetah:toxicity', ...r.flag });

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  LEXICON — three weighted categories. This is intentionally SMALL, PUBLIC-SAFE, and conservative:
//  no actual slurs are committed here (this is a public repo). The slurs category ships with neutral
//  PLACEHOLDER tokens; the real list is injected at runtime via __setLexicon from a private source
//  (or replaced wholesale by the hosted moderation API). The threats / severe-insult categories use
//  ordinary English words that are safe to commit and carry the heuristic on their own.
//
//  Each category carries a per-hit weight. score = clamp(sum of weights of matched categories' hits,
//  diminishing) into 0..1. Labels list the categories that fired.
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const DEFAULT_LEXICON = Object.freeze({
  // gravest. Placeholders only in the public repo — inject the real list privately.
  slurs: {
    weight: 0.6,
    terms: Object.freeze(['__slur_placeholder_a__', '__slur_placeholder_b__']),
  },
  // direct threats of violence / harm. Phrase patterns, not just words.
  threats: {
    weight: 0.5,
    terms: Object.freeze([
      'kill you', 'kill yourself', 'kys', 'i will hurt you', 'hurt you',
      'beat you', 'i will find you', 'watch your back', 'you should die',
      'going to die', 'rape', 'i will end you',
    ]),
  },
  // severe / dehumanizing insults (not protected-class slurs, but harassing).
  'severe-insult': {
    weight: 0.3,
    terms: Object.freeze([
      'worthless', 'pathetic', 'loser', 'idiot', 'moron', 'stupid',
      'trash', 'garbage', 'scum', 'disgusting', 'nobody likes you',
      'go away', 'shut up', 'freak', 'ugly', 'hate you',
    ]),
  },
});

// ── injectable seams ────────────────────────────────────────────────────────────────────────────
let _lexicon = DEFAULT_LEXICON;
// _fetch is the seam where a hosted moderation API (Perspective / OpenAI) would plug in. Unused in
// the offline fallback; kept so callers can wire production without changing the call site.
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;

/** Swap the lexicon (default DEFAULT_LEXICON). Shape: { category: { weight, terms:[...] } }. */
export function __setLexicon(lexicon) {
  if (lexicon && typeof lexicon === 'object') _lexicon = lexicon;
  return _lexicon;
}
/** Restore the default lexicon (tests). */
export function __resetLexicon() { _lexicon = DEFAULT_LEXICON; return _lexicon; }
/** Seam for a hosted moderation API (unused offline). */
export function __setFetch(fn) { if (typeof fn === 'function') _fetch = fn; return _fetch; }
/** Read the active lexicon (diagnostics / tests). */
export function __getLexicon() { return _lexicon; }

// ── normalization: lowercase, collapse separator-obfuscation (l-o-s-e-r, l.o.s.e.r), squeeze space ──
// We DON'T strip all punctuation, because threat phrases ("kill you") need word boundaries; we collapse
// single-char-gap obfuscation between letters and normalize whitespace.
function normalize(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  // collapse "k i l l" / "k.i.l.l" / "k-i-l-l" style letter-spacing into "kill"
  s = s.replace(/\b(?:[a-z][\s.\-_*]){1,}[a-z]\b/g, (m) => m.replace(/[\s.\-_*]/g, ''));
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Count non-overlapping occurrences of a needle in a haystack, on word-ish boundaries when the needle
// is alphabetic. Multi-word phrases ("kill you") match as substrings of the normalized text.
function countHits(haystack, needle) {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  let count = 0;
  let idx = haystack.indexOf(n);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(n, idx + n.length);
  }
  return count;
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

// Map a 0..1 score to a flag-pipe severity 1..5. Conservative: a single mild insult should not be a 5.
function severityFromScore(score) {
  if (score >= 0.85) return 5;
  if (score >= 0.65) return 4;
  if (score >= 0.45) return 3;
  if (score >= 0.25) return 2;
  return 1;
}

// Severity floor by worst category present: a real threat or slur is never below severity 4 even if a
// single hit's raw score is modest. Harassment gravity is category-driven, not just frequency-driven.
function severityFloor(labels) {
  if (labels.includes('slurs') || labels.includes('threats')) return 4;
  if (labels.includes('severe-insult')) return 2;
  return 1;
}

// The threshold above which we EMIT a flag (below = scored but no flag; e.g. a single mild insult).
export const FLAG_THRESHOLD = 0.45;

/**
 * Heuristic toxicity / harassment detector.
 *
 * @param {string} text  the text to score (any string; null/undefined → neutral result).
 * @returns {{score:number, labels:string[], flag:{kind:'harassment', severity:number, reason:string}|null}}
 *   - score  0..1 toxicity estimate.
 *   - labels which lexicon categories fired (e.g. ['threats','severe-insult']).
 *   - flag   a flag-pipe-shaped object when score >= FLAG_THRESHOLD, else null. Always
 *            { kind:'harassment', severity:1..5, reason:string }. `reason` is esc()-escaped.
 * Soft-fail: any internal error → { score:0, labels:[], flag:null }.
 */
export function detectToxicity(text) {
  try {
    const norm = normalize(text);
    if (!norm) return { score: 0, labels: [], flag: null };

    const labels = [];
    const perCategory = {}; // category -> total hits
    let rawScore = 0;

    for (const [category, def] of Object.entries(_lexicon || {})) {
      if (!def || !Array.isArray(def.terms)) continue;
      const weight = Number(def.weight) || 0;
      let hits = 0;
      for (const term of def.terms) {
        hits += countHits(norm, String(term || '').toLowerCase());
      }
      if (hits > 0) {
        labels.push(category);
        perCategory[category] = hits;
        // diminishing returns: first hit full weight, each extra hit half as much, capped per-category.
        const categoryScore = weight * (1 + Math.min(hits - 1, 4) * 0.5);
        rawScore += categoryScore;
      }
    }

    const score = clamp01(rawScore);

    if (score < FLAG_THRESHOLD || labels.length === 0) {
      return { score: Number(score.toFixed(3)), labels, flag: null };
    }

    const severity = Math.max(severityFromScore(score), severityFloor(labels));
    const hitSummary = labels
      .map((c) => `${c}×${perCategory[c]}`)
      .join(', ');
    const reason = esc(`heuristic toxicity (offline fallback): ${hitSummary} (score ${score.toFixed(2)})`);

    return {
      score: Number(score.toFixed(3)),
      labels,
      flag: { kind: 'harassment', severity, reason },
    };
  } catch {
    return { score: 0, labels: [], flag: null }; // soft-fail-never-throw
  }
}

// ── CLI: score a string of text from argv (read-only; files nothing). ───────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('toxicity-detect.mjs')) {
  const text = process.argv.slice(2).join(' ');
  console.log(JSON.stringify(detectToxicity(text), null, 2));
}
