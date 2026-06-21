// site/servers/server.mjs — servers.soapbox.community: the Van Kush / SoapBox Community game-server hub.
//
// Operator (2026-06-20): "do like servers.soapbox.community and we can have like live feeds and the
// info to join." This is the front door: every community game server in one place, each with a LIVE
// status feed (is it up? who's on? MOTD — via the keyless reader in integrations/minecraft.mjs) and
// the info to JOIN (address, edition, version, copy button), plus a link to the documentary-cam POV
// feed when one is running (integrations/games/documentary-camera.mjs → prismarine-viewer).
//
// HOST PRIVACY (load-bearing): the real server addresses are NOT hardcoded here — the public repo must
// not leak infrastructure (pre-commit hook). The server list is injected at deploy time via the
// MELEK_SERVERS_JSON env var (a JSON array). With nothing set, the page renders a SAFE example list
// (example.com placeholders) so the module is testable and the page never ships a real host by accident.
//
// House style: ESM, esc() all interpolation, keyless + soft-fail (the status reader never throws),
// handler(req,res) exported for tests, CLI guarded by process.argv[1]. Status fetch is injectable
// (minecraft.mjs __setFetch) so tests run fully offline.
//
//   PORT=8156 node site/servers/server.mjs
//   import { handler, loadServers } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { serverStatus } from '../../integrations/minecraft.mjs';

const PORT = +(process.env.PORT || 8156);
const HOST = process.env.HOST || '127.0.0.1';
const DISCORD_URL = process.env.SOAPBOX_DISCORD_URL || 'https://discord.gg/soapbox';
const REFRESH_MS = Math.max(5000, +(process.env.SERVERS_REFRESH_MS || 15000));   // live-feed poll cadence

// ── server list (env-injected; safe example fallback so no real host ships in the repo) ─────────────
const EXAMPLE_SERVERS = [
  { id: 'survival', name: 'SoapBox Survival', game: 'Minecraft: Java', edition: 'java',
    host: 'play.example.com', version: '1.21.x', desc: 'The flagship survival world — build, mine, and explore with the community. Hathor plays here; the documentary cam roams.',
    cam: '', tags: ['survival', 'community', 'hathor'] },
  { id: 'creative', name: 'SoapBox Creative', game: 'Minecraft: Java', edition: 'java',
    host: 'creative.example.com', version: '1.21.x', desc: 'Flat creative plots — temple builds, redstone, and showcases.',
    cam: '', tags: ['creative'] },
  { id: 'luanti', name: 'Van Kush Luanti', game: 'Luanti (Minetest)', edition: 'java',
    host: 'luanti.example.com:30000', version: '5.x', desc: 'Open-source voxel sandbox (Luanti / Minetest) — build and explore.',
    cam: '', tags: ['open-source'] },
];

// Parse + sanitize one server record into a stable shape (drops anything without an id + host).
function cleanServer(s) {
  if (!s || typeof s !== 'object' || !s.id || !s.host) return null;
  const id = String(s.id).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!id) return null;
  return {
    id,
    name: String(s.name || id),
    game: String(s.game || 'Minecraft: Java'),
    edition: String(s.edition || 'java').toLowerCase() === 'bedrock' ? 'bedrock' : 'java',
    host: String(s.host).slice(0, 120),
    version: s.version != null ? String(s.version) : '',
    desc: s.desc != null ? String(s.desc) : '',
    cam: s.cam != null ? String(s.cam) : '',
    tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t)).slice(0, 8) : [],
  };
}

/** The configured server list (env MELEK_SERVERS_JSON → array), or the safe example list. Never throws. */
export function loadServers() {
  const raw = process.env.MELEK_SERVERS_JSON;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) { const out = arr.map(cleanServer).filter(Boolean); if (out.length) return out; }
    } catch { /* fall through to example list */ }
  }
  return EXAMPLE_SERVERS.map(cleanServer).filter(Boolean);
}
function serverById(id) { return loadServers().find((s) => s.id === String(id || '').toLowerCase()) || null; }

