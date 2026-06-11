// backup-manifest.mjs — deterministic backup manifest builder + diff + rotation planner.
// The planning/verification primitive for ITINERARY "Backup automation" / "Daily knowledge base
// backup". This is NOT the backup runner: it performs NO fs writes, NO network, NO secrets. It
// takes already-collected file descriptors ({path,size,mtime,sha256}) and produces a stable,
// comparable manifest so a separate runner can decide what to back up, verify integrity, and
// prune old snapshots.
//
//   import { buildManifest, sortEntries, diffManifests, rotationPlan, formatManifestText } from './backup-manifest.mjs'
//   node tools/backup-manifest.mjs <entries.json>   # prints a plain-text manifest report
//
// Determinism: `generatedAt` is injected (never Date.now in the pure path). Entries sort by path.
// Soft-fail: malformed entries are skipped rather than throwing.

// --- small pure helpers -------------------------------------------------------------------------

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => HTML_ESC[c]); }

function extOf(p) {
  const base = String(p).split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';            // no ext, or dotfile like ".gitignore" -> no ext
  return base.slice(i + 1).toLowerCase();
}

function toInt(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

// a usable entry has at least a string path; everything else is normalized/defaulted.
function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.path !== 'string' || e.path.length === 0) return null;
  return {
    path: e.path,
    size: toInt(e.size),
    mtime: typeof e.mtime === 'string' || typeof e.mtime === 'number' ? e.mtime : null,
    sha256: typeof e.sha256 === 'string' ? e.sha256.toLowerCase() : '',
  };
}

// --- sorting ------------------------------------------------------------------------------------

// deterministic order: by path (codepoint), stable. Skips bad entries.
export function sortEntries(entries) {
  const arr = Array.isArray(entries) ? entries : [];
  const clean = [];
  for (const e of arr) { const n = normalizeEntry(e); if (n) clean.push(n); }
  clean.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return clean;
}

// --- manifest -----------------------------------------------------------------------------------

// build a stable manifest from file descriptors. `generatedAt` is injected (ISO string or null).
export function buildManifest(entries, { generatedAt = null } = {}) {
  const files = sortEntries(entries);
  let totalBytes = 0;
  const byExt = {};
  for (const f of files) {
    totalBytes += f.size;
    const k = extOf(f.path) || '(none)';
    if (!byExt[k]) byExt[k] = { count: 0, bytes: 0 };
    byExt[k].count += 1;
    byExt[k].bytes += f.size;
  }
  // sort byExt keys for a deterministic object shape
  const byExtSorted = {};
  for (const k of Object.keys(byExt).sort()) byExtSorted[k] = byExt[k];
  return {
    generatedAt: generatedAt ?? null,
    count: files.length,
    totalBytes,
    byExt: byExtSorted,
    files,
  };
}

// --- diff ---------------------------------------------------------------------------------------

function indexByPath(manifestOrFiles) {
  const files = Array.isArray(manifestOrFiles)
    ? sortEntries(manifestOrFiles)
    : (manifestOrFiles && Array.isArray(manifestOrFiles.files) ? manifestOrFiles.files : []);
  const map = new Map();
  for (const f of files) map.set(f.path, f);
  return map;
}

// compare two manifests by path; a path is "changed" when sha256 differs (or size, when no sha).
export function diffManifests(prev, next) {
  const a = indexByPath(prev);
  const b = indexByPath(next);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [path, nf] of b) {
    const pf = a.get(path);
    if (!pf) { added.push(path); continue; }
    const shaDiff = pf.sha256 && nf.sha256 ? pf.sha256 !== nf.sha256 : pf.size !== nf.size;
    if (shaDiff) changed.push(path);
  }
  for (const path of a.keys()) if (!b.has(path)) removed.push(path);
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

// --- rotation (grandfather-father-son) ----------------------------------------------------------

