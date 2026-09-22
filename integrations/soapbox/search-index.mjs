// search-index.mjs — the ALL-INTERNALS index for search.soapbox.community.
//
// WHY: search.soapbox.community (site/search/server.mjs) is a live FEDERATED meta-search. Its "Our
// Sites" mode fans a query out to a handful of live sources (MELEK chain, the wiki API, the Data
// coins API, the in-memory Directory/Learn objects, and ecosystem-nav links matched by name). That
// means a page is only findable if it happens to be one of those sources — the law pages
// (privacy/rights/constitution/treaties/maxims), stocks pages, tools, streaming, most wiki/data leaf
// pages, and every one of the ~100 verticals are NOT findable unless their surface name is typed.
//
// THIS MODULE closes that gap. Every vertical server already emits its own /sitemap.xml (built from
// crawlers.mjs). We AGGREGATE all of those per-surface sitemaps into one flat, searchable index, so
// "Our Sites" search covers EVERY internal page — not just the six live sources.
//
// AUTO-UPDATE (no hand-maintained list):
//   - The surface set is derived, not hard-coded: crawlers.PUBLIC_SITES  +  the LIVE entries of
//     ecosystem-nav.ECOSYSTEM_LINKS (the documented single-source-of-truth for our properties — "add
//     a link in ONE place and it appears everywhere"). Add a vertical there and it is indexed here.
//   - Each surface's OWN sitemap is the source of its pages, so a new page inside a surface appears
//     the next time that surface's sitemap is fetched — no edit here.
//   - The index is cached with a TTL and rebuilt lazily on read (getIndex) or on a timer
//     (startAutoRefresh). So it self-heals and picks up new surfaces/pages without a redeploy.
//
// House style: ESM .mjs, injectable fetch (__setFetch), soft-fail-never-throw, no network at import,
// esc-free (data only — the renderer escapes), CLI guarded by the process.argv[1] check.
//
// Public API:
//   INTERNAL_SURFACES                              -> [{ base, host, surface, label, live }]
//   buildIndex({ surfaces?, perSurface?, cap? })   -> async { builtAt, count, surfaces, docs }
//   searchIndex(index, query, { k?, scope? })      -> [{ url, title, surface, host, snippet, score }]
//   getIndex({ ttlMs?, force? })                   -> async cached index (rebuilds when stale)
//   startAutoRefresh({ intervalMs? })              -> stop() ; timer-driven rebuild
//   titleFromUrl(url)                              -> readable title from a URL slug
//   __setFetch(fn)                                 -> test seam

import { parseSitemap, parseSitemapIndex } from '../sitemap-parser.mjs';
import { PUBLIC_SITES } from './crawlers.mjs';
import { ECOSYSTEM_LINKS } from '../ecosystem-nav.mjs';

// ── injectable fetch (tests inject a fake; default = global fetch) ────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// Our hosts — only these are treated as "internal". Admin (soapy.blog) is deliberately absent and is
// additionally never present in the source registries, so it can never be indexed.
const OUR_HOST_RE = /(^|\.)(soapbox\.community|melek\.salon|vankushfamily\.com|dudael\.com|melek\.business)$/i;
export function isOurHost(host) {
  try { return OUR_HOST_RE.test(String(host || '').toLowerCase()); } catch { return false; }
}

function hostOf(u) { try { return new URL(u).host.toLowerCase(); } catch { return ''; } }
function baseOf(u) { try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return ''; } }

// A short surface key from a host: the leftmost label of a *.soapbox.community / *.melek.salon host,
// else the regist(second-level) label. e.g. law.soapbox.community -> "law", melek.salon -> "melek".
export function surfaceKey(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  const parts = h.split('.').filter(Boolean);
  if (h.endsWith('soapbox.community') || h.endsWith('melek.salon') || h.endsWith('melek.business')) {
    return parts.length > 2 ? parts[0] : parts[0]; // sub label, or the registrable label for the apex
  }
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || '');
}

// ── the internal surface set — DERIVED, never hand-maintained ─────────────────────────────────────
// Merge crawlers.PUBLIC_SITES (the sitemap-index registry) with the LIVE ecosystem-nav links, keep
// only our hosts, dedupe by base URL. Add a property to ecosystem-nav (the single source of truth)
// and it flows in here automatically. Pure getter so env overrides in ecosystem-nav are honoured.
export function internalSurfaces() {
  const byBase = new Map();
  const add = (url, label) => {
    const base = baseOf(url);
    if (!base) return;
    const host = hostOf(base);
    if (!isOurHost(host)) return;
    if (!byBase.has(base)) byBase.set(base, { base, host, surface: surfaceKey(host), label: label || surfaceKey(host), live: true });
  };
  try { for (const s of PUBLIC_SITES) add(s.url, s.name); } catch { /* soft */ }
  try { for (const l of ECOSYSTEM_LINKS) if (l && l.live) add(l.url, l.label); } catch { /* soft */ }
  return [...byBase.values()];
}

