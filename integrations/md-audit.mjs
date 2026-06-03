// md-audit.mjs — Task #128/#8: classify the repo's root .md files (DONE / TODO / SUPERSEDED /
// NOT-BUILT / KEEP) and PROPOSE an archive plan to declutter the root.
//
// HARD INVARIANT: this NEVER moves or deletes anything. It is a dry verdict only — it emits a
// proposed plan (markdown + suggested `git mv` commands as TEXT) for the operator to review and
// run themselves if they agree. Load-bearing docs are always KEEP; the append-only
// ITINERARY/MASTER_ITINERARY are never proposed for archive.
//
//   node integrations/md-audit.mjs            # verdict for the repo root
//   node integrations/md-audit.mjs --plan     # also print the suggested git mv commands
//
// Pure classification: heuristics on filename + content markers. fs/lister is injectable via
// __setFs(fn) so tests run OFFLINE on fixtures. No secrets, no network.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── injectable fs (offline tests) ────────────────────────────────────────────
// shape: { list(dir) -> string[] of filenames, read(path) -> string }
let _fs = {
  list: (dir) => readdirSync(dir).filter((n) => n.endsWith('.md')),
  read: (path) => readFileSync(path, 'utf8'),
};
export function __setFs(fn) { _fs = fn; }

// ── the protected set ─────────────────────────────────────────────────────────
// Load-bearing docs are ALWAYS KEEP, even if their content reads "done". These are the
// read-order / source-of-truth docs named in CLAUDE.md plus the standard repo meta files.
export const LOAD_BEARING = new Set([
  'CLAUDE.md',
  'BRIEF.md',
  'CHARACTER.md',
  'RULE_1.md',
  'LINEAGE.md',
  'MELEK.md',
  'README.md',
  'SECURITY.md',
  'OPERATOR.md',
  'POLICY.md',
  'MELEK_SIGNER.md',
  'BRIEF_PROTOCOL.md',
  'CHEETAH_ADVANCED.md',
  'CHEETAH_ADVANCED.MD', // tolerate case variants
  'CONTRIBUTING.md',
  'STATUS.md',
  'TODO.md',
]);

// The append-only docs: never archive, never remove — operator invariant (memory rule).
export const APPEND_ONLY = new Set([
  'ITINERARY.md',
  'MASTER_ITINERARY.md',
]);

function baseName(path) {
  const parts = String(path).split('/');
  return parts[parts.length - 1];
}

function isLoadBearing(path) {
  const b = baseName(path);
  return LOAD_BEARING.has(b) || APPEND_ONLY.has(b);
}

function isAppendOnly(path) {
  return APPEND_ONLY.has(baseName(path));
}

