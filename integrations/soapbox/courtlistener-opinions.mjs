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

// ---- the federal court hierarchy (CourtListener court slugs) ----
// The Supreme Court + the 13 U.S. Courts of Appeals. District courts are many and varied — they are
// reached through docket search rather than browsed here. Each: { slug, name, short }.
export const COURTS = {
  supreme: { slug: 'scotus', name: 'Supreme Court of the United States', short: 'SCOTUS' },
  circuits: [
    { slug: 'ca1', name: 'U.S. Court of Appeals, First Circuit', short: '1st Cir.' },
    { slug: 'ca2', name: 'U.S. Court of Appeals, Second Circuit', short: '2nd Cir.' },
    { slug: 'ca3', name: 'U.S. Court of Appeals, Third Circuit', short: '3rd Cir.' },
    { slug: 'ca4', name: 'U.S. Court of Appeals, Fourth Circuit', short: '4th Cir.' },
    { slug: 'ca5', name: 'U.S. Court of Appeals, Fifth Circuit', short: '5th Cir.' },
    { slug: 'ca6', name: 'U.S. Court of Appeals, Sixth Circuit', short: '6th Cir.' },
    { slug: 'ca7', name: 'U.S. Court of Appeals, Seventh Circuit', short: '7th Cir.' },
    { slug: 'ca8', name: 'U.S. Court of Appeals, Eighth Circuit', short: '8th Cir.' },
    { slug: 'ca9', name: 'U.S. Court of Appeals, Ninth Circuit', short: '9th Cir.' },
    { slug: 'ca10', name: 'U.S. Court of Appeals, Tenth Circuit', short: '10th Cir.' },
    { slug: 'ca11', name: 'U.S. Court of Appeals, Eleventh Circuit', short: '11th Cir.' },
    { slug: 'cadc', name: 'U.S. Court of Appeals, D.C. Circuit', short: 'D.C. Cir.' },
    { slug: 'cafc', name: 'U.S. Court of Appeals, Federal Circuit', short: 'Fed. Cir.' },
  ],
  districtNote: 'District (trial) courts are many — find them through docket search.',
};

