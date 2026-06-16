// trader.test.mjs — OFFLINE: the trader's write ops dry-run (no key) and emit the correct
// HIVE-Engine payloads. Focus: cancel() (added so the VKBT ratchet can pull stale bids).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder, cancel, sweepToKali, executeDecision, orderCapHive, MAX_ORDER_USD, MAX_ORDER_HIVE } from './trader.mjs';

// HIVE ~$0.05 → a $2 cap is 40 HIVE. Inject the price so tests stay offline + deterministic.
const hiveUsd5c = async () => 0.05;

// No ACTIVE key in the test env → every write is simulated (dry-run), never broadcasts.
test('cancel() dry-runs with the correct HE market cancel payload', async () => {
  const r = await cancel({ symbol: 'VKBT', orderId: 12345, type: 'buy' });
  assert.equal(r.simulated, true, 'no key → simulated, never broadcasts');
  assert.deepEqual(r.payload, {
    contractName: 'market', contractAction: 'cancel', contractPayload: { type: 'buy', id: 12345 },
  });
});

test('cancel() rejects a bad side', async () => {
  await assert.rejects(() => cancel({ orderId: 1, type: 'nope' }), /type must be/);
});

test('placeOrder() and sweepToKali() still dry-run with their payloads', async () => {
  const p = await placeOrder({ side: 'buy', symbol: 'VKBT', quantity: 10, price: '0.5' });
  assert.equal(p.simulated, true);
  assert.equal(p.payload.contractAction, 'buy');
  const s = await sweepToKali({ symbol: 'VKBT', quantity: 5 });
  assert.equal(s.simulated, true);
  assert.equal(s.payload.contractAction, 'transfer');
});

test('orderCapHive converts the $ cap at the live HIVE price (and never exceeds the HIVE ceiling)', async () => {
  const c = await orderCapHive({ getHiveUsd: hiveUsd5c });
  assert.equal(c.capHive, MAX_ORDER_USD / 0.05, '$2 / $0.05 = 40 HIVE');
  assert.equal(c.hiveUsd, 0.05);
  // no price → fall back to the HIVE ceiling, never throws
  const noPrice = await orderCapHive({ getHiveUsd: async () => 0 });
  assert.equal(noPrice.capHive, MAX_ORDER_HIVE);
});

test('executeDecision SELL hits the bid, caps notional to the $ cap, dry-runs (no key)', async () => {
  // bid 0.50 HIVE, HIVE $0.05 → cap 40 HIVE → quantity = 40 / 0.50 = 80, priced at the bid.
  const r = await executeDecision({ action: 'SELL', sym: 'SWAP.DOGE', reason: 'premium' },
    { getMetrics: async () => ({ highestBid: 0.50, lowestAsk: 0.60 }), getHiveUsd: hiveUsd5c });
  assert.equal(r.order.side, 'sell');
  assert.equal(r.order.price, 0.50, 'sells into the highest bid');
  assert.equal(r.order.notionalHive, +(MAX_ORDER_USD / 0.05).toFixed(4), 'notional = $ cap in HIVE');
  assert.equal(r.order.quantity, +((MAX_ORDER_USD / 0.05) / 0.50).toFixed(8), 'quantity = capHive / price');
  assert.equal(r.order.notionalUsd, MAX_ORDER_USD);
  assert.equal(r.result.simulated, true, 'no key → dry-run, never broadcasts');
});

test('executeDecision BUY lifts the ask', async () => {
  const r = await executeDecision({ action: 'BUY', sym: 'SWAP.DOGE', reason: 'discount' },
    { getMetrics: async () => ({ highestBid: 0.40, lowestAsk: 0.45 }), getHiveUsd: hiveUsd5c });
  assert.equal(r.order.side, 'buy');
  assert.equal(r.order.price, 0.45, 'buys from the lowest ask');
  assert.equal(r.result.simulated, true);
});

test('executeDecision skips when there is no executable side (one-sided/empty book)', async () => {
  const sell = await executeDecision({ action: 'SELL', sym: 'X', reason: 'r' }, { getMetrics: async () => ({ highestBid: 0, lowestAsk: 1 }), getHiveUsd: hiveUsd5c });
  assert.equal(sell.skipped, 'no bid to sell into');
  const none = await executeDecision({ action: 'BUY', sym: 'X', reason: 'r' }, { getMetrics: async () => null, getHiveUsd: hiveUsd5c });
  assert.equal(none.skipped, 'no market metrics');
});
