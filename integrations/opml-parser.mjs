// opml-parser.mjs — OPML 2.0 subscription-list parser / serializer (maps queue #276, RSS feeds).
//
// COMPANION to rss-feed.mjs, not a duplicate of it: rss-feed FETCHES + parses ONE feed's content;
// this manages the SUBSCRIPTION LIST — the roster of feeds an app subscribes to — as an OPML
// document. Lets the wiki / social bot IMPORT (parse) and EXPORT (build) a feed roster, and MERGE
// two rosters into a deduped union.
//
//   import { parseOpml, buildOpml, mergeOpml, esc } from './opml-parser.mjs'
//   node integrations/opml-parser.mjs           # round-trip demo (no network, no I/O)
//
// PURE / deterministic. No DOM, no network, no I/O — regex/string extraction only. Soft-fail
// EVERYWHERE: non-string / garbage input yields { title:'', feeds:[] } and never throws. Every
// value placed into built OPML XML is esc()'d.
//
// Shapes:
//   parseOpml(xmlString) -> { title, feeds:[ { title, xmlUrl, htmlUrl, category } ] }
//   buildOpml({ title, feeds }) -> OPML 2.0 XML string (empty list still yields <opml><body/></opml>)
//   mergeOpml(a, b) -> { title, feeds } deduped union by xmlUrl (a's entry wins on collision)
//
// <outline> nodes nest: category-grouping outlines (no xmlUrl) wrap feed outlines (with xmlUrl).
// Nested grouping titles are FLATTENED into the leaf feed's `category` field. Only outline nodes
// carrying an xmlUrl attribute become feeds; pure grouping outlines contribute their text as the
// category path for their descendants.

// ---- HTML/XML escape (single local copy; identical behavior to the house esc) --
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- XML entity decode (basic named + numeric) -----------------------------
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

// ---- attribute extraction --------------------------------------------------
// Pull a single attribute value from an opening-tag string. Handles "..." and '...' quoting.
function attr(tag, name) {
  if (!tag) return '';
  const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i');
  const m = tag.match(re);
  if (!m) return '';
  const raw = m[2] != null ? m[2] : (m[3] != null ? m[3] : '');
  return decodeEntities(raw).trim();
}

// The display text of an outline: OPML uses `text`, many real-world files use `title`.
function outlineText(tag) {
  return attr(tag, 'text') || attr(tag, 'title');
}

// ---- parseOpml -------------------------------------------------------------
export function parseOpml(xmlString) {
  const empty = { title: '', feeds: [] };
  if (typeof xmlString !== 'string' || xmlString.trim() === '') return empty;

  let title = '';
  // <title> inside <head>, or the head's own <title>; fall back to empty.
  const headTitle = xmlString.match(/<title>([\s\S]*?)<\/title>/i);
  if (headTitle) title = decodeEntities(headTitle[1]).trim();

  const feeds = [];
  // Walk the document token by token over <outline ...> open/self-close/close tags.
  // We do not require well-formedness; a soft tokenizer keeps a category stack.
  const tokenRe = /<outline\b([^>]*?)(\/?)>|<\/outline\s*>/gi;
  const stack = []; // category labels currently open (grouping outlines)
  let m;
  let guard = 0;
  while ((m = tokenRe.exec(xmlString)) !== null) {
    if (++guard > 200000) break; // pathological-input guard
    const isClose = m[0][1] === '/';
    if (isClose) {
      if (stack.length) stack.pop();
      continue;
    }
    const tagBody = m[1] || '';
    const selfClosed = m[2] === '/';
    const xmlUrl = attr(tagBody, 'xmlUrl') || attr(tagBody, 'xmlurl');
    const text = outlineText(tagBody);

    if (xmlUrl) {
      feeds.push({
        title: text,
        xmlUrl,
        htmlUrl: attr(tagBody, 'htmlUrl') || attr(tagBody, 'htmlurl'),
        category: stack.join('/'),
      });
      // A feed outline may legitimately wrap children; if it is NOT self-closed it
      // pushes nothing categorical (feeds are leaves for our roster purpose), but we
      // must still balance the stack — push an empty marker so its </outline> pops cleanly.
      if (!selfClosed) stack.push('');
    } else {
      // Grouping outline: contributes its text to the category path for descendants.
      if (!selfClosed) stack.push(text);
    }
  }

  return { title, feeds };
}

