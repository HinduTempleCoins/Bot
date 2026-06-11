// integrations/sitemap-parser.mjs
//
// Sitemap.xml / URL-frontier parser for the Project-2 Web-Scraper.
//
// Read-only crawl-planning helpers. Feeds the "261 tags by source and date"
// pipeline and the 459/490 scraper expansion: turn a site's sitemap(s) into a
// deduped, host-filtered, priority-sorted crawl queue (a "frontier").
//
// Distinct from integrations/robots-txt.mjs (fetch permission / crawl-delay)
// and integrations/source-tagger.mjs (post-fetch source tagging). This module
// only decides WHAT urls to consider and in WHAT order — it never fetches a
// page body, never writes, never throws.
//
// House style: ESM .mjs, pure functions, injectable fetch via __setFetch,
// soft-fail-never-throw, no XML dependency (tolerant regex/string parse),
// no network at import time. CLI is guarded by the process.argv[1] check.
//
// Public API:
//   parseSitemap(xml)                          -> [{loc, lastmod, changefreq, priority}]
//   parseSitemapIndex(xml)                     -> [childSitemapUrl, ...]
//   filterByDate(entries, {since, until})      -> entries whose lastmod is in range
//   sortByPriority(entries)                    -> entries sorted high->low priority
//   toFrontier(entries, {limit, hostAllowlist})-> deduped, host-filtered url queue
//   fetchSitemap(url)                           -> async; parsed entries, [] on any failure
//   __setFetch(fn)                             -> test seam for fetchSitemap

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- low-level helpers ------------------------------------------------------

// Pull the inner text of the FIRST <tag>...</tag> inside a chunk. Tolerant of
// whitespace, attributes, and CDATA. Returns '' when absent.
function tagText(chunk, tag) {
  if (typeof chunk !== 'string') return '';
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = chunk.match(re);
  if (!m) return '';
  let v = m[1];
  // unwrap a single CDATA section if present
  const cd = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  if (cd) v = cd[1];
  return decodeEntities(v.trim());
}

// Minimal XML entity decode — enough for urls in sitemaps (& and friends).
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) ? safeFromCode(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? safeFromCode(n) : '';
    });
}
function safeFromCode(n) { try { return String.fromCodePoint(n); } catch { return ''; } }

