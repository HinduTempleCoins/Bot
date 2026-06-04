// caselaw-cap.mjs — Law.SoapBox legal-vertical reader (v3 §10) over the Caselaw Access Project (CAP),
// Harvard Law School Library's digitization of ~6.7M U.S. cases. CAP's bulk data is served STATICALLY
// and KEYLESS from static.case.law (the legacy api.case.law is read here too where present). No key is
// required; everything we read is open. This module fetches a case by CAP id and resolves a reporter
// citation (e.g. "347 U.S. 483") to its case record.
//
// DISCIPLINE (v3 §10 — non-negotiable):
//   • PUBLIC-DOMAIN CASELAW, HOST FOREVER. The text of U.S. judicial opinions carries no copyright; CAP
//     made the full corpus open in 2024. We mark cases license:'public-domain'. Attribute CAP / Harvard
//     LIL as the digitizer of record either way.
//   • STATE FACTS, LINK SOURCES. Case name, court, decision date, reporter citation(s), a head snippet,
//     and the canonical case.law URL. NO holding-summary, NO editorial headnote, NO "good law" verdict.
//   • RESPECT REDACTION NORMS. We read the published, digitized opinion text; we do not reconstruct any
//     material a court sealed or redacted.
//
// Pattern follows worldbank.mjs / courtlistener-opinions.mjs: ESM, zero deps, __setFetch seam,
// soft-fail (return []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped HTML.
//
//   import { parseCitation, caseById, caseByCitation, citationUrl,
//            renderPage, dataNote, __setFetch } from './caselaw-cap.mjs'
//   node integrations/soapbox/caselaw-cap.mjs cite "347 U.S. 483"
//   node integrations/soapbox/caselaw-cap.mjs id 12345

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCaselawCAP/1.0 (+https://data.soapbox.community)' };
const API = 'https://api.case.law/v1'; // legacy read API (open, keyless for metadata + full text)
const WEB = 'https://case.law';
const SRC = 'Caselaw Access Project (Harvard Law School Library Innovation Lab)';
// U.S. judicial opinions are public domain; CAP opened the full corpus in 2024.
const LICENSE = 'public-domain';

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

/**
 * Parse a U.S. reporter citation → { volume, reporter, page, normalized } or null. Handles the common
 * "<vol> <Reporter> <page>" shape (e.g. "347 U.S. 483", "98 F.3d 1010", "5 Cal. 4th 200"). PURE.
 */
export function parseCitation(cite) {
  const c = str(cite).replace(/\s+/g, ' ');
  if (!c) return null;
  // volume = leading number; page = trailing number; reporter = everything between.
  const m = c.match(/^(\d+)\s+(.+?)\s+(\d+)$/);
  if (!m) return null;
  const volume = m[1];
  const reporter = m[2].trim();
  const page = m[3];
  if (!reporter) return null;
  return { volume, reporter, page, normalized: `${volume} ${reporter} ${page}` };
}

// CAP serves a snippet of opinion text via casebody.data.opinions[].text; first non-empty, collapsed. PURE.
export function caseText(cb) {
  if (!cb || typeof cb !== 'object') return '';
  const data = cb.casebody && cb.casebody.data ? cb.casebody.data : cb.casebody || cb;
  const ops = data && Array.isArray(data.opinions) ? data.opinions : [];
  for (const o of ops) { const t = str(o && o.text); if (t) return t.replace(/\s+/g, ' ').trim(); }
  // some CAP shapes carry plain head matter
  return str(data && data.head_matter).replace(/\s+/g, ' ').trim();
}

export function snippetOf(text, max = 280) {
  const t = str(text);
  const lim = Math.max(1, num(max) || 280);
  if (t.length <= lim) return t;
  const cut = t.slice(0, lim);
  const sp = cut.lastIndexOf(' ');
  return (sp > lim * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

/** Build the canonical case.law citation URL from a parsed citation. PURE. */
export function citationUrl(parsed) {
  if (!parsed || !parsed.volume || !parsed.reporter || !parsed.page) return '';
  // case.law uses reporter slugs; we keep the human reporter in the cite query for the search redirect.
  const slug = String(parsed.reporter).toLowerCase().replace(/\./g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `${WEB}/search/#/cases?q=${encodeURIComponent(parsed.normalized)}&cite=${slug}`;
}

/**
 * Normalize a raw CAP case record → a flat case card. Returns null for unusable input.
 * With { full:true } the card also carries `fullText` — the court's VERBATIM untruncated opinion text
 * (the whole decision) for the case-detail page. The 280-char `snippet` is always present for list views.
 * Facts-not-verdicts discipline: fullText is the source's OWN public-domain words, never our gloss.
 */
export function normalizeCase(r, { snippetMax = 280, full = false } = {}) {
  if (!r || typeof r !== 'object') return null;
  const id = r.id != null ? String(r.id) : '';
  const name = str(r.name_abbreviation) || str(r.name);
  if (!id && !name) return null;
  const cites = Array.isArray(r.citations) ? r.citations.map((c) => str(c && c.cite)).filter(Boolean) : [];
  const court = r.court && typeof r.court === 'object' ? (str(r.court.name_abbreviation) || str(r.court.name)) : str(r.court);
  const text = caseText(r);
  return tag({
    caseId: id,
    caseName: name,
    court,
    decisionDate: str(r.decision_date),
    citations: cites,
    reporter: r.reporter && typeof r.reporter === 'object' ? str(r.reporter.full_name) : str(r.reporter),
    snippet: text ? snippetOf(text, snippetMax) : '',
    ...(full ? { fullText: text } : {}),
    url: str(r.frontend_url) || (id ? `${WEB}/caselaw/?reporter=&volume=&case=${id}` : ''),
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

function apiUrl(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${API}${path}${qs ? '?' + qs : ''}`;
}

/**
 * Fetch one CAP case by id, with full casebody text. Returns a normalized case card or null.
 * Pass { full:true } to also get the untruncated `fullText` (the whole opinion) on the card for the
 * case-detail page; the bounded `snippet` is always present either way.
 * @param {string|number} caseId
 * @param {{full?:boolean}} [opts]
 */
export async function caseById(caseId, { full = false } = {}) {
  const id = str(caseId);
  if (!id) return null;
  const j = await getJson(apiUrl(`/cases/${encodeURIComponent(id)}/`, { full_case: 'true', body_format: 'text' }));
  return normalizeCase(j, { full });
}

/**
 * Resolve a reporter citation (e.g. "347 U.S. 483") to its CAP case record. Returns a normalized card,
 * or null if the citation can't be parsed or no case is found.
 * The query already asks CAP for the full case body (full_case=true, body_format=text), so with
 * { full:true } the card carries the untruncated `fullText` for the case-detail page; the bounded
 * `snippet` is always present either way. Default is { full:false } for back-compat with list callers.
 * @param {string} cite
 * @param {{full?:boolean}} [opts]
 */
export async function caseByCitation(cite, { full = false } = {}) {
  const parsed = parseCitation(cite);
  if (!parsed) return null;
  const j = await getJson(apiUrl('/cases/', { cite: parsed.normalized, full_case: 'true', body_format: 'text', page_size: 1 }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  const first = rows.find(Boolean);
  const card = first ? normalizeCase(first, { full }) : null;
  if (card && !card.citationLookup) card.citationLookup = parsed.normalized;
  return card;
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a single CAP case card (+ optional snippet) OR a "not found" notice. PURE; soft-
 * handles missing fields. Facts only — name, court, date, citations, snippet, link. Never a verdict.
 * @param {{case?:object, citation?:string}} data
 */
export function renderPage(data = {}) {
  const c = data.case || null;
  if (!c) {
    return `<section class="cap-case"><h2>Caselaw — public record</h2><p class="cap-empty">No case found${data.citation ? ` for ${esc(data.citation)}` : ''}.</p><p class="data-note">${esc(dataNote())}</p></section>`;
  }
  const parts = ['<section class="cap-case"><h2>Caselaw — public record</h2>'];
  parts.push(`<p class="cap-name"><strong>${esc(c.caseName || 'Case')}</strong>${c.caseId ? ' (CAP #' + esc(c.caseId) + ')' : ''}</p>`);
  parts.push('<ul class="cap-meta">');
  parts.push(`<li>Court: ${esc(c.court || '—')}</li>`);
  parts.push(`<li>Decided: ${esc(c.decisionDate || '—')}</li>`);
  if (Array.isArray(c.citations) && c.citations.length) parts.push(`<li>Citations: ${esc(c.citations.join('; '))}</li>`);
  if (c.reporter) parts.push(`<li>Reporter: ${esc(c.reporter)}</li>`);
  parts.push('</ul>');
  // Prefer the FULL public-domain opinion text when the card carries it (case-detail page); otherwise
  // fall back to the bounded snippet (list/preview). The text is the court's OWN words, never our gloss.
  if (c.fullText) parts.push(`<div class="cap-fulltext"><pre>${esc(c.fullText)}</pre></div>`);
  else if (c.snippet) parts.push(`<blockquote class="cap-snippet">${esc(c.snippet)}</blockquote>`);
  if (c.url) parts.push(`<p class="cap-link"><a href="${esc(c.url)}">Read the full case at the Caselaw Access Project</a></p>`);
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names CAP / Harvard LIL + public-domain + host-forever. */
export function dataNote() {
  return `source: ${SRC}; U.S. caselaw is public domain (host-forever); court redactions respected; corrections via the Caselaw Access Project`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('caselaw-cap.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'cite') {
    const cite = rest.join(' ');
    const parsed = parseCitation(cite);
    console.log(`SoapBox Caselaw Access Project — cite "${cite}" → ${parsed ? parsed.normalized : 'unparseable'}`);
    if (parsed) console.log(`  lookup url: ${citationUrl(parsed)}`);
    const c = await caseByCitation(cite);
    if (c) console.log(`  ${c.caseName} — ${c.court} (${c.decisionDate})\n  ${c.url}`);
    else console.log('  no case record found (or offline)');
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'id') {
    const id = rest[0];
    const c = await caseById(id);
    console.log(`SoapBox Caselaw Access Project — case ${id}`);
    if (c) { console.log(`  ${c.caseName} — ${c.court} (${c.decisionDate})`); if (c.snippet) console.log(`  ${c.snippet}`); console.log(`  ${c.url}`); }
    else console.log('  not found');
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: caselaw-cap.mjs <cite "VOL REPORTER PAGE" | id CASE_ID>');
    console.log('  CAP reads are keyless/open; U.S. caselaw is public domain.');
  }
}
