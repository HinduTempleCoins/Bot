// llm-gateway.test.mjs — OFFLINE unit tests for the LLM control-plane gateway (queue #89).
// No real provider calls: every test injects a fake backend and an injectable clock.
import { test } from 'node:test';
import assert from 'node:assert';
import { Gateway } from './llm-gateway.mjs';

// A controllable clock so rate-limit refill is deterministic.
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

// A fake backend that counts calls and echoes a result.
function fakeBackend(result = { text: 'ok', provider: 'fake', cost: 0.01 }) {
  const fn = async (req) => ({ ...result, _req: req });
  fn.calls = 0;
  const wrapped = async (req) => {
    wrapped.calls += 1;
    return fn(req);
  };
  wrapped.calls = 0;
  return wrapped;
}

// ── rate limit ──────────────────────────────────────────────────────────────────
test('rate limiter blocks calls over the burst, then refills', async () => {
  const c = clock();
  const gw = new Gateway({ ratePerSec: 1, burst: 2, now: c.now });
  const backend = fakeBackend();

  // burst = 2 → first two pass
  const r1 = await gw.call({ prompt: 'a', noCache: true }, backend);
  const r2 = await gw.call({ prompt: 'b', noCache: true }, backend);
  assert.equal(r1.error, undefined);
  assert.equal(r2.error, undefined);

  // third in same instant → blocked, backend NOT called
  const r3 = await gw.call({ prompt: 'c', noCache: true }, backend);
  assert.equal(r3.rejected, 'rate_limit');
  assert.equal(r3.error, 'rate_limited');
  assert.equal(backend.calls, 2, 'rate-limited call must not reach backend');

  // advance 1s → 1 token refilled → one more passes
  c.advance(1000);
  const r4 = await gw.call({ prompt: 'd', noCache: true }, backend);
  assert.equal(r4.error, undefined);
  assert.equal(backend.calls, 3);

  assert.equal(gw.metrics().rateLimited, 1);
});

test('rate limit is per-key (separate buckets)', async () => {
  const c = clock();
  const gw = new Gateway({ ratePerSec: 0, burst: 1, now: c.now });
  const backend = fakeBackend();

  const a = await gw.call({ prompt: 'x', key: 'alice', noCache: true }, backend);
  const b = await gw.call({ prompt: 'x', key: 'bob', noCache: true }, backend);
  assert.equal(a.error, undefined);
  assert.equal(b.error, undefined, 'a different key has its own bucket');

  // alice's bucket is now empty (rate 0 = no refill)
  const a2 = await gw.call({ prompt: 'x', key: 'alice', noCache: true }, backend);
  assert.equal(a2.rejected, 'rate_limit');
});

// ── budget cap ──────────────────────────────────────────────────────────────────
test('budget cap rejects once spend reaches the cap', async () => {
  const gw = new Gateway({ ratePerSec: 100, burst: 100, budgetUsd: 0.025 });
  const backend = fakeBackend({ text: 'ok', cost: 0.01 });

  const r1 = await gw.call({ prompt: '1', noCache: true }, backend); // spend 0.01
  const r2 = await gw.call({ prompt: '2', noCache: true }, backend); // spend 0.02
  assert.equal(r1.error, undefined);
  assert.equal(r2.error, undefined);

  // now totalCost 0.02 < 0.025 still ok, spends to 0.03
  const r3 = await gw.call({ prompt: '3', noCache: true }, backend);
  assert.equal(r3.error, undefined);

  // now totalCost 0.03 >= cap → reject without calling backend
  const before = backend.calls;
  const r4 = await gw.call({ prompt: '4', noCache: true }, backend);
  assert.equal(r4.rejected, 'budget');
  assert.equal(r4.error, 'budget_exceeded');
  assert.equal(backend.calls, before, 'over-budget call must not reach backend');
  assert.equal(gw.metrics().budgetRejected, 1);
});

// ── cache ───────────────────────────────────────────────────────────────────────
test('cache returns hit without calling backend twice', async () => {
  const c = clock();
  const gw = new Gateway({ ratePerSec: 100, burst: 100, cacheTtlMs: 1000, now: c.now });
  const backend = fakeBackend({ text: 'cached-answer', cost: 0.02 });

  const first = await gw.call({ prompt: 'same', taskHint: 'cheap' }, backend);
  assert.equal(first.text, 'cached-answer');
  assert.equal(first.cached, undefined);
  assert.equal(backend.calls, 1);

  const second = await gw.call({ prompt: 'same', taskHint: 'cheap' }, backend);
  assert.equal(second.text, 'cached-answer');
  assert.equal(second.cached, true);
  assert.equal(backend.calls, 1, 'cache hit must not call backend again');

  // cost only charged once (second was a cache hit)
  assert.ok(Math.abs(gw.metrics().totalCostUsd - 0.02) < 1e-9);

  const m = gw.metrics();
  assert.equal(m.cacheHits, 1);
  assert.equal(m.cacheMisses, 1);
  assert.ok(Math.abs(m.cacheHitRate - 0.5) < 1e-9);
});

