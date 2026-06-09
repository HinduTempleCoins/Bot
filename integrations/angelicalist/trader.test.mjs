// trader.test.mjs — OFFLINE: the trader's write ops dry-run (no key) and emit the correct
// HIVE-Engine payloads. Focus: cancel() (added so the VKBT ratchet can pull stale bids).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder, cancel, sweepToKali } from './trader.mjs';

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
