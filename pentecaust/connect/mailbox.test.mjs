// connect/mailbox.test.mjs — OFFLINE. In-memory store, mocked fetch (token refresh + Gmail send).
// Covers: connect + the @pentecaust.com identity-domain guard, token never exposed, send happy path,
// token refresh on expiry, refresh-failure → reconnect, recipient validation. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectMailbox, getMailbox, disconnectMailbox, sendViaMailbox, __setFetch } from './mailbox.mjs';

function mem() {
  const m = new Map();
  return { fs: { read: (p) => (m.has(p) ? m.get(p) : null), write: (p, s) => m.set(p, s) }, file: 'mem://mailboxes.json' };
}
// A fetch that records the Gmail send + answers refresh; configurable status.
function mockFetch({ sendStatus = 200, sendId = 'msg-1', newAccess = 'AT2' } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2.googleapis.com/token')) return { status: 200, json: async () => ({ access_token: newAccess, expires_in: 3600 }) };
    if (String(url).includes('gmail.googleapis.com')) return { status: sendStatus, json: async () => ({ id: sendId }) };
    return { status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

test('connectMailbox: stores a mailbox; refuses identity domains; hides tokens', () => {
  const o = mem();
  assert.equal(connectMailbox('', { email: 'x@gmail.com' }, o).ok, false);
  assert.equal(connectMailbox('alice', { email: 'bad' }, o).ok, false, 'needs a real email');
  assert.equal(connectMailbox('alice', { email: 'alice@pentecaust.com', accessToken: 'A' }, o).ok, false, 'refuses @pentecaust.com');
  const r = connectMailbox('alice', { provider: 'google', email: 'alice@gmail.com', accessToken: 'A', refreshToken: 'R', expiresAt: 0 }, o);
  assert.equal(r.ok, true);
  assert.equal(r.mailbox.email, 'alice@gmail.com');
  assert.equal(r.mailbox.accessToken, undefined, 'public view carries no token');
  const got = getMailbox('alice', o);
  assert.equal(got.email, 'alice@gmail.com');
  assert.equal(got.refreshToken, undefined, 'getMailbox never returns tokens');
});

test('sendViaMailbox: no mailbox → soft-fail; recipient required', async () => {
  const o = mem();
  assert.equal((await sendViaMailbox('nobody', { to: 'x@y.com' }, o)).ok, false);
  connectMailbox('alice', { email: 'alice@gmail.com', accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 3.6e6 }, o);
  assert.equal((await sendViaMailbox('alice', { to: '' }, o)).ok, false, 'recipient required');
});

test('sendViaMailbox: valid token → sends via Gmail API (from the user mailbox, not pentecaust)', async () => {
  const o = mem();
  const f = mockFetch({ sendId: 'gmail-123' }); __setFetch(f);
  connectMailbox('alice', { email: 'alice@gmail.com', accessToken: 'GOOD', refreshToken: 'R', expiresAt: 2_000_000 }, { ...o, now: 1_000_000 });
  const r = await sendViaMailbox('alice', { to: 'lead@acme.com', subject: 'Hi', body: 'hello' }, { ...o, now: 1_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'gmail-123');
  assert.equal(r.from, 'alice@gmail.com', 'sent FROM the user mailbox');
  const sendCall = f.calls.find((c) => c.url.includes('gmail.googleapis.com'));
  assert.match(sendCall.init.headers.authorization, /Bearer GOOD/, 'used the live access token');
  assert.ok(!f.calls.some((c) => c.url.includes('oauth2.googleapis.com')), 'no refresh needed when token is fresh');
  __setFetch(null);
});

test('sendViaMailbox: expired token → refreshes, then sends', async () => {
  const o = mem();
  const f = mockFetch({ newAccess: 'FRESH' }); __setFetch(f);
  process.env.GOOGLE_CLIENT_ID = 'gid'; process.env.GOOGLE_CLIENT_SECRET = 'gsec';
  connectMailbox('alice', { email: 'alice@gmail.com', accessToken: 'STALE', refreshToken: 'R', expiresAt: 1_000_000 }, { ...o, now: 500_000 });
  const r = await sendViaMailbox('alice', { to: 'lead@acme.com', subject: 'Hi', body: 'yo' }, { ...o, now: 2_000_000 }); // now > expiry
  assert.equal(r.ok, true);
  assert.ok(f.calls.some((c) => c.url.includes('oauth2.googleapis.com')), 'refreshed the token');
  const sendCall = f.calls.find((c) => c.url.includes('gmail.googleapis.com'));
  assert.match(sendCall.init.headers.authorization, /Bearer FRESH/, 'sent with the refreshed token');
  __setFetch(null);
});

test('sendViaMailbox: refresh fails → clean "reconnect" message, never throws', async () => {
  const o = mem();
  __setFetch(async () => { throw new Error('network'); });
  connectMailbox('alice', { email: 'alice@gmail.com', accessToken: '', refreshToken: 'R', expiresAt: 0 }, o);
  const r = await sendViaMailbox('alice', { to: 'lead@acme.com', body: 'x' }, o);
  assert.equal(r.ok, false);
  assert.match(r.reason, /reconnect/);
  __setFetch(null);
});

test('sendViaMailbox: Gmail API 4xx → soft-fail with status', async () => {
  const o = mem();
  __setFetch(mockFetch({ sendStatus: 403 }));
  connectMailbox('alice', { email: 'alice@gmail.com', accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 3.6e6 }, o);
  const r = await sendViaMailbox('alice', { to: 'lead@acme.com', body: 'x' }, o);
  assert.equal(r.ok, false);
  assert.match(r.reason, /403/);
  __setFetch(null);
});

test('disconnectMailbox removes it', () => {
  const o = mem();
  connectMailbox('alice', { email: 'alice@gmail.com', accessToken: 'A' }, o);
  disconnectMailbox('alice', o);
  assert.equal(getMailbox('alice', o), null);
});