test('cache expires after TTL', async () => {
  const c = clock();
  const gw = new Gateway({ ratePerSec: 100, burst: 100, cacheTtlMs: 1000, now: c.now });
  const backend = fakeBackend();

  await gw.call({ prompt: 'ttl' }, backend);
  assert.equal(backend.calls, 1);

  c.advance(1500); // past TTL
  const r = await gw.call({ prompt: 'ttl' }, backend);
  assert.equal(r.cached, undefined);
  assert.equal(backend.calls, 2, 'expired entry must re-call backend');
});

test('different taskHint is a different cache key', async () => {
  const gw = new Gateway({ ratePerSec: 100, burst: 100 });
  const backend = fakeBackend();
  await gw.call({ prompt: 'p', taskHint: 'cheap' }, backend);
  await gw.call({ prompt: 'p', taskHint: 'quality' }, backend);
  assert.equal(backend.calls, 2);
});

// ── failover ──────────────────────────────────────────────────────────────────────
test('fails over to secondary when primary throws', async () => {
  const gw = new Gateway({ ratePerSec: 100, burst: 100 });
  const primary = async () => {
    throw new Error('boom');
  };
  const secondary = fakeBackend({ text: 'from-secondary', provider: 'backup', cost: 0 });

  const r = await gw.call({ prompt: 'x', noCache: true }, primary, secondary);
  assert.equal(r.text, 'from-secondary');
  assert.equal(r.failedOver, true);
  assert.equal(secondary.calls, 1);

  const m = gw.metrics();
  assert.equal(m.failovers, 1);
  assert.equal(m.errors, 1);
});

test('fails over on router-style soft error ({error, no text})', async () => {
  const gw = new Gateway({ ratePerSec: 100, burst: 100 });
  const primary = async () => ({ text: '', error: 'all providers failed' });
  const secondary = fakeBackend({ text: 'rescued' });

  const r = await gw.call({ prompt: 'x', noCache: true }, primary, secondary);
  assert.equal(r.text, 'rescued');
  assert.equal(r.failedOver, true);
});

test('returns error when both backends fail', async () => {
  const gw = new Gateway({ ratePerSec: 100, burst: 100 });
  const bad = async () => {
    throw new Error('down');
  };
  const r = await gw.call({ prompt: 'x', noCache: true }, bad, bad);
  assert.equal(r.error, 'all_backends_failed');
  assert.equal(r.failedOver, true);
});

test('no secondary: primary error surfaces as backend_failed', async () => {
  const gw = new Gateway({ ratePerSec: 100, burst: 100 });
  const bad = async () => {
    throw new Error('nope');
  };
  const r = await gw.call({ prompt: 'x', noCache: true }, bad);
  assert.equal(r.error, 'backend_failed');
});

// ── metrics accumulate ────────────────────────────────────────────────────────────
test('metrics accumulate across calls and expose no secrets', async () => {
  const c = clock();
  const gw = new Gateway({ ratePerSec: 100, burst: 100, cacheTtlMs: 10_000, now: c.now });
  const backend = async (req) => {
    c.advance(50); // simulate 50ms latency
    return { text: 'r', provider: 'fake', cost: 0.005 };
  };

  await gw.call({ prompt: 'one' }, backend);
  await gw.call({ prompt: 'two' }, backend);
  await gw.call({ prompt: 'one' }, backend); // cache hit (no latency/cost)

  const m = gw.metrics();
  assert.equal(m.count, 3);
  assert.equal(m.cacheHits, 1);
  assert.equal(m.cacheMisses, 2);
  assert.ok(Math.abs(m.totalCostUsd - 0.01) < 1e-9, 'cost charged only on the 2 real calls');
  assert.ok(m.avgLatencyMs >= 0);

  // metrics object contains only aggregate numeric fields — no prompts, no keys
  const json = JSON.stringify(m);
  assert.ok(!json.includes('one'));
  assert.ok(!json.includes('two'));
  for (const k of Object.keys(m)) {
    assert.equal(typeof m[k], 'number', `metric ${k} must be numeric`);
  }
});

test('cost falls back to estimateCost when result has none', async () => {
  const gw = new Gateway({
    ratePerSec: 100,
    burst: 100,
    estimateCost: ({ prompt }) => prompt.length * 0.001,
  });
  const backend = fakeBackend({ text: 'ok' }); // no cost field
  await gw.call({ prompt: 'abcd', noCache: true }, backend); // 4 * 0.001
  assert.ok(Math.abs(gw.metrics().totalCostUsd - 0.004) < 1e-9);
});
