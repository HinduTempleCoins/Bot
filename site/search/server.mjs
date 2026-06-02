// server.mjs — Search.SoapBox.Community. The public search front door (operator 2026-06-02). Toggles
// between WEB search (the scraper's multi-provider searchAll — DuckDuckGo + Marginalia + Wikipedia +
// chemistry/academic APIs, merged + research-weighted) and SITEWIDE search (our own ecosystem: the
// Library/wiki, the Directory, Learn, and the markets — MELEK/SOAP/PRANA join when live). The public
// front of "us being our own search provider" (#133). Read-only, server-rendered, no keys.
//
//   PORT=8092 BASE_URL=https://search.soapbox.community node site/search/server.mjs

import { createServer } from 'node:http';
import { searchAll, translate, detectLanguage } from '../../integrations/scraper.mjs';
import { DIRECTORY } from '../soapbox/directory.mjs';
import { LEARN } from '../soapbox/content.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { robotsTxt, submitToIndexNow, pingSitemap } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8092);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const DIRECTORY_URL = process.env.DIRECTORY_SITE || 'https://directory.soapbox.community';
const STOCKS_URL = process.env.STOCKS_SITE || 'https://stocks.soapbox.community';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  /* slim sticky bar — same pattern as Data, but NO category nav (that's Data-only) */
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:760px;margin:0 auto;padding:22px}
  /* centered hero (Google-like) */
  .hero{text-align:center;padding:6vh 0 18px}
  .hero.compact{padding:18px 0 10px}
  .title{font-size:46px;font-weight:800;letter-spacing:-1px;margin:0}
  .title .s{color:var(--blue)}
  .hero.compact .title{font-size:26px}
  .desc{color:var(--mut);font-size:16px;margin:8px 0 18px}
  .hero.compact .desc{display:none}
  /* ribbon of our sites — under the title, above the bar */
  .ribbon{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:0 0 12px}
  .ribbon a{font-size:13px;font-weight:600;color:var(--mut);border:1px solid var(--line2);border-radius:16px;padding:5px 13px}
  .ribbon a:hover{color:var(--fg);text-decoration:none;border-color:var(--blue)}
  /* toggle — above the bar, under the title */
  .toggle{display:inline-flex;border:1px solid var(--line2);border-radius:20px;overflow:hidden;margin:0 0 14px}
  .toggle a{padding:7px 18px;color:var(--mut);font-weight:600;font-size:14px} .toggle a.on{background:var(--blue);color:#06101f}
  /* the search bar — big, centered, readable on desktop + mobile */
  form{margin:0 auto;max-width:600px}
  input.q{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:26px;color:var(--fg);padding:15px 22px;font-size:17px;outline:none}
  input.q:focus{border-color:var(--blue)} input.q::placeholder{color:var(--mut)}
  .btnrow{text-align:center;margin:16px 0 0}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 26px;font-size:15px}
  button:hover{border-color:var(--blue)}
  /* results */
  .results{max-width:680px;margin:22px auto 0;text-align:left}
  .res{padding:12px 0;border-bottom:1px solid var(--line)}
  .res a.t{font-size:17px;font-weight:600} .res .u{color:var(--gold);font-size:12px;word-break:break-all}
  .res .s{color:var(--mut);font-size:13px;margin-top:3px} .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .muted{color:var(--mut)}
  /* translation hub */
  .tform{max-width:680px}
  .tarea{width:100%;min-height:140px;background:#0b0f14;border:1px solid var(--line2);border-radius:12px;color:var(--fg);padding:14px 16px;font:15px/1.6 system-ui,sans-serif;outline:none;resize:vertical}
  .tarea:focus{border-color:var(--blue)} .tarea::placeholder{color:var(--mut)}
  .trow{display:flex;flex-wrap:wrap;align-items:end;gap:14px;margin-top:14px}
  .trow label{color:var(--mut);font-size:13px;display:flex;flex-direction:column;gap:5px}
  .trow select{background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 11px;font-size:14px}
  .trow button{margin-left:auto}
  .tresult{max-width:680px;margin:22px auto 0;background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:16px 18px}
  .tmeta{color:var(--mut);font-size:13px;margin:0 0 8px} .tmeta:last-child{margin:10px 0 0}
  .tout{font-size:17px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px;margin-top:24px}
  @media(max-width:560px){.title{font-size:34px}.input.q{font-size:16px}}
</style>`;

// The Search WebSite node carries a SearchAction: this subdomain HAS a real GET HTML results URL
// (/?q=…), so the {search_term_string} token belongs inside the urlTemplate (not leaked as text).
const SITE_GRAPH = { url: BASE_URL, name: 'SoapBox Search', searchUrlTemplate: `${BASE_URL}/?q={search_term_string}` };

const page = (title, body, opts = {}) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
${headTags({
  title,
  description: opts.description || 'Search for anything you want — across our websites, or the entire web.',
  canonical: opts.canonical || `${BASE_URL}/`,
  siteName: 'SoapBox Search',
  robots: opts.robots || 'index,follow,max-image-preview:large',
  site: SITE_GRAPH,
})}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">◈ SoapBox <span>search</span></a>
  <div class=topbar-r><a href="/translate" title="Translate text between languages — keyless, multilingual">Translate</a><a href="${DATA}" title="Markets, macro, commodities, forex">Data</a><a href="${DIRECTORY_URL}" title="Resource directory + site insights">Directory</a><a href="${WIKI}" title="Library of Ashurbanipal">Wiki</a><a href="${STOCKS_URL}" title="Stocks">Stocks</a></div></header>
<main class=wrap>${body}</main>
<footer>SoapBox Search — across our websites, or the entire web (independent + scholarly sources, research-weighted). No tracking.</footer></body></html>`;

// the Google-like hero: title, description, ribbon, toggle (above bar), bar, centered button (below bar).
const searchHero = (q, mode) => `
  <div class="hero${q ? ' compact' : ''}">
    <a href="/"><h1 class=title>SoapBox <span class=s>Search</span></h1></a>
    <p class=desc>Search for anything you want — across our websites, or the entire web.</p>
    <div class=toggle>
      <a href="/?q=${encodeURIComponent(q)}&mode=web" class="${mode === 'web' ? 'on' : ''}">🌐 Web</a>
      <a href="/?q=${encodeURIComponent(q)}&mode=site" class="${mode === 'site' ? 'on' : ''}">◈ Our Sites</a>
    </div>
    <form method=get action="/">
      <input class=q name=q value="${esc(q)}" placeholder="Search the entire web, or our sites…" autofocus autocomplete=off>
      <input type=hidden name=mode value="${esc(mode)}">
      <div class=btnrow><button>Search</button></div>
    </form>
    ${q ? '' : '<p class=desc style="margin-top:14px">Going global? <a href="/translate">Translate text between languages →</a></p>'}
  </div>`;

// Common languages for the Translation Hub. ISO-639-1 codes.
const LANGS = [
  ['auto', 'Detect language'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'],
  ['de', 'German'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ar', 'Arabic'], ['ru', 'Russian'],
  ['pt', 'Portuguese'], ['hi', 'Hindi'], ['it', 'Italian'], ['ko', 'Korean'], ['nl', 'Dutch'],
  ['tr', 'Turkish'], ['pl', 'Polish'], ['sw', 'Swahili'], ['id', 'Indonesian'], ['vi', 'Vietnamese'],
  ['fa', 'Persian'], ['he', 'Hebrew'], ['th', 'Thai'], ['uk', 'Ukrainian'], ['el', 'Greek'],
];
const LANG_NAME = Object.fromEntries(LANGS.map(([c, n]) => [c, n]));

const langOptions = (sel, codes) => codes
  .map(([c, n]) => `<option value="${c}"${c === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');

// The Translation Hub page. `r` is an optional translate() result to render.
function translatePage(text, from, to, r) {
  const detected = r && r.from && r.from !== 'auto' ? r.from : null;
  const detLabel = detected ? (LANG_NAME[detected] || detected) : null;
  return `
  <div class="hero compact">
    <a href="/translate"><h1 class=title>SoapBox <span class=s>Translate</span></h1></a>
    <p class=desc>Translate text between languages — keyless, multilingual, best-effort.</p>
  </div>
  <form method=post action="/translate" class=tform>
    <textarea class=tarea name=text placeholder="Type or paste text to translate…" autofocus>${esc(text)}</textarea>
    <div class=trow>
      <label>From <select name=from>${langOptions(from || 'auto', LANGS)}</select></label>
      <label>To <select name=to>${langOptions(to || 'en', LANGS.filter(([c]) => c !== 'auto'))}</select></label>
      <button>Translate</button>
    </div>
  </form>
  ${r ? `<div class=tresult>
    <div class=tmeta>${detLabel ? `Detected source: <b>${esc(detLabel)}</b> → ` : `${esc(LANG_NAME[from] || from || 'auto')} → `}<b>${esc(LANG_NAME[to] || to)}</b>${r.engine && r.engine !== 'fallback' && r.engine !== 'none' && r.engine !== 'noop' ? `<span class=badge>${esc(r.engine)}</span>` : ''}</div>
    <div class=tout>${esc(r.translated)}</div>
    <div class=tmeta><a href="/api/translate?text=${encodeURIComponent(text)}&to=${encodeURIComponent(to)}&from=${encodeURIComponent(from || 'auto')}">JSON</a> · other sites &amp; Hathor can call <code>/api/translate</code></div>
  </div>` : ''}`;
}

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

// Read a urlencoded POST body (bounded), returning a URLSearchParams.
function readForm(req) {
  return new Promise((resolve) => {
    let data = '', tooBig = false;
    req.on('data', (c) => { data += c; if (data.length > 1e6) { tooBig = true; req.destroy(); } });
    req.on('end', () => resolve(new URLSearchParams(tooBig ? '' : data)));
    req.on('error', () => resolve(new URLSearchParams('')));
  });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (url.pathname === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const urls = ['/', '/translate'];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        urls.map((u) => `  <url><loc>${BASE_URL}${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${u === '/' ? '1.0' : '0.7'}</priority></url>`).join('\n') + `\n</urlset>`;
      res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(xml);
    }

    // JSON translate endpoint — for other sites / Hathor. /api/translate?text=&to=&from=
    if (url.pathname === '/api/translate') {
      const text = url.searchParams.get('text') || '';
      const to = (url.searchParams.get('to') || 'en').trim() || 'en';
      const from = (url.searchParams.get('from') || 'auto').trim() || 'auto';
      let out = { from, to, translated: text };
      try { const r = await translate(text, { from, to }); out = { from: r.from || from, to: r.to || to, translated: r.translated }; } catch {}
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
      return res.end(JSON.stringify(out));
    }

    // Translation Hub page — GET (with optional ?text=&to=&from=) or POST form.
    if (url.pathname === '/translate') {
      let text = url.searchParams.get('text') || '';
      let to = (url.searchParams.get('to') || 'en').trim() || 'en';
      let from = (url.searchParams.get('from') || 'auto').trim() || 'auto';
      if (req.method === 'POST') {
        const f = await readForm(req);
        text = f.get('text') || ''; to = (f.get('to') || 'en').trim() || 'en'; from = (f.get('from') || 'auto').trim() || 'auto';
      }
      let r = null;
      if (text.trim()) { try { r = await translate(text, { from, to }); } catch { r = { translated: text, from, to, engine: 'fallback' }; } }
      const body = translatePage(text, from, to, r);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page('SoapBox Translate', body, {
        canonical: `${BASE_URL}/translate`,
        description: 'Translate text between languages — keyless, multilingual, best-effort. Free translation tool from SoapBox.',
      }));
    }

    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    const q = (url.searchParams.get('q') || '').trim();
    const mode = url.searchParams.get('mode') === 'site' ? 'site' : 'web';
    let body = searchHero(q, mode);
    if (q) body += `<div class=results><p class=muted>${mode === 'web' ? '🌐 Web' : '◈ Our sites'} results for "${esc(q)}"</p>${mode === 'web' ? await webSearch(q) : await siteSearch(q)}</div>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
    res.end(page(q ? `${q} — SoapBox Search` : 'SoapBox Search', body, {
      // a results page (?q=…) is a thin, query-specific view: keep it out of the index, point the
      // canonical at the clean root so crawlers consolidate on the home/search entry.
      canonical: q ? `${BASE_URL}/` : `${BASE_URL}/`,
      robots: q ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    }));
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, () => {
  console.log(`SoapBox Search on ${BASE_URL} (bound ${HOST}:${PORT})`);
  // welcome crawlers on boot: IndexNow + sitemap ping (best-effort, https only). Skippable via env.
  if (process.env.SOAPBOX_NO_CRAWL_PING !== '1' && BASE_URL.startsWith('https')) {
    submitToIndexNow(BASE_URL, ['/', '/translate']).then((r) => console.log('IndexNow:', JSON.stringify(r))).catch(() => {});
    pingSitemap(BASE_URL).then((r) => console.log('Bing sitemap ping:', JSON.stringify(r))).catch(() => {});
  }
});