// snapshots: [{id, date}] where date is an ISO date/datetime string. Selects which to keep:
//   - the most recent `keepDaily` distinct days
//   - the most recent `keepWeekly` distinct ISO weeks
//   - the most recent `keepMonthly` distinct months
// A snapshot is kept if it is the newest in any retained day/week/month bucket. Everything else
// is pruned. Pure: ranking is by the snapshot's own date string, no clock reads.
function parseDate(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function dayKey(d) { return d.toISOString().slice(0, 10); }                 // YYYY-MM-DD
function monthKey(d) { return d.toISOString().slice(0, 7); }               // YYYY-MM
function weekKey(d) {
  // ISO week: Thursday-based. Compute year-week deterministically (UTC).
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;            // 1..7, Mon..Sun
  dt.setUTCDate(dt.getUTCDate() + 4 - day);   // shift to Thursday of this week
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function rotationPlan(snapshots, { keepDaily = 7, keepWeekly = 4, keepMonthly = 12 } = {}) {
  const arr = Array.isArray(snapshots) ? snapshots : [];
  const clean = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const d = parseDate(s.date);
    if (!d) continue;
    const id = typeof s.id === 'string' && s.id ? s.id : s.date;
    clean.push({ id, date: d.toISOString(), _d: d, _t: d.getTime() });
  }
  // newest first
  clean.sort((a, b) => b._t - a._t);

  const keepIds = new Set();
  // distinct-bucket selection: keep the newest snapshot in each of the most-recent `limit` buckets.
  const selectBuckets = (keyFn, limit) => {
    if (limit <= 0) return;
    const usedBuckets = new Set();
    for (const s of clean) {
      const k = keyFn(s._d);
      if (usedBuckets.has(k)) continue;
      if (usedBuckets.size >= limit) break;
      usedBuckets.add(k);
      keepIds.add(s.id);
    }
  };
  selectBuckets(dayKey, keepDaily);
  selectBuckets(weekKey, keepWeekly);
  selectBuckets(monthKey, keepMonthly);

  const keep = [];
  const prune = [];
  for (const s of clean) {
    const row = { id: s.id, date: s.date };
    if (keepIds.has(s.id)) keep.push(row); else prune.push(row);
  }
  return { keep, prune };
}

// --- report -------------------------------------------------------------------------------------

export function formatManifestText(manifest) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const files = Array.isArray(m.files) ? m.files : [];
  const count = typeof m.count === 'number' ? m.count : files.length;
  const totalBytes = typeof m.totalBytes === 'number' ? m.totalBytes : 0;
  const byExt = m.byExt && typeof m.byExt === 'object' ? m.byExt : {};
  const lines = [];
  lines.push(`Backup manifest — ${m.generatedAt || '(time not set)'}`);
  lines.push('─'.repeat(64));
  lines.push(`files: ${count}    total: ${totalBytes} bytes`);
  const exts = Object.keys(byExt).sort();
  if (exts.length) {
    lines.push('by extension:');
    for (const k of exts) {
      const v = byExt[k] || {};
      lines.push(`  .${k}  ${v.count ?? 0} file(s)  ${v.bytes ?? 0} bytes`);
    }
  }
  lines.push('files:');
  for (const f of files) {
    const sha = f.sha256 ? f.sha256.slice(0, 12) : '(no-sha)';
    lines.push(`  ${sha}  ${String(f.size ?? 0).padStart(10)}  ${f.path}`);
  }
  return lines.join('\n');
}

// --- CLI ----------------------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('backup-manifest.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: backup-manifest.mjs <entries.json>');
    process.exit(1);
  }
  // dynamic import of fs only at the CLI boundary; the library path stays pure / IO-free.
  import('node:fs').then(({ default: fs }) => {
    let entries = [];
    try {
      entries = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`could not read/parse ${file}: ${err.message}`);
      process.exit(1);
    }
    const manifest = buildManifest(entries, { generatedAt: null });
    console.log(formatManifestText(manifest));
  });
}
