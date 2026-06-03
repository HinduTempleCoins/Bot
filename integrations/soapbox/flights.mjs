// flights.mjs — travel layer for SoapBox (queue #146): flights, ground transport, and live
// status. Every provider is keyed by an env var and SOFT-FAILS (missing key or a bad response
// returns [] / null, never throws) so the site renders with whatever is configured.
//
//   Booking (flights):  Duffel (PRIMARY, DUFFEL_KEY) → Travelpayouts/Kiwi affiliate (FALLBACK)
//   Ground (rail/bus/ferry):  Distribusion (DISTRIBUSION_KEY)
//   Flight STATUS (not booking):  AeroDataBox (AERODATABOX_KEY) → Aviationstack (AVIATIONSTACK_KEY)
//   Vessel tracking:  AISStream (AISSTREAM_KEY)
//
// NOTE: Amadeus Self-Service is being retired (Jul 2026) — deliberately NOT used. Duffel is primary.
//
// Everything that goes out is normalized + provenance-tagged ({ ...row, source }) so the caller can
// always show where a number came from and degrade gracefully when a provider is dark.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const env = (k) => process.env[k] || '';

// ── pure helpers ──────────────────────────────────────────────────────────────

/** Lowest-price offer from a normalized list. Returns null on empty/all-unpriced input. */
export function cheapestOffer(offers) {
  if (!Array.isArray(offers)) return null;
  let best = null;
  for (const o of offers) {
    if (o?.price == null || o.price === '') continue;
    const p = Number(o.price);
    if (!Number.isFinite(p)) continue;
    if (best === null || p < Number(best.price)) best = o;
  }
  return best;
}

/** Minutes between two ISO timestamps, or null if either is missing/unparseable. */
export function durationMinutes(departISO, arriveISO) {
  const a = Date.parse(departISO), b = Date.parse(arriveISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 60000);
}

// ── normalizers (pure; exported for tests) ──────────────────────────────────────

/** Duffel offers payload → normalized flight offers. */
export function normalizeDuffel(json) {
  const offers = json?.data?.offers || json?.data || [];
  if (!Array.isArray(offers)) return [];
  return offers.map((o) => {
    const slice = o?.slices?.[0] || {};
    const seg0 = slice?.segments?.[0] || {};
    const segN = slice?.segments?.[slice?.segments?.length - 1] || seg0;
    const depart = seg0?.departing_at || null;
    const arrive = segN?.arriving_at || null;
    return {
      id: o?.id || null,
      from: seg0?.origin?.iata_code || null,
      to: segN?.destination?.iata_code || null,
      depart, arrive,
      durationMin: durationMinutes(depart, arrive),
      stops: Math.max(0, (slice?.segments?.length || 1) - 1),
      carrier: o?.owner?.name || seg0?.marketing_carrier?.name || null,
      price: o?.total_amount != null ? Number(o.total_amount) : null,
      currency: o?.total_currency || 'USD',
      source: 'duffel',
    };
  }).filter((o) => o.price != null);
}

/** Travelpayouts/Aviasales "cheap prices" payload → normalized flight offers (affiliate fallback). */
export function normalizeTravelpayouts(json, { from = null, to = null } = {}) {
  const data = json?.data || {};
  const out = [];
  // shape: { data: { [destIata]: { [n]: { price, airline, departure_at, return_at, ... } } } }
  for (const [dest, byNum] of Object.entries(data)) {
    const rows = byNum && typeof byNum === 'object' ? Object.values(byNum) : [];
    for (const r of rows) {
      out.push({
        id: r?.flight_number ? `${r.airline || ''}${r.flight_number}` : null,
        from: from || r?.origin || null,
        to: to || r?.destination || dest || null,
        depart: r?.departure_at || null,
        arrive: r?.return_at || null,
        durationMin: durationMinutes(r?.departure_at, r?.return_at),
        stops: r?.transfers != null ? Number(r.transfers) : null,
        carrier: r?.airline || null,
        price: r?.price != null ? Number(r.price) : null,
        currency: 'USD',
        source: 'travelpayouts',
      });
    }
  }
  return out.filter((o) => o.price != null);
}

