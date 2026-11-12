// ride-core.test.mjs — MELEK Ride engine. OFFLINE: in-memory fs, injected verifier, no chain, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMiles, quoteFare, applyDriver, driverApplication, reviewDriver, pendingApplications,
  driverOnline, driverOffline, nearbyDrivers, driversNearSummary, riderPing, marketStatus,
  requestTrip, acceptTrip, advanceTrip, completeTrip, confirmPayment, cancelTrip, tripById,
  openRequests, driverDashboard, rideSummary, coverage, RIDE_FEE_ACCOUNT,
  riderWalkCredit, RIDE_WALK_PCT, RIDE_WALK_MAX_MILES, RIDE_WALK_STEPS_PER_MILE,
} from './ride-core.mjs';

function memfs() {
  let blob = null;
  return { read: () => blob, write: (_p, s) => { blob = s; } };
}
const FILE = './.ride-core-test.json';     // never written: memfs ignores the path
const DRIVER = 'dana-driver', RIDER = 'raj-rider', OTHER = 'otto-driver';
const DALLAS = { lat: 32.7767, lng: -96.797 };
const NEARBY = { lat: 32.78, lng: -96.8 };
const FARAWAY = { lat: 40.7128, lng: -74.006 };     // New York
const APP = {
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2016, color: 'silver', plate: 'abc1234', seats: 4 },
  licenceNumber: 'TX-9988776', licenceState: 'TX', insurer: 'State Farm', policyNumber: 'P-55512', policyExpires: '2027-03-01',
};
const env = (o) => { const was = {}; for (const k of Object.keys(o)) { was[k] = process.env[k]; process.env[k] = o[k]; } return () => { for (const k of Object.keys(was)) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; } }; };
const ctx = (fs, extra = {}) => ({ fs, file: FILE, ...extra });

function approvedDriver(fs, who = DRIVER, at = DALLAS) {
  applyDriver({ account: who, ...APP }, ctx(fs));
  reviewDriver({ account: who, decision: 'approved', by: 'hathor' }, ctx(fs));
  return driverOnline({ account: who, lat: at.lat, lng: at.lng }, ctx(fs));
}

test('haversineMiles is a real distance', () => {
  const d = haversineMiles(DALLAS.lat, DALLAS.lng, FARAWAY.lat, FARAWAY.lng);
  assert.ok(d > 1200 && d < 1400, `Dallas->NYC should be ~1,300 mi, got ${d}`);
  assert.equal(Math.round(haversineMiles(DALLAS.lat, DALLAS.lng, DALLAS.lat, DALLAS.lng)), 0);
});

test('quoteFare: rate card, minimum fare, and the platform split', () => {
  const q = quoteFare({ miles: 10, minutes: 20 });
  assert.equal(q.total, 17);                      // 2 base + 10 mi + 5 min-charge
  assert.equal(q.platformFee, 1.7);               // 10%
  assert.equal(q.driverShare, 15.3);
  assert.equal(q.driverShare + q.platformFee, q.total, 'the split is the whole fare');
  const tiny = quoteFare({ miles: 0.2, minutes: 1 });
  assert.equal(tiny.total, 5, 'minimum fare applies');
  assert.equal(tiny.minimumApplied, true);
  assert.equal(q.usd.usd, null, 'no MELEK price, so no dollar figure is invented');
});

// ── the two onboardings: a rider just has an account; a driver applies ─────────────────────────────
test('a rider needs no application — and an un-applied account cannot go online', () => {
  const fs = memfs();
  const r = driverOnline({ account: DRIVER, ...DALLAS }, ctx(fs));
  assert.equal(r.ok, false);
  assert.equal(r.status, 'none');
  assert.match(r.reason, /apply to drive first/i);
  // but that same account can request a ride immediately
  assert.equal(requestTrip({ rider: DRIVER, pickup: DALLAS, dropoff: FARAWAY }, ctx(fs)).ok, true);
});

