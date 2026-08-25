// server.mjs — Diagram.SoapBox.Community. A free online flowchart & diagram maker in the SoapBox
// house style (mirrors site/insurance + site/store). It is a genuinely-useful, standalone diagram
// tool: type mermaid-syntax text on the left, see a live rendered diagram on the right, download the
// SVG or copy the code. Rendering is 100% CLIENT-SIDE with a LOCALLY-VENDORED mermaid.js (MIT) —
// no external network at runtime, no CDN, no tracker, no account required.
//
//   PORT=8204 BASE_URL=https://diagram.soapbox.community node site/diagram/server.mjs
//   → serves the editor at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free diagram tool.
//   MELEK/PRANA appears ONLY as an understated, OPTIONAL "Save to your library / Publish" unlock that,
//   when clicked, explains (client-side) that saving across devices / publishing needs a free MELEK
//   account and links the signup flow. No wallet, no token talk, never the opening pitch. The whole
//   editor works fully without ever touching an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page editor (textarea + live preview + template buttons)
//   /www/mermaid.min.js   the vendored MIT mermaid UMD build (served locally; no CDN)
//   /www/mermaid.LICENSE.txt   its MIT license/attribution
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. Soft-fail: every
//   route renders even with no data — unknown path → 404, never a 500. No PII intake, no network at
//   runtime. The diagram source never leaves the browser unless the user opts into an account.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, 'www');

