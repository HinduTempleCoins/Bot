// fbi-crime.mjs — the SoapBox "Know the real crime stats" vertical. A reader over the FBI Crime Data
// Explorer (CDE) API — the federal UCR / NIBRS program's national, state, and agency crime STATISTICS.
//
// This is DISTINCT from public-safety.mjs. That module is the live-INCIDENT feed (city Socrata CAD data
// + PD press RSS) — "what just happened near you." This module is the STATISTICAL picture — multi-year
// estimated counts and rates per 100,000 population for an offense, nationally or by state, plus the list
// of agencies that report. Stats, not incidents.
//
// Contextual honesty is the whole point of a crime-stats page: we lead with RATES PER 100,000 (not raw
// counts, which just track population), surface the trend DIRECTION over the window, and always carry the
// reporting caveat — UCR/NIBRS is VOLUNTARY agency reporting, coverage varies by year and place, and the
// 2021 SRS→NIBRS transition created a national coverage gap. A bigger number is not automatically "more
// crime."
//
// Pattern follows cdc-health.mjs + public-safety.mjs: ESM, an injectable __setFetch() seam, every reader
// SOFT-FAILS (returns [] / null — never throws), as-of timestamps, a guarded CLI, HTML-escaped rendering,
// and NO secrets — the api.data.gov key is referenced by env NAME only, with the documented public
// DEMO_KEY as the keyless fallback. INFORMATIONAL ONLY: population statistics.
//
//   import { stateCrime, nationalTrend, agencies, summary, renderPage, dataNote } from './fbi-crime.mjs'
//   node integrations/soapbox/fbi-crime.mjs state TX 2020 violent-crime

import { cached, TTL } from './cache.mjs';

const BASE = 'https://api.usa.gov/crime/fbi/cde';
const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
const SOURCE = 'FBI Crime Data Explorer (UCR/NIBRS)';

