// autocorrectGuard.js — the in-code enforcement of the FLAG-ONLY policy (#102).
//
// ───────────────────────────────────────────────────────────────────────────────────────────────
// HARD MEMORY RULE (load-bearing, project invariant — see CLAUDE.md and AUTOCORRECTION_POLICY.md):
//   The fact-checker FLAGS ONLY. It NEVER edits, rewrites, patches, or deletes any file under
//   knowledge/**. Auto-correction that touches source data is a DISCUSSION item, not a feature —
//   it requires explicit operator sign-off before any such mechanism could ever be built.
//
//   Verdicts are FALLIBLE. False positives are EXPECTED (the checker once mislabeled VKFRI, a private
//   research group, as something externally notable). A flag is a question for a human, never a
//   correction. Source data is the operator's ground truth; only the operator edits it.
//
//   This module is the single importable source of truth for that rule (POLICY) and the runtime
//   guard (assertNotKbPath / isKbPath) that ANY prospective write path must call to REFUSE writing
//   into the knowledge base. There is intentionally NO auto-edit function here — only a refusal.
// ───────────────────────────────────────────────────────────────────────────────────────────────
//
//   import { POLICY, isKbPath, assertNotKbPath } from './autocorrectGuard.js'
//   assertNotKbPath(targetPath);   // throws if targetPath is under knowledge/** — refuses the write

/**
 * The single source of truth for the flag-only policy. Import this anywhere the rule must be
 * referenced so there is exactly one canonical statement in code. The full rationale lives in
 * AUTOCORRECTION_POLICY.md; this is the machine-referenceable summary.
 */
export const POLICY = Object.freeze({
  mode: 'flag-only',
  // Plain-language statement of the invariant.
  statement:
    'The fact-checker FLAGS only; it never edits, patches, or deletes source data under knowledge/**. ' +
    'Auto-correction of source data is a future discussion requiring explicit operator sign-off.',
  mayDo: Object.freeze([
    'raise advisory flags (kbFlags)',
    'log verdicts (verdictLog)',
    'surface brief warnings for operator review',
  ]),
  neverDo: Object.freeze([
    'write to knowledge/**',
    'patch knowledge/**',
    'delete knowledge/**',
    'enable any auto-correction without explicit operator sign-off',
  ]),
  // Human-in-the-loop: operator reviews flags → operator decides → operator (not the bot) edits.
  humanInTheLoop: true,
  doc: 'AUTOCORRECTION_POLICY.md',
});

/**
 * Is the given path a knowledge-base source path (anything under a `knowledge/` segment)?
 * Recording such a path as a STRING reference (e.g. a flag's kbPath) is fine — what is forbidden is
 * WRITING to it. This predicate lets callers distinguish "this is KB source" from "this is our store".
 *
 * Matches `knowledge/` at the start or after any path separator, on both POSIX and Windows.
 * @param {string} p
 * @returns {boolean}
 */
export function isKbPath(p) {
  if (p == null) return false;
  const s = String(p);
  return /(^|[\\/])knowledge[\\/]/.test(s);
}

/**
 * Guard for ANY write path: throws if `p` points into knowledge/**, otherwise returns `p`.
 * Call this immediately before opening a file for writing in any code that could conceivably target
 * the KB. It is the in-code teeth of the flag-only policy — the fact-checker refuses to edit source
 * data BY CONSTRUCTION rather than relying on convention.
 *
 * @param {string} p   the prospective write target
 * @returns {string}   `p` unchanged, if it is safe to write
 * @throws {Error}     if `p` is under knowledge/**
 */
export function assertNotKbPath(p) {
  if (isKbPath(p)) {
    throw new Error(
      `autocorrectGuard: refusing to write to a knowledge/ source path (${p}). ${POLICY.statement}`,
    );
  }
  return p;
}

export default { POLICY, isKbPath, assertNotKbPath };
