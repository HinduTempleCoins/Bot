// site/pact/channels.mjs — the HTTP surface for PACT CHANNELS (IRC-style rooms anyone can start).
//
//   GET  /channels                     list (JSON)            POST /channels {name, topic, inviteOnly, moderated}
//   GET  /c/<name>                     the room page (HTML)
//   GET  /channels/<name>/messages?since=N   messages + roster + topic (JSON; also records presence)
//   POST /channels/<name>/messages {text}    a message, a /me action, or an op command (/topic /op /kick …)
//
// Identity comes from the injected whoami (the Pact session) — never from a body field. Reading a public room
// needs no sign-in; talking, starting a room and running commands do. Raw text is escaped at render time.
import * as model from '../../pentecaust/channels/model.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sendJson(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
async function readJson(req) {
  let raw = '';
  try { for await (const c of req) { raw += c; if (raw.length > 8192) return null; } } catch { return null; }
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

export function roomPage(name, who, style = '') {
  const ch = model.getChannel(name);
  const title = ch ? `#${ch.name}` : 'Channel not found';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} · Pact</title><meta name=description content="${esc(ch ? (ch.topic || `#${ch.name} on Pact`) : 'Pact channels')}">${style}
<style>
 .room{display:grid;grid-template-columns:1fr 180px;gap:12px}
 @media(max-width:700px){.room{grid-template-columns:1fr}.users{order:-1}}
 #log{height:60vh;overflow:auto;border:1px solid #2a2f3a;border-radius:8px;padding:10px;background:#0f1218;font:14px/1.45 ui-monospace,Menlo,Consolas,monospace}
 #log .t{color:#6b7280} #log .n{color:#ffb547} #log .a{color:#c4b5fd;font-style:italic} #log .x{color:#7dd3fc}
 .users{border:1px solid #2a2f3a;border-radius:8px;padding:10px;background:#0f1218;font:13px ui-monospace,Menlo,monospace;max-height:60vh;overflow:auto}
 #say{display:flex;gap:8px;margin-top:8px} #say input{flex:1}
 .topic{color:#cbd5e1;margin:4px 0 10px}
</style></head><body><div class=wrap>
<header><span class=brand><a href="/" style="color:inherit;text-decoration:none"><b>Pact</b></a> · <b>${esc(title)}</b></span>
${who ? `<span class=authbar>${esc(who)}</span>` : '<span class=authbar><a class="btn primary" href="/auth/login">Sign in to talk</a></span>'}</header>
${ch ? `<div class=topic id=topic>${esc(ch.topic || 'No topic set.')}</div>
<div class=room><div><div id=log aria-live=polite></div>
<form id=say><input id=text maxlength=1000 placeholder="${who ? `Message #${esc(ch.name)} — or /me, /topic, /op name, /voice name, /kick name, /ban name, /invite name, /mode +m|+i, /join #room` : 'Sign in to talk'}" ${who ? '' : 'disabled'}><button class="btn primary" ${who ? '' : 'disabled'}>Send</button></form>
<p class=mut id=err role=status></p></div>
<div class=users><b>In the room</b><div id=users></div></div></div>` : '<p>No channel by that name. <a href="/#channels">See all channels</a> or start one.</p>'}
<footer>Pact channels · <a href="/#channels">all channels</a></footer></div>
${ch ? `<script>
const NAME=${JSON.stringify(ch.name)};let since=0;
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tm=ts=>new Date(ts).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
function line(m){const d=document.createElement('div');
 if(m.kind==='action')d.innerHTML='<span class=t>'+tm(m.ts)+'</span> <span class=a>* '+E(m.from)+' '+E(m.text)+'</span>';
 else if(m.kind==='notice')d.innerHTML='<span class=t>'+tm(m.ts)+'</span> <span class=x>-- '+E(m.text)+'</span>';
 else d.innerHTML='<span class=t>'+tm(m.ts)+'</span> <span class=n>&lt;'+E(m.from)+'&gt;</span> '+E(m.text);
 return d;}
async function poll(){try{const r=await fetch('/channels/'+NAME+'/messages?since='+since,{cache:'no-store'});const j=await r.json();
 if(j.ok){const log=$('log');const atEnd=log.scrollTop+log.clientHeight>=log.scrollHeight-20;
  for(const m of j.messages){log.appendChild(line(m));since=Math.max(since,m.seq);}
  if(atEnd)log.scrollTop=log.scrollHeight;
  $('users').innerHTML=j.roster.map(u=>'<div>'+E(u.mark+u.who)+'</div>').join('')||'<div class=mut>nobody yet</div>';
  $('topic').textContent=j.topic||'No topic set.';}
 else $('err').textContent=j.reason||'';}catch(e){}}
$('say').onsubmit=async e=>{e.preventDefault();const t=$('text').value.trim();if(!t)return;
 const j=/^\\/join\\s+#?([a-z0-9-]+)/i.exec(t);if(j){location.href='/c/'+j[1].toLowerCase();return;}
 if(/^\\/list\\b/i.test(t)){location.href='/#channels';return;}
 const r=await fetch('/channels/'+NAME+'/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:t})});
 const k=await r.json().catch(()=>({ok:false}));$('err').textContent=k.ok?'':(k.reason||'could not send');if(k.ok){$('text').value='';poll();}};
poll();setInterval(poll,3000);
</script>` : ''}</body></html>`;
}

/** Returns true if it handled the request. */
export async function handler(req, res, { whoami, style = '' } = {}) {
  const [rawPath, qs = ''] = String((req && req.url) || '/').split('?');
  const path = rawPath.replace(/\/+$/, '') || '/';
  const who = (typeof whoami === 'function' && whoami(req)) || null;
  const method = req.method || 'GET';

  const room = /^\/c\/([^/]+)$/.exec(path);
  if (room && method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(roomPage(decodeURIComponent(room[1]), who, style));
    return true;
  }
  if (path === '/channels' && method === 'GET') {
    let list = model.listChannels();
    // ?op=me — the channels the signed-in visitor can invite people into (they are an operator there)
    if (new URLSearchParams(qs).get('op') === 'me') list = who ? list.filter((c) => model.isOp(model.getChannel(c.name), who)) : [];
    sendJson(res, 200, { ok: true, channels: list }); return true;
  }
  if (path === '/channels' && method === 'POST') {
    if (!who) { sendJson(res, 401, { ok: false, reason: 'sign in to start a channel' }); return true; }
    const b = await readJson(req);
    if (!b) { sendJson(res, 400, { ok: false, reason: 'bad body' }); return true; }
    const r = model.createChannel({ name: b.name, topic: b.topic, founder: who, inviteOnly: !!b.inviteOnly, moderated: !!b.moderated });
    sendJson(res, r.ok ? 200 : 400, r); return true;
  }
  const msgs = /^\/channels\/([^/]+)\/messages$/.exec(path);
  if (msgs) {
    const name = decodeURIComponent(msgs[1]);
    const ch = model.getChannel(name);
    if (!ch) { sendJson(res, 404, { ok: false, reason: 'no such channel' }); return true; }
    if (method === 'GET') {
      if (who) { const j = model.joinChannel(name, who); if (!j.ok) { sendJson(res, 403, j); return true; } }
      else if (ch.modes.i) { sendJson(res, 403, { ok: false, reason: `#${ch.name} is invite-only — sign in.` }); return true; }
      const since = Number(new URLSearchParams(qs).get('since')) || 0;
      sendJson(res, 200, { ok: true, topic: ch.topic, modes: ch.modes, messages: model.readMessages(name, { since }), roster: model.roster(name) });
      return true;
    }
    if (method === 'POST') {
      if (!who) { sendJson(res, 401, { ok: false, reason: 'sign in to talk' }); return true; }
      const j = model.joinChannel(name, who);
      if (!j.ok) { sendJson(res, 403, j); return true; }
      const b = await readJson(req);
      if (!b) { sendJson(res, 400, { ok: false, reason: 'bad body' }); return true; }
      const r = model.postMessage(name, who, b.text);
      sendJson(res, r.ok ? 200 : 400, r); return true;
    }
  }
  return false;
}