// ── html ────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function card(s) {
  const join = s.edition === 'bedrock' ? 'Add it in Minecraft Bedrock → Servers → Add Server' : 'In Minecraft Java → Multiplayer → Add Server, paste the address';
  return `<div class=card data-id="${esc(s.id)}">
  <div class=top>
    <div><h2>${esc(s.name)}</h2><div class=game>${esc(s.game)}${s.version ? ` · ${esc(s.version)}` : ''}</div></div>
    <span class="badge" id="b-${esc(s.id)}" data-st=loading>checking…</span>
  </div>
  ${s.desc ? `<p class=desc>${esc(s.desc)}</p>` : ''}
  <a class=preview href="/watch/${esc(s.id)}" title="Open the full screen">
    ${s.cam
      ? `<iframe class=pv src="${esc(s.cam)}" loading=lazy scrolling=no tabindex=-1 title="${esc(s.name)} live camera"></iframe><span class="plabel live">📹 LIVE · click to watch full screen</span>`
      : `<span class=pvph>🎥</span><span class=plabel>Open the live screen</span>`}
  </a>
  <div class=feed id="f-${esc(s.id)}">live feed loading…</div>
  <div class=join>
    <label>Server address</label>
    <div class=addr><code id="a-${esc(s.id)}">${esc(s.host)}</code><button class=copy data-host="${esc(s.host)}" type=button>Copy</button></div>
    <div class=hint>${esc(join)}.</div>
  </div>
  <div class=row>
    <a class=btn href="/watch/${esc(s.id)}">${s.cam ? '📹 Watch full screen' : '🖥️ Open screen'}</a>
    <a class="btn ghost" href="${esc(DISCORD_URL)}" target=_blank rel=noopener>💬 Community Discord</a>
  </div>
  ${s.tags.length ? `<div class=tags>${s.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
</div>`;
}

function page() {
  const servers = loadServers();
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Servers · SoapBox Community</title>
<meta name=description content="Live status and join info for every SoapBox Community game server — Minecraft and more.">
<style>
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
  .wrap{max-width:920px;margin:0 auto}
  header{display:flex;align-items:center;gap:10px;margin:6px 0 16px}
  .brand{font-size:22px;font-weight:800} .brand b{color:var(--gold)}
  .alpha{font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
  .lead{color:var(--mut);font-size:14px;margin:0 0 16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
  .card{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:16px}
  .top{display:flex;align-items:flex-start;gap:10px} .top>div:first-child{flex:1}
  h2{font-size:17px;margin:0} .game{color:var(--mut);font-size:12px;margin-top:2px}
  .badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap}
  .badge[data-st=online]{color:var(--green);border-color:var(--green)} .badge[data-st=offline]{color:var(--red);border-color:var(--red)}
  .desc{color:var(--fg);font-size:13px;margin:10px 0} .feed{font-size:13px;color:var(--mut);min-height:20px;margin:8px 0 12px}
  .feed b{color:var(--fg)} .feed .motd{color:var(--blue);font-style:italic}
  .preview{position:relative;display:block;height:170px;border-radius:12px;overflow:hidden;border:1px solid var(--bd);background:#0a0e15 radial-gradient(circle at 50% 40%,#16202e,#0a0e15);margin:10px 0;text-decoration:none}
  .preview .pv{width:100%;height:100%;border:0;pointer-events:none;background:#0a0e15}
  .preview .pvph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;opacity:.5}
  .preview .plabel{position:absolute;left:0;right:0;bottom:0;padding:7px 10px;font-size:12px;font-weight:700;color:var(--fg);background:linear-gradient(transparent,rgba(0,0,0,.75))}
  .preview .plabel.live{color:#fff} .preview .plabel.live::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-right:6px;vertical-align:middle;box-shadow:0 0 0 0 rgba(224,139,139,.7);animation:lp 1.6s infinite}
  @keyframes lp{0%{box-shadow:0 0 0 0 rgba(224,139,139,.6)}70%{box-shadow:0 0 0 7px rgba(224,139,139,0)}100%{box-shadow:0 0 0 0 rgba(224,139,139,0)}}
  .preview:hover{border-color:var(--gold)}
  .join{background:#0e131b;border:1px solid var(--bd);border-radius:12px;padding:10px;margin-bottom:10px}
  label{font-size:11px;color:var(--mut);display:block;margin-bottom:5px}
  .addr{display:flex;gap:8px;align-items:center} code{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--gold);flex:1;word-break:break-all}
  button,.btn{font:inherit;font-weight:700;border-radius:10px;cursor:pointer;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 12px;text-decoration:none;display:inline-block}
  .copy{padding:6px 10px;font-size:12px} .row{display:flex;gap:8px;flex-wrap:wrap} .btn{flex:1;text-align:center;min-width:130px} .btn.ghost{color:var(--mut)}
  .hint{font-size:11px;color:var(--mut);margin-top:6px}
  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px} .tags span{font-size:10px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:2px 7px}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:24px 0 8px} a{color:var(--gold)}
</style></head><body><div class=wrap>
<header><span class=brand><b>SoapBox</b> Servers</span><span class=alpha>Alpha</span></header>
<p class=lead>Live status and join info for our community game servers. Pick one, copy the address, and hop in.</p>
<div class=grid>${servers.map(card).join('')}</div>
<footer>Live feeds refresh every ${Math.round(REFRESH_MS / 1000)}s · status read from public server pings (no game automation) ·
  the in-world documentary cam is an openly-labeled AI film crew. <a href="${esc(DISCORD_URL)}" target=_blank rel=noopener>Join the Discord →</a></footer>
</div>
<script>
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const REFRESH=${REFRESH_MS};
async function poll(id){
  try{
    const r=await fetch('/api/status?id='+encodeURIComponent(id),{cache:'no-store'});
    const j=await r.json(); const b=document.getElementById('b-'+id), f=document.getElementById('f-'+id);
    if(!b||!f) return; const s=j&&j.status;
    if(s&&s.online){
      b.dataset.st='online'; b.textContent='● Online';
      const po=s.players&&s.players.online!=null?s.players.online:'—', pm=s.players&&s.players.max!=null?(' / '+E(s.players.max)):'';
      let h='<b>'+E(po)+pm+'</b> player'+(po===1?'':'s')+' online';
      if(s.version) h+=' · '+E(s.version);
      if(s.motd) h+='<br><span class=motd>“'+E(String(s.motd).replace(/\\s+/g,' ').trim())+'”</span>';
      f.innerHTML=h;
    }else{
      b.dataset.st='offline'; b.textContent='● Offline';
      f.innerHTML='Server is offline or starting up — try the Discord for status.';
    }
  }catch(e){ const b=document.getElementById('b-'+id); if(b){b.dataset.st='offline';b.textContent='● Unknown';} }
}
function pollAll(){ document.querySelectorAll('.card').forEach(c=>poll(c.dataset.id)); }
document.addEventListener('click',e=>{ const btn=e.target.closest('.copy'); if(!btn)return;
  const host=btn.getAttribute('data-host')||''; (navigator.clipboard?navigator.clipboard.writeText(host):Promise.reject())
    .then(()=>{const o=btn.textContent;btn.textContent='Copied!';setTimeout(()=>btn.textContent=o,1200);}).catch(()=>{}); });
pollAll(); setInterval(pollAll, REFRESH);
</script></body></html>`;
}

