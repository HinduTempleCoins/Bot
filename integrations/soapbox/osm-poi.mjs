// osm-poi.mjs — the SoapBox "places near here" reader. A keyless reader over OpenStreetMap that powers
// "find places near here" public pages: pharmacies, hospitals, ATMs, fuel, EV chargers, libraries, and
// so on. Two free, keyless OSM services back it:
//   • Nominatim   — geocoding (place name → lat/lon/bounding box).        https://nominatim.openstreetmap.org
//   • Overpass API — query OSM features (amenities/POIs) around a point.  https://overpass-api.de
//
// This is DISTINCT from the maps base module (maps.mjs, queue #142), which owns the geocode/route/places
// provider chain and map tiles. This module does ONE focused job — amenity/POI discovery around a point —
// directly against OSM. Both share OSM as a source; this one talks Overpass, the base one does not.
//
// Pattern follows maps.mjs + cdc-health.mjs: ESM, an injectable __setFetch() seam, every reader SOFT-FAILS
// (returns null / [] — never throws), an as-of timestamp, a guarded CLI, HTML-escaped rendering, and NO
// secrets. Nominatim + Overpass are KEYLESS but their usage policies REQUIRE a descriptive User-Agent and
// polite, low-volume use — we send a real UA on every request and document the rate-limit expectation.
//
//   import { geocode, nearby, findNear, AMENITIES, renderPage, dataNote } from './osm-poi.mjs'
//   node integrations/soapbox/osm-poi.mjs pharmacy "Portland, Oregon"

// Endpoints are keyless. Overridable by env to point at a self-hosted instance (no secret involved).
const NOMINATIM = () => process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const OVERPASS = () => process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

// OSM usage policies REQUIRE a descriptive, contactable User-Agent. Keyless ≠ anonymous: identify the app.
const UA = 'SoapBoxData/1.0 (+https://data.soapbox.community)';

// OSM is community data licensed ODbL — attribution is required wherever it's shown.
const SOURCE = 'OpenStreetMap contributors (ODbL)';

