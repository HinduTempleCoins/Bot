// integrations/quota-window.test.mjs — offline tests for the pure sliding-window quota check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, record, createLimiter } from './quota-window.mjs';

const WIN = 60_000; // 1 min
const NOW = 1_000_000;

test('check: empty history is allowed with full remaining', () => {
  const v = check({ key: 'u', now: NOW, history: [], limit: 3, windowMs: WIN });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 3);
  assert.equal(v.retryAfterMs, 0);
  assert.deepEqual(v.prunedHistory, []);
});

test('check: under limit allowed, remaining counts down', () => {
  const hist = [NOW - 1000, NOW - 2000];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 3, windowMs: WIN });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 1);
  assert.equal(v.retryAfterMs, 0);
});

test('check: at limit is blocked, remaining 0', () => {
  const hist = [NOW - 1000, NOW - 2000, NOW - 3000];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 3, windowMs: WIN });
  assert.equal(v.allowed, false);
  assert.equal(v.remaining, 0);
  assert.ok(v.retryAfterMs > 0);
});

test('check: prunes stamps older than the window', () => {
  // two stale (older than window) + one fresh
  const hist = [NOW - WIN - 5000, NOW - WIN - 1, NOW - 100];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 2, windowMs: WIN });
  assert.deepEqual(v.prunedHistory, [NOW - 100]);
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 1);
});

test('check: stamp exactly at the cutoff is pruned (strict > now-window)', () => {
  const hist = [NOW - WIN]; // ts === cutoff, NOT in window
  const v = check({ key: 'u', now: NOW, history: hist, limit: 1, windowMs: WIN });
  assert.deepEqual(v.prunedHistory, []);
  assert.equal(v.allowed, true);
});

test('check: retryAfterMs derives from the OLDEST in-window stamp', () => {
  const oldest = NOW - 10_000;
  const hist = [oldest, NOW - 5000];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 2, windowMs: WIN });
  assert.equal(v.allowed, false);
  // oldest ages out at oldest + WIN; retry = that - now
  assert.equal(v.retryAfterMs, oldest + WIN - NOW);
});

test('check: unsorted history still computes correct oldest', () => {
  const hist = [NOW - 5000, NOW - 30_000, NOW - 1000];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 3, windowMs: WIN });
  assert.equal(v.allowed, false);
  assert.equal(v.retryAfterMs, NOW - 30_000 + WIN - NOW);
});

test('check: does NOT mutate the input history array', () => {
  const hist = [NOW - WIN - 1, NOW - 100];
  const copy = [...hist];
  check({ key: 'u', now: NOW, history: hist, limit: 5, windowMs: WIN });
  assert.deepEqual(hist, copy);
});

test('record: appends now and does not mutate input', () => {
  const hist = [NOW - 100];
  const next = record({ history: hist, now: NOW });
  assert.deepEqual(next, [NOW - 100, NOW]);
  assert.deepEqual(hist, [NOW - 100]); // unchanged
});

test('record + check round-trip enforces a hard cap', () => {
  const limit = 3;
  let hist = [];
  const allowedFlags = [];
  for (let i = 0; i < 5; i++) {
    const t = NOW + i * 1000; // all within the window
    const v = check({ key: 'u', now: t, history: hist, limit, windowMs: WIN });
    allowedFlags.push(v.allowed);
    if (v.allowed) hist = record({ history: v.prunedHistory, now: t });
  }
  assert.deepEqual(allowedFlags, [true, true, true, false, false]);
  assert.equal(hist.length, 3);
});

test('record + check: window slide frees a slot', () => {
  const limit = 1;
  let hist = [];
  let v = check({ key: 'u', now: 0, history: hist, limit, windowMs: WIN });
  assert.equal(v.allowed, true);
  hist = record({ history: v.prunedHistory, now: 0 });

  // immediately after: blocked
  v = check({ key: 'u', now: 1, history: hist, limit, windowMs: WIN });
  assert.equal(v.allowed, false);

  // after the window passes: allowed again, old stamp pruned
  v = check({ key: 'u', now: WIN + 1, history: hist, limit, windowMs: WIN });
  assert.equal(v.allowed, true);
  assert.deepEqual(v.prunedHistory, []);
});

// ---- soft-fail / garbage inputs --------------------------------------------------------------

