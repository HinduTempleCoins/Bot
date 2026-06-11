// pin-gate.mjs — deterministic salted-hash PIN gate with lockout (backlog 01de0a5ec0).
//
// The 'Require PIN codes' control for the SMS / emergency-backup command path. A short
// numeric PIN guards a sensitive command, but we NEVER store the plaintext PIN, and NEVER
// commit any real secret to the repo. Instead the caller persists a {salt, hash} record
// (both hex) wherever it keeps its own state; this module only does the pure crypto and the
// in-memory attempt accounting.
//
// All crypto is node:crypto only (scryptSync + timingSafeEqual) — no network, no disk, no env.
// Everything soft-fails: a bad/malformed input yields false / a locked gate, never a throw.
//
//   import { hashPin, verifyPin, makeSalt, createPinGate, validatePinFormat } from './pin-gate.mjs'
//
//   const rec  = hashPin('1234', makeSalt());        // { salt, hash } hex — persist this
//   verifyPin('1234', rec);                          // true
//   const gate = createPinGate({ record: rec, maxAttempts: 5 });
//   gate.check('0000');   // { ok:false, remaining:4, lockedOut:false }
//   gate.check('1234');   // { ok:true,  remaining:5, lockedOut:false } (and resets the counter)
//
// SECURITY: the PIN and the derived hash are never logged or printed. The record holds only
// a random salt and a derived hash — no secret material is committed by this file.

import crypto from 'node:crypto';

// scrypt cost params — fixed so a {salt,hash} record verifies deterministically across runs.
const KEYLEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ── salt ─────────────────────────────────────────────────────────────────────────
// Random salt as hex. Soft-fails to '' only if the platform RNG is somehow unavailable.
export function makeSalt(bytes = 16) {
  try {
    const n = Number.isInteger(bytes) && bytes > 0 && bytes <= 1024 ? bytes : 16;
    return crypto.randomBytes(n).toString('hex');
  } catch {
    return '';
  }
}

// ── hash ─────────────────────────────────────────────────────────────────────────
// Derive { salt, hash } (hex) from a pin + salt. Salt is caller-supplied; if omitted or
// malformed, a fresh one is generated. Returns null on any failure (never throws).
export function hashPin(pin, salt) {
  try {
    if (typeof pin !== 'string' || pin.length === 0) return null;
    let s = typeof salt === 'string' && /^[0-9a-fA-F]+$/.test(salt) && salt.length % 2 === 0
      ? salt.toLowerCase()
      : makeSalt();
    if (!s) return null;
    const saltBuf = Buffer.from(s, 'hex');
    const hash = crypto.scryptSync(pin, saltBuf, KEYLEN, SCRYPT_OPTS).toString('hex');
    return { salt: s, hash };
  } catch {
    return null;
  }
}

// ── verify ───────────────────────────────────────────────────────────────────────
// Constant-time compare of pin against a { salt, hash } record. Returns false on ANY
// malformed input (missing record, bad hex, length mismatch) — never throws.
export function verifyPin(pin, record) {
  try {
    if (typeof pin !== 'string' || pin.length === 0) return false;
    if (!record || typeof record !== 'object') return false;
    const { salt, hash } = record;
    if (typeof salt !== 'string' || typeof hash !== 'string') return false;
    if (!/^[0-9a-fA-F]+$/.test(salt) || salt.length % 2 !== 0) return false;
    if (!/^[0-9a-fA-F]+$/.test(hash) || hash.length % 2 !== 0) return false;
    const expected = Buffer.from(hash, 'hex');
    const saltBuf = Buffer.from(salt, 'hex');
    const actual = crypto.scryptSync(pin, saltBuf, KEYLEN, SCRYPT_OPTS);
    // timingSafeEqual requires equal lengths; guard first so it can't throw.
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── format ───────────────────────────────────────────────────────────────────────
// Digits-only PIN within [minLen, maxLen]. Pure predicate; false on anything off.
export function validatePinFormat(pin, opts = {}) {
  try {
    const minLen = Number.isInteger(opts.minLen) && opts.minLen > 0 ? opts.minLen : 4;
    const maxLen = Number.isInteger(opts.maxLen) && opts.maxLen >= minLen ? opts.maxLen : 8;
    if (typeof pin !== 'string') return false;
    if (!/^[0-9]+$/.test(pin)) return false;
    return pin.length >= minLen && pin.length <= maxLen;
  } catch {
    return false;
  }
}

// ── gate factory ───────────────────────────────────────────────────────────────────
// In-memory attempt tracker over a fixed { salt, hash } record. After maxAttempts failed
// checks the gate locks: every subsequent check returns lockedOut:true (even a correct PIN),
// until reset() is called. A successful check resets the failure counter.
//
//   check(pin) -> { ok, remaining, lockedOut }
//     ok        — the pin matched AND the gate was not locked
//     remaining — failed attempts still allowed before lockout (0 when locked)
//     lockedOut — true once failures have reached maxAttempts
//   reset()      — clear failures + unlock
export function createPinGate({ record, maxAttempts = 5 } = {}) {
  const max = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5;
  let failures = 0;

  function remainingFn() {
    return Math.max(0, max - failures);
  }

  function check(pin) {
    try {
      if (failures >= max) {
        return { ok: false, remaining: 0, lockedOut: true };
      }
      const matched = verifyPin(pin, record);
      if (matched) {
        failures = 0;
        return { ok: true, remaining: max, lockedOut: false };
      }
      failures += 1;
      const lockedOut = failures >= max;
      return { ok: false, remaining: remainingFn(), lockedOut };
    } catch {
      // Soft-fail: treat an internal error as a failed attempt, never throw.
      failures = Math.min(max, failures + 1);
      return { ok: false, remaining: remainingFn(), lockedOut: failures >= max };
    }
  }

  function reset() {
    failures = 0;
  }

  return { check, reset };
}

// No CLI / HTTP surface — this is a pure helper. Guard kept for house-style consistency.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // Intentionally inert: never accept or print a real PIN from the command line.
  process.stdout.write('pin-gate.mjs — pure helper, no CLI surface\n');
}
