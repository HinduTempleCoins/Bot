// server.mjs — Outliner.SoapBox.Community. A fast, keyboard-first collapsible outliner & to-do tree:
// nest bullets, check things off, collapse a branch, and it autosaves to your browser's localStorage so
// your outline is still there when you come back. Export the whole tree as an indented .txt or as .json,
// all client-side. Everything is 100% CLIENT-SIDE — the tree logic is a small, self-contained model
// (NO external library) — no external network at runtime, no CDN, no tracker, no account required.
//
//   PORT=8218 BASE_URL=https://outliner.soapbox.community node site/outliner/server.mjs
//   → serves the outliner at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free outliner / to-do app.
//   MELEK appears ONLY as an understated, OPTIONAL "sync & publish your outline — free account" line that,
//   when clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no token
//   talk, never the opening pitch. The outliner works fully, offline, without an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page outliner (tree + checkboxes + collapse + export)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. localStorage reads
//   AND writes are wrapped in try/catch and the page renders fine with no stored value. Soft-fail: every
//   route renders even with no data — unknown path → 404, never a 500. No PII intake, no network at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8218);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Outliner';
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
const SLUG = 'outliner';
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
  .wrap{max-width:940px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 12px;font-size:14px}
  .muted{color:var(--mut)}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .toolbar input.title{flex:1 1 220px;min-width:160px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font-size:15px;font-weight:600}
  .toolbar input.title:focus{border-color:var(--blue);outline:none}
  .toolbar button{border:1px solid var(--line2);border-radius:8px;padding:9px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .toolbar button:hover{border-color:var(--blue);color:var(--blue)}
  .status{font-size:13px;color:var(--mut);margin-left:auto}
  .status.saved{color:var(--up)}
  #tree{border:1px solid var(--line2);border-radius:12px;background:#0b0f14;padding:10px 8px;min-height:46vh}
  ul.outline{list-style:none;margin:0;padding:0}
  ul.outline ul.outline{margin-left:22px;border-left:1px solid var(--line);padding-left:6px}
  li.node{margin:1px 0}
  .row{display:flex;align-items:center;gap:6px;border-radius:7px;padding:2px 4px}
  .row:hover{background:#161b22}
  .tw{width:16px;text-align:center;color:var(--mut);cursor:pointer;user-select:none;font-size:12px;flex:0 0 auto}
  .tw.leaf{cursor:default;color:var(--line2)}
  .bul{color:var(--mut)}
  input.chk{accent-color:var(--up);cursor:pointer}
  .txt{flex:1 1 auto;background:transparent;border:0;outline:none;color:var(--fg);font:15px/1.5 system-ui,sans-serif;padding:2px 2px}
  .txt:focus{background:#0d1117;border-radius:5px}
  li.done>.row .txt{color:var(--mut);text-decoration:line-through}
  li.collapsed>ul.outline{display:none}
  .del{opacity:0;color:var(--mut);border:0;background:transparent;cursor:pointer;font-size:14px;flex:0 0 auto}
  .row:hover .del{opacity:.7} .del:hover{color:var(--down,#f85149);opacity:1}
  .hint{font-size:12px;color:var(--mut);margin:8px 2px 0}
  .hint kbd{background:#0b0f14;border:1px solid var(--line2);border-radius:4px;padding:0 5px;font-size:11px}
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
  <b>${esc(SITE_NAME)}</b> — a free, private outliner &amp; to-do tree. Your outline autosaves in
  <b>your own browser</b> and never leaves this page unless you export it or choose to sync. Nothing to
  install, no account needed.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online outliner & to-do tree — nest bullets, check things off, collapse branches, and it autosaves in your browser. Export to .txt or .json. No install, no sign-up, works offline.';
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
<header class=topbar><a class=brand href="${bp('/')}">🌳 SoapBox <span>Outliner</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">New</a><button type=button id=nav-save>☁ Sync &amp; publish</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the outliner page ───────────────────────────────────────────────────────────────────────────────
// `title` (optional) prefills the outline title; it is esc()'d before being echoed into the input value.
// `ret` (optional) is a Back URL routed through safeHref.
export function outlinerPage({ title, ret } = {}) {
  const back = safeHref(ret);
  const initialTitle = title ? esc(String(title).slice(0, 120)) : '';
  const echoedRaw = title ? `<span class=muted> · list: ${esc(title)}</span>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online outliner and to-do tree that autosaves to your browser and exports to .txt or .json. Runs entirely in the browser; nothing is transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free online outliner &amp; to-do tree</h1>
<p class=sub>Nest your bullets, check things off, collapse a branch to focus. It saves itself in your
browser as you go. Export the whole tree as text or JSON any time.${echoedRaw}</p>

<div class=toolbar>
  <input class=title id=title type=text placeholder="Untitled outline" value="${initialTitle}" aria-label="Outline title" maxlength=120>
  <button type=button id=collapse-all>Collapse all</button>
  <button type=button id=expand-all>Expand all</button>
  <button type=button id=export-txt>Export .txt</button>
  <button type=button id=export-json>Export .json</button>
  <button type=button id=clear>Clear</button>
  <span class=status id=status aria-live=polite>Ready</span>
</div>

<div id=tree aria-label="Outline"></div>

<p class=hint><kbd>Enter</kbd> new item · <kbd>Tab</kbd> indent · <kbd>Shift</kbd>+<kbd>Tab</kbd> outdent ·
  <kbd>Enter</kbd> on empty item outdents · check the box to mark done · click the triangle to collapse.</p>

<div class=save-cta><button type=button id=save-btn>☁ Sync your outline &amp; publish it</button></div>

<div class=panel id=save-panel role=note>
  <h3>Take your outlines everywhere — sync &amp; publish</h3>
  <p>This outliner is fully free and works right here in your browser, saving as you type — no account
    needed. To <b>sync your outlines across your phone, tablet and laptop</b>, and optionally <b>publish</b>
    an outline as a shareable page, you can create a free MELEK account. It takes a minute.</p>
  <p class=muted>Prefer to stay local? That's the default — your outline lives only in this browser until
    you export it or choose to sync.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>About autosave &amp; export</summary>
  <p class=muted>Your outline is saved to this browser's local storage a moment after each change — nothing
  is sent over the network. It stays on this device only. Use <b>Export .txt</b> for an indented plain-text
  copy, <b>Export .json</b> for the full structured tree, or create a free account to sync across devices.
  Clearing your browser data will remove the locally-saved outline.</p>
</details>

<script>
(function(){
  var KEY_TREE='soapbox.outliner.tree', KEY_TITLE='soapbox.outliner.title';
  var treeEl=document.getElementById('tree'), titleEl=document.getElementById('title');
  var status=document.getElementById('status');

  // ── self-contained tree model (no external library) ──────────────────────────────────────────────
  // A node: { id, text, done, collapsed, children:[] }. The document is a single root array of nodes.
  var uid=0; function nid(){ return 'n'+(Date.now().toString(36))+'_'+(++uid); }
  function makeNode(text){ return { id:nid(), text:text||'', done:false, collapsed:false, children:[] }; }
  var doc=[ makeNode('') ]; // start with one empty bullet

  // Structural helpers — all pure, operate on the doc array.
  function findPath(id, list, path){
    list=list||doc; path=path||[];
    for(var i=0;i<list.length;i++){
      if(list[i].id===id) return path.concat([{parent:list,index:i,node:list[i]}]);
      var r=findPath(id, list[i].children, path.concat([{parent:list,index:i,node:list[i]}]));
      if(r) return r;
    }
    return null;
  }
  function eachNode(fn, list){ list=list||doc; for(var i=0;i<list.length;i++){ fn(list[i]); eachNode(fn, list[i].children); } }

  // ── render (rebuilds the DOM from the model) ─────────────────────────────────────────────────────
  var focusId=null, focusCaret=null;
  function render(){
    treeEl.innerHTML='';
    treeEl.appendChild(renderList(doc));
    if(focusId){ var t=treeEl.querySelector('[data-txt="'+focusId+'"]'); if(t){ t.focus(); if(focusCaret!=null){ try{ t.setSelectionRange(focusCaret,focusCaret); }catch(e){} } } }
    focusId=null; focusCaret=null;
  }
  function renderList(list){
    var ul=document.createElement('ul'); ul.className='outline';
    for(var i=0;i<list.length;i++) ul.appendChild(renderNode(list[i]));
    return ul;
  }
  function renderNode(node){
    var li=document.createElement('li'); li.className='node'+(node.done?' done':'')+(node.collapsed?' collapsed':'');
    li.setAttribute('data-id', node.id);
    var row=document.createElement('div'); row.className='row';

    var tw=document.createElement('span');
    if(node.children.length){ tw.className='tw'; tw.textContent=node.collapsed?'▶':'▼'; tw.title='Collapse / expand';
      tw.addEventListener('click', function(){ node.collapsed=!node.collapsed; save(); render(); }); }
    else { tw.className='tw leaf'; tw.textContent='•'; }
    row.appendChild(tw);

    var chk=document.createElement('input'); chk.type='checkbox'; chk.className='chk'; chk.checked=!!node.done;
    chk.setAttribute('aria-label','Mark done');
    chk.addEventListener('change', function(){ node.done=chk.checked; save(); render(); });
    row.appendChild(chk);

    var txt=document.createElement('input'); txt.type='text'; txt.className='txt'; txt.value=node.text;
    txt.setAttribute('data-txt', node.id); txt.placeholder='';
    txt.addEventListener('input', function(){ node.text=txt.value; scheduleSave(); });
    txt.addEventListener('keydown', function(e){ onKey(e, node, txt); });
    row.appendChild(txt);

    var del=document.createElement('button'); del.className='del'; del.textContent='✕'; del.title='Delete item';
    del.addEventListener('click', function(){ removeNode(node.id); });
    row.appendChild(del);

    li.appendChild(row);
    if(node.children.length) li.appendChild(renderList(node.children));
    return li;
  }

  // ── editing operations ───────────────────────────────────────────────────────────────────────────
  function onKey(e, node, txt){
    var caret=txt.selectionStart;
    if(e.key==='Enter'){
      e.preventDefault();
      if(!node.text && !node.children.length){ outdent(node); return; }
      var p=findPath(node.id); var seg=p[p.length-1];
      var nn=makeNode(''); seg.parent.splice(seg.index+1,0,nn);
      focusId=nn.id; focusCaret=0; save(); render();
    } else if(e.key==='Tab'){
      e.preventDefault();
      focusCaret=caret; if(e.shiftKey) outdent(node); else indent(node);
    } else if(e.key==='Backspace' && txt.value==='' ){
      e.preventDefault(); removeNode(node.id, true);
    } else if(e.key==='ArrowUp'){ focusSibling(node,-1,txt); }
      else if(e.key==='ArrowDown'){ focusSibling(node,1,txt); }
  }
  function indent(node){
    var p=findPath(node.id); var seg=p[p.length-1];
    if(seg.index===0) return; // no previous sibling to nest under
    var prev=seg.parent[seg.index-1];
    seg.parent.splice(seg.index,1); prev.collapsed=false; prev.children.push(node);
    focusId=node.id; save(); render();
  }
  function outdent(node){
    var p=findPath(node.id); if(p.length<2) return; // already top-level
    var seg=p[p.length-1], parentSeg=p[p.length-2];
    seg.parent.splice(seg.index,1);
    parentSeg.parent.splice(parentSeg.index+1,0,node);
    focusId=node.id; save(); render();
  }
  function removeNode(id, mergeUp){
    var p=findPath(id); if(!p) return; var seg=p[p.length-1];
    // don't delete the very last remaining top-level empty node
    if(doc.length===1 && !doc[0].children.length && p.length===1){ doc[0].text=''; save(); render(); return; }
    var prevFocus=null;
    if(seg.index>0){ var pv=seg.parent[seg.index-1]; prevFocus=deepLast(pv).id; }
    else if(p.length>=2){ prevFocus=p[p.length-2].node.id; }
    // pull children up into the gap so nothing is lost
    var kids=seg.node.children;
    seg.parent.splice.apply(seg.parent,[seg.index,1].concat(kids));
    if(prevFocus){ focusId=prevFocus; var tn=findPath(prevFocus); focusCaret=tn?tn[tn.length-1].node.text.length:0; }
    save(); render();
  }
  function deepLast(node){ return node.children.length? deepLast(node.children[node.children.length-1]) : node; }
  function focusSibling(node, dir, txt){
    // flat visible-order navigation
    var order=[]; (function walk(list){ for(var i=0;i<list.length;i++){ order.push(list[i]); if(!list[i].collapsed) walk(list[i].children); } })(doc);
    var idx=order.indexOf(node); var t=order[idx+dir];
    if(t){ var el=treeEl.querySelector('[data-txt="'+t.id+'"]'); if(el){ el.focus(); } }
  }

  // ── persistence (every access guarded) ───────────────────────────────────────────────────────────
  var st=null;
  function scheduleSave(){ status.textContent='Saving…'; status.className='status'; clearTimeout(st); st=setTimeout(save,700); }
  function save(){
    clearTimeout(st);
    try{
      window.localStorage.setItem(KEY_TREE, JSON.stringify(doc));
      window.localStorage.setItem(KEY_TITLE, titleEl.value);
      status.textContent='Saved'; status.className='status saved';
    }catch(e){ status.textContent='Autosave unavailable (private mode)'; status.className='status'; }
  }
  function load(){
    try{
      var raw=window.localStorage.getItem(KEY_TREE);
      if(raw){ var d=JSON.parse(raw); if(Array.isArray(d) && d.length) doc=sanitizeTree(d); }
      var ti=window.localStorage.getItem(KEY_TITLE); if(ti!=null && !titleEl.value) titleEl.value=ti;
    }catch(e){ /* blocked / corrupt — start fresh */ }
  }
  // never trust stored JSON blindly — coerce to the node shape.
  function sanitizeTree(list){
    var out=[];
    for(var i=0;i<list.length;i++){ var n=list[i]||{};
      out.push({ id: nid(), text: (typeof n.text==='string'?n.text:''), done: !!n.done, collapsed: !!n.collapsed,
        children: Array.isArray(n.children)? sanitizeTree(n.children):[] });
    }
    return out;
  }

  titleEl.addEventListener('input', scheduleSave);

  document.getElementById('collapse-all').addEventListener('click', function(){ eachNode(function(n){ if(n.children.length) n.collapsed=true; }); save(); render(); });
  document.getElementById('expand-all').addEventListener('click', function(){ eachNode(function(n){ n.collapsed=false; }); save(); render(); });
  document.getElementById('clear').addEventListener('click', function(){
    if(confirm('Clear this outline?')){ doc=[makeNode('')]; try{ window.localStorage.removeItem(KEY_TREE); }catch(e){}
      status.textContent='Cleared'; status.className='status'; render(); }
  });

  // ── export (client-side blobs only) ──────────────────────────────────────────────────────────────
  function toText(list, depth){
    depth=depth||0; var out='';
    for(var i=0;i<list.length;i++){ var n=list[i];
      out += new Array(depth+1).join('  ') + '- ' + (n.done?'[x] ':'') + n.text + '\\n';
      if(n.children.length) out += toText(n.children, depth+1);
    }
    return out;
  }
  function download(name, text, type){
    var blob=new Blob([text], {type:type}); var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  }
  function baseName(){ return (titleEl.value.trim()||'outline').replace(/[^\\w.-]+/g,'_').slice(0,60); }
  document.getElementById('export-txt').addEventListener('click', function(){
    var head=titleEl.value.trim()? (titleEl.value.trim()+'\\n\\n') : '';
    download(baseName()+'.txt', head+toText(doc,0), 'text/plain;charset=utf-8');
  });
  document.getElementById('export-json').addEventListener('click', function(){
    function strip(list){ return list.map(function(n){ return { text:n.text, done:n.done, children:strip(n.children) }; }); }
    download(baseName()+'.json', JSON.stringify({ title:titleEl.value, items:strip(doc) }, null, 2), 'application/json');
  });

  // save-sync unlock (client-side explainer only; the outliner never needs it)
  var panel=document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  load(); render();
})();
</script>`;

  return page('Free Online Outliner & To-Do Tree — collapsible, autosaves, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based outliner / to-do tree — nest bullets, collapse branches, autosave to localStorage, export .txt/.json. Nothing transmitted, no install, no tracking. Optional free MELEK account to sync across devices & publish.',
        links: [{ label: 'Outliner', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, outlinerPage({
        title: url.searchParams.get('title') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Outliner', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open the outliner</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/outliner\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Outliner on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
