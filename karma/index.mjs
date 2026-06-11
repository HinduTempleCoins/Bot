// index.mjs — the Witness's OFF-CHAIN karma LEDGER (BRIEF.md §9, the store/ledger layer).
//
// This is the ledger/store layer, DISTINCT from its siblings in this dir:
//   • karma/karma.mjs        — derives a 0..100 score from observable on-chain ACTIVITY (a scoring model).
//   • karma/dharma-100.mjs   — pure two-axis given/received BALANCE math.
//   • karma/siring-model.mjs — scores a single siring act and ranks sires.
// THIS file holds none of that math. It is a plain append-only EVENT LEDGER: every award / penalize is
// recorded as an immutable entry, and an account's score is simply the sum of its entries' deltas. Where
// karma.mjs computes a score FROM behavior, this ledger RECORDS deliberate karma the Witness assigns
// (e.g. "+10 for a great answer", "-5 for spam") so those decisions are auditable and replayable.
//
// Karma here is SOCIAL, not economic (§9): it never touches the chain reward pool or stake-weighted
// voting. It is advisory input to the Witness's discretionary grant/flag logic only. The chain code
// stays unmodified.
//
// DESIGN (house style):
//   • createKarma({ store }) returns an instance bound to a STORE. The store is an injectable seam:
//     the default is an in-memory Map; a JSONL-backed (or any) store can be injected to persist. This
//     keeps the ledger fully offline-testable — no network, no clock dependency beyond Date.now() which
//     can itself be injected via { now }.
//   • Entries are IMMUTABLE append records: { account, points, reason, kind, ts, seq }. award/penalize
//     append; nothing is ever mutated or removed. scoreOf = sum of points. history = the entries.
//   • SOFT-FAIL NEVER THROWS: bad accounts / non-finite points / store I/O errors are swallowed and
//     surfaced as { ok:false, error } (for writes) or safe empties (for reads). The Witness must never
//     crash on a karma op.
//   • esc() is provided for any HTML rendering of reasons; no interpolation happens unescaped.
//
// STORE CONTRACT (duck-typed, all sync or async — we await everything):
//   store.append(entry) → void           append one immutable entry
//   store.all()         → entry[]         every entry, in append order
// The default in-memory store implements both over an array. A JSONL store can implement append() as a
// file append and all() as a parse-of-lines; see makeJsonlStore() below (IO behind injectable fs seam).
//
// CLI:  node karma/index.mjs award    <account> <points> [reason...]
//       node karma/index.mjs penalize <account> <points> [reason...]
//       node karma/index.mjs score    <account>
//       node karma/index.mjs rank     [limit]
//       node karma/index.mjs history  <account>
// The CLI uses a JSONL store at KARMA_LEDGER (default karma/data/karma-ledger.jsonl) so it persists.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── helpers ───────────────────────────────────────────────────────────────────
// num: anything → a finite number, else 0. (undefined, null, NaN, Infinity, junk strings → 0.)
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
// HTML escape for any rendering of user-supplied reasons.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// account names: lowercase non-empty strings only; anything else is rejected (soft-fail).
function normAccount(a) {
  if (typeof a !== 'string') return null;
  const t = a.trim();
  return t.length ? t : null;
}

// ── default in-memory store (a thin wrapper over an array) ──────────────────────
export function makeMemoryStore() {
  const entries = [];
  return {
    append(entry) { entries.push(entry); },
    all() { return entries.slice(); },
  };
}

// ── optional JSONL-backed store (IO behind an injectable fs seam) ───────────────
// One JSON object per line, append-only. Used by the CLI; injectable for tests too.
export function makeJsonlStore(file, fsImpl = null) {
  let _fs = fsImpl;
  const fsOrDie = () => {
    if (_fs) return _fs;
    // lazy import so unit tests that never touch disk don't pull node:fs into the path.
    throw new Error('jsonl store needs an fs impl; call with one or use the CLI');
  };
  return {
    __setFs(impl) { _fs = impl || null; },
    append(entry) {
      try { fsOrDie().appendFileSync(file, JSON.stringify(entry) + '\n'); } catch { /* soft-fail */ }
    },
    all() {
      try {
        const raw = fsOrDie().readFileSync(file, 'utf8');
        const out = [];
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          try { out.push(JSON.parse(t)); } catch { /* skip a corrupt line, never throw */ }
        }
        return out;
      } catch { return []; }
    },
  };
}

/**
 * Create a karma ledger instance bound to a store.
 * @param {object} [opts]
 * @param {{append:Function, all:Function}} [opts.store] injectable store (default in-memory Map-like).
 * @param {() => number} [opts.now] injectable clock (default Date.now), for deterministic tests.
 */
