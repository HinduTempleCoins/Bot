// worldbank.mjs — the SoapBox global development-indicators reader. Reads the World Bank Open Data API
// (api.worldbank.org/v2) — free, fully keyless — for country-level indicators: GDP, GDP per capita,
// population, inflation (CPI), life expectancy, unemployment, CO2 per capita. Powers the "compare any
// country" public pages.
//
//   World Bank returns a TWO-element array: [ metadata, dataRows ]. dataRows is an array of
//   { indicator:{id,value}, country:{id,value}, date:'2022', value: 25462700000000, ... }.
//   IMF (data.imf.org) can be layered in later where easy; the World Bank covers the curated set today.
//
// Pattern matches macro.mjs / noaa-climate.mjs: ESM, __setFetch hook, graceful soft-fail (return []/null
// on error, NEVER throw), a guarded CLI block, escaped rendered HTML, no secrets, as-of (year) labeling.
//
//   import { indicator, countryProfile, compareCountries, INDICATORS, renderPage, dataNote } from './worldbank.mjs'
//   node integrations/soapbox/worldbank.mjs US            # country profile
//   node integrations/soapbox/worldbank.mjs US CN IN -- NY.GDP.MKTP.CD   # compare GDP

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// World Bank asks nothing of clients (keyless); identify ourselves anyway, like the sibling modules.
const UA = { 'User-Agent': 'SoapBoxWorldBank/1.0 (+https://data.soapbox.community)' };

const BASE = 'https://api.worldbank.org/v2';

// ---- curated friendly name → World Bank indicator code, with a display unit ----
// These are the headline development indicators a public "compare countries" page wants.
export const INDICATORS = {
  'GDP': { code: 'NY.GDP.MKTP.CD', unit: 'USD' },
  'GDP per capita': { code: 'NY.GDP.PCAP.CD', unit: 'USD' },
  'Population': { code: 'SP.POP.TOTL', unit: 'people' },
  'Inflation (CPI)': { code: 'FP.CPI.TOTL.ZG', unit: '%' },
  'Life expectancy': { code: 'SP.DYN.LE00.IN', unit: 'years' },
  'Unemployment': { code: 'SL.UEM.TOTL.ZS', unit: '%' },
  'CO2 per capita': { code: 'EN.ATM.CO2E.PC', unit: 't' },
};

// ---- pure helpers (unit-tested offline) ----

// Minimal HTML-escape for rendered text (matches the sibling soapbox modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Number(null)/Number('') coerce to 0, which is wrong here — null/'' means "no value reported".
const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// Normalize the World Bank [meta, data] two-element payload → a clean [{ year, value }] series,
// newest first, dropping null-value rows. Returns [] for anything that isn't the expected shape.
export function normalizeSeries(json) {
  // The API returns [ metadata, dataRows ]. dataRows can be null (no data for the query).
  if (!Array.isArray(json) || json.length < 2) return [];
  const rows = json[1];
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const year = r.date != null ? String(r.date) : null;
    const value = num(r.value);
    if (year == null || value == null) continue;
    out.push({ year, value });
  }
  // World Bank returns newest-first already; sort defensively (descending by year).
  out.sort((a, b) => Number(b.year) - Number(a.year));
  return out;
}

// Latest (most recent year with a value) point of a normalized series, or null.
export function latestPoint(series) {
  return Array.isArray(series) && series.length ? series[0] : null;
}

// ---- live data (keyless; each fails soft to []/null) ----

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Time series for one country + one indicator. Returns a normalized [{ year, value }] (newest first),
 * or [] on any failure.
 * @param {{country:string, indicator:string, years?:number}} opts
 *   country = ISO2/ISO3 code (e.g. 'US', 'CHN'); indicator = a World Bank code (e.g. 'NY.GDP.MKTP.CD').
 */
export async function indicator({ country, indicator: code, years = 20 } = {}) {
  if (!country || !code) return [];
  const per = Math.max(1, Math.min(60, Number(years) || 20));
  const url = `${BASE}/country/${encodeURIComponent(String(country))}`
    + `/indicator/${encodeURIComponent(String(code))}`
    + `?format=json&per_page=${per}`;
  const j = await getJson(url);
  return normalizeSeries(j);
}

/**
 * Latest value for every curated indicator, for one country. Returns
 *   { country, indicators: { '<friendly name>': { code, unit, year, value } | null } }
 * Always returns an object; individual indicators soft-fail to null.
 * @param {{country:string}} opts
 */
export async function countryProfile({ country } = {}) {
  if (!country) return { country: null, indicators: {} };
  const indicators = {};
  for (const [name, { code, unit }] of Object.entries(INDICATORS)) {
    const series = await indicator({ country, indicator: code, years: 10 });
    const latest = latestPoint(series);
    indicators[name] = latest ? { code, unit, year: latest.year, value: latest.value } : null;
  }
  return { country: String(country), indicators };
}

