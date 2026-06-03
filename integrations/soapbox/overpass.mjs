// overpass.mjs — standalone OSM Overpass API reader for the SoapBox mapping spine (v3 §5).
//
// Queries OpenStreetMap features (POIs / amenities / shops / tourism / leisure) via the keyless public
// Overpass API (overpass-api.de). Two entry shapes the spine needs:
//   • queryBbox({ bbox, ... })  — features within a bounding box  [south, west, north, east]
//   • queryPlace(place, ...)    — geocode the place (via nominatim.mjs), then query its bounding box
// plus a low-level queryAround({ lat, lon, radiusM }) for point/radius.
//
// This is the BBOX/PLACE database reader, distinct from osm-poi.mjs (which is the point+radius "places near
// here" page over a single amenity). osm-poi answers "pharmacies within 2 km of me"; overpass.mjs answers
// "every cafe/shop/clinic in this bounding box / this town" — the corpus-population shape. Both hit
// Overpass; this one is bbox-first and tags EVERY record with ODbL provenance (license + attribution),
// because Overpass output is the database we KEEP (a HOST source — see posture.mjs).
//
// Pattern: ESM, zero deps, keyless, __setFetch seam, soft-fail ([] / null), per-record provenance, escaped
// render, guarded CLI, offline fixture tests. Reuses nominatim.mjs for place→bbox.
//
//   import { queryBbox, queryAround, queryPlace, FEATURE_KEYS, dataNote, __setFetch } from './overpass.mjs'
//   node integrations/soapbox/overpass.mjs cafe "Portland, Oregon"

import { geocode } from './nominatim.mjs';

// Keyless; overridable by env to point at a self-hosted instance (no secret involved).
const OVERPASS = () => process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

// Overpass asks for low-volume, cached use and a descriptive User-Agent. Keyless ≠ anonymous.
const UA = 'SoapBoxData/1.0 (+https://data.soapbox.community)';

// OSM data is ODbL — attribution required wherever a record is displayed or stored.
export const LICENSE = 'ODbL';
export const ATTRIBUTION = '© OpenStreetMap contributors';
const SOURCE = 'Overpass / OpenStreetMap';

// Politeness floor for schedulers (Overpass wants low-volume, cached use). Not enforced here.
export const MIN_REQUEST_INTERVAL_MS = 1000;

// The OSM top-level tag keys we treat as "a feature worth surfacing". A query may target any of these.
export const FEATURE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'healthcare', 'craft'];
const KNOWN_KEY = new Set(FEATURE_KEYS);

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Provenance stamped onto every record so the ODbL license travels with the data. */
export function provenance() {
  return { source: SOURCE, license: LICENSE, attribution: ATTRIBUTION, asOf: new Date().toISOString().slice(0, 10) };
}

