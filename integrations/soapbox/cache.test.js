// cache.test.js — the condenser hot cache: TTL hit/miss, single-flight de-dup, stale-on-error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, invalidate, stats, __setClock } from './cache.mjs';

test('caches within TTL, recomputes after expiry', async () => {
  invalidate();
  let t = 1000; __setClock(() => t);
  let calls = 0;
  const fn = async () => (++calls, `v${calls}`);
  assert.equal(await cached('k', 100, fn), 'v1');
  assert.equal(await cached('k', 100, fn), 'v1');   // within TTL → cached
  assert.equal(calls, 1);
  t = 1101;                                          // past expiry
  assert.equal(await cached('k', 100, fn), 'v2');
  assert.equal(calls, 2);
  __setClock(null);
});

test('single-flight: concurrent callers share one compute', async () => {
  invalidate();
  let calls = 0;
  const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return calls; };
  const [a, b, c] = await Promise.all([cached('s', 1000, fn), cached('s', 1000, fn), cached('s', 1000, fn)]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], [1, 1, 1]);
});

test('serves last good value when the feeder throws', async () => {
  invalidate();
  let t = 0; __setClock(() => t);
  assert.equal(await cached('e', 50, async () => 'good'), 'good');
  t = 100;                                           // expire it
  const boom = async () => { throw new Error('feeder down'); };
  assert.equal(await cached('e', 50, boom), 'good'); // stale fallback, not a throw
  __setClock(null);
});

test('propagates error when there is no prior value', async () => {
  invalidate();
  await assert.rejects(cached('cold', 50, async () => { throw new Error('nope'); }), /nope/);
});

test('stats reports fresh/stale/keys', async () => {
  invalidate();
  let t = 0; __setClock(() => t);
  await cached('a', 50, async () => 1);
  await cached('b', 200, async () => 2);
  t = 100;                                           // 'a' now stale, 'b' still fresh
  const s = stats();
  assert.equal(s.keys, 2);
  assert.equal(s.fresh, 1);
  assert.equal(s.stale, 1);
  __setClock(null);
});