/** Distribusion connections payload → normalized ground options. */
export function normalizeDistribusion(json) {
  const conns = json?.data?.connections || json?.connections || json?.data || [];
  if (!Array.isArray(conns)) return [];
  return conns.map((c) => {
    const depart = c?.departureTime || c?.departure_time || null;
    const arrive = c?.arrivalTime || c?.arrival_time || null;
    return {
      id: c?.id || null,
      mode: c?.mode || c?.vehicleType || 'ground',
      from: c?.departureStation?.name || c?.from || null,
      to: c?.arrivalStation?.name || c?.to || null,
      depart, arrive,
      durationMin: durationMinutes(depart, arrive),
      carrier: c?.marketingCarrier?.name || c?.carrier || null,
      price: c?.price?.amount != null ? Number(c.price.amount) : (c?.price != null ? Number(c.price) : null),
      currency: c?.price?.currency || 'EUR',
      source: 'distribusion',
    };
  });
}

/** AeroDataBox flight-status payload → normalized status row. */
export function normalizeAeroDataBox(json, flightNo) {
  const f = Array.isArray(json) ? json[0] : (json?.[0] || json);
  if (!f || typeof f !== 'object') return null;
  return {
    flightNo: f?.number || flightNo || null,
    status: f?.status || null,
    from: f?.departure?.airport?.iata || f?.departure?.airport?.icao || null,
    to: f?.arrival?.airport?.iata || f?.arrival?.airport?.icao || null,
    scheduledDeparture: f?.departure?.scheduledTime?.utc || f?.departure?.scheduledTimeUtc || null,
    scheduledArrival: f?.arrival?.scheduledTime?.utc || f?.arrival?.scheduledTimeUtc || null,
    carrier: f?.airline?.name || null,
    source: 'aerodatabox',
  };
}

/** Aviationstack flight-status payload → normalized status row (fallback). */
export function normalizeAviationstack(json, flightNo) {
  const f = json?.data?.[0];
  if (!f || typeof f !== 'object') return null;
  return {
    flightNo: f?.flight?.iata || f?.flight?.icao || flightNo || null,
    status: f?.flight_status || null,
    from: f?.departure?.iata || null,
    to: f?.arrival?.iata || null,
    scheduledDeparture: f?.departure?.scheduled || null,
    scheduledArrival: f?.arrival?.scheduled || null,
    carrier: f?.airline?.name || null,
    source: 'aviationstack',
  };
}

/** AISStream vessel payload → normalized position. */
export function normalizeVessel(json, mmsi) {
  const m = json?.MetaData || json?.metadata || {};
  const pos = json?.Message?.PositionReport || json?.PositionReport || json || {};
  const lat = pos?.Latitude ?? pos?.latitude ?? m?.latitude;
  const lon = pos?.Longitude ?? pos?.longitude ?? m?.longitude;
  if (lat == null || lon == null) return null;
  return {
    mmsi: m?.MMSI ?? mmsi ?? null,
    name: m?.ShipName?.trim?.() || m?.shipName || null,
    lat: Number(lat),
    lon: Number(lon),
    sog: pos?.Sog ?? pos?.sog ?? null,          // speed over ground (knots)
    cog: pos?.Cog ?? pos?.cog ?? null,          // course over ground (deg)
    timestamp: m?.time_utc || m?.timestamp || null,
    source: 'aisstream',
  };
}

// ── network calls (soft-fail) ───────────────────────────────────────────────────

