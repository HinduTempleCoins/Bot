// pentecaust/melek-signer-login.mjs — "Login with MELEK" for Pentecaust via the MELEK-Signer REDIRECT flow.
//
// The browser is sent to the hosted signer page (signer.melek.salon/oauth2/authorize); the user types their
// password THERE, never on pentecaust.com. The signer redirects back to /auth/melek-signer/callback with a
// one-time code, which the server exchanges (POST /oauth2/token) for the verified account. Pentecaust never
// sees, forwards, or stores a password or a key. (The old prompt()-the-password-and-forward-it verifier is
// retired — operator directive "Make sure Melek Signer signs people into everything".)
//
// Two signer URLs on purpose:
//   - PUBLIC  (MELEK_SIGNER_PUBLIC_URL, default https://signer.melek.salon) — where the BROWSER goes. Must be
//     public; a box-internal URL here would redirect visitors to their own loopback.
//   - EXCHANGE (MELEK_SIGNER_URL, default = the public URL) — server→signer token exchange; may be box-internal.
//
// Registration on the signer: client_id 'pentecaust' (MELEK_SIGNER_CLIENT), redirect_uri
// https://pentecaust.com/auth/melek-signer/callback (PENTECAUST_SIGNER_REDIRECT_URI to override).
// House style: ESM, injectable fetch, soft-fail-never-throw.

import { authorizeUrl, exchangeCode } from '../integrations/melek-signer-oauth.mjs';
import { validAccountName } from '../signup/welcome-grant.mjs';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const PUBLIC_DEFAULT = 'https://signer.melek.salon';

export const clientId = () => env('MELEK_SIGNER_CLIENT', 'pentecaust');
export const publicSignerUrl = () => env('MELEK_SIGNER_PUBLIC_URL', PUBLIC_DEFAULT).replace(/\/$/, '');
export const exchangeSignerUrl = () => env('MELEK_SIGNER_URL', publicSignerUrl()).replace(/\/$/, '');
export const redirectUri = () => env('PENTECAUST_SIGNER_REDIRECT_URI',
  `${String(env('PENTECAUST_BASE_URL', env('BASE_URL', 'https://pentecaust.com'))).replace(/\/$/, '')}/auth/melek-signer/callback`);

/** Where the "Login with MELEK" button sends the browser. `state` is the CSRF nonce. */
export function signerAuthorizeUrl({ state, scope = 'identity' } = {}) {
  return authorizeUrl({ clientId: clientId(), scope, redirectUri: redirectUri(), state, url: publicSignerUrl() });
}

/**
 * Exchange the callback's one-time code for the verified MELEK account.
 * @returns {Promise<string|null>} lowercased account, or null on ANY failure (never throws).
 */
export async function completeSignerLogin(code, fetchImpl = globalThis.fetch) {
  if (!code) return null;
  try {
    const g = await exchangeCode({ clientId: clientId(), code: String(code), url: exchangeSignerUrl() }, fetchImpl);
    const acct = g && g.account ? String(g.account).trim().toLowerCase() : '';
    return acct && validAccountName(acct) ? acct : null;
  } catch { return null; }
}
