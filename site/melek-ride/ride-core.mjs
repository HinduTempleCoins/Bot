// ride-core.mjs — MELEK Ride: the rideshare engine (matching, fares, the trip state machine).
//
// MELEK Ride is the other half of MELEK Drive. Drive pays a driver for miles whoever they are driving
// for; Ride is the app that gives them someone to drive. A completed MELEK Ride trip is also the only
// drive sample this system can VERIFY, so it is the one that earns the drive-weight boost.
//
// KEY CUSTODY IS THE WHOLE DESIGN CONSTRAINT. We never hold a rider's key, so we cannot move a rider's
// MELEK. A finished trip therefore does not "charge" anyone: it produces a PAYMENT INTENT — two ops in
// one transaction, rider -> driver (the driver's share) and rider -> the fee account (the platform's
// share) — that the RIDER signs on MELEK-Signer. No escrow account, no relay holding fares, nothing for
// an attacker to drain. The trip only completes when the signed transaction is verified on-chain.
//
// Everything here is pure or store-only: injectable fs, no network, no keys. Tested offline.
//
//   import { quoteFare, haversineMiles, requestTrip, acceptTrip, completeTrip } from './ride-core.mjs';

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../../signup/welcome-grant.mjs';
import { gasEquivalent } from '../../integrations/games/drive-economy.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };
export const DATA_FILE = () => env('RIDE_DATA', join(process.cwd(), 'data', 'melek-ride.json'));

// ── the rate card (MELEK, operator-settable) ───────────────────────────────────────────────────────
// Denominated in MELEK, not dollars: MELEK has no market price, so a USD rate card would be a made-up
// conversion. The USD line on a quote appears only when someone supplies a price, and is labeled
// theoretical. Change any of these with one env var.
export const RIDE_BASE = () => num('RIDE_BASE_MELEK', 2);          // flag drop
export const RIDE_PER_MILE = () => num('RIDE_PER_MILE_MELEK', 1);
export const RIDE_PER_MINUTE = () => num('RIDE_PER_MINUTE_MELEK', 0.25);
export const RIDE_MINIMUM = () => num('RIDE_MIN_MELEK', 5);
/** The platform's take. This is the revenue line of the app: a cut of every completed fare. */
export const RIDE_FEE_PCT = () => Math.min(0.5, Math.max(0, num('RIDE_FEE_PCT', 0.1)));
export const RIDE_FEE_ACCOUNT = () => String(env('RIDE_FEE_ACCOUNT', 'hathor')).trim().toLowerCase();
/** Riders are only matched with drivers inside this radius. */
export const RIDE_MATCH_RADIUS_MI = () => num('RIDE_MATCH_RADIUS_MI', 15);
/** A driver who has not pinged in this long is treated as offline. */
export const RIDE_DRIVER_STALE_SEC = () => num('RIDE_DRIVER_STALE_SEC', 300);
/** Beyond the match radius, this is the "region" band a rider is told about when their area is empty. */
export const RIDE_REGION_RADIUS_MI = () => num('RIDE_REGION_RADIUS_MI', 150);
/** Where this deployment is launching. A driver's application can override it. */
export const RIDE_DEFAULT_COUNTRY = () => String(env('RIDE_DEFAULT_COUNTRY', 'US')).trim().toUpperCase();
/** A rider counts as "looking" for this long after their last ping. */
export const RIDE_PRESENCE_STALE_SEC = () => num('RIDE_PRESENCE_STALE_SEC', 180);

