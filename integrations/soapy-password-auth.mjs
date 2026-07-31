// integrations/soapy-password-auth.mjs — Soapy.Blog single-shared-password login, BOUND TO THE
// TRANSCRIPT STORE. The credential (an scrypt hash + random salt) is written to a file that sits where
// the Claude Code session transcripts live — the Codespace's `~/.claude/projects/...` and the operator mirror
// mirror — NOT in this repo and NOT in any committed file. The security property the operator asked for:
// "no one logs in to Soapy without hacking those transcripts", i.e. the credential is only readable by
// someone who already has the transcript store. There is NO OAuth and NO consent prompt: the operator is
// handed the password directly (provisionPassword) and logs in with it.
//
// House style: soft-fail-never-throw (every export returns a safe shape, never throws), injectable fs +
// clock, fully offline-testable. Secrets are NEVER logged or returned — only booleans/reasons surface.
//
//   import { provisionPassword, verifyPassword, isProvisioned, CRED_FILE } from './soapy-password-auth.mjs'

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const now = (o) => (o && o.now != null ? o.now : Date.now());

// The credential lives in the transcript store, never the repo. Default path is under the Codespace's
// Claude project transcript dir; override with SOAPY_PW_FILE (e.g. the operator mirror host path).
export const CRED_FILE = () =>
  env('SOAPY_PW_FILE', join(env('HOME', '/root'), '.claude', 'projects', '-workspaces-Bot', 'soapy-cred.json'));

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s, { mode: 0o600 }); } catch {} },
};
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || CRED_FILE() });

// scrypt parameters — deliberately expensive so a stolen cred file still resists brute force.
const N = 16384, R = 8, P = 1, KEYLEN = 64;
function derive(plain, saltHex) {
  return scryptSync(String(plain == null ? '' : plain), Buffer.from(saltHex, 'hex'), KEYLEN, { N, r: R, p: P }).toString('hex');
}

// Provision (or rotate) the single password. Returns { ok } — never echoes the password or the hash.
export function provisionPassword(plain, opts = {}) {
  const pw = String(plain == null ? '' : plain);
  if (pw.length < 8) return { ok: false, reason: 'password too short (min 8)' };
  const salt = randomBytes(16).toString('hex');
  let rec;
  try { rec = { v: 1, salt, hash: derive(pw, salt), at: now(opts) }; } catch { return { ok: false, reason: 'hash-failed' }; }
  const { fs, file } = ctx(opts);
  fs.write(file, JSON.stringify(rec));
  return { ok: true, file };
}

export function isProvisioned(opts = {}) {
  const { fs, file } = ctx(opts);
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return false;
  try { const j = JSON.parse(raw); return !!(j && j.hash && j.salt); } catch { return false; }
}

// Verify a submitted password (constant-time). Returns { ok } — soft-fails on every error, never throws.
export function verifyPassword(plain, opts = {}) {
  const { fs, file } = ctx(opts);
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { ok: false, reason: 'not-provisioned' };
  let rec; try { rec = JSON.parse(raw); } catch { return { ok: false, reason: 'corrupt' }; }
  if (!rec || !rec.hash || !rec.salt) return { ok: false, reason: 'corrupt' };
  let got; try { got = derive(plain, rec.salt); } catch { return { ok: false, reason: 'error' }; }
  try {
    const a = Buffer.from(got, 'hex');
    const b = Buffer.from(rec.hash, 'hex');
    if (a.length !== b.length || a.length === 0) return { ok: false, reason: 'mismatch' };
    return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
  } catch { return { ok: false, reason: 'error' }; }
}
