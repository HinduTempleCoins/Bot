// queue-progress.mjs — "how close are we to clearing the 1000-item queue?"
//
// A pure/offline reporter. The brain's backlog lives in `.local/queue-items.jsonl`
// (one JSON object per line, `{id, file, section, text, status, ...}`), the list of
// already-handled ids in `.local/handled-ids.txt` (one id per line), and the module
// inventory under `integrations/` etc. is what the queue items map onto.
//
// All inputs are PASSED IN, not read from disk — `progress()` is a pure function the
// tests drive with in-memory data. Only the CLI touches the real `.local` files, via
// an injectable reader (`__setReader`) so even the CLI path stays testable/offline.
//
//   import { progress, renderProgress } from './tools/queue-progress.mjs'
//   const p = progress({ queueItems, handledIds, modules });
//   console.log(renderProgress(p));
//
//   node tools/queue-progress.mjs            # reads the real .local files
//
// Shape:
//   progress(...) -> { total, handled, remaining, pctDone, byArea }
//   byArea[area]  -> { total, handled, remaining, pctDone }
//
// soft-fail-never-throw: malformed input degrades to zeros, never throws.

import fs from 'node:fs';
import path from 'node:path';

const QUEUE_FILE = '.local/queue-items.jsonl';
const HANDLED_FILE = '.local/handled-ids.txt';

// esc() — HTML-escape any interpolation. The reporter renders markdown, but a module/
// section name could carry angle brackets, so escape defensively for any HTML embed.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// derive the "area" of a queue item: the top-level dir of its `file` path
// (integrations/, witness/, tutorial/, ...), else the item's explicit `area`, else 'other'.
function areaOf(item) {
  if (!item || typeof item !== 'object') return 'other';
  if (item.area) return String(item.area);
  const f = item.file;
  if (!f || typeof f !== 'string') return 'other';
  // queue links sometimes use `dir__file.md` joiners; normalize both separators.
  const norm = f.replace(/__/g, '/').replace(/\\/g, '/').replace(/^\.?\/+/, '');
  const head = norm.split('/')[0];
  if (!head) return 'other';
  if (head.endsWith('.md') || /\.[a-z0-9]+$/i.test(head)) return 'root'; // bare top-level file
  return head;
}

function pct(handled, total) {
  if (!total || total <= 0) return 0;
  return Math.round((handled / total) * 1000) / 10; // one decimal place
}

