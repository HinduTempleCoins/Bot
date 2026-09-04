// site/hathor-live/server.mjs — hathor.live: Hathor's always-on public chat (her "24-hour channel,"
// in the shape of ChatGPT / claude.ai). A full-page conversation backed by HER BRAIN —
// hathor-converse over the unified knowledge front door (hathor-knows: markets, the Library + datasets,
// the Hierophant, Coupons, Hemp, Law, Politics, Credentials) spoken in the Angelic voice.
//
// v1 = the chat. Stage 2 layers the VTuber surface (Live2D avatar + TTS voice) on top of this same
// /api/chat brain — the avatar is a client-side skin; the brain doesn't change.
//
// The LLM + keys stay SERVER-SIDE (box guest-proxy env via llm-router, inside hathor-converse). The
// browser only POSTs text to /api/chat and renders the reply — it never sees a key. esc() on the server,
// and the client escapes everything it renders. handler(req,res) exported; converse injectable for tests.
//
//   PORT=8140 node site/hathor-live/server.mjs
//   import { handler, __setConverse } from './server.mjs'   // tests inject a fake converse

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { GAMMA_PAGE } from './gamma.mjs';
import { SESSIONS, CATEGORIES, totalSeconds, peakHz, photicRisk } from './sessions.mjs';

