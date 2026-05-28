/**
 * Tests for watcher/compose.js.
 *
 *   node --test watcher/compose.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeAlert } from './compose.js';

const baseEvent = (overrides = {}) => ({
  kind: 'transfer',
  severity: 'high',
  account: 'hathor',
  op: 'transfer',
  opData: { from: 'hathor', to: 'attacker', amount: '100.000 MELEK', memo: '' },
  block: 1234,
  trxId: '0xdeadbeef',
  historyIndex: 42,
  timestamp: '2026-05-27T12:34:56',
  ...overrides,
});

test('composeAlert: outbound transfer renders severity tag, amount, recipient', () => {
  const { subject, body } = composeAlert(baseEvent());
  assert.match(subject, /^\[HIGH\]/);
  assert.match(subject, /Transfer from @hathor/);
  assert.match(subject, /to @attacker/);
  assert.match(subject, /100\.000 MELEK/);
  assert.match(body, /amount: 100\.000 MELEK/);
  assert.match(body, /to:\s+@attacker/);
  assert.match(body, /trx_id:\s+0xdeadbeef/);
  assert.match(body, /block:\s+1234/);
  assert.match(body, /SECURITY\.md/);
});

test('composeAlert: empty memo renders as (empty), not blank', () => {
  const { body } = composeAlert(baseEvent({ opData: { from: 'hathor', to: 'a', amount: '1 MELEK', memo: '' } }));
  assert.match(body, /memo:\s+\(empty\)/);
});

test('composeAlert: account_update has CRITICAL severity tag and key-change copy', () => {
  const { subject, body } = composeAlert(baseEvent({
    kind: 'account_update',
    severity: 'critical',
    opData: { account: 'hathor' },
  }));
  assert.match(subject, /^\[CRITICAL\]/);
  assert.match(subject, /KEY CHANGE/);
  assert.match(body, /offline\s+owner key/);
});

test('composeAlert: withdraw_vesting shows vesting_shares + power-down advice', () => {
  const { subject, body } = composeAlert(baseEvent({
    kind: 'withdraw_vesting',
    severity: 'warn',
    opData: { account: 'hathor', vesting_shares: '1000.000000 VESTS' },
  }));
  assert.match(subject, /^\[WARN\]/);
  assert.match(subject, /Power-down/);
  assert.match(body, /1000\.000000 VESTS/);
  assert.match(body, /13 weeks/);
});

test('composeAlert: delegate_vesting_shares names delegatee + amount', () => {
  const { subject, body } = composeAlert(baseEvent({
    kind: 'delegate_vesting_shares',
    severity: 'warn',
    opData: { delegator: 'hathor', delegatee: 'someone', vesting_shares: '50.000000 VESTS' },
  }));
  assert.match(subject, /Delegation from @hathor to @someone/);
  assert.match(body, /delegatee:\s+@someone/);
  assert.match(body, /50\.000000 VESTS/);
});

test('composeAlert: witness_update renders url + block_signing_key', () => {
  const { subject, body } = composeAlert(baseEvent({
    kind: 'witness_update',
    severity: 'critical',
    opData: { owner: 'hathor', url: 'https://example.test', block_signing_key: 'MLK7abc...' },
  }));
  assert.match(subject, /^\[CRITICAL\]/);
  assert.match(subject, /Witness record updated/);
  assert.match(body, /url:\s+https:\/\/example\.test/);
  assert.match(body, /block_signing_key:\s+MLK7abc\.\.\./);
});

test('composeAlert: subject + body are deterministic (same event in → same out)', () => {
  const a = composeAlert(baseEvent());
  const b = composeAlert(baseEvent());
  assert.deepEqual(a, b);
});

test('composeAlert: unknown severity falls back to [WARN]', () => {
  const { subject } = composeAlert(baseEvent({ severity: 'totally-made-up' }));
  assert.match(subject, /^\[WARN\]/);
});

test('composeAlert: missing block/trxId render as (unknown)', () => {
  const { body } = composeAlert(baseEvent({ block: null, trxId: null }));
  assert.match(body, /block:\s+\(unknown\)/);
  assert.match(body, /trx_id:\s+\(unknown\)/);
});

test('composeAlert: throws on null event', () => {
  assert.throws(() => composeAlert(null), /event required/);
});

test('composeAlert: body never contains a leaked private-key prefix', () => {
  // sanity: keys start with '5' or 'P' in WIF/BIP38; our event body should
  // never echo something that looks like a key. This is a defense-in-depth
  // probe against future changes.
  const { body } = composeAlert(baseEvent());
  assert.doesNotMatch(body, /\b5[KJL][1-9A-HJ-NP-Za-km-z]{50}\b/);
});
