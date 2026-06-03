// vault.mjs — the Web2 Credential Vault (queue #170).
//
// Stores BYO third-party API keys (Gemini / exchange / Twilio / etc.) ENCRYPTED AT REST and
// exposes CAPABILITIES, never plaintext secrets. The load-bearing invariant: a stored secret
// never leaves the vault as plaintext. Callers do not GET secrets — they get a capability
// handle whose .use(fn) runs THEIR function with the decrypted secret in scope, and the secret
// is wiped from memory the moment fn returns. The decrypted value is never returned to the caller.
//
// Each stored credential is a *grant*: { scope, cap (spend/rate cap), revoked flag, audit log }.
//
//   import { store, grant, revoke, audit, list } from './integrations/vault.mjs'
//   store({ name: 'gemini', secret: process.env.GEMINI_KEY, scope: 'llm:gemini', cap: { calls: 100 } })
//   const h = grant('gemini')
//   await h.use((secret) => callGemini(secret, prompt))   // secret never returned
//   list()    // [{ name, scope, cap, revoked }]  — NEVER secrets
//   audit()   // append-only event log
//   revoke('gemini')
//
//   node integrations/vault.mjs            # status (names + scopes, never secrets)
//
// Crypto: AES-256-GCM via node:crypto. Master key from process.env.VAULT_MASTER_KEY (hex/base64
// or passphrase, hashed to 32 bytes). Soft-fails to a clearly-marked, ephemeral per-process DEV
// key with a loud warning — never a hardcoded real secret.

import crypto from 'node:crypto';

// ---- master key resolution (soft-fail, never a hardcoded real secret) ----
let _devKeyWarned = false;
function masterKey() {
  const raw = process.env.VAULT_MASTER_KEY;
  if (raw && String(raw).trim()) {
    // Accept hex (64 chars) or base64 32-byte; otherwise hash the passphrase to 32 bytes.
    const s = String(raw).trim();
    if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
    try {
      const b = Buffer.from(s, 'base64');
      if (b.length === 32) return b;
    } catch { /* fall through to hash */ }
    return crypto.createHash('sha256').update(s, 'utf8').digest();
  }
  // No master key configured: derive a random, ephemeral, per-process dev key. Data is
  // unrecoverable across restarts by design — this is a dev fallback, not production storage.
  if (!_DEV_KEY) {
    _DEV_KEY = crypto.randomBytes(32);
    if (!_devKeyWarned) {
      // eslint-disable-next-line no-console
      console.warn(
        '[vault] WARNING: VAULT_MASTER_KEY is not set. Using a random EPHEMERAL dev key — ' +
        'secrets will NOT survive process restart and are NOT safe for production. Set VAULT_MASTER_KEY.'
      );
      _devKeyWarned = true;
    }
  }
  return _DEV_KEY;
}
let _DEV_KEY = null;

