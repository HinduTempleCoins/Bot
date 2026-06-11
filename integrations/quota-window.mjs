// integrations/quota-window.mjs — pure per-KEY sliding-window quota check (no storage).
//
// WHY THIS EXISTS
//   Distinct from integrations/rate-limit.mjs (a file-backed, per-IP + per-fingerprint token-style
//   limiter with on-disk state, atomic writes, env config, soft-fail-OPEN). THIS module is the
//   opposite end: a PURE function library for the "max N commands per interval" control on command
//   surfaces (e.g. the !commands menu / troll-box). It owns NO storage, does NO IO, has no env,
//   no clock of its own — the caller injects `now` and the `history` (array of past event
//   timestamps in ms). It returns what-to-do plus a pruned history, so the caller decides where
//   (if anywhere) to persist. That makes it trivially testable offline and reusable in front of
//   any keyed surface, on-disk or in-memory.
//
// DESIGN
//   • check({key, now, history, limit, windowMs}) -> { allowed, remaining, retryAfterMs, prunedHistory }
//       - prune: keep only stamps strictly newer than (now - windowMs); i.e. ts > now-windowMs.
//       - allowed iff (in-window count) < limit.
//       - remaining: max(0, limit - count) BEFORE this event would be recorded.
//       - retryAfterMs: when blocked, time until the OLDEST in-window stamp falls out of the window
//         (oldest + windowMs - now), clamped >= 0; 0 when allowed.
//   • record({history, now}) -> NEW array (append now; no mutation of the input).
//   • createLimiter({limit, windowMs}) -> a tiny stateful wrapper over a Map<key, number[]> for
//     callers that want statefulness; `now` is still injectable per call.
//   • SOFT-FAIL: garbage inputs are clamped to sane defaults; NEVER throws. A broken/garbage call
//     resolves to a permissive-but-bounded answer rather than crashing a command surface.
//
// USAGE — pure form (caller owns the history):
//   import { check, record } from '../integrations/quota-window.mjs';
//   const v = check({ key: user, now: Date.now(), history: store.get(user) || [],
//                     limit: 10, windowMs: 3600_000 });
//   if (!v.allowed) return reply(`slow down — try again in ${Math.ceil(v.retryAfterMs/1000)}s`);
//   store.set(user, record({ history: v.prunedHistory, now: Date.now() }));
//
// USAGE — stateful form:
//   const lim = createLimiter({ limit: 10, windowMs: 3600_000 });
//   const v = lim.check(user, Date.now());        // does NOT count
//   if (v.allowed) lim.record(user, Date.now());  // count one event
//
//   node integrations/quota-window.mjs            # worked example / self-check

import { fileURLToPath } from 'node:url';

// ---- soft-fail coercion helpers -------------------------------------------------------------

function num(v, dflt) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// A positive integer-ish window/limit; clamps junk to a default, floors to >= min.
function posNum(v, dflt, min = 1) {
  const n = num(v, dflt);
  return n >= min ? n : dflt;
}

// Coerce an arbitrary value into a clean array of finite timestamp numbers.
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const t of history) {
    const n = typeof t === 'number' ? t : Number(t);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// ---- pure API --------------------------------------------------------------------------------

/**
 * Sliding-window quota check. Pure: no IO, no mutation of inputs, never throws.
 * @returns {{allowed:boolean, remaining:number, retryAfterMs:number, prunedHistory:number[]}}
 */
export function check({ key, now, history, limit, windowMs } = {}) {
  // key is informational for the caller; we don't need it to compute, but coerce defensively.
  void key;
  const _now = num(now, Date.now());
  const _limit = posNum(limit, 10);
  const _windowMs = posNum(windowMs, 3600_000);
  const cutoff = _now - _windowMs;

  // Prune: keep strictly-in-window stamps. Sort ascending so [0] is the oldest in-window stamp.
  const pruned = cleanHistory(history)
    .filter((t) => t > cutoff)
    .sort((a, b) => a - b);

  const count = pruned.length;
  const allowed = count < _limit;
  const remaining = Math.max(0, _limit - count);

  let retryAfterMs = 0;
  if (!allowed && count > 0) {
    // When the oldest in-window stamp ages out, a slot frees up.
    retryAfterMs = Math.max(0, pruned[0] + _windowMs - _now);
  }

  return { allowed, remaining, retryAfterMs, prunedHistory: pruned };
}

/**
 * Append `now` to a history array, returning a NEW array (no mutation).
 * @returns {number[]}
 */
export function record({ history, now } = {}) {
  const base = cleanHistory(history);
  const _now = num(now, Date.now());
  return [...base, _now];
}

/**
 * Stateful wrapper. Holds a Map<key, number[]>; `now` injectable per call. Never throws.
 */
export function createLimiter({ limit, windowMs } = {}) {
  const _limit = posNum(limit, 10);
  const _windowMs = posNum(windowMs, 3600_000);
  const store = new Map();

  function keyOf(key) {
    // Stable string key; null/undefined collapse to a shared bucket rather than throwing.
    return key === undefined || key === null ? '' : String(key);
  }

  return {
    limit: _limit,
    windowMs: _windowMs,

    // check WITHOUT counting; also prunes the stored history as a side benefit.
    check(key, now) {
      const k = keyOf(key);
      const v = check({
        key: k,
        now,
        history: store.get(k) || [],
        limit: _limit,
        windowMs: _windowMs,
      });
      store.set(k, v.prunedHistory); // keep the bucket pruned
      return v;
    },

    // record ONE event for key at `now` (append).
    record(key, now) {
      const k = keyOf(key);
      const next = record({ history: store.get(k) || [], now });
      store.set(k, next);
      return next;
    },

    // check + (if allowed) record, returning the same shape as check().
    consume(key, now) {
      const k = keyOf(key);
      const v = this.check(k, now);
      if (v.allowed) this.record(k, now);
      return v;
    },

    // introspection / housekeeping
    peek(key) {
      return (store.get(keyOf(key)) || []).slice();
    },
    reset(key) {
      if (key === undefined) store.clear();
      else store.delete(keyOf(key));
    },
    size() {
      return store.size;
    },
  };
}

// ---- guarded CLI: worked example / self-check ------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = 1_000_000;
  const windowMs = 60_000;
  const limit = 3;
  let hist = [];
  for (let i = 0; i < 5; i++) {
    const t = now + i * 10_000;
    const v = check({ key: 'demo', now: t, history: hist, limit, windowMs });
    // eslint-disable-next-line no-console
    console.log(
      `t=${t} allowed=${v.allowed} remaining=${v.remaining} retryAfterMs=${v.retryAfterMs}`,
    );
    if (v.allowed) hist = record({ history: v.prunedHistory, now: t });
  }
  const lim = createLimiter({ limit: 2, windowMs: 1000 });
  // eslint-disable-next-line no-console
  console.log('stateful consume:', lim.consume('a', 0).allowed, lim.consume('a', 1).allowed, lim.consume('a', 2).allowed);
}
