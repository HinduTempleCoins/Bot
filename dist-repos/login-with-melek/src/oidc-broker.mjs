// oidc-broker.mjs — a provider-agnostic OIDC login broker (Authentik / Keycloak-style) for
// "Login with GitHub / Google / Discord" (task #75).
//
// This is the authorization-code + PKCE flow, generalized over three providers, so the rest of
// the stack gets ONE uniform "logged-in identity" no matter which button the user clicked. It is
// the LOGIN counterpart to ifttt-connect.mjs (which connects the OPERATOR's own accounts and holds
// long-lived tokens as vault grants): this broker AUTHENTICATES an end user and returns a
// normalized { provider, sub, email, name } — it does NOT store tokens.
//
// Conventions match ifttt-connect.mjs / admin-auth.mjs / soapbox:
//   - PURE logic, no network. The token-exchange and userinfo calls are INJECTED, so tests run
//     fully offline: __setTokenExchange(fn) / __setUserInfo(fn).
//   - injectable clock (__setClock) and nonce source (__setNonce) for deterministic tests.
//   - SOFT-FAIL: auth failures return { ok:false, reason } — they do NOT throw. (Programmer errors
//     — unknown provider, missing clientId — still throw, like ifttt-connect's resolveService.)
//   - NO SECRETS LOGGED: client secrets are NOT this module's concern (they live in the vault and
//     are used by the injected exchange fn). The broker handles only PUBLIC client ids + ephemeral
//     codes/state/PKCE verifiers, and tokens from the exchange are used in-memory and NEVER returned
//     to the caller or logged.
//
//   import { PROVIDERS, beginLogin, parseCallback, completeLogin, normalizeIdentity }
//     from './integrations/oidc-broker.mjs'
//
//   const { url, state, codeVerifier } = beginLogin('github', {
//     clientId: 'pub-id', redirectUri: 'https://app/cb',
//   });
//   // ...user authorizes, provider redirects to redirectUri?code=...&state=...
//   const { code, state: cbState } = parseCallback(req.url.split('?')[1]);
//   const r = await completeLogin('github', { code, state: cbState, codeVerifier, clientId, redirectUri });
//   // r = { ok:true, identity: { provider:'github', sub:'42', email, name } }  — NO tokens
//
//   node integrations/oidc-broker.mjs            # prints the provider catalog (no secrets)

import crypto from 'node:crypto';
import { getCapability, has } from './secrets.mjs';

// ---- error type (for programmer errors only; auth failures soft-fail) -------

export class OidcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OidcError';
  }
}

// ---- the provider catalog --------------------------------------------------
//
// PURE config: each provider's authorize / token / userinfo endpoints (public, well-known URLs)
// and the default scopes we request. `pkce` is always true here — this broker only does the
// PKCE-hardened auth-code flow. GitHub's OAuth supports PKCE; Google & Discord are OIDC providers.
//
// `emailField` / `idField` name the userinfo keys this provider uses for email + stable subject
// (they diverge: GitHub `id`, Google `sub`, etc.) — normalizeIdentity uses them. `clientSecretEnv`
// is the ENV NAME (never the value) under which the provider's confidential client secret resolves
// via secrets.getCapability(); the secret is read only inside the token-exchange `.use()` scope and
// is never returned or logged.
export const PROVIDERS = Object.freeze({
  github: {
    name: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
    emailField: 'email',
    idField: 'id',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
  },
  google: {
    name: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    emailField: 'email',
    idField: 'sub',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
  },
  discord: {
    name: 'discord',
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
    emailField: 'email',
    idField: 'id',
    clientSecretEnv: 'DISCORD_OAUTH_CLIENT_SECRET',
  },
  yahoo: {
    name: 'yahoo',
    authUrl: 'https://api.login.yahoo.com/oauth2/request_auth',
    tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
    userInfoUrl: 'https://api.login.yahoo.com/openid/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    emailField: 'email',
    idField: 'sub',
    clientSecretEnv: 'YAHOO_OAUTH_CLIENT_SECRET',
  },
});

