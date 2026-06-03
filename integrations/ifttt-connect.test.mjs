// ifttt-connect.test.mjs — OFFLINE tests for the OAuth account-connection hub.
// No network, no live OAuth, no real secrets. Run: node --test integrations/ifttt-connect.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';

import {
  SERVICES,
  authorizeUrl,
  handleCallback,
  listConnections,
  revoke,
  ConnectError,
} from './ifttt-connect.mjs';

// A fake token store matching the credential-store shape this hub depends on
// ({ store, list, revoke }) — holds the secret internally and NEVER exposes it via list().
function fakeStore() {
  const recs = new Map(); // name -> { name, scope, cap, _secret, revoked }
  return {
    store({ name, secret, scope, cap }) {
      recs.set(name, { name, scope, cap, _secret: secret, revoked: false });
    },
    list() {
      // Mirror credential-store: expose name/scope/cap/revoked — NEVER the secret.
      return [...recs.values()].map(({ name, scope, cap, revoked }) => ({ name, scope, cap, revoked }));
    },
    revoke(name) {
      recs.delete(name);
    },
    // test-only peek to assert the secret was actually stored (and never surfaced elsewhere)
    __peekSecret(name) {
      return recs.get(name) ? recs.get(name)._secret : undefined;
    },
  };
}

const FAKE_TOKEN = 'ya29.NOT-A-REAL-TOKEN-0000';

test('SERVICES catalog has the expected providers, each with required fields', () => {
  for (const key of ['google', 'github', 'discord', 'slack', 'x', 'reddit', 'dropbox']) {
    const s = SERVICES[key];
    assert.ok(s, `missing service: ${key}`);
    assert.equal(typeof s.authUrlTemplate, 'string');
    assert.equal(typeof s.tokenUrl, 'string');
    assert.ok(Array.isArray(s.scopes) && s.scopes.length > 0);
  }
});

