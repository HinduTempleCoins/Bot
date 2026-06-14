// integrations/hivesigner-auth.mjs — INERT HiveSigner OAuth execution path for MELEK's
// autovote + trade bots. Scoped, revocable OAuth token in place of a WIF private key.
//
// ★ KEY-CUSTODY INVARIANT (load-bearing — BRIEF.md §7, MELEK_SIGNER.md):
//   This module NEVER holds, reads, requires, or returns a private key (WIF). It is a thin
//   fetch wrapper around HiveSigner's OAuth2 endpoints. The bearer token it exchanges for is
//   OPAQUE and REVOCABLE by the user at hivesigner.com — our server only ever holds a
//   scope-limited token (`vote` for autovote; `market`+`transfer` for trade). It cannot post,
//   change keys, or move funds outside the granted scope.
//
// ★ INERT WITHOUT CREDENTIALS:
//   Until the operator registers a HiveSigner app and sets HIVESIGNER_APP + HIVESIGNER_SECRET
//   in the env, isConfigured() === false and EVERY action returns the soft-fail shape
//   { ok:false, reason:'hivesigner-not-configured' } — NO throw, NO key, NO network call.
//   See integrations/HIVESIGNER_SETUP.md for the operator activation steps.
//
// House style: ESM .mjs, injectable fetch (no ambient network in tests), soft-fail-never-throw,
// secrets only from env, handler(req,res) export, CLI guarded by process.argv[1].
//
//   import { isConfigured, authorizeUrl, exchangeCode, broadcastWithToken } from './hivesigner-auth.mjs'
//   node integrations/hivesigner-auth.mjs            # prints the configured/inert status

// Default endpoints (reference: /workspaces/hivesigner, read-only). HIVESIGNER_BASE lets us
// point at a self-hosted hivesigner-api instance later without code changes.
const BASE = process.env.HIVESIGNER_BASE || 'https://hivesigner.com';
const API = `${BASE}/api`;

const NOT_CONFIGURED = { ok: false, reason: 'hivesigner-not-configured' };

/** Read the (env-only) config. Never contains a private key — only an app id + client secret. */
export function hsConfig() {
  const scope = String(process.env.HIVESIGNER_SCOPE || 'vote')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    app: process.env.HIVESIGNER_APP || null, // registered app account, e.g. "autovote.app"
    secret: process.env.HIVESIGNER_SECRET || null, // client secret for code->token exchange
    callback: process.env.HIVESIGNER_CALLBACK || null, // e.g. auto.alpha.melek.salon/hivesigner/callback
    scope: scope.length ? scope : ['vote'],
    base: BASE,
  };
}

/**
 * True ONLY when the operator has registered the app and set BOTH HIVESIGNER_APP and
 * HIVESIGNER_SECRET. The secret is required because no token exchange (and therefore no
 * broadcast) is possible without it — so without it the whole path is inert.
 */
export function isConfigured() {
  const c = hsConfig();
  return !!(c.app && c.secret);
}

/**
 * Build the HiveSigner OAuth2 authorize URL the user's browser is redirected to.
 * Returns { ok:true, url } or the not-configured soft-fail shape. Never throws.
 *
 * @param {{scope?:string|string[], state?:string, callback?:string, account?:string}} [opts]
 */
export function authorizeUrl(opts = {}) {
  if (!isConfigured()) return { ...NOT_CONFIGURED };
  try {
    const c = hsConfig();
    const callback = opts.callback || c.callback;
    if (!callback) return { ok: false, reason: 'hivesigner-no-callback' };

    const scope = normalizeScope(opts.scope, c.scope);
    const u = new URL(`${BASE}/oauth2/authorize`);
    u.searchParams.set('client_id', c.app);
    u.searchParams.set('redirect_uri', callback);
    u.searchParams.set('response_type', 'code');
    if (scope.length) u.searchParams.set('scope', scope.join(','));
    if (opts.state) u.searchParams.set('state', String(opts.state));
    if (opts.account) u.searchParams.set('account', String(opts.account));
    return { ok: true, url: u.toString(), scope };
  } catch (err) {
    return { ok: false, reason: 'hivesigner-authorize-url-error', detail: String(err?.message || err) };
  }
}

/**
 * Exchange the `code` from the OAuth callback for a scoped, revocable access token.
 * Injectable fetch (tests pass a mock; no ambient network). Soft-fails — never throws.
 * Returns { ok:true, token, username, expiresIn, raw } or { ok:false, reason }.
 */
