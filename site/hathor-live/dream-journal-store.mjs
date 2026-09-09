// site/hathor-live/dream-journal-store.mjs — the most intimate store in the battery, built accordingly.
//
// WHY THIS IS NOT exams-store.mjs. An exam sitting is a number about a person. A dream entry is the
// person's own account of their inner life, in their own words, at 4 a.m. The two do not deserve the
// same retention posture, and the differences below are deliberate rather than incidental:
//
//   1. NO CROSS-PARTICIPANT CONTENT READ PATH EXISTS. exams-store has `distribution()` and
//      `readSittings()` — functions that walk every row for everyone, because a percentile needs a
//      denominator. This module has no such function and must never grow one. The only aggregate
//      here is `participantCount()`, which returns an integer and touches no content. A dream
//      journal is grade ③ (within-person): nobody else has your baseline, so there is nothing a
//      cross-participant read could legitimately compute. See .local/temple-exams/
//      dreams-induction-and-interpretation.md §10 — no share card, export only.
//
//   2. `forget()` ACTUALLY EMPTIES IT. exams-store appends a tombstone and folds it on read, which
//      hides the rows while leaving the bytes on disk. That is the right trade for scores. It is the
//      wrong trade for dream text. Here, forget REWRITES the file without that participant's records
//      and renames it into place. If the rewrite cannot be done, the call returns ok:false and says
//      so — it does not report a deletion that did not happen. (Charter: prove, don't claim.)
//
//   3. NOTHING GOES ON CHAIN. Not a hash, not a count, not a boolean. There is no emit path in this
//      file and there must never be one; a pseudonym on a public ledger is permanent and globally
//      readable, and a permanent public record of who keeps a dream journal is the harm.
//
// WHAT THE SERVER SEES. `pid` — the salted one-way hash from participant-key.mjs. This module has no
// parameter, no field and no code path that accepts a raw key, and a test greps the written bytes
// for one. The key lives in the participant's browser; the hash is the server's business.
//
// ⚠️ BACKFILL IS MARKED, FOREVER. Stone, Shiffman, Schwartz, Broderick & Hufford (2003), Controlled
// Clinical Trials 24(2):182–199, doi:10.1016/s0197-2456(02)00320-3, instrumented a paper diary binder
// and found 90% claimed compliance against 11% actual — the binder was not opened on 32% of study
// days that nonetheless reported >90% compliance; an electronic diary with compliance features ran
// at 94%. So an entry records BOTH the night it is about and the moment it was written, and the lag
// between them is computed on write and printed on export. A record that cannot tell a dream written
// at 06:10 from one reconstructed on Sunday afternoon is, on that evidence, most likely to be the
// 11% case wearing the 90% claim. Marking it is what makes the honest entries worth anything.
//
// House style: ESM, soft-fail-never-throw, injectable IO, offline-testable, no network.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATH = process.env.HATHOR_DREAMS_PATH
  || path.join(process.env.HOME || '/tmp', '.hathor', 'dream-journal.jsonl');

