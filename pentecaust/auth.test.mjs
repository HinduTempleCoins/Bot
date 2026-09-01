// auth.test.mjs — OFFLINE. Temp-file store, injected fetch, deterministic clock. No network, no keys.
// Soft-fail-never-throw. Covers: session sign→verify→tamper→expiry; OAuth happy path + CSRF; one-time
// single-use + expiry; account linking (needs-account → linked); provider allow-list; bad-input soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, readFileSync } from 'node:fs';
import {
  makeSession, sessionFromReq, verifier, handler,
  requestOneTime, redeemOneTime, linkAccount, lookupLink, completeOAuthLink,
  authorizeUrl, registerMethod, hasMethod, __setFetch, providersStatus,
} from './auth.mjs';

// A fixed secret so signatures are stable across the run.
process.env.PENTECAUST_SESSION_SECRET = 'test-secret-do-not-use-in-prod';
process.env.MAILBOX_DATA = join(tmpdir(), `pentecaust-mailbox-test-${process.pid}.json`);
const { getMailbox } = await import('./connect/mailbox.mjs');

let n = 0;
function freshFile() {
  const f = join(tmpdir(), `pentecaust-auth-test-${process.pid}-${n++}.json`);
  try { unlinkSync(f); } catch {}
  return f;
}
const O = (file) => ({ file });

// request with a session cookie set to `token`
const reqWithCookie = (name, token) => ({ headers: { cookie: `${name}=${encodeURIComponent(token)}` } });

// ── SESSIONS: sign → verify round-trip ───────────────────────────────────────────────────────────────
test('session: sign → verify round-trip carries account + method', () => {
  const token = makeSession('alice', 'google');
  const s = sessionFromReq(reqWithCookie('pentecaust_session', token));
  assert.ok(s);
  assert.equal(s.account, 'alice');
  assert.equal(s.method, 'google');
});

test('session: verifier(req) returns the certified account', () => {
  const token = makeSession('bob-jones', 'onetime');
  assert.equal(verifier(reqWithCookie('pentecaust_session', token)), 'bob-jones');
  assert.equal(verifier({ headers: {} }), null);   // no cookie → null
});

// ── SESSIONS: tamper rejection ───────────────────────────────────────────────────────────────────────
test('session: a tampered payload is rejected', () => {
  const token = makeSession('alice', 'google');
  // flip the account in the payload but keep the original signature → must fail the HMAC check
  const [body, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  payload.account = 'mallory';
  const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = `${forgedBody}.${sig}`;
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', forged)), null);
});

test('session: a garbage / wrong-signature token is rejected', () => {
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', 'not.a.token')), null);
  const token = makeSession('alice', 'google');
  const [body] = token.split('.');
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', `${body}.deadbeef`)), null);
});

// ── SESSIONS: expiry ─────────────────────────────────────────────────────────────────────────────────
test('session: an expired token is rejected', () => {
  const t0 = 1_000_000;
  const token = makeSession('alice', 'google', { now: t0, ttl: 1000 });
  // valid just before exp
  assert.ok(sessionFromReq(reqWithCookie('pentecaust_session', token), { now: t0 + 500 }));
  // rejected at/after exp
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', token), { now: t0 + 1000 }), null);
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', token), { now: t0 + 5000 }), null);
});

test('session: invalid account name is not mintable', () => {
  assert.equal(makeSession('0xNot!', 'google'), null);
  assert.equal(makeSession('', 'google'), null);
});

// ── OAUTH: happy path (mocked token + userinfo → session) ────────────────────────────────────────────
function mockProviderFetch({ accessToken = 'AT', userinfo }) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token') || u.includes('graph.facebook.com') && (init && init.method === 'POST')) {
      return { json: async () => ({ access_token: accessToken }) };
    }
    if (u.includes('/token')) return { json: async () => ({ access_token: accessToken }) };
    // userinfo
    return { json: async () => userinfo };
  };
}
const setCookieList = (h) => { const sc = h['set-cookie']; return Array.isArray(sc) ? sc : (sc ? [sc] : []); };
function cap() {
  const o = { code: 0, body: '', headers: {} };
  return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = b || ''; } }, o };
}
const J = (o) => { try { return JSON.parse(o.body); } catch { return {}; } };
// minimal GET request object — loopback socket so the dev-trust fallback is honorable when the flag is on.
const getReq = (path, cookie) => ({ url: path, method: 'GET', headers: cookie ? { cookie } : {}, socket: { remoteAddress: '127.0.0.1' } });
// POST request object with a JSON body (drives the handler's readJson)
function postReq(path, bodyObj, cookie) {
  const body = JSON.stringify(bodyObj || {});
  const handlers = {};
  const req = { url: path, method: 'POST', headers: cookie ? { cookie } : {}, socket: { remoteAddress: '127.0.0.1' }, on: (ev, fn) => { handlers[ev] = fn; return req; }, destroy() {} };
  // fire the body asynchronously so the handler can attach listeners first
  queueMicrotask(() => { handlers.data && handlers.data(body); handlers.end && handlers.end(); });
  return req;
}

