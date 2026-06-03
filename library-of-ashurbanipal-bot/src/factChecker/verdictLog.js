// verdictLog.js — the APPEND-ONLY audit log of every claim+verdict the fact-checker produces (#101).
//
// This is the permanent record: one JSONL line per checked claim, NEVER overwritten, only appended.
// It is the forensic trail behind the (mutable, healing) KB-flag store — flags can be cleared when a
// re-check heals a claim, but the log keeps the full history of what was checked and when. Brief
// writers and the operator can replay it to see how a verdict evolved.
//
// HARD project rule: the fact-checker FLAGS only — it NEVER edits the KB / knowledge source files.
// This module is the fact-checker's OWN append-only store, advisory for operator review. It writes
// ONLY to the log file (data/factcheck-log.jsonl by default) and never touches the KB.
//
// Append-only guarantee: every write opens the file in APPEND mode ('a') and emits exactly one line.
// No code path here reads-modifies-rewrites the file, so an earlier entry can never change. Each
// entry also carries a content hash + a monotonic seq so tampering or reordering is detectable on read.
//
// Spec API (#101):                       Legacy API (kept for index.js + older tests):
//   recordVerdict({...}) → entry           logVerdict(rec, file?) → record
//   readLog({since,articleId,verdict})     readLog(filePathString)        (overload)
//   verdictStats()                         logTallyForFile(file, log?)
//                                          logForFile(file, log?)
//
//   import { recordVerdict, readLog, verdictStats } from './verdictLog.js'

import nodeFs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/** The verdict-log path. Honours FACTCHECK_LOG so index.js and the log module agree on one file. */
export function logPath() {
  return process.env.FACTCHECK_LOG || path.join(__dir, '..', '..', 'data', 'factcheck-log.jsonl');
}

// ── injectable fs + clock so tests run fully offline / deterministically ──────────────────────────
// Tests pass their own { fs, now } (e.g. an in-memory fs) so nothing hits the real disk or wall clock.
// Default to the real node fs + Date.now()/ISO so production callers need pass nothing.
function defaultFs(fsImpl) {
  return fsImpl || nodeFs;
}
function defaultNowISO(now) {
  if (typeof now === 'function') return now();        // injected clock → its return value
  if (now != null) return now;                        // injected literal timestamp
  return new Date().toISOString();
}

/** Stable content hash over the meaningful fields — lets a reader detect a mutated/tampered line. */
function hashEntry(e) {
  const basis = JSON.stringify([
    e.seq, e.claim, e.verdict, e.confidence, e.articleId, e.sources, e.at,
  ]);
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

/** Count existing lines in the log → next monotonic seq. Read-only; tolerant of a missing file. */
function nextSeq(fs, file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return 1; }
  let n = 0;
  for (const line of raw.split('\n')) if (line.trim()) n++;
  return n + 1;
}

/** Parse the whole log into records, skipping corrupt lines. Empty array if absent. Read-only. */
function parseAll(fs, file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip a corrupt line, keep the rest (corrupt-tolerant) */ }
  }
  return out;
}

/**
 * Spec API (#101). Append ONE immutable claim+verdict entry to the audit log and return it.
 *
 * Append-only: the file is opened in append mode and a single JSONL line is written; existing lines
 * are never read for rewriting, never truncated, never removed. The returned entry carries a monotonic
 * `seq` and a content `hash` so any later mutation of an earlier line is detectable.
 *
 * @param {object}   p
 * @param {string}   p.claim       the claim text that was checked
 * @param {string}   p.verdict     SUPPORTED | CONTRADICTED | UNVERIFIABLE | UNCERTAIN (free-form ok)
 * @param {number}   [p.confidence]  0..1
 * @param {string[]} [p.sources]   evidence URLs the verdict rested on
 * @param {string}   [p.articleId] the article/KB-file the claim came from
 * @param {string}   [p.at]        ISO timestamp (else the injected/real clock)
 * @param {object}   [opts]
 * @param {string}   [opts.file]   log path (defaults to logPath())
 * @param {object}   [opts.fs]     injected fs (defaults to node fs) — must expose readFileSync/appendFileSync/mkdirSync
 * @param {function|string} [opts.now]  injected clock (fn → called, or a literal ISO string)
 * @returns {object} the exact immutable entry persisted
 */