// Env NAME of the api.data.gov key. We read process.env BY THIS NAME — there is no literal key in this
// file. When unset we fall back to the api.data.gov DEMO_KEY, the documented public (rate-limited) key.
export const API_KEY_ENV = 'DATA_GOV_API_KEY';
const DEMO_KEY = 'DEMO_KEY';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
// NB: Number(null) === 0 and Number('') === 0, so guard those — a missing field must read as null,
// not 0 (otherwise a "no rate present" row would look like a real rate of 0).
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation (strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// The api.data.gov key, read by env NAME (never a literal). Missing → public DEMO_KEY.
function apiKey() { return str(process.env[API_KEY_ENV]) || DEMO_KEY; }

// ── Generic CDE fetch helper — the reusable core ───────────────────────────────────────────────────
// GET any CDE path, attaching the API_KEY query param (read by env name). Returns parsed JSON or null.
// Soft-fails (network error / non-2xx / bad JSON → null). Cached 1h (these are annual statistics).
export async function cdeGet(path, params = {}) {
  const p = str(path);
  if (!p) return null;
  const u = new URL(BASE + (p.startsWith('/') ? p : `/${p}`));
  for (const [k, v] of Object.entries(params)) { if (v != null && v !== '') u.searchParams.set(k, String(v)); }
  u.searchParams.set('API_KEY', apiKey()); // read by env NAME via apiKey(); DEMO_KEY fallback
  return cached(`fbi:get:${u.pathname}:${u.searchParams.toString().replace(/API_KEY=[^&]*/, 'API_KEY=*')}`, TTL.metadata, async () => {
    try {
      const r = await _fetch(u.toString(), { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!r || !r.ok) return null;
      return await r.json();
    } catch { return null; }
  });
}

// Pick the first present value among candidate keys (CDE shapes vary by endpoint/version).
const pick = (row, ...keys) => { for (const k of keys) { if (row && row[k] != null && row[k] !== '') return row[k]; } return null; };

// CDE estimate endpoints return rows in a few shapes. Normalize ANY of them into a flat array of
// { year, offense, count, ratePer100k, population }. PURE — directly unit-tested. Soft-returns [].
//   - array of row objects:        [{ data_year, value, rate, ... }]
//   - { results: [ ...rows ] }
//   - { offenses: { actual:{ "2019": 1.2e6 }, rates:{ "2019": 380.7 }, population:{...} } }  (keyed form)
export function normalizeEstimates(json, offenseLabel) {
  if (!json) return [];
  const label = str(offenseLabel) || null;

  // Shape A/B: a plain array, or { results: [...] }
  const arr = Array.isArray(json) ? json : (Array.isArray(json.results) ? json.results : null);
  if (arr) {
    return arr.map((row) => {
      const year = num(pick(row, 'data_year', 'year', 'data_year_id'));
      const count = num(pick(row, 'value', 'actual', 'count', 'estimate'));
      let rate = num(pick(row, 'rate', 'rate_per_100k', 'value_rate'));
      const population = num(pick(row, 'population', 'pop'));
      if (rate == null && count != null && population) rate = (count / population) * 100000;
      return {
        year,
        offense: str(pick(row, 'offense', 'offense_name', 'key')) || label,
        count,
        ratePer100k: rate != null ? Math.round(rate * 10) / 10 : null,
        population,
      };
    }).filter((r) => r.year != null && (r.count != null || r.ratePer100k != null))
      .sort((a, b) => a.year - b.year);
  }

  // Shape C: keyed maps year→value under actual / rates / population (the CDE "estimates" payload).
  const counts = json.actual || json.counts || (json.offenses && json.offenses.actual) || null;
  const rates = json.rates || (json.offenses && json.offenses.rates) || null;
  const pops = json.population || json.populations || (json.offenses && json.offenses.population) || null;
  if (counts || rates) {
    const years = new Set([...Object.keys(counts || {}), ...Object.keys(rates || {})]);
    return [...years].map((y) => {
      const year = num(y);
      const count = num(counts && counts[y]);
      const population = num(pops && pops[y]);
      let rate = num(rates && rates[y]);
      if (rate == null && count != null && population) rate = (count / population) * 100000;
      return { year, offense: label, count, ratePer100k: rate != null ? Math.round(rate * 10) / 10 : null, population };
    }).filter((r) => r.year != null && (r.count != null || r.ratePer100k != null))
      .sort((a, b) => a.year - b.year);
  }

  return [];
}

// ── State crime estimates ──────────────────────────────────────────────────────────────────────────
// UCR/NIBRS estimates for ONE state. `state` = two-letter abbreviation (TX, CA…). `offense` = a CDE
// offense key (default 'violent-crime'). Optional `year` filters to a single year. Returns normalized
// [{ year, offense, count, ratePer100k }]. Soft-fails to [].
export async function stateCrime({ state, year, offense = 'violent-crime' } = {}) {
  const st = str(state).toUpperCase();
  const off = str(offense) || 'violent-crime';
  if (!st) return [];
  // CDE estimate path: /estimate/state/{state}/{offense}?from=&to=
  const params = {};
  const yr = num(year);
  if (yr) { params.from = yr; params.to = yr; }
  const json = await cdeGet(`/estimate/state/${encodeURIComponent(st)}/${encodeURIComponent(off)}`, params).catch(() => null);
  let rows = normalizeEstimates(json, off);
  if (yr) rows = rows.filter((r) => r.year === yr);
  return rows;
}

// ── National trend ─────────────────────────────────────────────────────────────────────────────────
// National UCR/NIBRS trend for an offense over a window. `years` = [from, to] (inclusive) or omitted.
// Returns the normalized series [{ year, offense, count, ratePer100k }], oldest→newest. Soft-fails to [].
export async function nationalTrend({ offense = 'violent-crime', years } = {}) {
  const off = str(offense) || 'violent-crime';
  const [from, to] = Array.isArray(years) ? years : [];
  const params = {};
  if (num(from)) params.from = num(from);
  if (num(to)) params.to = num(to);
  const json = await cdeGet(`/estimate/national/${encodeURIComponent(off)}`, params).catch(() => null);
  let rows = normalizeEstimates(json, off);
  if (num(from)) rows = rows.filter((r) => r.year >= num(from));
  if (num(to)) rows = rows.filter((r) => r.year <= num(to));
  return rows;
}

// ── Reporting agencies ─────────────────────────────────────────────────────────────────────────────
// The law-enforcement agencies that report to UCR/NIBRS in a state. Normalized to
// [{ ori, name, agencyType, county, nibrs }]. Soft-fails to []. (ORI = the FBI's agency identifier.)
export async function agencies({ state } = {}) {
  const st = str(state).toUpperCase();
  if (!st) return [];
  const json = await cdeGet(`/agency/byStateAbbr/${encodeURIComponent(st)}`).catch(() => null);
  const arr = Array.isArray(json) ? json : (json && Array.isArray(json.results) ? json.results : null);
  if (!arr) return [];
  return arr.map((a) => ({
    ori: str(pick(a, 'ori', 'ORI')) || null,
    name: str(pick(a, 'agency_name', 'name')) || null,
    agencyType: str(pick(a, 'agency_type_name', 'agency_type', 'type')) || null,
    county: str(pick(a, 'county_name', 'county')) || null,
    nibrs: pick(a, 'is_nibrs', 'nibrs') === true || /^(true|y|yes|1)$/i.test(str(pick(a, 'is_nibrs', 'nibrs'))),
  })).filter((a) => a.ori || a.name);
}

// ── Headline summary ───────────────────────────────────────────────────────────────────────────────
// Pure aggregation over a normalized estimate series (no I/O). Reports the latest rate per 100k, the
// first/last of the window, the percent change, and a trend DIRECTION (rates, not raw counts).
export function summary(data) {
  const rows = (Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : []))
    .filter((r) => r && r.year != null)
    .sort((a, b) => a.year - b.year);
  if (!rows.length) {
    return { offense: null, latestYear: null, latestRate: null, firstRate: null, pctChange: null, trend: 'no data', points: 0, asOf: new Date().toISOString() };
  }
  const withRate = rows.filter((r) => r.ratePer100k != null);
  const first = withRate[0] || null;
  const last = withRate[withRate.length - 1] || null;
  let pctChange = null;
  if (first && last && first.ratePer100k) pctChange = Math.round(((last.ratePer100k / first.ratePer100k - 1) * 100) * 10) / 10;
  let trend = 'flat';
  if (pctChange == null) trend = 'insufficient data';
  else if (pctChange > 2) trend = 'rising';
  else if (pctChange < -2) trend = 'falling';
  return {
    offense: str(rows[rows.length - 1].offense) || null,
    latestYear: last ? last.year : rows[rows.length - 1].year,
    latestRate: last ? last.ratePer100k : null,
    firstRate: first ? first.ratePer100k : null,
    pctChange,
    trend,
    points: rows.length,
    asOf: new Date().toISOString(),
  };
}

// ── Provenance / reporting caveat note ─────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}; rates per 100k (not raw counts); voluntary agency reporting — coverage varies`;
}

