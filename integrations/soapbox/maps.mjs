// maps.mjs — maps/geo base for SoapBox (queue #142). Four primitives — geocode, reverseGeocode, route,
// places — each tried across a provider chain with failover, normalized to ONE schema and tagged with the
// provider that answered (provenance). Order: Google Maps Platform → HERE → Mapbox (all keyed via
// process.env.*_KEY, soft-fail / skipped when no key) → self-host OSM (Nominatim geocode + OSRM route,
// keyless public instances) as the always-available floor. Nothing here throws: every function returns a
// normalized result on success, or null (point lookups) / [] (lists) when the whole chain comes up empty.
//
//   import { geocode, reverseGeocode, route, places } from './maps.mjs'
//   node integrations/soapbox/maps.mjs "Eiffel Tower"

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

// keys read lazily so tests can run without env and so a key added at runtime is picked up.
const KEY = {
  google: () => process.env.GOOGLE_MAPS_KEY || '',
  here: () => process.env.HERE_KEY || '',
  mapbox: () => process.env.MAPBOX_KEY || '',
};

// public keyless OSM endpoints (the self-host floor). Overridable by env for a real self-hosted instance.
const OSM = {
  nominatim: () => process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  osrm: () => process.env.OSRM_URL || 'https://router.project-osrm.org',
};

// travel mode → provider-specific token. Normalized input is one of: driving|walking|cycling.
const MODE = {
  google: { driving: 'driving', walking: 'walking', cycling: 'bicycling' },
  here: { driving: 'car', walking: 'pedestrian', cycling: 'bicycle' },
  mapbox: { driving: 'driving', walking: 'walking', cycling: 'cycling' },
  osrm: { driving: 'driving', walking: 'foot', cycling: 'bike' },
};
const normMode = (m) => (['driving', 'walking', 'cycling'].includes(m) ? m : 'driving');

async function getJSON(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number.isFinite(Number(v)) ? Number(v) : null));

// Normalized schemas:
//   place:    { name, lat, lon, address, provider }
//   route:    { distanceM, durationS, mode, from, to, provider }
// A function walks its provider chain in order; the first non-empty normalized answer wins and carries
// its provider tag. Each provider call is its own try/catch (via getJSON) so one failing never aborts.

