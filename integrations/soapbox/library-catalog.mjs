// library-catalog.mjs — the SoapBox Library discovery vertical (queue #83). Keyless scholarly + book
// catalogs unified behind one search. Every source here is free and (mostly) keyless:
//
//   Open Library  — books search + cover art (archive.org). PD/borrowable.
//   OpenAlex      — 250M+ scholarly works, OA flags, citation counts.
//   Crossref      — DOI registry: the authoritative metadata-by-DOI source.
//   DOAJ          — Directory of Open Access Journals (article-level OA).
//   CORE          — aggregator of OA full text. Key OPTIONAL — soft-fails to skipped if absent.
//   arXiv         — preprint server (physics/CS/math/bio). Always OA. Atom XML feed.
//   Gutendex      — Project Gutenberg JSON API: ~70k public-domain books, full-text downloads.
//
// `bucket` classifies each hit by what SoapBox can actually do with it:
//   'host-fully'    — public domain or open access; we can link/serve the full text.
//   'metadata-only' — in-copyright; we surface the citation + a link out, nothing more.
//
// Pattern mirrors macro.mjs: ESM, __setFetch hook, soft-fail (never throws — a dead source yields
// []), CLI guarded by argv check. No cache import here (search queries are unbounded; the caller's
// route can wrap catalogSearch in cached() if it wants).

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0; +https://soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// CORE key is optional. If present (env), CORE results are included; if not, CORE is silently skipped.
const CORE_KEY = process.env.CORE_API_KEY || '';

const BUCKET = { HOST: 'host-fully', META: 'metadata-only' };

// ── small helpers ──────────────────────────────────────────────────────────
async function getJSON(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function getText(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, ...(opts.headers || {}) } });
    if (!r || !r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/** Normalize a title for dedup: lowercase, strip punctuation, collapse whitespace. */
export function normTitle(t) {
  return String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function normDOI(d) {
  if (!d) return '';
  return String(d).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
}
function clampYear(y) {
  const n = parseInt(y, 10);
  return Number.isFinite(n) && n > 0 && n < 3000 ? n : null;
}

// ── Open Library (books) ─────────────────────────────────────────────────────
/** Search books via Open Library. Returns normalized rows with cover URLs. Soft-fails to []. */
export async function searchBooks(q, { limit = 20 } = {}) {
  if (!q) return [];
  const u = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=key,title,author_name,first_publish_year,cover_i,ia,public_scan_b,ebook_access`;
  const j = await getJSON(u);
  const docs = j?.docs || [];
  return docs.map((d) => {
    // public_scan_b / ebook_access tell us if Archive.org can serve the full scan.
    const pd = d.public_scan_b === true || d.ebook_access === 'public';
    return {
      source: 'openlibrary',
      type: 'book',
      title: d.title || '',
      authors: d.author_name || [],
      year: clampYear(d.first_publish_year),
      doi: null,
      url: d.key ? `https://openlibrary.org${d.key}` : null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      openAccess: pd,
      bucket: pd ? BUCKET.HOST : BUCKET.META,
    };
  }).filter((r) => r.title);
}

// ── OpenAlex (scholarly works) ───────────────────────────────────────────────
async function openAlexWorks(q, limit) {
  const u = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${limit}&mailto=library@soapbox.community`;
  const j = await getJSON(u);
  const results = j?.results || [];
  return results.map((w) => {
    const oa = w.open_access?.is_oa === true;
    const authors = (w.authorships || []).map((a) => a?.author?.display_name).filter(Boolean);
    return {
      source: 'openalex',
      type: 'paper',
      title: w.display_name || w.title || '',
      authors,
      year: clampYear(w.publication_year),
      doi: normDOI(w.doi),
      url: w.open_access?.oa_url || (w.doi ? `https://doi.org/${normDOI(w.doi)}` : w.id) || null,
      cited: typeof w.cited_by_count === 'number' ? w.cited_by_count : null,
      openAccess: oa,
      bucket: oa ? BUCKET.HOST : BUCKET.META,
    };
  }).filter((r) => r.title);
}