// slug → full court name, for header labels. Built from COURTS.
const COURT_NAME = (() => {
  const m = { [COURTS.supreme.slug]: COURTS.supreme.name };
  for (const c of COURTS.circuits) m[c.slug] = c.name;
  return m;
})();
/** Friendly full name for a court slug, or the slug itself if unknown. PURE. */
export function courtName(slug) {
  const s = str(slug);
  return COURT_NAME[s] || s;
}

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
    // the search API already returns a highlighted excerpt for the hit — keep it so list views can show
    // a relevant snippet without a second per-row opinion fetch. Strip any <mark> highlight tags.
    snippet: (str(r.snippet) || str(r.opinions?.[0]?.snippet) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    citations: cites,
    docketNumber: str(r.docketNumber) || str(r.docket_number),
    // the docket this opinion came out of — lets an opinion link back to its filings (Justia-style).
    docketId: str(r.docket_id) || idFromUrl(r.docket),
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
 *
 * Two modes:
 *   • SEARCH — a non-empty `q` runs a relevance search (order_by defaults to 'score desc').
 *   • COURT BROWSE — an empty `q` WITH a `court` (or `filedAfter`) set lists that court's recent
 *     opinions instead of early-returning []. Pass orderBy:'dateFiled desc' for a recency feed.
 *   • Empty `q` AND no court AND no filedAfter → still [] (nothing to browse).
 *
 * @param {{q:string, court?:string, filedAfter?:string, orderBy?:string, limit?:number}} opts
 */
export async function searchCases({ q = '', court = '', filedAfter = '', orderBy = 'score desc', limit = 20 } = {}) {
  const query = str(q);
  const ct = str(court);
  const after = str(filedAfter);
  // Nothing to query: no term and no browse facet → [].
  if (!query && !ct && !after) return [];
  const params = { type: 'o', order_by: str(orderBy) || 'score desc', page_size: Math.max(1, Math.min(100, num(limit) || 20)) };
  if (query) params.q = query;
  if (ct) params.court = ct;
  if (after) params.filed_after = after;
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
 * FULL opinion text + metadata for one opinion by CourtListener opinion id. Unlike opinionSnippet (list
 * view), this returns the court's VERBATIM words untruncated — the whole decision — for the case-detail
 * page. Facts-not-verdicts discipline: this is the source's OWN public-domain text, never our gloss.
 * Returns
 *   { opinionId, type, text, court, dateFiled, caseName, citation, absolute_url, url, source, license, fetchedAt }
 * or null. Respects PACER redaction: reads the already-published text, never reconstructs sealed material.
 * @param {string|number} opinionId
 */
export async function opinionText(opinionId) {
  const id = str(opinionId);
  if (!id) return null;
  const j = await getJson(apiUrl(`/opinions/${encodeURIComponent(id)}/`, {}));
  if (!j || typeof j !== 'object') return null;
  // The opinion endpoint carries the body; cluster-level metadata may be inlined or referenced by URL.
  const cl = (j.cluster && typeof j.cluster === 'object') ? j.cluster : {};
  const clusterId = idFromUrl(j.cluster) || (cl.id != null ? String(cl.id) : '') || id;
  const cites = Array.isArray(cl.citations)
    ? cl.citations.map((c) => [str(c.volume), str(c.reporter), str(c.page)].filter(Boolean).join(' ')).filter(Boolean)
    : [];
  const absoluteUrl = str(j.absolute_url) || str(cl.absolute_url);
  return tag({
    opinionId: id,
    type: str(j.type),
    text: plainText(j),
    court: slugFromUrl(cl.court) || str(cl.court_id) || str(j.court_id),
    dateFiled: str(cl.date_filed) || str(j.date_filed),
    caseName: str(cl.case_name) || str(cl.case_name_full) || str(j.case_name),
    citation: cites,
    absolute_url: absoluteUrl ? `${WEB}${absoluteUrl}` : '',
    url: `${WEB}/opinion/${clusterId}/`,
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

// ---- DOCKET SEARCH (Justia-style) — RECAP/PACER docket records via CourtListener ----
// Justia's "Dockets" surface is a search over case filings & proceedings. CourtListener mirrors PACER
// into the open RECAP archive; its v4 search exposes the docket record at type:'r' (RECAP). We state the
// docket facts — case name, docket number, court, filed/terminated dates, nature of suit, assigned judge —
// and link the CourtListener docket page. DISCIPLINE: facts only; we read CourtListener's already-published
// docket metadata; we never un-redact, reconstruct sealed material, or surface court-redacted content.

/** CourtListener web link for a docket. PURE — prefers the row's absolute_url, else builds /docket/<id>/. */
export function docketUrl(d) {
  if (!d || typeof d !== 'object') return '';
  const abs = str(d.absolute_url);
  if (abs) return abs.startsWith('http') ? abs : `${WEB}${abs}`;
  const id = str(d.docket_id != null ? d.docket_id : d.id);
  return id ? `${WEB}/docket/${id}/` : '';
}

/**
 * Normalize a raw v4 RECAP docket search row → a flat docket card. Returns null for unusable input.
 * @param {object} r
 */
export function normalizeDocket(r) {
  if (!r || typeof r !== 'object') return null;
  const id = r.docket_id != null ? String(r.docket_id) : (r.id != null ? String(r.id) : '');
  const caseName = str(r.caseName) || str(r.case_name) || str(r.caseNameFull) || str(r.case_name_full);
  const docketNumber = str(r.docketNumber) || str(r.docket_number);
  if (!id && !caseName && !docketNumber) return null;
  // best-effort: the cluster id of a published opinion that came out of this docket, so a docket row
  // can link straight to the opinion it produced. RECAP rows vary; try the common shapes.
  const clusterId = r.cluster_id != null ? String(r.cluster_id)
    : (Array.isArray(r.clusters) && r.clusters.length ? (idFromUrl(r.clusters[0]) || str(r.clusters[0]))
    : (Array.isArray(r.opinions) && r.opinions.length ? idFromUrl(r.opinions[0].cluster || r.opinions[0]) : ''));
  return tag({
    docketId: id,
    caseName,
    docketNumber,
    court: str(r.court) || str(r.court_id) || slugFromUrl(r.court_exact),
    dateFiled: str(r.dateFiled) || str(r.date_filed),
    dateTerminated: str(r.dateTerminated) || str(r.date_terminated),
    natureOfSuit: str(r.suitNature) || str(r.nature_of_suit),
    assignedTo: str(r.assignedTo) || str(r.assigned_to_str) || str(r.assigned_to) || str(r.judge),
    clusterId,
    url: docketUrl({ absolute_url: r.absolute_url, docket_id: id, id }),
  });
}

/**
 * Justia-style docket search over the RECAP archive. Returns normalized docket cards ([] on failure).
 * Empty `q` with no `court` → [] (nothing to query). A `court` slug narrows it; an empty `q` with a court
 * browses that court's recent dockets.
 * @param {{q?:string, court?:string, limit?:number}} opts
 */
export async function searchDockets({ q = '', court = '', limit = 20 } = {}) {
  const query = str(q);
  const ct = str(court);
  if (!query && !ct) return [];
  const params = { type: 'r', order_by: query ? 'score desc' : 'dateFiled desc', page_size: Math.max(1, Math.min(100, num(limit) || 20)) };
  if (query) params.q = query;
  if (ct) params.court = ct;
  const j = await getJson(apiUrl('/search/', params));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeDocket).filter(Boolean);
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a case-search list OR a single case detail (+ optional snippet/full text). PURE;
 * soft-handles missing fields. Facts only — name, court, date, citation count, status, the opinion text,
 * link. Never a verdict. When `fullText` is present (an opinionText() record or a raw string), the detail
 * view renders the WHOLE untruncated opinion; otherwise it falls back to the bounded `snippet`.
 * @param {{cases?:object[], detail?:object, snippet?:object, fullText?:object|string}} data
 */
export function renderPage(data = {}) {
  const cases = Array.isArray(data.cases) ? data.cases : [];
  const detail = data.detail || null;
  const snippet = data.snippet || null;
  // fullText may be an opinionText() record ({ text }) or a raw string.
  const fullText = data.fullText
    ? (typeof data.fullText === 'string' ? data.fullText : str(data.fullText.text))
    : '';
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
    // Prefer the FULL public-domain opinion text when supplied (case-detail page); otherwise fall back
    // to the bounded snippet (preview). The text is the court's OWN words, never our gloss.
    if (fullText) parts.push(`<div class="cl-fulltext"><pre>${esc(fullText)}</pre></div>`);
    else if (snippet && snippet.snippet) parts.push(`<blockquote class="cl-snippet">${esc(snippet.snippet)}</blockquote>`);
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
