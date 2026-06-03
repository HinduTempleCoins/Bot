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
  assert.deepEqual(
    { ...normalizeIdentity('github', FAKE_USERINFO.github), raw: undefined },
    { provider: 'github', sub: '4242', email: 'octo@github.test', name: 'The Octocat', raw: undefined }
  );
  assert.deepEqual(
    { ...normalizeIdentity('google', FAKE_USERINFO.google), raw: undefined },
    { provider: 'google', sub: 'g-1029384756', email: 'someone@gmail.test', name: 'Some One', raw: undefined }
  );
  assert.deepEqual(
    { ...normalizeIdentity('discord', FAKE_USERINFO.discord), raw: undefined },
    { provider: 'discord', sub: '998877665544', email: 'disco@discord.test', name: 'disco', raw: undefined }
  );
  // raw is preserved for callers that need provider-specific extras
  assert.equal(normalizeIdentity('github', FAKE_USERINFO.github).raw.login, 'octocat');
});
