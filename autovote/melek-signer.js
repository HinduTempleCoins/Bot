/**
 * autovote/melek-signer.js — MELEK-Signer login + broadcast (the MELEK-chain signer).
 *
 * The MELEK-chain analogue of hivesigner.js. A MELEK user logs in with their account
 * name + password (the master password their keys derive from). We hand that to the
 * live MELEK-Signer, which verifies identity against the account's CURRENT on-chain key
 * and returns a revocable bearer TOKEN. The vote engine then broadcasts votes with that
 * token while the user is OFFLINE — the user never gives us a key and we never hold one:
 * the signer is the sole key custodian ("login → token → takeover", like HiveSigner).
 *
 *   authorize: POST {url}/oauth2/authorize  {client_id, scope, account, password} -> { code }
 *   token:     POST {url}/oauth2/token      {code, client_id}                     -> { access_token, account }
 *   broadcast: POST {url}/v1/broadcast      Bearer <token> { ops }                -> { ok, result }
 *
 * Unlike HiveSigner there is NO operator app-registration step — MELEK-Signer is our own
 * service (default on the box at 127.0.0.1:8211), so configured() is true whenever a URL
 * is set (it always defaults). House style: env-only config, injectable fetch, never throws
 * a key into a log.
 */

const URL_ = () => process.env.MELEK_SIGNER_URL || 'http://127.0.0.1:8211';
const CLIENT_ID = () => process.env.MELEK_SIGNER_CLIENT_ID || 'autovote';
const SCOPE = () => (process.env.MELEK_SIGNER_SCOPE || 'vote').split(/[ ,]+/).filter(Boolean);

export function msConfig() {
  return { url: URL_(), clientId: CLIENT_ID(), scope: SCOPE() };
}

/** MELEK-Signer is our own service with a default URL, so the method is always available. */
export function configured() { return !!URL_(); }

/**
 * Log in: verify {account, password} via MELEK-Signer and exchange the one-time code for a
 * bearer token. Returns { account, token } or throws (the caller soft-fails to a 401).
 */
export async function login({ account, password } = {}, fetchImpl = fetch) {
  const c = msConfig();
  const acct = String(account || '').trim().toLowerCase();
  if (!acct || !password) throw new Error('account and password required');
  // 1) authorize → one-time code (identity is verified against the on-chain key inside the signer)
  const aRes = await fetchImpl(`${c.url}/oauth2/authorize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: c.clientId, scope: c.scope.join(' '), account: acct, password }),
  });
  const a = await aRes.json().catch(() => ({}));
  if (!aRes.ok || !a.code) throw new Error((a && a.error) || 'MELEK-Signer did not verify this account / password');
  // 2) exchange code → revocable bearer token
  const tRes = await fetchImpl(`${c.url}/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: a.code, client_id: c.clientId }),
  });
  const t = await tRes.json().catch(() => ({}));
  if (!tRes.ok || !t.access_token) throw new Error((t && t.error) || 'MELEK-Signer token exchange failed');
  return { account: String(t.account || acct).toLowerCase(), token: t.access_token };
}

/** Broadcast ops with a user's bearer token (works while they're offline; policy-gated by the signer). */
export async function broadcast(token, ops, fetchImpl = fetch) {
  const c = msConfig();
  const res = await fetchImpl(`${c.url}/v1/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ops, client_ref: c.clientId, role: 'posting' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error((j && j.error) || `MELEK-Signer broadcast failed: ${res.status}`);
  return j.result;
}

/** Cast a single vote via MELEK-Signer (the shape the vote engine calls). */
export async function voteViaMelekSigner(token, { voter, author, permlink, weight }, fetchImpl = fetch) {
  const op = ['vote', { voter, author, permlink, weight }];
  return broadcast(token, [op], fetchImpl);
}

/** Revoke a token (user disconnects). */
export async function revoke(token, fetchImpl = fetch) {
  const c = msConfig();
  const res = await fetchImpl(`${c.url}/oauth2/token/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}
