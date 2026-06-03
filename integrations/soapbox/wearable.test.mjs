// Offline tests for the SweatCoin-style step layer. No network: covers the PURE stepReward
// (daily cap + diminishing returns), ingest normalization across sources, and the gated,
// dry-run settle intent. Run: node --test integrations/soapbox/wearable.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { ingestSteps, stepReward, settleSteps, DEFAULT_RULES } from './wearable.mjs';

// --- stepReward (PURE) ---------------------------------------------------------------------------

test('stepReward is full-rate below the threshold', () => {
  const rules = { perStep: 0.001, dailyCap: 100, fullRateSteps: 8000, diminishRate: 0.25 };
  assert.equal(stepReward(5000, rules), 5); // 5000 * 0.001
});

test('stepReward applies diminishing returns above the threshold', () => {
  const rules = { perStep: 0.001, dailyCap: 100, fullRateSteps: 8000, diminishRate: 0.25 };
  // 8000 full (=8) + 2000 over at 25% (2000*0.001*0.25 = 0.5) = 8.5
  assert.equal(stepReward(10000, rules), 8.5);
});

test('stepReward clamps to the daily cap', () => {
  const rules = { perStep: 0.001, dailyCap: 9, fullRateSteps: 8000, diminishRate: 0.25 };
  assert.equal(stepReward(1000000, rules), 9, 'cap is the ceiling no matter the steps');
});

test('stepReward returns 0 for non-positive / junk input', () => {
  assert.equal(stepReward(0), 0);
  assert.equal(stepReward(-50), 0);
  assert.equal(stepReward('abc'), 0);
  assert.equal(stepReward(undefined), 0);
});

test('stepReward defaults are usable and bounded by cap', () => {
  const r = stepReward(50000, DEFAULT_RULES);
  assert.ok(r <= DEFAULT_RULES.dailyCap);
});

// --- ingest normalization ------------------------------------------------------------------------

test('ingestSteps normalizes Health Connect records', () => {
  const out = ingestSteps({
    source: 'health-connect',
    records: [{ count: 3000, startTime: '2026-06-03T08:00:00Z', distance: { inMeters: 2100 } }],
  });
  assert.deepEqual(out, [{ date: '2026-06-03', steps: 3000, distance: 2100 }]);
});

test('ingestSteps normalizes HealthKit records', () => {
  const out = ingestSteps({
    source: 'healthkit',
    records: [{ value: 4200, startDate: '2026-06-03T09:00:00Z', distanceMeters: 3000 }],
  });
  assert.deepEqual(out, [{ date: '2026-06-03', steps: 4200, distance: 3000 }]);
});

test('ingestSteps normalizes Fitbit records (incl. km→m distance)', () => {
  const out = ingestSteps({
    source: 'fitbit',
    records: [{ dateTime: '2026-06-03', value: '5000', distanceKm: 3.5 }],
  });
  assert.deepEqual(out, [{ date: '2026-06-03', steps: 5000, distance: 3500 }]);
});

test('ingestSteps merges same-date records and sorts by date', () => {
  const out = ingestSteps({
    source: 'fitbit',
    records: [
      { dateTime: '2026-06-03', value: 1000 },
      { dateTime: '2026-06-02', value: 500 },
      { dateTime: '2026-06-03', value: 2000 },
    ],
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { date: '2026-06-02', steps: 500, distance: 0 });
  assert.deepEqual(out[1], { date: '2026-06-03', steps: 3000, distance: 0 });
});

test('ingestSteps drops records with no usable date', () => {
  const out = ingestSteps({ source: 'fitbit', records: [{ value: 100 }, null, { dateTime: 'not-a-date', value: 9 }] });
  assert.deepEqual(out, []);
});

test('ingestSteps rejects unsupported sources (incl. google-fit)', () => {
  assert.throws(() => ingestSteps({ source: 'google-fit', records: [] }), /unsupported/);
  assert.throws(() => ingestSteps({ source: 'whatever', records: [] }), /unsupported/);
});

// --- gated, dry-run settle intent ----------------------------------------------------------------

test('settleSteps is gated-closed by default (no gate fn)', async () => {
  const intent = await settleSteps({ steps: 10000 });
  assert.equal(intent.gated, true);
  assert.equal(intent.reward, 0, 'no reward when gated');
  assert.ok(intent.rewardIfPassed > 0, 'still reports what it would have been');
  assert.equal(intent.dryRun, true);
  assert.equal(intent.kind, 'step-reward');
});

test('settleSteps pays out (intent) when the gate passes', async () => {
  const rules = { perStep: 0.001, dailyCap: 100, fullRateSteps: 8000, diminishRate: 0.25 };
  const intent = await settleSteps({ steps: 5000, rules, account: 'alice', gate: () => true });
  assert.equal(intent.gated, false);
  assert.equal(intent.reward, 5);
  assert.equal(intent.account, 'alice');
  assert.equal(intent.dryRun, true, 'still dry-run even when passed — no real value moves');
});

test('settleSteps stays gated when the gate (async, object form) fails', async () => {
  const gate = async () => ({ ok: false, reason: 'liveness-failed' });
  const intent = await settleSteps({ steps: 5000, gate });
  assert.equal(intent.gated, true);
  assert.equal(intent.reward, 0);
  assert.equal(intent.reason, 'liveness-failed');
});

test('settleSteps passes step context to the injected gate', async () => {
  let seen = null;
  await settleSteps({ steps: 1234, account: 'bob', date: '2026-06-03', gate: (ctx) => { seen = ctx; return true; } });
  assert.equal(seen.steps, 1234);
  assert.equal(seen.account, 'bob');
  assert.equal(seen.date, '2026-06-03');
  assert.ok(seen.reward > 0);
});
