// melek-signer-oauth.mjs — shared "Login with MELEK" redirect flow (OAuth2 authorization-code).
//
// The HiveSigner-style hosted-login flow, reusable by EVERY page (the Auto, Pentecaust, wallet, pool, Move):
//   1. button → redirect the browser to authorizeUrl(...)  — the hosted page at signer.melek.salon
//   2. user enters their MELEK password ON THE SIGNER (the page never sees it) and approves the scopes
//   3. signer redirects back to <page>/melek-signer/callback?code=…&state=…
//   4. the page calls exchangeCode(...) → { account, token }  and starts a session
//
// State is a CSRF nonce the page mints before the redirect and verifies on the callback. House style:
// pure functions + injectable fetch, soft-fail (returns null, never throws).

const SIGNER_URL = () => process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon';

export function signerUrl() { return SIGNER_URL(); }

/** The "Login with MELEK" button target — where the browser is redirected to log in. */
export function authorizeUrl({ clientId, scope = 'identity', redirectUri, state, url } = {}) {
  if (!clientId) throw new Error('authorizeUrl: clientId required');
  const u = new URL(`${url || SIGNER_URL()}/oauth2/authorize`);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('scope', Array.isArray(scope) ? scope.join(' ') : String(scope));
  if (redirectUri) u.searchParams.set('redirect_uri', redirectUri);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

/**
 * Exchange the one-time code (from the callback query) for a bearer token + the verified account.
 * @returns {Promise<{account:string, token:string, scopes:string[]}|null>} null on any failure.
 */
export async function exchangeCode({ clientId, code, url } = {}, fetchImpl = fetch) {
  if (!clientId || !code) return null;
  try {
    const r = await fetchImpl(`${url || SIGNER_URL()}/oauth2/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, client_id: clientId }),
    });
    const j = await r.json().catch(() => null);
    if (!j || !j.access_token) return null;
    return {
      account: String(j.account || '').toLowerCase(),
      token: j.access_token,
      scopes: String(j.scope || '').split(/[ ,]+/).filter(Boolean),
    };
  } catch { return null; }
}
