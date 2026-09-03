// server.mjs — The SoapBox Library: the public-domain-first books and documents surface.
//
// This is the served front end for integrations/soapbox/books-open.mjs, which was built as the
// "Scribd side" of the Resource Center and until now was mounted nowhere. The reader does the work;
// this file is the page.
//
//   PORT=8195 BASE_URL=https://library.soapbox.community node site/library/server.mjs
//
// ── The posture, which is the whole point ────────────────────────────────────────────────────────
//   The collection is outsourced to the sources, and what we do with a work depends entirely on its
//   rights, in three tiers the reader labels on every row:
//
//     host       Project Gutenberg public-domain texts. Ours to serve — read it here, take the
//                epub or the plain text.
//     window     Internet Archive texts. IA hosts the book and its reader; we frame IA's own
//                embed and store nothing.
//     aggregate  Open Library metadata. We show the record and link out. We hold no file.
//
//   We never rehost anyone's copyrighted file. Gutendex records are dropped unless the source
//   marks copyright === false, so the only thing we serve directly is verified public domain.
//
// handler(req,res) is exported for tests; the port is bound only when run directly. No keys, no
// database, no writes — every request is a live read through the injectable fetch in books-open.

import { createServer } from 'node:http';
import * as books from '../../integrations/soapbox/books-open.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8195);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'The SoapBox Library';
const MAX_RESULTS = 24;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// A few starting points so the page is never an empty search box.
const SHELVES = Object.freeze([
  'Mark Twain', 'Herodotus', 'Plutarch', 'Marcus Aurelius', 'Mary Shelley',
  'Frederick Douglass', 'Ida B. Wells', 'Nikola Tesla', 'herbal medicine', 'mythology',
]);

const STYLE = `<style>
:root{--ink:#181818;--muted:#5f5f5f;--rule:#ded9cf;--bg:#fbfaf7;--accent:#6b1d1d}
*{box-sizing:border-box}
body{font-family:"Iowan Old Style",Palatino,Georgia,serif;background:var(--bg);color:var(--ink);
 max-width:52rem;margin:0 auto;padding:2rem 1.1rem 5rem;line-height:1.6}
h1{font-size:1.9rem;margin:0 0 .3rem}
h2{font-size:1.15rem;margin:2rem 0 .6rem;padding-bottom:.3rem;border-bottom:1px solid var(--rule)}
.tag{color:var(--muted);margin:0 0 1.4rem}
form{display:flex;gap:.5rem;margin:1.2rem 0}
input[type=search]{flex:1;padding:.6rem .7rem;border:1px solid var(--rule);border-radius:4px;font:inherit;background:#fff}
button{padding:.6rem 1.1rem;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:4px;font:inherit;cursor:pointer}
.shelves a{display:inline-block;margin:0 .4rem .4rem 0;padding:.2rem .55rem;border:1px solid var(--rule);border-radius:99px;font-size:.85rem;text-decoration:none;color:var(--accent);background:#fff}
.books-list{list-style:none;padding:0}
.books-list li{padding:.7rem 0;border-bottom:1px solid var(--rule)}
.posture{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;padding:.1rem .4rem;border-radius:3px;border:1px solid var(--rule)}
.posture-host{background:#e7f4ea;border-color:#b6dcc0}
.posture-window{background:#eef1f8;border-color:#c3cde6}
.posture-aggregate{background:#f6f1e7;border-color:#e0d3b8}
.src,.lic{color:var(--muted);font-size:.85rem}
.dl a{font-size:.85rem}
a{color:#1a4b8c}
.data-note,.legend{color:var(--muted);font-size:.87rem}
.legend dt{font-weight:600;margin-top:.5rem}
.legend dd{margin:0 0 .2rem}
</style>`;

function page({ query = '', body = '' }) {
  const q = esc(query);
  const shelves = SHELVES.map((s) => `<a href="/?q=${encodeURIComponent(s)}">${esc(s)}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SITE_NAME)}${query ? ` — ${q}` : ''}</title>
<meta name="description" content="A public-domain-first library of books and documents: Project Gutenberg texts served directly, Internet Archive in its own reader, Open Library for everything else.">
${STYLE}</head><body>
<h1>${esc(SITE_NAME)}</h1>
<p class="tag">Public domain first. Nothing here is anybody else's file rehosted.</p>
<form action="/" method="get" role="search">
  <input type="search" name="q" value="${q}" placeholder="Search books and documents" aria-label="Search books and documents">
  <button type="submit">Search</button>
</form>
<p class="shelves">${shelves}</p>
${body}
<h2>What the labels mean</h2>
<dl class="legend">
  <dt>host</dt><dd>Public domain, from Project Gutenberg. Read it here, or take the epub or plain text.</dd>
  <dt>window</dt><dd>Internet Archive holds the book and its reader. We point you into their reader; we store nothing.</dd>
  <dt>aggregate</dt><dd>Open Library metadata only. We show the record and link out; rights vary and are theirs to state.</dd>
</dl>
</body></html>`;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, [{ path: '/', lastmod: today, changefreq: 'daily', priority: '1.0' }]));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME,
        baseUrl: BASE_URL,
        summary: 'Public-domain-first books and documents. Project Gutenberg texts are served directly; '
          + 'Internet Archive texts open in IA\'s own reader; Open Library records link out. No copyrighted file is rehosted.',
        links: [{ label: 'Library', path: '/' }],
      }));
    }

    const query = String(url.searchParams.get('q') || '').slice(0, 200);

    if (path === '/api/search') {
      const found = query ? await books.search({ query, limit: MAX_RESULTS }) : [];
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ query, count: found.length, note: books.dataNote(), books: found }, null, 2));
    }

    if (path === '/') {
      let body;
      if (query) {
        // search() soft-fails to [] on any source failure, so a dead upstream is an empty shelf,
        // never a broken page.
        const found = await books.search({ query, limit: MAX_RESULTS });
        body = books.renderList(found);
      } else {
        body = `<p class="data-note">${esc(books.dataNote())}</p>`;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page({ query, body }));
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

export { SHELVES, MAX_RESULTS };

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/library\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