// ── geo ────────────────────────────────────────────────────────────────────────────────────────────
/** Great-circle distance in miles. Pure. */
export function haversineMiles(aLat, aLng, bLat, bLng) {
  const R = 3958.7613;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(bLat) - toRad(aLat);
  const dLng = toRad(bLng) - toRad(aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const validCoord = (lat, lng) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
  && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;

// ── fares ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * Quote a fare. Pure. Returns the rider's total and how it splits between driver and platform.
 * @param {{miles:number, minutes?:number, melekUsd?:number|null}} p
 */
export function quoteFare({ miles = 0, minutes = 0, melekUsd } = {}) {
  const mi = Math.max(0, Number(miles) || 0);
  const min = Math.max(0, Number(minutes) || 0);
  const raw = RIDE_BASE() + mi * RIDE_PER_MILE() + min * RIDE_PER_MINUTE();
  const total = round(Math.max(raw, RIDE_MINIMUM()), 3);
  const fee = round(total * RIDE_FEE_PCT(), 3);
  const driver = round(total - fee, 3);
  return {
    miles: round(mi, 2), minutes: round(min, 1),
    total, driverShare: driver, platformFee: fee, feePct: RIDE_FEE_PCT(),
    symbol: env('MELEK_SYMBOL', env('WELCOME_SYMBOL', 'MELEK')),
    rateCard: { base: RIDE_BASE(), perMile: RIDE_PER_MILE(), perMinute: RIDE_PER_MINUTE(), minimum: RIDE_MINIMUM() },
    minimumApplied: raw < RIDE_MINIMUM(),
    usd: gasEquivalent({ melek: total, melekUsd }),
  };
}

// ── store ──────────────────────────────────────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function load(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { drivers: {}, riders: {}, trips: {}, seq: 0 };
  try { const o = JSON.parse(raw); return { drivers: o.drivers || {}, riders: o.riders || {}, trips: o.trips || {}, seq: Number(o.seq) || 0 }; }
  catch { return { drivers: {}, riders: {}, trips: {}, seq: 0 }; }
}
function save(fs, file, store) {
  // keep the trip log bounded: drop the oldest finished trips past RIDE_KEEP_TRIPS
  const keep = num('RIDE_KEEP_TRIPS', 2000);
  const ids = Object.keys(store.trips);
  if (ids.length > keep) {
    const done = ids.filter((id) => ['completed', 'cancelled', 'expired'].includes(store.trips[id].status))
      .sort((a, b) => (store.trips[a].updatedAt || 0) - (store.trips[b].updatedAt || 0));
    for (const id of done.slice(0, ids.length - keep)) delete store.trips[id];
  }
  // rider presence is ephemeral: anything older than the stale window is dropped, not kept forever
  if (store.riders) {
    const cutoff = Date.now() - RIDE_PRESENCE_STALE_SEC() * 1000;
    for (const [k, r] of Object.entries(store.riders)) if (!r || Number(r.pingedAt || 0) < cutoff) delete store.riders[k];
  }
  (fs.write || realFs.write)(file, JSON.stringify(store));
}
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE(), now: opts.now != null ? Number(opts.now) : Date.now() });

export const TRIP_STATES = ['requested', 'accepted', 'arrived', 'in_progress', 'awaiting_payment', 'completed', 'cancelled'];

// ── driver applications ────────────────────────────────────────────────────────────────────────────
// The two sides onboard differently, on purpose. A RIDER just makes a MELEK account — that is the whole
// signup. A DRIVER applies: the car, the plate, the licence and the insurance, reviewed before they can
// ever appear to a rider. Nobody drives on this app because they typed a username.
//
// That application is the only personal information this system holds, it is held OFF-CHAIN in this
// store and nowhere else, it never goes into a post, an op or a memo, and the licence and insurance
// fields are never returned by any rider-facing read (see publicDriver / driverApplication).
export const DRIVER_STATES = ['none', 'pending', 'approved', 'rejected', 'suspended'];
export const RIDE_AUTO_APPROVE = () => String(env('RIDE_AUTO_APPROVE', '')) === '1';
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/**
 * Apply to drive. Re-applying while pending or rejected updates the application; an approved driver
 * editing their details goes back to pending (a new car is a new thing to check).
 * @param {{account:string, vehicle:{make,model,year,color,plate,seats}, licenceNumber:string,
 *          licenceState?:string, insurer?:string, policyNumber?:string, policyExpires?:string}} a
 */
export function applyDriver({ account, vehicle = {}, licenceNumber, licenceState, insurer, policyNumber, policyExpires, state, country } = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'driver must be a valid MELEK account name' };
  const v = {
    make: str(vehicle.make, 40), model: str(vehicle.model, 40), color: str(vehicle.color, 24),
    plate: str(vehicle.plate, 16).toUpperCase(), year: Number(vehicle.year) || 0,
    seats: Math.min(8, Math.max(1, Number(vehicle.seats) || 4)),
  };
  const missing = [];
  if (!v.make) missing.push('vehicle make');
  if (!v.model) missing.push('vehicle model');
  if (!v.plate) missing.push('licence plate');
  const thisYear = new Date().getUTCFullYear();
  if (!(v.year >= 1950 && v.year <= thisYear + 1)) missing.push('vehicle year');
  const licence = str(licenceNumber, 32);
  if (!licence) missing.push("driver's licence number");
  if (missing.length) return { ok: false, reason: `still needed: ${missing.join(', ')}`, missing };

  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const prev = store.drivers[who] || {};
  const auto = RIDE_AUTO_APPROVE();
  store.drivers[who] = {
    ...prev,
    account: who,
    status: auto ? 'approved' : 'pending',
    online: false,
    vehicle: v,
    seats: v.seats,
    // held off-chain, never served to a rider, never broadcast
    licence: { number: licence, state: str(licenceState, 24) },
    insurance: { insurer: str(insurer, 60), policyNumber: str(policyNumber, 40), expires: str(policyExpires, 10) },
    // WHERE this driver drives. Defaults to the licence's state, which is a reasonable first guess and
    // not a certainty — a driver can state a different one. Used only to answer a rider's "is anyone
    // driving in my state / my country at all?"
    region: { state: str(state, 24).toUpperCase() || str(licenceState, 24).toUpperCase(), country: str(country, 2).toUpperCase() || RIDE_DEFAULT_COUNTRY() },
    appliedAt: now, reviewedAt: auto ? now : null, reviewedBy: auto ? 'auto' : null, reviewNote: auto ? 'auto-approved (RIDE_AUTO_APPROVE=1)' : '',
    trips: Number(prev.trips) || 0, milesDriven: Number(prev.milesDriven) || 0, earned: Number(prev.earned) || 0,
  };
  save(fs, file, store);
  return {
    ok: true, status: store.drivers[who].status, driver: publicDriver(store.drivers[who]),
    note: auto
      ? 'Approved. You can go online.'
      : 'Application received. A human reviews the car, the plate, the licence and the insurance before you can appear to a rider.',
  };
}

