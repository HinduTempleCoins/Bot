// gpu-scheduler.mjs — the GPU as a SCARCE resource called a FEW TIMES A DAY, not always-on.
//
// Operator (2026-06-20): "use this limitation as a way to build something — look at the Decades Brain
// and BRE and all that stuff we made for the Smols, start there before we bring in a GPU all the time,
// and find a way to call on the GPU a few times a day." The Decades brain (decades-brain.mjs) already
// answers most work on plain CPU (pattern → MYCIN → BRE → Bayes → TF-IDF → Smol), GPU-free. This module
// is the TOP lane: when something genuinely needs the big model (the LoRA/GPU), it does NOT fire a live
// $1/hr GPU. It DEFERS the job into a queue that a scheduled BATCH drains in a few windows per day —
// the GPU spins up, clears the backlog, scales to zero. A tiny URGENT reserve covers the rare can't-wait.
//
// This is the economics from BRAIN_ARCHITECTURE.md made real: always-warm GPU ≈ $600-800/mo; this lane
// is a few batched minutes/day ≈ ~free. Pure + injectable (clock + runner) → offline-testable, soft-fail.

const HOUR = 3600e3;
const dayKey = (ts, tz = 0) => new Date(ts + tz * HOUR).toISOString().slice(0, 10);
const hourOf = (ts, tz = 0) => new Date(ts + tz * HOUR).getUTCHours();

/**
 * @param {object} cfg {
 *   windows?: number[]      UTC hours the GPU batch runs (default 4x/day: 2,8,14,20)
 *   perWindowMax?: number   max jobs drained per window (default 25)
 *   urgentReserve?: number  live GPU calls allowed per DAY for can't-wait jobs (default 3)
 *   tz?: number             timezone offset hours for the day boundary (default 0 = UTC)
 * }
 */
export function createGpuScheduler(cfg = {}) {
  const windows = (cfg.windows || [2, 8, 14, 20]).slice().sort((a, b) => a - b);
  const perWindowMax = cfg.perWindowMax ?? 25;
  const urgentReserve = cfg.urgentReserve ?? 3;
  const tz = cfg.tz ?? 0;

  const queue = [];                 // [{ id, payload, submittedAt, urgent }]
  const state = { day: null, windowsRunToday: [], urgentUsedToday: 0, drained: 0 };
  let seq = 0;

  function rollover(ts) {
    const d = dayKey(ts, tz);
    if (state.day !== d) { state.day = d; state.windowsRunToday = []; state.urgentUsedToday = 0; }
  }

  /**
   * Submit a job that needs the big model. Most jobs WAIT for the next batch window. A job marked
   * urgent may fire live IF the day's small urgent reserve remains — otherwise it queues like the rest.
   * @returns {{ ticket, mode: 'queued'|'urgent-live', queueLen }}
   */
  function submit(payload, { ts = nowOr(cfg), urgent = false } = {}) {
    rollover(ts);
    const id = `gpu-${++seq}`;
    if (urgent && state.urgentUsedToday < urgentReserve) {
      state.urgentUsedToday++;
      return { ticket: id, mode: 'urgent-live', payload, queueLen: queue.length };
    }
    queue.push({ id, payload, submittedAt: ts, urgent });
    return { ticket: id, mode: 'queued', queueLen: queue.length };
  }

  // Is `ts` at/after a window that hasn't run yet today (and there is work)?
  function due(ts = nowOr(cfg)) {
    rollover(ts);
    if (!queue.length) return false;
    const h = hourOf(ts, tz);
    return windows.some((w) => h >= w && !state.windowsRunToday.includes(w));
  }

  function nextWindowHour(ts = nowOr(cfg)) {
    const h = hourOf(ts, tz);
    return windows.find((w) => w > h) ?? windows[0]; // wraps to tomorrow's first
  }

  /**
   * Drain the queue through the injected GPU runner (e.g. modal-compute / a served LoRA). Processes up
   * to perWindowMax oldest jobs, marks the window used. runner(batch) -> array of results (or a map).
   * Soft-fails: a runner error leaves the jobs queued for the next window.
   * @returns {Promise<{ ran:boolean, processed:number, results:any[], remaining:number, reason? }>}
   */
  async function runWindow(runner, { ts = nowOr(cfg), force = false } = {}) {
    rollover(ts);
    const h = hourOf(ts, tz);
    const win = windows.find((w) => h >= w && !state.windowsRunToday.includes(w));
    if (!force && win == null) return { ran: false, processed: 0, results: [], remaining: queue.length, reason: 'not-a-window' };
    if (!queue.length) { if (win != null) state.windowsRunToday.push(win); return { ran: false, processed: 0, results: [], remaining: 0, reason: 'empty' }; }
    const batch = queue.slice(0, perWindowMax);
    let results = [];
    try {
      results = await runner(batch.map((j) => ({ id: j.id, payload: j.payload })));
    } catch (e) {
      return { ran: false, processed: 0, results: [], remaining: queue.length, reason: `runner-error:${e && e.message || e}` };
    }
    queue.splice(0, batch.length);
    state.drained += batch.length;
    if (win != null) state.windowsRunToday.push(win); else if (force) state.windowsRunToday.push(h);
    return { ran: true, processed: batch.length, results: results || [], remaining: queue.length };
  }

  function summary(ts = nowOr(cfg)) {
    rollover(ts);
    return {
      queued: queue.length,
      windows,
      windowsRunToday: state.windowsRunToday.slice(),
      windowsLeftToday: windows.filter((w) => !state.windowsRunToday.includes(w)).length,
      urgentUsedToday: state.urgentUsedToday,
      urgentReserve,
      drainedTotal: state.drained,
      nextWindowHour: nextWindowHour(ts),
    };
  }

  return { submit, due, runWindow, nextWindowHour, summary, _queue: () => queue.slice() };
}

function nowOr(cfg) {
  if (typeof cfg.now === 'number') return cfg.now;
  if (typeof process !== 'undefined' && process.env && process.env.GPU_SCHED_NOW) return Number(process.env.GPU_SCHED_NOW);
  return 0; // tests/callers should pass ts explicitly; 0 keeps it deterministic
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const day = 1_700_000_000_000;
  const s = createGpuScheduler({ windows: [2, 8, 14, 20], perWindowMax: 3 });
  const t = (h) => day - (day % (24 * HOUR)) + h * HOUR;
  for (let i = 0; i < 5; i++) s.submit({ job: `deep-${i}` }, { ts: t(9) });
  s.submit({ job: 'urgent!' }, { ts: t(9), urgent: true });
  console.log('at 09:00 due?', s.due(t(9)), '→', JSON.stringify(s.summary(t(9))));
  s.runWindow(async (b) => b.map((j) => ({ id: j.id, ok: true })), { ts: t(14) }).then((r) => {
    console.log('14:00 window drained:', r.processed, 'remaining', r.remaining);
  });
}
