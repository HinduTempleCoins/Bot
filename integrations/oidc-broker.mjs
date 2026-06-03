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
export const PROVIDERS = Object.freeze({
  github: {
    name: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
  google: {
    name: 'google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  discord: {
    name: 'discord',
    authUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
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

const defaultDeps = {
  now: () => Date.now(),
  // nonce source for `state`. Default is crypto-random; tests inject a fixed/sequenced source.
  nonce: () => crypto.randomBytes(16),
  // token exchange: code (+PKCE verifier) -> token response. Injected so tests need no network.
  //   tokenExchange({ provider, code, codeVerifier, clientId, redirectUri, tokenUrl }) -> { access_token, ... }
  tokenExchange: async () => {
    throw new OidcError('no token-exchange configured — call __setTokenExchange(fn)');
  },
  // userinfo fetch: access token -> provider profile. Injected so tests need no network.
  //   userInfo({ provider, accessToken, userInfoUrl }) -> raw profile object
  userInfo: async () => {
    throw new OidcError('no userinfo fetcher configured — call __setUserInfo(fn)');
  },
};
let deps = { ...defaultDeps };

export function __setClock(fn) { deps.now = typeof fn === 'function' ? fn : defaultDeps.now; }
export function __setNonce(fn) { deps.nonce = typeof fn === 'function' ? fn : defaultDeps.nonce; }
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
  let sub = null;
  let email = null;
  let name = null;
  switch (p.name) {
    case 'github':
      // GitHub: numeric id, `login` handle, optional email.
      sub = u.id != null ? String(u.id) : null;
      email = u.email || null;
      name = u.name || u.login || null;
      break;
    case 'google':
      // Google OIDC userinfo: `sub`, `email`, `name`.
      sub = u.sub != null ? String(u.sub) : null;
      email = u.email || null;
      name = u.name || null;
      break;
    case 'discord':
      // Discord: snowflake `id`, `username`, optional email.
      sub = u.id != null ? String(u.id) : null;
      email = u.email || null;
      name = u.username || u.global_name || null;
      break;
    default:
      break;
  }
  return { provider: p.name, sub, email, name, raw: u };
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
    tokenResp = await deps.tokenExchange({
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
    profile = await deps.userInfo({
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