/** A driver's own view of their application — their licence/insurance are returned only to themselves. */
export function driverApplication(account, { self = false, ...opts } = {}) {
  const who = String(account || '').trim().toLowerCase();
  const { fs, file } = ctx(opts);
  const d = load(fs, file).drivers[who];
  if (!d) return { ok: true, account: who, status: 'none', note: 'No application yet. Apply to drive, or just ride — riders only need a MELEK account.' };
  const out = { ok: true, account: who, status: d.status || 'approved', driver: publicDriver(d), appliedAt: d.appliedAt || null, reviewedAt: d.reviewedAt || null, reviewNote: d.reviewNote || '' };
  if (self) { out.licence = d.licence || null; out.insurance = d.insurance || null; }
  return out;
}

/** Approve / reject / suspend an application. The server gates this to the review accounts. */
export function reviewDriver({ account, decision, by, note } = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const dec = String(decision || '').trim().toLowerCase();
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(dec)) return { ok: false, reason: 'decision must be approved, rejected, suspended or pending' };
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const d = store.drivers[who];
  if (!d) return { ok: false, reason: 'no application for that account' };
  d.status = dec; d.reviewedAt = now; d.reviewedBy = String(by || '').trim().toLowerCase(); d.reviewNote = str(note, 200);
  if (dec !== 'approved') d.online = false;
  save(fs, file, store);
  return { ok: true, account: who, status: d.status, driver: publicDriver(d) };
}

/** Applications awaiting review, oldest first (the review queue). Licence/insurance included — admin only. */
export function pendingApplications(opts = {}) {
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  return Object.values(store.drivers)
    .filter((d) => (d.status || '') === 'pending')
    .sort((a, b) => (a.appliedAt || 0) - (b.appliedAt || 0))
    .map((d) => ({ account: d.account, appliedAt: d.appliedAt, vehicle: d.vehicle, licence: d.licence || null, insurance: d.insurance || null }));
}

// ── drivers going on and off shift ─────────────────────────────────────────────────────────────────
/**
 * Go online (or re-ping a location). Only an APPROVED application can go online — this is the gate the
 * rider is trusting. A driver is matchable only while approved, online and freshly pinged.
 * @param {{account:string, lat:number, lng:number, seats?:number}} d
 */
export function driverOnline({ account, lat, lng, seats } = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'driver must be a valid MELEK account name' };
  if (!validCoord(lat, lng)) return { ok: false, reason: 'lat/lng required to go online' };
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const prev = store.drivers[who];
  if (!prev) return { ok: false, reason: 'apply to drive first — the car, the plate, the licence and the insurance', status: 'none' };
  if ((prev.status || '') !== 'approved') {
    return {
      ok: false, status: prev.status || 'pending',
      reason: prev.status === 'pending' ? 'your application is still being reviewed' : `your driver application is ${prev.status}`,
    };
  }
  store.drivers[who] = {
    ...prev,
    online: true, lat: Number(lat), lng: Number(lng),
    seats: Math.min(8, Math.max(1, Number(seats) || Number(prev.seats) || 4)),
    onlineSince: prev.online ? (prev.onlineSince || now) : now, pingedAt: now,
  };
  save(fs, file, store);
  return { ok: true, driver: publicDriver(store.drivers[who]) };
}

export function driverOffline({ account } = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const d = store.drivers[who];
  if (!d) return { ok: false, reason: 'not online' };
  d.online = false; d.pingedAt = now;
  save(fs, file, store);
  return { ok: true, driver: publicDriver(d) };
}

// What anyone other than the driver themselves may see. The licence and the insurance are NOT in here
// and must never be added: a rider needs to recognise the car, not read a licence number.
const publicDriver = (d) => {
  const v = d.vehicle && typeof d.vehicle === 'object' ? d.vehicle : {};
  return {
    account: d.account, status: d.status || 'approved', online: !!d.online,
    vehicle: { make: v.make || '', model: v.model || '', color: v.color || '', year: v.year || 0, plate: v.plate || '' },
    car: [v.color, v.year || '', v.make, v.model].filter(Boolean).join(' ').trim(),
    seats: d.seats || 4,
    region: { state: (d.region || {}).state || '', country: (d.region || {}).country || RIDE_DEFAULT_COUNTRY() },
    trips: d.trips || 0, milesDriven: round(d.milesDriven || 0, 1), earned: round(d.earned || 0, 3),
  };
};

