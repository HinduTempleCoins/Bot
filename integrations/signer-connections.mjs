// signer-connections.mjs — third-party OAuth connections held per MELEK ACCOUNT, in MELEK-Signer.
//
// THE PROBLEM THIS SOLVES. Pentecaust connects a user's mailbox and other IdPs, and today it keeps
// the resulting refresh tokens itself — pentecaust/connect/mailbox.mjs says in its own header that a
// refresh token is "long-lived access to a user's mailbox — a high-value target." Two consequences:
// lose the cookie and the connection is gone, and compromise Pentecaust and you have every user's
// mailbox. Both are the same mistake: durable third-party credentials living in the app.
//
// THE SHAPE. The cookie becomes a CACHE, not the record. The record lives in MELEK-Signer, keyed by
// MELEK account. Log back in with MELEK and your connections are simply there — because the signer
// kept them, the way it already keeps chain keys. That is the operator's design, and the signer was
// already most of the way to it: it is the OAuth2 provider ("Login with MELEK"), it has per-account
// custody with roles, and token-persist.mjs is a 0600 AES-256-GCM sealed-at-rest store that survives
// restart. The one thing missing is that social-broker.mjs authenticates and then deliberately drops
// the IdP tokens — "it does NOT store IdP tokens".
//
// WHY THE SIGNER AND NOT A NEW SERVICE. The signer is the box already hardened for exactly this
// threat: secrets sealed at rest with an env-held key, opaque revocable handles out, nothing
// sensitive returned to a caller. Adding a second secret store elsewhere would mean hardening a
// second box to the same standard, and the second one is always the one that lags.
//
// WHAT NEVER CROSSES THE WIRE. A refresh token goes IN and is never handed back out. Callers get a
// public view — provider, account, scopes, when it was connected, whether it still works — and when
// they need to act they ask the signer to use the connection, the same contract as /v1/broadcast and
// /v1/evm: the capability moves, the credential does not.
//
// STORAGE IS INJECTED, so this is fully testable offline and the same module runs on either side of
// the wire without dragging a filesystem into a unit test.

const PROVIDERS = new Set(['google', 'github', 'discord', 'x', 'reddit', 'facebook', 'linkedin', 'microsoft']);

/** Opaque, revocable handle. Callers hold this; they never hold the credential it stands for. */
function handleFor(account, provider, rand) {
  return `conn_${provider}_${rand(9)}`;
}

const defaultRand = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');

/**
 * @param {{storage?:Map, now?:()=>number, rand?:(n:number)=>string}} deps
 *   storage — anything with get/set/delete/keys. In the signer this is the sealed persistent store;
 *   in tests it is a Map. Never a bare object, so an attacker-controlled provider name cannot reach
 *   Object.prototype.
 */
