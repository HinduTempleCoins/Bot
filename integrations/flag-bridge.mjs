// flag-bridge.mjs — reconcile the LEGACY moderation system with the new unified flag-pipe.
//
// WHY THIS EXISTS
//   Two moderation lineages grew up side by side in this repo:
//     • LEGACY: integrations/moderation-flags.mjs (the condenser's "Report this" store, REPORT_KINDS
//       = spam/abuse/scam/impersonation/illegal/other) + integrations/flag-taxonomy.mjs (the harm
//       map whose category keys — scam-fraud, harassment-toxicity, hate, doxxing-pii, bot-sybil,
//       copyright-dmca, … — route INTO that store, stamping context.{category,severity,action,gated}).
//     • NEW: integrations/flag-pipe.mjs — the ONE detector-agnostic spine with 10 flat KINDS
//       (plagiarism, image-theft, spam, scam, harassment, impersonation, misinformation, doxxing,
//       csam, sybil).
//   If both keep filing independently the same harm lands twice in two stores nobody can reconcile.
//   flag-bridge is the translator: it maps a LEGACY flag (a moderation-flags report, optionally
//   carrying flag-taxonomy context) onto flag-pipe's fileFlag() shape, and imports a batch of legacy
//   flags INTO a flag-pipe (dedupe-aware, so re-running the import is idempotent).
//
// DIRECTION
//   LEGACY → PIPE only. The pipe is the destination of record. We never write back to the legacy
//   store here (that would re-duplicate); flag-bridge is a one-way reconciliation into flag-pipe.
//
// MAPPING PHILOSOPHY (POLICY.md — load-bearing)
//   • A flag is NOT a punishment; the bridge moves a MARKER, never an action. Nothing is auto-resolved.
//   • Never silently mislabel. A legacy kind we can map confidently maps to the closest pipe KIND
//     (KIND_MAP). A legacy kind we cannot map is SKIPPED with a recorded reason — never force-bucketed
//     into a wrong harm, because mis-bucketing is worse than refusing (same stance as flag-pipe).
//   • CSAM stays gated end to end: a legacy 'csam' / 'illegal'+csam-context flag maps to pipe 'csam',
//     and flag-pipe itself force-redacts gated evidence — no imagery ever rides through.
//
// CUSTODY / SAFETY
//   • Zero keys, zero broadcast, zero chain writes. Soft-fail-never-throw everywhere.
//   • Injectable seams for OFFLINE tests: __setReader(fn) supplies legacy flags from a source;
//     importLegacy(legacyFlags, flagPipe) takes an explicit flag-pipe module/object so a fake or the
//     real one can be passed. No network, no fs unless the caller's pipe uses it.
//
//   import { toFlagPipe, importLegacy, KIND_MAP } from '../integrations/flag-bridge.mjs';
//   const shape = toFlagPipe(legacyReport);            // → fileFlag() args (or {skip, reason})
//   const res   = importLegacy(legacyReports, flagPipe); // files each into the pipe, dedupe-aware

// esc() — HTML-escape any value that may be rendered in a queue/diagnostics UI.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MAX_FIELD = 2000;
const cap = (s, n = MAX_FIELD) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, n) : x; };

// The 10 flag-pipe KINDS, mirrored here so the bridge is self-validating offline (we don't import
// flag-pipe just to read its constant — the caller injects the pipe at import time). Kept in sync by
// the test: flag-bridge.test.mjs asserts these equal flag-pipe's KINDS.
export const PIPE_KINDS = Object.freeze([
  'plagiarism', 'image-theft', 'spam', 'scam', 'harassment',
  'impersonation', 'misinformation', 'doxxing', 'csam', 'sybil',
]);
const PIPE_KIND_SET = new Set(PIPE_KINDS);

// ── KIND_MAP: legacy kind → pipe KIND ──────────────────────────────────────────────────────────────
// Legacy "kinds" come from TWO vocabularies that the legacy system mixes:
//   1. flag-taxonomy category keys (the precise harm) — preferred when present in context.category.
//   2. moderation-flags REPORT_KINDS (the coarse bucket the store records) — the fallback.
// We map BOTH so a legacy flag maps correctly whether or not it carries a taxonomy category.
// Value `null` ⇒ deliberately UNMAPPABLE → skipped with a reason (never force-bucketed).
export const KIND_MAP = Object.freeze({
  // ── flag-taxonomy category keys (fine-grained) ──
  'plagiarism': 'plagiarism',
  'image-theft': 'image-theft',
  'spam': 'spam',
  'scam-fraud': 'scam',
  'harassment-toxicity': 'harassment',
  'hate': 'harassment',                 // pipe has no separate 'hate' KIND — closest is harassment
  'impersonation': 'impersonation',
  'misinformation': 'misinformation',
  'doxxing-pii': 'doxxing',
  'csam': 'csam',
  'bot-sybil': 'sybil',
  'copyright-dmca': 'image-theft',      // copyright reuse ≈ image/text theft family; closest pipe KIND

  // ── moderation-flags REPORT_KINDS (coarse buckets) ──
  // 'spam' already mapped above (same token).
  'scam': 'scam',
  'abuse': 'harassment',                // 'abuse' bucket = harassment/toxicity/hate family
  // 'impersonation' already mapped above (same token).
  'illegal': null,                      // ambiguous by itself — see resolveIllegal(): csam-context → csam,
                                        //   copyright/dmca-context → image-theft, else skipped.
  'other': null,                        // catch-all bucket carries no harm signal → skipped (unless a
                                        //   taxonomy context.category narrows it).
});

