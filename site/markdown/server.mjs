// server.mjs — Markdown.SoapBox.Community. A free live markdown editor: write markdown on the left, see a
// clean rendered preview on the right, and export your document as .md or .html — all client-side. Your
// draft autosaves to your browser's localStorage so it's still there when you come back. Rendering uses a
// LOCALLY-VENDORED marked.js (MIT) — no external network at runtime, no CDN, no tracker, no account.
//
//   PORT=8220 BASE_URL=https://markdown.soapbox.community node site/markdown/server.mjs
//   → serves the editor at  /
//
// ── SECURITY: the preview is SANITIZED ─────────────────────────────────────────────────────────────
//   marked (like most markdown parsers) passes RAW HTML straight through — an input of `<script>` or
//   `<img onerror=…>` would otherwise execute in the live preview. So every rendered document goes through
//   sanitizeHtml() (an allow-list sanitizer, exported + unit-tested) BEFORE it is inserted: <script>/<style>
//   blocks are dropped, unknown/embedding tags are removed, every on*= event handler and inline style is
//   stripped, and any javascript:/data:/vbscript: href/src is neutralised. The SAME function runs in the
//   browser (inlined below) and in the offline test, so the preview cannot be an XSS vector.
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free markdown editor.
//   MELEK appears ONLY as an understated, OPTIONAL "save & publish — free account" line that, when
//   clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no token
//   talk, never the opening pitch. The editor works fully, offline, without an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                    the single-page editor (textarea + live preview + export .md/.html)
//   /www/marked.min.js   the vendored MIT marked UMD build (served locally; no CDN)
//   /www/marked.LICENSE.txt   its MIT license/attribution
//   /health              liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. localStorage reads
//   AND writes are try/catch-guarded. Soft-fail: every route renders even with no data — unknown path →
//   404, never a 500. No PII intake, no network at runtime.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, 'www');