async function postOverpass(ql) {
  try {
    const r = await _fetch(OVERPASS(), {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(ql)}`,
    });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Build a `key=value` (or any-`key`) tag selector. value omitted ⇒ match every feature with that key.
function tagSelector(key, value) {
  const k = str(key);
  if (!k) return '';
  return value ? `["${k}"="${str(value)}"]` : `["${k}"]`;
}

// node/way/relation triple for one selector + one spatial filter (around / bbox suffix).
function tripleFor(selector, spatial) {
  return `node${selector}${spatial};way${selector}${spatial};relation${selector}${spatial};`;
}

// Pull a representative lat/lon from an element (node has it directly; way/relation use `center`).
function elementPoint(el) {
  if (num(el.lat) != null && num(el.lon) != null) return { lat: num(el.lat), lon: num(el.lon) };
  if (el.center && num(el.center.lat) != null && num(el.center.lon) != null) {
    return { lat: num(el.center.lat), lon: num(el.center.lon) };
  }
  return { lat: null, lon: null };
}

// Normalize Overpass `elements` → clean records, each carrying ODbL provenance. Drops point-less elements.
function normalizeElements(json, { key, value } = {}) {
  const els = Array.isArray(json?.elements) ? json.elements : [];
  const prov = provenance(); // one timestamp for the batch
  const k = str(key);
  return els.map((el) => {
    const tags = (el.tags && typeof el.tags === 'object') ? el.tags : {};
    const { lat, lon } = elementPoint(el);
    const category = (k && str(tags[k])) || str(value) || (k ? str(tags[k]) : '') || null;
    return {
      id: el.id != null ? `${el.type || 'node'}/${el.id}` : null,
      name: str(tags.name) || null,
      key: k || null,
      category,
      lat,
      lon,
      tags,
      provenance: prov,
    };
  }).filter((p) => p.lat != null && p.lon != null);
}

/**
 * Query features around a point. Soft-fails to [].
 * @param {{lat:number, lon:number, key?:string, value?:string, radiusM?:number}} opts
 *   key defaults to 'amenity'; omit value to match every feature with that key.
 */
export async function queryAround({ lat, lon, key = 'amenity', value, radiusM = 2000 } = {}) {
  const la = num(lat); const lo = num(lon);
  if (la == null || lo == null) return [];
  const radius = Math.max(1, Math.min(50000, num(radiusM) || 2000));
  const sel = tagSelector(key, value);
  if (!sel) return [];
  const ql = `[out:json][timeout:25];(${tripleFor(sel, `(around:${radius},${la},${lo})`)});out center 200;`;
  const j = await postOverpass(ql);
  return normalizeElements(j, { key, value });
}

/**
 * Query features within a bounding box. Soft-fails to [].
 * @param {{bbox:number[], key?:string, value?:string}} opts
 *   bbox = [south, west, north, east] (Overpass bbox order). key defaults to 'amenity'.
 */
export async function queryBbox({ bbox, key = 'amenity', value } = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [];
  const b = bbox.map(num);
  if (b.some((v) => v == null)) return [];
  const [south, west, north, east] = b;
  const sel = tagSelector(key, value);
  if (!sel) return [];
  const ql = `[out:json][timeout:25][bbox:${south},${west},${north},${east}];`
    + `(${tripleFor(sel, '')});out center 500;`;
  const j = await postOverpass(ql);
  return normalizeElements(j, { key, value });
}

/**
 * Geocode a place name (via Nominatim), then query its bounding box.
 * @param {string} place
 * @param {{key?:string, value?:string}} [opts]
 * @returns { place, bbox, results } — results soft-fails to [], place null if geocode fails.
 */
export async function queryPlace(place, { key = 'amenity', value } = {}) {
  const g = await geocode(place);
  if (!g || !Array.isArray(g.boundingbox) || g.boundingbox.some((v) => v == null)) {
    return { place: g || null, bbox: null, results: [] };
  }
  // Nominatim bbox is [southLat, northLat, westLon, eastLon]; Overpass wants [south, west, north, east].
  const [sLat, nLat, wLon, eLon] = g.boundingbox;
  const bbox = [sLat, wLon, nLat, eLon];
  const results = await queryBbox({ bbox, key, value });
  return { place: g, bbox, results };
}

// ── render ───────────────────────────────────────────────────────────────────────────────────────────
/** Escaped HTML list of feature records. Soft-handles empty/missing. */
export function renderPage(data = {}) {
  const results = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);
  const where = !Array.isArray(data) && data.place ? esc(data.place.displayName || '') : '';
  const title = `OSM features${where ? ` in ${where}` : ''}`;
  const rows = results.map((r) => (
    `<li class="osm-feature"><span class="f-name">${esc(r.name || r.category || 'unnamed')}</span>`
    + (r.category ? `<span class="f-cat">${esc(r.category)}</span>` : '')
    + `</li>`
  )).join('');
  const list = rows ? `<ul class="osm-features">${rows}</ul>` : '<p class="empty">No features found.</p>';
  return `<section class="overpass"><h1>${esc(title)}</h1>${list}<footer class="data-note">${esc(dataNote())}</footer></section>`;
}

/** Provenance string naming Overpass/OSM + the ODbL license + attribution + as-of date. */
export function dataNote() {
  const p = provenance();
  return `source: ${p.source}, license: ${p.license}, ${p.attribution}, as of ${p.asOf}`;
}

// ── guarded CLI ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('overpass.mjs')) {
  const value = process.argv[2] || 'cafe';
  const place = process.argv.slice(3).join(' ') || 'Portland, Oregon';
  if (!KNOWN_KEY.has('amenity')) console.error('(internal: amenity key missing)');
  const data = await queryPlace(place, { key: 'amenity', value });
  if (!data.place) console.log(`could not geocode: ${place}`);
  else {
    console.log(`amenity=${value} in ${data.place.displayName} (${data.results.length} found):`);
    for (const r of data.results.slice(0, 25)) console.log(`  ${r.name || '(unnamed)'}  [${r.category || '?'}]  ${r.lat},${r.lon}`);
  }
  console.log(dataNote());
}