test('soft-fail: no args never throws, returns a sane shape', () => {
  let v;
  assert.doesNotThrow(() => {
    v = check();
  });
  assert.equal(typeof v.allowed, 'boolean');
  assert.equal(v.allowed, true);
  assert.ok(Array.isArray(v.prunedHistory));
});

test('soft-fail: garbage history entries are dropped', () => {
  const hist = [NOW - 100, 'nope', null, undefined, NaN, {}, NOW - 200];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 5, windowMs: WIN });
  assert.deepEqual(v.prunedHistory.sort((a, b) => a - b), [NOW - 200, NOW - 100]);
});

test('soft-fail: history not an array → treated as empty', () => {
  const v = check({ key: 'u', now: NOW, history: 'garbage', limit: 2, windowMs: WIN });
  assert.deepEqual(v.prunedHistory, []);
  assert.equal(v.allowed, true);
});

test('soft-fail: junk limit/window clamp to defaults', () => {
  const v = check({ key: 'u', now: NOW, history: [], limit: -5, windowMs: 0 });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining, 10); // default limit
});

test('soft-fail: numeric-string timestamps are coerced', () => {
  const hist = [String(NOW - 100), String(NOW - 200)];
  const v = check({ key: 'u', now: NOW, history: hist, limit: 1, windowMs: WIN });
  assert.equal(v.allowed, false);
  assert.equal(v.prunedHistory.length, 2);
});

test('record: soft-fail with no args does not throw', () => {
  let out;
  assert.doesNotThrow(() => {
    out = record();
  });
  assert.equal(out.length, 1);
  assert.ok(Number.isFinite(out[0]));
});

// ---- stateful factory ------------------------------------------------------------------------

test('createLimiter: check does not count; consume does', () => {
  const lim = createLimiter({ limit: 2, windowMs: WIN });
  // two checks without recording stay allowed (no count)
  assert.equal(lim.check('a', 0).allowed, true);
  assert.equal(lim.check('a', 1).allowed, true);
  assert.equal(lim.peek('a').length, 0);

  assert.equal(lim.consume('a', 2).allowed, true);
  assert.equal(lim.consume('a', 3).allowed, true);
  assert.equal(lim.consume('a', 4).allowed, false); // third within window blocked
  assert.equal(lim.peek('a').length, 2);
});

test('createLimiter: keys are independent', () => {
  const lim = createLimiter({ limit: 1, windowMs: WIN });
  assert.equal(lim.consume('a', 0).allowed, true);
  assert.equal(lim.consume('a', 1).allowed, false);
  assert.equal(lim.consume('b', 1).allowed, true); // different key, own bucket
});

test('createLimiter: window slide frees the bucket', () => {
  const lim = createLimiter({ limit: 1, windowMs: WIN });
  assert.equal(lim.consume('a', 0).allowed, true);
  assert.equal(lim.consume('a', 10).allowed, false);
  assert.equal(lim.consume('a', WIN + 1).allowed, true);
});

test('createLimiter: check prunes stored bucket as a side benefit', () => {
  const lim = createLimiter({ limit: 5, windowMs: WIN });
  lim.consume('a', 0);
  lim.consume('a', 10);
  // far future check should prune both stale stamps out of the stored bucket
  lim.check('a', WIN * 10);
  assert.equal(lim.peek('a').length, 0);
});

test('createLimiter: reset and size', () => {
  const lim = createLimiter({ limit: 3, windowMs: WIN });
  lim.consume('a', 0);
  lim.consume('b', 0);
  assert.equal(lim.size(), 2);
  lim.reset('a');
  assert.equal(lim.size(), 1);
  lim.reset();
  assert.equal(lim.size(), 0);
});

test('createLimiter: null/undefined key collapses to one shared bucket, no throw', () => {
  const lim = createLimiter({ limit: 1, windowMs: WIN });
  assert.doesNotThrow(() => {
    assert.equal(lim.consume(null, 0).allowed, true);
    assert.equal(lim.consume(undefined, 1).allowed, false); // same shared bucket
  });
});

test('createLimiter: junk config clamps to defaults', () => {
  const lim = createLimiter({ limit: 'x', windowMs: -1 });
  assert.equal(lim.limit, 10);
  assert.equal(lim.windowMs, 3600_000);
});
