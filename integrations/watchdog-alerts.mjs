// watchdog-alerts — decide whether a quiet job is BROKEN or merely IDLE, and stop a monitor from
// crying wolf until nobody looks at it any more.
//
// WHY THIS EXISTS. The Server 4 watchdog checks each service's output file and alerts when the mtime
// has not moved inside a window. On 2026-09-08 it had been reporting `continue (10m): no new output
// for 109h` — every fifteen minutes, for four and a half days. Roughly 430 identical notifications to
// Telegram and Discord.
//
// The service was HEALTHY the whole time. Its job is to distil the newest Claude session transcript
// into CONTINUE.md; the transcript directory was empty, so it correctly did nothing and said so:
// `[continue] no transcript — leaving existing state intact`. A stale output file was the RIGHT
// outcome. The watchdog had no way to express that, so it reported success as failure.
//
// TWO FIXES, AND THE SECOND MATTERS MORE.
//
//   1. IDLE IS NOT STALE. A job that transforms an input into an output is only stale if the INPUT
//      moved and the output did not. With no input, silence is correct. And "the input never arrives"
//      is a real problem too — but it is a DIFFERENT problem, about the feed rather than the job, and
//      it deserves its own message pointed at the thing that is actually broken.
//
//   2. AN ALERT REPEATED IS AN ALERT IGNORED. The watchdog's own header says it exists "so a dead loop
//      is NEVER discovered hours later again." Four hundred identical pings guarantee the opposite:
//      the operator learns to swipe them away, and the next genuinely dead loop goes unread. So a
//      problem is announced when it APPEARS, when it gets materially WORSE, and when it CLEARS —
//      never on a timer.

const str = (s) => String(s == null ? '' : s).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const STATES = Object.freeze({
  ok: 'healthy, and producing on schedule',
  idle: 'healthy, but with nothing to do — silence is the correct output',
  stale: 'the input moved and the output did not: the job is not keeping up',
  starved: 'the job is fine; its INPUT has stopped arriving. Fix the feed, not the job.',
  failed: 'the service or its timer is not running',
});

/**
 * Classify one check.
 *
 * `outputAgeMin` — how long since this job last wrote.
 * `inputAgeMin`  — how long since its newest input appeared. `null` when the job has no input to wait
 *                  on (a poller, a heartbeat), in which case a stale output IS the fault.
 * `inputCount`   — how many inputs are waiting. Zero with a defined feed means starved, not stale.
 */
export function classify({
  name = '', maxQuietMin = 0, outputAgeMin = 0, inputAgeMin = null, inputCount = null,
  serviceFailed = false, timerActive = true, starvedAfterMin = 0,
} = {}) {
  const n = str(name);
  if (serviceFailed) return { name: n, state: 'failed', why: 'the service is in a failed state', ageMin: num(outputAgeMin) };
  if (!timerActive) return { name: n, state: 'failed', why: 'the timer is not active, so it will never run again', ageMin: num(outputAgeMin) };

  const outAge = num(outputAgeMin);
  const quiet = outAge > num(maxQuietMin);
  if (!quiet) return { name: n, state: 'ok', why: STATES.ok, ageMin: outAge };

  // The job has been quiet. Is that its fault?
  const hasFeed = inputCount !== null || inputAgeMin !== null;
  if (!hasFeed) {
    return { name: n, state: 'stale', why: `no output for ${Math.round(outAge)}m (expected under ${num(maxQuietMin)}m)`, ageMin: outAge };
  }
  if (num(inputCount) === 0 || inputAgeMin === null) {
    const after = num(starvedAfterMin) || num(maxQuietMin) * 4;
    if (outAge > after) {
      return {
        name: n, state: 'starved', ageMin: outAge,
        why: `nothing to process for ${Math.round(outAge / 60)}h — the job is fine, its INPUT has stopped `
           + 'arriving. Fix whatever feeds it.',
      };
    }
    return { name: n, state: 'idle', why: STATES.idle, ageMin: outAge };
  }
  // There IS input. If it is newer than our output, the job is genuinely behind.
  if (num(inputAgeMin) < outAge) {
    return {
      name: n, state: 'stale', ageMin: outAge,
      why: `input arrived ${Math.round(num(inputAgeMin))}m ago but the output is ${Math.round(outAge)}m old — not keeping up`,
    };
  }
  return { name: n, state: 'idle', why: STATES.idle, ageMin: outAge };
}