export function createKarma({ store, now } = {}) {
  const _store = store && typeof store.append === 'function' && typeof store.all === 'function'
    ? store
    : makeMemoryStore();
  const _now = typeof now === 'function' ? now : Date.now;
  let _seq = 0;

  // seed _seq past any pre-existing entries so seq stays monotonic across reloads.
  try {
    for (const e of _store.all() || []) {
      const s = num(e && e.seq);
      if (s >= _seq) _seq = s + 1;
    }
  } catch { /* soft-fail: start at 0 */ }

  async function _all() {
    try { return (await _store.all()) || []; } catch { return []; }
  }

  // shared write path. delta sign already applied by caller.
  async function _record(kind, account, points, reason) {
    const acc = normAccount(account);
    if (!acc) return { ok: false, error: 'invalid-account' };
    const raw = num(points);
    if (raw <= 0) return { ok: false, error: 'points-must-be-positive' };
    const delta = kind === 'penalize' ? -raw : raw;
    const entry = {
      account: acc,
      points: delta,
      reason: typeof reason === 'string' ? reason : '',
      kind,
      ts: new Date(num(_now())).toISOString(),
      seq: _seq++,
    };
    try {
      await _store.append(Object.freeze({ ...entry }));
      return { ok: true, entry };
    } catch (error) {
      _seq--; // roll back the seq we claimed; nothing was persisted.
      return { ok: false, error: String(error && error.message || error) };
    }
  }

  return {
    /** Award positive karma. points must be > 0. Soft-fails → { ok:false, error }. */
    award(account, points, reason) { return _record('award', account, points, reason); },

    /** Penalize (negative delta). points is the positive magnitude to subtract. */
    penalize(account, points, reason) { return _record('penalize', account, points, reason); },

    /** Current score = sum of all deltas for the account. Unknown account → 0. */
    async scoreOf(account) {
      const acc = normAccount(account);
      if (!acc) return 0;
      let sum = 0;
      for (const e of await _all()) if (e && e.account === acc) sum += num(e.points);
      return sum;
    },

    /** Leaderboard: [{ account, score }] sorted by score desc. limit caps the rows (default all). */
    async rank(limit) {
      const totals = new Map();
      for (const e of await _all()) {
        if (!e || !e.account) continue;
        totals.set(e.account, (totals.get(e.account) || 0) + num(e.points));
      }
      const rows = [...totals.entries()]
        .map(([account, score]) => ({ account, score }))
        .sort((a, b) => b.score - a.score || a.account.localeCompare(b.account));
      const n = num(limit);
      return n > 0 ? rows.slice(0, Math.floor(n)) : rows;
    },

    /** Immutable history for an account, in append order. Unknown account → []. */
    async history(account) {
      const acc = normAccount(account);
      if (!acc) return [];
      return (await _all()).filter((e) => e && e.account === acc);
    },

    /** Every entry across all accounts, in append order (audit view). */
    async all() { return _all(); },

    // expose the bound store (read-only handle) for callers that want to inspect/persist it.
    get store() { return _store; },
  };
}

export default createKarma;

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('index.mjs')
  && process.argv[1].includes('karma');
if (isMain) {
  const fs = await import('node:fs');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const LEDGER = process.env.KARMA_LEDGER || path.join(__dirname, 'data', 'karma-ledger.jsonl');
  try { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); } catch { /* soft-fail */ }
  const store = makeJsonlStore(LEDGER, fs);
  const k = createKarma({ store });

  const [cmd, account, points, ...reasonParts] = process.argv.slice(2);
  const reason = reasonParts.join(' ');
  const print = (x) => console.log(JSON.stringify(x, null, 2));

  if (cmd === 'award' && account) {
    print(await k.award(account, points, reason));
  } else if (cmd === 'penalize' && account) {
    print(await k.penalize(account, points, reason));
  } else if (cmd === 'score' && account) {
    console.log(`${account}: ${await k.scoreOf(account)}`);
  } else if (cmd === 'rank') {
    const rows = await k.rank(account ? Number(account) : undefined);
    if (!rows.length) { console.error('karma ledger empty — award some karma first'); process.exit(1); }
    for (const r of rows) console.log(`  ${String(r.score).padStart(6)}  @${r.account}`);
  } else if (cmd === 'history' && account) {
    for (const e of await k.history(account)) {
      console.log(`  [${e.ts}] ${e.points >= 0 ? '+' : ''}${e.points}  ${e.reason || '(no reason)'}`);
    }
  } else {
    console.error('usage: index.mjs award|penalize <account> <points> [reason] | score <account> | rank [limit] | history <account>');
    process.exit(1);
  }
}
