// server.mjs — Flashlight.SoapBox.Community. A free online flashlight: a big, full-screen white page
// you tap to toggle, with colour + brightness controls and an optional screen-strobe. Everything is
// 100% CLIENT-SIDE — no camera permission, no external network at runtime, no CDN, no tracker, no
// account required. (Flashlight apps are a notorious permissions/spyware vector — this one is the
// clean one: it asks for nothing.)
//
//   PORT=8210 BASE_URL=https://flashlight.soapbox.community node site/flashlight/server.mjs
//   → serves the flashlight at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free flashlight tool.
//   MELEK appears ONLY as an understated, OPTIONAL "save your settings across devices — free MELEK
//   account" line that, when clicked, explains (client-side) the opt-in and links the ordinary signup
//   flow. No wallet, no token talk, never the opening pitch. The light works fully without an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page flashlight (tap-to-toggle + colour/brightness/strobe controls)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. Soft-fail: every
//   route renders even with no data — unknown path → 404, never a 500. No PII intake, no network at
//   runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8210);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Flashlight';
// The opt-in unlock links the ordinary free-account signup flow (env-overridable). No wallet/token here.
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── Tools-hub path awareness (mundane-app-suite-stealth-funnel) ────────────────
// This app runs as its own process behind a path-routing proxy at tools.soapbox.community/<app>.
// The proxy STRIPS the prefix inbound (our routes stay on '/', '/health', '/www/…'); we PREPEND it to
// every self-URL we EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The Tools hub sits at the domain root (default '/'); sibling links point at the hub, not this app.
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const SLUG = 'flashlight';
const HUB_SIBLINGS = [['/calculator', 'Calculator'], ['/notes', 'Notes'], ['/qr', 'QR'], ['/timer', 'Timer'], ['/converter', 'Converter'], ['/diagram', 'Diagram']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + HUB_SIBLINGS.filter(([p]) => p !== '/' + SLUG).slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${l}</a>`).join('');


// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// A requested colour is only honoured if it is a plain hex colour; anything else falls back to white.
// (The client re-validates too — this is the server-side belt-and-braces so a hostile value never
// reaches an inline style.)
const HEX = /^#?[0-9a-fA-F]{6}$/;
export function safeColor(c, fallback = '#ffffff') {
  if (typeof c !== 'string') return fallback;
  const v = c.trim();
  return HEX.test(v) ? (v[0] === '#' ? v : '#' + v).toLowerCase() : fallback;
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} html,body{height:100%} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:900px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .stage{display:flex;flex-direction:column;align-items:center;gap:12px;margin:8px 0 18px}
  #light{width:100%;max-width:560px;height:240px;border-radius:16px;border:1px solid var(--line2);cursor:pointer;
    display:flex;align-items:center;justify-content:center;color:#000;font-weight:700;user-select:none;overflow:hidden;text-align:center;padding:8px}
  .controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;width:100%}
  .ctl{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:12px 14px}
  .ctl label{display:block;font-size:13px;color:var(--mut);margin-bottom:6px}
  .ctl input[type=range]{width:100%}
  .swatches{display:flex;flex-wrap:wrap;gap:8px}
  .swatches button{width:26px;height:26px;border-radius:50%;border:2px solid var(--line2);cursor:pointer;padding:0}
  .swatches button:hover{border-color:var(--blue)}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .btn{border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .btn:hover{border-color:var(--blue);color:var(--blue)}
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
  /* full-screen torch overlay — pure CSS/JS, no permissions */
  #fs{position:fixed;inset:0;z-index:50;display:none;cursor:pointer}
  #fs.on{display:block}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a free, private flashlight. It runs entirely in your browser and asks for
  <b>no permissions</b> — no camera, no location, nothing to install. Your settings never leave this page
  unless you choose to save them.
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online flashlight — a bright full-screen light you can tap to toggle, with colour, brightness and strobe controls. No app to install, no permissions, runs entirely in your browser.';
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
<header class=topbar><a class=brand href="${bp('/')}">🔦 SoapBox <span>Flashlight</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">New</a><button type=button id=nav-save>☁ Save settings</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// A few clean preset colours the swatches expose. Keys are labels, values plain hex.
export const SWATCHES = {
  White: '#ffffff', Warm: '#ffd8a8', Red: '#ff3b30', Amber: '#ff9f0a',
  Green: '#34c759', Blue: '#0a84ff', Violet: '#bf5af2',
};
export const SWATCH_KEYS = Object.keys(SWATCHES);

// ── the flashlight page ─────────────────────────────────────────────────────────────────────────
// `color` (optional) pre-selects the light colour (validated to a hex value); `label` (optional) is a
// short caption drawn on the light (handy as a quick "sign"); `ret` (optional) is a Back URL for an
// embedding app. ALL are user-controlled → color via safeColor, label esc()'d, ret via safeHref.
export function flashlightPage({ color, label, ret } = {}) {
  const initial = safeColor(color, '#ffffff');
  const back = safeHref(ret);
  const caption = label ? esc(String(label).slice(0, 60)) : '';
  // A subtle echo of the raw requested colour (may be hostile) — always escaped.
  const echoed = color ? `<span class=muted> · requested colour: ${esc(color)}</span>` : '';

  const swatchBtns = SWATCH_KEYS.map((k) =>
    `<button type=button title="${esc(k)}" data-color="${esc(SWATCHES[k])}" style="background:${esc(SWATCHES[k])}"></button>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online flashlight with colour, brightness and strobe controls. Runs entirely in the browser; asks for no permissions.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free online flashlight</h1>
<p class=sub>Tap the panel to turn the light on full-screen. Pick a colour, set the brightness, or switch on a strobe — all in your browser, no app and no permissions needed.${echoed}</p>

<div class=stage>
  <div id=light role=button tabindex=0 aria-label="Tap to turn the flashlight on" style="background:${esc(initial)}">${caption || 'Tap for full-screen light'}</div>
  <div class=controls>
    <div class=ctl>
      <label for=bright>Brightness</label>
      <input id=bright type=range min=10 max=100 value=100 aria-label="Brightness">
    </div>
    <div class=ctl>
      <label for=picker>Colour</label>
      <div class=row><input id=picker type=color value="${esc(initial)}" aria-label="Pick a colour">
        <div class=swatches>${swatchBtns}</div></div>
    </div>
    <div class=ctl>
      <label for=strobe>Strobe</label>
      <div class=row>
        <button type=button class=btn id=strobe aria-pressed=false>Strobe: off</button>
        <input id=rate type=range min=1 max=20 value=6 aria-label="Strobe speed">
      </div>
    </div>
  </div>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Save your settings across devices</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your flashlight set up — on every device</h3>
  <p>The flashlight is fully free and works right here in your browser, nothing to install. To <b>save your
    preferred colour, brightness and strobe</b> and sync them across your phone, tablet and laptop, you can
    create a free MELEK account — it takes a minute.</p>
  <p class=muted>Prefer to keep it local? You don't need an account at all — everything works as-is.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>Tips</summary>
  <p class=muted>Tap the light panel (or press Enter when it's focused) to go full-screen; tap anywhere to turn it
  off. The strobe flashes the whole screen — set the speed with the slider. This page asks for no camera or
  location access; it is simply a bright screen.</p>
</details>

<div id=fs aria-hidden=true></div>

<script>
(function(){
  var light = document.getElementById('light');
  var fs = document.getElementById('fs');
  var picker = document.getElementById('picker');
  var bright = document.getElementById('bright');
  var strobeBtn = document.getElementById('strobe');
  var rate = document.getElementById('rate');
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var color = HEX.test(light.style.backgroundColor) ? light.style.backgroundColor : (picker.value || '#ffffff');
  var strobing = false, timer = null, phase = true;

  function clampColor(c){ return (typeof c==='string' && HEX.test(c)) ? c : '#ffffff'; }
  function apply(){
    color = clampColor(picker.value);
    light.style.background = color;
    var op = Math.max(10, Math.min(100, +bright.value||100))/100;
    fs.style.opacity = String(op);
    if (!strobing) fs.style.background = color;
  }
  picker.addEventListener('input', apply);
  bright.addEventListener('input', apply);

  document.querySelectorAll('.swatches button[data-color]').forEach(function(b){
    b.addEventListener('click', function(){ var c=clampColor(b.getAttribute('data-color')); picker.value=c; apply(); });
  });

  function openFS(){ fs.classList.add('on'); apply(); try{ if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }catch(e){} }
  function closeFS(){ fs.classList.remove('on'); stopStrobe(); try{ if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); }catch(e){} }
  light.addEventListener('click', openFS);
  light.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openFS(); } });
  fs.addEventListener('click', closeFS);

  function startStrobe(){
    stopStrobe();
    strobing = true; strobeBtn.textContent='Strobe: on'; strobeBtn.setAttribute('aria-pressed','true');
    var hz = Math.max(1, Math.min(20, +rate.value||6));
    timer = setInterval(function(){ phase=!phase; fs.style.background = phase ? color : '#000000'; }, Math.round(1000/(hz*2)));
    if (!fs.classList.contains('on')) openFS();
  }
  function stopStrobe(){
    strobing=false; if(timer){ clearInterval(timer); timer=null; } phase=true;
    strobeBtn.textContent='Strobe: off'; strobeBtn.setAttribute('aria-pressed','false'); fs.style.background=color;
  }
  strobeBtn.addEventListener('click', function(){ strobing ? stopStrobe() : startStrobe(); });
  rate.addEventListener('input', function(){ if(strobing) startStrobe(); });

  // save-settings unlock (client-side explainer only; the light never needs it)
  var panel = document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if (panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  apply();
})();
</script>`;

  return page('Free Online Flashlight — bright full-screen light, no install', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based flashlight (full-screen light + colour/brightness/strobe). No permissions, no install, no tracking. Optional free MELEK account to save settings.',
        links: [{ label: 'Flashlight', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, flashlightPage({
        color: url.searchParams.get('color') || '',
        label: url.searchParams.get('label') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Flashlight', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open the flashlight</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/flashlight\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Flashlight on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
