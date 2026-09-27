// ryan-mind/util.mjs — small shared helpers: tokens, lexical similarity, dates, hashing, sentences.
// Pure functions, no I/O, no network.
import { createHash } from 'node:crypto';

export function sha(s, n = 12) {
  return createHash('sha256').update(String(s ?? '')).digest('hex').slice(0, n);
}

export function slug(s, max = 48) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'x';
}

export const STOPWORDS = new Set(`a about above after again against all also am an and any are as at be because been
before being below between both but by can could did do does doing down during each few for from further had has
have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself
no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that
the their theirs them themselves then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours yourself yourselves one two three may might
must shall upon within without via per etc ie eg vs part section also every many much well way thus hence therefore
becomes become became being made make makes like just even still yet whose whether either neither each other another
such same new old first last`.split(/\s+/));

const NEGATION_RE = /\b(not|no|never|none|nothing|neither|nor|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|wouldn't|shouldn't)\b/i;
// rhetorical contrast AFFIRMS ("not merely X", "not X but Y", "not fairy tales — it is Z"): strip before testing
const RHETORICAL_RE = [
  /\bnot\s+(merely|just|only|simply|mere|a mere)\b/gi,
  /\b(not|no longer|never)\b[^.;!?]{0,90}?(\bbut\b|—|–|--|;|:)/gi,
  /\bnot only\b/gi,
];
/** Does the sentence genuinely negate (as opposed to the "not X but Y" figure, which affirms Y)? */
export function hasNegation(s) {
  let t = String(s ?? '');
  for (const re of RHETORICAL_RE) t = t.replace(re, ' ');
  return NEGATION_RE.test(t);
}

// crude stemmer: enough to fold plurals / -ing / -ed for lexical matching
export function stem(w) {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Content tokens (lowercased, stopwords out, stemmed). Numbers kept (commas stripped). */
export function contentTokens(s) {
  const out = [];
  for (const raw of String(s ?? '').toLowerCase().replace(/(\d),(\d{3})/g, '$1$2').match(/[a-z0-9][a-z0-9'-]*/g) || []) {
    const w = raw.replace(/^'+|'+$/g, '').replace(/'s$/, '');
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    out.push(/^\d+$/.test(w) ? w : stem(w));
  }
  return out;
}

export function numbersIn(s) {
  return new Set((String(s ?? '').replace(/(\d),(\d{3})/g, '$1$2').match(/\b\d+(?:\.\d+)?\b/g) || []).filter((n) => n.length >= 2));
}

/** IDF-weighted cosine over token sets. idf(token) supplied by caller (defaults to 1). */
export function weightedOverlap(ta, tb, idf = () => 1) {
  const A = new Set(ta), B = new Set(tb);
  if (!A.size || !B.size) return 0;
  let shared = 0, wa = 0, wb = 0;
  for (const t of A) { const w = idf(t); wa += w * w; if (B.has(t)) shared += w * w; }
  for (const t of B) { const w = idf(t); wb += w * w; }
  return shared / Math.sqrt(wa * wb);
}

/** Fraction of b's tokens that also occur in a. */
export function containment(ta, tb) {
  const A = new Set(ta), B = new Set(tb);
  if (!B.size) return 0;
  let n = 0; for (const t of B) if (A.has(t)) n++;
  return n / B.size;
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Parse the loose dates the corpus uses into ISO YYYY-MM-DD. Returns null when no usable date.
 * Handles: 2026-05-23, 2026-05-23T..., "January 17, 2026", "17 January 2026", "January 2026", "2016 (STEEM Era)".
 * Month-only → day 01; year-only → 01-01. Callers record date_basis so a coarse date is never passed off as exact.
 */
export function parseLooseDate(s) {
  if (s == null) return null;
  if (typeof s === 'number' && Number.isFinite(s)) { // epoch seconds or ms
    const d = new Date(s > 1e12 ? s : s * 1000); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const t = String(s).trim();
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const low = t.toLowerCase();
  m = low.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = low.match(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+(\d{4})\b/);
  if (m) return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = low.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/);
  if (m) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-01`;
  m = low.match(/^(?:c\.\s*)?((?:19|20)\d{2})\b/);
  if (m) return `${m[1]}-01-01`;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime()) && /\d{4}/.test(t)) return d.toISOString().slice(0, 10);
  return null;
}

/** Exact timestamp (full ISO) when the input carries a time; null otherwise. Chats/emails keep this. */
export function parseTimestamp(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number' && Number.isFinite(s)) { const d = new Date(s > 1e12 ? s : s * 1000); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const t = String(s).trim();
  if (/^\d{12,}$/.test(t)) return parseTimestamp(Number(t));
  if (!/\d{1,2}:\d{2}/.test(t)) return null;
  const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Content tokens that sit inside a negated clause ("not X", "never Y") — what the sentence DENIES. */
export function negatedTokens(s) {
  let t = String(s ?? '');
  for (const re of RHETORICAL_RE.slice(0, 1)) t = t.replace(re, ' ');
  const out = new Set();
  for (const m of t.matchAll(/\b(?:not|no|never|cannot|neither|nor|\w+n't)\b([^.,;:!?—–()]{1,80})/gi)) for (const tok of contentTokens(m[1].split(/\bbut\b|\s-\s/i)[0])) out.add(tok);
  return out;
}

/**
 * Real polarity conflict: one sentence denies something the other asserts (a shared content token sits in
 * a negated clause on one side only). "Wadjet is not Leto, Wadjet is THEIA" does NOT conflict with
 * "Wadjet = Theia" — what it denies (Leto) the other never asserts.
 */
export function polarityConflict(a, b, { distinctive = () => true } = {}) {
  const na = negatedTokens(a), nb = negatedTokens(b);
  if (na.size && nb.size) return null; // both deny something — overwhelmingly the same denial, reworded
  const ta = new Set(contentTokens(a)), tb = new Set(contentTokens(b));
  for (const t of na) if (tb.has(t) && !nb.has(t) && distinctive(t)) return t;
  for (const t of nb) if (ta.has(t) && !na.has(t) && distinctive(t)) return t;
  return null;
}

/** Split prose into sentences, keeping each sentence's exact text (verbatim spans). */
export function splitSentences(text) {
  const t = String(text ?? '').replace(/\r/g, '');
  const out = [];
  for (const para of t.split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+\.)\s)/)) {
    const p = para.replace(/\s*\n\s*/g, ' ').trim();
    if (!p) continue;
    // split after . ! ? (and closing quote/paren) when followed by space + capital/quote/digit
    const parts = p.split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/);
    for (const s of parts) { const x = s.trim(); if (x) out.push(x); }
  }
  return out;
}

export function normalizeWs(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }

export function parseJsonl(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const l = line.trim(); if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* skip corrupt line — append-only logs survive a torn write */ }
  }
  return out;
}

/** Pull the first JSON object/array out of a model reply (models wrap JSON in prose / fences). */
export function extractJson(text) {
  const s = String(text ?? '');
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const i = s.indexOf(open); const j = s.lastIndexOf(close);
    if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch { /* try next */ } }
  }
  return null;
}
