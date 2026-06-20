// pentecaust/server.mjs — Pentecaust Messaging API + reference chat client (the game chat front door).
//
// Pentecaust Messaging (pentecaust.com) — MELEK's cross-game chat: the descent of tongues where every
// nation hears in its OWN language, here one MELEK account understood across every game and surface. The
// HTTP surface every game calls to form a Team/Alliance/Clan and chat — in-game, on the web, across games.
// Wraps model.mjs (roster) + messaging.mjs (channels + DM). Same edge discipline as the trollbox
// chat-server: CORS allowlist, per-client rate-limit, soft-fail-never-throw, no keys.
//
// IDENTITY / TRUST BOUNDARY (load-bearing): private data (DMs, inbox, team-chat history) and any act-as-
// account write are tied to a VERIFIED identity — NEVER to an attacker-controllable query/body field, or
// anyone reads anyone's DMs by naming them (IDOR). A verifier is injected (__setAuthVerifier) that validates
// a MELEK-Signer bearer token / session and returns the certified account. Identity resolution DENIES by
// default (401); TEAMS_DEV_TRUST_QUERY=1 — local dev / tests ONLY, never a public origin — trusts the
// asserted value so the reference client and the offline suite work. No private key is ever seen here.
//
//   API (JSON):
//     GET  /health                          GET  /teams           (directory)        GET /teams/:id
//     GET  /me/teams?account=               POST /teams           {name,owner,kind,openness,tag,game}
//     POST /teams/:id/join   {account}      POST /teams/:id/leave {account}
//     POST /teams/:id/kick   {actor,account}  POST /teams/:id/role {actor,account,role}
//     POST /teams/:id/approve {actor,account} POST /teams/:id/invite {actor,account}  POST /teams/:id/motd {actor,text}
//     GET  /teams/:id/chat?account=&since=  POST /teams/:id/chat {from,text,game,surface}
//     GET  /dm?me=&with=&since=             POST /dm {from,to,text,game,surface}      GET /inbox?account=
//     GET  /                                the reference chat UI (also a drop-in web client)
//
//   PORT=8157 BASE_URL=https://pentecaust.com node pentecaust/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  createTeam, joinTeam, leaveTeam, kick, setRole, approve, invite, setMotd, getTeam, teamsForAccount, listTeams, isMember,
} from './model.mjs';
import { postTeamMessage, postDM, readTeam, readDM, inboxFor } from './messaging.mjs';

const PORT = +(process.env.PORT || 8157);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://pentecaust.com').replace(/\/$/, '');
const _norm = (s) => String(s || '').trim().replace(/\/$/, '');
const ALLOWED = new Set((process.env.PENTECAUST_ALLOWED_ORIGINS || process.env.TEAMS_ALLOWED_ORIGINS ||
  'https://alpha.melek.salon,https://pool.soapbox.community,https://pentecaust.com,https://move.melek.salon')
  .split(',').map(_norm).filter(Boolean));

// ── identity (the trust boundary) ───────────────────────────────────────────────────────────────────
// Resolve the ACTING account from a VERIFIED source, never from an attacker-controllable query/body field.
// Production injects a verifier (validates a MELEK-Signer bearer token / session → certified account).
// Until then identity DENIES by default (401); PENTECAUST_DEV_TRUST=1 (local dev / tests ONLY, never a
// public origin) falls back to the asserted value so the reference client and the offline suite work.
let _verifyAuth = null;
export function __setAuthVerifier(fn) { _verifyAuth = typeof fn === 'function' ? fn : null; }
const DEV_TRUST = () => process.env.PENTECAUST_DEV_TRUST === '1' || process.env.TEAMS_DEV_TRUST_QUERY === '1';
function whoami(req, asserted) {
  if (_verifyAuth) { try { const a = _verifyAuth(req); return a ? _acct(a) : null; } catch { return null; } }
  if (DEV_TRUST()) return _acct(asserted);
  return null;
}

