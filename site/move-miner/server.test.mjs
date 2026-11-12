// server.test.mjs — MELEK Move PWA. OFFLINE. Earn = MELEK to a MELEK account, recorded into the hourly
// ledger (no chain, no keys, no EVM voucher). MOVE_DATA points at a temp file. Never throws.
import { test, after } from 'node:test';
import assert from 'node:assert';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.env.MOVE_DATA = fileURLToPath(new URL(`./.test-move-${process.pid}.json`, import.meta.url));   // isolate the ledger file
after(() => { try { unlinkSync(process.env.MOVE_DATA); } catch {} });
process.env.MELEK_SESSION_SECRET = 'move-test-secret';
delete process.env.MELEK_SIGNER_URL; delete process.env.MELEK_SIGNER_PUBLIC_URL; delete process.env.MELEK_SIGNER_SIGNUP_URL;
delete process.env.MOVE_BASE_URL; delete process.env.MOVE_SIGNER_CLIENT; delete process.env.MOVE_SIGNER_REDIRECT_URI;
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
  assert.match(o.body, /Claim this zone/);          // ToS-safe: "claim/zone", not "mine/cell"
  assert.match(o.body, /id=map class=blockmap/);    // the block map canvas is present
  assert.match(o.body, /block you can claim/);       // map legend explains the blocks
  assert.doesNotMatch(o.body, /0x… your PRANA address|PRANA address/); // old 0x identity gone
  // ToS: no banned on-device-mining or earnings-glamorizing language in the user-facing copy
  assert.doesNotMatch(o.body, /Mine this cell|earn crypto|mine crypto/i);
  assert.match(o.body, /live MELEK mainnet/i);      // discloses it's the live mainnet coin
  assert.match(o.body, /Privacy/);                  // privacy link present (Play requires a policy)
});

test('GET /privacy serves a Play-required privacy policy', async () => {
  const { res, o } = cap(); await handler(req('/privacy'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /Privacy Policy/);
  assert.match(o.body, /never sell/i);              // health-data-misuse disclosure
  assert.match(o.body, /motion|step/i);
  assert.match(o.body, /live MELEK mainnet/i);      // rewards paid in real mainnet MELEK
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
  assert.ok(h.geoPrecision > 0);                   // block-map grid precision (cells/degree)
  ({ res, o } = cap()); await handler(req('/economy'), res);
  const ec = JSON.parse(o.body);
  assert.equal(ec.stakeWeighted, true);
  assert.equal(ec.moveBudgetPerHour, 150);         // the chain's per-hour draw from the "move" fund
  assert.equal(ec.moveFundInflowPerHour, 135);     // what flows into that fund
  assert.match(ec.note, /not a share of the blog pool/);
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
  assert.match(j.model, /stake-weighted/i);
  assert.match(j.model, /150\.000 MELEK/, 'the hourly pool a walker is told about is the chain\'s cap');
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


// ── Sign in with MELEK (MELEK-Signer redirect flow) — no password, no key derivation in Move ─────────
const mod = await import('./server.mjs');
const { mintSession, SESSION_COOKIE } = await import('../../integrations/melek-login.mjs');
const sess = (a) => `${SESSION_COOKIE}=${mintSession(a, { provider: 'melek' })}`;
function capH() {
  const o = { code: 0, headers: {}, body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.headers = h || {}; }, end: (b) => { o.body = b || ''; } }, o };
}
function reqH(path, method = 'GET', bodyObj, headers = {}) {
  const r = req(path, method, bodyObj); r.headers = headers; return r;
}

test('the home page offers Sign in with MELEK + the signer /signup link — no password field', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /href="\/auth\/melek-signer\/start"/);
  assert.match(o.body, /https:\/\/signer\.melek\.salon\/signup/);
  assert.doesNotMatch(o.body, /type=password/);
  assert.doesNotMatch(o.body, /\/api\/create-account/);
});

test('/auth/melek-signer/start → signer authorize (client melek-move, registered redirect_uri)', async () => {
  const { res, o } = capH(); await handler(reqH('/auth/melek-signer/start?return=/delete'), res);
  assert.equal(o.code, 302);
  const u = new URL(o.headers.location);
  assert.equal(u.origin + u.pathname, 'https://signer.melek.salon/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'melek-move');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://move.melek.salon/auth/melek-signer/callback');
});

