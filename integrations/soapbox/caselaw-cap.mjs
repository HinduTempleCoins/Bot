// caselaw-cap.mjs — Law.SoapBox legal-vertical CITATION reader (v3 §10).
//
// BACKEND SWAP (2026-09): the Caselaw Access Project API (api.case.law) was DECOMMISSIONED. This module
// keeps its legacy filename and PUBLIC CONTRACT (parseCitation / caseByCitation / caseById / citationUrl /
// caseText / normalizeCase / renderPage / dataNote / __setFetch, and the same flat case-card shape callers
// read) but now reads the LIVE source: the CourtListener REST v4 API (courtlistener.com/api/rest/v4), the
// Free Law Project's open caselaw database (9M+ decisions). It is a thin adapter over CourtListener so
// site/law/server.mjs callers (cap.caseByCitation, cap.caseById) keep working unchanged.
//
// It resolves a reporter citation (e.g. "347 U.S. 483") to its case via the v4 citation-lookup endpoint,
// and fetches one case (cluster) by CourtListener cluster id with the court's verbatim opinion text.
//
// KEYLESS at a low rate; a personal token (env COURTLISTENER_API_TOKEN — falls back to COURTLISTENER_TOKEN
// for parity with the sibling modules — sent as "Authorization: Token …") raises the rate but is OPTIONAL.
// The token is read from the environment by NAME; it is NEVER hard-coded, logged, or printed.
//
// DISCIPLINE (v3 §10 — non-negotiable):
//   • FEDERAL/STATE OPINIONS ARE PUBLIC DOMAIN. U.S. judicial opinions carry no copyright; we mark cases
//     license:'public-domain' and host them forever. We attribute Free Law Project / CourtListener.
//   • STATE FACTS, LINK SOURCES. Case name, court, decision date, reporter citation(s), a head snippet or
//     the verbatim opinion text, and the canonical CourtListener URL. NO holding-summary, NO editorial
//     headnote, NO "good law" verdict.
//   • RESPECT REDACTION NORMS. We read the already-published, digitized opinion text; we never reconstruct
//     any material a court sealed or redacted.
//
// Pattern follows courtlistener-opinions.mjs: ESM, zero deps, __setFetch seam, soft-fail (return []/null,
// NEVER throw), injectable data for tests, guarded CLI demo, escaped HTML.
//
//   import { parseCitation, caseById, caseByCitation, citationUrl,
//            renderPage, dataNote, __setFetch } from './caselaw-cap.mjs'
//   node integrations/soapbox/caselaw-cap.mjs cite "347 U.S. 483"
//   node integrations/soapbox/caselaw-cap.mjs id 118144

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCaselaw/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://www.courtlistener.com/api/rest/v4'; // CourtListener REST v4 (open; keyless low-rate)
const WEB = 'https://www.courtlistener.com';
const SRC = 'CourtListener (Free Law Project)';
// U.S. judicial opinions are public domain; CourtListener distributes the open record under attribution.
const LICENSE = 'public-domain';