test('oauth: callback happy path links + sets a session (mocked token+userinfo)', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  process.env.PENTECAUST_BASE_URL = 'https://pentecaust.com';
  process.env.GOOGLE_CLIENT_ID = 'gid';
  process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
  __setFetch(mockProviderFetch({ userinfo: { sub: 'google-123', email: 'a@example.com' } }));

  // pre-link google-123 → alice so the callback yields a session (not needs-account)
  linkAccount('google', 'google-123', 'alice', O(process.env.PENTECAUST_AUTH_DATA));

  // 1) begin: GET /auth/google → state cookie + 302
  let { res, o } = cap();
  await handler(getReq('/auth/google'), res);
  assert.equal(o.code, 302);
  const stateCookie = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_oauth_state='));
  assert.ok(stateCookie, 'state cookie set');
  // pull the state token value back out (the provider echoes it on the callback)
  const stateVal = decodeURIComponent(stateCookie.split(';')[0].split('=')[1]);

  // 2) callback with matching state + a code
  ({ res, o } = cap());
  await handler(getReq(`/auth/google/callback?code=abc&state=${encodeURIComponent(stateVal)}`, `pentecaust_oauth_state=${encodeURIComponent(stateVal)}`), res);
  assert.equal(o.code, 302, 'redirect to / on success');
  const sessCookie = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_session='));
  assert.ok(sessCookie, 'session cookie set');
  assert.match(sessCookie, /HttpOnly/);
  assert.match(sessCookie, /Secure/);
  assert.match(sessCookie, /SameSite=Lax/);
  const token = decodeURIComponent(sessCookie.split(';')[0].split('=')[1]);
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', token)).account, 'alice');
  __setFetch(null);
});

// ── OAUTH: CSRF state mismatch is rejected ────────────────────────────────────────────────────────────
test('oauth: callback rejects a state/cookie mismatch (csrf guard)', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  process.env.GOOGLE_CLIENT_ID = 'gid';
  __setFetch(mockProviderFetch({ userinfo: { sub: 'x', email: 'x@x.com' } }));
  // state in the query doesn't match the cookie → 403
  const { res, o } = cap();
  await handler(getReq('/auth/google/callback?code=abc&state=attacker', 'pentecaust_oauth_state=different'), res);
  assert.equal(o.code, 403);
  assert.match(J(o).reason, /csrf/i);
  __setFetch(null);
});

test('oauth: callback with no state at all is rejected', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  process.env.GOOGLE_CLIENT_ID = 'gid';
  const { res, o } = cap();
  await handler(getReq('/auth/google/callback?code=abc'), res);
  assert.equal(o.code, 403);
});

