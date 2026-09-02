// melek-oidc-provider.mjs — MELEK-Signer as a STANDARD OpenID Connect Provider (OP/IdP).
//
// THE UNLOCK: the signer already does a HiveSigner-style /oauth2/authorize + /oauth2/token. This module
// wraps that into a *conformant* OIDC surface so ANY ordinary website — and every WordPress/Shopify social-
// login plugin and every aggregator (Auth0/WorkOS/Keycloak/Passport) — can consume "Login with MELEK" with
// ZERO custom code. The research's #1 lesson: the moat is SAMENESS. Speak vanilla OIDC and the whole
// existing ecosystem distributes us for free.
//
// What it adds on top of the signer's OAuth:
//   - /.well-known/openid-configuration  (discovery)         → discoveryDocument()
//   - /oauth2/jwks                        (public signing key) → jwks()
//   - a signed ID Token (JWT, RS256)      in the token response → redeemToken()
//   - PKCE (S256) + `nonce`               (CSRF + token binding)
//   - /userinfo                           (profile claims)     → userinfo()
//
// The MELEK account NAME is the OIDC `sub` AND a built-in `preferred_username` — no ENS-style lookup
// (our edge over siwe-oidc). Subject type: public.
//
// ZERO CHAIN KEYS: the OP signs ID tokens with its OWN RSA signing key (an OIDC key, not a chain WIF).
// The "who is this user" step stays the signer's existing consent page. Everything here is pure +
// injectable (signing key, client registry, code store, claims resolver), offline-tested, soft-fail.
//
//   import * as oidc from './melek-oidc-provider.mjs'

import { createSign, createVerify, createHash, createPublicKey, randomBytes } from 'node:crypto';

// ── base64url + compact JWT (JWS, RS256) ────────────────────────────────────────────────────────
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64uJson = (obj) => b64u(Buffer.from(JSON.stringify(obj), 'utf8'));
const unb64uJson = (s) => JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));

/** Sign a JWT (RS256). privateKey: PEM string or KeyObject. Returns the compact token. */
export function signJwt(payload, { privateKey, kid, header = {} } = {}) {
  if (!privateKey) throw new Error('signJwt: privateKey required');
  const head = b64uJson({ alg: 'RS256', typ: 'JWT', ...(kid ? { kid } : {}), ...header });
  const body = b64uJson(payload);
  const data = `${head}.${body}`;
  const sig = createSign('sha256').update(data).sign(privateKey);
  return `${data}.${b64u(sig)}`;
}

/** Verify + decode a JWT (RS256). publicKey: PEM/JWK/KeyObject. Returns payload, or null on any failure. */
export function verifyJwt(token, { publicKey, now = Date.now() } = {}) {
  try {
    const [head, body, sig] = String(token || '').split('.');
    if (!head || !body || !sig) return null;
    const ok = createVerify('sha256').update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const payload = unb64uJson(body);
    const t = Math.floor(now / 1000);
    if (payload.exp != null && t >= payload.exp) return null;      // expired
    if (payload.nbf != null && t < payload.nbf) return null;
    return payload;
  } catch { return null; }
}

// ── discovery + JWKS ─────────────────────────────────────────────────────────────────────────────
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