// Eager snapshot for callers that just want the list (tests, CLI). The function above is the live view.
export const INTERNAL_SURFACES = internalSurfaces();

// ── title from a URL slug ─────────────────────────────────────────────────────────────────────────
// "/privacy" -> "Privacy", "/us/cases" -> "Cases", "/coin/bitcoin" -> "Bitcoin", "/" -> "" (caller
// falls back to the surface label). Best-effort, never throws.
export function titleFromUrl(url) {
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    if (!p || p === '') return '';
    const seg = decodeURIComponent(p.split('/').filter(Boolean).pop() || '');
    return seg.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]{1,5}$/i, '').trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch { return ''; }
}

// Tokenize for scoring — lowercase word-ish tokens, length >= 2.
function tokenize(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9][a-z0-9+-]{1,}/g) || []);
}

// Build the searchable term bag for one doc (slug words + title + surface + host label).
function docTerms(url, title, surface, host) {
  let path = '';
  try { path = new URL(url).pathname; } catch { /* soft */ }
  return new Set(tokenize(`${path.replace(/[/_-]+/g, ' ')} ${title} ${surface} ${String(host).replace(/\./g, ' ')}`));
}

// ── fetch + parse one surface's sitemap into docs ────────────────────────────────────────────────
// Fetches ${base}/sitemap.xml. If it is a sitemap-INDEX, recurses one level into its child sitemaps
// (bounded). Always yields at least the surface home so the surface is findable even with no sitemap.
async function fetchXml(url) {
  try {
    // Bounded: a slow/hung surface must never stall an index build or a live search request.
    let signal;
    try { signal = AbortSignal.timeout(8000); } catch { /* older runtimes: no signal */ }
    const r = await _fetch(url, signal ? { redirect: 'follow', signal } : { redirect: 'follow' });
    if (!r || (typeof r.ok === 'boolean' && !r.ok)) return '';
    const t = await r.text();
    return typeof t === 'string' ? t : '';
  } catch { return ''; }
}

