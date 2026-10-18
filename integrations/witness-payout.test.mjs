// witness-payout.test.mjs — OFFLINE. The transfer plan: keep the reserve, skip dust, never misread amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPayout, transferOp } from './witness-payout.mjs';

test('sends everything above the reserve', () => {
  assert.deepEqual(planPayout({ balance: '4.200 MELEK' }), { send: true, amount: '3.200 MELEK', reason: 'ok' });
  assert.equal(planPayout({ balance: '1234.5 MELEK', reserve: '0.500 MELEK' }).amount, '1234.000 MELEK');
});

test('nothing below the minimum after the reserve', () => {
  assert.equal(planPayout({ balance: '1.999 MELEK' }).send, false);
  assert.equal(planPayout({ balance: '0.000 MELEK' }).send, false);
});

test('unreadable amounts and other symbols never send', () => {
  for (const balance of [null, '', '5.000 MBD', 'abc', '5,000.000 MELEK']) assert.equal(planPayout({ balance }).send, false);
});

test('transfer op carries a plain dated memo', () => {
  const op = transferOp({ from: 'melek-witness', to: 'melek', amount: '3.200 MELEK', date: new Date('2026-10-18T12:00:00Z') });
  assert.deepEqual(op, ['transfer', { from: 'melek-witness', to: 'melek', amount: '3.200 MELEK', memo: 'Witness rewards from @melek-witness, 2026-10-18' }]);
});
