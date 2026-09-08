// watchdog-alerts.test.mjs — OFFLINE. Pure functions; no clock, no network, no filesystem.
import { test } from 'node:test';
import assert from 'node:assert';
import { STATES, classify, isProblem, decideAlerts, statusReport, handler } from './watchdog-alerts.mjs';

// ── the real case that caused this ────────────────────────────────────────────────────────────────
test('the continue job: healthy, no input, 109h quiet — STARVED, and the message blames the feed', () => {
  const r = classify({ name: 'continue (10m)', maxQuietMin: 25, outputAgeMin: 109 * 60, inputCount: 0 });
  assert.equal(r.state, 'starved');
  assert.match(r.why, /INPUT has stopped arriving/);
  assert.match(r.why, /109h/);
  assert.ok(!/died|failed/i.test(r.why), 'it must not say the job died — it did not');
});

test('the same job, quiet but not yet long enough, is IDLE and not a problem at all', () => {
  const r = classify({ name: 'continue (10m)', maxQuietMin: 25, outputAgeMin: 40, inputCount: 0 });
  assert.equal(r.state, 'idle');
  assert.equal(isProblem(r), false, 'silence with nothing to do is correct output, not an incident');
});

test('input newer than output IS stale — the job is genuinely behind', () => {
  const r = classify({ name: 'continue (10m)', maxQuietMin: 25, outputAgeMin: 120, inputAgeMin: 5, inputCount: 3 });
  assert.equal(r.state, 'stale');
  assert.match(r.why, /not keeping up/);
  assert.equal(isProblem(r), true);
});

test('input older than output means the job already handled it — idle', () => {
  const r = classify({ name: 'x', maxQuietMin: 25, outputAgeMin: 60, inputAgeMin: 90, inputCount: 2 });
  assert.equal(r.state, 'idle');
});

test('a job with NO feed is judged on its own output — a poller has no excuse', () => {
  const r = classify({ name: 'annals (1m)', maxQuietMin: 6, outputAgeMin: 45 });
  assert.equal(r.state, 'stale');
  assert.match(r.why, /no output for 45m/);
});

test('failure and a dead timer both outrank staleness', () => {
  assert.equal(classify({ name: 'a', serviceFailed: true, outputAgeMin: 1 }).state, 'failed');
  const t = classify({ name: 'b', timerActive: false, outputAgeMin: 1 });
  assert.equal(t.state, 'failed');
  assert.match(t.why, /never run again/);
});

test('a healthy on-time job is ok, and ok is never a problem', () => {
  const r = classify({ name: 'a', maxQuietMin: 30, outputAgeMin: 5 });
  assert.equal(r.state, 'ok');
  assert.equal(isProblem(r), false);
});

// ── the noise fix ─────────────────────────────────────────────────────────────────────────────────
const starved = (age) => classify({ name: 'continue (10m)', maxQuietMin: 25, outputAgeMin: age, inputCount: 0 });

test('a NEW problem is announced once', () => {
  const d = decideAlerts([starved(6540)], {});
  assert.equal(d.send, true);
  assert.deepEqual(d.fresh, ['continue (10m)']);
  assert.match(d.text, /🚨/);
});

test('the SAME problem, fifteen minutes later, sends nothing — this is the whole point', () => {
  const first = decideAlerts([starved(6540)], {});
  const second = decideAlerts([starved(6555)], first.state);
  assert.equal(second.send, false, '430 identical alerts is how a monitor gets ignored');
  assert.equal(second.text, '');
  assert.deepEqual(second.ongoing, ['continue (10m)'], 'still wrong, just not news');
});

test('a doubling IS material and re-announces', () => {
  // Both ages must already be starved: at maxQuiet 25 the starve threshold is 4x = 100 minutes.
  const first = decideAlerts([starved(200)], {});
  assert.deepEqual(first.fresh, ['continue (10m)']);
  const later = decideAlerts([starved(400)], first.state);
  assert.equal(later.send, true);
  assert.deepEqual(later.worse, ['continue (10m)'], 'twice as long is news; twenty more minutes is not');
});

