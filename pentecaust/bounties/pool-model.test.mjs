import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memStore, createPool, setPoolFunded, submit, reviewSubmission, markPaid, payoutQueue, poolStats, listPools, laneFor } from './pool-model.mjs';

test('create → fund → submit → verify → pay, with slots + stats', () => {
  const s = memStore();
  const bad = createPool({ sponsor: '@r', taskType: 'x_post', pot: 10, perTaskReward: 50 }, s);
  assert.equal(bad.ok, false); // reward > pot
  const p = createPool({ sponsor: '@r', title: 'Post', taskType: 'x_post', chain: 'prana-testnet', token: 'PRANA', pot: 100, perTaskReward: 50 }, s);
  assert.ok(p.ok); assert.equal(p.pool.slots, 2); assert.equal(p.pool.lane, 'auto'); assert.equal(p.pool.status, 'draft');

  // not active → can't submit yet
  assert.equal(submit({ poolId: p.pool.id, worker: '@a' }, s).ok, false);
  setPoolFunded(p.pool.id, { bountyId: '3', txid: '0x1' }, s);
  assert.equal(listPools({ status: 'active' }, s).length, 1);

  const a = submit({ poolId: p.pool.id, worker: '@a', proof: 'url' }, s); assert.ok(a.ok);
  assert.equal(submit({ poolId: p.pool.id, worker: '@a', proof: 'dup' }, s).ok, false); // one per worker
  reviewSubmission(a.submission.id, 'verify', 'auto', '', s);
  assert.equal(payoutQueue(s).length, 1);
  markPaid(a.submission.id, '0xpay', s);
  assert.equal(payoutQueue(s).length, 0);
  const st = poolStats(p.pool.id, s);
  assert.equal(st.paid, 1); assert.equal(st.remaining, 1); assert.equal(st.potRemaining, 50);
});

test('slots cap submissions', () => {
  const s = memStore();
  const p = createPool({ sponsor: '@r', taskType: 'referral', pot: 10, perTaskReward: 10 }, s); // 1 slot
  setPoolFunded(p.pool.id, {}, s);
  assert.ok(submit({ poolId: p.pool.id, worker: '@a', proof: 'x' }, s).ok);
  assert.equal(submit({ poolId: p.pool.id, worker: '@b', proof: 'y' }, s).ok, false); // full
});

test('lane mapping', () => { assert.equal(laneFor('x_post'), 'auto'); assert.equal(laneFor('content'), 'review'); assert.equal(laneFor('nope'), 'review'); });
