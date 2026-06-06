// Tests for the OPTIONAL encrypted keystore (pool/www/walletgen/keystore.mjs).
// Offline, no network, no DOM. Uses Node's WebCrypto via node:crypto.webcrypto.
// Run: node --test pool/www/keystore.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Provide WebCrypto the way the browser does, BEFORE importing the module under test.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

const {
  encryptSeed, decryptSeed, passwordStrength,
  saveKeystore, loadKeystore, removeKeystore, hasKeystore,
  KeystoreSession, scheduleClipboardClear,
  KDF, KDF_ITERS, KEYSTORE_VERSION, MIN_PASSWORD_LEN, STORAGE_KEY,
  KEYSTORE_OPTIN_COPY,
} = await import('./walletgen/keystore.mjs');

const MNEMONIC =
  'fewest lipstick auburn cocoa macro circle hurried impel macro hatchet jeopardy swung ' +
  'aloof spiders gags jaws abducts buying alpine athlete junk patio academy loudly academy';
const PW = 'correct horse battery'; // 21 chars, passphrase-style

// A minimal in-memory localStorage stand-in.
function memStorage() {
  const m = new Map();
  return {
    setItem: (k, v) => m.set(k, String(v)),
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

// ---- core crypto ----------------------------------------------------------

test('round-trip: encryptSeed -> decryptSeed recovers the exact secret', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  assert.equal(ks.v, KEYSTORE_VERSION);
  assert.equal(ks.kdf, KDF);
  assert.equal(ks.iters, KDF_ITERS);
  assert.ok(ks.salt && ks.iv && ks.ct, 'has salt/iv/ct');
  const out = await decryptSeed(ks, PW);
  assert.equal(out, MNEMONIC);
});

test('round-trip works for an EVM private key string too', async () => {
  const pk = '0x' + 'ab'.repeat(32);
  const ks = await encryptSeed(pk, PW);
  assert.equal(await decryptSeed(ks, pk === PW ? PW : PW), pk);
});

test('random salt + iv per encryption (same input -> different ciphertext)', async () => {
  const a = await encryptSeed(MNEMONIC, PW);
  const b = await encryptSeed(MNEMONIC, PW);
  assert.notEqual(a.salt, b.salt, 'fresh salt each time');
  assert.notEqual(a.iv, b.iv, 'fresh iv each time');
  assert.notEqual(a.ct, b.ct, 'ciphertext differs');
  // ...yet both decrypt to the same secret.
  assert.equal(await decryptSeed(a, PW), MNEMONIC);
  assert.equal(await decryptSeed(b, PW), MNEMONIC);
});

test('wrong password fails cleanly (no plaintext leak, opaque error)', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  await assert.rejects(() => decryptSeed(ks, PW + 'x'), /wrong password or corrupted keystore/);
});

test('tamper detection: mutating ciphertext is rejected by GCM auth tag', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  // Flip a character in the base64 ciphertext.
  const chars = ks.ct.split('');
  const i = Math.floor(chars.length / 2);
  chars[i] = chars[i] === 'A' ? 'B' : 'A';
  const tampered = { ...ks, ct: chars.join('') };
  await assert.rejects(() => decryptSeed(tampered, PW), /wrong password or corrupted keystore/);
});

test('tamper detection: mutating the IV is rejected', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  const chars = ks.iv.split('');
  chars[0] = chars[0] === 'A' ? 'B' : 'A';
  await assert.rejects(() => decryptSeed({ ...ks, iv: chars.join('') }, PW), /wrong password or corrupted keystore/);
});

test('decryptSeed rejects unknown version / kdf', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  await assert.rejects(() => decryptSeed({ ...ks, v: 99 }, PW), /unsupported keystore version/);
  await assert.rejects(() => decryptSeed({ ...ks, kdf: 'scrypt' }, PW), /unsupported kdf/);
});

// ---- password strength ----------------------------------------------------

test('password strength: floor of MIN_PASSWORD_LEN is enforced honestly', () => {
  const short = passwordStrength('a'.repeat(MIN_PASSWORD_LEN - 1));
  assert.equal(short.acceptable, false);
  assert.match(short.reason, new RegExp(String(MIN_PASSWORD_LEN)));

  const ok = passwordStrength('a'.repeat(MIN_PASSWORD_LEN));
  assert.equal(ok.acceptable, true);
  assert.ok(ok.score >= 1);

  const strong = passwordStrength('correct horse battery Staple9');
  assert.equal(strong.acceptable, true);
  assert.ok(strong.score >= 3, 'long varied passphrase scores high');
});

test('encryptSeed refuses a too-weak password', async () => {
  await assert.rejects(() => encryptSeed(MNEMONIC, 'short'), /too weak/);
});

// ---- storage adapter (ciphertext only) ------------------------------------

test('storage adapter persists CIPHERTEXT ONLY and round-trips', async () => {
  const storage = memStorage();
  const ks = await encryptSeed(MNEMONIC, PW);
  saveKeystore(ks, storage);
  const stored = storage.getItem(STORAGE_KEY);
  // The raw stored string must NOT contain any seed word or the plaintext.
  assert.ok(!stored.includes('lipstick'), 'no plaintext seed word in storage');
  assert.ok(!stored.includes(MNEMONIC), 'no plaintext mnemonic in storage');
  // It IS the encrypted keystore.
  assert.ok(stored.includes(ks.ct), 'stored value carries the ciphertext');
  const loaded = loadKeystore(storage);
  assert.equal(await decryptSeed(loaded, PW), MNEMONIC);
  assert.equal(hasKeystore(storage), true);
  removeKeystore(storage);
  assert.equal(hasKeystore(storage), false);
  assert.equal(loadKeystore(storage), null);
});