// ── Crossref (DOIs) ──────────────────────────────────────────────────────────
async function crossrefWorks(q, limit) {
  const u = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${limit}&mailto=library@soapbox.community`;
  const j = await getJSON(u);
  const items = j?.message?.items || [];
  return items.map((w) => {
    const authors = (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
    const year = clampYear(w.issued?.['date-parts']?.[0]?.[0]);
    return {
      source: 'crossref',
      type: 'paper',
      title: Array.isArray(w.title) ? (w.title[0] || '') : (w.title || ''),
      authors,
      year,
      doi: normDOI(w.DOI),
      url: w.URL || (w.DOI ? `https://doi.org/${normDOI(w.DOI)}` : null),
      cited: typeof w['is-referenced-by-count'] === 'number' ? w['is-referenced-by-count'] : null,
      // Crossref doesn't reliably flag OA; treat as metadata-only unless a later merge says otherwise.
      openAccess: false,
      bucket: BUCKET.META,
    };
  }).filter((r) => r.title);
}

// ── DOAJ (open-access journal articles) ──────────────────────────────────────
async function doajArticles(q, limit) {
  const u = `https://doaj.org/api/search/articles/${encodeURIComponent(q)}?pageSize=${limit}`;
  const j = await getJSON(u);
  const results = j?.results || [];
  return results.map((r) => {
    const b = r.bibjson || {};
    const doiId = (b.identifier || []).find((i) => i.type === 'doi')?.id;
    const link = (b.link || []).find((l) => l.type === 'fulltext')?.url;
    const authors = (b.author || []).map((a) => a.name).filter(Boolean);
    return {
      source: 'doaj',
      type: 'paper',
      title: b.title || '',
      authors,
      year: clampYear(b.year),
      doi: normDOI(doiId),
      url: link || (doiId ? `https://doi.org/${normDOI(doiId)}` : null),
      openAccess: true, // DOAJ is by definition open access
      bucket: BUCKET.HOST,
    };
  }).filter((r) => r.title);
}

// ── CORE (OA full text aggregator) — key OPTIONAL ────────────────────────────
async function coreWorks(q, limit) {
  if (!CORE_KEY) return []; // soft-fail: no key, no CORE
  const u = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(q)}&limit=${limit}`;
  const j = await getJSON(u, { headers: { authorization: `Bearer ${CORE_KEY}` } });
  const results = j?.results || [];
  return results.map((w) => ({
    source: 'core',
    type: 'paper',
    title: w.title || '',
    authors: (w.authors || []).map((a) => a?.name).filter(Boolean),
    year: clampYear(w.yearPublished || w.publishedDate),
    doi: normDOI(w.doi),
    url: w.downloadUrl || w.sourceFulltextUrls?.[0] || (w.doi ? `https://doi.org/${normDOI(w.doi)}` : null),
    openAccess: true, // CORE indexes OA full text
    bucket: BUCKET.HOST,
  })).filter((r) => r.title);
}