// ---- key handling: env COURTLISTENER_API_TOKEN by NAME, optional (keyless works at a lower rate) ----
function authHeaders() {
  const key = process.env.COURTLISTENER_API_TOKEN || process.env.COURTLISTENER_TOKEN;
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

// CourtListener id fields come back as resource URLs like ".../clusters/118144/"; pull the numeric id. PURE.
function idFromUrl(u) {
  const m = String(u || '').match(/\/(\d+)\/?$/);
  return m ? m[1] : '';
}
// Court ids are alphanumeric slugs (e.g. "ca2", "scotus"); pull the last non-empty path segment. PURE.
function slugFromUrl(u) {
  const m = String(u || '').match(/\/([^/]+)\/?$/);
  return m ? m[1] : '';
}

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

/**
 * Extract the opinion text from a CourtListener opinion object (or a cluster that inlines its
 * sub_opinions). Opinion bodies arrive in several columns (plain_text, html, html_lawbox, html_columbia,
 * html_with_citations); take the first non-empty, strip tags, collapse whitespace. PURE.
 */
export function caseText(op) {
  if (!op || typeof op !== 'object') return '';
  const raw = op.plain_text || op.html || op.html_lawbox || op.html_columbia || op.html_with_citations || '';
  if (raw) return String(raw).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  // a cluster may inline its opinions as objects — recurse into the first that carries a body.
  const subs = Array.isArray(op.sub_opinions) ? op.sub_opinions : (Array.isArray(op.opinions) ? op.opinions : []);
  for (const s of subs) { if (s && typeof s === 'object') { const t = caseText(s); if (t) return t; } }
  return '';
}

export function snippetOf(text, max = 280) {
  const t = str(text);
  const lim = Math.max(1, num(max) || 280);
  if (t.length <= lim) return t;
  const cut = t.slice(0, lim);
  const sp = cut.lastIndexOf(' ');
  return (sp > lim * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

/** Build a CourtListener lookup URL from a parsed citation (opinion search on the normalized cite). PURE. */
export function citationUrl(parsed) {
  if (!parsed || !parsed.volume || !parsed.reporter || !parsed.page) return '';
  return `${WEB}/?q=${encodeURIComponent(parsed.normalized)}&type=o`;
}

// Assemble reporter citation strings from a CourtListener cluster's `citations` (objects) or a flat list.
function citeStrings(r) {
  if (Array.isArray(r.citations)) {
    return r.citations.map((c) => (typeof c === 'string'
      ? str(c)
      : [str(c.volume), str(c.reporter), str(c.page)].filter(Boolean).join(' '))).filter(Boolean);
  }
  if (Array.isArray(r.citation)) return r.citation.map(str).filter(Boolean);
  return [];
}

/**
 * Normalize a raw CourtListener CLUSTER record → a flat case card (same shape callers already read from the
 * legacy CAP module). Returns null for unusable input. With { full:true } the card also carries `fullText`
 * — the court's VERBATIM untruncated opinion text — for the case-detail page. The 280-char `snippet` is
 * always present for list views. The opinion body is passed in via `opinionText` (fetched separately) or,
 * failing that, read from an inlined opinion on the cluster. Facts-not-verdicts: the text is the source's
 * OWN public-domain words, never our gloss.
 */
export function normalizeCase(r, { snippetMax = 280, full = false, opinionText = '' } = {}) {
  if (!r || typeof r !== 'object') return null;
  const id = r.id != null ? String(r.id) : idFromUrl(r.resource_uri || r.absolute_url);
  const name = str(r.case_name) || str(r.case_name_full) || str(r.caseName) || str(r.caseNameFull);
  if (!id && !name) return null;
  const cites = citeStrings(r);
  const firstCiteObj = Array.isArray(r.citations) && r.citations.length && typeof r.citations[0] === 'object'
    ? r.citations[0] : null;
  const reporter = firstCiteObj ? str(firstCiteObj.reporter)
    : (cites.length ? cites[0].split(' ').slice(1, -1).join(' ') : '');
  const court = slugFromUrl(r.court) || str(r.court_id) || str(r.court_str) || slugFromUrl(r.docket);
  const text = str(opinionText) || caseText(r);
  const abs = str(r.absolute_url);
  return tag({
    caseId: id,
    caseName: name,
    court,
    decisionDate: str(r.date_filed) || str(r.dateFiled),
    citations: cites,
    reporter,
    snippet: text ? snippetOf(text, snippetMax) : '',
    ...(full ? { fullText: text } : {}),
    url: abs ? (abs.startsWith('http') ? abs : `${WEB}${abs}`) : (id ? `${WEB}/opinion/${id}/` : ''),
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

// The v4 citation-lookup endpoint is POST-only (structured volume/reporter/page, or a text blob).
// Records the transport outcome in `_lastPost` so callers can tell a rate-limit/error (retry later,
// serve stale) apart from a clean empty result (genuinely no such case). 429 is CourtListener's
// citation-lookup throttle — the demonstrated failure mode that made valid cites read "No case found".
let _lastPost = { ok: false, status: 0, error: false };
async function postJson(u, body) {
  try {
    const r = await _fetch(u, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    _lastPost = { ok: !!(r && r.ok), status: (r && r.status) || 0, error: false };
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { _lastPost = { ok: false, status: 0, error: true }; return null; }
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

// Best-effort fetch of a cluster's lead-opinion text: use an inlined body if present, else GET the first
// sub_opinion resource. Soft-fails to '' (a card without a snippet is still valid).
async function opinionTextFor(cluster) {
  const inlined = caseText(cluster);
  if (inlined) return inlined;
  const subs = Array.isArray(cluster.sub_opinions) ? cluster.sub_opinions : [];
  const first = subs.find(Boolean);
  if (!first) return '';
  const url = typeof first === 'string' ? first : str(first.resource_uri || first.absolute_url);
  if (!url) return '';
  const j = await getJson(url.startsWith('http') ? url : `${WEB}${url}`);
  return j ? caseText(j) : '';
}

/**
 * Fetch one case by CourtListener CLUSTER id, with the lead opinion's text. Returns a normalized case card
 * or null. Pass { full:true } to also get the untruncated `fullText` (the whole opinion) on the card for
 * the case-detail page; the bounded `snippet` is always present either way.
 * @param {string|number} caseId  a CourtListener cluster id
 * @param {{full?:boolean}} [opts]
 */
export async function caseById(caseId, { full = false } = {}) {
  const id = str(caseId);
  if (!id) return null;
  const cluster = await getJson(apiUrl(`/clusters/${encodeURIComponent(id)}/`));
  if (!cluster || typeof cluster !== 'object') return null;
  const text = await opinionTextFor(cluster);
  return normalizeCase(cluster, { full, opinionText: text });
}

/**
 * Resolve a reporter citation (e.g. "347 U.S. 483") to its case record via the CourtListener v4
 * citation-lookup endpoint. Returns a normalized card, or null if the citation can't be parsed or no case
 * is found. With { full:true } the card carries the untruncated `fullText` for the case-detail page; the
 * bounded `snippet` is always present either way. Default is { full:false } for back-compat with list callers.
 * @param {string} cite
 * @param {{full?:boolean}} [opts]
 */
// U.S. opinions are immutable public-domain records, so a resolved citation never changes — we cache
// resolved cards hard (keyed by normalized cite + full/list variant) and, on a rate-limit/transport error,
// serve any cached copy regardless of age (stale-while-error). This is what keeps popular cites resolving
// through CourtListener's 429s instead of dead-ending at "No case found".
const _citeCache = new Map(); // key -> { card, at }
const CITE_TTL_MS = 24 * 60 * 60 * 1000; // 24h freshness for a live re-verify; stale still served on error
/** Test seam: clear the citation cache so a test can exercise the live lookup/miss paths in isolation. */
export function __resetCache() { _citeCache.clear(); _lastPost = { ok: false, status: 0, error: false }; }
/** Was the most recent citation lookup blocked by a rate-limit/transport error (vs. a clean not-found)? */
export function citationLookupThrottled() { return !!(_lastPost && (_lastPost.error || _lastPost.status === 429 || _lastPost.status === 503)); }

export async function caseByCitation(cite, { full = false } = {}) {
  const parsed = parseCitation(cite);
  if (!parsed) return null;
  const key = `${parsed.normalized}|${full ? 'full' : 'list'}`;
  const hit = _citeCache.get(key);
  if (hit && (Date.now() - hit.at) < CITE_TTL_MS) return hit.card; // fresh cache
  const resp = await postJson(apiUrl('/citation-lookup/'), {
    volume: parsed.volume, reporter: parsed.reporter, page: parsed.page,
  });
  const entries = Array.isArray(resp) ? resp : [];
  let cluster = null;
  for (const e of entries) {
    const cl = Array.isArray(e?.clusters) ? e.clusters.find(Boolean) : null;
    if (cl) { cluster = cl; break; }
  }
  if (!cluster) {
    // Rate-limited/errored? Serve a stale card if we have one; the record can't have changed anyway.
    if (citationLookupThrottled() && hit) return hit.card;
    return null; // genuine not-found (or throttled with nothing cached — view checks the throttle flag)
  }
  const text = await opinionTextFor(cluster);
  const card = normalizeCase(cluster, { full, opinionText: text });
  if (card && !card.citationLookup) card.citationLookup = parsed.normalized;
  if (card) _citeCache.set(key, { card, at: Date.now() });
  return card;
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a single case card (+ optional snippet/full text) OR a "not found" notice. PURE; soft-
 * handles missing fields. Facts only — name, court, date, citations, opinion text, link. Never a verdict.
 * @param {{case?:object, citation?:string}} data
 */
export function renderPage(data = {}) {
  const c = data.case || null;
  if (!c) {
    return `<section class="cap-case"><h2>Caselaw — public record</h2><p class="cap-empty">No case found${data.citation ? ` for ${esc(data.citation)}` : ''}.</p><p class="data-note">${esc(dataNote())}</p></section>`;
  }
  const parts = ['<section class="cap-case"><h2>Caselaw — public record</h2>'];
  parts.push(`<p class="cap-name"><strong>${esc(c.caseName || 'Case')}</strong>${c.caseId ? ' (CourtListener #' + esc(c.caseId) + ')' : ''}</p>`);
  parts.push('<ul class="cap-meta">');
  parts.push(`<li>Court: ${esc(c.court || '—')}</li>`);
  parts.push(`<li>Decided: ${esc(c.decisionDate || '—')}</li>`);
  if (Array.isArray(c.citations) && c.citations.length) parts.push(`<li>Citations: ${esc(c.citations.join('; '))}</li>`);
  if (c.reporter) parts.push(`<li>Reporter: ${esc(c.reporter)}</li>`);
  parts.push('</ul>');
  // Prefer the FULL public-domain opinion text when the card carries it (case-detail page); otherwise fall
  // back to the bounded snippet (list/preview). The text is the court's OWN words, never our gloss.
  if (c.fullText) parts.push(`<div class="cap-fulltext"><pre>${esc(c.fullText)}</pre></div>`);
  else if (c.snippet) parts.push(`<blockquote class="cap-snippet">${esc(c.snippet)}</blockquote>`);
  if (c.url) parts.push(`<p class="cap-link"><a href="${esc(c.url)}">Read the full opinion at CourtListener</a></p>`);
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names CourtListener / Free Law Project + public-domain + host-forever. */
export function dataNote() {
  return `source: ${SRC}; U.S. judicial opinions are public domain (host-forever); court redactions respected; corrections via Free Law Project`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('caselaw-cap.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'cite') {
    const cite = rest.join(' ');
    const parsed = parseCitation(cite);
    console.log(`SoapBox Caselaw (CourtListener v4) — cite "${cite}" → ${parsed ? parsed.normalized : 'unparseable'}`);
    if (parsed) console.log(`  lookup url: ${citationUrl(parsed)}`);
    const c = await caseByCitation(cite);
    if (c) console.log(`  ${c.caseName} — ${c.court} (${c.decisionDate})\n  ${c.url}`);
    else console.log('  no case record found (or offline)');
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'id') {
    const id = rest[0];
    const c = await caseById(id);
    console.log(`SoapBox Caselaw (CourtListener v4) — cluster ${id}`);
    if (c) { console.log(`  ${c.caseName} — ${c.court} (${c.decisionDate})`); if (c.snippet) console.log(`  ${c.snippet}`); console.log(`  ${c.url}`); }
    else console.log('  not found');
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: caselaw-cap.mjs <cite "VOL REPORTER PAGE" | id CLUSTER_ID>');
    console.log(`  CourtListener reads are keyless/low-rate; COURTLISTENER_API_TOKEN ${process.env.COURTLISTENER_API_TOKEN || process.env.COURTLISTENER_TOKEN ? 'is set' : 'unset'}.`);
  }
}
