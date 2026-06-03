import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  startEmailLogin,
  verifyMagicLink,
  verifyGoogleLogin,
  createSession,
  verifySession,
  revokeSession,
  requireAdmin,
  __setProviders,
  __resetProviders,
  __resetRevoked,
} from './admin-auth.mjs';

const ADMIN = 'operator@gmail.com';
const OTHER = 'stranger@gmail.com';

// deterministic, offline providers
let clock;
let idCounter;
function setupProviders() {
  clock = 1_000_000;
  idCounter = 0;
  __resetProviders();
  __setProviders({
    now: () => clock,
    randomId: () => `id-${++idCounter}`,
    sendMail: async () => ({ delivered: true }),
  });
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = ADMIN;
  process.env.ADMIN_AUTH_SECRET = 'test-secret-deterministic';
  setupProviders();
  __resetRevoked();
});

test('non-admin email cannot start email login', async () => {
  const r = await startEmailLogin(OTHER);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-admin');
  assert.equal(r.token, undefined);
});

test('admin magic-link round-trips', async () => {
  const start = await startEmailLogin(ADMIN);
  assert.equal(start.ok, true);
  assert.ok(start.token);
  const v = verifyMagicLink(start.token);
  assert.equal(v.ok, true);
  assert.equal(v.email, ADMIN);
});

test('magic-link is case-insensitive on admin email', async () => {
  const start = await startEmailLogin('Operator@Gmail.com');
  assert.equal(start.ok, true);
  assert.equal(verifyMagicLink(start.token).ok, true);
});

test('expired magic-link is rejected', async () => {
  const start = await startEmailLogin(ADMIN, { ttlMs: 1000 });
  clock += 2000; // advance past expiry
  const v = verifyMagicLink(start.token);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'expired');
});

test('tampered magic-link is rejected', async () => {
  const start = await startEmailLogin(ADMIN);
  // flip a character in the signature portion
  const tampered = start.token.slice(0, -1) + (start.token.slice(-1) === 'a' ? 'b' : 'a');
  const v = verifyMagicLink(tampered);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'bad-signature');
});

test('magic-link with swapped email payload fails signature', async () => {
  const start = await startEmailLogin(ADMIN);
  const [body] = start.token.split('.');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  payload.e = OTHER;
  const forgedBody = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const forged = `${forgedBody}.${start.token.split('.')[1]}`;
  const v = verifyMagicLink(forged);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'bad-signature');
});

test('magic-link is single-use', async () => {
  const start = await startEmailLogin(ADMIN);
  assert.equal(verifyMagicLink(start.token).ok, true);
  const second = verifyMagicLink(start.token);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already-used');
});

test('Google login succeeds only for ADMIN_EMAIL', () => {
  const ok = verifyGoogleLogin({ email: ADMIN, email_verified: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, ADMIN);

  const bad = verifyGoogleLogin({ email: OTHER, email_verified: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not-admin');
});

test('Google login rejects unverified email and missing email', () => {
  assert.equal(verifyGoogleLogin({ email: ADMIN, email_verified: false }).reason, 'email-unverified');
  assert.equal(verifyGoogleLogin({}).reason, 'no-email');
});

test('session create / verify / revoke', () => {
  const s = createSession(ADMIN);
  assert.equal(s.ok, true);
  assert.ok(s.token);

  const v = verifySession(s.token);
  assert.equal(v.ok, true);
  assert.equal(v.email, ADMIN);

  const rev = revokeSession(s.token);
  assert.equal(rev.ok, true);

  const after = verifySession(s.token);
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'revoked');
});

test('createSession refuses non-admin', () => {
  const s = createSession(OTHER);
  assert.equal(s.ok, false);
  assert.equal(s.reason, 'not-admin');
});

test('expired session is rejected', () => {
  const s = createSession(ADMIN, { ttlMs: 1000 });
  clock += 2000;
  const v = verifySession(s.token);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'expired');
});

test('session token cannot be replayed as a magic link (domain separation)', () => {
  const s = createSession(ADMIN);
  const v = verifyMagicLink(s.token);
  assert.equal(v.ok, false); // wrong kind in signature → bad-signature
});

test('requireAdmin gate reads Bearer header', () => {
  const s = createSession(ADMIN);
  const okReq = { headers: { authorization: `Bearer ${s.token}` } };
  assert.equal(requireAdmin(okReq).ok, true);

  const noReq = { headers: {} };
  const r = requireAdmin(noReq);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-session');
});

test('requireAdmin gate reads cookie', () => {
  const s = createSession(ADMIN);
  const req = { headers: { cookie: `foo=bar; admin_session=${encodeURIComponent(s.token)}` } };
  assert.equal(requireAdmin(req).ok, true);
});
