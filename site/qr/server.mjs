// server.mjs — QR.SoapBox.Community. A free online QR code generator: turn any text, URL, Wi-Fi login, or
// contact line into a scannable QR code, then download it as a PNG or SVG. Generation is 100% CLIENT-SIDE
// with a LOCALLY-VENDORED qrcode.js (soldair/node-qrcode, MIT) bundled to a browser build — no external
// network at runtime, no CDN, no tracker, no account required.
//
//   PORT=8219 BASE_URL=https://qr.soapbox.community node site/qr/server.mjs
//   → serves the generator at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free QR code maker.
//   MELEK appears ONLY as an understated, OPTIONAL "save your codes / free account" line that, when
//   clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no token
//   talk, never the opening pitch. The generator works fully without an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                    the single-page generator (input + live QR + PNG/SVG download)
//   /www/qrcode.min.js   the vendored MIT node-qrcode browser bundle (served locally; no CDN)
//   /www/qrcode.LICENSE.txt   its MIT license/attribution
//   /health              liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. Soft-fail: every
//   route renders even with no data — unknown path → 404, never a 500. No PII intake, no network at
//   runtime. The text you encode never leaves the browser unless you opt into an account.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, 'www');

const PORT = +(process.env.PORT || 8219);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox QR';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

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
  .wrap{max-width:1040px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .tabs{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 14px}
  .tabs button{border:1px solid var(--line2);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .tabs button.on,.tabs button:hover{border-color:var(--blue);color:var(--blue)}
  .grid{display:grid;grid-template-columns:1fr 340px;gap:18px}
  @media (max-width:800px){.grid{grid-template-columns:1fr}}
  .pane{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:14px 16px}
  label{display:block;font-size:13px;color:var(--mut);margin:10px 0 4px}
  input[type=text],input[type=password],textarea,select{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font:14px/1.5 system-ui,sans-serif}
  textarea{min-height:90px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  input:focus,textarea:focus,select:focus{border-color:var(--blue);outline:none}
  .field{display:none} .field.on{display:block}
  .opts{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:12px}
  .opts .o{flex:1 1 120px}
  .qrbox{display:flex;flex-direction:column;align-items:center;gap:12px}
  #qr{background:#fff;border-radius:10px;padding:14px;display:flex;align-items:center;justify-content:center;min-height:220px;width:100%}
  #qr canvas,#qr svg{max-width:100%;height:auto;display:block}
  .dl{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
  .dl button{border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .dl button:hover{border-color:var(--blue);color:var(--blue)}
  .err{color:var(--down);font-size:13px}
  .echo{font-size:12px;color:var(--mut);word-break:break-all;margin-top:6px}
  .echo a{color:var(--blue)}
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
  <b>${esc(SITE_NAME)}</b> — a free, private QR code generator. Codes are drawn <b>in your browser</b>;
  the text you encode never leaves this page. QR codes render with
  <a href="/www/qrcode.LICENSE.txt">node-qrcode</a> (MIT) — vendored locally, no third-party trackers.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online QR code generator. Turn any text, URL, Wi-Fi login or contact into a scannable QR code and download it as PNG or SVG. No sign-up, no install, runs entirely in your browser.';
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
<header class=topbar><a class=brand href="/">🔳 SoapBox <span>QR</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>☁ Save your codes</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the generator page ────────────────────────────────────────────────────────────────────────────
// `text` (optional) prefills the plain-text/URL field; `ret` (optional) is a Back URL. Both are
// user-controlled: `text` is esc()'d wherever echoed, `ret` goes through safeHref. When the prefilled
// text is itself a URL we ALSO echo it as a clickable link — routed through safeHref so a hostile
// `javascript:` value can never become an href.
export function generatorPage({ text, ret } = {}) {
  const back = safeHref(ret);
  const initialText = text ? esc(String(text).slice(0, 1200)) : '';
  const linkHref = safeHref(text);
  const echoedLink = text
    ? `<div class=echo>Encoding: ${esc(String(text).slice(0, 300))}${linkHref ? ` &middot; <a href="${esc(linkHref)}" target=_blank rel="noopener nofollow">open link</a>` : ''}</div>`
    : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online QR code generator. Encodes text, URLs, Wi-Fi and contacts to a QR code, downloadable as PNG or SVG. Runs entirely in the browser; nothing is transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free QR code generator</h1>
<p class=sub>Type anything — a link, some text, a Wi-Fi login — and get a scannable QR code you can
download as PNG or SVG. No sign-up, no install, and the text you encode never leaves your browser.</p>

<div class=tabs role=tablist>
  <button type=button class="on" data-tab=text>Text / URL</button>
  <button type=button data-tab=wifi>Wi-Fi</button>
  <button type=button data-tab=contact>Contact</button>
</div>

<div class=grid>
  <div class=pane>
    <div class="field on" data-field=text>
      <label for=in-text>Text or URL</label>
      <textarea id=in-text placeholder="https://example.com  ·  or any text">${initialText}</textarea>
      ${echoedLink}
    </div>
    <div class=field data-field=wifi>
      <label for=wifi-ssid>Network name (SSID)</label>
      <input type=text id=wifi-ssid placeholder="MyNetwork">
      <label for=wifi-pass>Password</label>
      <input type=text id=wifi-pass placeholder="(leave blank if open)">
      <label for=wifi-enc>Security</label>
      <select id=wifi-enc><option value=WPA>WPA/WPA2</option><option value=WEP>WEP</option><option value=nopass>None (open)</option></select>
    </div>
    <div class=field data-field=contact>
      <label for=c-name>Name</label>
      <input type=text id=c-name placeholder="Jane Doe">
      <label for=c-phone>Phone</label>
      <input type=text id=c-phone placeholder="+1 555 0100">
      <label for=c-email>Email</label>
      <input type=text id=c-email placeholder="jane@example.com">
      <label for=c-org>Organisation (optional)</label>
      <input type=text id=c-org placeholder="Acme Co.">
    </div>

    <div class=opts>
      <div class=o><label for=opt-ec>Error correction</label>
        <select id=opt-ec><option value=L>Low</option><option value=M selected>Medium</option><option value=Q>Quartile</option><option value=H>High</option></select></div>
      <div class=o><label for=opt-fg>Foreground</label><input type=text id=opt-fg value="#000000"></div>
      <div class=o><label for=opt-bg>Background</label><input type=text id=opt-bg value="#ffffff"></div>
    </div>
    <div class=err id=err aria-live=polite></div>
  </div>

  <div class=pane qrbox>
    <div class=qrbox>
      <div id=qr aria-label="QR code preview"><span class=muted>Your QR code appears here</span></div>
      <div class=dl>
        <button type=button id=dl-png>Download PNG</button>
        <button type=button id=dl-svg>Download SVG</button>
      </div>
    </div>
  </div>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Save &amp; organise your codes</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your QR codes in one place</h3>
  <p>This generator is fully free and runs right here in your browser — no account needed. To <b>save the
    codes you make</b> and reach them from any device, you can create a free MELEK account. It takes a
    minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? Just use <b>Download PNG</b> or <b>Download SVG</b> — your work
    never leaves this page.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>Tips</summary>
  <p class=muted>Higher <b>error correction</b> makes a QR still scan when partly obscured (at the cost of a
  denser code). <b>PNG</b> is best for pasting into documents and slides; <b>SVG</b> is a crisp vector for
  print at any size. Everything is generated on your device — nothing is uploaded.</p>
</details>

<script src="/www/qrcode.min.js"></script>
<script>
(function(){
  var qrEl=document.getElementById('qr'), errEl=document.getElementById('err');
  var tab='text', lastSvg='', lastCanvas=null;
  var ready=(typeof QRCode!=='undefined');

  function val(id){ var e=document.getElementById(id); return e?e.value:''; }
  function esc4wifi(s){ return String(s).replace(/([\\\\;,:"])/g, '\\\\$1'); }

  // Build the payload string from whichever tab is active.
  function payload(){
    if(tab==='wifi'){
      var enc=val('wifi-enc'), ssid=val('wifi-ssid'), pass=val('wifi-pass');
      if(!ssid) return '';
      if(enc==='nopass') return 'WIFI:T:nopass;S:'+esc4wifi(ssid)+';;';
      return 'WIFI:T:'+enc+';S:'+esc4wifi(ssid)+';P:'+esc4wifi(pass)+';;';
    }
    if(tab==='contact'){
      var n=val('c-name'), ph=val('c-phone'), em=val('c-email'), org=val('c-org');
      if(!(n||ph||em)) return '';
      var v='BEGIN:VCARD\\nVERSION:3.0\\n';
      if(n) v+='N:'+n+'\\nFN:'+n+'\\n';
      if(org) v+='ORG:'+org+'\\n';
      if(ph) v+='TEL:'+ph+'\\n';
      if(em) v+='EMAIL:'+em+'\\n';
      v+='END:VCARD';
      return v;
    }
    return val('in-text');
  }

  function opts(){ return { errorCorrectionLevel: val('opt-ec')||'M', margin:2,
    color:{ dark:(val('opt-fg')||'#000000'), light:(val('opt-bg')||'#ffffff') } }; }

  function clearErr(){ errEl.textContent=''; }
  function showErr(m){ errEl.textContent=String(m||'Could not make a QR code.'); }

  function render(){
    clearErr();
    var data=payload();
    if(!ready){ showErr('QR engine failed to load.'); return; }
    if(!data){ qrEl.innerHTML=''; var s=document.createElement('span'); s.className='muted'; s.textContent='Your QR code appears here'; qrEl.appendChild(s); lastSvg=''; lastCanvas=null; return; }
    // canvas (for PNG + on-screen preview)
    var canvas=document.createElement('canvas');
    QRCode.toCanvas(canvas, data, Object.assign({ width:260 }, opts()), function(err){
      if(err){ showErr(err.message||err); return; }
      qrEl.innerHTML=''; qrEl.appendChild(canvas); lastCanvas=canvas;
    });
    // svg string (for the SVG download)
    QRCode.toString(data, Object.assign({ type:'svg' }, opts()), function(err, svg){
      if(err){ lastSvg=''; return; } lastSvg=svg;
    });
  }

  function download(name, href, revoke){
    var a=document.createElement('a'); a.href=href; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    if(revoke) setTimeout(function(){ URL.revokeObjectURL(href); },1000);
  }
  document.getElementById('dl-png').addEventListener('click', function(){
    if(!lastCanvas){ render(); }
    if(!lastCanvas){ return; }
    try{ download('qr-code.png', lastCanvas.toDataURL('image/png'), false); }catch(e){ showErr('Could not export PNG.'); }
  });
  document.getElementById('dl-svg').addEventListener('click', function(){
    if(!lastSvg){ render(); }
    if(!lastSvg){ return; }
    var blob=new Blob([lastSvg], {type:'image/svg+xml'}); var url=URL.createObjectURL(blob);
    download('qr-code.svg', url, true);
  });

  // tab switching
  var t;
  document.querySelectorAll('.tabs button[data-tab]').forEach(function(b){
    b.addEventListener('click', function(){
      tab=b.getAttribute('data-tab');
      document.querySelectorAll('.tabs button').forEach(function(x){ x.classList.toggle('on', x===b); });
      document.querySelectorAll('.field').forEach(function(f){ f.classList.toggle('on', f.getAttribute('data-field')===tab); });
      render();
    });
  });
  // live re-render as any input changes
  ['in-text','wifi-ssid','wifi-pass','wifi-enc','c-name','c-phone','c-email','c-org','opt-ec','opt-fg','opt-bg'].forEach(function(id){
    var e=document.getElementById(id); if(!e) return;
    e.addEventListener('input', function(){ clearTimeout(t); t=setTimeout(render,200); });
    e.addEventListener('change', render);
  });

  // save unlock (client-side explainer only; the generator never needs it)
  var panel=document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  render();
})();
</script>`;

  return page('Free QR Code Generator — text, URL, Wi-Fi → PNG or SVG, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── static vendored assets (qrcode + its license) — served locally, never a CDN ─────────────────────
const STATIC = {
  'qrcode.min.js': { file: 'qrcode.min.js', type: 'text/javascript; charset=utf-8' },
  'qrcode.LICENSE.txt': { file: 'qrcode.LICENSE.txt', type: 'text/plain; charset=utf-8' },
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
        summary: 'Free browser-based QR code generator (text/URL/Wi-Fi/contact → QR, download PNG or SVG). Nothing transmitted, no install, no tracking. Optional free MELEK account to save your codes.',
        links: [{ label: 'QR generator', path: '/' }],
      }));
    }

    if (path === '/www/qrcode.min.js') return serveStatic(res, 'qrcode.min.js');
    if (path === '/www/qrcode.LICENSE.txt') return serveStatic(res, 'qrcode.LICENSE.txt');

    if (path === '/') {
      return sendHtml(res, generatorPage({
        text: url.searchParams.get('text') || url.searchParams.get('url') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox QR', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the QR generator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/qr\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox QR on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
