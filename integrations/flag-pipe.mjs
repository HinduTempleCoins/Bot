// flag-pipe.mjs — ONE unified moderation pipe for ALL traditional social-media harms.
//
// WHY THIS EXISTS
//   The operator's instruction: "attach every traditional social-media harm to ONE flagging
//   system." Real platforms scatter harm-handling across a dozen detectors and a dozen queues —
//   plagiarism here, spam there, CSAM in a third silo nobody can audit. flag-pipe is the single
//   detector-agnostic SPINE: any detector (Cheetah text/image match, spamtest flood, the toxicity
//   adapter, the Ashurbanipal fact-checker, a human "Report" click, a PhotoDNA hit) calls ONE
//   function — fileFlag() — and every harm lands in ONE append-only store with ONE review queue.
//   `integrations/flag-taxonomy.mjs` knows WHICH detector finds WHAT; flag-pipe is the store that
//   WHAT lands in. The two compose: taxonomy.route() can write through a flag-pipe store.
//
// DETECTOR-AGNOSTIC
//   flag-pipe does no detection. It takes a finished {target, kind, severity, reason, reporter,
//   evidence} and records it. That is the whole point of "ONE flagging system": the pipe doesn't
//   care if the flag came from a model, a heuristic, or a human — it normalizes, dedupes, ranks,
//   and resolves uniformly.
//
// POLICY (POLICY.md / cheetah/policing.md — load-bearing)
//   • A flag is NOT a delete button and NOT a punishment button. It is "this may need attention".
//     Resolution is recorded with a reason and a `by`; nothing is auto-actioned, nothing auto-banned.
//   • Append-only & immutable: fileFlag() and resolve() each append ONE event. The current state of
//     a flag is the REPLAY of its events (last-write-wins per field). History is never rewritten.
//   • CSAM is GATED: flag-only. flag-pipe records the MARKER (target, kind='csam', reason). It NEVER
//     stores imagery, never decodes, never hashes here — the real pipeline is PhotoDNA/NCMEC
//     CyberTipline behind an institutional agreement (cheetah/policing.md). `evidence` for a csam
//     flag is force-redacted to a short non-image note so no image bytes can ride through this store.
//
// CUSTODY / SAFETY
//   • Zero keys, zero broadcast, zero chain writes. Soft-fail-never-throw: a store write that fails
//     returns an error field; it never crashes a request handler.
//   • Injectable seams for OFFLINE tests: __setStore(store) swaps the backing store (default
//     in-memory). jsonlStore({ fs, path }) is a drop-in JSONL-backed store. __setClock / __setIdGen
//     override time + id generation for deterministic tests.
//
//   import { fileFlag, reviewQueue, resolve, summary } from '../integrations/flag-pipe.mjs';
//   fileFlag({ target: '@bob/post', kind: 'spam', severity: 2, reason: 'flood', reporter: 'alice' });
//   reviewQueue({ status: 'pending' });   // pending flags, ranked most-severe first
//   resolve(id, { action: 'dismissed', by: 'hathor' });
//   summary();                            // { byKind, byStatus, total }

import fsReal from 'node:fs';
import pathReal from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = pathReal.dirname(fileURLToPath(import.meta.url));

// ── esc(): HTML-escape any value that may be rendered in a review-queue UI ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── KINDS: every traditional social-media harm, one flat vocabulary ─────────────────────────────────
export const KINDS = Object.freeze([
  'plagiarism', 'image-theft', 'spam', 'scam', 'harassment',
  'impersonation', 'misinformation', 'doxxing', 'csam', 'sybil',
]);
const KIND_SET = new Set(KINDS);

/** Categories that are GATED: flag-only, human/counsel owns them, never auto-handled, never store media. */
export const GATED_KINDS = Object.freeze(['csam']);
const GATED_SET = new Set(GATED_KINDS);
export function isGated(kind) { return GATED_SET.has(normalizeKind(kind)); }

/** Coerce a kind to a known KIND; anything unrecognized becomes 'spam' is WRONG — we keep the signal
 *  but mark it 'other'-like. We do NOT silently drop. Unknown kinds are rejected by fileFlag (returns
 *  an error) rather than mislabeled, because mis-bucketing a harm is worse than refusing the flag. */
export function normalizeKind(kind) {
  return String(kind || '').trim().toLowerCase();
}

// ── statuses + resolution actions ──────────────────────────────────────────────────────────────────
export const STATUSES = Object.freeze(['pending', 'reviewed', 'dismissed', 'actioned', 'escalated']);
const STATUS_SET = new Set(STATUSES);
// The resolution actions a reviewer / Hathor may take. None is an auto-ban — `actioned` means a human
// decided and recorded it. `escalated` is the gated path (CSAM → counsel/NCMEC, owned off-pipe).
export const RESOLVE_ACTIONS = Object.freeze(['reviewed', 'dismissed', 'actioned', 'escalated']);
const RESOLVE_SET = new Set(RESOLVE_ACTIONS);

const MAX_FIELD = 2000;
const cap = (s, n = MAX_FIELD) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, n) : x; };
const clampSeverity = (n) => { const x = Math.round(Number(n)); return Number.isFinite(x) ? Math.min(5, Math.max(1, x)) : 3; };

