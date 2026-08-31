import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from './pipeline.mjs';
import * as ledger from './ledger.mjs';

const signals = () => ([
  { id: 'ok', symbol: 'SPS', side: 'buy', venue: 'hive-engine', edgePct: 5, price: 0.02, priceUsd: 0.02, depthUsd: 50, verdict: 'ACT' },
  { id: 'dead', symbol: 'SWAP.ETH', side: 'buy', venue: 'hive-engine', edgePct: 164, price: 3000, priceUsd: 3000, verdict: 'ACT' },
  { id: 'naked', symbol: 'BAG', side: 'sell', venue: 'hive-engine', edgePct: 6, price: 0.02, priceUsd: 0.02, verdict: 'ACT' },
]);

test('staged by default: nothing fills, every fate recorded', async () => {
  ledger.reset();
  const r = await runPipeline({ signals: signals(), config: { bankrollUsd: 100, maxOrderUsd: 5 }, ledger });
  assert.equal(r.live, false);
  assert.equal(r.counts.executed, 0, 'nothing broadcasts in staged mode');
  assert.ok(r.counts.staged >= 1, 'the healthy signal is staged');
  assert.ok(r.counts.rejected >= 2, 'dead-book + naked-sell rejected');
  // ledger recorded ALL three considered signals — nothing dropped silently
  assert.equal(ledger.census().total, 3);
});

test('rejection reasons are itemized (anti-theater census)', async () => {
  ledger.reset();
  const r = await runPipeline({ signals: signals(), config: { bankrollUsd: 100 }, ledger });
  const reasons = Object.keys(r.rejectedByReason).join(',');
  assert.match(reasons, /dead-book|buy-first/);
});

test('live requested but adapter unauthorized still only stages', async () => {
  ledger.reset();
  delete process.env.REVENUE_LIVE_HIVE_ENGINE;
  const r = await runPipeline({ signals: [signals()[0]], config: { bankrollUsd: 100 }, ledger, live: true });
  assert.equal(r.counts.executed, 0, 'auth flag unset → no fill even when live:true');
  assert.ok(r.counts.staged === 1);
});

test('unroutable order is rejected, not thrown', async () => {
  ledger.reset();
  const r = await runPipeline({
    signals: [{ id: 'z', symbol: 'Z', side: 'buy', venue: 'mars-dex', edgePct: 5, priceUsd: 1, depthUsd: 50, verdict: 'ACT' }],
    config: { bankrollUsd: 100 }, ledger,
  });
  assert.ok(r.rejectedByReason['unroutable'] >= 1);
});

test('empty / junk signals soft-fail to a clean report', async () => {
  ledger.reset();
  const r = await runPipeline({ signals: [], ledger });
  assert.equal(r.considered, 0);
  assert.doesNotThrow(() => JSON.stringify(r));
});