/** Online, fresh drivers within the match radius of a point, nearest first. Pure read. */
export function nearbyDrivers({ lat, lng, radiusMi } = {}, opts = {}) {
  const { fs, file, now } = ctx(opts);
  if (!validCoord(lat, lng)) return [];
  const store = load(fs, file);
  const radius = Number(radiusMi) > 0 ? Number(radiusMi) : RIDE_MATCH_RADIUS_MI();
  const staleMs = RIDE_DRIVER_STALE_SEC() * 1000;
  const busy = new Set(Object.values(store.trips)
    .filter((t) => ['accepted', 'arrived', 'in_progress'].includes(t.status) && t.driver)
    .map((t) => t.driver));
  return Object.values(store.drivers)
    .filter((d) => (d.status || '') === 'approved' && d.online && now - Number(d.pingedAt || 0) <= staleMs && !busy.has(d.account))
    .map((d) => ({ ...publicDriver(d), miles: round(haversineMiles(lat, lng, d.lat, d.lng), 2) }))
    .filter((d) => d.miles <= radius)
    .sort((a, b) => a.miles - b.miles);
}

/** What a rider is allowed to know: how many cars are near and how far the closest is. Never coordinates. */
export function driversNearSummary({ lat, lng } = {}, opts = {}) {
  const list = nearbyDrivers({ lat, lng }, opts);
  const nearest = list[0] ? list[0].miles : null;
  return {
    ok: true, available: list.length, nearestMiles: nearest,
    etaMinutes: nearest == null ? null : Math.max(1, Math.round((nearest / 25) * 60)),
    radiusMi: RIDE_MATCH_RADIUS_MI(),
    coverage: list.length ? null : coverage({ lat, lng, state: opts.state, country: opts.country }, opts),
    note: 'Driver locations are never sent to riders — only how many are nearby and how far the closest one is.',
  };
}

// ── the market board: how many on each side, so neither side is staring at an empty app ───────────
// A new marketplace fails quietly when each side assumes the other is empty. So both sides can see the
// same counts: drivers online, riders looking, requests open right now. COUNTS ONLY — never a position,
// never an account name. A rider pings while the app is open; a driver's ping is their online heartbeat.

/** Mark a rider as present and looking. Presence expires by itself (RIDE_PRESENCE_STALE_SEC). */
export function riderPing({ account, lat, lng } = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'rider must be a valid MELEK account name' };
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  store.riders[who] = {
    account: who, pingedAt: now,
    lat: validCoord(lat, lng) ? Number(lat) : null, lng: validCoord(lat, lng) ? Number(lng) : null,
  };
  save(fs, file, store);
  return { ok: true, ...marketStatus({ lat, lng }, { ...opts, fs, file, now }) };
}

/**
 * The board. Global counts always; the nearby counts too when a point is given. Public — it takes no
 * account and returns no identity, because the number both sides need to see is just a number.
 */
export function marketStatus({ lat, lng } = {}, opts = {}) {
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const driverFresh = now - RIDE_DRIVER_STALE_SEC() * 1000;
  const riderFresh = now - RIDE_PRESENCE_STALE_SEC() * 1000;
  const here = validCoord(lat, lng);
  const radius = RIDE_MATCH_RADIUS_MI();

  const drivers = Object.values(store.drivers).filter((d) => (d.status || '') === 'approved' && d.online && Number(d.pingedAt || 0) >= driverFresh);
  const riders = Object.values(store.riders || {}).filter((r) => Number(r.pingedAt || 0) >= riderFresh);
  const open = Object.values(store.trips).filter((t) => t.status === 'requested');
  const running = Object.values(store.trips).filter((t) => ['accepted', 'arrived', 'in_progress'].includes(t.status));
  const near = (x) => here && Number.isFinite(Number(x.lat)) && haversineMiles(lat, lng, x.lat, x.lng) <= radius;

  const driversNear = here ? drivers.filter(near).length : null;
  const ridersNear = here ? riders.filter(near).length : null;
  const requestsNear = here ? open.filter((t) => haversineMiles(lat, lng, t.pickup.lat, t.pickup.lng) <= radius).length : null;
  const nearestDriver = here ? nearbyDrivers({ lat, lng }, { ...opts, fs, file, now })[0] : null;

  return {
    ok: true,
    driversOnline: drivers.length,
    ridersLooking: riders.length,
    requestsOpen: open.length,
    tripsRunning: running.length,
    pendingApplications: Object.values(store.drivers).filter((d) => (d.status || '') === 'pending').length,
    nearby: here ? { radiusMi: radius, driversOnline: driversNear, ridersLooking: ridersNear, requestsOpen: requestsNear, nearestDriverMiles: nearestDriver ? nearestDriver.miles : null } : null,
    staleSec: { driver: RIDE_DRIVER_STALE_SEC(), rider: RIDE_PRESENCE_STALE_SEC() },
    note: 'Counts only. No positions and no account names are published — a rider sees how many cars are out, a driver sees how many people are looking.',
  };
}