export function createConnectionStore({ storage = new Map(), now = () => Date.now(), rand = defaultRand } = {}) {
  const key = (account, provider) => `${String(account).toLowerCase()}::${String(provider).toLowerCase()}`;

  /** Everything a caller may see. Deliberately omits every token field. */
  function publicView(rec) {
    if (!rec) return null;
    return {
      account: rec.account,
      provider: rec.provider,
      handle: rec.handle,
      scopes: rec.scopes.slice(),
      identity: rec.identity ? { sub: rec.identity.sub, email: rec.identity.email, name: rec.identity.name } : null,
      connectedAt: rec.connectedAt,
      lastUsedAt: rec.lastUsedAt,
      expiresAt: rec.expiresAt,
      revoked: !!rec.revoked,
      healthy: !rec.revoked && (!rec.expiresAt || rec.expiresAt > now()),
    };
  }

  return {
    /**
     * Store a connection for a MELEK account. `refreshToken` goes in and is never returned by any
     * method on this object — connect() itself answers with the public view.
     */
    connect(account, provider, { refreshToken, accessToken = null, scopes = [], identity = null, expiresAt = null } = {}) {
      if (!account) return { ok: false, error: 'account required' };
      const p = String(provider || '').toLowerCase();
      if (!PROVIDERS.has(p)) return { ok: false, error: `unknown provider '${p}'` };
      if (!refreshToken || typeof refreshToken !== 'string') return { ok: false, error: 'refreshToken required' };

      const k = key(account, p);
      const prior = storage.get(k) || null;
      const rec = {
        account: String(account),
        provider: p,
        // A reconnect keeps the handle, so anything already pointing at this connection keeps working.
        handle: (prior && prior.handle) || handleFor(account, p, rand),
        refreshToken,
        accessToken,
        scopes: Array.isArray(scopes) ? scopes.map(String) : [],
        identity,
        connectedAt: (prior && prior.connectedAt) || new Date(now()).toISOString(),
        reconnectedAt: prior ? new Date(now()).toISOString() : null,
        lastUsedAt: null,
        expiresAt,
        revoked: false,
      };
      storage.set(k, rec);
      return { ok: true, connection: publicView(rec) };
    },

    /** What this account has connected. The answer Pentecaust needs after a cookie dies. */
    list(account) {
      const a = String(account).toLowerCase();
      const out = [];
      for (const k of [...storage.keys()]) {
        if (!k.startsWith(a + '::')) continue;
        const v = publicView(storage.get(k));
        if (v) out.push(v);
      }
      return out;
    },

    get(account, provider) { return publicView(storage.get(key(account, provider))); },

    /**
     * Hand the credential to a USE function without returning it. This is the whole point: the
     * caller gets the result of using the connection, never the connection itself. The token is
     * passed into `fn` and nothing here retains a reference to what `fn` does with it.
     */
    async use(account, provider, fn) {
      const rec = storage.get(key(account, provider));
      if (!rec) return { ok: false, error: 'not connected' };
      if (rec.revoked) return { ok: false, error: 'revoked' };
      if (rec.expiresAt && rec.expiresAt <= now()) return { ok: false, error: 'expired — reconnect' };
      if (typeof fn !== 'function') return { ok: false, error: 'use(fn) requires a function' };
      let result;
      try {
        result = await fn({ refreshToken: rec.refreshToken, accessToken: rec.accessToken, scopes: rec.scopes.slice() });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
      }
      rec.lastUsedAt = new Date(now()).toISOString();
      storage.set(key(account, provider), rec);
      return { ok: true, result };
    },

    /** Revoke without forgetting: the record stays so the history of a connection is not erased. */
    revoke(account, provider) {
      const k = key(account, provider);
      const rec = storage.get(k);
      if (!rec) return { ok: false, error: 'not connected' };
      rec.revoked = true;
      rec.refreshToken = null;
      rec.accessToken = null;
      rec.revokedAt = new Date(now()).toISOString();
      storage.set(k, rec);
      return { ok: true, connection: publicView(rec) };
    },

    /** Forget entirely — the user asked to be forgotten, not merely disconnected. */
    forget(account, provider) {
      const k = key(account, provider);
      if (!storage.has(k)) return { ok: false, error: 'not connected' };
      storage.delete(k);
      return { ok: true };
    },
  };
}

/**
 * The Pentecaust side. The cookie is a cache; this is what refills it. `fetchImpl` is injected so a
 * test never touches the network, and a signer that is down soft-fails to "no connections known"
 * rather than throwing a page over.
 */
export function createConnectionsClient({ url, token, fetchImpl = (...a) => fetch(...a) } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const call = async (path, body) => {
    if (!base || !token) return { ok: false, error: 'signer not configured' };
    try {
      const r = await fetchImpl(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => null);
      return j || { ok: false, error: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e).slice(0, 160) };
    }
  };
  return {
    list: () => call('/v1/connections/list', {}),
    get: (provider) => call('/v1/connections/get', { provider }),
    revoke: (provider) => call('/v1/connections/revoke', { provider }),
    configured: () => Boolean(base && token),
  };
}

export const CONNECTION_PROVIDERS = [...PROVIDERS];
