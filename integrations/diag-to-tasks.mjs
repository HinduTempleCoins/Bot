// diag-to-tasks.mjs — turn red e2e diagnostics into durable, deduplicated WORK ITEMS.
// (carryover #176: the standing "diagnostics → annals → self-fix tasks" loop, repo side.)
//
// alpha-e2e.mjs runs every 15 min on the ops box and emits a report:
//   { at, pass, failures, requiredFailures, results:[{ name, required, pass, detail }] }
// Red checks are ephemeral — they vanish from the next report once green. This module
// makes them DURABLE: each failing check becomes a task record keyed by a stable hash of
// its check name, merged into a queue file that survives across runs. Tasks accumulate a
// firstSeen / lastSeen / count, and RECOVER (drop out) only after N consecutive green runs,
// so a flaky check doesn't churn the queue. The next Claude session (or the resident AI)
// reads the queue + its markdown render and picks up the work.
//
// House style: pure functions + injectable IO (file read/write + a clock), every path
// soft-fails (never throws), CLI guarded by the process.argv[1] check.
//
//   node integrations/diag-to-tasks.mjs once            # read e2e --json from stdin-less:
//   node integrations/alpha-e2e.mjs --json | node integrations/diag-to-tasks.mjs once
//   node integrations/diag-to-tasks.mjs once --report path/to/report.json
//
// Output: the merged queue JSON (path via DIAG_TASKS_PATH; the deploy bundle points it at
// the box's brain/shared dir) + a compact markdown render (self-fix-queue.md alongside it)
// the annal/brief pipeline ingests.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// --- injectable IO (tests swap these; never touches the real FS or clock) ----------------
let _readFile = (p) => readFile(p, 'utf8');
let _writeFile = (p, d) => writeFile(p, d, 'utf8');
let _mkdir = (p) => mkdir(p, { recursive: true });
let _now = () => new Date();
export function __setIO({ readFile: rf, writeFile: wf, mkdir: md, now } = {}) {
  _readFile = rf || ((p) => readFile(p, 'utf8'));
  _writeFile = wf || ((p, d) => writeFile(p, d, 'utf8'));
  _mkdir = md || ((p) => mkdir(p, { recursive: true }));
  _now = now || (() => new Date());
}

// Default is a repo-relative dir so a bare run never writes outside the checkout; the box
// overrides DIAG_TASKS_PATH to the operator's brain/shared dir (set in the deploy env).
const DEFAULT_PATH = process.env.DIAG_TASKS_PATH || 'integrations/.diag-tasks/self-fix-queue.json';
// Consecutive green runs before a task is considered recovered and dropped from the queue.
const RECOVER_AFTER = Number(process.env.DIAG_RECOVER_AFTER || 3);

const mdPathFor = (jsonPath) => jsonPath.replace(/\.json$/i, '') + '.md';

/** Stable short id for a check name — survives wording-stable, evidence changes. */
export function taskId(checkName) {
  return 'fix-' + createHash('sha1').update(String(checkName)).digest('hex').slice(0, 12);
}

const sevFor = (required) => (required ? 'high' : 'low');

/** Defensive parse of an alpha-e2e report (object or JSON string). Returns {} on garbage. */
export function parseReport(input) {
  let rep = input;
  if (typeof input === 'string') {
    try { rep = JSON.parse(input); } catch { return {}; }
  }
  if (!rep || typeof rep !== 'object') return {};
  return rep;
}

/** Failing results from a report, defensively. A result fails when pass !== true. */
function failingResults(rep) {
  const results = Array.isArray(rep.results) ? rep.results : [];
  return results
    .filter((r) => r && typeof r === 'object' && typeof r.name === 'string' && r.pass !== true)
    .map((r) => ({ name: r.name, required: !!r.required, detail: typeof r.detail === 'string' ? r.detail : '' }));
}

/** Names of checks that ran and PASSED this run (used to count green streaks). */
function passingNames(rep) {
  const results = Array.isArray(rep.results) ? rep.results : [];
  return new Set(
    results.filter((r) => r && typeof r === 'object' && typeof r.name === 'string' && r.pass === true).map((r) => r.name),
  );
}

/**
 * Merge one e2e report into the existing queue.
 * - red check  -> task created (or updated: count++, lastSeen, evidence refreshed, green streak reset)
 * - green check that has an open task -> green streak++ ; dropped once streak >= recoverAfter
 * - check absent from this report -> task untouched (we only have signal for checks that ran)
 * Pure (no IO). Never throws.
 */
