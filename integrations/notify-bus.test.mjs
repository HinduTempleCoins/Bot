// notify-bus.test.mjs — OFFLINE. No network, injected send only. Covers: route maps events by rules,
// dedupe collapses repeats within a window, notify calls the injected send with the correct payload
// and soft-fails (no throw) when there's no endpoint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route, dedupe, notify, normalizePriority, __setFetch } from './notify-bus.mjs';

// Belt-and-suspenders: make any accidental real fetch blow up loudly rather than hit the network.
__setFetch(() => { throw new Error('network not allowed in tests'); });

test('normalizePriority maps names + clamps numbers', () => {
  assert.equal(normalizePriority('urgent'), 5);
  assert.equal(normalizePriority('low'), 2);
  assert.equal(normalizePriority(undefined), 3);
  assert.equal(normalizePriority(99), 5);
  assert.equal(normalizePriority(0), 1);
  assert.equal(normalizePriority('nonsense'), 3);
});

test('route: first matching rule wins, object field matchers', () => {
  const rules = [
    { match: { app: 'com.bank' }, topic: 'money', priority: 'high', tags: ['dollar'] },
    { match: { title: /otp|code/i }, topic: 'security', priority: 'max' },
    { match: true, topic: 'misc', priority: 'low' }, // catch-all
  ];
  const bank = route({ app: 'com.bank', title: 'Payment received' }, rules);
  assert.deepEqual(bank, { topic: 'money', priority: 4, tags: ['dollar'] });

  const otp = route({ app: 'com.sms', title: 'Your code is 1234' }, rules);
  assert.deepEqual(otp, { topic: 'security', priority: 5, tags: [] });

  const other = route({ app: 'com.game', title: 'New level!' }, rules);
  assert.deepEqual(other, { topic: 'misc', priority: 2, tags: [] });
});

test('route: function matchers, function topic/priority/tags, and no-match', () => {
  const rules = [
    {
      match: (e) => e.score > 10,
      topic: (e) => `alerts-${e.region}`,
      priority: (e) => (e.score > 100 ? 'urgent' : 'high'),
      tags: (e) => [e.region],
    },
  ];
  assert.deepEqual(route({ score: 5, region: 'us' }, rules), null); // nothing matches, no default
  assert.deepEqual(route({ score: 50, region: 'us' }, rules), { topic: 'alerts-us', priority: 4, tags: ['us'] });
  assert.deepEqual(route({ score: 500, region: 'eu' }, rules), { topic: 'alerts-eu', priority: 5, tags: ['eu'] });
});

test('route: substring (case-insensitive) and array any-of matchers', () => {
  const rules = [{ match: { app: ['whatsapp', 'signal'], message: 'urgent' }, topic: 'chat', priority: 'high' }];
  assert.deepEqual(route({ app: 'org.SIGNAL.app', message: 'This is URGENT pls' }, rules), { topic: 'chat', priority: 4, tags: [] });
  assert.equal(route({ app: 'com.email', message: 'urgent' }, rules), null); // app doesn't match
  assert.equal(route({ app: 'signal', message: 'hi' }, rules), null); // message doesn't match
});

test('dedupe: collapses repeats within window, keeps first with count + lastTs', () => {
  const events = [
    { app: 'a', title: 't', message: 'm', ts: 0 },
    { app: 'a', title: 't', message: 'm', ts: 1000 },
    { app: 'a', title: 't', message: 'm', ts: 2000 },
    { app: 'b', title: 'x', message: 'y', ts: 2500 },
  ];
  const out = dedupe(events, { windowMs: 5000 });
  assert.equal(out.length, 2);
  assert.equal(out[0].count, 3);
  assert.equal(out[0].lastTs, 2000);
  assert.equal(out[0].ts, 0); // first occurrence kept
  assert.equal(out[1].count, 1);
});

test('dedupe: events outside the window are kept separately', () => {
  const events = [
    { app: 'a', title: 't', message: 'm', ts: 0 },
    { app: 'a', title: 't', message: 'm', ts: 100_000 }, // far outside 60s window
  ];
  const out = dedupe(events, { windowMs: 60_000 });
  assert.equal(out.length, 2);
  assert.equal(out[0].count, 1);
  assert.equal(out[1].count, 1);
});

test('dedupe: sliding window chains repeats; custom key', () => {
  // each repeat is within 60s of the previous, but first->last spans > window: still one group (sliding).
  const events = [
    { id: 1, k: 'same', ts: 0 },
    { id: 2, k: 'same', ts: 50_000 },
    { id: 3, k: 'same', ts: 100_000 },
  ];
  const out = dedupe(events, { windowMs: 60_000, key: (e) => e.k });
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 3);
  assert.equal(out[0].lastTs, 100_000);
});

test('dedupe: falls back to index order when no ts', () => {
  const events = [{ app: 'a' }, { app: 'a' }, { app: 'b' }];
  const out = dedupe(events, { windowMs: 5 });
  assert.equal(out.length, 2);
  assert.equal(out[0].count, 2);
});

test('notify: calls injected send with normalized payload', async () => {
  let received;
  const send = (p) => { received = p; return { ok: true, status: 200 }; };
  const res = await notify({ topic: 'money', title: 'Hi', message: 'body', priority: 'high', tags: ['x'] }, { send });
  assert.deepEqual(res, { ok: true, status: 200 });
  assert.deepEqual(received, { topic: 'money', title: 'Hi', message: 'body', priority: 4, tags: ['x'] });
});

test('notify: defaults missing fields', async () => {
  let received;
  const send = (p) => { received = p; return { ok: true }; };
  await notify({ topic: 't' }, { send });
  assert.equal(received.title, '');
  assert.equal(received.message, '');
  assert.equal(received.priority, 3);
  assert.deepEqual(received.tags, []);
});

test('notify: soft-fails (skipped) when no endpoint configured, no throw', async () => {
  // default sender, empty env → no NOTIFY_BUS_URL → skipped, never touches the network.
  const res = await notify({ topic: 't', message: 'm' }, { env: {} });
  assert.equal(res.ok, false);
  assert.equal(res.skipped, 'no-endpoint');
});

test('notify: soft-fails when injected sender throws', async () => {
  const send = () => { throw new Error('boom'); };
  const res = await notify({ topic: 't', message: 'm' }, { send });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'boom');
});

test('notify: does not leak token into the result', async () => {
  // injected send that returns the token would be a bug; assert our soft-fail path never echoes env.
  const res = await notify({ topic: 't', message: 'm' }, { env: { NOTIFY_BUS_TOKEN: 'SECRET-TOKEN' } });
  assert.equal(JSON.stringify(res).includes('SECRET-TOKEN'), false);
});