// ── geocode: query string → best-match place ──────────────────────────────────────────────────────────
async function geocodeGoogle(q) {
  const key = KEY.google(); if (!key) return null;
  const j = await getJSON(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`);
  const r = j?.results?.[0]; const loc = r?.geometry?.location;
  if (!r || !loc) return null;
  return { name: r.formatted_address || q, lat: num(loc.lat), lon: num(loc.lng), address: r.formatted_address || '', provider: 'google' };
}
async function geocodeHere(q) {
  const key = KEY.here(); if (!key) return null;
  const j = await getJSON(`https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(q)}&apiKey=${key}`);
  const r = j?.items?.[0]; const p = r?.position;
  if (!r || !p) return null;
  return { name: r.title || q, lat: num(p.lat), lon: num(p.lng), address: r.address?.label || '', provider: 'here' };
}
async function geocodeMapbox(q) {
  const key = KEY.mapbox(); if (!key) return null;
  const j = await getJSON(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=1&access_token=${key}`);
  const r = j?.features?.[0]; const c = r?.center;
  if (!r || !Array.isArray(c)) return null;
  return { name: r.text || q, lat: num(c[1]), lon: num(c[0]), address: r.place_name || '', provider: 'mapbox' };
}
async function geocodeOSM(q) {
  const j = await getJSON(`${OSM.nominatim()}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
  const r = Array.isArray(j) ? j[0] : null;
  if (!r) return null;
  return { name: r.display_name?.split(',')[0] || q, lat: num(r.lat), lon: num(r.lon), address: r.display_name || '', provider: 'osm' };
}

export async function geocode(q) {
  if (!q) return null;
  for (const fn of [geocodeGoogle, geocodeHere, geocodeMapbox, geocodeOSM]) {
    const r = await fn(q).catch(() => null);
    if (r && r.lat != null && r.lon != null) return r;
  }
  return null;
}

// ── reverseGeocode: {lat,lon} → place ──────────────────────────────────────────────────────────────────
async function reverseGoogle({ lat, lon }) {
  const key = KEY.google(); if (!key) return null;
  const j = await getJSON(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${key}`);
  const r = j?.results?.[0];
  if (!r) return null;
  return { name: r.formatted_address || '', lat: num(lat), lon: num(lon), address: r.formatted_address || '', provider: 'google' };
}
async function reverseHere({ lat, lon }) {
  const key = KEY.here(); if (!key) return null;
  const j = await getJSON(`https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat},${lon}&apiKey=${key}`);
  const r = j?.items?.[0];
  if (!r) return null;
  return { name: r.title || '', lat: num(lat), lon: num(lon), address: r.address?.label || '', provider: 'here' };
}
async function reverseMapbox({ lat, lon }) {
  const key = KEY.mapbox(); if (!key) return null;
  const j = await getJSON(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?limit=1&access_token=${key}`);
  const r = j?.features?.[0];
  if (!r) return null;
  return { name: r.text || '', lat: num(lat), lon: num(lon), address: r.place_name || '', provider: 'mapbox' };
}
async function reverseOSM({ lat, lon }) {
  const j = await getJSON(`${OSM.nominatim()}/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
  if (!j || j.error) return null;
  return { name: j.display_name?.split(',')[0] || '', lat: num(lat), lon: num(lon), address: j.display_name || '', provider: 'osm' };
}

export async function reverseGeocode({ lat, lon } = {}) {
  if (num(lat) == null || num(lon) == null) return null;
  const at = { lat: num(lat), lon: num(lon) };
  for (const fn of [reverseGoogle, reverseHere, reverseMapbox, reverseOSM]) {
    const r = await fn(at).catch(() => null);
    if (r) return r;
  }
  return null;
}

// ── route: {from,to,mode} → distance/duration. from/to are {lat,lon} or query strings (geocoded first) ──
async function asPoint(x) {
  if (!x) return null;
  if (typeof x === 'object' && num(x.lat) != null && num(x.lon) != null) return { lat: num(x.lat), lon: num(x.lon) };
  if (typeof x === 'string') { const g = await geocode(x); return g ? { lat: g.lat, lon: g.lon } : null; }
  return null;
}

async function routeGoogle(a, b, mode) {
  const key = KEY.google(); if (!key) return null;
  const j = await getJSON(`https://maps.googleapis.com/maps/api/directions/json?origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&mode=${MODE.google[mode]}&key=${key}`);
  const leg = j?.routes?.[0]?.legs?.[0];
  if (!leg) return null;
  return { distanceM: num(leg.distance?.value), durationS: num(leg.duration?.value), provider: 'google' };
}
async function routeHere(a, b, mode) {
  const key = KEY.here(); if (!key) return null;
  const j = await getJSON(`https://router.hereapi.com/v8/routes?transportMode=${MODE.here[mode]}&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&return=summary&apiKey=${key}`);
  const s = j?.routes?.[0]?.sections?.[0]?.summary;
  if (!s) return null;
  return { distanceM: num(s.length), durationS: num(s.duration), provider: 'here' };
}
async function routeMapbox(a, b, mode) {
  const key = KEY.mapbox(); if (!key) return null;
  const prof = MODE.mapbox[mode];
  const j = await getJSON(`https://api.mapbox.com/directions/v5/mapbox/${prof}/${a.lon},${a.lat};${b.lon},${b.lat}?access_token=${key}`);
  const r = j?.routes?.[0];
  if (!r) return null;
  return { distanceM: num(r.distance), durationS: num(r.duration), provider: 'mapbox' };
}
async function routeOSM(a, b, mode) {
  const prof = MODE.osrm[mode];
  const j = await getJSON(`${OSM.osrm()}/route/v1/${prof}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
  const r = j?.routes?.[0];
  if (!r || j.code !== 'Ok') return null;
  return { distanceM: num(r.distance), durationS: num(r.duration), provider: 'osm' };
}

export async function route({ from, to, mode } = {}) {
  const m = normMode(mode);
  const [a, b] = await Promise.all([asPoint(from), asPoint(to)]);
  if (!a || !b) return null;
  for (const fn of [routeGoogle, routeHere, routeMapbox, routeOSM]) {
    const r = await fn(a, b, m).catch(() => null);
    if (r && r.distanceM != null) return { ...r, mode: m, from: a, to: b };
  }
  return null;
}

// ── places: {q,near} → list of matching places (POI / business search) ──────────────────────────────────
async function placesGoogle(q, near) {
  const key = KEY.google(); if (!key) return null;
  const loc = near ? `&location=${near.lat},${near.lon}&radius=5000` : '';
  const j = await getJSON(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}${loc}&key=${key}`);
  const rows = j?.results;
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.map((r) => ({ name: r.name || '', lat: num(r.geometry?.location?.lat), lon: num(r.geometry?.location?.lng), address: r.formatted_address || '', provider: 'google' }));
}
async function placesHere(q, near) {
  const key = KEY.here(); if (!key) return null;
  if (!near) return null; // HERE discover requires an anchor point
  const j = await getJSON(`https://discover.search.hereapi.com/v1/discover?q=${encodeURIComponent(q)}&at=${near.lat},${near.lon}&apiKey=${key}`);
  const rows = j?.items;
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.map((r) => ({ name: r.title || '', lat: num(r.position?.lat), lon: num(r.position?.lng), address: r.address?.label || '', provider: 'here' }));
}
async function placesMapbox(q, near) {
  const key = KEY.mapbox(); if (!key) return null;
  const prox = near ? `&proximity=${near.lon},${near.lat}` : '';
  const j = await getJSON(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?limit=10${prox}&access_token=${key}`);
  const rows = j?.features;
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.map((r) => ({ name: r.text || '', lat: num(r.center?.[1]), lon: num(r.center?.[0]), address: r.place_name || '', provider: 'mapbox' }));
}
async function placesOSM(q, near) {
  const around = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
  const j = await getJSON(`${OSM.nominatim()}/search?format=jsonv2&limit=10&q=${encodeURIComponent(q)}${around}`);
  if (!Array.isArray(j) || !j.length) return null;
  return j.map((r) => ({ name: r.display_name?.split(',')[0] || '', lat: num(r.lat), lon: num(r.lon), address: r.display_name || '', provider: 'osm' }));
}

export async function places({ q, near } = {}) {
  if (!q) return [];
  let anchor = null;
  if (near) anchor = (typeof near === 'object' && num(near.lat) != null) ? { lat: num(near.lat), lon: num(near.lon) } : await asPoint(near);
  for (const fn of [placesGoogle, placesHere, placesMapbox, placesOSM]) {
    const r = await fn(q, anchor).catch(() => null);
    if (Array.isArray(r) && r.length) return r.filter((p) => p.lat != null && p.lon != null);
  }
  return [];
}

if (process.argv[1] && process.argv[1].endsWith('maps.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'Eiffel Tower, Paris';
  const g = await geocode(q);
  console.log('geocode:', g);
  if (g) {
    console.log('reverse:', await reverseGeocode({ lat: g.lat, lon: g.lon }));
    console.log('places :', (await places({ q: 'coffee', near: g })).slice(0, 3));
  }
  console.log('route  :', await route({ from: 'Paris', to: 'Lyon', mode: 'driving' }));
}
