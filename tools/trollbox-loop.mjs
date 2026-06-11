// tools/trollbox-loop.mjs — the LIVE TrollBox reply-loop runner.
//
// Phase 2 wiring: makes Hathor answer !help/!signup in the condenser troll-box in REAL TIME by
// driving the existing one-shot cycle (src/trollbox/chain-connector.mjs → runOnce) on a timer.
// This module owns NONE of the routing logic — runOnce() does the poll→route→reply; index.mjs
// (handleMessage) does the deterministic answers. This file is purely the long-running loop that
// keeps calling runOnce, carrying the op-history cursor + the answered-id Set across ticks so the
// bot reads forward and never replies to the same line twice.
//
// Key custody (BRIEF.md §7 / zero-WIF-on-host): the bot holds NO key. The `broadcaster` is the
// injected MELEK-Signer client; runOnce hands it the op to sign. If no broadcaster is wired, every
// tick runs DRY (reads + routes, builds the reply, broadcasts nothing) — safe to run anywhere.
//
// Everything is injectable and soft-fail-never-throw: a thrown client/broadcaster/timer can never
// crash the loop. Bounded: the seen-Set is capped (oldest ids evicted) so memory can't grow without
// limit during a long run.
//
//   import { makeLoop } from './tools/trollbox-loop.mjs'
//   const loop = makeLoop({ client, broadcaster, intervalMs: 15000 });
//   loop.start();                 // begins ticking every intervalMs
//   const r = await loop.tick();  // or drive one cycle by hand (tests do this)
//   loop.stop();                  // clears the timer
//
// Exports:
//   makeLoop({ client, broadcaster, intervalMs, since, maxSeen, now, runOnce, setTimer, clearTimer })
//     -> { tick(), start(), stop(), state() }
//   esc(s)                  HTML-escape for any operator-facing interpolation.
//   __setRunner(fn)         swap the runOnce implementation (tests inject a fake).

import { runOnce as defaultRunOnce } from '../src/trollbox/chain-connector.mjs';

// --- injectable runner seam: default is the real chain-connector runOnce ---
let _runner = defaultRunOnce;
/** Swap the runOnce implementation (tests inject a fake; pass nothing/garbage to reset). */
export function __setRunner(fn) {
  _runner = typeof fn === 'function' ? fn : defaultRunOnce;
}

// --- HTML-escape for safe operator-facing interpolation --------------------
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DEFAULT_INTERVAL_MS = 15000; // 15s — gentle on the RPC, responsive enough for chat.
const MIN_INTERVAL_MS = 1000;      // floor: never hammer the node faster than 1/s.
const DEFAULT_MAX_SEEN = 5000;     // bound the idempotency Set; evict oldest beyond this.

/**
 * Build a live troll-box reply loop around chain-connector.runOnce.
 *
 * @param {object} opts
 * @param {object}   opts.client        reader exposing customJsonHistory(id,{since,max}) — INJECTED.
 * @param {Function} [opts.broadcaster] async ({op,redactedLog})=>result — the MELEK-Signer client.
 *                                       Omit for DRY-RUN (reads + routes, broadcasts nothing). No key here.
 * @param {number}   [opts.intervalMs]  ms between ticks (floored at 1s; default 15s).
 * @param {number}   [opts.since]       starting op-history cursor (default 0 = from the beginning).
 * @param {number}   [opts.maxSeen]     cap on the answered-id Set (default 5000).
 * @param {()=>number} [opts.now]       clock forwarded to runOnce/handleMessage (default ()=>Date.now()).
 * @param {Function} [opts.runOnce]     override the cycle fn (otherwise the injected/default runner).
 * @param {Function} [opts.setTimer]    schedule fn (default setInterval) — injectable for tests.
 * @param {Function} [opts.clearTimer]  cancel fn (default clearInterval) — injectable for tests.
 * @returns {{ tick: ()=>Promise<object>, start: ()=>boolean, stop: ()=>boolean, state: ()=>object }}
 */