// ── arXiv (preprints, Atom XML) ──────────────────────────────────────────────
function parseArxiv(xml) {
  if (!xml) return [];
  const out = [];
  const entries = xml.split(/<entry>/).slice(1);
  for (const e of entries) {
    const body = e.split(/<\/entry>/)[0];
    const grab = (tag) => {
      const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    const title = grab('title');
    if (!title) continue;
    const authors = [];
    const ar = body.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g);
    for (const m of ar) authors.push(m[1].trim());
    const id = grab('id'); // e.g. http://arxiv.org/abs/2401.12345v1
    const published = grab('published');
    const doiM = body.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/);
    out.push({
      source: 'arxiv',
      type: 'paper',
      title,
      authors,
      year: clampYear(published ? published.slice(0, 4) : null),
      doi: normDOI(doiM ? doiM[1].trim() : null),
      url: id || null,
      openAccess: true, // arXiv is always free full text
      bucket: BUCKET.HOST,
    });
  }
  return out;
}
async function arxivWorks(q, limit) {
  const u = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=${limit}`;
  const xml = await getText(u);
  return parseArxiv(xml);
}

// ── Gutendex / Project Gutenberg (public-domain books, full text) ────────────
/** Search Project Gutenberg via Gutendex. Every result is public domain → host-fully. Soft-fails to []. */
export async function gutenberg(q, { limit = 20 } = {}) {
  if (!q) return [];
  const u = `https://gutendex.com/books/?search=${encodeURIComponent(q)}`;
  const j = await getJSON(u);
  const results = (j?.results || []).slice(0, limit);
  return results.map((b) => {
    const fmts = b.formats || {};
    const readable = fmts['text/html'] || fmts['application/epub+zip'] || fmts['text/plain; charset=utf-8'] || fmts['text/plain'] || null;
    const cover = fmts['image/jpeg'] || null;
    return {
      source: 'gutenberg',
      type: 'book',
      title: b.title || '',
      authors: (b.authors || []).map((a) => a.name).filter(Boolean),
      year: null, // Gutendex exposes author birth/death, not publication year
      doi: null,
      url: readable || (b.id ? `https://www.gutenberg.org/ebooks/${b.id}` : null),
      cover,
      openAccess: true,
      bucket: BUCKET.HOST, // Project Gutenberg is public domain
    };
  }).filter((r) => r.title);
}

// ── Semantic Scholar (papers + TLDR summaries) ───────────────────────────────
// Keyless (shared public rate pool); SEMANTIC_SCHOLAR_API_KEY (free) lifts the rate when present.
async function semanticScholarWorks(q, limit) {
  const fields = 'title,authors,year,externalIds,openAccessPdf,citationCount,tldr';
  const u = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${limit}&fields=${fields}`;
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY || '';
  const j = await getJSON(u, key ? { headers: { 'x-api-key': key } } : {});
  const data = j?.data || [];
  return data.map((w) => {
    const oaUrl = w.openAccessPdf?.url || null;
    const doi = normDOI(w.externalIds?.DOI);
    return {
      source: 'semanticscholar',
      type: 'paper',
      title: w.title || '',
      authors: (w.authors || []).map((a) => a?.name).filter(Boolean),
      year: clampYear(w.year),
      doi: doi || null,
      url: oaUrl || (doi ? `https://doi.org/${doi}` : null),
      cited: typeof w.citationCount === 'number' ? w.citationCount : null,
      tldr: w.tldr?.text || null, // the one-line machine summary nobody else gives us
      openAccess: !!oaUrl,
      bucket: oaUrl ? BUCKET.HOST : BUCKET.META,
    };
  }).filter((r) => r.title);
}

// ── Unpaywall (DOI → free full-text) ─────────────────────────────────────────
/** Look up the best free full-text location for one DOI. Soft-fails to null. */
export async function unpaywallByDOI(doi) {
  const d = normDOI(doi);
  if (!d) return null;
  const j = await getJSON(`https://api.unpaywall.org/v2/${encodeURIComponent(d)}?email=library@soapbox.community`);
  const loc = j?.best_oa_location;
  if (!loc?.url) return null;
  return { doi: d, url: loc.url_for_pdf || loc.url, version: loc.version || null, license: loc.license || null };
}

/**
 * Upgrade metadata-only rows to host-fully when Unpaywall knows a legal free full-text copy.
 * Bounded (default 5 lookups) so one search never fans out into dozens of Unpaywall calls.
 * Mutates nothing: returns a new array. Soft-fail: a dead Unpaywall leaves rows unchanged.
 */
export async function enrichWithFullText(rows, { max = 5 } = {}) {
  const out = (rows || []).map((r) => ({ ...r }));
  const candidates = out.filter((r) => r.bucket === BUCKET.META && r.doi).slice(0, max);
  await Promise.all(candidates.map(async (r) => {
    const oa = await unpaywallByDOI(r.doi).catch(() => null);
    if (oa) {
      r.openAccess = true;
      r.bucket = BUCKET.HOST;
      r.url = oa.url || r.url;
      r.fullTextLicense = oa.license || null;
    }
  }));
  return out;
}