async function crawlSurface(surf, { perSurface = 500, childCap = 25 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (loc, lastmod) => {
    const url = String(loc || '').trim();
    if (!url || seen.has(url)) return;
    const host = hostOf(url);
    if (!isOurHost(host)) return;                 // never index off-network URLs a sitemap might list
    seen.add(url);
    const title = titleFromUrl(url) || surf.label;
    out.push({ url, host, surface: surf.surface, title, lastmod: lastmod || null });
  };
  // Always seed the home URL so a surface with no (yet-crawlable) sitemap is still findable by name.
  push(surf.base, null);

  const xml = await fetchXml(`${surf.base}/sitemap.xml`);
  if (xml) {
    if (/<sitemapindex\b/i.test(xml)) {
      const children = parseSitemapIndex(xml).slice(0, childCap);
      for (const child of children) {
        if (out.length >= perSurface) break;
        const cxml = await fetchXml(child);
        for (const e of parseSitemap(cxml)) { if (out.length >= perSurface) break; push(e.loc, e.lastmod); }
      }
    } else {
      for (const e of parseSitemap(xml)) { if (out.length >= perSurface) break; push(e.loc, e.lastmod); }
    }
  }
  return out.slice(0, perSurface);
}

// ── build the whole index ─────────────────────────────────────────────────────────────────────────
/**
 * Aggregate every internal surface's sitemap into one flat index. Soft-fails per surface (a dead
 * surface contributes only its home URL, never breaks the build). Never throws.
 *
 * @param {{ surfaces?, perSurface?, cap? }} [opts]
 * @returns {Promise<{ builtAt:string, count:number, surfaces:number, docs:Array }>}
 */
export async function buildIndex(opts = {}) {
  const { surfaces = internalSurfaces(), perSurface = 500, cap = 20000 } = opts;
  const settled = await Promise.all(surfaces.map((s) => crawlSurface(s, { perSurface }).catch(() => [])));
  const docs = [];
  const seen = new Set();
  for (const list of settled) {
    for (const d of list) {
      if (docs.length >= cap) break;
      const key = d.url.replace(/\/+$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push({ ...d, terms: docTerms(d.url, d.title, d.surface, d.host) });
    }
  }
  return { builtAt: new Date().toISOString(), count: docs.length, surfaces: surfaces.length, docs };
}

// ── search the built index ──────────────────────────────────────────────────────────────────────
/**
 * Score every doc against the query by term overlap, with boosts for a title-word match and for a
 * surface/host match. `scope` (a surface key or host substring) restricts results to that surface —
 * this is what powers a pre-scoped search like "our legal corpus" (scope: 'law'). Deterministic.
 *
 * @param {{docs:Array}} index
 * @param {string} query
 * @param {{ k?:number, scope?:string }} [opts]
 * @returns {Array<{url,title,surface,host,snippet,score,lastmod}>}
 */
export function searchIndex(index, query, { k = 12, scope = null } = {}) {
  const docs = (index && Array.isArray(index.docs)) ? index.docs : [];
  const qTokens = tokenize(query);
  if (!docs.length) return [];
  const scopeStr = scope ? String(scope).toLowerCase().trim() : null;
  const inScope = (d) => !scopeStr || d.surface === scopeStr || d.host.includes(scopeStr) || d.surface.includes(scopeStr);

  // Empty query but a scope → list that surface's pages (browse mode). Otherwise require a query.
  if (!qTokens.length) {
    if (!scopeStr) return [];
    return docs.filter(inScope).slice(0, k).map(toHit(1));
  }

  const scored = [];
  const titleWordCache = new Map();
  for (const d of docs) {
    if (!inScope(d)) continue;
    let overlap = 0;
    for (const t of qTokens) if (d.terms.has(t)) overlap++;
    if (!overlap) continue;
    let titleWords = titleWordCache.get(d);
    if (!titleWords) { titleWords = new Set(tokenize(d.title)); titleWordCache.set(d, titleWords); }
    let titleHits = 0;
    for (const t of qTokens) if (titleWords.has(t)) titleHits++;
    // score: overlap coverage (0..1) + title boost + surface-name boost, normalized to ~0..1.
    const coverage = overlap / qTokens.length;
    const titleBoost = titleHits ? 0.25 * (titleHits / qTokens.length) : 0;
    const surfaceBoost = qTokens.includes(d.surface) ? 0.15 : 0;
    const depthPenalty = Math.min(0.1, 0.02 * ((d.url.match(/\//g) || []).length - 3)); // shallow pages first
    const score = Math.max(0, Math.min(1, coverage + titleBoost + surfaceBoost - Math.max(0, depthPenalty)));
    scored.push({ d, score });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.d.url.length - b.d.url.length));
  return scored.slice(0, k).map(({ d, score }) => toHit(score)(d));
}

function toHit(score) {
  return (d) => ({
    url: d.url, title: d.title || surfaceKey(d.host), surface: d.surface, host: d.host,
    snippet: `${d.surface} — ${new URL(d.url).pathname}`, score, lastmod: d.lastmod || null,
  });
}

// ── cached index + auto-update ────────────────────────────────────────────────────────────────────
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — matches the 'high' self-crawl cadence
let _cache = null;        // { index, at }
let _inflight = null;     // single-flight guard

/**
 * Get the index, rebuilding when it is missing or older than ttlMs. Concurrent callers share one
 * build (single-flight). Never throws — on a build error the previous cache (if any) is returned.
 */
export async function getIndex({ ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const fresh = _cache && !force && (Date.now() - _cache.at) < ttlMs;
  if (fresh) return _cache.index;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const index = await buildIndex();
      _cache = { index, at: Date.now() };
      return index;
    } catch {
      return _cache ? _cache.index : { builtAt: new Date().toISOString(), count: 0, surfaces: 0, docs: [] };
    } finally { _inflight = null; }
  })();
  return _inflight;
}

/** Drop the cached index (tests / manual invalidation). */
export function clearIndexCache() { _cache = null; _inflight = null; }

/**
 * Timer-driven rebuild — the auto-update mechanism. Rebuilds every intervalMs (default = the TTL) so
 * new surfaces/pages are picked up without any hand edit or redeploy. The timer is unref'd so it never
 * keeps a process alive on its own. Returns a stop() function. Best-effort: a failed rebuild is
 * swallowed and the next tick tries again.
 */
export function startAutoRefresh({ intervalMs = DEFAULT_TTL_MS, immediate = true } = {}) {
  if (immediate) getIndex({ force: true }).catch(() => {});
  const t = setInterval(() => { getIndex({ force: true }).catch(() => {}); }, Math.max(60_000, intervalMs));
  if (t && typeof t.unref === 'function') t.unref();
  return function stop() { clearInterval(t); };
}

// ── CLI — node integrations/soapbox/search-index.mjs [query] [--scope=law] [--k=10] ─────────────────
if (process.argv[1] && process.argv[1].endsWith('search-index.mjs')) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const f = argv.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=')[1] : d; };
  const q = argv.filter((a) => !a.startsWith('--')).join(' ');
  const surfaces = internalSurfaces();
  console.error(`[search-index] ${surfaces.length} internal surfaces: ${surfaces.map((s) => s.surface).join(', ')}`);
  const index = await buildIndex();
  console.error(`[search-index] built ${index.count} docs across ${index.surfaces} surfaces at ${index.builtAt}`);
  if (q) {
    const hits = searchIndex(index, q, { k: Number(flag('k', 10)), scope: flag('scope', null) });
    console.log(`\n"${q}"${flag('scope', null) ? ` [scope:${flag('scope', null)}]` : ''} — ${hits.length} hits:\n`);
    for (const h of hits) console.log(`  ${h.score.toFixed(2)}  [${h.surface}] ${h.title}\n        ${h.url}`);
  } else {
    console.log('\npass a query to search, e.g.:  node integrations/soapbox/search-index.mjs privacy --scope=law');
  }
}
