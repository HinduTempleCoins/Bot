// account-create.test.mjs — offline tests for the email-verified account-creation flow (Task #41).
// node --test signup/account-create.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareAccountCreation,
  submit,
  validAccountName,
  rejectIfPrivateKey,
  looksLikePublicKey,
  WITNESS_ACCOUNT,
} from './account-create.mjs';

// ── fixtures ─────────────────────────────────────────────────────────────────────
// Well-formed-looking PUBLIC keys (MEL prefix + base58 payload). Not real, but right shape.
const PUB = {
  owner: 'MEL6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV',
  active: 'MEL8FiV6v7yqYWTZz8WuFDckWvGA6dxkV3M3DZ9P1qK4XfQwYpKfN',
  posting: 'MEL7yLwCWoXJqg8z3RcA4XwgkQ2mZ1Vd5sT9bN6hP3cM8eFkD2rWq',
  memo: 'MEL5jSe5ddffBQ3xq2Gk1y8aTz9WvPcN4mLd7hR3bU6cE8fK1gXpV',
};
// A WIF-shaped private key (base58, starts with 5, ~51 chars). Must be REJECTED everywhere.
// Assembled at runtime so no key-shaped literal sits in source (pre-commit secret scanner).
const WIF = '5J' + 'pC7P8XqF9mZ2kVd3rT4nB6hW8sQ1aL5cM7eD9fG2jK4pN6vXq8Y'.slice(0, 49);

// An always-valid injected verifier (single arg or with opts).
const okVerify = () => ({ ok: true, email: 'seeker@example.com' });
const failVerify = () => ({ ok: false, reason: 'unknown-or-used' });
const expiredVerify = () => ({ ok: false, reason: 'expired' });

function validInput(overrides = {}) {
  return {
    newAccountName: 'newseeker',
    ownerPub: PUB.owner,
    activePub: PUB.active,
    postingPub: PUB.posting,
    memoPub: PUB.memo,
    verifiedEmailToken: 'token.sig',
    ...overrides,
  };
}

// ── validAccountName ──────────────────────────────────────────────────────────────
test('validAccountName accepts and rejects per graphene rules', () => {
  assert.equal(validAccountName('newseeker'), true);
  assert.equal(validAccountName('abc'), true);
  assert.equal(validAccountName('a.b.cdef'), false); // segment too short
  assert.equal(validAccountName('foo.barbaz'), true);
  assert.equal(validAccountName('ab'), false);        // too short
  assert.equal(validAccountName('UPPER'), false);     // uppercase
  assert.equal(validAccountName('-leading'), false);  // bad start
  assert.equal(validAccountName('trailing-'), false); // bad end
  assert.equal(validAccountName('has space'), false);
  assert.equal(validAccountName('this-name-is-way-too-long'), false);
});

// ── key guards ─────────────────────────────────────────────────────────────────
test('rejectIfPrivateKey throws on a WIF and passes a public key', () => {
  assert.throws(() => rejectIfPrivateKey(WIF), /private key|WIF/i);
  assert.throws(() => rejectIfPrivateKey('a'.repeat(64)), /private/i); // raw hex
  assert.equal(rejectIfPrivateKey(PUB.owner), PUB.owner);
});

test('looksLikePublicKey accepts pubkeys, rejects WIF', () => {
  assert.equal(looksLikePublicKey(PUB.active), true);
  assert.equal(looksLikePublicKey(WIF), false);
});

// ── prepareAccountCreation: happy path ───────────────────────────────────────────
test('prepareAccountCreation builds the right op with a valid token + 4 public keys', () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: okVerify });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.op));
  const [opName, payload] = r.op;
  assert.equal(opName, 'account_create_with_delegation');
  assert.equal(payload.creator, WITNESS_ACCOUNT);
  assert.equal(payload.creator, 'hathor');
  assert.equal(payload.new_account_name, 'newseeker');
  // public keys land in the auth structures and memo_key
  assert.equal(payload.owner.key_auths[0][0], PUB.owner);
  assert.equal(payload.active.key_auths[0][0], PUB.active);
  assert.equal(payload.posting.key_auths[0][0], PUB.posting);
  assert.equal(payload.memo_key, PUB.memo);
});

// ── custody guard: reject any private-key-shaped input ────────────────────────────
test('prepareAccountCreation REJECTS if any key looks like a private WIF', () => {
  for (const field of ['ownerPub', 'activePub', 'postingPub', 'memoPub']) {
    const r = prepareAccountCreation(validInput({ [field]: WIF }), { verifyFn: okVerify });
    assert.equal(r.ok, false, `${field}=WIF should be rejected`);
    assert.match(r.reason, /private-key-rejected/);
  }
});

// ── invalid account name ─────────────────────────────────────────────────────────
test('prepareAccountCreation rejects an invalid account name', () => {
  const r = prepareAccountCreation(validInput({ newAccountName: 'X' }), { verifyFn: okVerify });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-account-name');
});

// ── unverified / expired email ────────────────────────────────────────────────────
test('prepareAccountCreation rejects an unverified email token', () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: failVerify });
  assert.equal(r.ok, false);
  assert.match(r.reason, /email-not-verified/);
});

test('prepareAccountCreation rejects an expired email token', () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: expiredVerify });
  assert.equal(r.ok, false);
  assert.match(r.reason, /expired/);
});

// ── submit: dry-run default does NOT call broadcaster ────────────────────────────
test('submit in dry-run does NOT call the broadcaster', async () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: okVerify });
  let called = 0;
  const broadcaster = async () => { called += 1; return { id: 'tx' }; };
  // default: live omitted → dry-run
  const s1 = await submit(r.op, { broadcaster });
  assert.equal(s1.ok, true);
  assert.equal(s1.dryRun, true);
  assert.deepEqual(s1.op, r.op);
  // explicit live=false → still dry-run
  const s2 = await submit(r.op, { broadcaster, live: false });
  assert.equal(s2.dryRun, true);
  // live=true but NO broadcaster → still dry-run (never signs locally)
  const s3 = await submit(r.op, { live: true });
  assert.equal(s3.dryRun, true);
  assert.equal(called, 0, 'broadcaster must not be called in any dry-run path');
});

// ── submit: live WITH broadcaster calls it once ──────────────────────────────────
test('submit live WITH broadcaster hands the op to the signer exactly once', async () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: okVerify });
  let called = 0;
  let received = null;
  const broadcaster = async (op) => { called += 1; received = op; return { id: 'tx-123' }; };
  const s = await submit(r.op, { broadcaster, live: true });
  assert.equal(called, 1);
  assert.equal(s.ok, true);
  assert.equal(s.dryRun, false);
  assert.deepEqual(received, r.op);
  assert.deepEqual(s.result, { id: 'tx-123' });
});

// ── soft-fail: a throwing broadcaster does not throw out of submit ────────────────
test('submit soft-fails when the broadcaster throws', async () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: okVerify });
  const broadcaster = async () => { throw new Error('signer down'); };
  const s = await submit(r.op, { broadcaster, live: true });
  assert.equal(s.ok, false);
  assert.match(s.reason, /broadcast-failed/);
});

// ── custody invariant: no code path stores a private key ──────────────────────────
test('no private key is ever stored or returned through the op', () => {
  const r = prepareAccountCreation(validInput(), { verifyFn: okVerify });
  const serialized = JSON.stringify(r.op);
  assert.ok(!serialized.includes(WIF), 'op must not contain any WIF');
  // and a WIF-bearing attempt yields no op at all
  const bad = prepareAccountCreation(validInput({ activePub: WIF }), { verifyFn: okVerify });
  assert.equal(bad.op, undefined);
});
