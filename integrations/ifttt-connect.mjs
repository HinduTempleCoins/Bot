// ifttt-connect.mjs — the OAuth account-connection hub for the admin portal (queue: "OAuth
// all my accounts for IFTTT and everything").
//
// One place to connect the operator's external accounts (Google, GitHub, Discord, Slack, X,
// Reddit, Dropbox, …) via standard OAuth2 + PKCE, then hold each access token as a CAPABILITY
// GRANT — never as a caller-visible value. The load-bearing invariant matches the rest of the
// repo's secret handling (credential-store.mjs / secrets.mjs): a token that enters this hub
// NEVER leaves it as plaintext. handleCallback() exchanges a code for a token and STORES it as a
// grant; it returns only a public descriptor (name + scopes + status), never the raw token.
// listConnections() reports names/scopes/status, never secrets. revoke() removes a grant.
//
// This module is PURE logic + an INJECTABLE token store:
//   - authorizeUrl()   builds the provider's OAuth2 authorize URL (no network).
//   - handleCallback() exchanges a code via an INJECTED `exchange` fn and stores via an
//                      INJECTED `store` (so tests run fully offline).
//   - listConnections()/revoke() operate on the injected store.
//
// The default store is integrations/credential-store.mjs ({ store, list, revoke }), so a real
// admin portal connects an account and the token lands in the encrypted vault as a grant. Tests
// inject a fake store and a fake exchange, so no live OAuth and no real secrets are involved.
//
//   import { SERVICES, authorizeUrl, handleCallback, listConnections, revoke }
//     from './integrations/ifttt-connect.mjs'
//
//   const { url, state, codeVerifier } = authorizeUrl('github', {
//     clientId: 'abc', redirectUri: 'https://portal/cb',
//   });
//   // ...user authorizes, provider redirects back with ?code=...&state=...
//   const conn = await handleCallback('github', {
//     code, exchange: async ({ code, codeVerifier }) => realExchange(...),  // returns { access_token, ... }
//   });                                                 // conn = { name, scopes, status } — NO token
//   listConnections();      // [{ name, scopes, status }]  — NEVER secrets
//   revoke('github');
//
//   node integrations/ifttt-connect.mjs            # prints the service catalog (no secrets)

import crypto from 'node:crypto';

// ---- error type ------------------------------------------------------------

export class ConnectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConnectError';
  }
}

// ---- the connectable-service catalog --------------------------------------
//
// Each entry is PURE config: how to build that provider's OAuth2 authorize URL, the default
// scopes we request, and the token endpoint a real exchange would POST to. `pkce` marks
// providers that support/require PKCE (we always generate a verifier; for providers that ignore
// it the extra params are harmless, but we only attach the challenge when pkce is true).
export const SERVICES = Object.freeze({
  google: {
    name: 'google',
    authUrlTemplate: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
    pkce: true,
    // Google needs these to return a refresh token on first consent.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  github: {
    name: 'github',
    authUrlTemplate: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'repo'],
    pkce: false,
  },
  discord: {
    name: 'discord',
    authUrlTemplate: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: ['identify', 'guilds'],
    pkce: true,
  },
  slack: {
    name: 'slack',
    authUrlTemplate: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read'],
    pkce: false,
  },
  x: {
    name: 'x',
    authUrlTemplate: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    pkce: true, // X (Twitter) v2 OAuth2 requires PKCE
  },
  reddit: {
    name: 'reddit',
    authUrlTemplate: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scopes: ['identity', 'read', 'submit'],
    pkce: false,
    extraAuthParams: { duration: 'permanent' },
  },
  dropbox: {
    name: 'dropbox',
    authUrlTemplate: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: ['files.content.read', 'files.content.write'],
    pkce: true,
    extraAuthParams: { token_access_type: 'offline' },
  },
});

// ---- internal helpers ------------------------------------------------------

function resolveService(service) {
  const key = typeof service === 'string' ? service.toLowerCase() : '';
  const svc = SERVICES[key];
  if (!svc) {
    throw new ConnectError(
      `unknown service: ${String(service)} (known: ${Object.keys(SERVICES).join(', ')})`
    );
  }
  return svc;
}

// PKCE: high-entropy verifier + S256 challenge (RFC 7636). base64url, no padding.
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function makePkce() {
  const codeVerifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge: challenge, codeChallengeMethod: 'S256' };
}

// The default token store: the encrypted credential store. Tokens are held as capability grants
// there, never returned as plaintext. Imported lazily so tests can run without env/master-key
// setup and so importing this module never has side effects on the real vault.
let _defaultStore = null;
async function defaultStore() {
  if (_defaultStore) return _defaultStore;
  const cs = await import('./credential-store.mjs');
  _defaultStore = {
    store: cs.store,
    list: cs.list,
    revoke: cs.revoke,
  };
  return _defaultStore;
}

// A grant name namespaced so OAuth connections don't collide with other vault entries.
function grantName(svcName) {
  return `oauth:${svcName}`;
}