// Injectable IO, so the offline suite never touches a disk and so a test can watch exactly what
// bytes were written — which is how the "no raw key on disk" assertion is actually proved.
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
    // Replace is separate from append because forget() is the one operation that must not be an
    // append. Written to a sibling temp file and renamed, so a crash mid-write leaves the old file
    // intact rather than a half-erased one.
    replace(p, contents) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const tmp = `${p}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, contents, 'utf8');
        fs.renameSync(tmp, p);
        return true;
      } catch { return false; }
    },
  };
}

const DAY_MS = 86400000;

/** How complete the recall was. Ordered worst-to-best; the order is the scale. */
export const RECALL_LEVELS = Object.freeze(['none', 'fragment', 'scene', 'full']);

/**
 * The lucidity ordinal, 0–4.
 *
 * ⚠️ THIS IS OUR SCALE AND IT IS NOT A VALIDATED INSTRUMENT. It is defined here, in the open, so a
 * person's entries are comparable to their OWN earlier entries and to nothing else. It is not the
 * LuCiD scale, it is not derived from one, and a number on it means nothing across two people. The
 * paper asked for an ordinal rather than a boolean for a specific reason: "was it lucid" throws away
 * the most common and most trainable part of the phenomenon, which is the near miss.
 */
export const LUCIDITY_LEVELS = Object.freeze([
  { level: 0, label: 'not lucid', note: 'No awareness at any point that it was a dream.' },
  { level: 1, label: 'a flicker', note: 'Something felt wrong, or the question was almost asked, and then it passed.' },
  { level: 2, label: 'knew it was a dream', note: 'Explicit recognition, but the dream ran on without you steering it.' },
  { level: 3, label: 'knew it and acted', note: 'Recognition plus at least one deliberate act taken because of it.' },
  { level: 4, label: 'sustained', note: 'Recognition held across a stretch of the dream, with more than one deliberate act.' },
]);

/** Light-switch outcomes — the R4 replication. Note that "worked" is only one of five. */
export const LIGHT_SWITCH_OUTCOMES = Object.freeze([
  'did not try', 'worked normally', 'flickered or dimmed', 'no response at all',
  'could not find the switch', 'brighter than expected',
]);

/**
 * Coerce to a finite number, or null.
 *
 * ⚠️ `Number()` is generous in exactly the directions that produce a silent wrong answer, and every
 * one of these was found by a test that passed the value explicitly rather than omitting it:
 *   Number(null) === 0 · Number('') === 0 · Number('   ') === 0 · Number([]) === 0 · Number(true) === 1
 * A window of "0 days" reported to somebody with a year of entries is not an error anybody sees. So
 * everything that is not a number or a non-blank numeric string is rejected BEFORE Number() runs.
 */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null; // arrays and objects: Number([]) is 0, Number([5]) is 5
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A calendar day string, or ''. Never throws, never guesses a date it was not given. */
function day(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * normaliseEntry — everything an entry may carry, and nothing it may not.
 *
 * ⚠️ `opts` is NOT destructured with `= {}`. A destructuring default fires only for `undefined`, so
 * an explicit `null` from a JSON body would have thrown out of a module whose contract is
 * soft-fail-never-throw. Normalise, then read.
 *
 * ⛔ FIELDS THAT ARE REFUSED, not merely unused: anything resembling a name, an email, a location or
 * a raw participant key. `KEY_FIELDS` is checked by name so that a caller who passes `{ key: '...' }`
 * by habit gets it dropped here rather than written to disk.
 */
const KEY_FIELDS = Object.freeze(['key', 'participantKey', 'rawKey', 'secret', 'name', 'email', 'phone']);

export function normaliseEntry(input) {
  const e = (input && typeof input === 'object') ? input : {};
  const lucidity = num(e.lucidity);
  const recall = RECALL_LEVELS.includes(String(e.recall || '').toLowerCase())
    ? String(e.recall).toLowerCase() : 'none';
  const out = {
    // The night the entry is ABOUT. Distinct from `at`, which is when it was written.
    night: day(e.night),
    wakeTime: /^\d{2}:\d{2}$/.test(String(e.wakeTime || '')) ? String(e.wakeTime) : '',
    wbtb: e.wbtb === true,
    technique: String(e.technique == null ? '' : e.technique).slice(0, 40),
    lucidity: (lucidity != null && lucidity >= 0 && lucidity <= 4) ? Math.round(lucidity) : 0,
    recall,
    // Did a reality check fire INSIDE the dream — the thing the induction literature actually cares
    // about, and a different question from whether one was done while awake.
    checkFiredInDream: e.checkFiredInDream === true,
    // R2 — the waking adherence log. Which checks, and whether doubt was genuinely held.
    checksDone: Array.isArray(e.checksDone)
      ? e.checksDone.slice(0, 20).map((c) => ({
        check: String((c && c.check) == null ? '' : c.check).slice(0, 40),
        doubtHeld: !!(c && c.doubtHeld),
      })).filter((c) => c.check)
      : [],
    // R4 — the light-switch replication. Brightness, not success: see the module docs on /dreams.
    lightSwitch: LIGHT_SWITCH_OUTCOMES.includes(String(e.lightSwitch || ''))
      ? String(e.lightSwitch) : 'did not try',
    // The person's OWN tags. No controlled vocabulary — imposing a symbol taxonomy would be
    // interpretation by the back door, which §10.1 forbids outright.
    tags: Array.isArray(e.tags)
      ? [...new Set(e.tags.map((t) => String(t == null ? '' : t).trim().slice(0, 40)).filter(Boolean))].slice(0, 24)
      : [],
    text: String(e.text == null ? '' : e.text).slice(0, 20000),
    // The State Card, already validated by state-card.mjs before it gets here.
    state: (e.state && typeof e.state === 'object') ? e.state : null,
  };
  for (const f of KEY_FIELDS) delete out[f];
  return out;
}

/** Every entry for one participant, oldest first. The ONLY content read path in this module. */
export function entriesFor(pid, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const file = o.file || DEFAULT_PATH;
  if (!pid) return [];
  const raw = io().read(file);
  if (!raw) return [];
  const forgotten = new Set();
  const rows = [];
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    // A torn line loses one entry, not the journal.
    try { rec = JSON.parse(t); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.tombstone && rec.pid) { forgotten.add(rec.pid); continue; }
    if (rec.pid !== pid) continue;
    rows.push(rec);
  }
  if (forgotten.has(pid)) return [];
  return rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * appendEntry — returns { ok, entry }. `ok:false` genuinely means nothing was written, so a caller
 * must not tell the person their dream was saved.
 *
 * `pid` must already be hashed. There is no code path here that could store a raw key.
 */
export function appendEntry(pid, entry, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const file = o.file || DEFAULT_PATH;
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  if (!pid || typeof pid !== 'string') {
    return { ok: false, reason: 'an entry needs a participant id — nothing was saved' };
  }
  const at = now().toISOString();
  const body = normaliseEntry(entry);
  // The night defaults to the day the entry was written only when the writer gave none; when they
  // did give one, the lag between the two is the whole point and is never smoothed away.
  const night = body.night || at.slice(0, 10);
  const lagDays = Math.max(0, Math.round((Date.parse(`${at.slice(0, 10)}T00:00:00Z`) - Date.parse(`${night}T00:00:00Z`)) / DAY_MS));
  const prior = entriesFor(pid, { file });
  const first = prior.length ? prior[0].at : at;
  const rec = {
    pid,
    at,
    ...body,
    night,
    // ⚠️ Permanent and printed on export. See the module header on Stone et al. 2003.
    lagDays,
    backfilled: lagDays > 0,
    entryNumber: prior.length + 1,
    daysSinceFirst: Math.max(0, Math.round((Date.parse(at) - Date.parse(first)) / DAY_MS)),
  };
  const wrote = io().append(file, `${JSON.stringify(rec)}\n`);
  return wrote ? { ok: true, entry: rec } : { ok: false, reason: 'could not write — nothing was saved' };
}

/**
 * forget(pid) — actually empties it.
 *
 * Rewrites the file without that participant's records rather than hiding them behind a tombstone,
 * because the bytes here are dream text. Returns { ok, removed, method }. On a failed rewrite it
 * falls back to appending a tombstone so that every read path still hides the rows, and it SAYS SO
 * in `method` — a partial deletion reported as a full one is the failure this repo's charter names.
 *
 * ⚠️ What this cannot do: a person who lost their key cannot be forgotten, because nothing here
 * knows which rows are theirs. The consent copy says that BEFORE they start, not after.
 */
export function forget(pid, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const file = o.file || DEFAULT_PATH;
  const now = typeof o.now === 'function' ? o.now : () => new Date();
  if (!pid || typeof pid !== 'string') return { ok: false, removed: 0, method: 'none', reason: 'no participant id' };

  const raw = io().read(file);
  if (!raw) return { ok: true, removed: 0, method: 'nothing-to-remove' };

  const kept = [];
  let removed = 0;
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec = null;
    try { rec = JSON.parse(t); } catch { rec = null; }
    // An unparseable line is kept: it cannot be attributed to this participant, and silently
    // discarding somebody else's torn row while claiming to delete yours would be a different bug.
    if (!rec || typeof rec !== 'object') { kept.push(t); continue; }
    if (rec.pid === pid) { removed += 1; continue; }
    kept.push(t);
  }
  if (!removed) return { ok: true, removed: 0, method: 'nothing-to-remove' };

  const wrote = io().replace(file, kept.length ? `${kept.join('\n')}\n` : '');
  if (wrote) return { ok: true, removed, method: 'rewritten' };

  const hid = io().append(file, `${JSON.stringify({ tombstone: true, pid, at: now().toISOString() })}\n`);
  return hid
    ? {
      ok: false,
      removed: 0,
      method: 'tombstoned-only',
      reason: 'The rewrite failed. Your entries are hidden from every read path, but the bytes are '
        + 'still on disk. That is not the deletion you asked for — please try again.',
    }
    : { ok: false, removed: 0, method: 'none', reason: 'Could not write. Nothing was deleted.' };
}

/**
 * participantCount — the ONLY aggregate in this module, and it counts people, never content.
 * It exists so a page can say "n people keep a journal here" without any path that could read one.
 */
export function participantCount(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const raw = io().read(o.file || DEFAULT_PATH);
  if (!raw) return 0;
  const people = new Set();
  const forgotten = new Set();
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (!rec || typeof rec !== 'object' || !rec.pid) continue;
    if (rec.tombstone) { forgotten.add(rec.pid); continue; }
    people.add(rec.pid);
  }
  for (const p of forgotten) people.delete(p);
  return people.size;
}

export const DREAMS_PATH = DEFAULT_PATH;

export default {
  RECALL_LEVELS, LUCIDITY_LEVELS, LIGHT_SWITCH_OUTCOMES,
  num, normaliseEntry, entriesFor, appendEntry, forget, participantCount, __setIO, DREAMS_PATH,
};
