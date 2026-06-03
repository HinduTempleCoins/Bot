// courtlistener-opinions.mjs — Law.SoapBox legal-vertical reader (v3 §10) over CourtListener's REST v4
// search/opinion/cluster endpoints (courtlistener.com/api/rest/v4), the Free Law Project's open
// caselaw database. KEYLESS at a low rate; a personal token (env COURTLISTENER_TOKEN, by NAME, sent
// as "Authorization: Token …") raises the rate but is OPTIONAL. Complements courtlistener-judges.mjs
// (which covers people/positions); this module covers the OPINIONS themselves: case search by
// query/court/date, an opinion-text snippet, the citation count, and the precedential status.
//
// DISCIPLINE (v3 §10 — non-negotiable):
//   • FEDERAL OPINIONS ARE PUBLIC DOMAIN. Judicial opinions of U.S. courts carry no copyright; we mark
//     them license:'public-domain' and host them forever. State-court text on CourtListener is
//     likewise the public record; we attribute Free Law Project either way.
//   • STATE FACTS, LINK SOURCES. Case name, court, date, citation count, precedential status, a text
//     snippet, and the canonical CourtListener URL. NO holding-summary, NO editorial headnote, NO
//     "good law / bad law" verdict. The citation count and status ARE the facts.
//   • RESPECT PACER REDACTION NORMS. We read CourtListener's already-published opinion text; we do not
//     un-redact, reconstruct sealed material, or surface anything the court redacted.
//
// Pattern follows worldbank.mjs / courtlistener-judges.mjs: ESM, zero deps, __setFetch seam,
// soft-fail (return []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped HTML.
//
//   import { searchCases, opinionSnippet, citationCount, clusterDetail,
//            renderPage, dataNote, __setFetch } from './courtlistener-opinions.mjs'
//   node integrations/soapbox/courtlistener-opinions.mjs search "qualified immunity" scotus
//   node integrations/soapbox/courtlistener-opinions.mjs opinion 118144

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCourtListener/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://www.courtlistener.com/api/rest/v4';
const WEB = 'https://www.courtlistener.com';
const SRC = 'CourtListener (Free Law Project)';
// Federal judicial opinions are public domain; CourtListener distributes the open record under attribution.
const LICENSE = 'public-domain';

