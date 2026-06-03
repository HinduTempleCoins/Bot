// geo-basics.mjs — small keyless geo-reference readers for the SoapBox mapping spine (v3 §5).
//
// Four independent readers, one module (they share the soft-fail/provenance shape and are individually small):
//
//   • elevation({lat,lon})   — Open-Elevation (open-elevation.com, KEYLESS). Meters above sea level.
//   • country(codeOrName)    — REST Countries (restcountries.com, KEYLESS). Capital/region/population/etc.
//   • timezone(area)         — WorldTimeAPI (worldtimeapi.org, KEYLESS). Current time + UTC offset for a TZ.
//   • geoSearch(q)           — GeoNames (secure.geonames.org). Needs a username — env GEONAMES_USERNAME
//                              BY NAME. If unset, SOFT-SKIPS (returns [] and a flag), never throws.
//
// GeoNames is the only one with a credential, and it is a USERNAME, not a secret key (GeoNames usernames are
// public registration handles, rate-limited per name). We read it from process.env.GEONAMES_USERNAME by name
// and soft-skip when absent — consistent with the keyless siblings, no secret stored in-repo.
//
// Provenance: each reader stamps source + license + attribution.
//   Open-Elevation → open DEMs (SRTM etc.), open.   REST Countries → open reference data.
//   WorldTimeAPI   → public-domain time data.        GeoNames → CC-BY-4.0 (attribution required).
//
// Pattern: ESM, zero deps, __setFetch seam, soft-fail ([]/null), provenance, escaped render, guarded CLI,
// offline fixture tests.
//
//   import { elevation, country, timezone, geoSearch, dataNote, __setFetch } from './geo-basics.mjs'
//   node integrations/soapbox/geo-basics.mjs elevation 39.7391 -104.9847
//   node integrations/soapbox/geo-basics.mjs country FR
//   node integrations/soapbox/geo-basics.mjs timezone America/Denver
//   node integrations/soapbox/geo-basics.mjs search Denver        # GeoNames (needs GEONAMES_USERNAME)

const ELEVATION_URL = () => process.env.OPEN_ELEVATION_URL || 'https://api.open-elevation.com/api/v1/lookup';
const COUNTRIES_URL = () => process.env.REST_COUNTRIES_URL || 'https://restcountries.com/v3.1';
const WORLDTIME_URL = () => process.env.WORLDTIME_URL || 'https://worldtimeapi.org/api';
const GEONAMES_URL = () => process.env.GEONAMES_URL || 'https://secure.geonames.org';

// GeoNames credential is a USERNAME (public handle), read BY NAME from env. Soft-skip when unset.
const GEONAMES_USERNAME = () => process.env.GEONAMES_USERNAME || '';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Per-source provenance descriptors (license + attribution).
export const PROVENANCE = {
  elevation: { source: 'Open-Elevation', license: 'Open (open DEMs, e.g. SRTM)', attribution: 'Open-Elevation / open DEM datasets' },
  country: { source: 'REST Countries', license: 'Open reference data', attribution: 'restcountries.com' },
  timezone: { source: 'WorldTimeAPI', license: 'Public Domain', attribution: 'worldtimeapi.org' },
  geonames: { source: 'GeoNames', license: 'CC-BY-4.0', attribution: '© GeoNames' },
};
const asOf = () => new Date().toISOString().slice(0, 10);
function provFor(kind) { return { ...PROVENANCE[kind], asOf: asOf() }; }

