import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ledger from './ledger.mjs';

test('records rows and censuses by status', () => {
  ledger.reset();
  ledger.record({ venue: 'hive-engine', symbol: 'SPS', side: 'buy', qty: 10, priceUsd: 1, status: 'FILLED', ts: 1000 });
  ledger.record({ symbol: 'SPS', side: 'sell', qty: 10, priceUsd: 1.2, status: 'FILLED', ts: 2000 });
  ledger.record({ symbol: 'X', status: 'STAGED', ts: 3000 });
  ledger.record({ symbol: 'Y', status: 'REJECTED', reason: 'dust', ts: 4000 });
  const c = ledger.census();
  assert.equal(c.FILLED, 2);
  assert.equal(c.STAGED, 1);
  assert.equal(c.REJECTED, 1);
  assert.equal(c.total, 4);
});

test('realized scorecard counts only FILLED round-trips in USD', () => {
  ledger.reset();
  ledger.record({ symbol: 'SPS', side: 'buy', qty: 100, priceUsd: 1, status: 'FILLED', ts: 1 });
  ledger.record({ symbol: 'SPS', side: 'sell', qty: 100, priceUsd: 1.1, status: 'FILLED', ts: 2 });
  ledger.record({ symbol: 'SPS', side: 'sell', qty: 50, priceUsd: 5, status: 'STAGED', ts: 3 }); // staged: ignored
  const s = ledger.realizedScorecard();
  assert.ok(s.netPnl > 9 && s.netPnl < 11, `netPnl ~10, got ${s.netPnl}`);
  assert.equal(s.profitable, true);
});

test('naked sells (dumps) are excluded from realized netPnl', () => {
  ledger.reset();
  ledger.record({ symbol: 'BAG', side: 'sell', qty: 1000, priceUsd: 0.05, status: 'FILLED', ts: 1 });
  const s = ledger.realizedScorecard();
  assert.equal(s.netPnl, 0, 'a pure dump is not trading profit');
  assert.ok(s.dumpPnl > 0, 'but the dump proceeds are tracked separately');
});

test('realizedUsdSince windows correctly', () => {
  ledger.reset();
  ledger.record({ symbol: 'A', side: 'buy', qty: 10, priceUsd: 1, status: 'FILLED', ts: 100 });
  ledger.record({ symbol: 'A', side: 'sell', qty: 10, priceUsd: 2, status: 'FILLED', ts: 200 });
  assert.ok(ledger.realizedUsdSince(0) > 9);
  assert.equal(ledger.realizedUsdSince(1000), 0, 'nothing after ts=1000');
});

test('soft-fails on junk without throwing', () => {
  ledger.reset();
  assert.doesNotThrow(() => ledger.record(null));
  assert.doesNotThrow(() => ledger.record({}));
  assert.doesNotThrow(() => ledger.realizedScorecard());
});
