// workplace-safety.mjs — SoapBox "Know Your Workplace" vertical: a reader over free US Department of
// Labor data so a worker can look up the safety + wage record behind any employer or industry.
// Three public DOL data families, every one soft-fails (a dead source returns [] / null, never throws):
//
//   1. OSHA enforcement inspections — Occupational Safety & Health Administration inspection /
//      enforcement records (violations + proposed penalties) from the DOL Enforcement Data API.
//   2. Wage & Hour Division (WHD) violations — back-wages owed + employees affected, from the DOL
//      WHD compliance-action dataset.
//   3. BLS workplace injury/illness rates — the recordable-case rate for an industry (reuses an
//      existing BLS client if one is present in the repo; otherwise calls the keyless BLS public API).
//
// The DOL Enforcement Data API is keyless for light use; a free DOL key (env DOL_API_KEY) lifts the
// quota and, when present, is sent as the X-API-KEY header. The key is referenced BY ENV NAME ONLY —
// never hard-coded, never logged, never printed. INFORMATIONAL ONLY — this is not legal advice.
//
// Follows the macro.mjs / legal.mjs / public-safety.mjs pattern: ESM, __setFetch hook for tests,
// soft-fail everywhere, HTML-escaped render, CLI guarded by an argv check.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// DOL public data hosts. apiprod.dol.gov hosts the Enforcement Data API (OSHA, WHD, MSHA datasets);
// api.bls.gov hosts the keyless BLS public-data API.
const DOL_BASE = 'https://apiprod.dol.gov/v4';
const BLS_BASE = 'https://api.bls.gov/publicAPI/v2';

// ---- PURE helpers (no I/O — directly unit-tested) --------------------------------------------------

/** Minimal HTML-escape (matches the convention in the sibling soapbox modules). */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

/** DOL request headers. Adds the API key as X-API-KEY only when DOL_API_KEY is set (never logged). */
function dolHeaders() {
  const h = { 'user-agent': UA, accept: 'application/json' };
  const key = process.env.DOL_API_KEY;
  if (key) h['x-api-key'] = key;
  return h;
}

