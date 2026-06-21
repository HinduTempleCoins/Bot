// pentecaust/auth.mjs — REAL authentication for Pentecaust (the MELEK messenger).
//
// WHAT THIS IS
//   The login system that feeds pentecaust/server.mjs its identity. server.mjs has an identity seam
//   (`__setAuthVerifier(fn)`): a verifier reads the request, returns the certified MELEK account, and
//   the whole app then authenticates from THAT — never from an attacker-controllable query/body field
//   (the IDOR guard). This module IS that verifier plus the login surface that mints what it verifies:
//
//     1) SESSIONS — a signed, tamper-proof, HttpOnly cookie. Persistent (~30d): "continue adding more",
//        not re-login every visit. `verifier(req)` is the function you hand to server's __setAuthVerifier.
//     2) SOCIAL OAUTH (Google + Facebook) — standard authorization-code flow, implemented by hand
//        (no heavy deps), provider-configurable via env, CSRF-protected with a signed `state`.
//     3) ONE-TIME LOGIN — passwordless single-use, short-TTL codes (the "1-time login").
//     4) ACCOUNT LINKING — (provider, providerUserId) -> a MELEK account, persisted in a file store.
//     5) MELEK-SIGNER HOOK — registerMethod('melek-signer', verifyFn) extension point so posting-key
//        signature login can be added later (the operator said it's added to this system).
//
// SECURITY MUST-HAVES (each enforced + commented at its site below)
//   - Sessions are HMAC-SHA256 signed (node:crypto) over a JSON payload; verified with a CONSTANT-TIME
//     compare (timingSafeEqual). A tampered payload or signature, or an expired token, is rejected.
//   - The session cookie is HttpOnly + Secure + SameSite=Lax (no JS access, HTTPS-only, CSRF-resistant).
//   - The OAuth flow carries a random CSRF `state` (a separate signed, HttpOnly cookie); the callback
//     REJECTS a mismatch — closes login-CSRF / code-injection.
//   - One-time codes are single-use and short-TTL; the STORE holds a HASH of the code, never the raw
//     code (a store leak can't be replayed).
//   - `provider` is validated against an ALLOW-LIST (no SSRF — we never fetch an attacker-named host).
//   - Routing is EXACT-PATH (split into segments), never endsWith/substring.
//   - Secrets (client secrets, the session secret, raw codes, tokens) are NEVER logged.
//
// OFFLINE / INJECTABLE (fully testable, no network in tests)
//   - `__setFetch(fn)` injects fetch so the OAuth token-exchange + userinfo calls are mocked.
//   - File store is injectable fs {read,write} + env path (PENTECAUST_AUTH_DATA), soft-fail-never-throw.
//   - `_now`/clock is injectable per-call (opts.now) so TTL/expiry are deterministic in tests.
//
//   import { verifier, handler, sessionFromReq, requestOneTime, redeemOneTime, registerMethod } from './auth.mjs'

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

// ── config (env-overridable; NO secrets baked in) ───────────────────────────────────────────────────
export const DATA_FILE = () => env('PENTECAUST_AUTH_DATA', join(process.cwd(), 'data', 'pentecaust-auth.json'));
const BASE_URL = () => String(env('PENTECAUST_BASE_URL', env('BASE_URL', 'https://pentecaust.com'))).replace(/\/$/, '');
// Session secret: REQUIRED in production. We never invent a default secret silently for a real signature —
// if it's unset we fall back to a per-process random secret so dev/tests still work, but sessions then die
// on restart (intentional: an operator who forgot to set the secret gets logout-on-restart, not a forgeable
// constant-secret session). Never logged.
let _ephemeralSecret = null;
function sessionSecret() {
  const s = env('PENTECAUST_SESSION_SECRET', '');
  if (s) return s;
  if (!_ephemeralSecret) _ephemeralSecret = randomBytes(32).toString('hex');
  return _ephemeralSecret;
}
const SESSION_TTL_MS = Number(env('PENTECAUST_SESSION_TTL_MS', String(30 * 24 * 60 * 60 * 1000))) || 30 * 24 * 60 * 60 * 1000; // ~30 days, persistent
const STATE_TTL_MS = Number(env('PENTECAUST_OAUTH_STATE_TTL_MS', String(10 * 60 * 1000))) || 10 * 60 * 1000;                  // OAuth round-trip window
const ONETIME_TTL_MS = Number(env('PENTECAUST_ONETIME_TTL_MS', String(15 * 60 * 1000))) || 15 * 60 * 1000;                    // one-time code lifetime
const SESSION_COOKIE = 'pentecaust_session';
const STATE_COOKIE = 'pentecaust_oauth_state';

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());