// tiny per-client token bucket (self-contained; soft-fails open) — mirrors the trollbox limiter intent.
const RL_BURST = +(process.env.TEAMS_RL_BURST || 40);
const RL_WIN = +(process.env.TEAMS_RL_WINDOW_MS || 60000);
const _buckets = new Map();
function allow(key) {
  try {
    const t = Date.now(); const b = _buckets.get(key) || { n: RL_BURST, t };
    b.n = Math.min(RL_BURST, b.n + ((t - b.t) / RL_WIN) * RL_BURST); b.t = t;
    if (b.n < 1) { _buckets.set(key, b); return false; }
    b.n -= 1; _buckets.set(key, b); return true;
  } catch { return true; }
}
function clientKey(req) {
  const h = (req && req.headers) || {};
  const xff = h['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim().slice(0, 64);
  return ((req && req.socket && req.socket.remoteAddress) || 'anon').slice(0, 64);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function cors(origin) {
  const o = _norm(origin);
  if (o && ALLOWED.has(o)) return { 'access-control-allow-origin': o, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'Origin' };
  return { vary: 'Origin' };
}
const json = (res, code, body, origin) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(origin) }); res.end(JSON.stringify(body)); };
function readBody(req, max = 16384) {
  return new Promise((resolve) => { let d = ''; let over = false;
    req.on('data', (c) => { d += c; if (d.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : d)); req.on('error', () => resolve(null)); });
}

export async function handler(req, res) {
  const origin = req.headers ? req.headers.origin : undefined;
  let url; try { url = new URL(req.url, BASE_URL); } catch { return json(res, 400, { ok: false, reason: 'bad-url' }, origin); }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }

  try {
    if (path === '/' && method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors(origin) }); return res.end(PAGE); }
    if (path === '/health') return json(res, 200, { ok: true, teams: listTeams().length }, origin);

    // ── reads (GET) ──────────────────────────────────────────────────────────────────────────────
    // The team directory + a single team's public profile are public (no private data).
    if (method === 'GET' && path === '/teams') return json(res, 200, { ok: true, teams: listTeams() }, origin);

    // PRIVATE reads — must be the authenticated account, never a named one (IDOR guard).
    if (method === 'GET' && path === '/me/teams') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, teams: teamsForAccount(me) }, origin);
    }
    if (method === 'GET' && path === '/inbox') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, threads: inboxFor(me) }, origin);
    }
    if (method === 'GET' && path === '/dm') {
      const me = whoami(req, q.get('me')); if (!me) return unauth(res, origin);
      const wth = _acct(q.get('with'));
      if (!wth) return json(res, 422, { ok: false, reason: 'with required' }, origin);
      return json(res, 200, readDM(me, wth, { since: +q.get('since') || 0, tail: !q.get('since') }), origin);
    }
    const segs = path.split('/').filter(Boolean);
    if (method === 'GET' && segs[0] === 'teams' && segs[1] && segs[2] === 'chat') {
      const id = segs[1]; const me = whoami(req, q.get('account'));
      if (!me) return unauth(res, origin);
      if (!isMember(id, me)) return json(res, 403, { ok: false, reason: 'team members only' }, origin);
      const team = getTeam(id);
      return json(res, 200, { ok: true, team, ...readTeam(id, { since: +q.get('since') || 0, tail: !q.get('since') }) }, origin);
    }
    if (method === 'GET' && segs[0] === 'teams' && segs[1]) {
      const t = getTeam(segs[1]); return t ? json(res, 200, { ok: true, team: t }, origin) : json(res, 404, { ok: false, reason: 'no such team' }, origin);
    }

    // ── writes (POST) ────────────────────────────────────────────────────────────────────────────
    if (method === 'POST') {
      if (!allow(clientKey(req))) return json(res, 429, { ok: false, reason: 'rate-limited' }, origin);
      const raw = await readBody(req); if (raw == null) return json(res, 400, { ok: false, reason: 'bad-body' }, origin);
      let b = {}; try { b = JSON.parse(raw || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad-json' }, origin); }

      // The acting identity is ALWAYS the verified account — never a body field that claims to be someone
      // else. (In dev-trust mode `who` falls back to the route's own actor field for the offline suite.)
      const who = (asserted) => whoami(req, asserted);

      if (path === '/teams') { const me = who(b.owner); if (!me) return unauth(res, origin); return json(res, 200, createTeam({ ...b, owner: me }), origin); }
      if (path === '/dm') { const me = who(b.from); if (!me) return unauth(res, origin); return json(res, 200, postDM({ ...b, from: me }), origin); }

      if (segs[0] === 'teams' && segs[1]) {
        const id = segs[1]; const op = segs[2];
        const actor = who(b.actor); const acct = who(b.account);  // member ops act AS b.account; admin ops AS b.actor
        if (op === 'join') { if (!acct) return unauth(res, origin); return json(res, 200, joinTeam(id, acct), origin); }
        if (op === 'leave') { if (!acct) return unauth(res, origin); return json(res, 200, leaveTeam(id, acct), origin); }
        if (op === 'kick') { if (!actor) return unauth(res, origin); return json(res, 200, kick(id, actor, b.account), origin); }
        if (op === 'role') { if (!actor) return unauth(res, origin); return json(res, 200, setRole(id, actor, b.account, b.role), origin); }
        if (op === 'approve') { if (!actor) return unauth(res, origin); return json(res, 200, approve(id, actor, b.account), origin); }
        if (op === 'invite') { if (!actor) return unauth(res, origin); return json(res, 200, invite(id, actor, b.account), origin); }
        if (op === 'motd') { if (!actor) return unauth(res, origin); return json(res, 200, setMotd(id, actor, b.text), origin); }
        if (op === 'chat') { const me = who(b.from); if (!me) return unauth(res, origin); return json(res, 200, postTeamMessage({ teamId: id, from: me, text: b.text, game: b.game, surface: b.surface }), origin); }
      }
    }
    return json(res, 404, { ok: false, reason: 'not-found' }, origin);
  } catch { return json(res, 500, { ok: false, reason: 'error' }, origin); }
}
const _acct = (s) => String(s || '').trim().toLowerCase();
const unauth = (res, origin) => json(res, 401, { ok: false, reason: 'authentication required (no verified MELEK identity)' }, origin);