test('applyDriver demands the car, the plate, the year and the licence', () => {
  const fs = memfs();
  const bad = applyDriver({ account: DRIVER, vehicle: { make: 'Toyota' } }, ctx(fs));
  assert.equal(bad.ok, false);
  for (const want of ['vehicle model', 'licence plate', 'vehicle year', "driver's licence number"]) {
    assert.ok(bad.reason.includes(want), `should ask for ${want}`);
  }
  assert.equal(applyDriver({ account: DRIVER, ...APP, vehicle: { ...APP.vehicle, year: 1890 } }, ctx(fs)).ok, false);
  const ok = applyDriver({ account: DRIVER, ...APP }, ctx(fs));
  assert.equal(ok.ok, true);
  assert.equal(ok.status, 'pending');
  assert.equal(ok.driver.vehicle.plate, 'ABC1234', 'plate is normalised');
  assert.equal(ok.driver.car, 'silver 2016 Toyota Corolla');
});

test('a pending application cannot go online or accept, and is invisible to riders', () => {
  const fs = memfs();
  applyDriver({ account: DRIVER, ...APP }, ctx(fs));
  const on = driverOnline({ account: DRIVER, ...DALLAS }, ctx(fs));
  assert.equal(on.ok, false); assert.equal(on.status, 'pending');
  assert.equal(nearbyDrivers(DALLAS, ctx(fs)).length, 0);
  assert.equal(pendingApplications(ctx(fs)).length, 1);
  assert.equal(pendingApplications(ctx(fs))[0].licence.number, 'TX-9988776', 'the reviewer sees the licence');
});

test('licence and insurance never leave the store except to the driver themselves', () => {
  const fs = memfs();
  approvedDriver(fs);
  const pub = driverApplication(DRIVER, ctx(fs));
  assert.equal(pub.licence, undefined, 'not in the default read');
  assert.equal(pub.insurance, undefined);
  assert.equal(JSON.stringify(pub).includes('TX-9988776'), false);
  const self = driverApplication(DRIVER, ctx(fs, { self: true }));
  assert.equal(self.licence.number, 'TX-9988776');
  // nor in anything a rider sees
  const seen = JSON.stringify(nearbyDrivers(DALLAS, ctx(fs)));
  assert.equal(seen.includes('TX-9988776'), false);
  assert.equal(seen.includes('P-55512'), false);
});

test('review decisions gate and un-gate driving; suspension takes a driver offline', () => {
  const fs = memfs();
  applyDriver({ account: DRIVER, ...APP }, ctx(fs));
  assert.equal(reviewDriver({ account: DRIVER, decision: 'sideways' }, ctx(fs)).ok, false);
  assert.equal(reviewDriver({ account: 'nobody-here', decision: 'approved' }, ctx(fs)).ok, false);
  reviewDriver({ account: DRIVER, decision: 'approved', by: 'hathor' }, ctx(fs));
  assert.equal(driverOnline({ account: DRIVER, ...DALLAS }, ctx(fs)).ok, true);
  reviewDriver({ account: DRIVER, decision: 'suspended', by: 'hathor', note: 'insurance lapsed' }, ctx(fs));
  assert.equal(nearbyDrivers(DALLAS, ctx(fs)).length, 0, 'suspended driver is off the map at once');
  assert.equal(driverOnline({ account: DRIVER, ...DALLAS }, ctx(fs)).ok, false);
});

test('RIDE_AUTO_APPROVE=1 approves on application (for a staged launch)', () => {
  const restore = env({ RIDE_AUTO_APPROVE: '1' });
  try {
    const fs = memfs();
    const r = applyDriver({ account: DRIVER, ...APP }, ctx(fs));
    assert.equal(r.status, 'approved');
    assert.equal(driverOnline({ account: DRIVER, ...DALLAS }, ctx(fs)).ok, true);
  } finally { restore(); }
});

// ── matching + privacy ────────────────────────────────────────────────────────────────────────────
test('riders are told how many cars are near, never where they are', () => {
  const fs = memfs();
  approvedDriver(fs);
  const s = driversNearSummary(NEARBY, ctx(fs));
  assert.equal(s.available, 1);
  assert.ok(s.nearestMiles < 5 && s.etaMinutes >= 1);
  assert.equal(JSON.stringify(s).includes('-96.79'), false, 'no coordinates in a rider-facing read');
  assert.equal(driversNearSummary(FARAWAY, ctx(fs)).available, 0, 'out of radius');
});

test('a stale driver drops off the map without going offline', () => {
  const fs = memfs();
  approvedDriver(fs);
  assert.equal(nearbyDrivers(NEARBY, ctx(fs)).length, 1);
  assert.equal(nearbyDrivers(NEARBY, ctx(fs, { now: Date.now() + 10 * 60 * 1000 })).length, 0);
});

