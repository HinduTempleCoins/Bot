// feed-state.mjs — Task #39: atomic, resumable state storage for the long-running witness cron
// (the feed publisher loop in feed-publisher.mjs + the general witness loop).
//
// PROBLEM this solves: feed-publisher.mjs holds its `lastPublished` purely in memory. A crash or
// restart loses the place — the cron could re-publish a feed it already sent, or forget the last
// price entirely. This module is the durable backing for that state: it persists `lastPublished`
// (same shape feed-publisher uses: { price, at }) plus run bookkeeping, and it does so SAFELY so a
// mid-write crash never leaves a half-written or double-published state.
//
// GUARANTEES:
//   - ATOMIC writes: every save writes to `<path>.tmp` then renames over `<path>` — readers never
//     observe a partial file (rename is atomic on the same filesystem).
//   - SOFT-FAIL reads: a missing or corrupt state file yields a safe default and NEVER throws;
//     a corrupt file is preserved as `<path>.bak` for forensics before we fall back to default.
//   - A simple lockfile (`<path>.lock`) so two cron instances can't run the loop at once; stale
//     locks (older than maxAgeMs) are stolen.
//   - NO keys, NO secrets, NO broadcast. Pure local state. By construction this file cannot sign.
//
// Everything that touches the filesystem and the clock is injectable, so the tests run fully
// offline against an in-memory fake fs and a fake clock.
//
//   import { loadState, saveState, updateState, withLock, recordPublish } from './feed-state.mjs'

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
  statSync,
} from 'node:fs';

// ---- injectable seams (fs + clock) -----------------------------------------------------------

// Default fs backing: the real synchronous node:fs. Tests inject an in-memory fake via __setFs.
const REAL_FS = {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
  statSync,
};

let _fs = REAL_FS;
let _now = () => Date.now();

/**
 * Inject a filesystem implementation. Must provide:
 *   readFileSync(path, enc) -> string   (throws if missing)
 *   writeFileSync(path, data, enc)
 *   renameSync(from, to)
 *   existsSync(path) -> boolean
 *   unlinkSync(path)
 *   statSync(path) -> { mtimeMs }
 * Pass nothing (or a falsy value) to restore the real node:fs.
 */
export function __setFs(fs) {
  _fs = fs || REAL_FS;
}

/** Inject the clock: a () => epochMs. Pass nothing to restore Date.now. */
export function __setClock(fn) {
  _now = typeof fn === 'function' ? fn : (() => Date.now());
}

// ---- the safe default ------------------------------------------------------------------------

/** A fresh, never-throwing default state. Matches feed-publisher's lastPublished shape. */
export function defaultState() {
  return { lastPublished: null, lastRunAt: null, runCount: 0, cursor: null };
}

// ---- load / save -----------------------------------------------------------------------------

/**
 * Load persisted state. Soft-fail: a missing file returns the default; a corrupt file is moved
 * aside to `<path>.bak` (best-effort) and the default is returned. NEVER throws.
 *
 * @param {string} path
 * @returns {{ lastPublished: any, lastRunAt: number|null, runCount: number, cursor: any }}
 */
export function loadState(path) {
  try {
    if (!_fs.existsSync(path)) return defaultState();
  } catch {
    return defaultState();
  }

  let raw;
  try {
    raw = _fs.readFileSync(path, 'utf8');
  } catch {
    // unreadable (e.g. removed between exists + read) — safe default
    return defaultState();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON: preserve the bad file for forensics, then fall back to default.
    try {
      _fs.renameSync(path, `${path}.bak`);
    } catch {
      // best-effort; never let forensics-keeping block recovery
    }
    return defaultState();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Valid JSON but not a state object (e.g. `null`, `42`, `[]`) — treat as default.
    return defaultState();
  }

  // Merge over the default so missing keys always have safe values.
  return { ...defaultState(), ...parsed };
}

/**
 * Persist state ATOMICALLY: write `<path>.tmp` then rename it over `<path>`. A reader either sees
 * the old file or the new one, never a partial write. Returns { ok }. Soft-fail on error.
 *
 * @param {string} path
 * @param {object} state
 * @returns {{ ok: boolean, error?: string }}
 */
