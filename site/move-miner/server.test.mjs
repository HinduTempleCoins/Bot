// server.test.mjs — MELEK Move (step + geo miner) PWA. Offline; attester runs in demo mode (no key)
// so it returns the built voucher with signed:false. Never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
function req(path, method = 'GET', bodyObj) {
  const h = {};
  const r = { url: path, method, on: (e, fn) => { h[e] = fn; return r; }, destroy: () => {} };
  queueMicrotask(() => { if (bodyObj !== undefined && h.data) h.data(JSON.stringify(bodyObj)); if (h.end) h.end(); });
  return r;
}
const PLAYER = '0x1111111111111111111111111111111111111111';

test('GET / serves the installable app (manifest + step + geo)', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /MELEK Move/);
  assert.match(o.body, /manifest.webmanifest/);
  assert.match(o.body, /Step boost/);            // steps are the boost meter
  assert.match(o.body, /Mine this cell/);        // geomine is the earn action
});

test('PWA plumbing: manifest, service worker, icon', async () => {
  let { res, o } = cap(); await handler(req('/manifest.webmanifest'), res);
  assert.match(o.type, /manifest/); assert.match(o.body, /MELEK Move/);
  ({ res, o } = cap()); await handler(req('/sw.js'), res);
  assert.match(o.type, /javascript/);
  ({ res, o } = cap()); await handler(req('/icon.svg'), res);
  assert.match(o.type, /svg/);
});

test('/health reports demo mode when no faucet/key configured', async () => {
  const { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200);
  assert.equal(JSON.parse(o.body).live, false);
});

test('POST /api/steps builds a reward voucher (demo: signed:false, payout present)', async () => {
  const { res, o } = cap();
  await handler(req('/api/steps', 'POST', { player: PLAYER, steps: 12000 }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.ok(j.payout >= 1);
  assert.equal(j.signed, false);     // demo (no ATTESTER_KEY)
  assert.ok(j.voucher && j.voucher.amount);
});

test('POST /api/geomine derives a cell and applies the step boost', async () => {
  const { res, o } = cap();
  await handler(req('/api/geomine', 'POST', { player: PLAYER, lat: 32.7767, lng: -96.7970, steps: 20000 }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.ok(BigInt(j.cellId) > 0n);
  assert.equal(j.boost, 5);                 // 20k-step tier → ×5 (steps must reach attestGeomine)
  assert.ok(j.payout > j.baseReward);       // boosted above base
});

test('bad input → 422, never a 500', async () => {
  let { res, o } = cap(); await handler(req('/api/steps', 'POST', { player: 'nope', steps: 100 }), res);
  assert.equal(o.code, 422);
  ({ res, o } = cap()); await handler(req('/api/geomine', 'POST', { player: PLAYER }), res); // no coords
  assert.equal(o.code, 422);
});

test('LIVE mode flips on when key + a faucet address are set, and signs', async () => {
  process.env.ATTESTER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  process.env.ARCADE_FAUCET_ADDRESS = '0x2222222222222222222222222222222222222222';
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(JSON.parse(o.body).live, true);
  ({ res, o } = cap()); await handler(req('/api/steps', 'POST', { player: PLAYER, steps: 12000 }), res);
  assert.equal(JSON.parse(o.body).signed, true);
  delete process.env.ATTESTER_KEY; delete process.env.ARCADE_FAUCET_ADDRESS;
});

test('unknown route → 404', async () => {
  const { res, o } = cap(); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