async function duffelSearch({ from, to, date }) {
  const key = env('DUFFEL_KEY');
  if (!key) return [];
  try {
    const r = await _fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${key}`,
        'duffel-version': 'v2',
        'content-type': 'application/json',
        'accept': 'application/json',
        'user-agent': UA,
      },
      body: JSON.stringify({
        data: {
          slices: [{ origin: from, destination: to, departure_date: date }],
          passengers: [{ type: 'adult' }],
          cabin_class: 'economy',
        },
      }),
    });
    if (!r.ok) return [];
    return normalizeDuffel(await r.json());
  } catch { return []; }
}

async function travelpayoutsSearch({ from, to, date }) {
  const key = env('TRAVELPAYOUTS_KEY');
  if (!key) return [];
  try {
    const u = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
    u.searchParams.set('origin', from);
    u.searchParams.set('destination', to);
    if (date) u.searchParams.set('departure_at', date);
    u.searchParams.set('currency', 'usd');
    u.searchParams.set('token', key);
    const r = await _fetch(u, { headers: { 'user-agent': UA, 'accept': 'application/json' } });
    if (!r.ok) return [];
    return normalizeTravelpayouts(await r.json(), { from, to });
  } catch { return []; }
}

// ── public API ──────────────────────────────────────────────────────────────────

/** Search flight offers. Duffel primary; Travelpayouts/Kiwi affiliate fallback. Cached, soft-fail → []. */
export async function searchFlights({ from, to, date } = {}) {
  if (!from || !to) return [];
  return cached(`flights:${from}:${to}:${date || ''}`, TTL.list, async () => {
    let offers = await duffelSearch({ from, to, date });
    if (!offers.length) offers = await travelpayoutsSearch({ from, to, date });
    offers.sort((a, b) => Number(a.price) - Number(b.price));
    return offers;
  });
}

/** Live flight status by flight number. AeroDataBox primary; Aviationstack fallback. Soft-fail → null. */
export async function flightStatus(flightNo) {
  if (!flightNo) return null;
  return cached(`flightstatus:${flightNo}`, TTL.price, async () => {
    const adb = env('AERODATABOX_KEY');
    if (adb) {
      try {
        const r = await _fetch(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNo)}`, {
          headers: { 'x-rapidapi-key': adb, 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com', 'user-agent': UA, 'accept': 'application/json' },
        });
        if (r.ok) { const n = normalizeAeroDataBox(await r.json(), flightNo); if (n) return n; }
      } catch { /* fall through */ }
    }
    const avs = env('AVIATIONSTACK_KEY');
    if (avs) {
      try {
        const u = new URL('https://api.aviationstack.com/v1/flights');
        u.searchParams.set('access_key', avs);
        u.searchParams.set('flight_iata', flightNo);
        const r = await _fetch(u, { headers: { 'user-agent': UA, 'accept': 'application/json' } });
        if (r.ok) { const n = normalizeAviationstack(await r.json(), flightNo); if (n) return n; }
      } catch { /* fall through */ }
    }
    return null;
  });
}

/** Ground transport options (rail/bus/ferry) via Distribusion. Cached, soft-fail → []. */
export async function groundOptions({ from, to, date } = {}) {
  if (!from || !to) return [];
  return cached(`ground:${from}:${to}:${date || ''}`, TTL.list, async () => {
    const key = env('DISTRIBUSION_KEY');
    if (!key) return [];
    try {
      const u = new URL('https://api.distribusion.com/retailers/v4/connections');
      u.searchParams.set('departure_station', from);
      u.searchParams.set('arrival_station', to);
      if (date) u.searchParams.set('departure_date', date);
      const r = await _fetch(u, { headers: { 'authorization': `Bearer ${key}`, 'user-agent': UA, 'accept': 'application/json' } });
      if (!r.ok) return [];
      return normalizeDistribusion(await r.json());
    } catch { return []; }
  });
}

/** Live vessel position by MMSI via AISStream. Cached, soft-fail → null. */
export async function vesselPosition(mmsi) {
  if (!mmsi) return null;
  return cached(`vessel:${mmsi}`, TTL.price, async () => {
    const key = env('AISSTREAM_KEY');
    if (!key) return null;
    try {
      const r = await _fetch('https://api.aisstream.io/v0/vessel', {
        method: 'POST',
        headers: { 'authorization': key, 'content-type': 'application/json', 'user-agent': UA, 'accept': 'application/json' },
        body: JSON.stringify({ APIKey: key, MMSI: String(mmsi) }),
      });
      if (!r.ok) return null;
      return normalizeVessel(await r.json(), mmsi);
    } catch { return null; }
  });
}

if (process.argv[1] && process.argv[1].endsWith('flights.mjs')) {
  const offers = await searchFlights({ from: 'JFK', to: 'LHR', date: '2026-07-01' });
  console.log(`flight offers: ${offers.length}`);
  const best = cheapestOffer(offers);
  if (best) console.log(`cheapest: ${best.carrier} ${best.price} ${best.currency} [${best.source}]`);
  console.log('configured providers:', {
    duffel: !!env('DUFFEL_KEY'), travelpayouts: !!env('TRAVELPAYOUTS_KEY'),
    distribusion: !!env('DISTRIBUSION_KEY'), aerodatabox: !!env('AERODATABOX_KEY'),
    aviationstack: !!env('AVIATIONSTACK_KEY'), aisstream: !!env('AISSTREAM_KEY'),
  });
}
