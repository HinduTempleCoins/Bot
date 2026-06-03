/**
 * src/chain/evm-aa-grants.test.mjs — OFFLINE unit tests for EVM AA grants.
 *
 * Pure functions only: no network, no RPC, no signing, no I/O. Run with:
 *
 *   node --test src/chain/evm-aa-grants.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GrantError,
  OWNER_OPS,
  createSessionKey,
  authorize,
  paymasterSponsor,
} from './evm-aa-grants.mjs';

// A fixed clock so time-window tests are deterministic.
const T = 1_000_000;
const clock = () => T;

function freshGrant(overrides = {}) {
  return createSessionKey({
    scope: 'prana:trade',
    validAfter: T - 100,
    validUntil: T + 1000,
    spendCap: 1000,
    allowedTargets: ['0xRouter', '0xVault'],
    ...overrides,
  });
}

// ---- createSessionKey -----------------------------------------------------

test('createSessionKey: produces a frozen scoped grant', () => {
  const g = freshGrant();
  assert.equal(g.kind, 'evm-session-key');
  assert.equal(g.scope, 'prana:trade');
  assert.equal(g.spendCap, 1000);
  assert.deepEqual(g.allowedTargets, ['0xrouter', '0xvault']); // normalized lower-case
  assert.ok(Object.isFrozen(g));
  assert.ok(Object.isFrozen(g.allowedTargets));
});

test('createSessionKey: rejects empty scope', () => {
  assert.throws(() => createSessionKey({ scope: '', validUntil: T + 1, spendCap: 1, allowedTargets: ['0xa'] }), GrantError);
});

test('createSessionKey: rejects empty allowedTargets', () => {
  assert.throws(() => createSessionKey({ scope: 's', validUntil: T + 1, spendCap: 1, allowedTargets: [] }), GrantError);
});

test('createSessionKey: rejects validUntil <= validAfter', () => {
  assert.throws(
    () => createSessionKey({ scope: 's', validAfter: 100, validUntil: 100, spendCap: 1, allowedTargets: ['0xa'] }),
    GrantError,
  );
});

test('createSessionKey: rejects owner-op in allowedMethods (create-time invariant)', () => {
  assert.throws(
    () =>
      createSessionKey({
        scope: 's',
        validUntil: T + 1,
        spendCap: 1,
        allowedTargets: ['0xa'],
        allowedMethods: ['swap', 'transferOwnership'],
      }),
    GrantError,
  );
});

// ---- authorize: in-scope allowed ------------------------------------------

test('authorize: in-scope op within cap is allowed', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xRouter', method: 'swap', value: 100, spent: 0 }, { clock });
  assert.deepEqual(r, { allowed: true, reason: 'ok' });
});

test('authorize: target match is case-insensitive', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xVAULT', value: 0 }, { clock });
  assert.equal(r.allowed, true);
});

// ---- authorize: out-of-scope rejected -------------------------------------

test('authorize: out-of-scope target is rejected', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xEvilContract', value: 0 }, { clock });
  assert.deepEqual(r, { allowed: false, reason: 'target-not-allowed' });
});

test('authorize: method not in allowlist is rejected', () => {
  const g = freshGrant({ allowedMethods: ['swap'] });
  const r = authorize(g, { target: '0xRouter', method: 'withdraw', value: 0 }, { clock });
  assert.deepEqual(r, { allowed: false, reason: 'method-not-allowed' });
});

// ---- authorize: expired / not-yet-valid -----------------------------------

test('authorize: expired grant is rejected', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xRouter', value: 0 }, { clock: () => T + 5000 });
  assert.deepEqual(r, { allowed: false, reason: 'expired' });
});

test('authorize: not-yet-valid grant is rejected', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xRouter', value: 0 }, { clock: () => T - 9999 });
  assert.deepEqual(r, { allowed: false, reason: 'not-yet-valid' });
});

// ---- authorize: over-cap rejected -----------------------------------------

test('authorize: cumulative over spend cap is rejected', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xRouter', value: 200, spent: 900 }, { clock });
  assert.deepEqual(r, { allowed: false, reason: 'spend-cap-exceeded' });
});

test('authorize: per-op cap is enforced', () => {
  const g = freshGrant({ perOpCap: 50 });
  const r = authorize(g, { target: '0xRouter', value: 100, spent: 0 }, { clock });
  assert.deepEqual(r, { allowed: false, reason: 'per-op-cap-exceeded' });
});

test('authorize: exactly at spend cap is allowed', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xRouter', value: 100, spent: 900 }, { clock });
  assert.equal(r.allowed, true);
});

// ---- authorize: owner-op ALWAYS rejected (load-bearing invariant) ---------

test('authorize: every owner op is hard-rejected, even on an allowed target', () => {
  const g = freshGrant();
  for (const op of OWNER_OPS) {
    const r = authorize(g, { target: '0xRouter', method: op, value: 0 }, { clock });
    assert.deepEqual(
      r,
      { allowed: false, reason: 'owner-op-forbidden' },
      `owner op '${op}' must be rejected`,
    );
  }
});

test('authorize: explicit ownerLevel flag is hard-rejected', () => {
  const g = freshGrant();
  const r = authorize(g, { target: '0xRouter', method: 'swap', ownerLevel: true }, { clock });
  assert.deepEqual(r, { allowed: false, reason: 'owner-op-forbidden' });
});

test('authorize: owner-op rejected takes precedence over expiry/target', () => {
  const g = freshGrant();
  // Out-of-scope target + expired + owner op: owner-op denial wins (checked first).
  const r = authorize(g, { target: '0xEvil', method: 'transferOwnership' }, { clock: () => T + 99999 });
  assert.equal(r.reason, 'owner-op-forbidden');
});

test('authorize: invalid grant / userOp', () => {
  assert.deepEqual(authorize(null, { target: '0xRouter' }), { allowed: false, reason: 'invalid-grant' });
  assert.deepEqual(authorize(freshGrant(), null), { allowed: false, reason: 'invalid-userop' });
});

// ---- paymasterSponsor: faucet rules ---------------------------------------

test('paymasterSponsor: sponsors an op within gas and budget', () => {
  const r = paymasterSponsor(
    { target: '0xRouter', gas: 100 },
    { maxGasPerOp: 200, dailyBudget: 1000, spentToday: 0 },
  );
  assert.deepEqual(r, { sponsored: true, reason: 'ok' });
});

test('paymasterSponsor: rejects op over per-op gas cap', () => {
  const r = paymasterSponsor({ gas: 500 }, { maxGasPerOp: 200, dailyBudget: 1000 });
  assert.deepEqual(r, { sponsored: false, reason: 'per-op-gas-cap-exceeded' });
});

test('paymasterSponsor: rejects op over daily budget', () => {
  const r = paymasterSponsor({ gas: 200 }, { maxGasPerOp: 500, dailyBudget: 1000, spentToday: 900 });
  assert.deepEqual(r, { sponsored: false, reason: 'daily-budget-exceeded' });
});

test('paymasterSponsor: enforces target allowlist when provided', () => {
  const rules = { maxGasPerOp: 500, dailyBudget: 1000, allowedTargets: ['0xRouter'] };
  assert.equal(paymasterSponsor({ target: '0xRouter', gas: 10 }, rules).sponsored, true);
  assert.deepEqual(
    paymasterSponsor({ target: '0xEvil', gas: 10 }, rules),
    { sponsored: false, reason: 'target-not-sponsorable' },
  );
});

test('paymasterSponsor: requireFreshRecipient gates sponsorship', () => {
  const rules = { maxGasPerOp: 500, dailyBudget: 1000, requireFreshRecipient: true };
  assert.deepEqual(
    paymasterSponsor({ gas: 10 }, rules),
    { sponsored: false, reason: 'recipient-not-fresh' },
  );
  assert.equal(paymasterSponsor({ gas: 10, recipientIsFresh: true }, rules).sponsored, true);
});

test('paymasterSponsor: never sponsors an owner op', () => {
  const r = paymasterSponsor(
    { target: '0xRouter', method: 'transferOwnership', gas: 10 },
    { maxGasPerOp: 500, dailyBudget: 1000 },
  );
  assert.deepEqual(r, { sponsored: false, reason: 'owner-op-forbidden' });
});

test('paymasterSponsor: kill-switch (enabled:false) refuses all', () => {
  const r = paymasterSponsor({ gas: 1 }, { maxGasPerOp: 500, dailyBudget: 1000, enabled: false });
  assert.deepEqual(r, { sponsored: false, reason: 'faucet-disabled' });
});
