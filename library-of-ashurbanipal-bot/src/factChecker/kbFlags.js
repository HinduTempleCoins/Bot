// kbFlags.js — the fact-checker's OWN advisory KB-flag store (#104), with a flag LIFECYCLE.
//
// ───────────────────────────────────────────────────────────────────────────────────────────────
// HARD MEMORY RULE (load-bearing, project invariant — see CLAUDE.md):
//   The fact-checker FLAGS ONLY. It NEVER edits, rewrites, or deletes any file under knowledge/**.
//   Every flag is ADVISORY — a marker that "this KB statement MAY be wrong" — written into THIS
//   module's own store for OPERATOR REVIEW. Nothing here ever touches the source document the flag
//   is about (`kbPath`); we record the path as a STRING, we never open or write it.
//
//   Verdicts are FALLIBLE. False positives are EXPECTED (it once mislabeled VKFRI, a private research
//   group, as something externally notable). A flag is a question for a human, never a correction.
//
//   By construction: the ONLY path this module ever writes to is the flag store (default
//   data/kb-flags.jsonl, override via the injected `storePath`). It has NO code path that opens
//   `kbPath` for writing. assertNeverWritesKb() (and the test) enforce this.
// ───────────────────────────────────────────────────────────────────────────────────────────────
//
// This sits ALONGSIDE flags.js (the older byFile/byTopic store). This one gives each flag a stable
// id and a status lifecycle — open → reviewed | dismissed — so the operator can triage and the brief
// writers only ever see OPEN flags. It is the #123 briefWarningFor() handoff shape.
//
// Store format: APPEND-ONLY-ish JSONL. raiseFlag() and resolveFlag() each append ONE line; the
// current state of a flag is the LAST line carrying its id (so a resolve is a new line, not an edit).
// The history is therefore never rewritten — you can replay the file to see how a flag evolved.
//
// Everything is injectable for OFFLINE tests: pass your own `fs` (needs mkdirSync/appendFileSync/
// readFileSync), `clock` (() => ISO string), `idGen`, and `storePath`. Defaults use real fs + a real
// clock + the env-pointed store, so production callers `import { kbFlags } from './kbFlags.js'`.
//
//   import { createKbFlagStore, kbFlags } from './kbFlags.js'
//   kbFlags.raiseFlag({ kbPath: 'knowledge/x.json', statement: '…', reason: '…', confidence: 0.7 });
//   kbFlags.briefWarnings();   // ⚠ lines for the brief writers (open flags only)

import fsReal from 'fs';
import pathReal from 'path';
import { fileURLToPath } from 'url';

const __dir = pathReal.dirname(fileURLToPath(import.meta.url));

/** Default store path. Honours KB_FLAG_JSONL so tests/prod agree on one file. */
export function defaultStorePath() {
  return process.env.KB_FLAG_JSONL || pathReal.join(__dir, '..', '..', 'data', 'kb-flags.jsonl');
}

const VALID_STATUS = new Set(['open', 'reviewed', 'dismissed']);

/** A flag whose kbPath points anywhere under knowledge/ is FINE to record (that's the whole point —
 *  flagging KB docs). What's forbidden is WRITING to that path. This guard exists so the invariant is
 *  legible in code: there is exactly one writable target, the store, and it is never under knowledge/. */
function assertStoreNotInKnowledge(storePath) {
  if (/(^|[\\/])knowledge[\\/]/.test(String(storePath))) {
    // soft-fail philosophy elsewhere, but THIS is a safety invariant — refuse loudly.
    throw new Error(`kbFlags: refusing to use a flag store under knowledge/ (${storePath}). The fact-checker flags only; it never writes to the KB.`);
  }
}

/**
 * Build a flag store bound to an injectable fs/clock/idGen/storePath. All persistence goes through
 * the one `storePath`; the KB source files are never opened for writing anywhere in here.
 */
