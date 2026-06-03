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
  // --- task #208: everything IFTTT-style automation needs to connect ---------
  yahoo: {
    name: 'yahoo',
    // Yahoo OAuth2 (api.login.yahoo.com). This is ALSO the admin's backup email identity —
    // connecting it here kills the recurring "what's the Yahoo password" problem: the token
    // becomes a capability grant in the vault, no password handling anywhere.
    authUrlTemplate: 'https://api.login.yahoo.com/oauth2/request_auth',
    tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
    scopes: ['openid', 'email', 'mail-r'], // mail-r = Yahoo Mail read
    pkce: true,
    category: 'email',
    notes: 'Yahoo OAuth2; also the operator backup email identity. mail-r = Mail read scope.',
  },
  microsoft: {
    name: 'microsoft',
    // Microsoft identity platform (login.microsoftonline.com, /common tenant). Outlook mail +
    // OneDrive files, read-mostly defaults. offline_access for refresh tokens.
    authUrlTemplate: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'offline_access', 'Mail.Read', 'Files.Read'],
    pkce: true,
    category: 'email',
    notes: 'Microsoft identity (Outlook Mail.Read + OneDrive Files.Read), common tenant.',
  },
  spotify: {
    name: 'spotify',
    authUrlTemplate: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scopes: ['user-read-email', 'user-read-recently-played', 'playlist-read-private'],
    pkce: true,
    category: 'media',
    notes: 'Spotify OAuth2 (PKCE), read-mostly listening/playlist scopes.',
  },
  twitch: {
    name: 'twitch',
    authUrlTemplate: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    scopes: ['user:read:email', 'user:read:follows'],
    pkce: false,
    category: 'media',
    notes: 'Twitch OAuth2, read-mostly user scopes.',
  },
  linkedin: {
    name: 'linkedin',
    authUrlTemplate: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'email'],
    pkce: false,
    category: 'social',
    notes: 'LinkedIn OAuth2 (OpenID Connect), profile + email read.',
  },
  notion: {
    name: 'notion',
    // Notion uses a fixed-capability OAuth (no scope param); kept here for the connect hub.
    authUrlTemplate: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: ['read_content', 'insert_content'],
    pkce: false,
    category: 'productivity',
    extraAuthParams: { owner: 'user' },
    notes: 'Notion OAuth2; capabilities are set on the integration, not via the scope param.',
  },
  todoist: {
    name: 'todoist',
    authUrlTemplate: 'https://todoist.com/oauth/authorize',
    tokenUrl: 'https://todoist.com/oauth/access_token',
    scopes: ['data:read', 'data:read_write'],
    pkce: false,
    category: 'productivity',
    notes: 'Todoist OAuth2, read + read_write task scopes.',
  },
});

// Category for the admin UI table. Falls back to the SERVICES entry's own `category`, then a
// name-based default, so every service has a stable bucket without per-service duplication.
const CATEGORY_DEFAULTS = Object.freeze({
  google: 'email',
  yahoo: 'email',
  microsoft: 'email',
  dropbox: 'storage',
  github: 'productivity',
  discord: 'social',
  slack: 'social',
  x: 'social',
  reddit: 'social',
  linkedin: 'social',
  spotify: 'media',
  twitch: 'media',
  notion: 'productivity',
  todoist: 'productivity',
});

function categoryOf(svc) {
  return svc.category || CATEGORY_DEFAULTS[svc.name] || 'productivity';
}

// The env-var that holds a service's OAuth client id, by the repo-wide <NAME>_CLIENT_ID
// convention (the admin server uses the same). Names only — never a secret literal.
function clientIdEnvName(svcName) {
  return `${svcName.toUpperCase()}_CLIENT_ID`;
}

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

// ---- serviceCatalog (admin UI table) ---------------------------------------
//
// Build the row model the admin /connect table renders: every connectable service with its
// default scopes, category, whether a client id is CONFIGURED (its <NAME>_CLIENT_ID env is set),
// and whether it's currently CONNECTED (a grant exists). The connection lookup soft-fails — if
// the store is unreachable, every service simply shows connected:false rather than throwing, so
// the catalog always renders. NEVER touches secrets.
export async function serviceCatalog(store) {
  let connectedNames = new Set();
  try {
    const conns = await listConnections(store);
    connectedNames = new Set(
      conns.filter((c) => c.status === 'connected').map((c) => c.name)
    );
  } catch {
    // soft-fail: leave everything as not-connected
  }
  return Object.values(SERVICES).map((svc) => ({
    name: svc.name,
    scopes: [...svc.scopes],
    category: categoryOf(svc),
    configured: Boolean(process.env[clientIdEnvName(svc.name)]),
    connected: connectedNames.has(svc.name),
  }));
}

// ---- recipePrereqs (what must I connect for this automation?) ---------------
//
// Given a simple recipe descriptor — { trigger: 'gmail.new_email', action: 'notion.add_row' } —
// return the connectable services that must be linked first. The service is the prefix before the
// first dot (e.g. 'gmail.new_email' -> 'gmail'). Common provider aliases are normalized to the
// SERVICES key (gmail/gcal/gdrive -> google, outlook/onedrive -> microsoft, twitter -> x), and a
// prefix that maps to no known service is reported under `unknown` rather than silently dropped.
// Accepts `trigger`/`action` plus any extra fields shaped like `<role>: '<service>.<event>'`,
// and a `services: [...]` array, so it works for multi-step recipes too. PURE — no store, no net.
const RECIPE_ALIASES = Object.freeze({
  gmail: 'google',
  gcal: 'google',
  googlecalendar: 'google',
  gdrive: 'google',
  googledrive: 'google',
  youtube: 'google',
  outlook: 'microsoft',
  onedrive: 'microsoft',
  office365: 'microsoft',
  msft: 'microsoft',
  twitter: 'x',
});

function recipeServiceKey(token) {
  if (typeof token !== 'string' || !token) return null;
  const prefix = token.split('.')[0].trim().toLowerCase();
  if (!prefix) return null;
  return RECIPE_ALIASES[prefix] || prefix;
}

export function recipePrereqs(recipe = {}) {
  const tokens = [];
  for (const [k, v] of Object.entries(recipe)) {
    if (k === 'services' && Array.isArray(v)) {
      for (const s of v) tokens.push(s);
    } else if (typeof v === 'string') {
      tokens.push(v);
    }
  }

  const required = [];
  const unknown = [];
  const seen = new Set();
  for (const tok of tokens) {
    const key = recipeServiceKey(tok);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (SERVICES[key]) required.push(key);
    else unknown.push(key);
  }
  return { required, unknown };
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
