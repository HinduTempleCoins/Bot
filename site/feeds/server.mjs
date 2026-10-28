// server.mjs — RSS / Atom / JSON Feed for MELEK blogs, generated from the chain.
//
// WHY THIS EXISTS
//   melek.salon had no feed of any kind. Every blog directory and aggregator that matters —
//   AllTop, Feedspot, Blogarama, BlogCatalog, Flipboard, Inoreader, Feedly — asks for a feed
//   URL, not a page URL. Without one a MELEK blog cannot be listed or syndicated anywhere.
//   The posts already exist on-chain, so a feed is a pure projection of chain state.
//
//   Served on the blog's OWN domain (melek.salon/rss/...) because directories prefer a
//   same-domain feed and some reject third-party feed hosts.
//
//   PORT=8242 BASE_URL=https://melek.salon node site/feeds/server.mjs
//
// Routes
//   /rss/@<account>            RSS 2.0 for an account's blog
//   /rss/@<account>/atom       Atom 1.0
//   /rss/@<account>/json       JSON Feed 1.1
//   /rss/tag/<tag>             RSS 2.0 for a tag
//   /rss                       a small index listing the URL shapes
//   /health
//
// House style: ESM, injectable fetch (__setFetch) so tests run fully offline, esc() on every
// interpolated value, soft-fail-never-throw (a chain error yields an empty but valid feed),
// handler(req,res) exported for tests, CLI guarded by process.argv[1].

import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8242);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const RPC_URL = process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
const SITE_NAME = process.env.SITE_NAME || 'MELEK';
const MAX_ITEMS = Math.min(100, Math.max(1, +(process.env.FEED_ITEMS || 25)));

// injectable fetch — tests pass a stub; production uses global fetch
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(f) { _fetch = f; }

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// strip markdown/html down to a plain-text summary
export function summarize(body = '', limit = 400) {
  const t = String(body)
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > limit ? t.slice(0, limit).replace(/\s+\S*$/, '') + '…' : t;
}

export function firstImage(body = '') {
  const md = String(body).match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  if (md) return md[1];
  const html = String(body).match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return html ? html[1] : null;
}

const rfc822 = (iso) => {
  const d = new Date(/Z$/.test(iso) ? iso : iso + 'Z');
  return Number.isFinite(d.getTime()) ? d.toUTCString() : new Date(0).toUTCString();
};
const iso8601 = (iso) => {
  const d = new Date(/Z$/.test(iso) ? iso : iso + 'Z');
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(0).toISOString();
};

/** Fetch an account's blog from the chain. Soft-fails to []. */
export async function fetchBlog(tag, { limit = MAX_ITEMS, rpc = RPC_URL } = {}) {
  try {
    const res = await _fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'condenser_api.get_discussions_by_blog',
        params: [{ tag, limit: Math.min(100, limit) }],
      }),
    });
    const j = await res.json();
    const rows = (j && j.result) || [];
    return rows.filter((p) => p && p.author && p.permlink);
  } catch { return []; }
}

export async function fetchTag(tag, { limit = MAX_ITEMS, rpc = RPC_URL } = {}) {
  try {
    const res = await _fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'condenser_api.get_discussions_by_created',
        params: [{ tag, limit: Math.min(100, limit) }],
      }),
    });
    const j = await res.json();
    return ((j && j.result) || []).filter((p) => p && p.author && p.permlink);
  } catch { return []; }
}

const postUrl = (p) => `${BASE_URL}/${p.category || 'melek'}/@${p.author}/${p.permlink}`;

