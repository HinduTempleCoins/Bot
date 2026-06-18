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

const PORT = +(process.env.PORT || 8140);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || 'https://hathor.live';
const MAX_MSG = 2000;

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
  <div class=live><span class=dot></span> live · always on</div>
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
      return res.end(JSON.stringify({ ok: true, brain: !!(await brain()) }));
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
      const converse = await brain();
      if (!converse) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ reply: 'My voice is resting — the brain is offline for a moment. Try again shortly.', sources: [] })); }
      let out;
      try { out = await converse(msg, { task: 'quality' }); } catch { out = null; }
      const reply = (out && out.reply) || 'I do not have that to hand just now — ask me another way.';
      const sources = (out && Array.isArray(out.sources)) ? out.sources.filter((s) => s && (s.title || s.link)).slice(0, 3) : [];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ reply, sources, grounded: !!(out && out.grounded) }));
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
