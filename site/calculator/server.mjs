// server.mjs — Calculator.SoapBox.Community. A clean, free online calculator: the standard keypad plus a
// few scientific functions (√, x², %, π, sin/cos/tan, ln/log), full keyboard support, and a running
// history. Everything is 100% CLIENT-SIDE. It NEVER uses eval() — expressions are parsed by a small,
// self-contained shunting-yard evaluator that only understands numbers and a fixed operator/function
// set. No external network at runtime, no CDN, no tracker, no account required.
//
//   PORT=8211 BASE_URL=https://calculator.soapbox.community node site/calculator/server.mjs
//   → serves the calculator at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free calculator.
//   MELEK appears ONLY as an understated, OPTIONAL "save your history across devices — free MELEK
//   account" line that, when clicked, explains the opt-in client-side and links the ordinary signup
//   flow. No wallet, no token talk, never the opening pitch. The calculator works fully without one.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page calculator (keypad + scientific keys + history)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. NO eval anywhere.
//   Soft-fail: every route renders even with no data — unknown path → 404, never a 500. No PII intake,
//   no network at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8211);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Calculator';
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
const SLUG = 'calculator';
const HUB_SIBLINGS = [['/calculator', 'Calculator'], ['/notes', 'Notes'], ['/qr', 'QR'], ['/timer', 'Timer'], ['/converter', 'Converter'], ['/diagram', 'Diagram']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + HUB_SIBLINGS.filter(([p]) => p !== '/' + SLUG).slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${l}</a>`).join('');


// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// A requested prefill expression is echoed only after being stripped to the characters a calculator
// can hold — digits, the operator/paren set, spaces and the function letters. This means a hostile
// value can never carry markup into the display even before esc() runs (defence in depth).
export function sanitizeExpr(s, max = 120) {
  if (typeof s !== 'string') return '';
  return s.replace(/[^0-9+\-*/().%^ a-zπ√]/gi, '').slice(0, max);
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .calc{display:grid;grid-template-columns:1fr;gap:12px}
  @media(min-width:720px){.calc{grid-template-columns:2fr 1fr}}
  .pad{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:14px;overflow:hidden}
  #display{background:#0b0f14;border:1px solid var(--line2);border-radius:10px;padding:12px 14px;text-align:right;min-height:64px;margin-bottom:12px}
  #expr{color:var(--mut);font:13px/1.4 ui-monospace,Menlo,monospace;min-height:18px;word-break:break-all}
  #out{color:var(--fg);font:28px/1.2 ui-monospace,Menlo,monospace;font-weight:700;word-break:break-all}
  .keys{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .sci{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px}
  .keys button,.sci button{border:1px solid var(--line2);border-radius:10px;background:#0d1117;color:var(--fg);font:16px/1 system-ui;font-weight:700;padding:14px 0;cursor:pointer}
  .keys button:hover,.sci button:hover{border-color:var(--blue);color:var(--blue)}
  .sci button{font-size:13px;padding:10px 0;color:var(--mut)}
  button.op{color:var(--blue)} button.eq{background:var(--blue);color:#0d1117;border-color:var(--blue)} button.eq:hover{color:#0d1117}
  button.fn{color:var(--gold)}
  .side{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:14px;display:flex;flex-direction:column}
  .side h3{margin:0 0 8px;font-size:14px;color:var(--mut)}
  #history{list-style:none;margin:0;padding:0;overflow:auto;max-height:320px;font:13px/1.5 ui-monospace,Menlo,monospace}
  #history li{border-bottom:1px solid var(--line);padding:6px 2px;cursor:pointer} #history li:hover{color:var(--blue)}
  #history .h-expr{color:var(--mut)} #history .h-val{color:var(--fg);font-weight:700}
  .side .clear{margin-top:8px;border:1px solid var(--line2);border-radius:8px;background:#0d1117;color:var(--mut);padding:7px 10px;font-size:13px;cursor:pointer}
  .side .clear:hover{border-color:var(--blue);color:var(--blue)}
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
  <b>${esc(SITE_NAME)}</b> — a free, private calculator. It runs entirely in your browser; there is
  <b>no eval</b> and nothing is sent anywhere. Your calculations never leave this page unless you choose
  to save them.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online calculator with a clean keypad, scientific functions and keyboard support — runs entirely in your browser, no install and no sign-up.';
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
<header class=topbar><a class=brand href="${bp('/')}">🧮 SoapBox <span>Calculator</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">New</a><button type=button id=nav-save>☁ Save history</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// The scientific function keys (label → the token typed into the expression). Kept in the module so a
// test can assert the sci row exists.
export const SCI_KEYS = ['sin', 'cos', 'tan', 'ln', 'log', '√', 'x²', 'π', '^', '%', '(', ')'];

// ── the calculator page ─────────────────────────────────────────────────────────────────────────
// `expr` (optional) prefills the display; it is sanitised to calculator characters AND esc()'d before
// it is echoed. `ret` (optional) is a Back URL routed through safeHref.
export function calculatorPage({ expr, ret } = {}) {
  const back = safeHref(ret);
  const clean = sanitizeExpr(expr || '');
  const echoedRaw = expr ? `<span class=muted> · requested: ${esc(expr)}</span>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online calculator with scientific functions and keyboard support. Runs entirely in the browser; never uses eval.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  // Basic keypad layout (label, css-class). data-k is what the key inserts / the action name.
  const KEYS = [
    ['C', 'fn', 'clear'], ['(', 'op', '('], [')', 'op', ')'], ['⌫', 'fn', 'back'],
    ['7', '', '7'], ['8', '', '8'], ['9', '', '9'], ['÷', 'op', '/'],
    ['4', '', '4'], ['5', '', '5'], ['6', '', '6'], ['×', 'op', '*'],
    ['1', '', '1'], ['2', '', '2'], ['3', '', '3'], ['−', 'op', '-'],
    ['0', '', '0'], ['.', '', '.'], ['=', 'eq', 'equals'], ['+', 'op', '+'],
  ];
  const sciRow = SCI_KEYS.map((k) => `<button type=button class=fn data-k="${esc(k)}">${esc(k)}</button>`).join('');
  const keyRow = KEYS.map(([lbl, cls, k]) =>
    `<button type=button class="${esc(cls)}" data-k="${esc(k)}">${esc(lbl)}</button>`).join('');

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free online calculator</h1>
<p class=sub>A clean calculator with scientific functions and full keyboard support. It runs entirely in your browser and never evaluates your input as code.${echoedRaw}</p>

<div class=calc>
  <div class=pad>
    <div id=display aria-live=polite>
      <div id=expr>${esc(clean)}</div>
      <div id=out>0</div>
    </div>
    <div class=sci>${sciRow}</div>
    <div class=keys>${keyRow}</div>
  </div>
  <div class=side>
    <h3>History</h3>
    <ul id=history></ul>
    <button type=button class=clear id=clear-hist>Clear history</button>
  </div>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Save your history across devices</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your calculations — on every device</h3>
  <p>The calculator is fully free and works right here in your browser, nothing to install. To <b>save your
    calculation history</b> and sync it across your phone, tablet and laptop, create a free MELEK account —
    it takes a minute.</p>
  <p class=muted>Prefer to keep it local? You don't need an account — the calculator works as-is.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>Keyboard &amp; functions</summary>
  <p class=muted>Type digits and <code>+ - * /</code>, <code>( )</code>, and <code>.</code> directly. Enter or
  <code>=</code> evaluates; Backspace deletes; Escape clears. Scientific keys: <code>sin cos tan ln log √</code>,
  <code>x²</code>, <code>π</code>, <code>^</code> (power) and <code>%</code>. Angles are in radians.</p>
</details>

<script>
(function(){
  var exprEl = document.getElementById('expr');
  var outEl = document.getElementById('out');
  var histEl = document.getElementById('history');
  var buf = exprEl.textContent || '';
  var history = [];

  function setExpr(s){ buf = s; exprEl.textContent = buf; }

  // ── a small SAFE evaluator (shunting-yard → RPN). No eval, no Function. It understands only numbers,
  //    the operators + - * / ^ %, unary minus, parentheses, the constant π, and the named functions
  //    below. Anything else throws → we show "Error". ────────────────────────────────────────────────
  var FUNCS = {
    sin:Math.sin, cos:Math.cos, tan:Math.tan,
    ln:Math.log, log:function(x){return Math.log(x)/Math.LN10;},
    sqrt:Math.sqrt, sq:function(x){return x*x;}
  };
  var PREC = { '+':1,'-':1,'*':2,'/':2,'%':2,'^':3,'u-':4 };
  var RIGHT = { '^':true,'u-':true };

  function tokenize(s){
    // normalise the pretty tokens the sci keys insert
    s = s.replace(/π/g,'('+Math.PI+')').replace(/√/g,'sqrt').replace(/x²/g,'sq');
    var t=[], i=0, prev=null;
    while(i<s.length){
      var c=s[i];
      if(c===' '){ i++; continue; }
      if(/[0-9.]/.test(c)){
        var num=''; while(i<s.length && /[0-9.]/.test(s[i])){ num+=s[i++]; }
        if((num.match(/\\./g)||[]).length>1) throw 0;
        t.push({t:'num',v:parseFloat(num)}); prev='num'; continue;
      }
      if(/[a-z]/i.test(c)){
        var name=''; while(i<s.length && /[a-z]/i.test(s[i])){ name+=s[i++]; }
        name=name.toLowerCase();
        if(!FUNCS[name]) throw 0;
        t.push({t:'fn',v:name}); prev='fn'; continue;
      }
      if(c==='('){ t.push({t:'lp'}); prev='lp'; i++; continue; }
      if(c===')'){ t.push({t:'rp'}); prev='rp'; i++; continue; }
      if('+-*/%^'.indexOf(c)>=0){
        var op=c;
        if(c==='-' && (prev===null||prev==='op'||prev==='lp')) op='u-';
        t.push({t:'op',v:op}); prev='op'; i++; continue;
      }
      throw 0;
    }
    return t;
  }

  function toRPN(toks){
    var out=[], ops=[];
    for(var k=0;k<toks.length;k++){
      var tk=toks[k];
      if(tk.t==='num'){ out.push(tk); }
      else if(tk.t==='fn'){ ops.push(tk); }
      else if(tk.t==='op'){
        while(ops.length){
          var top=ops[ops.length-1];
          if(top.t==='op' && ( (RIGHT[tk.v]?PREC[top.v]>PREC[tk.v]:PREC[top.v]>=PREC[tk.v]) )){ out.push(ops.pop()); }
          else break;
        }
        ops.push(tk);
      }
      else if(tk.t==='lp'){ ops.push(tk); }
      else if(tk.t==='rp'){
        while(ops.length && ops[ops.length-1].t!=='lp'){ out.push(ops.pop()); }
        if(!ops.length) throw 0; ops.pop();
        if(ops.length && ops[ops.length-1].t==='fn') out.push(ops.pop());
      }
    }
    while(ops.length){ var o=ops.pop(); if(o.t==='lp') throw 0; out.push(o); }
    return out;
  }

  function evalRPN(rpn){
    var st=[];
    for(var k=0;k<rpn.length;k++){
      var tk=rpn[k];
      if(tk.t==='num'){ st.push(tk.v); }
      else if(tk.t==='fn'){ if(!st.length) throw 0; st.push(FUNCS[tk.v](st.pop())); }
      else if(tk.t==='op'){
        if(tk.v==='u-'){ if(!st.length) throw 0; st.push(-st.pop()); continue; }
        if(st.length<2) throw 0; var b=st.pop(), a=st.pop();
        st.push(tk.v==='+'?a+b: tk.v==='-'?a-b: tk.v==='*'?a*b: tk.v==='/'?a/b: tk.v==='%'?a%b: Math.pow(a,b));
      }
    }
    if(st.length!==1) throw 0;
    return st[0];
  }

  function compute(s){
    if(!s || !s.trim()) return null;
    var v = evalRPN(toRPN(tokenize(s)));
    if(!isFinite(v)) throw 0;
    return Math.round((v+Number.EPSILON)*1e12)/1e12;
  }

  function preview(){
    try{ var v=compute(buf); outEl.textContent = (v===null)?'0':String(v); }
    catch(e){ outEl.textContent = buf ? '…' : '0'; }
  }
  function evaluate(){
    try{
      var v=compute(buf);
      if(v===null) return;
      outEl.textContent=String(v);
      history.unshift({e:buf, v:String(v)}); renderHist();
      setExpr(String(v));
    }catch(e){ outEl.textContent='Error'; }
  }
  function renderHist(){
    histEl.innerHTML='';
    history.slice(0,50).forEach(function(h){
      var li=document.createElement('li');
      var a=document.createElement('span'); a.className='h-expr'; a.textContent=h.e+' =';
      var b=document.createElement('span'); b.className='h-val'; b.textContent=' '+h.v;
      li.appendChild(a); li.appendChild(b);
      li.addEventListener('click', function(){ setExpr(h.e); preview(); });
      histEl.appendChild(li);
    });
  }

  function insert(tok){
    if(tok==='sin'||tok==='cos'||tok==='tan'||tok==='ln'||tok==='log') setExpr(buf+tok+'(');
    else if(tok==='√') setExpr(buf+'√(');
    else if(tok==='x²') setExpr(buf+'x²');
    else setExpr(buf+tok);
    preview();
  }

  document.querySelectorAll('.keys button, .sci button').forEach(function(b){
    b.addEventListener('click', function(){
      var k=b.getAttribute('data-k');
      if(k==='clear'){ setExpr(''); outEl.textContent='0'; }
      else if(k==='back'){ setExpr(buf.slice(0,-1)); preview(); }
      else if(k==='equals'){ evaluate(); }
      else insert(k);
    });
  });
  document.getElementById('clear-hist').addEventListener('click', function(){ history=[]; renderHist(); });

  // keyboard support
  window.addEventListener('keydown', function(e){
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    var k=e.key;
    if(/^[0-9]$/.test(k) || '+-*/().%^'.indexOf(k)>=0 || k==='.'){ insert(k); e.preventDefault(); }
    else if(k==='Enter' || k==='='){ evaluate(); e.preventDefault(); }
    else if(k==='Backspace'){ setExpr(buf.slice(0,-1)); preview(); e.preventDefault(); }
    else if(k==='Escape'){ setExpr(''); outEl.textContent='0'; e.preventDefault(); }
  });

  // save-history unlock (client-side explainer only)
  var panel = document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if (panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  preview();
})();
</script>`;

  return page('Free Online Calculator — scientific, keyboard support, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based calculator with scientific functions and keyboard support. No eval, no install, no tracking. Optional free MELEK account to save history.',
        links: [{ label: 'Calculator', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, calculatorPage({
        expr: url.searchParams.get('expr') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Calculator', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open the calculator</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/calculator\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Calculator on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
