// factcheck-brief-bridge.mjs — task #123. Bridges the fact-checker's advisory KB-flag store
// (library-of-ashurbanipal-bot/src/factChecker/kbFlags.js) into the Server-4 brief pipeline, so the
// brief writers see "⚠ KB statement X may be inaccurate" alongside the diagnostics block.
//
// The flow this sits in:
//   kbFlags store (open flags)  →  THIS bridge  →  warningsBlock()  →  24/7 engine splices into briefs
//
// ADVISORY ONLY. The fact-checker FLAGS, it never edits knowledge/** (project invariant). This bridge
// is read-only on top of that: it reads open flags and renders them as warning lines + a brief-ready
// markdown section. It writes nothing, loads no keys, and carries the "verdicts are fallible" caveat on
// every surface so a brief writer never treats a flag as a settled correction.
//
// Cross-package + soft-fail by construction: the kbFlags module lives in a SIBLING bot package. We
// import it DEFENSIVELY (dynamic import, soft-fail → empty) so this file works even when that package
// is absent. Tests inject an offline flag source via __setFlagSource().
//
//   import { warningsBlock, allBriefWarnings, briefWarningFor, warningCount } from './factcheck-brief-bridge.mjs'
//   await warningsBlock();        // brief-ready "### Fact-check warnings (advisory)" markdown
//   await allBriefWarnings();     // string[] of ⚠ lines, sorted by confidence desc
//   await briefWarningFor(path);  // string[] of ⚠ lines for one KB path
//   await warningCount();         // number of open flags

// Relative path from integrations/ to the sibling library bot's kbFlags module.
const KBFLAGS_MODULE = '../library-of-ashurbanipal-bot/src/factChecker/kbFlags.js';

// The fallibility caveat, attached to every warning surface. A flag is a question for a human, never a
// correction — verdicts are fallible and false positives are expected (see CLAUDE.md memory rule).
const ADVISORY_CAVEAT =
  'Advisory only — the fact-checker FLAGS, it never edits the KB. Verdicts are fallible and false ' +
  'positives are expected; verify each statement before acting. Nothing here corrects any document.';

// ── injectable flag source (offline-testable) ─────────────────────────────────────────────────────
// A flag source is a function returning an array of OPEN flag objects:
//   { kbPath, statement, reason?, confidence?, suggestedSource? }
// Default source defensively imports the sibling kbFlags module and returns its open flags. If that
// package is unavailable (cross-package) or anything throws, it soft-fails to [].
let _flagSource = defaultFlagSource;

/** Inject a flag source for tests / alternate stores. Pass null to restore the default. */
export function __setFlagSource(fn) {
  _flagSource = typeof fn === 'function' ? fn : defaultFlagSource;
}

/** Default source: dynamically import the sibling kbFlags module, return its open flags. Soft-fail → []. */
async function defaultFlagSource() {
  try {
    const mod = await import(KBFLAGS_MODULE);
    const store = mod?.kbFlags || (typeof mod?.createKbFlagStore === 'function' ? mod.createKbFlagStore() : null);
    if (!store || typeof store.listFlags !== 'function') return [];
    const flags = store.listFlags({ status: 'open' });
    return Array.isArray(flags) ? flags : [];
  } catch {
    return []; // cross-package / absent / corrupt — soft-fail, never throw.
  }
}

/** Pull open flags from the current source. Always resolves to an array, never throws. */
async function loadFlags() {
  try {
    const flags = await _flagSource();
    return Array.isArray(flags) ? flags : [];
  } catch {
    return []; // a thrown flag source must never crash a brief pass.
  }
}

const conf = (f) => (typeof f?.confidence === 'number' ? f.confidence : 0);

/** Render one open flag as an advisory ⚠ warning line. Pure. Mirrors kbFlags.briefWarnings() wording. */
function lineFor(f) {
  if (!f) return '';
  const c = typeof f.confidence === 'number' ? ` (confidence ${f.confidence.toFixed(2)})` : '';
  const why = f.reason ? `: ${f.reason}` : '';
  const src = f.suggestedSource ? ` — check: ${f.suggestedSource}` : '';
  const stmt = f.statement ? ` “${f.statement}”` : '';
  // ADVISORY wording: "may be inaccurate", never "is wrong".
  return `⚠ KB statement in ${f.kbPath || 'unknown'} may be inaccurate${why}${stmt}${c}${src} [advisory — fact-checker verdicts are fallible; verify before acting]`;
}

/**
 * Open flags for ONE specific KB path, as advisory warning lines, sorted by confidence desc.
 * Pure given a flag source. Soft-fails to [] on any error.
 * @param {string} kbPath
 * @returns {Promise<string[]>}
 */
export async function briefWarningFor(kbPath) {
  const want = String(kbPath || '');
  const flags = (await loadFlags()).filter((f) => f && String(f.kbPath || '') === want);
  return flags.sort((a, b) => conf(b) - conf(a)).map(lineFor).filter(Boolean);
}

/**
 * ALL open flags as advisory warning lines, sorted by confidence desc (most-likely-wrong first).
 * @returns {Promise<string[]>}
 */
export async function allBriefWarnings() {
  const flags = await loadFlags();
  return flags.slice().sort((a, b) => conf(b) - conf(a)).map(lineFor).filter(Boolean);
}

/** Number of open flags currently visible to the bridge. Soft-fails to 0. */
export async function warningCount() {
  return (await loadFlags()).length;
}

/**
 * Brief-ready markdown section the 24/7 engine splices into briefs. ADVISORY — carries the fallibility
 * caveat. Empty flags → a clean "no open flags" line (never a scary empty section). Never throws.
 * @returns {Promise<string>}
 */
export async function warningsBlock() {
  const lines = await allBriefWarnings();
  const L = [];
  L.push('### Fact-check warnings (advisory)');
  L.push(`*${ADVISORY_CAVEAT}*`);
  L.push('');
  if (!lines.length) {
    // Clean, non-alarming empty state — the absence of flags is good news, not an empty warning box.
    L.push('- _No open fact-check flags this pass — nothing in the KB is currently flagged for review._');
  } else {
    for (const ln of lines) L.push(`- ${ln}`);
  }
  L.push('');
  L.push('*Engine: factcheck-brief-bridge.mjs · open KB flags only · advisory, never a correction.*');
  return L.join('\n');
}

/**
 * The single entry point the brief engine calls (mirrors diagnostics-pipeline engineBlock contract):
 * returns markdown, never throws, empty string on total failure.
 * @returns {Promise<string>}
 */
export async function engineBlock() {
  try {
    return await warningsBlock();
  } catch {
    return '';
  }
}

export default { briefWarningFor, allBriefWarnings, warningsBlock, warningCount, engineBlock, __setFlagSource };

// CLI: print the brief warnings section (or count). Read-only — never edits the KB.
if (process.argv[1] && process.argv[1].endsWith('factcheck-brief-bridge.mjs')) {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'count') console.log(String(await warningCount()));
  else console.log(await warningsBlock());
}
