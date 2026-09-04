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
    // NOTE — this timer is deliberately NOT unref()'d.
    //
    // It was, with the rationale "don't let a pending warmup timer keep the process alive on its
    // own". But an unref'd timer does not hold the event loop open, so when the task is a genuine
    // hang (a promise that never settles, the exact case this module exists for) and nothing else
    // is pending, the loop drains and the timeout NEVER FIRES — bootWarmup then never resolves.
    // That is the very failure it was written to prevent.
    //
    // It also broke CI for weeks. Under Node 20 the three timeout tests in boot-warmup.test.mjs
    // died as `cancelledByParent` / "Promise resolution is still pending but the event loop has
    // already resolved", so `npm test` reported `fail 0, cancelled 3` and exited non-zero with no
    // named failure. Node 24 keeps the loop alive differently and passes, which is why it never
    // reproduced locally.
    //
    // Nothing is leaked by dropping it: clearTimeout() below runs on every settle path, so the
    // timer can only outlive the race while the race is still pending — precisely when it is
    // needed. The sole caller (site/soapbox/server.mjs) is a long-running server whose listening
    // socket holds the loop open regardless.
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
