/**
 * autovote/hivesigner.js — HiveSigner OAuth2 integration (Hive mainnet).
 *
 * Lets a Hive user authorize vote ops WITHOUT giving us a key: they OAuth into
 * HiveSigner with the `vote` scope; HiveSigner returns a revocable bearer token
 * our server uses to broadcast votes on their behalf — even while they're
 * offline (this is why HiveSigner, not WhaleVault, backs scheduled voting).
 *
 * Studied from the reference SDK at /workspaces/hivesigner (READ-ONLY). We don't
 * vendor the SDK; this is a tiny fetch wrapper around the same endpoints:
 *   - authorize:  GET  https://hivesigner.com/oauth2/authorize
 *   - token:      POST https://hivesigner.com/api/oauth2/token        (code -> access_token)
 *   - broadcast:  POST https://hivesigner.com/api/broadcast           (Authorization: <access_token>)
 *   - me:         POST https://hivesigner.com/api/me
 *   - revoke:     POST https://hivesigner.com/api/oauth2/token/revoke
 *
 * ── APP REGISTRATION (operator-gated) ──────────────────────────────────────
 * HiveSigner requires an app account registered on hivesigner.com. Until the
 * operator registers it and sets HIVESIGNER_APP (+ secret + callback URL), this
 * module reports `configured() === false` and the UI shows a "pending app
 * registration" state instead of a broken login. See .local/AUTOVOTE_SIGNERS_SETUP.md.
 * ───────────────────────────────────────────────────────────────────────────
 */

const BASE = process.env.HIVESIGNER_BASE || 'https://hivesigner.com';
const API = `${BASE}/api`;

export function hsConfig() {
  return {
    app: process.env.HIVESIGNER_APP || null, // the registered app account, e.g. "autovote.app"
    secret: process.env.HIVESIGNER_SECRET || null, // client secret (for code->token exchange)
    callback: process.env.HIVESIGNER_CALLBACK || null, // e.g. https://auto.alpha.melek.salon/hivesigner/callback
    scope: (process.env.HIVESIGNER_SCOPE || 'vote').split(',').map((s) => s.trim()).filter(Boolean),
    base: BASE,
  };
}

/** True only when the operator has registered the app and set the env. */
export function configured() {
  const c = hsConfig();
  return !!(c.app && c.callback);
}

/** Build the authorize URL the user's browser is redirected to. */
export function getLoginURL(state) {
  const c = hsConfig();
  if (!configured()) return null;
  const u = new URL(`${BASE}/oauth2/authorize`);
  u.searchParams.set('client_id', c.app);
  u.searchParams.set('redirect_uri', c.callback);
  u.searchParams.set('response_type', 'code');
  if (c.scope.length) u.searchParams.set('scope', c.scope.join(','));
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

/**
 * Exchange the `code` from the callback for an access token.
 * Returns { access_token, username, expires_in, ... } or throws.
 */
export async function exchangeCode(code, fetchImpl = fetch) {
  const c = hsConfig();
  if (!configured()) throw new Error('hivesigner not configured');
  if (!c.secret) throw new Error('hivesigner secret missing (HIVESIGNER_SECRET)');
  const res = await fetchImpl(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_secret: c.secret,
      scope: c.scope.join(','),
    }),
  });
  if (!res.ok) throw new Error(`hivesigner token exchange failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('hivesigner: no access_token in response');
  return data;
}

/** Resolve the account name for a token (the `me` endpoint). */
export async function me(accessToken, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: accessToken },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`hivesigner me failed: ${res.status}`);
  return res.json();
}

/**
 * Broadcast operations on the user's behalf using their bearer token.
 * This is what the vote engine calls for HiveSigner-authed users — it works
 * while the user is offline.
 */
export async function broadcast(accessToken, operations, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: accessToken },
    body: JSON.stringify({ operations }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch {}
    throw new Error(`hivesigner broadcast failed: ${res.status} ${detail}`);
  }
  return res.json();
}

/** Revoke a token (user disconnects). */
export async function revoke(accessToken, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: accessToken },
    body: JSON.stringify({ token: accessToken }),
  });
  return res.ok;
}

/** Cast a single vote via HiveSigner. */
export async function voteViaHiveSigner(accessToken, { voter, author, permlink, weight }, fetchImpl = fetch) {
  const op = ['vote', { voter, author, permlink, weight }];
  return broadcast(accessToken, [op], fetchImpl);
}
