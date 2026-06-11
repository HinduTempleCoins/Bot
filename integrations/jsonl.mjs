// jsonl.mjs — JSONL (newline-delimited JSON) serialize / parse / append / dedupe helpers for the
// MELEK corpus pipelines. JSONL is the on-disk format for scraped knowledge records (one JSON object
// per line), e.g. data/booklore/*.jsonl. This module is the dedicated, reusable home for the one-line
// `toJsonl` that was inlined in integrations/scrapers/sacred-texts.mjs, plus tolerant parsing, append,
// and stable first-wins dedup — so every scraper/ingest step shares one well-tested implementation.
//
// Pure module: no IO, no network, no secrets. Never throws — bad input is skipped or reported, not
// raised — so a single malformed record can't crash a corpus run.
//
//   import { toJsonl, parseJsonl, appendJsonl, dedupeJsonl } from './jsonl.mjs'

// ── toJsonl: records[] → newline-delimited JSON, one object per line, NO trailing newline. ──
// null/undefined entries are skipped. Non-array input → ''. Any record that can't be stringified
// (e.g. a BigInt or a circular structure) is skipped rather than throwing.
export function toJsonl(records) {
  if (!Array.isArray(records)) return '';
  const lines = [];
  for (const r of records) {
    if (r == null) continue;
    let s;
    try {
      s = JSON.stringify(r);
    } catch {
      continue; // un-serializable (circular / BigInt): skip, never throw.
    }
    if (s === undefined) continue; // e.g. a bare function/symbol stringifies to undefined.
    lines.push(s);
  }
  return lines.join('\n');
}

// ── parseJsonl: text → { records, errors }. Tolerant: blank/whitespace-only lines are skipped,
// per-line parse failures are captured in `errors` (1-based line number + message) instead of
// throwing. Lines that parse but are not objects/arrays are still kept (valid JSON values). ──
export function parseJsonl(text) {
  const out = { records: [], errors: [] };
  if (text == null) return out;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue; // skip blank lines (incl. a trailing newline's empty tail).
    try {
      out.records.push(JSON.parse(raw));
    } catch (e) {
      out.errors.push({ line: i + 1, message: (e && e.message) || String(e) });
    }
  }
  return out;
}

// ── appendJsonl: join new records onto an existing JSONL string, preserving the no-trailing-newline
// invariant and not introducing a leading blank line when the existing text is empty. ──
export function appendJsonl(existingText, records) {
  const tail = toJsonl(records);
  const head = existingText == null ? '' : String(existingText).replace(/\n+$/, '');
  if (head === '') return tail;
  if (tail === '') return head;
  return head + '\n' + tail;
}

// ── dedupeJsonl: first-wins dedup by a stable key. keyFn(record) → key (defaults to JSON.stringify
// of the whole record). Records where keyFn throws or returns null/undefined are kept (treated as
// un-keyable / always-unique) so dedup never silently drops data on a bad key function. ──
export function dedupeJsonl(records, keyFn) {
  if (!Array.isArray(records)) return [];
  const key = typeof keyFn === 'function' ? keyFn : (r) => safeStringify(r);
  const seen = new Set();
  const out = [];
  for (const r of records) {
    let k;
    try {
      k = key(r);
    } catch {
      out.push(r); // bad key fn for this record: keep it, don't drop.
      continue;
    }
    if (k == null) { out.push(r); continue; } // un-keyable: keep.
    const kk = typeof k === 'string' ? k : safeStringify(k);
    if (seen.has(kk)) continue; // first-wins: a later duplicate is dropped.
    seen.add(kk);
    out.push(r);
  }
  return out;
}

function safeStringify(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}