// ── coverage: telling a rider the truth when nobody is driving near them ───────────────────────────
// A rider staring at "no cars found" cannot tell whether the app is broken, whether they are early, or
// whether MELEK Ride simply has not reached their country. So the answer escalates: their area, then
// their region, then their state, then their country, then anywhere — and says which level the nearest
// driver is at. Counts only, as everywhere else.

/**
 * @param {{lat?:number, lng?:number, state?:string, country?:string}} where  rider's point; state/country optional
 * @returns {{ok:true, level:string, drivers:object, nearestMiles:number|null, message:string, ...}}
 */
export function coverage({ lat, lng, state, country } = {}, opts = {}) {
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const fresh = now - RIDE_DRIVER_STALE_SEC() * 1000;
  const online = Object.values(store.drivers).filter((d) => (d.status || '') === 'approved' && d.online && Number(d.pingedAt || 0) >= fresh);
  const here = validCoord(lat, lng);
  const st = String(state || '').trim().toUpperCase();
  const cc = String(country || '').trim().toUpperCase() || RIDE_DEFAULT_COUNTRY();

  const withMiles = online.map((d) => ({ d, miles: here ? haversineMiles(lat, lng, d.lat, d.lng) : null }));
  const areaMi = RIDE_MATCH_RADIUS_MI();
  const regionMi = RIDE_REGION_RADIUS_MI();
  const inArea = here ? withMiles.filter((x) => x.miles <= areaMi).length : 0;
  const inRegion = here ? withMiles.filter((x) => x.miles <= regionMi).length : 0;
  const inState = st ? online.filter((d) => ((d.region || {}).state || '') === st).length : null;
  const inCountry = online.filter((d) => ((d.region || {}).country || RIDE_DEFAULT_COUNTRY()) === cc).length;
  const anywhere = online.length;
  const nearest = here && withMiles.length ? round(Math.min(...withMiles.map((x) => x.miles)), 1) : null;

  // the first level that actually has a driver — that is what the rider is told
  let level = 'none';
  if (inArea > 0) level = 'area';
  else if (inRegion > 0) level = 'region';
  else if (inState > 0) level = 'state';
  else if (inCountry > 0) level = 'country';
  else if (anywhere > 0) level = 'elsewhere';

  const applyLine = 'If you know someone who drives, they can apply in the Drive tab — the app needs drivers before it can give rides.';
  const message = {
    area: () => `${inArea} ${inArea === 1 ? 'driver is' : 'drivers are'} online within ${areaMi} miles of you.`,
    region: () => `No drivers within ${areaMi} miles. The nearest is ${nearest} miles away, and ${inRegion} ${inRegion === 1 ? 'is' : 'are'} online in your wider region — a request may wait a while.`,
    state: () => `No drivers near you. ${inState} ${inState === 1 ? 'driver is' : 'drivers are'} online in ${st}, but none within ${regionMi} miles. ${applyLine}`,
    country: () => `No drivers online in your area${st ? ` or in ${st}` : ''} right now. ${inCountry} ${inCountry === 1 ? 'is' : 'are'} online elsewhere in ${cc}. ${applyLine}`,
    elsewhere: () => `MELEK Ride has no drivers online in ${cc} yet — ${anywhere} ${anywhere === 1 ? 'is' : 'are'} online in other countries. ${applyLine}`,
    none: () => `No drivers are online anywhere right now. MELEK Ride is new, so this will say so plainly rather than leave you waiting on a car that is not coming. ${applyLine}`,
  }[level]();

  return {
    ok: true, level, covered: level === 'area',
    drivers: { area: here ? inArea : null, region: here ? inRegion : null, state: inState, country: inCountry, anywhere },
    nearestMiles: nearest, bands: { areaMi, regionMi }, queried: { state: st || null, country: cc },
    message,
  };
}

// ── trips ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * A rider requests a ride. Quotes the fare from the straight-line trip distance (the final fare is
 * recomputed from the actual miles/minutes at completion) and offers it to the nearest free driver.
 * @param {{rider:string, pickup:{lat,lng}, dropoff:{lat,lng}, note?:string}} r
 */
