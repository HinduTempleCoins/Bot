// passkey-store.test.mjs — offline tests for the admin passkey credential store (task #250).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  listCredentials,
  addCredential,
  getByCredentialId,
  updateSignCount,
  removeCredential,
  hasAnyCredential,
  __resetStore,
} from './passkey-store.mjs';

const EMAIL = 'Operator@Gmail.com';
const cred = (id) => ({ credentialId: id, publicKeyPem: '-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----\n', signCount: 0 });

beforeEach(() => __resetStore());

test('empty store has no credentials', () => {
  assert.deepEqual(listCredentials(EMAIL), []);
  assert.equal(hasAnyCredential(), false);
});

test('addCredential stores and lists, keyed case-insensitively by email', () => {
  const r = addCredential(EMAIL, cred('cred-1'), { label: 'YubiKey' });
  assert.equal(r.ok, true);
  const list = listCredentials('operator@gmail.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].credentialId, 'cred-1');
  assert.equal(list[0].label, 'YubiKey');
  assert.equal(hasAnyCredential(), true);
});

test('addCredential rejects an incomplete credential', () => {
  assert.equal(addCredential(EMAIL, { credentialId: 'x' }).ok, false);
  assert.equal(addCredential('', cred('y')).ok, false);
});

test('addCredential replaces a duplicate credentialId', () => {
  addCredential(EMAIL, cred('cred-1'));
  addCredential(EMAIL, { ...cred('cred-1'), signCount: 9 });
  const list = listCredentials(EMAIL);
  assert.equal(list.length, 1);
  assert.equal(list[0].signCount, 9);
});

test('getByCredentialId finds across emails', () => {
  addCredential(EMAIL, cred('cred-1'));
  addCredential('backup@yahoo.com', cred('cred-2'));
  const hit = getByCredentialId('cred-2');
  assert.equal(hit.email, 'backup@yahoo.com');
  assert.equal(hit.credential.credentialId, 'cred-2');
  assert.equal(getByCredentialId('nope'), null);
});

test('updateSignCount bumps the counter + lastUsedAt', () => {
  addCredential(EMAIL, cred('cred-1'));
  const r = updateSignCount('cred-1', 42, { now: 123 });
  assert.equal(r.ok, true);
  const c = listCredentials(EMAIL)[0];
  assert.equal(c.signCount, 42);
  assert.equal(c.lastUsedAt, 123);
  assert.equal(updateSignCount('unknown', 1).ok, false);
});

test('removeCredential deletes by id', () => {
  addCredential(EMAIL, cred('cred-1'));
  addCredential(EMAIL, cred('cred-2'));
  const r = removeCredential(EMAIL, 'cred-1');
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  assert.equal(listCredentials(EMAIL).length, 1);
});
