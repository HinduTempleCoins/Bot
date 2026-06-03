// routing.mjs — multimodal "plan a trip" routing for SoapBox (queue #143). Given {from, to},
// return how to get there across modes (fly/train/bus/car/ferry/walk) with duration and (when
// available) price. This is the ROUTING layer only — it answers "what are my options and how long" —
// and is deliberately kept SEPARATE from booking (no deep-links, no carts, no PNRs here).
//
// Source order (each soft-fails to the next; a dead provider never throws to the caller):
//   1. Rome2Rio (commercial, ROME2RIO_KEY) — the one source that already spans every mode + price.
//   2. Open fallbacks — OpenTripPlanner / Navitia / Transitland (config URLs). Transit-leaning,
//      keyless/community, fill in when there's no Rome2Rio key or it's down.
// Every result is provenance-tagged source: 'rome2rio'|'otp'|'navitia'|'transitland' and a live flag
// (true = fetched this call, false = served from the TTL cache). rankItineraries() is a PURE sorter
// over already-normalized options so callers (and tests) can rank without any network at all.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Open fallback endpoints. Operators point these at their own (or a public) instance via env; absent
// env, no fallback is attempted (we don't guess at a third-party's URL). All soft-fail.
export const FALLBACK = {
  otp: process.env.OTP_URL || '',           // OpenTripPlanner GraphQL/REST base
  navitia: process.env.NAVITIA_URL || '',   // Navitia base (also needs NAVITIA_TOKEN)
  transitland: process.env.TRANSITLAND_URL || '', // Transitland v2 base
};

// Rome2Rio mode strings → our normalized mode vocabulary.
const R2R_MODE = {
  fly: 'fly', plane: 'fly', flight: 'fly',
  train: 'train', rail: 'train',
  bus: 'bus', coach: 'bus',
  car: 'car', drive: 'car', rideshare: 'car', taxi: 'car',
  ferry: 'ferry', boat: 'ferry',
  walk: 'walk', foot: 'walk',
  bike: 'bike', bicycle: 'bike',
  shuttle: 'bus', tram: 'train', subway: 'train', metro: 'train',
};
function normMode(m) {
  if (!m) return 'other';
  return R2R_MODE[String(m).toLowerCase()] || 'other';
}

// minutes from a variety of shapes (Rome2Rio uses hours on segments; OTP/Transitland use seconds).
function minsFromHours(h) { return h == null ? null : Math.round(Number(h) * 60); }
function minsFromSeconds(s) { return s == null ? null : Math.round(Number(s) / 60); }

/**
 * Normalize a Rome2Rio /search response into our shape:
 *   { legs: [{ mode, operator, duration(min), price?{amount,currency} }], totalDuration(min) }
 * Rome2Rio returns "routes" (one per option); we take the first/best route's segments as legs.
 * Best-effort: missing fields are dropped, never thrown on.
 */
export function normalizeRome2Rio(json) {
  const route = json?.routes?.[0];
  if (!route) return null;
  const segs = Array.isArray(route.segments) ? route.segments : [];
  const legs = segs.map((s) => {
    const leg = {
      mode: normMode(s.kind || s.transit?.kind || s.vehicle),
      operator: s.agency?.name || s.name || s.transit?.lineName || null,
      duration: minsFromHours(s.hours ?? s.duration),
    };
    const price = pricePart(s.indicativePrices || route.indicativePrices);
    if (price) leg.price = price;
    return leg;
  });
  const totalDuration = route.totalDuration != null
    ? minsFromHours(route.totalDuration)
    : sumDurations(legs);
  const out = { legs, totalDuration };
  const rp = pricePart(route.indicativePrices);
  if (rp) out.price = rp;
  return out;
}

// pull a {amount,currency} from a Rome2Rio indicativePrices array (lowest priced entry).
function pricePart(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let best = null;
  for (const p of arr) {
    const amount = p.price ?? p.low ?? p.average;
    if (amount == null) continue;
    if (best == null || Number(amount) < best.amount) best = { amount: Number(amount), currency: p.currency || 'USD' };
  }
  return best;
}

function sumDurations(legs) {
  let t = 0, any = false;
  for (const l of legs) if (l.duration != null) { t += l.duration; any = true; }
  return any ? t : null;
}

/**
 * Normalize an OpenTripPlanner plan (REST /otp/routers/default/plan style) into our shape.
 * OTP itineraries have `legs[]` with mode + durations in seconds and agencyName.
 */
export function normalizeOTP(json) {
  const it = json?.plan?.itineraries?.[0];
  if (!it) return null;
  const legs = (it.legs || []).map((l) => ({
    mode: normMode(l.mode),
    operator: l.agencyName || l.route || null,
    duration: minsFromSeconds(l.duration),
  }));
  return { legs, totalDuration: it.duration != null ? minsFromSeconds(it.duration) : sumDurations(legs) };
}

/**
 * Normalize a Transitland v2 routing response (best-effort; transit-leaning).
 * Falls back to the same itinerary/legs shape used elsewhere.
 */
export function normalizeTransitland(json) {
  const it = json?.itineraries?.[0] || json?.plan?.itineraries?.[0];
  if (!it) return null;
  const legs = (it.legs || []).map((l) => ({
    mode: normMode(l.mode || l.travel_mode),
    operator: l.operator?.name || l.agency_name || l.route || null,
    duration: l.duration_seconds != null ? minsFromSeconds(l.duration_seconds) : minsFromSeconds(l.duration),
  }));
  return { legs, totalDuration: it.duration != null ? minsFromSeconds(it.duration) : sumDurations(legs) };
}