function resolveProvider(provider) {
  const key = typeof provider === 'string' ? provider.toLowerCase() : '';
  const p = PROVIDERS[key];
  if (!p) {
    throw new OidcError(
      `unknown provider: ${String(provider)} (known: ${Object.keys(PROVIDERS).join(', ')})`
    );
  }
  return p;
}

// ---- injectable seams (deterministic + offline tests) ----------------------

// The injectable HTTP transport. The REAL token-exchange / userinfo defaults use deps.fetch; tests
// inject a fake via __setFetch. We default to globalThis.fetch when present (Node 18+), else null —
// when null AND no custom exchange/userinfo is injected, the defaults soft-fail (login fails closed)
// rather than throwing.
const realFetch =
  typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
    ? (...a) => globalThis.fetch(...a)
    : null;

const defaultDeps = {
  now: () => Date.now(),
  // nonce source for `state`. Default is crypto-random; tests inject a fixed/sequenced source.
  nonce: () => crypto.randomBytes(16),
  // HTTP transport for the real exchange/userinfo defaults. Injected in tests.
  fetch: realFetch,
  // token exchange: by default null → the REAL default (realTokenExchange) is used. A test or caller
  // may inject a custom fn via __setTokenExchange; when injected, that wins.
  //   tokenExchange({ provider, code, codeVerifier, clientId, redirectUri, tokenUrl }) -> { access_token, ... }
  tokenExchange: null,
  // userinfo fetch: by default null → the REAL default (realUserInfo) is used. Injectable via
  // __setUserInfo for offline tests.
  //   userInfo({ provider, accessToken, userInfoUrl }) -> raw profile object
  userInfo: null,
};
let deps = { ...defaultDeps };

export function __setClock(fn) { deps.now = typeof fn === 'function' ? fn : defaultDeps.now; }
export function __setNonce(fn) { deps.nonce = typeof fn === 'function' ? fn : defaultDeps.nonce; }
// Inject the HTTP transport (tests pass a fake; pass nothing to restore the platform fetch).
export function __setFetch(fn) { deps.fetch = typeof fn === 'function' ? fn : defaultDeps.fetch; }
export function __setTokenExchange(fn) {
  deps.tokenExchange = typeof fn === 'function' ? fn : defaultDeps.tokenExchange;
}
export function __setUserInfo(fn) {
  deps.userInfo = typeof fn === 'function' ? fn : defaultDeps.userInfo;
}
export function __reset() {
  deps = { ...defaultDeps };
  _states.clear();
}

// ---- PKCE + base64url (same shape as ifttt-connect.mjs) --------------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makePkce() {
  const codeVerifier = b64url(crypto.randomBytes(32));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

// ---- single-use state store -------------------------------------------------
//
// state is a CSRF + single-use token. We track issued, unconsumed states (with provider binding
// + expiry) so completeLogin can reject unknown/replayed state. In a real multi-process deployment
// this is a shared/persistent store; the in-memory Set/Map is the offline-testable default.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _states = new Map(); // state -> { provider, exp }

function rememberState(state, provider) {
  _states.set(state, { provider, exp: deps.now() + STATE_TTL_MS });
}
// Validate + CONSUME a state. Returns true only if known, unexpired, provider-matched, unconsumed.
function consumeState(state, provider) {
  if (typeof state !== 'string' || !state) return false;
  const rec = _states.get(state);
  if (!rec) return false;            // unknown or already consumed (replay)
  _states.delete(state);             // single-use: gone whether or not it's still valid
  if (rec.provider !== provider) return false;
  if (deps.now() > rec.exp) return false;
  return true;
}

// ---- REAL default token-exchange + userinfo (network; injectable fetch) ----
//
// These fire ONLY when no custom fn was injected via __setTokenExchange / __setUserInfo AND a fetch
// transport is available (deps.fetch). They use the provider's confidential client secret strictly
// by ENV NAME (PROVIDERS[provider].clientSecretEnv) through secrets.getCapability().use() — the
// secret never lands in a caller-visible variable, never returned, never logged. Tokens are used
// only to fetch userinfo and are never returned to the caller. Any network/parse error throws here
// and is caught by completeLogin → clean { ok:false, reason } (fail closed).

