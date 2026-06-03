// admin-auth.mjs — auth for the single-admin operator portal.
//
// The operator logs in with HIS Gmail, two ways:
//   (1) email magic-link  — generate a signed, expiring, single-use token mailed to an email,
//                           then verify it (verifyMagicLink).
//   (2) Google OIDC       — "Login with Google"; we verify an already-validated id-token's
//                           email claim (verifyGoogleLogin). The Google OAuth client id/secret
//                           come from the credential vault (Vaultwarden), NEVER hardcoded here.
//
// TWO-EMAIL ALLOWLIST (task #207):
//   - PRIMARY  (process.env.ADMIN_EMAIL)        — the ONLY full-access identity. Logs in and
//                                                  operates the portal exactly as before.
//   - BACKUP   (process.env.ADMIN_BACKUP_EMAIL) — an OPTIONAL recovery identity. It can start a
//                                                  login and hold a role:'backup' session, but that
//                                                  session may ONLY be used to recover primary
//                                                  access (startRecovery → fresh primary magic link).
//                                                  It can NEVER operate the portal as admin.
// Everyone else is rejected — even when they present a perfectly valid id-token for some other email.
//
// Sessions are signed with HMAC (node:crypto), secret from env. All crypto is PURE and the
// providers (clock, mailer, token id, single-use store) are injectable, so the tests run fully
// offline with no live network.
//
// SECURITY: tokens and secrets are NEVER logged or printed. We only ever surface booleans,
// the admin email, and opaque error reasons.
//
//   import { startEmailLogin, verifyMagicLink, verifyGoogleLogin, verifyOAuthLogin,
//            createSession, verifySession, revokeSession, requireAdmin, startRecovery,
//            adminEmail, backupEmail, roleFor } from './admin-auth.mjs'
//   node integrations/admin-auth.mjs --whoami        # print configured admin (not the secret)

import crypto from 'node:crypto';

// ── config / secrets (env only; never hardcoded) ────────────────────────────────
// Google OAuth client id/secret are pulled from the credential vault at the call site that
// validates the raw id-token upstream — they are intentionally absent from this file.

export function adminEmail() {
  return normEmail(process.env.ADMIN_EMAIL || '');
}

// Optional backup/recovery identity. Empty when unset — backup features are then simply inert.
export function backupEmail() {
  return normEmail(process.env.ADMIN_BACKUP_EMAIL || '');
}

