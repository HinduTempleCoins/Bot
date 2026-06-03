// lobbying-lda.mjs — Accountability Graph base reader (v3 §6A.2) over the U.S. Senate Lobbying
// Disclosure Act (LDA) API (lda.senate.gov/api/v1). Open REST. Federal lobbying disclosures: filings
// by registrant (lobbying firm) and by client (the entity that hired them), with the issues lobbied,
// the period, and the reported income/expenses. Registration with the API raises rate limits (env
// LDA_API_KEY, by name, sent as an Authorization token); it works UNAUTHENTICATED at a lower rate.
//
// DISCIPLINE (v3 §6A.2 — non-negotiable):
//   • FACTS + CONNECTIONS ONLY. Who lobbied for whom, on what issues, for how much — as DISCLOSED.
//     No verdict on whether lobbying was improper, no scoring. The filing is the fact.
//   • PUBLIC-CAPACITY DATA ONLY. Registered lobbyists/clients in the federal disclosure system.
//   • LINK EVERY SOURCE. Each record carries source + license (filings are U.S.-Gov public records) +
//     fetchedAt, plus the filing's own document URL where present. lda.senate.gov is the citable origin.
//   • RIGHT OF REPLY. Registrants/clients dispute via amended filings; this mirrors the official record.
//
// Pattern follows worldbank.mjs / gov-readers.mjs: ESM, zero deps, __setFetch seam, soft-fail (return
// []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped rendered HTML.
//
//   import { filingsByRegistrant, filingsByClient, searchFilings,
//            renderPage, dataNote, __setFetch } from './lobbying-lda.mjs'
//   node integrations/soapbox/lobbying-lda.mjs registrant "Akin Gump"
//   node integrations/soapbox/lobbying-lda.mjs client "Pfizer"

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxLDA/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://lda.senate.gov/api/v1';
const SRC = 'U.S. Senate LDA disclosures';
const LICENSE = 'U.S. Government public record';

// ---- key handling: env LDA_API_KEY by NAME, optional (works unauthenticated at lower rate) ----
function authHeaders() {
  const key = process.env.LDA_API_KEY;
  return key ? { ...UA, Accept: 'application/json', Authorization: `Token ${key}` }
             : { ...UA, Accept: 'application/json' };
}

// ---- pure helpers (unit-tested offline) ----
const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const now = () => new Date().toISOString();
const tag = (extra = {}) => ({ source: SRC, license: LICENSE, fetchedAt: now(), ...extra });

function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + (Math.round(n * 100) / 100).toString();
}

/**
 * Normalize one raw LDA filing object → a flat public-record card. The LDA filing shape is
 * { filing_uuid, filing_year, filing_period_display, dt_posted, income, expenses,
 *   registrant:{name}, client:{name, general_description}, lobbying_activities:[{general_issue_code_display}],
 *   filing_document_url }. Returns null for unusable input.
 */
export function normalizeFiling(f) {
  if (!f || typeof f !== 'object') return null;
  const id = str(f.filing_uuid);
  const registrant = str(f.registrant?.name);
  const client = str(f.client?.name);
  if (!id && !registrant && !client) return null;
  const issues = Array.isArray(f.lobbying_activities)
    ? [...new Set(f.lobbying_activities.map((a) => str(a.general_issue_code_display || a.general_issue_code)).filter(Boolean))]
    : [];
  return tag({
    filingId: id,
    year: num(f.filing_year),
    period: str(f.filing_period_display || f.filing_period),
    posted: str(f.dt_posted),
    type: str(f.filing_type_display || f.filing_type),
    registrant,
    client,
    clientDescription: str(f.client?.general_description),
    income: num(f.income),
    expenses: num(f.expenses),
    issues,
    documentUrl: str(f.filing_document_url),
  });
}

// ---- live data (each fails soft to []) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: authHeaders() });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function listUrl(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  return `${BASE}/filings/?${p.toString()}`;
}