test('going offline clears the driver from matching', () => {
  const fs = memfs();
  approvedDriver(fs);
  assert.equal(driverOffline({ account: DRIVER }, ctx(fs)).ok, true);
  assert.equal(nearbyDrivers(NEARBY, ctx(fs)).length, 0);
  assert.equal(driverOffline({ account: 'ghost-acct' }, ctx(fs)).ok, false);
});

// ── the market board ──────────────────────────────────────────────────────────────────────────────
test('the board counts both sides and publishes no identity or position', () => {
  const fs = memfs();
  approvedDriver(fs);
  riderPing({ account: RIDER, ...NEARBY }, ctx(fs));
  const m = marketStatus(NEARBY, ctx(fs));
  assert.equal(m.driversOnline, 1);
  assert.equal(m.ridersLooking, 1);
  assert.equal(m.nearby.driversOnline, 1);
  assert.equal(m.nearby.ridersLooking, 1);
  assert.equal(JSON.stringify(m).includes(RIDER), false, 'no account names on the board');
  assert.equal(JSON.stringify(m).includes('32.78'), false, 'no positions on the board');
  // rider presence expires on its own
  assert.equal(marketStatus(NEARBY, ctx(fs, { now: Date.now() + 10 * 60 * 1000 })).ridersLooking, 0);
});

test('requesting a ride counts the rider as looking, and shows the request as open', () => {
  const fs = memfs();
  requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  const m = marketStatus(DALLAS, ctx(fs));
  assert.equal(m.ridersLooking, 1);
  assert.equal(m.requestsOpen, 1);
  assert.equal(m.nearby.requestsOpen, 1);
});

test('the board counts pending applications (the queue a reviewer has to clear)', () => {
  const fs = memfs();
  applyDriver({ account: DRIVER, ...APP }, ctx(fs));
  assert.equal(marketStatus({}, ctx(fs)).pendingApplications, 1);
  assert.equal(marketStatus({}, ctx(fs)).nearby, null, 'no point given, no nearby block');
});

// ── the trip ──────────────────────────────────────────────────────────────────────────────────────
test('a trip runs requested -> accepted -> in_progress -> awaiting_payment', () => {
  const fs = memfs();
  approvedDriver(fs);
  const req = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  assert.equal(req.ok, true);
  assert.equal(req.trip.status, 'requested');
  assert.equal(req.driversAvailable, 1);
  assert.deepEqual(openRequests(DALLAS, ctx(fs)).map((t) => t.id), [req.trip.id]);

  const acc = acceptTrip({ tripId: req.trip.id, driver: DRIVER }, ctx(fs));
  assert.equal(acc.trip.status, 'accepted');
  assert.equal(advanceTrip({ tripId: req.trip.id, driver: DRIVER, to: 'arrived' }, ctx(fs)).trip.status, 'arrived');
  assert.equal(advanceTrip({ tripId: req.trip.id, driver: DRIVER, to: 'in_progress' }, ctx(fs)).trip.status, 'in_progress');

  const done = completeTrip({ tripId: req.trip.id, driver: DRIVER, miles: 10, minutes: 20 }, ctx(fs));
  assert.equal(done.trip.status, 'awaiting_payment');
  assert.equal(done.fare.total, 17);
  assert.match(done.note, /never holds the rider's key/);
});

test('an accepted driver is not offered another trip until the first is done', () => {
  const fs = memfs();
  approvedDriver(fs);
  const a = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: a.trip.id, driver: DRIVER }, ctx(fs));
  const b = requestTrip({ rider: 'second-rider', pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  assert.equal(b.driversAvailable, 0, 'a busy driver is not matchable');
  assert.equal(acceptTrip({ tripId: b.trip.id, driver: DRIVER }, ctx(fs)).ok, false);
});

test('only the assigned driver can move or end a trip; only one driver can accept it', () => {
  const fs = memfs();
  approvedDriver(fs);
  approvedDriver(fs, OTHER, NEARBY);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  assert.equal(acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs)).ok, true);
  assert.equal(acceptTrip({ tripId: t.trip.id, driver: OTHER }, ctx(fs)).ok, false, 'first accept wins');
  assert.equal(advanceTrip({ tripId: t.trip.id, driver: OTHER, to: 'in_progress' }, ctx(fs)).ok, false);
  assert.equal(completeTrip({ tripId: t.trip.id, driver: OTHER, miles: 5 }, ctx(fs)).ok, false);
});