// ── reference chat UI (self-contained; also the drop-in web client) ─────────────────────────────────
const PAGE = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Pentecaust Messaging — MELEK Game Chat</title>
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:760px;margin:0 auto}.brand{font-size:20px;font-weight:800}.brand b{color:var(--gold)}.alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px;margin-left:8px}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px;margin:12px 0}
 label{font-size:12px;color:var(--mut);display:block;margin:6px 0 4px}
 input,select{width:100%;padding:9px 11px;border:1px solid var(--bd);border-radius:9px;background:#0e131b;color:var(--fg);font:inherit}
 .row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1;min-width:120px}
 button{padding:10px;border-radius:9px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);font:inherit;font-weight:700;cursor:pointer}
 button.primary{background:var(--gold);color:#1a1306;border-color:var(--gold)}button.green{background:var(--green);color:#062018;border-color:var(--green)}
 .feed{height:300px;overflow:auto;background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:10px;margin:8px 0;font-size:14px}
 .msg{margin:4px 0}.msg .who{color:var(--gold);font-weight:700}.msg .src{color:var(--blue);font-size:11px}.msg.dm .who{color:var(--green)}
 .pill{font-size:11px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:1px 6px;margin-left:6px}
 .mut{color:var(--mut);font-size:12px}.tabs{display:flex;gap:6px;margin-bottom:8px}.tabs button{flex:0 0 auto;padding:6px 12px;font-size:13px}.tabs button.on{background:var(--gold);color:#1a1306;border-color:var(--gold)}
 a{color:var(--gold)}
</style></head><body><div class=wrap>
<div class=brand><b>Pentecaust</b> Messaging<span class=alpha>Alpha</span></div>
<p class=mut>One account, one chat — understood across every MELEK game. Form a <b>Team</b> / <b>Alliance</b> / <b>Clan</b> and talk in-game, out-of-game, or from a different game entirely.</p>

<div class=card>
 <label>Your MELEK account</label><input id=me placeholder=your-melek-name autocapitalize=off spellcheck=false>
 <div class=tabs style="margin-top:8px"><button id=tabTeam class=on>Team chat</button><button id=tabDM>Direct message</button></div>

 <div id=teamPane>
   <div class=row><input id=teamId placeholder="team id (e.g. van-kush-family)"><button id=loadTeam class=primary>Open</button></div>
   <div class=row style="margin-top:6px"><input id=newName placeholder="new team name"><select id=newKind><option value=team>Team</option><option value=alliance>Alliance</option><option value=clan>Clan</option><option value=crew>Crew</option><option value=guild>Guild</option><option value=squad>Squad</option></select><button id=create class=green>Create</button><button id=join>Join</button></div>
   <div id=teamMeta class=mut style="margin-top:6px"></div>
 </div>
 <div id=dmPane style="display:none"><div class=row><input id=dmWith placeholder="message who? (their MELEK account)"><button id=loadDM class=primary>Open thread</button></div></div>

 <div class=feed id=feed><span class=mut>open a team or a DM thread…</span></div>
 <div class=row><input id=text placeholder="type a message…"><select id=surface><option value=website>from website</option><option value=game>from game</option><option value=minecraft>from Minecraft</option><option value=move>from Move app</option></select><button id=send class=primary>Send</button></div>
</div>
<p class=mut>Identity is your MELEK account — the same one you sign up with, mine with, and walk with. <a href="/health">api</a></p>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mode='team', cursor=0, timer=null;
$('me').value=localStorage.getItem('melek_me')||''; $('me').oninput=()=>localStorage.setItem('melek_me',$('me').value.trim().toLowerCase());
const me=()=>$('me').value.trim().toLowerCase();
function setMode(m){mode=m;$('tabTeam').classList.toggle('on',m==='team');$('tabDM').classList.toggle('on',m==='dm');$('teamPane').style.display=m==='team'?'':'none';$('dmPane').style.display=m==='dm'?'':'none';cursor=0;$('feed').innerHTML='<span class=mut>open a '+(m==='team'?'team':'DM thread')+'…</span>';}
$('tabTeam').onclick=()=>setMode('team');$('tabDM').onclick=()=>setMode('dm');
async function api(path,opts){try{const r=await fetch(path,opts);return await r.json();}catch(e){return{ok:false,reason:'network'};}}
function render(msgs,append){const f=$('feed');if(!append)f.innerHTML='';for(const m of msgs){const d=document.createElement('div');d.className='msg'+(m.to?' dm':'');
  d.innerHTML='<span class=who>'+E(m.from)+'</span>'+(m.to?(' → '+E(m.to)):'')+(m.game?(' <span class=src>['+E(m.game)+']</span>'):(m.surface?(' <span class=src>['+E(m.surface)+']</span>'):''))+': '+E(m.text);
  f.appendChild(d);} if(msgs.length)cursor=msgs[msgs.length-1].seq; f.scrollTop=f.scrollHeight;}
async function refresh(){if(mode==='team'){const id=$('teamId').value.trim();if(!id||!me())return;const j=await api('/teams/'+encodeURIComponent(id)+'/chat?account='+encodeURIComponent(me())+(cursor?('&since='+cursor):''));if(j.ok){if(j.team)$('teamMeta').textContent=j.team.kind+' “'+j.team.name+'” · '+j.team.memberCount+' members'+(j.team.motd?(' · '+j.team.motd):'');render(j.messages,cursor>0);}}
  else{const w=$('dmWith').value.trim();if(!w||!me())return;const j=await api('/dm?me='+encodeURIComponent(me())+'&with='+encodeURIComponent(w)+(cursor?('&since='+cursor):''));if(j.ok)render(j.messages,cursor>0);}}
function startPoll(){if(timer)clearInterval(timer);cursor=0;refresh();timer=setInterval(refresh,3000);}
$('loadTeam').onclick=startPoll;$('loadDM').onclick=startPoll;
$('create').onclick=async()=>{const j=await api('/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('newName').value.trim(),owner:me(),kind:$('newKind').value})});if(j.ok){$('teamId').value=j.team.id;startPoll();}else alert(j.reason||'could not create');};
$('join').onclick=async()=>{const id=$('teamId').value.trim();const j=await api('/teams/'+encodeURIComponent(id)+'/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:me()})});if(j.ok)startPoll();else alert(j.reason||'could not join');};
$('send').onclick=async()=>{const t=$('text').value.trim();if(!t||!me())return;$('text').value='';
  if(mode==='team'){await api('/teams/'+encodeURIComponent($('teamId').value.trim())+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:me(),text:t,surface:$('surface').value})});}
  else{await api('/dm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:me(),to:$('dmWith').value.trim(),text:t,surface:$('surface').value})});}refresh();};
$('text').addEventListener('keydown',e=>{if(e.key==='Enter')$('send').click();});
</script></body></html>`;

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Pentecaust Messaging API + chat on http://${HOST}:${PORT} (${BASE_URL})${DEV_TRUST() ? ' — DEV_TRUST on (query-asserted identity; DEV ONLY)' : ''}`));
}
