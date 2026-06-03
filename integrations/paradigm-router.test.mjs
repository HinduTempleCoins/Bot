// paradigm-router.test.mjs — OFFLINE tests for the PARADIGM router (queue #90).
// No network: pure routing decisions + dispatch with injected stub handlers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  route,
  classifyJob,
  dispatch,
  TIERS,
  COST_TIER,
} from './paradigm-router.mjs';

// ── classifyJob: the four canonical cases ────────────────────────────────────────────────────
test('bounded decision → rules', () => {
  assert.equal(classifyJob({ kind: 'lookup', bounded: true }), 'rules');
  assert.equal(classifyJob({ kind: 'validate' }), 'rules'); // bounded kind, no language
  assert.equal(classifyJob({ kind: 'whatever', bounded: true }), 'rules');
});

test('short classify → tiny', () => {
  assert.equal(classifyJob({ kind: 'classify', tokens: 40 }), 'tiny');
  assert.equal(classifyJob({ kind: 'label', tokens: 10 }), 'tiny');
  assert.equal(classifyJob({ kind: 'intent' }), 'tiny');
});

test('language parse/generate → small', () => {
  assert.equal(classifyJob({ kind: 'summarize', needsLanguage: true }), 'small');
  assert.equal(classifyJob({ kind: 'parse' }), 'small');
  assert.equal(classifyJob({ kind: 'generate' }), 'small');
  assert.equal(classifyJob({ kind: 'mystery', needsLanguage: true }), 'small');
});

test('hard / open-ended / long / low-confidence → cloud', () => {
  assert.equal(classifyJob({ kind: 'answer', openEnded: true }), 'cloud');
  assert.equal(classifyJob({ kind: 'summarize', complexity: 0.9 }), 'cloud');
  assert.equal(classifyJob({ kind: 'summarize', tokens: 5000 }), 'cloud');
  assert.equal(
    classifyJob({ kind: 'answer', needsLanguage: true, confidence: 0.2 }),
    'cloud',
  );
});

// ── escalation precedence & overrides ────────────────────────────────────────────────────────
test('hard signals override bounded kind', () => {
  // a bounded kind but explicitly not bounded + open-ended → cloud, not rules
  assert.equal(classifyJob({ kind: 'lookup', bounded: false, openEnded: true }), 'cloud');
});

test('long classify job is treated as small, not tiny', () => {
  assert.equal(classifyJob({ kind: 'classify', tokens: 5000 }), 'cloud'); // long → cloud first
  assert.equal(classifyJob({ kind: 'classify', tokens: 800 }), 'small'); // big but not "long"
});

test('language need forces small even on a bounded kind', () => {
  assert.equal(classifyJob({ kind: 'lookup', needsLanguage: true }), 'small');
});

test('unknown kind with no hints defaults to tiny (cheap), not cloud', () => {
  assert.equal(classifyJob({ kind: 'huh' }), 'tiny');
  assert.equal(classifyJob({}), 'tiny');
});

// ── route(): shape, reason, cost tier ────────────────────────────────────────────────────────
test('route returns tier, estCostTier, reason', () => {
  const r = route({ kind: 'classify', tokens: 30 });
  assert.equal(r.tier, 'tiny');
  assert.equal(r.estCostTier, 'cheap');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

test('cost tiers map every tier and are ordered cheap→expensive', () => {
  assert.deepEqual(TIERS, ['rules', 'tiny', 'small', 'cloud']);
  assert.deepEqual(
    TIERS.map((t) => COST_TIER[t]),
    ['free', 'cheap', 'moderate', 'expensive'],
  );
});

test('route cloud reason explains the escalation cause', () => {
  assert.match(route({ kind: 'x', openEnded: true }).reason, /open-ended/);
  assert.match(route({ kind: 'x', complexity: 0.95 }).reason, /complexity/);
  assert.match(route({ kind: 'x', tokens: 9999 }).reason, /long input/);
});

// ── dispatch(): calls the right injected handler ─────────────────────────────────────────────
test('dispatch routes to the correct injected handler', async () => {
  const calls = [];
  const handlers = {
    rules: (j) => { calls.push(['rules', j]); return 'R'; },
    tiny: (j) => { calls.push(['tiny', j]); return 'T'; },
    small: async (j) => { calls.push(['small', j]); return 'S'; },
    cloud: async (j) => { calls.push(['cloud', j]); return 'C'; },
  };

  assert.equal(await dispatch({ kind: 'validate' }, handlers), 'R');
  assert.equal(await dispatch({ kind: 'classify', tokens: 20 }, handlers), 'T');
  assert.equal(await dispatch({ kind: 'summarize', needsLanguage: true }, handlers), 'S');
  assert.equal(await dispatch({ kind: 'answer', openEnded: true }, handlers), 'C');

  assert.deepEqual(calls.map((c) => c[0]), ['rules', 'tiny', 'small', 'cloud']);
});

test('dispatch passes the job through to the handler', async () => {
  const job = { kind: 'classify', tokens: 5, marker: 'xyz' };
  const out = await dispatch(job, { tiny: (j) => j.marker });
  assert.equal(out, 'xyz');
});

test('dispatch throws when no handler is registered for the chosen tier', async () => {
  await assert.rejects(
    () => dispatch({ kind: 'summarize', needsLanguage: true }, { rules: () => 1 }),
    /no handler registered for tier "small"/,
  );
});
