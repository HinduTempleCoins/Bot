// rss-feed.mjs — read-only RSS 2.0 / Atom feed parser (queue #276, RSS feeds, unlimited).
//
// The ingest PRIMITIVE the n8n / cross-post items assume but which did not exist yet: a pure,
// dependency-free way to turn a feed XML string (or a URL, via injected fetch) into a normalized
// { title, link, items:[...] } shape. Handles BOTH dialects:
//   - RSS 2.0:  <channel><title><link><item><title><link><guid><pubDate><description>
//   - Atom:     <feed><title><link href><entry><title><link href><id><updated><summary>
//
// PURE / deterministic. No DOM dependency — regex/string extraction only. No network except through
// the injected fetch seam (__setFetch / fetchFeed(url,{fetch})). Soft-fail EVERYWHERE: a malformed
// feed or a network error yields { title:'', items:[] } and never throws. Every value placed into the
// returned HTML helpers is esc()'d.
//
//   import { parseFeed, fetchFeed, dedupeItems, sortByDate, __setFetch } from './rss-feed.mjs'
//   node integrations/rss-feed.mjs <url>     # fetch + print a normalized summary (needs global fetch)

// ---- injectable IO seam ----------------------------------------------------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- HTML escape (single local copy; identical behavior to the house esc) --
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- XML entity decode (basic named + numeric) -----------------------------
// Decodes the five predefined XML entities plus decimal (&#NN;) and hex (&#xNN;) numeric refs.
// &amp; is decoded LAST so an encoded sequence like "&amp;lt;" round-trips to "&lt;" not "<".
export function decodeEntities(s) {
  let out = String(s ?? '');
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)));
  out = out.replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)));
  out = out
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return out;
}
function safeFromCodePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

// ---- low-level extractors --------------------------------------------------
// Strip a leading <![CDATA[ ... ]]> wrapper if present, then decode entities and trim.
function cleanText(raw) {
  if (raw == null) return '';
  let s = String(raw);
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(s).trim();
}