/**
 * Latest value of ONE indicator across several countries, ranked high → low.
 * Returns { indicator, unit, rows: [{ country, year, value }] } (rows sorted descending by value;
 * countries with no data are dropped).
 * @param {string[]} countries  ISO codes
 * @param {string} code         a World Bank indicator code
 */
export async function compareCountries(countries = [], code) {
  if (!Array.isArray(countries) || !countries.length || !code) {
    return { indicator: code || null, unit: unitForCode(code), rows: [] };
  }
  const rows = [];
  for (const c of countries) {
    const series = await indicator({ country: c, indicator: code, years: 10 });
    const latest = latestPoint(series);
    if (latest) rows.push({ country: String(c), year: latest.year, value: latest.value });
  }
  rows.sort((a, b) => b.value - a.value);
  return { indicator: code, unit: unitForCode(code), rows };
}

// look up the display unit for a raw indicator code (best effort; '' if unknown).
function unitForCode(code) {
  for (const { code: c, unit } of Object.values(INDICATORS)) if (c === code) return unit;
  return '';
}
// friendly name for a raw indicator code (the code itself if not curated).
function nameForCode(code) {
  for (const [name, { code: c }] of Object.entries(INDICATORS)) if (c === code) return name;
  return code || '';
}

// Compact number formatting for display (1.2T, 340.5M, 4.2K, 7.3).
function fmt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return (Math.round(n * 100) / 100).toString();
}

// ---- rendering ----

/**
 * Escaped HTML — either a single-country profile or a multi-country comparison. PURE; soft-handles
 * missing fields. Shape is inferred: a `rows` array → comparison; an `indicators` map → profile.
 * @param {object} data  from countryProfile() or compareCountries()
 */
export function renderPage(data = {}) {
  // Comparison view
  if (data && Array.isArray(data.rows)) {
    const label = esc(nameForCode(data.indicator));
    const unit = esc(data.unit || '');
    const parts = [`<section class="worldbank-compare"><h2>Compare countries — ${label}${unit ? ` (${unit})` : ''}</h2>`];
    if (data.rows.length) {
      parts.push('<table class="wb-rank"><thead><tr><th>#</th><th>Country</th><th>Value</th><th>Year</th></tr></thead><tbody>');
      data.rows.forEach((r, i) => {
        parts.push(`<tr><td>${i + 1}</td><td>${esc(r.country)}</td><td>${esc(fmt(r.value))}</td><td>${esc(r.year)}</td></tr>`);
      });
      parts.push('</tbody></table>');
    } else {
      parts.push('<p class="wb-empty">No data available.</p>');
    }
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }

  // Profile view
  const country = esc(data.country || 'Country');
  const inds = data.indicators || {};
  const parts = [`<section class="worldbank-profile"><h2>Country profile — ${country}</h2>`];
  const keys = Object.keys(inds);
  if (keys.length) {
    parts.push('<table class="wb-profile"><thead><tr><th>Indicator</th><th>Value</th><th>Unit</th><th>As of</th></tr></thead><tbody>');
    for (const name of keys) {
      const v = inds[name];
      if (v) {
        parts.push(`<tr><td>${esc(name)}</td><td>${esc(fmt(v.value))}</td><td>${esc(v.unit || '')}</td><td>${esc(v.year)}</td></tr>`);
      } else {
        parts.push(`<tr><td>${esc(name)}</td><td>—</td><td></td><td>—</td></tr>`);
      }
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="wb-empty">No indicators available.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the World Bank + the latest-available-year caveat. */
export function dataNote() {
  return 'source: World Bank Open Data, latest available year';
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('worldbank.mjs')) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  if (sep >= 0) {
    // compare mode: <c1> <c2> ... -- <indicatorCode>
    const countries = argv.slice(0, sep);
    const code = argv[sep + 1] || INDICATORS['GDP'].code;
    const res = await compareCountries(countries, code);
    console.log(`SoapBox World Bank — compare ${nameForCode(code)} (${res.unit})`);
    console.log('─'.repeat(50));
    if (res.rows.length) res.rows.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.country.padEnd(6)} ${fmt(r.value)}  (${r.year})`));
    else console.log('  no data');
    console.log(`  ${dataNote()}`);
  } else {
    const country = argv[0] || 'US';
    const p = await countryProfile({ country });
    console.log(`SoapBox World Bank — country profile ${p.country}`);
    console.log('─'.repeat(50));
    for (const [name, v] of Object.entries(p.indicators)) {
      console.log(v ? `  ${name.padEnd(20)} ${fmt(v.value)} ${v.unit} (${v.year})` : `  ${name.padEnd(20)} —`);
    }
    console.log(`  ${dataNote()}`);
  }
}
