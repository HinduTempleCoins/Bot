// melek-signer-session.mjs — the drop-in "Sign in with MELEK" ROUTES any site mounts, on top of
// melek-signer-oauth.mjs (the OAuth2 code flow) + melek-login.mjs (the HMAC session cookie).
//
//   GET /auth/melek-signer/start?return=/path   → startLogin()  → 302 to the hosted signer page
//   GET /auth/melek-signer/callback?code&state  → finishLogin() → session cookie, 302 back to /path
//   identity on every request                   → currentAccount(req.headers.cookie)
//
// The password is typed on the SIGNER's page, never on the site; the site only ever holds a one-time code
// and then a signed session naming the verified account. Nothing here touches a key or a password.
//
// Two signer URLs on purpose:
//   MELEK_SIGNER_PUBLIC_URL (default https://signer.melek.salon) — where the BROWSER goes; must be public.
//   MELEK_SIGNER_URL        (default = public)                   — server→signer token exchange; may be internal.
//
// CSRF: a random nonce is the OAuth `state`; it rides back in a signed, HttpOnly, 10-minute cookie with the
// return path. The callback refuses unless the echoed state equals that nonce.
// House style: ESM, injectable fetch + secret + clock, soft-fail-never-throw (returns {ok:false}).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { authorizeUrl, exchangeCode } from './melek-signer-oauth.mjs';
import { mintSession, sessionCookie, clearCookie, requireSession } from './melek-login.mjs';
import { validAccountName } from '../signup/welcome-grant.mjs';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const STATE_COOKIE = 'melek_signer_state';
const STATE_TTL_S = 600;

export const publicSignerUrl = () => env('MELEK_SIGNER_PUBLIC_URL', 'https://signer.melek.salon').replace(/\/$/, '');
export const exchangeSignerUrl = () => env('MELEK_SIGNER_URL', publicSignerUrl()).replace(/\/$/, '');
/** The signer's own account-creation page (keys are made there, never on our servers). */
export const signerSignupUrl = () => env('MELEK_SIGNER_SIGNUP_URL', `${publicSignerUrl()}/signup`);

const b64u = (s) => Buffer.from(String(s)).toString('base64url');
const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');
const secretOf = (s) => s || env('MELEK_SESSION_SECRET', '');

/** Only same-site relative paths survive the round-trip (no open redirect). */
export function safeReturn(r) {
  const s = String(r || '/');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s.slice(0, 512) : '/';
}

function readCookie(header, name) {
  const m = String(header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/**
 * Begin "Sign in with MELEK".
 * @returns {{ok:true, location:string, cookie:string} | {ok:false, reason:string}}
 */
export function startLogin({ clientId, redirectUri, returnTo = '/', scope = 'identity', secret, now = Date.now() } = {}) {
  const sec = secretOf(secret);
  if (!clientId || !redirectUri) return { ok: false, reason: 'signer client not configured' };
  if (!sec) return { ok: false, reason: 'MELEK_SESSION_SECRET not set' };
  try {
    const nonce = randomBytes(16).toString('base64url');
    const body = b64u(JSON.stringify({ n: nonce, r: safeReturn(returnTo), e: Math.floor(now / 1000) + STATE_TTL_S }));
    const token = `${body}.${sign(body, sec)}`;
    const location = authorizeUrl({ clientId, scope, redirectUri, state: nonce, url: publicSignerUrl() });
    const cookie = `${STATE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_TTL_S}`;
    return { ok: true, location, cookie };
  } catch { return { ok: false, reason: 'could not start login' }; }
}

function readState(cookieHeader, sec, now) {
  try {
    const t = readCookie(cookieHeader, STATE_COOKIE);
    if (!t) return null;
    const i = t.lastIndexOf('.');
    if (i <= 0) return null;
    const body = t.slice(0, i);
    const a = Buffer.from(t.slice(i + 1)); const b = Buffer.from(sign(body, sec));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || !p.n || !Number.isFinite(+p.e) || +p.e < Math.floor(now / 1000)) return null;
    return p;
  } catch { return null; }
}

/**
 * Finish the round-trip: verify state, exchange the code, mint the session.
 * @returns {Promise<{ok:true, account, returnTo, cookies:string[]} | {ok:false, status, reason, cookies:string[]}>}
 */
export async function finishLogin({ query, cookieHeader, clientId, secret, domain, now = Date.now() } = {}, fetchImpl = globalThis.fetch) {
  const sec = secretOf(secret);
  const clear = `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  const fail = (status, reason) => ({ ok: false, status, reason, cookies: [clear] });
  try {
    if (!sec) return fail(503, 'MELEK_SESSION_SECRET not set');
    const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || '');
    const st = readState(cookieHeader, sec, now);
    const state = q.get('state') || '';
    if (!st || !state || state !== st.n) return fail(403, 'state mismatch (csrf)');
    if (q.get('error')) return fail(401, 'sign-in was cancelled at the signer');
    const g = await exchangeCode({ clientId, code: q.get('code'), url: exchangeSignerUrl() }, fetchImpl);
    const account = g && g.account ? String(g.account).trim().toLowerCase() : '';
    if (!account || !validAccountName(account)) return fail(502, 'MELEK-Signer code exchange failed');
    const session = mintSession(account, { provider: 'melek', secret: sec, now });
    return { ok: true, account, returnTo: safeReturn(st.r), cookies: [sessionCookie(session, { domain }), clear] };
  } catch { return fail(500, 'sign-in failed'); }
}

/** The verified MELEK (on-chain) account for this request's cookie, or null. Never trusts a header. */
export function currentAccount(cookieHeader, { secret, now } = {}) {
  const sec = secretOf(secret);
  if (!sec) return null;
  const s = requireSession(cookieHeader, { secret: sec, now });
  return s && s.onchain ? s.account : null;
}

export const logoutCookie = ({ domain } = {}) => clearCookie({ domain });

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The button / signed-in chip a page drops in. */
export function signInHtml({ account, returnTo = '/', signup = false } = {}) {
  if (account) {
    return `<span class="melek-signin melek-signin-in">Signed in as <b>@${esc(account)}</b> · `
      + `<a href="/auth/logout?return=${encodeURIComponent(safeReturn(returnTo))}">Sign out</a></span>`;
  }
  return `<a class="melek-signin melek-signin-btn" href="/auth/melek-signer/start?return=${encodeURIComponent(safeReturn(returnTo))}" rel="nofollow">Sign in with MELEK</a>`
    + (signup ? ` <a class="melek-signin melek-signup" href="${esc(signerSignupUrl())}">Create a MELEK account</a>` : '');
}
