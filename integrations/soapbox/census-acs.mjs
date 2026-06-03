// census-acs.mjs — "Know your community" reader over the US Census Bureau ACS (American Community
// Survey) API. Pulls demographics, income, housing, education, and poverty for a state / county /
// place and renders an escaped public profile panel. This is DISTINCT from coliving.mjs — that module
// fuses BLS/FRED/Census into a cost-of-living number; this one is a straight ACS demographic reader.
//
// Pattern matches coliving.mjs (its byMetro() Census fetch is the template): ESM, __setFetch hook,
// graceful soft-fail (return null on error, NEVER throw), a guarded CLI, and PURE parse/render helpers
// unit-tested offline. The ACS API returns a header-row + data-row array shape: [[..cols..],[..vals..]].
//
//   import { profile, variable, compare, renderPage, dataNote } from './census-acs.mjs'
//   node integrations/soapbox/census-acs.mjs 06 075   # state=06 (CA), county=075 (San Francisco)
//
// Census API is KEYLESS at low volume. A key (env name CENSUS_API_KEY) only raises rate limits — it is
// read from process.env at call time, used only in the request URL, never logged/printed/returned.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCensusACS/1.0 (+https://data.soapbox.community)' };

// Default ACS 5-year vintage (survey year). 5-year estimates cover every place down to small
// geographies, which is what "know your community" needs. Bump this as new vintages release.
export const VINTAGE = 2022;

// The ACS variables we surface in a profile, in render order. Codes are stable ACS table cells.
//   B01003_001E  total population
//   B19013_001E  median household income ($)
//   B01002_001E  median age (years)
//   B25064_001E  median gross rent ($/mo)
//   B25003_001E  occupied housing units (tenure universe)
//   B25003_002E  owner-occupied units            → ownerOccupiedPct = 002/001
//   B15003_001E  population 25+ (education universe)
//   B15003_022E  bachelor's degree
//   B15003_023E  master's degree
//   B15003_024E  professional school degree
//   B15003_025E  doctorate degree                → bachelorsPlusPct = (022+023+024+025)/001
//   B17001_001E  poverty-status universe
//   B17001_002E  income below poverty level      → povertyPct = 002/001
export const PROFILE_VARS = [
  'B01003_001E', 'B19013_001E', 'B01002_001E', 'B25064_001E',
  'B25003_001E', 'B25003_002E',
  'B15003_001E', 'B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E',
  'B17001_001E', 'B17001_002E',
];

// ---------------------------------------------------------------------------
// PURE helpers (unit-tested offline, no network)
// ---------------------------------------------------------------------------

// Minimal HTML-escape for any rendered text (matches the sibling soapbox modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Coerce an ACS string cell → finite number, or null. ACS encodes "no data" as large negative
// sentinels (e.g. -666666666) and sometimes null/empty — all of those become null.
function num(x) {
  if (x == null) return null;
  const str = String(x).replace(/,/g, '').trim();
  if (str === '') return null;
  const n = Number(str);
  if (!Number.isFinite(n)) return null;
  if (n <= -666666666) return null; // ACS jam/annotation sentinel
  return n;
}

// pct of a part over a whole → rounded 1dp, or null if either is missing / whole is 0.
function pct(part, whole) {
  const p = num(part);
  const w = num(whole);
  if (p == null || w == null || w <= 0) return null;
  return Math.round((p / w) * 1000) / 10;
}

/**
 * Turn the ACS [[header],[row],...] response into a flat { VAR: value } object for the FIRST data row,
 * keyed by the variable codes the header names. Soft-fails to null on a malformed/empty shape.
 * (ACS always returns the header as row 0; data rows follow.)
 */
export function parseAcsRow(json) {
  if (!Array.isArray(json) || json.length < 2) return null;
  const header = json[0];
  const row = json[1];
  if (!Array.isArray(header) || !Array.isArray(row)) return null;
  const out = {};
  for (let i = 0; i < header.length; i++) out[header[i]] = row[i];
  return out;
}

