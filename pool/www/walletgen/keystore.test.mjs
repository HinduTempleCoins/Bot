// keystore.test.mjs — password-encrypted in-browser keystore (WebCrypto AES-256-GCM/PBKDF2).
//
// Runs under node --test using globalThis.crypto.subtle (Node >= 20). Uses a low PBKDF2
// iteration count via the `iters` option so the suite stays fast; the crypto path is
// identical. Core property: encrypt -> decrypt recovers the exact secret; a wrong password
// or tampered ciphertext fails cleanly (never returns wrong plaintext, never throws an
// information-leaking error).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptSeed,
  decryptSeed,
  passwordStrength,
  saveKeystore,
  loadKeystore,
  removeKeystore,
  hasKeystore,
  KeystoreSession,
  KEYSTORE_VERSION,
  MIN_PASSWORD_LEN,
} from './keystore.mjs';

const ITERS = 1000; // fast test work factor; same code path as production 600k.
const SECRET = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
const PASSWORD = 'correct horse battery staple';

// Minimal in-memory localStorage shim.
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('WebCrypto subtle is available under node --test', () => {
  assert.ok(globalThis.crypto && globalThis.crypto.subtle, 'crypto.subtle required');
});

test('encrypt -> decrypt recovers the exact secret', async () => {
  const ks = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  assert.equal(ks.v, KEYSTORE_VERSION);
  assert.ok(ks.ct && ks.salt && ks.iv, 'keystore must carry ct/salt/iv');
  assert.ok(!JSON.stringify(ks).includes(SECRET), 'ciphertext must not contain the plaintext');
  const out = await decryptSeed(ks, PASSWORD);
  assert.equal(out, SECRET);
});

test('wrong password fails cleanly (does not return wrong plaintext)', async () => {
  const ks = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  await assert.rejects(decryptSeed(ks, 'wrong password here'), /wrong password or corrupted/);
});

test('tampered ciphertext fails (GCM auth tag)', async () => {
  const ks = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  // Flip a base64 char in the ciphertext.
  const bad = { ...ks, ct: ks.ct.slice(0, -2) + (ks.ct.endsWith('A') ? 'B' : 'A') + '=' };
  await assert.rejects(decryptSeed(bad, PASSWORD));
});

test('fresh salt+iv per encryption => different ciphertext for same input', async () => {
  const a = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  const b = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.salt, b.salt);
  // Both still decrypt to the same secret.
  assert.equal(await decryptSeed(a, PASSWORD), SECRET);
  assert.equal(await decryptSeed(b, PASSWORD), SECRET);
});

test('encryptSeed rejects a too-weak password', async () => {
  await assert.rejects(encryptSeed(SECRET, 'short', { iters: ITERS }), /too weak/);
});

test('passwordStrength: floors at MIN_PASSWORD_LEN', () => {
  assert.equal(passwordStrength('a'.repeat(MIN_PASSWORD_LEN - 1)).acceptable, false);
  assert.equal(passwordStrength('a'.repeat(MIN_PASSWORD_LEN)).acceptable, true);
  assert.ok(passwordStrength('A1b2c3d4e5f6g7h8i9j0!').score >= 3);
});

test('saveKeystore/loadKeystore/remove round-trip; refuses plaintext fields', async () => {
  const ks = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  const store = memStorage();
  assert.equal(hasKeystore(store), false);
  saveKeystore(ks, store);
  assert.equal(hasKeystore(store), true);
  const loaded = loadKeystore(store);
  assert.equal(loaded.ct, ks.ct);
  // Defence-in-depth: refuse to persist a record carrying a decrypted field.
  assert.throws(() => saveKeystore({ ...ks, mnemonic: SECRET }, store));
  removeKeystore(store);
  assert.equal(loadKeystore(store), null);
});

test('KeystoreSession unlock/getSecret/lock + auto-lock with injected clock', async () => {
  const ks = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  let now = 0;
  const session = new KeystoreSession({
    keystore: ks,
    autoLockMs: 1000,
    now: () => now,
    // No real timers — we drive _maybeAutoLock manually.
    setTimer: () => null,
    clearTimer: () => {},
  });
  assert.equal(session.locked, true);
  const secret = await session.unlock(PASSWORD);
  assert.equal(secret, SECRET);
  assert.equal(session.locked, false);
  assert.equal(session.getSecret(), SECRET);

  // Not yet idle -> stays unlocked.
  now = 500;
  assert.equal(session._maybeAutoLock(), false);
  assert.equal(session.locked, false);

  // Past the idle window -> auto-locks and zeroizes.
  now = 2000;
  assert.equal(session._maybeAutoLock(), true);
  assert.equal(session.locked, true);
  assert.throws(() => session.getSecret(), /locked/);
});

test('KeystoreSession.unlock rejects a wrong password', async () => {
  const ks = await encryptSeed(SECRET, PASSWORD, { iters: ITERS });
  const session = new KeystoreSession({ keystore: ks, setTimer: () => null, clearTimer: () => {} });
  await assert.rejects(session.unlock('not the password'));
  assert.equal(session.locked, true);
});