const fmtInt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const fmtRate = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const fmtPct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(1) + '%');

// ── Render an escaped HTML crime-stats section ─────────────────────────────────────────────────────
// data = { title?, rows:[{ year, offense, count, ratePer100k }] } or just the rows array. EVERY
// interpolated value is HTML-escaped. The table emphasizes the rate per 100k; the raw count is shown
// secondary (muted). Always carries the voluntary-reporting caveat.
export function renderPage(data = {}) {
  const rows = (Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []))
    .filter((r) => r && r.year != null)
    .sort((a, b) => a.year - b.year);
  const title = str((data && !Array.isArray(data) && data.title) || (rows[0] && rows[0].offense) || 'Crime Statistics');
  const s = summary(rows);

  const arrow = s.trend === 'rising' ? '▲' : s.trend === 'falling' ? '▼' : '▬';
  const headline = rows.length
    ? `  <p class="headline"><strong>${esc(title)}</strong> — latest rate <strong>${esc(fmtRate(s.latestRate))}</strong> per 100,000 `
      + `(${esc(String(s.latestYear ?? '—'))}); trend <span class="trend ${esc(s.trend)}">${arrow} ${esc(s.trend)}</span>`
      + `${s.pctChange != null ? ` (${esc(fmtPct(s.pctChange))} over window)` : ''}.</p>`
    : '  <p class="headline">No statistics available.</p>';

  const bodyRows = rows.map((r) => (
    `<tr><td>${esc(String(r.year ?? '—'))}</td>`
    + `<td class="rate"><strong>${esc(fmtRate(r.ratePer100k))}</strong></td>`
    + `<td class="num muted">${esc(fmtInt(r.count))}</td></tr>`
  )).join('');
  const table = bodyRows
    ? '<table class="crime-stats"><thead><tr><th>Year</th><th>Rate / 100k</th><th class="muted">Count</th></tr></thead>'
      + `<tbody>${bodyRows}</tbody></table>`
    : '';

  return [
    '<section class="fbi-crime">',
    '  <h2>Crime Statistics</h2>',
    headline,
    table,
    '  <p class="caveat"><strong>Reporting caveat:</strong> UCR/NIBRS is <em>voluntary</em> agency reporting. '
      + 'Coverage varies by year and jurisdiction (the 2021 SRS→NIBRS transition left a national gap), and rates per '
      + '100,000 — not raw counts — are the honest comparison.</p>',
    `  <p class="note">${esc(dataNote(s.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/fbi-crime.mjs <state|national|agencies|page> [args] ───────────────
if (process.argv[1] && process.argv[1].endsWith('fbi-crime.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'state') {
    out('state crime', await stateCrime({ state: rest[0], year: num(rest[1]), offense: rest[2] || 'violent-crime' }));
  } else if (cmd === 'national') {
    const years = num(rest[1]) ? [num(rest[1]), num(rest[2]) || num(rest[1])] : undefined;
    out('national trend', await nationalTrend({ offense: rest[0] || 'violent-crime', years }));
  } else if (cmd === 'agencies') {
    out('agencies', (await agencies({ state: rest[0] })).slice(0, 25));
  } else if (cmd === 'page') {
    const rows = await stateCrime({ state: rest[0], offense: rest[1] || 'violent-crime' });
    console.log(renderPage({ rows }));
  } else {
    console.log('usage: fbi-crime.mjs <state ST [year] [offense] | national [offense] [from] [to] | agencies ST | page ST [offense]>');
  }
}
