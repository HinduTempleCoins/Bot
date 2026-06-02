// server.mjs — Search.SoapBox.Community. The public search front door (operator 2026-06-02). Toggles
// between WEB search (the scraper's multi-provider searchAll — DuckDuckGo + Marginalia + Wikipedia +
// chemistry/academic APIs, merged + research-weighted) and SITEWIDE search (our own ecosystem: the
// Library/wiki, the Directory, Learn, and the markets — MELEK/SOAP/PRANA join when live). The public
// front of "us being our own search provider" (#133). Read-only, server-rendered, no keys.
//
//   PORT=8092 BASE_URL=https://search.soapbox.community node site/search/server.mjs

import { createServer } from 'node:http';
import { searchAll } from '../../integrations/scraper.mjs';
import { DIRECTORY } from '../soapbox/directory.mjs';
import { LEARN } from '../soapbox/content.mjs';

const PORT = +(process.env.PORT || 8092);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header{padding:14px 22px;background:var(--panel);border-bottom:1px solid var(--line2);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  nav{display:flex;gap:14px} nav a{color:var(--mut);font-weight:600;font-size:14px}
  .wrap{max-width:820px;margin:0 auto;padding:26px 22px}
  form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 8px}
  input.q{flex:1;min-width:240px;background:#0b0f14;border:1px solid var(--line2);border-radius:10px;color:var(--fg);padding:12px 16px;font-size:16px}
  button{cursor:pointer;background:var(--blue);border:none;border-radius:10px;color:#06101f;font-weight:700;padding:12px 18px;font-size:15px}
  .toggle{display:flex;gap:0;margin:0 0 16px;border:1px solid var(--line2);border-radius:10px;overflow:hidden;width:fit-content}
  .toggle a{padding:8px 16px;color:var(--mut);font-weight:600;font-size:14px} .toggle a.on{background:var(--blue);color:#06101f}
  .res{padding:12px 0;border-bottom:1px solid var(--line)}
  .res a.t{font-size:17px;font-weight:600} .res .u{color:var(--gold);font-size:12px;word-break:break-all}
  .res .s{color:var(--mut);font-size:13px;margin-top:3px} .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .muted{color:var(--mut)} h1{font-size:24px;margin:0 0 4px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px;border-top:1px solid var(--line);margin-top:24px}
</style>`;

const page = (title, body) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="Search the web and the SoapBox ecosystem — markets, the Library of Ashurbanipal, the directory, and the MELEK chains.">
<meta name=robots content="index,follow">${STYLE}</head><body>
<header><a class=brand href="/">◈ SoapBox <span>search</span></a>
<nav><a href="${DATA}">Markets</a><a href="${WIKI}">Library</a><a href="${DATA}/directory">Directory</a></nav></header>
<main class=wrap>${body}</main>
<footer>SoapBox Search — web search (independent + scholarly sources, research-weighted) and sitewide search across the ecosystem. No tracking.</footer></body></html>`;

const searchForm = (q, mode) => `
  <form method=get action="/">
    <input class=q name=q value="${esc(q)}" placeholder="Search the web or the SoapBox ecosystem…" autofocus>
    <input type=hidden name=mode value="${esc(mode)}"><button>Search</button>
  </form>
  <div class=toggle>
    <a href="/?q=${encodeURIComponent(q)}&mode=web" class="${mode === 'web' ? 'on' : ''}">🌐 Web</a>
    <a href="/?q=${encodeURIComponent(q)}&mode=site" class="${mode === 'site' ? 'on' : ''}">◈ Sitewide</a>
  </div>`;

const resultRow = (r) => `<div class=res>
  <a class=t href="${esc(r.url)}">${esc(r.title)}</a>${r.tag ? `<span class=badge>${esc(r.tag)}</span>` : (r.providers ? `<span class=badge>${esc(r.providers.join('+'))}</span>` : '')}
  <div class=u>${esc(r.url)}</div>${r.snippet ? `<div class=s>${esc(r.snippet)}</div>` : ''}</div>`;

async function webSearch(q) {
  const r = await searchAll(q, { limit: 20 }).catch(() => []);
  return r.map(resultRow).join('') || '<p class=muted>No web results.</p>';
}

async function siteSearch(q) {
  const ql = q.toLowerCase();
  const out = [];
  // Library / wiki
  try {
    const r = await fetch(`${WIKI}/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    for (const a of (d.results || []).slice(0, 6)) out.push({ title: a.title, url: a.url, snippet: a.snippet, tag: 'Library' });
  } catch {}
  // markets / coins (filter the live api/coins)
  try {
    const r = await fetch(`${DATA}/api/coins`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    for (const c of [...(d.ours || []), ...(d.market || [])].filter((c) => `${c.name} ${c.symbol}`.toLowerCase().includes(ql)).slice(0, 6))
      out.push({ title: `${c.name} (${c.symbol})`, url: `${DATA}/coins/${c.id}`, snippet: `Price ${c.price_usd ? '$' + c.price_usd : '—'}`, tag: 'Markets' });
  } catch {}
  // directory
  for (const g of DIRECTORY) for (const it of g.items)
    if (`${it.name} ${it.blurb}`.toLowerCase().includes(ql)) out.push({ title: it.name, url: it.url, snippet: `${g.cat} — ${it.blurb}`, tag: 'Directory' });
  // learn
  for (const [slug, a] of Object.entries(LEARN))
    if (`${a.title} ${a.summary}`.toLowerCase().includes(ql)) out.push({ title: a.title, url: `${DATA}/learn/${slug}`, snippet: a.summary, tag: 'Learn' });
  return out.slice(0, 30).map(resultRow).join('') || '<p class=muted>Nothing in the ecosystem matches yet. Try Web search, or browse <a href="' + DATA + '">Markets</a> / <a href="' + WIKI + '">the Library</a>.</p>';
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\n`); }
    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    const q = (url.searchParams.get('q') || '').trim();
    const mode = url.searchParams.get('mode') === 'site' ? 'site' : 'web';
    let body = `<h1>Search</h1><p class=muted>The web (independent + scholarly sources, research over opinion) or the SoapBox ecosystem.</p>${searchForm(q, mode)}`;
    if (q) body += `<p class=muted>${mode === 'web' ? '🌐 Web' : '◈ Sitewide'} results for "${esc(q)}"</p>` + (mode === 'web' ? await webSearch(q) : await siteSearch(q));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
    res.end(page(q ? `${q} — SoapBox Search` : 'SoapBox Search', body));
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, () => console.log(`SoapBox Search on ${BASE_URL} (bound ${HOST}:${PORT})`));
