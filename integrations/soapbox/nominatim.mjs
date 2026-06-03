// nominatim.mjs — standalone OSM Nominatim geocoder for the SoapBox mapping spine (v3 §5).
//
// Two primitives over the keyless public Nominatim service (nominatim.openstreetmap.org):
//   • geocode(query)        — free-text place / address → { lat, lon, displayName, boundingbox, ... }
//   • reverseGeocode({…})   — lat/lon → nearest address ({ displayName, address:{...}, lat, lon })
//
// This is the dedicated geocode/reverse reader for the spine. It is DISTINCT from:
//   • osm-poi.mjs — which does amenity/POI discovery and has only a forward geocode() helper (no reverse).
//   • maps.mjs    — the multi-provider geocode chain (Google→HERE→Mapbox→OSM); Nominatim is its OSM floor.
// Here we talk ONLY to Nominatim, expose reverse geocoding, and tag every record with ODbL provenance so a
// record carries its license wherever it travels.
//
// Nominatim is a HOST source (open data, ODbL — see posture.mjs) so its results MAY be stored, BUT the
// service's USAGE POLICY (https://operations.osmfoundation.org/policies/nominatim/) is strict and
// non-negotiable for the public instance:
//   • a valid, identifying User-Agent on every request (set below),
//   • an ABSOLUTE MAXIMUM of 1 request per second (MIN_REQUEST_INTERVAL_MS / rps note in the header),
//   • no heavy/bulk use against the public endpoint — self-host (NOMINATIM_URL) for volume.
// We do not throttle here (a scheduler/cache layer owns rate), but we document the floor and send the UA.
//
// Pattern: ESM, zero deps, keyless, __setFetch seam, soft-fail (null), provenance with license+attribution,
// escaped render, guarded CLI, offline fixture tests.
//
//   import { geocode, reverseGeocode, provenance, dataNote, __setFetch } from './nominatim.mjs'
//   node integrations/soapbox/nominatim.mjs "Eiffel Tower"
//   node integrations/soapbox/nominatim.mjs --reverse 48.8584 2.2945

// Keyless; overridable by env to point at a self-hosted instance (no secret involved).
const NOMINATIM = () => process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';

// Usage policy REQUIRES a descriptive, contactable User-Agent. Keyless ≠ anonymous.
const UA = 'SoapBoxData/1.0 (+https://data.soapbox.community)';

// OSM data is ODbL — attribution required wherever a record is displayed or stored.
export const LICENSE = 'ODbL';
export const ATTRIBUTION = '© OpenStreetMap contributors';
const SOURCE = 'Nominatim / OpenStreetMap';

// Usage policy: <= 1 request/second against the public instance. Documented for schedulers; not enforced here.
export const MAX_RPS = 1;
export const MIN_REQUEST_INTERVAL_MS = 1000;

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// 1-request-per-second usage policy is honored at the header level for the public instance.
const POLICY_HEADERS = { 'User-Agent': UA, 'Accept': 'application/json' };

async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: POLICY_HEADERS });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Provenance stamped onto every record so the license travels with the data. */
export function provenance() {
  return { source: SOURCE, license: LICENSE, attribution: ATTRIBUTION, asOf: new Date().toISOString().slice(0, 10) };
}

// Normalize a Nominatim result object → a clean record with numeric coords + a normalized bbox.
function normalizeHit(r) {
  if (!r) return null;
  const lat = num(r.lat); const lon = num(r.lon);
  if (lat == null || lon == null) return null;
  // boundingbox is [southLat, northLat, westLon, eastLon] as strings; normalize to numbers (or null).
  const bb = Array.isArray(r.boundingbox) && r.boundingbox.length === 4 ? r.boundingbox.map(num) : null;
  return {
    lat,
    lon,
    displayName: str(r.display_name),
    type: str(r.type) || null,
    osmType: str(r.osm_type) || null,
    osmId: r.osm_id != null ? str(r.osm_id) : null,
    boundingbox: bb,
    address: (r.address && typeof r.address === 'object') ? r.address : null,
    provenance: provenance(),
  };
}

/**
 * Forward geocode free text → best match record (soft-fails to null).
 * @param {string} query  place name / address
 * @param {{limit?:number}} [opts]
 */
export async function geocode(query, { limit = 1 } = {}) {
  const q = str(query);
  if (!q) return null;
  const lim = Math.max(1, Math.min(10, num(limit) || 1));
  const url = `${NOMINATIM()}/search?format=jsonv2&addressdetails=1&limit=${lim}&q=${encodeURIComponent(q)}`;
  const j = await getJSON(url);
  const r = Array.isArray(j) ? j[0] : null;
  return normalizeHit(r);
}

/**
 * Reverse geocode lat/lon → nearest address record (soft-fails to null).
 * @param {{lat:number, lon:number, zoom?:number}} opts  zoom 0(country)…18(building); default 18.
 */
export async function reverseGeocode({ lat, lon, zoom = 18 } = {}) {
  const la = num(lat); const lo = num(lon);
  if (la == null || lo == null) return null;
  const z = Math.max(0, Math.min(18, num(zoom) == null ? 18 : num(zoom)));
  const url = `${NOMINATIM()}/reverse?format=jsonv2&addressdetails=1&zoom=${z}`
    + `&lat=${encodeURIComponent(la)}&lon=${encodeURIComponent(lo)}`;
  const j = await getJSON(url);
  // /reverse returns a single object (not an array); an error payload has { error }.
  if (!j || typeof j !== 'object' || j.error) return null;
  return normalizeHit(j);
}

// ── render ───────────────────────────────────────────────────────────────────────────────────────────
/** Escaped HTML for one geocode/reverse record. Soft-handles null → a "not found" note. */
export function renderRecord(rec) {
  if (!rec) return `<section class="nominatim"><p class="empty">No match found.</p></section>`;
  return `<section class="nominatim">`
    + `<h2>${esc(rec.displayName || 'Unknown place')}</h2>`
    + `<p class="coords">${esc(rec.lat)}, ${esc(rec.lon)}${rec.type ? ` · ${esc(rec.type)}` : ''}</p>`
    + `<footer class="data-note">${esc(dataNote())}</footer></section>`;
}

/** Provenance string naming Nominatim/OSM + the ODbL license + attribution + as-of date. */
export function dataNote() {
  const p = provenance();
  return `source: ${p.source}, license: ${p.license}, ${p.attribution}, as of ${p.asOf}`;
}

// ── guarded CLI ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('nominatim.mjs')) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--reverse') {
    const lat = argv[1]; const lon = argv[2];
    const rec = await reverseGeocode({ lat, lon });
    console.log(rec ? `${rec.displayName}\n  (${rec.lat}, ${rec.lon})` : `no address at ${lat}, ${lon}`);
  } else {
    const q = argv.join(' ') || 'Eiffel Tower';
    const rec = await geocode(q);
    console.log(rec ? `${rec.displayName}\n  (${rec.lat}, ${rec.lon})  [${rec.type || '?'}]` : `could not geocode: ${q}`);
  }
  console.log(dataNote());
}
