// verdictLog.js — the APPEND-ONLY audit log of every claim+verdict the fact-checker produces (#101).
//
// This is the permanent record: one JSONL line per checked claim, NEVER overwritten, only appended.
// It is the forensic trail behind the (mutable, healing) KB-flag store — flags can be cleared when a
// re-check heals a claim, but the log keeps the full history of what was checked and when. Brief
// writers and the operator can replay it to see how a verdict evolved.
//
// It writes ONLY to the log file (data/factcheck-log.jsonl by default). It never touches the KB.
//
//   import { logVerdict, readLog, logTallyForFile } from './verdictLog.js'

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/** The verdict-log path. Honours FACTCHECK_LOG so index.js and the log module agree on one file. */
export function logPath() {
  return process.env.FACTCHECK_LOG || path.join(__dir, '..', '..', 'data', 'factcheck-log.jsonl');
}

/**
 * Append ONE claim+verdict record to the audit log. Append-only: the file is opened in append mode and
 * a single line is written; existing lines are never read, rewritten, or removed. Returns the exact
 * record persisted (so callers can assert on it in tests).
 *
 * @param {object} rec  { article, topic, claim, file, sourceRef, verdict, confidence, reason, source,
 *                        evidence_urls, evidence_fetched, checkedAt }
 * @param {string} [file] override log path (tests)
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(out) + '\n');   // append-only — never truncates
  return out;
}

/** Read the whole log back as an array of records (skips malformed lines). Empty array if absent. */
export function readLog(file = logPath()) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip a corrupt line, keep the rest */ }
  }
  return out;
}

/** Verdict tally ({SUPPORTED:n, ...}) for a given KB source file, computed from the log. */
export function logTallyForFile(file, log = readLog()) {
  return log.filter((r) => r.file === file || r.sourceRef === file)
    .reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
}

/** All log records for one KB source file (newest last, as appended). */
export function logForFile(file, log = readLog()) {
  return log.filter((r) => r.file === file || r.sourceRef === file);
}

if (process.argv[1] && process.argv[1].endsWith('verdictLog.js')) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'file') console.log(JSON.stringify({ tally: logTallyForFile(arg), records: logForFile(arg) }, null, 2));
  else { const log = readLog(); console.log(`${log.length} verdict records in ${logPath()}`); }
}