export function mergeReport(prevQueue, report, { now, recoverAfter = RECOVER_AFTER } = {}) {
  const nowIso = (now || _now()).toISOString();
  const rep = parseReport(report);
  const prevTasks = prevQueue && Array.isArray(prevQueue.tasks) ? prevQueue.tasks : [];
  const byId = new Map();
  for (const t of prevTasks) if (t && t.id) byId.set(t.id, { ...t });

  const fails = failingResults(rep);
  const passed = passingNames(rep);
  const recovered = [];

  // 1) Apply red checks: create or bump.
  for (const f of fails) {
    const id = taskId(f.name);
    const existing = byId.get(id);
    if (existing) {
      existing.severity = sevFor(f.required);
      existing.summary = f.name;
      existing.evidence = f.detail;
      existing.lastSeen = nowIso;
      existing.count = (existing.count || 0) + 1;
      existing.greenStreak = 0;
      existing.status = 'open';
    } else {
      byId.set(id, {
        id,
        severity: sevFor(f.required),
        summary: f.name,
        evidence: f.detail,
        firstSeen: nowIso,
        lastSeen: nowIso,
        count: 1,
        greenStreak: 0,
        status: 'open',
      });
    }
  }

  // 2) Apply green checks: advance the recovery streak; drop when it crosses the threshold.
  for (const t of byId.values()) {
    if (passed.has(t.summary)) {
      t.greenStreak = (t.greenStreak || 0) + 1;
      t.lastGreen = nowIso;
      if (t.greenStreak >= recoverAfter) {
        recovered.push(t.id);
      } else {
        t.status = 'recovering';
      }
    }
  }
  for (const id of recovered) byId.delete(id);

  const tasks = [...byId.values()].sort((a, b) => {
    const rank = (s) => (s === 'high' ? 0 : s === 'medium' ? 1 : 2);
    if (rank(a.severity) !== rank(b.severity)) return rank(a.severity) - rank(b.severity);
    return (a.firstSeen || '').localeCompare(b.firstSeen || '');
  });

  return {
    queue: { updatedAt: nowIso, lastReportAt: typeof rep.at === 'string' ? rep.at : null, tasks },
    recovered,
  };
}

/** Compact markdown the annal/brief pipeline ingests. Never throws. */
export function renderMarkdown(queue) {
  const q = queue && typeof queue === 'object' ? queue : {};
  const tasks = Array.isArray(q.tasks) ? q.tasks : [];
  const open = tasks.filter((t) => t.status !== 'recovering');
  const lines = [
    '# Self-fix queue (from alpha-e2e diagnostics)',
    '',
    `_Updated ${q.updatedAt || '?'} · last report ${q.lastReportAt || '?'} · ${open.length} open / ${tasks.length} tracked_`,
    '',
  ];
  if (tasks.length === 0) {
    lines.push('No failing checks. Stack is green. ✅', '');
    return lines.join('\n');
  }
  for (const t of tasks) {
    const flag = t.status === 'recovering' ? ' _(recovering)_' : '';
    lines.push(`## [${(t.severity || '?').toUpperCase()}] ${t.summary}${flag}`);
    lines.push(`- id: \`${t.id}\``);
    lines.push(`- evidence: ${t.evidence || '(none)'}`);
    lines.push(`- seen ${t.count || 1}× · first ${t.firstSeen || '?'} · last ${t.lastSeen || '?'}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Read the existing queue file; returns an empty queue on missing/garbage. Never throws. */
export async function loadQueue(path) {
  try {
    const raw = await _readFile(path);
    const q = JSON.parse(raw);
    if (q && typeof q === 'object' && Array.isArray(q.tasks)) return q;
  } catch { /* missing or malformed -> empty */ }
  return { updatedAt: null, lastReportAt: null, tasks: [] };
}

/**
 * One full pass: load existing queue, merge the report, write JSON + markdown.
 * Returns a small summary { ok, path, mdPath, open, recovered, error? }. Never throws.
 */
export async function runOnce({ report, path = DEFAULT_PATH, recoverAfter = RECOVER_AFTER } = {}) {
  try {
    const prev = await loadQueue(path);
    const { queue, recovered } = mergeReport(prev, report, { now: _now(), recoverAfter });
    const md = renderMarkdown(queue);
    try { await _mkdir(dirname(path)); } catch { /* dir may exist / be unwritable in tests */ }
    await _writeFile(path, JSON.stringify(queue, null, 2) + '\n');
    await _writeFile(mdPathFor(path), md);
    const open = queue.tasks.filter((t) => t.status !== 'recovering').length;
    return { ok: true, path, mdPath: mdPathFor(path), open, tracked: queue.tasks.length, recovered };
  } catch (e) {
    return { ok: false, path, error: e && e.message ? e.message : String(e) };
  }
}

// --- CLI -------------------------------------------------------------------------------
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && process.argv[1].endsWith('diag-to-tasks.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === 'once') {
    const ri = args.indexOf('--report');
    let report;
    if (ri >= 0 && args[ri + 1]) {
      try { report = JSON.parse(await readFile(args[ri + 1], 'utf8')); }
      catch (e) { console.error('could not read --report file:', e.message); process.exit(1); }
    } else {
      // Default: read the alpha-e2e --json report from stdin, OR run it inline if no pipe.
      const piped = await readStdin();
      if (piped.trim()) {
        report = piped;
      } else {
        const { runAll } = await import('./alpha-e2e.mjs');
        report = await runAll();
      }
    }
    const res = await runOnce({ report });
    if (res.ok) {
      console.log(`diag-to-tasks: ${res.open} open / ${res.tracked} tracked → ${res.path}` +
        (res.recovered.length ? ` (recovered: ${res.recovered.join(', ')})` : ''));
      process.exit(0);
    } else {
      console.error('diag-to-tasks failed (soft):', res.error);
      process.exit(0); // never-throw posture: a failed merge must not fail the timer hard
    }
  } else {
    console.log('usage: node integrations/diag-to-tasks.mjs once [--report <file>]   (or pipe alpha-e2e --json)');
    process.exit(2);
  }
}