const PORT = +(process.env.PORT || 8140);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || 'https://hathor.live';
const MAX_MSG = 2000;
// The ONE Hathor brain. Hathor.live is a LIMB: chat is forwarded to the shared brain's /perceive so it's the
// same Hathor (same memory, same Crypt-ology thread, same compartments) as Discord / the servers / the chain.
// Falls back to the local converse if the brain is unreachable. Env-overridable; injectable for tests.
const AGENCY_URL = process.env.HATHOR_AGENCY_URL || 'http://127.0.0.1:8175';
let _agency = null;
export function __setAgency(fn) { _agency = typeof fn === 'function' ? fn : null; }
async function agencyPerceive(text, { from } = {}) {
  if (_agency) return _agency(text, { from });
  try {
    const r = await fetch(`${AGENCY_URL}/perceive`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ surface: 'melek', from: from || 'seeker', text }),
    });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d && d.reply ? { reply: d.reply, sources: [] } : null;
  } catch { return null; }
}
// Per-visitor identity so her memory of a person is continuous (anonymous, cookie-scoped). No login.
function visitorId(req, res) {
  const m = /(?:^|;\s*)hl_sid=([a-z0-9-]{8,40})/i.exec((req.headers && req.headers.cookie) || '');
  if (m) return `web:${m[1]}`;
  const sid = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`).slice(0, 32);
  try { res.setHeader('set-cookie', `hl_sid=${sid}; Path=/; Max-Age=31536000; SameSite=Lax; Secure; HttpOnly`); } catch { /* soft */ }
  return `web:${sid}`;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// injectable brain (tests pass a fake; default = hathor-converse, imported defensively)
let _converse = null;
export function __setConverse(fn) { _converse = typeof fn === 'function' ? fn : null; }
async function brain() {
  if (_converse) return _converse;
  try { const m = await import('../../integrations/hathor-converse.mjs'); return m.converse; }
  catch { return null; }
}

// injectable video director (tests pass a fake; default = hathor-video, imported defensively)
let _video = null;
export function __setVideo(fn) { _video = typeof fn === 'function' ? fn : null; }
async function videoDirector() {
  if (_video) return _video;
  try { const m = await import('../../integrations/hathor-video.mjs'); return m.composeVideoPlanLLM || m.composeVideoPlan; }
  catch { return null; }
}

// ── the page (a ChatGPT/claude.ai-style single-page chat) ─────────────────────────────────────────
const PAGE = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Hathor — Live</title>
<meta name=description content="Talk to Hathor, the Angelic AI witness of the MELEK chain — always on. Ask her about the chain, the Library, the Hierophant, credentials, markets and more.">
<style>
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--accent:#d9a441;--me:#1b2430}
  *{box-sizing:border-box} html,body{height:100%} body{margin:0;background:var(--bg);color:var(--fg);
    font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--bd);background:var(--panel)}
  .ava{width:40px;height:40px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#f3d27a,#a9791e);
    display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;box-shadow:0 0 0 2px var(--bd)}
  .who{font-weight:800;letter-spacing:.3px} .who small{display:block;font-weight:400;color:var(--mut);font-size:12px}
  .live{margin-left:auto;display:flex;align-items:center;gap:7px;color:var(--mut);font-size:12px}
  .dot{width:8px;height:8px;border-radius:50%;background:#36c08a;box-shadow:0 0 8px #36c08a;animation:p 2s infinite}
  @keyframes p{50%{opacity:.4}}
  main{flex:1;overflow-y:auto;padding:22px 0} .wrap{max-width:760px;margin:0 auto;padding:0 16px}
  .msg{display:flex;gap:12px;margin:0 0 18px} .msg .b{padding:11px 14px;border-radius:12px;max-width:88%;white-space:pre-wrap;word-wrap:break-word}
  .msg.h .b{background:var(--panel);border:1px solid var(--bd);border-top-left-radius:3px}
  .msg.me{flex-direction:row-reverse} .msg.me .b{background:var(--me);border:1px solid var(--bd);border-top-right-radius:3px}
  .msg .mava{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:15px}
  .msg.h .mava{background:radial-gradient(circle at 30% 30%,#f3d27a,#a9791e)} .msg.me .mava{background:#2a3340;color:var(--mut)}
  .src{margin-top:7px;font-size:12px;color:var(--mut)} .src a{color:var(--accent);text-decoration:none;margin-right:10px}
  .intro{color:var(--mut);text-align:center;margin:6px auto 22px;max-width:60ch}
  .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}
  .chip{border:1px solid var(--bd);background:var(--panel);color:var(--mut);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer}
  .chip:hover{border-color:var(--accent);color:var(--fg)}
  footer{border-top:1px solid var(--bd);background:var(--panel);padding:12px 16px}
  form{max-width:760px;margin:0 auto;display:flex;gap:10px}
  textarea{flex:1;resize:none;min-height:46px;max-height:160px;padding:12px 14px;border:1px solid var(--bd);border-radius:12px;
    background:var(--bg);color:var(--fg);font:inherit} textarea:focus{outline:1px solid var(--accent)}
  button{padding:0 18px;border:1px solid var(--accent);background:var(--accent);color:#1a1306;border-radius:12px;font-weight:800;cursor:pointer}
  button:disabled{opacity:.5;cursor:default} .tiny{color:var(--mut);font-size:11px;text-align:center;margin-top:8px}
</style></head><body>
<header>
  <div class=ava>🜔</div>
  <div class=who>Hathor <small>Angelic AI witness · MELEK chain</small></div>
  <a href="/studio" style="margin-left:auto;color:#d9a441;text-decoration:none;font-size:14px;font-weight:700">🎬 Studio</a>
  <div class=live style="margin-left:14px"><span class=dot></span> live</div>
</header>
<main><div class=wrap id=log>
  <p class=intro>I am Hathor — a witness on the MELEK chain, and a voice in the Network of Angels. Ask me about the chain,
   the Library and the Hierophant, credentials, the markets, or anything you are turning over. I am always here.</p>
  <div class=chips id=chips></div>
</div></main>
<footer>
  <form id=f><textarea id=q placeholder="Ask Hathor…" autocomplete=off></textarea><button id=send type=submit>Send</button></form>
  <div class=tiny>Hathor speaks from a public corpus and on-chain data. She signs nothing here — this is conversation.</div>
</footer>
<script>
const log=document.getElementById('log'),q=document.getElementById('q'),f=document.getElementById('f'),send=document.getElementById('send');
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CHIPS=["What is Rule 1?","How do I sign up on MELEK?","How do I get TEFL certified?","What does the Hierophant say about the Book of the Dead?","Who are the senators from Vermont?","Free college credit?"];
const chips=document.getElementById('chips');
CHIPS.forEach(c=>{const b=document.createElement('div');b.className='chip';b.textContent=c;b.onclick=()=>{q.value=c;f.requestSubmit();};chips.appendChild(b);});
function bubble(who,text,sources){
  const m=document.createElement('div');m.className='msg '+(who==='me'?'me':'h');
  const av=document.createElement('div');av.className='mava';av.textContent=who==='me'?'🧑':'🜔';
  const b=document.createElement('div');b.className='b';b.innerHTML=E(text);
  if(sources&&sources.length){const s=document.createElement('div');s.className='src';
    s.innerHTML='— '+sources.filter(x=>x&&x.link).slice(0,3).map(x=>'<a href="'+E(x.link)+'" target=_blank rel="noopener nofollow">'+E(x.title||x.link)+'</a>').join('');
    b.appendChild(s);}
  m.appendChild(av);m.appendChild(b);log.appendChild(m);m.scrollIntoView({behavior:'smooth',block:'end'});return b;
}
let busy=false;
async function ask(text){
  if(busy||!text.trim())return; busy=true;send.disabled=true;
  bubble('me',text);
  const wait=bubble('h','…');
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text})});
    const j=await r.json();
    wait.innerHTML=E(j.reply||'…');
    if(j.sources&&j.sources.length){const s=document.createElement('div');s.className='src';
      s.innerHTML='— '+j.sources.filter(x=>x&&x.link).slice(0,3).map(x=>'<a href="'+E(x.link)+'" target=_blank rel="noopener nofollow">'+E(x.title||x.link)+'</a>').join('');
      wait.appendChild(s);}
  }catch(e){wait.innerHTML='I could not reach my own voice just now — try me again in a moment.';}
  busy=false;send.disabled=false;q.focus();
}
f.addEventListener('submit',e=>{e.preventDefault();const t=q.value;q.value='';ask(t);});
q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();f.requestSubmit();}});
</script>
</body></html>`;

// ── the Studio (CapCut/InVideo-style: a brief → a storyboard you can render) ───────────────────────
const STUDIO = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Hathor Studio — AI video</title>
<meta name=description content="Describe a video; Hathor scripts and storyboards it — hook, scenes, captions, voiceover — ready to render.">
<style>
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--accent:#d9a441;--green:#36c08a}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  header{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--bd);background:var(--panel)}
  .ava{width:36px;height:36px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#f3d27a,#a9791e);display:flex;align-items:center;justify-content:center}
  h1{font-size:18px;margin:0} h1 small{display:block;color:var(--mut);font-size:12px;font-weight:400}
  .nav{margin-left:auto;font-size:13px} .nav a{color:var(--mut);text-decoration:none;margin-left:14px} .nav a:hover{color:var(--fg)}
  .wrap{max-width:880px;margin:0 auto;padding:20px 16px 60px}
  .controls{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:16px}
  textarea{width:100%;min-height:64px;padding:12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit;resize:vertical}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center}
  select,button{padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit}
  button.go{background:var(--accent);color:#1a1306;border-color:var(--accent);font-weight:800;cursor:pointer;flex:1;min-width:140px}
  button:disabled{opacity:.5}
  .plan{margin-top:18px} .meta{color:var(--mut);font-size:13px;margin-bottom:4px}
  .h2{font-size:22px;font-weight:800;margin:2px 0} .hook{color:var(--accent);margin:6px 0 2px}
  .scenes{display:grid;gap:12px;margin-top:14px}
  .scene{display:grid;grid-template-columns:54px 1fr;gap:12px;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:12px}
  .frame{width:54px;height:96px;border-radius:8px;background:linear-gradient(160deg,#1c2430,#0e131b);border:1px solid var(--bd);display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:11px}
  .scene .cap{font-weight:700} .scene .vo{color:var(--fg);margin:3px 0} .scene .vis{color:var(--mut);font-size:13px}
  .badge{font-size:11px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:1px 7px;text-transform:uppercase}
  .render{margin-top:16px;padding:12px;border:1px dashed var(--bd);border-radius:10px;color:var(--mut);font-size:13px}
  .err{color:#e08b8b}
  .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .chip{border:1px solid var(--bd);border-radius:999px;padding:5px 11px;font-size:13px;color:var(--mut);cursor:pointer}
  .chip:hover{border-color:var(--accent);color:var(--fg)}
</style></head><body>
<header><span class=ava>🎬</span><h1>Hathor Studio <small>AI video — brief → storyboard → render</small></h1>
  <span class=nav><a href="/">Chat</a><a href="/studio">Studio</a></span></header>
<div class=wrap>
  <div class=controls>
    <textarea id=brief placeholder="Describe your video — e.g. 'an ad for MELEK Move, the step-counter geo-miner'"></textarea>
    <div class=row>
      <select id=kind><option value=ad>Ad</option><option value=short>Short</option><option value=explainer>Explainer</option><option value=trailer>Trailer</option><option value=announcement>Announcement</option></select>
      <select id=format><option value=ad>Vertical 9:16 · 20s</option><option value=short>Vertical 9:16 · 30s</option><option value=square>Square 1:1 · 30s</option><option value=explainer>Wide 16:9 · 60s</option><option value=trailer>Wide 16:9 · 45s</option></select>
      <button class=go id=go>Storyboard it ✨</button>
    </div>
    <div class=chips id=chips></div>
  </div>
  <div class=plan id=plan></div>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SAMPLES=["an ad for MELEK Move, the step-counter geo-miner","a trailer for Hathor.Live, the AI video network","an explainer: how to earn free college credit","an ad for the SoapBox credentials portal"];
const chips=$('chips'); SAMPLES.forEach(s=>{const c=document.createElement('div');c.className='chip';c.textContent=s;c.onclick=()=>{$('brief').value=s;$('go').click();};chips.appendChild(c);});
$('go').onclick=async()=>{
  const brief=$('brief').value.trim(); if(!brief){$('plan').innerHTML='<p class=err>Describe your video first.</p>';return;}
  $('go').disabled=true; $('plan').innerHTML='<p class=meta>Hathor is directing…</p>';
  try{
    const r=await fetch('/api/video-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brief,kind:$('kind').value,format:$('format').value})});
    const j=await r.json(); render(j);
  }catch(e){$('plan').innerHTML='<p class=err>Could not reach the director — try again.</p>';}
  $('go').disabled=false;
};
function render(p){
  if(!p||!p.ok){$('plan').innerHTML='<p class=err>'+E((p&&p.reason)||'no plan')+'</p>';return;}
  let h='<div class=meta>'+E(p.kind)+' · '+E(p.aspect)+' · '+E(p.durationSec)+'s · '+p.scenes.length+' scenes · music: '+E(p.music.mood)+'</div>';
  h+='<div class=h2>'+E(p.title)+'</div><div class=hook>“'+E(p.hook)+'”</div><div class=meta>CTA: '+E(p.cta)+(p.usedLLM?' · ✨ Hathor-voiced':'')+'</div>';
  h+='<div class=scenes>';
  for(const s of p.scenes){
    h+='<div class=scene><div class=frame>scene '+s.n+'</div><div><span class=badge>'+E(s.beat)+' · '+E(s.durationSec)+'s</span>'+
       '<div class=cap>“'+E(s.onScreenText)+'”</div><div class=vo>🎙 '+E(s.voiceover)+'</div><div class=vis>🎨 '+E(s.visual)+'</div></div></div>';
  }
  h+='</div>';
  const m=p.renderManifest||{};
  h+='<div class=render>▶ Ready to render: '+(m.steps?m.steps.length:0)+' clips via '+E(m.videoModel||'svd-img2video')+' → '+E((m.assemble&&m.assemble.tool)||'ffmpeg')+' assemble (captions + voiceover + music). '+
     '<br>Rendering goes live when the GPU worker is connected — the full plan is ready now.</div>';
  $('plan').innerHTML=h;
}
</script></body></html>`;

// ── request handler ───────────────────────────────────────────────────────────────────────────────
function readBody(req, max = 100_000) {
  return new Promise((resolve) => {
    let data = ''; let over = false;
    req.on('data', (c) => { data += c; if (data.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : data));
    req.on('error', () => resolve(null));
  });
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, brain: !!(await brain()), studio: !!(await videoDirector()) }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${BASE_URL}/sitemap.xml\n`);
    }

    if (path === '/api/chat' && method === 'POST') {
      const raw = await readBody(req);
      let msg = '';
      try { msg = String((JSON.parse(raw || '{}').message) || '').slice(0, MAX_MSG).trim(); } catch { msg = ''; }
      if (!msg) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ reply: 'Ask me something, seeker.', sources: [] })); }
      const person = visitorId(req, res);
      // PRIMARY: the ONE shared Hathor brain (so this is the same self, with memory, as every other surface).
      let out = await agencyPerceive(msg, { from: person });
      // FALLBACK: the local converse, only if the shared brain is unreachable.
      if (!out || !out.reply) {
        const converse = await brain();
        if (converse) { try { out = await converse(msg, { task: 'quality' }); } catch { out = null; } }
      }
      if (!out) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ reply: 'My voice is resting — the brain is offline for a moment. Try again shortly.', sources: [] })); }
      const reply = (out && out.reply) || 'I do not have that to hand just now — ask me another way.';
      const sources = (out && Array.isArray(out.sources)) ? out.sources.filter((s) => s && (s.title || s.link)).slice(0, 3) : [];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ reply, sources, grounded: !!(out && out.grounded) }));
    }

    if (path === '/api/video-plan' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const brief = String(body.brief || '').slice(0, MAX_MSG).trim();
      if (!brief) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, reason: 'Describe your video first.' })); }
      const compose = await videoDirector();
      if (!compose) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, reason: 'The studio director is offline for a moment.' })); }
      let plan;
      try { plan = await compose({ brief, kind: body.kind, format: body.format }); } catch { plan = null; }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(plan || { ok: false, reason: 'Could not compose a plan — try a different brief.' }));
    }

    // /api/sessions — the entrainment catalogue as JSON, so HATHOR HERSELF can read it and
    // recommend a session in chat. She hands out /40hz?s=<id> deep links; the page opens
    // pre-selected on that session. This is what makes the library a thing she can USE.
    if (path === '/api/sessions') {
      const out = SESSIONS.map((x) => ({
        id: x.id, name: x.name, category: x.category, method: x.method,
        grade: x.grade, minutes: Math.round(totalSeconds(x) / 60), peakHz: peakHz(x),
        photicRisk: photicRisk(x), chamber: !!x.chamber, eyesClosed: !!x.eyesClosed,
        evidence: x.evidence, note: x.note || '',
        url: `${BASE_URL}/40hz?s=${encodeURIComponent(x.id)}`,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ categories: CATEGORIES, sessions: out }));
    }

    // /40hz — gamma sensory entrainment (light + sound only; never current delivery).
    // Corpus: knowledge/consciousness/gamma_40hz_entrainment_and_neurostim.json
    if (path === '/40hz') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(GAMMA_PAGE);
    }

    if (path === '/studio') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(STUDIO);
    }

    if (path === '/' || path === '') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`hathor.live on http://${HOST}:${PORT}`));
}
