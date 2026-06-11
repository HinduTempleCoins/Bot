// extractive-summary.mjs — deterministic, no-LLM, no-network extractive text summarizer.
// (backlog cba0a2f622; serves "Summary generation" (444) and wiki-bot rule-based extraction (392).)
// Phase-2-safe by construction: PURE. No LLM, no fetch, no secrets, no file IO. Soft-fail, never throws.
//
// THE MODEL: classic TF + position + length-penalty extractive summarization.
//   1. split text into sentences (abbreviation-aware so "e.g." / "Dr." don't break a sentence);
//   2. build a term-frequency map over content words (stopwords removed, lowercased);
//   3. score each sentence = sum(term freq) / sqrt(words) * positionBoost(rank);
//   4. summarize() picks the top-N highest-scoring sentences and returns them in ORIGINAL order;
//   5. keywords() returns the top-N content terms.
//
// Everything degrades softly: empty / whitespace / non-string input -> '' (or [] / {}). Never throws.
//
//   import { sentences, wordFreq, scoreSentences, summarize, keywords } from './extractive-summary.mjs'
//   node integrations/extractive-summary.mjs "Some long text. With sentences. To summarize."

// --- HTML escape (strict; available for any render path) -------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- a small English stopword set ------------------------------------------

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can',
  'will', 'just', 'don', 'should', 'now', 'is', 'am', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do',
  'does', 'did', 'doing', 'this', 'that', 'these', 'those', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  'as', 'of', 'because', 'until', 'while', 'how', 'why', 'where',
]);

// --- abbreviations that must NOT terminate a sentence ----------------------

const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st',
  'sr', 'jr', 'inc', 'ltd', 'co', 'corp', 'no', 'fig', 'al', 'a.m',
  'p.m', 'u.s', 'u.k', 'ph.d', 'b.c', 'a.d', 'approx',
]);

// --- helpers ----------------------------------------------------------------

function safeStr(text) {
  return typeof text === 'string' ? text : '';
}

// the word that immediately precedes a candidate terminator, lowercased, no trailing dot
function tailWord(chunk) {
  const m = String(chunk).match(/([A-Za-z][A-Za-z.]*)\.?\s*$/);
  if (!m) return '';
  return m[1].replace(/\.$/, '').toLowerCase();
}

// --- sentences(text) — abbreviation-aware splitter --------------------------

export function sentences(text) {
  const src = safeStr(text).replace(/\s+/g, ' ').trim();
  if (!src) return [];

  const out = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // gather a run of terminators (e.g. "?!" or "...")
    let j = i;
    while (j + 1 < src.length && '.!?'.includes(src[j + 1])) j++;

    const next = src[j + 1];
    // a sentence ends only when followed by whitespace+ (capital/quote/digit) or end-of-string
    const followedByBreak = next === undefined || (/\s/.test(next));
    if (!followedByBreak) { i = j; continue; }

    const piece = src.slice(start, i); // up to (not incl.) the first terminator
    const tw = tailWord(piece + (ch === '.' ? '' : ''));

    // single '.' right after a known abbreviation -> not a boundary
    if (ch === '.' && j === i && ABBREVIATIONS.has(tw)) { i = j; continue; }
    // single uppercase letter + '.' -> likely an initial (e.g. "J. Smith")
    if (ch === '.' && j === i && /^[a-z]$/.test(tw)) {
      // peek: if the next non-space char is uppercase, treat as initial, not a boundary
      let k = j + 1;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (k < src.length && /[A-Z]/.test(src[k])) { i = j; continue; }
    }

    const sentence = src.slice(start, j + 1).trim();
    if (sentence) out.push(sentence);
    start = j + 1;
    i = j;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// --- tokenization -----------------------------------------------------------

function tokens(text) {
  return safeStr(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(Boolean);
}

// --- wordFreq(text, {stopwords}) — content-term frequency map ---------------

export function wordFreq(text, opts = {}) {
  const stop = opts && opts.stopwords ? opts.stopwords : STOPWORDS;
  const stopSet = stop instanceof Set ? stop : new Set(Array.isArray(stop) ? stop : []);
  const freq = Object.create(null);
  for (const w of tokens(text)) {
    if (stopSet.has(w)) continue;
    if (w.length < 2 && !/[0-9]/.test(w)) continue; // drop single letters, keep digits
    freq[w] = (freq[w] || 0) + 1;
  }
  return freq;
}

// --- scoreSentences(text, {stopwords, positionBoost}) -----------------------
// returns [{ index, text, score, words }], in ORIGINAL order.

export function scoreSentences(text, opts = {}) {
  const sents = sentences(text);
  if (!sents.length) return [];
  const freq = wordFreq(text, opts);

  // default position boost: earlier sentences get a mild lift, tapering off.
  const positionBoost = (opts && typeof opts.positionBoost === 'function')
    ? opts.positionBoost
    : (rank, total) => 1 + 0.35 * (1 - rank / Math.max(1, total));

  const stop = opts && opts.stopwords ? opts.stopwords : STOPWORDS;
  const stopSet = stop instanceof Set ? stop : new Set(Array.isArray(stop) ? stop : []);
  const total = sents.length;

  return sents.map((s, index) => {
    const ws = tokens(s).filter((w) => !stopSet.has(w));
    const raw = ws.reduce((sum, w) => sum + (freq[w] || 0), 0);
    // length penalty: divide by sqrt(content-word count) so long sentences don't dominate.
    const lenPenalty = ws.length > 0 ? Math.sqrt(ws.length) : 1;
    let score = (raw / lenPenalty) * positionBoost(index, total);
    if (!Number.isFinite(score)) score = 0;
    return { index, text: s, score, words: tokens(s).length };
  });
}

// --- summarize(text, {maxSentences=3, maxChars}) ----------------------------
// top sentences by score, re-emitted in ORIGINAL order, joined with a space.

export function summarize(text, opts = {}) {
  const scored = scoreSentences(text, opts);
  if (!scored.length) return '';

  const maxSentences = Number.isInteger(opts.maxSentences) && opts.maxSentences > 0
    ? opts.maxSentences
    : 3;

  // pick the top-N by score (stable: ties keep earlier sentence first).
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const picked = ranked.slice(0, maxSentences).sort((a, b) => a.index - b.index);

  const maxChars = Number.isInteger(opts.maxChars) && opts.maxChars > 0 ? opts.maxChars : 0;
  const parts = [];
  let len = 0;
  for (const p of picked) {
    const piece = p.text;
    const addLen = (parts.length ? 1 : 0) + piece.length;
    if (maxChars && len + addLen > maxChars) {
      // include this sentence only if nothing has been added yet (avoid empty summary),
      // truncated to the cap.
      if (!parts.length) {
        return piece.slice(0, maxChars).trim();
      }
      break;
    }
    parts.push(piece);
    len += addLen;
  }
  return parts.join(' ');
}

// --- keywords(text, {n=8}) — top content terms ------------------------------

export function keywords(text, opts = {}) {
  const n = Number.isInteger(opts.n) && opts.n > 0 ? opts.n : 8;
  const freq = wordFreq(text, opts);
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term]) => term);
}

// --- CLI --------------------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv.slice(2).join(' ');
  const text = input || 'No input supplied. Pass text as arguments to summarize it.';
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    summary: summarize(text, { maxSentences: 3 }),
    keywords: keywords(text, { n: 8 }),
    sentenceCount: sentences(text).length,
  }, null, 2));
}
