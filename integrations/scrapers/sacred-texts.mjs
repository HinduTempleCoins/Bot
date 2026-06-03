// sacred-texts.mjs — corpus scrapers for two well-known public-domain / freely-readable mythology +
// religion text archives, turning fetched pages into clean JSONL knowledge-corpus records for the
// Library of Ashurbanipal:
//   • Sacred-Texts (sacred-texts.com) — J.B. Hare's archive of public-domain religious/mythological texts.
//   • Theoi (theoi.com) — an encyclopedia of Greek mythology with sourced primary quotations.
//
// Both are simple, mostly-static HTML, so we parse with light regex tag-stripping (no DOM dependency)
// — matching scraper.mjs's fetch/inject/soft-fail style. Records are one-per-line JSONL ready for the
// corpus ingest. NO secrets, no real network in tests (fetch is injectable).
//
//   import { parseSacredText, parseTheoi, scrapeUrl, toJsonl } from './scrapers/sacred-texts.mjs'
//   node integrations/scrapers/sacred-texts.mjs https://www.sacred-texts.com/...

// ── politeness: a clear UA + a rate-limit floor. These archives are run by volunteers/small teams,
// so any real crawler built on this MUST throttle to <= 1 request / RATE_LIMIT_MS and honour each
// site's robots.txt. This module does NOT crawl by itself (no link-following loop) — it parses a page
// you already fetched — but the constants are exported so a future crawler respects them. ──
export const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot; corpus archival, respects robots.txt)';
export const RATE_LIMIT_MS = +(process.env.SACRED_TEXTS_RATE_LIMIT_MS || 2000); // >= 2s between requests; be polite.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── cleanText: HTML → clean plain text. Pure + well-tested. Drops scripts/styles/nav, converts a few
// block tags to newlines, strips remaining tags, decodes common entities, collapses whitespace. ──
export function cleanText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')                              // comments
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')                   // scripts
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')                     // styles
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')                         // nav blocks
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')                   // page headers
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')                   // page footers
    .replace(/<br\s*\/?>(?=)/gi, '\n')                             // line breaks
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|table)>/gi, '\n')  // block enders → newline
    .replace(/<[^>]+>/g, ' ')                                      // remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ' '; } })
    .replace(/[ \t]+/g, ' ')                                       // collapse inline whitespace
    .replace(/ *\n */g, '\n')                                      // trim around newlines
    .replace(/\n{3,}/g, '\n\n')                                    // cap blank runs
    .trim();
}

// Pull the first matching tag's inner text (cleaned). Returns '' if not found.
function firstTagText(html, tag) {
  const m = String(html || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? cleanText(m[1]) : '';
}

// Title from <title>, falling back to the first heading. <title> often has a " — Sacred-Texts" style
// suffix we trim on common separators.
function extractTitle(html) {
  let t = firstTagText(html, 'title');
  if (t) t = t.split(/\s+[|—–-]\s+/)[0].trim();         // drop "… | Site" / "… — Site" suffixes
  if (!t) t = firstTagText(html, 'h1') || firstTagText(html, 'h2') || firstTagText(html, 'h3');
  return t.trim();
}

// Best-effort main body: prefer a <body>…</body> slice (so we never include <head> metadata), else the
// whole document. cleanText already strips nav/header/footer/scripts/styles.
function extractBody(html) {
  const s = String(html || '');
  const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return cleanText(body ? body[1] : s);
}

// lang from <html lang="..">, the meta content-language, or undefined.
function extractLang(html) {
  const s = String(html || '');
  const m = s.match(/<html[^>]*\blang=["']?([a-z-]+)/i)
    || s.match(/<meta[^>]+http-equiv=["']content-language["'][^>]+content=["']([a-z-]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

// author: best-effort from a meta author tag or a "by …" byline near the top. Optional.
function extractAuthor(html) {
  const s = String(html || '');
  const m = s.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i);
  if (m) return cleanText(m[1]) || undefined;
  return undefined;
}

/**
 * Parse a Sacred-Texts (sacred-texts.com) page into a corpus record. Soft-fails: returns null on
 * empty/garbage input rather than throwing.
 */
export function parseSacredText(html, { url } = {}) {
  try {
    if (!html || typeof html !== 'string') return null;
    const title = extractTitle(html);
    const body = extractBody(html);
    if (!title && !body) return null;
    const rec = {
      source: 'sacred-texts',
      url: url || '',
      title,
      body,
      license: 'public-domain-or-archive',
      fetchedAt: new Date().toISOString(),
    };
    const author = extractAuthor(html);
    if (author) rec.author = author;
    const lang = extractLang(html);
    if (lang) rec.lang = lang;
    return rec;
  } catch { return null; }
}

/**
 * Parse a Theoi (theoi.com) mythology entry into a corpus record. Theoi pages are an entry title plus
 * descriptive prose and sourced primary-source quotations — we capture the title + the body text.
 * Soft-fails to null.
 */
export function parseTheoi(html, { url } = {}) {
  try {
    if (!html || typeof html !== 'string') return null;
    const title = extractTitle(html);
    const body = extractBody(html);
    if (!title && !body) return null;
    const rec = {
      source: 'theoi',
      url: url || '',
      title,
      body,
      license: 'public-domain-or-archive',
      fetchedAt: new Date().toISOString(),
    };
    const lang = extractLang(html);
    if (lang) rec.lang = lang;
    return rec;
  } catch { return null; }
}

/** Records → newline-delimited JSON (one record per line). toJsonl([]) → ''. */
export function toJsonl(records) {
  if (!Array.isArray(records) || !records.length) return '';
  return records.filter((r) => r != null).map((r) => JSON.stringify(r)).join('\n');
}

// hostname → parser dispatch.
function parserFor(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return null; }
  if (host.endsWith('sacred-texts.com')) return parseSacredText;
  if (host.endsWith('theoi.com')) return parseTheoi;
  return null;
}

/**
 * Fetch a URL (via the injectable fetch) and dispatch to the matching parser by hostname. Soft-fails
 * to null on bad URL, unknown host, fetch error, or non-OK response.
 */
export async function scrapeUrl(url) {
  const parse = parserFor(url);
  if (!parse) return null;
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA } });
    if (r && r.ok === false) return null;
    const html = await r.text();
    return parse(html, { url });
  } catch { return null; }
}

// ── CLI: node integrations/scrapers/sacred-texts.mjs <url> — fetch + parse + print one JSONL line ──
if (process.argv[1] && process.argv[1].endsWith('sacred-texts.mjs')) {
  const url = process.argv[2];
  if (!url) { console.error('usage: sacred-texts.mjs <url>'); process.exit(1); }
  const rec = await scrapeUrl(url);
  if (!rec) { console.error('no record (unknown host, fetch error, or empty page)'); process.exit(2); }
  console.log(toJsonl([rec]));
}
