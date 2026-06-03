// library-federation.mjs — keyless (where possible) FEDERATION readers for the SoapBox Library. Where
// library-catalog.mjs covers the global book/scholarly catalogs, this module reaches into the big
// digital-heritage AGGREGATORS — the ones that federate thousands of libraries, archives and museums:
//
//   Library of Congress  — loc.gov JSON API. KEYLESS. https://www.loc.gov/search/?q=...&fo=json
//   DPLA                 — Digital Public Library of America. Needs a key (api.dp.la). We accept it by
//                          name from env DPLA_API_KEY and SOFT-SKIP when absent (no key → no DPLA rows).
//   Europeana            — 50M+ items from European cultural institutions. Needs a key (api.europeana.eu).
//                          env EUROPEANA_API_KEY; SOFT-SKIP when absent.
//
// At least LOC works with zero configuration, so searchFederation() always returns real results offline-
// key environments. Each row carries provenance (`source`) + a `license`/`rights` field so the Library
// page can apply the same host-fully vs metadata-only treatment the catalog uses.
//
// Pattern mirrors worldbank.mjs / library-catalog.mjs: ESM, zero deps, __setFetch seam, soft-fail (a
// dead/keyless source yields [], never throws), provenance fields, CLI behind argv guard, offline tests.
//
//   import { searchFederation, loc, dpla, europeana } from './library-federation.mjs'
//   node integrations/soapbox/library-federation.mjs "civil war photographs"

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0; +https://soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Keys are read by NAME from env; absent → that source is silently skipped (soft-skip).
const DPLA_KEY = process.env.DPLA_API_KEY || '';
const EUROPEANA_KEY = process.env.EUROPEANA_API_KEY || '';

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────
async function getJSON(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);
function str(v) { const x = firstOf(v); return x == null ? '' : String(x).trim(); }
function clampYear(y) {
  const m = String(y || '').match(/-?\d{3,4}/);
  const n = m ? parseInt(m[0], 10) : NaN;
  return Number.isFinite(n) && n > -3000 && n < 3000 ? n : null;
}

// ── Library of Congress (KEYLESS) ───────────────────────────────────────────────────────────────────
/** Search loc.gov's JSON API. Keyless. Soft-fails to []. Each row is a digitized LoC item. */
export async function loc(q, { limit = 20 } = {}) {
  if (!q) return [];
  const u = `https://www.loc.gov/search/?q=${encodeURIComponent(q)}&fo=json&c=${limit}`;
  const j = await getJSON(u);
  const results = j?.results || [];
  return results.slice(0, limit).map((r) => {
    // LoC items are very often public-domain US government / heritage material, but rights vary; we
    // record the rights string and let the catalog classifier decide. Default to a conservative blank.
    const rights = str(r.rights || r.rights_information || r.access_restricted);
    return {
      source: 'loc',
      provider: 'Library of Congress',
      type: str(firstOf(r.original_format)) || 'item',
      title: str(r.title) || '',
      authors: [].concat(r.contributor || []).map(String).filter(Boolean),
      year: clampYear(r.date),
      url: str(r.id) || str(r.url) || (r.aka ? str(r.aka) : ''),
      thumb: str(firstOf(r.image_url)) || null,
      rights: rights || null,
      // LoC digitizes much PD heritage; mark openAccess only when nothing restricts it.
      license: null,
      openAccess: /no known|public domain|free to use/i.test(rights),
    };
  }).filter((x) => x.title);
}

// ── DPLA (needs DPLA_API_KEY; soft-skip absent) ─────────────────────────────────────────────────────
/** Digital Public Library of America. Returns [] (soft-skip) when DPLA_API_KEY is not set. */
export async function dpla(q, { limit = 20 } = {}) {
  if (!q || !DPLA_KEY) return []; // soft-skip: no key, no DPLA
  const u = `https://api.dp.la/v2/items?q=${encodeURIComponent(q)}&page_size=${limit}&api_key=${encodeURIComponent(DPLA_KEY)}`;
  const j = await getJSON(u);
  const docs = j?.docs || [];
  return docs.map((d) => {
    const sr = d.sourceResource || {};
    const rights = str(sr.rights);
    return {
      source: 'dpla',
      provider: str(d.dataProvider) || str(d.provider?.name) || 'DPLA',
      type: str(sr.type) || 'item',
      title: str(sr.title) || '',
      authors: [].concat(sr.creator || []).map(String).filter(Boolean),
      year: clampYear(sr.date?.displayDate || sr.date),
      url: str(d.isShownAt) || str(d.object) || '',
      thumb: str(d.object) || null,
      rights: rights || null,
      license: null,
      openAccess: /no copyright|public domain|no known/i.test(rights),
    };
  }).filter((x) => x.title);
}