export function rss({ title, link, description, items }) {
  const entries = items.map((p) => {
    const img = firstImage(p.body);
    return `    <item>
      <title>${esc(p.title || p.permlink)}</title>
      <link>${esc(postUrl(p))}</link>
      <guid isPermaLink="true">${esc(postUrl(p))}</guid>
      <pubDate>${esc(rfc822(p.created))}</pubDate>
      <dc:creator>${esc(p.author)}</dc:creator>
      <description>${esc(summarize(p.body))}</description>${img ? `
      <enclosure url="${esc(img)}" type="image/jpeg" length="0"/>` : ''}
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(link)}</link>
    <atom:link href="${esc(link)}" rel="self" type="application/rss+xml"/>
    <description>${esc(description)}</description>
    <language>en</language>
    <generator>${esc(SITE_NAME)} feeds</generator>
    <lastBuildDate>${esc(items.length ? rfc822(items[0].created) : new Date(0).toUTCString())}</lastBuildDate>
${entries}
  </channel>
</rss>
`;
}

export function atom({ title, link, selfLink, items }) {
  const entries = items.map((p) => `  <entry>
    <title>${esc(p.title || p.permlink)}</title>
    <link href="${esc(postUrl(p))}"/>
    <id>${esc(postUrl(p))}</id>
    <updated>${esc(iso8601(p.created))}</updated>
    <author><name>${esc(p.author)}</name></author>
    <summary>${esc(summarize(p.body))}</summary>
  </entry>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(title)}</title>
  <link href="${esc(link)}"/>
  <link href="${esc(selfLink)}" rel="self"/>
  <id>${esc(link)}</id>
  <updated>${esc(items.length ? iso8601(items[0].created) : new Date(0).toISOString())}</updated>
${entries}
</feed>
`;
}

export function jsonFeed({ title, link, selfLink, items }) {
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title, home_page_url: link, feed_url: selfLink,
    items: items.map((p) => ({
      id: postUrl(p), url: postUrl(p), title: p.title || p.permlink,
      content_text: summarize(p.body, 1200),
      date_published: iso8601(p.created),
      authors: [{ name: p.author }],
      image: firstImage(p.body) || undefined,
    })),
  }, null, 1);
}

const send = (res, code, type, body) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' });
  res.end(body);
};

export async function handler(req, res) {
  let path;
  try { path = new URL(req.url, 'http://x').pathname; } catch { path = '/'; }
  // tolerate being mounted with or without the /rss prefix
  path = path.replace(/^\/rss(?=\/|$)/, '') || '/';

  if (path === '/health') return send(res, 200, 'application/json', '{"ok":true}');

  const acct = path.match(/^\/@([a-z0-9.-]{3,16})(\/(atom|json))?\/?$/i);
  if (acct) {
    const account = acct[1].toLowerCase();
    const kind = acct[3];
    const items = (await fetchBlog(account)).filter((p) => p.author === account).slice(0, MAX_ITEMS);
    const title = `${account} — ${SITE_NAME}`;
    const link = `${BASE_URL}/@${account}`;
    const selfLink = `${BASE_URL}/rss/@${account}${kind ? '/' + kind : ''}`;
    const description = `Posts by @${account} on ${SITE_NAME}.`;
    if (kind === 'atom') return send(res, 200, 'application/atom+xml; charset=utf-8', atom({ title, link, selfLink, items }));
    if (kind === 'json') return send(res, 200, 'application/feed+json; charset=utf-8', jsonFeed({ title, link, selfLink, items }));
    return send(res, 200, 'application/rss+xml; charset=utf-8', rss({ title, link, description, items }));
  }

  const tg = path.match(/^\/tag\/([a-z0-9-]{1,32})\/?$/i);
  if (tg) {
    const tag = tg[1].toLowerCase();
    const items = (await fetchTag(tag)).slice(0, MAX_ITEMS);
    return send(res, 200, 'application/rss+xml; charset=utf-8', rss({
      title: `#${tag} — ${SITE_NAME}`, link: `${BASE_URL}/created/${tag}`,
      description: `Posts tagged #${tag} on ${SITE_NAME}.`, items,
    }));
  }

  if (path === '/' || path === '') {
    return send(res, 200, 'text/html; charset=utf-8', `<!doctype html><meta charset=utf-8>
<title>Feeds — ${esc(SITE_NAME)}</title>
<h1>Feeds</h1>
<p>Every ${esc(SITE_NAME)} blog has a feed. Give any of these URLs to a directory, reader or aggregator.</p>
<ul>
<li><code>${esc(BASE_URL)}/rss/@&lt;account&gt;</code> — RSS 2.0</li>
<li><code>${esc(BASE_URL)}/rss/@&lt;account&gt;/atom</code> — Atom 1.0</li>
<li><code>${esc(BASE_URL)}/rss/@&lt;account&gt;/json</code> — JSON Feed 1.1</li>
<li><code>${esc(BASE_URL)}/rss/tag/&lt;tag&gt;</code> — RSS 2.0 for a tag</li>
</ul>`);
  }

  return send(res, 404, 'text/plain; charset=utf-8', 'not found\n');
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs') && process.argv[1].includes('site/feeds')) {
  createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('error\n'); } catch {} }); })
    .listen(PORT, HOST, () => console.log(`feeds on http://${HOST}:${PORT} base=${BASE_URL}`));
}
