// moderation-adapter.mjs — pluggable text-moderation interface (task #286).
//
// This is the Perspective-API REPLACEMENT. Perspective sunsets 2026-12-31 (no migration tooling), so
// per .local/TONE_NLP_TRANSLATION_API_CATALOG.md the floor becomes self-hosted Detoxify. This adapter
// is the seam:
//
//   • DEFAULT path: POST the text to a self-hosted Detoxify endpoint at process.env.DETOXIFY_URL.
//     fetch is INJECTABLE (__setFetch) for tests. The call SOFT-FAILS — any error / missing URL /
//     bad shape falls through to the lexicon heuristic.
//   • FALLBACK path: a keyless lexicon-based toxicity/harassment/threat scorer so the adapter ALWAYS
//     returns a score, even fully offline with nothing configured.
//
// Swapping in the REAL Detoxify (or cardiffNLP offensive/hate) is a self-host deploy that sits BEHIND
// this same moderate() signature — callers don't change.
//
// SEPARATION OF CONCERNS: this score is the moderation/content-POSTURE floor that feeds POLICY. It is
// NOT folded into the Clarity Score — Clarity = observable on-chain facts only (clarity.mjs). Keep the
// two distinct: low Clarity ≠ toxic, "toxic" label ≠ ban. Every output is an ADVISORY FLAG for human/
// operator review (same liability frame as clarity.mjs / comms-parser sentiment) — never an auto-block.
//
//   import { moderate } from './integrations/moderation-adapter.mjs';
//   const r = await moderate('you are an idiot');   // → { toxicity, severe, insult, threat, label, source }
//
//   node integrations/moderation-adapter.mjs "some text to score"

