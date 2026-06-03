// osha.mjs — the SoapBox OSHA workplace-safety enforcement reader. Surfaces OSHA establishment
// inspections / enforcement records so a SoapBox "local business intelligence" page can answer
// "has this employer been inspected / cited by OSHA?".
//
// ENDPOINT NOTE (read this before changing the URL): OSHA itself does NOT publish a stable, keyless,
// per-establishment JSON REST endpoint. The data lives in the U.S. Department of Labor's enforcement
// data platform. The DOL "Data Enforcement" API at
//   https://enforcedata.dol.gov/api/get   (params: ?query=…&format=json&tableName=osha_inspection…)
// fronts the same datasets and returns JSON, but its availability/shape has drifted over time and it is
// not guaranteed keyless-stable. We therefore implement against the DOL public-API response SHAPE (a
// rows/records array of OSHA inspection fields) with an injectable fetch + fixtures, so the reader is
// fully exercised offline and degrades to [] live if the endpoint is unavailable — it NEVER throws.
// (Bulk CSV downloads at enforcedata.dol.gov/views/data_summary.php remain the authoritative public
// fallback for batch ingestion; that path is out of scope for this live reader.)
//
// FREE / KEYLESS — no auth token. No secret ever lives in this file. Same shape as the sibling soapbox
// readers (fda-recalls.mjs / nhtsa.mjs): ESM, a __setFetch() seam for tests, graceful soft-fail. Every
// emitted record carries provenance (source / license: public-domain / fetchedAt) per v3 §6.
//
//   import { inspections, byEmployer, byState, summary, renderPage, dataNote } from './osha.mjs'
//   node integrations/soapbox/osha.mjs "ACME MANUFACTURING"

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// DOL enforcement-data API (OSHA inspections table). Keyless JSON. See ENDPOINT NOTE above for caveats.
export const ENDPOINT = 'https://enforcedata.dol.gov/api/get';
export const TABLE = 'osha_inspection';

// Provenance applied to every emitted record (v3 §6).
export const SOURCE = 'OSHA / U.S. DOL';
export const LICENSE = 'public-domain';

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const clean = (s) => String(s == null ? '' : s).trim();
const num = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);

// OSHA inspection dates arrive as "YYYY-MM-DD" or "MM/DD/YYYY" or an ISO timestamp. Render YYYY-MM-DD
// when we can; else pass the trimmed value through (null when empty).
function fmtDate(s) {
  const d = clean(s);
  if (!d) return null;
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return d;
}

// Build the request URL. The DOL API takes a free-text `query`, the `tableName`, and `format=json`.
// URLSearchParams encodes everything — we never interpolate raw input into the query grammar.
function buildUrl({ query = '', limit = 10 } = {}) {
  const p = new URLSearchParams();
  p.set('tableName', TABLE);
  p.set('format', 'json');
  p.set('limit', String(capLimit(limit)));
  const q = clean(query);
  if (q) p.set('query', q);
  return `${ENDPOINT}?${p.toString()}`;
}

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// The DOL API has returned its rows under a few keys across versions: a bare array, { data: [...] },
// { records: [...] }, or { results: [...] }. Accept any of them; anything else → [].
function extractRows(j) {
  if (Array.isArray(j)) return j;
  for (const k of ['data', 'records', 'results', 'rows']) if (Array.isArray(j?.[k])) return j[k];
  return [];
}

// Normalize one OSHA inspection record into the SoapBox row shape, tolerating both lower-case and
// upper-case field-name conventions the DOL platform has used. Every row carries provenance.
function normalize(r, fetchedAt) {
  const pick = (...keys) => { for (const k of keys) { const v = clean(r?.[k]); if (v) return v; } return ''; };
  const violations = pick('nr_in_violation', 'total_violations', 'nr_violations');
  const penalty = pick('total_current_penalty', 'current_penalty', 'penalty');
  return {
    activityId: pick('activity_nr', 'activity_id', 'inspection_nr') || null,
    employer: pick('estab_name', 'establishment_name', 'employer') || null,
    site: pick('site_address', 'address', 'site_city') || null,
    city: pick('site_city', 'city') || null,
    state: pick('site_state', 'state') || null,
    zip: pick('site_zip', 'zip') || null,
    naics: pick('naics_code', 'naics') || null,
    inspectionType: pick('insp_type', 'inspection_type', 'safety_hlth') || null,
    openDate: fmtDate(pick('open_date', 'inspection_date', 'open_dt')),
    closeDate: fmtDate(pick('close_conf_date', 'close_case_date', 'close_date')),
    violations: violations ? num(violations, null) : null,
    penalty: penalty ? num(penalty, null) : null,
    source: SOURCE,
    license: LICENSE,
    fetchedAt,
  };
}