async function getJSON(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Open-Elevation (keyless) ────────────────────────────────────────────────────────────────────────
/**
 * Elevation (meters) at a lat/lon via Open-Elevation. Soft-fails to null.
 * @param {{lat:number, lon:number}} opts
 */
export async function elevation({ lat, lon } = {}) {
  const la = num(lat); const lo = num(lon);
  if (la == null || lo == null) return null;
  const url = `${ELEVATION_URL()}?locations=${encodeURIComponent(la)},${encodeURIComponent(lo)}`;
  const j = await getJSON(url);
  const r = Array.isArray(j?.results) ? j.results[0] : null;
  const m = r ? num(r.elevation) : null;
  if (m == null) return null;
  return { lat: la, lon: lo, elevationM: m, provenance: provFor('elevation') };
}

// ── REST Countries (keyless) ────────────────────────────────────────────────────────────────────────
/**
 * Country reference by ISO code (alpha-2/3) or name. Soft-fails to null.
 * @param {string} codeOrName  e.g. 'FR', 'FRA', 'France'
 */
export async function country(codeOrName) {
  const q = str(codeOrName);
  if (!q) return null;
  // /alpha for 2-3 letter codes; /name for everything else.
  const isCode = /^[A-Za-z]{2,3}$/.test(q);
  const path = isCode ? `alpha/${encodeURIComponent(q)}` : `name/${encodeURIComponent(q)}`;
  const url = `${COUNTRIES_URL()}/${path}`;
  const j = await getJSON(url);
  const r = Array.isArray(j) ? j[0] : (j && typeof j === 'object' && !j.status ? j : null);
  if (!r || !r.name) return null;
  const capital = Array.isArray(r.capital) ? str(r.capital[0]) : str(r.capital);
  const currencies = r.currencies && typeof r.currencies === 'object' ? Object.keys(r.currencies) : [];
  const languages = r.languages && typeof r.languages === 'object' ? Object.values(r.languages).map(str) : [];
  return {
    name: str(r.name?.common) || q,
    officialName: str(r.name?.official) || null,
    cca2: str(r.cca2) || null,
    cca3: str(r.cca3) || null,
    region: str(r.region) || null,
    subregion: str(r.subregion) || null,
    capital: capital || null,
    population: num(r.population),
    currencies,
    languages,
    latlng: Array.isArray(r.latlng) ? r.latlng.map(num) : null,
    provenance: provFor('country'),
  };
}

// ── WorldTimeAPI (keyless) ──────────────────────────────────────────────────────────────────────────
/**
 * Current time + UTC offset for a timezone area (e.g. 'America/Denver'). Soft-fails to null.
 * @param {string} area  IANA timezone name
 */
export async function timezone(area) {
  const tz = str(area);
  if (!tz) return null;
  const url = `${WORLDTIME_URL()}/timezone/${encodeURIComponent(tz)}`;
  const j = await getJSON(url);
  if (!j || typeof j !== 'object' || j.error || !j.datetime) return null;
  return {
    timezone: str(j.timezone) || tz,
    datetime: str(j.datetime),
    utcOffset: str(j.utc_offset) || null,
    abbreviation: str(j.abbreviation) || null,
    dayOfWeek: num(j.day_of_week),
    dst: typeof j.dst === 'boolean' ? j.dst : null,
    provenance: provFor('timezone'),
  };
}

// ── GeoNames (needs GEONAMES_USERNAME; soft-skips when unset) ─────────────────────────────────────────
/**
 * Search places by name via GeoNames. Requires env GEONAMES_USERNAME — when unset, SOFT-SKIPS:
 * returns { skipped:true, reason, results:[] } and never throws.
 * @param {string} q  place query
 * @param {{maxRows?:number}} [opts]
 * @returns { skipped, reason?, results:[{ name, countryCode, lat, lon, fcl, fcode, provenance }] }
 */
export async function geoSearch(q, { maxRows = 10 } = {}) {
  const query = str(q);
  const user = GEONAMES_USERNAME();
  if (!user) {
    return { skipped: true, reason: 'GEONAMES_USERNAME not set', results: [] };
  }
  if (!query) return { skipped: false, results: [] };
  const rows = Math.max(1, Math.min(100, num(maxRows) || 10));
  const url = `${GEONAMES_URL()}/searchJSON?q=${encodeURIComponent(query)}`
    + `&maxRows=${rows}&username=${encodeURIComponent(user)}`;
  const j = await getJSON(url);
  // GeoNames returns { status: { message } } on error (bad username, over quota, …) → soft-skip.
  if (!j || j.status) {
    return { skipped: false, reason: j?.status?.message || 'geonames error', results: [] };
  }
  const list = Array.isArray(j.geonames) ? j.geonames : [];
  const prov = provFor('geonames');
  const results = list.map((g) => ({
    geonameId: g.geonameId != null ? str(g.geonameId) : null,
    name: str(g.name) || null,
    countryCode: str(g.countryCode) || null,
    adminName1: str(g.adminName1) || null,
    lat: num(g.lat),
    lon: num(g.lng),
    fcl: str(g.fcl) || null,
    fcode: str(g.fcode) || null,
    population: num(g.population),
    provenance: prov,
  })).filter((r) => r.lat != null && r.lon != null);
  return { skipped: false, results };
}

// ── render (escaped) ─────────────────────────────────────────────────────────────────────────────────
/** Render a small escaped fact block for any of the records above. Soft-handles null. */
export function renderRecord(rec, label = 'Geo') {
  if (!rec) return `<section class="geo-basics"><p class="empty">No data.</p></section>`;
  const pairs = Object.entries(rec)
    .filter(([k, v]) => k !== 'provenance' && v != null && typeof v !== 'object')
    .map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`)
    .join('');
  const note = rec.provenance
    ? `${rec.provenance.source} (${rec.provenance.license}) — ${rec.provenance.attribution}`
    : dataNote();
  return `<section class="geo-basics"><h2>${esc(label)}</h2><ul>${pairs}</ul>`
    + `<footer class="data-note">${esc(`source: ${note}`)}</footer></section>`;
}

/** Generic provenance line naming all four backing sources + their licenses. */
export function dataNote() {
  return 'sources: Open-Elevation (open DEMs), REST Countries (open), WorldTimeAPI (public domain), '
    + 'GeoNames (CC-BY-4.0, © GeoNames)';
}

// ── guarded CLI ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('geo-basics.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'elevation') {
    const r = await elevation({ lat: rest[0], lon: rest[1] });
    console.log(r ? `${r.elevationM} m @ (${r.lat}, ${r.lon})` : 'no elevation');
  } else if (cmd === 'country') {
    const r = await country(rest.join(' '));
    console.log(r ? `${r.name} — capital ${r.capital}, ${r.region}, pop ${r.population}` : 'no country');
  } else if (cmd === 'timezone') {
    const r = await timezone(rest.join(' '));
    console.log(r ? `${r.timezone}: ${r.datetime} (UTC${r.utcOffset})` : 'no timezone');
  } else if (cmd === 'search') {
    const r = await geoSearch(rest.join(' '));
    if (r.skipped) console.log(`GeoNames skipped: ${r.reason}`);
    else r.results.forEach((g) => console.log(`  ${g.name}, ${g.countryCode}  (${g.lat}, ${g.lon})  [${g.fcode}]`));
  } else {
    console.log('usage: geo-basics.mjs <elevation lat lon | country CODE | timezone AREA | search QUERY>');
  }
  console.log(dataNote());
}
