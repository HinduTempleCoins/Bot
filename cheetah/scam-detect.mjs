// scam-detect.mjs — heuristic, NO-NETWORK scam / phishing detector for Cheetah.
//
// WHY THIS EXISTS
//   The flag-pipe (integrations/flag-pipe.mjs) is the ONE unified moderation spine; it does no
//   detection itself. This module is one of its detector adapters — the sibling of
//   toxicity-detect.mjs. It reads a piece of text (plus any extracted links) and, if it looks like
//   a scam / phish, emits a flag in the EXACT shape fileFlag() wants — a
//   { kind:'scam', severity, reason } object — so a caller can pipe it straight through.
//
//   cheetah/security-scan.js already catches some overlapping wallet-drainer / phish-link SHAPES
//   for the platform-security role; this module is the SCAM-CLASS detector for the moderation pipe:
//   social-engineering lures (seed-phrase asks, "send X get 2X" doublers, urgent-DM bait, fake
//   airdrops, lookalike domains). It does NOT import or edit security-scan.js — it stands alone so
//   it can be tuned and flagged independently.
//
// PRODUCTION NOTE
//   The real production upgrade is a hosted classifier / URL-reputation feed (URLhaus, PhishTank,
//   Google Safe Browsing). This module is the OFFLINE FALLBACK: a deterministic pattern + lexicon
//   heuristic that runs with zero network, zero keys, and never blocks a request. __setFetch is the
//   seam where a hosted reputation API would plug in; it is unused in the offline path.
//
// DESIGN
//   • Deterministic: same text in → same score/signals out. No clock, no randomness.
//   • Soft-fail-never-throw: any internal error returns the empty/neutral result, never crashes.
//   • esc(): the `reason` we hand to flag-pipe may be rendered in a review-queue UI, so any echoed
//     fragment is HTML-escaped at the boundary here too (defence in depth — flag-pipe also escapes).
//   • Injectable seams: __setPatterns(patterns) swaps the rule set for tests / tuning;
//     __setBrands(brands) swaps the lookalike-target brand list; __setFetch(fn) is the seam where a
//     hosted URL-reputation API would plug in (unused offline).
//
//   import { detectScam } from './scam-detect.mjs';
//   const r = detectScam('send 1 ETH to this address and get 2 ETH back!', { links: [] });
//   // r = { score: 0.7, signals: ['doubler'], flag: { kind:'scam', severity:4, reason:'…' } }
//   if (r.flag) fileFlag({ target: '@bob/post', reporter: 'cheetah:scam', ...r.flag });

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PATTERN CATALOG — each rule: { signal, weight, re, why }. Weight accumulates (with diminishing
//  returns per signal) into a 0..1 score. `re` is matched against the NORMALIZED text (lowercased,
//  de-obfuscated). Signals are conservative and PUBLIC-SAFE (ordinary English / generic phish shapes).
//
//  Categories:
//    seed-phrase    — asks for a wallet seed / recovery phrase / private key (the gravest social ask)
//    doubler        — "send X get 2X" / giveaway-multiplier confidence trick
//    urgent-dm      — "DM me", "message support", urgency + private-channel lure
//    fake-airdrop   — "claim your free airdrop", "connect wallet to claim", reward-bait
//    impersonation  — claims to be official support / admin / a known brand (a scam vector here; the
//                     dedicated account-impersonation detector is separate)
//    payment-lure   — "guaranteed returns", "investment", "double your money" pump-style bait
// ════════════════════════════════════════════════════════════════════════════════════════════════
export const DEFAULT_PATTERNS = Object.freeze([
  // --- seed-phrase / private-key requests (gravest) ---
  { signal: 'seed-phrase', weight: 0.7,
    re: /\b(?:seed|recovery|secret|mnemonic)\s*(?:phrase|words?)\b/,
    why: 'asks for a wallet seed / recovery phrase' },
  { signal: 'seed-phrase', weight: 0.7,
    re: /\b(?:enter|send|share|verify|confirm|provide|submit|paste|give)\s+(?:me\s+)?(?:your\s+)?(?:12|24)?\s*(?:word\s+)?(?:seed|recovery|secret|private|mnemonic)\b/,
    why: 'prompt to hand over seed / private key' },
  { signal: 'seed-phrase', weight: 0.7,
    re: /\b(?:private|posting|active|owner|master)[\s-]?key\b/,
    why: 'references a private / posting / active / owner key' },

  // --- "send X get 2X" doublers / giveaway multipliers ---
  { signal: 'doubler', weight: 0.6,
    re: /\bsend\s+(?:\$?\d[\d.,]*\s*)?[a-z]{2,5}\b[^.\n]{0,40}\b(?:get|receive|return|back|double)\b[^.\n]{0,30}\b(?:2x|double|twice|back)\b/,
    why: '"send X, get 2X back" doubler shape' },
  { signal: 'doubler', weight: 0.55,
    re: /\b(?:double|triple|10x|2x|3x)\s+(?:your\s+)?(?:coins?|crypto|money|funds?|btc|eth|investment)\b/,
    why: 'multiply-your-funds promise' },
  { signal: 'doubler', weight: 0.5,
    re: /\b(?:giveaway|airdrop|bonus)\b[^.\n]{0,40}\bsend\b[^.\n]{0,30}\b(?:address|wallet)\b/,
    why: 'giveaway that asks you to send first' },

  // --- urgent-DM lures ---
  { signal: 'urgent-dm', weight: 0.35,
    re: /\b(?:dm|pm|message|whatsapp|telegram|whats\s?app)\s+(?:me|us|support|admin|@?\w+)\b/,
    why: 'pushes the conversation to a private channel (DM/PM)' },
  { signal: 'urgent-dm', weight: 0.3,
    re: /\b(?:act\s+now|hurry|limited\s+time|only\s+\d+\s+(?:spots?|left)|expires?\s+(?:soon|today)|last\s+chance|don'?t\s+miss)\b/,
    why: 'manufactured urgency' },
  { signal: 'urgent-dm', weight: 0.3,
    re: /\b(?:contact|reach\s+out\s+to|message)\s+(?:our\s+)?(?:official\s+)?support\b/,
    why: '"contact support" lure (support never DMs first)' },

  // --- fake airdrop / claim-bait ---
  { signal: 'fake-airdrop', weight: 0.5,
    re: /\b(?:claim|get)\s+(?:your\s+)?(?:free\s+)?(?:airdrop|tokens?|reward|nft|coins?)\b/,
    why: 'claim-your-free-reward airdrop bait' },
  { signal: 'fake-airdrop', weight: 0.5,
    re: /\b(?:connect|link|sync|validate|verify|restore)\s+(?:your\s+)?wallet\b/,
    why: '"connect / validate your wallet" drainer prompt' },
  { signal: 'fake-airdrop', weight: 0.4,
    re: /\b(?:free|exclusive)\s+(?:\$?\d[\d.,]*\s*)?(?:btc|eth|usdt|usdc|sol|melek|tokens?|crypto)\b/,
    why: 'free-crypto bait' },

  // --- impersonation-as-scam vector ---
  { signal: 'impersonation', weight: 0.35,
    re: /\b(?:i\s*am|we\s*are|this\s+is)\s+(?:the\s+)?(?:official|verified)\s+(?:support|team|admin|account)\b/,
    why: 'claims to be official support / team' },

  // --- payment / investment lure ---
  { signal: 'payment-lure', weight: 0.35,
    re: /\b(?:guaranteed|risk[\s-]?free|100%)\s+(?:returns?|profit|roi|gains?)\b/,
    why: 'guaranteed-returns investment lure' },
  { signal: 'payment-lure', weight: 0.3,
    re: /\b(?:gift\s*cards?|google\s+play\s+card|itunes\s+card|wire\s+transfer)\b/,
    why: 'gift-card / wire-transfer payment request' },
]);

// Brands a phisher commonly impersonates with a lookalike domain. PUBLIC-SAFE generic list; inject a
// fuller one via __setBrands. We flag a link whose registrable domain LOOKS LIKE one of these but is
// not an exact match (typosquat / homoglyph-ish / extra-token).
export const DEFAULT_BRANDS = Object.freeze([
  'hive-keychain', 'hivekeychain', 'hiveblog', 'hive', 'peakd', 'ecency',
  'metamask', 'binance', 'coinbase', 'ledger', 'trezor', 'trustwallet',
  'opensea', 'uniswap', 'melek', 'soapbox', 'phantom', 'solflare',
]);

// ── injectable seams ────────────────────────────────────────────────────────────────────────────
let _patterns = DEFAULT_PATTERNS;
let _brands = DEFAULT_BRANDS;
// _fetch is the seam where a hosted URL-reputation API would plug in. Unused in the offline fallback;
// kept so callers can wire production without changing the call site.
let _fetch = (typeof globalThis !== 'undefined' && globalThis.fetch) ? globalThis.fetch : null;

/** Swap the pattern set (default DEFAULT_PATTERNS). Shape: [{ signal, weight, re, why }]. */
export function __setPatterns(patterns) {
  if (Array.isArray(patterns)) _patterns = patterns;
  return _patterns;
}
/** Restore the default patterns (tests). */
export function __resetPatterns() { _patterns = DEFAULT_PATTERNS; return _patterns; }
/** Swap the lookalike-target brand list (default DEFAULT_BRANDS). */
export function __setBrands(brands) {
  if (Array.isArray(brands)) _brands = brands.map((b) => String(b || '').toLowerCase());
  return _brands;
}
/** Restore the default brands (tests). */
export function __resetBrands() { _brands = DEFAULT_BRANDS; return _brands; }
/** Seam for a hosted URL-reputation API (unused offline). */
export function __setFetch(fn) { if (typeof fn === 'function') _fetch = fn; return _fetch; }
/** Read the active patterns / brands (diagnostics / tests). */
export function __getPatterns() { return _patterns; }
export function __getBrands() { return _brands; }

// ── normalization: lowercase, collapse single-char-gap obfuscation (s-e-e-d, s.e.e.d), squeeze space.
//    We keep enough structure for the phrase patterns to match on word-ish boundaries.
function normalize(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  // collapse "s e e d" / "s.e.e.d" / "s-e-e-d" letter-spacing into "seed"
  s = s.replace(/\b(?:[a-z][\s.\-_*]){1,}[a-z]\b/g, (m) => m.replace(/[\s.\-_*]/g, ''));
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

// Levenshtein edit distance (tiny, iterative, capped strings). Used for lookalike-domain detection.
function editDistance(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

// Extract the registrable-ish label (the part before the public suffix) from a URL or bare domain.
// Conservative: we just want the most-significant label to compare against brand names.
function domainLabel(urlOrDomain) {
  let host = String(urlOrDomain || '').trim().toLowerCase();
  const m = host.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/); // scheme://host
  if (m) host = m[1];
  else host = host.replace(/^\/\//, '').split(/[/?#\s]/)[0];
  host = host.replace(/^www\./, '').split(':')[0]; // strip www. + port
  const parts = host.split('.').filter(Boolean);
  if (parts.length === 0) return '';
  // registrable label = second-to-last when there is a TLD, else the whole thing.
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

// A link is a lookalike if its registrable label is CLOSE to (but not exactly) a known brand label.
// Exact matches are explicitly NOT flagged (the legitimate site). One-or-two edits, or brand-as-
// substring with extra tokens, is the typosquat shape.
function lookalikeHits(links) {
  const hits = [];
  const seen = new Set();
  for (const raw of links || []) {
    const label = domainLabel(raw);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    for (const brand of _brands) {
      if (!brand) continue;
      if (label === brand) break; // exact brand → legitimate, never flag this link
      const dist = editDistance(label, brand);
      const close = dist > 0 && dist <= Math.max(1, Math.floor(brand.length / 6));
      // "binance-support", "metamask-wallet", "hive-keychainn" — brand embedded with extra tokens.
      const embeddedExtra = label !== brand && label.length > brand.length &&
        label.includes(brand) && brand.length >= 4;
      if (close || embeddedExtra) {
        hits.push({ link: String(raw).slice(0, 256), label, brand, distance: dist });
        break;
      }
    }
  }
  return hits;
}

// Map a 0..1 score to a flag-pipe severity 1..5. Conservative: a single mild signal is not a 5.
function severityFromScore(score) {
  if (score >= 0.85) return 5;
  if (score >= 0.65) return 4;
  if (score >= 0.45) return 3;
  if (score >= 0.25) return 2;
  return 1;
}

// Severity floor by worst signal present: a seed-phrase ask is the gravest scam (drains a wallet
// outright) and is never below severity 5; a doubler / fake-airdrop is never below 4.
function severityFloor(signals) {
  if (signals.includes('seed-phrase')) return 5;
  if (signals.includes('doubler') || signals.includes('fake-airdrop') || signals.includes('lookalike-domain')) return 4;
  return 1;
}

// The threshold above which we EMIT a flag (below = scored but no flag; e.g. a single mild lure).
export const FLAG_THRESHOLD = 0.45;

/**
 * Heuristic scam / phishing detector.
 *
 * @param {string} text  the text to score (any string; null/undefined → neutral result).
 * @param {{links?:string[]}} [opts]  links extracted from the content (URLs or bare domains) — used
 *   for lookalike-domain detection. Optional; text-only detection still works without it.
 * @returns {{score:number, signals:string[], flag:{kind:'scam', severity:number, reason:string}|null}}
 *   - score   0..1 scam-likelihood estimate.
 *   - signals which pattern signals fired (e.g. ['seed-phrase','doubler','lookalike-domain']).
 *   - flag    a flag-pipe-shaped object when score >= FLAG_THRESHOLD, else null. Always
 *             { kind:'scam', severity:1..5, reason:string }. `reason` is esc()-escaped.
 * Soft-fail: any internal error → { score:0, signals:[], flag:null }.
 */
export function detectScam(text, opts = {}) {
  try {
    const norm = normalize(text);
    const links = Array.isArray(opts && opts.links) ? opts.links : [];

    const signals = [];
    const perSignal = {}; // signal -> hit count
    const whyBySignal = {}; // signal -> first matched `why`
    let rawScore = 0;

    // Text pattern rules. We add each DISTINCT signal once at full weight, then diminish for repeats
    // of the SAME signal so a spammy repeated phrase can't run the score to 1 on its own.
    for (const rule of _patterns || []) {
      if (!rule || !rule.re) continue;
      let matched = false;
      try { matched = rule.re.test(norm); } catch { matched = false; }
      if (!matched) continue;
      const sig = rule.signal;
      const weight = Number(rule.weight) || 0;
      const firstHit = !(sig in perSignal);
      perSignal[sig] = (perSignal[sig] || 0) + 1;
      if (firstHit) {
        signals.push(sig);
        whyBySignal[sig] = rule.why || sig;
        rawScore += weight;
      } else {
        rawScore += weight * 0.25; // diminishing for additional rules of the same signal
      }
    }

    // Lookalike-domain signal from the links.
    const looks = lookalikeHits(links);
    if (looks.length) {
      signals.push('lookalike-domain');
      perSignal['lookalike-domain'] = looks.length;
      const sample = looks[0];
      whyBySignal['lookalike-domain'] =
        `link domain "${sample.label}" mimics "${sample.brand}"`;
      rawScore += 0.55 + Math.min(looks.length - 1, 3) * 0.1;
    }

    const score = clamp01(rawScore);

    if (score < FLAG_THRESHOLD || signals.length === 0) {
      return { score: Number(score.toFixed(3)), signals, flag: null };
    }

    const severity = Math.max(severityFromScore(score), severityFloor(signals));
    const why = signals.map((s) => whyBySignal[s]).filter(Boolean).join('; ');
    const reason = esc(`heuristic scam/phish (offline fallback): ${why} (score ${score.toFixed(2)})`);

    return {
      score: Number(score.toFixed(3)),
      signals,
      flag: { kind: 'scam', severity, reason },
    };
  } catch {
    return { score: 0, signals: [], flag: null }; // soft-fail-never-throw
  }
}

// Exposed for tests / diagnostics (pure helpers).
export const _internal = { normalize, editDistance, domainLabel, lookalikeHits };

// ── CLI: score a string of text from argv (read-only; files nothing). ───────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('scam-detect.mjs')) {
  const text = process.argv.slice(2).join(' ');
  console.log(JSON.stringify(detectScam(text, {}), null, 2));
}
