// claim-extract.mjs — PURE factual-claim extractor for the citation/fact-check pipeline
// (backlog b3adf6fddb). This is the missing UPSTREAM step that feeds tools/citations.mjs
// and integrations/ragas-verify.mjs: before you can check a claim, you have to find the
// claims. This splits prose into candidate sentences and scores how *checkable* each one
// is — numbers, dates, named entities, and copulas ("is/was/founded/located") are factual
// markers; first-person and evaluative adjectives mark opinion; hedges ("maybe/I think")
// demote a claim. NO LLM, NO network, NO file IO — regex + heuristics only.
//
//   import { extractClaims, splitSentences, hasFactualMarkers, claimScore, isOpinion, esc }
//     from './tools/claim-extract.mjs'
//   node tools/claim-extract.mjs            # runs the inline sample demo
//
// splitSentences(text) -> [string]                 (. ! ? terminators, abbreviation-guarded)
// hasFactualMarkers(sentence) -> boolean            (numbers/dates/caps-entities/copulas)
// claimScore(sentence) -> 0..1                      (markers + specificity - hedging)
// isOpinion(sentence) -> boolean                    (first-person / evaluative adjectives)
// extractClaims(text, { minScore = 0.3 })
//   -> [{ text, score, markers:[...] }]             (sorted by score desc, stable)
//
// Soft-fail: empty/garbage/non-string -> [] (or 0 / false), never throws.

// --- HTML-escape for safe CLI/report interpolation -------------------------
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Abbreviations whose trailing period must NOT end a sentence. Lowercased, no dot.
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'gen', 'sen', 'rep', 'gov',
  'vs', 'etc', 'eg', 'ie', 'al', 'inc', 'ltd', 'co', 'corp', 'fig', 'no', 'vol', 'pp',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'a', 'b', 'c', 'd', 'e', 'u', 's', 'p', 'm', 'phd', 'usa', 'uk',
]);

// hedging words that signal an *unverified* / softened assertion.
const HEDGES = [
  'maybe', 'perhaps', 'probably', 'possibly', 'apparently', 'allegedly', 'reportedly',
  'i think', 'i believe', 'i guess', 'i feel', 'in my opinion', 'imo', 'seems', 'seem',
  'seemed', 'might', 'could be', 'may be', 'arguably', 'supposedly', 'kind of', 'sort of',
];

// first-person / opinion openers + evaluative adjectives that mark subjective text.
const FIRST_PERSON = /\b(i|we|my|our|me|us)\b/i;
const EVALUATIVE = [
  'beautiful', 'ugly', 'best', 'worst', 'better', 'worse', 'amazing', 'awesome', 'terrible',
  'awful', 'great', 'wonderful', 'horrible', 'good', 'bad', 'nice', 'lovely', 'delicious',
  'boring', 'fun', 'fascinating', 'gorgeous', 'stunning', 'overrated', 'underrated',
  'favorite', 'favourite', 'love', 'hate', 'prefer', 'beautifully', 'should', 'ought',
];

// copulas / factual relation verbs.
const COPULAS = [
  'is', 'are', 'was', 'were', 'has', 'have', 'had', 'founded', 'located', 'born', 'died',
  'established', 'invented', 'discovered', 'built', 'created', 'launched', 'released',
  'contains', 'consists', 'measures', 'weighs', 'spans', 'comprises', 'situated',
];

function wordSet(words) {
  return new RegExp('\\b(' + words.join('|') + ')\\b', 'i');
}
const COPULA_RE = wordSet(COPULAS);
const EVAL_RE = wordSet(EVALUATIVE);

