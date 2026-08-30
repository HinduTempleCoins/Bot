// server.mjs — the MELEK Knowledge Base. A hand-authored, SteemCenter/Hive-style newcomer + developer
// wiki ABOUT MELEK. Server-rendered for SEO, read-only, keyless, fully offline (content lives in
// pages.mjs — no network at runtime). House style: ESM, esc() all interpolation, handler(req,res)
// exported, CLI guarded by process.argv[1], PORT/BASE_URL env.
//
//   PORT=8155 BASE_URL=https://kb.melek.salon node site/knowledgebase/server.mjs
//
// Routes:
//   /                index — sectioned directory of every KB page + search box
//   /<slug>          a single explainer page (what-is-melek, accounts-and-keys, …)
//   /search?q=       keyword search across page titles + prose
//   /api/search?q=   JSON search (for a client-side box)
//   /sitemap.xml /robots.txt /health

import { createServer } from 'node:http';
import { PAGES, SECTIONS, bySlug } from './pages.mjs';

const PORT = +(process.env.PORT || 8155);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Related ecosystem surfaces, overridable by env so hostnames aren't hard-coded.
const WITNESS_SCHOOL = process.env.WITNESS_SCHOOL_URL || 'https://witness.melek.salon';
const CONDENSER = process.env.CONDENSER_URL || 'https://melek.salon';
const LIBRARY = process.env.LIBRARY_URL || 'https://wiki.soapbox.community';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Expand internal-link tokens {{slug}} / {{slug|label}} into <a href="/slug">label</a>. Unknown slugs
// render as plain label text (never a broken link). Authored prose is trusted static HTML; only the
// label — which is authored too, but cheap to guard — is passed through esc().
export function links(html) {
  return String(html).replace(/\{\{([a-z0-9-]+)(?:\|([^}]+))?\}\}/gi, (_, slug, label) => {
    const page = bySlug(slug);
    const text = esc(label || (page ? page.title : slug));
    return page ? `<a href="/${esc(page.slug)}">${text}</a>` : text;
  });
}