export function recordVerdict(p = {}, opts = {}) {
  const fs = defaultFs(opts.fs);
  const file = opts.file || logPath();
  const seq = nextSeq(fs, file);
  const entry = {
    seq,                                               // monotonic, 1-based
    claim: p.claim ?? '',
    verdict: p.verdict ?? 'UNVERIFIABLE',
    confidence: typeof p.confidence === 'number' ? p.confidence : null,
    sources: Array.isArray(p.sources) ? p.sources : (p.sources ? [p.sources] : []),
    articleId: p.articleId ?? '',
    at: p.at ?? defaultNowISO(opts.now),
  };
  entry.hash = hashEntry(entry);                        // content hash over the fields above
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* soft-fail: dir may exist / fs may be flat */ }
  fs.appendFileSync(file, JSON.stringify(entry) + '\n'); // APPEND ONLY — never truncates an earlier line
  return entry;
}

/**
 * Read past entries. Two shapes (overloaded for back-compat):
 *
 *   readLog('/path/to/log.jsonl')              → legacy: every record from that file (array)
 *   readLog({ file, fs, since, articleId, verdict })  → spec: filtered read
 *
 * Filters (all optional, ANDed): `since` (ISO/Date — keep entries with at >= since),
 * `articleId` (exact match), `verdict` (exact match, case-insensitive). Read-only; never writes.
 * Corrupt lines are skipped, not thrown.
 */
export function readLog(arg = {}) {
  // legacy overload: a bare path string
  if (typeof arg === 'string') return parseAll(nodeFs, arg);
  const { file = logPath(), fs, since, articleId, verdict } = arg || {};
  let recs = parseAll(defaultFs(fs), file);
  if (since != null) {
    const t = since instanceof Date ? since.getTime() : Date.parse(since);
    if (!Number.isNaN(t)) recs = recs.filter((r) => { const rt = Date.parse(r.at ?? r.checkedAt); return !Number.isNaN(rt) && rt >= t; });
  }
  if (articleId != null) recs = recs.filter((r) => (r.articleId ?? r.article) === articleId);
  if (verdict != null) { const v = String(verdict).toUpperCase(); recs = recs.filter((r) => String(r.verdict).toUpperCase() === v); }
  return recs;
}

/**
 * Counts by verdict across the whole log: { SUPPORTED, CONTRADICTED, UNVERIFIABLE, UNCERTAIN, ... }.
 * Verdict keys are normalised to upper-case. Read-only.
 * @param {object} [opts]  { file, fs }
 */
export function verdictStats(opts = {}) {
  const fs = defaultFs(opts.fs);
  const file = opts.file || logPath();
  return parseAll(fs, file).reduce((a, r) => {
    const k = String(r.verdict ?? 'UNKNOWN').toUpperCase();
    a[k] = (a[k] || 0) + 1;
    return a;
  }, {});
}

// ── legacy API kept verbatim-compatible for index.js + the existing factChecker.test.js ───────────
// index.js imports { logVerdict }; factChecker.test.js imports { logVerdict, readLog, logTallyForFile }
// and calls readLog(pathString) / logTallyForFile(file, recs). These keep their old shapes.

/**
 * Legacy append. Same append-only guarantee. Kept so index.js (the orchestrator) is untouched.
 * Records carry the original {article, topic, claim, file, sourceRef, verdict, ...} shape.
 */
export function logVerdict(rec, file = logPath()) {
  const out = {
    article: rec.article ?? '',
    topic: rec.topic ?? '',
    claim: rec.claim ?? '',
    file: rec.file ?? rec.sourceRef ?? '',
    sourceRef: rec.sourceRef ?? rec.file ?? '',
    verdict: rec.verdict ?? 'UNVERIFIABLE',
    confidence: typeof rec.confidence === 'number' ? rec.confidence : null,
    reason: rec.reason ?? '',
    source: rec.source ?? '',
    evidence_urls: Array.isArray(rec.evidence_urls) ? rec.evidence_urls : [],
    evidence_fetched: rec.evidence_fetched ?? 0,
    checkedAt: rec.checkedAt ?? new Date().toISOString(),
  };
  nodeFs.mkdirSync(path.dirname(file), { recursive: true });
  nodeFs.appendFileSync(file, JSON.stringify(out) + '\n');   // append-only — never truncates
  return out;
}

/** Verdict tally ({SUPPORTED:n, ...}) for a given KB source file, computed from the log. */
export function logTallyForFile(file, log = readLog(logPath())) {
  return log.filter((r) => r.file === file || r.sourceRef === file)
    .reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
}

/** All log records for one KB source file (newest last, as appended). */
export function logForFile(file, log = readLog(logPath())) {
  return log.filter((r) => r.file === file || r.sourceRef === file);
}

if (process.argv[1] && process.argv[1].endsWith('verdictLog.js')) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'file') console.log(JSON.stringify({ tally: logTallyForFile(arg), records: logForFile(arg) }, null, 2));
  else if (cmd === 'stats') console.log(JSON.stringify(verdictStats(), null, 2));
  else { const log = readLog(logPath()); console.log(`${log.length} verdict records in ${logPath()}`); }
}