export function requestTrip({ rider, pickup, dropoff, note } = {}, opts = {}) {
  const who = String(rider || '').trim().toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'rider must be a valid MELEK account name' };
  const p = pickup || {}; const q = dropoff || {};
  if (!validCoord(p.lat, p.lng) || !validCoord(q.lat, q.lng)) return { ok: false, reason: 'pickup and dropoff coordinates are required' };

  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const open = Object.values(store.trips).find((t) => t.rider === who && !['completed', 'cancelled'].includes(t.status));
  if (open) return { ok: false, reason: 'you already have a trip in progress', trip: publicTrip(open) };

  const miles = haversineMiles(p.lat, p.lng, q.lat, q.lng);
  // an estimate only, at a 25 mph city average — the real minutes are measured on the trip
  const minutes = (miles / 25) * 60;
  const quote = quoteFare({ miles, minutes, melekUsd: opts.melekUsd });
  const candidates = nearbyDrivers({ lat: p.lat, lng: p.lng }, { ...opts, fs, file, now });

  store.seq = (Number(store.seq) || 0) + 1;
  const id = `r${String(now).slice(-8)}${String(store.seq).padStart(4, '0')}`;
  const trip = {
    id, rider: who, driver: null, status: 'requested',
    pickup: { lat: Number(p.lat), lng: Number(p.lng) }, dropoff: { lat: Number(q.lat), lng: Number(q.lng) },
    note: String(note || '').slice(0, 140),
    estimate: { miles: quote.miles, minutes: quote.minutes, total: quote.total },
    fare: null, payment: null, createdAt: now, updatedAt: now,
    offeredTo: candidates.slice(0, 3).map((d) => d.account),
  };
  store.trips[id] = trip;
  // requesting a ride is the strongest "I'm looking" there is — it counts on the board
  store.riders[who] = { account: who, pingedAt: now, lat: Number(p.lat), lng: Number(p.lng) };
  save(fs, file, store);
  return {
    ok: true, trip: publicTrip(trip), quote,
    driversAvailable: candidates.length,
    // when nobody is near, say WHERE the nearest driver actually is instead of spinning
    coverage: candidates.length ? null : coverage({ lat: p.lat, lng: p.lng, state: opts.state, country: opts.country }, { ...opts, fs, file, now }),
    note: candidates.length ? 'Offered to the nearest drivers.' : 'No driver is online nearby yet — the request stays open.',
  };
}

function getTrip(store, id) { return store.trips[String(id || '').trim()]; }

/** A driver accepts a requested trip. First accept wins. */
export function acceptTrip({ tripId, driver } = {}, opts = {}) {
  const who = String(driver || '').trim().toLowerCase();
  if (!validAccountName(who)) return { ok: false, reason: 'driver must be a valid MELEK account name' };
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const trip = getTrip(store, tripId);
  if (!trip) return { ok: false, reason: 'no such trip' };
  if (trip.status !== 'requested') return { ok: false, reason: `trip is ${trip.status}, not open`, trip: publicTrip(trip) };
  const d = store.drivers[who];
  if (!d || (d.status || '') !== 'approved') return { ok: false, reason: 'only an approved driver can accept a trip', status: (d && d.status) || 'none' };
  if (!d.online) return { ok: false, reason: 'go online before accepting a trip' };
  const busy = Object.values(store.trips).find((t) => t.driver === who && ['accepted', 'arrived', 'in_progress'].includes(t.status));
  if (busy) return { ok: false, reason: 'finish your current trip first', trip: publicTrip(busy) };
  trip.driver = who; trip.status = 'accepted'; trip.acceptedAt = now; trip.updatedAt = now;
  save(fs, file, store);
  return { ok: true, trip: publicTrip(trip) };
}

/** Driver status moves: 'arrived' then 'in_progress'. */
export function advanceTrip({ tripId, driver, to } = {}, opts = {}) {
  const who = String(driver || '').trim().toLowerCase();
  const next = String(to || '').trim();
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const trip = getTrip(store, tripId);
  if (!trip) return { ok: false, reason: 'no such trip' };
  if (trip.driver !== who) return { ok: false, reason: 'only the assigned driver can move this trip' };
  const allowed = { accepted: ['arrived', 'in_progress'], arrived: ['in_progress'] };
  if (!(allowed[trip.status] || []).includes(next)) return { ok: false, reason: `cannot go ${trip.status} -> ${next || '(nothing)'}`, trip: publicTrip(trip) };
  trip.status = next; trip.updatedAt = now;
  if (next === 'in_progress') trip.startedAt = now;
  save(fs, file, store);
  return { ok: true, trip: publicTrip(trip) };
}

/**
 * The driver ends the trip. Recomputes the fare from the ACTUAL miles and minutes, and produces the
 * rider's payment intent: two ops in one transaction (driver share + platform fee), for the RIDER to
 * sign on MELEK-Signer. Nothing is charged here — we hold no rider key and no escrow.
 * @param {{tripId:string, driver:string, miles:number, minutes?:number}} c
 */