/** Scholarly papers: OpenAlex + Crossref (+ DOAJ + CORE + arXiv + Semantic Scholar), merged & deduped. Soft-fails to []. */
export async function searchPapers(q, { limit = 20 } = {}) {
  if (!q) return [];
  const [oa, cr, doaj, core, ax, s2] = await Promise.all([
    openAlexWorks(q, limit).catch(() => []),
    crossrefWorks(q, limit).catch(() => []),
    doajArticles(q, limit).catch(() => []),
    coreWorks(q, limit).catch(() => []),
    arxivWorks(q, limit).catch(() => []),
    semanticScholarWorks(q, limit).catch(() => []),
  ]);
  return mergeDedup([...oa, ...doaj, ...core, ...ax, ...s2, ...cr]);
}

/**
 * Merge rows from many sources, deduping by DOI first then normalized title. When two rows collide,
 * we keep the FIRST seen but UPGRADE its bucket to host-fully if any duplicate is OA (so a Crossref
 * metadata-only hit that also appears OA in OpenAlex/DOAJ ends up correctly classified as hostable).
 * Also fills missing fields (cover, year, doi, cited, url) from later duplicates.
 */
export function mergeDedup(rows) {
  const byKey = new Map();
  const order = [];
  for (const r of rows || []) {
    if (!r || !r.title) continue;
    const doi = normDOI(r.doi);
    const key = doi ? `doi:${doi}` : `t:${normTitle(r.title)}`;
    if (!key || key === 't:') continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r, doi: doi || null, sources: [r.source] });
      order.push(key);
      continue;
    }
    // merge into existing
    if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
    if (r.openAccess) { existing.openAccess = true; existing.bucket = BUCKET.HOST; }
    existing.doi = existing.doi || doi || null;
    existing.year = existing.year ?? r.year ?? null;
    existing.cover = existing.cover || r.cover || null;
    existing.url = existing.url || r.url || null;
    if (r.cited != null && (existing.cited == null || r.cited > existing.cited)) existing.cited = r.cited;
    if ((!existing.authors || existing.authors.length === 0) && r.authors?.length) existing.authors = r.authors;
    if (!existing.tldr && r.tldr) existing.tldr = r.tldr; // Semantic Scholar's one-liner survives the merge
  }
  return order.map((k) => byKey.get(k));
}

/**
 * Unified Library search: books (Open Library + Gutenberg) + papers (OpenAlex/Crossref/DOAJ/CORE/arXiv),
 * merged and deduped across all sources, each carrying a `bucket` (host-fully | metadata-only).
 * Soft-fails: any dead source contributes nothing; the call never throws.
 */
export async function catalogSearch(q, { limit = 20 } = {}) {
  if (!q) return { query: q || '', total: 0, hostFully: 0, metadataOnly: 0, results: [] };
  const [books, gut, papers] = await Promise.all([
    searchBooks(q, { limit }).catch(() => []),
    gutenberg(q, { limit }).catch(() => []),
    searchPapers(q, { limit }).catch(() => []),
  ]);
  const results = mergeDedup([...gut, ...books, ...papers]);
  return {
    query: q,
    total: results.length,
    hostFully: results.filter((r) => r.bucket === BUCKET.HOST).length,
    metadataOnly: results.filter((r) => r.bucket === BUCKET.META).length,
    results,
  };
}

export { BUCKET };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('library-catalog.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'phoenix protocol';
  const out = await catalogSearch(q);
  console.log(`\nLibrary: "${q}" — ${out.total} results (${out.hostFully} hostable, ${out.metadataOnly} metadata-only)\n`);
  for (const r of out.results.slice(0, 25)) {
    const tag = r.bucket === BUCKET.HOST ? '[OA/PD]' : '[cite ]';
    console.log(`  ${tag} ${r.type.padEnd(5)} ${(r.title || '').slice(0, 70)}`);
    console.log(`         ${(r.authors || []).slice(0, 3).join(', ')}${r.year ? ` (${r.year})` : ''}  ${r.sources?.join('+') || r.source}`);
    if (r.url) console.log(`         ${r.url}`);
  }
}
