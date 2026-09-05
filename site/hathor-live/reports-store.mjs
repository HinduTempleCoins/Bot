// site/hathor-live/reports-store.mjs — append-only JSONL store for the report archive.
//
// Why JSONL and not a database: reports are append-only by nature, the volume is small, and a flat
// file is the format an operator can read, grep, back up and hand to a court without a migration.
// Moderation edits append a new status record rather than rewriting history — the archive keeps
// what was submitted, separately from what was published.
//
// Every function soft-fails. A missing file, an unreadable line, a full disk: the page still
// renders, the archive is just short. Nothing here throws into the request path.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = process.env.HATHOR_REPORTS_PATH
  || path.join(process.env.HOME || '/tmp', '.hathor', 'reports.jsonl');

// injectable for tests — no fs in the offline suite
let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }

function io() {
  return _io || {
    read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } },
    append(p, line) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.appendFileSync(p, line, 'utf8');
        return true;
      } catch { return false; }
    },
  };
}

/**
 * Read every record, then fold status changes over the submissions.
 * A record is either a full report (has `protocol`) or a status patch (`{id, status}`).
 */
export function readReports({ file = DEFAULT_PATH } = {}) {
  const raw = io().read(file);
  if (!raw) return [];
  const byId = new Map();
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; } // a torn line loses one report, not the file
    if (!rec || typeof rec !== 'object' || !rec.id) continue;
    if (rec.protocol != null) {
      byId.set(rec.id, { ...rec });
    } else if (byId.has(rec.id) && rec.status) {
      byId.set(rec.id, { ...byId.get(rec.id), status: rec.status, moderated: rec.moderated || rec.at || '' });
    }
  }
  return [...byId.values()];
}

/** Append one validated report. Returns true if it reached disk. */
export function appendReport(report, { file = DEFAULT_PATH } = {}) {
  if (!report || typeof report !== 'object' || !report.id) return false;
  try {
    return io().append(file, JSON.stringify(report) + '\n');
  } catch { return false; }
}

/** Append a moderation decision. `status` must be one the caller has already validated. */
export function setStatus(id, status, { file = DEFAULT_PATH, now = () => new Date() } = {}) {
  if (!id || !status) return false;
  try {
    return io().append(file, JSON.stringify({ id, status, moderated: now().toISOString() }) + '\n');
  } catch { return false; }
}

export const REPORTS_PATH = DEFAULT_PATH;
