// integrations/moderation-runner.mjs — the WIRING that makes the moderation pieces usable.
//
// WHY THIS EXISTS
//   The repo already has two halves that never met:
//     • DETECTORS (cheetah/toxicity-detect.mjs, scam-detect.mjs, impersonation-detect.mjs, …) —
//       each reads a piece of content and, if it looks like a harm, returns a flag-pipe-shaped
//       { kind, severity, reason } object (or null when clean).
//     • THE PIPE (integrations/flag-pipe.mjs) — the ONE unified, append-only moderation spine.
//       fileFlag({target, kind, severity, reason, reporter, evidence}) records a harm; it does no
//       detection itself.
//   Nothing actually RAN every detector over a piece of content and filed what they found. This
//   module is that glue: runModeration(content, deps) runs the whole detector registry over
//   `content` and files each produced flag into the pipe. One call → "scan this, file what's wrong".
//
// DETECTOR REGISTRY
//   The set of detectors to run is a REGISTRY: an array of { name, kind?, run(content) } entries
//   where run(content) returns zero, one, or many flag-shaped objects (or a { flag } / { flags }
//   wrapper — we normalize all of these). The registry is injectable so a real
//   `cheetah/detector-registry.mjs` can be dropped in later via __setRegistry / deps.registry; the
//   built-in default wraps the three shipped cheetah detector adapters. The runner imports the
//   detectors lazily (best-effort) so a missing/renamed detector degrades to "fewer detectors ran",
//   never a crash.
//
// CONTENT SHAPE
//   `content` may be a bare string (treated as the text) or an object. Recognized fields:
//     { text|body, links[], target, reporter,                       // text-class detectors
//       account, displayName, bio, accountAgeDays, knownAccounts[] } // identity-class detectors
//   `target` is what a filed flag points at ('@author/permlink' or '@account'); if omitted we derive
//   a best-effort target ('@<account>' or '(unknown-target)') so a flag is never silently dropped.
//
// CUSTODY / SAFETY
//   • Detector-agnostic, zero keys, zero network, zero chain writes. Pure read+route.
//   • Soft-fail-never-throw: a thrown detector, a thrown fileFlag, a bad registry entry — each is
//     caught and recorded in results[].error; the pass always returns a result object.
//   • esc() ALL HTML interpolation in the CLI/diagnostic render path.
//   • Injectable seams for OFFLINE tests: __setFlagPipe(pipe) swaps the pipe (default = the real
//     flag-pipe module); __setRegistry(reg) swaps the detector set (default = the built-in one).
//     deps.flagPipe / deps.registry override per-call without mutating module state.
//
//   import { runModeration, __setFlagPipe } from './integrations/moderation-runner.mjs';
//   const out = await runModeration('send me your seed phrase', { reporter: 'troll-box', target: '@bob/x' });
//   // out = { flagsFiled: 1, results: [ { name:'scam', filed:[{id,kind,...}], skipped:false }, ... ] }

import * as realFlagPipe from './flag-pipe.mjs';

// ── esc(): HTML-escape any value that may be rendered in a diagnostic / CLI UI ──────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  CONTENT NORMALIZATION — accept a bare string or a rich object, expose a uniform view.
// ════════════════════════════════════════════════════════════════════════════════════════════════
function normalizeContent(content) {
  if (typeof content === 'string') return { text: content, raw: content };
  if (content && typeof content === 'object') {
    const text = content.text != null ? content.text
      : content.body != null ? content.body
      : '';
    return {
      text: String(text == null ? '' : text),
      links: Array.isArray(content.links) ? content.links : [],
      account: content.account != null ? String(content.account) : '',
      displayName: content.displayName != null ? String(content.displayName) : '',
      bio: content.bio != null ? String(content.bio) : '',
      accountAgeDays: content.accountAgeDays != null ? content.accountAgeDays : null,
      knownAccounts: Array.isArray(content.knownAccounts) ? content.knownAccounts : [],
      target: content.target != null ? String(content.target) : '',
      reporter: content.reporter != null ? String(content.reporter) : '',
      raw: content,
    };
  }
  return { text: '', raw: content };
}

