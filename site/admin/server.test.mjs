// site/admin/server.test.mjs — OFFLINE tests for the Soapy.blog admin portal route handler.
//
// No real listen, no network: we set ADMIN_EMAIL + a fixed ADMIN_AUTH_SECRET BEFORE importing the
// modules, then drive the exported handle(req, res) directly with mock req/res objects.
//
//   node --test site/admin/server.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// must be set before importing admin-auth (it reads env at call time, but be explicit + deterministic).
process.env.ADMIN_EMAIL = 'operator@example.com';
process.env.ADMIN_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
process.env.BASE_URL = 'http://localhost:8096';
delete process.env.GOOGLE_CLIENT_ID;

const { handle } = await import('./server.mjs');
const auth = await import('../../integrations/admin-auth.mjs');

// ── mock req/res ─────────────────────────────────────────────────────────────────────────────────
function makeReq({ url = '/', method = 'GET', headers = {}, body = '' } = {}) {
  const listeners = {};
  const req = {
    url, method, headers,
    on(ev, fn) { listeners[ev] = fn; return req; },
    destroy() {},
  };
  // Replay the body on next tick so readBody()'s data/end handlers fire.
  queueMicrotask(() => {
    if (listeners.data && body) listeners.data(Buffer.from(body));
    if (listeners.end) listeners.end();
  });
  return req;
}

function makeRes() {
  return {
    statusCode: 0, headers: {}, body: '', ended: false,
    writeHead(code, hdrs) { this.statusCode = code; if (hdrs) this.headers = { ...this.headers, ...hdrs }; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}

async function call(reqOpts) {
  const req = makeReq(reqOpts);
  const res = makeRes();
  await handle(req, res);
  return res;
}

// build a valid admin session cookie via the real auth layer.
function adminCookie() {
  const s = auth.createSession('operator@example.com');
  assert.ok(s.ok, 'session should be created for the admin');
  return `admin_session=${encodeURIComponent(s.token)}`;
}

// ── tests ──────────────────────────────────────────────────────────────────────────────────────
test('/health is open and returns ok', async () => {
  const res = await call({ url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('unauthenticated gated route → 401 (non-html client)', async () => {
  const res = await call({ url: '/analytics', headers: {} });
  assert.equal(res.statusCode, 401);
});

test('unauthenticated gated route → redirect to /login (browser)', async () => {
  const res = await call({ url: '/', headers: { accept: 'text/html' } });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /\/login/);
});

test('/login renders the sign-in form', async () => {
  const res = await call({ url: '/login' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /magic link/i);
  assert.match(res.body, /Send magic link/);
  // no Google client id configured → shows the "unavailable" note, not a live button
  assert.match(res.body, /unavailable/i);
});

test('with a valid session cookie, a gated route renders', async () => {
  const res = await call({ url: '/', headers: { cookie: adminCookie(), accept: 'text/html' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Operator Console/);
  assert.match(res.body, /operator@example.com/);
});

test('gated /connect renders the service catalog for an admin', async () => {
  const res = await call({ url: '/connect', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /github/);
  assert.match(res.body, /discord/);
});

test('gated /features lists built-but-hidden capabilities', async () => {
  const res = await call({ url: '/features', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /capabilities built/);
  assert.match(res.body, /built but hidden/);
  assert.match(res.body, /Surface this/);
});

test('/features/flag requires admin and redirects back', async () => {
  // unauthenticated → 401 (non-html)
  const denied = await call({ url: '/features/flag', method: 'POST', body: 'id=x&on=1' });
  assert.equal(denied.statusCode, 401);
  // authenticated → 302 back to /features
  const ok = await call({
    url: '/features/flag', method: 'POST', body: 'id=demo-feature&on=1',
    headers: { cookie: adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(ok.statusCode, 302);
  assert.equal(ok.headers.location, '/features');
});

test('/security/scan flags a malicious snippet', async () => {
  const malicious = '<script>document.cookie</script><iframe src="javascript:eval(atob(\'x\'))"></iframe>';
  const res = await call({
    url: '/security/scan', method: 'POST',
    headers: { cookie: adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'html=' + encodeURIComponent(malicious),
  });
  assert.equal(res.statusCode, 200);
  // the scan result is rendered and the verdict is NOT clean
  assert.match(res.body, /Result:/);
  assert.doesNotMatch(res.body, /Result: <span class=ok>clean/);
});

test('full magic-link login flow yields a session and dashboard', async () => {
  const r = await auth.startEmailLogin('operator@example.com');
  assert.ok(r.ok);
  // GET /auth/magic?token=... PEEKS only (messenger link-preview bots GET every
  // URL they see — Telegram's preview fetch burned the operator's single-use
  // link). It renders a confirm page and must NOT consume the token or set a
  // session cookie.
  const peek = await call({ url: `/auth/magic?token=${encodeURIComponent(r.token)}` });
  assert.equal(peek.statusCode, 200);
  assert.match(peek.body, /Complete sign-in/);
  assert.equal(peek.headers['set-cookie'], undefined);
  // a second GET still works — peeks don't consume
  const peek2 = await call({ url: `/auth/magic?token=${encodeURIComponent(r.token)}` });
  assert.equal(peek2.statusCode, 200);
  // the human's POST consumes the token, sets the cookie, redirects to /
  const res = await call({
    url: '/auth/magic', method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(r.token)}`,
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
  const setCookie = res.headers['set-cookie'];
  assert.match(setCookie, /admin_session=/);
  // replay: the consumed token is dead
  const replay = await call({
    url: '/auth/magic', method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(r.token)}`,
  });
  assert.equal(replay.statusCode, 400);
});

test('non-admin email cannot start a login', async () => {
  const r = await auth.startEmailLogin('intruder@example.com');
  assert.equal(r.ok, false);
});

test('injected Google verifier completes login for the admin only', async () => {
  const { __setGoogleVerifier } = await import('./server.mjs');
  // admin claims → session
  __setGoogleVerifier(() => ({ email: 'operator@example.com', email_verified: true }));
  let res = await call({ url: '/auth/google/callback' });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
  // someone else's verified Google account → rejected by the single-admin lock
  __setGoogleVerifier(() => ({ email: 'someone@gmail.com', email_verified: true }));
  res = await call({ url: '/auth/google/callback' });
  assert.equal(res.statusCode, 400);
  __setGoogleVerifier(null);
});
