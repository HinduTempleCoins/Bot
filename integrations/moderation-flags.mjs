// moderation-flags.mjs — the condenser's REAL flag/report store (Task #300).
//
// WHY THIS EXISTS
//   The condenser front-end (alpha.melek.salon) needs a "Report this" / "Flag" control that goes
//   somewhere REAL — an append-only queue the moderation layer reads — not a console.log or a
//   browser alert() that evaporates. This is that store. The POST /api/report route in
//   signup/server.mjs writes through here; a moderator (or Hathor's resolution flow, POLICY.md §7)
//   reads the open queue and resolves entries.
//
// POLICY (POLICY.md, load-bearing)
//   • A report is NOT a delete button and NOT a punishment button (§1, §6, §9). It is a marker that
//     "this content/account may need a human's attention". Resolution is evidenced and recorded with
//     a reason; wrongful flags can be dismissed (§7 right-of-reply). False/mass reporting is itself a
//     violation (§1), so the route caps abuse before a flag lands here.
//   • On an append-only chain, "removal" is condenser-side hiding, never on-chain deletion (§1). This
//     store records the *report*; it never touches chain content.
//
// STORE FORMAT — append-only JSONL (mirrors library-of-ashurbanipal kbFlags.js):
//   raiseReport() and resolveReport() each append ONE line. The current state of a report is the LAST
//   line carrying its id (a resolve is a new line, not an edit), so the history is never rewritten —
//   replay the file to see how a report evolved. The default store path matches `*.jsonl` in
//   .gitignore, so it is per-deployment runtime data and never committed.
//
// CUSTODY / SAFETY
//   • Zero keys, zero broadcast, zero chain writes. The only path this module writes is the store.
//   • Reporter identity is recorded as a short opaque string (account name or a hash the caller
//     passes); we never store IPs or PII here — the route does its own rate-limiting upstream.
//   • Everything is injectable for OFFLINE tests: pass your own `fs` (needs mkdirSync/appendFileSync/
//     readFileSync), `clock` (() => ISO string), `idGen`, and `storePath`.
//
//   import { createModerationStore, moderationFlags } from '../integrations/moderation-flags.mjs';
//   moderationFlags.raiseReport({ target: '@alice/some-post', kind: 'spam', reason: '…', reporter: 'bob' });
//   moderationFlags.queueForModeration();   // open reports for the moderation layer

import fsReal from 'node:fs';
import pathReal from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = pathReal.dirname(fileURLToPath(import.meta.url));

/** Default store path. Honours MODERATION_FLAGS_JSONL so the route + a CLI reader agree on one file. */
export function defaultStorePath() {
  return process.env.MODERATION_FLAGS_JSONL || pathReal.join(__dir, '.moderation-flags.jsonl');
}

// The report categories the condenser UI offers. Anything else is coerced to 'other' (we never reject
// a report for an odd category — that would lose a signal — we just normalise it).
export const REPORT_KINDS = ['spam', 'abuse', 'scam', 'impersonation', 'illegal', 'other'];
export function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  return REPORT_KINDS.includes(k) ? k : 'other';
}

const VALID_STATUS = new Set(['open', 'reviewed', 'dismissed', 'actioned']);
const MAX_FIELD = 2000; // hard cap any free-text field so a report can't bloat the store

function cap(s, n = MAX_FIELD) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) : str;
}

/**
 * Build a moderation store bound to an injectable fs/clock/idGen/storePath. All persistence goes
 * through the one `storePath`; nothing else is ever opened for writing.
 */
