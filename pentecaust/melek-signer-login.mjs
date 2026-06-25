// pentecaust/melek-signer-login.mjs — "Login with MELEK" for Pentecaust via MELEK-Signer.
//
// Pentecaust's auth.mjs exposes registerMethod('melek-signer', verifyFn); POST /auth/method/melek-signer
// runs verifyFn(req, body) and, on a truthy account, mints the session. This verifyFn proves the login by
// asking the deployed MELEK-Signer to authenticate {account, password}: the signer derives the account's
// keys from the password and checks them against the on-chain key (see melek-signer/src/login.mjs). A `code`
// back = verified. NO private key is handled here — the password is forwarded to the signer over the
// box-internal URL and never logged. House style: ESM, injectable fetch, soft-fail-never-throw.

const SIGNER_URL = () => process.env.MELEK_SIGNER_URL || 'http://127.0.0.1:8211';
const CLIENT_ID = () => process.env.MELEK_SIGNER_CLIENT || 'pentecaust';

/**
 * Build the verifyFn to hand to registerMethod('melek-signer', fn).
 * @param {{ fetch?:Function, signerUrl?:string, clientId?:string }} [deps]
 */
export function makeMelekSignerVerify({ fetch: f = globalThis.fetch, signerUrl = SIGNER_URL(), clientId = CLIENT_ID() } = {}) {
  return async function verify(_req, body) {
    const account = String((body && body.account) || '').trim().toLowerCase();
    const password = body && body.password;
    if (!account || !password) return null;
    try {
      const r = await f(`${signerUrl}/oauth2/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, scope: 'identity', account, password }),
      });
      const j = await r.json().catch(() => null);
      return j && j.code ? account : null; // a code back from the signer = password verified against the chain
    } catch {
      return null; // signer unreachable → fail closed (no login), never throw
    }
  };
}

/** Convenience: register the method on a given auth module. Returns true if registered. */
export function installMelekSignerLogin(auth, deps) {
  if (!auth || typeof auth.registerMethod !== 'function') return false;
  return auth.registerMethod('melek-signer', makeMelekSignerVerify(deps));
}
