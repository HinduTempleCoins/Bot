// ifttt-executor.test.mjs — OFFLINE. Injected fetch + notifier, no network, no keys.
//
// Covers the thing that was missing: ifttt-triggers.evaluate() produced planned actions that nothing
// ever executed. These assert the executor performs the keyless ones, REFUSES the ones that move value
// (keeping the Signer boundary), and cannot be pointed at an internal address by a user-supplied recipe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, executeAll, isSafeWebhookTarget, KEYLESS_ACTIONS, SIGNER_ACTIONS, __setFetch }
  from './ifttt-executor.mjs';
import { evaluate } from './ifttt-triggers.mjs';

const at = () => 1700000000000;

test('notify executes through the injected notifier', async () => {
  const seen = [];
  const r = await execute({ recipeId: 'r1', name: 'n', action: 'notify', target: 'ops', tag: 'prana', whenType: 'tag' },
    { notify: async (m) => seen.push(m), now: at });
  assert.equal(r.ok, true);
  assert.equal(r.executed, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].message, /Herald/);
  assert.match(seen[0].message, /prana/);
});

test('notify with no notifier configured fails cleanly rather than throwing', async () => {
  const r = await execute({ recipeId: 'r', action: 'notify' }, { now: at });
  assert.equal(r.ok, false);
  assert.equal(r.executed, false);
  assert.match(r.reason, /no notifier/);
});

test('webhook POSTs the event and reports the status', async () => {
  let got = null;
  __setFetch(async (url, opts) => { got = { url, opts }; return { ok: true, status: 200 }; });
  const r = await execute({ recipeId: 'r2', name: 'w', action: 'webhook', target: 'https://example.com/hook',
    tag: 'prana', whenType: 'tag', event: { author: 'bob' } }, { now: at });
  __setFetch(null);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(got.url, 'https://example.com/hook');
  assert.equal(got.opts.method, 'POST');
  const body = JSON.parse(got.opts.body);
  assert.equal(body.recipeId, 'r2');
  assert.equal(body.tag, 'prana');
});

test('a non-2xx webhook is reported, not thrown', async () => {
  __setFetch(async () => ({ ok: false, status: 503 }));
  const r = await execute({ recipeId: 'r', action: 'webhook', target: 'https://example.com/h' }, { now: at });
  __setFetch(null);
  assert.equal(r.ok, false);
  assert.equal(r.executed, true);
  assert.match(r.reason, /503/);
});

// ---------------------------------------------------------------------------
// THE BOUNDARY: reward and post move value. This module holds no key, by construction.
// ---------------------------------------------------------------------------
test('reward and post are REFUSED and handed to the Signer, not executed', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, status: 200 }; });
  for (const type of SIGNER_ACTIONS) {
    const r = await execute({ recipeId: 'x', action: type, target: 'alice' },
      { now: at, notify: async () => { called = true; } });
    assert.equal(r.executed, false, `${type} must not execute`);
    assert.equal(r.requiresSigner, true, `${type} must be flagged for the Signer`);
    assert.match(r.reason, /MELEK-Signer/);
  }
  __setFetch(null);
  assert.equal(called, false, 'a value-moving action must never reach fetch or the notifier');
});

// ---------------------------------------------------------------------------
// SSRF: a recipe target is user input.
// ---------------------------------------------------------------------------
test('webhook targets cannot point at internal or private addresses', async () => {
  const blocked = [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/', 'http://10.0.0.5/x', 'http://192.168.1.1/x',
    'http://172.16.0.1/x', 'http://100.64.0.1/x', 'http://thing.internal/x', 'http://box.local/x',
    'file:///etc/passwd', 'gopher://x/', 'https://user:pass@example.com/x', 'not a url',
  ];
  for (const t of blocked) {
    assert.equal(isSafeWebhookTarget(t).ok, false, `${t} must be blocked`);
  }
  for (const t of ['https://example.com/hook', 'http://example.org/h?a=1']) {
    assert.equal(isSafeWebhookTarget(t).ok, true, `${t} should be allowed`);
  }
});

test('an unsafe target is refused BEFORE any request is made', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, status: 200 }; });
  const r = await execute({ recipeId: 'r', action: 'webhook', target: 'http://169.254.169.254/' }, { now: at });
  __setFetch(null);
  assert.equal(called, false, 'must not fetch an unsafe target');
  assert.equal(r.ok, false);
  assert.match(r.reason, /unsafe target/);
});

test('execute never throws on junk', async () => {
  for (const junk of [null, undefined, {}, { action: 'nonsense' }, { action: 'webhook' }]) {
    const r = await execute(junk, { now: at });
    assert.equal(typeof r, 'object');
    assert.equal(r.ok, false);
  }
});

// ---------------------------------------------------------------------------
// END TO END: the rule engine's output actually gets acted on. This is the gap that existed.
// ---------------------------------------------------------------------------
test('evaluate() -> executeAll(): a fired recipe now actually does something', async () => {
  const recipes = [
    { id: 'a', name: 'ping ops', when: { type: 'tag', tag: 'prana' }, then: { type: 'notify', target: 'ops' } },
    { id: 'b', name: 'call hook', when: { type: 'tag', tag: 'prana' }, then: { type: 'webhook', target: 'https://example.com/h' } },
    { id: 'c', name: 'pay out',  when: { type: 'tag', tag: 'prana' }, then: { type: 'reward', target: 'alice' } },
  ];
  // evaluate() gates on event.type matching recipe.when.type (ifttt-triggers.mjs:103), so a tag
  // recipe only fires on a tag-typed event. Omitting it silently planned nothing.
  const planned = evaluate(recipes, { type: 'tag', author: 'bob', tags: ['prana'], permlink: 'p1' });
  assert.equal(planned.length, 3, 'all three recipes should fire on the tag');
  assert.ok(planned.every((p) => p.planned === true), 'evaluate only plans');

  const notified = [];
  __setFetch(async () => ({ ok: true, status: 200 }));
  const out = await executeAll(planned, { notify: async (m) => notified.push(m), now: at });
  __setFetch(null);

  assert.equal(out.total, 3);
  assert.equal(out.executed, 2, 'the two keyless actions execute');
  assert.equal(out.ok, 2);
  assert.equal(out.needSigner, 1, 'the reward is handed to the Signer');
  assert.equal(notified.length, 1);
});

test('the action split is exactly what the module documents', () => {
  assert.deepEqual(KEYLESS_ACTIONS, ['notify', 'webhook']);
  assert.deepEqual(SIGNER_ACTIONS, ['reward', 'post']);
});