// ── injectable fetch (so OAuth token-exchange + userinfo are mocked offline) ────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── injectable file store (same soft-fail idiom as invites.mjs / move-ledger) ───────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); } catch {} },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { links: {}, onetime: {} };
  try { const o = JSON.parse(raw); return o && o.links && o.onetime ? o : { links: {}, onetime: {} }; }
  catch { return { links: {}, onetime: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

// ── base64url helpers ───────────────────────────────────────────────────────────────────────────────
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
function fromB64urlJson(s) {
  try { return JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch { return null; }
}
const _acct = (s) => String(s || '').trim().toLowerCase();

// ── HMAC-signed token (sessions + the OAuth state cookie share this primitive) ──────────────────────
// Token shape: <b64url(payloadJSON)>.<b64url(HMAC-SHA256(payloadJSON))>. Verification is CONSTANT-TIME.
function signToken(payload, secret = sessionSecret()) {
  const body = b64urlJson(payload);
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}
// Returns the payload object, or null on ANY problem (malformed, bad signature, can't decode).
// Constant-time signature compare so we don't leak validity via timing. Never throws.
function verifyToken(token, secret = sessionSecret()) {
  try {
    const t = String(token || '');
    const dot = t.indexOf('.');
    if (dot <= 0) return null;
    const body = t.slice(0, dot);
    const sig = t.slice(dot + 1);
    const expected = b64url(createHmac('sha256', secret).update(body).digest());
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length) return null;          // length-mismatch fails before timingSafeEqual (it requires equal length)
    if (!timingSafeEqual(a, b)) return null;         // constant-time — no early-exit timing leak
    return fromB64urlJson(body);
  } catch { return null; }
}

// ── SESSIONS ────────────────────────────────────────────────────────────────────────────────────────
/**
 * Mint a session token for a certified account. payload = { account, method, iat, exp }.
 * `method` records HOW they logged in (google/facebook/onetime/melek-signer/dev) for audit.
 */
export function makeSession(account, method = 'session', opts = {}) {
  const acct = _acct(account);
  if (!validAccountName(acct)) return null;
  const iat = now(opts);
  const exp = iat + (opts.ttl || SESSION_TTL_MS);
  return signToken({ account: acct, method: String(method).slice(0, 32), iat, exp });
}

/**
 * Parse + verify the session cookie on a request → { account, method } or null.
 * Rejects: missing cookie, bad signature (tamper), malformed payload, expired (exp passed), bad account.
 */
export function sessionFromReq(req, opts = {}) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const p = verifyToken(token);
  if (!p || typeof p !== 'object') return null;                 // bad signature / malformed → reject
  if (!p.exp || now(opts) >= Number(p.exp)) return null;        // expired → reject
  const acct = _acct(p.account);
  if (!validAccountName(acct)) return null;                     // payload must name a real account
  return { account: acct, method: String(p.method || 'session') };
}

// The verifier you hand to server.mjs `__setAuthVerifier`: certified account (string) or null.
// DEV fallback: PENTECAUST_DEV_TRUST=1 (local/testnet ONLY) trusts an asserted x-melek-account header so
// the reference client + offline suites still work — mirrors the server's own DEV_TRUST seam.
const DEV_TRUST = () => env('PENTECAUST_DEV_TRUST', '') === '1';
export function verifier(req) {
  const s = sessionFromReq(req);
  if (s) return s.account;
  if (DEV_TRUST()) { const h = (req && req.headers) || {}; const a = h['x-melek-account']; return a ? _acct(a) : null; }
  return null;
}

// ── cookie helpers (parse from header; build a hardened Set-Cookie) ──────────────────────────────────
function readCookie(req, name) {
  const h = (req && req.headers && req.headers.cookie) || '';
  if (!h) return null;
  for (const part of String(h).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); } }
  }
  return null;
}
// HttpOnly (no JS access → XSS can't read the session), Secure (HTTPS only), SameSite=Lax (CSRF-resistant
// while still allowing the top-level OAuth redirect back). Path=/ so the whole app sees it.
function setCookie(name, value, maxAgeMs) {
  const attrs = ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAgeMs != null) attrs.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return `${name}=${encodeURIComponent(value)}; ${attrs.join('; ')}`;
}
const clearCookie = (name) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ── PROVIDERS (allow-list — no SSRF; we only ever talk to these exact hosts) ────────────────────────
// Provider config is read from env at call time so the operator sets client id/secret without code edits.
// SCOPES are OPERATOR-CONTROLLED via env (GOOGLE_SCOPES / FACEBOOK_SCOPES). The default is the MINIMUM for
// login (identity only). To turn OAuth into a data-CONNECTOR — pull a user's inbox / friends-list / posts
// from another site into the MELEK messenger + feed the IFTTT layer — the operator widens these (e.g. add
// `https://www.googleapis.com/auth/gmail.readonly` / contacts / etc.). So the consent screen asks for
// EXACTLY what's configured, nothing more. (Sensitive scopes require the provider's app verification.)
const PROVIDERS = {
  google: {
    scope: () => env('GOOGLE_SCOPES', 'openid email profile'),
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    clientId: () => env('GOOGLE_CLIENT_ID', ''),
    clientSecret: () => env('GOOGLE_CLIENT_SECRET', ''),
    // Google userinfo: { sub, email, ... } — `sub` is the stable id.
    extract: (u) => ({ id: u && (u.sub || u.id), email: u && u.email }),
  },
  facebook: {
    scope: () => env('FACEBOOK_SCOPES', 'email'),
    authorize: 'https://www.facebook.com/v19.0/dialog/oauth',
    token: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userinfo: 'https://graph.facebook.com/me?fields=id,email',
    clientId: () => env('FACEBOOK_CLIENT_ID', ''),
    clientSecret: () => env('FACEBOOK_CLIENT_SECRET', ''),
    // Facebook /me: { id, email } — `id` is the stable per-app user id.
    extract: (u) => ({ id: u && u.id, email: u && u.email }),
  },
};
// Allow-list check — the ONLY way `provider` ever reaches a fetch/host. Unknown provider → rejected.
const isProvider = (p) => Object.prototype.hasOwnProperty.call(PROVIDERS, String(p || ''));
const redirectUri = (provider) => `${BASE_URL()}/auth/${provider}/callback`;

