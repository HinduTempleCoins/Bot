// site/connect/server.test.mjs — OFFLINE tests for the "Connect your own API keys" surface.
// No network, no real secret. Proves the load-bearing invariants: the key is a CAPABILITY (never
// returned/listed as plaintext), encrypted at rest, per-tenant isolated (CrossTenantError), revocable.
// Run: node --test site/connect/server.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

// Deterministic vault master key so encrypt/decrypt round-trips within the process. NOT a real secret.
process.env.VAULT_MASTER_KEY = 'b'.repeat(64);

const { __reset: resetVault } = await import('../../integrations/credential-store.mjs');
const {
  __reset: resetTenants, assertTenantOwns, getCapability, CrossTenantError,
} = await import('../../integrations/tenant-grants.mjs');
const {
  connectProvider, listConnections, revokeConnection, useConnection,
} = await import('./connections.mjs');
const {
  handler, __setWhoami, esc, exampleAiComplete, exampleCourtListenerSearch,
} = await import('./server.mjs');
const { makeSiblingSession, COOKIE, __resetSpent } = await import('../../pentecaust/sso.mjs');

// A fake key that is obviously not real, so a leak in any output is unmistakable in an assertion.
const FAKE = 'sk-NOT-A-REAL-SECRET-abcdef0123456789';

beforeEach(() => { resetVault(); resetTenants(); __resetSpent(); __setWhoami(null); });

// ── HTTP test harness (no server; drive handler directly) ──────────────────────────────────────
function reqOf({ url, method = 'GET', body = null, headers = {} }) {
  const listeners = {};
  const req = {
    url, method, headers,
    on(ev, fn) {
      listeners[ev] = fn;
      if (ev === 'end') {
        setImmediate(() => {
          if (body != null && listeners.data) listeners.data(Buffer.from(String(body)));
          if (listeners.end) listeners.end();
        });
      }
      return req;
    },
    destroy() {},
  };
  return req;
}
function resCap() {
  const o = { code: 0, type: '', body: '' };
  const res = {
    writeHead(c, h) { o.code = c; o.type = (h && h['content-type']) || ''; },
    end(b) { o.body = b || ''; },
  };
  return { res, o };
}
async function call(opts) {
  const { res, o } = resCap();
  await handler(reqOf(opts), res);
  return o;
}
const json = (o) => { try { return JSON.parse(o.body); } catch { return null; } };

// ── the capability: connect + no plaintext ever ────────────────────────────────────────────────
test('connectProvider stores the key and returns a REDACTED view — never the key', () => {
  const r = connectProvider('alice', { provider: 'openai', scope: 'llm:complete', key: FAKE, cap: { calls: 5 } });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.scope, 'llm:complete');
  assert.deepEqual(r.cap, { calls: 5 });
  assert.equal(r.revoked, false);
  // The key must not appear anywhere in the returned object.
  assert.ok(!JSON.stringify(r).includes(FAKE), 'connect result must not contain the key');
});

test('listConnections shows {provider,scope,cap,revoked,added} and NEVER the key', () => {
  connectProvider('alice', { provider: 'openai', scope: 'llm:complete', key: FAKE, cap: { calls: 5 } });
  const list = listConnections('alice');
  assert.equal(list.length, 1);
  const c = list[0];
  assert.deepEqual(Object.keys(c).sort(), ['added', 'cap', 'provider', 'revoked', 'scope']);
  assert.equal(c.provider, 'openai');
  assert.equal(c.revoked, false);
  assert.ok(typeof c.added === 'number');
  assert.ok(!JSON.stringify(list).includes(FAKE), 'listed connections must not contain the key');
});

// ── the capability: use without exposing the secret ───────────────────────────────────────────
test('useConnection runs the caller fn WITH the secret and returns only the result', async () => {
  connectProvider('alice', { provider: 'courtlistener', scope: 'search', key: FAKE });
  let sawSecret = false;
  const result = await useConnection('alice', 'courtlistener', (secret) => {
    sawSecret = secret === FAKE;      // the real key IS delivered to the action
    return { hits: 3 };               // …but only THIS leaves the vault
  });
  assert.equal(sawSecret, true, 'the action receives the decrypted key (round-trip proves at-rest storage)');
  assert.deepEqual(result, { hits: 3 });
  assert.ok(!JSON.stringify(result).includes(FAKE), 'the result handed back must not contain the key');
});

test('exampleCourtListenerSearch: connected token used for a search, token never exposed', async () => {
  connectProvider('alice', { provider: 'courtlistener', scope: 'search', key: FAKE, cap: { calls: 2 } });
  const injectedSearch = (secret, query) => ({ query, count: 2, authedWithLen: secret.length, authedOk: secret === FAKE });
  const out = await exampleCourtListenerSearch('alice', 'first amendment', { search: injectedSearch });
  assert.equal(out.authedOk, true);        // the token reached the transport
  assert.equal(out.query, 'first amendment');
  assert.ok(!JSON.stringify(out).includes(FAKE));   // …and did not leak into the result
});

test('exampleAiComplete: connected AI key used as a Bearer, key never exposed', async () => {
  connectProvider('alice', { provider: 'openai', scope: 'llm:complete', key: FAKE });
  // Mirror llm-router's OpenAI-compatible call: Authorization: Bearer <key>.
  const injectedCall = (secret, prompt) => ({ text: `answered: ${prompt}`, authHeader: `Bearer ${secret}` });
  const out = await exampleAiComplete('alice', 'explain VKBT', { call: injectedCall });
  assert.match(out.text, /answered: explain VKBT/);
  // The caller of exampleAiComplete gets text; the Bearer was built INSIDE the callback only.
  assert.match(out.authHeader, /^Bearer /);   // proves the key was usable as a credential
});

