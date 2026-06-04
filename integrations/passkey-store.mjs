// passkey-store.mjs — file-backed store of the admin's registered passkeys (task #250).
//
// Keyed by admin email. Each record is a public credential descriptor produced by
// webauthn.verifyRegistration: { credentialId, publicKeyPem, signCount, aaguid, label, createdAt,
// lastUsedAt }. There is NO private key here — a passkey's private half never leaves the
// authenticator. The public key + sign counter are not secrets, but we keep the file in data/ with
// the other stores and never render the raw PEM in the portal.
//
// Follows integrations/captcha-handoff.mjs: ESM .mjs, file-or-memory store, soft-fail (a bad read =
// empty, a bad write = dropped, never throws across the public surface), injectable for offline tests.
//
//   import {
//     listCredentials, addCredential, getByCredentialId, updateSignCount,
//     removeCredential, __setStore, __resetStore,
//   } from './passkey-store.mjs'

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

function normEmail(e) { return String(e || '').trim().toLowerCase(); }

// ── store abstraction: { read(): obj, write(obj): void } over { email: [credentials] } ───────────
function makeMemStore() {
  let data = {};
  return { read: () => data, write: (obj) => { data = obj || {}; } };
}
export function makeFileStore(path) {
  return {
    read() {
      try { return JSON.parse(readFileSync(path, 'utf8') || '{}') || {}; }
      catch { return {}; }
    },
    write(obj) {
      try {
        const dir = path.replace(/\/[^/]*$/, '');
        if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(path, JSON.stringify(obj || {}, null, 2));
      } catch { /* soft-fail: a dropped write just means the passkey isn't persisted this tick */ }
    },
  };
}

let _store = makeMemStore();
export function __setStore(store) { _store = store || makeMemStore(); }
export function __resetStore() { _store = makeMemStore(); }

// Default to a file store when PASSKEY_STORE_FILE is set (prod), else in-memory (tests/dev).
if (process.env.PASSKEY_STORE_FILE) {
  try { _store = makeFileStore(process.env.PASSKEY_STORE_FILE); } catch { /* keep mem store */ }
}

function readAll() { const d = _store.read(); return d && typeof d === 'object' ? d : {}; }

// ── public surface ────────────────────────────────────────────────────────────────────────────────
// All credentials registered for an email (empty array when none).
export function listCredentials(email) {
  const e = normEmail(email);
  const all = readAll();
  return Array.isArray(all[e]) ? all[e] : [];
}

// Any admin has at least one passkey? (drives the "Sign in with passkey" button visibility hint).
export function hasAnyCredential() {
  const all = readAll();
  return Object.values(all).some((arr) => Array.isArray(arr) && arr.length > 0);
}

// Add (or replace, by credentialId) a credential for an email. `cred` is what verifyRegistration
// returned plus an optional human label. Returns the stored record.
export function addCredential(email, cred = {}, { label, now = Date.now() } = {}) {
  const e = normEmail(email);
  if (!e || !cred.credentialId || !cred.publicKeyPem) return { ok: false, reason: 'invalid-credential' };
  const all = readAll();
  const list = Array.isArray(all[e]) ? all[e].filter((c) => c.credentialId !== cred.credentialId) : [];
  const record = {
    credentialId: cred.credentialId,
    publicKeyPem: cred.publicKeyPem,
    signCount: Number(cred.signCount || 0),
    aaguid: cred.aaguid || null,
    label: label || 'passkey',
    createdAt: now,
    lastUsedAt: null,
  };
  list.push(record);
  all[e] = list;
  _store.write(all);
  return { ok: true, credential: record };
}

// Look up a credential by its credentialId across all emails (login: we know the credential, not the
// email up front). Returns { email, credential } or null.
export function getByCredentialId(credentialId) {
  if (!credentialId) return null;
  const all = readAll();
  for (const [email, list] of Object.entries(all)) {
    if (!Array.isArray(list)) continue;
    const credential = list.find((c) => c.credentialId === credentialId);
    if (credential) return { email, credential };
  }
  return null;
}

// Bump the stored sign counter (and lastUsedAt) after a successful authentication — anti-clone.
export function updateSignCount(credentialId, newSignCount, { now = Date.now() } = {}) {
  if (!credentialId) return { ok: false, reason: 'no-credential-id' };
  const all = readAll();
  for (const list of Object.values(all)) {
    if (!Array.isArray(list)) continue;
    const c = list.find((x) => x.credentialId === credentialId);
    if (c) { c.signCount = Number(newSignCount || 0); c.lastUsedAt = now; _store.write(all); return { ok: true }; }
  }
  return { ok: false, reason: 'unknown-credential' };
}

// Remove one of an email's credentials by credentialId.
export function removeCredential(email, credentialId) {
  const e = normEmail(email);
  const all = readAll();
  if (!Array.isArray(all[e])) return { ok: false, reason: 'none' };
  const before = all[e].length;
  all[e] = all[e].filter((c) => c.credentialId !== credentialId);
  _store.write(all);
  return { ok: true, removed: before - all[e].length };
}

// ── CLI (guarded) — list counts only, never the PEM ────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('passkey-store.mjs')) {
  const all = readAll();
  for (const [email, list] of Object.entries(all)) {
    console.log(`${email}: ${Array.isArray(list) ? list.length : 0} passkey(s)`);
  }
  if (!Object.keys(all).length) console.log('no passkeys registered');
}