// POST code -> token at the provider tokenUrl. Returns the parsed token response (kept local).
async function realTokenExchange({ provider, code, codeVerifier, clientId, redirectUri, tokenUrl }) {
  const p = resolveProvider(provider);
  const fetchFn = deps.fetch;
  if (typeof fetchFn !== 'function') throw new OidcError('no fetch transport for token exchange');

  const secretName = p.clientSecretEnv;
  if (!has(secretName)) throw new OidcError('client secret unavailable for token exchange');

  // The secret stays inside the capability .use() scope — assemble the request body there and POST,
  // so the plaintext secret is never assigned to an outer variable, returned, or logged.
  const resp = await getCapability(secretName).use(async (clientSecret) => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      client_id: String(clientId),
      client_secret: String(clientSecret),
      redirect_uri: String(redirectUri),
      code_verifier: String(codeVerifier),
    });
    return fetchFn(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
  });

  if (!resp || typeof resp.json !== 'function' || (resp.ok === false)) {
    throw new OidcError('token endpoint returned a non-OK response');
  }
  const json = await resp.json(); // may throw on bad JSON → caught upstream
  if (!json || typeof json !== 'object') throw new OidcError('token endpoint returned no JSON object');
  return json; // { access_token, ... } — secret. Stays local; completeLogin extracts access_token only.
}

// GET userInfoUrl with the bearer access token. Returns the raw profile object.
async function realUserInfo({ accessToken, userInfoUrl }) {
  const fetchFn = deps.fetch;
  if (typeof fetchFn !== 'function') throw new OidcError('no fetch transport for userinfo');

  const resp = await fetchFn(userInfoUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'user-agent': 'melek-oidc-broker',
    },
  });
  if (!resp || typeof resp.json !== 'function' || (resp.ok === false)) {
    throw new OidcError('userinfo endpoint returned a non-OK response');
  }
  const json = await resp.json(); // may throw on bad JSON → caught upstream
  if (!json || typeof json !== 'object') throw new OidcError('userinfo endpoint returned no JSON object');
  return json;
}

// Resolve the effective fn: an injected one wins; otherwise the real default (network).
function effectiveTokenExchange() {
  return typeof deps.tokenExchange === 'function' ? deps.tokenExchange : realTokenExchange;
}
function effectiveUserInfo() {
  return typeof deps.userInfo === 'function' ? deps.userInfo : realUserInfo;
}

// ---- beginLogin (PURE) -----------------------------------------------------
//
// Build the provider's authorize URL for the PKCE auth-code flow. Returns
//   { url, state, codeVerifier, codeChallenge }
// The caller persists state + codeVerifier (e.g. in the browser session) and redirects to `url`.
// state is registered here so completeLogin can enforce single-use.
export function beginLogin(provider, { clientId, redirectUri, scopes } = {}) {
  const p = resolveProvider(provider);
  if (!clientId) throw new OidcError(`beginLogin(${p.name}): clientId is required`);
  if (!redirectUri) throw new OidcError(`beginLogin(${p.name}): redirectUri is required`);

  const state = b64url(deps.nonce());
  const { codeVerifier, codeChallenge, codeChallengeMethod } = makePkce();
  const wantScopes = Array.isArray(scopes) && scopes.length ? scopes : p.scopes;

  const u = new URL(p.authUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', wantScopes.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', codeChallengeMethod);

  rememberState(state, p.name);

  return { url: u.toString(), state, codeVerifier, codeChallenge };
}

// ---- parseCallback (PURE) --------------------------------------------------
//
// Pull { code, state } out of the redirect query string (the part after `?`). Also surfaces a
// provider error if the user denied consent (?error=access_denied). Accepts a raw query string,
// a full URL, or an object/URLSearchParams.
export function parseCallback(rawQuery) {
  let params;
  if (rawQuery instanceof URLSearchParams) {
    params = rawQuery;
  } else if (rawQuery && typeof rawQuery === 'object') {
    params = new URLSearchParams(rawQuery);
  } else {
    let q = String(rawQuery || '');
    const qi = q.indexOf('?');
    if (qi >= 0) q = q.slice(qi + 1); // tolerate a full URL or a leading '?'
    params = new URLSearchParams(q);
  }
  const out = { code: params.get('code') || null, state: params.get('state') || null };
  const error = params.get('error');
  if (error) out.error = error;
  return out;
}

