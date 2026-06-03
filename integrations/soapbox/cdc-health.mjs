// cdc-health.mjs — the SoapBox Public-Health vertical. A reader over the CDC's free open data on
// data.cdc.gov (a Socrata portal — keyless for light use; an app-token RAISES the rate limit but is
// NOT required) plus the respiratory/flu surveillance datasets the CDC publishes there. It surfaces
// public-health statistics: disease surveillance, vaccination coverage, mortality / leading causes of
// death, and the current respiratory-illness activity level by state.
//
// This is DISTINCT from pharma.mjs (drug identity / labels / adverse events / trials). Pharma answers
// "what is this drug"; this answers "what's the public-health picture" — population stats, not advice.
//
// Pattern follows public-safety.mjs + treasury-fiscal.mjs: ESM, an injectable __setFetch() seam, every
// reader SOFT-FAILS (returns null / [] — never throws), as-of timestamps from the rows, a guarded CLI,
// HTML-escaped rendering, and NO secrets — the Socrata app token is referenced by env NAME only and is
// optional. INFORMATIONAL ONLY: population statistics, NOT medical advice.
//
//   import { respiratoryLevels, leadingCauses, vaccination, dataset,
//            summary, renderPage, dataNote } from './cdc-health.mjs'
//   node integrations/soapbox/cdc-health.mjs resp California

import { cached, TTL } from './cache.mjs';

const DOMAIN = 'data.cdc.gov';
const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
const SOURCE = 'CDC (data.cdc.gov)';