// CSAM evidence is force-redacted: we never let image bytes / data-URIs / long blobs into the store.
function redactGatedEvidence(kind, evidence) {
  if (!GATED_SET.has(kind)) return cap(evidence);
  return 'GATED(csam): flag-only marker recorded — no imagery stored. Real pipeline: PhotoDNA/NCMEC CyberTipline (cheetah/policing.md).';
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  BACKING STORES — append-only event logs. A store exposes: append(event) -> bool, events() -> array.
//  Default is in-memory; jsonlStore() is the injectable file-backed variant.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** In-memory append-only event log (default; perfect for tests + ephemeral runs). */
export function memoryStore() {
  const log = [];
  return {
    kind: 'memory',
    append(event) { try { log.push(event); return true; } catch { return false; } },
    events() { return log.slice(); },
    _reset() { log.length = 0; },
  };
}

/** Default JSONL store path. Honours FLAG_PIPE_JSONL so a route + a CLI reader agree on one file. */
export function defaultStorePath() {
  return process.env.FLAG_PIPE_JSONL || pathReal.join(__dir, '.flag-pipe.jsonl');
}

/**
 * JSONL-backed append-only event store. Injectable fs (needs mkdirSync/appendFileSync/readFileSync).
 * Each append writes ONE line; events() replays the whole file (skipping corrupt lines). Never edits.
 */
export function jsonlStore({ fs = fsReal, path = defaultStorePath() } = {}) {
  return {
    kind: 'jsonl',
    path,
    append(event) {
      try {
        fs.mkdirSync(pathReal.dirname(path), { recursive: true });
        fs.appendFileSync(path, JSON.stringify(event) + '\n'); // append-only — never truncates
        return true;
      } catch { return false; } // soft-fail
    },
    events() {
      let raw;
      try { raw = fs.readFileSync(path, 'utf8'); } catch { return []; }
      const out = [];
      for (const line of String(raw).split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try { out.push(JSON.parse(s)); } catch { /* skip corrupt line, keep the rest */ }
      }
      return out;
    },
  };
}

// ── injectable seams ────────────────────────────────────────────────────────────────────────────
let _store = memoryStore();
let _clock = () => new Date().toISOString();
let _seq = 0;
let _idGen = () => `flag_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

/** Swap the backing store (default in-memory). Pass jsonlStore({fs,path}) for a file-backed one. */
export function __setStore(store) { if (store && typeof store.append === 'function' && typeof store.events === 'function') _store = store; return _store; }
/** Override the clock (() => ISO string) for deterministic tests. */
export function __setClock(fn) { if (typeof fn === 'function') _clock = fn; }
/** Override id generation for deterministic tests. */
export function __setIdGen(fn) { if (typeof fn === 'function') _idGen = fn; }
/** Read the active store (diagnostics / tests). */
export function __getStore() { return _store; }

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  REPLAY — collapse the append-only event log to current flag state. Two event types:
//    { type:'flag',    id, ...fields }     — a filed flag (one per id)
//    { type:'resolve', id, ...fields }     — a resolution event (may be many; last wins per field)
//  Current state = the flag event merged with every later resolve event for the same id.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function currentFlags(store = _store) {
  const byId = new Map();
  let events = [];
  try { events = store.events() || []; } catch { events = []; }
  for (const ev of events) {
    if (!ev || !ev.id) continue;
    const prev = byId.get(ev.id) || {};
    byId.set(ev.id, { ...prev, ...ev, type: undefined }); // later event overrides earlier fields
  }
  return [...byId.values()].map((f) => { const { type, ...rest } = f; return rest; });
}

// ── dedupe key: (target, kind). A second still-pending flag on the same target+kind is idempotent —
//    we return the existing flag rather than stacking duplicates, which is what makes the pipe safe to
//    call from many detectors + retries without inflating the queue. Resolved flags do NOT block a new
//    flag (a re-offense after a dismissal is a fresh signal). ──
function findOpenDuplicate(target, kind, store = _store) {
  return currentFlags(store).find((f) =>
    f.status === 'pending' && f.target === target && f.kind === kind) || null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * File a flag. Detector-agnostic: the caller has already decided this is a harm.
 *   - target   REQUIRED: what's flagged ('@author/permlink' or '@account'). Capped.
 *   - kind     REQUIRED: one of KINDS. An unknown kind is REFUSED (returns error) — never mislabeled.
 *   - severity 1..5 (clamped; default 3).
 *   - reason   free text (capped).
 *   - reporter opaque reporter id (account name / hash / detector name). NOT an IP, NOT PII.
 *   - evidence free text (capped). For GATED kinds (csam) it is force-redacted — no imagery ever.
 * Idempotent on (target, kind) while still pending → returns the existing flag with deduped:true.
 * Soft-fail: returns { flag:null, error } rather than throwing.
 * @returns {{flag:object|null, deduped:boolean, gated?:boolean, error?:string}}
 */
export function fileFlag({ target, kind, severity, reason = '', reporter = '', evidence = '', at } = {}, opts = {}) {
  const store = opts.store || _store;
  const cleanTarget = cap(target, 256);
  if (!cleanTarget) return { flag: null, deduped: false, error: 'missing-target' };
  const cleanKind = normalizeKind(kind);
  if (!KIND_SET.has(cleanKind)) return { flag: null, deduped: false, error: `unknown-kind:${esc(cleanKind) || '(empty)'}` };

  const dup = findOpenDuplicate(cleanTarget, cleanKind, store);
  if (dup) return { flag: dup, deduped: true, gated: GATED_SET.has(cleanKind) };

  const gated = GATED_SET.has(cleanKind);
  const flag = {
    id: _idGen(),
    target: cleanTarget,
    kind: cleanKind,
    severity: clampSeverity(severity ?? defaultSeverity(cleanKind)),
    reason: cap(reason),
    reporter: cap(reporter, 64),
    evidence: redactGatedEvidence(cleanKind, evidence),
    gated,                       // gated kinds are flag-only / human+counsel; never auto-actioned
    status: 'pending',
    filedAt: at || _clock(),
  };
  const ok = store.append({ type: 'flag', ...flag });
  return { flag, deduped: false, gated, ...(ok ? {} : { error: 'store-write-failed' }) };
}

// Per-kind default severity when the caller omits one (1=lightest .. 5=gravest).
function defaultSeverity(kind) {
  return ({
    plagiarism: 2, 'image-theft': 2, spam: 2, sybil: 2,
    misinformation: 2, harassment: 3, impersonation: 3,
    doxxing: 4, scam: 4, csam: 5,
  })[kind] ?? 3;
}

/**
 * The review queue: flags filtered by status, ranked most-severe first (then oldest-first within a
 * severity — FIFO triage). Default status 'pending'. Pass status:null/'all' for everything.
 * @param {{status?:string}} [f]
 * @returns {Array<object>}
 */
export function reviewQueue({ status = 'pending', kind, target } = {}, opts = {}) {
  const store = opts.store || _store;
  let flags = currentFlags(store);
  if (status && status !== 'all') flags = flags.filter((f) => f.status === status);
  if (kind) flags = flags.filter((f) => f.kind === normalizeKind(kind));
  if (target) flags = flags.filter((f) => f.target === target);
  return flags.sort((a, b) =>
    (Number(b.severity) - Number(a.severity)) ||
    String(a.filedAt).localeCompare(String(b.filedAt)));
}

/**
 * Resolve a flag: append an immutable resolution event carrying the same id, a new status, the action,
 * a reviewer `by`, and an optional note. Append-only — the original flag event is never edited.
 *   action ∈ RESOLVE_ACTIONS ('reviewed' | 'dismissed' | 'actioned' | 'escalated').
 *   status is set from the action ('reviewed'→reviewed, etc.). Gated flags resolve like any other but
 *   the canonical gated action is 'escalated' (to a human / counsel).
 * @returns {object|null} the updated flag, or null if no such id / invalid action.
 */
export function resolve(id, { action = 'reviewed', by = '', note = '', at } = {}, opts = {}) {
  const store = opts.store || _store;
  const act = String(action || '').trim().toLowerCase();
  if (!RESOLVE_SET.has(act)) return null;
  const existing = currentFlags(store).find((f) => f.id === id);
  if (!existing) return null;
  // action maps 1:1 onto status here; all RESOLVE_ACTIONS are valid statuses.
  const status = STATUS_SET.has(act) ? act : 'reviewed';
  const event = {
    type: 'resolve',
    id,
    status,
    action: act,
    resolvedBy: cap(by, 64),
    note: cap(note),
    resolvedAt: at || _clock(),
  };
  store.append(event); // soft-fails internally; still return the merged view
  return { ...existing, status, action: act, resolvedBy: cap(by, 64), note: cap(note), resolvedAt: event.resolvedAt };
}

/**
 * Summary counts: by kind, by status, plus total + gatedPending.
 * @returns {{byKind:object, byStatus:object, total:number, gatedPending:number}}
 */
export function summary(opts = {}) {
  const store = opts.store || _store;
  const byKind = {};
  const byStatus = {};
  let total = 0;
  let gatedPending = 0;
  for (const f of currentFlags(store)) {
    total += 1;
    byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    if (f.gated && f.status === 'pending') gatedPending += 1;
  }
  return { byKind, byStatus, total, gatedPending };
}

/** All current flags (diagnostics / tests). */
export function listFlags(opts = {}) { return currentFlags(opts.store || _store); }

// ── CLI: inspect the queue / summary (read-only — never files or resolves anything). ───────────────
if (process.argv[1] && process.argv[1].endsWith('flag-pipe.mjs')) {
  const [cmd] = process.argv.slice(2);
  // Use the file-backed store for the CLI so it reads the persisted queue, not an empty memory store.
  __setStore(jsonlStore());
  if (cmd === 'summary') console.log(JSON.stringify(summary(), null, 2));
  else if (cmd === 'kinds') console.log(JSON.stringify({ KINDS, GATED_KINDS, STATUSES }, null, 2));
  else console.log(JSON.stringify(reviewQueue({ status: 'pending' }), null, 2));
}