// ── ACCOUNT LINKING: first login → needs-account, then linked ────────────────────────────────────────
test('linking: first social login returns needsAccount, second is linked', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  process.env.GOOGLE_CLIENT_ID = 'gid';
  process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
  __setFetch(mockProviderFetch({ userinfo: { sub: 'newuser-9', email: 'new@example.com' } }));

  // begin → get state
  let { res, o } = cap();
  await handler(getReq('/auth/google'), res);
  const stateCookie = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_oauth_state='));
  const stateVal = decodeURIComponent(stateCookie.split(';')[0].split('=')[1]);

  // callback: no link yet → redirect to the dashboard account-picker carrying a signed claim
  ({ res, o } = cap());
  await handler(getReq(`/auth/google/callback?code=abc&state=${encodeURIComponent(stateVal)}`, `pentecaust_oauth_state=${encodeURIComponent(stateVal)}`), res);
  assert.equal(o.code, 302);
  const loc = new URL(o.headers.location, 'https://pentecaust.com');
  assert.equal(loc.pathname, '/');
  const claim = loc.searchParams.get('link');
  assert.ok(claim, 'a signed oauth-claim rides the redirect as ?link=');
  assert.equal(loc.searchParams.get('email'), 'new@example.com');

  // complete the link with the claim → real link + session token
  const done = completeOAuthLink(claim, 'newperson', O(process.env.PENTECAUST_AUTH_DATA));
  assert.equal(done.ok, true);
  assert.equal(done.account, 'newperson');
  assert.equal(lookupLink('google', 'newuser-9', O(process.env.PENTECAUST_AUTH_DATA)), 'newperson');
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', done.token)).account, 'newperson');

  // SECOND login for the same provider id → now linked, callback redirects with a session
  __setFetch(mockProviderFetch({ userinfo: { sub: 'newuser-9', email: 'new@example.com' } }));
  ({ res, o } = cap());
  await handler(getReq('/auth/google'), res);
  const sc2 = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_oauth_state='));
  const sv2 = decodeURIComponent(sc2.split(';')[0].split('=')[1]);
  ({ res, o } = cap());
  await handler(getReq(`/auth/google/callback?code=abc&state=${encodeURIComponent(sv2)}`, `pentecaust_oauth_state=${encodeURIComponent(sv2)}`), res);
  assert.equal(o.code, 302);
  const sess = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_session='));
  const tok = decodeURIComponent(sess.split(';')[0].split('=')[1]);
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', tok)).account, 'newperson');
  __setFetch(null);
});

test('linking: a provider identity cannot be re-pointed to another account', () => {
  const o = O(freshFile());
  assert.equal(linkAccount('google', 'id-1', 'alice', o).ok, true);
  const second = linkAccount('google', 'id-1', 'mallory', o);
  assert.equal(second.ok, false);
  assert.match(second.reason, /already linked/);
  // and the original link stands
  assert.equal(lookupLink('google', 'id-1', o), 'alice');
});

test('completeOAuthLink: a forged/expired claim is rejected', () => {
  const o = O(freshFile());
  assert.equal(completeOAuthLink('not-a-claim', 'alice', o).ok, false);
  // tamper with a real-looking but unsigned blob
  const fake = Buffer.from(JSON.stringify({ kind: 'oauth-claim', provider: 'google', providerUserId: 'x', exp: Date.now() + 10000 })).toString('base64');
  assert.equal(completeOAuthLink(`${fake}.sig`, 'alice', o).ok, false);
});

// ── PROVIDER ALLOW-LIST (no SSRF) ────────────────────────────────────────────────────────────────────
test('provider allow-list: unknown provider is rejected everywhere', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  assert.equal(authorizeUrl('evil.com', 'state'), null);
  assert.equal(linkAccount('evil', 'id', 'alice', O(process.env.PENTECAUST_AUTH_DATA)).ok, false);
  const { res, o } = cap();
  await handler(getReq('/auth/evil'), res);
  assert.equal(o.code, 404);
  assert.match(J(o).reason, /unknown provider/);
});

