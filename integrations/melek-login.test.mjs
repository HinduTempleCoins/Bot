// melek-login.test.mjs — offline. `node --test`. Injected secret + fetch; no network/env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginLogin, completeLogin, mintSession, sessionFromIdentity, verifySession, sessionCookie, clearCookie,
  requireSession, loginButtonHtml, LOGIN_PROVIDERS, isOnchainProvider, SESSION_COOKIE,
} from './melek-login.mjs';

const S = { secret: 'test-hmac-secret' };

test('MELEK session round-trips with provider + onchain flag', () => {
  const t = mintSession('Politician', { ...S, provider: 'melek' });
  assert.deepEqual(verifySession(t, S), { account: 'politician', provider: 'melek', onchain: true });
});

test('federated identity → comment-scope session (namespaced account, onchain:false)', () => {
  const t = sessionFromIdentity({ provider: 'google', sub: '12345' }, S);
  assert.deepEqual(verifySession(t, S), { account: 'google:12345', provider: 'google', onchain: false });
  assert.throws(() => sessionFromIdentity({ provider: 'google' }, S), /provider.*sub/);
});

test('tampering, wrong secret, expiry, and bad shape all reject (null, never throw)', () => {
  const t = mintSession('alice', S);
  assert.equal(verifySession(t.slice(0, -2) + 'xx', S), null);
  assert.equal(verifySession(t, { secret: 'other' }), null);
  assert.equal(verifySession('a.b.c', S), null);            // wrong part count
  assert.equal(verifySession(mintSession('alice', { ...S, ttl: 1, now: Date.now() - 10_000 }), S), null);
  assert.equal(verifySession('', S), null);
});

test('providers: MELEK is on-chain, the rest come from the OIDC broker', () => {
  assert.equal(LOGIN_PROVIDERS[0], 'melek');
  assert.ok(LOGIN_PROVIDERS.includes('google'));
  assert.equal(isOnchainProvider('melek'), true);
  assert.equal(isOnchainProvider('google'), false);
});

test('beginLogin: MELEK → signer authorize URL; unknown provider throws', () => {
  const u = beginLogin('melek', { redirectUri: 'https://data.soapbox.community/callback', state: 'n1' });
  assert.match(u, /\/oauth2\/authorize/);
  assert.match(u, /client_id=soapbox/);
  assert.throws(() => beginLogin('myspace', {}), /unknown provider/);
});

test('completeLogin (MELEK) exchanges the code → an on-chain session', async () => {
  const fakeFetch = async (url) => { assert.match(url, /\/oauth2\/token$/); return { json: async () => ({ access_token: 'tok', account: 'Judge', scope: 'identity' }) }; };
  const r = await completeLogin({ code: 'onetime', ...S }, fakeFetch);
  assert.equal(r.account, 'judge'); assert.equal(r.provider, 'melek');
  assert.deepEqual(verifySession(r.session, S), { account: 'judge', provider: 'melek', onchain: true });
  assert.equal(await completeLogin({ code: '', ...S }, async () => ({ json: async () => ({}) })), null);
});

test('cookie is SoapBox-wide SSO: Domain=.soapbox.community, HttpOnly, Secure', () => {
  const c = sessionCookie('VAL');
  assert.match(c, new RegExp(`^${SESSION_COOKIE}=VAL`));
  assert.match(c, /Domain=\.soapbox\.community/); assert.match(c, /HttpOnly/); assert.match(c, /Secure/);
  assert.match(clearCookie(), /Max-Age=0/);
});

test('requireSession reads + verifies the cookie', () => {
  const header = `foo=bar; ${SESSION_COOKIE}=${mintSession('reporter', S)}; baz=qux`;
  assert.deepEqual(requireSession(header, S), { account: 'reporter', provider: 'melek', onchain: true });
  assert.equal(requireSession('foo=bar', S), null);
});

test('login widget: a button per provider when logged out; signed-in state (shows federated via)', () => {
  const out = loginButtonHtml({ returnTo: '/dossier/x' });
  assert.match(out, /Log in with MELEK/);
  assert.match(out, /Log in with Google/);
  assert.match(out, /provider=melek/); assert.match(out, /provider=google/);
  assert.match(loginButtonHtml({ account: 'mayor', provider: 'melek', returnTo: '/' }), /Signed in as <b>@mayor<\/b>/);
  assert.match(loginButtonHtml({ account: 'google:1', provider: 'google' }), /via Google/);
});
