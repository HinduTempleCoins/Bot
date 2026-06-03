// feed-publisher.test.mjs — offline tests for the keyless median-drift feed publisher (Task #153).
// node --test witness/feed-publisher.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  medianPrice,
  shouldPublish,
  buildFeedOp,
  publishOnce,
  state,
  __setPriceSource,
  __setBroadcaster,
  __setClock,
} from './feed-publisher.mjs';

function reset() {
  state.reset();
  __setBroadcaster(null);
  __setClock(null);
  __setPriceSource(async () => null);
}

// ---- medianPrice -----------------------------------------------------------------------------

test('medianPrice rejects an outlier', async () => {
  // 1.00, 1.01, 1.02, 0.99 cluster ~1.00; 50 is a wild outlier and must be dropped.
  const m = await medianPrice([1.0, 1.01, 1.02, 0.99, 50]);
  assert.ok(m > 0.9 && m < 1.1, `expected ~1.0, got ${m}`);
});

test('medianPrice returns null on empty / all-bad input', async () => {
  assert.equal(await medianPrice([]), null);
  assert.equal(await medianPrice([0, -1, NaN]), null);
});

// ---- shouldPublish ---------------------------------------------------------------------------

test('shouldPublish: no prior feed -> publish', () => {
  const d = shouldPublish(1.0, null, { driftPct: 1.0 });
  assert.equal(d.publish, true);
  assert.equal(d.reason, 'no-prior-feed');
});

test('shouldPublish: drift above threshold -> true', () => {
  const d = shouldPublish(1.05, { price: 1.0, at: 0 }, { driftPct: 1.0 }); // 5% > 1%
  assert.equal(d.publish, true);
  assert.equal(d.reason, 'drift');
});

test('shouldPublish: tiny drift below threshold -> false', () => {
  const d = shouldPublish(1.005, { price: 1.0, at: 0 }, { driftPct: 1.0 }); // 0.5% < 1%
  assert.equal(d.publish, false);
  assert.equal(d.reason, 'within-threshold');
});

test('shouldPublish: staleness -> true even with no drift', () => {
  __setClock(() => 1_000_000);
  const d = shouldPublish(1.0, { price: 1.0, at: 0 }, { driftPct: 1.0, maxAgeMs: 500_000 });
  assert.equal(d.publish, true);
  assert.equal(d.reason, 'stale');
  __setClock(null);
});

test('shouldPublish: fresh + no drift -> false', () => {
  __setClock(() => 1000);
  const d = shouldPublish(1.0, { price: 1.0, at: 900 }, { driftPct: 1.0, maxAgeMs: 500_000 });
  assert.equal(d.publish, false);
  __setClock(null);
});

// ---- buildFeedOp -----------------------------------------------------------------------------

test('buildFeedOp shape matches graphene feed_publish', () => {
  const op = buildFeedOp({ base: '1.000 MELEK', price: 0.001234 });
  assert.equal(Array.isArray(op), true);
  assert.equal(op[0], 'feed_publish');
  assert.equal(op[1].publisher, 'hathor');
  assert.equal(op[1].exchange_rate.base, '1.000 MELEK');
  assert.equal(op[1].exchange_rate.quote, '0.001 USD'); // default precision 3
});

test('buildFeedOp respects explicit quote string', () => {
  const op = buildFeedOp({ base: '1.000 MELEK', quote: '0.500 USD' });
  assert.equal(op[1].exchange_rate.quote, '0.500 USD');
});

// ---- publishOnce -----------------------------------------------------------------------------

test('publishOnce DRY-RUN default never calls the broadcaster, returns prepared op', async () => {
  reset();
  let called = 0;
  __setBroadcaster(() => { called++; });
  __setPriceSource(async () => 1.0);

  const r = await publishOnce({ driftPct: 1.0 }); // live defaults to false
  assert.equal(called, 0, 'broadcaster must NOT be called in dry-run');
  assert.equal(r.published, false);
  assert.equal(r.dryRun, true);
  assert.ok(Array.isArray(r.op) && r.op[0] === 'feed_publish', 'op prepared');
  assert.equal(r.price, 1.0);
});

test('publishOnce live WITH injected broadcaster calls it once with the op', async () => {
  reset();
  const seen = [];
  __setBroadcaster((op) => { seen.push(op); });
  __setPriceSource(async () => 1.0);

  const r = await publishOnce({ driftPct: 1.0, live: true }); // no prior -> publishes
  assert.equal(seen.length, 1, 'broadcaster called exactly once');
  assert.equal(seen[0][0], 'feed_publish');
  assert.equal(r.published, true);
  assert.equal(r.dryRun, false);
  // state advanced
  assert.equal(state.get().price, 1.0);
});

test('publishOnce live but NO broadcaster -> dry-run, never broadcasts', async () => {
  reset();
  __setPriceSource(async () => 1.0);
  const r = await publishOnce({ live: true }); // no broadcaster injected
  assert.equal(r.dryRun, true);
  assert.equal(r.published, false);
});

test('publishOnce no-drift case -> published:false', async () => {
  reset();
  let called = 0;
  __setBroadcaster(() => { called++; });
  __setClock(() => 1000);
  state.set({ price: 1.0, at: 999 }); // fresh
  __setPriceSource(async () => 1.002); // 0.2% < 1%

  const r = await publishOnce({ driftPct: 1.0, maxAgeMs: 1_000_000, live: true });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'within-threshold');
  assert.equal(called, 0, 'no broadcast when within threshold');
});

test('publishOnce computes median when source returns an array of quotes', async () => {
  reset();
  __setPriceSource(async () => [1.0, 1.01, 0.99, 50]); // outlier dropped
  const r = await publishOnce({}); // dry-run
  assert.ok(r.price > 0.9 && r.price < 1.1, `median price ~1.0, got ${r.price}`);
  assert.ok(Array.isArray(r.op));
});

test('publishOnce soft-fails to no-price when source throws', async () => {
  reset();
  __setPriceSource(async () => { throw new Error('network down'); });
  const r = await publishOnce({});
  assert.equal(r.published, false);
  assert.equal(r.reason, 'no-price');
  assert.equal(r.op, null);
});

test('publishOnce broadcast failure does not advance state', async () => {
  reset();
  __setBroadcaster(() => { throw new Error('signer 503'); });
  __setPriceSource(async () => 2.0);
  const r = await publishOnce({ live: true });
  assert.equal(r.published, false);
  assert.equal(r.reason, 'broadcast-failed');
  assert.equal(state.get(), null, 'state not advanced on broadcast failure');
});