// Best-effort target for a filed flag when the caller didn't give one.
function deriveTarget(view, depsTarget) {
  if (depsTarget) return String(depsTarget);
  if (view.target) return view.target;
  if (view.account) return view.account.startsWith('@') ? view.account : `@${view.account}`;
  return '(unknown-target)';
}

// Normalize whatever a detector returns into a flat array of flag-shaped objects.
// Accepts: null/undefined, a flag object, { flag }, { flags:[...] }, or an array of any of those.
function collectFlags(ret) {
  const out = [];
  const push = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(push); return; }
    if (Array.isArray(x.flags)) { x.flags.forEach(push); return; }
    if (x.flag && typeof x.flag === 'object') { push(x.flag); return; }
    if (x.kind) out.push(x); // a flag-shaped object (has a kind)
  };
  push(ret);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  DEFAULT REGISTRY — wraps the three shipped cheetah detector adapters. Each entry exposes a
//  uniform run(view) that calls the underlying detector with the right argument shape and returns
//  the flag (or null). Detectors are imported LAZILY + best-effort so a missing module just means
//  that detector is absent from the pass, never a crash.
// ════════════════════════════════════════════════════════════════════════════════════════════════
async function tryImport(spec) {
  try { return await import(spec); } catch { return null; }
}

let _builtinRegistry = null; // memoized
async function builtinRegistry() {
  if (_builtinRegistry) return _builtinRegistry;
  const [tox, scam, imp] = await Promise.all([
    tryImport('../cheetah/toxicity-detect.mjs'),
    tryImport('../cheetah/scam-detect.mjs'),
    tryImport('../cheetah/impersonation-detect.mjs'),
  ]);
  const reg = [];
  if (tox && typeof tox.detectToxicity === 'function') {
    reg.push({ name: 'toxicity', run: (v) => tox.detectToxicity(v.text) });
  }
  if (scam && typeof scam.detectScam === 'function') {
    reg.push({ name: 'scam', run: (v) => scam.detectScam(v.text, { links: v.links }) });
  }
  if (imp && typeof imp.detectImpersonation === 'function') {
    reg.push({
      name: 'impersonation',
      // identity-class: only meaningful when an account is present.
      run: (v) => (v.account
        ? imp.detectImpersonation(v.account, {
          knownAccounts: v.knownAccounts,
          displayName: v.displayName,
          bio: v.bio,
          accountAgeDays: v.accountAgeDays,
        })
        : null),
    });
  }
  _builtinRegistry = reg;
  return reg;
}

// ── injectable seams ────────────────────────────────────────────────────────────────────────────
let _flagPipe = realFlagPipe;
let _registryOverride = null;

