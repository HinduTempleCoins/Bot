// peer-merit.mjs — the MELEK SCARCE PEER-MERIT layer (Bitcointalk-Merit-style trust primitive).
//
// WHY THIS EXISTS (research §HALF B): our karma/reputation is stake+activity based. This adds the
// single most differentiating idea from Bitcointalk's Merit system (Marti Malmi / theymos): a SCARCE,
// PEER-AWARDED merit that is Sybil-resistant and NON-plutocratic. The rule that makes it work:
//   • YOU CAN ONLY SEND MERIT YOU WERE GIVEN — you cannot mint merit for yourself.
//   • A periodic small allotment is the ONLY faucet (rate-limited).
// So a whale's stake buys nothing here; merit only ever comes from the faucet or from a peer choosing
// to spend theirs on you. This layers on top of the existing off-chain karma DB (karma/), not the chain.
//
// RECORD (one per account):
//   { account, sendable, received, sentTotal, lastAllotmentTs }
//     • received        — LIFETIME merit received. This is THE SCORE / rank signal. Monotonic up.
//     • sendable         — balance you may still SEND. Grows ONLY from (a) the periodic allotment and
//                          (b) a small fraction of merit you receive (SENDABLE_FRACTION_OF_RECEIVED,
//                          default 0). Shrinks when you send. It is NOT the score.
//     • sentTotal        — lifetime merit you have sent out (audit).
//     • lastAllotmentTs  — ms timestamp of the last granted allotment, for rate-limiting the faucet.
//
// DESIGN NOTES on sendable-vs-received: `received` is the pure score — it never funds your own sends,
// so accumulating a high score does NOT let you mint more outgoing merit (keeps it scarce and
// non-plutocratic). By default receiving merit gives you ZERO new sendable (SENDABLE_FRACTION_OF_RECEIVED
// = 0), so the ONLY source of sendable is the faucet — the strictest Bitcointalk-faithful setting. An
// operator may set a small fraction (e.g. 0.1) to let well-regarded members re-circulate a sliver of
// what they earn; it is a constant, documented, and capped below 1 so merit can never inflate.
//
// HOUSE STYLE: ESM .mjs, soft-fail-never-throw, deterministic (pass `now` in — pure logic never calls
// Date.now(); only the store/CLI may). esc() all rendered output. Mirrors karma/index.mjs store shape:
// makeMemoryStore() + an injectable store, createPeerMerit({ store, now }).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── constants (configurable trust parameters) ─────────────────────────────────
export const ALLOTMENT_AMOUNT = 1;                       // merit units granted per faucet tick
export const ALLOTMENT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days between allotments
export const SENDABLE_FRACTION_OF_RECEIVED = 0;          // fraction of received merit added to sendable (0..<1)
export const DEFAULT_THRESHOLD = 1;                      // default privilege gate on received score

// ── helpers ───────────────────────────────────────────────────────────────────
// int: anything → a finite integer, else 0. (undefined, null, NaN, Infinity, "3.5", junk → 0/floor.)
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
// isPosInt: strictly a positive whole number. Used to enforce integer merit amounts.
function isPosInt(x) {
  return typeof x === 'number' && Number.isInteger(x) && x > 0;
}
// HTML escape for any rendering of account names / badges.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// account names: non-empty trimmed strings only; anything else is rejected (soft-fail).
function normAccount(a) {
  if (typeof a !== 'string') return null;
  const t = a.trim();
  return t.length ? t : null;
}
// a fresh zeroed record for an account.
function blankRecord(account) {
  return { account, sendable: 0, received: 0, sentTotal: 0, lastAllotmentTs: 0 };
}
// normalize any stored/garbage record into a well-formed one (never throws).
function normRecord(account, raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    account,
    sendable: Math.max(0, Math.floor(num(r.sendable))),
    received: Math.max(0, Math.floor(num(r.received))),
    sentTotal: Math.max(0, Math.floor(num(r.sentTotal))),
    lastAllotmentTs: Math.max(0, Math.floor(num(r.lastAllotmentTs))),
  };
}

// ── default in-memory store (a thin wrapper over a Map keyed by account) ────────
// STORE CONTRACT (duck-typed, sync or async — we await everything):
//   store.get(account)      → record | undefined
//   store.set(account, rec) → void
//   store.all()             → record[]
export function makeMemoryStore() {
  const m = new Map();
  return {
    get(account) { return m.get(account); },
    set(account, rec) { m.set(account, rec); },
    all() { return [...m.values()]; },
  };
}

