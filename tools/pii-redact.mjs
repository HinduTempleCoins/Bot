// pii-redact.mjs — PII redaction / anonymizer. Pure regex, no IO, no network, no LLM.
// The public-safe scrubbing core of the "Anonymize sensitive information" itinerary item:
// run corpus / training-set text through here before it is shared, so emails, phones,
// SSNs, card numbers, IPs, chain addresses and key-shaped strings are swapped for stable
// tokens like [EMAIL], [PHONE], [KEY].
//
//   import { redact, findPii, counts, redactRecord, PATTERNS, esc } from './pii-redact.mjs'
//   node tools/pii-redact.mjs <file>            # or: cat file | node tools/pii-redact.mjs
//   node tools/pii-redact.mjs <file> --keep email,ipv4 --hash
//
// redact(text, { keep=[], hashTags=false }) -> text with matches -> tokens
//   keep:     array of category names to leave untouched
//   hashTags: append a short deterministic FNV suffix so distinct values stay
//             distinguishable but non-reversible, e.g. [EMAIL_a1b2]
// findPii(text)            -> [{ type, match, index }]  (read-only scan, no mutation)
// counts(text)            -> { email:n, phone:n, ... }
// redactRecord(obj, fields=null) -> deep-cloned object, string fields redacted
//
// Soft-fail: null / non-string input -> '' (redact) or [] / {} (scans). Never throws.
// NOTE: the key-shaped detection here exists ONLY to SCRUB such strings out of corpus
// text. This module never generates, derives, validates, or stores any key material.

import fs from 'node:fs';