// Split a document into the inner chunks of each <tag>...</tag>.
function splitBlocks(xml, tag) {
  if (typeof xml !== 'string') return [];
  const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// A loc is usable only if it parses as an absolute http(s) URL.
function normalizeLoc(loc) {
  if (!loc || typeof loc !== 'string') return null;
  const trimmed = loc.trim();
  if (!trimmed) return null;
  let u;
  try { u = new URL(trimmed); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}

// priority is 0.0..1.0 in the sitemap spec. Default per spec is 0.5.
function normalizePriority(raw) {
  if (raw === '' || raw == null) return 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// lastmod -> epoch ms, or null if unparseable. Tolerates date-only and W3C.
function lastmodMs(lastmod) {
  if (!lastmod) return null;
  const t = Date.parse(lastmod);
  return Number.isFinite(t) ? t : null;
}

function toMs(v) {
  if (v == null) return null;
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// ---- public API -------------------------------------------------------------

// Parse a <urlset> sitemap. Returns one record per VALID <url> (a usable loc).
// Malformed entries (no loc, relative loc, non-http) are silently dropped.
export function parseSitemap(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const out = [];
  for (const block of splitBlocks(xml, 'url')) {
    const loc = normalizeLoc(tagText(block, 'loc'));
    if (!loc) continue;
    const lastmod = tagText(block, 'lastmod') || null;
    const changefreq = (tagText(block, 'changefreq') || '').toLowerCase() || null;
    const priority = normalizePriority(tagText(block, 'priority'));
    out.push({ loc, lastmod, changefreq, priority });
  }
  return out;
}

// Parse a <sitemapindex>. Returns the list of child sitemap urls (deduped,
// http(s) only). Malformed <sitemap> entries are dropped.
export function parseSitemapIndex(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const block of splitBlocks(xml, 'sitemap')) {
    const loc = normalizeLoc(tagText(block, 'loc'));
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }
  return out;
}

// Keep entries whose lastmod falls within [since, until]. Bounds may be Date,
// epoch-ms, or a parseable date string; either may be omitted. Entries with no
// (or unparseable) lastmod are kept ONLY when no bounds are supplied — once you
// ask for a date window, undated entries cannot be proven to match, so drop.
export function filterByDate(entries, range = {}) {
  if (!Array.isArray(entries)) return [];
  const since = toMs(range.since);
  const until = toMs(range.until);
  if (since == null && until == null) return entries.slice();
  return entries.filter((e) => {
    const ms = lastmodMs(e && e.lastmod);
    if (ms == null) return false;
    if (since != null && ms < since) return false;
    if (until != null && ms > until) return false;
    return true;
  });
}

// Sort high priority first. Stable for equal priorities (preserves input order).
export function sortByPriority(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e, i) => [e, i])
    .sort((a, b) => {
      const pa = normalizePriority(a[0] && a[0].priority);
      const pb = normalizePriority(b[0] && b[0].priority);
      if (pb !== pa) return pb - pa;
      return a[1] - b[1];
    })
    .map((pair) => pair[0]);
}

// Build a crawl frontier: a deduped, host-filtered, priority-ordered list of
// urls. opts.hostAllowlist (array of bare hostnames) restricts to those hosts;
// matching is case-insensitive and includes subdomains of an allowed host.
// opts.limit caps the result length.
export function toFrontier(entries, opts = {}) {
  if (!Array.isArray(entries)) return [];
  const allow = Array.isArray(opts.hostAllowlist)
    ? opts.hostAllowlist.map((h) => String(h || '').toLowerCase().trim()).filter(Boolean)
    : null;
  const limit = Number.isFinite(opts.limit) && opts.limit >= 0 ? Math.floor(opts.limit) : Infinity;

  const sorted = sortByPriority(entries);
  const seen = new Set();
  const out = [];
  for (const e of sorted) {
    if (out.length >= limit) break;
    const loc = normalizeLoc(e && e.loc);
    if (!loc) continue;
    let host;
    try { host = new URL(loc).hostname.toLowerCase(); } catch { continue; }
    if (allow && !allow.some((a) => host === a || host.endsWith('.' + a))) continue;
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }
  return out;
}

// Convenience: fetch a sitemap url and parse it. Auto-detects a sitemap index
// and, if so, returns the child urls wrapped as entries ({loc} only) so the
// caller can recurse via toFrontier/fetchSitemap. Soft-fails to [] on ANY
// problem (no network in tests; inject via __setFetch). Never throws.
export async function fetchSitemap(url) {
  const target = normalizeLoc(url);
  if (!target) return [];
  let body;
  try {
    const r = await _fetch(target, { redirect: 'follow' });
    if (!r || (typeof r.ok === 'boolean' && !r.ok)) return [];
    body = await r.text();
  } catch {
    return [];
  }
  if (typeof body !== 'string' || !body) return [];
  if (/<sitemapindex\b/i.test(body)) {
    return parseSitemapIndex(body).map((loc) => ({ loc, lastmod: null, changefreq: null, priority: 0.5 }));
  }
  return parseSitemap(body);
}

// ---- CLI (guarded) ----------------------------------------------------------
// node integrations/sitemap-parser.mjs <sitemap-url>
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: node integrations/sitemap-parser.mjs <sitemap-url>');
    process.exit(1);
  }
  fetchSitemap(url).then((entries) => {
    const frontier = toFrontier(entries, { limit: 50 });
    console.log(JSON.stringify({ count: entries.length, frontier }, null, 2));
  });
}
