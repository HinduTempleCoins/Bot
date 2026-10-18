// melek-signer-login.test.mjs — Pentecaust "Login with MELEK" = the MELEK-Signer REDIRECT flow.
// OFFLINE: the signer's /oauth2/token is an injected fetch; repo-local temp store; no password ever handled.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, `.test-ms-auth-${process.pid}.json`);
process.env.PENTECAUST_SESSION_SECRET = 'ms-test-secret';
process.env.PENTECAUST_AUTH_DATA = STORE;
process.env.PENTECAUST_BASE_URL = 'https://pentecaust.com';
process.env.SSO_ALLOWED_ORIGINS = 'https://pact.pentecaust.com,https://herald.soapbox.community,https://connect.pentecaust.com';
delete process.env.MELEK_SIGNER_URL; delete process.env.MELEK_SIGNER_PUBLIC_URL; delete process.env.MELEK_SIGNER_CLIENT;
delete process.env.PENTECAUST_DEV_TRUST;
after(() => { try { unlinkSync(STORE); } catch {} });

const { handler, __setFetch, sessionFromReq, lookupLink, linkAccount } = await import('./auth.mjs');
const { signerAuthorizeUrl, completeSignerLogin, redirectUri, clientId } = await import('./melek-signer-login.mjs');
const { redeemTicket } = await import('./sso.mjs');
import { createHmac } from 'node:crypto';

// The signer contract: POST /oauth2/token {code, client_id} → {access_token, account, scope}.
const CODES = { 'code-pip': 'melekbot-pip', 'code-nova': 'melekbot-nova' };
const calls = [];
const signerFetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  const acct = CODES[JSON.parse(opts.body).code];
  return { json: async () => (acct ? { access_token: 'tok', account: acct, scope: 'identity' } : { error: 'invalid_grant' }) };
};
__setFetch(signerFetch);

function cap() {
  const o = { code: 0, body: '', headers: {} };
  return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = b || ''; } }, o };
}
const getReq = (path, cookie) => ({ url: path, method: 'GET', headers: cookie ? { cookie } : {}, socket: { remoteAddress: '203.0.113.9' } });
const cookies = (o) => [].concat(o.headers['set-cookie'] || []);
const cookieVal = (o, name) => { for (const c of cookies(o)) { const m = new RegExp(`^${name}=([^;]*)`).exec(c); if (m && m[1]) return m[1]; } return null; };

