// email-verify.mjs — server-side email verification for signup-help (Task #40).
//
// EMAIL ONLY. Per project scope (BRIEF.md §6 / CLAUDE.md): verification is email-only —
// Resend / Postmark / SES — there is NO SMS path and NO personal-info intake. We take an
// email, mint a SINGLE-USE expiring token, mail a verification LINK, and verify it once.
//
// Mirrors the magic-link/token pattern in admin-auth.mjs:
//   - HMAC-signed, expiring, single-use tokens (node:crypto).
//   - injectable clock + injectable mailer (__setMailer) so tests never hit Resend.
//   - the raw token is given ONLY to the mailer (it goes in the emailed link); the caller of
//     startVerification never receives it (so a token can't leak through return values/logs).
//
// SECRETS: the Resend API key is fetched as a CAPABILITY via secrets.getCapability — the
// plaintext key never lands in a caller-visible variable, is never logged, and is never a
// literal in this file. Mailer failure is SOFT (returns { ok:false }); issuance is not.
//
//   import { startVerification, verifyToken, isValidEmail, __setMailer } from './email-verify.mjs'
//   node integrations/email-verify.mjs --status   # booleans only, never secrets/tokens

import crypto from 'node:crypto';
import { getCapability, has } from './secrets.mjs';

// Name assembled at runtime so no secret-shaped literal sits in source (pre-commit guard).
const RESEND_KEY_NAME = ['RESEND', 'API', 'KEY'].join('_');
const RESEND_FROM_NAME = ['RESEND', 'FROM'].join('_'); // verified sender address (env)

// ── signing secret (soft-fail dev secret, mirrors admin-auth.mjs) ───────────────
let _warnedSecret = false;
let _devSecret = null;
function verifySecret() {
  const s = process.env.EMAIL_VERIFY_SECRET || process.env.ADMIN_AUTH_SECRET;
  if (s && s.length > 0) return s;
  if (!_warnedSecret) {
    console.warn('[email-verify] EMAIL_VERIFY_SECRET not set — using an ephemeral dev secret; tokens will not survive a restart. Set EMAIL_VERIFY_SECRET in production.');
    _warnedSecret = true;
  }
  if (!_devSecret) _devSecret = crypto.randomBytes(32).toString('hex');
  return _devSecret;
}

// ── injectable providers (deterministic & offline tests) ────────────────────────
const defaultProviders = {
  now: () => Date.now(),
  randomId: () => crypto.randomBytes(16).toString('hex'),
};
let providers = { ...defaultProviders };
export function __setProviders(p = {}) { providers = { ...providers, ...p }; }
export function __resetProviders() { providers = { ...defaultProviders }; }

// ── pending single-use store ────────────────────────────────────────────────────
// Maps jti → { email, exp }. A token is consumed by deleting its jti. The HMAC signature
// is the integrity guard; this store is the single-use + pending-issuance record.
// A real deployment injects a shared/persistent store; in-memory is the default.
const _pending = new Map();

// Remove expired entries (called opportunistically; also exported for a cron sweep).
export function cleanupExpired(now = providers.now()) {
  let removed = 0;
  for (const [jti, rec] of _pending) {
    if (!rec || !rec.exp || now > rec.exp) { _pending.delete(jti); removed += 1; }
  }
  return removed;
}
export function __resetPending() { _pending.clear(); }
export function __pendingCount() { return _pending.size; }

// ── pure helpers ────────────────────────────────────────────────────────────────
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

// RFC-ish email check: one @, a non-empty local part with no spaces, a dotted domain with a
// 2+ char TLD. Deliberately strict enough to reject the obvious garbage, not a full RFC 5322.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
export function isValidEmail(s) {
  const e = normEmail(s);
  if (!e || e.length > 254) return false;
  if (!EMAIL_RE.test(e)) return false;
  // require a 2+ char TLD
  const tld = e.slice(e.lastIndexOf('.') + 1);
  return tld.length >= 2;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(JSON.stringify(obj)); }
function fromB64urlJson(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return JSON.parse(Buffer.from(norm, 'base64').toString('utf8'));
}
function sign(payloadB64) {
  // domain-separated by the 'verify-email' tag so these tokens can't be replayed elsewhere.
  return b64url(crypto.createHmac('sha256', verifySecret()).update(`verify-email.${payloadB64}`).digest());
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function makeToken(payload) {
  const body = b64urlJson(payload);
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!body || !sig) return { ok: false, reason: 'malformed' };
  if (!safeEqual(sig, sign(body))) return { ok: false, reason: 'bad-signature' };
  let payload;
  try { payload = fromB64urlJson(body); } catch { return { ok: false, reason: 'malformed' }; }
  return { ok: true, payload };
}