// Politeness: Nominatim asks for <=1 req/s and Overpass for low-volume, cached use. Callers should cache
// results and throttle; this constant documents the floor so a scheduler can space requests accordingly.
export const MIN_REQUEST_INTERVAL_MS = 1000;

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation (strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Curated amenity types people actually search for near them. Each is a real OSM `amenity=*` value
// (the EV charger is `amenity=charging_station`). Labels are human-facing; the key is the OSM tag value.
export const AMENITIES = [
  { type: 'pharmacy', label: 'Pharmacies' },
  { type: 'hospital', label: 'Hospitals' },
  { type: 'clinic', label: 'Clinics' },
  { type: 'doctors', label: "Doctors' offices" },
  { type: 'dentist', label: 'Dentists' },
  { type: 'atm', label: 'ATMs' },
  { type: 'bank', label: 'Banks' },
  { type: 'fuel', label: 'Gas stations' },
  { type: 'charging_station', label: 'EV charging stations' },
  { type: 'library', label: 'Libraries' },
  { type: 'school', label: 'Schools' },
  { type: 'police', label: 'Police stations' },
  { type: 'fire_station', label: 'Fire stations' },
  { type: 'post_office', label: 'Post offices' },
  { type: 'drinking_water', label: 'Drinking water' },
  { type: 'toilets', label: 'Public toilets' },
  { type: 'cafe', label: 'Cafes' },
  { type: 'restaurant', label: 'Restaurants' },
  { type: 'place_of_worship', label: 'Places of worship' },
  { type: 'parking', label: 'Parking' },
];

const KNOWN_AMENITY = new Set(AMENITIES.map((a) => a.type));
const labelFor = (type) => (AMENITIES.find((a) => a.type === type)?.label || type);

async function getJSON(url, opts = {}) {
  try {
    const r = await _fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── geocode: place name → coordinates + bounding box (Nominatim) ───────────────────────────────────────
/** Geocode a free-text place via Nominatim. → { lat, lon, displayName, boundingbox } or null (soft-fail). */
export async function geocode(place) {
  const q = str(place);
  if (!q) return null;
  const url = `${NOMINATIM()}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const j = await getJSON(url);
  const r = Array.isArray(j) ? j[0] : null;
  if (!r) return null;
  const lat = num(r.lat); const lon = num(r.lon);
  if (lat == null || lon == null) return null;
  // Nominatim boundingbox is [southLat, northLat, westLon, eastLon] as strings; normalize to numbers.
  const bb = Array.isArray(r.boundingbox) ? r.boundingbox.map(num) : null;
  return { lat, lon, displayName: str(r.display_name), boundingbox: bb };
}

// ── nearby: amenity type around a point (Overpass) ─────────────────────────────────────────────────────
// Build an Overpass QL query for nodes/ways/relations tagged amenity=<type> within radiusM of (lat,lon).
// `out center` gives ways/relations a representative point so everything normalizes to one lat/lon shape.
function overpassQuery({ lat, lon, amenity, radiusM }) {
  const around = `(around:${radiusM},${lat},${lon})`;
  return `[out:json][timeout:25];(node["amenity"="${amenity}"]${around};way["amenity"="${amenity}"]${around};relation["amenity"="${amenity}"]${around};);out center 50;`;
}

// Pull a representative lat/lon from an Overpass element (node has lat/lon directly; way/relation use center).
function elementPoint(el) {
  if (num(el.lat) != null && num(el.lon) != null) return { lat: num(el.lat), lon: num(el.lon) };
  if (el.center && num(el.center.lat) != null && num(el.center.lon) != null) return { lat: num(el.center.lat), lon: num(el.center.lon) };
  return { lat: null, lon: null };
}

/**
 * Find amenities of one type near a point via Overpass.
 * @param {{lat:number,lon:number,amenity:string,radiusM?:number}} q
 * @returns normalized [{ name, type, lat, lon, tags }] (soft-fails to []).
 */
export async function nearby({ lat, lon, amenity, radiusM = 2000 } = {}) {
  const la = num(lat); const lo = num(lon); const am = str(amenity);
  if (la == null || lo == null || !am) return [];
  const radius = Math.max(1, Math.min(50000, num(radiusM) || 2000));
  const body = overpassQuery({ lat: la, lon: lo, amenity: am, radiusM: radius });
  const j = await getJSON(OVERPASS(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(body)}`,
  });
  const els = Array.isArray(j?.elements) ? j.elements : [];
  return els.map((el) => {
    const tags = (el.tags && typeof el.tags === 'object') ? el.tags : {};
    const { lat: plat, lon: plon } = elementPoint(el);
    return { name: str(tags.name) || labelFor(am), type: str(tags.amenity) || am, lat: plat, lon: plon, tags };
  }).filter((p) => p.lat != null && p.lon != null);
}

// ── findNear: convenience — geocode a place, then search an amenity around it ───────────────────────────
/**
 * Convenience: geocode `place`, then find `amenity` nearby.
 * @returns { place, amenity, results } — results is the nearby() array (soft-fails: results [] / place null).
 */
export async function findNear(place, amenity, { radiusM = 2000 } = {}) {
  const g = await geocode(place);
  if (!g) return { place: null, amenity: str(amenity), results: [] };
  const results = await nearby({ lat: g.lat, lon: g.lon, amenity, radiusM });
  return { place: g, amenity: str(amenity), results };
}

// ── distance helper (haversine, meters) — used by the page to show how far each POI is ──────────────────
function distanceM(aLat, aLon, bLat, bLon) {
  if ([aLat, aLon, bLat, bLon].some((v) => num(v) == null)) return null;
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

const fmtDist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

// ── renderPage: escaped HTML POI list ──────────────────────────────────────────────────────────────────
/**
 * Render a "places near here" page. `data` is a findNear()-shaped object ({ place, amenity, results }).
 * Everything user/OSM-derived is HTML-escaped. Distances computed from the geocoded place when available.
 */
export function renderPage(data = {}) {
  const place = data.place || null;
  const amenity = str(data.amenity);
  const results = Array.isArray(data.results) ? data.results : [];
  const title = `${esc(labelFor(amenity))} near ${esc(place?.displayName || 'you')}`;
  const rows = results.map((p) => {
    const d = place ? distanceM(place.lat, place.lon, p.lat, p.lon) : null;
    return `<li class="poi"><span class="poi-name">${esc(p.name)}</span>`
      + `<span class="poi-type">${esc(p.type)}</span>`
      + (d != null ? `<span class="poi-dist">${esc(fmtDist(d))}</span>` : '')
      + `</li>`;
  }).join('');
  const list = rows ? `<ul class="poi-list">${rows}</ul>` : '<p class="empty">No places found nearby.</p>';
  return `<section class="osm-poi"><h1>${title}</h1>${list}<footer class="data-note">${esc(dataNote())}</footer></section>`;
}

// ── dataNote: provenance / attribution (ODbL) ──────────────────────────────────────────────────────────
/** Provenance string. Names OpenStreetMap + the ODbL license and the as-of date. */
export function dataNote() {
  return `source: ${SOURCE}, as of ${new Date().toISOString().slice(0, 10)}`;
}

// ── guarded CLI ────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('osm-poi.mjs')) {
  const amenity = process.argv[2] || 'pharmacy';
  const place = process.argv.slice(3).join(' ') || 'Portland, Oregon';
  if (!KNOWN_AMENITY.has(amenity)) console.error(`(note: "${amenity}" isn't in AMENITIES — querying OSM anyway)`);
  const data = await findNear(place, amenity);
  if (!data.place) { console.log(`could not geocode: ${place}`); }
  else {
    console.log(`${labelFor(amenity)} near ${data.place.displayName} (${data.results.length} found):`);
    for (const p of data.results.slice(0, 20)) {
      const d = distanceM(data.place.lat, data.place.lon, p.lat, p.lon);
      console.log(`  ${p.name}  [${p.type}]  ${fmtDist(d)}`);
    }
  }
  console.log(dataNote());
}