export function createModerationStore({
  fs = fsReal,
  storePath = defaultStorePath(),
  clock = () => new Date().toISOString(),
  idGen,
} = {}) {
  let seq = 0;
  const nextId = idGen || (() => `mod_${Date.now().toString(36)}_${(seq++).toString(36)}`);

  // ── persistence (the ONLY writes this module performs) ──
  function appendLine(rec) {
    try {
      fs.mkdirSync(pathReal.dirname(storePath), { recursive: true });
      fs.appendFileSync(storePath, JSON.stringify(rec) + '\n'); // append-only — never truncates
      return true;
    } catch {
      return false; // soft-fail: a report write must never crash the request handler
    }
  }

  /** Read every JSONL line (skips corrupt lines). Empty array if the store is absent. */
  function readLines() {
    let raw;
    try { raw = fs.readFileSync(storePath, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of String(raw).split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch { /* skip a corrupt line, keep the rest */ }
    }
    return out;
  }

  /** Collapse the append-only log to current report state: last line per id wins. */
  function currentReports() {
    const byId = new Map();
    for (const rec of readLines()) {
      if (!rec || !rec.id) continue;
      const prev = byId.get(rec.id) || {};
      byId.set(rec.id, { ...prev, ...rec }); // later line overrides earlier fields
    }
    return [...byId.values()];
  }

  // ── dedup: the same reporter reporting the same target with the same kind, while still OPEN, is
  //    idempotent — we return the existing open report rather than stacking duplicates. This is what
  //    makes the endpoint safe to retry (network blips, double-clicks) without inflating the queue. ──
  function findOpenDuplicate({ target, kind, reporter }) {
    return currentReports().find((r) =>
      r.status === 'open' &&
      r.target === target &&
      r.kind === kind &&
      (r.reporter || '') === (reporter || ''),
    ) || null;
  }

  // ── public API ──

  /**
   * Record a content/account report. Returns { report, deduped }.
   *   - `target`   REQUIRED: what's being reported (e.g. '@author/permlink' or '@account'). Capped.
   *   - `kind`     normalized to one of REPORT_KINDS (defaults 'other').
   *   - `reason`   optional free text from the reporter. Capped.
   *   - `reporter` optional opaque reporter id (account name / hash). NOT an IP, NOT PII.
   *   - `context`  optional small object the UI passes (e.g. { url }). Stringified + capped.
   * Idempotent: a still-open identical (reporter,target,kind) report is returned with deduped:true.
   */
  function raiseReport({ target, kind, reason = '', reporter = '', context, at } = {}) {
    const cleanTarget = cap(target);
    if (!cleanTarget) return { report: null, deduped: false, error: 'missing-target' };
    const cleanKind = normalizeKind(kind);
    const cleanReporter = cap(reporter, 64);

    const dup = findOpenDuplicate({ target: cleanTarget, kind: cleanKind, reporter: cleanReporter });
    if (dup) return { report: dup, deduped: true };

    const report = {
      id: nextId(),
      target: cleanTarget,
      kind: cleanKind,
      reason: cap(reason),
      reporter: cleanReporter,
      context: context != null ? cap(typeof context === 'string' ? context : JSON.stringify(context)) : '',
      status: 'open',         // awaits a human / Hathor's resolution flow (POLICY.md §7)
      raisedAt: at || clock(),
    };
    appendLine(report);       // soft-fails internally; report object still returned
    return { report, deduped: false };
  }

  /**
   * List reports, optionally filtered. Newest collapsed-state.
   * @param {object} [f] { status, target, kind }
   */
  function listReports({ status, target, kind } = {}) {
    let reports = currentReports();
    if (status) reports = reports.filter((r) => r.status === status);
    if (target) reports = reports.filter((r) => r.target === target);
    if (kind) reports = reports.filter((r) => r.kind === normalizeKind(kind));
    return reports;
  }

  /**
   * Moderator / Hathor action: set a report's status. Appends a new line carrying the same id + the
   * new status + an evidenced reason (POLICY.md §7: corrections are recorded with their reasoning).
   * Returns the updated report, or null if no such id / invalid status.
   *   status: 'reviewed' | 'dismissed' | 'actioned' | 'open' (reopen)
   */
  function resolveReport(id, { status = 'reviewed', note = '', by = '' } = {}) {
    if (!VALID_STATUS.has(status)) return null;
    const existing = currentReports().find((r) => r.id === id);
    if (!existing) return null;
    const updated = {
      ...existing,
      status,
      note: cap(note || existing.note || ''),
      resolvedBy: cap(by, 64),
      resolvedAt: clock(),
    };
    appendLine(updated); // store-only mutation, append-only
    return updated;
  }

  /** The open queue the moderation layer reads — oldest first (FIFO triage). */
  function queueForModeration() {
    return listReports({ status: 'open' })
      .sort((a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt)));
  }

  /** Counts by status: { open, reviewed, dismissed, actioned, total }. */
  function stats() {
    const out = { open: 0, reviewed: 0, dismissed: 0, actioned: 0, total: 0 };
    for (const r of currentReports()) {
      out.total += 1;
      if (out[r.status] != null) out[r.status] += 1;
    }
    return out;
  }

  return {
    raiseReport,
    listReports,
    resolveReport,
    queueForModeration,
    stats,
    storePath,
    // exposed for diagnostics / tests
    _readLines: readLines,
    _currentReports: currentReports,
  };
}

/** Default singleton bound to real fs + real clock + the env-pointed store. Production import. */
export const moderationFlags = createModerationStore();

// CLI: inspect the queue (open reports / stats). Read-only — never resolves anything.
if (process.argv[1] && process.argv[1].endsWith('moderation-flags.mjs')) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'stats') console.log(JSON.stringify(moderationFlags.stats(), null, 2));
  else console.log(JSON.stringify(moderationFlags.queueForModeration(), null, 2));
}
