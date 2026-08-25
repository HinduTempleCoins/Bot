// server.mjs — Habits.SoapBox.Community. A free habit & streak tracker: add habits, check off each day,
// watch your streaks build, and see a small "consistency radar" across your habits. Everything is 100%
// CLIENT-SIDE and persists to your browser's localStorage — no external network at runtime (this app
// needs no data API at all), no CDN, no tracker, no account required. The streak grid and the radar
// chart are drawn with plain inline SVG we build ourselves — no charting library, no runtime deps.
//
//   PORT=8216 BASE_URL=https://habits.soapbox.community node site/habits/server.mjs
//   → serves the tracker at  /
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free habit tracker.
//   MELEK appears ONLY as an understated, OPTIONAL "sync your streaks — free account" line that, when
//   clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no token
//   talk, never the opening pitch. The tracker works fully, offline, without an account.
//
// ── NETWORK DISCIPLINE ─────────────────────────────────────────────────────────────────────────────
//   The SERVER handler NEVER fetches at request time. This app makes NO network request at all — not
//   even client-side — everything lives in localStorage. The server renders a pure string.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page habit tracker (add habits, check days, streaks, radar)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. localStorage reads
//   AND writes are wrapped in try/catch and the page renders fine with no stored value. Soft-fail: every
//   route renders even with no data — unknown path → 404, never a 500. No PII intake, no network.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8216);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Habits';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── starter habit suggestions (the "add one of these" quick buttons) ─────────────────────────────────
export const STARTERS = ['Drink water', 'Read', 'Exercise', 'Meditate', 'Sleep by 11', 'Journal', 'No sugar', 'Walk'];

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
  .wrap{max-width:940px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)}
  .add{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .add input{flex:1 1 240px;min-width:180px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 12px;font-size:15px}
  .add input:focus{border-color:var(--blue);outline:none}
  .add button{border:1px solid var(--line2);border-radius:8px;padding:10px 15px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer;white-space:nowrap}
  .add button:hover{border-color:var(--blue);color:var(--blue)}
  .starters{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 16px}
  .starters span{color:var(--mut);font-size:13px;align-self:center;margin-right:2px}
  .starters button{border:1px dashed var(--line2);border-radius:16px;padding:4px 11px;font-size:12px;color:var(--mut);background:transparent;cursor:pointer}
  .starters button:hover{border-color:var(--blue);color:var(--blue)}
  .layout{display:grid;grid-template-columns:1fr 300px;gap:18px}
  @media (max-width:800px){.layout{grid-template-columns:1fr}}
  .habit{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:14px;margin-bottom:12px}
  .habit .top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .habit .name{font-weight:700;font-size:16px;flex:1}
  .habit .streak{font-size:13px;color:var(--gold);font-weight:700;white-space:nowrap}
  .habit .del{border:1px solid var(--line2);border-radius:7px;background:var(--panel);color:var(--mut);cursor:pointer;padding:3px 9px;font-size:12px}
  .habit .del:hover{border-color:var(--down);color:var(--down)}
  .grid{display:flex;gap:5px;flex-wrap:wrap}
  .cell{width:26px;height:26px;border-radius:6px;border:1px solid var(--line2);background:#0b0f14;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--mut);position:relative}
  .cell.on{background:var(--up);border-color:var(--up);color:#0d1117;font-weight:700}
  .cell.today{outline:2px solid var(--blue);outline-offset:1px}
  .cell:hover{border-color:var(--blue)}
  .empty{border:1px dashed var(--line2);border-radius:12px;padding:24px;text-align:center;color:var(--mut)}
  .side{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:16px;align-self:start}
  .side h3{margin:0 0 4px;font-size:15px} .side .cap{color:var(--mut);font-size:13px;margin:0 0 10px}
  #radar{width:100%;height:auto;display:block}
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
  <b>${esc(SITE_NAME)}</b> — a free, private habit &amp; streak tracker. Your habits are saved in
  <b>your own browser</b> and never leave this page unless you choose to sync. Nothing to install, no
  account needed, and no network is ever touched.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free habit & streak tracker — add daily habits, check them off, build streaks, and see a consistency radar across your habits. No sign-up, no install; everything saves in your browser.';
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
<header class=topbar><a class=brand href="/">✅ SoapBox <span>Habits</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">New</a><button type=button id=nav-save>☁ Sync streaks</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the tracker page ────────────────────────────────────────────────────────────────────────────────
// `add` (optional) prefills the new-habit box; user-controlled → esc()'d into the input value.
// `ret` (optional) is a Back URL routed through safeHref.
export function habitsPage({ add, ret } = {}) {
  const back = safeHref(ret);
  const initialAdd = add ? esc(String(add).slice(0, 80)) : '';
  const echoedRaw = add ? `<span class=muted> · adding: ${esc(add)}</span>` : '';

  const starterButtons = STARTERS.map((s) =>
    `<button type=button data-starter="${esc(s)}">+ ${esc(s)}</button>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'HealthApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free habit and streak tracker that saves to your browser. Add habits, check off days, build streaks, and view a consistency radar. Nothing is transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Habit &amp; streak tracker</h1>
<p class=sub>Add the habits you want to build, tick each day you do them, and watch your streaks grow. It
all saves in your browser — no sign-up needed.${echoedRaw}</p>

<div class=add>
  <input id=addInput type=text placeholder="New habit (e.g. Drink water)" value="${initialAdd}"
    aria-label="New habit" maxlength=80 autocomplete=off>
  <button type=button id=addBtn>Add habit</button>
</div>
<div class=starters><span>Quick add:</span>${starterButtons}</div>

<div class=layout>
  <div id=habits>
    <div class=empty id=empty>No habits yet — add one above, or tap a quick-add chip to get started.</div>
  </div>
  <aside class=side>
    <h3>Consistency radar</h3>
    <p class=cap>Last 7 days, per habit. Fuller shape = more consistent.</p>
    <svg id=radar viewBox="0 0 240 240" role=img aria-label="Consistency radar chart"></svg>
    <p class=cap id=radarNote>Add a couple of habits to see your radar.</p>
  </aside>
</div>

<div class=save-cta><button type=button id=save-btn>☁ Sync your streaks across devices</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your streaks going — on every device</h3>
  <p>This tracker is fully free and works right here in your browser, saving as you go — no account needed.
    To <b>sync your habits and streaks across your phone, tablet and laptop</b> (and optionally share a
    progress radar), you can create a free MELEK account. It takes a minute.</p>
  <p class=muted>Prefer to stay local? That's the default — your habits live only in this browser until you
    choose to sync.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>How streaks &amp; the radar work</summary>
  <p class=muted>Each habit shows the last 14 days as a row of squares — tap a square to mark that day done.
  Your <b>streak</b> counts consecutive done-days ending today (or yesterday, if today isn't ticked yet).
  The <b>radar</b> plots each habit's last-7-day completion as one axis, drawn with plain SVG. Everything
  is stored in this browser's local storage; nothing is sent anywhere. Clearing your browser data removes it.</p>
</details>

<script>
(function(){
  var KEY='soapbox.habits.v1';
  var DAYS=14, RADAR_DAYS=7;
  var habitsEl=document.getElementById('habits');
  var emptyEl=document.getElementById('empty');
  var radar=document.getElementById('radar');
  var radarNote=document.getElementById('radarNote');
  var state={ habits: [] };

  function esc2(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];}); }
  function todayKey(d){ d=d||new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function dayKeyOffset(n){ var d=new Date(); d.setDate(d.getDate()-n); return todayKey(d); }
  function uid(){ return 'h'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

  // localStorage read — EVERY access guarded; page renders fine with no stored value.
  function load(){
    try{
      var raw=window.localStorage.getItem(KEY);
      if(raw){ var j=JSON.parse(raw); if(j && Array.isArray(j.habits)) state=j; }
    }catch(e){ /* private mode / bad JSON — just start empty */ }
  }
  function save(){
    try{ window.localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){ /* private mode — in-memory only */ }
  }

  function streak(done){
    var n=0, start=0;
    // allow the streak to count from yesterday if today isn't ticked yet
    if(!done[todayKey()]) start=1;
    for(var i=start;i<3650;i++){ if(done[dayKeyOffset(i)]) n++; else break; }
    return n;
  }
  function last7pct(done){
    var c=0; for(var i=0;i<RADAR_DAYS;i++){ if(done[dayKeyOffset(i)]) c++; } return c/RADAR_DAYS;
  }

  function addHabit(name){
    name=(name||'').trim(); if(!name) return;
    state.habits.push({ id:uid(), name:name.slice(0,80), done:{} });
    save(); renderAll();
  }
  function delHabit(id){
    state.habits=state.habits.filter(function(h){ return h.id!==id; });
    save(); renderAll();
  }
  function toggleDay(id, key){
    var h=state.habits.filter(function(x){return x.id===id;})[0]; if(!h) return;
    if(h.done[key]) delete h.done[key]; else h.done[key]=1;
    save(); renderAll();
  }

  function renderHabits(){
    habitsEl.innerHTML='';
    if(!state.habits.length){ habitsEl.appendChild(emptyEl); emptyEl.style.display='block'; return; }
    emptyEl.style.display='none';
    var tk=todayKey();
    state.habits.forEach(function(h){
      var card=document.createElement('div'); card.className='habit';
      var top=document.createElement('div'); top.className='top';
      var name=document.createElement('div'); name.className='name'; name.textContent=h.name;
      var sk=document.createElement('div'); sk.className='streak'; var s=streak(h.done);
      sk.textContent='🔥 '+s+' day'+(s===1?'':'s');
      var del=document.createElement('button'); del.className='del'; del.textContent='Delete';
      del.addEventListener('click', function(){ if(confirm('Delete “'+h.name+'”?')) delHabit(h.id); });
      top.appendChild(name); top.appendChild(sk); top.appendChild(del);
      var grid=document.createElement('div'); grid.className='grid';
      for(var i=DAYS-1;i>=0;i--){
        var key=dayKeyOffset(i);
        var cell=document.createElement('div'); cell.className='cell'+(h.done[key]?' on':'')+(key===tk?' today':'');
        var dd=new Date(); dd.setDate(dd.getDate()-i);
        cell.textContent=String(dd.getDate());
        cell.title=key;
        (function(k){ cell.addEventListener('click', function(){ toggleDay(h.id,k); }); })(key);
        grid.appendChild(cell);
      }
      card.appendChild(top); card.appendChild(grid);
      habitsEl.appendChild(card);
    });
  }

  // Inline SVG radar — built by hand, no chart library.
  function renderRadar(){
    var cx=120, cy=120, R=88;
    var hs=state.habits;
    while(radar.firstChild) radar.removeChild(radar.firstChild);
    function ns(tag){ return document.createElementNS('http://www.w3.org/2000/svg', tag); }
    if(hs.length<3){ radarNote.textContent = hs.length? 'Add '+(3-hs.length)+' more habit'+((3-hs.length)===1?'':'s')+' for a radar.' : 'Add a couple of habits to see your radar.'; return; }
    radarNote.textContent='Last 7 days · '+hs.length+' habits.';
    var N=hs.length;
    function pt(i, r){ var a=-Math.PI/2 + i*2*Math.PI/N; return [cx+r*Math.cos(a), cy+r*Math.sin(a)]; }
    // rings
    [0.25,0.5,0.75,1].forEach(function(f){
      var ring=ns('polygon'); var pts=[];
      for(var i=0;i<N;i++){ var p=pt(i,R*f); pts.push(p[0].toFixed(1)+','+p[1].toFixed(1)); }
      ring.setAttribute('points', pts.join(' '));
      ring.setAttribute('fill','none'); ring.setAttribute('stroke','#30363d'); ring.setAttribute('stroke-width','1');
      radar.appendChild(ring);
    });
    // spokes + labels
    for(var i=0;i<N;i++){
      var edge=pt(i,R); var line=ns('line');
      line.setAttribute('x1',cx); line.setAttribute('y1',cy); line.setAttribute('x2',edge[0].toFixed(1)); line.setAttribute('y2',edge[1].toFixed(1));
      line.setAttribute('stroke','#21262d'); line.setAttribute('stroke-width','1'); radar.appendChild(line);
      var lp=pt(i,R+14); var t=ns('text');
      t.setAttribute('x',lp[0].toFixed(1)); t.setAttribute('y',lp[1].toFixed(1));
      t.setAttribute('fill','#8b949e'); t.setAttribute('font-size','9'); t.setAttribute('text-anchor','middle'); t.setAttribute('dominant-baseline','middle');
      t.textContent = hs[i].name.length>10 ? hs[i].name.slice(0,9)+'…' : hs[i].name;
      radar.appendChild(t);
    }
    // data polygon
    var dpts=[];
    for(var i=0;i<N;i++){ var v=last7pct(hs[i].done); var p=pt(i, R*Math.max(0.02,v)); dpts.push(p[0].toFixed(1)+','+p[1].toFixed(1)); }
    var poly=ns('polygon'); poly.setAttribute('points', dpts.join(' '));
    poly.setAttribute('fill','#58a6ff44'); poly.setAttribute('stroke','#58a6ff'); poly.setAttribute('stroke-width','2');
    radar.appendChild(poly);
  }

  function renderAll(){ renderHabits(); renderRadar(); }

  document.getElementById('addBtn').addEventListener('click', function(){ var el=document.getElementById('addInput'); addHabit(el.value); el.value=''; el.focus(); });
  document.getElementById('addInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ addHabit(this.value); this.value=''; } });
  document.querySelectorAll('.starters button[data-starter]').forEach(function(b){
    b.addEventListener('click', function(){ addHabit(b.getAttribute('data-starter')); });
  });

  // sync unlock (client-side explainer only; the tracker never needs it)
  var panel=document.getElementById('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', toggle);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  load(); renderAll();
  // if ?add= was provided, prefill is already in the box — leave it for the user to confirm.
})();
</script>`;

  return page('Free Habit & Streak Tracker — build habits, no sign-up', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based habit & streak tracker: add habits, check off days, build streaks, see a consistency radar. Saves to localStorage, nothing transmitted. Optional free MELEK account to sync across devices.',
        links: [{ label: 'Habit tracker', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, habitsPage({
        add: url.searchParams.get('add') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Habits', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the habit tracker</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/habits\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Habits on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
