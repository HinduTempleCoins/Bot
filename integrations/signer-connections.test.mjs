import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionStore, createConnectionsClient, CONNECTION_PROVIDERS } from './signer-connections.mjs';

const fixed = () => 1_700_000_000_000;
const seq = (() => { let n = 0; return () => `r${n++}`; })();
const mk = () => createConnectionStore({ now: fixed, rand: () => seq() });

test('a refresh token goes in and never comes back out of any method', () => {
  const s = mk();
  const SECRET = 'rt_thisisarefreshtoken_donotleak';
  const c = s.connect('hathor', 'google', { refreshToken: SECRET, scopes: ['mail.send'] });
  assert.equal(c.ok, true);
  // Every surface a caller can reach, serialised, must not contain it.
  const surfaces = JSON.stringify([c, s.get('hathor', 'google'), s.list('hathor'), s.revoke('hathor', 'google')]);
  assert.ok(!surfaces.includes(SECRET), 'the credential must never be returned');
  assert.ok(!/refreshToken/.test(surfaces), 'not even the field name');
});

test('the connections survive the cookie — that is the whole feature', () => {
  const s = mk();
  s.connect('hathor', 'google', { refreshToken: 'a', scopes: ['mail.send'] });
  s.connect('hathor', 'discord', { refreshToken: 'b' });
  // Pentecaust's cookie is gone. It logs back in as this MELEK account and asks.
  const back = s.list('hathor');
  assert.equal(back.length, 2);
  assert.deepEqual(back.map((x) => x.provider).sort(), ['discord', 'google']);
  assert.ok(back.every((x) => x.healthy));
});

test('connections are per MELEK account and do not bleed across them', () => {
  const s = mk();
  s.connect('hathor', 'google', { refreshToken: 'a' });
  s.connect('someone-else', 'google', { refreshToken: 'b' });
  assert.equal(s.list('hathor').length, 1);
  assert.equal(s.list('someone-else').length, 1);
  assert.notEqual(s.get('hathor', 'google').handle, s.get('someone-else', 'google').handle);
});

test('account lookup is case-insensitive, because a chain account is', () => {
  const s = mk();
  s.connect('Hathor', 'google', { refreshToken: 'a' });
  assert.ok(s.get('hathor', 'google'));
  assert.equal(s.list('HATHOR').length, 1);
});

test('use() hands the credential to a function and returns only the result', async () => {
  const s = mk();
  s.connect('hathor', 'google', { refreshToken: 'rt_secret', accessToken: 'at_1', scopes: ['mail.send'] });
  let sawToken = null;
  const r = await s.use('hathor', 'google', async ({ refreshToken }) => { sawToken = refreshToken; return { sent: 1 }; });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { sent: 1 });
  assert.equal(sawToken, 'rt_secret', 'the doer gets it');
  assert.ok(!JSON.stringify(r).includes('rt_secret'), 'the caller does not');
  assert.ok(s.get('hathor', 'google').lastUsedAt, 'use is recorded');
});

test('use() reports a thrown error instead of leaking a stack with the token in it', async () => {
  const s = mk();
  s.connect('hathor', 'google', { refreshToken: 'rt_secret' });
  const r = await s.use('hathor', 'google', async () => { throw new Error('upstream 401'); });
  assert.equal(r.ok, false);
  assert.match(r.error, /upstream 401/);
  assert.ok(!JSON.stringify(r).includes('rt_secret'));
});

test('use() refuses a revoked or expired connection', async () => {
  const s = mk();
  s.connect('hathor', 'google', { refreshToken: 'a' });
  s.revoke('hathor', 'google');
  assert.equal((await s.use('hathor', 'google', async () => 1)).error, 'revoked');

  const s2 = createConnectionStore({ now: fixed, rand: () => 'x' });
  s2.connect('hathor', 'github', { refreshToken: 'a', expiresAt: fixed() - 1 });
  assert.match((await s2.use('hathor', 'github', async () => 1)).error, /expired/);
  assert.equal(s2.get('hathor', 'github').healthy, false);
});

test('revoke keeps the record and drops the credential', () => {
  const s = mk();
  s.connect('hathor', 'google', { refreshToken: 'a' });
  const r = s.revoke('hathor', 'google');
  assert.equal(r.ok, true);
  assert.equal(r.connection.revoked, true);
  assert.equal(r.connection.healthy, false);
  assert.ok(s.get('hathor', 'google'), 'history is not erased by a disconnect');
  assert.equal(s.forget('hathor', 'google').ok, true, 'forget is the separate, harder action');
  assert.equal(s.get('hathor', 'google'), null);
});

test('reconnecting keeps the handle so anything pointing at it keeps working', () => {
  const s = mk();
  const first = s.connect('hathor', 'google', { refreshToken: 'a' }).connection;
  const again = s.connect('hathor', 'google', { refreshToken: 'b' }).connection;
  assert.equal(again.handle, first.handle);
  assert.equal(again.connectedAt, first.connectedAt, 'the original connection date is preserved');
});

test('bad input is refused, never stored', () => {
  const s = mk();
  assert.match(s.connect('', 'google', { refreshToken: 'a' }).error, /account/);
  assert.match(s.connect('hathor', 'myspace', { refreshToken: 'a' }).error, /unknown provider/);
  assert.match(s.connect('hathor', 'google', {}).error, /refreshToken/);
  assert.equal(s.list('hathor').length, 0);
});

test('a hostile provider name cannot reach Object.prototype', () => {
  const s = mk();
  // The store is a Map, not a bare object, so "__proto__" is an ordinary unknown provider.
  assert.match(s.connect('hathor', '__proto__', { refreshToken: 'a' }).error, /unknown provider/);
  assert.equal({}.polluted, undefined);
});

test('the client soft-fails when the signer is unreachable instead of throwing the page over', async () => {
  const c = createConnectionsClient({ url: 'https://signer.example', token: 't', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await c.list();
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test('the client reports unconfigured rather than calling nowhere', async () => {
  const c = createConnectionsClient({});
  assert.equal(c.configured(), false);
  assert.match((await c.list()).error, /not configured/);
});

test('the client sends a bearer and asks the documented paths', async () => {
  const seen = [];
  const c = createConnectionsClient({ url: 'https://signer.example/', token: 'tok',
    fetchImpl: async (u, i) => { seen.push({ u, auth: i.headers.authorization, body: i.body }); return { json: async () => ({ ok: true, connections: [] }) }; } });
  await c.list(); await c.get('google'); await c.revoke('google');
  assert.deepEqual(seen.map((s) => s.u), [
    'https://signer.example/v1/connections/list',
    'https://signer.example/v1/connections/get',
    'https://signer.example/v1/connections/revoke',
  ]);
  assert.ok(seen.every((s) => s.auth === 'Bearer tok'));
});

test('the provider allowlist is exported so callers do not invent one', () => {
  assert.ok(CONNECTION_PROVIDERS.includes('google'));
  assert.ok(!CONNECTION_PROVIDERS.includes('myspace'));
});
