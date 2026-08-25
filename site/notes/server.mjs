// server.mjs — Notes.SoapBox.Community. A fast, private scratchpad: start typing immediately, and it
// autosaves to your browser's localStorage so your note is still there when you come back. Export any
// note as a .txt file (client-side blob), all with ZERO friction. Everything is 100% CLIENT-SIDE — no
// external network at runtime, no CDN, no tracker, no account required.
//
//   PORT=8213 BASE_URL=https://notes.soapbox.community node site/notes/server.mjs
//   → serves the scratchpad at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free notepad.
//   MELEK appears ONLY as an understated, OPTIONAL "sync across devices — free account" line that,
//   when clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no
//   token talk, never the opening pitch. The scratchpad works fully, offline, without an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page scratchpad (textarea + autosave + export .txt)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. localStorage reads
//   AND writes are wrapped in try/catch and the page renders fine with no stored value. Soft-fail:
//   every route renders even with no data — unknown path → 404, never a 500. No PII intake, no network
//   at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8213);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Notes';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

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
  .wrap{max-width:900px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 12px;font-size:14px}
  .muted{color:var(--mut)}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
  .toolbar input.title{flex:1 1 220px;min-width:160px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font-size:15px;font-weight:600}
  .toolbar input.title:focus{border-color:var(--blue);outline:none}
  .toolbar button{border:1px solid var(--line2);border-radius:8px;padding:9px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .toolbar button:hover{border-color:var(--blue);color:var(--blue)}
  .status{font-size:13px;color:var(--mut);margin-left:auto}
  .status.saved{color:var(--up)}
  textarea#note{width:100%;min-height:56vh;border:1px solid var(--line2);border-radius:12px;background:#0b0f14;color:var(--fg);
    font:15px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;padding:16px 18px;resize:vertical;outline:none}
  textarea#note:focus{border-color:var(--blue)}
  .meta{display:flex;gap:14px;font-size:13px;color:var(--mut);margin-top:8px}
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
  <b>${esc(SITE_NAME)}</b> — a free, private scratchpad. Your notes autosave in <b>your own browser</b>
  and never leave this page unless you export them or choose to sync. Nothing to install, no account
  needed.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online notepad & scratchpad — start typing instantly, it autosaves in your browser, and you can export any note as a .txt file. No install, no sign-up, works offline.';
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
<header class=topbar><a class=brand href="/">📝 SoapBox <span>Notes</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>☁ Sync across devices</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the scratchpad page ───────────────────────────────────────────────────────────────────────────
// `title` (optional) prefills the note title; it is esc()'d before being echoed into the input value.
// `ret` (optional) is a Back URL routed through safeHref.
export function notesPage({ title, ret } = {}) {
  const back = safeHref(ret);
  const initialTitle = title ? esc(String(title).slice(0, 120)) : '';
  const echoedRaw = title ? `<span class=muted> · title: ${esc(title)}</span>` : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online notepad that autosaves to your browser and exports notes as .txt. Runs entirely in the browser; nothing is transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free online notepad</h1>
<p class=sub>Start typing — your note saves itself in your browser as you go, so it's still here when you
come back. Export it as a text file any time.${echoedRaw}</p>

<div class=toolbar>
  <input class=title id=title type=text placeholder="Untitled note" value="${initialTitle}" aria-label="Note title" maxlength=120>
  <button type=button id=export>Export .txt</button>
  <button type=button id=clear>Clear</button>
  <span class=status id=status aria-live=polite>Ready</span>
</div>

<textarea id=note spellcheck=true placeholder="Write anything here… it autosaves to this browser." aria-label="Note text"></textarea>

<div class=meta><span id=count>0 words</span><span id=chars>0 characters</span></div>

<div class=save-cta><button type=button id=save-btn>☁ Sync your notes across devices</button></div>

<div class=panel id=save-panel role=note>
  <h3>Take your notes everywhere — sync across devices</h3>
  <p>This scratchpad is fully free and works right here in your browser, saving as you type — no account
    needed. To <b>sync your notes across your phone, tablet and laptop</b> (and optionally publish one as a
    shareable page), you can create a free MELEK account. It takes a minute.</p>
  <p class=muted>Prefer to stay local? That's the default — your notes live only in this browser until you
    export them or choose to sync.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>About autosave</summary>
  <p class=muted>Your note is saved to this browser's local storage every second or two as you type — nothing
  is sent over the network. It stays on this device only. Use <b>Export .txt</b> to keep a copy as a file, or
  create a free account to sync across devices. Clearing your browser data will remove locally-saved notes.</p>
</details>

<script>
(function(){
  var KEY_TEXT='soapbox.notes.text', KEY_TITLE='soapbox.notes.title';
  var note=document.getElementById('note'), titleEl=document.getElementById('title');
  var status=document.getElementById('status'), countEl=document.getElementById('count'), charsEl=document.getElementById('chars');

  // localStorage read — EVERY access guarded; page renders fine with no stored value.
  function load(){
    try{
      var t=window.localStorage.getItem(KEY_TEXT); if(t!=null) note.value=t;
      var ti=window.localStorage.getItem(KEY_TITLE); if(ti!=null && !titleEl.value) titleEl.value=ti;
    }catch(e){ /* private mode / blocked storage — just start empty */ }
  }
  function save(){
    try{
      window.localStorage.setItem(KEY_TEXT, note.value);
      window.localStorage.setItem(KEY_TITLE, titleEl.value);
      status.textContent='Saved'; status.className='status saved';
    }catch(e){ status.textContent='Autosave unavailable (private mode)'; status.className='status'; }
  }

  function counts(){
    var v=note.value; var words=(v.trim().match(/\\S+/g)||[]).length;
    countEl.textContent=words+' '+(words===1?'word':'words');
    charsEl.textContent=v.length+' characters';
  }

  var t=null;
  function onInput(){
    counts(); status.textContent='Saving…'; status.className='status';
    clearTimeout(t); t=setTimeout(save, 700);
  }
  note.addEventListener('input', onInput);
  titleEl.addEventListener('input', onInput);

  document.getElementById('export').addEventListener('click', function(){
    var name=(titleEl.value.trim()||'note').replace(/[^\\w.-]+/g,'_').slice(0,60)+'.txt';
    var blob=new Blob([note.value], {type:'text/plain;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById('clear').addEventListener('click', function(){
    if(!note.value || confirm('Clear this note?')){
      note.value=''; counts();
      try{ window.localStorage.removeItem(KEY_TEXT); }catch(e){}
      status.textContent='Cleared'; status.className='status'; note.focus();
    }
  });

  // save-sync unlock (client-side explainer only; the pad never needs it)
  var panel=document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  load(); counts();
})();
</script>`;

  return page('Free Online Notepad — instant autosave scratchpad, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based notepad/scratchpad that autosaves to localStorage and exports .txt. Nothing transmitted, no install, no tracking. Optional free MELEK account to sync across devices.',
        links: [{ label: 'Notepad', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, notesPage({
        title: url.searchParams.get('title') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Notes', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the notepad</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/notes\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Notes on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
