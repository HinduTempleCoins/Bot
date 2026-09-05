// chain-feed.mjs — turn on-chain Graphene posts into a syndication feed. The GENERATOR half.
//
// integrations/rss-feed.mjs is the READER (parse someone else's feed, for ingest). This is the
// WRITER: take an author's posts off a Graphene chain and emit RSS 2.0, Atom, or JSON Feed.
//
// DELIBERATELY NOT HATHOR-SPECIFIC. It takes an author and a chain reader, so it serves @hathor on
// MELEK today and any other author or Graphene chain tomorrow. Hathor-specific defaults live in the
// caller (site/hathor-live/server.mjs), not here.
//
// WHY A CHAIN NEEDS THIS AT ALL. A Graphene post is already public, permanent and addressable — but
// nothing off-chain can subscribe to it. RSS is the lowest-common-denominator subscribe primitive:
// Discord, Slack, Telegram, every reader, and every no-code automation tool speak it. One feed makes
// the chain's output reachable by all of them without any of them needing a chain client.
//
// CORRECTNESS THIS MODULE ACTUALLY HANDLES (each was a real bug class, not a hypothetical):
//   • XML escaping, including the C0 control characters that are ILLEGAL in XML 1.0 at any level of
//     escaping. A post body with a stray 0x08 makes the whole feed unparseable; stripping is the only
//     legal fix. See xmlEsc().
//   • RFC-822 dates for RSS and RFC-3339 for Atom. Readers reject the wrong dialect.
//   • Stable GUIDs (author/permlink), so an edited post updates rather than duplicating.
//   • Markdown → plain-text summaries, so a reader shows prose rather than link syntax.
//
// PURE + OFFLINE. No network except through an injected reader. Soft-fail everywhere: a broken post
// is skipped, never thrown. House style — ESM, esc() everything, CLI guarded by process.argv[1].
//
//   import { buildFeed, renderRss, renderAtom, renderJsonFeed, fetchAuthorPosts } from './chain-feed.mjs'

// ---- escaping --------------------------------------------------------------

// XML 1.0 forbids most C0 controls OUTRIGHT - they cannot be escaped, only removed. Tab, LF
// and CR are the only legal ones, plus the noncharacters U+FFFE/U+FFFF. A single stray byte
// from a pasted post body otherwise makes the feed unparseable for every subscriber at once,
// which is a silent and total failure.
// Written as explicit escapes on purpose: an earlier draft of this line carried the raw
// control characters themselves, which is invisible in an editor and mangles the range
// boundaries (0x7F-U+009F as raw UTF-8 is not the range it looks like).
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g;

export function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---- dates -----------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Graphene timestamps are naive UTC ("2026-09-05T04:42:48"); Date.parse would read them as local. */
export function toDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v || '').trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s) ? s + 'Z' : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** RFC-822, which is what RSS 2.0 requires. */
export function rfc822(v) {
  const d = toDate(v);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
}

/** RFC-3339, which is what Atom and JSON Feed require. */
export function rfc3339(v) {
  const d = toDate(v);
  return d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
}

// ---- markdown → summary ----------------------------------------------------

