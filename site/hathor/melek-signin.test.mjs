// melek-signin.test.mjs — Studio identity = a MELEK-Signer session ONLY (the x-melek-user header is ignored).
// OFFLINE: the signer token exchange is injected; DATA_DIR is a repo-local scratch dir removed afterwards.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), `.test-signin-${process.pid}`);
process.env.DATA_DIR = DIR;
process.env.MELEK_SESSION_SECRET = 'studio-test-secret';
delete process.env.MELEK_SIGNER_URL; delete process.env.MELEK_SIGNER_PUBLIC_URL;
delete process.env.HATHOR_STUDIO_URL; delete process.env.BASE_URL;
after(() => { try { rmSync(DIR, { recursive: true, force: true }); } catch {} });

const { handler, studioUser, __setSignerFetch, bifrostUploadView, hardDriveView } = await import('./server.mjs');
const { mintSession, SESSION_COOKIE } = await import('../../integrations/melek-login.mjs');

__setSignerFetch(async (_url, opts) => {
  const { code, client_id } = JSON.parse(opts.body);
  const ok = code === 'good' && client_id === 'hathor-studio';
  return { json: async () => (ok ? { access_token: 't', account: 'melekbot-pip', scope: 'identity' } : { error: 'invalid_grant' }) };
});

let ip = 0;
async function call({ method = 'GET', url = '/', body, headers = {} }) {
  const listeners = {};
  const req = { method, url, headers, socket: { remoteAddress: `10.9.0.${++ip}` }, on(ev, cb) { listeners[ev] = cb; return req; } };
  const res = { status: 0, headers: {}, body: '', writeHead(c, h) { this.status = c; Object.assign(this.headers, h || {}); }, end(d) { if (d != null) this.body += String(d); } };
  const p = handler(req, res);
  queueMicrotask(() => { if (body && listeners.data) listeners.data(Buffer.from(body)); if (listeners.end) listeners.end(); });
  await p; await new Promise((r) => setTimeout(r, 5));
  return res;
}
const sess = (a) => `${SESSION_COOKIE}=${mintSession(a, { provider: 'melek' })}`;

test('the x-melek-user header is NOT identity any more', () => {
  assert.equal(studioUser({ headers: { 'x-melek-user': 'hathor' } }), null);
  assert.equal(studioUser({ headers: { cookie: sess('melekbot-pip') } }), 'melekbot-pip');
});

test('Sign in with MELEK → signer authorize (client hathor-studio, registered redirect_uri)', async () => {
  const r = await call({ url: '/auth/melek-signer/start?return=/pentecaust/bifrost/upload' });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.location);
  assert.equal(u.origin + u.pathname, 'https://signer.melek.salon/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'hathor-studio');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://hathor.soapbox.community/auth/melek-signer/callback');

  const cb = await call({ url: `/auth/melek-signer/callback?code=good&state=${u.searchParams.get('state')}`,
    headers: { cookie: String(r.headers['set-cookie']).split(';')[0] } });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.location, '/pentecaust/bifrost/upload');
  const sc = [].concat(cb.headers['set-cookie']);
  assert.ok(sc.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && /Domain=\.soapbox\.community/.test(c)));
  const me = await call({ url: '/auth/me', headers: { cookie: sc[0].split(';')[0] } });
  assert.equal(JSON.parse(me.body).account, 'melekbot-pip');
});

test('callback with a forged state or bad code signs nobody in', async () => {
  const r = await call({ url: '/auth/melek-signer/start' });
  const state = new URL(r.headers.location).searchParams.get('state');
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  assert.equal((await call({ url: `/auth/melek-signer/callback?code=good&state=forged`, headers: { cookie } })).status, 403);
  assert.equal((await call({ url: `/auth/melek-signer/callback?code=bad&state=${state}`, headers: { cookie } })).status, 502);
});

const post = (headers, extra = {}) => call({ method: 'POST', url: '/api/bifrost/publish', headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ title: 'Walk', videoUrl: 'https://cdn.example/v.mp4', author: 'hathor', ...extra }) });

test('Bifrost publish: a header/body-asserted author is ignored (anon); the session account is the author', async () => {
  const forged = await post({ 'x-melek-user': 'hathor' });
  assert.equal(forged.status, 200, forged.body);
  assert.match(JSON.parse(forged.body).url, /\/watch\/anon\//);
  const real = await post({ cookie: sess('melekbot-pip'), 'x-melek-user': 'hathor' });
  assert.match(JSON.parse(real.body).url, /\/watch\/melekbot-pip\//);
});

test('upload + HardDrive pages carry the Sign in with MELEK button / signed-in chip', () => {
  assert.match(bifrostUploadView(), /Sign in with MELEK/);
  assert.match(hardDriveView(), /\/auth\/melek-signer\/start\?return=/);
  assert.match(bifrostUploadView({ account: 'melekbot-pip' }), /Signed in as <b>@melekbot-pip<\/b>/);
});

test('logout clears the session cookie on the shared domain', async () => {
  const r = await call({ url: '/auth/logout?return=/tools' });
  assert.equal(r.status, 302); assert.equal(r.headers.location, '/tools');
  assert.match(String(r.headers['set-cookie']), /Max-Age=0/);
});