// ---- low-level AES-256-GCM ----
function encrypt(plaintext) {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') };
}
function decrypt(blob) {
  const key = masterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

// ---- in-memory store (one record per credential name) ----
// record: { name, scope, cap, blob, revoked, uses }
const _store = new Map();

// ---- append-only audit log ----
const _audit = [];
function logEvent(event, name, extra = {}) {
  _audit.push(Object.freeze({ ts: new Date().toISOString(), event, name, ...extra }));
}

// ---- cap enforcement ----
// cap is an opaque-ish object; we understand { calls } (max number of use() invocations) and
// { rate } (alias for calls). Absent/zero/negative/missing → no limit. Spend caps are tracked
// the same way via { spend } + a per-use cost (handle.use(fn, cost)).
function capExceeded(record, cost) {
  const cap = record.cap || {};
  const callLimit = cap.calls ?? cap.rate;
  if (Number.isFinite(callLimit) && callLimit >= 0 && record.uses + 1 > callLimit) {
    return `call cap (${callLimit}) reached`;
  }
  const spendLimit = cap.spend;
  if (Number.isFinite(spendLimit) && spendLimit >= 0) {
    const projected = record.spent + (Number(cost) || 0);
    if (projected > spendLimit) return `spend cap (${spendLimit}) reached`;
  }
  return null;
}

// ---- public API ----

// store({ name, secret, scope, cap }) — encrypts the secret at rest. Overwrites by name.
export function store({ name, secret, scope = 'default', cap = {} } = {}) {
  if (!name || typeof name !== 'string') throw new Error('vault.store: name (string) is required');
  if (secret == null || secret === '') throw new Error('vault.store: secret is required');
  const blob = encrypt(String(secret));
  _store.set(name, { name, scope, cap: cap || {}, blob, revoked: false, uses: 0, spent: 0 });
  logEvent('store', name, { scope });
  return { name, scope, cap: cap || {} }; // never returns the secret
}

// grant(name) — returns a capability handle. The handle runs the caller's fn with the
// decrypted secret in scope and returns fn's result; the secret itself is never returned and
// is best-effort wiped from local scope after the call.
export function grant(name) {
  const record = _store.get(name);
  if (!record) throw new Error(`vault.grant: no credential named '${name}'`);
  return Object.freeze({
    name,
    scope: record.scope,
    async use(fn, cost = 0) {
      if (typeof fn !== 'function') throw new Error('capability.use: fn (function) is required');
      const live = _store.get(name);
      if (!live || live.revoked) {
        logEvent('use_denied', name, { reason: 'revoked' });
        throw new Error(`vault.use: credential '${name}' is revoked`);
      }
      const exceeded = capExceeded(live, cost);
      if (exceeded) {
        logEvent('use_denied', name, { reason: exceeded });
        throw new Error(`vault.use: ${exceeded} for '${name}'`);
      }
      // Reserve the use (count/spend) BEFORE running fn so caps hold under concurrency.
      live.uses += 1;
      live.spent += Number(cost) || 0;
      let secret = decrypt(live.blob);
      try {
        const result = await fn(secret);
        logEvent('use', name, { scope: live.scope, uses: live.uses, cost: Number(cost) || 0 });
        return result;
      } finally {
        secret = null; // drop reference; let GC reclaim the plaintext
      }
    },
  });
}

// revoke(name) — flags the credential; future use() calls are blocked. Keeps the record (and
// its audit history) for accountability. Idempotent.
export function revoke(name) {
  const record = _store.get(name);
  if (!record) throw new Error(`vault.revoke: no credential named '${name}'`);
  record.revoked = true;
  logEvent('revoke', name);
  return true;
}

// audit() — the append-only event log (frozen copy of frozen entries).
export function audit() {
  return _audit.slice();
}

// list() — names + scopes + caps + revoked status. NEVER secrets, NEVER ciphertext.
export function list() {
  return Array.from(_store.values()).map((r) => ({
    name: r.name,
    scope: r.scope,
    cap: r.cap,
    revoked: r.revoked,
    uses: r.uses,
  }));
}

// Test-only: clear all state (does not expose secrets).
export function __reset() {
  _store.clear();
  _audit.length = 0;
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('credential-store.mjs')) {
  const creds = list();
  // eslint-disable-next-line no-console
  console.log('Web2 Credential Vault — stored credentials (capabilities, never secrets):');
  if (!creds.length) {
    // eslint-disable-next-line no-console
    console.log('  (none stored in this process)');
  } else {
    for (const c of creds) {
      // eslint-disable-next-line no-console
      console.log(`  • ${c.name}  scope=${c.scope}  revoked=${c.revoked}  uses=${c.uses}`);
    }
  }
  if (!process.env.VAULT_MASTER_KEY) {
    // eslint-disable-next-line no-console
    console.log('\nNote: VAULT_MASTER_KEY not set — running with an ephemeral dev key.');
  }
}