// Full-screen "watch this server" page — the whole screen for one server. The camera POV fills the stage
// (when a cam URL is configured); the live status + join address sit beneath. Reached by clicking a card's
// preview or its "Watch full screen" button (/watch/:id).
function watchPage(s) {
  const join = s.edition === 'bedrock' ? 'Add it in Minecraft Bedrock → Servers → Add Server' : 'In Minecraft Java → Multiplayer → Add Server, paste the address';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(s.name)} · SoapBox Servers</title>
<style>
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  header{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bd)}
  .back{color:var(--gold);text-decoration:none;font-weight:700;white-space:nowrap} h1{font-size:18px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap}
  .badge[data-st=online]{color:var(--green);border-color:var(--green)} .badge[data-st=offline]{color:var(--red);border-color:var(--red)}
  .stage{position:relative;width:100%;height:62vh;min-height:340px;background:#0a0e15 radial-gradient(circle at 50% 38%,#16202e,#0a0e15);border-bottom:1px solid var(--bd)}
  .stage iframe{width:100%;height:100%;border:0;display:block}
  .stage .none{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;color:var(--mut);text-align:center;padding:20px}
  .stage .none b{color:var(--fg);font-size:18px}
  .info{max-width:920px;margin:0 auto;padding:16px}
  .feed{color:var(--mut);font-size:14px;margin:0 0 14px} .feed b{color:var(--fg)} .feed .motd{color:var(--blue);font-style:italic}
  .join{background:#0e131b;border:1px solid var(--bd);border-radius:12px;padding:12px}
  label{font-size:11px;color:var(--mut);display:block;margin-bottom:5px}
  .addr{display:flex;gap:8px;align-items:center} code{font-family:ui-monospace,Menlo,monospace;font-size:14px;color:var(--gold);flex:1;word-break:break-all}
  button,.btn{font:inherit;font-weight:700;border-radius:10px;cursor:pointer;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 12px;text-decoration:none}
  .hint{font-size:12px;color:var(--mut);margin-top:8px} a{color:var(--gold)}
</style></head><body>
<header><a class=back href="/">← Servers</a><h1>${esc(s.name)}</h1><span class=badge id=badge data-st=loading>checking…</span></header>
<div class=stage>${s.cam
  ? `<iframe src="${esc(s.cam)}" title="${esc(s.name)} live camera" allowfullscreen></iframe>`
  : `<div class=none><b>🎥 The live camera isn't streaming yet</b><span>When the documentary cam is rolling on this world, its view shows here.</span></div>`}</div>
<div class=info>
  ${s.desc ? `<p class=feed style="color:var(--fg)">${esc(s.desc)}</p>` : ''}
  <div class=feed id=feed>live status loading…</div>
  <div class=join>
    <label>Server address</label>
    <div class=addr><code id=addr>${esc(s.host)}</code><button id=copy data-host="${esc(s.host)}" type=button>Copy</button></div>
    <div class=hint>${esc(join)}.</div>
  </div>
</div>
<script>
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ID=${JSON.stringify(s.id)};
async function poll(){try{
  const r=await fetch('/api/status?id='+encodeURIComponent(ID),{cache:'no-store'}); const j=await r.json();
  const b=document.getElementById('badge'), f=document.getElementById('feed'); const st=j&&j.status;
  if(st&&st.online){ b.dataset.st='online'; b.textContent='● Online';
    const po=st.players&&st.players.online!=null?st.players.online:'—', pm=st.players&&st.players.max!=null?(' / '+E(st.players.max)):'';
    let h='<b>'+E(po)+pm+'</b> player'+(po===1?'':'s')+' online'; if(st.version)h+=' · '+E(st.version);
    if(st.motd)h+='<br><span class=motd>“'+E(String(st.motd).replace(/\\s+/g,' ').trim())+'”</span>'; f.innerHTML=h;
  }else{ b.dataset.st='offline'; b.textContent='● Offline'; f.innerHTML='Server is offline or starting up.'; }
}catch(e){ const b=document.getElementById('badge'); if(b){b.dataset.st='offline';b.textContent='● Unknown';} }}
document.getElementById('copy').addEventListener('click',e=>{const btn=e.currentTarget,host=btn.getAttribute('data-host')||'';
  (navigator.clipboard?navigator.clipboard.writeText(host):Promise.reject()).then(()=>{const o=btn.textContent;btn.textContent='Copied!';setTimeout(()=>btn.textContent=o,1200);}).catch(()=>{});});
poll(); setInterval(poll, ${REFRESH_MS});
</script></body></html>`;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://servers.local');
    const path = url.pathname;

    if (path === '/health') return json(res, 200, { ok: true, servers: loadServers().length });
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nDisallow: /api/\n'); }

    // public-safe server list (host is config-provided)
    if (path === '/api/servers') return json(res, 200, { ok: true, servers: loadServers() });

    // LIVE status for ONE configured server — by id only (no arbitrary host → no SSRF/open proxy).
    if (path === '/api/status') {
      const s = serverById(url.searchParams.get('id'));
      if (!s) return json(res, 404, { ok: false, reason: 'unknown server id' });
      const status = await serverStatus(s.host, { bedrock: s.edition === 'bedrock' });
      return json(res, 200, { ok: true, id: s.id, edition: s.edition, status });
    }

    // Full-screen view of ONE server's screen/camera (click a card's preview). By id only.
    const watch = path.match(/^\/watch\/([a-z0-9._-]{1,64})$/i);
    if (watch) {
      const s = serverById(watch[1]);
      if (!s) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown server'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(watchPage(s));
    }

    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error');
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`SoapBox Servers hub on http://${HOST}:${PORT} — ${loadServers().length} server(s)`));
}
