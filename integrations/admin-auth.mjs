// admin-auth.mjs — auth for the single-admin operator portal.
//
// The operator logs in with HIS Gmail, two ways:
//   (1) email magic-link  — generate a signed, expiring, single-use token mailed to an email,
//                           then verify it (verifyMagicLink).
//   (2) Google OIDC       — "Login with Google"; we verify an already-validated id-token's
//                           email claim (verifyGoogleLogin). The Google OAuth client id/secret
//                           come from the credential vault (Vaultwarden), NEVER hardcoded here.
//
// SINGLE-ADMIN LOCK: only process.env.ADMIN_EMAIL may ever log in. Everyone else is rejected —
//   even when they present a perfectly valid Google id-token for some other Gmail.
//
// Sessions are signed with HMAC (node:crypto), secret from env. All crypto is PURE and the
// providers (clock, mailer, token id, single-use store) are injectable, so the tests run fully
// offline with no live network.
//
// SECURITY: tokens and secrets are NEVER logged or printed. We only ever surface booleans,
// the admin email, and opaque error reasons.
//
//   import { startEmailLogin, verifyMagicLink, verifyGoogleLogin,
//            createSession, verifySession, revokeSession, requireAdmin } from './admin-auth.mjs'
//   node integrations/admin-auth.mjs --whoami        # print configured admin (not the secret)

import crypto from 'node:crypto';

// ── config / secrets (env only; never hardcoded) ────────────────────────────────
// Google OAuth client id/secret are pulled from the credential vault at the call site that
// validates the raw id-token upstream — they are intentionally absent from this file.

export function adminEmail() {
  return normEmail(process.env.ADMIN_EMAIL || '');
}

// Soft-fail dev secret: in production set ADMIN_AUTH_SECRET. With none, we derive a throwaway
// per-process secret and warn ONCE so dev still works but tokens don't survive a restart.
let _warnedSecret = false;
let _devSecret = null;
function authSecret() {
  const s = process.env.ADMIN_AUTH_SECRET;
  if (s && s.length > 0) return s;
  if (!_warnedSecret) {
    console.warn('[admin-auth] ADMIN_AUTH_SECRET not set — using an ephemeral dev secret; tokens will not survive a restart. Set ADMIN_AUTH_SECRET in production.');
    _warnedSecret = true;
  }
  if (!_devSecret) _devSecret = crypto.randomBytes(32).toString('hex');
  return _devSecret;
}

// ── injectable providers (so tests are deterministic & offline) ─────────────────
const defaultProviders = {
  now: () => Date.now(),
  randomId: () => crypto.randomBytes(16).toString('hex'),
  // single-use store: tracks which magic-link jti values have already been consumed.
  // default is an in-memory Set; a real deployment injects a shared/persistent store.
  usedStore: new Set(),
  // mailer: how a magic link is delivered. Default just records the request (no network).
  // It MUST NOT receive or log the raw token beyond what's needed to send it.
  sendMail: async ({ email }) => ({ delivered: false, email }),
};
let providers = { ...defaultProviders };

// Replace some/all providers (used by tests and by the real deployment wiring).
export function __setProviders(p = {}) {
  providers = { ...providers, ...p };
}
export function __resetProviders() {
  providers = { ...defaultProviders, usedStore: new Set() };
}

// ── pure helpers ────────────────────────────────────────────────────────────────
function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function fromB64urlJson(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(norm, 'base64').toString('utf8'));
}

function sign(payloadB64, kind) {
  // domain-separate signatures by token kind so a session token can't be replayed as a magic link
  return b64url(crypto.createHmac('sha256', authSecret()).update(`${kind}.${payloadB64}`).digest());
}

// constant-time compare of two base64url strings
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Build & verify a generic HMAC token: `${payloadB64}.${sig}`.
function makeToken(payload, kind) {
  const body = b64urlJson(payload);
  return `${body}.${sign(body, kind)}`;
}
function readToken(token, kind) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!body || !sig) return { ok: false, reason: 'malformed' };
  if (!safeEqual(sig, sign(body, kind))) return { ok: false, reason: 'bad-signature' };
  let payload;
  try { payload = fromB64urlJson(body); } catch { return { ok: false, reason: 'malformed' }; }
  return { ok: true, payload };
}

// ── magic-link login (method 1) ─────────────────────────────────────────────────
const MAGIC_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Begin email login. Only the admin email is ever issued a link; for any other address we
// return { ok: false } WITHOUT generating a token (no enumeration of who is/isn't admin via timing
// is attempted here beyond the single-admin lock — this is a one-operator portal).
export async function startEmailLogin(email, { ttlMs = MAGIC_TTL_MS } = {}) {
  const e = normEmail(email);
  const admin = adminEmail();
  if (!admin) return { ok: false, reason: 'admin-not-configured' };
  if (e !== admin) return { ok: false, reason: 'not-admin' };

  const now = providers.now();
  const payload = {
    e,
    jti: providers.randomId(),
    exp: now + ttlMs,
    typ: 'magic',
  };
  const token = makeToken(payload, 'magic');
  // Deliver out of band. We pass the token to the mailer only; we never log it.
  let delivered = { delivered: false, email: e };
  try { delivered = (await providers.sendMail({ email: e, token })) || delivered; } catch { /* mailer failure is non-fatal to issuance */ }
  return { ok: true, email: e, token, expiresAt: payload.exp, delivered };
}