// ---- authorizeUrl (PURE) ---------------------------------------------------
//
// Build the provider's OAuth2 authorize URL with the service's scopes, a CSRF `state`, and (for
// PKCE providers) a code challenge. Returns { url, state, codeVerifier, scopes }. The caller must
// persist `state` + `codeVerifier` (e.g. in the portal session) to validate the callback and
// complete the exchange. No network, no secrets touched.
export function authorizeUrl(service, { clientId, redirectUri, state, scopes } = {}) {
  const svc = resolveService(service);
  if (!clientId) throw new ConnectError(`authorizeUrl(${svc.name}): clientId is required`);
  if (!redirectUri) throw new ConnectError(`authorizeUrl(${svc.name}): redirectUri is required`);

  const csrfState = state || b64url(crypto.randomBytes(16));
  const wantScopes = Array.isArray(scopes) && scopes.length ? scopes : svc.scopes;

  const u = new URL(svc.authUrlTemplate);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', wantScopes.join(' '));
  u.searchParams.set('state', csrfState);
  for (const [k, v] of Object.entries(svc.extraAuthParams || {})) {
    u.searchParams.set(k, v);
  }

  let codeVerifier = null;
  if (svc.pkce) {
    const pkce = makePkce();
    codeVerifier = pkce.codeVerifier;
    u.searchParams.set('code_challenge', pkce.codeChallenge);
    u.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
  }

  return { url: u.toString(), state: csrfState, codeVerifier, scopes: wantScopes };
}

// ---- handleCallback --------------------------------------------------------
//
// Turn an authorization `code` into a token (via the INJECTED `exchange` fn) and STORE it as a
// capability grant (via the injected/default store). NEVER returns the raw token to the caller —
// returns only the public connection descriptor { name, scopes, status }.
//
//   exchange({ code, codeVerifier, service, tokenUrl, redirectUri }) -> token-ish
//     where token-ish is the provider response, e.g. { access_token, refresh_token, scope, ... }
//     (or just a token string). The secret never leaves this function as a return value.
export async function handleCallback(
  service,
  { code, codeVerifier, redirectUri, exchange, store } = {}
) {
  const svc = resolveService(service);
  if (!code) throw new ConnectError(`handleCallback(${svc.name}): code is required`);
  if (typeof exchange !== 'function') {
    throw new ConnectError(`handleCallback(${svc.name}): an injectable exchange() fn is required`);
  }

  const tokenResp = await exchange({
    code,
    codeVerifier,
    redirectUri,
    service: svc.name,
    tokenUrl: svc.tokenUrl,
  });

  // Accept either a raw string token or a standard OAuth2 token response object.
  const accessToken =
    typeof tokenResp === 'string'
      ? tokenResp
      : tokenResp && (tokenResp.access_token || tokenResp.token);
  if (!accessToken) {
    throw new ConnectError(`handleCallback(${svc.name}): exchange returned no access token`);
  }

  // Scopes actually granted (provider may downscope); fall back to requested defaults.
  const grantedScopes =
    tokenResp && typeof tokenResp === 'object' && tokenResp.scope
      ? String(tokenResp.scope).split(/[\s,]+/).filter(Boolean)
      : svc.scopes;

  // The full token payload is the secret. It goes into the store and NOTHING ELSE.
  const secretPayload =
    typeof tokenResp === 'string' ? JSON.stringify({ access_token: accessToken }) : JSON.stringify(tokenResp);

  const sink = store || (await defaultStore());
  sink.store({
    name: grantName(svc.name),
    secret: secretPayload,
    scope: `oauth:${svc.name}:${grantedScopes.join(',')}`,
    cap: { service: svc.name, scopes: grantedScopes },
  });

  // Public descriptor only — never the token.
  return { name: svc.name, scopes: grantedScopes, status: 'connected' };
}

// ---- listConnections -------------------------------------------------------
//
// Report connected services: name + scopes + status. NEVER secrets/ciphertext. Reads from the
// injected (or default) store and surfaces only the oauth: grants this hub created.
export async function listConnections(store) {
  const src = store || (await defaultStore());
  const entries = src.list ? src.list() : [];
  return entries
    .filter((e) => typeof e.name === 'string' && e.name.startsWith('oauth:'))
    .map((e) => {
      const svcName = e.name.slice('oauth:'.length);
      const scopes = (e.cap && Array.isArray(e.cap.scopes) && e.cap.scopes) || [];
      return {
        name: svcName,
        scopes,
        status: e.revoked ? 'revoked' : 'connected',
      };
    });
}

// ---- revoke ----------------------------------------------------------------
//
// Remove (revoke) a service's grant. Returns true if a matching grant existed.
export async function revoke(service, store) {
  const svc = resolveService(service);
  const src = store || (await defaultStore());
  const name = grantName(svc.name);
  const existed = src.list ? src.list().some((e) => e.name === name) : false;
  if (src.revoke) src.revoke(name);
  return existed;
}

// ---- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('ifttt-connect.mjs')) {
  // Print the catalog only — names, scopes, endpoints. No secrets, no network.
  const rows = Object.values(SERVICES).map((s) => ({
    service: s.name,
    scopes: s.scopes.join(' '),
    pkce: s.pkce ? 'yes' : 'no',
    authUrl: s.authUrlTemplate,
  }));
  // eslint-disable-next-line no-console
  console.log('IFTTT-connect — connectable services (no secrets printed):');
  // eslint-disable-next-line no-console
  console.table(rows);
}
