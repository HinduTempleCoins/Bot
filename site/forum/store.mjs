// store.mjs — the forum's layered ledger store (forum-core STORE CONTRACT: append(entry) / all()).
//
//   all() = seed entries (read-only, never persisted)
//         + chain-mirror entries (what @hathor, @melek and the melek-forum-* categories hold on chain)
//         + local entries (anything appended through the engine), persisted to a JSONL file at FORUM_DATA.
//
// Persistence: every appended entry, and every newly mirrored chain entry, is written as one JSON line, so a
// restart loses nothing and the mirror renders immediately on boot even if the RPC is down. Ids are unique
// across layers; when the same id appears twice, the later layer and the later line win.
//
// Stale lines: the file may hold lines written by older forum builds (demo threads by invented accounts such
// as satoshi or austin_local, and copies of the old launch seed). Only lines this build wrote — tagged
// src:'local' or src:'chain' — are read back; everything else in the file is ignored, never deleted.

export const DEMO_AUTHORS = new Set(['satoshi', 'austin_local', 'crafter', 'wanderer', 'sponsor', 'xsser', 'xsser-sponsor']);
const KEEP_SRC = new Set(['local', 'chain']);

function readLines(file, fs) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch { /* skip a corrupt line */ }
    }
    return out;
  } catch { return []; }
}

/** Would this persisted line be shown? (exported for tests) */
export function keepPersisted(e) {
  if (!e || typeof e !== 'object') return false;
  if (!KEEP_SRC.has(e.src)) return false;
  if (e.kind !== 'post' && e.kind !== 'merit') return false;
  if (e.kind === 'post' && (typeof e.id !== 'string' || !e.board)) return false;
  if (DEMO_AUTHORS.has(e.author) || DEMO_AUTHORS.has(e.from)) return false;
  return true;
}

/**
 * @param {object} o
 * @param {string} [o.file]      JSONL path (FORUM_DATA). Omit for memory-only.
 * @param {object} [o.fs]        node:fs-compatible impl (readFileSync/appendFileSync/mkdirSync); required with file.
 * @param {() => object[]} [o.seed]    seed entries (read-only layer).
 * @param {{entries:Function}} [o.mirror] chain mirror (read-only layer, persisted via persistChain).
 */
export function createForumStore({ file = '', fs = null, seed = () => [], mirror = null } = {}) {
  const local = [];
  const persisted = file && fs ? readLines(file, fs).filter(keepPersisted) : [];
  const chainPersisted = persisted.filter((e) => e.src === 'chain');
  for (const e of persisted) if (e.src === 'local') local.push(e);
  let dirMade = false;

  function write(entry) {
    if (!file || !fs) return;
    try {
      if (!dirMade && typeof fs.mkdirSync === 'function') {
        const dir = file.replace(/\/[^/]*$/, '');
        if (dir && dir !== file) { try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists or not allowed */ } }
        dirMade = true;
      }
      fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch { /* soft-fail: the entry still lives in memory */ }
  }

  return {
    append(entry) {
      const e = { ...entry, src: 'local' };
      local.push(e);
      write(e);
    },
    all() {
      const byId = new Map();
      const merits = [];
      const add = (e) => {
        if (!e) return;
        if (e.kind === 'merit') { merits.push(e); return; }
        if (typeof e.id === 'string') byId.set(e.id, e);
      };
      let seedRows = [];
      try { seedRows = seed() || []; } catch { seedRows = []; }
      for (const e of seedRows) add(e);
      let mirrored = [];
      try { mirrored = mirror && typeof mirror.entries === 'function' ? mirror.entries() : []; } catch { mirrored = []; }
      for (const e of mirrored) add(e);
      for (const e of local) add(e);
      return [...byId.values(), ...merits];
    },
    /** Persist newly mirrored chain entries (the mirror's onNew hook). */
    persistChain(entries) {
      for (const e of Array.isArray(entries) ? entries : []) if (e && e.src === 'chain') write(e);
    },
    /** Chain entries recovered from the file at boot, for mirror.load(). */
    persistedChain() { return chainPersisted.slice(); },
    get file() { return file; },
  };
}

export default createForumStore;
