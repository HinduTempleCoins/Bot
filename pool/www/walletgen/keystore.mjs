// keystore.mjs — OPTIONAL, password-encrypted, in-browser keystore for the pool wallet.
//
// MetaMask-grade at-rest protection with ZERO dependencies: WebCrypto (crypto.subtle) only.
// This is an OPT-IN convenience layer that sits ON TOP of the existing zero-secret floor.
// The default custody model is unchanged — seed shown once, type-back quiz, only the public
// ADDRESS persisted. This module exists ONLY for users who explicitly choose "also keep an
// encrypted copy in this browser".
//
// Hard invariants:
//   - The DECRYPTED secret is NEVER written to any storage. Only the ciphertext keystore is.
//   - The unlocked secret lives in MODULE MEMORY ONLY, and is zeroized on lock / auto-lock.
//   - The pool never sees the password or the seed. Forgetting the password => the paper
//     backup is the ONLY recovery (we cannot reset it).
//
// Crypto: AES-256-GCM, key derived from the password via PBKDF2-SHA256 @ 600k iterations.
// Random 16-byte salt + 12-byte IV per encryption (crypto.getRandomValues). GCM's auth tag
// gives tamper detection: a wrong password OR a mutated ciphertext fails decryption cleanly.
//
// Compatible with the Akasha unified-identity lock/unlock/export semantics (AK5 §3):
//   - unlock() is per-keystore and materializes the secret in memory only.
//   - lock() zeroizes.
//   - revealing/using the secret for an outflow requires the password again (re-auth) — the
//     wallet page calls unlock() per spend rather than holding an ambient unlocked session.

const subtle = () => {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new Error('WebCrypto (crypto.subtle) unavailable — refusing to handle key material.');
  }
  return c;
};

export const KDF = 'PBKDF2-SHA256';
export const KDF_ITERS = 600000;        // MetaMask-grade work factor
export const KEYSTORE_VERSION = 1;
export const MIN_PASSWORD_LEN = 10;     // honest floor; see passwordStrength()
export const DEFAULT_AUTOLOCK_MS = 10 * 60 * 1000; // 10 minutes idle
export const STORAGE_KEY = 'sb-wallet-keystore-v1'; // ciphertext only ever lives here

// ---------------------------------------------------------------------------
// base64 <-> bytes (no Buffer dependency; works in browser + node webcrypto tests).
// ---------------------------------------------------------------------------
const b64 = (bytes) => {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return (typeof btoa === 'function') ? btoa(s) : Buffer.from(arr).toString('base64');
};
const unb64 = (str) => {
  if (typeof atob === 'function') {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(str, 'base64'));
};

const enc = new TextEncoder();
const dec = new TextDecoder();

// Best-effort zeroize a Uint8Array (defence in depth; JS strings are immutable so we keep the
// live secret as bytes wherever we can and overwrite them on lock).
function wipe(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

// ---------------------------------------------------------------------------
// Key derivation.
// ---------------------------------------------------------------------------
async function deriveKey(password, salt, iters = KDF_ITERS) {
  const c = subtle();
  const baseKey = await c.subtle.importKey(
    'raw', enc.encode(String(password)), { name: 'PBKDF2' }, false, ['deriveKey'],
  );
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// encryptSeed / decryptSeed — the core round trip.
// ---------------------------------------------------------------------------

/**
 * encryptSeed(secret, password) -> keystore JSON object.
 * @param {string} secret - the mnemonic (25 words) OR the private key hex. Treated opaquely.
 * @param {string} password - user-chosen; must meet MIN_PASSWORD_LEN.
 * @returns {Promise<{v,kdf,iters,salt,iv,ct}>} all binary fields are base64 strings.
 */
export async function encryptSeed(secret, password, { iters = KDF_ITERS } = {}) {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('nothing to encrypt');
  const strength = passwordStrength(password);
  if (!strength.acceptable) throw new Error(`password too weak: ${strength.reason}`);

  const c = subtle();
  const salt = c.getRandomValues(new Uint8Array(16)); // fresh per encryption
  const iv = c.getRandomValues(new Uint8Array(12));   // fresh per encryption
  const key = await deriveKey(password, salt, iters);
  const ctBuf = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret));

  return {
    v: KEYSTORE_VERSION,
    kdf: KDF,
    iters,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(new Uint8Array(ctBuf)),
  };
}

/**
 * decryptSeed(keystore, password) -> the original secret string.
 * Throws a clean Error on wrong password OR tampered ciphertext (GCM auth-tag failure). The
 * two are indistinguishable by design — we never leak which one failed.
 */
