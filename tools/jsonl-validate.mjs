// jsonl-validate.mjs — pure text utility for the "export to JSONL for AI training" rule
// (queue items 243/258, backlog 412c35e1a7). No network, no filesystem in the API surface
// (the CLI reads a fixture only). Soft-fail throughout: a malformed line is reported in an
// errors array, never thrown. Handles a leading BOM and CRLF line endings.
//
//   import { parseLines, toJsonl, dedupe, validate, stripBlankLines } from './jsonl-validate.mjs'
//   node tools/jsonl-validate.mjs [fixture.jsonl]   # validates a fixture, prints a summary
//
// JSONL = one JSON value per line. We treat each non-blank line independently so one bad
// line can't poison the rest of an export.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Strip a UTF-8 BOM if present and normalize CRLF / lone CR to LF.
function normalize(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s.replace(/\r\n?/g, '\n');
}

// Remove blank (empty or whitespace-only) lines; preserves order, drops the BOM, LF-normalized.
export function stripBlankLines(text) {
  return normalize(text)
    .split('\n')
    .filter(line => line.trim() !== '')
    .join('\n');
}

// Parse each non-blank line as JSON. Returns { records, errors } — errors collected, never thrown.
export function parseLines(text) {
  const lines = normalize(text).split('\n');
  const records = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue; // skip blank lines silently
    try {
      records.push(JSON.parse(raw));
    } catch (e) {
      errors.push({ line: i + 1, raw, message: (e && e.message) ? String(e.message) : 'invalid JSON' });
    }
  }
  return { records, errors };
}

// Serialize records to JSONL: one compact JSON object per line, trailing newline.
// Non-serializable entries (circular, undefined) are soft-skipped rather than throwing.
export function toJsonl(records) {
  if (!Array.isArray(records)) return '';
  const out = [];
  for (const rec of records) {
    try {
      const s = JSON.stringify(rec);
      if (s === undefined) continue; // e.g. a bare `undefined` record
      out.push(s);
    } catch {
      // circular / unserializable — skip, never throw
    }
  }
  return out.length ? out.join('\n') + '\n' : '';
}

// Dedupe records preserving the FIRST occurrence. keyFn maps a record to a string key;
// defaults to the compact JSON of the record. Soft-fails per record.
export function dedupe(records, keyFn) {
  if (!Array.isArray(records)) return [];
  const fn = typeof keyFn === 'function'
    ? keyFn
    : (r) => { try { return JSON.stringify(r); } catch { return String(r); } };
  const seen = new Set();
  const out = [];
  for (const r of records) {
    let key;
    try { key = String(fn(r)); } catch { key = String(r); }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// Validate a JSONL text blob. requiredKeys: array of keys every record (object) must have.
// Returns { ok, count, errors, missingKeyLines }. Never throws.
export function validate(text, { requiredKeys = [] } = {}) {
  const { records, errors } = parseLines(text);
  const missingKeyLines = [];
  if (Array.isArray(requiredKeys) && requiredKeys.length) {
    // Re-walk non-blank lines so we can report the correct source line numbers.
    const lines = normalize(text).split('\n');
    let recIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trim() === '') continue;
      // Was this line a parse error? If so it's already in errors; skip key-checking it.
      if (errors.some(e => e.line === i + 1)) continue;
      const rec = records[recIdx++];
      const obj = (rec && typeof rec === 'object' && !Array.isArray(rec)) ? rec : null;
      const missing = obj
        ? requiredKeys.filter(k => !Object.prototype.hasOwnProperty.call(obj, k))
        : requiredKeys.slice();
      if (missing.length) missingKeyLines.push({ line: i + 1, missing });
    }
  }
  const ok = errors.length === 0 && missingKeyLines.length === 0;
  return { ok, count: records.length, errors, missingKeyLines };
}

// ---- CLI: validate a fixture and print a one-screen summary. Read-only. ----
function summarize(text, requiredKeys) {
  const res = validate(text, { requiredKeys });
  const lines = [];
  lines.push(`records:    ${res.count}`);
  lines.push(`parse errors: ${res.errors.length}`);
  lines.push(`missing-key lines: ${res.missingKeyLines.length}`);
  lines.push(`ok: ${res.ok}`);
  for (const e of res.errors.slice(0, 10)) lines.push(`  L${e.line}: ${e.message}`);
  for (const m of res.missingKeyLines.slice(0, 10)) lines.push(`  L${m.line}: missing ${m.missing.join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fixture = process.argv[2];
  let text;
  if (fixture) {
    try { text = fs.readFileSync(fixture, 'utf8'); }
    catch (e) { console.error(`could not read fixture: ${e && e.message}`); process.exit(0); }
  } else {
    // built-in demo fixture: 2 good lines, 1 blank, 1 malformed, 1 missing a required key
    text = '﻿{"id":1,"text":"hello"}\r\n\r\n{"id":2,"text":"world"}\nnot json\n{"id":3}\n';
  }
  console.log(summarize(text, ['id', 'text']));
}
