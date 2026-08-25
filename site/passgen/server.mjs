// server.mjs — Passgen.SoapBox.Community. A strong password generator that runs 100% CLIENT-SIDE.
// Randomness comes from the browser's cryptographic RNG (crypto.getRandomValues) with unbiased
// rejection sampling — NEVER Math.random, never a server round-trip. Length + character-class toggles,
// a live strength meter, and a one-click copy. Nothing is ever transmitted: the password is generated
// in your browser and stays there. No CDN, no tracker, no account required.
//
//   PORT=8212 BASE_URL=https://passgen.soapbox.community node site/passgen/server.mjs
//   → serves the generator at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto-currency is visible up front. This reads and works exactly like a normal free password
//   generator (the "crypto" here is CRYPTOGRAPHY — the RNG — not a currency). MELEK appears ONLY as an
//   understated, OPTIONAL "keep a private, opt-in vault — free MELEK account" line that, when clicked,
//   explains the opt-in client-side and links the ordinary signup flow. Never the opening pitch; the
//   generator works fully without an account. (No security-sensitive value ever phones home.)
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page generator (length + class toggles + strength meter + copy)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. The RNG is
//   client-side only — no entropy ever leaves the browser. Soft-fail: every route renders even with no
//   data — unknown path → 404, never a 500. No PII intake, no network at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8212);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Password Generator';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// A requested default length is clamped to a sane numeric range; a non-number falls back to 16.
export function safeLen(n, fallback = 16) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(4, Math.min(128, v));
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
  .wrap{max-width:680px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .out{display:flex;gap:8px;align-items:stretch;margin:12px 0}
  #pw{flex:1;background:#0b0f14;border:1px solid var(--line2);border-radius:10px;color:var(--fg);
    font:18px/1.4 ui-monospace,Menlo,monospace;padding:14px 16px;word-break:break-all;min-height:56px}
  .out button{border:1px solid var(--line2);border-radius:10px;background:var(--panel);color:var(--fg);font-weight:700;padding:0 16px;cursor:pointer}
  .out button:hover{border-color:var(--blue);color:var(--blue)}
  .meter{height:8px;border-radius:6px;background:#0b0f14;overflow:hidden;margin:4px 0 2px}
  .meter>div{height:100%;width:0;transition:width .2s,background .2s}
  .strength{font-size:13px;color:var(--mut);margin-bottom:12px}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:16px 18px}
  .lenrow{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .lenrow input[type=range]{flex:1}
  .lenval{font:16px/1 ui-monospace,Menlo,monospace;font-weight:700;min-width:34px;text-align:right}
  .toggles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
  label.tog{display:flex;align-items:center;gap:8px;border:1px solid var(--line2);border-radius:8px;padding:9px 12px;cursor:pointer;background:#0d1117;font-size:14px}
  label.tog:hover{border-color:var(--blue)}
  .genrow{margin-top:14px}
  .genrow button{border:1px solid var(--blue);border-radius:10px;background:var(--blue);color:#0d1117;font-weight:800;padding:12px 22px;font-size:15px;cursor:pointer}
  .genrow button:hover{filter:brightness(1.08)}
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
  <b>${esc(SITE_NAME)}</b> — a free, private password generator. Passwords are made in your browser with
  its cryptographic random-number generator and are <b>never sent anywhere</b>. Nothing to install,
  no account needed.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Strong password generator — set the length, pick character types, and get a secure random password made in your browser with a cryptographic RNG. Nothing is transmitted; no install, no sign-up.';
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
<header class=topbar><a class=brand href="/">🔐 SoapBox <span>Passwords</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>☁ Save to a vault</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// The four character-class toggles (id → label). Kept in the module so a test can assert the row.
export const CLASSES = [
  ['upper', 'A–Z uppercase'],
  ['lower', 'a–z lowercase'],
  ['digits', '0–9 digits'],
  ['symbols', 'Symbols !@#$'],
];

// ── the generator page ────────────────────────────────────────────────────────────────────────────
// `len` (optional) prefills the length slider (clamped 4–128). `ret` (optional) is a Back URL routed
// through safeHref. The raw requested len is echoed (esc()'d) as a muted note.
export function passgenPage({ len, ret } = {}) {
  const back = safeHref(ret);
  const initialLen = safeLen(len, 16);
  const echoedRaw = len ? `<span class=muted> · requested length: ${esc(len)}</span>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'SecurityApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Strong password generator using the browser cryptographic RNG. Runs entirely in the browser; passwords are never transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const toggles = CLASSES.map(([id, label], i) =>
    `<label class=tog><input type=checkbox id="c-${esc(id)}" ${i < 3 ? 'checked' : ''}> ${esc(label)}</label>`).join('');

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Strong password generator</h1>
<p class=sub>Set the length, choose which character types to include, and generate a secure random password
right in your browser. Nothing is ever sent over the network.${echoedRaw}</p>

<div class=out>
  <div id=pw aria-live=polite role=textbox aria-label="Generated password">click Generate</div>
  <button type=button id=copy title="Copy">Copy</button>
</div>
<div class=meter><div id=bar></div></div>
<div class=strength id=strength>Strength: —</div>

<div class=card>
  <div class=lenrow>
    <label for=len style="color:var(--mut);font-size:14px">Length</label>
    <input id=len type=range min=4 max=64 value="${esc(String(initialLen))}" aria-label="Password length">
    <span class=lenval id=lenval>${esc(String(initialLen))}</span>
  </div>
  <div class=toggles>${toggles}</div>
  <div class=genrow><button type=button id=gen>Generate password</button></div>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Keep a private, opt-in vault</button></div>

<div class=panel id=save-panel role=note>
  <h3>Save your passwords — privately, only if you want to</h3>
  <p>The generator is fully free and works entirely in your browser. If you'd like a place to <b>keep the
    passwords you make</b>, synced across your devices, you can create a free MELEK account and use an opt-in,
    private vault. It takes a minute.</p>
  <p class=muted>Prefer to keep nothing? That's the default — passwords are generated locally and never
    stored or transmitted unless you choose to save one.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>How this stays secure</summary>
  <p class=muted>Every password is drawn from <code>crypto.getRandomValues</code> — the browser's
  cryptographic random-number generator — using rejection sampling so each allowed character is equally
  likely (no modulo bias). It is generated on your device and is never sent to any server. For maximum
  safety, use a length of 16 or more and enable several character types.</p>
</details>

<script>
(function(){
  var SETS = {
    upper:'ABCDEFGHJKLMNPQRSTUVWXYZ',
    lower:'abcdefghijkmnopqrstuvwxyz',
    digits:'23456789',
    symbols:'!@#$%^&*()-_=+[]{};:,.?/'
  };
  var pwEl=document.getElementById('pw'), bar=document.getElementById('bar'), strengthEl=document.getElementById('strength');
  var lenEl=document.getElementById('len'), lenval=document.getElementById('lenval');

  // unbiased index in [0,max) via rejection sampling over Uint32 — no modulo bias, cryptographic RNG.
  function randIndex(max){
    if(!window.crypto || !window.crypto.getRandomValues) return 0; // degraded env; UI still renders
    var limit = Math.floor(4294967296/max)*max, x=new Uint32Array(1);
    do { window.crypto.getRandomValues(x); } while(x[0]>=limit);
    return x[0]%max;
  }

  function activeSets(){
    var out=[];
    ['upper','lower','digits','symbols'].forEach(function(k){
      var box=document.getElementById('c-'+k); if(box && box.checked) out.push(SETS[k]);
    });
    return out;
  }

  function generate(){
    var len=Math.max(4,Math.min(128,parseInt(lenEl.value,10)||16));
    var sets=activeSets();
    if(!sets.length){ pwEl.textContent='Pick at least one character type'; setStrength(0,0); return; }
    var pool=sets.join(''), chars=[];
    // guarantee at least one char from each chosen set, then fill the rest from the whole pool
    sets.forEach(function(s){ chars.push(s[randIndex(s.length)]); });
    while(chars.length<len){ chars.push(pool[randIndex(pool.length)]); }
    // Fisher–Yates shuffle with the same unbiased RNG so the guaranteed chars aren't front-loaded
    for(var i=chars.length-1;i>0;i--){ var j=randIndex(i+1); var t=chars[i]; chars[i]=chars[j]; chars[j]=t; }
    var pw=chars.slice(0,len).join('');
    pwEl.textContent=pw;
    setStrength(pw.length, pool.length);
  }

  function setStrength(len, poolSize){
    // entropy ≈ len * log2(poolSize); band it for a friendly meter
    var bits = (len&&poolSize) ? len*Math.log2(poolSize) : 0;
    var pct=Math.max(0,Math.min(100, Math.round(bits/1.28))); // ~128 bits → 100%
    var label='Very weak', col='#f85149';
    if(bits>=112){ label='Excellent'; col='#3fb950'; }
    else if(bits>=80){ label='Strong'; col='#3fb950'; }
    else if(bits>=60){ label='Good'; col='#d29922'; }
    else if(bits>=40){ label='Fair'; col='#d29922'; }
    else if(bits>0){ label='Weak'; col='#f85149'; }
    bar.style.width=pct+'%'; bar.style.background=col;
    strengthEl.textContent = bits ? ('Strength: '+label+' · ~'+Math.round(bits)+' bits of entropy') : 'Strength: —';
  }

  lenEl.addEventListener('input', function(){ lenval.textContent=lenEl.value; });
  document.getElementById('gen').addEventListener('click', generate);
  document.querySelectorAll('.toggles input').forEach(function(b){ b.addEventListener('change', generate); });

  document.getElementById('copy').addEventListener('click', function(){
    var b=this, txt=pwEl.textContent||'';
    if(!txt) return;
    function done(){ var o=b.textContent; b.textContent='Copied!'; setTimeout(function(){b.textContent=o;},1200); }
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done, done); }
    else { done(); }
  });

  // save-to-vault unlock (client-side explainer only; the generator never needs it)
  var panel=document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  generate();
})();
</script>`;

  return page('Strong Password Generator — secure, private, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based strong password generator (crypto.getRandomValues, length + class toggles, strength meter). Nothing transmitted, no install, no tracking. Optional free MELEK account for a private vault.',
        links: [{ label: 'Password generator', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, passgenPage({
        len: url.searchParams.get('len') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Password Generator', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the password generator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/passgen\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Password Generator on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