export async function decryptSeed(keystore, password) {
  if (!keystore || typeof keystore !== 'object') throw new Error('no keystore');
  if (keystore.v !== KEYSTORE_VERSION) throw new Error(`unsupported keystore version: ${keystore.v}`);
  if (keystore.kdf !== KDF) throw new Error(`unsupported kdf: ${keystore.kdf}`);
  const c = subtle();
  const salt = unb64(keystore.salt);
  const iv = unb64(keystore.iv);
  const ct = unb64(keystore.ct);
  const key = await deriveKey(password, salt, keystore.iters || KDF_ITERS);
  let plainBuf;
  try {
    plainBuf = await c.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch (e) {
    // Wrong password or tampered ciphertext — same opaque failure either way.
    throw new Error('wrong password or corrupted keystore');
  }
  return dec.decode(plainBuf);
}

// ---------------------------------------------------------------------------
// Password strength — honest meter, no fake "must contain a symbol" theatre. Length is the
// dominant factor for a PBKDF2-guarded secret; we floor at MIN_PASSWORD_LEN and reward
// variety/length without inventing hard rules beyond the length floor.
// ---------------------------------------------------------------------------
export function passwordStrength(password) {
  const pw = String(password == null ? '' : password);
  const len = pw.length;
  if (len < MIN_PASSWORD_LEN) {
    return { acceptable: false, score: 0, label: 'too short', reason: `use at least ${MIN_PASSWORD_LEN} characters` };
  }
  // Honest scoring: length is most of it; character variety adds a little.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  let score = 1; // acceptable floor
  if (len >= 14) score++;
  if (len >= 20) score++;
  if (classes >= 3) score++;
  score = Math.min(score, 4);
  const label = ['weak', 'fair', 'good', 'strong'][score - 1] || 'fair';
  return {
    acceptable: true,
    score,            // 1..4
    label,
    reason: 'a longer passphrase is stronger than a short complex one',
  };
}

// ---------------------------------------------------------------------------
// Storage adapter — persists CIPHERTEXT ONLY under STORAGE_KEY. Injectable so tests run
// without a real localStorage and the browser passes window.localStorage.
// ---------------------------------------------------------------------------
function defaultStorage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  throw new Error('no storage available');
}

/** Persist a keystore (ciphertext only). Refuses to store anything that looks like plaintext. */
export function saveKeystore(keystore, storage = defaultStorage(), key = STORAGE_KEY) {
  if (!keystore || keystore.v !== KEYSTORE_VERSION || !keystore.ct || !keystore.salt || !keystore.iv) {
    throw new Error('refusing to save: not a valid v1 keystore (must be encrypted ct/salt/iv)');
  }
  // Defence-in-depth: never persist a record carrying a decrypted secret field.
  for (const forbidden of ['secret', 'mnemonic', 'privateKey', 'plaintext', 'seed']) {
    if (forbidden in keystore) throw new Error(`refusing to save: keystore carries a plaintext "${forbidden}" field`);
  }
  storage.setItem(key, JSON.stringify(keystore));
  return true;
}

/** Load a keystore (or null). */
export function loadKeystore(storage = defaultStorage(), key = STORAGE_KEY) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const ks = JSON.parse(raw);
    return (ks && ks.v === KEYSTORE_VERSION && ks.ct) ? ks : null;
  } catch (e) {
    return null;
  }
}

/** Remove the stored keystore. */
export function removeKeystore(storage = defaultStorage(), key = STORAGE_KEY) {
  storage.removeItem(key);
  return true;
}

export function hasKeystore(storage = defaultStorage(), key = STORAGE_KEY) {
  return !!loadKeystore(storage, key);
}

// ---------------------------------------------------------------------------
// Session model — holds the decrypted secret in MEMORY ONLY, with idle auto-lock.
//
// The clock is injectable (now() in ms) so auto-lock can be tested deterministically without
// real timers. By default it uses Date.now + setTimeout (the browser). After `autoLockMs` of
// no activity the session zeroizes itself.
// ---------------------------------------------------------------------------
export class KeystoreSession {
  constructor({
    keystore = null,
    storage = null,
    storageKey = STORAGE_KEY,
    autoLockMs = DEFAULT_AUTOLOCK_MS,
    now = () => Date.now(),
    setTimer = (fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : null),
    clearTimer = (id) => (typeof clearTimeout === 'function' ? clearTimeout(id) : undefined),
  } = {}) {
    this.keystore = keystore;
    this.storage = storage;
    this.storageKey = storageKey;
    this.autoLockMs = autoLockMs;
    this._now = now;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;

    this._secretBytes = null;   // live secret as bytes (memory only)
    this._unlockedAt = 0;
    this._lastActivity = 0;
    this._timerId = null;
  }