/** The provider's authorize-URL the browser is redirected to (with a CSRF state). */
export function authorizeUrl(provider, state) {
  if (!isProvider(provider)) return null;
  const p = PROVIDERS[provider];
  if (!p.clientId()) return null;                       // not configured → caller surfaces a clean error
  const q = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: typeof p.scope === 'function' ? p.scope() : p.scope,   // operator-controlled (env) scope list
    state,
    access_type: 'offline',     // request a refresh token so connector reads can continue (Messenger/IFTTT)
    prompt: 'consent',
  });
  return `${p.authorize}?${q.toString()}`;
}

// Exchange an authorization code for an access token at the provider's token endpoint (injected fetch).
async function exchangeCode(provider, code) {
  const p = PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    client_id: p.clientId(),
    client_secret: p.clientSecret(),                    // sent to the provider only; NEVER logged
    redirect_uri: redirectUri(provider),
  });
  const r = await _fetch(p.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  const j = await r.json();
  return (j && j.access_token) ? String(j.access_token) : null;
}

// Fetch userinfo with the access token, extract a stable { id, email } via the provider's extractor.
async function fetchUserInfo(provider, accessToken) {
  const p = PROVIDERS[provider];
  const r = await _fetch(p.userinfo, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  const u = await r.json();
  const { id, email } = p.extract(u) || {};
  if (!id) return null;
  return { id: String(id), email: email ? String(email) : null };
}

// ── ACCOUNT LINKING STORE: (provider, providerUserId) -> MELEK account ──────────────────────────────
const linkKey = (provider, id) => `${provider}:${id}`;

/** Look up the MELEK account linked to (provider, providerUserId), or null. */
export function lookupLink(provider, providerUserId, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const rec = store.links[linkKey(provider, providerUserId)];
  return rec ? _acct(rec.account) : null;
}

/**
 * Link (provider, providerUserId) → a MELEK account. Validates the account name. First-write-wins:
 * an existing link is NOT silently overwritten (an attacker who re-auths can't re-point someone's link).
 * @returns {{ ok:true, account } | { ok:false, reason }}
 */
export function linkAccount(provider, providerUserId, account, opts = {}) {
  if (!isProvider(provider)) return { ok: false, reason: 'unknown provider' };
  const acct = _acct(account);
  if (!validAccountName(acct)) return { ok: false, reason: 'invalid account name' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const key = linkKey(provider, String(providerUserId || ''));
  const existing = store.links[key];
  if (existing) {
    if (_acct(existing.account) !== acct) return { ok: false, reason: 'provider identity already linked to another account' };
    return { ok: true, account: acct };
  }
  store.links[key] = { account: acct, provider, linkedAt: now(opts), email: opts.email || null };
  saveStore(fs, file, store);
  return { ok: true, account: acct };
}

// ── ONE-TIME (passwordless) LOGIN ────────────────────────────────────────────────────────────────────
// Random single-use code, short TTL. The STORE holds a SHA-256 HASH of the code, never the raw code, so a
// store leak can't be replayed. Delivery (email) is FUTURE: for now requestOneTime returns the raw code so
// the testnet/operator can surface it; in production it would be emailed and NOT returned to the caller.
const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex');

/**
 * Issue a single-use, short-TTL one-time login code for an account.
 * @returns {{ ok:true, account, code, expiresAt } | { ok:false, reason }}
 *          NOTE: `code` is returned for now (testnet). When email delivery lands, send it and DON'T return it.
 */
export function requestOneTime(account, opts = {}) {
  const acct = _acct(account);
  if (!validAccountName(acct)) return { ok: false, reason: 'invalid account name' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  // H2: prune consumed/expired codes on the write path so the store can't grow unbounded.
  for (const k of Object.keys(store.onetime)) { const v = store.onetime[k]; if (!v || v.used || now(opts) >= Number(v.expiresAt)) delete store.onetime[k]; }
  const code = b64url(randomBytes(24));                 // ~32 chars, 192 bits of entropy — unguessable
  const expiresAt = now(opts) + ONETIME_TTL_MS;
  store.onetime[hashCode(code)] = { account: acct, expiresAt, used: false, createdAt: now(opts) };
  saveStore(fs, file, store);
  return { ok: true, account: acct, code, expiresAt };
}

/**
 * Redeem a one-time code: valid + unused + unexpired → consume it (single-use) and return the account.
 * Reuse, expiry, or an unknown code are all rejected. We look up by the code's HASH (store has no raw code).
 * @returns {{ ok:true, account } | { ok:false, reason }}
 */
export function redeemOneTime(code, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const h = hashCode(String(code || ''));
  const rec = store.onetime[h];
  if (!rec) return { ok: false, reason: 'unknown or invalid code' };
  if (rec.used) return { ok: false, reason: 'code already used' };
  if (now(opts) >= Number(rec.expiresAt)) { delete store.onetime[h]; saveStore(fs, file, store); return { ok: false, reason: 'code expired' }; }
  rec.used = true;                                      // single-use: mark consumed before returning
  rec.usedAt = now(opts);
  saveStore(fs, file, store);
  return { ok: true, account: _acct(rec.account) };
}

// ── MELEK-SIGNER (and other future methods) EXTENSION POINT ─────────────────────────────────────────
// registerMethod('melek-signer', verifyFn) lets MELEK-Signer (posting-key signature) be added later as
// another login method WITHOUT touching this file's core. verifyFn(req|payload) → MELEK account | null.
// The handler exposes /auth/method/:name which runs the registered verifier and, on success, mints a
// session via that method. Operator note: MELEK-Signer is the posting-key proof step referenced in
// server.mjs's UI ("the posting-key proof is the MELEK-Signer step").
const _methods = new Map();
export function registerMethod(name, verifyFn) {
  if (typeof name === 'string' && typeof verifyFn === 'function') _methods.set(name, verifyFn);
  return _methods.has(name);
}
export function hasMethod(name) { return _methods.has(name); }

// ── HTTP HANDLER ────────────────────────────────────────────────────────────────────────────────────
// Routes (exact-path, segment-split — no endsWith/substring matching):
//   GET  /auth/:provider           → set state cookie, 302 to the provider authorize URL
//   GET  /auth/:provider/callback  → verify state (CSRF), exchange code, link account, set session, 302 /
//   POST /auth/onetime  {account}            → requestOneTime  (testnet returns the code)
//   POST /auth/onetime  {code}               → redeemOneTime → set session
//   POST /auth/method/:name {…}    → run a registered method (e.g. melek-signer) → set session
//   GET  /auth/logout              → clear the session cookie, 302 /
//   GET  /auth/me                  → current session { account, method } or 401
export async function handler(req, res) {
  const send = (code, obj, extraHeaders = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
    res.end(JSON.stringify(obj));
  };
  const redirect = (location, extraHeaders = {}) => { res.writeHead(302, { location, 'cache-control': 'no-store', ...extraHeaders }); res.end(); };

  let url;
  try { url = new URL(req.url, BASE_URL()); } catch { return send(400, { ok: false, reason: 'bad-url' }); }
  const segs = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);   // exact segments
  const method = (req.method || 'GET').toUpperCase();
  const q = url.searchParams;

  try {
    // segs: ['auth', ...]
    if (segs[0] !== 'auth') return send(404, { ok: false, reason: 'not-found' });

    // GET /auth/me — current session
    if (method === 'GET' && segs[1] === 'me' && segs.length === 2) {
      const s = sessionFromReq(req);
      return s ? send(200, { ok: true, ...s }) : send(401, { ok: false, reason: 'no session' });
    }

    // GET /auth/logout — clear the cookie
    if (method === 'GET' && segs[1] === 'logout' && segs.length === 2) {
      return redirect('/', { 'set-cookie': clearCookie(SESSION_COOKIE) });
    }

    // POST /auth/onetime — request (has account) or redeem (has code)
    if (method === 'POST' && segs[1] === 'onetime' && segs.length === 2) {
      const b = await readJson(req);
      if (b == null) return send(400, { ok: false, reason: 'bad-body' });
      if (b.code) {
        const r = redeemOneTime(b.code);
        if (!r.ok) return send(401, r);
        const token = makeSession(r.account, 'onetime');
        if (!token) return send(400, { ok: false, reason: 'invalid account' });
        return send(200, { ok: true, account: r.account }, { 'set-cookie': setCookie(SESSION_COOKIE, token, SESSION_TTL_MS) });
      }
      if (b.account) {
        const r = requestOneTime(b.account);
        // SECURITY (C1): the raw code IS the login secret. Return it inline ONLY on the dev/testnet surface
        // (where dev-trust already lets anyone assert any identity, so this is not a new hole). In production
        // the code MUST be delivered out-of-band to the account owner (email) and never returned — otherwise
        // anyone could request+redeem a code for ANY account (e.g. the witness `hathor`). Email delivery is
        // not wired yet, so production yields no usable code (safe-by-default; the endpoint can't log you in).
        if (!DEV_TRUST() && r && r.code) delete r.code;
        return send(200, r);
      }
      return send(422, { ok: false, reason: 'account or code required' });
    }

    // POST /auth/link — complete a FIRST social login by binding the signed oauth-claim to a MELEK account.
    if (method === 'POST' && segs[1] === 'link' && segs.length === 2) {
      const b = await readJson(req);
      if (b == null) return send(400, { ok: false, reason: 'bad-body' });
      // OWNERSHIP GATE (C2, load-bearing): the claim proves the requester controls the SOCIAL identity
      // (Google/Facebook) — NOT the MELEK account. Binding to an on-chain account requires proving you own
      // THAT account: the MELEK-Signer posting-key proof (the operator's "add MELEK-Signer to that" step).
      // Until that's wired, production REFUSES all linking, so nobody can bind their Google to e.g. 'hathor'
      // and take it over. Testnet (DEV_TRUST) allows it for the demo, on a SEPARATE auth store
      // (PENTECAUST_AUTH_DATA) so a testnet link can never carry into production.
      if (!DEV_TRUST()) return send(403, { ok: false, reason: 'linking requires MELEK-Signer account proof (not yet enabled)' });
      const r = completeOAuthLink(b.claim, b.account);
      if (!r.ok) return send(400, r);
      return send(200, { ok: true, account: r.account }, { 'set-cookie': setCookie(SESSION_COOKIE, r.token, SESSION_TTL_MS) });
    }

    // POST /auth/method/:name — a registered method (e.g. melek-signer)
    if (method === 'POST' && segs[1] === 'method' && segs[2] && segs.length === 3) {
      const fn = _methods.get(segs[2]);
      if (!fn) return send(404, { ok: false, reason: 'unknown method' });
      const b = await readJson(req);
      let acct = null;
      try { acct = await fn(req, b); } catch { acct = null; }
      acct = acct ? _acct(acct) : null;
      if (!acct || !validAccountName(acct)) return send(401, { ok: false, reason: 'method verification failed' });
      const token = makeSession(acct, segs[2]);
      return send(200, { ok: true, account: acct }, { 'set-cookie': setCookie(SESSION_COOKIE, token, SESSION_TTL_MS) });
    }

    // OAuth: /auth/:provider  and  /auth/:provider/callback
    if (method === 'GET' && segs[1] && segs.length <= 3) {
      const provider = segs[1];
      if (!isProvider(provider)) return send(404, { ok: false, reason: 'unknown provider' });   // ALLOW-LIST (no SSRF)

      // GET /auth/:provider — begin: random CSRF state in a signed, HttpOnly cookie, 302 to authorize URL
      if (segs.length === 2) {
        const nonce = b64url(randomBytes(16));
        const stateToken = signToken({ provider, nonce, exp: now() + STATE_TTL_MS });
        const dest = authorizeUrl(provider, stateToken);
        if (!dest) return send(503, { ok: false, reason: 'provider not configured' });
        return redirect(dest, { 'set-cookie': setCookie(STATE_COOKIE, stateToken, STATE_TTL_MS) });
      }

      // GET /auth/:provider/callback — verify state (CSRF), exchange code, link, set session
      if (segs[2] === 'callback') {
        const code = q.get('code');
        const state = q.get('state');
        const cookieState = readCookie(req, STATE_COOKIE);
        // CSRF guard: the state returned by the provider MUST equal the state we stashed in the cookie,
        // and must be a valid, unexpired, provider-matching signed token. Any mismatch → reject.
        if (!state || !cookieState || state !== cookieState) return send(403, { ok: false, reason: 'state mismatch (csrf)' });
        const sp = verifyToken(state);
        if (!sp || sp.provider !== provider || !sp.exp || now() >= Number(sp.exp)) return send(403, { ok: false, reason: 'bad-state' });
        if (!code) return send(400, { ok: false, reason: 'missing code' });

        const accessToken = await exchangeCode(provider, code);
        if (!accessToken) return send(502, { ok: false, reason: 'token exchange failed' }, { 'set-cookie': clearCookie(STATE_COOKIE) });
        const info = await fetchUserInfo(provider, accessToken);
        if (!info || !info.id) return send(502, { ok: false, reason: 'userinfo failed' }, { 'set-cookie': clearCookie(STATE_COOKIE) });

        // Account linking: is this provider identity already tied to a MELEK account?
        const linked = lookupLink(provider, info.id);
        if (!linked) {
          // FIRST social login with no link → land on the dashboard's account-picker, carrying a short-lived
          // SIGNED claim of the verified provider identity (so the link step at POST /auth/link can't be
          // spoofed). A browser callback is a top-level navigation — redirect, don't return a raw JSON page.
          const claim = signToken({ kind: 'oauth-claim', provider, providerUserId: info.id, email: info.email, exp: now() + STATE_TTL_MS });
          const dest = `/?link=${encodeURIComponent(claim)}${info.email ? `&email=${encodeURIComponent(info.email)}` : ''}`;
          return redirect(dest, { 'set-cookie': clearCookie(STATE_COOKIE) });
        }

        // Linked → mint the session and land them on the app.
        const token = makeSession(linked, provider);
        return redirect('/', { 'set-cookie': [setCookie(SESSION_COOKIE, token, SESSION_TTL_MS), clearCookie(STATE_COOKIE)] });
      }
    }

    return send(404, { ok: false, reason: 'not-found' });
  } catch { return send(500, { ok: false, reason: 'error' }); }
}

// Read+parse a small JSON body. Returns the object, or null on over-limit/parse error (soft-fail).
function readJson(req, max = 16384) {
  return new Promise((resolve) => {
    let d = ''; let over = false;
    req.on('data', (c) => { d += c; if (d.length > max) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// ── completeOAuthLink — turn a "needsAccount" oauth-claim into a real link + session (offline-testable) ─
/**
 * Complete a first-time social login by linking the verified provider identity (from the signed claim) to
 * the chosen/created MELEK account. The claim is the tamper-proof proof that the OAuth flow really verified
 * this provider identity — so the link step can't be spoofed with an attacker-named provider id.
 * @returns {{ ok:true, account, token } | { ok:false, reason }}
 */
export function completeOAuthLink(claimToken, account, opts = {}) {
  const c = verifyToken(claimToken);
  if (!c || c.kind !== 'oauth-claim' || !c.exp || now(opts) >= Number(c.exp)) return { ok: false, reason: 'invalid or expired claim' };
  if (!isProvider(c.provider) || !c.providerUserId) return { ok: false, reason: 'bad claim' };
  const link = linkAccount(c.provider, c.providerUserId, account, { ...opts, email: c.email });
  if (!link.ok) return link;
  const token = makeSession(link.account, c.provider, opts);
  if (!token) return { ok: false, reason: 'invalid account' };
  return { ok: true, account: link.account, token };
}

// ── CLI (guarded) — offline self-check on a temp store; NEVER prints a secret ───────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2] || '--serve';
  if (arg === '--demo') {
    const file = `/tmp/pentecaust-auth-demo-${process.pid}.json`;
    const o = { file };
    console.log('Pentecaust auth — offline demo (temp store):');
    const token = makeSession('alice', 'demo');
    console.log('  session minted   :', token ? 'ok' : 'FAILED');
    const ot = requestOneTime('alice', o);
    console.log('  one-time issued  :', ot.ok ? 'ok (code hidden)' : ot.reason);
    const red = redeemOneTime(ot.code, o);
    console.log('  one-time redeemed:', red.ok, red.account);
    console.log('  redeem reuse     :', redeemOneTime(ot.code, o).reason);
    try { (await import('node:fs')).unlinkSync(file); } catch {}
  } else {
    const PORT = +(env('PORT', '8158'));
    const HOST = env('HOST', '127.0.0.1');
    createServer(handler).listen(PORT, HOST, () => console.log(`Pentecaust auth on http://${HOST}:${PORT} (${BASE_URL()})${DEV_TRUST() ? ' — DEV_TRUST on' : ''}`));
  }
}
