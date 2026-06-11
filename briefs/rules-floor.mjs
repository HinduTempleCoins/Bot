// rules-floor.mjs — the DETERMINISTIC floor under a Brief.
//
// A Brief (BRIEF_PROTOCOL.md) is "deterministic floor + LLM polish". This module IS the floor:
// given the tracker's backlog items, it scores and buckets them into a stable, reproducible Brief
// skeleton — BEFORE any model touches it. Same items in → byte-identical skeleton out. The LLM
// (granite-common / Claude) then only polishes prose on top; the ranking itself never depends on a
// model, so a Brief is auditable and forkable (BRIEF.md §10 Phase 3).
//
//   import { scoreItem, rankItems, buildFloor, renderMarkdown } from './rules-floor.mjs'
//   buildFloor(items)              -> { readFirst, doNext, blocked, deferred, counts }
//   renderMarkdown(buildFloor(...)) -> a stable Brief skeleton (esc-safe plain markdown)
//
// item shape (the tracker's, .local/queue-items.jsonl):
//   { id, file, section, text, status, dependsHint, links }
//     status:      'open' | 'in_progress' | 'blocked' | 'done' | 'closed' | (anything else → 'open')
//     dependsHint: truthy string ⇒ has an unmet dependency (deprioritized / blocked-leaning)
//     file/section/text: strings used for priority signals + display
//
// Scoring is a transparent weighted sum (all knobs in WEIGHTS). Higher = more urgent. Pure,
// offline, soft-fail-never-throw. No Date.now() — recency, if used, is caller-injected.

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- tunable weights (the whole policy lives here, legibly) ---------------------------------
export const WEIGHTS = Object.freeze({
  statusInProgress: 100, // finish what's started first
  statusOpen: 50,
  statusBlocked: 10, // visible but low — needs an unblock, not doing
  operatorAsk: 40, // items that trace to a preserved operator ask rank up
  priorityPath: 25, // Hathor / Cheetah / Signup paths are load-bearing (resident-AI index priority)
  hasDependency: -30, // an unmet dependency pushes it down (can't start cleanly)
  shortActionable: 8, // a crisp short item is likelier to be a clean next-action
});

