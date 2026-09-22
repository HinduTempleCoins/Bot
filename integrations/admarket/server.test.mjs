// server.test.mjs — offline, no network, no real listen. Drives handler(req,res) with mock req/res.
// End-to-end: create (self-serve) → funding intent → operator review → confirm → serve → click; gating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { handler, __setStore } from './server.mjs';
import { createStore } from './model.mjs';

// mock req: an EventEmitter that emits the JSON body; mock res: captures head+body.
function mkReq(method, path, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method; req.url = path; req.headers = headers;
  queueMicrotask(() => { if (body !== undefined) req.emit('data', JSON.stringify(body)); req.emit('end'); });
  return req;
}
function mkRes() {
  return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { if (b != null) this.body += b; this.ended = true; return this; } };
}
async function call(method, path, body, headers) {
  const res = mkRes();
  await handler(mkReq(method, path, body, headers), res);
  let json = null; try { json = JSON.parse(res.body); } catch {}
  return { res, json };
}

function reset(env = {}) {
  __setStore(createStore({ now: (() => { let t = 1_700_000_000_000; return () => (t += 1000); })() }));
  process.env.AD_ADMIN_TOKEN = 'sekret';
  process.env.AD_ESCROW_ACCOUNT = 'melek.ads';
  delete process.env.AD_STORE_FILE;
  Object.assign(process.env, env);
}

const CRE = { headline: 'Acme Legal', body: 'Fast lookup', url: 'https://example.com' };
const NEW = { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000', placement: 'law-top', creative: CRE };

test('health + inventory (honest, public)', async () => {
  reset();
  assert.equal((await call('GET', '/health')).json.ok, true);
  const inv = await call('GET', '/api/inventory?placement=law-top');
  assert.equal(inv.json.inventory.surface, 'law');
  assert.ok(inv.json.inventory.monthlyImpressions > 0);
  assert.deepEqual(inv.json.tokens, ['MELEK', 'APIS', 'PRANA', 'KULA']);
});

test('self-serve create returns campaign + unsigned funding intent', async () => {
  reset();
  const r = await call('POST', '/api/campaigns', NEW);
  assert.equal(r.res.code, 201);
  assert.equal(r.json.campaign.status, 'pending_review');
  assert.equal(r.json.funding.ok, true);
  assert.equal(r.json.funding.intent[0], 'transfer');
  assert.equal(r.json.funding.requiresSignature, true);
});

test('bad create → 400, never a 500', async () => {
  reset();
  const r = await call('POST', '/api/campaigns', { ...NEW, token: 'USD' });
  assert.equal(r.res.code, 400);
  assert.equal(r.json.ok, false);
});

test('a fresh campaign does NOT serve until approved AND funded', async () => {
  reset();
  await call('POST', '/api/campaigns', NEW);
  const serve = await call('GET', '/serve?placement=law-top&format=json');
  assert.equal(serve.json.sold, false);            // falls back to a house ad
  assert.match(serve.json.adId, /^house:/);
});

test('operator gating: review/confirm require the token', async () => {
  reset();
  const c = (await call('POST', '/api/campaigns', NEW)).json.campaign;
  // no token → 401
  assert.equal((await call('POST', `/api/campaigns/${c.id}/review`, { decision: 'approve' })).res.code, 401);
  // wrong token → 401
  assert.equal((await call('POST', `/api/campaigns/${c.id}/review?token=nope`, { decision: 'approve' })).res.code, 401);
  // right token (query) → ok
  assert.equal((await call('POST', `/api/campaigns/${c.id}/review?token=sekret`, { decision: 'approve' })).json.campaign.status, 'approved');
  // right token (header) → ok
  const conf = await call('POST', `/api/campaigns/${c.id}/confirm`, { ref: '0xdep', amount: '10.000' }, { 'x-admin-token': 'sekret' });
  assert.equal(conf.json.campaign.status, 'active');
});

test('full flow: create → approve → confirm → serve (sold + metered) → click redirect', async () => {
  reset({ AD_CLICK_BASE: 'http://localhost/click' });
  const c = (await call('POST', '/api/campaigns', NEW)).json.campaign;
  await call('POST', `/api/campaigns/${c.id}/review?token=sekret`, { decision: 'approve' });
  await call('POST', `/api/campaigns/${c.id}/confirm?token=sekret`, { ref: '0xdep', amount: '10.000' });

  const serve = await call('GET', '/serve?placement=law-top&format=json');
  assert.equal(serve.json.sold, true);
  assert.equal(serve.json.adId, c.id);
  assert.equal(serve.json.charged, '2');           // metered one impression
  assert.match(serve.json.html, /ad-slot--sold/);

  // the click endpoint meters + 302s to the creative
  const click = await call('GET', `/click?c=${encodeURIComponent(c.id)}&p=law-top`);
  assert.equal(click.res.code, 302);
  assert.equal(click.res.headers.location, 'https://example.com');

  // state reflects the serve
  const got = await call('GET', `/api/campaigns/${c.id}`);
  assert.equal(got.json.campaign.impressions, 1);
});

test('fund endpoint returns the unsigned intent for an existing campaign', async () => {
  reset();
  const c = (await call('POST', '/api/campaigns', NEW)).json.campaign;
  const f = await call('POST', `/api/campaigns/${c.id}/fund`, { amount: '20.000' });
  assert.equal(f.json.ok, true);
  assert.equal(f.json.intent[1].amount, '20.000 MELEK');
  assert.match(f.json.intent[1].memo, new RegExp(c.id));
});

test('unknown campaign → 404; unknown route → 404 html not 500', async () => {
  reset();
  assert.equal((await call('GET', '/api/campaigns/nope')).res.code, 404);
  const nf = await call('GET', '/totally-unknown');
  assert.equal(nf.res.code, 404);
});

test('admin console gated; advertiser dashboard public', async () => {
  reset();
  assert.match((await call('GET', '/')).res.body, /Advertise on MELEK/);
  assert.equal((await call('GET', '/admin')).res.code, 401);
  assert.match((await call('GET', '/admin?token=sekret')).res.body, /Operator console/);
});
