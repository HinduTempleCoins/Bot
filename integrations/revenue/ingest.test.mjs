import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromProfitTracker, fromMonitorSummary } from './ingest.mjs';
import * as ledger from './ledger.mjs';

test('ingests profit-tracker fills as FILLED rows and computes realized', () => {
  ledger.reset();
  const entries = [
    { account: 'angelicalist', market: 'SPS', side: 'buy', qty: 100, price: 0.02, ts: 1 },
    { account: 'angelicalist', market: 'SPS', side: 'sell', qty: 100, price: 0.024, ts: 2 },
  ];
  const res = fromProfitTracker(entries, { ledger, hiveUsd: 0.05 });
  assert.equal(res.recorded, 2);
  const s = ledger.realizedScorecard();
  assert.ok(s.netPnl > 0, 'a real round-trip shows realized profit');
  assert.equal(ledger.fills().length, 2);
});

test('skips malformed fills without throwing', () => {
  ledger.reset();
  const res = fromProfitTracker([{ market: 'X' }, null, { side: 'buy', qty: 0, price: 1 }], { ledger });
  assert.equal(res.recorded, 0);
});

test('fromMonitorSummary extracts realized figure or null', () => {
  assert.equal(fromMonitorSummary({ realizedHive: 113.01 }).realizedHive, 113.01);
  assert.equal(fromMonitorSummary(null), null);
  assert.equal(fromMonitorSummary({}).realizedHive, null);
});