/**
 * PURE itinerary ranker. Given an array of normalized options, return a new array sorted best-first.
 * Default ordering: shortest total duration, then cheapest price, then fewest transfers (leg count).
 * No network, no mutation of the input. Options missing a field sort last for that field.
 */
export function rankItineraries(options, { by = ['duration', 'price', 'transfers'] } = {}) {
  if (!Array.isArray(options)) return [];
  const big = Number.POSITIVE_INFINITY;
  const transfers = (o) => (Array.isArray(o?.legs) ? Math.max(0, o.legs.length - 1) : big);
  const duration = (o) => (o?.totalDuration != null ? Number(o.totalDuration) : big);
  const price = (o) => {
    const p = o?.price?.amount ?? lowestLegPrice(o);
    return p == null ? big : Number(p);
  };
  const keyFns = { duration, price, transfers };
  return [...options].sort((a, b) => {
    for (const k of by) {
      const fn = keyFns[k];
      if (!fn) continue;
      const d = fn(a) - fn(b);
      if (d !== 0) return d;
    }
    return 0;
  });
}

function lowestLegPrice(o) {
  if (!Array.isArray(o?.legs)) return null;
  let best = null;
  for (const l of o.legs) {
    const a = l?.price?.amount;
    if (a == null) continue;
    if (best == null || Number(a) < best) best = Number(a);
  }
  return best;
}

// tag a normalized itinerary with where it came from and whether it's live this call.
function tag(itinerary, source, live) {
  if (!itinerary) return null;
  return { ...itinerary, source, live, provenance: live ? 'LIVE' : 'cached' };
}

async function fromRome2Rio(from, to) {
  const key = process.env.ROME2RIO_KEY;
  if (!key) return null;
  try {
    const url = `https://free.rome2rio.com/api/1.4/json/Search?key=${encodeURIComponent(key)}`
      + `&oName=${encodeURIComponent(from)}&dName=${encodeURIComponent(to)}`;
    const r = await _fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    return normalizeRome2Rio(await r.json());
  } catch { return null; }
}

async function fromOTP(from, to) {
  if (!FALLBACK.otp) return null;
  try {
    const url = `${FALLBACK.otp.replace(/\/$/, '')}/plan`
      + `?fromPlace=${encodeURIComponent(from)}&toPlace=${encodeURIComponent(to)}`;
    const r = await _fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    return normalizeOTP(await r.json());
  } catch { return null; }
}

async function fromNavitia(from, to) {
  if (!FALLBACK.navitia) return null;
  try {
    const headers = { 'user-agent': UA };
    if (process.env.NAVITIA_TOKEN) headers.Authorization = process.env.NAVITIA_TOKEN;
    const url = `${FALLBACK.navitia.replace(/\/$/, '')}/journeys`
      + `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const r = await _fetch(url, { headers });
    if (!r.ok) return null;
    // Navitia "journeys" map cleanly onto the OTP-ish shape via the Transitland normalizer.
    return normalizeTransitland(await r.json());
  } catch { return null; }
}

async function fromTransitland(from, to) {
  if (!FALLBACK.transitland) return null;
  try {
    const url = `${FALLBACK.transitland.replace(/\/$/, '')}/plan`
      + `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const r = await _fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    return normalizeTransitland(await r.json());
  } catch { return null; }
}

/**
 * Plan a trip from → to. Tries Rome2Rio first, then the configured open fallbacks in order, returning
 * the first provider that yields a normalized itinerary. Result is provenance-tagged (source + live).
 * Cached 5 min; a cached hit comes back with provenance 'cached'/live:false. Returns null if every
 * provider soft-failed (the caller renders "no route found", never an exception).
 */
export async function planTrip({ from, to } = {}) {
  if (!from || !to) return null;
  const cacheKey = `routing:${String(from).toLowerCase()}->${String(to).toLowerCase()}`;
  const providers = [
    ['rome2rio', fromRome2Rio],
    ['otp', fromOTP],
    ['navitia', fromNavitia],
    ['transitland', fromTransitland],
  ];
  try {
    const fresh = await cached(cacheKey, TTL.ohlcv, async () => {
      for (const [source, fn] of providers) {
        const it = await fn(from, to);
        if (it && Array.isArray(it.legs) && it.legs.length) return tag(it, source, true);
      }
      throw new Error('no route');
    });
    // cached() may return a previously-stored (live:true) object on a later call → mark it cached.
    return fresh && fresh.live === false ? fresh : { ...fresh, live: false, provenance: 'cached' };
  } catch {
    return null;
  }
}

if (process.argv[1] && process.argv[1].endsWith('routing.mjs')) {
  const [from, to] = process.argv.slice(2);
  const trip = await planTrip({ from: from || 'Rome', to: to || 'Paris' });
  if (!trip) { console.log('no route found'); }
  else {
    console.log(`${from || 'Rome'} → ${to || 'Paris'}  [${trip.source} · ${trip.provenance}]  ~${trip.totalDuration ?? '?'} min`);
    for (const l of trip.legs) {
      console.log(`  ${l.mode.padEnd(6)} ${(l.operator || '').padEnd(20)} ${l.duration != null ? l.duration + ' min' : ''} ${l.price ? l.price.amount + ' ' + l.price.currency : ''}`);
    }
  }
}