// ── inspections({ query, limit }): the core reader ───────────────────────────────────────────────────
// Fetches OSHA inspection records (optionally filtered by a free-text employer/keyword query),
// normalized to the SoapBox row, capped to `limit`. Soft-fails to [].
export async function inspections({ query = '', limit = 10 } = {}) {
  const fetchedAt = new Date().toISOString();
  const j = await getJSON(buildUrl({ query, limit }));
  const rows = extractRows(j);
  if (!rows.length) return [];
  return rows.map((r) => normalize(r, fetchedAt)).slice(0, capLimit(limit));
}

// ── byEmployer(name): inspections for a named employer (client-side filtered, case-insensitive) ──────
export async function byEmployer(name, { limit = 50 } = {}) {
  const needle = clean(name).toLowerCase();
  if (!needle) return [];
  const all = await inspections({ query: clean(name), limit: 100 });
  return all.filter((r) => String(r.employer || '').toLowerCase().includes(needle)).slice(0, capLimit(limit));
}

// ── byState(state): inspections in a given state (2-letter, case-insensitive) ────────────────────────
export async function byState(state, { limit = 50 } = {}) {
  const needle = clean(state).toUpperCase();
  if (!needle) return [];
  const all = await inspections({ limit: 100 });
  return all.filter((r) => String(r.state || '').toUpperCase() === needle).slice(0, capLimit(limit));
}

// ── summary({ query }): small dashboard — inspection count + total penalties + by-type tally ─────────
// Soft-fails to a zeroed dashboard; never throws. Always carries provenance.
export async function summary({ query = '', limit = 50 } = {}) {
  const rows = await inspections({ query, limit }).catch(() => []);
  const byType = {};
  let totalPenalty = 0;
  let totalViolations = 0;
  for (const r of rows) {
    const t = r.inspectionType || 'Unclassified';
    byType[t] = (byType[t] || 0) + 1;
    if (r.penalty != null) totalPenalty += r.penalty;
    if (r.violations != null) totalViolations += r.violations;
  }
  return {
    source: SOURCE,
    license: LICENSE,
    asOf: new Date().toISOString(),
    total: rows.length,
    totalViolations,
    totalPenalty,
    byType,
  };
}

// ── dataNote(): provenance + disclaimer ──────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: OSHA enforcement data via U.S. Department of Labor, public domain, as of ${asOf}. ` +
    `Inspection records are as filed and may be updated or contested; not legal advice.`;
}

// ── renderPage(data): escaped HTML inspections table for the SoapBox site ────────────────────────────
// `data` is { inspections: [...normalized rows...] } (or a bare array). EVERY field is escaped before it
// reaches markup — a hostile employer/site/state string cannot inject HTML.
export function renderPage(data = {}) {
  const list = Array.isArray(data.inspections) ? data.inspections
    : Array.isArray(data) ? data : [];
  const rows = list.map((r) => `      <tr>
        <td>${esc(r.employer)}</td>
        <td>${esc(r.city)}</td>
        <td>${esc(r.state)}</td>
        <td>${esc(r.inspectionType)}</td>
        <td>${esc(r.openDate)}</td>
        <td>${esc(r.violations)}</td>
        <td>${esc(r.penalty)}</td>
      </tr>`).join('\n');
  const body = rows || '      <tr><td colspan="7">No inspections found.</td></tr>';
  return `<section class="osha-inspections">
  <h2>OSHA Workplace-Safety Inspections</h2>
  <table>
    <thead>
      <tr><th>Employer</th><th>City</th><th>State</th><th>Type</th><th>Opened</th><th>Violations</th><th>Penalty</th></tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/osha.mjs <employer or keyword> ────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('osha.mjs')) {
  const q = process.argv.slice(2).join(' ');
  const [list, sum] = await Promise.all([inspections({ query: q, limit: 10 }), summary({ query: q })]);
  console.log(`\n# OSHA inspections${q ? `: ${q}` : ''}\n`);
  for (const r of list.slice(0, 10)) {
    console.log(`  - ${(r.employer || '?').slice(0, 50)} [${r.state || '?'}] ${r.openDate || ''} viol=${r.violations ?? '?'} pen=${r.penalty ?? '?'}`);
  }
  console.log('\nSummary by type:', JSON.stringify(sum.byType), '| total penalty:', sum.totalPenalty);
  console.log('\n' + dataNote());
}