// ---- normalizeIdentity (PURE) ----------------------------------------------
//
// Map each provider's differently-named profile fields onto ONE uniform identity. `raw` carries the
// original profile for callers that need provider-specific extras; tokens are never part of this.
export function normalizeIdentity(provider, userinfo) {
  const p = resolveProvider(provider);
  const u = userinfo || {};

  // Stable subject + email come from the provider's configured field names (they diverge: GitHub
  // `id`, Google/Yahoo `sub`; all use `email` here but the seam stays per-provider).
  const idRaw = u[p.idField];
  const sub = idRaw != null ? String(idRaw) : null;
  const email = u[p.emailField] || null;

  // emailVerified: providers expose this differently (Google/Yahoo OIDC `email_verified`; GitHub's
  // user endpoint doesn't include it; Discord uses `verified` for the account-email flag).
  let emailVerified = null;
  if (typeof u.email_verified === 'boolean') emailVerified = u.email_verified;
  else if (typeof u.verified === 'boolean') emailVerified = u.verified;

  // Human-readable display name — provider-specific best field.
  let name = null;
  switch (p.name) {
    case 'github':
      name = u.name || u.login || null;       // GitHub: real name or `login` handle
      break;
    case 'discord':
      name = u.username || u.global_name || null; // Discord: username or display name
      break;
    case 'google':
    case 'yahoo':
    default:
      name = u.name || null;                  // OIDC `name`
      break;
  }

  return { provider: p.name, id: sub, sub, email, emailVerified, name, raw: u };
}

// ---- completeLogin ---------------------------------------------------------
//
// Finish the flow: validate the returned state (known + unexpired + provider-bound + single-use),
// exchange the code for tokens (INJECTED token-exchange), fetch the profile (INJECTED userinfo),
// and return a NORMALIZED identity. Tokens are used only to fetch userinfo and are NEVER returned
// or logged. Auth failures soft-fail to { ok:false, reason }.
export async function completeLogin(
  provider,
  { code, state, codeVerifier, clientId, redirectUri } = {}
) {
  const p = resolveProvider(provider); // unknown provider is a programmer error -> throws

  if (!code) return { ok: false, reason: 'missing-code' };
  if (!state) return { ok: false, reason: 'missing-state' };

  // State must be known, unexpired, provider-matched, and unconsumed. Consumes it (single-use).
  if (!consumeState(state, p.name)) return { ok: false, reason: 'bad-state' };

  // Exchange the authorization code for tokens. The token response is a secret: it stays local.
  let tokenResp;
  try {
    tokenResp = await effectiveTokenExchange()({
      provider: p.name,
      code,
      codeVerifier,
      clientId,
      redirectUri,
      tokenUrl: p.tokenUrl,
    });
  } catch {
    return { ok: false, reason: 'token-exchange-failed' };
  }

  const accessToken =
    typeof tokenResp === 'string'
      ? tokenResp
      : tokenResp && (tokenResp.access_token || tokenResp.token);
  if (!accessToken) return { ok: false, reason: 'no-access-token' };

  // Fetch the user profile with the access token (in-memory use only).
  let profile;
  try {
    profile = await effectiveUserInfo()({
      provider: p.name,
      accessToken,
      userInfoUrl: p.userInfoUrl,
    });
  } catch {
    return { ok: false, reason: 'userinfo-failed' };
  }
  if (!profile || typeof profile !== 'object') return { ok: false, reason: 'no-userinfo' };

  const identity = normalizeIdentity(p.name, profile);
  if (!identity.sub) return { ok: false, reason: 'no-subject' };

  // Public identity only — NO tokens.
  return { ok: true, identity };
}

// ---- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('oidc-broker.mjs')) {
  // Print the provider catalog only — names, scopes, endpoints. No secrets, no network.
  const rows = Object.values(PROVIDERS).map((p) => ({
    provider: p.name,
    scopes: p.scopes.join(' '),
    authUrl: p.authUrl,
    userInfo: p.userInfoUrl,
  }));
  // eslint-disable-next-line no-console
  console.log('OIDC broker — login providers (auth-code + PKCE, no secrets printed):');
  // eslint-disable-next-line no-console
  console.table(rows);
}
