// fed-opportunities.mjs — the SoapBox "find federal money + jobs" reader. A single, page-ready surface
// over the three big federal OPPORTUNITY sources, normalized into one shape so the site can render a
// unified "opportunities" table:
//   • Grants.gov Search2 API      — grant opportunities (KEYLESS POST)
//   • USAJOBS Search API          — federal jobs (needs an API key + a User-Agent email header)
//   • SAM.gov Opportunities API   — federal contract opportunities (needs a SAM.gov key)
//
// Deliberately separate from gov-readers.mjs / govapis.mjs — those follow already-AWARDED money
// (USAspending). This module is the OPEN-opportunity side: money you can still apply for and jobs you
// can still take. It imports nothing from those files, so a key-policy change there can't break this.
//
// SECRETS: never a literal key in this file. USAJOBS needs BOTH an API key AND a User-Agent email
// header — both referenced ONLY by env NAME (USAJOBS_API_KEY / USAJOBS_USER_AGENT). SAM.gov key by env
// NAME (SAM_GOV_API_KEY). Grants.gov Search2 is keyless. Readers that require a key soft-fail to [] when
// it's absent — no network call, no throw. Every list reader soft-fails to [] on any error.
//
//   import { grants, jobs, contracts, summary, renderPage, dataNote } from './fed-opportunities.mjs'
//   node integrations/soapbox/fed-opportunities.mjs grants "water"

const str = (s) => String(s == null ? '' : s).trim();
const num = (n, d = null) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);
const now = () => new Date().toISOString();

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Source endpoints.
export const ENDPOINTS = {
  grants: 'https://api.grants.gov/v1/api/search2',
  jobs: 'https://data.usajobs.gov/api/search',
  contracts: 'https://api.sam.gov/opportunities/v2/search',
};

