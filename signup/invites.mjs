// invites.mjs — the account-level INVITE-WALL for MELEK signup.
//
// MODEL (operator)
//   MELEK accounts are INVITE-ONLY. There is one configurable ROOT account (default `hathor`) that can
//   invite anyone, UNLIMITED. Every normal account is born with INVITES_PER_ACCOUNT (default 10) invites
//   to give out. When someone redeems an invite to create THEIR account, that new account ALSO receives a
//   fresh INVITES_PER_ACCOUNT to give out — the wall propagates outward, one bounded fan-out per person.
//   Signup REQUIRES a valid, unused invite code; the signup flow calls requireInvite()/canRedeem() as the
//   gate before it creates the chain account, then redeemInvite() once the account exists.
//
//   The store also records the invite TREE (who invited whom) so lineage() can chain any account back to
//   root — the social provenance of every account on the chain.
//
// PERSISTENCE
//   One JSON file (injectable fs {read,write}; default path from INVITES_DATA), the move-ledger/pentecaust
//   idiom: pure-ish helpers, soft-fail-never-throw (return { ok:false, reason } — never throws at the API),
//   fully offline-testable. No keys, no chain writes here — this is the off-chain gate the signup reads.
//
//   import { issueInvite, redeemInvite, invitesFor, requireInvite, canRedeem, lineage } from './invites.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validAccountName } from './welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const DATA_FILE = () => env('INVITES_DATA', join(process.cwd(), 'data', 'invites.json'));
// How many invites every NORMAL account is born with (root is unlimited and ignores this).
export const INVITES_PER_ACCOUNT = Number(env('INVITES_PER_ACCOUNT', '10')) || 10;
// The unlimited ROOT account — the operator/Witness. Configurable; falls back to the Witness account.
export const ROOT = String(env('MELEK_ROOT', '') || env('HATHOR_ACCOUNT', '') || 'hathor').toLowerCase();

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());