const PORT = +(process.env.PORT || 8220);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Markdown';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── sanitizeHtml — allow-list HTML sanitizer (defence for the live preview) ─────────────────────────
// Self-contained (no closures over module scope) so it can be inlined verbatim into the browser script
// AND imported directly by the offline test — the browser and the test run the EXACT same code. It takes
// the HTML that marked emits and returns HTML safe to assign to innerHTML: dangerous tags and their
// contents are removed, every other non-allow-listed tag is dropped (its text kept), all event-handler
// and style attributes are stripped, and href/src are limited to safe URL schemes.
export function sanitizeHtml(html) {
  html = String(html == null ? '' : html);
  // 1) delete tag + inner content for executable / embedding elements
  html = html.replace(/<(script|style|template|noscript|iframe|object|embed|svg|math|form)\b[\s\S]*?<\/\1\s*>/gi, '');
  // 2) drop any stray/self-closing occurrences of those same elements
  html = html.replace(/<\/?(script|style|template|noscript|iframe|object|embed|svg|math|form|link|meta|base)\b[^>]*>/gi, '');
  const ALLOWED = ['a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
    'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 'del', 's', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'span', 'div', 'sup', 'sub', 'kbd', 'input'];
  const OK_ATTR = ['href', 'src', 'alt', 'title', 'class', 'align', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled'];
  const SAFE_URL = /^\s*(https?:|mailto:|tel:|#|\/|\.)/i;
  // 3) rewrite every remaining tag through the allow-list
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, function (m, slash, name, attrs) {
    name = name.toLowerCase();
    if (ALLOWED.indexOf(name) === -1) return '';       // unknown tag -> drop it, keep inner text
    if (slash) return '</' + name + '>';
    let out = '';
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a;
    while ((a = attrRe.exec(attrs))) {
      const attr = a[1].toLowerCase();
      const val = a[3] != null ? a[3] : (a[4] != null ? a[4] : (a[5] || ''));
      if (attr.indexOf('on') === 0) continue;           // strip all event handlers
      if (attr === 'style') continue;                   // strip inline styles
      if (OK_ATTR.indexOf(attr) === -1) continue;       // only allow a modest attribute set
      if ((attr === 'href' || attr === 'src') && !SAFE_URL.test(val)) continue; // neutralise bad URLs
      out += ' ' + attr + '="' + String(val).replace(/"/g, '&quot;') + '"';
    }
    if (name === 'a') out += ' rel="noopener nofollow" target="_blank"';  // harden links
    return '<' + name + out + '>';
  });
}

const STARTER = `# Welcome to your markdown editor

Type on the **left**, see it rendered on the **right**. Everything stays in your browser.

## Features
- Live preview as you type
- Autosaves to *this browser*
- Export as \`.md\` or \`.html\`

> Markdown makes clean writing fast.

1. Write
2. Preview
3. Export

[Learn markdown](https://commonmark.org/help/)
`;

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} html,body{height:100%} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:1240px;margin:0 auto;padding:18px 22px}
  h1.pg{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 12px;font-size:14px}
  .muted{color:var(--mut)}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .toolbar input.title{flex:1 1 220px;min-width:160px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font-size:15px;font-weight:600}
  .toolbar input.title:focus{border-color:var(--blue);outline:none}
  .toolbar button{border:1px solid var(--line2);border-radius:8px;padding:9px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .toolbar button:hover{border-color:var(--blue);color:var(--blue)}
  .status{font-size:13px;color:var(--mut);margin-left:auto}
  .status.saved{color:var(--up)}
  .editor{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:820px){.editor{grid-template-columns:1fr}}
  .pane{border:1px solid var(--line2);border-radius:10px;background:var(--panel);display:flex;flex-direction:column;overflow:hidden}
  .pane .hd{padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px;color:var(--mut)}
  textarea#src{border:0;outline:none;resize:vertical;min-height:64vh;background:#0b0f14;color:var(--fg);font:13.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:14px 16px;width:100%}
  #preview{padding:14px 18px;min-height:64vh;overflow:auto;background:#0b0f14}
  #preview h1,#preview h2,#preview h3{border-bottom:1px solid var(--line);padding-bottom:.2em}
  #preview code{background:#161b22;border:1px solid var(--line2);border-radius:5px;padding:1px 5px;font-size:13px}
  #preview pre{background:#161b22;border:1px solid var(--line2);border-radius:8px;padding:12px 14px;overflow:auto}
  #preview pre code{border:0;background:none;padding:0}
  #preview blockquote{border-left:3px solid var(--line2);margin:.6em 0;padding:.1em 1em;color:var(--mut)}
  #preview table{border-collapse:collapse} #preview th,#preview td{border:1px solid var(--line2);padding:5px 10px}
  #preview img{max-width:100%}
  .save-cta{margin:16px 0}
  .save-cta button{border:1px solid var(--line2);border-radius:8px;padding:9px 16px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .save-cta button:hover{border-color:var(--gold);color:var(--gold)}
  .panel{display:none;border:1px solid var(--gold);background:#d2992211;border-radius:10px;padding:16px 18px;margin:12px 0;color:var(--fg)}
  .panel.on{display:block}
  .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px;color:var(--fg)}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:8px;padding:8px 15px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#0d1117;text-decoration:none}
  details.help{margin:16px 0;color:var(--mut);font-size:14px} details.help summary{cursor:pointer;font-weight:600;color:var(--fg)}
  .backlink{font-size:13px;margin-bottom:10px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a free, private markdown editor. Your draft autosaves in <b>your own browser</b>
  and never leaves this page unless you export it or choose to sync. Rendering uses
  <a href="/www/marked.LICENSE.txt">marked</a> (MIT) — vendored locally, and the preview is sanitized.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online markdown editor with live preview. Write markdown, see it render instantly, and export as .md or .html. Autosaves in your browser. No install, no sign-up, works offline.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">&#9997; SoapBox <span>Markdown</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>&#9729; Save &amp; publish</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the editor page ───────────────────────────────────────────────────────────────────────────────
// `title` (optional) prefills the document title (esc()'d into the input). `ret` (optional) → safeHref.
export function editorPage({ title, ret } = {}) {
  const back = safeHref(ret);
  const initialTitle = title ? esc(String(title).slice(0, 120)) : '';
  const echoedRaw = title ? `<span class=muted> · doc: ${esc(title)}</span>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online markdown editor with live preview; exports .md and .html. Runs entirely in the browser; the preview is sanitized and nothing is transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1 class=pg>Free markdown editor with live preview</h1>
<p class=sub>Write markdown on the left and watch it render on the right. Export as Markdown or HTML, and
your draft autosaves right here in your browser.${echoedRaw}</p>

<div class=toolbar>
  <input class=title id=title type=text placeholder="Untitled document" value="${initialTitle}" aria-label="Document title" maxlength=120>
  <button type=button id=export-md>Export .md</button>
  <button type=button id=export-html>Export .html</button>
  <button type=button id=clear>Clear</button>
  <span class=status id=status aria-live=polite>Ready</span>
</div>

<div class=editor>
  <div class=pane>
    <div class=hd>Markdown</div>
    <textarea id=src spellcheck=true aria-label="Markdown source"></textarea>
  </div>
  <div class=pane>
    <div class=hd>Preview</div>
    <div id=preview aria-live=polite></div>
  </div>
</div>

<div class=save-cta><button type=button id=save-btn>&#9729; Save your document &amp; publish it</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your documents — and publish when you're ready</h3>
  <p>This editor is fully free and works right here in your browser, saving as you type — no account needed.
    To <b>save your documents</b>, sync them across devices, and optionally <b>publish</b> one as a shareable
    page, you can create a free MELEK account. It takes a minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? That's the default — use <b>Export .md</b> or <b>Export .html</b> and
    your work never leaves this page.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>About the preview &amp; safety</summary>
  <p class=muted>The preview is rendered with marked and then <b>sanitized</b> before display — raw
  <code>&lt;script&gt;</code>, event handlers, and unsafe links are stripped, so pasting untrusted markdown
  can't run code here. Your draft saves to this browser's local storage as you type; nothing is uploaded.</p>
</details>

<script src="/www/marked.min.js"></script>
<script>
(function(){
  var KEY_TEXT='soapbox.markdown.text', KEY_TITLE='soapbox.markdown.title';
  var src=document.getElementById('src'), titleEl=document.getElementById('title');
  var preview=document.getElementById('preview'), status=document.getElementById('status');
  var STARTER=${JSON.stringify(STARTER)};

  // The SAME sanitizer the offline test imports — inlined verbatim so browser == test.
  ${sanitizeHtml.toString()}

  var parser=null;
  try{ if(typeof marked!=='undefined'){ parser=(marked.Marked?new marked.Marked({gfm:true,breaks:true}):marked); } }catch(e){ parser=null; }
  function toHtml(md){
    if(parser){ try{ return parser.parse(md); }catch(e){} }
    return ''; // engine missing — render nothing rather than raw markup
  }

  function render(){
    var html=sanitizeHtml(toHtml(src.value));   // ALWAYS sanitize before it touches the DOM
    preview.innerHTML=html;                       // safe: html has been allow-list sanitized above
  }

  function load(){
    try{
      var t=window.localStorage.getItem(KEY_TEXT); src.value=(t!=null)?t:STARTER;
      var ti=window.localStorage.getItem(KEY_TITLE); if(ti!=null && !titleEl.value) titleEl.value=ti;
    }catch(e){ src.value=STARTER; }
  }
  function save(){
    try{
      window.localStorage.setItem(KEY_TEXT, src.value);
      window.localStorage.setItem(KEY_TITLE, titleEl.value);
      status.textContent='Saved'; status.className='status saved';
    }catch(e){ status.textContent='Autosave unavailable (private mode)'; status.className='status'; }
  }
  var t=null;
  function onInput(){ status.textContent='Saving…'; status.className='status'; render(); clearTimeout(t); t=setTimeout(save,700); }
  src.addEventListener('input', onInput);
  titleEl.addEventListener('input', function(){ status.textContent='Saving…'; clearTimeout(t); t=setTimeout(save,700); });

  function baseName(){ return (titleEl.value.trim()||'document').replace(/[^\\w.-]+/g,'_').slice(0,60); }
  function download(name, text, type){
    var blob=new Blob([text], {type:type}); var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  }
  document.getElementById('export-md').addEventListener('click', function(){
    download(baseName()+'.md', src.value, 'text/markdown;charset=utf-8');
  });
  document.getElementById('export-html').addEventListener('click', function(){
    var inner=sanitizeHtml(toHtml(src.value));
    var title=(titleEl.value.trim()||'Document');
    var e=function(s){ return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
    var doc='<!doctype html>\\n<html lang="en">\\n<head>\\n<meta charset="utf-8">\\n<meta name="viewport" content="width=device-width,initial-scale=1">\\n<title>'+e(title)+'</title>\\n</head>\\n<body>\\n'+inner+'\\n</body>\\n</html>\\n';
    download(baseName()+'.html', doc, 'text/html;charset=utf-8');
  });
  document.getElementById('clear').addEventListener('click', function(){
    if(!src.value || confirm('Clear this document?')){
      src.value=''; render(); try{ window.localStorage.removeItem(KEY_TEXT); }catch(e){}
      status.textContent='Cleared'; status.className='status'; src.focus();
    }
  });

  // save unlock (client-side explainer only; the editor never needs it)
  var panel=document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  load(); render();
})();
</script>`;

  return page('Free Markdown Editor with Live Preview — export .md/.html, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── static vendored assets (marked + its license) — served locally, never a CDN ─────────────────────
const STATIC = {
  'marked.min.js': { file: 'marked.min.js', type: 'text/javascript; charset=utf-8' },
  'marked.LICENSE.txt': { file: 'marked.LICENSE.txt', type: 'text/plain; charset=utf-8' },
};

function serveStatic(res, name) {
  const meta = STATIC[name];
  if (!meta) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  try {
    const buf = readFileSync(join(WWW, meta.file));
    res.writeHead(200, { 'content-type': meta.type, 'cache-control': 'public, max-age=604800, immutable' });
    return res.end(buf);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.6' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Free browser-based markdown editor with live sanitized preview; exports .md and .html; autosaves to localStorage. Nothing transmitted, no install, no tracking. Optional free MELEK account to save & publish.',
        links: [{ label: 'Markdown editor', path: '/' }],
      }));
    }

    if (path === '/www/marked.min.js') return serveStatic(res, 'marked.min.js');
    if (path === '/www/marked.LICENSE.txt') return serveStatic(res, 'marked.LICENSE.txt');

    if (path === '/') {
      return sendHtml(res, editorPage({
        title: url.searchParams.get('title') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Markdown', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the markdown editor</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/markdown\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Markdown on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