// HTML-escape any value that might be interpolated into markup downstream. House rule.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Patterns --------------------------------------------------------------
// Order matters: more specific / longer matches run first so a credit-card or a
// long hex key is not partially eaten by a looser pattern. Each is global.
// `token` is the replacement label; `g` is freshly cloned per scan to avoid
// lastIndex state leaking between calls.
const _DEFS = [
  // email: local@domain.tld
  { type: 'email', token: 'EMAIL',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // ethAddress: 0x + 40 hex
  { type: 'ethAddress', token: 'ETH',
    re: /\b0x[a-fA-F0-9]{40}\b/g },
  // longHexKey: 64+ hex chars (e.g. a raw private/public hex key). Scrub-only.
  { type: 'longHexKey', token: 'KEY',
    re: /\b[a-fA-F0-9]{64,}\b/g },
  // wifKey-shaped: base58-ish 50-52 char run starting 5/K/L (WIF placeholder shape).
  // Detection-for-scrubbing only — never validated as a real key.
  { type: 'wifKey', token: 'KEY',
    re: /\b[5KL][1-9A-HJ-NP-Za-km-z]{49,51}\b/g },
  // btcAddress: legacy 1/3 (25-34 base58) or bech32 bc1...
  { type: 'btcAddress', token: 'BTC',
    re: /\b(?:bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})\b/g },
  // creditCard: 13-16 digits, optional space/dash groups
  { type: 'creditCard', token: 'CARD',
    re: /\b(?:\d[ -]?){13,16}\b/g },
  // ssn: 3-2-4
  { type: 'ssn', token: 'SSN',
    re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // ipv4: dotted quad
  { type: 'ipv4', token: 'IP',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  // phone: international-ish, 7+ digits with separators
  { type: 'phone', token: 'PHONE',
    re: /(?:\+?\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{2,4}[ .-]?\d{3,4}[ .-]?\d{3,4}\b/g },
];

// Public frozen named-regex registry (fresh-cloned, non-global copies for inspection).
export const PATTERNS = Object.freeze(
  Object.fromEntries(_DEFS.map((d) => [d.type, new RegExp(d.re.source)]))
);

// FNV-1a 32-bit -> 4 lowercase hex chars. Deterministic, non-secret, non-reversible
// (truncated). Used only to keep distinct redacted values distinguishable when asked.
function fnvTag(s) {
  let h = 0x811c9dc5;
  const str = String(s == null ? '' : s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 4);
}

// internal: walk patterns, yield non-overlapping matches earliest-first.
// We scan each pattern independently, collect {start,end,...}, then resolve
// overlaps by keeping the earliest start (ties: longest match wins).
function scan(text, keep) {
  const skip = new Set(Array.isArray(keep) ? keep : []);
  const hits = [];
  for (const d of _DEFS) {
    if (skip.has(d.type)) continue;
    const re = new RegExp(d.re.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const match = m[0];
      if (!match) { re.lastIndex++; continue; } // guard zero-width
      hits.push({ type: d.type, token: d.token, match, start: m.index, end: m.index + match.length });
    }
  }
  hits.sort((a, b) => (a.start - b.start) || (b.end - a.end));
  const out = [];
  let cursor = -1;
  for (const h of hits) {
    if (h.start < cursor) continue; // overlapping a kept earlier match
    out.push(h);
    cursor = h.end;
  }
  return out;
}

// findPii(text) -> read-only array of { type, match, index }. No mutation.
export function findPii(text) {
  if (typeof text !== 'string' || !text) return [];
  return scan(text, []).map((h) => ({ type: h.type, match: h.match, index: h.start }));
}

// counts(text) -> { email:0, phone:0, ... } for every category, populated by findPii.
export function counts(text) {
  const out = {};
  for (const d of _DEFS) out[d.type] = 0;
  for (const h of findPii(text)) out[h.type] = (out[h.type] || 0) + 1;
  return out;
}

// redact(text, opts) -> text with matches replaced by [TOKEN] (or [TOKEN_tag]).
export function redact(text, opts = {}) {
  if (typeof text !== 'string' || !text) return '';
  const o = opts && typeof opts === 'object' ? opts : {};
  const hits = scan(text, o.keep);
  if (!hits.length) return text;
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    out += text.slice(cursor, h.start);
    const tag = o.hashTags ? `_${fnvTag(h.match)}` : '';
    out += `[${h.token}${tag}]`;
    cursor = h.end;
  }
  out += text.slice(cursor);
  return out;
}

// redactRecord(obj, fields=null) -> deep-cloned object with string fields redacted.
// fields=null redacts ALL string leaves; an array limits redaction to those top-level
// field names. Arrays / nested objects are recursed. Non-objects soft-fail to {}.
export function redactRecord(obj, fields = null, opts = {}) {
  const limit = Array.isArray(fields) ? new Set(fields) : null;
  function walk(val, key) {
    if (typeof val === 'string') {
      if (limit && key != null && !limit.has(key)) return val;
      return redact(val, opts);
    }
    if (Array.isArray(val)) return val.map((v) => walk(v, key));
    if (val && typeof val === 'object') {
      const o = {};
      for (const k of Object.keys(val)) {
        // at the top level, honor the field filter by key name; deeper, filter by leaf key
        o[k] = limit ? walk(val[k], k) : walk(val[k], null);
      }
      return o;
    }
    return val; // numbers, booleans, null, undefined pass through
  }
  if (obj == null || typeof obj !== 'object') return {};
  return walk(obj, null);
}

// --- CLI (guarded) ---------------------------------------------------------
let _read = (p) => fs.readFileSync(p, 'utf8');
export function __setReader(fn) { _read = fn || ((p) => fs.readFileSync(p, 'utf8')); }

function parseArgs(argv) {
  const o = { file: null, keep: [], hashTags: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') o.keep = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--hash') o.hashTags = true;
    else if (!a.startsWith('--') && o.file == null) o.file = a;
  }
  return o;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

export function runCli(argv, read = _read, stdin = readStdin) {
  const o = parseArgs(argv);
  let text = '';
  if (o.file) { try { text = read(o.file); } catch { text = ''; } }
  else { text = stdin(); }
  return redact(text, { keep: o.keep, hashTags: o.hashTags });
}

if (process.argv[1] && process.argv[1].endsWith('pii-redact.mjs')) {
  process.stdout.write(runCli(process.argv.slice(2)));
}
