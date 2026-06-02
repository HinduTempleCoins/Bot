// self-crawl.mjs — the UI becomes part of the backend records (task #157).
//
// We crawl OUR OWN public pages (the SoapBox subdomains: data / directory / wiki / stocks) and turn
// what they currently SHOW into structured, append-ready records that the annal + brief writers can
// read. The point: the live product state informs the briefs. A brief writer no longer has to guess
// "what does the Data site list right now?" — it reads the last self-crawl record and quotes the
// live UI. The 12&12 conference and the Diagnostics vision (#179) consume the same JSONL.
//
// Privacy (load-bearing): PUBLIC pages ONLY. We never crawl /stats, /seo, or anything token-gated.
// OUR_PAGES is an explicit allow-list of canonical public URLs — there is no link-following crawl
// here, so the module cannot wander into a gated path by accident.
//
//   import { crawlOurSite, toAnnalRecords, siteStateSummary } from './self-crawl.mjs'
//   const crawl = await crawlOurSite();           // fetch + extract structure for each OUR_PAGES url
//   const recs  = toAnnalRecords(crawl);          // → data/self-crawl/site-state.jsonl
//   const para  = siteStateSummary(crawl);        // one-paragraph "current state of the live product"
//   node integrations/self-crawl.mjs              // CLI: crawl + print the summary
//
// Best-effort throughout: a dead page yields an empty summary, never a throw.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fetchClean } from './scraper.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

// ── our public canonical URLs ───────────────────────────────────────────────────────────────────
// Explicit allow-list. Subdomain homes + the key data sections + a few representative leaf pages so
// the crawl proves the deeper structure (a coin page, an article) without trying to enumerate them.
// NEVER add /stats, /seo, or any token-gated path here.
const DATA = 'https://data.soapbox.community';
const DIRECTORY = 'https://directory.soapbox.community';
const WIKI = 'https://wiki.soapbox.community';
const STOCKS = 'https://stocks.soapbox.community';

export const OUR_PAGES = [
  // subdomain homes
  { url: DATA, surface: 'data', kind: 'home' },
  { url: DIRECTORY, surface: 'directory', kind: 'home' },
  { url: WIKI, surface: 'wiki', kind: 'home' },
  { url: STOCKS, surface: 'stocks', kind: 'home' },
  // key data sections
  { url: `${DATA}/macro`, surface: 'data', kind: 'section' },
  { url: `${DATA}/commodities`, surface: 'data', kind: 'section' },
  { url: `${DATA}/forex`, surface: 'data', kind: 'section' },
  { url: `${DATA}/ecosystem`, surface: 'data', kind: 'section' },
  { url: `${DATA}/learn`, surface: 'data', kind: 'section' },
  // representative leaf pages (prove the deeper structure)
  { url: `${DATA}/coin/bitcoin`, surface: 'data', kind: 'coin' },
  { url: `${WIKI}/what-is-a-blockchain`, surface: 'wiki', kind: 'article' },
];