// ── optional JSONL-backed store (IO behind an injectable fs seam) ───────────────
// One JSON record per line; last line for an account wins (append-on-write snapshot). Used by the CLI.
export function makeJsonlStore(file, fsImpl = null) {
  let _fs = fsImpl;
  const fsOrDie = () => {
    if (_fs) return _fs;
    throw new Error('jsonl store needs an fs impl; call with one or use the CLI');
  };
  const load = () => {
    const m = new Map();
    try {
      const raw = fsOrDie().readFileSync(file, 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { const o = JSON.parse(t); if (o && o.account) m.set(o.account, o); } catch { /* skip */ }
      }
    } catch { /* soft-fail: empty */ }
    return m;
  };
  return {
    __setFs(impl) { _fs = impl || null; },
    get(account) { return load().get(account); },
    set(account, rec) {
      try { fsOrDie().appendFileSync(file, JSON.stringify(rec) + '\n'); } catch { /* soft-fail */ }
    },
    all() { return [...load().values()]; },
  };
}

/**
 * Create a peer-merit instance bound to a store.
 * @param {object} [opts]
 * @param {{get:Function,set:Function,all:Function}} [opts.store] injectable store (default in-memory).
 * @param {() => number} [opts.now] injectable clock (default Date.now), for the store/CLI only.
 * @param {object} [opts.config] override the module constants for this instance.
 */
export function createPeerMerit({ store, now, config } = {}) {
  const _store = store
    && typeof store.get === 'function'
    && typeof store.set === 'function'
    && typeof store.all === 'function'
    ? store
    : makeMemoryStore();
  const _now = typeof now === 'function' ? now : Date.now;

  const cfg = {
    allotmentAmount: ALLOTMENT_AMOUNT,
    allotmentIntervalMs: ALLOTMENT_INTERVAL_MS,
    sendableFractionOfReceived: SENDABLE_FRACTION_OF_RECEIVED,
    defaultThreshold: DEFAULT_THRESHOLD,
    ...(config && typeof config === 'object' ? config : {}),
  };

  // read a normalized record for an account (never throws; unknown → blank).
  async function _read(account) {
    let raw;
    try { raw = await _store.get(account); } catch { raw = null; }
    return normRecord(account, raw);
  }
  async function _write(rec) {
    try { await _store.set(rec.account, rec); return true; } catch { return false; }
  }

  return {
    /** Read a normalized record (blank if unknown). Soft-fail: invalid account → blank record. */
    async record(account) {
      const acc = normAccount(account);
      return acc ? _read(acc) : blankRecord('');
    },

    /**
     * Periodic faucet. Adds cfg.allotmentAmount to `sendable`, but ONLY if at least
     * cfg.allotmentIntervalMs has passed since lastAllotmentTs. `now` (ms) MUST be passed for
     * determinism. Returns { ok, reason?, record } — soft-fail, never throws.
     */
    async grantAllotment(account, { amount, now } = {}) {
      const acc = normAccount(account);
      if (!acc) return { ok: false, reason: 'invalid-account', record: blankRecord('') };
      const nowTs = Math.floor(num(now));
      const rec = await _read(acc);
      const step = num(amount) > 0 ? Math.floor(num(amount)) : cfg.allotmentAmount;
      const due = rec.lastAllotmentTs === 0
        || (nowTs - rec.lastAllotmentTs) >= cfg.allotmentIntervalMs;
      if (!due) {
        return { ok: false, reason: 'rate-limited', record: rec };
      }
      rec.sendable += step;
      rec.lastAllotmentTs = nowTs;
      await _write(rec);
      return { ok: true, record: rec };
    },

    /**
     * THE CORE RULE. Transfer `amount` merit from `from` to `to`:
     *   • from.sendable  -= amount     (you spend what you were given)
     *   • from.sentTotal += amount
     *   • to.received    += amount     (the receiver's SCORE rises — permanent)
     *   • to.sendable    += floor(amount * cfg.sendableFractionOfReceived)  (default 0)
     * Enforces: from !== to (no self-award), positive INTEGER amount, from.sendable >= amount.
     * Returns { ok, reason?, from, to } — soft-fail, never throws.
     */
    async sendMerit(from, to, amount, { now } = {}) {
      const f = normAccount(from);
      const t = normAccount(to);
      if (!f || !t) return { ok: false, reason: 'invalid-account' };
      if (f === t) return { ok: false, reason: 'self-send' };
      if (!isPosInt(amount)) return { ok: false, reason: 'amount-must-be-positive-integer' };

      const fromRec = await _read(f);
      if (fromRec.sendable < amount) {
        return { ok: false, reason: 'insufficient-sendable', from: fromRec, to: await _read(t) };
      }
      const toRec = await _read(t);
      const nowTs = Math.floor(num(now));

      fromRec.sendable -= amount;
      fromRec.sentTotal += amount;
      toRec.received += amount;
      const bonus = Math.floor(amount * cfg.sendableFractionOfReceived);
      if (bonus > 0) toRec.sendable += bonus;
      if (nowTs > 0) { fromRec.lastSentTs = nowTs; toRec.lastReceivedTs = nowTs; }

      await _write(fromRec);
      await _write(toRec);
      return { ok: true, from: fromRec, to: toRec };
    },

    /** The rank signal: lifetime merit received. Unknown/invalid account → 0. */
    async meritScore(account) {
      const acc = normAccount(account);
      if (!acc) return 0;
      return (await _read(acc)).received;
    },

    /** How much this account may still send. Unknown/invalid → 0. */
    async sendableOf(account) {
      const acc = normAccount(account);
      if (!acc) return 0;
      return (await _read(acc)).sendable;
    },

    /** Leaderboard by received desc (tie: account name asc). limit caps rows (default all). */
    async rank(limit) {
      let rows = [];
      try { rows = (await _store.all()) || []; } catch { rows = []; }
      const out = rows
        .filter((r) => r && r.account)
        .map((r) => normRecord(r.account, r))
        .sort((a, b) => b.received - a.received || a.account.localeCompare(b.account));
      const n = num(limit);
      return n > 0 ? out.slice(0, Math.floor(n)) : out;
    },

    /** Privilege gate: does this account's received score meet `threshold`? (default cfg.defaultThreshold) */
    async meetsThreshold(account, threshold) {
      const acc = normAccount(account);
      if (!acc) return false;
      const th = num(threshold) > 0 ? num(threshold) : cfg.defaultThreshold;
      return (await _read(acc)).received >= th;
    },

    /** One-line HTML badge for an account (all interpolation escaped). */
    renderBadge(account, record) {
      const acc = esc(normAccount(account) || (record && record.account) || '');
      const rec = normRecord(acc, record);
      return `<span class="merit-badge" data-account="${acc}">`
        + `✦ ${esc(rec.received)} merit `
        + `<small>(${esc(rec.sendable)} to give)</small></span>`;
    },

    get config() { return { ...cfg }; },
    get store() { return _store; },
  };
}