test('the idle-to-starved crossing is itself the first alert', () => {
  const quiet = decideAlerts([starved(60)], {});
  assert.equal(quiet.send, false, '60m with nothing to do is still just idle');
  const crossed = decideAlerts([starved(200)], quiet.state);
  assert.deepEqual(crossed.fresh, ['continue (10m)']);
});

test('a state change re-announces and says what it was', () => {
  const first = decideAlerts([starved(6540)], {});
  const failedNow = classify({ name: 'continue (10m)', serviceFailed: true, outputAgeMin: 6600 });
  const next = decideAlerts([failedNow], first.state);
  assert.equal(next.send, true);
  assert.match(next.text, /was: starved/);
});

test('recovery is worth exactly one message, then silence', () => {
  const first = decideAlerts([starved(6540)], {});
  const ok = classify({ name: 'continue (10m)', maxQuietMin: 25, outputAgeMin: 2, inputCount: 1, inputAgeMin: 3 });
  const rec = decideAlerts([ok], first.state);
  assert.equal(rec.send, true);
  assert.deepEqual(rec.cleared, ['continue (10m)']);
  assert.match(rec.text, /✅/);
  const after = decideAlerts([ok], rec.state);
  assert.equal(after.send, false, 'recovered stays quiet');
});

test('a long-running problem escalates on a slow clock, not a fast one', () => {
  let t = 1_000_000;
  const first = decideAlerts([starved(6540)], {}, { now: () => t });
  t += 60 * 60 * 1000;                                   // one hour
  const hourly = decideAlerts([starved(6600)], first.state, { now: () => t });
  assert.equal(hourly.send, false, 'an hour is not news');
  t += 24 * 60 * 60 * 1000;                              // a day
  const daily = decideAlerts([starved(6700)], hourly.state, { now: () => t });
  assert.equal(daily.send, true);
  assert.match(daily.text, /🔁/);
});

test('healthy services never appear in an alert', () => {
  const d = decideAlerts([classify({ name: 'ok-one', maxQuietMin: 30, outputAgeMin: 1 })], {});
  assert.equal(d.send, false);
  assert.deepEqual(d.state, {});
});

test('several problems at once are one message, not several', () => {
  const d = decideAlerts([starved(6540), classify({ name: 'annals (1m)', maxQuietMin: 6, outputAgeMin: 90 })], {});
  assert.equal(d.fresh.length, 2);
  assert.equal((d.text.match(/\n/g) || []).length, 2, 'one header, two lines');
});

// ── status on demand ──────────────────────────────────────────────────────────────────────────────
test('statusReport shows everything wrong without sending anything', () => {
  const s = statusReport([starved(6540), classify({ name: 'ok-one', maxQuietMin: 30, outputAgeMin: 1 })]);
  assert.match(s, /1 problem/);
  assert.match(s, /continue/);
  assert.ok(!s.includes('ok-one'));
  assert.equal(statusReport([classify({ name: 'a', maxQuietMin: 30, outputAgeMin: 1 })]), 'All MELEK services healthy.');
});

test('a starved job is marked informational, a stale one as a warning', () => {
  assert.match(statusReport([starved(6540)]), /ℹ️/);
  assert.match(statusReport([classify({ name: 'a', maxQuietMin: 6, outputAgeMin: 90 })]), /⚠️/);
});

test('junk rows are ignored rather than crashing the run', () => {
  const d = decideAlerts([null, {}, starved(6540)], {});
  assert.deepEqual(d.fresh, ['continue (10m)']);
  assert.equal(decideAlerts([], {}).send, false);
  assert.equal(decideAlerts([], null).send, false);
});

test('every state has a description, and the handler states the rule', () => {
  assert.ok(Object.values(STATES).every((v) => typeof v === 'string' && v.length));
  let body = '';
  handler({}, { setHeader() {}, end(b) { body = b; } });
  assert.match(JSON.parse(body).rule, /never on a timer/);
});
