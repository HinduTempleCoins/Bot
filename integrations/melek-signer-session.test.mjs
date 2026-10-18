// melek-signer-session.test.mjs — "Sign in with MELEK" route helpers. OFFLINE: injected signer fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.MELEK_SIGNER_URL; delete process.env.MELEK_SIGNER_PUBLIC_URL; delete process.env.MELEK_SIGNER_SIGNUP_URL;
const { startLogin, finishLogin, currentAccount, safeReturn, signInHtml, signerSignupUrl, STATE_COOKIE } =
  await import('./melek-signer-session.mjs');
const { mintSession, SESSION_COOKIE } = await import('./melek-login.mjs');

const SECRET = 'unit-secret';
const signer = (account) => async (url, opts) => {
  signer.last = { url, body: JSON.parse(opts.body) };
  return { json: async () => (account ? { access_token: 't', account, scope: 'identity' } : { error: 'invalid_grant' }) };
};
const stateCookie = (s) => s.cookie.split(';')[0];
const nonceOf = (s) => new URL(s.location).searchParams.get('state');

test('startLogin → public signer authorize URL + signed HttpOnly state cookie', () => {
  const s = startLogin({ clientId: 'hathor-studio', redirectUri: 'https://x.example/auth/melek-signer/callback', returnTo: '/a?b=1', secret: SECRET });
  assert.equal(s.ok, true);
  const u = new URL(s.location);
  assert.equal(u.origin + u.pathname, 'https://signer.melek.salon/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'hathor-studio');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.example/auth/melek-signer/callback');
  assert.ok(nonceOf(s));
  assert.match(s.cookie, new RegExp(`^${STATE_COOKIE}=`));
  assert.match(s.cookie, /HttpOnly/); assert.match(s.cookie, /Secure/);
});

test('startLogin soft-fails without a client or secret', () => {
  assert.equal(startLogin({ redirectUri: 'x', secret: SECRET }).ok, false);
  const prev = process.env.MELEK_SESSION_SECRET; delete process.env.MELEK_SESSION_SECRET;
  assert.equal(startLogin({ clientId: 'c', redirectUri: 'x' }).ok, false);
  if (prev) process.env.MELEK_SESSION_SECRET = prev;
});

test('round-trip: callback exchanges the code and mints an on-chain session; returnTo preserved', async () => {
  const s = startLogin({ clientId: 'melek-move', redirectUri: 'https://m.example/cb', returnTo: '/delete', secret: SECRET });
  const r = await finishLogin({ query: `code=c1&state=${nonceOf(s)}`, cookieHeader: stateCookie(s), clientId: 'melek-move', secret: SECRET, domain: '.melek.salon' }, signer('walker1'));
  assert.equal(r.ok, true);
  assert.equal(r.account, 'walker1');
  assert.equal(r.returnTo, '/delete');
  assert.deepEqual(signer.last.body, { code: 'c1', client_id: 'melek-move' });
  assert.match(signer.last.url, /^https:\/\/signer\.melek\.salon\/oauth2\/token$/);
  assert.match(r.cookies[0], /Domain=\.melek\.salon/);
  const cookie = r.cookies[0].split(';')[0];
  assert.equal(currentAccount(cookie, { secret: SECRET }), 'walker1');
});

test('CSRF + failures: wrong state, no cookie, forged cookie, bad code, bad account → no session', async () => {
  const s = startLogin({ clientId: 'c', redirectUri: 'https://e/cb', secret: SECRET });
  const n = nonceOf(s);
  const cases = [
    [{ query: `code=c&state=evil`, cookieHeader: stateCookie(s) }, signer('a1b'), 403],
    [{ query: `code=c&state=${n}`, cookieHeader: '' }, signer('a1b'), 403],
    [{ query: `code=c&state=${n}`, cookieHeader: `${STATE_COOKIE}=forged.sig` }, signer('a1b'), 403],
    [{ query: `code=c&state=${n}`, cookieHeader: stateCookie(s) }, signer(null), 502],
    [{ query: `code=c&state=${n}`, cookieHeader: stateCookie(s) }, signer('NOT VALID'), 502],
    [{ query: `code=c&state=${n}`, cookieHeader: stateCookie(s) }, async () => { throw new Error('down'); }, 502],
  ];
  for (const [args, f, status] of cases) {
    const r = await finishLogin({ ...args, clientId: 'c', secret: SECRET }, f);
    assert.equal(r.ok, false); assert.equal(r.status, status);
    assert.ok(!r.cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !/Max-Age=0/.test(c)));
  }
});

test('expired state is refused', async () => {
  const s = startLogin({ clientId: 'c', redirectUri: 'https://e/cb', secret: SECRET, now: Date.now() - 3600_000 });
  const r = await finishLogin({ query: `code=c&state=${nonceOf(s)}`, cookieHeader: stateCookie(s), clientId: 'c', secret: SECRET }, signer('alice'));
  assert.equal(r.status, 403);
});

test('currentAccount trusts only a signed on-chain session (not federated, not forged)', () => {
  assert.equal(currentAccount(`${SESSION_COOKIE}=${mintSession('alice', { secret: SECRET })}`, { secret: SECRET }), 'alice');
  assert.equal(currentAccount(`${SESSION_COOKIE}=${mintSession('google:123', { provider: 'google', secret: SECRET })}`, { secret: SECRET }), null);
  assert.equal(currentAccount(`${SESSION_COOKIE}=${mintSession('alice', { secret: 'other' })}`, { secret: SECRET }), null);
  assert.equal(currentAccount('', { secret: SECRET }), null);
});

test('safeReturn blocks open redirects; signInHtml escapes and links the signer signup', () => {
  assert.equal(safeReturn('https://evil.example'), '/');
  assert.equal(safeReturn('//evil.example'), '/');
  assert.equal(safeReturn('/ok'), '/ok');
  assert.match(signInHtml({ returnTo: '/x', signup: true }), /Sign in with MELEK/);
  assert.match(signInHtml({ signup: true }), /https:\/\/signer\.melek\.salon\/signup/);
  assert.equal(signerSignupUrl(), 'https://signer.melek.salon/signup');
  assert.ok(!signInHtml({ account: '<b>x' }).includes('<b>x'));
});