// ── classification ────────────────────────────────────────────────────────────
// Heuristics, in priority order:
//   1. load-bearing / append-only name → KEEP (never overridden by content)
//   2. SUPERSEDED / deprecated markers  → SUPERSEDED
//   3. NOT-BUILT markers (not started / placeholder / proposed-only) → NOT-BUILT
//   4. DONE markers (status: done/complete/shipped) → DONE
//   5. TODO markers → TODO
//   6. default → KEEP (when in doubt, keep — never propose archiving the ambiguous)
const RX_SUPERSEDED = /\b(superseded|superceded|deprecated|obsolete|replaced by|do not use|no longer (used|maintained))\b/i;
const RX_NOT_BUILT = /\b(not[\s-]*(yet[\s-]*)?(built|started|implemented)|never built|placeholder|stub(bed)?|scaffold(ing)? only|proposal only|propose[ds]?[\s-]*only)\b/i;
const RX_DONE = /(^|\n)\s*(status\s*[:=]\s*(done|complete[d]?|shipped|finished)|>?\s*\*{0,2}status\*{0,2}\s*[:=]\s*(done|complete[d]?|shipped))/i;
const RX_DONE_LOOSE = /\b(all (done|complete)|✅\s*(done|complete|shipped)|marked (done|complete)|this is complete)\b/i;
const RX_TODO = /(^|\n)\s*(#+\s*)?(todo|to[\s-]?do)\b|- \[ \]/i;

export function classifyDoc({ path, content = '' }) {
  const b = baseName(path);

  // 1. protected set — always KEEP, content cannot override
  if (LOAD_BEARING.has(b)) {
    return { path, class: 'KEEP', reason: 'load-bearing doc (read-order / source of truth) — always kept' };
  }
  if (APPEND_ONLY.has(b)) {
    return { path, class: 'KEEP', reason: 'append-only operator doc — never archive or remove' };
  }

  const head = content.slice(0, 600); // markers near the top carry the most weight

  // 2. SUPERSEDED — strongest decluttering signal
  if (RX_SUPERSEDED.test(head) || RX_SUPERSEDED.test(content)) {
    return { path, class: 'SUPERSEDED', reason: 'contains superseded/deprecated/replaced-by marker' };
  }

  // 3. NOT-BUILT
  if (RX_NOT_BUILT.test(head) || RX_NOT_BUILT.test(content)) {
    return { path, class: 'NOT-BUILT', reason: 'marked not-built / placeholder / proposal-only' };
  }

  // 4. DONE (explicit status line, or loose done phrasing)
  if (RX_DONE.test(content) || RX_DONE_LOOSE.test(content)) {
    return { path, class: 'DONE', reason: 'marked status: done / complete / shipped' };
  }

  // 5. TODO
  if (RX_TODO.test(content)) {
    return { path, class: 'TODO', reason: 'contains TODO / open checklist items' };
  }

  // 6. default — keep the ambiguous
  return { path, class: 'KEEP', reason: 'no decluttering marker found — kept by default' };
}

// ── audit + plan ────────────────────────────────────────────────────────────
// files: [{ path, content }]
// Only SUPERSEDED docs become archive candidates. DONE/NOT-BUILT/TODO are reported in their
// class but are NOT proposed for archive (a "done" doc may still be a load-bearing record;
// archiving is conservative — superseded scratch only). Load-bearing & append-only → neverTouch.
export function auditRoot({ files = [] }) {
  const classified = files.map((f) => classifyDoc(f));
  const keep = [];
  const archiveCandidates = [];
  const neverTouch = [];

  for (const c of classified) {
    if (isLoadBearing(c.path)) {
      neverTouch.push({ path: c.path, class: c.class, reason: c.reason });
      continue;
    }
    if (c.class === 'SUPERSEDED') {
      archiveCandidates.push({ path: c.path, class: c.class, reason: c.reason });
    } else {
      keep.push({ path: c.path, class: c.class, reason: c.reason });
    }
  }

  return { classified, keep, archiveCandidates, neverTouch };
}

// ── verdict rendering (operator-facing) ──────────────────────────────────────
export function renderVerdict(plan) {
  const { archiveCandidates = [], keep = [], neverTouch = [] } = plan;
  const lines = [];
  lines.push('# Root .md audit — proposed archive plan (PROPOSAL ONLY)');
  lines.push('');
  lines.push('This is a dry verdict. Nothing has been moved or deleted. Here is what I would');
  lines.push('archive and why — your call.');
  lines.push('');

  lines.push(`## Would archive → \`archive/\` (${archiveCandidates.length})`);
  if (archiveCandidates.length === 0) {
    lines.push('');
    lines.push('_Nothing. No superseded docs found cluttering the root._');
  } else {
    lines.push('');
    for (const c of archiveCandidates) {
      lines.push(`- **${baseName(c.path)}** — \`${c.class}\`: ${c.reason}`);
    }
  }
  lines.push('');

  lines.push(`## Never touch — load-bearing / append-only (${neverTouch.length})`);
  lines.push('');
  for (const c of neverTouch) {
    lines.push(`- ${baseName(c.path)} — ${c.reason}`);
  }
  lines.push('');

  lines.push(`## Keep in root, but classified (${keep.length})`);
  lines.push('');
  for (const c of keep) {
    lines.push(`- ${baseName(c.path)} — \`${c.class}\`: ${c.reason}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('Run nothing automatically. If you agree, the suggested commands are in the archive plan.');
  return lines.join('\n');
}

// ── proposed commands (TEXT ONLY — never executed) ───────────────────────────
export function proposeArchivePlan(plan) {
  const { archiveCandidates = [] } = plan;
  const lines = [];
  lines.push('# Suggested commands (TEXT ONLY — this module runs none of them)');
  if (archiveCandidates.length === 0) {
    lines.push('# (no archive candidates — nothing to propose)');
    return lines.join('\n');
  }
  lines.push('mkdir -p archive');
  for (const c of archiveCandidates) {
    lines.push(`git mv ${baseName(c.path)} archive/${baseName(c.path)}`);
  }
  return lines.join('\n');
}

// ── load from disk (real fs via the injectable layer) ────────────────────────
export function loadRootDocs(dir) {
  let names = [];
  try { names = _fs.list(dir); } catch { return []; }
  const files = [];
  for (const n of names) {
    const path = join(dir, n);
    let content = '';
    try { content = _fs.read(path); } catch { content = ''; } // soft-fail per file
    files.push({ path, content });
  }
  return files;
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('md-audit.mjs')) {
  try {
    const root = process.argv.find((a) => a.startsWith('/')) || process.cwd();
    const files = loadRootDocs(root);
    const plan = auditRoot({ files });
    process.stdout.write(renderVerdict(plan) + '\n');
    if (process.argv.includes('--plan')) {
      process.stdout.write('\n' + proposeArchivePlan(plan) + '\n');
    }
  } catch (e) {
    process.stderr.write(`md-audit: soft-fail: ${e?.message || e}\n`);
  }
}