// Verify a magic link: signature + not expired + correct admin + single-use (jti not yet consumed).
export function verifyMagicLink(token) {
  const r = readToken(token, 'magic');
  if (!r.ok) return { ok: false, reason: r.reason };
  const p = r.payload;
  if (p.typ !== 'magic') return { ok: false, reason: 'wrong-type' };
  if (normEmail(p.e) !== adminEmail() || !adminEmail()) return { ok: false, reason: 'not-admin' };
  if (!p.exp || providers.now() > p.exp) return { ok: false, reason: 'expired' };
  if (!p.jti) return { ok: false, reason: 'malformed' };
  if (providers.usedStore.has(p.jti)) return { ok: false, reason: 'already-used' };
  providers.usedStore.add(p.jti); // consume — single use
  return { ok: true, email: p.e };
}

// ── Google OIDC login (method 2) ────────────────────────────────────────────────
// The raw id-token must already be cryptographically verified upstream (audience = our Google
// OAuth client id from the vault, issuer = accounts.google.com, signature against Google's JWKS).
// Here we enforce the PORTAL policy on the trusted claims: email present, email_verified, and the
// single-admin lock. We accept either a decoded claims object or a { ...claims } payload.
export function verifyGoogleLogin(idTokenClaims) {
  const c = idTokenClaims || {};
  const email = normEmail(c.email);
  if (!email) return { ok: false, reason: 'no-email' };
  // Google sets email_verified; require it when present, but don't hard-fail if a verifier omits it.
  if (c.email_verified === false) return { ok: false, reason: 'email-unverified' };
  const admin = adminEmail();
  if (!admin) return { ok: false, reason: 'admin-not-configured' };
  if (email !== admin) return { ok: false, reason: 'not-admin' };
  return { ok: true, email };
}

// ── sessions ────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Create a signed session token for an email (must be the admin).
export function createSession(email, { ttlMs = SESSION_TTL_MS } = {}) {
  const e = normEmail(email);
  const admin = adminEmail();
  if (!admin || e !== admin) return { ok: false, reason: 'not-admin' };
  const now = providers.now();
  const payload = { e, sid: providers.randomId(), iat: now, exp: now + ttlMs, typ: 'session' };
  return { ok: true, email: e, token: makeToken(payload, 'session'), expiresAt: payload.exp };
}

// Verify a session token: signature + not expired + admin + not revoked.
export function verifySession(token) {
  const r = readToken(token, 'session');
  if (!r.ok) return { ok: false, reason: r.reason };
  const p = r.payload;
  if (p.typ !== 'session') return { ok: false, reason: 'wrong-type' };
  if (normEmail(p.e) !== adminEmail() || !adminEmail()) return { ok: false, reason: 'not-admin' };
  if (!p.exp || providers.now() > p.exp) return { ok: false, reason: 'expired' };
  if (!p.sid) return { ok: false, reason: 'malformed' };
  if (_revoked.has(p.sid)) return { ok: false, reason: 'revoked' };
  return { ok: true, email: p.e, sid: p.sid };
}

// Revocation list (session ids). In a real deployment this is a shared/persistent store.
const _revoked = new Set();
export function revokeSession(token) {
  const r = readToken(token, 'session');
  if (!r.ok || !r.payload?.sid) return { ok: false, reason: r.reason || 'malformed' };
  _revoked.add(r.payload.sid);
  return { ok: true };
}
export function __resetRevoked() { _revoked.clear(); }

// ── gate helper ─────────────────────────────────────────────────────────────────
// Pull a session token from a request-like object (cookie or Authorization: Bearer) and verify it.
// Returns { ok, email } on success; on failure { ok:false, reason } — caller sends 401/redirect.
export function requireAdmin(req) {
  const token = sessionTokenFromRequest(req);
  if (!token) return { ok: false, reason: 'no-session' };
  return verifySession(token);
}

function sessionTokenFromRequest(req) {
  if (!req) return null;
  // Authorization: Bearer <token>
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  // Cookie: admin_session=<token>
  const cookie = req.headers?.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === 'admin_session') return decodeURIComponent(v.join('='));
    }
  }
  // direct fields some frameworks expose
  if (typeof req.sessionToken === 'string') return req.sessionToken;
  if (req.cookies && typeof req.cookies.admin_session === 'string') return req.cookies.admin_session;
  return null;
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('admin-auth.mjs')) {
  const arg = process.argv[2] || '--whoami';
  if (arg === '--whoami') {
    const a = adminEmail();
    console.log(a ? `configured admin: ${a}` : 'ADMIN_EMAIL not set');
    console.log(`session secret: ${process.env.ADMIN_AUTH_SECRET ? 'configured' : 'EPHEMERAL DEV SECRET (set ADMIN_AUTH_SECRET)'}`);
  } else {
    console.log('usage: node integrations/admin-auth.mjs [--whoami]');
  }
}
