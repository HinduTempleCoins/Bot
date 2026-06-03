// epa-enviro.mjs — the SoapBox "Is my air / water / neighborhood safe?" reader. A keyless-core reader
// over the EPA's free public data:
//   • AirNow (airnowapi.org) — current air-quality / AQI by ZIP or lat/lon. The ONLY source here that
//     wants a key (env name AIRNOW_API_KEY, OPTIONAL). With no key we fall back to Open-Meteo's keyless
//     Air-Quality API, so the air-quality vertical is never dark.
//   • ECHO (Enforcement & Compliance History Online, echo.epa.gov) — regulated facilities near a point
//     + their compliance / enforcement status. KEYLESS.
//   • Envirofacts (data.epa.gov/efservice) — TRI (Toxics Release Inventory) toxic-release facilities near
//     a ZIP, plus Superfund. KEYLESS.
//
// Like fcc-broadband.mjs / weather.mjs / public-safety.mjs this is a READER only: every source soft-fails
// (null / []) and the module NEVER throws — a dead source just drops out. No personal-info intake; a ZIP
// or coordinates go in, public environmental data comes out. The AirNow key is read by NAME only — never
// logged, never printed, never committed.
//
//   import { airQuality, facilitiesNear, toxicReleases, summary, renderPage, dataNote } from './epa-enviro.mjs'
//   node integrations/soapbox/epa-enviro.mjs 90210
//   node integrations/soapbox/epa-enviro.mjs 34.07 -118.40

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape user/facility-controlled text before it lands in HTML. Mirrors the project convention.
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// AQI → EPA category label by the standard 0–500 breakpoints. Used for the keyless fallback (AirNow
// returns its own category text; this is the backstop / normalizer).
export function aqiCategory(aqi) {
  const n = num(aqi);
  if (n == null) return 'Unknown';
  if (n <= 50) return 'Good';
  if (n <= 100) return 'Moderate';
  if (n <= 150) return 'Unhealthy for Sensitive Groups';
  if (n <= 200) return 'Unhealthy';
  if (n <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

// AirNow / Open-Meteo pollutant codes → friendly labels. Unknown codes pass through as-is.
const POLLUTANTS = {
  PM25: 'PM2.5', 'PM2.5': 'PM2.5', pm2_5: 'PM2.5',
  PM10: 'PM10', pm10: 'PM10',
  O3: 'Ozone', ozone: 'Ozone',
  CO: 'Carbon Monoxide', carbon_monoxide: 'Carbon Monoxide',
  NO2: 'Nitrogen Dioxide', nitrogen_dioxide: 'Nitrogen Dioxide',
  SO2: 'Sulfur Dioxide', sulphur_dioxide: 'Sulfur Dioxide',
};
const pollutantLabel = (code) => POLLUTANTS[str(code)] || (str(code) || 'Unknown');

// Optional AirNow key, read by NAME only. Returns null when unset (the keyless fallback then runs).
function airNowKey() { return process.env.AIRNOW_API_KEY || null; }

const asOfDate = () => new Date().toISOString().slice(0, 10);

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Air quality ───────────────────────────────────────────────────────────────────────────────────────
// Current AQI for a location. With an AirNow key + a ZIP or coords we hit AirNow; otherwise (and when
// AirNow fails) we fall back to Open-Meteo's keyless Air-Quality API using the coords. Returns a
// normalized { aqi, category, pollutant, asOf, source } or null. Soft-fails to null.
export async function airQuality({ zip, lat, lon } = {}) {
  const la = num(lat), lo = num(lon);
  const z = str(zip);
  if (!z && (la == null || lo == null)) return null;

  // 1) AirNow, only when a key is present (read by NAME from env).
  const key = airNowKey();
  if (key) {
    let u = null;
    if (z) {
      u = `https://www.airnowapi.org/aq/observation/zipCode/current/?format=application/json`
        + `&zipCode=${encodeURIComponent(z)}&distance=25&API_KEY=${encodeURIComponent(key)}`;
    } else if (la != null && lo != null) {
      u = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json`
        + `&latitude=${la}&longitude=${lo}&distance=25&API_KEY=${encodeURIComponent(key)}`;
    }
    if (u) {
      const j = await getJson(u);
      const norm = normalizeAirNow(j);
      if (norm) return norm;
    }
  }

  // 2) Keyless fallback — Open-Meteo Air-Quality API (needs coords).
  if (la != null && lo != null) {
    const u = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la}&longitude=${lo}`
      + `&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide`;
    const j = await getJson(u);
    return normalizeOpenMeteoAir(j);
  }
  return null;
}

// Normalize an AirNow observation array (one row per pollutant) → the single worst-AQI record. null if unusable.
export function normalizeAirNow(json) {
  const rows = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : null);
  if (!rows || rows.length === 0) return null;
  let worst = null;
  for (const r of rows) {
    const aqi = num(r.AQI ?? r.aqi);
    if (aqi == null) continue;
    if (!worst || aqi > worst.aqi) {
      worst = {
        aqi,
        category: str(r.Category?.Name ?? r.category) || aqiCategory(aqi),
        pollutant: pollutantLabel(r.ParameterName ?? r.parameter),
        asOf: str(r.DateObserved ?? r.dateObserved) || asOfDate(),
        source: 'EPA AirNow',
      };
    }
  }
  return worst;
}

// Normalize an Open-Meteo Air-Quality `current` payload → the worst pollutant by US AQI. null if unusable.
export function normalizeOpenMeteoAir(json) {
  const cur = json && json.current;
  if (!cur) return null;
  const aqi = num(cur.us_aqi);
  if (aqi == null) return null;
  // pick the pollutant carrying the highest raw concentration as the "responsible" one (coarse but honest).
  const candidates = [
    ['pm2_5', num(cur.pm2_5)], ['pm10', num(cur.pm10)],
    ['ozone', num(cur.ozone)], ['nitrogen_dioxide', num(cur.nitrogen_dioxide)],
  ].filter(([, v]) => v != null);
  candidates.sort((a, b) => b[1] - a[1]);
  const pollutant = candidates.length ? pollutantLabel(candidates[0][0]) : 'Unknown';
  return {
    aqi,
    category: aqiCategory(aqi),
    pollutant,
    asOf: str(cur.time) || asOfDate(),
    source: 'Open-Meteo Air Quality (keyless fallback)',
  };
}

// ── ECHO facilities + compliance ────────────────────────────────────────────────────────────────────────
// EPA ECHO regulated facilities near a point + their compliance status. KEYLESS (echodata REST service,
// JSON). Normalizes to [{ name, program, status, lastInspection, ... }]; soft-fails to [].
//   https://echodata.epa.gov/echo/echo_rest_services.get_facilities  (spatial: p_lat / p_long / p_radius)
export async function facilitiesNear({ lat, lon, radiusMiles = 5 } = {}) {
  const la = num(lat), lo = num(lon);
  if (la == null || lo == null) return [];
  const radius = Math.max(0.5, Math.min(num(radiusMiles) || 5, 50));
  const u = `https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON`
    + `&p_lat=${la}&p_long=${lo}&p_radius=${radius}&responseset=100`;
  const j = await getJson(u);
  const rows = echoRows(j);
  return rows.map(normalizeFacility).filter(Boolean);
}

// ECHO's response nests the facility array under Results.Facilities (with some shape drift). Pull it out.
function echoRows(j) {
  const r = j?.Results ?? j?.results ?? j;
  const arr = r?.Facilities ?? r?.facilities ?? r?.facs ?? (Array.isArray(r) ? r : null);
  return Array.isArray(arr) ? arr : [];
}

// Normalize one ECHO facility record → our compliance shape. PURE. null if nothing usable.
export function normalizeFacility(f) {
  if (!f || typeof f !== 'object') return null;
  const name = str(f.FacName ?? f.fac_name ?? f.name);
  const program = str(f.StatuteCodes ?? f.Statute ?? f.program ?? f.RegistryID) || null;
  // ECHO uses CWAComplianceStatus / CAAComplianceStatus / RcraComplianceStatus; fall back to a generic one.
  const status = str(
    f.CurrVioFlag === 'Y' || f.cwa_3yr_compl_qtrs_history ? null : null
  ) || str(
    f.ComplianceStatus ?? f.CAAComplianceStatus ?? f.CWAComplianceStatus
    ?? f.RcraComplianceStatus ?? f.compliance_status
  ) || (str(f.CurrVioFlag).toUpperCase() === 'Y' ? 'Current violation' : null) || 'Unknown';
  const lastInspection = str(f.LastInspDate ?? f.last_inspection ?? f.DateLastInspection) || null;
  const violations = num(f.Informal_Count ?? f.informal_count ?? f.violations);
  if (!name && !program) return null;
  return {
    name: name || 'Unnamed facility',
    program,
    status,
    lastInspection,
    violations: violations != null ? violations : (str(f.CurrVioFlag).toUpperCase() === 'Y' ? 1 : 0),
    inViolation: str(f.CurrVioFlag).toUpperCase() === 'Y' || /violation|non-?compliance|significant/i.test(status),
    source: 'EPA ECHO',
  };
}

// ── TRI toxic releases (Envirofacts) ──────────────────────────────────────────────────────────────────
// TRI toxic-release facilities near a ZIP via the Envirofacts efservice (KEYLESS, JSON). Normalizes to
// [{ name, chemical, releaseLbs, year, city, state }]; soft-fails to [].
//   https://data.epa.gov/efservice/TRI_FACILITY/ZIP_CODE/<zip>/JSON
export async function toxicReleases({ zip, year } = {}) {
  const z = str(zip);
  if (!z) return [];
  let path = `https://data.epa.gov/efservice/TRI_FACILITY/ZIP_CODE/${encodeURIComponent(z)}`;
  const y = num(year);
  if (y != null) path += `/REPORTING_YEAR/${y}`;
  const j = await getJson(`${path}/JSON`);
  const rows = Array.isArray(j) ? j : (Array.isArray(j?.results) ? j.results : []);
  return rows.map((r) => normalizeTri(r, y)).filter(Boolean);
}

// Normalize one Envirofacts TRI row → our toxic-release shape. PURE. null if nothing usable.
export function normalizeTri(r, fallbackYear) {
  if (!r || typeof r !== 'object') return null;
  const name = str(r.FACILITY_NAME ?? r.facility_name ?? r.name);
  if (!name) return null;
  const releaseLbs = num(r.TOTAL_RELEASES ?? r.total_releases ?? r.release_lbs ?? r.RELEASE_LBS);
  return {
    name,
    chemical: str(r.CHEMICAL ?? r.chem_name ?? r.chemical) || null,
    releaseLbs,
    year: num(r.REPORTING_YEAR ?? r.reporting_year ?? r.year) ?? (fallbackYear != null ? fallbackYear : null),
    city: str(r.CITY_NAME ?? r.city_name ?? r.city) || null,
    state: str(r.STATE_ABBR ?? r.state_abbr ?? r.state) || null,
    zip: str(r.ZIP_CODE ?? r.zip_code ?? r.zip) || null,
    source: 'EPA Envirofacts (TRI)',
  };
}

// ── summary — a small neighborhood-health roll-up ─────────────────────────────────────────────────────
// data: { air, facilities, toxics } (any field optional). Aggregates AQI, facility count, violation count,
// and total reported toxic pounds. Safe on missing / empty inputs.
export function summary(data = {}) {
  const air = data.air || null;
  const facilities = Array.isArray(data.facilities) ? data.facilities : [];
  const toxics = Array.isArray(data.toxics) ? data.toxics : [];

  const violations = facilities.filter((f) => f && f.inViolation);
  const toxicLbs = toxics.reduce((acc, t) => acc + (num(t?.releaseLbs) || 0), 0);

  const aqi = air ? num(air.aqi) : null;
  // coarse overall concern flag: bad air OR any facility in violation OR any reported release.
  const concern = (aqi != null && aqi > 100) || violations.length > 0 || toxicLbs > 0;

  return {
    aqi,
    aqiCategory: air ? str(air.category) || aqiCategory(aqi) : 'Unknown',
    pollutant: air ? str(air.pollutant) || null : null,
    facilityCount: facilities.length,
    violationCount: violations.length,
    toxicFacilityCount: toxics.length,
    toxicReleaseLbs: Math.round(toxicLbs),
    concern,
    asOf: asOfDate(),
  };
}

// ── provenance note ───────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Source: EPA AirNow / ECHO / Envirofacts, as of ${asOfDate()}. ` +
    `Air-quality readings are from the nearest monitor and may not reflect your exact block; when no AirNow ` +
    `key is configured a keyless air-quality source is used instead. Facility compliance and toxic-release ` +
    `figures are self-/agency-reported and may lag. This is public reference, not a safety guarantee.`;
}

// ── renderPage — escaped HTML section ─────────────────────────────────────────────────────────────────
// data: { air, facilities, toxics, summary } (any field optional). EVERY interpolated value is escaped.
export function renderPage(data = {}) {
  const air = data.air || null;
  const facilities = Array.isArray(data.facilities) ? data.facilities : [];
  const toxics = Array.isArray(data.toxics) ? data.toxics : [];
  const sum = data.summary || summary({ air, facilities, toxics });

  const airLine = air
    ? `<p class="air">Air Quality Index: <strong>${escapeHtml(air.aqi)}</strong> — ${escapeHtml(air.category)}` +
      `${air.pollutant ? ` (${escapeHtml(air.pollutant)})` : ''} <span class="src">${escapeHtml(air.source)}</span></p>`
    : `<p class="air">Air quality: unavailable.</p>`;

  const facRows = facilities.map((f) => `<tr class="${f.inViolation ? 'violation' : ''}">` +
    `<td>${escapeHtml(f.name)}</td>` +
    `<td>${f.program == null ? '—' : escapeHtml(f.program)}</td>` +
    `<td>${escapeHtml(f.status)}</td>` +
    `<td>${f.lastInspection == null ? '—' : escapeHtml(f.lastInspection)}</td>` +
    `</tr>`).join('');

  const toxRows = toxics.map((t) => `<tr>` +
    `<td>${escapeHtml(t.name)}</td>` +
    `<td>${t.chemical == null ? '—' : escapeHtml(t.chemical)}</td>` +
    `<td>${t.releaseLbs == null ? '—' : escapeHtml(t.releaseLbs)}</td>` +
    `<td>${t.year == null ? '—' : escapeHtml(t.year)}</td>` +
    `</tr>`).join('');

  const sumLine = `<p class="summary">` +
    `${sum.facilityCount} regulated facilit${sum.facilityCount === 1 ? 'y' : 'ies'} nearby` +
    `${sum.violationCount ? `, <strong>${escapeHtml(sum.violationCount)} in violation</strong>` : ''}; ` +
    `${sum.toxicFacilityCount} TRI site(s) reporting ${escapeHtml(sum.toxicReleaseLbs)} lbs released. ` +
    `Overall: ${sum.concern ? 'review the flags below' : 'no major flags'}.</p>`;

  return `<section class="epa-enviro">
  <h2>Is my neighborhood safe?</h2>
  ${airLine}
  ${sumLine}
  <h3>Regulated facilities</h3>
  <table class="facilities">
    <thead><tr><th>Facility</th><th>Program</th><th>Status</th><th>Last inspection</th></tr></thead>
    <tbody>${facRows}</tbody>
  </table>
  <h3>Toxic releases (TRI)</h3>
  <table class="toxics">
    <thead><tr><th>Facility</th><th>Chemical</th><th>Released (lbs)</th><th>Year</th></tr></thead>
    <tbody>${toxRows}</tbody>
  </table>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// CLI — accepts a ZIP (single 5-digit arg) or "lat lon".
if (process.argv[1] && process.argv[1].endsWith('epa-enviro.mjs')) {
  const args = process.argv.slice(2);
  let loc;
  if (args.length === 1 && /^\d{5}$/.test(args[0])) loc = { zip: args[0] };
  else loc = { lat: Number(args[0] ?? 34.07), lon: Number(args[1] ?? -118.40) };

  const [air, facilities, toxics] = await Promise.all([
    airQuality(loc).catch(() => null),
    (loc.lat != null ? facilitiesNear({ lat: loc.lat, lon: loc.lon }) : Promise.resolve([])).catch(() => []),
    (loc.zip ? toxicReleases({ zip: loc.zip }) : Promise.resolve([])).catch(() => []),
  ]);
  const sum = summary({ air, facilities, toxics });
  console.log(`\nEPA Enviro — ${loc.zip ? `ZIP ${loc.zip}` : `${loc.lat}, ${loc.lon}`}`);
  console.log('─'.repeat(60));
  if (air) console.log(`  Air: AQI ${air.aqi} (${air.category}) — ${air.pollutant}  [${air.source}]`);
  else console.log('  Air: unavailable');
  console.log(`  Facilities: ${sum.facilityCount}   in violation: ${sum.violationCount}`);
  console.log(`  TRI sites: ${sum.toxicFacilityCount}   released: ${sum.toxicReleaseLbs} lbs`);
  console.log(`  Overall: ${sum.concern ? 'flags present' : 'no major flags'}`);
  console.log(`\n${dataNote()}`);
}
