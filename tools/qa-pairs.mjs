// qa-pairs.mjs — PURE upstream extractor that turns an email/forum *thread* into clean
// question/answer training pairs. Backlog item 2c7c984ba2 / Itinerary item "Create Q&A pairs
// from email threads".
//
// Where this sits in the pipeline: this module is UPSTREAM of tools/training-export.mjs. That
// module is a serializer — it only formats records that are ALREADY paired ({q,a}-ish). It does
// not look at a thread and decide which turn answers which. This module is exactly that missing
// step: given an ordered thread of turns, it heuristically pairs each *question* turn with the
// next *differing-author* turn (an answer) inside a small look-ahead window, skips empty and
// quoted-reply noise, and emits chat-shaped records ready to hand to training-export.toChatJsonl.
//
// A "thread" is an ordered array of turns: { author, role?, text, ts? }. Order is the thread's
// natural reading order (oldest→newest). Author is whatever string identifies the speaker; role
// is optional and unused for pairing (kept for caller context). text is the body. ts is optional.
//
// Pure module: deterministic, no IO, no network, no LLM, no secrets, never throws. Bad input
// (non-array / empty) soft-fails to []. No HTML is produced by the core API, but esc() is exported
// per house style for any caller that renders a pair into markup.
//
//   import { esc, isQuestion, extractPairs, stripQuoted, toRecords, stats } from './qa-pairs.mjs'
//   node tools/qa-pairs.mjs        # prints a tiny inline-sample demo (offline)

// ── esc(s): HTML-escape any string for safe interpolation into markup. House-style seam. ──
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Leading interrogatives. If a (de-quoted, non-empty) line starts with one of these words, we
// treat the turn as a question even without a trailing '?'. Matched case-insensitively on the
// first word only. ──
const INTERROGATIVES = new Set([
  'who', 'what', 'when', 'where', 'why', 'how',
  'can', 'could', 'would', 'should', 'does', 'do', 'did', 'is', 'are', 'will',
]);