/**
 * Derive the headline profile stats from a flat ACS var→value map (the parseAcsRow output).
 * Every field soft-fails to null independently. Pure; no network.
 */
export function deriveProfile(vars, { vintage = VINTAGE } = {}) {
  if (!vars || typeof vars !== 'object') return null;
  return {
    name: vars.NAME != null ? String(vars.NAME) : null,
    population: num(vars.B01003_001E),
    medianHouseholdIncome: num(vars.B19013_001E),
    medianAge: num(vars.B01002_001E),
    medianRent: num(vars.B25064_001E),
    ownerOccupiedPct: pct(vars.B25003_002E, vars.B25003_001E),
    bachelorsPlusPct: pct(
      (num(vars.B15003_022E) || 0) + (num(vars.B15003_023E) || 0)
        + (num(vars.B15003_024E) || 0) + (num(vars.B15003_025E) || 0),
      vars.B15003_001E,
    ),
    povertyPct: pct(vars.B17001_002E, vars.B17001_001E),
    vintage,
  };
}

/**
 * Build the ACS `for=`/`in=` geography clause from a {state, county, place} selector. Most-specific
 * wins: place (needs state) → county (needs state) → state → nation. Returns the query fragment
 * (already URL-shaped, e.g. "for=place:67000&in=state:06"). Pure.
 */
export function geoClause({ state, county, place } = {}) {
  const s = state != null ? String(state) : null;
  if (place != null && s != null) return `for=place:${encodeURIComponent(place)}&in=state:${encodeURIComponent(s)}`;
  if (county != null && s != null) return `for=county:${encodeURIComponent(county)}&in=state:${encodeURIComponent(s)}`;
  if (s != null) return `for=state:${encodeURIComponent(s)}`;
  return 'for=us:1';
}

/**
 * Build the full ACS request URL for a set of variables + geo. NAME is always prepended so the
 * response carries a human-readable place name. The CENSUS_API_KEY is appended (by NAME from env)
 * ONLY when present — keyless requests work at lower volume. Pure aside from the env read.
 */
export function buildUrl({ geo, vars, vintage = VINTAGE } = {}) {
  const list = Array.isArray(vars) && vars.length ? vars : PROFILE_VARS;
  const get = ['NAME', ...list].join(',');
  const clause = geoClause(geo || {});
  const key = process.env.CENSUS_API_KEY;
  return `https://api.census.gov/data/${vintage}/acs/acs5`
    + `?get=${encodeURIComponent(get).replace(/%2C/g, ',')}`
    + `&${clause}`
    + (key ? `&key=${encodeURIComponent(key)}` : '');
}

/** Provenance line for any rendered/returned ACS data. */
export function dataNote({ vintage = VINTAGE } = {}) {
  return `source: US Census Bureau ACS 5-year, vintage ${vintage}`;
}

// ---------------------------------------------------------------------------
// network (soft-fail to null, never throws)
// ---------------------------------------------------------------------------

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Generic ACS variable fetch — the reusable core. Fetches the requested `vars` for a `geo` selector
 * and returns the flat { NAME, VAR: value, ... } map (raw ACS cell strings), or null on any failure.
 * @param {{geo:object, vars?:string[], vintage?:number}} opts
 */
export async function variable({ geo, vars, vintage = VINTAGE } = {}) {
  const url = buildUrl({ geo, vars, vintage });
  const json = await getJson(url);
  return parseAcsRow(json);
}

/**
 * Key ACS stats for one place. Soft-fails to null on any error (network, malformed, missing geo).
 *   → { name, population, medianHouseholdIncome, medianAge, medianRent, ownerOccupiedPct,
 *       bachelorsPlusPct, povertyPct, vintage }
 * @param {{state?:string, county?:string, place?:string, vintage?:number}} geo
 */
export async function profile({ state, county, place, vintage = VINTAGE } = {}) {
  try {
    const vars = await variable({ geo: { state, county, place }, vars: PROFILE_VARS, vintage });
    if (!vars) return null;
    return deriveProfile(vars, { vintage });
  } catch { return null; }
}

