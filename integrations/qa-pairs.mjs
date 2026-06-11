// qa-pairs.mjs — Q&A / instruction-pair builder from parsed email & forum/Discord threads, for the
// MELEK training-set transform pipeline. This is the "Create Q&A pairs from email threads" /
// "format as JSONL for AI training" itinerary step: it turns an ALREADY-PARSED conversation into
// clean instruction-tuning records.
//
// Pure transform: NO scraping, NO network, NO PII intake. The caller pre-parses (one message per
// turn) and pre-redacts. This module only re-shapes. Never throws — bad input returns [].
//
// It pairs with integrations/jsonl.mjs for on-disk write: build records here, then
//   import { toJsonl } from './jsonl.mjs'
//   toJsonl(toRecords(pairsFromThread({ messages })))
// to serialize. This module deliberately does NOT do the file write.
//
//   import { pairsFromThread, toRecords, dedupePairs } from './qa-pairs.mjs'
//
// Shapes:
//   messages = [{ author, role?, text, ts? }]        (input: one parsed turn each)
//   pair     = { instruction, response, meta }       (one Q→A training example)
//   record   = { messages: [{ role, content }, ...] } (chat-format instruction record)

// ── Quote / signature stripping ──────────────────────────────────────────────────────────────
// Email/forum replies carry the message being replied to as quoted lines (`> ...`) plus an
// attribution header ("On <date>, <name> wrote:") and a trailing signature ("-- \n..."). For a
// training instruction we want only the NEW text the author wrote, so we strip all of that.

// "On Mon, Jan 1, 2020 at 9:00 AM Foo <foo@x> wrote:" and localized/loose variants, through EOL.
const ATTRIBUTION_RE = /^\s*On\b.*\bwrote:\s*$/i;
// Forum/Discord style: "Foo said:" / "Quote from: Foo on ..." attribution lines.
const FORUM_QUOTE_RE = /^\s*(?:>+\s*)?(?:.+\bsaid:|quote\b.*:)\s*$/i;

// Strip a thread's reply cruft from one turn's text, returning only the author's fresh content.
function cleanText(text) {
  if (text == null) return '';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const kept = [];
  for (const line of lines) {
    // Signature delimiter "-- " (RFC 3676): everything from here down is the sig — stop.
    if (/^--\s*$/.test(line)) break;
    if (ATTRIBUTION_RE.test(line)) continue; // drop attribution header
    if (FORUM_QUOTE_RE.test(line)) continue;  // drop "X said:" headers
    if (/^\s*>/.test(line)) continue;          // drop quoted (`>`-prefixed) lines
    kept.push(line);
  }
  // Collapse runs of blank lines and trim ends.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// A turn is "empty" for our purposes if, once quote/sig-stripped, nothing fresh remains.
function isEmptyTurn(text) {
  return cleanText(text) === '';
}

// ── normalize: for dedupe key — lowercased, whitespace-collapsed, trimmed. ──
function normalize(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
}

// A turn's "side" — who is asking (user) vs answering (assistant). Explicit role wins; otherwise we
// fall back to author identity (first distinct author = the asker).
function sideOf(msg, askerAuthor) {
  const role = msg && msg.role != null ? String(msg.role).toLowerCase() : '';
  if (role === 'user' || role === 'question' || role === 'inbound' || role === 'q') return 'user';
  if (role === 'assistant' || role === 'answer' || role === 'reply' || role === 'outbound' || role === 'a') {
    return 'assistant';
  }
  const author = msg && msg.author != null ? String(msg.author) : '';
  if (askerAuthor != null) return author === askerAuthor ? 'user' : 'assistant';
  return 'user';
}

// ── mergeConsecutive: collapse consecutive same-side, drop quoted-only/empty turns. ──
// Returns a list of merged turns: [{ side, author, text, ts }] in original order, where text is the
// already-cleaned fresh content. Empty/quoted-only turns are dropped BEFORE merging so they don't
// split an otherwise-consecutive run.
function mergeConsecutive(messages) {
  // Determine the asker: first message with an explicit user role, else the first author seen.
  let askerAuthor = null;
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role != null ? String(m.role).toLowerCase() : '';
    if (role === 'user' || role === 'question' || role === 'inbound' || role === 'q') {
      askerAuthor = m.author != null ? String(m.author) : null;
      break;
    }
    if (m.author != null && askerAuthor === null) askerAuthor = String(m.author);
  }

  const cleaned = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const text = cleanText(m.text);
    if (text === '') continue; // empty / quoted-only — drop
    cleaned.push({
      side: sideOf(m, askerAuthor),
      author: m.author != null ? String(m.author) : '',
      text,
      ts: m.ts,
    });
  }

  const merged = [];
  for (const turn of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.side === turn.side && last.author === turn.author) {
      last.text = (last.text + '\n\n' + turn.text).trim();
      if (turn.ts != null) last.ts = turn.ts; // carry the latest ts of the merged run
    } else {
      merged.push({ ...turn });
    }
  }
  return merged;
}