test('authorizeUrl: builds the provider URL with correct scope + redirect (when configured)', () => {
  process.env.GOOGLE_CLIENT_ID = 'gid';
  process.env.PENTECAUST_BASE_URL = 'https://pentecaust.com';
  const u = authorizeUrl('google', 'STATE');
  assert.ok(u.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.match(u, /scope=openid\+email\+profile/);
  assert.match(u, /state=STATE/);
  assert.match(u, /redirect_uri=https%3A%2F%2Fpentecaust\.com%2Fauth%2Fgoogle%2Fcallback/);
  // facebook scope
  process.env.FACEBOOK_CLIENT_ID = 'fid';
  assert.match(authorizeUrl('facebook', 'S'), /scope=email/);
});

// ── ONE-TIME LOGIN: redeem once, then rejected on reuse / expiry ─────────────────────────────────────
test('one-time: redeem succeeds once, then reuse is rejected', () => {
  const o = O(freshFile());
  const r = requestOneTime('alice', o);
  assert.equal(r.ok, true);
  assert.ok(r.code, 'a raw code is surfaced (testnet)');
  const first = redeemOneTime(r.code, o);
  assert.equal(first.ok, true);
  assert.equal(first.account, 'alice');
  const second = redeemOneTime(r.code, o);   // reuse
  assert.equal(second.ok, false);
  assert.match(second.reason, /already used/);
});

test('one-time: an expired code is rejected', () => {
  const o = O(freshFile());
  const t0 = 5_000_000;
  const r = requestOneTime('alice', { ...o, now: t0 });
  // 16 min later (TTL is 15 min) → expired
  const red = redeemOneTime(r.code, { ...o, now: t0 + 16 * 60 * 1000 });
  assert.equal(red.ok, false);
  assert.match(red.reason, /expired/);
});

test('one-time: the store holds a HASH, not the raw code', () => {
  const file = freshFile();
  const o = O(file);
  const r = requestOneTime('alice', o);
  let raw = ''; try { raw = readFileSync(file, 'utf8'); } catch {}
  assert.ok(raw.length > 0, 'store was written');
  assert.ok(!raw.includes(r.code), 'raw code must not appear in the store');
});

test('one-time: invalid account name is rejected; unknown code soft-fails', () => {
  const o = O(freshFile());
  assert.equal(requestOneTime('0xBad!', o).ok, false);
  assert.equal(redeemOneTime('nope', o).ok, false);
  assert.equal(redeemOneTime('', o).ok, false);
});

// ── HANDLER: /auth/onetime request + redeem → session cookie ─────────────────────────────────────────
test('handler: /auth/onetime request then redeem sets a hardened session cookie (testnet/dev-trust)', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  process.env.PENTECAUST_DEV_TRUST = '1';          // the inline-code flow is the testnet surface only
  let { res, o } = cap();
  await handler(postReq('/auth/onetime', { account: 'alice' }), res);
  assert.equal(o.code, 200);
  const code = J(o).code;
  assert.ok(code);

  ({ res, o } = cap());
  await handler(postReq('/auth/onetime', { code }), res);
  assert.equal(o.code, 200);
  assert.equal(J(o).account, 'alice');
  const sc = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_session='));
  assert.ok(sc);
  assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/);

  // reuse via the handler → 401
  ({ res, o } = cap());
  await handler(postReq('/auth/onetime', { code }), res);
  assert.equal(o.code, 401);
  delete process.env.PENTECAUST_DEV_TRUST;
});

// ── SECURITY C1: in production (no dev-trust) the raw one-time code is NEVER returned over HTTP ──
test('handler: /auth/onetime does NOT leak the code in production (no dev-trust)', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  delete process.env.PENTECAUST_DEV_TRUST;          // production posture
  const { res, o } = cap();
  await handler(postReq('/auth/onetime', { account: 'hathor' }), res);
  assert.equal(o.code, 200);
  const body = J(o);
  assert.equal(body.ok, true);
  assert.equal(body.code, undefined, 'the login secret must not be handed to the requester in production');
});

// ── SECURITY C2: linking a social identity to a MELEK account is refused without account-ownership proof ──
test('handler: /auth/link is refused in production — a Google login cannot claim an on-chain account', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  delete process.env.PENTECAUST_DEV_TRUST;          // production posture
  const { res, o } = cap();                          // refused before the claim is even examined
  await handler(postReq('/auth/link', { claim: 'any-claim', account: 'hathor' }), res);
  assert.equal(o.code, 403, 'cannot bind a social identity to hathor without MELEK-Signer proof');
});

