/**
 * Tests for watcher/detect.js.
 *
 *   node --test watcher/detect.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSensitiveEvents, isSensitiveOp, maxHistoryIndex } from './detect.js';

const ACC = 'hathor';

const entry = (index, opName, opData, extras = {}) => [
  index,
  {
    trx_id: `tx-${index}`,
    block: 1000 + index,
    timestamp: `2026-05-27T00:00:${String(index).padStart(2, '0')}`,
    op: [opName, opData],
    ...extras,
  },
];

test('isSensitiveOp: outbound transfer = true', () => {
  assert.equal(isSensitiveOp(['transfer', { from: ACC, to: 'someone', amount: '1.000 MELEK' }], ACC), true);
});

test('isSensitiveOp: inbound transfer = false', () => {
  assert.equal(isSensitiveOp(['transfer', { from: 'someone', to: ACC, amount: '1.000 MELEK' }], ACC), false);
});

test('isSensitiveOp: account_update on watched account = true', () => {
  assert.equal(isSensitiveOp(['account_update', { account: ACC }], ACC), true);
});

test('isSensitiveOp: account_update on other account = false', () => {
  assert.equal(isSensitiveOp(['account_update', { account: 'other' }], ACC), false);
});

test('isSensitiveOp: withdraw_vesting on watched account = true', () => {
  assert.equal(isSensitiveOp(['withdraw_vesting', { account: ACC, vesting_shares: '100 VESTS' }], ACC), true);
});

test('isSensitiveOp: delegate_vesting_shares (we are delegator) = true', () => {
  assert.equal(isSensitiveOp(['delegate_vesting_shares', { delegator: ACC, delegatee: 'b', vesting_shares: '1 VESTS' }], ACC), true);
});

test('isSensitiveOp: delegate_vesting_shares (we are delegatee) = false', () => {
  assert.equal(isSensitiveOp(['delegate_vesting_shares', { delegator: 'a', delegatee: ACC, vesting_shares: '1 VESTS' }], ACC), false);
});

test('isSensitiveOp: witness_update on watched account = true', () => {
  assert.equal(isSensitiveOp(['witness_update', { owner: ACC, url: 'http://x' }], ACC), true);
});

test('isSensitiveOp: unknown / boring ops = false', () => {
  assert.equal(isSensitiveOp(['comment', { author: ACC, body: 'hi' }], ACC), false);
  assert.equal(isSensitiveOp(['vote', { voter: ACC }], ACC), false);
  assert.equal(isSensitiveOp(['custom_json', { id: 'x' }], ACC), false);
  assert.equal(isSensitiveOp(null, ACC), false);
  assert.equal(isSensitiveOp([], ACC), false);
});

test('detectSensitiveEvents picks out only outbound transfers and the key/witness/delegation/power-down ops', () => {
  const history = [
    entry(1, 'transfer', { from: ACC, to: 'b', amount: '5 MELEK' }),
    entry(2, 'transfer', { from: 'a', to: ACC, amount: '1 MELEK' }), // inbound — ignored
    entry(3, 'vote',     { voter: ACC, author: 'x', permlink: 'y' }), // ignored
    entry(4, 'witness_update', { owner: ACC, url: 'http://x' }),
    entry(5, 'account_update', { account: ACC }),
    entry(6, 'withdraw_vesting', { account: ACC, vesting_shares: '100 VESTS' }),
    entry(7, 'delegate_vesting_shares', { delegator: ACC, delegatee: 'b', vesting_shares: '5 VESTS' }),
  ];
  const events = detectSensitiveEvents(history, ACC);
  assert.deepEqual(events.map((e) => e.kind), [
    'transfer', 'witness_update', 'account_update', 'withdraw_vesting', 'delegate_vesting_shares',
  ]);
});

test('detectSensitiveEvents respects minIndex', () => {
  const history = [
    entry(1, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK' }),
    entry(2, 'transfer', { from: ACC, to: 'c', amount: '2 MELEK' }),
    entry(3, 'transfer', { from: ACC, to: 'd', amount: '3 MELEK' }),
  ];
  const events = detectSensitiveEvents(history, ACC, { minIndex: 1 });
  assert.deepEqual(events.map((e) => e.historyIndex), [2, 3]);
});

test('detectSensitiveEvents assigns severity correctly', () => {
  const history = [
    entry(1, 'transfer',                { from: ACC, to: 'b', amount: '1 MELEK' }),
    entry(2, 'account_update',          { account: ACC }),
    entry(3, 'witness_update',          { owner: ACC }),
    entry(4, 'withdraw_vesting',        { account: ACC, vesting_shares: '1 VESTS' }),
    entry(5, 'delegate_vesting_shares', { delegator: ACC, delegatee: 'x', vesting_shares: '1 VESTS' }),
  ];
  const events = detectSensitiveEvents(history, ACC);
  const sevByKind = Object.fromEntries(events.map((e) => [e.kind, e.severity]));
  assert.equal(sevByKind.transfer, 'high');
  assert.equal(sevByKind.account_update, 'critical');
  assert.equal(sevByKind.witness_update, 'critical');
  assert.equal(sevByKind.withdraw_vesting, 'warn');
  assert.equal(sevByKind.delegate_vesting_shares, 'warn');
});

test('detectSensitiveEvents returns events sorted oldest-first', () => {
  const history = [
    entry(10, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK' }),
    entry(5,  'transfer', { from: ACC, to: 'c', amount: '2 MELEK' }),
    entry(7,  'transfer', { from: ACC, to: 'd', amount: '3 MELEK' }),
  ];
  const events = detectSensitiveEvents(history, ACC);
  assert.deepEqual(events.map((e) => e.historyIndex), [5, 7, 10]);
});

test('detectSensitiveEvents copies through block/trxId/timestamp', () => {
  const history = [entry(1, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK' })];
  const [e] = detectSensitiveEvents(history, ACC);
  assert.equal(e.block, 1001);
  assert.equal(e.trxId, 'tx-1');
  assert.equal(e.timestamp, '2026-05-27T00:00:01');
  assert.equal(e.account, ACC);
});

test('detectSensitiveEvents tolerates malformed entries', () => {
  const history = [
    null,
    [1],
    [2, null],
    [3, { op: 'not-an-array' }],
    entry(4, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK' }),
  ];
  const events = detectSensitiveEvents(history, ACC);
  assert.equal(events.length, 1);
  assert.equal(events[0].historyIndex, 4);
});

test('detectSensitiveEvents handles empty / bad input', () => {
  assert.deepEqual(detectSensitiveEvents([], ACC), []);
  assert.deepEqual(detectSensitiveEvents(null, ACC), []);
  assert.deepEqual(detectSensitiveEvents([entry(1, 'transfer', { from: ACC, to: 'b', amount: '1 MELEK' })], ''), []);
});

test('maxHistoryIndex returns the highest index', () => {
  assert.equal(maxHistoryIndex([entry(5, 'transfer', {}), entry(2, 'transfer', {}), entry(9, 'transfer', {})]), 9);
});

test('maxHistoryIndex on empty returns null', () => {
  assert.equal(maxHistoryIndex([]), null);
  assert.equal(maxHistoryIndex(null), null);
});