test('a rider cannot stack two live trips, and bad coordinates are refused', () => {
  const fs = memfs();
  assert.equal(requestTrip({ rider: RIDER, pickup: DALLAS }, ctx(fs)).ok, false);
  assert.equal(requestTrip({ rider: RIDER, pickup: { lat: 999, lng: 0 }, dropoff: NEARBY }, ctx(fs)).ok, false);
  assert.equal(requestTrip({ rider: '0xnope', pickup: DALLAS, dropoff: NEARBY }, ctx(fs)).ok, false);
  assert.equal(requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs)).ok, true);
  const dup = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /already have a trip/);
});

// ── the money ─────────────────────────────────────────────────────────────────────────────────────
test('the payment intent is two rider-signed transfers — no escrow, no relay', () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  const done = completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 10, minutes: 20 }, ctx(fs));
  const ops = done.payment.ops;
  assert.equal(ops.length, 2);
  assert.equal(ops[0][0], 'transfer');
  assert.equal(ops[0][1].from, RIDER);
  assert.equal(ops[0][1].to, DRIVER);
  assert.match(ops[0][1].amount, /^15\.300 /);
  assert.equal(ops[1][1].to, RIDE_FEE_ACCOUNT());
  assert.match(ops[1][1].amount, /^1\.700 /);
  assert.equal(done.payment.signedBy, 'rider');
  assert.equal(done.payment.confirmedTrxId, null);
  // every op moves value FROM the rider: nothing is ever paid out of an account we hold
  assert.ok(ops.every((o) => o[1].from === RIDER));
});

test('a trip is NOT marked paid without an on-chain verifier', async () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 10, minutes: 20 }, ctx(fs));

  const noVerifier = await confirmPayment({ tripId: t.trip.id, trxId: 'abc123' }, {}, ctx(fs));
  assert.equal(noVerifier.ok, false);
  assert.match(noVerifier.reason, /no on-chain verifier/);
  assert.equal(tripById(t.trip.id, ctx(fs)).trip.status, 'awaiting_payment');

  const liar = await confirmPayment({ tripId: t.trip.id, trxId: 'abc123' }, { verifyTransfer: async () => ({ ok: false, reason: 'no such transfer' }) }, ctx(fs));
  assert.equal(liar.ok, false);
  assert.equal(tripById(t.trip.id, ctx(fs)).trip.status, 'awaiting_payment', 'still not paid');

  const noId = await confirmPayment({ tripId: t.trip.id, trxId: '' }, { verifyTransfer: async () => ({ ok: true }) }, ctx(fs));
  assert.equal(noId.ok, false);
});

test('a verified fare completes the trip AND files a verified drive sample for the lane', async () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 10, minutes: 20 }, ctx(fs));

  const seen = [];
  const r = await confirmPayment({ tripId: t.trip.id, trxId: 'trx-real' },
    { verifyTransfer: async (v) => { seen.push(v); return { ok: true }; }, recordDrive: (s) => { seen.push(s); return { ok: true, projectedMelek: 1.2 }; } },
    ctx(fs));
  assert.equal(r.ok, true);
  assert.equal(r.trip.status, 'completed');
  assert.equal(r.paidTrxId, 'trx-real');
  assert.equal(seen[0].amount, 15.3, 'the verifier is told what to look for');
  assert.equal(seen[1].source, 'ride', 'a MELEK Ride trip is the VERIFIED drive source');
  assert.equal(seen[1].miles, 10);
  assert.equal(r.drive.ok, true);

  const again = await confirmPayment({ tripId: t.trip.id, trxId: 'trx-real' }, { verifyTransfer: async () => ({ ok: true }) }, ctx(fs));
  assert.equal(again.alreadyCompleted, true, 'confirming twice does not double-count');

  const dash = driverDashboard(DRIVER, ctx(fs));
  assert.equal(dash.totals.trips, 1);
  assert.equal(dash.totals.earnedMelek, 15.3);
  assert.equal(dash.totals.milesDriven, 10);
  assert.equal(dash.fares.gas.usd, null, 'still no invented dollar figure');
});

