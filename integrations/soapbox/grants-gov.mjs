// grants-gov.mjs — the SoapBox Grants.gov opportunity reader. Reads the Grants.gov Search2 API
// (api.grants.gov/v1/api/search2) — a fully KEYLESS JSON POST endpoint — for federal grant
// opportunities by keyword, agency, and status. Powers the honest Benefits Navigator (/benefits):
// it surfaces REAL, official grant opportunities, normalized into one clean row shape.
//
//   Search2 takes a JSON POST body { keyword, rows, oppStatuses, agencies?, ... } and returns
//   { data: { oppHits: [ { id, number, title, agencyName, agencyCode, openDate, closeDate,
//     oppStatus, docType, ... } ], hitCount, ... }, errorcode, msg }.
//
// Pattern matches worldbank.mjs / fed-opportunities.mjs: ESM, zero deps, keyless-first, __setFetch
// seam, graceful soft-fail (return []/{} on error, NEVER throw), guarded CLI block, escaped rendered
// HTML, no secrets, provenance (source + fetched_at) on every row.
//
//   import { search, byAgency, normalizeHit, OPP_STATUSES, renderPage, dataNote } from './grants-gov.mjs'
//   node integrations/soapbox/grants-gov.mjs "high tunnel"
//   node integrations/soapbox/grants-gov.mjs "water" --agency USDA --status posted

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Grants.gov asks nothing of clients (keyless); identify ourselves anyway, like the sibling modules.
const UA = { 'User-Agent': 'SoapBoxGrantsGov/1.0 (+https://data.soapbox.community)' };

export const ENDPOINT = 'https://api.grants.gov/v1/api/search2';

// Valid Search2 opportunity statuses (pipe-joined in the request body).
export const OPP_STATUSES = ['forecasted', 'posted', 'closed', 'archived'];

// ---- pure helpers (unit-tested offline) ----

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const now = () => new Date().toISOString();
const capRows = (n) => Math.max(1, Math.min(100, num(n) || 25));

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Normalize a caller-supplied status list/string into a clean "posted|forecasted" pipe string.
// Unknown statuses are dropped; empty input defaults to the live (forecasted|posted) set.
export function normalizeStatuses(input) {
  let list;
  if (Array.isArray(input)) list = input;
  else if (str(input)) list = String(input).split(/[|,\s]+/);
  else list = [];
  const clean = list.map((s) => str(s).toLowerCase()).filter((s) => OPP_STATUSES.includes(s));
  return (clean.length ? clean : ['forecasted', 'posted']).join('|');
}

// Normalize one Search2 oppHit → a clean grant row with provenance. PURE; soft-handles loose shapes.
export function normalizeHit(g = {}) {
  const id = str(g.id);
  const number = str(g.number || g.opportunityNumber);
  return {
    type: 'grant',
    id: id || null,
    title: str(g.title) || null,
    agency: str(g.agencyName || g.agency || g.agencyCode) || null,
    agency_code: str(g.agencyCode) || null,
    opportunity_number: number || null,
    status: str(g.oppStatus || g.docType) || null,
    open_date: str(g.openDate) || null,
    close_date: str(g.closeDate) || null,
    url: (id || number)
      ? `https://www.grants.gov/search-results-detail/${encodeURIComponent(id || number)}`
      : null,
    source: 'Grants.gov',
    fetched_at: now(),
  };
}

// ---- live data (keyless; soft-fails to []) ----

/**
 * Search grant opportunities by keyword/agency/status. Returns normalized rows (or [] on any
 * failure). Search2 is a keyless JSON POST.
 * @param {{keyword?:string, agency?:string, status?:string|string[], limit?:number}} opts
 *   agency = agency code/name filter (e.g. 'USDA'); status = one or more of OPP_STATUSES.
 */
export async function search({ keyword = '', agency = '', status = '', limit = 25 } = {}) {
  try {
    const body = {
      keyword: str(keyword),
      rows: capRows(limit),
      oppStatuses: normalizeStatuses(status),
    };
    const ag = str(agency);
    if (ag) body.agencies = [ag];
    const r = await _fetch(ENDPOINT, {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.data?.oppHits;
    if (!Array.isArray(rows)) return [];
    return rows.map(normalizeHit);
  } catch { return []; }
}

/** Convenience: opportunities filtered to one agency. Soft-fails to []. */
export async function byAgency(agency, { keyword = '', status = '', limit = 25 } = {}) {
  if (!str(agency)) return [];
  return search({ keyword, agency, status, limit });
}

// ---- rendering ----

/** Escaped HTML table of grant opportunities. PURE; soft-handles missing fields. */
export function renderPage(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const body = list.map((g) => `      <tr>
        <td>${g.url ? `<a href="${esc(g.url)}">${esc(g.title)}</a>` : esc(g.title)}</td>
        <td>${esc(g.agency)}</td>
        <td>${esc(g.opportunity_number)}</td>
        <td>${esc(g.status)}</td>
        <td>${esc(g.close_date)}</td>
      </tr>`).join('\n');
  const tbody = body || '      <tr><td colspan="5">No grant opportunities found.</td></tr>';
  return `<section class="grants-gov">
  <h2>Grants.gov — Federal Grant Opportunities</h2>
  <table>
    <thead>
      <tr><th>Title</th><th>Agency</th><th>Number</th><th>Status</th><th>Close Date</th></tr>
    </thead>
    <tbody>
${tbody}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

/** Provenance line — names Grants.gov + the verify-before-applying caveat. */
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: Grants.gov Search2 (keyless), as of ${asOf}. Opportunities are as published and may ` +
    `close or change; read each opportunity's eligibility and confirm deadlines on grants.gov before applying.`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('grants-gov.mjs')) {
  const argv = process.argv.slice(2);
  let agency = '', status = '';
  const kw = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agency') { agency = argv[++i] || ''; }
    else if (argv[i] === '--status') { status = argv[++i] || ''; }
    else kw.push(argv[i]);
  }
  const rows = await search({ keyword: kw.join(' '), agency, status });
  console.log(`\n# Grants.gov${kw.length ? `: ${kw.join(' ')}` : ''} (${rows.length})\n`);
  for (const g of rows.slice(0, 15)) {
    console.log(`  - ${(g.title || '').slice(0, 64)} — ${g.agency || ''} [${g.status || '?'}] (closes ${g.close_date || '—'})`);
  }
  console.log(`\n${dataNote()}`);
}