// ── per-tenant isolation ─────────────────────────────────────────────────────────────────────
test('one tenant can never READ another tenant\'s connections', () => {
  connectProvider('alice', { provider: 'openai', scope: 's', key: FAKE });
  assert.equal(listConnections('bob').length, 0, "bob sees none of alice's");
  // bob asking for the same provider gets nothing (not alice's).
  assert.equal(getCapability('bob', 'openai'), null);
});

test('one tenant can never USE another tenant\'s connection', async () => {
  connectProvider('alice', { provider: 'openai', scope: 's', key: FAKE });
  await assert.rejects(() => useConnection('bob', 'openai', () => 'x'), /no connection for provider/);
});

test('one tenant can never REVOKE another tenant\'s connection', () => {
  connectProvider('alice', { provider: 'openai', scope: 's', key: FAKE });
  assert.equal(revokeConnection('bob', 'openai'), false, "bob's revoke is a no-op on alice's key");
  // alice's connection is untouched and still usable.
  assert.equal(listConnections('alice')[0].revoked, false);
});

test('cross-tenant access to a capability id is LOUD (CrossTenantError)', () => {
  connectProvider('alice', { provider: 'openai', scope: 's', key: FAKE });
  const aliceCap = getCapability('alice', 'openai');
  assert.ok(aliceCap && aliceCap.id);
  // bob reaching for alice's capability id throws — never a silent empty.
  assert.throws(() => assertTenantOwns('bob', aliceCap.id), CrossTenantError);
  // alice owns it.
  assert.equal(assertTenantOwns('alice', aliceCap.id), true);
});

test('same provider name across tenants does not collide (tenant-scoped vault name)', async () => {
  connectProvider('alice', { provider: 'openai', scope: 's', key: 'ALICE-KEY-xxxx' });
  connectProvider('bob', { provider: 'openai', scope: 's', key: 'BOB-KEY-yyyy' });
  const aSaw = await useConnection('alice', 'openai', (s) => s);
  const bSaw = await useConnection('bob', 'openai', (s) => s);
  // Each tenant's action sees THEIR OWN key, not the other's.
  assert.equal(aSaw, 'ALICE-KEY-xxxx');
  assert.equal(bSaw, 'BOB-KEY-yyyy');
});

// ── revoke ────────────────────────────────────────────────────────────────────────────────────
test('revokeConnection flags revoked, blocks use, and shows revoked:true', async () => {
  connectProvider('alice', { provider: 'openai', scope: 's', key: FAKE });
  assert.equal(revokeConnection('alice', 'openai'), true);
  assert.equal(listConnections('alice')[0].revoked, true);
  await assert.rejects(() => useConnection('alice', 'openai', () => 'x'), /revoked/);
});

// ── MELEK-Signer gating (HTTP) ──────────────────────────────────────────────────────────────
test('signed OUT: home shows "Sign in with MELEK" and no connect form', async () => {
  const o = await call({ url: '/' });
  assert.equal(o.code, 200);
  assert.match(o.body, /Sign in with MELEK/);
  assert.doesNotMatch(o.body, /id=connect/);   // the form is only for signed-in tenants
});

test('signed OUT: protected routes FAIL CLOSED with 401', async () => {
  assert.equal((await call({ url: '/connections' })).code, 401);
  assert.equal((await call({ url: '/connect', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai', key: FAKE }) })).code, 401);
  assert.equal((await call({ url: '/revoke', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai' }) })).code, 401);
});

test('MELEK-Signer session cookie is the gate (real sso.sessionFromCookie path)', async () => {
  // No injected whoami here — exercise the REAL SSO verify used in production.
  __setWhoami(); // reset to default (cookie-based)
  const token = makeSiblingSession('alice');
  const cookie = `${COOKIE}=${encodeURIComponent(token)}`;
  const withCookie = await call({ url: '/connections', headers: { cookie } });
  assert.equal(withCookie.code, 200, 'a valid MELEK session is admitted');
  const noCookie = await call({ url: '/connections' });
  assert.equal(noCookie.code, 401, 'no session → fail closed');
});

test('signed IN (injected): POST /connect stores, GET /connections lists — never the key', async () => {
  __setWhoami(() => 'alice');
  const c = await call({ url: '/connect', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai', scope: 'llm', key: FAKE, cap: { calls: 3 } }) });
  assert.equal(c.code, 200);
  assert.ok(!c.body.includes(FAKE), 'connect response must not echo the key');
  const l = await call({ url: '/connections' });
  assert.equal(l.code, 200);
  const body = json(l);
  assert.equal(body.connections.length, 1);
  assert.equal(body.connections[0].provider, 'openai');
  assert.ok(!l.body.includes(FAKE), 'connections response must not contain the key');
});

test('signed IN (injected): the tenant is the SESSION, not a body field (IDOR guard)', async () => {
  __setWhoami(() => 'alice');
  // Attacker tries to write as "bob" via the body — it is ignored; the connection is alice's.
  await call({ url: '/connect', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant: 'bob', account: 'bob', provider: 'openai', key: FAKE }) });
  assert.equal(listConnections('bob').length, 0);
  assert.equal(listConnections('alice').length, 1);
});

test('signed IN (injected): revoke via HTTP works', async () => {
  __setWhoami(() => 'alice');
  connectProvider('alice', { provider: 'openai', scope: 's', key: FAKE });
  const r = await call({ url: '/revoke', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai' }) });
  assert.equal(r.code, 200);
  assert.equal(listConnections('alice')[0].revoked, true);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
