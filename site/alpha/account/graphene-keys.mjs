// graphene-keys.mjs — CLIENT-SIDE Graphene (Steem-fork) key derivation for the MELEK testnet
// account pages (signup + key-checker). Runs entirely in the visitor's browser:
// **no private key, password, or seed ever leaves the page.** The server only ever receives
// PUBLIC keys (signup → faucet) or nothing at all (key checker reads the chain, compares locally).
//
// Implements the standard Steem derivation, byte-compatible with dhive (verified in tests):
//   privFromLogin(name, role, password)  = sha256(name + role + password)
//   WIF                                  = base58check(0x80 || priv)  (double-sha256 checksum)
//   public key string                    = PREFIX + base58(pub33 || ripemd160(pub33)[0..4])
//
// secp256k1 from the audited in-repo vendor (same one the pool wallet uses); sha256 from
// WebCrypto; RIPEMD-160 implemented below (reference implementation, test-verified against
// dhive's public-key encoding).

import { publicKeyFromPrivate } from './vendor/secp256k1.mjs';

export const ROLES = ['owner', 'active', 'posting', 'memo'];
export const DEFAULT_PREFIX = 'TST'; // MELEK testnet; mainnet will pass 'MLK'/'STM'-style explicitly

// ── hashing ──────────────────────────────────────────────────────────────────────────────────────

const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle)
  ? globalThis.crypto.subtle : null;

export async function sha256(bytes) {
  if (!subtle) throw new Error('WebCrypto unavailable');
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

// RIPEMD-160 — compact reference implementation (public-domain algorithm, RFC test vectors).
/* eslint-disable no-bitwise */
export function ripemd160(bytes) {
  const r = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
  const rr = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
  const s = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
  const ss = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
  const K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
  const KK = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const f = (j, x, y, z) => (
    j < 16 ? (x ^ y ^ z)
      : j < 32 ? ((x & y) | (~x & z))
        : j < 48 ? ((x | ~y) ^ z)
          : j < 64 ? ((x & z) | (y & ~z))
            : (x ^ (y | ~z))
  ) >>> 0;

  // pad (MD-style, little-endian length)
  const len = bytes.length;
  const withOne = len + 1;
  const padded = new Uint8Array((Math.ceil((withOne + 8) / 64)) * 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitLenLo = (len << 3) >>> 0;
  const bitLenHi = Math.floor(len / 0x20000000);
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLenLo, true);
  dv.setUint32(padded.length - 4, bitLenHi, true);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let off = 0; off < padded.length; off += 64) {
    const X = new Array(16);
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    let A = h0, B = h1, C = h2, D = h3, E = h4;
    let AA = h0, BB = h1, CC = h2, DD = h3, EE = h4;
    for (let j = 0; j < 80; j++) {
      let T = (A + f(j, B, C, D) + X[r[j]] + K[j >> 4]) >>> 0;
      T = (rotl(T, s[j]) + E) >>> 0;
      A = E; E = D; D = rotl(C, 10); C = B; B = T;
      T = (AA + f(79 - j, BB, CC, DD) + X[rr[j]] + KK[j >> 4]) >>> 0;
      T = (rotl(T, ss[j]) + EE) >>> 0;
      AA = EE; EE = DD; DD = rotl(CC, 10); CC = BB; BB = T;
    }
    const T = (h1 + C + DD) >>> 0;
    h1 = (h2 + D + EE) >>> 0;
    h2 = (h3 + E + AA) >>> 0;
    h3 = (h4 + A + BB) >>> 0;
    h4 = (h0 + B + CC) >>> 0;
    h0 = T;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, h0, true); ov.setUint32(4, h1, true); ov.setUint32(8, h2, true);
  ov.setUint32(12, h3, true); ov.setUint32(16, h4, true);
  return out;
}

// ── base58 (Bitcoin alphabet) ────────────────────────────────────────────────────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58MAP = Object.fromEntries([...B58].map((c, i) => [c, BigInt(i)]));

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