// First text content of <tag>...</tag> (namespace-aware: matches dc:date etc. when asked).
// `tag` may include a namespace prefix; we also allow an optional prefix on bare tags.
function tagText(xml, tag) {
  if (!xml) return '';
  const t = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<(?:[\\w-]+:)?${t}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${t}>`, 'i');
  const m = xml.match(re);
  return m ? cleanText(m[1]) : '';
}

// Split a document into the inner XML of each <tag>...</tag> block.
function blocks(xml, tag) {
  if (!xml) return [];
  const t = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<(?:[\\w-]+:)?${t}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${t}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// Atom <link href="..."/> — prefer rel="alternate" (or no rel), skip rel="self". Falls back to the
// first href found. Returns '' if none.
function atomLink(xml) {
  if (!xml) return '';
  const re = /<(?:[\w-]+:)?link\b([^>]*?)\/?>/gi;
  let first = '';
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || '';
    const href = (attrs.match(/\bhref\s*=\s*"([^"]*)"/i) || attrs.match(/\bhref\s*=\s*'([^']*)'/i));
    if (!href) continue;
    const url = decodeEntities(href[1]).trim();
    if (!first) first = url;
    const rel = (attrs.match(/\brel\s*=\s*"([^"]*)"/i) || attrs.match(/\brel\s*=\s*'([^']*)'/i));
    const relVal = rel ? rel[1].toLowerCase() : '';
    if (relVal === 'self') continue;
    if (relVal === '' || relVal === 'alternate') return url;
  }
  return first;
}

// ---- date normalization ----------------------------------------------------
// Best-effort ISO 8601 string from any feed date; '' if unparseable. Never throws.
export function toIso(dateStr) {
  const s = String(dateStr ?? '').trim();
  if (!s) return '';
  const t = Date.parse(s);
  if (Number.isNaN(t)) return '';
  try { return new Date(t).toISOString(); } catch { return ''; }
}

// ---- the parser ------------------------------------------------------------
const EMPTY = Object.freeze({ title: '', link: '', items: [] });

/**
 * parseFeed(xmlString) -> { title, link, items:[{title,link,guid,pubDate,isoDate,summary}] }
 * Handles RSS 2.0 and Atom. Soft-fail: any error / non-string / empty yields { title:'', link:'', items:[] }.
 */
export function parseFeed(xmlString) {
  try {
    if (typeof xmlString !== 'string' || !xmlString.trim()) return clone(EMPTY);
    const xml = xmlString;

    const isAtom = /<feed\b[^>]*>/i.test(xml) && !/<rss\b[^>]*>/i.test(xml);

    if (isAtom) return parseAtom(xml);
    return parseRss(xml);
  } catch {
    return clone(EMPTY); // never throw
  }
}

function parseRss(xml) {
  // Channel scope: prefer the <channel> inner XML so item parsing is contained, but tolerate its absence.
  const channelBlocks = blocks(xml, 'channel');
  const channel = channelBlocks.length ? channelBlocks[0] : xml;

  // Channel title/link come from text BEFORE the first <item> to avoid grabbing an item's title.
  const firstItem = channel.search(/<(?:[\w-]+:)?item\b/i);
  const head = firstItem >= 0 ? channel.slice(0, firstItem) : channel;

  const title = tagText(head, 'title');
  const link = tagText(head, 'link');

  const items = blocks(channel, 'item').map((b) => ({
    title: tagText(b, 'title'),
    link: tagText(b, 'link'),
    guid: tagText(b, 'guid') || tagText(b, 'link'),
    pubDate: tagText(b, 'pubDate') || tagText(b, 'date'),
    isoDate: toIso(tagText(b, 'pubDate') || tagText(b, 'date')),
    summary: tagText(b, 'description') || tagText(b, 'encoded') || tagText(b, 'summary'),
  }));

  return { title, link, items };
}

function parseAtom(xml) {
  const firstEntry = xml.search(/<(?:[\w-]+:)?entry\b/i);
  const head = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml;

  const title = tagText(head, 'title');
  const link = atomLink(head);

  const items = blocks(xml, 'entry').map((b) => {
    const lnk = atomLink(b);
    return {
      title: tagText(b, 'title'),
      link: lnk,
      guid: tagText(b, 'id') || lnk,
      pubDate: tagText(b, 'updated') || tagText(b, 'published'),
      isoDate: toIso(tagText(b, 'updated') || tagText(b, 'published')),
      summary: tagText(b, 'summary') || tagText(b, 'content'),
    };
  });

  return { title, link, items };
}

// ---- fetch wrapper ---------------------------------------------------------
/**
 * fetchFeed(url, {fetch}={}) -> same shape as parseFeed, via the injected (or global) fetch.
 * Soft-fail: any network / non-OK / parse error yields { title:'', link:'', items:[] }. Never throws.
 */
export async function fetchFeed(url, { fetch } = {}) {
  try {
    if (!url || typeof url !== 'string') return clone(EMPTY);
    const f = typeof fetch === 'function' ? fetch : _fetch;
    const res = await f(url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!res || res.ok === false) return clone(EMPTY);
    const text = typeof res.text === 'function' ? await res.text() : String(res.body ?? res ?? '');
    return parseFeed(text);
  } catch {
    return clone(EMPTY); // never throw
  }
}

// ---- helpers over item lists -----------------------------------------------
/** dedupeItems(items) — drop later duplicates keyed by guid || link (keeps first seen). */
export function dedupeItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const key = (it.guid && String(it.guid)) || (it.link && String(it.link)) || '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(it);
  }
  return out;
}

/** sortByDate(items) — newest first by isoDate (falling back to pubDate). Items without a date sort last.
 *  Returns a NEW array; never mutates the input. Stable for equal/undated entries. */
export function sortByDate(items) {
  if (!Array.isArray(items)) return [];
  const withIdx = items
    .filter((it) => it && typeof it === 'object')
    .map((it, i) => ({ it, i, t: dateMs(it) }));
  withIdx.sort((a, b) => {
    const an = a.t == null, bn = b.t == null;
    if (an && bn) return a.i - b.i;
    if (an) return 1;
    if (bn) return -1;
    if (b.t !== a.t) return b.t - a.t;
    return a.i - b.i;
  });
  return withIdx.map((x) => x.it);
}
function dateMs(it) {
  const s = it.isoDate || it.pubDate || '';
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ---- HTML render helpers (every value esc()'d) -----------------------------
/** renderItem(item) -> a safe <li> with an escaped title/link/summary. */
export function renderItem(item) {
  const it = item && typeof item === 'object' ? item : {};
  const title = esc(it.title || '(untitled)');
  const link = esc(it.link || '');
  const when = esc(it.isoDate || it.pubDate || '');
  const summary = esc(it.summary || '');
  const titleHtml = link ? `<a href="${link}">${title}</a>` : title;
  return `<li class="rss-item"><span class="rss-title">${titleHtml}</span>`
    + (when ? `<time class="rss-date">${when}</time>` : '')
    + (summary ? `<p class="rss-summary">${summary}</p>` : '')
    + `</li>`;
}

/** renderFeed(feed) -> a safe <section> listing the feed's items (deduped + newest-first). */
export function renderFeed(feed) {
  const f = feed && typeof feed === 'object' ? feed : EMPTY;
  const title = esc(f.title || '(untitled feed)');
  const link = esc(f.link || '');
  const head = link ? `<a href="${link}">${title}</a>` : title;
  const items = sortByDate(dedupeItems(Array.isArray(f.items) ? f.items : []));
  const lis = items.map(renderItem).join('');
  return `<section class="rss-feed"><h2 class="rss-feed-title">${head}</h2><ul class="rss-items">${lis}</ul></section>`;
}

// ---- misc ------------------------------------------------------------------
function clone(o) { return { title: o.title, link: o.link, items: o.items.slice() }; }

// ---- CLI (guarded) ---------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.log('usage: node integrations/rss-feed.mjs <feed-url>');
  } else {
    fetchFeed(url).then((feed) => {
      const items = sortByDate(dedupeItems(feed.items));
      console.log(`feed: ${feed.title || '(untitled)'}  (${items.length} items)`);
      for (const it of items.slice(0, 10)) {
        console.log(`- ${it.isoDate || it.pubDate || '?'}  ${it.title || '(untitled)'}  ${it.link || ''}`);
      }
    });
  }
}