async function start(qs = '') {
  const { res, o } = cap();
  await handler(getReq(`/auth/melek-signer/start${qs}`), res);
  return o;
}
async function callback(state, code, msCookie) {
  const { res, o } = cap();
  await handler(getReq(`/auth/melek-signer/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    msCookie ? `pentecaust_ms_state=${msCookie}` : undefined), res);
  return o;
}

test('authorize URL targets the PUBLIC signer with client_id=pentecaust and the registered redirect_uri', () => {
  const u = new URL(signerAuthorizeUrl({ state: 'n1' }));
  assert.equal(u.origin + u.pathname, 'https://signer.melek.salon/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'pentecaust');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://pentecaust.com/auth/melek-signer/callback');
  assert.equal(u.searchParams.get('scope'), 'identity');
  assert.equal(u.searchParams.get('state'), 'n1');
  assert.equal(clientId(), 'pentecaust');
  assert.equal(redirectUri(), 'https://pentecaust.com/auth/melek-signer/callback');
});

test('a box-internal MELEK_SIGNER_URL never leaks into the browser redirect', () => {
  process.env.MELEK_SIGNER_URL = 'http://127.0.0.1:8211';
  try { assert.match(signerAuthorizeUrl({ state: 'x' }), /^https:\/\/signer\.melek\.salon\//); }
  finally { delete process.env.MELEK_SIGNER_URL; }
});

test('completeSignerLogin: code → account; bad code / bad account / throw → null', async () => {
  assert.equal(await completeSignerLogin('code-pip', signerFetch), 'melekbot-pip');
  assert.equal(await completeSignerLogin('nope', signerFetch), null);
  assert.equal(await completeSignerLogin('', signerFetch), null);
  assert.equal(await completeSignerLogin('x', async () => { throw new Error('down'); }), null);
  assert.equal(await completeSignerLogin('x', async () => ({ json: async () => ({ access_token: 't', account: 'BAD NAME!' }) })), null);
});

test('start → signer → callback mints a melek-signer session (no password anywhere)', async () => {
  const o = await start();
  assert.equal(o.code, 302);
  const loc = new URL(o.headers.location);
  assert.equal(loc.host, 'signer.melek.salon');
  const state = loc.searchParams.get('state');
  const ms = cookieVal(o, 'pentecaust_ms_state');
  assert.ok(state && ms);
  assert.ok(cookies(o).some((c) => /HttpOnly/.test(c) && /Secure/.test(c)));

  calls.length = 0;
  const cb = await callback(state, 'code-pip', ms);
  assert.equal(cb.code, 302);
  assert.equal(cb.headers.location, '/');
  assert.deepEqual(calls[0].body, { code: 'code-pip', client_id: 'pentecaust' });
  assert.match(calls[0].url, /^https:\/\/signer\.melek\.salon\/oauth2\/token$/);
  const sess = cookieVal(cb, 'pentecaust_session');
  const s = sessionFromReq({ headers: { cookie: `pentecaust_session=${sess}` } });
  assert.equal(s.account, 'melekbot-pip');
  assert.equal(s.method, 'melek-signer');
});

test('CSRF: wrong state, missing cookie, or a forged cookie → 403 and no session', async () => {
  const o = await start();
  const state = new URL(o.headers.location).searchParams.get('state');
  const ms = cookieVal(o, 'pentecaust_ms_state');
  for (const cb of [await callback('attacker', 'code-pip', ms), await callback(state, 'code-pip', null), await callback(state, 'code-pip', 'forged.sig')]) {
    assert.equal(cb.code, 403);
    assert.equal(cookieVal(cb, 'pentecaust_session'), null);
  }
});

test('a failed code exchange mints no session', async () => {
  const o = await start();
  const cb = await callback(new URL(o.headers.location).searchParams.get('state'), 'bogus', cookieVal(o, 'pentecaust_ms_state'));
  assert.equal(cb.code, 502);
  assert.equal(cookieVal(cb, 'pentecaust_session'), null);
});

test('the old password-forwarding endpoint is gone: /auth/method/melek-signer → 404', async () => {
  const handlers = {};
  const req = { url: '/auth/method/melek-signer', method: 'POST', headers: {}, socket: {}, on: (e, f) => { handlers[e] = f; return req; }, destroy() {} };
  queueMicrotask(() => { handlers.data && handlers.data('{"account":"a","password":"p"}'); handlers.end && handlers.end(); });
  const { res, o } = cap();
  await handler(req, res);
  assert.equal(o.code, 404);
});

// ── SSO: Pact / Herald / Connect sign in THROUGH Pentecaust, and the signer round-trip keeps the return ──
for (const sib of ['https://pact.pentecaust.com', 'https://herald.soapbox.community', 'https://connect.pentecaust.com']) {
  test(`SSO via Pentecaust still works for ${sib} with Login with MELEK`, async () => {
    const want = `${sib}/auth/callback`;
    // 1) the sibling bounces an anonymous visitor to /auth/sso → sent to sign in, return carried
    let { res, o } = cap();
    await handler(getReq(`/auth/sso?return=${encodeURIComponent(want)}`), res);
    assert.equal(o.headers.location, `/?sso=${encodeURIComponent(want)}`);
    // 2) the page's Login with MELEK button carries ?sso= into the signer round-trip
    const st = await start(`?sso=${encodeURIComponent(want)}`);
    const state = new URL(st.headers.location).searchParams.get('state');
    const cb = await callback(state, 'code-nova', cookieVal(st, 'pentecaust_ms_state'));
    assert.equal(cb.headers.location, `/auth/sso?return=${encodeURIComponent(want)}`);
    // 3) back at /auth/sso, now signed in → a ticket for the sibling, which redeems to the account
    ({ res, o } = cap());
    await handler(getReq(`/auth/sso?return=${encodeURIComponent(want)}`, `pentecaust_session=${cookieVal(cb, 'pentecaust_session')}`), res);
    const back = new URL(o.headers.location);
    assert.equal(back.origin, sib);
    const r = redeemTicket(back.searchParams.get('sso'), want);
    assert.equal(r.ok, true);
    assert.equal(r.account, 'melekbot-nova');
  });
}

test('an sso return off the allow-list is dropped (no open redirect through the signer round-trip)', async () => {
  const st = await start(`?sso=${encodeURIComponent('https://evil.example/cb')}`);
  const cb = await callback(new URL(st.headers.location).searchParams.get('state'), 'code-pip', cookieVal(st, 'pentecaust_ms_state'));
  assert.equal(cb.headers.location, '/');
});

// ── first social login → "Login with MELEK & link" binds the social to the signer-PROVEN account ──
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signClaim(provider, providerUserId) {
  const body = b64u(JSON.stringify({ kind: 'oauth-claim', provider, providerUserId, exp: Date.now() + 600000 }));
  return `${body}.${b64u(createHmac('sha256', process.env.PENTECAUST_SESSION_SECRET).update(body).digest())}`;
}

test('link: start?link=<claim> → signer → callback binds the social to the proven account', async () => {
  const st = await start(`?link=${encodeURIComponent(signClaim('google', 'g-pip'))}`);
  const cb = await callback(new URL(st.headers.location).searchParams.get('state'), 'code-pip', cookieVal(st, 'pentecaust_ms_state'));
  assert.equal(cb.code, 302);
  assert.equal(cb.headers.location, '/');
  assert.equal(lookupLink('google', 'g-pip', { file: STORE }), 'melekbot-pip');
});

test('link: a social already bound elsewhere is reported, but the MELEK login still stands', async () => {
  linkAccount('google', 'g-taken', 'melekbot-nova', { file: STORE });
  const st = await start(`?link=${encodeURIComponent(signClaim('google', 'g-taken'))}`);
  const cb = await callback(new URL(st.headers.location).searchParams.get('state'), 'code-pip', cookieVal(st, 'pentecaust_ms_state'));
  assert.match(cb.headers.location, /^\/\?link_error=/);
  assert.ok(cookieVal(cb, 'pentecaust_session'));
  assert.equal(lookupLink('google', 'g-taken', { file: STORE }), 'melekbot-nova');
});