/**
 * Side-by-side profiles for a few places. Each place soft-fails to null independently, so a single
 * bad geo never sinks the comparison. Returns an array aligned with the input.
 * @param {Array<{state?:string,county?:string,place?:string}>} places
 */
export async function compare(places = [], { vintage = VINTAGE } = {}) {
  const list = Array.isArray(places) ? places : [];
  return Promise.all(list.map((p) => profile({ ...p, vintage }).catch(() => null)));
}

// ---------------------------------------------------------------------------
// render (always escaped)
// ---------------------------------------------------------------------------

function fmtInt(n) { return n == null ? 'n/a' : Number(n).toLocaleString('en-US'); }
function fmtMoney(n) { return n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US')}`; }
function fmtPct(n) { return n == null ? 'n/a' : `${n}%`; }
function fmtAge(n) { return n == null ? 'n/a' : `${n}`; }

/**
 * Escaped HTML demographic-profile panel for a single profile object (or pass { profiles: [...] }
 * to render a compare panel). Every interpolated value — including the place name — is HTML-escaped.
 */
export function renderPage(data) {
  if (!data) return '<section class="acs-profile"><p>No Census data available.</p></section>';

  const profiles = Array.isArray(data.profiles)
    ? data.profiles.filter(Boolean)
    : [data];
  if (!profiles.length) return '<section class="acs-profile"><p>No Census data available.</p></section>';

  const vintage = profiles[0] && profiles[0].vintage != null ? profiles[0].vintage : VINTAGE;
  const rows = [
    ['Population', (p) => fmtInt(p.population)],
    ['Median household income', (p) => fmtMoney(p.medianHouseholdIncome)],
    ['Median age', (p) => fmtAge(p.medianAge)],
    ['Median gross rent', (p) => (p.medianRent == null ? 'n/a' : `${fmtMoney(p.medianRent)}/mo`)],
    ['Owner-occupied', (p) => fmtPct(p.ownerOccupiedPct)],
    ["Bachelor's degree or higher", (p) => fmtPct(p.bachelorsPlusPct)],
    ['Below poverty level', (p) => fmtPct(p.povertyPct)],
  ];

  const head = profiles.map((p) => `<th>${esc(p.name || 'Selected area')}</th>`).join('');
  const body = rows.map(([label, fn]) => {
    const cells = profiles.map((p) => `<td>${esc(fn(p))}</td>`).join('');
    return `<tr><th scope="row">${esc(label)}</th>${cells}</tr>`;
  }).join('');

  return [
    '<section class="acs-profile">',
    '  <h2>Know Your Community</h2>',
    '  <table>',
    `    <thead><tr><th></th>${head}</tr></thead>`,
    `    <tbody>${body}</tbody>`,
    '  </table>',
    `  <p class="data-note">${esc(dataNote({ vintage }))}</p>`,
    '</section>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('census-acs.mjs')) {
  const [state, county, place] = process.argv.slice(2);
  const data = await profile({ state, county, place }).catch((e) => { console.error(e.message); return null; });
  if (!data) {
    console.log('No data.');
  } else {
    console.log(`SoapBox — Know Your Community: ${data.name || '(area)'}`);
    console.log('─'.repeat(50));
    console.log(`  Population               : ${fmtInt(data.population)}`);
    console.log(`  Median household income  : ${fmtMoney(data.medianHouseholdIncome)}`);
    console.log(`  Median age               : ${fmtAge(data.medianAge)}`);
    console.log(`  Median gross rent        : ${data.medianRent == null ? 'n/a' : fmtMoney(data.medianRent) + '/mo'}`);
    console.log(`  Owner-occupied           : ${fmtPct(data.ownerOccupiedPct)}`);
    console.log(`  Bachelor's+              : ${fmtPct(data.bachelorsPlusPct)}`);
    console.log(`  Below poverty            : ${fmtPct(data.povertyPct)}`);
    console.log(`  ${dataNote({ vintage: data.vintage })}`);
  }
}