// Paths the resident-AI index weights highest (per CLAUDE.md). Matched case-insensitively.
const PRIORITY_PATHS = ['hathor', 'cheetah', 'signup', 'witness', 'brief'];
const OPERATOR_ASK_HINT = /\b(operator|ryan|you asked|i asked|i told you|i need|please|make|let'?s)\b/i;

const normStatus = (s) => {
  const v = String(s ?? '').trim().toLowerCase();
  if (v === 'in_progress' || v === 'in-progress' || v === 'wip') return 'in_progress';
  if (v === 'blocked') return 'blocked';
  if (v === 'done' || v === 'closed' || v === 'complete' || v === 'completed') return 'done';
  return 'open';
};

const isDone = (item) => normStatus(item && item.status) === 'done';

/**
 * Score one item. Pure, deterministic, never throws. Higher = more urgent.
 * Returns 0 for a falsy/garbage item (soft-fail).
 */
export function scoreItem(item, weights = WEIGHTS) {
  if (!item || typeof item !== 'object') return 0;
  const w = { ...WEIGHTS, ...(weights || {}) };
  let score = 0;
  const status = normStatus(item.status);
  if (status === 'in_progress') score += w.statusInProgress;
  else if (status === 'open') score += w.statusOpen;
  else if (status === 'blocked') score += w.statusBlocked;
  // done items score 0 contribution from status (they're filtered out of the floor anyway)

  const hay = `${item.file || ''} ${item.section || ''}`.toLowerCase();
  if (PRIORITY_PATHS.some((p) => hay.includes(p))) score += w.priorityPath;

  const text = String(item.text || '');
  if (OPERATOR_ASK_HINT.test(text) || OPERATOR_ASK_HINT.test(item.section || '')) score += w.operatorAsk;

  if (item.dependsHint) score += w.hasDependency; // negative weight

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (wordCount > 0 && wordCount <= 18) score += w.shortActionable;

  return score;
}

/**
 * Rank items most-urgent-first. Done/closed items are dropped. Stable: ties break by id so the
 * order is byte-reproducible. Non-array input → []. Never throws.
 */
export function rankItems(items, weights = WEIGHTS) {
  const list = Array.isArray(items) ? items.filter((i) => i && !isDone(i)) : [];
  return list
    .map((item) => ({ item, score: scoreItem(item, weights) }))
    .sort((a, b) => b.score - a.score || String(a.item.id ?? '').localeCompare(String(b.item.id ?? '')))
    .map((x) => x.item);
}

/**
 * Bucket ranked items into a Brief skeleton:
 *   readFirst  — in_progress items (finish these), top of the brief
 *   doNext     — open, no unmet dependency, ranked
 *   blocked    — status blocked OR has a dependsHint (needs an unblock first)
 *   deferred   — everything else still-open that didn't make the doNext cut (cap keeps the brief tight)
 * Pure, deterministic, soft-fail to empty buckets.
 */
export function buildFloor(items, opts = {}) {
  const o = opts || {};
  const doNextCap = Number.isFinite(o.doNextCap) ? o.doNextCap : 12;
  const weights = o.weights || WEIGHTS;
  const ranked = rankItems(items, weights);

  const readFirst = [];
  const blocked = [];
  const openable = [];
  for (const item of ranked) {
    const status = normStatus(item.status);
    if (status === 'in_progress') readFirst.push(item);
    else if (status === 'blocked' || item.dependsHint) blocked.push(item);
    else openable.push(item);
  }
  const doNext = openable.slice(0, doNextCap);
  const deferred = openable.slice(doNextCap);

  return {
    readFirst,
    doNext,
    blocked,
    deferred,
    counts: {
      total: ranked.length,
      readFirst: readFirst.length,
      doNext: doNext.length,
      blocked: blocked.length,
      deferred: deferred.length,
    },
  };
}

const line = (item) => {
  const id = esc(item.id ?? '?');
  const where = item.file ? ` _(${esc(item.file)})_` : '';
  const text = esc(String(item.text || '').replace(/\s+/g, ' ').trim().slice(0, 160));
  return `- \`${id}\` ${text}${where}`;
};

/**
 * Render a floor as a stable Brief skeleton (plain markdown, every field esc()'d). Byte-identical
 * for identical input — this is the deterministic artifact the LLM polishes. Never throws.
 */
export function renderMarkdown(floor) {
  const f = floor && typeof floor === 'object' ? floor : buildFloor([]);
  const out = [];
  out.push('## Brief skeleton (deterministic floor)');
  out.push('');
  const c = f.counts || {};
  out.push(
    `_${c.total ?? 0} open · ${c.readFirst ?? 0} in-progress · ${c.doNext ?? 0} do-next · ${c.blocked ?? 0} blocked · ${c.deferred ?? 0} deferred_`,
  );
  out.push('');
  const section = (title, arr) => {
    out.push(`### ${title}`);
    if (!arr || !arr.length) out.push('_(none)_');
    else for (const it of arr) out.push(line(it));
    out.push('');
  };
  section('Read first — in progress', f.readFirst);
  section('Do next', f.doNext);
  section('Blocked — unblock first', f.blocked);
  if (f.deferred && f.deferred.length) section(`Deferred (${f.deferred.length})`, f.deferred);
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

// --- CLI (guarded; reads the tracker queue if present, else a tiny demo) ---------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  let items = [];
  try {
    const fs = await import('node:fs');
    const path = '.local/queue-items.jsonl';
    if (fs.existsSync(path)) {
      items = fs
        .readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch {
    /* soft-fail to demo */
  }
  if (!items.length) {
    items = [
      { id: 'demo1', file: 'witness/monitor.mjs', text: 'finish the witness monitor', status: 'in_progress' },
      { id: 'demo2', file: 'signup/help.mjs', text: 'operator asked: wire signup help', status: 'open' },
      { id: 'demo3', file: 'misc.md', text: 'someday refactor', status: 'open', dependsHint: 'needs X' },
    ];
  }
  process.stdout.write(renderMarkdown(buildFloor(items)));
}
