// boot-warmup.test.mjs — OFFLINE. No network, no real sockets: the unit under test is the timeout
// race, exercised with fake tasks (a resolved promise, a rejected promise, and a promise that never
// settles — standing in for a hung upstream).
//
//   node --test integrations/soapbox/boot-warmup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootWarmup, DEFAULT_WARMUP_MS } from './boot-warmup.mjs';

const quiet = () => {}; // swallow the helper's progress logs in tests

test('resolves true when the task finishes in time', async () => {
  const ok = await bootWarmup(() => Promise.resolve('primed'), { ms: 1000, log: quiet });
  assert.equal(ok, true);
});

test('resolves false (does NOT throw) when the task rejects', async () => {
  const ok = await bootWarmup(() => Promise.reject(new Error('upstream 500')), { ms: 1000, log: quiet });
  assert.equal(ok, false);
});

test('a synchronous throw in the task is caught, not propagated', async () => {
  const ok = await bootWarmup(() => { throw new Error('boom'); }, { ms: 1000, log: quiet });
  assert.equal(ok, false);
});

test('times out (does NOT hang) when the task never settles', async () => {
  const started = Date.now();
  // a never-resolving promise = a hung upstream socket. Without the timeout this await would hang
  // the test runner; with it, bootWarmup resolves false promptly.
  const ok = await bootWarmup(() => new Promise(() => {}), { ms: 40, log: quiet });
  assert.equal(ok, false);
  assert.ok(Date.now() - started < 1000, 'should have given up quickly, not waited on the hung task');
});

test('logs the timeout with the provided label', async () => {
  const lines = [];
  await bootWarmup(() => new Promise(() => {}), { ms: 20, label: 'boot warmup: homepage', log: (m) => lines.push(m) });
  assert.ok(lines.some((l) => l.includes('boot warmup: homepage') && /timed out/.test(l)), `got: ${JSON.stringify(lines)}`);
});

test('exposes a sane default timeout', () => {
  assert.equal(typeof DEFAULT_WARMUP_MS, 'number');
  assert.ok(DEFAULT_WARMUP_MS > 0 && DEFAULT_WARMUP_MS <= 30000);
});

// Regression: the timeout must fire even when NOTHING ELSE holds the event loop open. The timer was
// once unref()'d, so on an idle loop it never fired and bootWarmup never resolved — the exact hang
// this module exists to prevent. It also made these tests die as `cancelledByParent` on Node 20.
test('the timeout still fires on an otherwise-idle event loop', async () => {
  const started = Date.now();
  const ok = await bootWarmup(() => new Promise(() => {}), { ms: 30, log: quiet });
  assert.equal(ok, false);
  assert.ok(Date.now() - started >= 25, 'should have actually waited for the timer, not short-circuited');
  assert.ok(Date.now() - started < 2000, 'and should not have hung');
});