/** The /.well-known/openid-configuration document. issuer = the OP's base URL. */
export function discoveryDocument(issuer) {
  const iss = trimSlash(issuer) || 'https://signer.melek.salon';
  return {
    issuer: iss,
    authorization_endpoint: `${iss}/oauth2/authorize`,
    token_endpoint: `${iss}/oauth2/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/oauth2/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256', 'plain'],
    claims_supported: ['sub', 'preferred_username', 'name', 'profile', 'picture', 'email', 'email_verified', 'iss', 'aud', 'exp', 'iat', 'nonce'],
  };
}

/** The public JWKS. publicKey: PEM string or KeyObject for the OP's RSA signing key. */
export function jwks({ publicKey, kid = 'melek-1' } = {}) {
  try {
    const ko = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    const jwk = ko.export({ format: 'jwk' });
    return { keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid }] };
  } catch { return { keys: [] }; }
}

// ── client registry + authorize-request validation ────────────────────────────────────────────────
/** Look up a registered client and confirm the redirect_uri is one it registered (exact match). */
export function validateClient(clients, clientId, redirectUri) {
  const list = Array.isArray(clients) ? clients : (clients ? Object.values(clients) : []);
  const c = list.find((x) => x && x.client_id === clientId);
  if (!c) return { ok: false, error: 'invalid_client' };
  const uris = c.redirect_uris || [];
  if (redirectUri != null && !uris.includes(redirectUri)) return { ok: false, error: 'invalid_redirect_uri' };
  return { ok: true, client: c };
}

const asScopes = (scope) => String(scope || '').split(/[ +]+/).filter(Boolean);

// MINIMAL PERMISSION — the load-bearing property of "distributing the Signer." The PUBLIC OIDC surface
// grants IDENTITY ONLY (who you are); it can NEVER hand a third-party site the ability to ACT as the user.
// These identity scopes are the only ones the OP will mint a login for. Any on-chain CAPABILITY scope
// (posting/active/owner/transfer/custom_json/vote/comment) is refused here — those require the Signer's
// SEPARATE first-party consent + a scoped broadcast token that a distributed OIDC client never receives.
export const IDENTITY_SCOPES = Object.freeze(['openid', 'profile', 'email', 'offline_access']);
export const CAPABILITY_SCOPES = Object.freeze(['posting', 'active', 'owner', 'transfer', 'custom_json', 'vote', 'comment', 'broadcast']);
/** True if a requested scope set stays within identity-only (no capability leak). */
export function isIdentityOnly(scope) {
  const s = asScopes(scope);
  return s.length > 0 && s.every((x) => IDENTITY_SCOPES.includes(x)) && !s.some((x) => CAPABILITY_SCOPES.includes(x));
}

/**
 * Validate an /oauth2/authorize request. Returns { ok, error?, params }. Enforces response_type=code,
 * a registered client + exact redirect_uri, and that `openid` is present in scope (it's an OIDC request).
 */
export function parseAuthorize(query, clients) {
  const q = query || {};
  const params = {
    response_type: q.response_type, client_id: q.client_id, redirect_uri: q.redirect_uri,
    scope: q.scope || 'openid', state: q.state, nonce: q.nonce,
    code_challenge: q.code_challenge, code_challenge_method: q.code_challenge_method || (q.code_challenge ? 'plain' : undefined),
  };
  if (params.response_type !== 'code') return { ok: false, error: 'unsupported_response_type', params };
  const cv = validateClient(clients, params.client_id, params.redirect_uri);
  if (!cv.ok) return { ok: false, error: cv.error, params };
  if (!asScopes(params.scope).includes('openid')) return { ok: false, error: 'invalid_scope', params };
  // Minimal permission: the distributable OIDC surface refuses any on-chain capability scope.
  if (!isIdentityOnly(params.scope)) return { ok: false, error: 'invalid_scope', params };
  if (params.code_challenge && !['S256', 'plain'].includes(params.code_challenge_method)) {
    return { ok: false, error: 'invalid_request', params };
  }
  return { ok: true, params, client: cv.client };
}

// ── authorization code issue/redeem ────────────────────────────────────────────────────────────────
// `store` is any Map-like { get(k), set(k,v), delete(k) }. Codes are one-time (deleted on redeem).

/**
 * Issue an authorization code for an ALREADY-AUTHENTICATED account (the signer's consent page proved it).
 * Returns { code, redirectTo } — redirectTo is the client redirect_uri with ?code=&state=.
 */
export function issueCode(store, { client_id, account, redirect_uri, scope, nonce, code_challenge, code_challenge_method, now = Date.now(), ttl = 600 } = {}) {
  if (!store || !client_id || !account || !redirect_uri) throw new Error('issueCode: store, client_id, account, redirect_uri required');
  if (!isIdentityOnly(scope || 'openid')) throw new Error('issueCode: minimal permission — identity scopes only (no on-chain capability via OIDC)');
  const code = b64u(randomBytes(32));
  store.set(code, {
    client_id, account: String(account).toLowerCase(), redirect_uri, scope: scope || 'openid',
    nonce: nonce || null, code_challenge: code_challenge || null, code_challenge_method: code_challenge_method || null,
    exp: Math.floor(now / 1000) + ttl,
  });
  const u = new URL(redirect_uri);
  u.searchParams.set('code', code);
  return { code, redirectTo: u.toString() };
}

function verifyPkce(rec, codeVerifier) {
  if (!rec.code_challenge) return true;                         // no PKCE was requested
  if (!codeVerifier) return false;
  if (rec.code_challenge_method === 'S256') {
    return b64u(createHash('sha256').update(codeVerifier).digest()) === rec.code_challenge;
  }
  return codeVerifier === rec.code_challenge;                   // plain
}

/**
 * The /oauth2/token grant_type=authorization_code exchange. Validates the code (exists, unexpired, one-time),
 * the client, redirect_uri, PKCE, and confidential-client secret; then returns the OIDC token response with
 * a signed ID Token. { ok, response } | { ok:false, error }.
 *
 * @param {object} opts { clients, issuer, privateKey, kid, claimsFor, now, accessTtl, idTtl }
 *   claimsFor(account, scopes) → extra claims (name/email/…); default emits preferred_username only.
 */
export function redeemToken(store, body = {}, opts = {}) {
  const { clients, issuer, privateKey, kid = 'melek-1', now = Date.now(), accessTtl = 3600, idTtl = 3600 } = opts;
  const claimsFor = opts.claimsFor || ((account) => ({ preferred_username: account }));
  if (body.grant_type !== 'authorization_code') return { ok: false, error: 'unsupported_grant_type' };
  const rec = store && store.get(body.code);
  if (!rec) return { ok: false, error: 'invalid_grant' };
  store.delete(body.code);                                       // one-time use, even on failure below
  if (rec.exp < Math.floor(now / 1000)) return { ok: false, error: 'invalid_grant' };
  if (rec.client_id !== body.client_id) return { ok: false, error: 'invalid_grant' };
  if (rec.redirect_uri !== body.redirect_uri) return { ok: false, error: 'invalid_grant' };
  const cv = validateClient(clients, body.client_id, body.redirect_uri);
  if (!cv.ok) return { ok: false, error: cv.error };
  if (cv.client.client_secret) {                                // confidential client → secret required
    if (body.client_secret !== cv.client.client_secret) return { ok: false, error: 'invalid_client' };
  }
  if (!verifyPkce(rec, body.code_verifier)) return { ok: false, error: 'invalid_grant' };

  const iss = trimSlash(issuer) || 'https://signer.melek.salon';
  const iat = Math.floor(now / 1000);
  const scopes = asScopes(rec.scope);
  const sub = rec.account;
  const extra = { ...claimsFor(sub, scopes) };
  const idClaims = {
    iss, sub, aud: rec.client_id, iat, exp: iat + idTtl, auth_time: iat,
    ...(rec.nonce ? { nonce: rec.nonce } : {}),
    preferred_username: sub, ...extra,
  };
  const id_token = signJwt(idClaims, { privateKey, kid });
  // Access token = a self-contained signed JWT so /userinfo needs no session store.
  const access_token = signJwt({ iss, sub, aud: 'userinfo', scope: rec.scope, iat, exp: iat + accessTtl, tok: 'at' }, { privateKey, kid });
  return {
    ok: true,
    response: { access_token, token_type: 'Bearer', expires_in: accessTtl, id_token, scope: rec.scope,
      // convenience for our own non-OIDC callers (parity with the signer's existing token response):
      account: sub },
  };
}

/**
 * /userinfo — verify the bearer access token (JWT) and return the profile claims for its subject.
 * Returns the claims object, or null if the token is missing/invalid/expired.
 */
export function userinfo(accessToken, { publicKey, issuer, now = Date.now(), claimsFor } = {}) {
  const payload = verifyJwt(accessToken, { publicKey, now });
  if (!payload || payload.tok !== 'at' || !payload.sub) return null;
  if (issuer && payload.iss !== trimSlash(issuer)) return null;
  const scopes = asScopes(payload.scope);
  const extra = (claimsFor ? claimsFor(payload.sub, scopes) : { preferred_username: payload.sub });
  return { sub: payload.sub, preferred_username: payload.sub, ...extra };
}

/**
 * Thin HTTP handler for the MACHINE endpoints (discovery, jwks, token, userinfo). The human /oauth2/authorize
 * step stays on the signer's consent page, which calls issueCode() after it authenticates the account.
 * opts: { issuer, publicKey, privateKey, kid, clients, store, claimsFor }. Never throws.
 */
export async function handler(req, res, opts = {}) {
  const send = (code, obj, type = 'application/json') => {
    try { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
    catch { /* headers already sent */ }
  };
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    if (req.method === 'GET' && p === '/.well-known/openid-configuration') return send(200, discoveryDocument(opts.issuer));
    if (req.method === 'GET' && (p === '/oauth2/jwks' || p === '/jwks.json')) return send(200, jwks({ publicKey: opts.publicKey, kid: opts.kid }));
    if (req.method === 'POST' && p === '/oauth2/token') {
      let raw = ''; for await (const ch of req) raw += ch;
      let body;
      try { body = req.headers['content-type']?.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw)); }
      catch { body = {}; }
      const r = redeemToken(opts.store, body, opts);
      return r.ok ? send(200, r.response) : send(400, { error: r.error });
    }
    if (p === '/userinfo') {
      const auth = String(req.headers.authorization || '');
      const tok = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('access_token');
      const claims = userinfo(tok, opts);
      return claims ? send(200, claims) : send(401, { error: 'invalid_token' });
    }
    return send(404, { error: 'not_found' });
  } catch { return send(500, { error: 'server_error' }); }
}
