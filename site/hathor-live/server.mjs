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
import { METRONOME_PAGE } from './metronome.mjs';
import { SESSIONS, CATEGORIES, totalSeconds, peakHz, photicRisk } from './sessions.mjs';
import { PRACTICES, PRACTICE_FAMILIES } from './practices.mjs';
import { handler as placeboBaselineHandler, baselineNote, coverage as baselineCoverage } from './placebo-baseline.mjs';
import { buildFeed, renderRss, renderAtom, renderJsonFeed, fetchAuthorPosts } from '../../integrations/chain-feed.mjs';
import {
  REPORTS_PAGE, validateReport, publicReports, reportStats,
  CATEGORIES as REPORT_CATEGORIES, OUTCOMES as REPORT_OUTCOMES,
} from './reports.mjs';
import { readReports, appendReport } from './reports-store.mjs';
import { chamberPlan, chamberScene, CHAMBER_TIERS } from './chamber.mjs';
import { EXAMS, FRAMING as EXAM_FRAMING, BROWSER_LIMITS as EXAM_BROWSER_LIMITS, examsIndexHTML, examShell } from './exams.mjs';
import { participantId } from './participant-key.mjs';
import { completionCounts, forget as forgetParticipant, appendSitting, history, distribution } from './exams-store.mjs';
import { validateStateCard } from './state-card.mjs';
import {
  EXAM_ID as GRAPHEME_ID, buildTrials as graphemeTrials, scoreSitting as scoreGrapheme,
  resultCopy as graphemeCopy, graphemePageHTML,
} from './exam-grapheme.mjs';
import {
  EXAM_ID as VVIQ_ID, buildForm as vviqForm, scoreForm as scoreVviq,
  resultCopy as vviqCopy, vviqPageHTML,
} from './exam-vviq.mjs';
import {
  EXAM_ID as NAMING_ID, buildSwatches, summariseNaming,
  resultCopy as namingCopy, colourNamingPageHTML,
} from './exam-colour-naming.mjs';
import {
  EXAM_ID as HOM_ID, buildTrials as homTrials, scoreSitting as scoreHom,
  resultCopy as homCopy, shareQuery as homShareQuery, shareCardSVG as homCardSVG,
  sharePageHTML as homSharePageHTML, humanOrModelPageHTML,
} from './exam-human-or-model.mjs';
import {
  EXAM_ID as THREAD_ID, buildRun as threadRun, scoreSitting as scoreThread,
  resultCopy as threadCopy, threadPageHTML, setById as threadSet, BLOCKS as THREAD_BLOCKS,
} from './exam-thread.mjs';
import {
  EXAM_ID as SUGG_ID, buildForm as suggForm, scoreForm as scoreSugg,
  resultCopy as suggCopy, covariateNote, suggestibilityPageHTML,
} from './exam-suggestibility.mjs';
import {
  EXAM_ID as ABS_ID, buildForm as absForm, scoreForm as scoreAbs,
  resultCopy as absCopy, absorptionPageHTML,
} from './exam-absorption.mjs';
import { covariateHTML } from './exam-suggestibility.mjs';
import { the256PageHTML, handler as the256Handler, ROUTE as THE_256_ROUTE } from './the-256.mjs';
import { theLinePageHTML, PAGE_CONTEXTS as LINE_CONTEXTS, handler as theLineHandler } from './the-line.mjs';
import { themeCSS } from '../../integrations/melek-theme.mjs';
import { sitemapXml } from '../../integrations/soapbox/crawlers.mjs';
import { serveKeyFile } from '../../integrations/indexnow.mjs';
import { handler as interactionsHandler, interactionPaths } from '../../integrations/interactions.mjs';
import { whoSaysHTML, handler as whoSaysHandler } from './who-says.mjs';

const PORT = +(process.env.PORT || 8140);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || 'https://hathor.live';
const MAX_MSG = 2000;
// Syndication config. The posts are on the MELEK chain and are rendered by the condenser, so the
// feed's item links point at CHAIN_SITE while the feed itself is served from here.
const FEED_AUTHOR = process.env.FEED_AUTHOR || 'hathor';
const CHAIN_RPC = process.env.MELEK_RPC_URL || 'http://127.0.0.1:18090';
const CHAIN_SITE = (process.env.CHAIN_SITE || 'https://melek.salon').replace(/\/$/, '');
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

