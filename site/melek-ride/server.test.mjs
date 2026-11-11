// server.test.mjs — MELEK Ride HTTP surface. OFFLINE: no chain, no keys, no network. Never throws.
// RIDE_DATA points at a temp file beside this test; the fare verifier is injected.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.RIDE_DATA = fileURLToPath(new URL(`./.test-ride-${process.pid}.json`, import.meta.url));
process.env.MELEK_SESSION_SECRET = 'ride-test-secret';
process.env.RIDE_REVIEWERS = 'hathor, review-two';
delete process.env.RIDE_AUTO_APPROVE;
delete process.env.MELEK_SIGNER_PUBLIC_URL; delete process.env.MELEK_SIGNER_SIGNUP_URL; delete process.env.MELEK_SIGNER_SIGN_URL;
after(() => { try { unlinkSync(process.env.RIDE_DATA); } catch {} });

const { handler, isReviewer, signTransferUrl, __setVerifyTransfer, __setRecordDrive } = await import('./server.mjs');
const { mintSession, SESSION_COOKIE } = await import('../../integrations/melek-login.mjs');
const sess = (a) => `${SESSION_COOKIE}=${mintSession(a, { provider: 'melek' })}`;

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
function req(path, method = 'GET', bodyObj, headers = {}) {
  const h = {};
  const r = { url: path, method, headers, on: (e, fn) => { h[e] = fn; return r; }, destroy: () => {} };
  queueMicrotask(() => { if (bodyObj !== undefined && h.data) h.data(JSON.stringify(bodyObj)); if (h.end) h.end(); });
  return r;
}
async function call(path, method = 'GET', body, who) {
  const { res, o } = cap();
  await handler(req(path, method, body, who ? { cookie: sess(who) } : {}), res);
  let j = null; try { j = JSON.parse(o.body); } catch {}
  return { code: o.code, type: o.type, body: o.body, j };
}

const DRIVER = 'dana-driver', RIDER = 'raj-rider';
const DALLAS = { lat: 32.7767, lng: -96.797 };
const APP = {
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2016, color: 'silver', plate: 'ABC1234', seats: 4 },
  licenceNumber: 'TX-9988776', licenceState: 'TX', insurer: 'State Farm', policyNumber: 'P-55512', policyExpires: '2027-03-01',
};
beforeEach(() => { writeFileSync(process.env.RIDE_DATA, '{}'); __setVerifyTransfer(null); __setRecordDrive(null); });