test('a drive-lane failure does not undo a paid trip', async () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 10, minutes: 20 }, ctx(fs));
  const r = await confirmPayment({ tripId: t.trip.id, trxId: 'trx-real' },
    { verifyTransfer: async () => ({ ok: true }), recordDrive: () => { throw new Error('ledger disk full'); } }, ctx(fs));
  assert.equal(r.ok, true);
  assert.equal(r.trip.status, 'completed');
  assert.equal(r.drive.ok, false);
});

test('cancelling: either party may, but not once the fare is owed', () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  assert.equal(cancelTrip({ tripId: t.trip.id, account: 'random-person' }, ctx(fs)).ok, false);
  assert.equal(cancelTrip({ tripId: t.trip.id, account: RIDER, reason: 'changed my mind' }, ctx(fs)).ok, true);
  assert.equal(tripById(t.trip.id, ctx(fs)).trip.status, 'cancelled');

  const u = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: u.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: u.trip.id, driver: DRIVER, miles: 4, minutes: 9 }, ctx(fs));
  const late = cancelTrip({ tripId: u.trip.id, account: RIDER }, ctx(fs));
  assert.equal(late.ok, false);
  assert.match(late.reason, /cannot be cancelled/);
});

test('unknown trips and junk input soft-fail rather than throw', async () => {
  const fs = memfs();
  assert.equal(tripById('nope', ctx(fs)).ok, false);
  assert.equal(acceptTrip({ tripId: 'nope', driver: DRIVER }, ctx(fs)).ok, false);
  assert.equal(advanceTrip({}, ctx(fs)).ok, false);
  assert.equal(completeTrip({}, ctx(fs)).ok, false);
  assert.equal(cancelTrip({}, ctx(fs)).ok, false);
  assert.equal((await confirmPayment({}, {}, ctx(fs))).ok, false);
  assert.equal(applyDriver({}, ctx(fs)).ok, false);
  assert.equal(riderPing({}, ctx(fs)).ok, false);
  assert.equal(driverApplication('nobody', ctx(fs)).status, 'none');
});

test('rideSummary states the fee, the custody rule, and that the card rail is NOT wired', () => {
  const s = rideSummary();
  assert.equal(s.app, 'MELEK Ride');
  assert.equal(s.platformFeePct, 0.1);
  assert.match(s.custody, /holds no keys and no escrow/);
  assert.match(s.onboarding.rider, /MELEK account/);
  assert.match(s.onboarding.driver, /reviewed/);
  assert.match(s.paymentRails.usdCard, /not wired/);
});

// ── coverage: what a rider is told when nobody is driving near them ───────────────────────────────
test('coverage escalates area → region → state → country → anywhere', () => {
  const fs = memfs();
  // nobody online at all
  const empty = coverage({ ...DALLAS, state: 'TX', country: 'US' }, ctx(fs));
  assert.equal(empty.level, 'none');
  assert.equal(empty.covered, false);
  assert.match(empty.message, /No drivers are online anywhere/);
  assert.match(empty.message, /they can apply in the Drive tab/);

  // a driver in another country
  applyDriver({ account: 'far-driver', ...APP, state: 'ON', country: 'CA' }, ctx(fs));
  reviewDriver({ account: 'far-driver', decision: 'approved', by: 'hathor' }, ctx(fs));
  driverOnline({ account: 'far-driver', lat: 43.65, lng: -79.38 }, ctx(fs));
  const abroad = coverage({ ...DALLAS, state: 'TX', country: 'US' }, ctx(fs));
  assert.equal(abroad.level, 'elsewhere');
  assert.equal(abroad.drivers.country, 0);
  assert.equal(abroad.drivers.anywhere, 1);
  assert.match(abroad.message, /no drivers online in US yet/);

  // a driver elsewhere in the same country
  applyDriver({ account: 'nyc-driver', ...APP, state: 'NY', country: 'US' }, ctx(fs));
  reviewDriver({ account: 'nyc-driver', decision: 'approved', by: 'hathor' }, ctx(fs));
  driverOnline({ account: 'nyc-driver', lat: FARAWAY.lat, lng: FARAWAY.lng }, ctx(fs));
  const country = coverage({ ...DALLAS, state: 'TX', country: 'US' }, ctx(fs));
  assert.equal(country.level, 'country');
  assert.equal(country.drivers.state, 0);
  assert.equal(country.drivers.country, 1);
  assert.match(country.message, /elsewhere in US/);

  // a driver in the rider's own state, but far away
  applyDriver({ account: 'elpaso-driver', ...APP, state: 'TX', country: 'US' }, ctx(fs));
  reviewDriver({ account: 'elpaso-driver', decision: 'approved', by: 'hathor' }, ctx(fs));
  driverOnline({ account: 'elpaso-driver', lat: 31.7619, lng: -106.485 }, ctx(fs));   // El Paso: ~550 mi
  const state = coverage({ ...DALLAS, state: 'TX', country: 'US' }, ctx(fs));
  assert.equal(state.level, 'state');
  assert.equal(state.drivers.state, 1);
  assert.ok(state.nearestMiles > 500);
  assert.match(state.message, /online in TX/);

  // and finally one in town
  approvedDriver(fs);
  const near = coverage({ ...DALLAS, state: 'TX', country: 'US' }, ctx(fs));
  assert.equal(near.level, 'area');
  assert.equal(near.covered, true);
  assert.equal(near.drivers.area, 1);
  assert.match(near.message, /within 15 miles of you/);
});