export function makeLoop({
  client,
  broadcaster,
  intervalMs = DEFAULT_INTERVAL_MS,
  since = 0,
  maxSeen = DEFAULT_MAX_SEEN,
  now = () => Date.now(),
  runOnce,
  setTimer,
  clearTimer,
} = {}) {
  const cycle = typeof runOnce === 'function' ? runOnce : (...a) => _runner(...a);
  const schedule = typeof setTimer === 'function' ? setTimer : ((fn, ms) => setInterval(fn, ms));
  const cancel = typeof clearTimer === 'function' ? clearTimer : ((h) => clearInterval(h));

  // intervalMs floored + coerced; bad values fall back to the default.
  const period = Math.max(MIN_INTERVAL_MS, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS);
  const cap = Number.isFinite(maxSeen) && maxSeen > 0 ? Math.floor(maxSeen) : DEFAULT_MAX_SEEN;
  const dryRun = typeof broadcaster !== 'function';

  // --- carried state across ticks -----------------------------------------
  let cursor = Number.isFinite(since) ? since : 0;
  // seen is a Set runOnce mutates (it adds answered keys). We also bound it ourselves.
  const seen = new Set();
  let handle = null;       // active timer handle, or null when stopped.
  let running = false;     // is a tick currently in flight? (re-entrancy guard).
  let ticks = 0;           // total tick() calls.
  let errors = 0;          // ticks that soft-failed.
  let answeredTotal = 0;   // cumulative replies emitted.
  let lastNote = '';       // human summary of the last tick.

  /** Evict oldest entries so the idempotency Set stays bounded over a long run. */
  function boundSeen() {
    if (seen.size <= cap) return;
    const over = seen.size - cap;
    let i = 0;
    for (const k of seen) {          // Set iterates in insertion order → oldest first.
      seen.delete(k);
      if (++i >= over) break;
    }
  }

  /**
   * Drive exactly one poll→route→reply cycle. Never throws — any failure is caught and folded
   * into the returned summary, and the loop keeps its cursor/seen state intact.
   * @returns {Promise<{ok, answered, cursor, dryRun, seenSize, note}>}
   */
  async function tick() {
    ticks += 1;
    if (running) {
      // A previous tick is still in flight (slow RPC). Skip rather than overlap — soft, not an error.
      lastNote = 'skipped: previous tick still running';
      return { ok: true, skipped: true, answered: 0, cursor, dryRun, seenSize: seen.size, note: lastNote };
    }
    running = true;
    try {
      const res = await cycle({ client, broadcaster, since: cursor, seen, now });
      // runOnce returns { answered, cursor, seen, dryRun }. Advance our cursor only forward.
      const nextCursor = res && Number.isFinite(Number(res.cursor)) ? Number(res.cursor) : cursor;
      if (nextCursor > cursor) cursor = nextCursor;
      const answered = res && Array.isArray(res.answered) ? res.answered : [];
      answeredTotal += answered.length;
      boundSeen();
      lastNote = `tick ${ticks}: answered ${answered.length}, cursor ${cursor}${dryRun ? ' (dry-run)' : ''}`;
      return {
        ok: true,
        answered: answered.length,
        replies: answered.map((a) => ({ to: a?.to, kind: a?.kind })),
        cursor,
        dryRun,
        seenSize: seen.size,
        note: lastNote,
      };
    } catch (e) {
      errors += 1;
      lastNote = `tick ${ticks} soft-failed: ${e?.message || String(e)}`;
      return { ok: false, answered: 0, cursor, dryRun, seenSize: seen.size, error: e?.message || String(e), note: lastNote };
    } finally {
      running = false;
    }
  }

  /**
   * Begin ticking every `period` ms. Idempotent — a second start() while already running is a no-op
   * and returns false. The scheduled callback swallows its own promise rejection (defense-in-depth;
   * tick already never rejects). Returns true if a timer was armed.
   */
  function start() {
    if (handle != null) return false;
    try {
      handle = schedule(() => { tick().catch(() => {}); }, period);
      // Let the process exit even if a stray timer is live (Node convenience; ignored elsewhere).
      if (handle && typeof handle.unref === 'function') handle.unref();
      return true;
    } catch {
      handle = null;
      return false;
    }
  }

  /** Stop ticking. Idempotent — returns true if a timer was cleared, false if none was armed. */
  function stop() {
    if (handle == null) return false;
    try { cancel(handle); } catch { /* soft-fail */ }
    handle = null;
    return true;
  }

  /** Snapshot of loop state for an operator surface / tests. */
  function state() {
    return {
      running: handle != null,
      inFlight: running,
      dryRun,
      period,
      cursor,
      seenSize: seen.size,
      ticks,
      errors,
      answeredTotal,
      note: lastNote,
    };
  }

  return { tick, start, stop, state };
}

// --- CLI (guarded) — offline demo with a fake client, no broadcaster -------
if (process.argv[1] && process.argv[1].endsWith('trollbox-loop.mjs')) {
  const fakeClient = {
    async customJsonHistory() {
      return [
        { seq: 21, op: ['custom_json', { id: 'melek_trollbox', json: JSON.stringify({ v: 1, user: 'newbie', text: '!help', ts: 1 }) }] },
        { seq: 22, op: ['custom_json', { id: 'melek_trollbox', json: JSON.stringify({ v: 1, user: 'mary', text: 'how do i sign up?', ts: 2 }) }] },
      ];
    },
  };
  const loop = makeLoop({ client: fakeClient, intervalMs: 1000 }); // no broadcaster → dry-run
  const r1 = await loop.tick();
  const r2 = await loop.tick(); // second tick: nothing new past the cursor / already seen
  console.log(JSON.stringify({ tick1: r1, tick2: r2, state: loop.state() }, null, 2));
}
