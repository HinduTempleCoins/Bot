// server.test.mjs — MELEK Move PWA. OFFLINE. Earn = MELEK to a MELEK account, recorded into the hourly
// ledger (no chain, no keys, no EVM voucher). MOVE_DATA points at a temp file. Never throws.
import { test } from 'node:test';
import assert from 'node:assert';
process.env.MOVE_DATA = `/tmp/move-test-${process.pid}.json`;   // isolate the ledger file
const { handler } = await import('./server.mjs');

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
const ACCT = 'alice-walker';

test('GET / serves the installable app — MELEK username, steps, geo, signup link', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /MELEK Move/);
  assert.match(o.body, /manifest.webmanifest/);
  assert.match(o.body, /MELEK username/);          // identity is a MELEK account, not 0x
  assert.match(o.body, /Create your MELEK account/);// signup link present
  assert.match(o.body, /Step boost/);
  assert.match(o.body, /Mine this cell/);
  assert.doesNotMatch(o.body, /0x… your PRANA address|PRANA address/); // old 0x identity gone
});

test('PWA plumbing: manifest, service worker, icon, assetlinks', async () => {
  let { res, o } = cap(); await handler(req('/manifest.webmanifest'), res);
  assert.match(o.type, /manifest/); const m = JSON.parse(o.body);
  assert.ok(m.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.ok(m.categories.includes('fitness'));
  ({ res, o } = cap()); await handler(req('/sw.js'), res); assert.match(o.type, /javascript/);
  ({ res, o } = cap()); await handler(req('/icon.svg'), res); assert.match(o.type, /svg/);
  ({ res, o } = cap()); await handler(req('/icons/icon-192.png'), res); assert.match(o.type, /image\/png/);
  ({ res, o } = cap()); await handler(req('/.well-known/assetlinks.json'), res); assert.match(o.body, /android_app/);
});

test('/health and /economy expose the model', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); const h = JSON.parse(o.body);
  assert.equal(h.live, false);                     // MOVE_LIVE not set
  assert.ok(Number.isFinite(h.epoch));
  ({ res, o } = cap()); await handler(req('/economy'), res);
  const ec = JSON.parse(o.body);
  assert.equal(ec.stakeWeighted, true);
  assert.ok(ec.moveBudgetPerHour > 0);             // 15% of the blog pool, in MELEK
  assert.match(ec.note, /15% of the blog pool/);
});

test('POST /api/geomine records a stake-weighted move-weight + projected MELEK', async () => {
  const { res, o } = cap();
  await handler(req('/api/geomine', 'POST', { account: ACCT, lat: 32.7767, lng: -96.7970, steps: 20000, stake: 1000 }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.equal(j.account, ACCT);
  assert.ok(BigInt(j.cellId) > 0n);
  assert.equal(j.boost, 5);                         // 20k-step tier → ×5
  assert.ok(j.weight > 0);
  assert.ok(j.standing.projectedMelek > 0);         // a real MELEK slice this hour
  assert.ok(j.standing.hourlyPool > 0);
  assert.match(j.model, /15% of the blog pool|stake-weighted/i);
});

test('more stake → bigger move-weight (vote-weight mechanics)', async () => {
  const get = async (account, stake) => { const { res, o } = cap(); await handler(req('/api/geomine', 'POST', { account, lat: 32.7, lng: -96.8, steps: 10000, stake }), res); return JSON.parse(o.body).weight; };
  assert.ok((await get('rich-walker', 10000)) > (await get('poor-walker', 0)), 'holding more MELEK earns a bigger slice');
});

test('rejects a 0x / non-MELEK identity (this is the chain, not EVM)', async () => {
  const { res, o } = cap();
  await handler(req('/api/geomine', 'POST', { account: '0x1111111111111111111111111111111111111111', lat: 1, lng: 1, steps: 5000 }), res);
  assert.equal(o.code, 422);
  assert.match(JSON.parse(o.body).reason, /MELEK account/);
});

test('/api/standing reads a walker’s current hour without recording', async () => {
  await handler(req('/api/geomine', 'POST', { account: 'carol-walker', lat: 10, lng: 10, steps: 5000, stake: 500 }), cap().res);
  const { res, o } = cap(); await handler(req('/api/standing?account=carol-walker'), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.account, 'carol-walker');
  assert.ok(j.accountWeight > 0);
});

test('POST /api/steps previews the boost (steps are the boost, not a payout)', async () => {
  const { res, o } = cap(); await handler(req('/api/steps', 'POST', { steps: 12000 }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true); assert.equal(j.boost, 3);   // 10k tier → ×3
  assert.match(j.note, /boost/);
});

test('bad input → 422/400, never a 500', async () => {
  let { res, o } = cap(); await handler(req('/api/geomine', 'POST', { account: ACCT }), res); // no coords
  assert.equal(o.code, 422);
  ({ res, o } = cap()); await handler(req('/api/steps', 'POST', { steps: -1 }), res);
  assert.equal(o.code, 422);
  ({ res, o } = cap()); await handler(req('/api/standing?account=0xabc'), res);
  assert.equal(o.code, 422);
});

test('unknown route → 404', async () => {
  const { res, o } = cap(); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
