// server.mjs — Timer.SoapBox.Community. A free focus timer, stopwatch, and countdown in one clean page.
// Set a work/break focus cycle, run a plain stopwatch with laps, or count down to zero — with a tab-title
// countdown, an optional chime, and an optional desktop notification when time's up. Everything is 100%
// CLIENT-SIDE (setInterval, AudioContext, the Notification API) — NO external library — no external
// network at runtime, no CDN, no tracker, no account required.
//
//   PORT=8217 BASE_URL=https://timer.soapbox.community node site/timer/server.mjs
//   → serves the timer at  /
//
// ── NAMING ─────────────────────────────────────────────────────────────────────────────────────────
//   Deliberately a "Focus Timer" — the "Pomodoro" method name is a registered trademark, so this app
//   does not use it in its name or copy. It's a generic work/break interval timer.
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto is visible up front. This reads and works exactly like a normal free timer app.
//   MELEK appears ONLY as an understated, OPTIONAL "log your focus sessions — free account" line that,
//   when clicked, explains the opt-in client-side and links the ordinary signup flow. No wallet, no token
//   talk, never the opening pitch. The timer works fully, offline, without an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page timer (focus timer + stopwatch + countdown tabs)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. localStorage reads
//   AND writes are try/catch-guarded. Soft-fail: every route renders even with no data — unknown path →
//   404, never a 500. No PII intake, no network at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8217);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Timer';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// Clamp a requested "minutes" prefill to a sane integer range before it is echoed (defence in depth: the
// value can only ever be a small number, never markup).
export function sanitizeMinutes(s, def = 25) {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, 180);
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} html,body{height:100%} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:18px 22px;text-align:center}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 16px;font-size:14px}
  .muted{color:var(--mut)}
  .tabs{display:inline-flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
  .tabs button{border:1px solid var(--line2);border-radius:20px;padding:6px 18px;font-size:14px;font-weight:700;color:var(--fg);background:var(--panel);cursor:pointer}
  .tabs button.on,.tabs button:hover{border-color:var(--blue);color:var(--blue)}
  .card{border:1px solid var(--line2);border-radius:16px;background:var(--panel);padding:26px 22px;margin:0 auto}
  .phase{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);min-height:18px}
  .phase.work{color:var(--blue)} .phase.break{color:var(--up)}
  .display{font:700 clamp(52px,16vw,104px)/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;margin:6px 0 4px;font-variant-numeric:tabular-nums}
  .display.done{color:var(--gold)}
  .ctrls{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}
  .ctrls button{border:1px solid var(--line2);border-radius:10px;padding:11px 22px;font-weight:800;font-size:15px;color:var(--fg);background:#0b0f14;cursor:pointer;min-width:96px}
  .ctrls button.primary{border-color:var(--up);color:var(--up)} .ctrls button.primary:hover{background:#3fb95015}
  .ctrls button:hover{border-color:var(--blue);color:var(--blue)}
  .setrow{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:16px;color:var(--mut);font-size:13px}
  .setrow label{display:flex;flex-direction:column;align-items:center;gap:4px}
  .setrow input[type=number]{width:78px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:7px 8px;text-align:center;font-size:15px}
  .setrow input:focus{border-color:var(--blue);outline:none}
  .opts{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:14px;color:var(--mut);font-size:13px}
  .opts label{display:flex;align-items:center;gap:6px;cursor:pointer}
  .laps{margin-top:14px;text-align:left;max-height:180px;overflow:auto;font:13px/1.7 ui-monospace,Menlo,monospace;color:var(--mut)}
  .laps div{display:flex;justify-content:space-between;border-bottom:1px solid var(--line)}
  .pane{display:none} .pane.on{display:block}
  .save-cta{margin:22px 0 0}
  .save-cta button{border:1px solid var(--line2);border-radius:8px;padding:9px 16px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .save-cta button:hover{border-color:var(--gold);color:var(--gold)}
  .panel{display:none;border:1px solid var(--gold);background:#d2992211;border-radius:10px;padding:16px 18px;margin:14px 0;color:var(--fg);text-align:left}
  .panel.on{display:block}
  .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px;color:var(--fg)}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:8px;padding:8px 15px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#0d1117;text-decoration:none}
  details.help{margin:18px auto 0;color:var(--mut);font-size:14px;text-align:left;max-width:560px} details.help summary{cursor:pointer;font-weight:600;color:var(--fg)}
  .backlink{font-size:13px;margin-bottom:10px;text-align:left}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a free, private focus timer, stopwatch &amp; countdown. It runs entirely
  <b>in your browser</b>; nothing is uploaded and no account is needed. Optional settings save to this
  browser only.
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free online focus timer, stopwatch and countdown. Run a work/break focus cycle, time laps, or count down to zero — with a tab-title countdown and an optional chime. No install, no sign-up, works offline.';
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
<header class=topbar><a class=brand href="/">&#9202; SoapBox <span>Timer</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">Reset</a><button type=button id=nav-save>&#9729; Log your sessions</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the timer page ────────────────────────────────────────────────────────────────────────────────
// `mins` (optional) prefills the focus work length; `ret` (optional) → safeHref. `mins` is clamped to a
// small integer by sanitizeMinutes before being echoed anywhere.
export function timerPage({ mins, ret } = {}) {
  const back = safeHref(ret);
  const workMins = sanitizeMinutes(mins, 25);

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free online focus timer, stopwatch and countdown. Runs entirely in the browser; nothing is transmitted.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Free focus timer, stopwatch &amp; countdown</h1>
<p class=sub>Start a work/break focus cycle, run a stopwatch with laps, or count down to zero. The time
shows in the tab title, and an optional chime lets you know when it's up. No sign-up, nothing to install.</p>

<div class=tabs role=tablist>
  <button type=button class="on" data-tab=focus>Focus timer</button>
  <button type=button data-tab=stopwatch>Stopwatch</button>
  <button type=button data-tab=countdown>Countdown</button>
</div>

<div class=card>
  <div class=phase id=phase></div>
  <div class=display id=display>25:00</div>

  <div class=ctrls>
    <button type=button class=primary id=startstop>Start</button>
    <button type=button id=reset>Reset</button>
    <button type=button id=lap style="display:none">Lap</button>
  </div>

  <div class="pane on" data-pane=focus>
    <div class=setrow>
      <label>Work (min)<input type=number id=work-min min=1 max=180 value="${esc(String(workMins))}"></label>
      <label>Break (min)<input type=number id=break-min min=1 max=60 value="5"></label>
      <label>Rounds<input type=number id=rounds min=1 max=12 value="4"></label>
    </div>
  </div>
  <div class=pane data-pane=countdown>
    <div class=setrow>
      <label>Minutes<input type=number id=cd-min min=0 max=180 value="10"></label>
      <label>Seconds<input type=number id=cd-sec min=0 max=59 value="0"></label>
    </div>
  </div>
  <div class=pane data-pane=stopwatch>
    <div class=laps id=laps></div>
  </div>

  <div class=opts>
    <label><input type=checkbox id=opt-sound checked> Chime when time's up</label>
    <label><input type=checkbox id=opt-notify> Desktop notification</label>
  </div>
</div>

<div class=save-cta><button type=button id=save-btn>&#9729; Log your focus sessions</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep track of your focus over time</h3>
  <p>This timer is fully free and runs right here in your browser — no account needed. To <b>log your focus
    sessions</b> and see your streaks build up across days and devices, you can create a free MELEK account.
    It takes a minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? That's the default — the timer works completely on its own and keeps
    nothing beyond this browser.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<details class=help><summary>Tips</summary>
  <p class=muted>The <b>focus timer</b> alternates work and break periods for the number of rounds you set —
  a simple, effective way to work in intervals. The <b>stopwatch</b> counts up and records laps; the
  <b>countdown</b> runs a single timer to zero. Turn on <b>desktop notification</b> to be alerted even when
  this tab is in the background (your browser will ask permission the first time). Everything runs on your
  device — nothing is uploaded.</p>
</details>

<script>
(function(){
  var KEY='soapbox.timer.opts';
  var display=document.getElementById('display'), phaseEl=document.getElementById('phase');
  var startStop=document.getElementById('startstop'), resetBtn=document.getElementById('reset'), lapBtn=document.getElementById('lap');
  var lapsEl=document.getElementById('laps');
  var optSound=document.getElementById('opt-sound'), optNotify=document.getElementById('opt-notify');
  var mode='focus', running=false, tickId=null;
  var baseTitle='Focus Timer';

  // ── options persistence (guarded) ────────────────────────────────────────────────────────────────
  function loadOpts(){
    try{ var raw=window.localStorage.getItem(KEY); if(raw){ var o=JSON.parse(raw);
      if(o && typeof o.sound==='boolean') optSound.checked=o.sound;
      if(o && typeof o.notify==='boolean') optNotify.checked=o.notify; } }catch(e){}
  }
  function saveOpts(){ try{ window.localStorage.setItem(KEY, JSON.stringify({sound:optSound.checked, notify:optNotify.checked})); }catch(e){} }
  optSound.addEventListener('change', saveOpts); optNotify.addEventListener('change', function(){ saveOpts(); if(optNotify.checked) reqNotify(); });

  // ── helpers ──────────────────────────────────────────────────────────────────────────────────────
  function fmt(ms){ ms=Math.max(0,ms); var s=Math.floor(ms/1000); var m=Math.floor(s/60); s=s%60;
    if(m>=60){ var h=Math.floor(m/60); m=m%60; return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }
  function fmtSw(ms){ var t=Math.max(0,ms); var cs=Math.floor(t/10)%100; var s=Math.floor(t/1000); var m=Math.floor(s/60); s=s%60;
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')+'.'+String(cs).padStart(2,'0'); }
  function num(id, def){ var e=document.getElementById(id); var n=e?parseInt(e.value,10):def; return (isFinite(n)&&n>=0)?n:def; }
  function setDisplay(txt){ display.textContent=txt; document.title=running?(txt+' · '+baseTitle):baseTitle; }

  function chime(){
    if(!optSound.checked) return;
    try{ var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return; var ctx=new AC();
      var o=ctx.createOscillator(), g=ctx.createGain(); o.connect(g); g.connect(ctx.destination);
      o.type='sine'; o.frequency.value=880; g.gain.setValueAtTime(0.001,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime+0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.9);
      o.start(); o.stop(ctx.currentTime+0.95);
    }catch(e){}
  }
  function reqNotify(){ try{ if('Notification' in window && Notification.permission==='default') Notification.requestPermission(); }catch(e){} }
  function notify(msg){ try{ if(optNotify.checked && 'Notification' in window && Notification.permission==='granted') new Notification(msg); }catch(e){} }
  function alertDone(msg){ chime(); notify(msg); display.classList.add('done'); }

  // ── focus timer + countdown (count down to a deadline) ──────────────────────────────────────────
  var deadline=0, remainingPaused=0, phaseType='work', round=1, totalRounds=4;
  function startCountTo(ms){ deadline=Date.now()+ms; running=true; startStop.textContent='Pause'; display.classList.remove('done'); loopDown(); }
  function loopDown(){
    clearInterval(tickId);
    tickId=setInterval(function(){
      var left=deadline-Date.now();
      if(left<=0){ clearInterval(tickId); setDisplay(fmt(0)); onPhaseEnd(); return; }
      setDisplay(fmt(left));
    }, 200);
    setDisplay(fmt(deadline-Date.now()));
  }
  function onPhaseEnd(){
    if(mode==='countdown'){ running=false; startStop.textContent='Start'; alertDone('Countdown finished'); document.title=baseTitle; return; }
    // focus mode: alternate work/break
    if(phaseType==='work'){
      alertDone('Work done — take a break');
      if(round>=totalRounds){ running=false; startStop.textContent='Start'; phaseEl.textContent='All rounds complete'; phaseEl.className='phase'; document.title=baseTitle; return; }
      phaseType='break'; phaseEl.textContent='Break · round '+round+'/'+totalRounds; phaseEl.className='phase break';
      startCountTo(num('break-min',5)*60000);
    } else {
      alertDone('Break over — back to work');
      round++; phaseType='work'; phaseEl.textContent='Work · round '+round+'/'+totalRounds; phaseEl.className='phase work';
      startCountTo(num('work-min',25)*60000);
    }
  }

  // ── stopwatch (count up) ─────────────────────────────────────────────────────────────────────────
  var swStart=0, swElapsed=0, laps=[];
  function loopUp(){
    clearInterval(tickId);
    tickId=setInterval(function(){ setDisplay(fmtSw(swElapsed+(Date.now()-swStart))); }, 33);
  }

  // ── controls ─────────────────────────────────────────────────────────────────────────────────────
  function currentPreset(){
    if(mode==='focus') return num('work-min',25)*60000;
    if(mode==='countdown') return (num('cd-min',10)*60 + num('cd-sec',0))*1000;
    return 0;
  }
  function toggle(){
    display.classList.remove('done');
    if(mode==='stopwatch'){
      if(running){ running=false; swElapsed+=Date.now()-swStart; clearInterval(tickId); startStop.textContent='Start'; document.title=baseTitle; }
      else { running=true; swStart=Date.now(); startStop.textContent='Pause'; loopUp(); }
      return;
    }
    if(running){ // pause
      running=false; remainingPaused=deadline-Date.now(); clearInterval(tickId); startStop.textContent='Resume'; document.title=baseTitle;
    } else { // start or resume
      if(remainingPaused>0){ startCountTo(remainingPaused); remainingPaused=0; }
      else {
        if(mode==='focus'){ round=1; totalRounds=num('rounds',4); phaseType='work'; phaseEl.textContent='Work · round 1/'+totalRounds; phaseEl.className='phase work'; }
        else phaseEl.textContent='';
        startCountTo(currentPreset());
      }
    }
  }
  function resetAll(){
    running=false; clearInterval(tickId); startStop.textContent='Start'; remainingPaused=0; display.classList.remove('done');
    document.title=baseTitle; phaseEl.textContent=''; phaseEl.className='phase';
    if(mode==='stopwatch'){ swElapsed=0; laps=[]; renderLaps(); setDisplay(fmtSw(0)); }
    else setDisplay(fmt(currentPreset()));
  }
  function renderLaps(){
    lapsEl.innerHTML='';
    laps.forEach(function(l,i){ var d=document.createElement('div');
      var a=document.createElement('span'); a.textContent='Lap '+(i+1);
      var b=document.createElement('span'); b.textContent=fmtSw(l);
      d.appendChild(a); d.appendChild(b); lapsEl.appendChild(d); });
  }
  startStop.addEventListener('click', toggle);
  resetBtn.addEventListener('click', resetAll);
  lapBtn.addEventListener('click', function(){ if(mode!=='stopwatch') return; var cur=swElapsed+(running?(Date.now()-swStart):0); laps.unshift(cur); renderLaps(); });

  // re-preview the display when settings change (while not running)
  ['work-min','break-min','rounds','cd-min','cd-sec'].forEach(function(id){ var e=document.getElementById(id); if(e) e.addEventListener('input', function(){ if(!running) resetAll(); }); });

  // ── tab switching ────────────────────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tabs button[data-tab]').forEach(function(b){
    b.addEventListener('click', function(){
      mode=b.getAttribute('data-tab');
      document.querySelectorAll('.tabs button').forEach(function(x){ x.classList.toggle('on', x===b); });
      document.querySelectorAll('.pane').forEach(function(p){ p.classList.toggle('on', p.getAttribute('data-pane')===mode); });
      lapBtn.style.display=(mode==='stopwatch')?'':'none';
      resetAll();
    });
  });

  // save unlock (client-side explainer only; the timer never needs it)
  var panel=document.getElementById('save-panel');
  function togglePanel(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  document.getElementById('save-btn').addEventListener('click', togglePanel);
  var navSave=document.getElementById('nav-save'); if(navSave) navSave.addEventListener('click', togglePanel);

  loadOpts(); resetAll();
})();
</script>`;

  return page('Free Focus Timer, Stopwatch & Countdown — no sign-up, works offline', body, { canonical: `${BASE_URL}/`, jsonld });
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
        summary: 'Free browser-based focus timer, stopwatch & countdown (work/break intervals, laps, tab-title countdown, chime). Nothing transmitted, no install, no tracking. Optional free MELEK account to log focus sessions.',
        links: [{ label: 'Focus timer', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, timerPage({
        mins: url.searchParams.get('mins') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Timer', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="/">Open the timer</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/timer\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Timer on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
