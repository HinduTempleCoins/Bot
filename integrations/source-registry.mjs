// source-registry.mjs — the Resource Center's SINGLE registry of every data source the brain perceives.
//
// Operator's architecture call: the Resource Center IS the web scraper / perception engine, and the
// things we built (credentials, grants, languages, hierophant, law, politics, markets, library) should
// be wired THROUGH it, not as scattered ad-hoc imports. This is that unification — ONE place that
// declares every source with its DOMAIN, its MODE, its LICENSE and its canonical page, so:
//   • the Resource Center can enumerate the SCHEDULED sources to scrape/refresh on a timer, and
//   • hathor-knows / the Language Center can RESOLVE any source by id (query it) uniformly.
//
// Two modes (the honest nuance — not everything pre-scrapes):
//   • 'scheduled'  — finite + stable; fanned + cached on a schedule (markets, the catalogs, the library)
//   • 'on-demand'  — too large to pre-fetch; resolved live per query (a specific court case, a legislator)
//
// PURE declaration layer: listing sources does NO network and NO heavy import. A source's data is only
// touched when you call query()/resolve(), which lazy-imports its module then calls its function. So
// the registry is fully offline-listable + testable; only an explicit query reaches out.
//
//   import { SOURCES, all, byMode, byDomain, get, scheduled, resolve, query, validate } from './source-registry.mjs'

// id, domain, label, mode, kind, license, page (our canonical surface), module (lazy path), fn (export to call).
// kind: 'catalog' (pure curated data) | 'scraper' (fans the web) | 'reader' (live per-query) | 'index' (RAG).
function s(o) { return { license: 'mixed', page: null, ...o }; }

export const SOURCES = [
  s({ id: 'markets', domain: 'markets', label: 'Markets & data (Resource Center)', mode: 'scheduled', kind: 'scraper',
      license: 'keyless/public APIs', page: 'https://data.soapbox.community', module: './resource-center.mjs', fn: 'fanCatalog' }),
  s({ id: 'library', domain: 'library', label: 'Library / corpus + datasets', mode: 'scheduled', kind: 'index',
      license: 'mixed', page: 'https://wiki.soapbox.community', module: './library-index.mjs', fn: 'catalogLookup' }),
  s({ id: 'credentials', domain: 'credentials', label: 'Credentialing (by industry)', mode: 'scheduled', kind: 'catalog',
      license: 'curated link-out', page: 'https://credentials.soapbox.community', module: './soapbox/credentials-catalog.mjs', fn: 'search' }),
  s({ id: 'grants', domain: 'grants', label: 'Grants (by field) + RFPs', mode: 'scheduled', kind: 'catalog',
      license: 'curated link-out', page: 'https://grants.soapbox.community', module: './soapbox/grants-catalog.mjs', fn: 'search' }),
  s({ id: 'languages', domain: 'languages', label: 'Language Center curriculum', mode: 'scheduled', kind: 'catalog',
      license: 'open/CC + link-out', page: 'https://hathor.live', module: './language-catalog.mjs', fn: 'search' }),
  s({ id: 'languages-corpus', domain: 'languages', label: 'Language datasets (scraped)', mode: 'scheduled', kind: 'scraper',
      license: 'open/CC only', page: 'https://hathor.live', module: './language-ingest.mjs', fn: 'ingest' }),
  s({ id: 'hierophant', domain: 'religion', label: 'Hierophant (sacred texts)', mode: 'scheduled', kind: 'catalog',
      license: 'public-domain link-out', page: 'https://hierophant.soapbox.community', module: './hierophant-catalog.mjs', fn: 'TEXTS' }),
  s({ id: 'law', domain: 'law', label: 'Law (case law / statutes)', mode: 'on-demand', kind: 'reader',
      license: 'public record', page: 'https://law.soapbox.community', module: './soapbox/courtlistener-opinions.mjs', fn: 'searchCases' }),
  s({ id: 'politics', domain: 'politics', label: 'Politics (legislators / elections)', mode: 'on-demand', kind: 'reader',
      license: 'public record (keyless)', page: 'https://politics.soapbox.community', module: './soapbox/congress-legislators.mjs', fn: 'currentLegislators' }),
];

const norm = (x) => String(x || '').toLowerCase().trim();

export function all() { return SOURCES.slice(); }
export function get(id) { return SOURCES.find((x) => x.id === norm(id)) || null; }
export function byMode(mode) { return SOURCES.filter((x) => x.mode === norm(mode)); }
export function byDomain(domain) { return SOURCES.filter((x) => x.domain === norm(domain)); }
export function scheduled() { return byMode('scheduled'); }
export function onDemand() { return byMode('on-demand'); }
export function domains() { return [...new Set(SOURCES.map((x) => x.domain))]; }

// injectable resolver (tests pass a fake so no real import happens); default lazy-imports the module.
let _resolver = null;
export function __setResolver(fn) { _resolver = typeof fn === 'function' ? fn : null; }

/** Resolve a source id → its callable fetcher (lazy-imports its module). null if unknown/broken. */
export async function resolve(id) {
  const src = get(id);
  if (!src) return null;
  if (_resolver) return _resolver(src);
  try { const m = await import(src.module); const f = m[src.fn]; return typeof f === 'function' ? f : (f != null ? () => f : null); }
  catch { return null; }
}

/** Query one source uniformly: resolve + call. Never throws; null on any failure. */
export async function query(id, arg, opts) {
  const fn = await resolve(id);
  if (!fn) return null;
  try { return await fn(arg, opts); } catch { return null; }
}

/** Registry integrity (for a /health route). Pure. */
export function validate() {
  const errors = [];
  const ids = new Set();
  for (const x of SOURCES) {
    if (!x.id || ids.has(x.id)) errors.push(`bad/dup id: ${x.id}`); else ids.add(x.id);
    if (!['scheduled', 'on-demand'].includes(x.mode)) errors.push(`${x.id}: bad mode ${x.mode}`);
    if (!['catalog', 'scraper', 'reader', 'index'].includes(x.kind)) errors.push(`${x.id}: bad kind ${x.kind}`);
    if (!x.module || !x.fn) errors.push(`${x.id}: missing module/fn`);
  }
  return { ok: errors.length === 0, errors, sources: SOURCES.length, scheduled: scheduled().length, onDemand: onDemand().length, domains: domains().length };
}

if (process.argv[1] && process.argv[1].endsWith('source-registry.mjs')) {
  const v = validate();
  console.log(`Source registry — ${v.sources} sources (${v.scheduled} scheduled, ${v.onDemand} on-demand) across ${v.domains} domains. valid=${v.ok}`);
  for (const x of SOURCES) console.log(`  [${x.mode.padEnd(9)}] [${x.kind.padEnd(7)}] ${x.domain.padEnd(12)} ${x.id.padEnd(17)} → ${x.page || x.module}`);
  if (!v.ok) v.errors.forEach((e) => console.log('  ! ' + e));
}
