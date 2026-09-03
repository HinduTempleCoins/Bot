// melek-login.mjs — "Log in to SoapBox": the ecosystem-wide, MULTI-PROVIDER sign-in.
//
// One login, do things across the whole ecosystem — comment, follow, post, and (the motivating case) a
// RIGHT OF REPLY on the SoapBox Data surfaces: a politician/judge/company profiled in a dossier logs in and
// attaches a response to the record about them.
//
// Two kinds of identity, one session:
//   - MELEK  (via melek-signer-oauth.mjs)  → the native on-chain account. onchain:true — can post, follow,
//     and make on-chain comments/replies (their reply is a signed op on the record).
//   - Federated: Google / Facebook / GitHub / Discord (via oidc-broker.mjs → normalized {provider,sub}) →
//     onchain:false — COMMENT-scope only (off-chain). "Log in with Facebook/Google to comment," MELEK is
//     just the strongest option, not the only one.
//
// Flow: button → beginLogin(provider) redirect → provider approves → callback → complete → mintSession →
// an HMAC-signed cookie (Domain=.soapbox.community → SSO across every *.soapbox subdomain). Password/tokens
// never touch our servers (MELEK on the signer; federated via PKCE in the broker, which returns no tokens).
//
// Pure + injectable (fetch + secret), soft-fail (verify → null, never throws), no top-level network.
// MELEK_SESSION_SECRET = HMAC key, stable across restarts, never logged.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { authorizeUrl, exchangeCode } from './melek-signer-oauth.mjs';
import { PROVIDERS as OIDC_PROVIDERS, beginLogin as oidcBeginLogin } from './oidc-broker.mjs';

const DEFAULT_TTL = 30 * 24 * 3600;
const COOKIE = 'soapbox_session';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Providers offered on the login widget. 'melek' is native+on-chain; the rest come from the OIDC broker.
// (Facebook = a one-entry add to oidc-broker.PROVIDERS; it appears here once configured there.)
export const LOGIN_PROVIDERS = ['melek', ...Object.keys(OIDC_PROVIDERS)];
export const isOnchainProvider = (p) => p === 'melek';

function secretOf(secret) {
  const s = secret || process.env.MELEK_SESSION_SECRET;
  if (!s) throw new Error('melek-login: MELEK_SESSION_SECRET required (HMAC key; never logged)');
  return s;
}
const b64u = (s) => Buffer.from(String(s)).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');
const sign = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url');

/** The redirect target for a provider's "Log in" button. */
export function beginLogin(provider = 'melek', { clientId = 'soapbox', scope = 'identity', redirectUri, state, oidc } = {}) {
  if (provider === 'melek') return authorizeUrl({ clientId, scope, redirectUri, state });
  if (!OIDC_PROVIDERS[provider]) throw new Error(`melek-login: unknown provider ${provider}`);
  return oidcBeginLogin(provider, { clientId: (oidc && oidc.clientId) || clientId, redirectUri, ...(oidc || {}) });
}

/** mintSession — a tamper-proof session for a verified identity: b64(provider).b64(account).exp.sig */
export function mintSession(account, { provider = 'melek', secret, ttl = DEFAULT_TTL, now = Date.now() } = {}) {
  const a = String(account || '').toLowerCase();
  if (!a) throw new Error('melek-login: no account');
  const exp = Math.floor(now / 1000) + ttl;
  const body = `${b64u(provider)}.${b64u(a)}.${exp}`;
  return `${body}.${sign(body, secretOf(secret))}`;
}

/** Mint a comment-scope session from a normalized federated identity ({provider, sub}). Account is namespaced. */
export function sessionFromIdentity(identity, opts = {}) {
  const provider = String(identity && identity.provider || '').toLowerCase();
  const sub = String(identity && identity.sub || '');
  if (!provider || !sub) throw new Error('melek-login: identity needs { provider, sub }');
  return mintSession(`${provider}:${sub}`, { ...opts, provider });
}

/** verifySession — { account, provider, onchain } for a valid, unexpired, untampered token; else null. */
export function verifySession(token, { secret, now = Date.now() } = {}) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 4) return null;
    const [encP, encA, exp, sig] = parts;
    const body = `${encP}.${encA}.${exp}`;
    const a = Buffer.from(sig); const b = Buffer.from(sign(body, secretOf(secret)));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;         // tampered / wrong secret
    if (!Number.isFinite(+exp) || +exp < Math.floor(now / 1000)) return null; // expired
    const provider = unb64u(encP).toLowerCase();
    const account = unb64u(encA).toLowerCase();
    return account ? { account, provider, onchain: isOnchainProvider(provider) } : null;
  } catch { return null; }
}

/** completeLogin (MELEK) — exchange the callback code → verified account → a session. null on failure. */
export async function completeLogin({ clientId = 'soapbox', code, secret, ttl } = {}, fetchImpl = fetch) {
  const res = await exchangeCode({ clientId, code }, fetchImpl);
  if (!res || !res.account) return null;
  return { account: res.account, provider: 'melek', token: res.token, session: mintSession(res.account, { provider: 'melek', secret, ttl }) };
}

export function sessionCookie(value, { domain = '.soapbox.community', ttl = DEFAULT_TTL, secure = true } = {}) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${ttl}`];
  if (domain) attrs.push(`Domain=${domain}`);
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
export function clearCookie({ domain = '.soapbox.community' } = {}) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${domain ? `; Domain=${domain}` : ''}`;
}

/** Read + verify the session from a raw Cookie header. Returns { account, provider, onchain } | null. */
export function requireSession(cookieHeader, { secret, now } = {}) {
  const m = String(cookieHeader || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? verifySession(decodeURIComponent(m[1]), { secret, now }) : null;
}

const PROVIDER_LABEL = { melek: 'MELEK', google: 'Google', facebook: 'Facebook', github: 'GitHub', discord: 'Discord' };

/** The drop-in login widget: signed-in state, or a button per offered provider (MELEK first). */
export function loginButtonHtml({ account, provider, returnTo = '/', providers = LOGIN_PROVIDERS } = {}) {
  if (account) {
    const via = provider && provider !== 'melek' ? ` <span class=muted>(via ${esc(PROVIDER_LABEL[provider] || provider)})</span>` : '';
    return `<span class="melek-login melek-login-in" data-account="${esc(account)}" data-provider="${esc(provider || '')}">`
      + `Signed in as <b>@${esc(account)}</b>${via} · <a href="/logout?return=${encodeURIComponent(returnTo)}">Log out</a></span>`;
  }
  const btns = providers.map((p) =>
    `<a class="melek-login melek-login-btn melek-login-${esc(p)}" data-widget="login" data-provider="${esc(p)}"`
    + ` href="/login?provider=${encodeURIComponent(p)}&return=${encodeURIComponent(returnTo)}" rel="nofollow">`
    + `Log in with ${esc(PROVIDER_LABEL[p] || p)}</a>`).join('');
  return `<div class="melek-login-choices">${btns}</div>`;
}

export const SESSION_COOKIE = COOKIE;