export const isProblem = (r) => r && (r.state === 'stale' || r.state === 'starved' || r.state === 'failed');

/**
 * Decide what to actually SEND, given what was sent last time.
 *
 * A problem is announced when it appears, when it gets materially worse (a state change, or a
 * doubling of how long it has been going), and once when it clears. Never on a bare timer.
 *
 * `escalateAfterMin` re-announces a long-running problem at most that often, so something genuinely
 * broken for a week does not fall silent forever — but at hours, not minutes.
 */
export function decideAlerts(results = [], previous = {}, { escalateAfterMin = 24 * 60, now = () => Date.now() } = {}) {
  const prev = previous && typeof previous === 'object' ? previous : {};
  const state = {};
  const fresh = []; const worse = []; const cleared = [];
  const t = now();

  for (const r of results) {
    if (!r || !r.name) continue;
    const p = prev[r.name];
    if (isProblem(r)) {
      const entry = { state: r.state, ageMin: num(r.ageMin), firstSeen: (p && p.firstSeen) || t, lastAlerted: (p && p.lastAlerted) || 0 };
      if (!p || !p.state) { fresh.push(r); entry.lastAlerted = t; }
      else if (p.state !== r.state) { worse.push({ ...r, was: p.state }); entry.lastAlerted = t; }
      // A doubling is material; a few more minutes is not.
      else if (num(r.ageMin) >= num(p.ageMin) * 2 && num(p.ageMin) > 0) { worse.push({ ...r, was: p.state }); entry.lastAlerted = t; }
      else if (t - num(p.lastAlerted) >= escalateAfterMin * 60000) { worse.push({ ...r, was: p.state, escalation: true }); entry.lastAlerted = t; }
      state[r.name] = entry;
    } else if (p && p.state) {
      cleared.push(r);   // it was broken, now it is not — worth exactly one message
    }
  }

  const lines = [
    ...fresh.map((r) => `🚨 ${r.name}: ${r.why}`),
    ...worse.map((r) => `${r.escalation ? '🔁' : '⬆️'} ${r.name}: ${r.why}${r.was && r.was !== r.state ? ` (was: ${r.was})` : ''}`),
    ...cleared.map((r) => `✅ ${r.name}: recovered`),
  ];
  return {
    send: lines.length > 0,
    text: lines.length ? `MELEK watchdog\n${lines.join('\n')}` : '',
    fresh: fresh.map((r) => r.name),
    worse: worse.map((r) => r.name),
    cleared: cleared.map((r) => r.name),
    // Suppressed problems are still REAL — they are just not news. Carried so a status command can
    // show everything currently wrong without another notification being sent.
    ongoing: results.filter(isProblem).filter((r) => !fresh.includes(r) && !worse.some((w) => w.name === r.name)).map((r) => r.name),
    state,
  };
}

/** A one-screen summary for an on-demand status check — everything wrong, nothing sent. */
export function statusReport(results = []) {
  const problems = results.filter(isProblem);
  if (!problems.length) return 'All MELEK services healthy.';
  return `MELEK status — ${problems.length} problem(s):\n`
    + problems.map((r) => `${r.state === 'starved' ? 'ℹ️' : '⚠️'} ${r.name}: ${r.why}`).join('\n');
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'watchdog-alerts', states: STATES,
    rule: 'announce on appear, on material worsening, and once on clear — never on a timer',
  }, null, 2));
}

export default { STATES, classify, isProblem, decideAlerts, statusReport, handler };

if (process.argv[1] && process.argv[1].endsWith('watchdog-alerts.mjs')) {
  const demo = classify({ name: 'continue (10m)', maxQuietMin: 25, outputAgeMin: 6540, inputCount: 0 });
  console.log(JSON.stringify({ demo, states: Object.keys(STATES) }, null, 1));
}