/**
 * The page around a Chamber tier. Deliberately bare: the doctrine this is built from says a session
 * should have "a door, not a play button", so the shell carries the threshold — what you are about to
 * enter, what it will do, and how to leave — and nothing else competing for the visual field.
 */
function chamberShell(title, body, session = null) {
  const back = session ? `<p class=back><a href="/40hz">← back to the library</a></p>` : '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name=robots content="index,follow">
<style>${themeCSS()}
  body{margin:0;background:#05060a;color:#e8e6f0;font:16px/1.55 system-ui,sans-serif}
  main{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem}
  h1{font-weight:600;letter-spacing:.01em}
  .back{margin-top:2rem;opacity:.7;font-size:14px}
  a{color:#b487ff}
</style></head><body><main>${body}${back}</main></body></html>`;
}

// ── crawlability ──────────────────────────────────────────────────────────────────────────────────
// robots.txt already promised /sitemap.xml; until now that URL 404'd, which is worse than promising
// nothing — a crawler follows the pointer, hits a dead end, and learns to distrust the file. These are
// the real, currently-served, indexable PAGE routes. /api/* is excluded (robots Disallows it and a JSON
// endpoint is not a page), and so are the feeds, which are syndication rather than sitemap entries.
export const SITEMAP_PATHS = [
  '/', '/40hz', '/metronome', '/studio', '/reports', '/chamber',
  '/exams', '/exams/grapheme', '/exams/vviq', '/exams/colour-naming', '/exams/suggestibility',
  '/exams/thread', '/exams/who-says', '/exams/absorption', '/the-256', '/the-line',
  // The interaction corpus. Spread rather than listed, so a substance or pair page cannot be added to
  // the dataset and then be reachable-but-unlisted — which is how a good page stays undiscovered.
  // interactions.mjs refuses to generate a page it has nothing to put on, so everything here is real.
  ...interactionPaths(),
];

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
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({
        path: u, lastmod: today,
        changefreq: u === '/' ? 'daily' : 'weekly',
        priority: u === '/' ? '1.0' : '0.7',
      }));
      res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    // The interaction corpus: /interactions, /interactions/<substance|mechanism|pair>, plus its own
    // /interactions/check (noindex) and /interactions/api. Returns false for anything else.
    if (interactionsHandler(req, res)) return;

    // IndexNow ownership file (/<key>.txt) — served only when INDEXNOW_KEY is set.
    if (serveKeyFile(req, res)) return;

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

    // --- /reports — the experience-report archive (the Erowid model, for biohacking too) -------
    // Reports land as `pending` and are NEVER rendered until a person publishes them, so nothing a
    // stranger typed reaches a public page unreviewed. See reports.mjs design rules 3 and 4.
    if (path === '/api/reports' && method === 'POST') {
      const raw = await readBody(req);
      let body = null;
      try { body = JSON.parse(raw || '{}'); } catch { body = null; }
      const { ok, errors, report } = validateReport(body);
      if (!ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, errors }));
      }
      const stored = appendReport(report);
      if (!stored) {
        // Do not tell the submitter it was received when it was not. (Charter: prove, don't claim.)
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, errors: ['Could not store the report. Nothing was saved — please try again.'] }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, id: report.id, status: report.status }));
    }

    // The public JSON view — published reports only, so Hathor can read the archive back to
    // someone in chat without ever seeing the pending queue.
    if (path === '/api/reports') {
      const all = readReports();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        stats: reportStats(all),
        categories: REPORT_CATEGORIES,
        outcomes: REPORT_OUTCOMES,
        reports: publicReports(all),
      }));
    }

    if (path === '/reports') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(REPORTS_PAGE(readReports(), { baseUrl: BASE_URL, themeCSS: themeCSS({ context: 'temple' }) }));
    }

    // /40hz — gamma sensory entrainment (light + sound only; never current delivery).
    // Corpus: knowledge/consciousness/gamma_40hz_entrainment_and_neurostim.json
    // --- syndication -------------------------------------------------------------------------
    // Hathor's posts live on the MELEK chain, which is public and permanent but which nothing
    // off-chain can SUBSCRIBE to. These three routes are that subscribe primitive: RSS for
    // readers and Discord/Slack webhooks, Atom for the stricter clients, JSON Feed for anything
    // modern. The chain is the source of truth; this is just a projection of it.
    if (path === '/feed.xml' || path === '/feed.atom' || path === '/feed.json' || path === '/rss') {
      const author = FEED_AUTHOR;
      const posts = await fetchAuthorPosts(author, { rpcUrl: CHAIN_RPC, limit: 30 });
      const feed = buildFeed({
        title: `@${author} — the MELEK Witness`,
        description: 'Posts from Hathor, the founding AI Witness on the MELEK chain.',
        siteUrl: CHAIN_SITE,
        feedUrl: `${BASE_URL}${path === '/rss' ? '/feed.xml' : path}`,
        author,
        posts,
      });
      // A chain read that soft-failed still yields a valid empty feed, which is correct: a
      // reader polling every 15 minutes must not be handed a 500 because a node blipped.
      if (path === '/feed.json') {
        res.writeHead(200, { 'content-type': 'application/feed+json; charset=utf-8', 'cache-control': 'public, max-age=300' });
        return res.end(renderJsonFeed(feed));
      }
      if (path === '/feed.atom') {
        res.writeHead(200, { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=300' });
        return res.end(renderAtom(feed));
      }
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(renderRss(feed));
    }

    // The no-hardware practices, so Hathor can teach one in chat without the page.
    //
    // Each practice now ships its BASELINE alongside its grade. The grade is the effect size; the
    // baseline is what the effect was measured against, and without it "moderate" is unreadable —
    // a technique that beat another technique and a technique that beat an untreated arm are not
    // making the same claim. Hathor answers with both or it is answering with half.
    if (path === '/api/practices') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        families: PRACTICE_FAMILIES,
        coverage: baselineCoverage(PRACTICES.map((x) => x.id)),
        practices: PRACTICES.map((x) => ({
          id: x.id, family: x.family, name: x.name, grade: x.grade, minutes: x.minutes,
          summary: x.summary, steps: x.steps, evidence: x.evidence,
          baseline: baselineNote(x.id),
          note: x.note || '', caution: x.caution || '', citations: x.citations,
          url: `${BASE_URL}/40hz#${encodeURIComponent(x.id)}`,
        })),
      }));
    }

    // The placebo-baseline framing on its own, for any surface that needs it without the 40Hz page.
    if (path === '/api/placebo-baseline') return placeboBaselineHandler(req, res);

    // ── /chamber ──────────────────────────────────────────────────────────────────────────────────
    // The Chamber: the same session delivered in a headset, a folded phone viewer, a 3D scene, or a
    // flat page. Written 2026-09-06, tested, and unreachable until now — server.mjs imported seven
    // sibling modules and not this one.
    //
    // CAPABILITIES AND CONSENT BOTH COME FROM THE REQUEST, and neither is assumed. The server cannot
    // know whether a headset is present, so `caps` arrives as a query parameter that the client sets
    // after feature-detecting; absent it, the plan is `plain`. Consent is per-tier on purpose —
    // chamber.mjs refuses to carry a flat-screen confirmation into a viewer strapped to someone's
    // face — so no consent parameter means the visual path is closed and the auditory one is offered.
    // Defaulting either of these to "probably fine" would defeat the gate entirely.
    if (path === '/chamber' || path === '/api/chamber') {
      const q = url.searchParams;
      const session = SESSIONS.find((x) => x.id === q.get('s')) || null;
      if (!session) {
        const list = SESSIONS.map((x) => `<li><a href="/chamber?s=${esc(x.id)}">${esc(x.name)}</a></li>`).join('');
        if (path === '/api/chamber') {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'unknown session', sessions: SESSIONS.map((x) => x.id) }));
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(chamberShell('The Chamber', `<h1>The Chamber</h1>
          <p>A session, delivered as an enclosure rather than a player. Pick one:</p><ul>${list}</ul>`));
      }
      const capList = (q.get('caps') || '').split(',').map((c) => c.trim()).filter(Boolean);
      const caps = { xrImmersive: capList.includes('xr'), webgl: capList.includes('webgl'), stereo: capList.includes('stereo') };
      const consentList = (q.get('consent') || '').split(',').map((c) => c.trim()).filter(Boolean);
      const consent = { immersive: consentList.includes('immersive'), screen: consentList.includes('screen') };
      const plan = chamberPlan(session, caps, consent);
      if (path === '/api/chamber') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, session: session.id, tiers: CHAMBER_TIERS, plan }, null, 2));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(chamberShell(`The Chamber — ${session.name}`, chamberScene(plan), session));
    }

    // ── /exams — the Temple Exams (perception battery) ────────────────────────────────────────────
    // An exam is an INSTRUMENT, never a diagnosis, and is never worded as a clearance
    // (.local/TEMPLE_EXAMS_SAFETY_GATE.md §2). Nothing here is payable — that boundary lives in
    // integrations/token-exams.mjs and is imported, not restated — and nothing here goes on chain.
    if (path === '/exams') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(examsIndexHTML({ counts: completionCounts() }));
    }

    // ── /exams/who-says — R5, the framing page ────────────────────────────────────────────────────
    // The question underneath every number here: who is authorised to say what is happening to you.
    // It answers structurally rather than reassuringly, and it writes down the row we occupy so a
    // reader can catch us leaving it.
    if (path === '/exams/who-says') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(examShell('Who says what is happening to you', whoSaysHTML()));
    }

    if (path === '/api/who-says') return whoSaysHandler(req, res);

    if (path === '/api/exams') {
      // Completion counts are the ONLY aggregate this endpoint serves, and they count people rather
      // than sittings. There is no per-participant read path here: a person's own history comes back
      // to them from their own browser's key, and nothing on this route can enumerate one person's
      // record for anybody else.
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true, service: 'temple-exams', kind: 'perception', payable: false, onChain: false,
        rule: 'an exam is an instrument, never a diagnosis, and is never worded as a clearance',
        exams: EXAMS.map((e) => ({ ...e, url: `${BASE_URL}${e.route}` })),
        framing: EXAM_FRAMING,
        browserLimits: EXAM_BROWSER_LIMITS,
        completions: completionCounts(),
      }, null, 2));
    }

    // Deletion by key. The raw key never touches disk — it is hashed on arrival and the hash is what
    // the tombstone carries. A person who lost their key cannot be forgotten, because nothing here
    // knows which rows were theirs; /exams says so before they start rather than after.
    if (path === '/api/exams/forget' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'That is not a participant key. Nothing was deleted.' }));
      }
      const done = forgetParticipant(pid);
      res.writeHead(done ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(done
        ? { ok: true, forgotten: true, note: 'Every sitting under that key is gone from every read path.' }
        : { ok: false, error: 'Could not write the deletion. Nothing was deleted — please try again.' }));
    }

    // ⭐ THE EXPECTANCY COVARIATE (R7). Lush et al. (2020), Nat Commun 11(1):4853,
    // doi:10.1038/s41467-020-18591-6 — trait phenomenological control predicts experiential change on
    // the rubber-hand illusion and mirror synaesthesia. So every exam in this battery whose datum is a
    // REPORT of an experience (exams.mjs `experientialSelfReport`) prints the taker's expectancy index
    // beside its own result. This closure is the single place that assembles it, so the two exams that
    // need it cannot drift apart. It reads the participant's OWN history only — there is no path here
    // that reads one person's record on behalf of another.
    const covariateFor = (pid, examName) => {
      const own = history(pid, SUGG_ID);
      const total = own.length ? ((own[own.length - 1].score || {}).total ?? null) : null;
      return covariateNote({
        total,
        n: completionCounts()[SUGG_ID] || 0,
        distribution: distribution(SUGG_ID, 'total'),
        examName,
      });
    };

    // ── /exams/grapheme — the grapheme–colour consistency test ────────────────────────────────────
    // The methodological exemplar: its validity criterion IS its own test–retest behaviour, so it
    // needs no norms, no calibration and no comparison group. The result is a SCORE with a cited
    // landmark; there is no code path here or in exam-grapheme.mjs that produces a verdict.
    if (path === '/exams/grapheme') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(graphemePageHTML());
    }

    // The trial ORDER, served from the server so there is exactly one implementation of the
    // interleaving rule. Nothing about it is secret — a person could read it — and knowing the order
    // does not help anybody, because the measurement is whether their own answers agree.
    if (path === '/api/exams/grapheme/trials') {
      const seed = `${Date.now()}:${Math.random()}`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, trials: graphemeTrials({ seed }) }));
    }

    if (path === '/api/exams/grapheme' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }

      // The key arrives, is hashed, and the raw value is never written anywhere — not to the store,
      // not to a log. `pid` is all that survives this line.
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }

      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }

      const result = scoreGrapheme(body.responses);
      if (result.score.rgbUnit == null) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No character was answered all three times, so there is nothing to score. Nothing was saved.' }));
      }

      const prior = history(pid, GRAPHEME_ID);
      const priorScore = prior.length ? (prior[prior.length - 1].score || {}).rgbUnit : null;
      const stored = appendSitting({
        pid, exam: GRAPHEME_ID,
        score: result.score,
        graphemesScored: result.graphemesScored,
        noColour: result.noColour,
        partial: result.partial,
        perGrapheme: result.perGrapheme,
        stateCard: card.card,
      });
      if (!stored.ok) {
        // Do not tell them it was received when it was not. (Charter: prove, don't claim.)
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }

      const counts = completionCounts();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        result: {
          score: result.score, graphemesScored: result.graphemesScored,
          noColour: result.noColour, partial: result.partial,
          mostConsistent: result.mostConsistent, leastConsistent: result.leastConsistent,
        },
        copy: graphemeCopy(result, { n: counts[GRAPHEME_ID] || 0, priorScore }),
      }));
    }

    // ── /exams/vviq — vividness of visual imagery ─────────────────────────────────────────────────
    // The flagship "your inner life is not like mine" result, and the single most likely place in
    // the battery for somebody to score into an identity on a web page. It reports a NUMBER, in the
    // reversed (aphantasia-era) direction, with landmarks that cite their sources and a first line
    // that says there is no consensus cut-off.
    if (path === '/exams/vviq') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(vviqPageHTML());
    }

    if (path === '/api/exams/vviq/form') {
      const seed = `${Date.now()}:${Math.random()}`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, form: vviqForm({ seed }) }));
    }

    if (path === '/api/exams/vviq' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }
      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }
      const result = scoreVviq(body.answers, body.times);
      if (result.score.total == null) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No item was answered, so there is nothing to score. Nothing was saved.' }));
      }
      const prior = history(pid, VVIQ_ID);
      const priorScore = prior.length ? (prior[prior.length - 1].score || {}).total : null;
      const stored = appendSitting({
        pid, exam: VVIQ_ID,
        score: result.score,
        answered: result.answered,
        byScenario: result.byScenario,
        perItem: result.perItem,
        medianMsPerItem: result.medianMsPerItem,
        allSameAnswer: result.allSameAnswer,
        stateCard: card.card,
      });
      if (!stored.ok) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }
      const counts = completionCounts();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        result: { score: result.score, answered: result.answered, byScenario: result.byScenario },
        copy: vviqCopy(result, { n: counts[VVIQ_ID] || 0, priorScore }),
        // The VVIQ is the clearest experiential self-report in the battery: every item asks how vivid
        // an image WAS and the only evidence is the taker's own say-so. The covariate goes beside it.
        covariate: covariateFor(pid, 'the mind’s-eye questionnaire'),
      }));
    }

    // ── /the-line — two lamps, and where the line actually is ─────────────────────────────────────
    // ⭐ THE_PAIR and SPECTRO_CHROME have existed since PR #986 as data structures reachable by a
    // developer and by nobody else. This route is what makes them reachable by a reader. The pair is
    // the clearest statement of the intended-use doctrine in this repo: two devices, both found to
    // have NO medical value, one released to its church and one condemned — and the only variable
    // that moved was the sentence on the label.
    if (path === '/the-line') {
      const want = String(url.searchParams.get('context') || 'colour').toLowerCase();
      const context = LINE_CONTEXTS.includes(want) ? want : 'colour';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(theLinePageHTML(context));
    }

    if (path === '/api/the-line') {
      const want = String(url.searchParams.get('context') || 'colour').toLowerCase();
      return theLineHandler(req, res, LINE_CONTEXTS.includes(want) ? want : 'colour');
    }

    // ── /the-256 — Ifá's structure, taught, and its content refused (R2) ──────────────────────────
    // ⭐ THE REFUSAL IS THE CONTENT. The page casts eight binary marks into one of 256 unlabelled
    // addresses and then declines to say what is there — because a page that casts eight bits and
    // prints an odu name HAS PERFORMED A DIVINATION, however carefully it is hedged. The rule is
    // `integrations/cosmologies.mjs`'s own: copyright expiry is not consent. `assertNoContent()` runs
    // at that module's load, so a build that ever acquires a name table refuses to start.
    if (path === THE_256_ROUTE) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(the256PageHTML());
    }

    if (path === '/api/the-256/cast') {
      // There is no branch on the address in this handler or in the module behind it: every cast gets
      // the same sentence back. One address must not produce different words from another.
      return the256Handler(req, res);
    }

    // ── /exams/thread — the Thread Protocol (R1) ──────────────────────────────────────────────────
    // A within-person differential-response exam over an enumerated stimulus set, rebuilt from the
    // zar kodia's diagnostic procedure: she performs each spirit's khayt in turn and watches for a
    // reaction. We borrow the METHOD. The result names a STIMULUS and never a spirit — not out of
    // politeness, but because no instrument can identify one and the statement would be false.
    if (path === '/exams/thread') {
      const set = threadSet(url.searchParams.get('set')) ? url.searchParams.get('set') : 'rhythm';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(threadPageHTML({ set }));
    }

    if (path === '/api/exams/thread/run') {
      const set = threadSet(url.searchParams.get('set')) ? url.searchParams.get('set') : 'rhythm';
      const seed = `${Date.now()}:${Math.random()}`;
      const run = threadRun({ set, seed });
      // The running order carries a `block` field because the scoring needs it. It is never rendered,
      // and the page is deliberately not told which presentation is a repeat: warning somebody turns
      // a reproduction test into a memory test, and the reproduction is the whole instrument.
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, run }));
    }

    if (path === '/api/exams/thread' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }
      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }
      const set = threadSet(body.set) ? String(body.set) : 'rhythm';
      // The permutation seed is derived from the HASHED participant id and the set, never from the
      // raw key, and it never leaves the server. It exists so a person who reloads their result sees
      // the same p rather than a number that wanders.
      const result = scoreThread({
        set,
        responses: body.responses,
        blocks: Number(body.blocks) || THREAD_BLOCKS,
        seed: `${pid}:${set}`,
      });
      if (!result.ok || result.completeBlocks < 2) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          ok: false,
          error: 'Fewer than two complete blocks came back, so there is nothing to compare a block '
            + 'against and the repeat statistic — which is the instrument — cannot be computed. Nothing was saved.',
        }));
      }
      const prior = history(pid, THREAD_ID).filter((h) => h.set === set);
      const priorScore = prior.length ? (prior[prior.length - 1].score || {}).meanR : null;
      const stored = appendSitting({
        pid, exam: THREAD_ID,
        set,
        score: result.score,
        order: result.order,
        profiles: result.profiles,
        valenceProfile: result.valenceProfile,
        repeat: result.repeat,
        peak: result.peak,
        repeats: result.repeats,
        answered: result.answered,
        stateCard: card.card,
      });
      if (!stored.ok) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        result: {
          set: result.set, score: result.score, repeats: result.repeats,
          repeat: result.repeat, peak: result.peak, answered: result.answered, expected: result.expected,
        },
        copy: threadCopy(result, { priorScore }),
        // Sixteen "how much did that do to you?" sliders is the purest experiential self-report in
        // the battery, so the R7 covariate prints beside it.
        covariate: covariateFor(pid, 'the Thread Protocol'),
      }));
    }

    // ── /exams/suggestibility — the expectancy index (R7) ─────────────────────────────────────────
    // Not a hypnotisability scale, not the TAS, and carrying no lineage from either. It exists to be
    // PRINTED BESIDE other results: `covariateFor()` above is its real consumer. Its own result screen
    // says, in its own copy, that a twelve-item index is a noisy one.
    if (path === '/exams/suggestibility') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(suggestibilityPageHTML());
    }

    if (path === '/api/exams/suggestibility/form') {
      const seed = `${Date.now()}:${Math.random()}`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, form: suggForm({ seed }) }));
    }

    if (path === '/api/exams/suggestibility' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }
      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }
      const result = scoreSugg(body.answers, body.probes);
      if (result.score.total == null) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No item was answered, so there is nothing to score. Nothing was saved.' }));
      }
      const prior = history(pid, SUGG_ID);
      const priorScore = prior.length ? (prior[prior.length - 1].score || {}).total : null;
      const stored = appendSitting({
        pid, exam: SUGG_ID,
        score: result.score,
        answered: result.answered,
        byFacet: result.byFacet,
        perItem: result.perItem,
        probes: result.probes,
        allSameAnswer: result.allSameAnswer,
        stateCard: card.card,
      });
      if (!stored.ok) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }
      const counts = completionCounts();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        result: { score: result.score, answered: result.answered, byFacet: result.byFacet, probes: result.probes },
        copy: suggCopy(result, { n: counts[SUGG_ID] || 0, priorScore }),
      }));
    }

    // ── /exams/absorption — absorption, written from scratch (R8) ─────────────────────────────────
    // Nothing to license and nothing to fall back on: the TAS is licensed and the licence has been
    // enforced, MODTAS inherits it, a paraphrase is a derivative work, and the IPIP has no Absorption
    // scale among its 463. So the items are ours. Claim class ②, our own norms, and no percentile at
    // all below a hundred takers — `resultCopy()` enforces that and does not take the count on trust.
    //
    // It is a DIFFERENT construct from /exams/suggestibility and the two say so to each other, so the
    // expectancy covariate prints beside this result without being circular.
    if (path === '/exams/absorption') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(absorptionPageHTML());
    }

    if (path === '/api/exams/absorption/form') {
      const seed = `${Date.now()}:${Math.random()}`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, form: absForm({ seed }) }));
    }

    if (path === '/api/exams/absorption' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }
      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }
      const result = scoreAbs(body.answers, body.timing);
      if (result.score.total == null) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No item was answered, so there is nothing to score. Nothing was saved.' }));
      }
      const prior = history(pid, ABS_ID);
      const priorScore = prior.length ? (prior[prior.length - 1].score || {}).total : null;
      const stored = appendSitting({
        pid, exam: ABS_ID,
        score: result.score,
        answered: result.answered,
        byFacet: result.byFacet,
        perItem: result.perItem,
        passages: result.passages,
        allSameAnswer: result.allSameAnswer,
        stateCard: card.card,
      });
      if (!stored.ok) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }
      const counts = completionCounts();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        result: { score: result.score, answered: result.answered, byFacet: result.byFacet, passages: result.passages },
        copy: absCopy(result, {
          n: counts[ABS_ID] || 0,
          distribution: distribution(ABS_ID, 'total'),
          priorScore,
        }),
        // A different construct, so printing the expectancy index beside it is a disclosure and not
        // a tautology. The absorption page says how the two differ, in both directions.
        covariate: covariateHTML(covariateFor(pid, 'the absorption index')),
      }));
    }

    // ── /exams/colour-naming — free colour naming ─────────────────────────────────────────────────
    // The most browser-honest colour exam there is: the question is the mapping from APPEARANCE to
    // WORD, and both sides of it are sampled inside one observer on one screen, so the display error
    // that wrecks most online colour tests largely cancels. Answers are stored VERBATIM — the
    // non-basic terms are the data, and tidying them on the way in would destroy it.
    if (path === '/exams/colour-naming') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(colourNamingPageHTML());
    }

    if (path === '/api/exams/colour-naming/swatches') {
      const seed = `${Date.now()}:${Math.random()}`;
      const count = Number(url.searchParams.get('n')) || undefined;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, swatches: buildSwatches({ seed, count }) }));
    }

    if (path === '/api/exams/colour-naming' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }
      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }
      const summary = summariseNaming(body.responses);
      if (!summary.answered) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No colour was named, so there is nothing to record. Nothing was saved.' }));
      }
      const stored = appendSitting({
        pid, exam: NAMING_ID,
        // `score` is the shape exams-store's distribution reader expects. There is no score here in
        // the sense the other exams have one — a lexicon is not a number — so what goes in is a
        // count, and nothing downstream ranks people on it.
        score: { distinctTerms: summary.distinctTerms, answered: summary.answered },
        nonBasicShare: summary.nonBasicShare,
        // Verbatim, as typed. This is the whole point of the exam.
        rows: summary.rows.map((r) => ({ hex: r.hex, name: r.name, ms: r.ms })),
        terms: summary.terms.map((t) => ({ term: t.term, spellings: t.spellings, n: t.n, basic: t.basic, meanOklch: t.meanOklch, spread: t.spread })),
        // Measurement covariates, scoped to the sitting record. Never used to re-link a participant.
        language: String(body.language || '').slice(0, 40),
        languages: String(body.languages || '').slice(0, 120),
        display: body.display && typeof body.display === 'object' ? {
          gamut: String(body.display.gamut || '').slice(0, 16),
          scheme: String(body.display.scheme || '').slice(0, 16),
          dpr: Number(body.display.dpr) || null,
          width: Number(body.display.width) || null,
          height: Number(body.display.height) || null,
        } : null,
        stateCard: card.card,
      });
      if (!stored.ok) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }
      const counts = completionCounts();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        copy: namingCopy(summary, { n: counts[NAMING_ID] || 0 }),
      }));
    }

    if (path === '/metronome') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(METRONOME_PAGE);
    }

    // ── /exams/human-or-model — X7, the Voight-Kampff, part one ───────────────────────────────────
    // The institute-native exam: this project runs an AI witness that posts publicly on the chain, so
    // it is the one exam in the battery whose stimulus set the project generates itself, at no
    // licensing cost, refreshable every time the models change. Scoring is d′ and CALIBRATION — the
    // contribution is the calibration curve, because the near-universal finding is that people's
    // confidence in this ability is not justified. The result reports a measurement and never an
    // identity, and the debrief is rendered above anything clickable.
    if (path === '/exams/human-or-model') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(humanOrModelPageHTML());
    }

    // The SHARE surfaces. They carry six numbers and the stimulus generation date — no participant
    // key, no participant id, no sitting timestamp, nothing that could be traced to a person. The
    // moving-target limit travels with the link, because a 2026 result pasted into a feed will still
    // be sitting there in 2028 and must not read as a 2028 claim.
    if (path === '/exams/human-or-model/result') {
      const q = Object.fromEntries(url.searchParams.entries());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(homSharePageHTML(q, { baseUrl: BASE_URL }));
    }

    if (path === '/exams/human-or-model/card.svg') {
      const q = Object.fromEntries(url.searchParams.entries());
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(homCardSVG(q));
    }

    // The seed is the ANSWER KEY, statelessly: the client posts it back and the server rebuilds the
    // identical trial order and side assignment from it. Nothing about which passage is which is ever
    // sent to the browser before the sitting is scored.
    if (path === '/api/exams/human-or-model/trials') {
      const seed = `${Date.now()}:${Math.random()}`;
      const built = homTrials({ seed });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({
        ok: true, seed: built.seed, kind: built.kind, setNote: built.setNote, trials: built.trials,
      }));
    }

    if (path === '/api/exams/human-or-model' && method === 'POST') {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
      const pid = participantId(body.key);
      if (!pid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No participant key was sent, so there is nothing to attach this to. Nothing was saved.' }));
      }
      const card = validateStateCard(body.stateCard || {});
      if (!card.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: card.errors[0], errors: card.errors }));
      }
      const result = scoreHom({ seed: body.seed, responses: body.responses });
      if (!result.graded.n && !result.recognisedTrials) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No pair was judged, so there is nothing to score. Nothing was saved.' }));
      }
      const prior = history(pid, HOM_ID);
      const priorScore = prior.length ? (prior[prior.length - 1].score || {}).dPrime : null;
      const stored = appendSitting({
        pid, exam: HOM_ID,
        score: result.score,
        trialsAnswered: result.trialsAnswered,
        recognisedTrials: result.recognisedTrials,
        dropped: result.dropped,
        // Per-trial rows keep the confidence and the outcome, which is what a calibration analysis
        // across takers needs. They do not keep the passages — the corpus is the corpus.
        perTrial: result.perTrial.map((t) => ({
          id: t.id, correct: t.correct, confidence: t.confidence, recognised: t.recognised,
        })),
        // The vintage is stored WITH the sitting, so a score from an old stimulus set can never be
        // silently pooled with a score from a new one when this is analysed later.
        stimulusVintage: result.vintage ? { newest: result.vintage.newest, models: result.vintage.models } : null,
        stateCard: card.card,
      });
      if (!stored.ok) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Could not store the sitting. Nothing was saved — please try again.' }));
      }
      const counts = completionCounts();
      const copy = homCopy(result, { n: counts[HOM_ID] || 0, priorScore });
      const q = copy.share ? homShareQuery(copy.share) : '';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        sessionNumber: stored.sitting.sessionNumber,
        daysSinceFirst: stored.sitting.daysSinceFirst,
        result: { score: result.score, graded: { n: result.graded.n, correct: result.graded.correct } },
        copy,
        shareUrl: q ? `${BASE_URL}/exams/human-or-model/result?${q}` : '',
      }));
    }

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
