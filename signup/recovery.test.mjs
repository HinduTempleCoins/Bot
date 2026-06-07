// recovery.test.mjs — offline tests for signup/recovery.mjs (Steem-style account recovery).
// node --test signup/recovery.test.mjs
//
// Fully offline: no network. The broadcaster is injected with a fake that records ops. We assert
// op shapes, authority/account-name validation, the private-key custody guard, the testnet-prefix
// guard, the request→recover sequence, and the zero-WIF / DRY-RUN floor. Never asserts a throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecoveryRequest, buildRecoverAccount, buildChangeRecoveryAccount,
  validateOwnerAuthority, ownerAuthorityFromKey, runRecovery,
  RECOVERY_ACCOUNT, PREFIX, TESTNET_RECOVERY_PERIOD_S,
} from './recovery.mjs';

const NEW_PUB = 'TST5jUQUS5Xdjp8RB5Wj2bWct8Gwf1mHzL3sQZ9k3kBm2Nq4Rtwwz';
const OLD_PUB = 'TST6s9nba8D9QpPhuX6Vyvgcg6ck7YuLULbNsPLrfKFMG7pR7eBGtX';
// A value with WIF/private-key SHAPE (base58, leading '5', ~51 chars), built at runtime so no
// literal key string sits in source. It is NOT a real key — only its shape matters: the custody
// guard must reject anything that looks like a private key.
const WIF = '5' + 'JLwabcdefghJKLMNPQRSTUVWXYZ23456789kmnpqrstuvwxyz'.slice(0, 50);

function authFrom(pub) {
  return { weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] };
}

// ── validateOwnerAuthority ────────────────────────────────────────────────────────
test('validateOwnerAuthority accepts a single-key TST owner authority', () => {
  assert.deepEqual(validateOwnerAuthority(authFrom(NEW_PUB)), { ok: true });
});

test('validateOwnerAuthority rejects non-object / missing fields', () => {
  assert.equal(validateOwnerAuthority(null).ok, false);
  assert.equal(validateOwnerAuthority([]).ok, false);
  assert.equal(validateOwnerAuthority({}).ok, false);
  assert.equal(validateOwnerAuthority({ weight_threshold: 0, account_auths: [], key_auths: [[NEW_PUB, 1]] }).ok, false);
});

test('validateOwnerAuthority rejects account_auths (only single-key supported)', () => {
  const a = { weight_threshold: 1, account_auths: [['someacct', 1]], key_auths: [[NEW_PUB, 1]] };
  assert.equal(validateOwnerAuthority(a).reason, 'account-auths-not-supported');
});

test('validateOwnerAuthority rejects a private-key-shaped value HARD', () => {
  const a = authFrom(WIF);
  const r = validateOwnerAuthority(a);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'private-key-rejected');
});

test('validateOwnerAuthority rejects a wrong-prefix (non-TST / mainnet) key', () => {
  const a = authFrom('MEL5jUQUS5Xdjp8RB5Wj2bWct8Gwf1mHzL3sQZ9k3kBm2Nq4Rtwwz');
  assert.equal(validateOwnerAuthority(a).reason, 'wrong-prefix');
});

test('validateOwnerAuthority rejects weights below threshold', () => {
  const a = { weight_threshold: 2, account_auths: [], key_auths: [[NEW_PUB, 1]] };
  assert.equal(validateOwnerAuthority(a).reason, 'weights-below-threshold');
});

// ── ownerAuthorityFromKey ───────────────────────────────────────────────────────
test('ownerAuthorityFromKey builds the canonical single-key authority', () => {
  assert.deepEqual(ownerAuthorityFromKey(NEW_PUB), { weight_threshold: 1, account_auths: [], key_auths: [[NEW_PUB, 1]] });
});

test('ownerAuthorityFromKey throws on a private key (custody guard)', () => {
  assert.throws(() => ownerAuthorityFromKey(WIF));
});

// ── buildRecoveryRequest ─────────────────────────────────────────────────────────
test('buildRecoveryRequest builds request_account_recovery with recovery_account=hathor', () => {
  const r = buildRecoveryRequest('faucet-test-1', authFrom(NEW_PUB));
  assert.equal(r.ok, true);
  const [name, payload] = r.op;
  assert.equal(name, 'request_account_recovery');
  assert.equal(payload.recovery_account, RECOVERY_ACCOUNT);
  assert.equal(payload.recovery_account, 'hathor');
  assert.equal(payload.account_to_recover, 'faucet-test-1');
  assert.deepEqual(payload.new_owner_authority, authFrom(NEW_PUB));
  assert.deepEqual(payload.extensions, []);
});

test('buildRecoveryRequest honors an explicit recoveryAccount override', () => {
  const r = buildRecoveryRequest('faucet-test-1', authFrom(NEW_PUB), { recoveryAccount: 'somehelper' });
  assert.equal(r.op[1].recovery_account, 'somehelper');
});