// ── H2: the one-time store is swept of consumed/expired codes on the write path (no unbounded growth) ──
test('one-time store prunes used/expired entries on write', () => {
  const file = freshFile(); const o = { file };
  const a = requestOneTime('alice', o);              // entry 1
  redeemOneTime(a.code, o);                          // now used
  requestOneTime('bob', o);                          // write-path sweep should drop the used entry 1
  const store = JSON.parse(readFileSync(file, 'utf8'));
  const entries = Object.values(store.onetime);
  assert.equal(entries.length, 1, 'only the live (bob) code remains; the used (alice) one was pruned');
  assert.equal(entries[0].account, 'bob');
});

// ── HANDLER: /auth/me + /auth/logout ─────────────────────────────────────────────────────────────────
test('handler: /auth/me reflects the session; /auth/logout clears it', async () => {
  const token = makeSession('alice', 'google');
  let { res, o } = cap();
  await handler(getReq('/auth/me', `pentecaust_session=${encodeURIComponent(token)}`), res);
  assert.equal(o.code, 200);
  assert.equal(J(o).account, 'alice');

  ({ res, o } = cap());
  await handler(getReq('/auth/me'), res);   // no cookie
  assert.equal(o.code, 401);

  ({ res, o } = cap());
  await handler(getReq('/auth/logout'), res);
  assert.equal(o.code, 302);
  const sc = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_session='));
  assert.match(sc, /Max-Age=0/);
});

// ── MELEK-SIGNER EXTENSION POINT ─────────────────────────────────────────────────────────────────────
test('registerMethod: a melek-signer method can mint a session', async () => {
  registerMethod('melek-signer', (req, body) => (body && body.proven ? body.account : null));
  assert.equal(hasMethod('melek-signer'), true);

  let { res, o } = cap();
  await handler(postReq('/auth/method/melek-signer', { proven: true, account: 'alice' }), res);
  assert.equal(o.code, 200);
  assert.equal(J(o).account, 'alice');
  const sc = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_session='));
  assert.ok(sc);
  const tok = decodeURIComponent(sc.split(';')[0].split('=')[1]);
  assert.equal(sessionFromReq(reqWithCookie('pentecaust_session', tok)).method, 'melek-signer');

  // failed proof → 401
  ({ res, o } = cap());
  await handler(postReq('/auth/method/melek-signer', { proven: false, account: 'alice' }), res);
  assert.equal(o.code, 401);

  // unknown method → 404
  ({ res, o } = cap());
  await handler(postReq('/auth/method/ghost', {}), res);
  assert.equal(o.code, 404);
});

// ── BAD INPUT SOFT-FAILS (never throws) ──────────────────────────────────────────────────────────────
test('bad input soft-fails everywhere (never throws)', async () => {
  const o = O(freshFile());
  assert.doesNotThrow(() => makeSession(undefined));
  assert.doesNotThrow(() => sessionFromReq(undefined));
  assert.doesNotThrow(() => sessionFromReq({}));
  assert.doesNotThrow(() => verifier(undefined));
  assert.doesNotThrow(() => requestOneTime(undefined, o));
  assert.doesNotThrow(() => redeemOneTime(undefined, o));
  assert.doesNotThrow(() => linkAccount(undefined, undefined, undefined, o));
  assert.doesNotThrow(() => lookupLink(undefined, undefined, o));
  assert.doesNotThrow(() => completeOAuthLink(undefined, undefined, o));
  assert.doesNotThrow(() => authorizeUrl(undefined, undefined));

  assert.equal(sessionFromReq({}), null);
  assert.equal(verifier({ headers: {} }), null);
  assert.equal(requestOneTime(undefined, o).ok, false);
});

test('handler: bad url / unknown route soft-fail', async () => {
  let { res, o } = cap();
  await handler(getReq('/not-auth/x'), res);
  assert.equal(o.code, 404);
  ({ res, o } = cap());
  await handler(getReq('/auth'), res);   // just /auth, no action
  assert.equal(o.code, 404);
});