// ── isQuestion(text) → bool. Heuristic: the de-quoted text ends with '?', OR its first word is a
// leading interrogative. Empty / non-string → false. ──
export function isQuestion(text) {
  if (typeof text !== 'string') return false;
  const t = stripQuoted(text).trim();
  if (t === '') return false;
  if (t.endsWith('?')) return true;
  const firstWord = t.toLowerCase().match(/^[a-z']+/);
  if (firstWord && INTERROGATIVES.has(firstWord[0])) return true;
  return false;
}

// ── stripQuoted(text) → text with reply noise removed:
//   - lines beginning with '>' (any leading whitespace), the classic quoted-reply marker;
//   - attribution headers like "On Tue, Jan 2, 2024 at 3pm, Alice <a@x> wrote:" — a line that
//     starts with "On " and ends with "wrote:" (optionally followed by nothing). We also catch a
//     bare trailing "... wrote:" line.
// Remaining lines are kept; surrounding blank lines collapse. Non-string → ''. ──
export function stripQuoted(text) {
  if (typeof text !== 'string') return '';
  const kept = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw;
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) continue; // quoted body
    // attribution header: "On ... wrote:" (the line that introduces a quote block).
    if (/^on\b.*\bwrote:\s*$/i.test(trimmed)) continue;
    // a bare "Someone wrote:" header on its own line.
    if (/^.{0,120}\bwrote:\s*$/i.test(trimmed) && /\bwrote:\s*$/i.test(trimmed) && trimmed.length <= 120) {
      // only drop if it really looks like an attribution (contains no sentence punctuation before wrote:)
      const before = trimmed.replace(/\bwrote:\s*$/i, '');
      if (!/[.!?]/.test(before)) continue;
    }
    kept.push(line);
  }
  // collapse leading/trailing blank lines and runs of >1 blank line.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// turn accessors — tolerant of missing/odd shapes.
function turnText(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (typeof t.text === 'string') return t.text;
  if (typeof t.content === 'string') return t.content;
  if (typeof t.body === 'string') return t.body;
  return '';
}
function turnAuthor(t) {
  if (t && typeof t === 'object') {
    if (typeof t.author === 'string') return t.author;
    if (typeof t.from === 'string') return t.from;
  }
  return '';
}

// cleanBody(t) → the de-quoted, trimmed body of a turn (the part worth training on).
function cleanBody(t) {
  return stripQuoted(turnText(t)).trim();
}

// ── extractPairs(turns, opts={}) → [{ question, answer, qIndex, aIndex }]. For each turn that
// isQuestion(), scan forward up to `maxGap` turns (default 3) for the first turn that (a) has a
// non-empty de-quoted body and (b) a *different* author than the question turn — that is the
// answer. Empty / quoted-only turns inside the window do not consume the gap budget toward a
// match, but they ARE counted in the window distance. One answer turn can answer multiple earlier
// questions; pairing does not consume the answer. Non-array / empty → []. ──
export function extractPairs(turns, opts = {}) {
  if (!Array.isArray(turns) || turns.length === 0) return [];
  const maxGap = Number.isInteger(opts.maxGap) && opts.maxGap > 0 ? opts.maxGap : 3;

  const pairs = [];
  for (let i = 0; i < turns.length; i++) {
    const qBody = cleanBody(turns[i]);
    if (qBody === '') continue;
    if (!isQuestion(turnText(turns[i]))) continue;
    const qAuthor = turnAuthor(turns[i]);

    // look ahead within the window for the answer.
    const end = Math.min(turns.length - 1, i + maxGap);
    for (let j = i + 1; j <= end; j++) {
      const aBody = cleanBody(turns[j]);
      if (aBody === '') continue; // skip empty/quoted-only lines
      const aAuthor = turnAuthor(turns[j]);
      // a differing author signals a reply/answer. If authors are unknown (both ''), the
      // adjacency itself is taken as the answer.
      if (qAuthor !== '' && aAuthor !== '' && qAuthor === aAuthor) continue;
      pairs.push({ question: qBody, answer: aBody, qIndex: i, aIndex: j });
      break;
    }
  }
  return pairs;
}

// ── toRecords(pairs) → [{ messages:[{role:'user',content:q},{role:'assistant',content:a}] }].
// Chat-shaped records, one per valid pair (both sides non-empty strings). This is the exact shape
// training-export consumes; from here a caller does training-export.toChatJsonl(records). Bad
// input soft-fails to []. ──
export function toRecords(pairs) {
  if (!Array.isArray(pairs)) return [];
  const out = [];
  for (const p of pairs) {
    if (!p || typeof p !== 'object') continue;
    const q = typeof p.question === 'string' ? p.question.trim() : '';
    const a = typeof p.answer === 'string' ? p.answer.trim() : '';
    if (q === '' || a === '') continue;
    out.push({
      messages: [
        { role: 'user', content: q },
        { role: 'assistant', content: a },
      ],
    });
  }
  return out;
}

// ── stats(pairs) → { count, avgQLen, avgALen }. Averages are mean character length over valid
// pairs, rounded to one decimal; empty → zeros. ──
export function stats(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { count: 0, avgQLen: 0, avgALen: 0 };
  }
  let count = 0, qSum = 0, aSum = 0;
  for (const p of pairs) {
    if (!p || typeof p !== 'object') continue;
    const q = typeof p.question === 'string' ? p.question : '';
    const a = typeof p.answer === 'string' ? p.answer : '';
    if (q === '' || a === '') continue;
    count++; qSum += q.length; aSum += a.length;
  }
  if (count === 0) return { count: 0, avgQLen: 0, avgALen: 0 };
  const round1 = (n) => Math.round((n / count) * 10) / 10;
  return { count, avgQLen: round1(qSum), avgALen: round1(aSum) };
}

// ── CLI demo: tiny inline thread. Offline, stdout only. ──
if (process.argv[1] && process.argv[1].endsWith('qa-pairs.mjs')) {
  const thread = [
    { author: 'alice', text: 'How do I claim my MELEK witness account?' },
    { author: 'hathor', text: 'On Mon, Jan 1, alice wrote:\n> How do I claim my MELEK witness account?\n\nRun the claim flow with your fresh keys, then set your witness URL.' },
    { author: 'alice', text: 'Thanks!' }, // not a question → no pair opened
    { author: 'bob', text: 'Is the active slot really protected?' },
    { author: 'hathor', text: 'Yes — for the first year, at the chain-code level, scoped to hathor.' },
  ];
  const pairs = extractPairs(thread);
  console.log('# extractPairs → ' + pairs.length + ' pair(s)');
  for (const p of pairs) console.log('  Q[' + p.qIndex + ']: ' + p.question + '\n  A[' + p.aIndex + ']: ' + p.answer);
  console.log('# stats → ' + JSON.stringify(stats(pairs)));
  const records = toRecords(pairs);
  console.log('# toRecords → ' + records.length + ' chat record(s) ready for training-export.toChatJsonl');
}