const PORT = +(process.env.PORT || 8204);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Diagrams';
// The opt-in unlock links the ordinary free-account signup flow (env-overridable). No wallet/token here.
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── starter templates (mermaid syntax) — the "get me started" buttons populate the textarea ─────────
// Keys are stable slugs; each has a human label + the mermaid source it drops into the editor.
export const TEMPLATES = {
  flowchart: {
    label: 'Flowchart',
    src: `flowchart TD
  A([Start]) --> B{Is it working?}
  B -- Yes --> C[Ship it]
  B -- No --> D[Fix the bug]
  D --> B
  C --> E([Done])`,
  },
  sequence: {
    label: 'Sequence',
    src: `sequenceDiagram
  participant User
  participant App
  participant Server
  User->>App: Click "Save"
  App->>Server: POST /save
  Server-->>App: 200 OK
  App-->>User: Saved!`,
  },
  org: {
    label: 'Org chart',
    src: `flowchart TD
  CEO[Chief Executive] --> COO[Operations]
  CEO --> CTO[Technology]
  CEO --> CFO[Finance]
  CTO --> ENG[Engineering]
  CTO --> DES[Design]
  COO --> SUP[Support]`,
  },
  mindmap: {
    label: 'Mind map',
    src: `mindmap
  root((My Project))
    Planning
      Goals
      Timeline
    Build
      Frontend
      Backend
    Launch
      Marketing
      Support`,
  },
};
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:1240px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .tpls{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px;align-items:center}
  .tpls .lbl{color:var(--mut);font-size:13px;margin-right:2px}
  .tpls button{border:1px solid var(--line2);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .tpls button:hover{border-color:var(--blue);color:var(--blue)}
  .editor{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:820px){.editor{grid-template-columns:1fr}}
  .pane{border:1px solid var(--line2);border-radius:10px;background:var(--panel);display:flex;flex-direction:column;overflow:hidden}
  .pane .hd{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px;color:var(--mut)}
  .pane .hd .sp{margin-left:auto;display:flex;gap:8px}
  .pane .hd button{border:1px solid var(--line2);border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;color:var(--fg);background:var(--panel);cursor:pointer}
  .pane .hd button:hover{border-color:var(--blue);color:var(--blue)}
  textarea#src{border:0;outline:none;resize:vertical;min-height:420px;background:#0b0f14;color:var(--fg);font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:12px 14px;width:100%}
  #preview{padding:14px;min-height:420px;overflow:auto;display:flex;align-items:flex-start;justify-content:center;background:#0b0f14}
  #preview svg{max-width:100%;height:auto}
  .err{color:var(--down);font-size:13px;white-space:pre-wrap;font-family:ui-monospace,monospace;align-self:flex-start}
  .save-cta{margin:16px 0}
  .save-cta button{border:1px solid var(--line2);border-radius:8px;padding:9px 16px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .save-cta button:hover{border-color:var(--gold);color:var(--gold)}
  .panel{display:none;border:1px solid var(--gold);background:#d2992211;border-radius:10px;padding:16px 18px;margin:12px 0;color:var(--fg)}
  .panel.on{display:block}
  .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px;color:var(--fg)}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:8px;padding:8px 15px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#0d1117;text-decoration:none}
  details.help{margin:16px 0;color:var(--mut);font-size:14px} details.help summary{cursor:pointer;font-weight:600;color:var(--fg)}
  details.help code{background:#0b0f14;border:1px solid var(--line2);border-radius:5px;padding:1px 5px;font-size:13px}
  .backlink{font-size:13px;margin-bottom:10px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a free, private diagram &amp; flowchart maker. Everything runs in your browser;
  your diagram never leaves this page unless you choose to save it. Diagrams render with
  <a href="/www/mermaid.LICENSE.txt">mermaid.js</a> (MIT) — vendored locally, no third-party trackers.
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online flowchart & diagram maker. Type simple text, get a clean flowchart, sequence diagram, org chart, or mind map — download as SVG. No sign-up, no install, runs entirely in your browser.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  // Note: we deliberately do NOT emit the shared SoapBox Organization graph here (it self-describes as
  // a "crypto + markets aggregator"). This surface is a plain diagram tool — stealth funnel — so its
  // structured data is a neutral SoftwareApplication only. No crypto branding, even in the JSON-LD.
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">📊 SoapBox <span>Diagrams</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>☁ Save to library</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the editor page ───────────────────────────────────────────────────────────────────────────────
// `tpl` (optional) pre-selects a starter template; `ret` (optional) is a return URL for an embedding
// app. BOTH are user-controlled → tpl is esc()'d wherever echoed, ret is passed through safeHref().
export function editorPage({ tpl, ret } = {}) {
  const tplKey = TEMPLATE_KEYS.includes(tpl) ? tpl : 'flowchart';
  const initial = TEMPLATES[tplKey].src;
  const back = safeHref(ret);
  // A subtle echo of the raw requested template name (may be hostile) — always escaped.
  const echoedTpl = tpl ? `<span class=muted> · starter: ${esc(tpl)}</span>` : '';

  const tplButtons = TEMPLATE_KEYS.map((k) =>
    `<button type=button data-tpl="${esc(k)}">${esc(TEMPLATES[k].label)}</button>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online flowchart, sequence, org-chart and mind-map maker. Runs entirely in the browser; export to SVG.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free flowchart &amp; diagram maker</h1>
<p class=sub>Type on the left, watch it draw on the right. Flowcharts, sequence diagrams, org charts &amp; mind maps — no sign-up, no install.${echoedTpl}</p>

<div class=tpls><span class=lbl>Start from a template:</span>${tplButtons}
  <button type=button data-tpl="clear" style="border-style:dashed">Blank</button></div>

<div class=editor>
  <div class=pane>
    <div class=hd><span>Diagram source</span>
      <div class=sp><button type=button id=copy>Copy code</button></div></div>
    <textarea id=src spellcheck=false aria-label="Diagram source">${esc(initial)}</textarea>
  </div>
  <div class=pane>
    <div class=hd><span>Preview</span>
      <div class=sp><button type=button id=dl>Download SVG</button></div></div>
    <div id=preview aria-live=polite><span class=muted>Rendering…</span></div>
  </div>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Save to your library / Publish</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your diagrams — across every device</h3>
  <p>This editor is fully free and works right here in your browser, no account needed. To <b>save your
    diagrams to a library</b>, sync them across devices, and optionally <b>publish</b> a diagram to share
    with a permanent link, create a free MELEK account — it takes a minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? Just use <b>Copy code</b> or <b>Download SVG</b> — your work never
    leaves this page.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>Diagram syntax help</summary>
  <p>Diagrams use the mermaid text format. A few starters:</p>
  <p><code>flowchart TD</code> — top-down flowchart · <code>A --&gt; B</code> connects boxes ·
     <code>A{Decision}</code> a diamond · <code>A([Rounded])</code> a pill.</p>
  <p><code>sequenceDiagram</code> — message diagrams · <code>mindmap</code> — mind maps.</p>
  <p>Pick a template above to see a working example, then edit it.</p>
</details>

<script src="/www/mermaid.min.js"></script>
<script>
(function(){
  var TEMPLATES = ${JSON.stringify(Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, TEMPLATES[k].src])))};
  var src = document.getElementById('src');
  var preview = document.getElementById('preview');
  var lastSvg = '';
  var n = 0;
  var ready = (typeof mermaid !== 'undefined');
  if (ready) { try { mermaid.initialize({ startOnLoad:false, theme:'dark', securityLevel:'strict' }); } catch(e){ ready=false; } }

  function showErr(msg){ preview.innerHTML=''; var d=document.createElement('div'); d.className='err'; d.textContent=String(msg||'Could not render diagram.'); preview.appendChild(d); }

  function render(){
    var code = src.value;
    if (!ready){ showErr('Diagram engine failed to load.'); return; }
    if (!code.trim()){ preview.innerHTML='<span class="muted">Type a diagram to see it here.</span>'; lastSvg=''; return; }
    var id = 'd'+(++n);
    try {
      var p = mermaid.render(id, code);
      Promise.resolve(p).then(function(out){
        var svg = (out && out.svg) ? out.svg : out;
        lastSvg = svg; preview.innerHTML = svg;
      }).catch(function(err){ showErr(err && err.message ? err.message : err); });
    } catch(err){ showErr(err && err.message ? err.message : err); }
  }

  var t; src.addEventListener('input', function(){ clearTimeout(t); t=setTimeout(render, 250); });

  // template buttons
  document.querySelectorAll('.tpls button[data-tpl]').forEach(function(b){
    b.addEventListener('click', function(){
      var k=b.getAttribute('data-tpl');
      src.value = (k==='clear') ? '' : (TEMPLATES[k]||'');
      render(); src.focus();
    });
  });

  // copy code
  document.getElementById('copy').addEventListener('click', function(){
    var b=this;
    function done(){ var o=b.textContent; b.textContent='Copied!'; setTimeout(function(){b.textContent=o;},1200); }
    if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(src.value).then(done, function(){ src.select(); document.execCommand&&document.execCommand('copy'); done(); }); }
    else { src.select(); try{document.execCommand('copy');}catch(e){} done(); }
  });

  // download SVG (purely client-side blob)
  document.getElementById('dl').addEventListener('click', function(){
    if (!lastSvg){ render(); }
    if (!lastSvg){ return; }
    var blob = new Blob([lastSvg], {type:'image/svg+xml'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href=url; a.download='diagram.svg';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });

  // save-to-library unlock (client-side explainer only; the editor never needs it)
  var panel = document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if (panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  render();
})();
</script>`;

  return page('Free Online Flowchart & Diagram Maker — SoapBox Diagrams', body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── static vendored assets (mermaid + its license) — served locally, never a CDN ───────────────────
const STATIC = {
  'mermaid.min.js': { file: 'mermaid.min.js', type: 'text/javascript; charset=utf-8' },
  'mermaid.LICENSE.txt': { file: 'mermaid.LICENSE.txt', type: 'text/plain; charset=utf-8' },
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
        summary: 'Free browser-based flowchart & diagram maker (mermaid syntax → live SVG). No account, no install, no tracking. Optional free MELEK account to save/publish.',
        links: [{ label: 'Diagram editor', path: '/' }],
      }));
    }

    if (path === '/www/mermaid.min.js') return serveStatic(res, 'mermaid.min.js');
    if (path === '/www/mermaid.LICENSE.txt') return serveStatic(res, 'mermaid.LICENSE.txt');

    if (path === '/') {
      return sendHtml(res, editorPage({
        tpl: url.searchParams.get('tpl') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Diagrams', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the diagram editor</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/diagram\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Diagrams on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