test('buildRecoveryRequest rejects a bad account name', () => {
  assert.equal(buildRecoveryRequest('xx', authFrom(NEW_PUB)).reason, 'invalid-account-name');
});

test('buildRecoveryRequest rejects a bad new owner authority (private key)', () => {
  const r = buildRecoveryRequest('faucet-test-1', authFrom(WIF));
  assert.equal(r.ok, false);
  assert.match(r.reason, /^bad-new-owner:private-key-rejected$/);
});

// ── buildRecoverAccount ──────────────────────────────────────────────────────────
test('buildRecoverAccount builds recover_account with new + recent owner authorities', () => {
  const r = buildRecoverAccount('faucet-test-1', authFrom(NEW_PUB), authFrom(OLD_PUB));
  assert.equal(r.ok, true);
  const [name, payload] = r.op;
  assert.equal(name, 'recover_account');
  assert.equal(payload.account_to_recover, 'faucet-test-1');
  assert.deepEqual(payload.new_owner_authority, authFrom(NEW_PUB));
  assert.deepEqual(payload.recent_owner_authority, authFrom(OLD_PUB));
});

test('buildRecoverAccount rejects a private-key-shaped recent authority', () => {
  const r = buildRecoverAccount('faucet-test-1', authFrom(NEW_PUB), authFrom(WIF));
  assert.equal(r.ok, false);
  assert.match(r.reason, /^bad-recent-owner:private-key-rejected$/);
});

// ── buildChangeRecoveryAccount ───────────────────────────────────────────────────
test('buildChangeRecoveryAccount builds change_recovery_account', () => {
  const r = buildChangeRecoveryAccount('myaccount', 'hathor');
  assert.equal(r.ok, true);
  const [name, payload] = r.op;
  assert.equal(name, 'change_recovery_account');
  assert.equal(payload.account_to_recover, 'myaccount');
  assert.equal(payload.new_recovery_account, 'hathor');
});

test('buildChangeRecoveryAccount rejects setting yourself as your own helper', () => {
  assert.equal(buildChangeRecoveryAccount('hathor', 'hathor').reason, 'recovery-account-equals-self');
});

test('buildChangeRecoveryAccount rejects a bad new recovery account name', () => {
  assert.equal(buildChangeRecoveryAccount('myaccount', 'xx').reason, 'invalid-new-recovery-account');
});

// ── the request → recover sequence (the recovery cycle, shapes only) ─────────────
test('request then recover form a consistent pair on the same new_owner_authority', () => {
  const newOwner = authFrom(NEW_PUB);
  const recent = authFrom(OLD_PUB);
  const req = buildRecoveryRequest('faucet-test-1', newOwner);
  const rec = buildRecoverAccount('faucet-test-1', newOwner, recent);
  assert.equal(req.ok && rec.ok, true);
  // the new owner authority named in the request MUST equal the one in recover_account
  assert.deepEqual(req.op[1].new_owner_authority, rec.op[1].new_owner_authority);
  assert.equal(req.op[1].account_to_recover, rec.op[1].account_to_recover);
});

// ── runRecovery: DRY-RUN floor + injected broadcaster ────────────────────────────
test('runRecovery is DRY-RUN with no broadcaster (zero-WIF floor), even when live=true', async () => {
  const req = buildRecoveryRequest('faucet-test-1', authFrom(NEW_PUB));
  const out = await runRecovery(req, { live: true }); // no broadcaster injected
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.op, req.op);
});

test('runRecovery broadcasts via an injected broadcaster when live', async () => {
  const seen = [];
  const broadcaster = async (op) => { seen.push(op); return { id: 'txid-abc' }; };
  const req = buildRecoveryRequest('faucet-test-1', authFrom(NEW_PUB));
  const out = await runRecovery(req, { live: true, broadcaster });
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, false);
  assert.equal(out.id, 'txid-abc');
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'request_account_recovery');
});

test('runRecovery soft-fails (never throws) on a broadcaster error', async () => {
  const broadcaster = async () => { throw new Error('boom'); };
  const rec = buildRecoverAccount('faucet-test-1', authFrom(NEW_PUB), authFrom(OLD_PUB));
  const out = await runRecovery(rec, { live: true, broadcaster });
  assert.equal(out.ok, false);
  assert.match(out.reason, /^broadcast-failed:boom/);
});

test('runRecovery refuses a failed build result', async () => {
  const out = await runRecovery({ ok: false, reason: 'invalid-account-name' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid-account-name');
});

test('exports: testnet config constants are present and sane', () => {
  assert.equal(PREFIX, 'TST');
  assert.equal(RECOVERY_ACCOUNT, 'hathor');
  assert.equal(typeof TESTNET_RECOVERY_PERIOD_S, 'number');
  assert.ok(TESTNET_RECOVERY_PERIOD_S > 0);
});