// Per-pipe-KIND default severity (1=lightest..5=gravest). Used only when the legacy flag carries no
// usable severity. Mirrors flag-pipe's own defaults so a bridged flag looks native.
const PIPE_DEFAULT_SEVERITY = Object.freeze({
  plagiarism: 2, 'image-theft': 2, spam: 2, sybil: 2,
  misinformation: 2, harassment: 3, impersonation: 3,
  doxxing: 4, scam: 4, csam: 5,
});

const norm = (k) => String(k || '').trim().toLowerCase();
const clampSeverity = (n) => {
  const x = Math.round(Number(n));
  return Number.isFinite(x) ? Math.min(5, Math.max(1, x)) : null;
};

// Pull the flag-taxonomy context off a legacy report regardless of whether it's an object or a
// JSON-stringified string (moderation-flags caps+stringifies non-string context).
function legacyContext(legacy) {
  const ctx = legacy && legacy.context;
  if (!ctx) return {};
  if (typeof ctx === 'object') return ctx;
  if (typeof ctx === 'string') { try { return JSON.parse(ctx) || {}; } catch { return {}; } }
  return {};
}

// The 'illegal' coarse bucket is ambiguous; narrow it using the taxonomy category if present.
function resolveIllegal(category) {
  const c = norm(category);
  if (c === 'csam') return 'csam';
  if (c === 'copyright-dmca') return 'image-theft';
  return null; // still ambiguous → skip with reason
}

/**
 * Map ONE legacy flag onto flag-pipe's fileFlag() argument shape.
 *
 * A legacy flag is a moderation-flags report (or anything shaped like one):
 *   { target, kind (REPORT_KIND), reason, reporter, context:{category,severity,action,gated,confidence},
 *     status, id, raisedAt, ... }
 * The fine-grained taxonomy category (context.category) is PREFERRED for mapping; the coarse
 * `kind` is the fallback.
 *
 * @returns {{
 *   target, kind, severity, reason, reporter, evidence, at,    // ← fileFlag() args when mappable
 *   _legacy: { id, kind, category, status }                    // provenance, for diagnostics/dedupe
 * } | { skip:true, reason:string, _legacy:object }}
 *   On an unmappable/empty input returns { skip:true, reason } — never throws.
 */
export function toFlagPipe(legacy) {
  try {
    if (!legacy || typeof legacy !== 'object') return { skip: true, reason: 'not-an-object', _legacy: {} };
    const ctx = legacyContext(legacy);
    const category = norm(ctx.category);
    const coarse = norm(legacy.kind);
    const provenance = { id: legacy.id, kind: coarse, category: category || undefined, status: legacy.status };

    const target = cap(legacy.target, 256);
    if (!target) return { skip: true, reason: 'missing-target', _legacy: provenance };

    // Resolve the pipe KIND: prefer the fine-grained taxonomy category, fall back to the coarse kind.
    let pipeKind = null;
    let via = null;
    if (category && category in KIND_MAP && KIND_MAP[category] != null) { pipeKind = KIND_MAP[category]; via = `category:${category}`; }
    else if (coarse && coarse in KIND_MAP && KIND_MAP[coarse] != null) { pipeKind = KIND_MAP[coarse]; via = `kind:${coarse}`; }
    else if (coarse === 'illegal') { pipeKind = resolveIllegal(category); via = `illegal+category:${category || '(none)'}`; }
    else if (category && PIPE_KIND_SET.has(category)) { pipeKind = category; via = `category-direct:${category}`; } // already a pipe KIND
    else if (coarse && PIPE_KIND_SET.has(coarse)) { pipeKind = coarse; via = `kind-direct:${coarse}`; }            // already a pipe KIND

    if (!pipeKind || !PIPE_KIND_SET.has(pipeKind)) {
      const seen = category || coarse || '(empty)';
      return { skip: true, reason: `unmappable-kind:${seen}`, _legacy: provenance };
    }

    // Severity: prefer the taxonomy context.severity, else the pipe default for this KIND.
    const sevFromCtx = clampSeverity(ctx.severity);
    const severity = sevFromCtx ?? (PIPE_DEFAULT_SEVERITY[pipeKind] ?? 3);

    // Evidence: carry the legacy reason + a short provenance note so the bridged flag is auditable.
    // (flag-pipe force-redacts gated/csam evidence on its side — we don't need to special-case here.)
    const reason = cap(legacy.reason, MAX_FIELD);
    const provNote = `bridged from legacy ${esc(provenance.id || '(no-id)')} via ${esc(via)}`
      + (ctx.action ? `; legacy action=${esc(ctx.action)}` : '')
      + (ctx.gated ? '; legacy gated' : '');
    const evidence = cap(reason ? `${reason} — ${provNote}` : provNote, MAX_FIELD);

    return {
      target,
      kind: pipeKind,
      severity,
      reason: reason || provNote,
      reporter: cap(legacy.reporter, 64),
      evidence,
      // Preserve the original timing so re-import is stable and the pipe orders sensibly.
      at: legacy.raisedAt || legacy.filedAt || undefined,
      _legacy: provenance,
    };
  } catch (e) {
    return { skip: true, reason: `error:${esc(e && e.message)}`, _legacy: {} };
  }
}

