// site/hathor-live/exams-store.mjs — append-only JSONL for exam sittings, keyed by an opaque id.
//
// Same posture as reports-store.mjs, and for the same reasons: sittings are append-only by nature,
// the volume is small, and a flat file is the format an operator can read, grep and back up without
// a migration. Every function soft-fails — a missing file, an unreadable line, a full disk — and
// nothing here throws into the request path.
//
// WHAT IS IN A RECORD. A participant id that is a one-way hash of a key only the participant holds,
// an exam id, the state card, the trial data, and the derived score. There is no name field, no
// email field and no account, because there is nothing to attach one to.
//
// DELETION. `forget(pid)` appends a tombstone rather than rewriting history, and reads fold it, so
// a delete is itself an append and cannot corrupt the file halfway through. After a tombstone the
// participant's sittings are gone from every read path in this module.
//
// SESSION NUMBERING is the whole reason the store exists. `sessionNumber` and `daysSinceFirst` are
// computed on write, so the within-subject analysis — you against you — is available without
// reconstructing a timeline from timestamps later.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = process.env.HATHOR_EXAMS_PATH
  || path.join(process.env.HOME || '/tmp', '.hathor', 'exams.jsonl');

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

const DAY_MS = 86400000;

/**
 * Read every sitting, dropping anything belonging to a participant who asked to be forgotten.
 *
 * A torn line loses one sitting, not the file — the same rule as reports-store.
 */
export function readSittings({ file = DEFAULT_PATH, exam = null, pid = null } = {}) {
  const raw = io().read(file);
  if (!raw) return [];
  const forgotten = new Set();
  const rows = [];
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.tombstone && rec.pid) { forgotten.add(rec.pid); continue; }
    if (!rec.pid || !rec.exam) continue;
    rows.push(rec);
  }
  return rows.filter((r) => !forgotten.has(r.pid)
    && (!exam || r.exam === exam)
    && (!pid || r.pid === pid));
}

/** Every previous sitting of one exam by one participant, oldest first. */
export function history(pid, exam, opts = {}) {
  return readSittings({ ...opts, exam, pid })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * Append one sitting. Returns { ok, sitting } — and `ok:false` genuinely means nothing was written,
 * so the caller must not tell the participant it was received. (Charter: prove, don't claim.)
 *
 * `pid` must already be the hashed participant id. This module never sees a raw key and has no code
 * path that could accidentally store one.
 */
export function appendSitting(sitting, { file = DEFAULT_PATH, now = () => new Date() } = {}) {
  if (!sitting || typeof sitting !== 'object' || !sitting.pid || !sitting.exam) {
    return { ok: false, reason: 'a sitting needs a participant id and an exam id' };
  }
  const at = now().toISOString();
  const prior = history(sitting.pid, sitting.exam, { file });
  const first = prior.length ? prior[0].at : at;
  const daysSinceFirst = Math.max(0, Math.round((Date.parse(at) - Date.parse(first)) / DAY_MS));
  const rec = {
    ...sitting,
    at,
    sessionNumber: prior.length + 1,
    daysSinceFirst,
  };
  const wrote = io().append(file, `${JSON.stringify(rec)}\n`);
  return wrote ? { ok: true, sitting: rec } : { ok: false, reason: 'could not write — nothing was saved' };
}

/**
 * Forget a participant. Appends a tombstone; every read path in this module honours it.
 *
 * Note what this cannot do: a person who lost their key cannot be forgotten, because nothing here
 * knows which rows are theirs. The consent copy says so before they start rather than after.
 */
export function forget(pid, { file = DEFAULT_PATH, now = () => new Date() } = {}) {
  if (!pid) return false;
  return io().append(file, `${JSON.stringify({ tombstone: true, pid, at: now().toISOString() })}\n`);
}

/**
 * How many people have completed each exam here, for the reference-class sentence.
 * Counts PARTICIPANTS, not sittings — a repeat taker is one person, and saying otherwise would
 * inflate the only number the honest-reporting rule lets us print.
 */
export function completionCounts(opts = {}) {
  const byExam = new Map();
  for (const s of readSittings(opts)) {
    if (!byExam.has(s.exam)) byExam.set(s.exam, new Set());
    byExam.get(s.exam).add(s.pid);
  }
  const out = {};
  for (const [exam, people] of byExam) out[exam] = people.size;
  return out;
}

/** The distribution of a numeric field for one exam — first sittings only, so repeats do not stack. */
export function distribution(exam, field, opts = {}) {
  const firsts = new Map();
  for (const s of readSittings({ ...opts, exam })) {
    const v = Number(s && s.score && s.score[field]);
    if (!Number.isFinite(v)) continue;
    if (!firsts.has(s.pid) || String(s.at) < String(firsts.get(s.pid).at)) firsts.set(s.pid, { at: s.at, v });
  }
  return [...firsts.values()].map((x) => x.v).sort((a, b) => a - b);
}

export const EXAMS_PATH = DEFAULT_PATH;

export default { readSittings, history, appendSitting, forget, completionCounts, distribution, __setIO, EXAMS_PATH };