// ── injectable fs + store (same shape discipline as move-ledger / pentecaust) ───────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { accounts: {}, codes: {} };
  try {
    const o = JSON.parse(raw);
    return o && o.accounts && o.codes ? o : { accounts: {}, codes: {} };
  } catch { return { accounts: {}, codes: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
const isRoot = (account) => account === ROOT;

// A URL-safe single-use code, ~11 chars from 8 random bytes (base64url, no padding).
function genCode() {
  return randomBytes(8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function uniqueCode(store) {
  for (let i = 0; i < 1000; i++) { const c = genCode(); if (!store.codes[c]) return c; }
  return `${genCode()}-${Date.now()}`; // astronomically unreachable fallback
}

// Ensure an account record exists. Root is auto-registered with unlimited quota on first touch.
function ensureAccount(store, account, opts = {}) {
  let rec = store.accounts[account];
  if (rec) return rec;
  rec = isRoot(account)
    ? { registered: true, unlimited: true, remaining: Infinity, invitedBy: null, issued: [], redeemed: [], created: now(opts) }
    : { registered: false, unlimited: false, remaining: 0, invitedBy: null, issued: [], redeemed: [], created: now(opts) };
  store.accounts[account] = rec;
  return rec;
}

// Public, store-free view of an account's standing (safe to hand to a client).
export function viewAccount(account, rec) {
  if (!rec) return { account, registered: false, remaining: 0, issued: 0, redeemed: 0, invitedBy: null, unlimited: false };
  return {
    account,
    registered: !!rec.registered,
    unlimited: !!rec.unlimited,
    remaining: rec.unlimited ? Infinity : Number(rec.remaining) || 0,
    issued: (rec.issued || []).length,
    redeemed: (rec.redeemed || []).length,
    invitedBy: rec.invitedBy || null,
  };
}

// ── operations ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Issue ONE single-use invite code from `inviter`, if they have quota left.
 *   - ROOT: unlimited; issuing never decrements.
 *   - normal registered account: must have remaining > 0; issuing decrements by one.
 *   - unknown / unregistered / over-quota inviter: rejected.
 * @returns {{ ok:true, code, inviter, remaining } | { ok:false, reason }}
 */
export function issueInvite(inviter, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(inviter || '').toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'inviter must be a valid MELEK account name' };

  const store = loadStore(fs, file);
  // Root self-registers on first use; everyone else must already be a registered (redeemed) account.
  const rec = isRoot(who) ? ensureAccount(store, who, opts) : store.accounts[who];
  if (!rec || !rec.registered) return { ok: false, reason: 'unknown or unregistered inviter' };
  if (!rec.unlimited && (Number(rec.remaining) || 0) <= 0) return { ok: false, reason: 'no invites remaining' };

  const code = uniqueCode(store);
  store.codes[code] = { inviter: who, created: now(opts), redeemedBy: null, redeemedAt: null };
  rec.issued = rec.issued || [];
  rec.issued.push(code);
  if (!rec.unlimited) rec.remaining = (Number(rec.remaining) || 0) - 1;
  saveStore(fs, file, store);
  return { ok: true, code, inviter: who, remaining: rec.unlimited ? Infinity : rec.remaining };
}

/**
 * Check whether a code is valid and still unused — the GATE signup calls BEFORE creating the account.
 * Read-only; never mutates. canRedeem() is an alias.
 * @returns {{ ok:true, code, inviter } | { ok:false, reason }}
 */
export function requireInvite(code, opts = {}) {
  const { fs, file } = ctx(opts);
  const c = String(code || '');
  if (!c) return { ok: false, reason: 'no invite code' };
  const store = loadStore(fs, file);
  const rec = store.codes[c];
  if (!rec) return { ok: false, reason: 'unknown invite code' };
  if (rec.redeemedBy) return { ok: false, reason: 'invite code already used' };
  return { ok: true, code: c, inviter: rec.inviter };
}
export const canRedeem = requireInvite;

/**
 * Redeem an UNUSED code to register `newAccount`:
 *   - validate the code (unused) and the account name (valid, not already registered),
 *   - mark the code consumed (single-use),
 *   - record the tree edge inviter -> newAccount,
 *   - grant newAccount a fresh INVITES_PER_ACCOUNT quota and mark it registered.
 * @returns {{ ok:true, account, invitedBy, granted } | { ok:false, reason }}
 */
export function redeemInvite(code, newAccount, opts = {}) {
  const { fs, file } = ctx(opts);
  const c = String(code || '');
  const account = String(newAccount || '').toLowerCase();
  if (!validAccountName(account)) return { ok: false, reason: 'account must be a valid MELEK account name' };

  const store = loadStore(fs, file);
  const codeRec = store.codes[c];
  if (!codeRec) return { ok: false, reason: 'unknown invite code' };
  if (codeRec.redeemedBy) return { ok: false, reason: 'invite code already used' };

  const existing = store.accounts[account];
  if (existing && existing.registered) return { ok: false, reason: 'account already registered' };

  const t = now(opts);
  // consume the code (single-use)
  codeRec.redeemedBy = account;
  codeRec.redeemedAt = t;

  // record on the inviter's side (they exist — they issued the code)
  const inviterRec = ensureAccount(store, codeRec.inviter, opts);
  inviterRec.redeemed = inviterRec.redeemed || [];
  if (!inviterRec.redeemed.includes(account)) inviterRec.redeemed.push(account);

  // register the new account with a fresh quota and its lineage edge
  const granted = INVITES_PER_ACCOUNT;
  const rec = ensureAccount(store, account, opts);
  rec.registered = true;
  rec.unlimited = isRoot(account) ? true : rec.unlimited;
  rec.remaining = rec.unlimited ? Infinity : granted;
  rec.invitedBy = codeRec.inviter;

  saveStore(fs, file, store);
  return { ok: true, account, invitedBy: codeRec.inviter, granted: rec.unlimited ? Infinity : granted };
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────
/** An account's standing: remaining quota, codes issued, accounts redeemed, who invited them. */
export function invitesFor(account, opts = {}) {
  const { fs, file } = ctx(opts);
  const who = String(account || '').toLowerCase();
  const store = loadStore(fs, file);
  return viewAccount(who, store.accounts[who]);
}

/**
 * The invite chain from `account` UP to root: [account, invitedBy, ..., root].
 * Returns the names in order. Cycle-guarded; stops at root or an account with no inviter.
 */
export function lineage(account, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const chain = [];
  const seen = new Set();
  let who = String(account || '').toLowerCase();
  while (who && !seen.has(who)) {
    seen.add(who);
    chain.push(who);
    if (isRoot(who)) break;
    const rec = store.accounts[who];
    if (!rec || !rec.invitedBy) break;
    who = rec.invitedBy;
  }
  return chain;
}

// ── identity (the trust boundary) ───────────────────────────────────────────────────────────────────
// The acting account is resolved from a VERIFIED source, never a spoofable query/body field — otherwise
// anyone issues invites AS anyone (auth bypass). Production injects a verifier (MELEK-Signer bearer /
// session → certified account); identity DENIES by default (401). INVITES_DEV_TRUST=1 (local dev / tests
// ONLY, never a public origin) trusts an asserted `x-melek-account` header so the gate is testable.
let _verifyAuth = null;
export function __setAuthVerifier(fn) { _verifyAuth = typeof fn === 'function' ? fn : null; }
const DEV_TRUST = () => env('INVITES_DEV_TRUST', '') === '1';
function whoami(req) {
  if (_verifyAuth) { try { const a = _verifyAuth(req); return a ? String(a).toLowerCase() : null; } catch { return null; } }
  if (DEV_TRUST()) { const h = (req && req.headers) || {}; const a = h['x-melek-account']; return a ? String(a).toLowerCase() : null; }
  return null;
}

// ── HTTP handler (optional; mirrors other modules) — issue / redeem / standing as JSON ──────────────
// Exact-segment routing (no substring/endsWith bypass); mutations are POST + verified-identity only;
// the acting account is whoami(req), NEVER a query field. Read-only code-validity check is public
// (codes are 64-bit-random, unguessable); standing/lineage are scoped to the authenticated account.
export function handler(req, res) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const unauth = () => send(401, { ok: false, reason: 'authentication required (no verified MELEK identity)' });
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(400, { ok: false, reason: 'bad url' }); }
  const q = url.searchParams;
  const seg = url.pathname.replace(/\/+$/, '').split('/').pop();   // exact action segment, not a substring match
  const method = (req.method || 'GET').toUpperCase();

  switch (seg) {
    case 'issue': {                                  // POST — issue AS the verified caller
      if (method !== 'POST') return send(405, { ok: false, reason: 'use POST' });
      const me = whoami(req); if (!me) return unauth();
      return send(200, issueInvite(me));
    }
    case 'redeem': {                                 // POST — register the verified caller's account via a code
      if (method !== 'POST') return send(405, { ok: false, reason: 'use POST' });
      const me = whoami(req); if (!me) return unauth();
      return send(200, redeemInvite(q.get('code'), me));
    }
    case 'check':                                    // GET — public code-validity check (codes are unguessable)
      return send(200, requireInvite(q.get('code')));
    case 'standing': {                               // GET — your own standing (or root may view any)
      const me = whoami(req); if (!me) return unauth();
      const target = q.get('account') ? String(q.get('account')).toLowerCase() : me;
      if (target !== me && !isRoot(me)) return send(403, { ok: false, reason: 'forbidden' });
      return send(200, invitesFor(target));
    }
    case 'lineage': {                                // GET — your own lineage (or root may view any)
      const me = whoami(req); if (!me) return unauth();
      const target = q.get('account') ? String(q.get('account')).toLowerCase() : me;
      if (target !== me && !isRoot(me)) return send(403, { ok: false, reason: 'forbidden' });
      return send(200, { account: target, chain: lineage(target) });
    }
    default:
      return send(404, { ok: false, reason: 'unknown endpoint' });
  }
}

// ── CLI (guarded) — offline demo on a temp store ────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('invites.mjs')) {
  const file = `/tmp/invites-demo-${process.pid}.json`;
  const o = { file };
  console.log(`MELEK invite-wall — offline demo (root=${ROOT}, ${INVITES_PER_ACCOUNT}/account):\n`);
  const r1 = issueInvite(ROOT, o);
  console.log('root issues  :', r1.code, `(remaining ${r1.remaining})`);
  const red1 = redeemInvite(r1.code, 'alice', o);
  console.log('alice redeems:', red1.ok, `invitedBy=${red1.invitedBy} granted=${red1.granted}`);
  const r2 = issueInvite('alice', o);
  console.log('alice issues :', r2.code, `(remaining ${r2.remaining})`);
  const red2 = redeemInvite(r2.code, 'bob-jones', o);
  console.log('bob redeems  :', red2.ok, `invitedBy=${red2.invitedBy}`);
  console.log('standing(bob):', JSON.stringify(invitesFor('bob-jones', o)));
  console.log('lineage(bob) :', lineage('bob-jones', o).join(' -> '));
  try { (await import('node:fs')).unlinkSync(file); } catch {}
}
