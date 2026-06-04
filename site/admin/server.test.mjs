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
  // v2 cockpit: tier sections (front-facing-first at top), plain-English
  // descriptions, and the three-way decision buttons
  assert.match(res.body, /FRONT-FACING FIRST/);
  assert.match(res.body, /sorted by the decision/);
  assert.match(res.body, />Surface</);
  assert.match(res.body, />Later</);
  assert.match(res.body, />Not public</);
  // tier order: front-facing section appears before the internal tools section
  assert.ok(res.body.indexOf('FRONT-FACING FIRST') < res.body.indexOf('INTERNAL TOOL'));
});

test('repo toggle: /features (default) shows the Bot catalog + the repo tabs', async () => {
  const res = await call({ url: '/features', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  // Bot catalog still renders unchanged
  assert.match(res.body, /capabilities built/);
  assert.match(res.body, /FRONT-FACING FIRST/);
  // the new repo toggle is present with the ecosystem repos
  assert.match(res.body, /Switch between MELEK-ecosystem repos/);
  assert.match(res.body, /repo=PRANA/);
  assert.match(res.body, /repo=melek-chain/);
  assert.match(res.body, /repo=KULASwap/);
});

test('repo toggle: /features?repo=PRANA renders the PRANA panel (honest scaffold note)', async () => {
  const res = await call({ url: '/features?repo=PRANA', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  // PRANA repo panel — NOT the Bot module catalog
  assert.doesNotMatch(res.body, /capabilities built/);
  assert.match(res.body, /scaffold\/empty/);
  assert.match(res.body, /chain code not built yet/);
  // GitHub link opens in a new tab safely
  assert.match(res.body, /github\.com\/HinduTempleCoins\/PRANA/);
  assert.match(res.body, /target="_blank" rel="noopener"/);
  // toggle still present so you can switch back
  assert.match(res.body, /repo=Bot/);
});

test('repo toggle: /features?repo=melek-chain renders a live-codebase panel with its tree', async () => {
  const res = await call({ url: '/features?repo=melek-chain', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /live-codebase/);
  assert.match(res.body, /Graphene/);              // its description
  assert.match(res.body, /Top-level contents/);    // file tree section
});

test('repo toggle: an unknown ?repo= falls back to the Bot catalog', async () => {
  const res = await call({ url: '/features?repo=does-not-exist', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /capabilities built/);    // Bot catalog
});

test('CAPTCHA console: seed a handoff, see it listed, solve it (end-to-end)', async () => {
  // pin a fresh in-memory store so the seed + list + resolve share one queue deterministically
  const captcha = await import('../../integrations/captcha-handoff.mjs');
  captcha.__setStore(new Map());
  // gated
  const denied = await call({ url: '/captcha' });
  assert.equal(denied.statusCode, 401);
  // page renders for admin
  const page = await call({ url: '/captcha', headers: { cookie: adminCookie() } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /CAPTCHA \/ human-step handoffs/);
  assert.match(page.body, /Test it \(seed a Twitter CAPTCHA\)/);
  // seed a Twitter CAPTCHA handoff
  const seeded = await call({
    url: '/captcha/test', method: 'POST', body: '',
    headers: { cookie: adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(seeded.statusCode, 302);
  assert.equal(seeded.headers.location, '/captcha');
  // it now shows in the pending list with a resolve form + the right id to solve
  const listed = await call({ url: '/captcha', headers: { cookie: adminCookie() } });
  assert.match(listed.body, /twitter signup \(test\)/);
  assert.match(listed.body, /Submit answer/);
  const m = listed.body.match(/name=id value="([^"]+)"/);
  assert.ok(m, 'a pending handoff id is present to solve');
  // solve it — the operator types the CAPTCHA answer
  const solved = await call({
    url: '/captcha/resolve', method: 'POST',
    body: `id=${encodeURIComponent(m[1])}&answer=HELLO123`,
    headers: { cookie: adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(solved.statusCode, 200);
  assert.match(solved.body, /Solved — the signup flow can now resume/);
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

test('/claude/history is admin-gated → 401 without a cookie', async () => {
  const res = await call({ url: '/claude/history?sessionId=admin', headers: {} });
  assert.equal(res.statusCode, 401);
});

test('/claude/history returns JSON {history:[…]} for an admin (display-safe fields only)', async () => {
  const relay = await import('../../integrations/claude-relay.mjs');
  relay.__reset();
  // configure the relay + seed a turn so history has content
  process.env.CLAUDE_RELAY_URL = 'https://server4.example/claude';
  process.env[['CLAUDE', 'RELAY', 'TOKEN'].join('_')] = 'tok-not-real';
  relay.__setTransport(async (payload) => ({ reply: `echo:${payload.message}`, sessionId: payload.sessionId }));
  await relay.sendToClaude({ message: 'hello server', sessionId: 'admin', from: 'operator@example.com' });

  const res = await call({ url: '/claude/history?sessionId=admin', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] || '', /application\/json/);
  const data = JSON.parse(res.body);
  assert.equal(data.sessionId, 'admin');
  assert.ok(Array.isArray(data.history));
  assert.equal(data.history.length, 2, 'user turn + assistant turn');
  // display-safe fields only: ts, from, text — and from is normalized to a screen-name
  const userTurn = data.history[0];
  assert.equal(userTurn.from, 'operator@example.com');
  assert.equal(userTurn.text, 'hello server');
  assert.ok('ts' in userTurn);
  assert.equal(data.history[1].from, 'claude');
  assert.equal(data.history[1].text, 'echo:hello server');

  delete process.env.CLAUDE_RELAY_URL;
  delete process.env[['CLAUDE', 'RELAY', 'TOKEN'].join('_')];
  relay.__reset();
});

test('/claude messenger panel renders the #ops header + status dot + input bar', async () => {
  const res = await call({ url: '/claude', headers: { cookie: adminCookie() } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /#ops/);
  assert.match(res.body, /Claude @ Server 4/);
  assert.match(res.body, /claude-dot/);
  assert.match(res.body, /action="\/claude\/send"/);
  assert.match(res.body, /\/claude\/history/, 'panel polls the history route');
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

// ── #246: the REAL Google id-token verifier (tokeninfo via injectable fetch) ─────────────────────
// The default verifier (no injected one) actually verifies the token: it calls the tokeninfo
// endpoint through __setFetch, then enforces issuer / audience / expiry / email_verified BEFORE
// trusting any claim. We never trust an unverified token.
test('#246 real Google verifier: valid tokeninfo (right aud/iss/exp + allowed email) → session', async () => {
  const srv = await import('./server.mjs');
  srv.__setGoogleVerifier(null); // use the REAL default path
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  const futureExp = String(Math.floor(Date.now() / 1000) + 3600);
  let calledUrl = '';
  srv.__setFetch(async (u) => {
    calledUrl = String(u);
    return {
      ok: true,
      async json() {
        return {
          iss: 'https://accounts.google.com',
          aud: 'client-123.apps.googleusercontent.com',
          exp: futureExp,
          email: 'operator@example.com',
          email_verified: 'true',
        };
      },
    };
  });
  const res = await call({ url: '/auth/google/callback?credential=fake.jwt.token' });
  assert.equal(res.statusCode, 302, 'a verified admin id-token mints a session');
  assert.equal(res.headers.location, '/');
  assert.match(res.headers['set-cookie'] || '', /admin_session=/);
  // it actually hit Google's tokeninfo endpoint with the token (verified, not trusted)
  assert.match(calledUrl, /oauth2\.googleapis\.com\/tokeninfo\?id_token=fake\.jwt\.token/);
  srv.__setFetch(null);
  delete process.env.GOOGLE_CLIENT_ID;
});

test('#246 real Google verifier: WRONG audience → rejected, no session', async () => {
  const srv = await import('./server.mjs');
  srv.__setGoogleVerifier(null);
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  const futureExp = String(Math.floor(Date.now() / 1000) + 3600);
  srv.__setFetch(async () => ({
    ok: true,
    async json() {
      return {
        iss: 'https://accounts.google.com',
        aud: 'SOME-OTHER-APP.apps.googleusercontent.com', // not ours
        exp: futureExp,
        email: 'operator@example.com',
        email_verified: 'true',
      };
    },
  }));
  const res = await call({ url: '/auth/google/callback?credential=fake.jwt.token' });
  assert.equal(res.statusCode, 400, 'a token minted for another app is never trusted');
  assert.equal(res.headers['set-cookie'], undefined);
  srv.__setFetch(null);
  delete process.env.GOOGLE_CLIENT_ID;
});

test('#246 real Google verifier: EXPIRED token → rejected, no session', async () => {
  const srv = await import('./server.mjs');
  srv.__setGoogleVerifier(null);
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  const pastExp = String(Math.floor(Date.now() / 1000) - 60);
  srv.__setFetch(async () => ({
    ok: true,
    async json() {
      return {
        iss: 'https://accounts.google.com',
        aud: 'client-123.apps.googleusercontent.com',
        exp: pastExp, // already expired
        email: 'operator@example.com',
        email_verified: 'true',
      };
    },
  }));
  const res = await call({ url: '/auth/google/callback?credential=fake.jwt.token' });
  assert.equal(res.statusCode, 400, 'an expired token is rejected');
  assert.equal(res.headers['set-cookie'], undefined);
  srv.__setFetch(null);
  delete process.env.GOOGLE_CLIENT_ID;
});

test('#246 real Google verifier: network error → fails closed (no session)', async () => {
  const srv = await import('./server.mjs');
  srv.__setGoogleVerifier(null);
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  srv.__setFetch(async () => { throw new Error('network down'); });
  const res = await call({ url: '/auth/google/callback?credential=fake.jwt.token' });
  assert.equal(res.statusCode, 400, 'a verifier network error fails closed, never throws');
  assert.equal(res.headers['set-cookie'], undefined);
  srv.__setFetch(null);
  delete process.env.GOOGLE_CLIENT_ID;
});

// ── #248: /connect/callback completes the OAuth round-trip and stores a grant ────────────────────
test('#248 /connect/callback: valid state + exchange → redirects to ?connected= and stores a grant', async () => {
  const srv = await import('./server.mjs');
  const connect = await import('../../integrations/ifttt-connect.mjs');
  // handleCallback writes the grant into the default credential-store; we read it back from there
  // via listConnections() to prove the round-trip stored a real grant.
  // preload a known connect-state as if authorizeUrl had issued it (PKCE verifier included)
  srv.__rememberConnectState('state-abc', 'github', 'verifier-xyz');
  // inject the fetch the exchange uses → a successful token response
  let postedTo = '';
  srv.__setFetch(async (u, opts) => {
    postedTo = String(u);
    assert.match(String(opts?.body || ''), /code=the-code/);
    assert.match(String(opts?.body || ''), /grant_type=authorization_code/);
    return { ok: true, async json() { return { access_token: 'tok-123', scope: 'read:user repo' }; } };
  });
  const res = await call({
    url: '/connect/callback?state=state-abc&code=the-code',
    headers: { cookie: adminCookie() },
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/connect?connected=github');
  assert.match(postedTo, /github\.com\/login\/oauth\/access_token/, 'it POSTed to the provider token endpoint');
  // the grant landed in the default vault — read it back through the connect hub
  const conns = await connect.listConnections().catch(() => []);
  const gh = conns.find((c) => c.name === 'github');
  assert.ok(gh, 'a github grant was stored after the exchange');
  assert.equal(gh.status, 'connected');
  srv.__setFetch(null);
  // cleanup so the stored grant doesn't leak into other tests
  await connect.revoke('github').catch(() => {});
});

test('#248 /connect/callback: unknown/expired state → redirect to ?error=invalid_state, no grant', async () => {
  const srv = await import('./server.mjs');
  srv.__setFetch(async () => { throw new Error('exchange should not be called for a bad state'); });
  const res = await call({
    url: '/connect/callback?state=never-issued&code=the-code',
    headers: { cookie: adminCookie() },
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/connect?error=invalid_state');
  srv.__setFetch(null);
});

test('#248 /connect/callback is admin-gated → 401 without a session', async () => {
  const res = await call({ url: '/connect/callback?state=x&code=y' });
  assert.equal(res.statusCode, 401);
});

// ── #249: CSRF Origin check on POST routes ───────────────────────────────────────────────────────
test('#249 cross-origin POST (Origin != BASE_URL) → 403', async () => {
  const res = await call({
    url: '/features/flag', method: 'POST', body: 'id=demo&on=1',
    headers: {
      cookie: adminCookie(),
      origin: 'https://evil.example.com',
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  assert.equal(res.statusCode, 403, 'a forged cross-site post is rejected');
});

test('#249 same-origin POST (Origin == BASE_URL) still works', async () => {
  const res = await call({
    url: '/features/flag', method: 'POST', body: 'id=demo-feature&on=1',
    headers: {
      cookie: adminCookie(),
      origin: 'http://localhost:8096',
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/features');
});

test('#249 no-Origin POST still works (non-browser client / tests)', async () => {
  const res = await call({
    url: '/features/flag', method: 'POST', body: 'id=demo-feature&on=1',
    headers: { cookie: adminCookie(), 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/features');
});

// ── passkey / WebAuthn end-to-end (task #250) ────────────────────────────────────────────────────
// Reuse a real EC P-256 key + hand-built CBOR to drive the four routes through handle() offline.
import crypto from 'node:crypto';
import { __resetStore as resetPasskeys } from '../../integrations/passkey-store.mjs';

const PK_ORIGIN = 'http://localhost:8096';
const PK_RPID = 'localhost';

function pkB64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function pkFromB64u(s) { const p = s.length % 4 ? '='.repeat(4 - s.length % 4) : ''; return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + p, 'base64'); }
function pkCborUInt(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function pkInt(n) { return n >= 0 ? pkCborUInt(0, n) : pkCborUInt(1, -1 - n); }
function pkBytes(b) { return Buffer.concat([pkCborUInt(2, b.length), b]); }
function pkText(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([pkCborUInt(3, b.length), b]); }
function pkMap(pairs) { const parts = [pkCborUInt(5, pairs.length)]; for (const [k, v] of pairs) parts.push(k, v); return Buffer.concat(parts); }
function pkCoseKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return pkMap([[pkInt(1), pkInt(2)], [pkInt(3), pkInt(-7)], [pkInt(-1), pkInt(1)], [pkInt(-2), pkBytes(pkFromB64u(jwk.x))], [pkInt(-3), pkBytes(pkFromB64u(jwk.y))]]);
}
function pkAuthData({ flags, signCount, credentialId = null, coseKey = null }) {
  const rpIdHash = crypto.createHash('sha256').update(Buffer.from(PK_RPID, 'utf8')).digest();
  const head = Buffer.alloc(37); rpIdHash.copy(head, 0); head.writeUInt8(flags, 32); head.writeUInt32BE(signCount, 33);
  if (!credentialId) return head;
  const aaguid = Buffer.alloc(16, 0); const cl = Buffer.alloc(2); cl.writeUInt16BE(credentialId.length, 0);
  return Buffer.concat([head, aaguid, cl, credentialId, coseKey]);
}

test('/login shows the passkey button + client glue', async () => {
  const res = await call({ url: '/login' });
  assert.match(res.body, /Sign in with passkey/);
  assert.match(res.body, /navigator\.credentials/);
});

test('passkey enrolment is admin-gated (no session → 401)', async () => {
  const res = await call({ url: '/auth/passkey/register/options', method: 'POST', headers: { origin: PK_ORIGIN } });
  assert.equal(res.statusCode, 401);
});

test('passkey enrol + login round-trips and mints a session', async () => {
  resetPasskeys();
  const cookie = adminCookie();

  // 1) registration options (admin-gated)
  let res = await call({ url: '/auth/passkey/register/options', method: 'POST', headers: { cookie, origin: PK_ORIGIN } });
  assert.equal(res.statusCode, 200);
  const regOpts = JSON.parse(res.body);
  assert.ok(regOpts.challenge);

  // 2) build a real attestation for a fresh key, signed nowhere (none fmt)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = crypto.randomBytes(20);
  const authData = pkAuthData({ flags: 0x45, signCount: 0, credentialId, coseKey: pkCoseKey(publicKey) });
  const attObj = pkMap([[pkText('fmt'), pkText('none')], [pkText('attStmt'), pkMap([])], [pkText('authData'), pkBytes(authData)]]);
  const regClientData = pkB64u(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: regOpts.challenge, origin: PK_ORIGIN })));
  const regBody = JSON.stringify({ id: pkB64u(credentialId), rawId: pkB64u(credentialId), type: 'public-key', response: { clientDataJSON: regClientData, attestationObject: pkB64u(attObj) } });
  res = await call({ url: '/auth/passkey/register/verify', method: 'POST', headers: { cookie, origin: PK_ORIGIN, 'content-type': 'application/json' }, body: regBody });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);

  // 3) login options (anonymous, no session)
  res = await call({ url: '/auth/passkey/login/options', method: 'POST', headers: { origin: PK_ORIGIN } });
  assert.equal(res.statusCode, 200);
  const loginOpts = JSON.parse(res.body);
  assert.ok(loginOpts.challenge && loginOpts.handle);

  // 4) sign an assertion over authData||SHA256(clientDataJSON)
  const aData = pkAuthData({ flags: 0x05, signCount: 1 });
  const loginClientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: loginOpts.challenge, origin: PK_ORIGIN }));
  const signed = Buffer.concat([aData, crypto.createHash('sha256').update(loginClientData).digest()]);
  const signature = crypto.sign('sha256', signed, { key: privateKey, dsaEncoding: 'der' });
  const loginBody = JSON.stringify({ handle: loginOpts.handle, id: pkB64u(credentialId), rawId: pkB64u(credentialId), type: 'public-key', response: { clientDataJSON: pkB64u(loginClientData), authenticatorData: pkB64u(aData), signature: pkB64u(signature) } });
  res = await call({ url: '/auth/passkey/login/verify', method: 'POST', headers: { origin: PK_ORIGIN, 'content-type': 'application/json' }, body: loginBody });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  // a session cookie was set
  const setCookie = res.headers['set-cookie'];
  assert.ok(setCookie && /admin_session=/.test(setCookie), 'login should set the session cookie');
});

test('passkey login rejects a wrong-challenge assertion', async () => {
  resetPasskeys();
  const cookie = adminCookie();
  let res = await call({ url: '/auth/passkey/register/options', method: 'POST', headers: { cookie, origin: PK_ORIGIN } });
  const regOpts = JSON.parse(res.body);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = crypto.randomBytes(20);
  const authData = pkAuthData({ flags: 0x45, signCount: 0, credentialId, coseKey: pkCoseKey(publicKey) });
  const attObj = pkMap([[pkText('fmt'), pkText('none')], [pkText('attStmt'), pkMap([])], [pkText('authData'), pkBytes(authData)]]);
  const regClientData = pkB64u(Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: regOpts.challenge, origin: PK_ORIGIN })));
  await call({ url: '/auth/passkey/register/verify', method: 'POST', headers: { cookie, origin: PK_ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ id: pkB64u(credentialId), rawId: pkB64u(credentialId), type: 'public-key', response: { clientDataJSON: regClientData, attestationObject: pkB64u(attObj) } }) });

  res = await call({ url: '/auth/passkey/login/options', method: 'POST', headers: { origin: PK_ORIGIN } });
  const loginOpts = JSON.parse(res.body);
  // sign over a DIFFERENT (wrong) challenge than the server issued
  const aData = pkAuthData({ flags: 0x05, signCount: 1 });
  const wrongClientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: pkB64u(crypto.randomBytes(32)), origin: PK_ORIGIN }));
  const signed = Buffer.concat([aData, crypto.createHash('sha256').update(wrongClientData).digest()]);
  const signature = crypto.sign('sha256', signed, { key: privateKey, dsaEncoding: 'der' });
  const loginBody = JSON.stringify({ handle: loginOpts.handle, id: pkB64u(credentialId), rawId: pkB64u(credentialId), type: 'public-key', response: { clientDataJSON: pkB64u(wrongClientData), authenticatorData: pkB64u(aData), signature: pkB64u(signature) } });
  res = await call({ url: '/auth/passkey/login/verify', method: 'POST', headers: { origin: PK_ORIGIN, 'content-type': 'application/json' }, body: loginBody });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});