export function b58decode(str) {
  let n = 0n;
  for (const c of str) {
    const v = B58MAP[c];
    if (v === undefined) throw new Error('bad base58 character');
    n = n * 58n + v;
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return new Uint8Array(out);
}

// ── key derivation ───────────────────────────────────────────────────────────────────────────────

const utf8 = (s) => new TextEncoder().encode(s);
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

/** 33-byte compressed public key from a 32-byte private key. */
export function compressedPub(priv32) {
  const xy = publicKeyFromPrivate(priv32); // 64 bytes X||Y
  const out = new Uint8Array(33);
  out[0] = (xy[63] & 1) ? 0x03 : 0x02;
  out.set(xy.subarray(0, 32), 1);
  return out;
}

/** Steem login derivation: priv = sha256(name + role + password). */
export async function privFromLogin(name, role, password) {
  return sha256(utf8(`${name}${role}${password}`));
}

/** WIF encode: base58check(0x80 || priv) with double-sha256 checksum. */
export async function wifFromPriv(priv32) {
  const payload = concat(new Uint8Array([0x80]), priv32);
  const check = (await sha256(await sha256(payload))).subarray(0, 4);
  return b58encode(concat(payload, check));
}

/** WIF decode → 32-byte priv. Throws on bad checksum/shape. */
export async function privFromWif(wif) {
  const raw = b58decode(String(wif || '').trim());
  if (raw.length !== 37 || raw[0] !== 0x80) throw new Error('not a WIF private key');
  const payload = raw.subarray(0, 33);
  const check = raw.subarray(33);
  const expect = (await sha256(await sha256(payload))).subarray(0, 4);
  for (let i = 0; i < 4; i++) if (check[i] !== expect[i]) throw new Error('WIF checksum mismatch');
  return payload.subarray(1);
}

/** Public key string: PREFIX + base58(pub33 || ripemd160(pub33)[0..4]). */
export function pubToString(pub33, prefix = DEFAULT_PREFIX) {
  const check = ripemd160(pub33).subarray(0, 4);
  return prefix + b58encode(concat(pub33, check));
}

/** Looks like a WIF? (shape check only — 51 base58 chars starting 5) */
export function looksLikeWif(s) {
  return /^5[1-9A-HJ-NP-Za-km-z]{50}$/.test(String(s || '').trim());
}

/**
 * Derive the full role key set from a login (name + master password).
 * @returns {Promise<Record<role, {wif:string, pub:string}>>}
 */
export async function keysFromLogin(name, password, prefix = DEFAULT_PREFIX) {
  const out = {};
  for (const role of ROLES) {
    const priv = await privFromLogin(name, role, password);
    out[role] = { wif: await wifFromPriv(priv), pub: pubToString(compressedPub(priv), prefix) };
  }
  return out;
}

/** Generate a fresh master password: 'P' + WIF(random 32 bytes) — the standard shape. */
export async function generateMasterPassword() {
  const rnd = new Uint8Array(32);
  globalThis.crypto.getRandomValues(rnd);
  return 'P' + (await wifFromPriv(rnd));
}

/**
 * The key-checker brain. Given the secret string a user saved and the account's on-chain
 * public keys, work out WHAT they have. Tries: the string as a WIF (which role does it
 * unlock?); as a master password; and with a leading 'P' added (the classic lost-P case).
 * Everything local — nothing leaves the page.
 *
 * @param {string} name      account name (for login-derivation)
 * @param {string} secret    whatever they saved
 * @param {{owner:string[],active:string[],posting:string[],memo?:string[]}} chainPubs
 * @returns {Promise<{kind:string, role?:string, hint:string}>}
 */
export async function classifySecret(name, secret, chainPubs, prefix = DEFAULT_PREFIX) {
  const s = String(secret || '').trim();
  const n = String(name || '').trim().toLowerCase();
  const has = (role, pub) => (chainPubs[role] || []).includes(pub);

  // 1) raw WIF?
  if (looksLikeWif(s)) {
    try {
      const pub = pubToString(compressedPub(await privFromWif(s)), prefix);
      for (const role of ROLES) {
        if (has(role, pub)) {
          return role === 'posting'
            ? { kind: 'wif', role, hint: 'This is your POSTING key — log in with exactly this string.' }
            : { kind: 'wif', role, hint: `This is your ${role.toUpperCase()} key. The login box only accepts the POSTING key (or your master password) — don't use the ${role} key for login.` };
        }
      }
    } catch { /* fall through */ }
  }

  // 2) as a master password (as-typed)?
  for (const candidate of [s, 'P' + s]) {
    const keys = await keysFromLogin(n, candidate, prefix);
    if (ROLES.some((role) => has(role, keys[role].pub))) {
      return candidate === s
        ? { kind: 'master', hint: 'This is your MASTER PASSWORD — log in with it exactly as saved.' }
        : { kind: 'master-missing-p', hint: 'This is your master password MISSING its leading "P". Log in with a capital P in front of what you saved.' };
    }
  }

  return {
    kind: 'no-match',
    hint: 'This string does not unlock this account — it may be from a different account name (check spelling) or an earlier signup attempt. Ask in signup-help; the operator can issue fresh keys.',
  };
}