const URL = () => (process.env.DETOXIFY_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = +(process.env.DETOXIFY_TIMEOUT_MS || 8000);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const LABELS = ['toxicity', 'severe', 'insult', 'threat'];

function clamp01(n) { const x = Number(n); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; }
function labelFor(scores) {
  // a single rolled-up label for callers that want one word. Order matters: severe > threat > toxic.
  if (scores.severe >= 0.5) return 'severe';
  if (scores.threat >= 0.5) return 'threat';
  if (scores.insult >= 0.5) return 'insult';
  if (scores.toxicity >= 0.5) return 'toxic';
  return 'ok';
}

// ── lexicon fallback — keyless, pure, deterministic. Always returns a score. ───────────────────────
// Compact, expandable term sets. We DON'T reproduce slurs here; the floor is harassment/insult/threat
// CUES, scaled to 0..1. A real model (Detoxify) replaces this behind the same shape.
const INSULT = new Set([
  'idiot', 'stupid', 'dumb', 'moron', 'loser', 'pathetic', 'worthless', 'useless', 'trash', 'garbage',
  'clown', 'fool', 'incompetent', 'ugly', 'disgusting', 'scum', 'jerk', 'shut up',
]);
const THREAT = [
  /\bi(?:'| wi| )?ll (?:kill|hurt|destroy|end|find) you\b/i, /\bkill yourself\b/i, /\byou(?:'| a| )?re dead\b/i,
  /\bwatch your back\b/i, /\bcome for you\b/i, /\bmake you (?:pay|regret)\b/i, /\bbeat you up\b/i,
  /\bhunt you down\b/i,
];
const PROFANITY = new Set([
  'damn', 'hell', 'crap', 'screw', 'piss', 'bastard', 'jackass', 'asshole', 'shit', 'fuck', 'fucking',
  'bullshit',
]);
const SEVERE_CUES = [/\bf+u+c+k+\s+you\b/i, /\bgo to hell\b/i];

function words(text) {
  return String(text == null ? '' : text).toLowerCase().match(/[a-z][a-z']*/g) || [];
}

/**
 * Lexicon heuristic — keyless toxicity floor. PURE, offline, deterministic. Counts insult/profanity
 * tokens and matches threat/severe phrase patterns, scaling each axis to 0..1. ALL-CAPS shouting and
 * second-person targeting ("you …") nudge toxicity up (harassment cue).
 *
 * @param {string} text
 * @returns {{toxicity,severe,insult,threat:number, label:string, source:'lexicon'}}
 */
export function lexiconModerate(text) {
  const s = String(text == null ? '' : text);
  const toks = words(s);
  const n = Math.max(toks.length, 1);

  let insultHits = 0, profanityHits = 0;
  for (const t of toks) { if (INSULT.has(t)) insultHits++; if (PROFANITY.has(t)) profanityHits++; }
  // multi-word insult phrases.
  if (/\bshut up\b/i.test(s)) insultHits++;

  const threatHit = THREAT.some((re) => re.test(s));
  const severeHit = SEVERE_CUES.some((re) => re.test(s)) || (threatHit && /\bkill\b/i.test(s));

  const targetsYou = /\byou(?:'re| are| r)?\b/i.test(s);
  const shouting = s === s.toUpperCase() && /[A-Z]{3,}/.test(s);

  // scale: each insult/profanity contributes, saturating; threat/severe are near-binary signals.
  const insult = clamp01(insultHits * 0.45 + (targetsYou && insultHits ? 0.2 : 0));
  const profanity = clamp01(profanityHits * 0.3);
  const threat = threatHit ? 0.9 : 0;
  const severe = severeHit ? 0.85 : 0;
  let toxicity = clamp01(Math.max(insult, profanity * 0.8, threat, severe) + (shouting ? 0.1 : 0));
  if (threat || severe) toxicity = clamp01(Math.max(toxicity, 0.85));

  const scores = { toxicity, severe, insult, threat };
  return { ...scores, label: labelFor(scores), source: 'lexicon' };
}

// Normalize a Detoxify-style JSON body into our shape. Detoxify keys: toxicity, severe_toxicity,
// obscene, threat, insult, identity_attack. We map the four we expose; tolerate arrays/objects.
function normDetoxify(body) {
  if (body == null) return null;
  const b = Array.isArray(body) ? body[0] : body;
  if (!b || typeof b !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) if (b[k] != null && Number.isFinite(Number(b[k]))) return clamp01(b[k]);
    return null;
  };
  const toxicity = pick('toxicity', 'toxic');
  if (toxicity == null) return null;       // not a recognizable Detoxify body → soft-fall to lexicon
  const scores = {
    toxicity,
    severe: clamp01(pick('severe_toxicity', 'severe', 'severe_toxic') ?? 0),
    insult: clamp01(pick('insult') ?? 0),
    threat: clamp01(pick('threat') ?? 0),
  };
  return { ...scores, label: labelFor(scores), source: 'detoxify' };
}

async function postDetoxify(text) {
  const base = URL();
  if (!base) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await _fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!r || !r.ok) return null;
    const body = await r.json().catch(() => null);
    return normDetoxify(body);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Moderate a piece of text. Tries the self-hosted Detoxify endpoint (DETOXIFY_URL) first; on any
 * failure / missing URL / unrecognizable response, falls back to the keyless lexicon heuristic so a
 * score is ALWAYS returned. Never throws.
 *
 * @param {string} text
 * @param {{fetchImpl?:Function}} [opts]  optional per-call fetch override (else the module-level one)
 * @returns {Promise<{toxicity,severe,insult,threat:number, label:string, source:'detoxify'|'lexicon'}>}
 */
export async function moderate(text, opts = {}) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return { toxicity: 0, severe: 0, insult: 0, threat: 0, label: 'ok', source: 'lexicon' };
  // per-call fetch override (used by tests / callers that hold their own client).
  const prev = _fetch;
  if (typeof opts.fetchImpl === 'function') _fetch = opts.fetchImpl;
  try {
    const hosted = await postDetoxify(s);
    if (hosted) return hosted;
  } finally {
    _fetch = prev;
  }
  return lexiconModerate(s);
}

if (process.argv[1] && process.argv[1].endsWith('moderation-adapter.mjs')) {
  const text = process.argv.slice(2).join(' ') || 'you are an idiot and I will find you';
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(await moderate(text), null, 2));
}
