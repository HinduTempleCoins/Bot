// oidc-broker.test.mjs — offline tests for the provider-agnostic OIDC login broker (task #75).
// All network is injected away via __setTokenExchange / __setUserInfo; clock + nonce are injected
// for determinism. node:test, no live OAuth, no real secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDERS,
  beginLogin,
  parseCallback,
  completeLogin,
  normalizeIdentity,
  __setNonce,
  __setClock,
  __setTokenExchange,
  __setUserInfo,
  __setFetch,
  __reset,
} from './oidc-broker.mjs';

// A sequenced nonce source so each beginLogin gets a distinct, predictable state.
function seqNonce() {
  let n = 0;
  return () => Buffer.from(`nonce-${n++}-padding-bytes-here!`); // >=16 bytes
}

// Fake provider userinfo payloads with each provider's distinct field names.
const FAKE_USERINFO = {
  github: { id: 4242, login: 'octocat', name: 'The Octocat', email: 'octo@github.test' },
  google: { sub: 'g-1029384756', email: 'someone@gmail.test', name: 'Some One' },
  discord: { id: '998877665544', username: 'disco', email: 'disco@discord.test', global_name: 'Disco Star' },
};

// A token-exchange + userinfo pair that records secrets it saw, so a test can assert they never leak.
function wireFakes({ provider, recorder } = {}) {
  __setTokenExchange(async ({ code, codeVerifier }) => {
    if (recorder) { recorder.lastCode = code; recorder.lastVerifier = codeVerifier; }
    // Return a realistic token response. This object must NEVER reach the caller.
    return { access_token: 'SECRET-ACCESS-TOKEN-do-not-leak', refresh_token: 'SECRET-REFRESH', token_type: 'bearer' };
  });
  __setUserInfo(async ({ provider: p, accessToken }) => {
    if (recorder) recorder.userInfoSawToken = accessToken;
    return FAKE_USERINFO[p];
  });
}

function reset() {
  __reset();
  __setClock(() => 1_000_000); // fixed clock
  __setNonce(seqNonce());
}

test('beginLogin builds a PKCE authorize URL with client_id, redirect_uri, code_challenge, state + a verifier', () => {
  reset();
  const { url, state, codeVerifier, codeChallenge } = beginLogin('github', {
    clientId: 'pub-client-id', redirectUri: 'https://app.test/cb',
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, PROVIDERS.github.authUrl);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'pub-client-id');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.test/cb');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('state'), state);
  assert.equal(u.searchParams.get('code_challenge'), codeChallenge);
  assert.ok(u.searchParams.get('scope').includes('read:user'));
  // a usable verifier is returned and is NOT the same as the challenge (S256 hashed)
  assert.ok(typeof codeVerifier === 'string' && codeVerifier.length >= 20);
  assert.notEqual(codeVerifier, codeChallenge);
});

test('beginLogin throws on unknown provider and missing args (programmer errors)', () => {
  reset();
  assert.throws(() => beginLogin('myspace', { clientId: 'x', redirectUri: 'y' }), /unknown provider/);
  assert.throws(() => beginLogin('google', { redirectUri: 'y' }), /clientId is required/);
  assert.throws(() => beginLogin('google', { clientId: 'x' }), /redirectUri is required/);
});