// Classify an email against the allowlist: 'primary' | 'backup' | null.
// Primary wins if (mis)configured to the same address — there is never a backup-only path to operate.
export function roleFor(email) {
  const e = normEmail(email);
  if (!e) return null;
  if (adminEmail() && e === adminEmail()) return 'primary';
  if (backupEmail() && e === backupEmail()) return 'backup';
  return null;
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

// Begin email login. Both the PRIMARY admin and the optional BACKUP email may be issued a link;
// any other address returns { ok: false } WITHOUT generating a token (no enumeration is attempted
// beyond the allowlist — this is a one-operator portal). The link carries the email's role, so the
// session minted from it is full-access for the primary and recovery-only for the backup.
export async function startEmailLogin(email, { ttlMs = MAGIC_TTL_MS } = {}) {
  const e = normEmail(email);
  const admin = adminEmail();
  if (!admin) return { ok: false, reason: 'admin-not-configured' };
  const role = roleFor(e);
  if (!role) return { ok: false, reason: 'not-admin' };

  const now = providers.now();
  const payload = {
    e,
    role,
    jti: providers.randomId(),
    exp: now + ttlMs,
    typ: 'magic',
  };
  const token = makeToken(payload, 'magic');
  // Deliver out of band. We pass the token to the mailer only; we never log it.
  let delivered = { delivered: false, email: e };
  try { delivered = (await providers.sendMail({ email: e, token })) || delivered; } catch { /* mailer failure is non-fatal to issuance */ }
  return { ok: true, email: e, role, token, expiresAt: payload.exp, delivered };
}

// Verify a magic link: signature + not expired + on the allowlist + single-use (jti not yet consumed).
// Returns the email's role so the caller mints a primary or backup session accordingly. Links issued
// before roles existed (no payload role) are treated as primary, preserving old behavior.
export function verifyMagicLink(token, { consume = true } = {}) {
  const r = readToken(token, 'magic');
  if (!r.ok) return { ok: false, reason: r.reason };
  const p = r.payload;
  if (p.typ !== 'magic') return { ok: false, reason: 'wrong-type' };
  const role = roleFor(p.e);
  if (!role) return { ok: false, reason: 'not-admin' };
  if (!p.exp || providers.now() > p.exp) return { ok: false, reason: 'expired' };
  if (!p.jti) return { ok: false, reason: 'malformed' };
  if (providers.usedStore.has(p.jti)) return { ok: false, reason: 'already-used' };
  // consume:false = peek (validate without burning the single-use jti). The
  // portal uses this for the GET that link-preview bots (Telegram, Slack,
  // iMessage…) fire automatically — only the human's explicit POST consumes.
  if (consume) providers.usedStore.add(p.jti); // consume — single use
  return { ok: true, email: p.e, role };
}

// ── Google OIDC login (method 2) ────────────────────────────────────────────────
// The raw id-token must already be cryptographically verified upstream (audience = our Google
// OAuth client id from the vault, issuer = accounts.google.com, signature against Google's JWKS).
// Here we enforce the PORTAL policy on the trusted claims: email present, email_verified, and the
// single-admin lock. We accept either a decoded claims object or a { ...claims } payload.
// Generalized OAuth/OIDC verifier (Google, Yahoo, …). The raw id-token must already be
// cryptographically verified upstream (audience/issuer/signature) by the provider's own validator —
// Yahoo's lives in ifttt-connect, NOT here. We enforce only the PORTAL policy on the trusted claims:
// email present, email_verified (when supplied), and the two-email allowlist. Primary gets full
// access; backup gets a recovery-only session (role:'backup').
export function verifyOAuthLogin(claims) {
  const c = claims || {};
  const email = normEmail(c.email);
  if (!email) return { ok: false, reason: 'no-email' };
  // Providers set email_verified; require it when present, but don't hard-fail if a verifier omits it.
  if (c.email_verified === false) return { ok: false, reason: 'email-unverified' };
  const admin = adminEmail();
  if (!admin) return { ok: false, reason: 'admin-not-configured' };
  const role = roleFor(email);
  if (!role) return { ok: false, reason: 'not-admin' };
  return { ok: true, email, role };
}

// Google OIDC login (method 2). Thin wrapper over verifyOAuthLogin preserved for the existing
// route wiring and tests — same shape, same single-admin behavior for the primary.
export function verifyGoogleLogin(idTokenClaims) {
  return verifyOAuthLogin(idTokenClaims);
}

// ── sessions ────────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Create a signed session token for an email on the allowlist. The session carries the email's role:
// 'primary' (full access) or 'backup' (recovery-only). Strangers are refused. An explicit
// { role } may be passed but is ALWAYS reconciled against the allowlist — you can never mint a
// primary session for a backup email.
export function createSession(email, { ttlMs = SESSION_TTL_MS } = {}) {
  const e = normEmail(email);
  const admin = adminEmail();
  if (!admin) return { ok: false, reason: 'not-admin' };
  const role = roleFor(e);
  if (!role) return { ok: false, reason: 'not-admin' };
  const now = providers.now();
  const payload = { e, role, sid: providers.randomId(), iat: now, exp: now + ttlMs, typ: 'session' };
  return { ok: true, email: e, role, token: makeToken(payload, 'session'), expiresAt: payload.exp };
}

// Verify a session token: signature + not expired + on the allowlist + not revoked.
// Returns the role. Sessions minted before roles existed (no payload role) are treated as primary,
// preserving old behavior for any token already in flight.
export function verifySession(token) {
  const r = readToken(token, 'session');
  if (!r.ok) return { ok: false, reason: r.reason };
  const p = r.payload;
  if (p.typ !== 'session') return { ok: false, reason: 'wrong-type' };
  const role = roleFor(p.e) || (normEmail(p.e) === adminEmail() && adminEmail() ? 'primary' : null);
  if (!role) return { ok: false, reason: 'not-admin' };
  if (!p.exp || providers.now() > p.exp) return { ok: false, reason: 'expired' };
  if (!p.sid) return { ok: false, reason: 'malformed' };
  if (_revoked.has(p.sid)) return { ok: false, reason: 'revoked' };
  return { ok: true, email: p.e, sid: p.sid, role };
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
// Returns { ok, email, role } on success; on failure { ok:false, reason } — caller sends 401/redirect.
//
// By default ONLY a primary session passes — a backup (recovery) session is rejected with
// reason:'backup-recovery-only' so it can never operate the portal. The recovery route, and ONLY
// that route, opts in with requireAdmin(req, { allowBackup: true }) to accept a backup session.
export function requireAdmin(req, { allowBackup = false } = {}) {
  const token = sessionTokenFromRequest(req);
  if (!token) return { ok: false, reason: 'no-session' };
  const v = verifySession(token);
  if (!v.ok) return v;
  if (v.role === 'backup' && !allowBackup) {
    return { ok: false, reason: 'backup-recovery-only' };
  }
  return v;
}

// ── recovery flow ─────────────────────────────────────────────────────────────────
// The point of the backup identity: regain PRIMARY access, NOT operate as admin. A holder of a
// valid backup session calls this to mail a FRESH single-use magic link to the PRIMARY email.
// The backup never receives the primary's link and never gets a primary session here.
//
// Accepts a request-like object (uses the same session extraction as requireAdmin). The session
// MUST be a backup session — a primary session is told to just log in normally, and anything else
// is refused.
export async function startRecovery(req, { ttlMs = MAGIC_TTL_MS } = {}) {
  const token = sessionTokenFromRequest(req);
  if (!token) return { ok: false, reason: 'no-session' };
  const v = verifySession(token);
  if (!v.ok) return v;
  if (v.role !== 'backup') return { ok: false, reason: 'not-backup' };
  const admin = adminEmail();
  if (!admin) return { ok: false, reason: 'admin-not-configured' };

  // Issue a primary magic link — same single-use, signed, expiring token, delivered to the PRIMARY.
  const now = providers.now();
  const payload = { e: admin, role: 'primary', jti: providers.randomId(), exp: now + ttlMs, typ: 'magic' };
  const linkToken = makeToken(payload, 'magic');
  let delivered = { delivered: false, email: admin };
  try { delivered = (await providers.sendMail({ email: admin, token: linkToken })) || delivered; } catch { /* non-fatal to issuance */ }
  // recoveredFor = the primary the link was sent to; token returned for wiring/tests, never logged.
  return { ok: true, recoveredFor: admin, token: linkToken, expiresAt: payload.exp, delivered };
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
    const b = backupEmail();
    console.log(a ? `configured admin (primary): ${a}` : 'ADMIN_EMAIL not set');
    console.log(b ? `configured backup (recovery-only): ${b}` : 'ADMIN_BACKUP_EMAIL not set (backup/recovery disabled)');
    console.log(`session secret: ${process.env.ADMIN_AUTH_SECRET ? 'configured' : 'EPHEMERAL DEV SECRET (set ADMIN_AUTH_SECRET)'}`);
  } else {
    console.log('usage: node integrations/admin-auth.mjs [--whoami]');
  }
}