/** Swap the flag-pipe (default = the real flag-pipe module). Must expose fileFlag(). Falsy resets. */
export function __setFlagPipe(pipe) {
  _flagPipe = (pipe && typeof pipe.fileFlag === 'function') ? pipe : realFlagPipe;
  return _flagPipe;
}
/** Swap the detector registry (array of { name, run(view) }). Falsy resets to the built-in default. */
export function __setRegistry(reg) {
  _registryOverride = Array.isArray(reg) ? reg : null;
  return _registryOverride;
}
/** Read the active flag-pipe (diagnostics / tests). */
export function __getFlagPipe() { return _flagPipe; }
/** Resolve the active registry (override → built-in). Exposed for diagnostics / tests. */
export async function __getRegistry() {
  return _registryOverride || (await builtinRegistry());
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Run every detector in the registry over `content` and file each produced flag into the flag-pipe.
 *
 * @param {string|object} content  the text/object to scan (see CONTENT SHAPE above).
 * @param {object} [deps]
 * @param {object} [deps.flagPipe]   override the flag-pipe for this call (must expose fileFlag()).
 * @param {Array}  [deps.registry]   override the detector registry for this call.
 * @param {string} [deps.target]     target a filed flag points at (overrides content.target).
 * @param {string} [deps.reporter]   reporter id recorded on each flag (overrides content.reporter).
 * @returns {Promise<{flagsFiled:number, results:Array}>}
 *   results[]: { name, filed:[flag,...], deduped:[flag,...], skipped:boolean, error?:string }
 *   Soft-fail: never throws; a detector or pipe failure is captured in results[].error.
 */
export async function runModeration(content, deps = {}) {
  const out = { flagsFiled: 0, results: [] };
  let view;
  try {
    view = normalizeContent(content);
  } catch (e) {
    out.results.push({ name: '(normalize)', filed: [], deduped: [], skipped: true, error: e?.message || String(e) });
    return out;
  }

  const pipe = (deps && deps.flagPipe && typeof deps.flagPipe.fileFlag === 'function') ? deps.flagPipe : _flagPipe;
  let registry;
  try {
    registry = (deps && Array.isArray(deps.registry)) ? deps.registry
      : (_registryOverride || (await builtinRegistry()));
  } catch (e) {
    out.results.push({ name: '(registry)', filed: [], deduped: [], skipped: true, error: e?.message || String(e) });
    return out;
  }
  if (!Array.isArray(registry)) registry = [];

  const target = deriveTarget(view, deps && deps.target);
  const reporterBase = (deps && deps.reporter) || view.reporter || 'moderation-runner';

  for (const det of registry) {
    if (!det || typeof det.run !== 'function') {
      out.results.push({ name: det?.name || '(invalid)', filed: [], deduped: [], skipped: true, error: 'invalid-registry-entry' });
      continue;
    }
    const name = det.name || 'detector';
    const entry = { name, filed: [], deduped: [], skipped: false };

    let ret;
    try {
      ret = await det.run(view); // detectors are sync, but await tolerates async ones too
    } catch (e) {
      entry.skipped = true;
      entry.error = e?.message || String(e);
      out.results.push(entry);
      continue;
    }

    const flags = collectFlags(ret);
    if (flags.length === 0) { out.results.push(entry); continue; }

    for (const flag of flags) {
      try {
        const res = pipe.fileFlag({
          target,
          kind: flag.kind ?? det.kind,
          severity: flag.severity,
          reason: flag.reason,
          reporter: flag.reporter || `${reporterBase}:${name}`,
          evidence: flag.evidence,
        });
        if (res && res.flag) {
          if (res.deduped) entry.deduped.push(res.flag);
          else { entry.filed.push(res.flag); out.flagsFiled += 1; }
        } else {
          entry.error = (res && res.error) || 'file-failed';
        }
      } catch (e) {
        entry.error = e?.message || String(e);
      }
    }
    out.results.push(entry);
  }

  return out;
}

// ── CLI (guarded): scan stdin/args text through the default pipe + registry; print what was filed. ──
if (process.argv[1] && /moderation-runner\.mjs$/.test(process.argv[1])) {
  const text = process.argv.slice(2).join(' ') || '';
  // Use the file-backed flag-pipe store so the CLI files into the same queue the readers see.
  if (typeof realFlagPipe.__setStore === 'function' && typeof realFlagPipe.jsonlStore === 'function') {
    realFlagPipe.__setStore(realFlagPipe.jsonlStore());
  }
  const out = await runModeration(text, { reporter: 'cli' });
  console.log(`[moderation-runner] flagsFiled=${out.flagsFiled} detectors=${out.results.length}`);
  for (const r of out.results) {
    const filed = r.filed.map((f) => `${esc(f.kind)}(sev${f.severity})`).join(', ') || '—';
    const note = r.error ? ` error=${esc(r.error)}` : '';
    console.log(`  ${esc(r.name)}: filed=[${filed}]${r.deduped.length ? ` deduped=${r.deduped.length}` : ''}${note}`);
  }
}