// progress({queueItems, handledIds, modules}) -> {total, handled, remaining, pctDone, byArea}
//   queueItems: array of {id, file, section, text, status, area?}
//   handledIds: array (or Set) of ids that are done. An item is also counted handled
//               if its own status is 'done'/'closed'/'handled'/'resolved'.
//   modules:    array of module paths/names (the integrations/ etc inventory). Optional;
//               surfaces as `moduleCount` and per-area module tallies for context.
export function progress({ queueItems, handledIds, modules } = {}) {
  const items = Array.isArray(queueItems) ? queueItems : [];
  const handledSet = new Set(
    (handledIds instanceof Set ? [...handledIds] : Array.isArray(handledIds) ? handledIds : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
  );
  const mods = Array.isArray(modules) ? modules.filter((m) => typeof m === 'string') : [];

  const DONE_STATUS = new Set(['done', 'closed', 'handled', 'resolved', 'complete', 'completed']);
  const isHandled = (it) => {
    const id = it && it.id != null ? String(it.id).trim() : '';
    if (id && handledSet.has(id)) return true;
    const st = it && it.status != null ? String(it.status).trim().toLowerCase() : '';
    return DONE_STATUS.has(st);
  };

  const byArea = {};
  let total = 0;
  let handled = 0;

  for (const it of items) {
    total += 1;
    const a = areaOf(it);
    const done = isHandled(it);
    if (done) handled += 1;
    const bucket = byArea[a] || (byArea[a] = { total: 0, handled: 0, remaining: 0, pctDone: 0, modules: 0 });
    bucket.total += 1;
    if (done) bucket.handled += 1;
  }

  // module tallies per area (best-effort context; a module path's top dir = its area)
  let moduleCount = 0;
  for (const m of mods) {
    moduleCount += 1;
    const a = areaOf({ file: m });
    const bucket = byArea[a] || (byArea[a] = { total: 0, handled: 0, remaining: 0, pctDone: 0, modules: 0 });
    bucket.modules += 1;
  }

  for (const a of Object.keys(byArea)) {
    const b = byArea[a];
    b.remaining = Math.max(0, b.total - b.handled);
    b.pctDone = pct(b.handled, b.total);
  }

  return {
    total,
    handled,
    remaining: Math.max(0, total - handled),
    pctDone: pct(handled, total),
    moduleCount,
    byArea,
  };
}

// a plain ASCII progress bar of `width` cells for the given fraction.
function bar(pctDone, width = 24) {
  const frac = Math.max(0, Math.min(100, Number(pctDone) || 0)) / 100;
  const filled = Math.round(frac * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

// renderProgress(p) -> plain markdown: a top-line bar + counts, then a per-area table.
export function renderProgress(p) {
  const r = p && typeof p === 'object' ? p : {};
  const total = Number(r.total) || 0;
  const handled = Number(r.handled) || 0;
  const remaining = Number(r.remaining) || 0;
  const pctDone = Number(r.pctDone) || 0;
  const byArea = r.byArea && typeof r.byArea === 'object' ? r.byArea : {};

  const lines = [];
  lines.push('# Queue progress');
  lines.push('');
  lines.push('`' + bar(pctDone) + '` **' + pctDone + '%**');
  lines.push('');
  lines.push(`- total: **${total}**`);
  lines.push(`- handled: **${handled}**`);
  lines.push(`- remaining: **${remaining}**`);
  if (r.moduleCount != null) lines.push(`- modules in inventory: **${Number(r.moduleCount) || 0}**`);
  lines.push('');

  const areas = Object.keys(byArea).sort((a, b) => {
    const ra = byArea[a].remaining || 0;
    const rb = byArea[b].remaining || 0;
    if (rb !== ra) return rb - ra; // most-remaining first
    return a.localeCompare(b);
  });

  if (areas.length) {
    lines.push('## By area');
    lines.push('');
    lines.push('| area | done | total | remaining | % | progress |');
    lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
    for (const a of areas) {
      const b = byArea[a];
      lines.push(
        `| ${a} | ${Number(b.handled) || 0} | ${Number(b.total) || 0} | ${Number(b.remaining) || 0} | ${Number(b.pctDone) || 0}% | \`${bar(b.pctDone, 12)}\` |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---- injectable reader seam (CLI only) -------------------------------------
let _read = (p) => fs.readFileSync(p, 'utf8');
export function __setReader(fn) {
  _read = typeof fn === 'function' ? fn : ((p) => fs.readFileSync(p, 'utf8'));
}

// parse the real .local files via the injected reader; soft-fail to empty.
function readQueueItems(file) {
  let raw = '';
  try { raw = _read(file); } catch { return []; }
  const out = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed line */ }
  }
  return out;
}

function readHandledIds(file) {
  let raw = '';
  try { raw = _read(file); } catch { return []; }
  return String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// scan a module inventory directory for *.mjs modules (skips *.test.* and non-modules).
function readModuleInventory(dirs) {
  const out = [];
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (!e.endsWith('.mjs') && !e.endsWith('.js')) continue;
      if (/\.test\.[mc]?js$/.test(e)) continue;
      out.push(path.posix.join(path.basename(dir), e));
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('queue-progress.mjs')) {
  const root = process.cwd();
  const queueItems = readQueueItems(path.join(root, QUEUE_FILE));
  const handledIds = readHandledIds(path.join(root, HANDLED_FILE));
  const modules = readModuleInventory([
    path.join(root, 'integrations'),
    path.join(root, 'tools'),
  ]);
  const p = progress({ queueItems, handledIds, modules });
  console.log(renderProgress(p));
}
