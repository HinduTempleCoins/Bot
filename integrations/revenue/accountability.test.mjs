import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revenueReport, accountabilityCheck, renderBrief, METRIC, CADENCE } from './accountability.mjs';
import * as ledger from './ledger.mjs';

test('OK when realized > 0', () => {
  ledger.reset();
  const now = Date.now();
  ledger.record({ symbol: 'A', side: 'buy', qty: 100, priceUsd: 1, status: 'FILLED', ts: now - 1000 });
  ledger.record({ symbol: 'A', side: 'sell', qty: 100, priceUsd: 1.2, status: 'FILLED', ts: now - 500 });
  const rec = accountabilityCheck({ ledger, now });
  assert.equal(rec.status, 'OK');
  assert.equal(rec.escalate, false);
  assert.ok(rec.realizedNetUsd > 0);
});

test('ZERO_REVENUE forces a derived, non-empty why + escalation', () => {
  ledger.reset();
  const now = Date.now();
  const run = {
    considered: 5,
    counts: { staged: 3, executed: 0, rejected: 2, failed: 0 },
    rejectedByReason: { 'dead-book (edge 164% > 30%)': 1, 'buy-first (naked sell blocked)': 1 },
  };
  const rec = accountabilityCheck({ ledger, run, now,
    adapters: [{ venue: 'hive-engine', authGate: 'REVENUE_LIVE_HIVE_ENGINE', authorized: false }] });
  assert.equal(rec.status, 'ZERO_REVENUE');
  assert.equal(rec.escalate, true);
  assert.ok(rec.why.length >= 1, 'why is populated from the run');
  assert.ok(rec.why.some((w) => /STAGED/.test(w)), 'names the staged-awaiting-auth blocker');
  assert.ok(rec.actions.some((a) => /ESCALATE/.test(a)), 'demands operator authorization');
});

test('ZERO_REVENUE with no signals names the dry-pipeline blocker', () => {
  ledger.reset();
  const rec = accountabilityCheck({ ledger, run: { considered: 0, counts: {} }, now: Date.now(), adapters: [] });
  assert.equal(rec.status, 'ZERO_REVENUE');
  assert.ok(rec.why.some((w) => /0 suggestions/.test(w)));
});

test('renderBrief produces a readable escalation block', () => {
  const rec = accountabilityCheck({ ledger, run: { considered: 2, counts: { staged: 2, rejected: 0 } },
    now: Date.now(), adapters: [{ venue: 'hive-engine', authGate: 'REVENUE_LIVE_HIVE_ENGINE', authorized: false }] });
  const txt = renderBrief(rec);
  assert.match(txt, /REVENUE ACCOUNTABILITY/);
  assert.match(txt, /ESCALATE TO OPERATOR/);
});

test('metric + cadence are defined and stable', () => {
  assert.equal(METRIC.name, 'realizedNetUsd');
  assert.ok(CADENCE.daily.windowHours === 24);
  assert.ok(CADENCE.weekly.windowHours === 168);
});

test('revenueReport soft-fails to an object', () => {
  ledger.reset();
  const r = revenueReport({ ledger });
  assert.equal(typeof r.realizedNetUsd, 'number');
});