// Render one authored content block to HTML.
function block(b) {
  switch (b.type) {
    case 'h2': return `<h2 id="${esc(b.t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}">${links(b.t)}</h2>`;
    case 'p': return `<p>${links(b.t)}</p>`;
    case 'ul': return `<ul>${b.items.map((i) => `<li>${links(i)}</li>`).join('')}</ul>`;
    case 'ol': return `<ol>${b.items.map((i) => `<li>${links(i)}</li>`).join('')}</ol>`;
    case 'note': return `<div class=note>${links(b.t)}</div>`;
    case 'dl': return `<dl>${b.items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${links(d)}</dd>`).join('')}</dl>`;
    case 'html': return String(b.t);
    default: return '';
  }
}

const STYLE = `<style>
  :root{--bg:#f5f6f8;--panel:#fff;--line:#e6e9ee;--line2:#dbe0e6;--fg:#1c2126;--mut:#5c6670;--link:#117a37;--gold:#e5a21b;--goldink:#a8730c}
  *{box-sizing:border-box} body{font:16px/1.7 Georgia,'Times New Roman',serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
  .alpha{position:fixed;top:0;left:0;background:var(--gold);color:#1c2126;font:700 11px/1 system-ui,sans-serif;padding:4px 8px;border-radius:0 0 6px 0;z-index:9;letter-spacing:.04em}
  header.top{font-family:system-ui,sans-serif;background:var(--panel);border-bottom:1px solid var(--line2);padding:12px 22px 12px 60px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg);display:flex;align-items:center;gap:8px} .brand span{color:var(--goldink);font-weight:400;font-size:13px}
  .brand .sun{width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 50% 50%,#e5a21b 0 32%,#c0392b 34% 50%,#117a37 52% 100%);flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.06)}
  nav{display:flex;gap:16px;font-family:system-ui,sans-serif;margin-left:auto;flex-wrap:wrap} nav a{color:var(--mut);font-weight:600;font-size:14px} nav a:hover{color:var(--link);text-decoration:none}
  .wrap{max-width:840px;margin:0 auto;padding:26px 22px}
  h1{font-size:31px;margin:0 0 8px} h2{font-size:22px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:5px} h3{font-size:18px;margin:18px 0 6px}
  p{margin:11px 0} ul,ol{margin:11px 0 11px 22px} li{margin:5px 0}
  dl{margin:12px 0} dt{font-weight:700;font-family:system-ui,sans-serif;margin-top:12px} dd{margin:2px 0 0;color:var(--fg)}
  code{background:#eef1f4;padding:1px 5px;border-radius:4px;font:13px/1.5 ui-monospace,Menlo,monospace}
  .muted{color:var(--mut)} .lede{font-size:18px;color:var(--mut);margin:0 0 18px}
  input.search{font-family:system-ui;background:#fff;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 13px;width:100%;max-width:460px;font-size:14px}
  input.search:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(229,162,27,.15)}
  .note{font-family:system-ui,sans-serif;background:#fbf6e9;border:1px solid #e5cf9b;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:14px;line-height:1.6}
  .sec{margin:26px 0} .sec h2{margin-bottom:4px} .sec>.muted{font-size:14px;font-family:system-ui,sans-serif;margin:0 0 12px}
  .grid{font-family:system-ui,sans-serif;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
  .grid a{display:block;padding:12px 15px;background:#fff;border:1px solid var(--line2);border-radius:8px}
  .grid a:hover{border-color:var(--gold);text-decoration:none} .grid a b{display:block;color:var(--link);font-size:15px} .grid a span{font-size:13px;color:var(--mut);font-family:system-ui,sans-serif}
  .card{font-family:system-ui,sans-serif;background:#fbfcfd;border:1px solid var(--line2);border-radius:8px;padding:12px 16px;margin:12px 0}
  .related{font-family:system-ui,sans-serif;margin-top:30px;padding-top:16px;border-top:1px solid var(--line);font-size:14px}
  footer{font-family:system-ui,sans-serif;color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding:26px 22px;text-align:center;margin-top:34px}
</style>`;

const NAV = [['/', 'Home'], ['/what-is-melek', 'What is MELEK'], ['/getting-started', 'Getting Started'], ['/glossary', 'Glossary'], [WITNESS_SCHOOL, 'Witness School'], [CONDENSER, 'MELEK']];

function jsonLd(obj) {
  try { return `<script type="application/ld+json">${JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1')}</script>`; }
  catch { return ''; }
}

function layout({ title, description = '', canonical = '', ld = null, body = '' }) {
  const nav = NAV.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} — MELEK Knowledge Base</title>
${description ? `<meta name=description content="${esc(description)}">` : ''}
${canonical ? `<link rel=canonical href="${esc(canonical)}">` : ''}
<meta property="og:title" content="${esc(title)} — MELEK Knowledge Base">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
<meta property="og:type" content="article">
${ld ? jsonLd(ld) : ''}
${STYLE}</head><body>
<a class=alpha href="/">Alpha</a>
<header class=top><a class=brand href="/"><span class=sun></span>MELEK <span>Knowledge Base</span></a><nav>${nav}</nav></header>
<div class=wrap>${body}</div>
<footer>MELEK Knowledge Base — a plain-language wiki about the MELEK social blockchain and the SoapBox ecosystem.<br>
Read-only reference. Not financial, legal, or medical advice. · <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a> · <a href="${esc(WITNESS_SCHOOL)}">Witness School</a></footer>
</body></html>`;
}

function indexPage() {
  const searchBox = `<input class=search placeholder="Search the Knowledge Base…" autocomplete=off onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">`;
  const sections = SECTIONS.map((s) => {
    const pages = PAGES.filter((pg) => pg.section === s.id);
    if (!pages.length) return '';
    return `<div class=sec><h2>${esc(s.title)}</h2><p class=muted>${esc(s.blurb)}</p>
      <div class=grid>${pages.map((pg) => `<a href="/${esc(pg.slug)}"><b>${esc(pg.title)}</b><span>${esc(pg.description.length > 110 ? pg.description.slice(0, 110).replace(/\s+\S*$/, '') + '…' : pg.description)}</span></a>`).join('')}</div></div>`;
  }).join('');
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'MELEK Knowledge Base', url: `${BASE_URL}/`,
    description: 'A newcomer and developer wiki about the MELEK social blockchain: accounts, keys, earning, witnesses, and the SoapBox app ecosystem.',
    hasPart: PAGES.map((pg) => ({ '@type': 'Article', name: pg.title, url: `${BASE_URL}/${pg.slug}` })),
  };
  const body = `<h1>MELEK Knowledge Base</h1>
    <p class=lede>Everything a newcomer or a developer needs to understand MELEK — the fee-less, downvote-free social blockchain — and the ecosystem around it. Modeled on the community wikis of the Graphene family (SteemCenter, the Hive docs), written fresh for MELEK.</p>
    ${searchBox}
    ${sections}`;
  return layout({ title: 'Knowledge Base', description: 'A newcomer and developer wiki about the MELEK social blockchain and the SoapBox ecosystem.', canonical: `${BASE_URL}/`, ld, body });
}

function pagePage(slug) {
  const pg = bySlug(slug);
  if (!pg) return { code: 404, html: layout({ title: 'Not found', body: `<h1>Not found</h1><p class=muted>No page "${esc(slug)}". <a href="/">← Knowledge Base</a></p>` }) };
  const url = `${BASE_URL}/${pg.slug}`;
  const html = pg.body.map(block).join('\n');
  // "Related" cross-links: other pages in the same section.
  const related = PAGES.filter((x) => x.section === pg.section && x.slug !== pg.slug);
  const relatedHtml = related.length ? `<div class=related><b>Related:</b> ${related.map((x) => `<a href="/${esc(x.slug)}">${esc(x.title)}</a>`).join(' · ')}</div>` : '';
  const ld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: pg.title, description: pg.description, url, mainEntityOfPage: url,
    isPartOf: { '@type': 'CreativeWorkSeries', name: 'MELEK Knowledge Base' },
    publisher: { '@type': 'Organization', name: 'MELEK' },
  };
  const body = `<p class=muted><a href="/">← Knowledge Base</a></p><h1>${esc(pg.title)}</h1>${html}${relatedHtml}`;
  return { code: 200, html: layout({ title: pg.title, description: pg.description, canonical: url, ld, body }) };
}

// Flatten a page's authored blocks to plain searchable text.
function pageText(pg) {
  return pg.body.map((b) => {
    if (b.type === 'dl') return b.items.map(([t, d]) => `${t} ${d}`).join(' ');
    if (b.items) return b.items.join(' ');
    return b.t || '';
  }).join(' ').replace(/\{\{[a-z0-9-]+\|?([^}]*)\}\}/gi, '$1').replace(/<[^>]+>/g, ' ');
}

function searchResults(q) {
  q = (q || '').trim();
  if (!q) return [];
  const ql = q.toLowerCase();
  const rx = new RegExp(ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  return PAGES.map((pg) => {
    const titleHit = pg.title.toLowerCase().includes(ql);
    const n = (pageText(pg).toLowerCase().match(rx) || []).length;
    return { pg, score: (titleHit ? 100 : 0) + n };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}

function searchPage(q) {
  q = (q || '').trim();
  const hits = searchResults(q);
  const body = `<h1>Search</h1>
    <input class=search value="${esc(q)}" placeholder="Search the Knowledge Base…" onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">
    ${q ? `<p class=muted style="margin-top:14px">${hits.length} result(s) for "${esc(q)}"</p>
      ${hits.map(({ pg }) => `<div class=card><a href="/${esc(pg.slug)}" style="font-size:16px;font-weight:700">${esc(pg.title)}</a><div class=muted style="font-size:14px;font-family:system-ui,sans-serif">${esc(pg.description)}</div></div>`).join('')}`
      : '<p class=muted style="margin-top:14px">Type a term and press Enter.</p>'}`;
  return layout({ title: q ? `Search: ${q}` : 'Search', body });
}

function sitemap() {
  const locs = ['/', '/search', ...PAGES.map((pg) => `/${pg.slug}`)];
  const node = (u) => `  <url><loc>${BASE_URL}${encodeURI(u)}</loc><changefreq>weekly</changefreq></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map(node).join('\n')}\n</urlset>`;
}

const ROBOTS = `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`;

export const handler = (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    const send = (html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }); res.end(html); };
    if (p === '/' || p === '/index.html') return send(indexPage());
    if (p === '/search') return send(searchPage(url.searchParams.get('q')));
    if (p === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      const results = searchResults(q).slice(0, 8).map(({ pg }) => ({ slug: pg.slug, title: pg.title, url: `${BASE_URL}/${pg.slug}`, description: pg.description }));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ q, count: results.length, results }));
    }
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' }); return res.end(sitemap()); }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(ROBOTS); }
    if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    const r = pagePage(decodeURIComponent(p.replace(/^\/+/, '').replace(/\/+$/, '')));
    return send(r.html, r.code);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
};

// CLI guard: only bind a socket when run directly, not when imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK Knowledge Base on ${BASE_URL} (bound ${HOST}:${PORT}, ${PAGES.length} pages)`);
  });
}