test('coverage names the region band when the nearest car is outside the match radius', () => {
  const fs = memfs();
  applyDriver({ account: 'suburb-driver', ...APP, state: 'TX', country: 'US' }, ctx(fs));
  reviewDriver({ account: 'suburb-driver', decision: 'approved', by: 'hathor' }, ctx(fs));
  driverOnline({ account: 'suburb-driver', lat: 32.75, lng: -97.33 }, ctx(fs));   // Fort Worth, ~32 mi
  const c = coverage({ ...DALLAS, state: 'TX', country: 'US' }, ctx(fs));
  assert.equal(c.level, 'region');
  assert.equal(c.drivers.area, 0);
  assert.equal(c.drivers.region, 1);
  assert.match(c.message, /nearest is 3\d(\.\d)? miles away/);
  assert.match(c.message, /may wait a while/);
});

test('a request with nobody nearby carries the coverage answer, not a spinner', () => {
  const fs = memfs();
  const r = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs, { state: 'TX', country: 'US' }));
  assert.equal(r.ok, true);
  assert.equal(r.driversAvailable, 0);
  assert.equal(r.coverage.level, 'none');
  assert.match(r.coverage.message, /No drivers are online anywhere/);
  // and when there IS a driver, no coverage lecture is attached
  const fs2 = memfs();
  approvedDriver(fs2);
  const ok = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs2));
  assert.equal(ok.coverage, null);
});

test('the nearby summary also carries coverage when it is empty, and never a position', () => {
  const fs = memfs();
  const s = driversNearSummary(DALLAS, ctx(fs, { state: 'TX', country: 'US' }));
  assert.equal(s.available, 0);
  assert.equal(s.coverage.level, 'none');
  assert.equal(JSON.stringify(s).includes('-96.797'), false);
});

test('a driver application records where they drive; the licence state is the default', () => {
  const fs = memfs();
  const a = applyDriver({ account: DRIVER, ...APP }, ctx(fs));
  assert.equal(a.driver.region.state, 'TX', 'defaults to the licence state');
  assert.equal(a.driver.region.country, 'US');
  const b = applyDriver({ account: OTHER, ...APP, state: 'nm', country: 'mx' }, ctx(fs));
  assert.equal(b.driver.region.state, 'NM');
  assert.equal(b.driver.region.country, 'MX');
});


// ── the rider's trip counts into the WALK lane (operator, 2026-11-12) ─────────────────────────────

test('riderWalkCredit converts ridden miles into discounted step-equivalents', () => {
  const c = riderWalkCredit({ miles: 10 });
  assert.equal(c.creditedMiles, 10);
  assert.equal(c.stepEquivalent, 10 * RIDE_WALK_STEPS_PER_MILE() * RIDE_WALK_PCT());   // 5,000 at defaults
  assert.equal(c.pct, 0.25, 'riding is credited at a fraction — it is not walking');
  assert.equal(c.index, 0);
  assert.match(c.note, /step-equivalents into the MELEK Move walk lane/);
});

