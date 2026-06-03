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
  serviceCatalog,
  recipePrereqs,
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

// ---- task #208: expanded service catalog + helpers -------------------------

test('SERVICES includes the task #208 additions with real endpoint hosts', () => {
  for (const key of ['yahoo', 'microsoft', 'spotify', 'twitch', 'linkedin', 'notion', 'todoist']) {
    const s = SERVICES[key];
    assert.ok(s, `missing service: ${key}`);
    assert.equal(typeof s.authUrlTemplate, 'string');
    assert.equal(typeof s.tokenUrl, 'string');
    assert.ok(Array.isArray(s.scopes) && s.scopes.length > 0, `${key} needs scopes`);
  }
  // Yahoo OAuth2 lives at api.login.yahoo.com (operator backup email identity).
  assert.equal(new URL(SERVICES.yahoo.authUrlTemplate).host, 'api.login.yahoo.com');
  assert.equal(new URL(SERVICES.yahoo.tokenUrl).host, 'api.login.yahoo.com');
  assert.ok(SERVICES.yahoo.scopes.includes('mail-r'), 'yahoo should request Mail read');
  // Microsoft identity platform lives at login.microsoftonline.com.
  assert.equal(new URL(SERVICES.microsoft.authUrlTemplate).host, 'login.microsoftonline.com');
  assert.equal(new URL(SERVICES.microsoft.tokenUrl).host, 'login.microsoftonline.com');
});

test('authorizeUrl builds a valid URL for yahoo with a client id (PKCE)', () => {
  const { url, codeVerifier, scopes } = authorizeUrl('yahoo', {
    clientId: 'YH-CID',
    redirectUri: 'https://portal.example/cb',
    state: 'st',
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://api.login.yahoo.com/oauth2/request_auth');
  assert.equal(u.searchParams.get('client_id'), 'YH-CID');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://portal.example/cb');
  assert.equal(u.searchParams.get('scope'), SERVICES.yahoo.scopes.join(' '));
  // yahoo is PKCE: challenge present + verifier returned
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('code_challenge'));
  assert.ok(codeVerifier && codeVerifier.length >= 16);
  assert.deepEqual(scopes, SERVICES.yahoo.scopes);
});

test('serviceCatalog: configured reflects <NAME>_CLIENT_ID env (set/unset) and merges connection status', async () => {
  const ENV = 'SPOTIFY_CLIENT_ID';
  const prior = process.env[ENV];
  delete process.env[ENV];

  const store = fakeStore();
  // connect twitch so the catalog can merge a real connection status
  await handleCallback('twitch', {
    code: 'c',
    store,
    exchange: async () => ({ access_token: FAKE_TOKEN, scope: 'user:read:email' }),
  });

  // unset → spotify configured:false
  let cat = await serviceCatalog(store);
  let byName = Object.fromEntries(cat.map((r) => [r.name, r]));
  assert.equal(byName.spotify.configured, false, 'spotify should be unconfigured when env unset');
  assert.equal(byName.twitch.connected, true, 'twitch is connected');
  assert.equal(byName.spotify.connected, false, 'spotify is not connected');
  // every row carries a category bucket + scopes array
  assert.ok(['email', 'storage', 'social', 'productivity', 'media'].includes(byName.spotify.category));
  assert.ok(Array.isArray(byName.spotify.scopes) && byName.spotify.scopes.length > 0);
  // no secrets anywhere in the catalog
  assert.ok(!JSON.stringify(cat).includes(FAKE_TOKEN));

  // set → spotify configured:true
  process.env[ENV] = 'a-client-id-from-env'; // a CLIENT ID (public), not a secret
  cat = await serviceCatalog(store);
  byName = Object.fromEntries(cat.map((r) => [r.name, r]));
  assert.equal(byName.spotify.configured, true, 'spotify configured when env set');

  // restore env
  if (prior === undefined) delete process.env[ENV];
  else process.env[ENV] = prior;
});

test('serviceCatalog soft-fails when the store is unreachable (everything not-connected)', async () => {
  const badStore = {
    list() {
      throw new Error('vault unreachable');
    },
  };
  const cat = await serviceCatalog(badStore);
  assert.ok(cat.length >= 14, 'catalog still lists every service');
  assert.ok(cat.every((r) => r.connected === false), 'all not-connected on store failure');
});

test('recipePrereqs extracts the services a recipe needs (with alias normalization)', () => {
  // gmail.* → google, notion.* → notion
  const a = recipePrereqs({ trigger: 'gmail.new_email', action: 'notion.add_row' });
  assert.deepEqual(a.required.sort(), ['google', 'notion']);
  assert.deepEqual(a.unknown, []);

  // outlook → microsoft, twitter → x; dedupes; reports unknown prefixes separately
  const b = recipePrereqs({
    trigger: 'outlook.new_mail',
    action: 'twitter.post',
    extra: 'spotify.save_track',
    services: ['gdrive.upload', 'pagerduty.alert'],
  });
  assert.deepEqual(b.required.sort(), ['google', 'microsoft', 'spotify', 'x']);
  assert.deepEqual(b.unknown, ['pagerduty']);

  // empty / non-string fields are ignored, never throws
  assert.deepEqual(recipePrereqs({}), { required: [], unknown: [] });
  assert.deepEqual(recipePrereqs({ trigger: 42, action: null }), { required: [], unknown: [] });
});