// ── pairsFromThread: parsed thread → [{ instruction, response, meta }]. ──
// Each user (question/inbound) turn is paired with the NEXT assistant (reply) turn. A user turn with
// no following assistant turn is dropped (no answer to learn from). Consecutive same-author turns are
// merged first; empty/quoted-only turns are stripped. Returns [] on bad input, never throws.
export function pairsFromThread(input) {
  try {
    const messages = input && Array.isArray(input.messages) ? input.messages : null;
    if (!messages) return [];
    const turns = mergeConsecutive(messages);
    const pairs = [];
    for (let i = 0; i < turns.length; i++) {
      const q = turns[i];
      if (q.side !== 'user') continue;
      // find the next assistant turn
      const a = turns[i + 1];
      if (!a || a.side !== 'assistant') continue;
      pairs.push({
        instruction: q.text,
        response: a.text,
        meta: {
          questionAuthor: q.author,
          answerAuthor: a.author,
          ...(q.ts != null ? { questionTs: q.ts } : {}),
          ...(a.ts != null ? { answerTs: a.ts } : {}),
        },
      });
    }
    return pairs;
  } catch {
    return [];
  }
}

// ── toRecords: pairs → chat-format instruction records. ──
// [{ instruction, response, meta }] -> [{ messages: [{role,content}, ...] }]
// An optional `system` prompt is prepended as a system turn on every record. Pairs missing either
// side are skipped. Returns [] on bad input, never throws.
export function toRecords(pairs, opts) {
  try {
    if (!Array.isArray(pairs)) return [];
    const system = opts && opts.system != null ? String(opts.system) : '';
    const out = [];
    for (const p of pairs) {
      if (!p || typeof p !== 'object') continue;
      const instruction = p.instruction == null ? '' : String(p.instruction);
      const response = p.response == null ? '' : String(p.response);
      if (instruction.trim() === '' || response.trim() === '') continue;
      const msgs = [];
      if (system.trim() !== '') msgs.push({ role: 'system', content: system });
      msgs.push({ role: 'user', content: instruction });
      msgs.push({ role: 'assistant', content: response });
      out.push({ messages: msgs });
    }
    return out;
  } catch {
    return [];
  }
}

// ── dedupePairs: first-wins dedup on the normalized instruction. ──
// Keeps the first pair for each distinct (lowercased, whitespace-collapsed) instruction. Returns []
// on bad input, never throws.
export function dedupePairs(pairs) {
  try {
    if (!Array.isArray(pairs)) return [];
    const seen = new Set();
    const out = [];
    for (const p of pairs) {
      if (!p || typeof p !== 'object') continue;
      const key = normalize(p.instruction);
      if (key === '') continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  } catch {
    return [];
  }
}

// ── Guarded CLI: read a JSON thread from stdin or a file arg, print JSONL-ish records to stdout. ──
// Pure demo aid; no network, no secrets. `node integrations/qa-pairs.mjs path/to/thread.json`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const { readFileSync } = await import('node:fs');
      const arg = process.argv[2];
      const raw = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');
      const thread = JSON.parse(raw);
      const pairs = dedupePairs(pairsFromThread(thread));
      const records = toRecords(pairs, { system: thread && thread.system });
      for (const r of records) process.stdout.write(JSON.stringify(r) + '\n');
    } catch (e) {
      process.stderr.write('qa-pairs: ' + ((e && e.message) || String(e)) + '\n');
      process.exitCode = 1;
    }
  })();
}