test('callback → session; /api/me names the verified account; geomine pays the SESSION account', async () => {
  mod.__setFetch(async (_u, opts) => {
    const { code, client_id } = JSON.parse(opts.body);
    return { json: async () => (code === 'good' && client_id === 'melek-move' ? { access_token: 't', account: 'sess-walker', scope: 'identity' } : { error: 'invalid_grant' }) };
  });
  const s = capH(); await handler(reqH('/auth/melek-signer/start?return=/'), s.res);
  const state = new URL(s.o.headers.location).searchParams.get('state');
  const stCookie = String(s.o.headers['set-cookie']).split(';')[0];
  const bad = capH(); await handler(reqH(`/auth/melek-signer/callback?code=good&state=forged`, 'GET', undefined, { cookie: stCookie }), bad.res);
  assert.equal(bad.o.code, 403);
  const c = capH(); await handler(reqH(`/auth/melek-signer/callback?code=good&state=${state}`, 'GET', undefined, { cookie: stCookie }), c.res);
  assert.equal(c.o.code, 302);
  const sc = [].concat(c.o.headers['set-cookie']).find((x) => x.startsWith(`${SESSION_COOKIE}=`));
  assert.match(sc, /Domain=\.melek\.salon/);
  const me = capH(); await handler(reqH('/api/me', 'GET', undefined, { cookie: sc.split(';')[0] }), me.res);
  assert.equal(JSON.parse(me.o.body).account, 'sess-walker');
  const g = capH(); await handler(reqH('/api/geomine', 'POST', { account: 'someone-else', lat: 1, lng: 1, steps: 100 }, { cookie: sc.split(';')[0] }), g.res);
  assert.equal(JSON.parse(g.o.body).account, 'sess-walker');
  mod.__setFetch(globalThis.fetch);
});

test('POST /api/create-account is retired (410) and points at MELEK-Signer — no key derivation', async () => {
  const { res, o } = capH(); await handler(reqH('/api/create-account', 'POST', { username: 'walker2', password: 'hunter2pw' }), res);
  assert.equal(o.code, 410);
  const j = JSON.parse(o.body);
  assert.equal(j.signup, 'https://signer.melek.salon/signup');
  assert.equal(j.login, '/auth/melek-signer/start');
  assert.equal(typeof mod.createAccount, 'undefined');
});

test('GET /delete serves the Play-required account & data deletion page (sign in with MELEK, no password)', async () => {
  const { res, o } = cap(); await handler(req('/delete'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /Delete your MELEK Move account/i);
  assert.match(o.body, /What is deleted/i);
  assert.match(o.body, /public blockchain/i);                 // honest about what we can't erase
  assert.match(o.body, /community\.soapbox\.move/);           // names the app/developer per Play guidance
  assert.match(o.body, /\/auth\/melek-signer\/start\?return=\/delete/);
  assert.doesNotMatch(o.body, /type=password/);
});

test('delete-account: needs a MELEK-Signer session; erases ONLY the signed-in account (body names ignored)', async () => {
  const A = 'delwalker', B = 'otherwalker';
  await handler(req('/api/geomine', 'POST', { account: A, lat: 5, lng: 5, steps: 3000, stake: 100 }), cap().res);
  await handler(req('/api/geomine', 'POST', { account: B, lat: 6, lng: 6, steps: 3000, stake: 100 }), cap().res);
  const anon = capH(); await handler(reqH('/api/delete-account', 'POST', { username: A, password: 'x' }), anon.res);
  assert.equal(anon.o.code, 401);
  const ok = capH(); await handler(reqH('/api/delete-account', 'POST', { username: B }, { cookie: sess(A) }), ok.res);
  assert.equal(ok.o.code, 200);
  const j = JSON.parse(ok.o.body);
  assert.equal(j.account, A); assert.ok(j.removed >= 1); assert.match(j.note, /blockchain/i);
  const sa = cap(); await handler(req('/api/standing?account=' + A), sa.res);
  assert.strictEqual(JSON.parse(sa.o.body).accountWeight, 0);
  const sb = cap(); await handler(req('/api/standing?account=' + B), sb.res);
  assert.ok(JSON.parse(sb.o.body).accountWeight > 0, 'another walker is untouched');
});

// ── MELEK DRIVE: the drive lane inside the Move app ───────────────────────────────────────────────
process.env.DRIVE_DATA = fileURLToPath(new URL(`./.test-drive-${process.pid}.json`, import.meta.url));
after(() => { try { unlinkSync(process.env.DRIVE_DATA); } catch {} });

test('the page carries the MELEK Drive card: gas framing, rideshare apps, the Ride tab', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /MELEK Drive/);
  assert.match(o.body, /gas/i);
  assert.match(o.body, /Uber, Lyft, DoorDash or Instacart/);
  assert.match(o.body, /href="\/ride"/, 'MELEK Ride is reachable as a tab of Move');
  assert.match(o.body, /don't touch the phone/i);
});