// ---- key handling: env COURTLISTENER_TOKEN by NAME, optional (keyless works at lower rate) ----
function authHeaders() {
  const key = process.env.COURTLISTENER_TOKEN;
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

// CourtListener id fields come back as resource URLs like ".../clusters/118144/"; pull the numeric id.
export function idFromUrl(u) {
  const m = String(u || '').match(/\/(\d+)\/?$/);
  return m ? m[1] : '';
}

// Court ids are alphanumeric slugs (e.g. "ca2", "scotus"); pull the last non-empty path segment.
export function slugFromUrl(u) {
  const m = String(u || '').match(/\/([^/]+)\/?$/);
  return m ? m[1] : '';
}

// Opinion bodies arrive in several columns (html, html_lawbox, html_columbia, plain_text); take the
// first non-empty, strip tags, collapse whitespace. PURE.
export function plainText(op) {
  if (!op || typeof op !== 'object') return '';
  const raw = op.plain_text || op.html || op.html_lawbox || op.html_columbia || op.html_with_citations || '';
  return String(raw).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// A bounded, word-safe snippet of opinion text (default ~280 chars). PURE.
export function snippetOf(text, max = 280) {
  const t = str(text);
  const lim = Math.max(1, num(max) || 280);
  if (t.length <= lim) return t;
  const cut = t.slice(0, lim);
  const sp = cut.lastIndexOf(' ');
  return (sp > lim * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

/**
 * Normalize a raw v4 search-result row (a "cluster" hit) → a flat case card. Returns null for unusable
 * input. Search rows expose caseName, court, dateFiled, citeCount, status, and the cluster id.
 */
export function normalizeCase(r) {
  if (!r || typeof r !== 'object') return null;
  const id = r.cluster_id != null ? String(r.cluster_id)
    : (r.id != null ? String(r.id) : idFromUrl(r.absolute_url || r.resource_uri));
  const name = str(r.caseName) || str(r.case_name) || str(r.caseNameFull);
  if (!id && !name) return null;
  const cites = Array.isArray(r.citation) ? r.citation.map(str).filter(Boolean) : [];
  return tag({
    clusterId: id,
    caseName: name,
    court: str(r.court) || str(r.court_id) || slugFromUrl(r.court_exact),
    dateFiled: str(r.dateFiled) || str(r.date_filed),
    citationCount: num(r.citeCount != null ? r.citeCount : r.citation_count),
    precedentialStatus: str(r.status) || str(r.precedential_status),
    citations: cites,
    docketNumber: str(r.docketNumber) || str(r.docket_number),
    url: id ? `${WEB}/opinion/${id}/` : (r.absolute_url ? `${WEB}${r.absolute_url}` : ''),
  });
}

// ---- live data (keyless; each fails soft to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: authHeaders() });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function apiUrl(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${BASE}${path}${qs ? '?' + qs : ''}`;
}

/**
 * Search opinions/clusters by query, optionally narrowed by court slug and a filed-after date.
 * Returns normalized case cards ([] on failure).
 * @param {{q:string, court?:string, filedAfter?:string, limit?:number}} opts
 */
export async function searchCases({ q = '', court = '', filedAfter = '', limit = 20 } = {}) {
  const query = str(q);
  if (!query) return [];
  const params = { q: query, type: 'o', order_by: 'score desc', page_size: Math.max(1, Math.min(100, num(limit) || 20)) };
  if (str(court)) params.court = str(court);
  if (str(filedAfter)) params.filed_after = str(filedAfter);
  const j = await getJson(apiUrl('/search/', params));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeCase).filter(Boolean);
}

/**
 * Text snippet + metadata for one opinion by CourtListener opinion id. Returns
 *   { opinionId, snippet, type, url, source, license, fetchedAt } or null.
 * Respects PACER redaction: reads the already-published text, never reconstructs sealed material.
 * @param {string|number} opinionId
 * @param {{max?:number}} [opts]
 */
export async function opinionSnippet(opinionId, { max = 280 } = {}) {
  const id = str(opinionId);
  if (!id) return null;
  const j = await getJson(apiUrl(`/opinions/${encodeURIComponent(id)}/`, {}));
  if (!j || typeof j !== 'object') return null;
  return tag({
    opinionId: id,
    type: str(j.type),
    snippet: snippetOf(plainText(j), max),
    url: `${WEB}/opinion/${idFromUrl(j.cluster) || id}/`,
  });
}

/**
 * Citation count for a cluster (how many later opinions cite it). Returns a number or null.
 * @param {string|number} clusterId
 */
export async function citationCount(clusterId) {
  const id = str(clusterId);
  if (!id) return null;
  const j = await getJson(apiUrl(`/clusters/${encodeURIComponent(id)}/`, {}));
  if (!j || typeof j !== 'object') return null;
  return num(j.citation_count);
}

/**
 * Detail card for one cluster (case name, court, date, status, citation count, canonical URL).
 * Returns a normalized case card or null.
 * @param {string|number} clusterId
 */
export async function clusterDetail(clusterId) {
  const id = str(clusterId);
  if (!id) return null;
  const j = await getJson(apiUrl(`/clusters/${encodeURIComponent(id)}/`, {}));
  if (!j || typeof j !== 'object') return null;
  const cites = Array.isArray(j.citations)
    ? j.citations.map((c) => [str(c.volume), str(c.reporter), str(c.page)].filter(Boolean).join(' ')).filter(Boolean)
    : [];
  return tag({
    clusterId: j.id != null ? String(j.id) : id,
    caseName: str(j.case_name) || str(j.case_name_full),
    court: slugFromUrl(j.court) || str(j.court_id),
    dateFiled: str(j.date_filed),
    citationCount: num(j.citation_count),
    precedentialStatus: str(j.precedential_status),
    citations: cites,
    url: `${WEB}/opinion/${j.id != null ? j.id : id}/`,
  });
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a case-search list OR a single case detail (+ optional snippet). PURE; soft-handles
 * missing fields. Facts only — name, court, date, citation count, status, snippet, link. Never a verdict.
 * @param {{cases?:object[], detail?:object, snippet?:object}} data
 */
export function renderPage(data = {}) {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const detail = data.detail || null;
  const snippet = data.snippet || null;
  if (detail) {
    const parts = ['<section class="cl-case"><h2>Opinion — public record</h2>'];
    parts.push(`<p class="cl-name"><strong>${esc(detail.caseName || 'Case')}</strong>${detail.clusterId ? ' (CourtListener #' + esc(detail.clusterId) + ')' : ''}</p>`);
    parts.push('<ul class="cl-meta">');
    parts.push(`<li>Court: ${esc(detail.court || '—')}</li>`);
    parts.push(`<li>Filed: ${esc(detail.dateFiled || '—')}</li>`);
    parts.push(`<li>Precedential status: ${esc(detail.precedentialStatus || '—')}</li>`);
    parts.push(`<li>Cited by: ${esc(detail.citationCount != null ? detail.citationCount : '—')} later opinions</li>`);
    if (Array.isArray(detail.citations) && detail.citations.length) parts.push(`<li>Citations: ${esc(detail.citations.join('; '))}</li>`);
    parts.push('</ul>');
    if (snippet && snippet.snippet) parts.push(`<blockquote class="cl-snippet">${esc(snippet.snippet)}</blockquote>`);
    if (detail.url) parts.push(`<p class="cl-link"><a href="${esc(detail.url)}">Read the full opinion at CourtListener</a></p>`);
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  const parts = ['<section class="cl-cases"><h2>Case search — public record</h2>'];
  if (cases.length) {
    parts.push('<table class="cl-list"><thead><tr><th>Case</th><th>Court</th><th>Filed</th><th>Status</th><th>Cited by</th></tr></thead><tbody>');
    for (const c of cases) {
      const link = c.url ? `<a href="${esc(c.url)}">${esc(c.caseName || c.clusterId)}</a>` : esc(c.caseName || c.clusterId);
      parts.push(`<tr><td>${link}</td><td>${esc(c.court)}</td><td>${esc(c.dateFiled)}</td><td>${esc(c.precedentialStatus)}</td><td>${esc(c.citationCount != null ? c.citationCount : '—')}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="cl-empty">No cases on record.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names CourtListener / Free Law Project + public-domain + right-of-reply path. */
export function dataNote() {
  return `source: ${SRC}; U.S. judicial opinions are public domain (host-forever); PACER redactions respected; corrections via Free Law Project`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('courtlistener-opinions.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'search') {
    const q = rest[0] || '';
    const court = rest[1] || '';
    const rows = await searchCases({ q, court });
    console.log(`SoapBox CourtListener — ${rows.length} cases match "${q}"${court ? ` @ ${court}` : ''} ${process.env.COURTLISTENER_TOKEN ? '(token)' : '(keyless)'}`);
    for (const r of rows.slice(0, 25)) console.log(`  • ${r.caseName} — ${r.court} ${r.dateFiled} [${r.precedentialStatus}] cited×${r.citationCount ?? '?'}\n    ${r.url}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'opinion') {
    const id = rest[0];
    const snip = await opinionSnippet(id);
    console.log(`SoapBox CourtListener — opinion ${id}`);
    if (snip) { console.log(`  ${snip.snippet}`); console.log(`  ${snip.url}`); }
    else console.log('  not found');
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'cluster') {
    const id = rest[0];
    const d = await clusterDetail(id);
    console.log(`SoapBox CourtListener — cluster ${id}`);
    if (d) console.log(`  ${d.caseName} — ${d.court} ${d.dateFiled} [${d.precedentialStatus}] cited×${d.citationCount ?? '?'}\n  ${d.url}`);
    else console.log('  not found');
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: courtlistener-opinions.mjs <search "query" [court] | opinion OPINION_ID | cluster CLUSTER_ID>');
    console.log(`  COURTLISTENER_TOKEN ${process.env.COURTLISTENER_TOKEN ? 'is set' : 'unset → keyless low-rate reads'}`);
  }
}