// ---- buildOpml -------------------------------------------------------------
export function buildOpml(doc) {
  const d = (doc && typeof doc === 'object') ? doc : {};
  const title = typeof d.title === 'string' ? d.title : '';
  const feeds = Array.isArray(d.feeds) ? d.feeds : [];

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<opml version="2.0">');
  lines.push('  <head>');
  lines.push(`    <title>${esc(title)}</title>`);
  lines.push('  </head>');

  // Group feeds by their (flattened) category to rebuild a minimal nesting.
  const byCat = new Map();
  for (const f of feeds) {
    if (!f || typeof f !== 'object') continue;
    const xmlUrl = typeof f.xmlUrl === 'string' ? f.xmlUrl : '';
    if (!xmlUrl) continue; // a roster entry without a feed URL is not a subscription
    const cat = typeof f.category === 'string' ? f.category.trim() : '';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({ ...f, xmlUrl });
  }

  if (byCat.size === 0) {
    // Empty list -> still valid: a body that self-closes.
    lines.push('  <body/>');
    lines.push('</opml>');
    return lines.join('\n') + '\n';
  }

  lines.push('  <body>');
  for (const [cat, list] of byCat) {
    const segs = cat ? cat.split('/').filter((s) => s !== '') : [];
    let indent = '    ';
    // Open one grouping outline per category segment.
    for (const seg of segs) {
      lines.push(`${indent}<outline text="${esc(seg)}" title="${esc(seg)}">`);
      indent += '  ';
    }
    for (const f of list) {
      const t = typeof f.title === 'string' ? f.title : '';
      const html = typeof f.htmlUrl === 'string' ? f.htmlUrl : '';
      lines.push(
        `${indent}<outline type="rss" text="${esc(t)}" title="${esc(t)}" ` +
        `xmlUrl="${esc(f.xmlUrl)}" htmlUrl="${esc(html)}"/>`
      );
    }
    // Close the grouping outlines in reverse.
    for (let i = segs.length - 1; i >= 0; i--) {
      indent = indent.slice(0, -2);
      lines.push(`${indent}<outline>`.replace('<outline>', '</outline>'));
    }
  }
  lines.push('  </body>');
  lines.push('</opml>');
  return lines.join('\n') + '\n';
}

// ---- mergeOpml -------------------------------------------------------------
// Deduped union of two rosters by xmlUrl. `a`'s entry wins on collision. Title prefers a's,
// then b's. Non-roster / garbage inputs are treated as empty.
export function mergeOpml(a, b) {
  const da = normalizeRoster(a);
  const db = normalizeRoster(b);
  const seen = new Set();
  const feeds = [];
  for (const f of [...da.feeds, ...db.feeds]) {
    const key = f.xmlUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    feeds.push(f);
  }
  return { title: da.title || db.title || '', feeds };
}

function normalizeRoster(x) {
  if (typeof x === 'string') return parseOpml(x);
  if (x && typeof x === 'object' && Array.isArray(x.feeds)) {
    const feeds = [];
    for (const f of x.feeds) {
      if (!f || typeof f !== 'object') continue;
      const xmlUrl = typeof f.xmlUrl === 'string' ? f.xmlUrl : '';
      if (!xmlUrl) continue;
      feeds.push({
        title: typeof f.title === 'string' ? f.title : '',
        xmlUrl,
        htmlUrl: typeof f.htmlUrl === 'string' ? f.htmlUrl : '',
        category: typeof f.category === 'string' ? f.category : '',
      });
    }
    return { title: typeof x.title === 'string' ? x.title : '', feeds };
  }
  return { title: '', feeds: [] };
}

// ---- CLI (guarded) ---------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const demo = {
    title: 'Demo roster',
    feeds: [
      { title: 'A', xmlUrl: 'https://a.example/feed.xml', htmlUrl: 'https://a.example/', category: 'News' },
      { title: 'B', xmlUrl: 'https://b.example/feed.xml', htmlUrl: 'https://b.example/', category: 'News/Tech' },
    ],
  };
  const xml = buildOpml(demo);
  process.stdout.write(xml + '\n');
  const round = parseOpml(xml);
  process.stdout.write(`parsed ${round.feeds.length} feed(s), title=${JSON.stringify(round.title)}\n`);
}