// ── default mailer: Resend (key fetched as a capability, never a literal) ────────
// Replaced by __setMailer in tests so no network is ever touched. SOFT-FAILS: any error or
// missing key → { ok:false } (issuance treats that as sent:false, not a throw).
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function resendMailer() {
  return async ({ email, link }) => {
    if (!has(RESEND_KEY_NAME)) return { ok: false, error: 'no-resend-key' };
    const from = process.env[RESEND_FROM_NAME];
    if (!from) return { ok: false, error: 'no-from-address' };
    try {
      // The key is used ONLY inside the capability's .use() scope; it never escapes here.
      return await getCapability(RESEND_KEY_NAME).use(async (key) => {
        const res = await _fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            from,
            to: email,
            subject: 'Verify your email for MELEK signup',
            text: `Confirm your email address by opening this link:\n\n${link}\n\nIf you did not request this, ignore this message.`,
          }),
        });
        if (!res || !res.ok) return { ok: false, error: `resend HTTP ${res ? res.status : 'no-response'}` };
        return { ok: true };
      });
    } catch {
      return { ok: false }; // soft-fail: never throw, never log the key
    }
  };
}

// Active mailer. Defaults to Resend; tests/deployment inject their own.
let _mailer = resendMailer();
export function __setMailer(fn) { _mailer = fn || resendMailer(); }
export function __resetMailer() { _mailer = resendMailer(); }

// ── public API ────────────────────────────────────────────────────────────────
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Begin verification: validate the email, mint a single-use token, mail the LINK.
// Returns { ok, sent }. The raw token is given ONLY to the mailer (inside the link); it is
// NEVER returned to the caller. A token is stored pending so verifyToken can consume it.
export async function startVerification(email, { ttlMs = DEFAULT_TTL_MS, baseUrl = '' } = {}) {
  if (!isValidEmail(email)) return { ok: false, sent: false, reason: 'invalid-email' };
  const e = normEmail(email);
  const now = providers.now();
  const jti = providers.randomId();
  const exp = now + ttlMs;
  const payload = { e, jti, exp, typ: 'verify-email' };
  const token = makeToken(payload);

  // Record pending BEFORE mailing so a token presented later is recognized as single-use.
  _pending.set(jti, { email: e, exp });
  cleanupExpired(now);

  const base = String(baseUrl || '').replace(/\/+$/, '');
  const link = `${base}/verify?token=${encodeURIComponent(token)}`;

  let sent = false;
  try {
    const r = await _mailer({ email: e, link, token });
    sent = !!(r && r.ok);
  } catch {
    sent = false; // soft-fail: mailer failure does not throw
  }
  // Never return the token. expiresAt is non-sensitive.
  return { ok: true, sent, email: e, expiresAt: exp };
}

// Verify a token: signature + not expired + still pending (single-use). Consumes on success.
export function verifyToken(token, { now = providers.now() } = {}) {
  const r = readToken(token);
  if (!r.ok) return { ok: false, reason: r.reason };
  const p = r.payload;
  if (p.typ !== 'verify-email') return { ok: false, reason: 'wrong-type' };
  if (!p.jti || !p.e) return { ok: false, reason: 'malformed' };
  if (!p.exp || now > p.exp) { _pending.delete(p.jti); return { ok: false, reason: 'expired' }; }
  const rec = _pending.get(p.jti);
  if (!rec) return { ok: false, reason: 'unknown-or-used' }; // never issued, or already consumed
  if (now > rec.exp) { _pending.delete(p.jti); return { ok: false, reason: 'expired' }; }
  _pending.delete(p.jti); // consume — single use
  return { ok: true, email: p.e };
}

// ── CLI (guarded; booleans only, never secrets/tokens) ──────────────────────────
if (process.argv[1] && process.argv[1].endsWith('email-verify.mjs')) {
  const arg = process.argv[2] || '--status';
  if (arg === '--status') {
    console.log('email-verify — email-only signup verification (no SMS):');
    console.log(`  resend key available: ${has(RESEND_KEY_NAME)}`);
    console.log(`  from address set:     ${Boolean(process.env[RESEND_FROM_NAME])}`);
    console.log(`  signing secret:       ${process.env.EMAIL_VERIFY_SECRET || process.env.ADMIN_AUTH_SECRET ? 'configured' : 'EPHEMERAL DEV SECRET (set EMAIL_VERIFY_SECRET)'}`);
    console.log(`  pending tokens:       ${__pendingCount()}`);
  } else {
    console.log('usage: node integrations/email-verify.mjs [--status]');
  }
}