// numbers (incl. 1,000 / 3.14 / 42%), years, ordinals.
const NUMBER_RE = /\b\d[\d,.]*%?\b/;
// month names + day/year date shapes.
const DATE_RE = /\b(\d{4}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;
// a capitalized word that is NOT just the sentence-initial cap (proper-noun-ish).
const PROPER_RE = /(?:\S\s+)([A-Z][a-zA-Z]+)/;

// --- sentence splitting -----------------------------------------------------
// Split on . ! ? followed by whitespace, but do not break after a known abbreviation,
// a single capital initial ("J. R. R."), or a decimal point inside a number.
export function splitSentences(text) {
  if (typeof text !== 'string') return [];
  const norm = text.replace(/\s+/g, ' ').trim();
  if (!norm) return [];

  const out = [];
  let start = 0;
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // need whitespace (or end) after the terminator to count as a boundary.
    const next = norm[i + 1];
    if (next !== undefined && next !== ' ') continue;

    // don't split a decimal: digit . digit
    if (ch === '.' && /\d/.test(norm[i - 1] || '') && /\d/.test(norm[i + 2] || '')) continue;

    // grab the token immediately before the period to check abbreviation/initial.
    if (ch === '.') {
      const before = norm.slice(start, i);
      const m = before.match(/([A-Za-z]+)$/);
      const tok = m ? m[1].toLowerCase() : '';
      if (tok && ABBREV.has(tok)) continue;       // e.g. "Dr." "Inc." "Jan."
      if (m && m[1].length === 1) continue;        // single initial "J."
    }

    const piece = norm.slice(start, i + 1).trim();
    if (piece) out.push(piece);
    start = i + 1;
  }
  const tail = norm.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

// collect which factual markers a sentence carries (used by score + record).
function markersOf(sentence) {
  const s = typeof sentence === 'string' ? sentence : '';
  const found = [];
  if (NUMBER_RE.test(s)) found.push('number');
  if (DATE_RE.test(s)) found.push('date');
  if (PROPER_RE.test(s)) found.push('proper-noun');
  if (COPULA_RE.test(s)) found.push('copula');
  return found;
}

export function hasFactualMarkers(sentence) {
  return markersOf(sentence).length > 0;
}

function countHedges(s) {
  const lower = s.toLowerCase();
  let n = 0;
  for (const h of HEDGES) if (lower.includes(h)) n++;
  return n;
}

export function isOpinion(sentence) {
  if (typeof sentence !== 'string' || !sentence.trim()) return false;
  // first-person pronoun is a strong opinion signal.
  if (FIRST_PERSON.test(sentence)) return true;
  // evaluative adjective with no factual specificity (no number/date) reads as opinion.
  if (EVAL_RE.test(sentence) && !NUMBER_RE.test(sentence) && !DATE_RE.test(sentence)) return true;
  return false;
}

// 0..1 checkability. markers + specificity, minus hedging and opinion.
export function claimScore(sentence) {
  if (typeof sentence !== 'string') return 0;
  const s = sentence.trim();
  if (!s) return 0;

  const m = markersOf(s);
  let score = 0;
  if (m.includes('number')) score += 0.3;
  if (m.includes('date')) score += 0.3;
  if (m.includes('proper-noun')) score += 0.25;
  if (m.includes('copula')) score += 0.2;

  // specificity bonus: longer, multi-clause factual sentences are more checkable,
  // very short fragments less so.
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words >= 6) score += 0.1;
  if (words < 3) score -= 0.15;

  // hedging demotes.
  score -= 0.25 * countHedges(s);
  // opinion framing demotes hard.
  if (isOpinion(s)) score -= 0.4;

  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return score;
}

// --- main entry -------------------------------------------------------------
export function extractClaims(text, { minScore = 0.3 } = {}) {
  if (typeof text !== 'string') return [];
  const thresh = (typeof minScore === 'number' && !Number.isNaN(minScore)) ? minScore : 0.3;

  const sentences = splitSentences(text);
  const records = [];
  for (let idx = 0; idx < sentences.length; idx++) {
    const t = sentences[idx];
    const score = claimScore(t);
    if (score < thresh) continue;
    records.push({ text: t, score, markers: markersOf(t), _idx: idx });
  }
  // sort by score desc; stable on original order for ties.
  records.sort((a, b) => (b.score - a.score) || (a._idx - b._idx));
  return records.map(({ text, score, markers }) => ({ text, score, markers }));
}

// --- CLI demo (guarded) -----------------------------------------------------
const SAMPLE = [
  'The MELEK testnet launched in June 2026 and runs on a Graphene fork.',
  'I think it is the most beautiful chain I have ever seen.',
  'Dr. Hathor founded the witness account, maybe around block 1000.',
  'It is great.',
].join(' ');

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const claims = extractClaims(SAMPLE);
  const rows = claims.map(c =>
    `<tr><td>${c.score.toFixed(2)}</td><td>${esc(c.markers.join(', '))}</td><td>${esc(c.text)}</td></tr>`
  ).join('\n');
  process.stdout.write(
    `claim-extract demo — ${claims.length} checkable claim(s) of ${splitSentences(SAMPLE).length} sentence(s)\n` +
    `<table>\n${rows}\n</table>\n`
  );
}