// Env NAME of the optional Socrata app token. We read process.env BY THIS NAME — there is no literal
// token in this file, and a missing token simply means we hit the keyless (lower) rate limit.
export const APP_TOKEN_ENV = 'SOCRATA_APP_TOKEN';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Curated data.cdc.gov resource ids per reader. If the CDC retires/renames a dataset, the reader using
// it simply soft-fails (the generic dataset() helper still works against any resource id you pass it).
export const RESOURCES = {
  // Respiratory Virus Activity Levels by jurisdiction (weekly). Column names below match the public set;
  // we normalize whatever shape comes back so a column rename degrades gracefully.
  respiratory: 'kvib-3txy',
  // NCHS — Leading Causes of Death (United States), by year + state + cause.
  leadingCauses: '9bhg-hcku',
  // Vaccination coverage (e.g. flu/COVID) by state. Generic — `vaccination()` filters by name + state.
  vaccination: 'vh55-3he6',
};

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Escape for safe HTML interpolation (strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ── Generic Socrata query helper — the reusable core ─────────────────────────────────────────────────
// Build a SODA query against any data.cdc.gov resource and return the rows array. `where` → $where,
// `limit` → $limit, `order` → $order, `select` → $select. The optional app token is sent as the
// X-App-Token header ONLY when its env var is set (read by name; never a literal). Soft-fails to [].
export async function dataset(resourceId, { where, limit = 50, order, select } = {}) {
  const id = str(resourceId);
  if (!id) return [];
  const lim = Math.max(1, Math.min(50000, num(limit) || 50));
  return cached(`cdc:dataset:${id}:${where || ''}:${order || ''}:${select || ''}:${lim}`, TTL.list, async () => {
    try {
      const u = new URL(`https://${DOMAIN}/resource/${id}.json`);
      u.searchParams.set('$limit', String(lim));
      if (where) u.searchParams.set('$where', where);
      if (order) u.searchParams.set('$order', order);
      if (select) u.searchParams.set('$select', select);
      const headers = { 'user-agent': UA, accept: 'application/json' };
      const token = process.env[APP_TOKEN_ENV];
      if (token) headers['X-App-Token'] = token; // optional — raises the rate limit; keyless still works
      const r = await _fetch(u.toString(), { headers });
      if (!r || !r.ok) return [];
      const rows = await r.json();
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }
  });
}

// Pick the first present value among candidate column names (Socrata datasets vary in naming).
const pick = (row, ...keys) => { for (const k of keys) { if (row && row[k] != null && row[k] !== '') return row[k]; } return null; };

// ── Respiratory / flu activity level by state ────────────────────────────────────────────────────────
// Current respiratory-illness activity level for one state, normalized to { state, level, week, asOf }.
// Soft-fails to null (no usable row → null).
export async function respiratoryLevels({ state } = {}) {
  const want = str(state);
  if (!want) return null;
  const where = `upper(geographic_name)=upper('${want.replace(/'/g, "''")}') OR upper(state)=upper('${want.replace(/'/g, "''")}')`;
  const rows = await dataset(RESOURCES.respiratory, { where, order: 'week_end DESC', limit: 50 }).catch(() => []);
  const row = rows[0];
  if (!row) return null;
  const level = pick(row, 'activity_level_label', 'activity_level', 'level', 'value');
  if (level == null) return null;
  return {
    state: str(pick(row, 'geographic_name', 'state', 'jurisdiction')) || want,
    level: str(level),
    week: str(pick(row, 'week_end', 'week', 'weekend', 'date')) || null,
    asOf: new Date().toISOString(),
  };
}

// ── Leading causes of death ──────────────────────────────────────────────────────────────────────────
// NCHS leading-causes dataset, optionally filtered by state + year. Normalized to
// [{ cause, deaths, rate }], soft-fails to []. Drops the synthetic "All causes" aggregate row.
export async function leadingCauses({ state, year } = {}) {
  const clauses = [];
  const st = str(state);
  const yr = num(year);
  if (st && st.toLowerCase() !== 'united states' && st.toLowerCase() !== 'us') {
    clauses.push(`upper(state)=upper('${st.replace(/'/g, "''")}')`);
  }
  if (yr) clauses.push(`year=${yr}`);
  const where = clauses.length ? clauses.join(' AND ') : undefined;
  const rows = await dataset(RESOURCES.leadingCauses, { where, order: 'year DESC', limit: 200 }).catch(() => []);
  return rows
    .map((d) => ({
      cause: str(pick(d, 'cause_name', 'leading_cause', 'cause')),
      deaths: num(pick(d, 'deaths', 'count')),
      rate: num(pick(d, 'aadr', 'age_adjusted_death_rate', 'rate')),
      year: num(pick(d, 'year')) ,
      state: str(pick(d, 'state', 'jurisdiction')) || null,
    }))
    .filter((x) => x.cause && !/^all causes$/i.test(x.cause) && (x.deaths != null || x.rate != null))
    .map(({ cause, deaths, rate }) => ({ cause, deaths, rate }));
}

// ── Vaccination coverage ─────────────────────────────────────────────────────────────────────────────
// Vaccination coverage for a state, optionally filtered to a vaccine name (case-insensitive contains,
// applied client-side so dataset column variance doesn't break the query). Normalized list, soft to [].
export async function vaccination({ state, vaccine } = {}) {
  const st = str(state);
  const vax = str(vaccine).toLowerCase();
  const where = st ? `upper(geography)=upper('${st.replace(/'/g, "''")}') OR upper(state)=upper('${st.replace(/'/g, "''")}')` : undefined;
  const rows = await dataset(RESOURCES.vaccination, { where, limit: 200 }).catch(() => []);
  return rows
    .map((d) => ({
      vaccine: str(pick(d, 'vaccine', 'biologics', 'dose')),
      state: str(pick(d, 'geography', 'state', 'jurisdiction')) || st || null,
      group: str(pick(d, 'group_name', 'demographic', 'age_group', 'dimension')) || null,
      coverage: num(pick(d, 'coverage_estimate', 'estimate_pct', 'coverage', 'estimate')),
      season: str(pick(d, 'season_survey_year', 'season', 'year')) || null,
    }))
    .filter((x) => x.vaccine && x.coverage != null)
    .filter((x) => !vax || x.vaccine.toLowerCase().includes(vax));
}

// ── Headline snapshot ────────────────────────────────────────────────────────────────────────────────
// Small health snapshot from already-fetched data (pure aggregation — no I/O). Accepts whatever the page
// gathered: { respiratory:{level,...}, causes:[...], vaccinations:[...] }.
export function summary(data = {}) {
  const causes = Array.isArray(data.causes) ? data.causes : [];
  const vax = Array.isArray(data.vaccinations) ? data.vaccinations : [];
  const resp = data.respiratory || null;
  const totalDeaths = causes.reduce((s, c) => s + (c.deaths || 0), 0);
  const topCause = causes.slice().sort((a, b) => (b.deaths || 0) - (a.deaths || 0))[0] || null;
  const avgCoverage = vax.length
    ? vax.reduce((s, v) => s + (v.coverage || 0), 0) / vax.length
    : null;
  return {
    respiratoryLevel: resp ? str(resp.level) || null : null,
    respiratoryState: resp ? str(resp.state) || null : null,
    causeCount: causes.length,
    totalDeaths,
    topCause: topCause ? topCause.cause : null,
    vaccinationCount: vax.length,
    avgCoverage: avgCoverage != null ? Math.round(avgCoverage * 10) / 10 : null,
    asOf: new Date().toISOString(),
  };
}

// ── Provenance / disclaimer note ─────────────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}; informational, not medical advice`;
}

