// captcha-handoff.test.mjs — OFFLINE. Injected notifier + clock + store. No network, no real timers.
// Covers: requestHandoff enqueues + calls the notifier with the operator prompt and NEVER auto-solves
// (there is no solver path — the handoff is born with answer:null and only a human fills it);
// listPending excludes expired (advance clock); resolveHandoff supplies the operator's answer and a
// waiting awaitResolution gets it; an expired handoff resolves ok:false; redactForLog hides the solution.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestHandoff,
  listPending,
  resolveHandoff,
  awaitResolution,
  expireStale,
  redactForLog,
  getHandoff,
  __setNotifier,
  __setClock,
  __setStore,
  PENDING,
  RESOLVED,
} from './captcha-handoff.mjs';

// A controllable clock so "expired" is deterministic and instant.
let NOW = 1_000_000;
function setNow(t) { NOW = t; }
__setClock(() => NOW);

function freshStore() { __setStore(new Map()); }

test('requestHandoff enqueues, notifies operator with the prompt, and NEVER auto-solves', async () => {
  freshStore();
  setNow(1_000_000);
  const calls = [];
  __setNotifier(async (payload) => { calls.push(payload); return { ok: true }; });

  const res = await requestHandoff({
    kind: 'captcha',
    context: { service: 'signup', step: 'verify' },
    screenshotRef: 'shot://abc',
    promptText: 'Solve this CAPTCHA please',
    expiresInMs: 60_000,
  });

  assert.ok(res.id, 'returns an id');
  assert.equal(res.status, PENDING);
  assert.equal(res.expiresAt, 1_060_000);

  // notifier got the operator prompt (the human-actionable text), not any solution.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, res.id);
  assert.equal(calls[0].kind, 'captcha');
  assert.equal(calls[0].promptText, 'Solve this CAPTCHA please');
  assert.equal(calls[0].screenshotRef, 'shot://abc');
  assert.ok(!('answer' in calls[0]), 'notify payload carries no answer/solution');

  // NEVER auto-solves: the freshly enqueued handoff has no answer and is still pending.
  const pend = listPending();
  assert.equal(pend.length, 1);
  assert.equal(pend[0].answer, null, 'no auto-solved answer — a human must supply it');
  assert.equal(pend[0].status, PENDING);
});

test('requestHandoff soft-fails the notify but still enqueues the handoff', async () => {
  freshStore();
  setNow(2_000_000);
  __setNotifier(async () => { throw new Error('telegram down'); });

  const res = await requestHandoff({ kind: 'human', promptText: 'approve please' });
  assert.ok(res.id);
  assert.equal(res.status, PENDING);
  assert.equal(res.notified.ok, false);
  assert.equal(listPending().length, 1, 'handoff is still pending despite notify failure');
});

test('listPending excludes expired handoffs once the clock advances', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));

  await requestHandoff({ kind: 'sms', expiresInMs: 1000 });
  assert.equal(listPending().length, 1, 'pending before expiry');

  setNow(2000); // past the 1000ms TTL
  assert.equal(listPending().length, 0, 'excluded after expiry');
});

test('resolveHandoff supplies the operator answer; a waiting awaitResolution receives it', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));

  const { id } = await requestHandoff({ kind: 'sms', expiresInMs: 60_000 });

  // pollFn flips to resolved on the 3rd poll — simulates the operator tapping mid-wait. intervalMs:0
  // keeps the test instant (no real timers).
  let polls = 0;
  const waitP = awaitResolution(id, {
    timeoutMs: 60_000,
    intervalMs: 0,
    pollFn: (hid) => {
      polls += 1;
      if (polls === 3) resolveHandoff(hid, { answer: '123456', by: 'operator' });
      return undefined; // force read-through to the store
    },
  });

  const result = await waitP;
  assert.equal(result.ok, true);
  assert.equal(result.status, RESOLVED);
  assert.equal(result.answer, '123456', 'flow resumes on the human-supplied SMS code');
  assert.ok(polls >= 3);
});

test('resolveHandoff on an expired handoff returns ok:false', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));

  const { id } = await requestHandoff({ kind: 'captcha', expiresInMs: 500 });
  setNow(10_000); // well past expiry
  const r = resolveHandoff(id, { answer: 'too late', by: 'operator' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'expired');
});

test('resolveHandoff on an unknown id returns ok:false', () => {
  freshStore();
  const r = resolveHandoff('does-not-exist', { answer: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown');
});

test('awaitResolution times out gracefully when no human answers', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));
  const { id } = await requestHandoff({ kind: 'human', expiresInMs: 1_000_000 });

  // Clock advances past the timeout on each poll; intervalMs:0 → no real waiting.
  const r = await awaitResolution(id, {
    timeoutMs: 100,
    intervalMs: 0,
    pollFn: (hid) => { setNow(NOW + 1000); return _peek(hid); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'timeout');

  function _peek() { return { status: PENDING }; }
});

test('awaitResolution returns expired when the handoff lapses while waiting', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));
  const { id } = await requestHandoff({ kind: 'sms', expiresInMs: 500 });

  const r = await awaitResolution(id, {
    timeoutMs: 1_000_000,
    intervalMs: 0,
    pollFn: (hid) => { setNow(NOW + 1000); return undefined; }, // read-through; clock passes TTL
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'expired');
});

test('expireStale sweeps pending handoffs past their deadline', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));
  const a = await requestHandoff({ kind: 'captcha', expiresInMs: 100 });
  await requestHandoff({ kind: 'human', expiresInMs: 1_000_000 });

  setNow(500);
  const swept = expireStale();
  assert.deepEqual(swept, [a.id], 'only the lapsed one is swept');
  assert.equal(listPending().length, 1, 'the long-lived one remains pending');
});

test('redactForLog hides the human-supplied solution', async () => {
  freshStore();
  setNow(0);
  __setNotifier(async () => ({ ok: true }));
  const { id } = await requestHandoff({ kind: 'sms', promptText: 'enter the code', expiresInMs: 60_000 });
  resolveHandoff(id, { answer: '987654', by: 'operator' });

  const safe = redactForLog(getHandoff(id));
  assert.equal(safe.answer, '[redacted]', 'the actual code is never in the log view');
  assert.equal(safe.promptText, 'enter the code', 'descriptive prompt is fine to log');
  assert.equal(JSON.stringify(safe).includes('987654'), false, 'solution absent from log view');

  // a never-answered handoff logs answer:null, not "[redacted]"
  const { id: id2 } = await requestHandoff({ kind: 'captcha', expiresInMs: 60_000 });
  const safe2 = redactForLog(getHandoff(id2));
  assert.equal(safe2.answer, null);
});