export function saveState(path, state) {
  const tmp = `${path}.tmp`;
  try {
    _fs.writeFileSync(tmp, JSON.stringify(state ?? {}, null, 2), 'utf8');
    _fs.renameSync(tmp, path); // atomic on the same filesystem
    return { ok: true };
  } catch (e) {
    // Best-effort cleanup of the temp file so we don't leave litter behind.
    try {
      if (_fs.existsSync(tmp)) _fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Safe read-modify-write the cron uses each tick: load current state, shallow-merge `patch`, and
 * save atomically. Returns the new state. If the save fails it still returns the merged object so
 * the caller has the intended value, but the on-disk state is unchanged (no partial write).
 *
 * @param {string} path
 * @param {object} patch
 * @returns {object} the merged state
 */
export function updateState(path, patch) {
  const current = loadState(path);
  const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
  saveState(path, next);
  return next;
}

// ---- lock ------------------------------------------------------------------------------------

/**
 * Run `fn` while holding a simple lockfile at `<path>.lock`, so two cron instances can't run the
 * loop concurrently. The lock records the time it was taken; a lock older than `maxAgeMs` is
 * considered stale (the previous holder presumably crashed) and is stolen. A fresh lock throws
 * "already running". The lock is always released in a finally, even when `fn` throws.
 *
 * @param {string} path        the STATE path; the lock is `<path>.lock`
 * @param {() => any|Promise<any>} fn
 * @param {{ maxAgeMs?: number }} [opts]   staleness threshold (default 5 min)
 * @returns {Promise<any>} whatever `fn` returns
 */
export async function withLock(path, fn, { maxAgeMs = 5 * 60 * 1000 } = {}) {
  const lockPath = `${path}.lock`;

  let held = false;
  try {
    held = _fs.existsSync(lockPath);
  } catch {
    held = false;
  }

  if (held) {
    // Determine the lock's age to decide fresh vs. stale.
    let lockedAt = null;
    try {
      const body = JSON.parse(_fs.readFileSync(lockPath, 'utf8'));
      if (body && Number.isFinite(body.at)) lockedAt = body.at;
    } catch {
      // unreadable/corrupt lock — fall back to filesystem mtime if available
      try {
        const st = _fs.statSync(lockPath);
        if (st && Number.isFinite(st.mtimeMs)) lockedAt = st.mtimeMs;
      } catch {
        /* ignore */
      }
    }

    const age = lockedAt == null ? Infinity : _now() - lockedAt;
    if (age <= maxAgeMs) {
      throw new Error('already running');
    }
    // Stale lock — steal it (overwrite below).
  }

  // Acquire (or steal) the lock atomically via tmp→rename.
  const acquired = saveLock(lockPath, { at: _now(), pid: typeof process !== 'undefined' ? process.pid : null });
  if (!acquired.ok) {
    throw new Error(`could not acquire lock: ${acquired.error}`);
  }

  try {
    return await fn();
  } finally {
    try {
      if (_fs.existsSync(lockPath)) _fs.unlinkSync(lockPath);
    } catch {
      // best-effort release; a leftover lock will be reaped as stale next run
    }
  }
}

/** Write the lockfile atomically (tmp→rename), mirroring saveState's safety. */
function saveLock(lockPath, body) {
  const tmp = `${lockPath}.tmp`;
  try {
    _fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
    _fs.renameSync(tmp, lockPath);
    return { ok: true };
  } catch (e) {
    try {
      if (_fs.existsSync(tmp)) _fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ---- convenience -----------------------------------------------------------------------------

/**
 * Convenience RMW for the publisher: record a successful feed publish. Sets `lastPublished` to the
 * feed-publisher shape ({ price, at }), stores the op for forensics, bumps `runCount`, and stamps
 * `lastRunAt`. Returns the new state.
 *
 * @param {string} path
 * @param {{ price: number, op?: any, at?: number }} info
 * @returns {object} the new state
 */
export function recordPublish(path, { price, op = null, at } = {}) {
  const current = loadState(path);
  const stamp = Number.isFinite(at) ? at : _now();
  return updateState(path, {
    lastPublished: { price, at: stamp },
    lastOp: op,
    lastRunAt: stamp,
    runCount: (Number.isFinite(current.runCount) ? current.runCount : 0) + 1,
  });
}

// ---- CLI (guarded) ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('feed-state.mjs')) {
  const path = process.argv[2] || './witness/.data/feed-state.json';
  const state = loadState(path);
  console.log(`[feed-state] ${path}`);
  console.log(JSON.stringify(state, null, 2));
}