const fmtInt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const fmtRate = (n) => (n == null ? '—' : Number(n).toFixed(1));
const fmtPct = (n) => (n == null ? '—' : Number(n).toFixed(1) + '%');

// ── Render an escaped HTML section ───────────────────────────────────────────────────────────────────
// data = { respiratory:{state,level,week}, causes:[{cause,deaths,rate}], vaccinations:[{vaccine,coverage,...}] }.
// EVERY interpolated value is HTML-escaped. Returns a self-contained <section>.
export function renderPage(data = {}) {
  const resp = data.respiratory || null;
  const causes = Array.isArray(data.causes) ? data.causes : [];
  const vax = Array.isArray(data.vaccinations) ? data.vaccinations : [];
  const s = summary(data);

  const respBlock = resp
    ? `  <p class="respiratory"><strong>Respiratory activity — ${esc(resp.state || '')}:</strong> `
      + `${esc(str(resp.level) || '—')}${resp.week ? ` <span class="asof">(week ending ${esc(str(resp.week))})</span>` : ''}</p>`
    : '';

  const causeRows = causes.slice(0, 12).map((c) => (
    `<tr><td>${esc(c.cause)}</td><td class="num">${esc(fmtInt(c.deaths))}</td><td class="num">${esc(fmtRate(c.rate))}</td></tr>`
  )).join('');
  const causeTable = causeRows
    ? '  <h3>Leading causes of death</h3>'
      + '<table class="causes"><thead><tr><th>Cause</th><th>Deaths</th><th>Rate*</th></tr></thead>'
      + `<tbody>${causeRows}</tbody></table>`
    : '';

  const vaxRows = vax.slice(0, 12).map((v) => (
    `<tr><td>${esc(v.vaccine)}</td><td>${esc(v.group || '')}</td><td class="num">${esc(fmtPct(v.coverage))}</td></tr>`
  )).join('');
  const vaxTable = vaxRows
    ? '  <h3>Vaccination coverage</h3>'
      + '<table class="vax"><thead><tr><th>Vaccine</th><th>Group</th><th>Coverage</th></tr></thead>'
      + `<tbody>${vaxRows}</tbody></table>`
    : '';

  return [
    '<section class="cdc-health">',
    '  <h2>Public-Health Snapshot</h2>',
    respBlock,
    s.topCause ? `  <p class="figure">Top cause of death: <strong>${esc(s.topCause)}</strong></p>` : '',
    causeTable,
    vaxTable,
    '  <p class="disclaimer">Informational only — population statistics, not medical advice.</p>',
    `  <p class="note">${esc(dataNote(s.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/cdc-health.mjs <resp|causes|vax|page> [state] [year] ──────────────
if (process.argv[1] && process.argv[1].endsWith('cdc-health.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const state = rest[0] || '';
  const year = num(rest[1]);
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'resp') out('respiratory', await respiratoryLevels({ state }));
  else if (cmd === 'causes') out('leading causes', await leadingCauses({ state, year }));
  else if (cmd === 'vax') out('vaccination', await vaccination({ state }));
  else if (cmd === 'page') {
    const [respiratory, causes, vaccinations] = await Promise.all([
      respiratoryLevels({ state }).catch(() => null),
      leadingCauses({ state, year }).catch(() => []),
      vaccination({ state }).catch(() => []),
    ]);
    console.log(renderPage({ respiratory, causes, vaccinations }));
  } else console.log('usage: cdc-health.mjs <resp [state]|causes [state] [year]|vax [state]|page [state] [year]>');
}
