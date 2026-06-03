// legal.mjs — SoapBox Legal vertical (queue task #102): "what's happening in the courts and the
// federal government," sourced from free, public, US legal-data APIs. Three sources, all soft-fail
// (a dead source returns [] / null, never throws — the page degrades, it doesn't break):
//
//   1. CourtListener REST API v4 (Free Law Project) — opinions, dockets, courts. Token is OPTIONAL
//      (many search endpoints work unauthenticated); if process.env.COURTLISTENER_TOKEN is set we
//      send it as `Authorization: Token <tok>` for higher rate limits. Never logged/printed.
//   2. Federal Register API — keyless. Executive orders, rules, notices published in the FR.
//   3. GovInfo (api.govinfo.gov) — needs a free api.data.gov key in process.env.GOVINFO_API_KEY.
//      Without the key we soft-fail (return null) rather than calling with a bad/empty key.
//
// Follows the macro.mjs pattern: ESM, __setFetch hook for tests, CLI guarded by argv check.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4';
const FR_BASE = 'https://www.federalregister.gov/api/v1';
const GI_BASE = 'https://api.govinfo.gov';

// CourtListener auth header — only when a token is present. The token value is never logged.
function clHeaders() {
  const h = { 'user-agent': UA, accept: 'application/json' };
  const tok = process.env.COURTLISTENER_TOKEN;
  if (tok) h.authorization = `Token ${tok}`;
  return h;
}

async function getJson(url, headers) {
  try {
    const r = await _fetch(url, { headers: headers || { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Search CourtListener opinions (case law) for a query string.
 * Soft-fails to [] on any error. Returns normalized rows.
 */
export async function searchOpinions(q, { limit = 10 } = {}) {
  if (!q) return [];
  const url = `${CL_BASE}/search/?type=o&q=${encodeURIComponent(q)}&order_by=score%20desc`;
  const data = await getJson(url, clHeaders());
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.slice(0, limit).map((r) => ({
    id: r.id ?? r.cluster_id ?? null,
    caseName: r.caseName || r.caseNameFull || r.caseName_short || 'Untitled',
    court: r.court || r.court_id || null,
    dateFiled: r.dateFiled || r.dateArgued || null,
    citation: Array.isArray(r.citation) ? r.citation[0] : (r.citation || null),
    docketNumber: r.docketNumber || null,
    snippet: (r.snippet || '').replace(/<[^>]+>/g, '').trim() || null,
    url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
  }));
}

/**
 * Look up a single CourtListener court by its id (e.g. "scotus", "ca9").
 * Soft-fails to null.
 */
export async function court(id) {
  if (!id) return null;
  const data = await getJson(`${CL_BASE}/courts/${encodeURIComponent(id)}/`, clHeaders());
  if (!data || (!data.id && !data.full_name)) return null;
  return {
    id: data.id || id,
    name: data.full_name || data.short_name || id,
    jurisdiction: data.jurisdiction || null,
    citationString: data.citation_string || null,
    url: data.url || null,
    inUse: data.in_use ?? null,
    startDate: data.start_date || null,
  };
}

/**
 * Search the Federal Register (keyless) for documents matching a query.
 * Soft-fails to [].
 */
export async function federalRegister(q, { limit = 10 } = {}) {
  if (!q) return [];
  const fields = ['title', 'document_number', 'publication_date', 'type', 'abstract', 'html_url', 'agencies']
    .map((f) => `fields[]=${f}`).join('&');
  const url = `${FR_BASE}/documents.json?per_page=${limit}&order=newest&conditions[term]=${encodeURIComponent(q)}&${fields}`;
  const data = await getJson(url);
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.slice(0, limit).map((r) => ({
    documentNumber: r.document_number || null,
    title: r.title || 'Untitled',
    type: r.type || null,
    publicationDate: r.publication_date || null,
    agencies: Array.isArray(r.agencies) ? r.agencies.map((a) => a?.name).filter(Boolean) : [],
    abstract: r.abstract || null,
    url: r.html_url || null,
  }));
}

/**
 * Search GovInfo published collections (needs GOVINFO_API_KEY; soft-fails to null without it,
 * and to [] on a failed request when the key IS present).
 */
export async function govInfo(q, { limit = 10 } = {}) {
  const key = process.env.GOVINFO_API_KEY;
  if (!key) return null; // no key → soft-fail, don't make a doomed request
  if (!q) return [];
  const body = JSON.stringify({ query: q, pageSize: limit, offsetMark: '*' });
  try {
    const r = await _fetch(`${GI_BASE}/search?api_key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' },
      body,
    });
    if (!r || !r.ok) return [];
    const data = await r.json();
    const rows = Array.isArray(data?.results) ? data.results : [];
    return rows.slice(0, limit).map((r2) => ({
      title: r2.title || 'Untitled',
      collection: r2.collectionName || r2.collectionCode || null,
      dateIssued: r2.dateIssued || null,
      packageId: r2.packageId || null,
      url: (r2.download && (r2.download.pdfLink || r2.download.txtLink)) || r2.detailsLink || null,
    }));
  } catch { return []; }
}

/**
 * One-call legal snapshot for a query: case law (CourtListener) + executive/regulatory
 * activity (Federal Register) + GovInfo (if a key is configured). Each source soft-fails
 * independently, so the summary always returns a well-formed object.
 */
export async function legalSummary(q, { limit = 5 } = {}) {
  const [opinions, fedReg, gov] = await Promise.all([
    searchOpinions(q, { limit }).catch(() => []),
    federalRegister(q, { limit }).catch(() => []),
    govInfo(q, { limit }).catch(() => null),
  ]);
  return {
    query: q || '',
    opinions: opinions || [],
    federalRegister: fedReg || [],
    govInfo: gov, // null when no key; [] when key present but empty
    sources: {
      courtListener: { authed: !!process.env.COURTLISTENER_TOKEN },
      federalRegister: { keyless: true },
      govInfo: { configured: !!process.env.GOVINFO_API_KEY },
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith('legal.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'first amendment';
  const s = await legalSummary(q);
  console.log(`\nLegal snapshot for: ${s.query}`);
  console.log(`\nCase law (CourtListener${s.sources.courtListener.authed ? ', authed' : ''}):`);
  for (const o of s.opinions) console.log(`  ${o.caseName}${o.dateFiled ? ` (${o.dateFiled})` : ''}  ${o.url || ''}`);
  console.log(`\nFederal Register:`);
  for (const d of s.federalRegister) console.log(`  [${d.type || '?'}] ${d.title}  ${d.url || ''}`);
  if (s.govInfo) { console.log(`\nGovInfo:`); for (const g of s.govInfo) console.log(`  ${g.title}  ${g.url || ''}`); }
  else console.log(`\nGovInfo: (set GOVINFO_API_KEY to enable)`);
}