export async function exchangeCode(code, fetchImpl = fetch) {
  if (!isConfigured()) return { ...NOT_CONFIGURED };
  if (!code) return { ok: false, reason: 'hivesigner-no-code' };
  try {
    const c = hsConfig();
    const res = await fetchImpl(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_secret: c.secret, scope: c.scope.join(',') }),
    });
    if (!res || !res.ok) {
      return { ok: false, reason: 'hivesigner-token-exchange-failed', status: res?.status ?? null };
    }
    const data = await res.json();
    if (!data || !data.access_token) {
      return { ok: false, reason: 'hivesigner-no-access-token' };
    }
    return {
      ok: true,
      token: data.access_token,
      username: data.username || null,
      expiresIn: data.expires_in ?? null,
      raw: data,
    };
  } catch (err) {
    return { ok: false, reason: 'hivesigner-token-exchange-error', detail: String(err?.message || err) };
  }
}

/**
 * Broadcast operations on the user's behalf using their OPAQUE bearer token.
 * This is the WIF-free signing path: HiveSigner holds the key; we send ops + the token.
 * Injectable fetch. Soft-fails — never throws. Returns { ok:true, result } or { ok:false, reason }.
 *
 * @param {string} token  the user's revocable HiveSigner access token (NOT a private key)
 * @param {Array}  ops    Graphene operations, e.g. [['vote', {voter,author,permlink,weight}]]
 */
export async function broadcastWithToken(token, ops, fetchImpl = fetch) {
  if (!isConfigured()) return { ...NOT_CONFIGURED };
  if (!token) return { ok: false, reason: 'hivesigner-no-token' };
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, reason: 'hivesigner-no-ops' };
  try {
    const res = await fetchImpl(`${API}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ operations: ops }),
    });
    if (!res || !res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()); } catch { /* soft */ }
      return { ok: false, reason: 'hivesigner-broadcast-failed', status: res?.status ?? null, detail };
    }
    const result = await res.json();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, reason: 'hivesigner-broadcast-error', detail: String(err?.message || err) };
  }
}

// ---- helpers ---------------------------------------------------------------

function normalizeScope(scope, fallback) {
  if (scope == null) return fallback.slice();
  const list = Array.isArray(scope) ? scope : String(scope).split(',');
  const cleaned = list.map((s) => String(s).trim()).filter(Boolean);
  return cleaned.length ? cleaned : fallback.slice();
}

function parseQuery(url) {
  const q = {};
  const i = String(url || '').indexOf('?');
  if (i < 0) return q;
  for (const [k, v] of new URLSearchParams(url.slice(i + 1))) q[k] = v;
  return q;
}

function pathOf(url) {
  const s = String(url || '');
  const i = s.indexOf('?');
  return i < 0 ? s : s.slice(0, i);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---- HTTP handler (additive; does NOT touch the live autovote signing path) ----
//
//   GET /hivesigner/login?scope=vote   -> 302 to the authorize URL, or 503 not-configured
//   GET /hivesigner/callback?code=...  -> exchange code -> return token JSON (caller stores it
//                                         per the existing autovote session pattern)
//
// Soft-fails on every path. Holds no key. The caller owns server-side token storage; this
// handler returns the exchanged token so it can be persisted with the existing session model.
export async function handler(req, res) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const url = req.url || '/';
    const route = pathOf(url);
    const query = parseQuery(url);

    if (route === '/hivesigner/login' && method === 'GET') {
      if (!isConfigured()) return sendJson(res, 503, { ...NOT_CONFIGURED });
      const built = authorizeUrl({ scope: query.scope, state: query.state, account: query.account });
      if (!built.ok) return sendJson(res, 503, built);
      res.writeHead(302, { Location: built.url });
      res.end();
      return;
    }

    if (route === '/hivesigner/callback' && method === 'GET') {
      if (!isConfigured()) return sendJson(res, 503, { ...NOT_CONFIGURED });
      const out = await exchangeCode(query.code);
      // 200 carries the token for the caller to store server-side; non-fatal failures are 400.
      return sendJson(res, out.ok ? 200 : 400, out);
    }

    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch (err) {
    // Last-resort soft-fail: never throw out of the handler.
    try { sendJson(res, 500, { ok: false, reason: 'hivesigner-handler-error', detail: String(err?.message || err) }); }
    catch { /* response already sent */ }
  }
}

// ---- CLI status (no network, no keys) --------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const c = hsConfig();
  const status = {
    configured: isConfigured(),
    app: c.app,
    callback: c.callback,
    scope: c.scope,
    base: c.base,
    secretPresent: !!c.secret, // never print the secret itself
  };
  console.log('[hivesigner-auth]', JSON.stringify(status, null, 2));
  if (!isConfigured()) {
    console.log('INERT: set HIVESIGNER_APP + HIVESIGNER_SECRET to activate. See integrations/HIVESIGNER_SETUP.md');
  }
}
