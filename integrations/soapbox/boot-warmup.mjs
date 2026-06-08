// boot-warmup.mjs — a bounded "prime the cache on boot" runner for the SoapBox aggregator.
//
// Why this exists (2026-06-06 → 2026-06-08): on a cold restart the homepage warmup fans out to
// every upstream serially-ish; if ONE upstream socket hangs (no response, no RST), the warmup
// promise stays pending forever. The June-6 sweep found that a slow upstream could wedge boot
// warmup — the work never settles, so any boot step chained after it (or a probe watching the log
// line) reads the box as not-yet-ready. The individual fetches are already soft-failed with
// `.catch()`, but a HANG is not a rejection — so we cap the whole warmup with a timeout race.
//
// bootWarmup(task, { ms, label, log }): run `task` (a function returning a promise), but never let
// it hold the caller longer than `ms`. Resolves to true if the task finished in time, false if it
// timed out or threw. Soft-fail-never-throw: a failed/slow warmup just means the first real visitor
// warms the cache instead. No network here; the timeout is the unit under test.

export const DEFAULT_WARMUP_MS = 8000;

export function bootWarmup(task, { ms = DEFAULT_WARMUP_MS, label = 'boot warmup', log = console.log } = {}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    // don't let a pending warmup timer keep the process alive on its own.
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  const run = Promise.resolve()
    .then(() => task())
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, err: e }));

  return Promise.race([run, timeout]).then((r) => {
    clearTimeout(timer);
    if (r.timedOut) {
      try { log(`${label}: timed out after ${ms}ms — first visitor will warm the cache`); } catch {}
      return false;
    }
    if (r.ok) {
      try { log(`${label}: cache primed`); } catch {}
      return true;
    }
    try { log(`${label}: skipped (${r.err && r.err.message ? r.err.message : 'error'})`); } catch {}
    return false;
  });
}
