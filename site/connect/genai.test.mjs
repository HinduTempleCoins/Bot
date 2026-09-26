// Pentecaust Connect as key custodian for Hathor Studio — offline tests (injected fetch/resolver, no network).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.CONNECT_LINK_SECRET = 'test-link-secret';
process.env.CONNECT_STUDIO_ORIGINS = 'https://hathor.soapbox.community';

const { __reset: resetVault } = await import('../../integrations/credential-store.mjs');
const { __reset: resetTenants } = await import('../../integrations/tenant-grants.mjs');
const { connectProvider } = await import('./connections.mjs');
const { handler, __setWhoami } = await import('./server.mjs');
const G = await import('./genai.mjs');

const STUDIO = 'https://hathor.soapbox.community';
const FAL_KEY = 'fal-key-NEVER-ECHO';

beforeEach(() => { resetVault(); resetTenants(); __setWhoami(null); G.__setClock(null); G.__setFetch(null); G.__setResolver(null); });

function reqOf({ url, method = 'GET', body = null, headers = {} }) {
  const listeners = {};
  const req = { url, method, headers,
    on(ev, fn) { listeners[ev] = fn; if (ev === 'end') setImmediate(() => { if (body != null && listeners.data) listeners.data(Buffer.from(String(body))); if (listeners.end) listeners.end(); }); return req; },
    destroy() {} };
  return req;
}
async function call(opts) {
  const o = { code: 0, headers: {}, body: '' };
  await handler(reqOf(opts), { writeHead(c, h) { o.code = c; Object.assign(o.headers, h || {}); }, end(b) { o.body = b || ''; } });
  return o;
}
const J = (o) => JSON.parse(o.body);

// ── link tokens ─────────────────────────────────────────────────────────────────────────────────
test('link token: verifies, is scoped, expires, and rejects tampering', () => {
  const t = G.mintLinkToken('alice', { origin: STUDIO, ttlMs: 1000 });
  assert.deepEqual(G.verifyLinkToken(t), { account: 'alice', origin: STUDIO });
  const [, body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ a: 'bob', s: 'genai:image', e: Date.now() + 9e9 })).toString('base64url');
  assert.equal(G.verifyLinkToken(`pcl1.${forged}.${sig}`), null);
  assert.equal(G.verifyLinkToken(`pcl1.${body}.${sig.slice(0, -2)}xx`), null);
  const t0 = Date.now(); G.__setClock(() => t0 + 5000);
  assert.equal(G.verifyLinkToken(t), null); // expired
});

test('/studio-link: only allowlisted origins; signed-out goes to sign-in; signed-in posts the token to that origin only', async () => {
  assert.equal((await call({ url: '/studio-link?origin=https://evil.example' })).code, 400);
  const out = await call({ url: `/studio-link?origin=${encodeURIComponent(STUDIO)}` });
  assert.equal(out.code, 302); assert.equal(out.headers.location, '/auth/login');
  assert.match(out.headers['set-cookie'], /pcl_next=/);

  __setWhoami(() => 'alice');
  connectProvider('alice', { provider: 'fal', key: FAL_KEY });
  const page = await call({ url: `/studio-link?origin=${encodeURIComponent(STUDIO)}` });
  assert.equal(page.code, 200);
  assert.match(page.body, /pentecaust-link/);
  assert.match(page.body, new RegExp(`"${STUDIO.replace(/[./]/g, '\\$&')}"\\)`)); // targetOrigin is the Studio, not "*"
  assert.doesNotMatch(page.body, /NEVER-ECHO/);
  assert.match(page.body, /"fal"/);
});