// Defensive: paths we must never crawl even if one sneaks into a future OUR_PAGES edit.
const GATED = [/\/stats(\/|$|\?)/i, /\/seo(\/|$|\?)/i, /\/admin(\/|$|\?)/i, /\/health(\/|$|\?)/i];
export function isPublic(url) {
  return /^https?:\/\//.test(url) && !GATED.some((re) => re.test(url));
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT_DIR = 'data/self-crawl';
const OUT_FILE = `${OUT_DIR}/site-state.jsonl`;

// ── extraction ──────────────────────────────────────────────────────────────────────────────────
// fetchClean returns clean markdown. We pull a compact structured summary out of it: headings, the
// first meaningful lines / list items (keyPoints), internal links, and a word count. Markdown-first
// (Jina), with graceful handling of the plain-text fallback (no markdown syntax → fewer headings).

function ourHost(url) {
  try { return new URL(url).host; } catch { return ''; }
}

// Extract structure from clean markdown for one page.
function extractStructure(url, md) {
  const text = String(md || '');
  const lines = text.split('\n');

  // Title: Jina emits "Title: ..." or a leading "# ...".
  const title =
    (text.match(/^Title:\s*(.+)$/m) || [])[1] ||
    (text.match(/^#{1,3}\s+(.+)$/m) || [])[1] ||
    '';

  // Headings: markdown ATX headings (skip the Jina metadata block "Title:/URL Source:/Markdown...").
  const headings = [];
  for (const ln of lines) {
    const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const h = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
      if (h && !/^(title|url source|markdown content)/i.test(h)) headings.push(h);
    }
    if (headings.length >= 40) break;
  }

  // keyPoints: the first meaningful content lines / list items — what the page actually shows.
  const keyPoints = [];
  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) continue;
    if (/^(title|url source|markdown content|published time):/i.test(ln)) continue;
    if (/^#{1,6}\s/.test(ln)) continue;             // headings captured separately
    if (/^[=\-]{3,}$/.test(ln)) continue;           // hr / setext underline
    if (/^!\[/.test(ln)) continue;                  // image-only line
    // bullets, table rows, or a substantive sentence
    const isList = /^([-*+]\s|\d+\.\s|\|)/.test(ln);
    const cleaned = ln
      .replace(/^([-*+]\s|\d+\.\s)/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')       // strip md links → text
      .replace(/[*_`>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 3) continue;
    if (isList || cleaned.length >= 12) keyPoints.push(cleaned);
    if (keyPoints.length >= 25) break;
  }

  // Internal links: markdown links whose host matches the page's own host (or a *.soapbox.community).
  const host = ourHost(url);
  const internal = new Set();
  for (const m of text.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    const href = m[1].replace(/[#?].*$/, '');
    const h = ourHost(href);
    if (!h) continue;
    if (h === host || /(^|\.)soapbox\.community$/i.test(h)) {
      if (isPublic(href) && href !== url) internal.add(href);
    }
    if (internal.size >= 50) break;
  }

  const wordCount = text.replace(/[#*_`>|\-]/g, ' ').split(/\s+/).filter(Boolean).length;

  return {
    url,
    title: String(title).trim(),
    headings,
    wordCount,
    keyPoints,
    links: [...internal],
  };
}

// ── crawl ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Fetch each OUR_PAGES url, extract a compact structured summary. Polite (small delay between
 * fetches), cached (per-page metadata TTL, shared single-flight via the condenser cache). Never
 * throws — a failed page yields { ok:false } with empty structure.
 *
 * opts: { pages = OUR_PAGES, delayMs = 800, maxChars = 12000, fresh = false }
 */
export async function crawlOurSite(opts = {}) {
  const {
    pages = OUR_PAGES,
    delayMs = 800,
    maxChars = 12000,
    fresh = false,
  } = opts;

  const targets = pages.filter((p) => isPublic(p.url));   // drop anything gated, defensively
  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const page = targets[i];
    let entry;
    try {
      const fetched = await cached(`self-crawl:${page.url}`, TTL.metadata, () =>
        fetchClean(page.url, { maxChars, fresh }),
      );
      const struct = extractStructure(page.url, fetched.markdown);
      const ok = !!fetched.markdown && fetched.chars > 0;
      entry = {
        ...struct,
        surface: page.surface,
        pageKind: page.kind,
        source: fetched.source,
        ok,
        fetchedAt: new Date().toISOString(),
      };
    } catch (e) {
      entry = {
        url: page.url, title: '', headings: [], wordCount: 0, keyPoints: [], links: [],
        surface: page.surface, pageKind: page.kind, source: 'error:' + (e?.message || e),
        ok: false, fetchedAt: new Date().toISOString(),
      };
    }
    results.push(entry);
    if (i < targets.length - 1 && delayMs > 0) await delay(delayMs);  // polite
  }

  return {
    crawledAt: new Date().toISOString(),
    pageCount: results.length,
    okCount: results.filter((p) => p.ok).length,
    pages: results,
  };
}

// ── annal/brief records ─────────────────────────────────────────────────────────────────────────
/**
 * Transform a crawl into append-ready records — one per page, summarizing "what this page currently
 * shows". Appends them as JSONL to data/self-crawl/site-state.jsonl (gitignored). A brief writer
 * reads these to reference the LIVE UI state. Returns the records (so callers/tests can inspect them
 * without re-reading the file). Best-effort: a write failure does not throw, it returns the records.
 *
 * opts: { write = true, file = OUT_FILE }
 */
export function toAnnalRecords(crawl, opts = {}) {
  const { write = true, file = OUT_FILE } = opts;
  const crawledAt = crawl?.crawledAt || new Date().toISOString();

  const records = (crawl?.pages || []).map((p) => ({
    type: 'site-state',
    task: 157,
    surface: p.surface,
    pageKind: p.pageKind,
    url: p.url,
    title: p.title,
    ok: p.ok,
    // the human-readable line a brief can drop in verbatim:
    shows: describePage(p),
    headings: p.headings.slice(0, 20),
    keyPoints: p.keyPoints.slice(0, 15),
    wordCount: p.wordCount,
    internalLinks: p.links.slice(0, 25),
    source: p.source,
    crawledAt,
    fetchedAt: p.fetchedAt,
  }));

  if (write && records.length) {
    try {
      mkdirSync(OUT_DIR, { recursive: true });
      const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      const prior = existsSync(file) ? readFileSync(file, 'utf8') : '';
      writeFileSync(file, prior + body);            // append-only: the record is a log over time
    } catch { /* best-effort; records still returned */ }
  }
  return records;
}

// One-line "what this page currently shows" for a single page record.
function describePage(p) {
  if (!p.ok) return `${p.surface}: page unreachable (${p.source})`;
  const what = p.headings.length
    ? `headings: ${p.headings.slice(0, 6).join(' · ')}`
    : (p.keyPoints[0] ? `top line: ${p.keyPoints[0].slice(0, 80)}` : 'content present');
  return `${p.surface}/${p.pageKind} "${p.title || p.url}" — ${p.wordCount} words, ` +
    `${p.headings.length} headings, ${p.keyPoints.length} key points, ${p.links.length} internal links. ${what}`;
}

// ── one-paragraph live-product summary ──────────────────────────────────────────────────────────
/**
 * A one-paragraph "current state of the live product" string a brief can drop in. Derives counts
 * from the crawl: how many coins/sections the Data site shows, whether Directory's leaderboard is
 * present, roughly how many Wiki articles, whether the Stocks subdomain is live. If no crawl is
 * passed it reads the last batch from the JSONL.
 */
export function siteStateSummary(crawl) {
  const pages = crawl?.pages || lastRecordedPages();
  if (!pages.length) return 'Self-crawl: no live-site records yet (run a crawl).';

  const bySurface = (s) => pages.filter((p) => (p.surface === s) && (p.ok ?? true));
  const data = bySurface('data');
  const directory = bySurface('directory');
  const wiki = bySurface('wiki');
  const stocks = bySurface('stocks');

  const parts = [];

  // Data: count coin rows + named sections it surfaces.
  if (data.length) {
    const home = data.find((p) => (p.pageKind || p.kind) === 'home') || data[0];
    const coinRows = countCoinish(home);
    const sections = data
      .filter((p) => (p.pageKind || p.kind) === 'section')
      .map((p) => p.url.replace(/.*\//, ''))
      .filter(Boolean);
    parts.push(
      `Data lists ${coinRows ? `~${coinRows} coins` : 'coins'}` +
      (sections.length ? ` plus ${sections.join('/')} pages` : ''),
    );
  }

  // Directory: is the Top-Sites leaderboard present?
  if (directory.length) {
    const home = directory[0];
    const hasBoard = /top.?sites|leaderboard|directory|ranked/i.test(
      [home.title, ...(home.headings || []), ...(home.keyPoints || [])].join(' '),
    );
    parts.push(hasBoard ? 'Directory has the Top-Sites leaderboard' : 'Directory is live');
  }

  // Wiki: rough article count from internal links + key points.
  if (wiki.length) {
    const home = wiki.find((p) => (p.pageKind || p.kind) === 'home') || wiki[0];
    const n = articleCount(home);
    parts.push(n ? `Wiki has ~${n} articles` : 'Wiki is live');
  }

  // Stocks: live?
  if (stocks.length) parts.push(stocks[0].ok ?? true ? 'Stocks subdomain live' : 'Stocks subdomain down');

  const when = crawl?.crawledAt || lastCrawledAt();
  return `Live product state${when ? ` (as of ${when})` : ''}: ${parts.join('; ')}.`;
}

// Heuristic: how many coin rows does a Data home/markets page show? Count table rows / bullet lines
// that look like a coin (have a $ price or a known-ticker shape). Capped, best-effort.
function countCoinish(page) {
  if (!page) return 0;
  const lines = [...(page.keyPoints || []), ...(page.headings || [])];
  let n = 0;
  for (const ln of lines) {
    if (/\$\s?[\d,]+(\.\d+)?/.test(ln) || /\b[A-Z]{2,6}\b.*\$/.test(ln)) n++;
  }
  return n;
}

// Heuristic: rough Wiki article count from internal article-ish links + list items on the wiki home.
function articleCount(page) {
  if (!page) return 0;
  const links = (page.links || []).filter((u) => /\/[a-z0-9-]{3,}$/i.test(u) && !/\/$/.test(u));
  const listish = (page.keyPoints || []).filter((p) => p.length > 4).length;
  return Math.max(links.length, Math.min(listish, 60)) || 0;
}

// ── reading the last recorded batch (when no fresh crawl is passed) ───────────────────────────────
function lastBatch() {
  try {
    if (!existsSync(OUT_FILE)) return [];
    const lines = readFileSync(OUT_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!recs.length) return [];
    const latest = recs[recs.length - 1].crawledAt;
    return recs.filter((r) => r.crawledAt === latest);
  } catch { return []; }
}
function lastRecordedPages() {
  return lastBatch().map((r) => ({
    url: r.url, surface: r.surface, pageKind: r.pageKind, kind: r.pageKind,
    title: r.title, headings: r.headings || [], keyPoints: r.keyPoints || [],
    links: r.internalLinks || [], wordCount: r.wordCount, ok: r.ok,
  }));
}
function lastCrawledAt() {
  const b = lastBatch();
  return b.length ? b[b.length - 1].crawledAt : '';
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('self-crawl.mjs')) {
  (async () => {
    try {
      console.error(`[self-crawl] crawling ${OUR_PAGES.filter((p) => isPublic(p.url)).length} public pages…`);
      const crawl = await crawlOurSite();
      const records = toAnnalRecords(crawl);
      console.error(`[self-crawl] ${crawl.okCount}/${crawl.pageCount} pages OK → ${records.length} records → ${OUT_FILE}`);
      for (const p of crawl.pages) {
        console.error(`  ${p.ok ? '✓' : '✗'} [${p.surface}/${p.pageKind}] ${p.title || p.url} — ${p.wordCount}w, ${p.headings.length}h, ${p.keyPoints.length}kp, ${p.links.length}↗`);
      }
      console.log('\n' + siteStateSummary(crawl));
    } catch (e) {
      console.error('[self-crawl] failed:', e?.message || e);
      process.exit(0);                              // never throw — best-effort
    }
  })();
}