  get locked() { return this._secretBytes === null; }

  /** Attach (or replace) the ciphertext keystore this session unlocks. */
  setKeystore(keystore) { this.keystore = keystore; return this; }

  /**
   * unlock(password) -> the decrypted secret string. Materializes it in memory only and arms
   * the idle auto-lock. Re-auth per outflow = call unlock() again at spend time (AK5 §3).
   */
  async unlock(password) {
    const ks = this.keystore || (this.storage ? loadKeystore(this.storage, this.storageKey) : null);
    if (!ks) throw new Error('no keystore to unlock');
    const secret = await decryptSeed(ks, password); // throws clean on wrong pw / tamper
    this._secretBytes = enc.encode(secret);
    this._unlockedAt = this._now();
    this._touch();
    return secret;
  }

  /** Return the live secret while unlocked (throws if locked). Refreshes the idle timer. */
  getSecret() {
    if (this.locked) throw new Error('locked');
    this._touch();
    return dec.decode(this._secretBytes);
  }

  /** Manual lock: zeroize the in-memory secret and cancel the auto-lock timer. */
  lock() {
    wipe(this._secretBytes);
    this._secretBytes = null;
    this._unlockedAt = 0;
    this._lastActivity = 0;
    if (this._timerId != null) { this._clearTimer(this._timerId); this._timerId = null; }
  }

  /** Record activity + (re)arm the idle auto-lock timer. */
  _touch() {
    this._lastActivity = this._now();
    if (this._timerId != null) this._clearTimer(this._timerId);
    this._timerId = this._setTimer(() => this._maybeAutoLock(), this.autoLockMs);
  }

  /**
   * Fire the idle check. Locks iff idle >= autoLockMs. Public so tests (and a foreground
   * visibility handler) can poke it with an injected clock. Re-arms if not yet idle.
   */
  _maybeAutoLock() {
    if (this.locked) return false;
    const idle = this._now() - this._lastActivity;
    if (idle >= this.autoLockMs) { this.lock(); return true; }
    // Woke early (clock skew / coalesced timer) — re-arm for the remaining window.
    if (this._timerId != null) this._clearTimer(this._timerId);
    this._timerId = this._setTimer(() => this._maybeAutoLock(), this.autoLockMs - idle);
    return false;
  }

  /** Test/diagnostic helper: ms since last activity (0 when locked). */
  idleMs() { return this.locked ? 0 : this._now() - this._lastActivity; }
}

// ---------------------------------------------------------------------------
// Honest UI copy — surfaced verbatim by the wallet page so the page test can assert it and the
// promise stays a single source of truth.
// ---------------------------------------------------------------------------
export const KEYSTORE_OPTIN_COPY =
  'Also keep an encrypted copy in this browser (you choose a password — we can’t reset it). ' +
  'This is optional. Your paper backup is still the real backup: if you forget this password, ' +
  'the paper backup is the only way to recover this wallet. The pool never sees your password ' +
  'or your seed — both stay on this device.';

// Clipboard hygiene: if the page offers a "copy seed" button, auto-clear the clipboard after
// this many ms so a copied secret does not linger. Best-effort (browser may deny clipboard
// writes when the tab is unfocused); the page should still warn the user.
export const CLIPBOARD_CLEAR_MS = 60 * 1000;

/**
 * Schedule a best-effort clipboard wipe `CLIPBOARD_CLEAR_MS` after a secret was copied. Only
 * overwrites if the clipboard still holds the same value we wrote (so we don't clobber the
 * user's later copy). Injectable clipboard/timer for tests. Returns the timer id.
 */
export function scheduleClipboardClear(copied, {
  clipboard = (typeof navigator !== 'undefined' ? navigator.clipboard : null),
  setTimer = (fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : null),
  ms = CLIPBOARD_CLEAR_MS,
} = {}) {
  if (!clipboard || typeof clipboard.writeText !== 'function') return null;
  return setTimer(async () => {
    try {
      if (typeof clipboard.readText === 'function') {
        const cur = await clipboard.readText();
        if (cur !== copied) return; // user copied something else — leave it alone
      }
      await clipboard.writeText('');
    } catch (e) { /* clipboard access denied (unfocused tab) — best effort only */ }
  }, ms);
}