test('providersStatus: reflects env config, never leaks a secret', () => {
  process.env.GOOGLE_CLIENT_ID = 'gid';
  process.env.GOOGLE_CLIENT_SECRET = 'shh-secret';
  delete process.env.FACEBOOK_CLIENT_ID;
  const st = providersStatus();
  const g = st.find((p) => p.id === 'google');
  const f = st.find((p) => p.id === 'facebook');
  assert.equal(g.configured, true, 'google configured when client id present');
  assert.equal(f.configured, false, 'facebook not configured when client id absent');
  assert.ok(g.redirectUri.endsWith('/auth/google/callback'), 'exposes redirect uri for console setup');
  // no field anywhere carries the secret
  assert.ok(!JSON.stringify(st).includes('shh-secret'), 'client secret never appears in status');
});

test('GET /auth/providers: returns non-secret connection status', async () => {
  process.env.GOOGLE_CLIENT_ID = 'gid';
  process.env.GOOGLE_CLIENT_SECRET = 'shh-secret';
  delete process.env.FACEBOOK_CLIENT_ID;
  const { res, o } = cap();
  await handler(getReq('/auth/providers'), res);
  assert.equal(o.code, 200);
  const j = J(o);
  assert.equal(j.ok, true);
  const g = j.providers.find((p) => p.id === 'google');
  assert.equal(g.configured, true);
  assert.ok(!o.body.includes('shh-secret'), 'endpoint never returns the secret');
});

test('oauth connect (Herald): session-gated; callback stores the sending mailbox', async () => {
  process.env.PENTECAUST_AUTH_DATA = freshFile();
  process.env.PENTECAUST_BASE_URL = 'https://pentecaust.com';
  process.env.GOOGLE_CLIENT_ID = 'gid'; process.env.GOOGLE_CLIENT_SECRET = 'gsec';
  __setFetch(mockProviderFetch({ userinfo: { sub: 'g-conn-1', email: 'seller@gmail.com' } }));

  // no session → 401 (can't connect a mailbox to an account you haven't proven you own)
  let { res, o } = cap();
  await handler(getReq('/auth/google/connect'), res);
  assert.equal(o.code, 401);

  // with a session → 302 to Google with a connect-state cookie
  const sess = makeSession('alice', 'google');
  ({ res, o } = cap());
  await handler(getReq('/auth/google/connect', `pentecaust_session=${encodeURIComponent(sess)}`), res);
  assert.equal(o.code, 302);
  const stateCookie = setCookieList(o.headers).find((c) => c.startsWith('pentecaust_oauth_state='));
  assert.ok(stateCookie, 'connect state cookie set');
  const stateVal = decodeURIComponent(stateCookie.split(';')[0].split('=')[1]);

  // callback with the connect-state → persists alice's sending mailbox, redirects to Integrations
  ({ res, o } = cap());
  await handler(getReq(`/auth/google/callback?code=abc&state=${encodeURIComponent(stateVal)}`, `pentecaust_oauth_state=${encodeURIComponent(stateVal)}`), res);
  assert.equal(o.code, 302);
  assert.match(o.headers.location || o.headers.Location || '', /tab=int/);
  const mb = getMailbox('alice');
  assert.ok(mb && mb.email === 'seller@gmail.com', 'mailbox connected for the session account');
  assert.equal(mb.accessToken, undefined, 'no token leaked to the public view');
  __setFetch(null);
});

// ── SECURITY: the dev-trust header fallback is honored ONLY for a genuinely-local request ──
test('verifier: dev-trust x-melek-account is honored on loopback, IGNORED off-loopback (no impersonation)', () => {
  process.env.PENTECAUST_DEV_TRUST = '1';
  // local dev/tests: the asserted header identity is trusted (so the reference client + suite work)
  const local = { headers: { 'x-melek-account': 'hathor' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(verifier(local), 'hathor');
  // a public request (or one via a proxy) can assert nothing — the header is inert, so no impersonation
  const remote = { headers: { 'x-melek-account': 'hathor' }, socket: { remoteAddress: '203.0.113.7' } };
  assert.equal(verifier(remote), null);
  const proxied = { headers: { 'x-melek-account': 'hathor', 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(verifier(proxied), null);
  delete process.env.PENTECAUST_DEV_TRUST;
});

test('verifier: with the flag OFF, the header never authenticates anyone (even locally)', () => {
  delete process.env.PENTECAUST_DEV_TRUST;
  const local = { headers: { 'x-melek-account': 'hathor' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(verifier(local), null);
});