/**
 * Filings where the named lobbying firm is the registrant. Returns normalized cards ([] on failure),
 * newest filing year first.
 * @param {{name:string, year?:number, limit?:number}} opts
 */
export async function filingsByRegistrant({ name = '', year, limit = 25 } = {}) {
  const q = str(name);
  if (!q) return [];
  const j = await getJson(listUrl({
    registrant_name: q, filing_year: num(year), page_size: Math.max(1, Math.min(100, num(limit) || 25)),
  }));
  return collect(j);
}

/**
 * Filings where the named entity is the client (who hired the lobbyists). Returns normalized cards
 * ([] on failure), newest filing year first.
 * @param {{name:string, year?:number, limit?:number}} opts
 */
export async function filingsByClient({ name = '', year, limit = 25 } = {}) {
  const q = str(name);
  if (!q) return [];
  const j = await getJson(listUrl({
    client_name: q, filing_year: num(year), page_size: Math.max(1, Math.min(100, num(limit) || 25)),
  }));
  return collect(j);
}

/**
 * Generic filing search across registrant + client + issue text.
 * @param {{q:string, year?:number, limit?:number}} opts
 */
export async function searchFilings({ q = '', year, limit = 25 } = {}) {
  const query = str(q);
  if (!query) return [];
  const j = await getJson(listUrl({
    search: query, filing_year: num(year), page_size: Math.max(1, Math.min(100, num(limit) || 25)),
  }));
  return collect(j);
}

// shared: pull .results out of the paginated LDA envelope, normalize, sort newest year first.
function collect(j) {
  const rows = Array.isArray(j?.results) ? j.results : (Array.isArray(j) ? j : []);
  return rows.map(normalizeFiling).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0));
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a list of lobbying filings. PURE; soft-handles missing fields. Renders the
 * disclosed facts only — registrant, client, issues, reported $$ — never any judgment.
 * @param {object[]} filings
 */
export function renderPage(filings = []) {
  const rows = Array.isArray(filings) ? filings : [];
  const parts = ['<section class="lda-filings"><h2>Federal lobbying disclosures — public record</h2>'];
  if (rows.length) {
    parts.push('<table class="lda-table"><thead><tr><th>Year</th><th>Registrant</th><th>Client</th><th>Issues</th><th>Reported $</th></tr></thead><tbody>');
    for (const f of rows) {
      const money = f.income != null ? fmtUsd(f.income) : (f.expenses != null ? fmtUsd(f.expenses) : '—');
      parts.push(`<tr><td>${esc(f.year)}</td><td>${esc(f.registrant)}</td><td>${esc(f.client)}</td><td>${esc(f.issues.join(', '))}</td><td>${esc(money)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="lda-empty">No filings found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the Senate LDA system + public-record status + amended-filing right of reply. */
export function dataNote() {
  return `source: ${SRC} (${LICENSE}); as disclosed under the Lobbying Disclosure Act; filers correct via amended filings`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('lobbying-lda.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  let rows = [];
  if (cmd === 'registrant') rows = await filingsByRegistrant({ name: arg });
  else if (cmd === 'client') rows = await filingsByClient({ name: arg });
  else if (cmd === 'search') rows = await searchFilings({ q: arg });
  else { console.log('usage: lobbying-lda.mjs <registrant|client|search> "name/query"'); process.exit(0); }
  console.log(`SoapBox LDA — ${rows.length} filings for ${cmd} "${arg}" ${process.env.LDA_API_KEY ? '(auth)' : '(keyless)'}`);
  for (const f of rows.slice(0, 20)) {
    const money = f.income != null ? fmtUsd(f.income) : fmtUsd(f.expenses);
    console.log(`  • ${f.year} ${f.registrant} → ${f.client} [${f.issues.join(', ')}] ${money}`);
  }
  console.log(`  ${dataNote()}`);
}