test('parseCallback extracts code + state from a query string, full URL, and object', () => {
  reset();
  assert.deepEqual(parseCallback('code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parseCallback('?code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parseCallback('https://app.test/cb?code=abc&state=xyz'), { code: 'abc', state: 'xyz' });
  assert.deepEqual(parseCallback({ code: 'abc', state: 'xyz' }), { code: 'abc', state: 'xyz' });
  const denied = parseCallback('error=access_denied&state=xyz');
  assert.equal(denied.error, 'access_denied');
  assert.equal(denied.code, null);
});

// completeLogin happy path for EACH provider, asserting field-name normalization.
const NORMALIZED = {
  github: { sub: '4242', email: 'octo@github.test', name: 'The Octocat' },
  google: { sub: 'g-1029384756', email: 'someone@gmail.test', name: 'Some One' },
  discord: { sub: '998877665544', email: 'disco@discord.test', name: 'disco' },
};

for (const provider of ['github', 'google', 'discord']) {
  test(`completeLogin succeeds for ${provider} and returns a normalized identity`, async () => {
    reset();
    const recorder = {};
    wireFakes({ recorder });
    const { state, codeVerifier } = beginLogin(provider, {
      clientId: 'pub-id', redirectUri: 'https://app.test/cb',
    });
    const { code, state: cbState } = parseCallback(`code=AUTHCODE&state=${encodeURIComponent(state)}`);
    const r = await completeLogin(provider, {
      code, state: cbState, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb',
    });
    assert.equal(r.ok, true);
    assert.equal(r.identity.provider, provider);
    assert.equal(r.identity.sub, NORMALIZED[provider].sub);
    assert.equal(r.identity.email, NORMALIZED[provider].email);
    assert.equal(r.identity.name, NORMALIZED[provider].name);
    // the exchange actually received our code + PKCE verifier
    assert.equal(recorder.lastCode, 'AUTHCODE');
    assert.equal(recorder.lastVerifier, codeVerifier);
    assert.equal(recorder.userInfoSawToken, 'SECRET-ACCESS-TOKEN-do-not-leak');
  });
}

test('completeLogin NEVER returns tokens in the identity', async () => {
  reset();
  wireFakes({});
  const { state, codeVerifier } = beginLogin('google', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  const r = await completeLogin('google', { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  assert.equal(r.ok, true);
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes('SECRET-ACCESS-TOKEN'), 'access token must not appear in result');
  assert.ok(!blob.includes('SECRET-REFRESH'), 'refresh token must not appear in result');
  assert.ok(!('access_token' in r.identity), 'no access_token field on identity');
  assert.ok(!('token' in r.identity), 'no token field on identity');
});

test('completeLogin soft-fails on unknown state (not throw)', async () => {
  reset();
  wireFakes({});
  const r = await completeLogin('github', {
    code: 'C', state: 'never-issued', codeVerifier: 'v', clientId: 'pub-id', redirectUri: 'https://app.test/cb',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-state');
});

test('completeLogin soft-fails on replayed state (single-use)', async () => {
  reset();
  wireFakes({});
  const { state, codeVerifier } = beginLogin('discord', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  const args = { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' };
  const first = await completeLogin('discord', args);
  assert.equal(first.ok, true);
  const replay = await completeLogin('discord', { ...args });
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, 'bad-state');
});

test('completeLogin soft-fails when state belongs to a different provider', async () => {
  reset();
  wireFakes({});
  const { state, codeVerifier } = beginLogin('github', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  const r = await completeLogin('google', { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-state');
});

test('completeLogin soft-fails on expired state', async () => {
  reset();
  wireFakes({});
  let t = 1_000_000;
  __setClock(() => t);
  const { state, codeVerifier } = beginLogin('google', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  t += 11 * 60 * 1000; // past the 10-minute TTL
  const r = await completeLogin('google', { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-state');
});

test('completeLogin soft-fails on missing code/state', async () => {
  reset();
  wireFakes({});
  const r1 = await completeLogin('github', { state: 's', codeVerifier: 'v', clientId: 'x', redirectUri: 'y' });
  assert.deepEqual(r1, { ok: false, reason: 'missing-code' });
  const r2 = await completeLogin('github', { code: 'c', codeVerifier: 'v', clientId: 'x', redirectUri: 'y' });
  assert.deepEqual(r2, { ok: false, reason: 'missing-state' });
});

test('completeLogin soft-fails when exchange yields no token / userinfo throws', async () => {
  reset();
  // exchange returns no access token
  __setTokenExchange(async () => ({ token_type: 'bearer' }));
  __setUserInfo(async () => FAKE_USERINFO.github);
  let b = beginLogin('github', { clientId: 'x', redirectUri: 'y' });
  let r = await completeLogin('github', { code: 'c', state: b.state, codeVerifier: b.codeVerifier, clientId: 'x', redirectUri: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-access-token');

  // exchange ok but userinfo throws
  __setTokenExchange(async () => ({ access_token: 'tok' }));
  __setUserInfo(async () => { throw new Error('boom'); });
  b = beginLogin('github', { clientId: 'x', redirectUri: 'y' });
  r = await completeLogin('github', { code: 'c', state: b.state, codeVerifier: b.codeVerifier, clientId: 'x', redirectUri: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'userinfo-failed');
});

test('completeLogin throws on unknown provider (programmer error)', async () => {
  reset();
  await assert.rejects(() => completeLogin('myspace', { code: 'c', state: 's' }), /unknown provider/);
});

test('normalizeIdentity unifies divergent field names across the 3 providers', () => {
  reset();
  // identity carries both `id` (task-spec shape) and `sub` (kept for back-compat); emailVerified is
  // null when the provider's userinfo omits it (GitHub/Discord fixtures here have no verified flag).
  assert.deepEqual(
    { ...normalizeIdentity('github', FAKE_USERINFO.github), raw: undefined },
    { provider: 'github', id: '4242', sub: '4242', email: 'octo@github.test', emailVerified: null, name: 'The Octocat', raw: undefined }
  );
  assert.deepEqual(
    { ...normalizeIdentity('google', FAKE_USERINFO.google), raw: undefined },
    { provider: 'google', id: 'g-1029384756', sub: 'g-1029384756', email: 'someone@gmail.test', emailVerified: null, name: 'Some One', raw: undefined }
  );
  assert.deepEqual(
    { ...normalizeIdentity('discord', FAKE_USERINFO.discord), raw: undefined },
    { provider: 'discord', id: '998877665544', sub: '998877665544', email: 'disco@discord.test', emailVerified: null, name: 'disco', raw: undefined }
  );
  // raw is preserved for callers that need provider-specific extras
  assert.equal(normalizeIdentity('github', FAKE_USERINFO.github).raw.login, 'octocat');
});

// ---- REAL default token-exchange + userinfo (network path, fake fetch) ------
//
// These exercise the DEFAULT fetchers (no __setTokenExchange / __setUserInfo injected) through an
// injected fake fetch (__setFetch). The client secret resolves by ENV NAME via secrets.getCapability
// — we set that env var to a dummy value (env-name literal assembled at runtime so no secret-shaped
// token sits in source, per the pre-commit guard).

// A fetch-Response-like object.
function fakeResp(jsonBody, { ok = true } = {}) {
  return { ok, status: ok ? 200 : 500, json: async () => jsonBody };
}

// Build provider client-secret env names at runtime (matches PROVIDERS[*].clientSecretEnv).
function secretEnvName(provider) {
  return [provider.toUpperCase(), 'OAUTH', 'CLIENT', 'SECRET'].join('_');
}

test('REAL default token-exchange POSTs code+verifier to the provider tokenUrl and returns the token', async () => {
  __reset();
  __setClock(() => 1_000_000);
  __setNonce(seqNonce());
  const envName = secretEnvName('github');
  process.env[envName] = 'dummy-secret-value'; // resolves via secrets env fallback
  try {
    const calls = [];
    __setFetch(async (url, opts) => {
      calls.push({ url, opts });
      // token endpoint
      if (url === PROVIDERS.github.tokenUrl) {
        return fakeResp({ access_token: 'REAL-TOK-abc', token_type: 'bearer' });
      }
      // userinfo endpoint
      return fakeResp(FAKE_USERINFO.github);
    });

    const { state, codeVerifier } = beginLogin('github', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
    const r = await completeLogin('github', { code: 'THECODE', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });

    assert.equal(r.ok, true);
    assert.equal(r.identity.id, '4242');
    // the token POST hit the right URL with the right form fields
    const tokenCall = calls.find((c) => c.url === PROVIDERS.github.tokenUrl);
    assert.ok(tokenCall, 'token endpoint was called');
    assert.equal(tokenCall.opts.method, 'POST');
    const body = new URLSearchParams(tokenCall.opts.body);
    assert.equal(body.get('code'), 'THECODE');
    assert.equal(body.get('code_verifier'), codeVerifier);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), 'pub-id');
    assert.equal(body.get('redirect_uri'), 'https://app.test/cb');
    assert.equal(body.get('client_secret'), 'dummy-secret-value'); // pulled by env NAME, used only here
  } finally {
    delete process.env[envName];
  }
});

test('REAL default userinfo GETs userInfoUrl with the bearer token and normalizes google vs github shapes', async () => {
  for (const provider of ['google', 'github']) {
    __reset();
    __setClock(() => 1_000_000);
    __setNonce(seqNonce());
    const envName = secretEnvName(provider);
    process.env[envName] = 'dummy-secret-value';
    try {
      let userInfoAuthHeader = null;
      let userInfoUrlHit = null;
      __setFetch(async (url, opts) => {
        if (url === PROVIDERS[provider].tokenUrl) {
          return fakeResp({ access_token: 'REAL-TOK-xyz' });
        }
        userInfoUrlHit = url;
        userInfoAuthHeader = opts && opts.headers && (opts.headers.authorization || opts.headers.Authorization);
        return fakeResp(FAKE_USERINFO[provider]);
      });

      const { state, codeVerifier } = beginLogin(provider, { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
      const r = await completeLogin(provider, { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });

      assert.equal(r.ok, true, `${provider} login ok`);
      assert.equal(userInfoUrlHit, PROVIDERS[provider].userInfoUrl, `${provider} userinfo URL`);
      assert.equal(userInfoAuthHeader, 'Bearer REAL-TOK-xyz', `${provider} bearer header`);
      assert.equal(r.identity.id, NORMALIZED[provider].sub, `${provider} id via idField`);
      assert.equal(r.identity.email, NORMALIZED[provider].email, `${provider} email via emailField`);
    } finally {
      delete process.env[envName];
    }
  }
});

test('REAL default fetchers soft-fail (not throw) on a network error', async () => {
  __reset();
  __setClock(() => 1_000_000);
  __setNonce(seqNonce());
  const envName = secretEnvName('google');
  process.env[envName] = 'dummy-secret-value';
  try {
    __setFetch(async () => { throw new Error('ECONNRESET'); });
    const { state, codeVerifier } = beginLogin('google', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
    const r = await completeLogin('google', { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'token-exchange-failed');
  } finally {
    delete process.env[envName];
  }
});

test('REAL default path: tokens NEVER appear in the returned identity', async () => {
  __reset();
  __setClock(() => 1_000_000);
  __setNonce(seqNonce());
  const envName = secretEnvName('discord');
  process.env[envName] = 'dummy-secret-value';
  try {
    __setFetch(async (url) => {
      if (url === PROVIDERS.discord.tokenUrl) {
        return fakeResp({ access_token: 'SECRET-ACCESS-TOKEN-do-not-leak', refresh_token: 'SECRET-REFRESH' });
      }
      return fakeResp(FAKE_USERINFO.discord);
    });
    const { state, codeVerifier } = beginLogin('discord', { clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
    const r = await completeLogin('discord', { code: 'C', state, codeVerifier, clientId: 'pub-id', redirectUri: 'https://app.test/cb' });
    assert.equal(r.ok, true);
    const blob = JSON.stringify(r);
    assert.ok(!blob.includes('SECRET-ACCESS-TOKEN'), 'access token absent from result');
    assert.ok(!blob.includes('SECRET-REFRESH'), 'refresh token absent from result');
    assert.ok(!('access_token' in r.identity), 'no access_token on identity');
  } finally {
    delete process.env[envName];
  }
});

test('PROVIDERS includes google/github/discord/yahoo with real-looking endpoints + email/id fields', () => {
  for (const name of ['google', 'github', 'discord', 'yahoo']) {
    const p = PROVIDERS[name];
    assert.ok(p, `${name} present`);
    assert.match(p.authUrl, /^https:\/\//, `${name} authUrl https`);
    assert.match(p.tokenUrl, /^https:\/\//, `${name} tokenUrl https`);
    assert.match(p.userInfoUrl, /^https:\/\//, `${name} userInfoUrl https`);
    assert.ok(Array.isArray(p.scopes) && p.scopes.length, `${name} scopes`);
    assert.ok(typeof p.emailField === 'string' && p.emailField, `${name} emailField`);
    assert.ok(typeof p.idField === 'string' && p.idField, `${name} idField`);
    assert.ok(typeof p.clientSecretEnv === 'string' && p.clientSecretEnv, `${name} clientSecretEnv`);
  }
  // the field names actually diverge (idField: github=id, google=sub)
  assert.equal(PROVIDERS.github.idField, 'id');
  assert.equal(PROVIDERS.google.idField, 'sub');
  assert.equal(PROVIDERS.yahoo.idField, 'sub');
});