test('/api/drive records driving miles and reports the gas equivalent', async () => {
  const c = cap(); await handler(req('/api/drive', 'POST', { account: 'dee-driver', miles: 12, seconds: 1200, stake: 0, source: 'shift' }), c.res);
  assert.equal(c.o.code, 200);
  const j = JSON.parse(c.o.body);
  assert.equal(j.ok, true);
  assert.equal(j.lane, 'drive');
  assert.equal(j.milesCounted, 12);
  assert.ok(j.projectedMelek > 0);
  assert.equal(j.gas.usd, null, 'no MELEK market price, so no dollar figure is invented');
  assert.match(j.model, /drive_pay/);
});

test('/api/drive refuses walking speeds, impossible speeds and bad accounts', async () => {
  const walk = cap(); await handler(req('/api/drive', 'POST', { account: 'dee-driver', miles: 1, seconds: 1800 }), walk.res);
  assert.equal(walk.o.code, 422);
  assert.equal(JSON.parse(walk.o.body).lane, 'walk');
  const fly = cap(); await handler(req('/api/drive', 'POST', { account: 'dee-driver', miles: 400, seconds: 900 }), fly.res);
  assert.equal(fly.o.code, 422);
  const bad = cap(); await handler(req('/api/drive', 'POST', { account: '0xabc', miles: 12, seconds: 1200 }), bad.res);
  assert.equal(bad.o.code, 422);
});

test('a signed-in walker\'s drive miles go to the SESSION account, not a typed one', async () => {
  const c = capH(); await handler(reqH('/api/drive', 'POST', { account: 'someone-else', miles: 12, seconds: 1200 }, { cookie: sess('dee-driver') }), c.res);
  assert.equal(c.o.code, 200);
  assert.equal(JSON.parse(c.o.body).account, 'dee-driver');
});

test('/api/drive-standing and /drive-economy expose the lane', async () => {
  const s = cap(); await handler(req('/api/drive-standing?account=dee-driver'), s.res);
  assert.equal(s.o.code, 200);
  assert.ok(JSON.parse(s.o.body).accountWeight > 0);
  const e = cap(); await handler(req('/drive-economy'), e.res);
  const j = JSON.parse(e.o.body);
  assert.equal(j.fund, 'drive', 'its own pool, not the Move pool');
  assert.equal(j.driveCapPerHour, j.fundInflowPerHour, 'the drive cap equals the drive fund inflow');
  assert.equal(j.walkLaneTouched, false);
  const eco = cap(); await handler(req('/economy'), eco.res);
  assert.equal(JSON.parse(eco.o.body).drive.driveCapPerHour, 135);
});

test('MELEK Ride is mounted at /ride (a tab of Move, one sign-in)', async () => {
  const p = cap(); await handler(req('/ride'), p.res);
  assert.equal(p.o.code, 200);
  assert.match(p.o.body, /MELEK Ride/);
  const r = cap(); await handler(req('/ride/api/rates'), r.res);
  assert.equal(JSON.parse(r.o.body).platformFeePct, 0.1);
});

test('deleting an account erases BOTH ledgers (walk and drive)', async () => {
  await handler(req('/api/geomine', 'POST', { account: 'dee-driver', lat: 3, lng: 3, steps: 1000 }), cap().res);
  await handler(req('/api/drive', 'POST', { account: 'dee-driver', miles: 10, seconds: 900 }), cap().res);
  const ok = capH(); await handler(reqH('/api/delete-account', 'POST', {}, { cookie: sess('dee-driver') }), ok.res);
  assert.equal(ok.o.code, 200);
  const j = JSON.parse(ok.o.body);
  assert.ok(j.removed >= 1, 'walk ledger cleared');
  assert.ok(j.removedDrive >= 1, 'drive ledger cleared too');
  const s = cap(); await handler(req('/api/drive-standing?account=dee-driver'), s.res);
  assert.equal(JSON.parse(s.o.body).accountWeight, 0);
});

test('the page has a real tab row: Move here, Ride next to it', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /class=apptabs/);
  assert.match(o.body, /<span aria-current=page>Move<\/span>/);
  assert.match(o.body, /<a href="\/ride">Ride<\/a>/);
});

test('the page offers "Earn for Driving" beside the walking earnings, in one panel', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /Earn for Driving/);
  assert.match(o.body, /Your MELEK this hour/);
  assert.match(o.body, /id=earnBoth/);
  assert.match(o.body, /api\/drive-standing/);
  assert.match(o.body, /Walking \\u2014 reward zones|Walking/);
  assert.match(o.body, /Both lanes/);
});