export default createPeerMerit;

// standalone badge renderer (no instance needed) — same escaping contract.
export function renderBadge(account, record) {
  const acc = esc(normAccount(account) || (record && record.account) || '');
  const rec = normRecord(acc, record);
  return `<span class="merit-badge" data-account="${acc}">`
    + `✦ ${esc(rec.received)} merit `
    + `<small>(${esc(rec.sendable)} to give)</small></span>`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('peer-merit.mjs');
if (isMain) {
  // A short deterministic demo over the in-memory store (no disk, no network).
  const merit = createPeerMerit({});
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  (async () => {
    await merit.grantAllotment('alice', { now: t0 });                 // alice gets 1 sendable
    const r1 = await merit.sendMerit('alice', 'bob', 1, { now: t0 }); // alice → bob
    const r2 = await merit.sendMerit('alice', 'bob', 1, { now: t0 }); // rejected: empty
    const self = await merit.sendMerit('bob', 'bob', 1, { now: t0 }); // rejected: self-send
    const early = await merit.grantAllotment('alice', { now: t0 + day }); // rejected: rate-limited
    const later = await merit.grantAllotment('alice', { now: t0 + 15 * day }); // ok: interval passed
    console.log('bob score      :', await merit.meritScore('bob'));
    console.log('alice sendable :', await merit.sendableOf('alice'));
    console.log('send#2 (empty) :', JSON.stringify(r2));
    console.log('self-send      :', JSON.stringify(self));
    console.log('allot early    :', early.reason);
    console.log('allot later ok :', later.ok, 'sendable=', later.record.sendable);
    console.log('rank           :', (await merit.rank()).map((r) => `${r.account}:${r.received}`).join(' '));
    console.log('bob meets>=1   :', await merit.meetsThreshold('bob', 1));
    console.log('badge          :', renderBadge('bob', await merit.record('bob')));
    void r1;
  })();
}