export function completeTrip({ tripId, driver, miles, minutes } = {}, opts = {}) {
  const who = String(driver || '').trim().toLowerCase();
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const trip = getTrip(store, tripId);
  if (!trip) return { ok: false, reason: 'no such trip' };
  if (trip.driver !== who) return { ok: false, reason: 'only the assigned driver can end this trip' };
  if (!['in_progress', 'arrived', 'accepted'].includes(trip.status)) return { ok: false, reason: `trip is ${trip.status}`, trip: publicTrip(trip) };

  const mi = Number(miles) >= 0 ? Number(miles) : trip.estimate.miles;
  const mins = Number(minutes) >= 0
    ? Number(minutes)
    : (trip.startedAt ? Math.max(0, (now - trip.startedAt) / 60000) : trip.estimate.minutes);
  const fare = quoteFare({ miles: mi, minutes: mins, melekUsd: opts.melekUsd });
  const symbol = fare.symbol;
  trip.status = 'awaiting_payment';
  trip.fare = { miles: fare.miles, minutes: fare.minutes, total: fare.total, driverShare: fare.driverShare, platformFee: fare.platformFee, feePct: fare.feePct };
  trip.payment = {
    // one transaction, two transfers, signed by the rider on MELEK-Signer. No relay, no escrow.
    ops: [
      ['transfer', { from: trip.rider, to: trip.driver, amount: `${fare.driverShare.toFixed(3)} ${symbol}`, memo: `MELEK Ride ${trip.id} — driver share` }],
      ...(fare.platformFee > 0
        ? [['transfer', { from: trip.rider, to: RIDE_FEE_ACCOUNT(), amount: `${fare.platformFee.toFixed(3)} ${symbol}`, memo: `MELEK Ride ${trip.id} — platform fee ${Math.round(fare.feePct * 100)}%` }]]
        : []),
    ],
    signedBy: 'rider', confirmedTrxId: null,
  };
  trip.endedAt = now; trip.updatedAt = now;
  save(fs, file, store);
  return {
    ok: true, trip: publicTrip(trip), fare,
    payment: trip.payment,
    note: 'Fare is not charged automatically — MELEK Ride never holds the rider\'s key. The rider signs this one transaction on MELEK-Signer and the trip closes when it is confirmed on-chain.',
  };
}

/**
 * Confirm the rider's signed fare transaction. The verify dep is what makes this real: without it the
 * trip stays awaiting_payment rather than being marked paid on a client's word.
 * @param {{tripId:string, trxId:string}} c
 * @param {{verifyTransfer?:function, recordDrive?:function}} deps
 */
export async function confirmPayment({ tripId, trxId } = {}, deps = {}, opts = {}) {
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const trip = getTrip(store, tripId);
  if (!trip) return { ok: false, reason: 'no such trip' };
  if (trip.status === 'completed') return { ok: true, alreadyCompleted: true, trip: publicTrip(trip) };
  if (trip.status !== 'awaiting_payment') return { ok: false, reason: `trip is ${trip.status}, not awaiting payment` };
  const id = String(trxId || '').trim();
  if (!id) return { ok: false, reason: 'the rider\'s transaction id is required' };
  if (typeof deps.verifyTransfer !== 'function') {
    return { ok: false, reason: 'no on-chain verifier wired — the trip stays awaiting_payment rather than being marked paid unverified', trip: publicTrip(trip) };
  }
  let v;
  try { v = await deps.verifyTransfer({ trxId: id, from: trip.rider, to: trip.driver, amount: trip.fare.driverShare, tripId: trip.id }); }
  catch (e) { return { ok: false, reason: `could not verify the fare transaction: ${String((e && e.message) || e).slice(0, 140)}`, trip: publicTrip(trip) }; }
  if (!v || v.ok !== true) return { ok: false, reason: (v && v.reason) || 'the fare transaction did not check out on-chain', trip: publicTrip(trip) };

  trip.status = 'completed'; trip.payment.confirmedTrxId = id; trip.paidAt = now; trip.updatedAt = now;
  const d = store.drivers[trip.driver];
  if (d) { d.trips = (Number(d.trips) || 0) + 1; d.milesDriven = (Number(d.milesDriven) || 0) + trip.fare.miles; d.earned = (Number(d.earned) || 0) + trip.fare.driverShare; }
  save(fs, file, store);

  // A completed MELEK Ride trip is a VERIFIED drive sample — the one that earns the drive-weight boost.
  let drive = null;
  if (typeof deps.recordDrive === 'function') {
    try {
      drive = deps.recordDrive({
        account: trip.driver, miles: trip.fare.miles,
        seconds: Math.max(1, Math.round(trip.fare.minutes * 60)), source: 'ride',
      });
    } catch (e) { drive = { ok: false, reason: String((e && e.message) || e).slice(0, 140) }; }
  }
  return { ok: true, trip: publicTrip(trip), paidTrxId: id, drive };
}

/** Either party cancels. A trip already awaiting payment or completed cannot be cancelled. */
export function cancelTrip({ tripId, account, reason } = {}, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const { fs, file, now } = ctx(opts);
  const store = load(fs, file);
  const trip = getTrip(store, tripId);
  if (!trip) return { ok: false, reason: 'no such trip' };
  if (who !== trip.rider && who !== trip.driver) return { ok: false, reason: 'only the rider or the assigned driver can cancel' };
  if (['awaiting_payment', 'completed'].includes(trip.status)) return { ok: false, reason: `trip is ${trip.status} — it cannot be cancelled`, trip: publicTrip(trip) };
  trip.status = 'cancelled'; trip.cancelledBy = who; trip.cancelReason = String(reason || '').slice(0, 140); trip.updatedAt = now;
  save(fs, file, store);
  return { ok: true, trip: publicTrip(trip) };
}