test('GET /ride serves the app — both tabs, the apply form, the board', async () => {
  const r = await call('/ride');
  assert.equal(r.code, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /MELEK Ride/);
  assert.match(r.body, /Get a ride/);
  assert.match(r.body, /Apply to drive/);
  assert.match(r.body, /Licence plate/);
  assert.match(r.body, /Who is out right now/);
  assert.match(r.body, /don't touch the phone|leave the phone alone/i);
  // the same handler serves it bare, for running standalone
  assert.equal((await call('/')).code, 200);
});

test('GET /ride/api/rates publishes the rate card, the fee and the custody rule', async () => {
  const r = await call('/ride/api/rates');
  assert.equal(r.code, 200);
  assert.equal(r.j.rateCard.base, 2);
  assert.equal(r.j.platformFeePct, 0.1);
  assert.equal(r.j.platformFeeAccount, 'hathor');
  assert.match(r.j.custody, /no keys and no escrow/);
  assert.match(r.j.paymentRails.usdCard, /not wired/);
});

test('GET /ride/api/market is public and carries counts only', async () => {
  const r = await call('/ride/api/market?lat=32.7767&lng=-96.797');
  assert.equal(r.code, 200);
  assert.equal(r.j.driversOnline, 0);
  assert.equal(r.j.ridersLooking, 0);
  assert.equal(r.j.nearby.radiusMi, 15);
  assert.match(r.j.note, /Counts only/);
});

test('every write route needs a MELEK session', async () => {
  for (const [path, body] of [
    ['/ride/api/driver/apply', APP],
    ['/ride/api/driver/online', DALLAS],
    ['/ride/api/driver/offline', {}],
    ['/ride/api/rider/ping', DALLAS],
    ['/ride/api/request', { pickup: DALLAS, dropoff: { lat: 32.8, lng: -96.9 } }],
    ['/ride/api/accept', { tripId: 'x' }],
    ['/ride/api/advance', { tripId: 'x', to: 'arrived' }],
    ['/ride/api/complete', { tripId: 'x', miles: 1 }],
    ['/ride/api/cancel', { tripId: 'x' }],
  ]) {
    const r = await call(path, 'POST', body);
    assert.equal(r.code, 401, `${path} should require a session`);
    assert.equal(r.j.login, '/login?return=/ride');
  }
  assert.equal((await call('/ride/api/driver/application')).code, 401);
  assert.equal((await call('/ride/api/driver/dashboard')).code, 401);
});

test('a signed-in account cannot act as a different account', async () => {
  await call('/ride/api/driver/apply', 'POST', { ...APP, account: 'someone-else' }, DRIVER);
  const mine = await call('/ride/api/driver/application', 'GET', undefined, DRIVER);
  assert.equal(mine.j.status, 'pending', 'the application landed on the SESSION account');
  const theirs = await call('/ride/api/driver/application', 'GET', undefined, 'someone-else');
  assert.equal(theirs.j.status, 'none');
});

test('apply → review queue → approve → online, and the gate holds at every step', async () => {
  const bad = await call('/ride/api/driver/apply', 'POST', { vehicle: { make: 'Toyota' } }, DRIVER);
  assert.equal(bad.code, 422);
  assert.match(bad.j.reason, /still needed/);

  const ok = await call('/ride/api/driver/apply', 'POST', APP, DRIVER);
  assert.equal(ok.code, 200);
  assert.equal(ok.j.status, 'pending');

  const early = await call('/ride/api/driver/online', 'POST', DALLAS, DRIVER);
  assert.equal(early.code, 422);
  assert.equal(early.j.status, 'pending');

  // the queue is reviewer-only, because it holds the licence and the insurance
  assert.equal((await call('/ride/api/admin/applications', 'GET', undefined, RIDER)).code, 403);
  assert.equal((await call('/ride/api/admin/review', 'POST', { account: DRIVER, decision: 'approved' }, RIDER)).code, 403);
  const q = await call('/ride/api/admin/applications', 'GET', undefined, 'hathor');
  assert.equal(q.code, 200);
  assert.equal(q.j.pending.length, 1);
  assert.equal(q.j.pending[0].licence.number, 'TX-9988776');

  assert.equal((await call('/ride/api/admin/review', 'POST', { account: DRIVER, decision: 'approved' }, 'review-two')).code, 200);
  assert.equal((await call('/ride/api/driver/online', 'POST', DALLAS, DRIVER)).code, 200);

  const board = await call('/ride/api/market?lat=32.7767&lng=-96.797');
  assert.equal(board.j.driversOnline, 1);
});

test('a rider never receives a driver licence, policy or position from any route', async () => {
  await call('/ride/api/driver/apply', 'POST', APP, DRIVER);
  await call('/ride/api/admin/review', 'POST', { account: DRIVER, decision: 'approved' }, 'hathor');
  await call('/ride/api/driver/online', 'POST', DALLAS, DRIVER);
  for (const p of ['/ride/api/drivers?lat=32.78&lng=-96.8', '/ride/api/market?lat=32.78&lng=-96.8', '/ride/api/requests?lat=32.78&lng=-96.8']) {
    const r = await call(p, 'GET', undefined, RIDER);
    assert.doesNotMatch(r.body, /TX-9988776|P-55512/, `${p} leaked a document number`);
    assert.doesNotMatch(r.body, /-96\.797/, `${p} leaked a driver position`);
  }
  const near = await call('/ride/api/drivers?lat=32.78&lng=-96.8', 'GET', undefined, RIDER);
  assert.equal(near.j.available, 1);
  assert.ok(near.j.etaMinutes >= 1);
});

test('end to end: request → accept → start → end → the rider signs → paid + a drive sample filed', async () => {
  await call('/ride/api/driver/apply', 'POST', APP, DRIVER);
  await call('/ride/api/admin/review', 'POST', { account: DRIVER, decision: 'approved' }, 'hathor');
  await call('/ride/api/driver/online', 'POST', DALLAS, DRIVER);

  const rq = await call('/ride/api/request', 'POST', { pickup: DALLAS, dropoff: { lat: 32.86, lng: -96.9 } }, RIDER);
  assert.equal(rq.code, 200);
  assert.equal(rq.j.driversAvailable, 1);
  const id = rq.j.trip.id;

  const open = await call(`/ride/api/requests?lat=${DALLAS.lat}&lng=${DALLAS.lng}`, 'GET', undefined, DRIVER);
  assert.equal(open.j.requests.length, 1);

  assert.equal((await call('/ride/api/accept', 'POST', { tripId: id }, DRIVER)).code, 200);
  assert.equal((await call('/ride/api/advance', 'POST', { tripId: id, to: 'in_progress' }, DRIVER)).code, 200);

  const done = await call('/ride/api/complete', 'POST', { tripId: id, miles: 10, minutes: 20 }, DRIVER);
  assert.equal(done.code, 200);
  assert.equal(done.j.fare.total, 17);
  assert.equal(done.j.payment.ops.length, 2);
  assert.match(done.j.signUrl, /^https:\/\/signer\.melek\.salon\/sign\/transfer\?/);
  assert.match(done.j.signUrl, /amount=15\.300/);

  // no verifier wired → the trip is NOT marked paid
  const unverified = await call('/ride/api/confirm', 'POST', { tripId: id, trxId: 'abc' }, RIDER);
  assert.equal(unverified.code, 422);
  assert.match(unverified.j.reason, /no on-chain verifier/);

  const filed = [];
  __setVerifyTransfer(async () => ({ ok: true }));
  __setRecordDrive((s) => { filed.push(s); return { ok: true, projectedMelek: 0.42 }; });
  const paid = await call('/ride/api/confirm', 'POST', { tripId: id, trxId: 'trx-good' }, RIDER);
  assert.equal(paid.code, 200);
  assert.equal(paid.j.trip.status, 'completed');
  assert.equal(filed.length, 1);
  assert.equal(filed[0].source, 'ride');
  assert.equal(filed[0].miles, 10);

  const dash = await call('/ride/api/driver/dashboard', 'GET', undefined, DRIVER);
  assert.equal(dash.j.totals.trips, 1);
  assert.equal(dash.j.totals.earnedMelek, 15.3);
  assert.equal(dash.j.fares.gas.usd, null, 'no MELEK market price, so no dollar figure');
});

test('GET /ride/api/quote prices a trip without any account', async () => {
  const r = await call('/ride/api/quote?miles=10&minutes=20');
  assert.equal(r.code, 200);
  assert.equal(r.j.total, 17);
  assert.equal(r.j.driverShare, 15.3);
});

test('reviewers come from RIDE_REVIEWERS; nobody else reviews', () => {
  assert.equal(isReviewer('hathor'), true);
  assert.equal(isReviewer('review-two'), true);
  assert.equal(isReviewer('HATHOR'), true);
  assert.equal(isReviewer('raj-rider'), false);
  assert.equal(isReviewer(''), false);
  assert.equal(isReviewer(null), false);
});

test('signTransferUrl builds a hot-sign link and escapes its parameters', () => {
  const u = signTransferUrl({ to: 'dana-driver', amount: '15.300 MELEK', memo: 'MELEK Ride r1 — driver share' });
  assert.match(u, /^https:\/\/signer\.melek\.salon\/sign\/transfer\?/);
  assert.match(u, /to=dana-driver/);
  assert.match(u, /amount=15\.300\+MELEK/);
  assert.ok(!u.includes(' '), 'no raw spaces in the URL');
});

test('bad input and unknown paths never throw', async () => {
  const { res, o } = cap();
  await handler(req('/ride/api/request', 'POST', undefined, { cookie: sess(RIDER) }), res);
  await handler(req('/ride/api/nope'), res);
  assert.equal(o.code, 404);
  const badJson = cap();
  const r = req('/ride/api/request', 'POST', undefined, { cookie: sess(RIDER) });
  queueMicrotask(() => {});
  await handler(r, badJson.res);
  assert.ok([400, 422].includes(badJson.o.code));
  assert.equal((await call('/ride/api/trip?id=nope')).code, 404);
  assert.equal((await call('/ride/api/drivers')).code, 422);
});

test('GET /ride/api/coverage tells a rider where the nearest driver actually is', async () => {
  const empty = await call('/ride/api/coverage?lat=32.7767&lng=-96.797&state=TX&country=US');
  assert.equal(empty.code, 200);
  assert.equal(empty.j.level, 'none');
  assert.match(empty.j.message, /No drivers are online anywhere/);

  await call('/ride/api/driver/apply', 'POST', { ...APP, state: 'TX', country: 'US' }, DRIVER);
  await call('/ride/api/admin/review', 'POST', { account: DRIVER, decision: 'approved' }, 'hathor');
  await call('/ride/api/driver/online', 'POST', DALLAS, DRIVER);

  const near = await call('/ride/api/coverage?lat=32.7767&lng=-96.797&state=TX&country=US');
  assert.equal(near.j.level, 'area');
  assert.equal(near.j.covered, true);
  // a rider 550 miles away in the same state is told it is a state-level answer, not "no cars"
  const far = await call('/ride/api/coverage?lat=31.7619&lng=-106.485&state=TX&country=US');
  assert.equal(far.j.level, 'state');
  assert.equal(far.j.drivers.state, 1);
  assert.doesNotMatch(far.body, /-96\.797/, 'no driver position in a coverage answer');
});

test('a request with no driver nearby returns the coverage message', async () => {
  const r = await call('/ride/api/request', 'POST', { pickup: DALLAS, dropoff: { lat: 32.86, lng: -96.9 }, state: 'TX', country: 'US' }, RIDER);
  assert.equal(r.code, 200);
  assert.equal(r.j.driversAvailable, 0);
  assert.equal(r.j.coverage.level, 'none');
});

test('the driver pane carries the two-lane earnings panel and the apply region fields', async () => {
  const r = await call('/ride');
  assert.match(r.body, /Your MELEK earnings this hour/);
  assert.match(r.body, /reward zones/i);
  assert.match(r.body, /State\/province you drive in/);
  assert.match(r.body, /api\/geomine/, 'the Drive app does the geolocation mining');
  assert.match(r.body, /api\/drive-standing/);
});
