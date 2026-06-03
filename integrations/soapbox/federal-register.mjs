// federal-register.mjs — Law.SoapBox legal-vertical reader (v3 §10) over the Federal Register API
// (www.federalregister.gov/api/v1), the official daily journal of the U.S. Government published by the
// Office of the Federal Register and GPO. KEYLESS and open. This module lists documents filtered by
// agency, document type (rule / proposed rule / notice / presidential document), and publication date,
// and fetches a single document by its document number.
//
// DISCIPLINE (v3 §10 — non-negotiable):
//   • FEDERAL REGISTER IS PUBLIC DOMAIN. U.S. Government work, no copyright. We mark records
//     license:'public-domain' and host them forever. Attribute the Office of the Federal Register.
//   • STATE FACTS, LINK SOURCES. Title, agencies, type, publication date, abstract, the FR document
//     number, and the official html_url / pdf_url. NO editorial summary of what the rule "does", NO
//     for/against framing. The abstract is the agency's own; we quote, never gloss.
//
// Pattern follows worldbank.mjs / courtlistener-opinions.mjs: ESM, zero deps, __setFetch seam,
// soft-fail (return []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped HTML.
//
//   import { TYPES, listDocuments, documentByNumber, recentByAgency,
//            renderPage, dataNote, __setFetch } from './federal-register.mjs'
//   node integrations/soapbox/federal-register.mjs agency environmental-protection-agency
//   node integrations/soapbox/federal-register.mjs doc 2024-12345

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxFederalRegister/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://www.federalregister.gov/api/v1';
const SRC = 'Federal Register — Office of the Federal Register / GPO';
const LICENSE = 'public-domain';

// FR document-type slugs (friendly → API value).
export const TYPES = {
  rule: 'RULE',
  'proposed-rule': 'PRORULE',
  notice: 'NOTICE',
  presidential: 'PRESDOCU',
};

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

/** Normalize a raw FR document → a flat card. Returns null for unusable input. */
export function normalizeDoc(d) {
  if (!d || typeof d !== 'object') return null;
  const number = str(d.document_number);
  const title = str(d.title);
  if (!number && !title) return null;
  const agencies = Array.isArray(d.agencies)
    ? d.agencies.map((a) => str(a && (a.name || a.raw_name))).filter(Boolean)
    : [];
  return tag({
    documentNumber: number,
    title,
    type: str(d.type),
    agencies,
    publicationDate: str(d.publication_date),
    abstract: str(d.abstract),
    htmlUrl: str(d.html_url),
    pdfUrl: str(d.pdf_url),
  });
}

