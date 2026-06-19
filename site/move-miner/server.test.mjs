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

test('store-grade manifest: PNG 192/512 + maskable + categories (TWA/PWABuilder-ready)', async () => {
  const { res, o } = cap(); await handler(req('/manifest.webmanifest'), res);
  const m = JSON.parse(o.body);
  assert.ok(m.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.ok(Array.isArray(m.categories) && m.categories.includes('fitness'));
});

test('icon PNGs serve as image/png', async () => {
  const { res, o } = cap(); await handler(req('/icons/icon-192.png'), res);
  assert.equal(o.code === 0 ? 200 : o.code, 200);   // writeHead(200) sets code
  assert.match(o.type, /image\/png/);
});

test('assetlinks.json is served for TWA (fingerprint stubbed pre-build)', async () => {
  const { res, o } = cap(); await handler(req('/.well-known/assetlinks.json'), res);
  assert.match(o.type, /json/);
  assert.match(o.body, /delegate_permission|android_app/);
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

test('POST /api/geomine applies the step boost + the stake-weighted economy', async () => {
  const { res, o } = cap();
  await handler(req('/api/geomine', 'POST', { player: PLAYER, lat: 32.7767, lng: -96.7970, steps: 20000, stake: 1000 }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.ok(BigInt(j.cellId) > 0n);
  assert.equal(j.boost, 5);                 // 20k-step tier → ×5
  // the real economy is attached: move-weight scales with stake, + the fixed hourly pool
  assert.ok(j.economy, 'economy view attached');
  assert.equal(j.economy.stake, 1000);
  assert.ok(j.economy.moveWeight > 0);
  assert.ok(j.economy.hourlyPool > 0);      // ~87.75 MELEK (15% of the blog pool)
  assert.match(j.economy.model, /stake-weighted|hourly/i);
});

test('more stake → bigger move-weight (vote-weight mechanics)', async () => {
  const get = async (stake) => { const { res, o } = cap(); await handler(req('/api/geomine', 'POST', { player: PLAYER, lat: 32.7, lng: -96.8, steps: 10000, stake }), res); return JSON.parse(o.body).economy.moveWeight; };
  assert.ok((await get(10000)) > (await get(0)), 'holding more MELEK earns a bigger slice');
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