/** Flatten markdown to readable prose for a feed summary. Never throws. */
export function plainSummary(md, max = 400) {
  let t = String(md == null ? '' : md);
  t = t.replace(/^---\n[\s\S]*?\n---\n/, '');          // front matter
  t = t.replace(/```[\s\S]*?```/g, ' ');                // fenced code
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');          // images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');        // links → their text
  t = t.replace(/<[^>]+>/g, ' ');                       // raw html
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');             // headings
  t = t.replace(/^\s{0,3}>\s?/gm, '');                  // quotes
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '');              // bullets
  t = t.replace(/[*_`~]/g, '');                         // emphasis marks
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/** Tags out of a Graphene post's json_metadata, soft-failing on anything malformed. */
export function postTags(post) {
  try {
    const meta = typeof post.json_metadata === 'string'
      ? JSON.parse(post.json_metadata) : (post.json_metadata || {});
    const t = Array.isArray(meta.tags) ? meta.tags : [];
    return t.filter((x) => typeof x === 'string' && x).slice(0, 12);
  } catch { return []; }
}

// ---- normalise -------------------------------------------------------------

/**
 * Chain post objects → feed items. Drops anything without an author+permlink rather than
 * emitting a broken entry. Comments (depth > 0) are excluded by default — a feed of a blog
 * should be the blog, not every reply.
 */
export function postsToItems(posts, { baseUrl = '', includeReplies = false, summaryChars = 400 } = {}) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return (Array.isArray(posts) ? posts : [])
    .filter((p) => p && p.author && p.permlink)
    .filter((p) => (includeReplies ? true : !(p.parent_author && String(p.parent_author).length)))
    .map((p) => ({
      id: `${p.author}/${p.permlink}`,
      title: String(p.title || p.permlink),
      url: `${base}/@${p.author}/${p.permlink}`,
      author: String(p.author),
      date: rfc3339(p.created) || '',
      _sort: (toDate(p.created) || new Date(0)).getTime(),
      summary: plainSummary(p.body, summaryChars),
      tags: postTags(p),
      category: String(p.category || (postTags(p)[0] || '')),
    }))
    .sort((a, b) => b._sort - a._sort);
}

/** Assemble the feed object the renderers take. */
export function buildFeed({
  title = 'Feed', description = '', siteUrl = '', feedUrl = '',
  author = '', language = 'en', posts = [], items = null, ...opts
} = {}) {
  const list = Array.isArray(items) ? items : postsToItems(posts, { baseUrl: siteUrl, ...opts });
  const newest = list.length ? list[0].date : rfc3339(new Date());
  return {
    title: String(title), description: String(description),
    siteUrl: String(siteUrl).replace(/\/$/, ''), feedUrl: String(feedUrl),
    author: String(author), language: String(language),
    updated: newest, items: list,
  };
}

// ---- renderers -------------------------------------------------------------

export function renderRss(feed) {
  const f = feed || {};
  const items = (f.items || []).map((i) => `    <item>
      <title>${xmlEsc(i.title)}</title>
      <link>${xmlEsc(i.url)}</link>
      <guid isPermaLink="false">${xmlEsc(i.id)}</guid>
      <pubDate>${xmlEsc(rfc822(i.date))}</pubDate>
      <dc:creator>${xmlEsc(i.author)}</dc:creator>
${(i.tags || []).map((t) => `      <category>${xmlEsc(t)}</category>`).join('\n')}
      <description>${xmlEsc(i.summary)}</description>
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEsc(f.title)}</title>
    <link>${xmlEsc(f.siteUrl)}</link>
    <description>${xmlEsc(f.description)}</description>
    <language>${xmlEsc(f.language || 'en')}</language>
    <lastBuildDate>${xmlEsc(rfc822(f.updated))}</lastBuildDate>
    <atom:link href="${xmlEsc(f.feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export function renderAtom(feed) {
  const f = feed || {};
  const entries = (f.items || []).map((i) => `  <entry>
    <title>${xmlEsc(i.title)}</title>
    <link href="${xmlEsc(i.url)}"/>
    <id>tag:${xmlEsc((f.siteUrl || '').replace(/^https?:\/\//, ''))},${xmlEsc((i.date || '').slice(0, 10))}:${xmlEsc(i.id)}</id>
    <updated>${xmlEsc(i.date)}</updated>
    <author><name>${xmlEsc(i.author)}</name></author>
${(i.tags || []).map((t) => `    <category term="${xmlEsc(t)}"/>`).join('\n')}
    <summary>${xmlEsc(i.summary)}</summary>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEsc(f.title)}</title>
  <link href="${xmlEsc(f.siteUrl)}"/>
  <link href="${xmlEsc(f.feedUrl)}" rel="self"/>
  <id>${xmlEsc(f.siteUrl)}/</id>
  <updated>${xmlEsc(f.updated)}</updated>
  <subtitle>${xmlEsc(f.description)}</subtitle>
${entries}
</feed>
`;
}

export function renderJsonFeed(feed) {
  const f = feed || {};
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: f.title, home_page_url: f.siteUrl, feed_url: f.feedUrl,
    description: f.description, language: f.language,
    items: (f.items || []).map((i) => ({
      id: i.id, url: i.url, title: i.title,
      date_published: i.date, summary: i.summary,
      tags: i.tags, authors: [{ name: i.author }],
    })),
  }, null, 2) + '\n';
}

// ---- chain read ------------------------------------------------------------

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/**
 * Read an author's blog off a Graphene node. Soft-fails to [] — a feed endpoint must serve a
 * valid empty feed when the chain is unreachable rather than 500 at every subscriber at once.
 */
export async function fetchAuthorPosts(author, { rpcUrl, limit = 20, fetch: f = null } = {}) {
  const url = rpcUrl || process.env.MELEK_RPC_URL || 'http://127.0.0.1:8090';
  const doFetch = f || _fetch;
  if (!author || !url) return [];
  try {
    const r = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'condenser_api.get_discussions_by_blog',
        params: [{ tag: String(author), limit: Math.max(1, Math.min(100, limit)) }],
      }),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const res = j && j.result;
    return Array.isArray(res) ? res.filter((p) => p && p.author === author) : [];
  } catch { return []; }
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const author = process.argv[2] || 'hathor';
  const posts = await fetchAuthorPosts(author, { rpcUrl: process.env.MELEK_RPC_URL });
  const feed = buildFeed({
    title: `@${author}`, siteUrl: process.env.BASE_URL || 'https://melek.salon',
    feedUrl: `${process.env.BASE_URL || 'https://melek.salon'}/feed.xml`, author, posts,
  });
  process.stdout.write(renderRss(feed));
}