/** A trip as either party may see it. */
export function tripById(tripId, opts = {}) {
  const { fs, file } = ctx(opts);
  const trip = getTrip(load(fs, file), tripId);
  return trip ? { ok: true, trip: publicTrip(trip), payment: trip.payment || null } : { ok: false, reason: 'no such trip' };
}

/** Open requests a driver may accept, nearest pickup first. */
export function openRequests({ lat, lng } = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  const here = validCoord(lat, lng);
  return Object.values(store.trips)
    .filter((t) => t.status === 'requested')
    .map((t) => ({
      ...publicTrip(t),
      pickupMiles: here ? round(haversineMiles(lat, lng, t.pickup.lat, t.pickup.lng), 2) : null,
    }))
    .filter((t) => !here || t.pickupMiles <= RIDE_MATCH_RADIUS_MI())
    .sort((a, b) => (a.pickupMiles ?? 0) - (b.pickupMiles ?? 0));
}

/** A driver's own trips + totals. */
export function driverDashboard(account, opts = {}) {
  const who = String(account || '').trim().toLowerCase();
  const { fs, file } = ctx(opts);
  const store = load(fs, file);
  const d = store.drivers[who];
  const mine = Object.values(store.trips).filter((t) => t.driver === who).sort((a, b) => b.updatedAt - a.updatedAt);
  const earned = mine.filter((t) => t.status === 'completed').reduce((s, t) => s + Number((t.fare || {}).driverShare || 0), 0);
  return {
    ok: true, account: who, driver: d ? publicDriver(d) : null,
    active: mine.filter((t) => !['completed', 'cancelled'].includes(t.status)).map(publicTrip),
    recent: mine.slice(0, 20).map(publicTrip),
    totals: { trips: mine.filter((t) => t.status === 'completed').length, earnedMelek: round(earned, 3), milesDriven: round(d ? d.milesDriven : 0, 1) },
    fares: { gas: gasEquivalent({ melek: earned, melekUsd: opts.melekUsd }) },
  };
}

// a trip, minus anything a counterparty should not have (exact driver position, raw internals)
function publicTrip(t) {
  return {
    id: t.id, status: t.status, rider: t.rider, driver: t.driver,
    pickup: t.pickup, dropoff: t.dropoff, note: t.note,
    estimate: t.estimate, fare: t.fare || null,
    createdAt: t.createdAt, updatedAt: t.updatedAt,
    paidTrxId: (t.payment && t.payment.confirmedTrxId) || null,
  };
}

const round = (n, p) => { const f = 10 ** p; return Math.round(Number(n) * f) / f; };

/** The rate card + fee, for a /rates endpoint and the report. */
export function rideSummary() {
  return {
    app: 'MELEK Ride',
    rateCard: { base: RIDE_BASE(), perMile: RIDE_PER_MILE(), perMinute: RIDE_PER_MINUTE(), minimum: RIDE_MINIMUM(), symbol: env('MELEK_SYMBOL', env('WELCOME_SYMBOL', 'MELEK')) },
    platformFeePct: RIDE_FEE_PCT(), platformFeeAccount: RIDE_FEE_ACCOUNT(),
    matchRadiusMi: RIDE_MATCH_RADIUS_MI(), driverStaleSec: RIDE_DRIVER_STALE_SEC(),
    custody: 'Fares are signed by the rider on MELEK-Signer as one transaction with two transfers (driver + platform fee). MELEK Ride holds no keys and no escrow.',
    driveLane: 'A completed trip is recorded as a VERIFIED drive sample, so the driver also earns MELEK Drive weight for those miles.',
    onboarding: {
      rider: 'A MELEK account. That is all — no application, no documents.',
      driver: 'An application: make, model, year, colour, plate, licence and insurance, reviewed before the driver is ever shown to a rider.',
      autoApprove: RIDE_AUTO_APPROVE(),
    },
    // The fare rail today is MELEK, signed by the rider. A card rail (rider pays USD, driver is paid out)
    // is a second rail that needs a processor, a merchant account and KYC on the payout side; it is NOT
    // wired here, and this field says so rather than implying a card works.
    paymentRails: { melek: 'live — rider-signed transfer', usdCard: 'not wired — needs a processor + payout account; see MOVE_HARDFORK.md' },
  };
}

if (process.argv[1] && process.argv[1].endsWith('ride-core.mjs')) {
  console.log(JSON.stringify(rideSummary(), null, 2));
  const q = quoteFare({ miles: 7.4, minutes: 18 });
  console.log(`\nexample fare 7.4 mi / 18 min: ${q.total} ${q.symbol} → driver ${q.driverShare}, platform ${q.platformFee}`);
}
