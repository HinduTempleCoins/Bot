// site/yoni/producers-store.mjs — who may publish here, and how somebody becomes one.
//
// ⭐ WHY THIS IS A STORE AND NOT AN ENV VAR.
// The first version of the producer allowlist was YONI_PRODUCERS in the unit file, which meant approving
// an applicant required editing systemd and restarting the web tier for every surface on the box. That is
// not an approval process, it is an outage with paperwork. Approval is an operator decision that happens
// often and should cost nothing, so it lives in an append-only file the operator can read and grep.
//
// ⭐ A GATE SUBJECT IS A BROWSER, NOT A PERSON — SO APPROVAL CANNOT BIND TO ONE DIRECTLY.
// The age gate keys on an opaque random cookie id. It is deliberately not an identity: clear the cookie
// and it is gone. So the operator approves a HANDLE and gets a one-time CLAIM CODE; the person visits the
// claim link in their own browser and that binds their current subject to the handle. Re-approving issues
// a fresh code, which is how a producer moves to a new device without the operator learning anything about
// either one.
//
// ⭐ A CLAIM CODE IS SINGLE-USE AND EXPIRES.
// Otherwise a code in a chat log is a permanent key to the publishing door. Used once, it is spent; after
// the window it is dead; and neither state is recoverable, only re-approvable.
//
// ⭐ WHAT IS NOT IN HERE.
// No name, no address, no document, no date of birth. A handle the operator chose and a hashed subject.
// The § 2257 records are the custodian's file and are not this web tier's business — see /compliance.
//
// House style: ESM, append-only JSONL, injectable IO and clock, soft-fail-never-throw.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export const CLAIM_TTL_MS = 7 * 24 * 3600 * 1000;   // a week to claim, then re-approve
export const storePath = (env = process.env) =>
  String(env.YONI_PRODUCERS_FILE || '/var/lib/yoni/producers.jsonl');

let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }
function io() {
  return _io || {
    read: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } },
    append: (p, line) => {
      try { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
        fs.appendFileSync(p, line, { mode: 0o600 }); return true; } catch { return false; }
    },
  };
}

const now = (o) => (o && typeof o.now === 'function' ? o.now() : Date.now());
const str = (s, n = 120) => String(s == null ? '' : s).trim().slice(0, n);
/** Subjects are hashed before storage: the file is a list of who may publish, not a list of cookies. */
export const hashSubject = (s) => createHash('sha256').update(`yoni:${str(s, 200)}`).digest('hex').slice(0, 32);
const normHandle = (h) => str(h, 60).toLowerCase().replace(/[^a-z0-9._-]/g, '');

function lines(opts) {
  const out = [];
  for (const l of String(io().read(opts.path || storePath(opts.env)) || '').split('\n')) {
    const t = l.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* torn line */ }
  }
  return out;
}

function write(rec, opts) {
  return io().append(opts.path || storePath(opts.env), `${JSON.stringify(rec)}\n`);
}

/**
 * Fold the log into current state: { handles: Map<handle, {claimed, subjects:Set}>, codes: Map<code, {handle, exp}> }
 * Later lines win. A revoke kills the handle and every subject bound to it.
 */
export function state(opts = {}) {
  const handles = new Map();
  const codes = new Map();
  for (const r of lines(opts)) {
    const h = normHandle(r.handle);
    if (!h) continue;
    if (r.op === 'approve') {
      if (!handles.has(h)) handles.set(h, { handle: h, subjects: new Set(), revoked: false });
      handles.get(h).revoked = false;
      if (r.code) codes.set(str(r.code, 64), { handle: h, exp: +r.exp || 0 });
    } else if (r.op === 'claim') {
      const e = handles.get(h);
      if (e && !e.revoked && r.subject) e.subjects.add(str(r.subject, 64));
      if (r.code) codes.delete(str(r.code, 64));
    } else if (r.op === 'revoke') {
      const e = handles.get(h);
      if (e) { e.revoked = true; e.subjects.clear(); }
      for (const [c, v] of codes) if (v.handle === h) codes.delete(c);
    }
  }
  return { handles, codes };
}

/** Operator action: approve a handle and mint a single-use claim code. */
export function approve(handle, opts = {}) {
  const h = normHandle(handle);
  if (!h) return { ok: false, reason: 'a handle is required' };
  const code = randomBytes(16).toString('hex');
  const exp = now(opts) + (+opts.ttlMs || CLAIM_TTL_MS);
  if (!write({ op: 'approve', handle: h, code, exp, at: now(opts) }, opts)) {
    return { ok: false, reason: 'could not write the approval' };
  }
  return { ok: true, handle: h, code, expiresAt: exp };
}

/** The person binds their own browser to the handle. Single use; expired codes are dead. */
export function claim(code, subject, opts = {}) {
  const c = str(code, 64);
  const s = str(subject, 200);
  if (!c || !s) return { ok: false, reason: 'a code and a subject are both required' };
  const { codes } = state(opts);
  const found = codes.get(c);
  if (!found) return { ok: false, reason: 'that code is not valid — it may already have been used' };
  if (found.exp && found.exp <= now(opts)) return { ok: false, reason: 'that code has expired — ask for a new one' };
  const hashed = hashSubject(s);
  if (!write({ op: 'claim', handle: found.handle, subject: hashed, code: c, at: now(opts) }, opts)) {
    return { ok: false, reason: 'could not record the claim' };
  }
  return { ok: true, handle: found.handle };
}

/** Operator action: revoke a handle and every browser bound to it. */
export function revoke(handle, opts = {}) {
  const h = normHandle(handle);
  if (!h) return { ok: false, reason: 'a handle is required' };
  return write({ op: 'revoke', handle: h, at: now(opts) }, opts)
    ? { ok: true, handle: h } : { ok: false, reason: 'could not write the revocation' };
}

/** May this subject publish? Falls back to the bootstrap env allowlist so a first producer can exist. */
export function isProducer(subject, opts = {}) {
  const s = str(subject, 200);
  if (!s) return false;
  const boot = String((opts.env || process.env).YONI_PRODUCERS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (boot.includes(s.toLowerCase())) return true;
  const hashed = hashSubject(s);
  for (const e of state(opts).handles.values()) {
    if (!e.revoked && e.subjects.has(hashed)) return true;
  }
  return false;
}

/** Which handle is this subject, if any. For showing "publishing as …" rather than for authorising. */
export function handleFor(subject, opts = {}) {
  const hashed = hashSubject(str(subject, 200));
  for (const e of state(opts).handles.values()) {
    if (!e.revoked && e.subjects.has(hashed)) return e.handle;
  }
  return null;
}

/** Operator view: handles, whether claimed, how many browsers, and whether revoked. */
export function listProducers(opts = {}) {
  return [...state(opts).handles.values()]
    .map((e) => ({ handle: e.handle, revoked: e.revoked, devices: e.subjects.size }))
    .sort((a, b) => a.handle.localeCompare(b.handle));
}