// ── Europeana (needs EUROPEANA_API_KEY; soft-skip absent) ────────────────────────────────────────────
/** Europeana cultural-heritage search. Returns [] (soft-skip) when EUROPEANA_API_KEY is not set. */
export async function europeana(q, { limit = 20 } = {}) {
  if (!q || !EUROPEANA_KEY) return []; // soft-skip: no key, no Europeana
  const u = `https://api.europeana.eu/record/v2/search.json?wskey=${encodeURIComponent(EUROPEANA_KEY)}`
    + `&query=${encodeURIComponent(q)}&rows=${limit}`;
  const j = await getJSON(u);
  const items = j?.items || [];
  return items.map((it) => {
    const license = str(it.rights); // Europeana standardizes on rights-statement / CC URLs
    return {
      source: 'europeana',
      provider: str(it.dataProvider) || str(it.provider) || 'Europeana',
      type: str(it.type) || 'item',
      title: str(it.title) || '',
      authors: [].concat(it.dcCreator || []).map(String).filter(Boolean),
      year: clampYear(str(it.year)),
      url: str(it.guid) || str(firstOf(it.edmIsShownAt)) || '',
      thumb: str(firstOf(it.edmPreview)) || null,
      rights: license || null,
      license: license || null,
      openAccess: /creativecommons|publicdomain|\/zero\//i.test(license),
    };
  }).filter((x) => x.title);
}

// ── unified federation search ────────────────────────────────────────────────────────────────────────
/**
 * Run all federation readers in parallel and MERGE their rows with provenance + license/rights fields.
 * Keyless sources (LoC) always contribute; keyed sources (DPLA, Europeana) contribute only when their
 * env key is present. Soft-fails: any dead/absent source yields nothing; the call never throws.
 *
 * @param {string} q
 * @param {{limit?: number}} [opts]
 * @returns {Promise<{ query, total, sources: string[], skipped: string[], results: Array }>}
 */
export async function searchFederation(q, { limit = 20 } = {}) {
  if (!q) return { query: q || '', total: 0, sources: [], skipped: [], results: [] };
  const [l, d, e] = await Promise.all([
    loc(q, { limit }).catch(() => []),
    dpla(q, { limit }).catch(() => []),
    europeana(q, { limit }).catch(() => []),
  ]);

  // dedup by url first, then by lowercased title (federation aggregators overlap heavily).
  const seen = new Set();
  const results = [];
  for (const r of [...l, ...d, ...e]) {
    const key = (r.url ? `u:${r.url}` : `t:${r.title.toLowerCase()}`);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(r);
  }

  const sources = [];
  if (l.length) sources.push('loc');
  if (d.length) sources.push('dpla');
  if (e.length) sources.push('europeana');
  // Report which keyed sources were skipped for want of a key (transparency on the page/CLI).
  const skipped = [];
  if (!DPLA_KEY) skipped.push('dpla (no DPLA_API_KEY)');
  if (!EUROPEANA_KEY) skipped.push('europeana (no EUROPEANA_API_KEY)');

  return { query: q, total: results.length, sources, skipped, results };
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('library-federation.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'civil war photographs';
  const out = await searchFederation(q);
  console.log(`\nFederation: "${q}" — ${out.total} results from [${out.sources.join(', ') || 'none'}]`);
  if (out.skipped.length) console.log(`  skipped: ${out.skipped.join('; ')}`);
  console.log('');
  for (const r of out.results.slice(0, 25)) {
    console.log(`  [${r.source}] ${(r.title || '').slice(0, 70)}${r.year ? ` (${r.year})` : ''}`);
    console.log(`         ${r.provider}${r.rights ? `  · ${r.rights}` : ''}`);
    if (r.url) console.log(`         ${r.url}`);
  }
}