test('storage adapter refuses to save a record that carries a plaintext secret', () => {
  const storage = memStorage();
  const bad = { v: KEYSTORE_VERSION, kdf: KDF, iters: KDF_ITERS, salt: 'x', iv: 'y', ct: 'z', mnemonic: MNEMONIC };
  assert.throws(() => saveKeystore(bad, storage), /plaintext "mnemonic"/);
  assert.throws(() => saveKeystore({ v: KEYSTORE_VERSION, ct: 'z' }, storage), /not a valid v1 keystore/);
});

// ---- session model (memory only + auto-lock) ------------------------------

test('session: unlock holds secret in memory, lock zeroizes', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  const s = new KeystoreSession({ keystore: ks });
  assert.equal(s.locked, true);
  const secret = await s.unlock(PW);
  assert.equal(secret, MNEMONIC);
  assert.equal(s.locked, false);
  assert.equal(s.getSecret(), MNEMONIC);
  s.lock();
  assert.equal(s.locked, true);
  assert.throws(() => s.getSecret(), /locked/);
});

test('session: wrong password leaves the session locked', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  const s = new KeystoreSession({ keystore: ks });
  await assert.rejects(() => s.unlock('nope nope nope'), /wrong password or corrupted keystore/);
  assert.equal(s.locked, true);
});

test('session: never writes the decrypted secret to storage on unlock', async () => {
  const storage = memStorage();
  const ks = await encryptSeed(MNEMONIC, PW);
  saveKeystore(ks, storage);
  const s = new KeystoreSession({ storage });
  await s.unlock(PW);
  // After unlock, storage still only holds the ciphertext keystore.
  const stored = storage.getItem(STORAGE_KEY);
  assert.ok(!stored.includes(MNEMONIC), 'decrypted secret never persisted');
  assert.ok(!stored.includes('lipstick'));
});

test('session: auto-lock fires after idle window (injected clock)', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  let nowMs = 1000;
  const timers = [];
  const s = new KeystoreSession({
    keystore: ks,
    autoLockMs: 5000,
    now: () => nowMs,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  await s.unlock(PW);
  assert.equal(s.locked, false);
  // Not yet idle enough -> _maybeAutoLock re-arms, stays unlocked.
  nowMs += 3000;
  s._maybeAutoLock();
  assert.equal(s.locked, false, 'still unlocked before window elapses');
  // Past the idle window -> locks.
  nowMs += 3000; // total idle 6000 >= 5000
  s._maybeAutoLock();
  assert.equal(s.locked, true, 'auto-locked after idle window');
});

test('session: activity (getSecret) refreshes the idle timer', async () => {
  const ks = await encryptSeed(MNEMONIC, PW);
  let nowMs = 0;
  const s = new KeystoreSession({
    keystore: ks, autoLockMs: 5000, now: () => nowMs,
    setTimer: () => 1, clearTimer: () => {},
  });
  await s.unlock(PW);
  nowMs += 4000;
  s.getSecret();          // activity -> resets lastActivity to now (4000)
  nowMs += 4000;          // 4000 idle since last activity, < 5000
  assert.equal(s._maybeAutoLock(), false);
  assert.equal(s.locked, false);
});

// ---- clipboard hygiene ----------------------------------------------------

test('scheduleClipboardClear wipes the clipboard after the window iff unchanged', async () => {
  let clip = 'the-secret';
  let scheduled = null;
  const clipboard = {
    writeText: async (t) => { clip = t; },
    readText: async () => clip,
  };
  scheduleClipboardClear('the-secret', { clipboard, setTimer: (fn) => { scheduled = fn; return 1; }, ms: 60000 });
  assert.equal(typeof scheduled, 'function');
  await scheduled();
  assert.equal(clip, '', 'clipboard cleared after window');
});

test('scheduleClipboardClear leaves the clipboard alone if the user copied something else', async () => {
  let clip = 'something-else';
  let scheduled = null;
  const clipboard = { writeText: async (t) => { clip = t; }, readText: async () => clip };
  scheduleClipboardClear('the-secret', { clipboard, setTimer: (fn) => { scheduled = fn; return 1; }, ms: 60000 });
  await scheduled();
  assert.equal(clip, 'something-else', 'did not clobber the user later copy');
});

// ---- page wiring: honest opt-in copy on the wallet page -------------------

test('keystore opt-in copy is honest (optional, password unrecoverable, paper is real backup)', () => {
  assert.match(KEYSTORE_OPTIN_COPY, /encrypted copy in this browser/i);
  assert.match(KEYSTORE_OPTIN_COPY, /can.?t reset it/i);
  assert.match(KEYSTORE_OPTIN_COPY, /paper backup/i);
  assert.match(KEYSTORE_OPTIN_COPY, /never sees your password or your seed/i);
});

test('wallet page contains the honest encrypted-keystore opt-in copy', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, 'wallet', 'index.html'), 'utf8');
  assert.match(html, /encrypted copy in this browser/i);
  assert.match(html, /can(?:’|&rsquo;|')?t reset it/i, 'honest: we cannot reset the password');
  assert.match(html, /paper backup/i, 'honest: paper backup is the only recovery');
});
