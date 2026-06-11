// readability-stats.mjs — PURE, deterministic text-readability metrics for the
// MELEK knowledge / training corpus quality pipeline. No network, no LLM, no IO.
//
// Supports assessing the readability of corpus documents (scripture, tutorial copy,
// generated prose) so the knowledge pipeline can flag passages that are too dense
// or too thin. Everything here is a deterministic function of the input string.
//
//   import { textStats, fleschReadingEase, fleschKincaidGrade, readingTimeMinutes }
//     from './readability-stats.mjs'
//   node integrations/readability-stats.mjs "some text"   # print a stats table
//   echo "some text" | node integrations/readability-stats.mjs
//
// ── On the numbers ─────────────────────────────────────────────────────────
//   Flesch Reading Ease  = 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)
//   Flesch-Kincaid Grade = 0.39*(words/sentences) + 11.8*(syllables/words) - 15.59
//   Syllable counting is an APPROXIMATE vowel-group heuristic (silent-e + trailing
//   'le' adjustments). It is good enough for relative corpus comparison, NOT a
//   dictionary-accurate phonetic count. Documented as approximate by design.
//
//   Soft-fail contract: empty / non-string input -> zeroed stats, NEVER throws.

// ---------------------------------------------------------------------------
// tokenisation (pure)
// ---------------------------------------------------------------------------

// A "word" is a run of letters/digits/apostrophes. Keeps "don't" as one word.
const WORD_RE = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)*/g;
// Sentence terminators: ., !, ? (and runs thereof). We count the segments that
// actually contain a word so trailing punctuation / whitespace don't inflate.
const SENTENCE_SPLIT_RE = /[.!?]+/;

function asText(text) {
  return (typeof text === 'string') ? text : '';
}

function countWords(text) {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

function countSentences(text) {
  // Count segments between terminators that contain at least one word.
  const segs = text.split(SENTENCE_SPLIT_RE);
  let n = 0;
  for (const s of segs) {
    if (WORD_RE.test(s)) n++;
    WORD_RE.lastIndex = 0; // reset the global regex's stateful cursor
  }
  return n;
}

// ---------------------------------------------------------------------------
// syllable heuristic (APPROXIMATE — see header)
// ---------------------------------------------------------------------------
// Count vowel groups; subtract a likely-silent trailing 'e'; add back a syllable
// for a consonant + 'le' ending (e.g. "table", "candle"); floor at 1 for any word
// that has letters. This is the standard textstat-style approximation.
export function syllablesInWord(word) {
  if (typeof word !== 'string') return 0;
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;

  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 0;

  const consonantLe = /[^aeiouy]le$/.test(w); // table, candle, little

  // Silent trailing 'e' drops a syllable (make -> 1). The terminal 'e' of a
  // consonant+'le' ending is treated the same way: its own syllable comes from
  // the consonant+'le' rule below, so we strip the bare 'e' group either way.
  if (w.length > 2 && w.endsWith('e') && count > 1) {
    count -= 1;
  }
  // Consonant + 'le' ending is its own syllable (ta-ble, can-dle).
  if (consonantLe) {
    count += 1;
  }

  return count < 1 ? 1 : count;
}

export function countSyllables(text) {
  const t = asText(text);
  const words = t.match(WORD_RE);
  if (!words) return 0;
  let total = 0;
  for (const w of words) total += syllablesInWord(w);
  return total;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

const round = (n, d = 3) => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

const ZERO_STATS = Object.freeze({
  chars: 0, words: 0, sentences: 0, syllables: 0,
  avgWordsPerSentence: 0, avgSyllablesPerWord: 0,
});

export function textStats(text) {
  const t = asText(text);
  if (!t) return { ...ZERO_STATS };

  const chars = t.length;
  const words = countWords(t);
  const sentences = countSentences(t);
  const syllables = countSyllables(t);

  return {
    chars,
    words,
    sentences,
    syllables,
    avgWordsPerSentence: sentences ? round(words / sentences) : 0,
    avgSyllablesPerWord: words ? round(syllables / words) : 0,
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Flesch Reading Ease, clamped to the conventional 0..100 reporting band.
export function fleschReadingEase(text) {
  const s = textStats(text);
  if (!s.words || !s.sentences) return 0;
  const score = 206.835
    - 1.015 * (s.words / s.sentences)
    - 84.6 * (s.syllables / s.words);
  return round(clamp(score, 0, 100), 2);
}

// Flesch-Kincaid Grade Level (not clamped — can legitimately be < 0 or large).
export function fleschKincaidGrade(text) {
  const s = textStats(text);
  if (!s.words || !s.sentences) return 0;
  const grade = 0.39 * (s.words / s.sentences)
    + 11.8 * (s.syllables / s.words)
    - 15.59;
  return round(grade, 2);
}

// Estimated reading time in minutes at `wpm` words-per-minute (default 200).
export function readingTimeMinutes(text, wpm = 200) {
  const s = textStats(text);
  const rate = (Number.isFinite(wpm) && wpm > 0) ? wpm : 200;
  if (!s.words) return 0;
  return round(s.words / rate, 2);
}

// ---------------------------------------------------------------------------
// CLI — print a stats table for an arg string or piped stdin (no network)
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('readability-stats.mjs')) {
  const argText = process.argv.slice(2).join(' ').trim();
  let input = argText;
  if (!input) {
    // no arg — try stdin (pipe). readFileSync(0) is sync and offline.
    try {
      const fs = await import('node:fs');
      input = fs.readFileSync(0, 'utf8');
    } catch {
      input = '';
    }
  }

  const s = textStats(input);
  const rows = [
    ['chars', s.chars],
    ['words', s.words],
    ['sentences', s.sentences],
    ['syllables', s.syllables],
    ['avg words/sentence', s.avgWordsPerSentence],
    ['avg syllables/word', s.avgSyllablesPerWord],
    ['Flesch reading-ease (0..100)', fleschReadingEase(input)],
    ['Flesch-Kincaid grade', fleschKincaidGrade(input)],
    ['reading time (min @200wpm)', readingTimeMinutes(input)],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  console.log('readability-stats (syllables approximate)');
  for (const [k, v] of rows) console.log('  ' + k.padEnd(w) + '  ' + v);
}