async function getJson(url, headers) {
  try {
    const r = await _fetch(url, { headers: headers || { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// The DOL Enforcement API wraps results differently across datasets; pull the row array out of any of
// the common envelopes (top-level array, { data: [] }, { results: [] }, { records: [] }). PURE.
function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

/** Normalize ONE raw OSHA inspection row onto our shape (tolerant of column-name variants). PURE. */
export function normalizeInspection(row) {
  if (!row || typeof row !== 'object') return null;
  const norm = {
    employer: row.estab_name ?? row.establishment_name ?? row.employer ?? row.name ?? null,
    city: row.site_city ?? row.city ?? null,
    state: row.site_state ?? row.state ?? null,
    date: row.open_date ?? row.activity_date ?? row.date ?? row.case_open_date ?? null,
    violations: num(row.nr_violations ?? row.violations ?? row.total_violations) ?? 0,
    penalty: num(row.total_current_penalty ?? row.penalty ?? row.current_penalty) ?? 0,
  };
  // a row with no employer AND no usable activity isn't worth surfacing
  if (norm.employer == null && norm.violations === 0 && norm.penalty === 0 && norm.date == null) return null;
  return norm;
}

/** Normalize ONE raw WHD violation row (back-wages + employees affected). PURE. */
export function normalizeWhd(row) {
  if (!row || typeof row !== 'object') return null;
  const norm = {
    employer: row.legal_name ?? row.trade_name ?? row.employer ?? row.name ?? null,
    city: row.cty_nm ?? row.city ?? null,
    state: row.st_cd ?? row.state ?? null,
    backWages: num(row.bw_atp_amt ?? row.back_wages ?? row.backwages ?? row.amount) ?? 0,
    employeesAffected: num(row.ee_atp_cnt ?? row.employees_affected ?? row.ee_violated_cnt) ?? 0,
    violationCount: num(row.violtn_cnt ?? row.violations ?? row.violation_count) ?? 0,
  };
  if (norm.employer == null && norm.backWages === 0 && norm.employeesAffected === 0) return null;
  return norm;
}

// ---- network feeders (soft-fail) ------------------------------------------------------------------

/**
 * OSHA enforcement inspections, optionally filtered by state / NAICS industry code.
 * Returns normalized rows [{ employer, city, state, date, violations, penalty }]. Soft-fails to [].
 */
export async function oshaInspections({ state, naics, limit = 25 } = {}) {
  const u = new URL(`${DOL_BASE}/get/osha/inspection`);
  u.searchParams.set('limit', String(limit));
  if (state) u.searchParams.set('filter_object', JSON.stringify({ field: 'site_state', operator: 'eq', value: String(state).toUpperCase() }));
  if (naics) u.searchParams.set('naics', String(naics));
  const data = await getJson(u.toString(), dolHeaders());
  if (data == null) return [];
  return rowsOf(data).slice(0, limit).map(normalizeInspection).filter(Boolean);
}

/**
 * Wage & Hour Division compliance actions (violations), optionally filtered by state.
 * Returns normalized rows with back-wages + employees affected. Soft-fails to [].
 */
export async function whdViolations({ state, limit = 25 } = {}) {
  const u = new URL(`${DOL_BASE}/get/whd/whisard`);
  u.searchParams.set('limit', String(limit));
  if (state) u.searchParams.set('filter_object', JSON.stringify({ field: 'st_cd', operator: 'eq', value: String(state).toUpperCase() }));
  const data = await getJson(u.toString(), dolHeaders());
  if (data == null) return [];
  return rowsOf(data).slice(0, limit).map(normalizeWhd).filter(Boolean);
}

// BLS series ids for the headline private-industry recordable injury/illness rate, keyed by a coarse
// industry label. The series carry the total recordable-cases incidence rate. Defensive: if the repo
// later grows a richer BLS client we prefer it (see injuryRates).
export const INJURY_SERIES = {
  'all private industry': 'ISU00000000000000031000',
  'construction': 'ISU23000000000000031000',
  'manufacturing': 'ISU31000000000000031000',
  'healthcare': 'ISU62000000000000031000',
  'retail': 'ISU44000000000000031000',
  'transportation': 'ISU48000000000000031000',
};

/**
 * BLS workplace injury/illness recordable-case rate for an industry.
 * Defensive: tries to reuse an existing BLS client in the repo (a `blsSeries` export from a sibling
 * `bls.mjs`, if present); otherwise calls the keyless BLS public API directly. Returns
 * { industry, series, rate, year } or { industry, series, rate: null } on any failure. Never throws.
 */
export async function injuryRates({ industry = 'all private industry' } = {}) {
  const key = String(industry).toLowerCase();
  const series = INJURY_SERIES[key] || INJURY_SERIES['all private industry'];
  const fail = { industry, series, rate: null, year: null };

  // 1) Reuse an existing BLS client if the repo has one (best-effort, never throws).
  try {
    const mod = await import('./bls.mjs').catch(() => null);
    if (mod && typeof mod.blsSeries === 'function') {
      const out = await mod.blsSeries(series).catch(() => null);
      const v = out?.[0] ?? out;
      const rate = num(v?.value ?? v?.rate);
      if (rate != null) return { industry, series, rate, year: v?.year ?? v?.period ?? null };
    }
  } catch { /* fall through to direct call */ }

  // 2) Direct keyless BLS public-data API call.
  const headers = { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' };
  const reqKey = process.env.BLS_API_KEY; // optional; lifts quota. Referenced by name only, never logged.
  const body = JSON.stringify(reqKey ? { seriesid: [series], registrationkey: reqKey } : { seriesid: [series] });
  try {
    const r = await _fetch(`${BLS_BASE}/timeseries/data/`, { method: 'POST', headers, body });
    if (!r || !r.ok) return fail;
    const data = await r.json();
    const ser = data?.Results?.series?.[0];
    const point = Array.isArray(ser?.data) ? ser.data[0] : null;
    const rate = num(point?.value);
    if (rate == null) return fail;
    return { industry, series, rate, year: point?.year ?? null };
  } catch { return fail; }
}

/**
 * Small dashboard roll-up: recent inspection counts + total proposed penalties, plus WHD totals and
 * the headline all-industry injury rate. Each source soft-fails independently, so summary() always
 * returns a well-formed object.
 */
export async function summary({ state, limit = 25 } = {}) {
  const [insp, whd, inj] = await Promise.all([
    oshaInspections({ state, limit }).catch(() => []),
    whdViolations({ state, limit }).catch(() => []),
    injuryRates({ industry: 'all private industry' }).catch(() => ({ rate: null })),
  ]);
  const totalPenalties = insp.reduce((s, r) => s + (num(r.penalty) || 0), 0);
  const totalViolations = insp.reduce((s, r) => s + (num(r.violations) || 0), 0);
  const totalBackWages = whd.reduce((s, r) => s + (num(r.backWages) || 0), 0);
  const employeesAffected = whd.reduce((s, r) => s + (num(r.employeesAffected) || 0), 0);
  return {
    state: state ? String(state).toUpperCase() : null,
    inspectionCount: insp.length,
    totalViolations,
    totalPenalties: Math.round(totalPenalties * 100) / 100,
    whdActionCount: whd.length,
    totalBackWages: Math.round(totalBackWages * 100) / 100,
    employeesAffected,
    injuryRate: inj?.rate ?? null,
    asOf: new Date().toISOString(),
  };
}

const money = (n) => {
  const v = num(n);
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

/**
 * Render an escaped HTML section from a { inspections, whd, injury, summary } bundle (any field
 * optional). Every interpolated value is run through esc() so a malicious employer name is inert.
 */
export function renderPage(data = {}) {
  const inspections = Array.isArray(data.inspections) ? data.inspections : [];
  const whd = Array.isArray(data.whd) ? data.whd : [];
  const injury = data.injury || null;
  const s = data.summary || null;

  const rows = (list, cells) => list.map((r) => `<tr>${cells(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');

  const inspBlock = inspections.length
    ? `<table class="osha-inspections"><thead><tr><th>Employer</th><th>City</th><th>State</th><th>Date</th><th>Violations</th><th>Penalty</th></tr></thead><tbody>${
        rows(inspections, (r) => [r.employer || '—', r.city || '—', r.state || '—', r.date || '—', r.violations ?? 0, money(r.penalty)])
      }</tbody></table>`
    : '<p>No OSHA inspection records to show.</p>';

  const whdBlock = whd.length
    ? `<table class="whd-violations"><thead><tr><th>Employer</th><th>City</th><th>State</th><th>Back wages</th><th>Employees affected</th></tr></thead><tbody>${
        rows(whd, (r) => [r.employer || '—', r.city || '—', r.state || '—', money(r.backWages), r.employeesAffected ?? 0])
      }</tbody></table>`
    : '<p>No Wage &amp; Hour records to show.</p>';

  const injBlock = injury && injury.rate != null
    ? `<p class="injury-rate">Recordable injury/illness rate for <strong>${esc(injury.industry)}</strong>: <strong>${esc(injury.rate)}</strong> per 100 full-time workers${injury.year ? ` (${esc(injury.year)})` : ''}.</p>`
    : '<p class="injury-rate">Injury/illness rate unavailable.</p>';

  const summaryBlock = s
    ? `<p class="ws-summary">${esc(s.inspectionCount)} inspections · ${esc(s.totalViolations)} violations · ${esc(money(s.totalPenalties))} proposed penalties · ${esc(money(s.totalBackWages))} back wages owed to ${esc(s.employeesAffected)} workers.</p>`
    : '';

  return `<section class="workplace-safety">
  <h2>Know Your Workplace</h2>
  ${summaryBlock}
  <h3>OSHA inspections</h3>
  ${inspBlock}
  <h3>Wage &amp; Hour violations</h3>
  ${whdBlock}
  <h3>Industry injury rate</h3>
  ${injBlock}
  <footer class="data-note">${dataNote().text}</footer>
</section>`;
}

/** Provenance + the informational/not-legal-advice disclaimer. */
export function dataNote() {
  return {
    sources: [
      { name: 'OSHA Enforcement Data (US Dept of Labor)', url: 'https://enforcedata.dol.gov/' },
      { name: 'Wage & Hour Division compliance actions (DOL)', url: 'https://enforcedata.dol.gov/' },
      { name: 'BLS workplace injury & illness rates', url: 'https://www.bls.gov/iif/' },
    ],
    keyless: true, // works without a key; DOL_API_KEY / BLS_API_KEY only lift quotas (env name only)
    asOf: new Date().toISOString(),
    text: 'Source: US Department of Labor (OSHA enforcement + Wage & Hour Division) and the Bureau of '
      + 'Labor Statistics injury/illness data. Informational only — this is not legal advice. '
      + 'Records can be incomplete, delayed, or under appeal; verify with the primary source before acting.',
  };
}

if (process.argv[1] && process.argv[1].endsWith('workplace-safety.mjs')) {
  const state = process.argv[2] || undefined;
  const [insp, whd, inj, s] = await Promise.all([
    oshaInspections({ state, limit: 5 }),
    whdViolations({ state, limit: 5 }),
    injuryRates({}),
    summary({ state, limit: 25 }),
  ]);
  console.log(`\nWorkplace safety${state ? ` — ${state}` : ''}`);
  console.log(`  inspections: ${s.inspectionCount}, violations: ${s.totalViolations}, penalties: ${money(s.totalPenalties)}`);
  console.log(`  WHD actions: ${s.whdActionCount}, back wages: ${money(s.totalBackWages)} to ${s.employeesAffected} workers`);
  console.log(`  injury rate (all private industry): ${inj.rate ?? 'n/a'}`);
  for (const r of insp.slice(0, 3)) console.log(`  OSHA: ${r.employer || '?'} (${r.city || '?'}, ${r.state || '?'}) — ${r.violations} viol, ${money(r.penalty)}`);
  for (const r of whd.slice(0, 3)) console.log(`  WHD:  ${r.employer || '?'} — ${money(r.backWages)} to ${r.employeesAffected} workers`);
  console.log('\n' + dataNote().text);
}