// ── injectable reader seam ──────────────────────────────────────────────────────────────────────────
// A reader supplies legacy flags from a source (e.g. moderationFlags.listReports()). Tests inject one;
// production can wire the legacy store. The reader is OPTIONAL — importLegacy() also takes flags directly.
let _reader = null;
/** Set a () => Array<legacyFlag> reader (used when importLegacy is called without an explicit list). */
export function __setReader(fn) { if (typeof fn === 'function') _reader = fn; return _reader; }

/**
 * Import a batch of legacy flags INTO a flag-pipe, dedupe-aware.
 *
 * @param {Array<object>|null} legacyFlags  the legacy flags to import. If null/omitted, the injected
 *                                          reader (__setReader) is used; if neither, returns empty.
 * @param {object} flagPipe                 a flag-pipe module/object exposing fileFlag(args). The REAL
 *                                          integrations/flag-pipe.mjs satisfies this; tests pass a fake.
 *                                          A `store` may be threaded via opts.store (passed to fileFlag).
 * @param {object} [opts]  { store } — optional backing store passed to flagPipe.fileFlag(args, {store}).
 * @returns {{
 *   imported:number, deduped:number, skipped:number, failed:number,
 *   results: Array<{ ok:boolean, deduped?:boolean, skipped?:boolean, reason?:string, flag?:object, legacyId?:* }>
 * }}
 *   Soft-fail: a flag that can't be filed is counted (failed/skipped) but never throws the batch.
 */
export function importLegacy(legacyFlags, flagPipe, opts = {}) {
  const summary = { imported: 0, deduped: 0, skipped: 0, failed: 0, results: [] };

  // Source the flags: explicit list wins; else the injected reader; else nothing.
  let flags = legacyFlags;
  if (!Array.isArray(flags)) {
    if (_reader) { try { flags = _reader(); } catch { flags = []; } }
  }
  if (!Array.isArray(flags)) flags = [];

  if (!flagPipe || typeof flagPipe.fileFlag !== 'function') {
    // No valid destination — everything "fails" softly so the caller learns why without a crash.
    for (const f of flags) {
      summary.failed += 1;
      summary.results.push({ ok: false, reason: 'no-flag-pipe', legacyId: f && f.id });
    }
    return summary;
  }

  const passOpts = opts && opts.store ? { store: opts.store } : undefined;

  for (const legacy of flags) {
    const mapped = toFlagPipe(legacy);
    const legacyId = mapped._legacy ? mapped._legacy.id : (legacy && legacy.id);

    if (mapped.skip) {
      summary.skipped += 1;
      summary.results.push({ ok: false, skipped: true, reason: mapped.reason, legacyId });
      continue;
    }

    const { _legacy, ...args } = mapped; // _legacy is provenance, not a fileFlag() arg
    let res;
    try {
      res = passOpts ? flagPipe.fileFlag(args, passOpts) : flagPipe.fileFlag(args);
    } catch (e) {
      summary.failed += 1;
      summary.results.push({ ok: false, reason: `file-threw:${esc(e && e.message)}`, legacyId });
      continue;
    }

    // flag-pipe.fileFlag returns { flag, deduped, gated?, error? }.
    if (!res || res.error || !res.flag) {
      summary.failed += 1;
      summary.results.push({ ok: false, reason: (res && res.error) || 'no-flag-returned', legacyId });
      continue;
    }
    if (res.deduped) {
      summary.deduped += 1;
      summary.results.push({ ok: true, deduped: true, flag: res.flag, legacyId });
    } else {
      summary.imported += 1;
      summary.results.push({ ok: true, flag: res.flag, legacyId });
    }
  }

  return summary;
}

// ── CLI: print the kind map (read-only — never files or imports anything). ───────────────────────────
if (process.argv[1] && process.argv[1].endsWith('flag-bridge.mjs')) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'map') console.log(JSON.stringify(KIND_MAP, null, 2));
  else console.log(JSON.stringify({ PIPE_KINDS, KIND_MAP }, null, 2));
}