export function createKbFlagStore({
  fs = fsReal,
  storePath = defaultStorePath(),
  clock = () => new Date().toISOString(),
  idGen,
} = {}) {
  assertStoreNotInKnowledge(storePath);

  let seq = 0;
  const nextId = idGen || (() => `flag_${Date.now().toString(36)}_${(seq++).toString(36)}`);

  // ── persistence (the ONLY writes this module performs; target is always `storePath`) ──
  function appendLine(rec) {
    try {
      fs.mkdirSync(pathReal.dirname(storePath), { recursive: true });
      fs.appendFileSync(storePath, JSON.stringify(rec) + '\n'); // append-only — never truncates
      return true;
    } catch {
      return false; // soft-fail: a flag-store write must never crash the fact-check pass
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

  /** Collapse the append-only log to current flag state: last line per id wins. */
  function currentFlags() {
    const byId = new Map();
    for (const rec of readLines()) {
      if (!rec || !rec.id) continue;
      const prev = byId.get(rec.id) || {};
      byId.set(rec.id, { ...prev, ...rec });    // later line overrides earlier fields
    }
    return [...byId.values()];
  }

  // ── public API ──

  /**
   * Record an ADVISORY flag ("this KB statement MAY be inaccurate"). Returns the stored flag.
   * NEVER touches `kbPath`'s file — kbPath is stored as a reference string only.
   *
   * @param {object} a
   * @param {string} a.kbPath           the KB document the statement came from (reference only)
   * @param {string} a.statement        the suspect statement, verbatim
   * @param {string} [a.reason]         why it was flagged (the verdict's one-line reason)
   * @param {number} [a.confidence]     0..1 — how confident the (fallible) checker is it's wrong
   * @param {string} [a.suggestedSource] a URL/citation the operator can check against
   * @param {string} [a.at]            ISO timestamp (defaults to clock())
   */
  function raiseFlag({ kbPath, statement, reason = '', confidence, suggestedSource = '', at } = {}) {
    const flag = {
      id: nextId(),
      kbPath: String(kbPath || 'unknown'),     // reference string — never opened/written
      statement: String(statement || ''),
      reason: String(reason || ''),
      confidence: typeof confidence === 'number' ? confidence : null,
      suggestedSource: String(suggestedSource || ''),
      status: 'open',                            // advisory; awaits operator review
      advisory: true,                            // explicit: this is a marker, not a correction
      raisedAt: at || clock(),
    };
    appendLine(flag);                            // soft-fails internally; flag object still returned
    return flag;
  }

  /**
   * List flags, newest-collapsed-state first-applied. Filters are optional.
   * @param {object} [f]
   * @param {string} [f.status]        'open' | 'reviewed' | 'dismissed'
   * @param {string} [f.kbPath]        exact KB path match
   * @param {number} [f.minConfidence] keep flags with confidence >= this (null-confidence kept only if 0)
   */
  function listFlags({ status, kbPath, minConfidence } = {}) {
    let flags = currentFlags();
    if (status) flags = flags.filter((x) => x.status === status);
    if (kbPath) flags = flags.filter((x) => x.kbPath === kbPath);
    if (typeof minConfidence === 'number') {
      flags = flags.filter((x) => (typeof x.confidence === 'number' ? x.confidence : 0) >= minConfidence);
    }
    return flags;
  }

  /**
   * Operator action: set a flag's status (reviewed/dismissed) WITHIN THE STORE ONLY. Appends a new
   * line carrying the same id + the new status; the KB is never touched. Returns the updated flag, or
   * null if no such id / the requested status is invalid.
   *
   * @param {string} id
   * @param {object} [a]
   * @param {string} [a.status='reviewed'] 'reviewed' | 'dismissed' (operator may also reopen → 'open')
   * @param {string} [a.note]              operator note recorded with the resolution
   */
  function resolveFlag(id, { status = 'reviewed', note = '' } = {}) {
    if (!VALID_STATUS.has(status)) return null;
    const existing = currentFlags().find((x) => x.id === id);
    if (!existing) return null;
    const updated = {
      ...existing,
      status,
      note: String(note || existing.note || ''),
      resolvedAt: clock(),
    };
    appendLine(updated);                         // store-only mutation, append-only
    return updated;
  }

  /**
   * Brief-ready warning lines for the brief writers (#123 handoff). ONLY open flags, sorted by
   * confidence DESC (most-likely-wrong first). Each line says, in plain terms, that the KB statement
   * MAY be inaccurate and is advisory — never asserting it IS wrong.
   * @returns {string[]}
   */
  function briefWarnings() {
    return listFlags({ status: 'open' })
      .sort((a, b) => ((b.confidence ?? 0) - (a.confidence ?? 0)))
      .map((f) => {
        const conf = typeof f.confidence === 'number' ? ` (confidence ${f.confidence.toFixed(2)})` : '';
        const why = f.reason ? `: ${f.reason}` : '';
        const src = f.suggestedSource ? ` — check: ${f.suggestedSource}` : '';
        const stmt = f.statement ? ` “${f.statement}”` : '';
        // ADVISORY wording: "may be inaccurate", not "is wrong". This is a review prompt, not a verdict.
        return `⚠ KB statement in ${f.kbPath} may be inaccurate${why}${stmt}${conf}${src} [advisory — fact-checker verdicts are fallible; verify before acting]`;
      });
  }

  /** Counts by status: { open, reviewed, dismissed, total }. */
  function flagStats() {
    const out = { open: 0, reviewed: 0, dismissed: 0, total: 0 };
    for (const f of currentFlags()) {
      out.total += 1;
      if (out[f.status] != null) out[f.status] += 1;
    }
    return out;
  }

  /**
   * By-construction self-check of the invariant: this store's only write target is `storePath`, which
   * is NOT under knowledge/. Returns true; throws if somehow misconfigured. (The test also asserts,
   * structurally, that the injected fs only ever saw `storePath` as a write target.)
   */
  function assertNeverWritesKb() {
    assertStoreNotInKnowledge(storePath);
    return true;
  }

  return {
    raiseFlag,
    listFlags,
    resolveFlag,
    briefWarnings,
    flagStats,
    assertNeverWritesKb,
    storePath,
    // exposed for diagnostics / tests
    _readLines: readLines,
    _currentFlags: currentFlags,
  };
}

/** Default singleton bound to real fs + real clock + the env-pointed store. Production import. */
export const kbFlags = createKbFlagStore();

// CLI: inspect the store (open flags / stats / brief warnings). Read-only — never edits the KB.
if (process.argv[1] && process.argv[1].endsWith('kbFlags.js')) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'warnings') console.log(kbFlags.briefWarnings().join('\n') || '(no open flags)');
  else if (cmd === 'stats') console.log(JSON.stringify(kbFlags.flagStats(), null, 2));
  else console.log(JSON.stringify(kbFlags.listFlags({ status: 'open' }), null, 2));
}