// ── generate with the stored key ────────────────────────────────────────────────────────────────
test('/v1/genai/image runs fal with the STORED key and returns the image — never the key', async () => {
  connectProvider('alice', { provider: 'fal', key: FAL_KEY });
  let sawAuth = '';
  G.__setFetch(async (url, init) => { sawAuth = init.headers.authorization;
    return { ok: true, status: 200, json: async () => ({ images: [{ url: 'https://fal.media/x.png' }] }) }; });
  const tok = G.mintLinkToken('alice', { origin: STUDIO });
  const r = await call({ url: '/v1/genai/image', method: 'POST', headers: { authorization: `Bearer ${tok}`, origin: STUDIO, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'fal', prompt: 'a blue lotus', size: '512x512' }) });
  assert.equal(r.code, 200);
  assert.equal(J(r).src, 'https://fal.media/x.png');
  assert.equal(sawAuth, `Key ${FAL_KEY}`);
  assert.doesNotMatch(r.body, /NEVER-ECHO/);
  assert.equal(r.headers['access-control-allow-origin'], STUDIO);
});

test('no/bad token → 401; another tenant\'s key is unreachable; foreign origin gets no CORS', async () => {
  connectProvider('alice', { provider: 'fal', key: FAL_KEY });
  G.__setFetch(async () => { throw new Error('must not be called'); });
  const body = JSON.stringify({ provider: 'fal', prompt: 'x' });
  assert.equal((await call({ url: '/v1/genai/image', method: 'POST', body })).code, 401);
  const bob = G.mintLinkToken('bob', { origin: STUDIO });
  const r = await call({ url: '/v1/genai/image', method: 'POST', headers: { authorization: `Bearer ${bob}`, origin: 'https://evil.example' }, body });
  assert.equal(r.code, 404);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('/v1/genai/providers lists only this account\'s image providers', async () => {
  connectProvider('alice', { provider: 'fal', key: FAL_KEY });
  connectProvider('alice', { provider: 'courtlistener', key: 'cl' });
  connectProvider('bob', { provider: 'gemini', key: 'g' });
  const r = await call({ url: '/v1/genai/providers', headers: { authorization: `Bearer ${G.mintLinkToken('alice')}` } });
  assert.deepEqual(J(r).providers, ['fal']);
});

// ── own worker: SSRF guard + job flow ───────────────────────────────────────────────────────────
test('worker URL guard: https only, no private/loopback/metadata addresses', async () => {
  G.__setResolver(async (h) => (h === 'good.modal.run' ? ['34.1.2.3'] : h === 'sneaky.example' ? ['10.0.0.5'] : []));
  assert.equal(await G.safeWorkerBase('https://good.modal.run/'), 'https://good.modal.run');
  await assert.rejects(() => G.safeWorkerBase('http://good.modal.run'), /https/);
  await assert.rejects(() => G.safeWorkerBase('https://127.0.0.1:8510'), /private/);
  await assert.rejects(() => G.safeWorkerBase('https://169.254.169.254/'), /private/);
  await assert.rejects(() => G.safeWorkerBase('https://[::1]/'), /private/);
  await assert.rejects(() => G.safeWorkerBase('https://sneaky.example'), /private/);
});

test('worker runner submits a job, polls, returns the image', async () => {
  G.__setResolver(async () => ['34.1.2.3']);
  const calls = [];
  G.__setFetch(async (url, init = {}) => { calls.push([url, init.headers && init.headers.authorization]);
    if (url.endsWith('/jobs')) return { ok: true, status: 202, json: async () => ({ ok: true, id: 'j1' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, status: 'done', result: { ok: true, base64: 'AAA', mime: 'image/png', mode: 'txt2img' } }) }; });
  const out = await G.RUNNERS.worker(JSON.stringify({ url: 'https://me.modal.run', token: 'pw' }), { prompt: 'x', size: '512x512' }, { pollMs: 1 });
  assert.equal(out.src, 'data:image/png;base64,AAA');
  assert.deepEqual(calls.map((c) => c[1]), ['Bearer pw', 'Bearer pw']);
});

test('normImageJob: unknown provider / empty prompt / non-image data rejected', () => {
  assert.equal(G.normImageJob({ provider: 'openai', prompt: 'x' }).ok, false);
  assert.equal(G.normImageJob({ provider: 'fal', prompt: '  ' }).ok, false);
  assert.equal(G.normImageJob({ provider: 'fal', prompt: 'x', image: 'data:text/html;base64,PHA+' }).job.image, null);
});