// Env var NAMES holding credentials — read by name only, never inlined. Grants.gov needs none.
export const API_KEY_ENV = {
  jobs: 'USAJOBS_API_KEY',         // USAJOBS Authorization-Key header value
  jobsUserAgent: 'USAJOBS_USER_AGENT', // a contact email USAJOBS requires as the User-Agent
  contracts: 'SAM_GOV_API_KEY',    // SAM.gov api_key query param
};

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ── grants({ keyword, limit }) — Grants.gov Search2 (KEYLESS POST) ───────────────────────────────────
// Search2 is a JSON POST endpoint; no key required. Normalized to the unified opportunity row.
// Soft-fails to [].
export async function grants({ keyword = '', limit = 10 } = {}) {
  try {
    const body = {
      keyword: str(keyword),
      rows: capLimit(limit),
      oppStatuses: 'posted|forecasted',
    };
    const r = await _fetch(ENDPOINTS.grants, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.data?.oppHits;
    if (!Array.isArray(rows)) return [];
    return rows.map((g) => {
      const number = str(g.number || g.opportunityNumber);
      const id = str(g.id);
      return {
        type: 'grant',
        title: str(g.title) || null,
        agency: str(g.agencyName || g.agencyCode) || null,
        opportunityNumber: number || null,
        closeDate: str(g.closeDate || g.openDate) || null,
        url: number || id
          ? `https://www.grants.gov/search-results-detail/${encodeURIComponent(id || number)}`
          : null,
      };
    });
  } catch { return []; }
}

// ── jobs({ keyword, location, limit }) — USAJOBS search (key + User-Agent email by env NAME) ──────────
// USAJOBS requires BOTH an Authorization-Key header AND a User-Agent email header. Both read by env
// NAME; if EITHER is absent we soft-fail to [] WITHOUT a network call. Soft-fails to [] on any error.
export async function jobs({ keyword = '', location = '', limit = 10 } = {}) {
  const key = process.env[API_KEY_ENV.jobs];
  const ua = process.env[API_KEY_ENV.jobsUserAgent];
  if (!key || !ua) return [];
  try {
    const p = new URLSearchParams();
    if (str(keyword)) p.set('Keyword', str(keyword));
    if (str(location)) p.set('LocationName', str(location));
    p.set('ResultsPerPage', String(capLimit(limit)));
    const r = await _fetch(`${ENDPOINTS.jobs}?${p.toString()}`, {
      headers: {
        Host: 'data.usajobs.gov',
        'User-Agent': ua,
        'Authorization-Key': key,
        Accept: 'application/json',
      },
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.SearchResult?.SearchResultItems;
    if (!Array.isArray(rows)) return [];
    return rows.map((item) => {
      const d = item?.MatchedObjectDescriptor || {};
      const pay = Array.isArray(d.PositionRemuneration) ? d.PositionRemuneration[0] : null;
      const loc = Array.isArray(d.PositionLocationDisplay)
        ? d.PositionLocationDisplay.join('; ')
        : str(d.PositionLocationDisplay);
      return {
        type: 'job',
        title: str(d.PositionTitle) || null,
        agency: str(d.OrganizationName || d.DepartmentName) || null,
        location: loc || null,
        salaryMin: pay ? num(pay.MinimumRange) : null,
        salaryMax: pay ? num(pay.MaximumRange) : null,
        closeDate: str(d.ApplicationCloseDate) || null,
        url: str(d.PositionURI) || null,
      };
    });
  } catch { return []; }
}

// ── contracts({ keyword, limit }) — SAM.gov contract opportunities (key by env NAME) ─────────────────
// SAM.gov requires an api_key. Read by env NAME; absent ⇒ soft-fail [] with no network call. SAM.gov
// also requires a posted-date window — we default to the last ~year. Soft-fails to [] on any error.
export async function contracts({ keyword = '', limit = 10 } = {}) {
  const key = process.env[API_KEY_ENV.contracts];
  if (!key) return [];
  try {
    const mmddyyyy = (d) => {
      const x = new Date(d);
      return `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}/${x.getFullYear()}`;
    };
    const today = new Date();
    const yearAgo = new Date(today.getTime() - 365 * 24 * 3600 * 1000);
    const p = new URLSearchParams();
    p.set('api_key', key);
    if (str(keyword)) p.set('title', str(keyword));
    p.set('limit', String(capLimit(limit)));
    p.set('postedFrom', mmddyyyy(yearAgo));
    p.set('postedTo', mmddyyyy(today));
    const r = await _fetch(`${ENDPOINTS.contracts}?${p.toString()}`, { headers: { Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.opportunitiesData;
    if (!Array.isArray(rows)) return [];
    return rows.map((c) => ({
      type: 'contract',
      title: str(c.title) || null,
      agency: str(c.fullParentPathName || c.department || c.organizationType) || null,
      opportunityNumber: str(c.solicitationNumber || c.noticeId) || null,
      closeDate: str(c.responseDeadLine) || null,
      url: str(c.uiLink) || null,
    }));
  } catch { return []; }
}

// ── summary(data) — counts of open opportunities by type ─────────────────────────────────────────────
// `data` may be a flat array of normalized rows, or { grants:[], jobs:[], contracts:[] }. Returns a
// small dashboard object with a count per opportunity type + total + an as-of timestamp.
export function summary(data = {}) {
  let rows;
  if (Array.isArray(data)) rows = data;
  else rows = [
    ...(Array.isArray(data.grants) ? data.grants : []),
    ...(Array.isArray(data.jobs) ? data.jobs : []),
    ...(Array.isArray(data.contracts) ? data.contracts : []),
  ];
  const byType = { grant: 0, job: 0, contract: 0 };
  for (const r of rows) {
    const t = str(r?.type);
    if (t in byType) byType[t] += 1;
  }
  return {
    source: 'Grants.gov / USAJOBS / SAM.gov',
    asOf: now(),
    grants: byType.grant,
    jobs: byType.job,
    contracts: byType.contract,
    total: byType.grant + byType.job + byType.contract,
    byType,
  };
}

// ── dataNote() — provenance + as-of ──────────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: Grants.gov / USAJOBS / SAM.gov, as of ${asOf}. ` +
    `Opportunities are as published and may close or change; confirm on the source site before applying.`;
}

// ── renderPage(data) — escaped HTML opportunities table ──────────────────────────────────────────────
// `data` may be a flat array of normalized rows, or { grants, jobs, contracts }. EVERY field is escaped
// before it reaches markup — a hostile title/agency cannot inject HTML.
export function renderPage(data = {}) {
  let rows;
  if (Array.isArray(data)) rows = data;
  else rows = [
    ...(Array.isArray(data.grants) ? data.grants : []),
    ...(Array.isArray(data.jobs) ? data.jobs : []),
    ...(Array.isArray(data.contracts) ? data.contracts : []),
  ];
  const salary = (r) => {
    if (r.salaryMin == null && r.salaryMax == null) return '';
    return `$${num(r.salaryMin, 0)}–$${num(r.salaryMax, 0)}`;
  };
  const body = rows.map((r) => `      <tr>
        <td>${esc(r.type)}</td>
        <td>${r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : esc(r.title)}</td>
        <td>${esc(r.agency)}</td>
        <td>${esc(r.location)}</td>
        <td>${esc(salary(r))}</td>
        <td>${esc(r.opportunityNumber)}</td>
        <td>${esc(r.closeDate)}</td>
      </tr>`).join('\n');
  const tbody = body || '      <tr><td colspan="7">No federal opportunities found.</td></tr>';
  return `<section class="fed-opportunities">
  <h2>Federal Opportunities — Grants, Jobs & Contracts</h2>
  <table>
    <thead>
      <tr><th>Type</th><th>Title</th><th>Agency</th><th>Location</th><th>Salary</th><th>Number</th><th>Close Date</th></tr>
    </thead>
    <tbody>
${tbody}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/fed-opportunities.mjs <grants|jobs|contracts> <keyword> ────────────
if (process.argv[1] && process.argv[1].endsWith('fed-opportunities.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const kw = rest.join(' ');
  let rows = [];
  if (cmd === 'grants') rows = await grants({ keyword: kw });
  else if (cmd === 'jobs') rows = await jobs({ keyword: kw });
  else if (cmd === 'contracts') rows = await contracts({ keyword: kw });
  else { console.log('usage: fed-opportunities.mjs <grants|jobs|contracts> <keyword>'); process.exit(0); }
  console.log(`\n# Federal ${cmd}${kw ? `: ${kw}` : ''} (${rows.length})\n`);
  for (const r of rows.slice(0, 15)) {
    console.log(`  - [${r.type}] ${(r.title || '').slice(0, 60)} — ${r.agency || ''}`);
  }
  console.log('\nSummary:', JSON.stringify(summary(rows).byType));
  console.log(dataNote());
}