test('riderWalkCredit caps one trip and never throws on junk', () => {
  const long = riderWalkCredit({ miles: 400 });
  assert.equal(long.creditedMiles, RIDE_WALK_MAX_MILES());
  assert.equal(long.stepEquivalent, RIDE_WALK_MAX_MILES() * RIDE_WALK_STEPS_PER_MILE() * RIDE_WALK_PCT());
  assert.match(long.note, /capped at/);
  assert.equal(riderWalkCredit(null).stepEquivalent, 0);
  assert.equal(riderWalkCredit({ miles: 'x' }).stepEquivalent, 0);
  assert.equal(riderWalkCredit({ miles: -5 }).stepEquivalent, 0);
  // a ride can never reach a serious walker's boost tier: the cap is below 15,000 step-equivalents
  assert.ok(long.stepEquivalent < 15000, 'a capped ride stays under the 4x step tier');
});

test('riderWalkCredit diminishes repeat rides inside the same hour', () => {
  assert.equal(riderWalkCredit({ miles: 5, ridesThisHour: 0 }).index, 0);
  const second = riderWalkCredit({ miles: 5, ridesThisHour: 1 });
  assert.equal(second.index, 1);
  assert.match(second.note, /ride #2 this hour, so it diminishes/);
});

test('a verified fare credits the RIDER into the walk lane, on top of the driver\'s drive sample', async () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 12, minutes: 24 }, ctx(fs));

  const walks = [];
  const r = await confirmPayment({ tripId: t.trip.id, trxId: 'tx-walk-1' }, {
    verifyTransfer: async () => ({ ok: true }),
    recordRiderWalk: (c) => { walks.push(c); return { ok: true, accountWeight: 1234 }; },
  }, ctx(fs));

  assert.equal(r.ok, true);
  assert.equal(walks.length, 1, 'exactly one walk-lane claim per paid trip');
  assert.equal(walks[0].account, RIDER, 'the credit goes to the RIDER, not the driver');
  assert.equal(walks[0].tripId, t.trip.id);
  assert.equal(walks[0].stepEquivalent, 12 * RIDE_WALK_STEPS_PER_MILE() * RIDE_WALK_PCT());
  assert.equal(r.riderWalk.recorded, true);
  assert.equal(r.riderWalk.index, 0);
});

test('with no walk recorder wired the trip still pays, and says the credit was not filed', async () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 6, minutes: 15 }, ctx(fs));
  const r = await confirmPayment({ tripId: t.trip.id, trxId: 'tx-walk-2' },
    { verifyTransfer: async () => ({ ok: true }) }, ctx(fs));
  assert.equal(r.ok, true);
  assert.equal(r.riderWalk.recorded, false);
  assert.match(r.riderWalk.reason, /no walk-lane recorder/);
  assert.equal(tripById(t.trip.id, ctx(fs)).trip.status, 'completed', 'the fare is still paid');
});

test('a throwing walk recorder cannot un-pay a paid trip', async () => {
  const fs = memfs();
  approvedDriver(fs);
  const t = requestTrip({ rider: RIDER, pickup: DALLAS, dropoff: NEARBY }, ctx(fs));
  acceptTrip({ tripId: t.trip.id, driver: DRIVER }, ctx(fs));
  completeTrip({ tripId: t.trip.id, driver: DRIVER, miles: 9, minutes: 18 }, ctx(fs));
  const r = await confirmPayment({ tripId: t.trip.id, trxId: 'tx-walk-3' }, {
    verifyTransfer: async () => ({ ok: true }),
    recordRiderWalk: () => { throw new Error('ledger on fire'); },
  }, ctx(fs));
  assert.equal(r.ok, true);
  assert.equal(r.riderWalk.recorded, false);
  assert.match(r.riderWalk.reason, /ledger on fire/);
  assert.equal(tripById(t.trip.id, ctx(fs)).trip.status, 'completed');
});

test('rideSummary publishes the rider walk lane, bounded and honest about the discount', () => {
  const w = rideSummary().walkLane;
  assert.equal(w.riderEarns, true);
  assert.equal(w.pct, RIDE_WALK_PCT());
  assert.equal(w.maxMilesPerTrip, RIDE_WALK_MAX_MILES());
  assert.match(w.how, /riding can never out-earn walking/);
});
