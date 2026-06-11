/**
 * seams.test.mjs (sibling, contracts/) — offline unit test for the two gated
 * PRANA-DEX seams (`seams.mjs`).
 *
 * Fully offline + deterministic: no network, no clock, no randomness. The seams
 * are config-gated (disabled until PRANA exists), so the test drives the live
 * `config.seams` object — flipping `enabled` and `registeredAccounts` — to
 * cover all three branches of the seamGuard (disabled, unregistered, passed-
 * through). The contract's own config snapshot is restored after each case so
 * no other module sees a mutated config. All handlers soft-fail (return an
 * {ok:false,error} envelope) and are asserted to NOT throw.
 *
 * Run: node --test engine/contracts/seams.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../config.mjs';
import { gateway, dexSettlement, ok, err } from '../contracts/seams.mjs';

function ctx(sender) {
  return { sender, blockNum: 1, blockId: 'b', txId: 't', authLevel: 'active' };
}

// Snapshot/restore the seam config around a body so we never leak mutations.
function withSeam(name, patch, body) {
  const original = config.seams[name];
  config.seams[name] = { ...original, ...patch };
  try {
    return body();
  } finally {
    config.seams[name] = original;
  }
}

test('ok() builds a success envelope', () => {
  assert.deepEqual(ok(), { ok: true });
  assert.deepEqual(ok({ minted: '5' }), { ok: true, minted: '5' });
});

test('err() builds a failure envelope', () => {
  assert.deepEqual(err('boom'), { ok: false, error: 'boom' });
});

test('gateway.deposit is disabled by default config (no DEX, gated for PRANA)', () => {
  const r = gateway.deposit({}, ctx('anyone'), {});
  assert.equal(r.ok, false);
  assert.match(r.error, /disabled/);
  assert.match(r.error, /gateway/);
});

test('gateway.withdraw is disabled by default config', () => {
  const r = gateway.withdraw({}, ctx('anyone'), {});
  assert.equal(r.ok, false);
  assert.match(r.error, /disabled/);
});

test('dexSettlement.settle is disabled by default config', () => {
  const r = dexSettlement.settle({}, ctx('anyone'), {});
  assert.equal(r.ok, false);
  assert.match(r.error, /disabled/);
  assert.match(r.error, /dexSettlement/);
});

test('enabled seam rejects an unregistered capability account', () => {
  withSeam('gateway', { enabled: true, registeredAccounts: ['peg-gw'] }, () => {
    const r = gateway.deposit({}, ctx('mallory'), {});
    assert.equal(r.ok, false);
    assert.match(r.error, /mallory is not a registered gateway/);
  });
});

test('enabled seam with a registered account passes the guard (reaches reserved stub)', () => {
  withSeam('gateway', { enabled: true, registeredAccounts: ['peg-gw'] }, () => {
    const r = gateway.deposit({}, ctx('peg-gw'), {});
    // Guard passed; the body is the not-yet-implemented PRANA reservation.
    assert.equal(r.ok, false);
    assert.match(r.error, /not yet implemented/);
    assert.doesNotMatch(r.error, /disabled/);
    assert.doesNotMatch(r.error, /not a registered/);
  });
});

test('dexSettlement registered account likewise reaches its reserved stub', () => {
  withSeam('dexSettlement', { enabled: true, registeredAccounts: ['dex'] }, () => {
    const r = dexSettlement.settle({}, ctx('dex'), {});
    assert.equal(r.ok, false);
    assert.match(r.error, /not yet implemented/);
  });
});

test('seam handlers never throw on a missing seam config entry', () => {
  const saved = config.seams.gateway;
  delete config.seams.gateway;
  try {
    let r;
    assert.doesNotThrow(() => {
      r = gateway.withdraw({}, ctx('anyone'), {});
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /disabled/);
  } finally {
    config.seams.gateway = saved;
  }
});