// ---- live data (keyless; each fails soft to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function url(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) { for (const item of v) p.append(k, String(item)); continue; }
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${BASE}${path}${qs ? '?' + qs : ''}`;
}

/**
 * List FR documents filtered by agency slug, friendly type, and/or a published-on-or-after date.
 * Returns normalized document cards ([] on failure).
 * @param {{agency?:string, type?:string, since?:string, limit?:number}} opts
 */
export async function listDocuments({ agency = '', type = '', since = '', limit = 20 } = {}) {
  const params = {
    per_page: Math.max(1, Math.min(100, num(limit) || 20)),
    order: 'newest',
    'fields[]': ['document_number', 'title', 'type', 'abstract', 'publication_date', 'agencies', 'html_url', 'pdf_url'],
  };
  if (str(agency)) params['conditions[agencies][]'] = str(agency);
  const apiType = TYPES[str(type).toLowerCase()];
  if (apiType) params['conditions[type][]'] = apiType;
  if (str(since)) params['conditions[publication_date][gte]'] = str(since);
  const j = await getJson(url('/documents.json', params));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeDoc).filter(Boolean);
}

/**
 * Fetch one FR document by its document number. Returns a normalized card or null.
 * @param {string} documentNumber  e.g. '2024-12345'
 */
export async function documentByNumber(documentNumber) {
  const n = str(documentNumber);
  if (!n) return null;
  const j = await getJson(url(`/documents/${encodeURIComponent(n)}.json`, {}));
  return normalizeDoc(j);
}

/**
 * Convenience: the most recent documents for one agency (newest first).
 * @param {string} agency  FR agency slug (e.g. 'environmental-protection-agency')
 * @param {{limit?:number}} [opts]
 */
export async function recentByAgency(agency, { limit = 20 } = {}) {
  return listDocuments({ agency, limit });
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a document list OR a single document detail. PURE; soft-handles missing fields.
 * Facts only — title, agencies, type, date, abstract (agency's own words), official links.
 * @param {{documents?:object[], document?:object, query?:string}} data
 */
export function renderPage(data = {}) {
  const single = data.document || null;
  if (single) {
    const d = single;
    const parts = ['<section class="fr-doc"><h2>Federal Register document</h2>'];
    parts.push(`<p class="fr-title"><strong>${esc(d.title || 'Document')}</strong>${d.documentNumber ? ' (' + esc(d.documentNumber) + ')' : ''}</p>`);
    parts.push('<ul class="fr-meta">');
    parts.push(`<li>Type: ${esc(d.type || '—')}</li>`);
    parts.push(`<li>Published: ${esc(d.publicationDate || '—')}</li>`);
    if (Array.isArray(d.agencies) && d.agencies.length) parts.push(`<li>Agencies: ${esc(d.agencies.join('; '))}</li>`);
    parts.push('</ul>');
    if (d.abstract) parts.push(`<blockquote class="fr-abstract">${esc(d.abstract)}</blockquote>`);
    const links = [];
    if (d.htmlUrl) links.push(`<a href="${esc(d.htmlUrl)}">official HTML</a>`);
    if (d.pdfUrl) links.push(`<a href="${esc(d.pdfUrl)}">PDF</a>`);
    if (links.length) parts.push(`<p class="fr-links">${links.join(' · ')}</p>`);
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  const docs = Array.isArray(data.documents) ? data.documents : [];
  const out = [`<section class="fr-docs"><h2>Federal Register${data.query ? ` — ${esc(data.query)}` : ''}</h2>`];
  if (docs.length) {
    out.push('<table class="fr-list"><thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Agencies</th></tr></thead><tbody>');
    for (const d of docs) {
      const t = d.htmlUrl ? `<a href="${esc(d.htmlUrl)}">${esc(d.title || d.documentNumber)}</a>` : esc(d.title || d.documentNumber);
      out.push(`<tr><td>${esc(d.publicationDate)}</td><td>${esc(d.type)}</td><td>${t}</td><td>${esc((d.agencies || []).join('; '))}</td></tr>`);
    }
    out.push('</tbody></table>');
  } else {
    out.push('<p class="fr-empty">No documents on record.</p>');
  }
  out.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return out.join('');
}

/** Provenance line — names the Federal Register / OFR + public-domain status. */
export function dataNote() {
  return `source: ${SRC}; the Federal Register is public domain (host-forever); abstracts are the agency's own words`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('federal-register.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'agency') {
    const slug = rest[0] || '';
    const type = rest[1] || '';
    const docs = await listDocuments({ agency: slug, type });
    console.log(`SoapBox Federal Register — ${docs.length} docs for ${slug}${type ? ` [${type}]` : ''}`);
    for (const d of docs.slice(0, 25)) console.log(`  • ${d.publicationDate} [${d.type}] ${d.title}\n    ${d.htmlUrl}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'doc') {
    const n = rest[0];
    const d = await documentByNumber(n);
    console.log(`SoapBox Federal Register — document ${n}`);
    if (d) { console.log(`  ${d.title} [${d.type}] ${d.publicationDate}`); if (d.abstract) console.log(`  ${d.abstract}`); console.log(`  ${d.htmlUrl}`); }
    else console.log('  not found');
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: federal-register.mjs <agency AGENCY_SLUG [type] | doc DOCUMENT_NUMBER>');
    console.log(`  types: ${Object.keys(TYPES).join(', ')}  (FR reads are keyless/open; public domain)`);
  }
}
