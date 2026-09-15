// OFFLINE. No network, no disk beyond the model's injectable store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PENTECAUST_SESSION_SECRET = 'pact-test-secret';
process.env.SSO_ALLOWED_ORIGINS = 'https://pact.pentecaust.com';
process.env.BASE_URL = 'https://pact.pentecaust.com';
process.env.GROUPS_DATA = `/tmp/pact-groups-${process.pid}.json`;
const { handler } = await import('./server.mjs');
const { makeSiblingSession, COOKIE } = await import('../../pentecaust/sso.mjs');

const cap = () => { const o = { code: 0, body: '', headers: {} }; return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = b || ''; } }, o }; };
const req = (url, method = 'GET', body, cookie) => ({ url, method, body, headers: cookie ? { cookie } : {} });
const cookieFor = (a) => `${COOKIE}=${encodeURIComponent(makeSiblingSession(a))}`;
const J = (o) => { try { return JSON.parse(o.body); } catch { return {}; } };

test('the front page renders signed-out and offers sign-in', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /Sign in with MELEK/);
  assert.match(o.body, /A pact is a binding agreement/);
  assert.ok(!/Log out/.test(o.body));
});

test('signed-in state is rendered SERVER-side so it is right on first paint', async () => {
  const { res, o } = cap();
  await handler(req('/', 'GET', undefined, cookieFor('hathor')), res);
  assert.match(o.body, /@hathor/);
  assert.match(o.body, /Log out/);
  assert.ok(!/Sign in with MELEK/.test(o.body));
});

test('⭐ identity comes from the SSO ticket session, and drives the group API', async () => {
  const c = cookieFor('alice');
  let { res, o } = cap();
  await handler(req('/groups', 'POST', { name: 'First Pact' }, c), res);
  assert.equal(J(o).ok, true, o.body);
  const id = J(o).group.id;

  ({ res, o } = cap());
  await handler(req(`/groups/${id}/me`, 'GET', undefined, c), res);
  assert.equal(J(o).role, 'owner');

  // …and anonymous cannot write
  ({ res, o } = cap());
  await handler(req('/groups', 'POST', { name: 'Nope' }), res);
  assert.equal(o.code, 401);
});

test('/auth/login bounces to Pentecaust, not to a local form', async () => {
  const { res, o } = cap();
  await handler(req('/auth/login'), res);
  assert.equal(o.code, 302);
  assert.match(o.headers.location, /^https:\/\/pentecaust\.com\/auth\/sso\?return=/);
  assert.match(decodeURIComponent(o.headers.location), /pact\.pentecaust\.com\/auth\/callback/);
});

test('the directory is public — you can see the pacts before signing in', async () => {
  const { res, o } = cap();
  await handler(req('/groups'), res);
  assert.equal(o.code, 200);
  assert.ok(Array.isArray(J(o).groups));
  assert.ok(J(o).joinPolicies.includes('dues'), 'clubs are a join policy, not a separate product');
});

test('health, robots and sitemap answer; anything else is a 404', async () => {
  for (const [p, re] of [['/health', /ok/], ['/robots.txt', /User-agent/i], ['/sitemap.xml', /<urlset/]]) {
    const { res, o } = cap();
    await handler(req(p), res);
    assert.equal(o.code, 200, p);
    assert.match(o.body, re, p);
  }
  const { res, o } = cap();
  await handler(req('/nonsense'), res);
  assert.equal(o.code, 404);
});