test('authorizeUrl builds a correct OAuth2 URL with scopes + state', () => {
  const { url, state, scopes } = authorizeUrl('github', {
    clientId: 'CID-123',
    redirectUri: 'https://portal.example/cb',
    state: 'fixed-state',
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'CID-123');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://portal.example/cb');
  assert.equal(u.searchParams.get('state'), 'fixed-state');
  assert.equal(state, 'fixed-state');
  // scopes are space-joined and match the service catalog default
  assert.equal(u.searchParams.get('scope'), SERVICES.github.scopes.join(' '));
  assert.deepEqual(scopes, SERVICES.github.scopes);
});

test('authorizeUrl adds PKCE challenge for PKCE providers and returns a verifier', () => {
  const { url, codeVerifier } = authorizeUrl('google', {
    clientId: 'g-cid',
    redirectUri: 'https://portal.example/cb',
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('code_challenge'), 'expected a code_challenge param');
  assert.ok(codeVerifier && codeVerifier.length >= 16, 'expected a code verifier');
  // Google offline-access extras carried through:
  assert.equal(u.searchParams.get('access_type'), 'offline');
});

test('authorizeUrl: non-PKCE provider has no challenge and a null verifier', () => {
  const { url, codeVerifier } = authorizeUrl('slack', {
    clientId: 's-cid',
    redirectUri: 'https://portal.example/cb',
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get('code_challenge'), null);
  assert.equal(codeVerifier, null);
});

test('authorizeUrl generates a random state when none supplied', () => {
  const a = authorizeUrl('discord', { clientId: 'c', redirectUri: 'https://x/cb' });
  const b = authorizeUrl('discord', { clientId: 'c', redirectUri: 'https://x/cb' });
  assert.ok(a.state && b.state);
  assert.notEqual(a.state, b.state);
});

test('authorizeUrl rejects unknown service and missing params', () => {
  assert.throws(() => authorizeUrl('nope', { clientId: 'c', redirectUri: 'r' }), ConnectError);
  assert.throws(() => authorizeUrl('github', { redirectUri: 'r' }), ConnectError);
  assert.throws(() => authorizeUrl('github', { clientId: 'c' }), ConnectError);
});

test('handleCallback exchanges the code, stores a grant, and never returns the token', async () => {
  const store = fakeStore();
  let exchangeArgs = null;
  const conn = await handleCallback('github', {
    code: 'auth-code-xyz',
    codeVerifier: null,
    redirectUri: 'https://portal.example/cb',
    store,
    exchange: async (args) => {
      exchangeArgs = args;
      return { access_token: FAKE_TOKEN, scope: 'read:user repo', token_type: 'bearer' };
    },
  });

  // exchange got the code + endpoint info
  assert.equal(exchangeArgs.code, 'auth-code-xyz');
  assert.equal(exchangeArgs.tokenUrl, SERVICES.github.tokenUrl);
  assert.equal(exchangeArgs.service, 'github');

  // returned descriptor is public-only — NO token anywhere in it
  assert.deepEqual(conn, { name: 'github', scopes: ['read:user', 'repo'], status: 'connected' });
  const blob = JSON.stringify(conn);
  assert.ok(!blob.includes(FAKE_TOKEN), 'token must NOT appear in the returned descriptor');

  // the secret WAS stored (internally), under the namespaced grant name
  assert.ok(store.__peekSecret('oauth:github'), 'grant secret should be stored');
  assert.ok(store.__peekSecret('oauth:github').includes(FAKE_TOKEN));
});

test('handleCallback accepts a bare string token', async () => {
  const store = fakeStore();
  const conn = await handleCallback('dropbox', {
    code: 'c',
    store,
    exchange: async () => FAKE_TOKEN,
  });
  assert.equal(conn.status, 'connected');
  assert.deepEqual(conn.scopes, SERVICES.dropbox.scopes);
  assert.ok(store.__peekSecret('oauth:dropbox').includes(FAKE_TOKEN));
});

test('handleCallback rejects missing code, missing exchange, and bad token', async () => {
  const store = fakeStore();
  await assert.rejects(() => handleCallback('github', { store, exchange: async () => FAKE_TOKEN }), ConnectError);
  await assert.rejects(() => handleCallback('github', { code: 'c', store }), ConnectError);
  await assert.rejects(
    () => handleCallback('github', { code: 'c', store, exchange: async () => ({}) }),
    ConnectError
  );
});

test('listConnections shows names/scopes/status and HIDES secrets', async () => {
  const store = fakeStore();
  await handleCallback('github', {
    code: 'c',
    store,
    exchange: async () => ({ access_token: FAKE_TOKEN, scope: 'read:user repo' }),
  });
  await handleCallback('discord', {
    code: 'c2',
    store,
    exchange: async () => ({ access_token: FAKE_TOKEN + '-d', scope: 'identify guilds' }),
  });

  const conns = await listConnections(store);
  const byName = Object.fromEntries(conns.map((c) => [c.name, c]));
  assert.deepEqual(byName.github, { name: 'github', scopes: ['read:user', 'repo'], status: 'connected' });
  assert.equal(byName.discord.status, 'connected');

  // No secret leaks into the public listing.
  const blob = JSON.stringify(conns);
  assert.ok(!blob.includes(FAKE_TOKEN), 'listConnections must not expose tokens');
  // And no field named like a secret is present.
  for (const c of conns) {
    assert.deepEqual(Object.keys(c).sort(), ['name', 'scopes', 'status']);
  }
});

test('revoke removes a connection', async () => {
  const store = fakeStore();
  await handleCallback('x', {
    code: 'c',
    codeVerifier: 'v',
    store,
    exchange: async () => ({ access_token: FAKE_TOKEN, scope: 'tweet.read' }),
  });
  assert.equal((await listConnections(store)).length, 1);

  const existed = await revoke('x', store);
  assert.equal(existed, true);
  assert.equal((await listConnections(store)).length, 0);
  assert.equal(store.__peekSecret('oauth:x'), undefined);

  // revoking a non-connected service reports false, does not throw
  assert.equal(await revoke('reddit', store), false);
});
