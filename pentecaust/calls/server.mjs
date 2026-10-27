// pentecaust/calls/server.mjs — the HTTP surface for live video on Pentecaust, plus the app itself.
//
// WHAT THIS IS: 1:1 and small-group video calling between signed-in members, a "next stranger"
// roulette mode, and a tool shelf (screen share, recording, snapshots, stats, in-call chat).
//
// WHAT THIS IS NOT, and the line is deliberate: there is NO broadcast here. Mesh WebRTC uploads one
// stream per peer per peer, so it is honest to about four people and dishonest past that. Twitch-style
// one-to-many needs a selective forwarding unit (mediasoup / LiveKit / Janus) — a real server with real
// bandwidth cost. The model's MESH_SOFT_LIMIT refuses the fifth joiner with a reason that says so,
// rather than letting a nine-person call degrade into everyone blaming their wifi.
//
// IDENTITY: the caller is resolved by an injected whoami, never by a body field — the same
// deny-by-default boundary pentecaust/groups/server.mjs uses. No account, no call.
//
// MEDIA NEVER TOUCHES THIS SERVER. Only the SDP/ICE handshake is relayed, and recordings are PUT
// straight from the browser to object storage with a presigned URL (integrations/harddrive.mjs).
//
// ⭐ STORAGE IS PER-SURFACE AND MUST STAY THAT WAY.
// `deps.drive` is injected by whoever mounts this handler, and DIFFERENT SURFACES PASS DIFFERENT
// DRIVES. The Pentecaust messenger writes to BiFrost; the separate adult surface gets its own
// bucket, its own credentials and its own lifecycle — operator decision, 2026-10-27: "they won't
// upload to the same place." Nothing in this file names a bucket, so the only way the two could
// ever share storage is for a caller to pass the same drive to both, which is the one thing not
// to do. `deps.surface` is echoed back to the client so the UI can say where a recording went,
// and so a mis-mounted surface is visible rather than silent.
//
// House style: ESM, soft-fail-never-throw, handler(req,res,deps), esc() at the render edge.

import {
  heartbeat, goOffline, online, sweep,
  signal, drain,
  block, unblock, blocklist, report,
  createRoom, joinRoom, leaveRoom, getRoom, roomsFor,
  joinQueue, leaveQueue, queueLength, pair,
  iceConfig, MESH_SOFT_LIMIT, MODES,
} from './model.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Embed a value inside a <script> block safely.
 *
 * JSON.stringify does NOT escape '<', so an account literally named `</script><img onerror=…>`
 * would close the script element and execute. Account names come from social logins and are not
 * ours to trust. U+2028/U+2029 are escaped too — they are valid in JSON but terminate a JavaScript
 * line, which is a different way to break the same thing.
 */
export const safeJson = (v) => JSON.stringify(v === undefined ? null : v)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const unauth = (res) => json(res, 401, { ok: false, reason: 'sign in first' });

function readBody(req, max = 262144) {
  if (req && req.body !== undefined && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let d = ''; let over = false;
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * handler(req, res, { whoami, opts, drive, surface })
 *   whoami(req) → verified account (a MELEK name or a '~…' messenger handle), or null.
 *   opts        → passed to the model (clock/store seams for tests).
 *   drive       → THIS SURFACE'S storage: { presignPut, objectKey, storageConfig }. Per-surface,
 *                 never shared between the messenger and the adult surface.
 *   surface     → a label for that storage ('bifrost', …), echoed to the client.
 */
export async function handler(req, res, deps = {}) {
  const whoami = typeof deps.whoami === 'function' ? deps.whoami : () => null;
  const opts = deps.opts || {};
  // `mount` lets this live under a prefix on a bigger server (e.g. '/live' on the messenger)
  // without every route inside having to know about it.
  const mount = String(deps.mount || '').replace(/\/+$/, '');
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return json(res, 400, { ok: false, reason: 'bad url' }); }
  let p = url.pathname.replace(/\/+$/, '') || '/';
  if (mount && (p === mount || p.startsWith(`${mount}/`))) p = p.slice(mount.length) || '/';
  const seg = p.split('/').filter(Boolean);
  const me = whoami(req);

  try {
    if (req.method === 'GET' && (p === '/' || p === '/calls')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page(me, iceConfig(), { surface: String(deps.surface || 'unconfigured'), meshLimit: MESH_SOFT_LIMIT, mount }));
    }

    if (p === '/ice' && req.method === 'GET') return json(res, 200, { ok: true, ...iceConfig() });

    if (p === '/whoami' && req.method === 'GET') return json(res, 200, { ok: true, account: me || null });

    if (!me) return unauth(res);

    if (p === '/heartbeat' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      const r = heartbeat(me, b.mode, opts);
      return json(res, 200, { ...r, online: online(opts), waiting: queueLength(opts), modes: MODES });
    }

    if (p === '/offline' && req.method === 'POST') { goOffline(me, opts); return json(res, 200, { ok: true }); }

    if (p === '/online' && req.method === 'GET') {
      sweep(opts);
      return json(res, 200, { ok: true, online: online(opts).filter((o) => o.account !== me), waiting: queueLength(opts) });
    }

    // ── signalling ──────────────────────────────────────────────────────────────────────────────
    if (p === '/signal' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      const r = signal(me, b.to, b.payload, opts);
      return json(res, r.ok ? 200 : 400, r);
    }
    if (p === '/poll' && req.method === 'GET') {
      return json(res, 200, { ok: true, signals: drain(me, opts), waiting: queueLength(opts) });
    }

    // ── rooms ───────────────────────────────────────────────────────────────────────────────────
    if (p === '/room' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      return json(res, 200, createRoom(me, { name: b.name, locked: b.locked }, opts));
    }
    if (seg[0] === 'room' && seg[1] && req.method === 'GET') {
      const r = getRoom(seg[1], opts);
      return r ? json(res, 200, { ok: true, room: r }) : json(res, 404, { ok: false, reason: 'no such room' });
    }
    if (seg[0] === 'room' && seg[1] && seg[2] === 'join' && req.method === 'POST') {
      const r = joinRoom(seg[1], me, opts);
      return json(res, r.ok ? 200 : 403, r);
    }
    if (seg[0] === 'room' && seg[1] && seg[2] === 'leave' && req.method === 'POST') {
      return json(res, 200, leaveRoom(seg[1], me, opts));
    }
    if (p === '/rooms' && req.method === 'GET') return json(res, 200, { ok: true, rooms: roomsFor(me, opts) });

    // ── roulette ────────────────────────────────────────────────────────────────────────────────
    if (p === '/roulette/join' && req.method === 'POST') {
      joinQueue(me, opts);
      const m = pair(opts);
      if (m) {
        // tell both sides. The one who is told `initiator` makes the offer, so exactly one does.
        signal(m.a, m.b, { type: 'matched', roomId: m.roomId, peer: m.a, initiator: false }, opts);
        signal(m.b, m.a, { type: 'matched', roomId: m.roomId, peer: m.b, initiator: true }, opts);
        const mine = m.a === me ? { peer: m.b, initiator: true } : (m.b === me ? { peer: m.a, initiator: false } : null);
        if (mine) return json(res, 200, { ok: true, matched: true, roomId: m.roomId, ...mine });
      }
      return json(res, 200, { ok: true, matched: false, waiting: queueLength(opts) });
    }
    if (p === '/roulette/leave' && req.method === 'POST') { leaveQueue(me, opts); return json(res, 200, { ok: true }); }

    // ── safety ──────────────────────────────────────────────────────────────────────────────────
    if (p === '/block' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      return json(res, 200, { ...block(me, b.account, opts), blocklist: blocklist(me, opts) });
    }
    if (p === '/unblock' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      return json(res, 200, { ...unblock(me, b.account, opts), blocklist: blocklist(me, opts) });
    }
    if (p === '/blocklist' && req.method === 'GET') return json(res, 200, { ok: true, blocklist: blocklist(me, opts) });
    if (p === '/report' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      return json(res, 200, report(me, b.account, b.reason, opts));
    }

    // ── recordings → THIS SURFACE'S storage, presigned so media never passes through here ──────
    if (p === '/upload-url' && req.method === 'POST') {
      const b = (await readBody(req)) || {};
      const drive = deps.drive;
      const surface = String(deps.surface || 'unconfigured');
      if (!drive || typeof drive.presignPut !== 'function') {
        return json(res, 503, { ok: false, reason: 'no storage is configured for this surface', surface });
      }
      const cfg = drive.storageConfig ? drive.storageConfig() : null;
      if (cfg && cfg.configured === false) return json(res, 503, { ok: false, reason: 'no storage is configured for this surface', surface });
      const name = String(b.filename || 'recording.webm')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/\.{2,}/g, '.')      // no traversal sequences survive
        .replace(/^[._-]+/, '')        // and no leading dot/dash games
        .slice(0, 120) || 'recording.webm';
      const key = drive.objectKey ? drive.objectKey(me, name) : `${me}/${name}`;
      const bytes = Number(b.bytes) || null;
      try {
        return json(res, 200, { ok: true, key, surface, putUrl: drive.presignPut(cfg, key, { contentLength: bytes }) });
      } catch (e) {
        return json(res, 500, { ok: false, reason: String(e && e.message || 'presign failed'), surface });
      }
    }

    return json(res, 404, { ok: false, reason: 'no such route' });
  } catch (e) {
    return json(res, 500, { ok: false, reason: String(e && e.message || 'error') });
  }
}

// ── the app ─────────────────────────────────────────────────────────────────────────────────────
// One page. Signalling is a poll loop against /poll; media is peer-to-peer and never comes here.

export function page(me, ice, info = {}) {
  const surface = esc(info.surface || 'unconfigured');
  const meshLimit = Number(info.meshLimit) || 4;
  const signedIn = !!me;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Live — Pentecaust</title>
<meta name=description content="Video calling, rooms and roulette for signed-in Pentecaust members.">
<style>
:root{--bg:#0d0f13;--panel:#161a21;--line:#262c36;--ink:#e8ecf2;--mut:#93a0b4;--acc:#ffd24a;--bad:#ff6b6b;--ok:#5ad19a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{display:flex;gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
header b{color:var(--acc)}
.sp{flex:1}
main{padding:16px;max-width:1200px;margin:0 auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:12px 0}
.tile{position:relative;background:#000;border:1px solid var(--line);border-radius:10px;overflow:hidden;aspect-ratio:4/3}
.tile video{width:100%;height:100%;object-fit:cover;background:#000}
.tile .who{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:6px;font-size:13px}
.tile .st{position:absolute;right:8px;top:8px;font-size:11px;color:var(--mut);background:rgba(0,0,0,.6);padding:2px 6px;border-radius:6px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
button{background:#222835;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:14px}
button:hover{border-color:var(--acc)}
button[disabled]{opacity:.45;cursor:not-allowed}
button.on{background:var(--acc);color:#111;border-color:var(--acc)}
button.bad{border-color:var(--bad);color:var(--bad)}
.shelf{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
select,input{background:#0f131a;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:14px}
.mut{color:var(--mut)}
.warn{border-left:3px solid var(--acc);padding-left:10px}
#chat{height:150px;overflow:auto;background:#0f131a;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:14px}
#chat div{margin-bottom:4px}
ul.people{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
ul.people li{background:#0f131a;border:1px solid var(--line);border-radius:8px;padding:6px 10px}
code{background:#0f131a;padding:1px 5px;border-radius:4px}
</style></head><body>
<header><b>Pentecaust Live</b>
  <span class=mut id=whoami>${signedIn ? esc(me) : 'not signed in'}</span>
  <span class=sp></span>
  <span class=mut id=status>idle</span>
</header>
<main>
${signedIn ? '' : '<div class="card warn">You need to be signed in to Pentecaust to call anyone. Calling is member-to-member by design — there is no anonymous entry.</div>'}
${ice.relay ? '' : `<div class="card warn"><b>STUN only.</b> ${esc(ice.note)} Calls between two people on ordinary home networks will usually work; some will not connect at all until a TURN relay is configured.</div>`}

<div class=card>
  <div class=shelf>
    <button id=btnStart>Start camera</button>
    <button id=btnRoulette>Roulette — next stranger</button>
    <button id=btnRoom>Create a room</button>
    <button id=btnHang class=bad disabled>Hang up</button>
  </div>
  <div class=shelf>
    <select id=cam></select><select id=mic></select>
  </div>
  <div class=mut id=lobbyNote>Mesh calls are capped at ${meshLimit} people — past that, every browser uploads a separate stream to every other browser. One-to-many broadcast needs a media server, which is a separate decision.</div>
</div>

<div class=grid id=stage>
  <div class=tile><video id=local autoplay playsinline muted></video><span class=who>you</span><span class=st id=lstat></span></div>
</div>

<div class=card>
  <div class=shelf>
    <button id=btnCam class=on>Camera</button>
    <button id=btnMic class=on>Mic</button>
    <button id=btnScreen>Share screen</button>
    <button id=btnSnap>Snapshot</button>
    <button id=btnRec>Record</button>
    <button id=btnPip>Picture-in-picture</button>
    <button id=btnStats>Connection stats</button>
    <button id=btnBlock class=bad disabled>Block</button>
    <button id=btnReport class=bad disabled>Report</button>
  </div>
  <div class=mut id=recNote></div>
  <pre class=mut id=stats style="white-space:pre-wrap;margin:6px 0 0"></pre>
</div>

<div class=card>
  <div><b>In-call chat</b> <span class=mut>— rides the same relay as the handshake</span></div>
  <div id=chat></div>
  <div class=shelf><input id=msg placeholder="Say something" style="flex:1"><button id=btnSend>Send</button></div>
</div>

<div class=card>
  <div><b>Online now</b></div>
  <ul class=people id=people></ul>
  <div class=mut id=roomNote></div>
</div>

<script>
const ICE = ${safeJson({ iceServers: ice.iceServers })};
const SURFACE = ${safeJson(surface)};
const MESH = ${meshLimit};
const MOUNT = ${safeJson(info.mount || '')};
const ME = ${safeJson(me || null)};
const $ = (id) => document.getElementById(id);
const api = async (path, body) => {
  try {
    const r = await fetch(MOUNT + path, body ? { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) } : {});
    return await r.json();
  } catch { return { ok:false, reason:'network' }; }
};
const setStatus = (s) => { $('status').textContent = s; };
const say = (who, what) => { const d=document.createElement('div'); d.innerHTML='<b>'+who.replace(/[<>&]/g,'')+':</b> '+String(what).replace(/[<>&]/g,''); $('chat').appendChild(d); $('chat').scrollTop=1e9; };

let local=null, screenTrack=null, recorder=null, chunks=[], peers=new Map(), roomId=null, mode='idle';

// ── devices ─────────────────────────────────────────────────────────────────
async function listDevices(){
  try{
    const ds = await navigator.mediaDevices.enumerateDevices();
    for (const [sel,kind] of [[$('cam'),'videoinput'],[$('mic'),'audioinput']]){
      sel.innerHTML='';
      ds.filter(d=>d.kind===kind).forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||(kind+' '+(i+1)); sel.appendChild(o); });
    }
  }catch{}
}
async function startLocal(){
  try{
    const v=$('cam').value, a=$('mic').value;
    local = await navigator.mediaDevices.getUserMedia({
      video: v?{deviceId:{exact:v}}:true,
      audio: a?{deviceId:{exact:a}}:true
    });
    $('local').srcObject = local;
    await listDevices();
    setStatus('camera on');
    return true;
  }catch(e){ setStatus('camera blocked: '+e.name); return false; }
}

// ── peer plumbing ───────────────────────────────────────────────────────────
function tileFor(who){
  let t=document.getElementById('t-'+who);
  if(!t){
    t=document.createElement('div'); t.className='tile'; t.id='t-'+who;
    t.innerHTML='<video autoplay playsinline></video><span class=who></span><span class=st></span>';
    t.querySelector('.who').textContent=who;
    $('stage').appendChild(t);
  }
  return t;
}
function peer(who, initiator){
  if (peers.has(who)) return peers.get(who);
  const pc = new RTCPeerConnection(ICE);
  peers.set(who, pc);
  if (local) local.getTracks().forEach(t=>pc.addTrack(t, local));
  pc.onicecandidate = (e)=>{ if(e.candidate) api('/signal',{to:who,payload:{type:'ice',candidate:e.candidate}}); };
  pc.ontrack = (e)=>{ const t=tileFor(who); t.querySelector('video').srcObject = e.streams[0]; };
  pc.onconnectionstatechange = ()=>{
    const t=document.getElementById('t-'+who); if(t) t.querySelector('.st').textContent = pc.connectionState;
    if(['failed','closed','disconnected'].includes(pc.connectionState)) dropPeer(who);
  };
  if (initiator) (async()=>{
    const o = await pc.createOffer(); await pc.setLocalDescription(o);
    api('/signal',{to:who,payload:{type:'offer',sdp:pc.localDescription}});
  })();
  $('btnBlock').disabled=false; $('btnReport').disabled=false; $('btnHang').disabled=false;
  return pc;
}
function dropPeer(who){
  const pc=peers.get(who); if(pc){ try{pc.close()}catch{} peers.delete(who); }
  const t=document.getElementById('t-'+who); if(t) t.remove();
  if(!peers.size){ $('btnBlock').disabled=true; $('btnReport').disabled=true; $('btnHang').disabled=true; }
}
function hangup(){
  for(const who of [...peers.keys()]) { api('/signal',{to:who,payload:{type:'bye'}}); dropPeer(who); }
  if(roomId) api('/room/'+roomId+'/leave',{});
  roomId=null; mode='idle'; setStatus('idle'); api('/roulette/leave',{});
}

// ── the signalling loop ─────────────────────────────────────────────────────
async function pump(){
  const r = await api('/poll');
  for (const s of (r.signals||[])){
    const who = s.from, p = s.payload||{};
    if (p.type==='matched'){ roomId=p.roomId; setStatus('matched with '+who); peer(who, !!p.initiator); }
    else if (p.type==='offer'){
      const pc = peer(who, false);
      await pc.setRemoteDescription(p.sdp);
      const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
      api('/signal',{to:who,payload:{type:'answer',sdp:pc.localDescription}});
    }
    else if (p.type==='answer'){ const pc=peers.get(who); if(pc) await pc.setRemoteDescription(p.sdp); }
    else if (p.type==='ice'){ const pc=peers.get(who); if(pc) try{ await pc.addIceCandidate(p.candidate); }catch{} }
    else if (p.type==='chat'){ say(who, p.text); }
    else if (p.type==='bye'){ dropPeer(who); say('system', who+' left'); }
    else if (p.type==='invite'){ say('system', who+' invited you to a room — '+p.roomId); }
  }
  if (r.waiting!==undefined && mode==='roulette') setStatus('waiting — '+r.waiting+' in the queue');
}
async function heartbeat(){
  const r = await api('/heartbeat',{mode: mode==='roulette'?'roulette':'calls'});
  const ul=$('people'); ul.innerHTML='';
  for (const o of (r.online||[]).filter(x=>x.account!==ME)){
    const li=document.createElement('li');
    li.innerHTML = '<span>'+o.account.replace(/[<>&]/g,'')+'</span> ';
    const b=document.createElement('button'); b.textContent='Call'; b.onclick=()=>{ if(!local) return setStatus('start your camera first'); peer(o.account, true); };
    li.appendChild(b); ul.appendChild(li);
  }
}

// ── the tool shelf ──────────────────────────────────────────────────────────
$('btnStart').onclick = async ()=>{ if(await startLocal()) $('btnStart').disabled=true; };
$('btnHang').onclick = hangup;

$('btnRoulette').onclick = async ()=>{
  if(!local && !(await startLocal())) return;
  mode='roulette'; setStatus('looking for someone…');
  const r = await api('/roulette/join',{});
  if (r.matched){ roomId=r.roomId; setStatus('matched with '+r.peer); peer(r.peer, !!r.initiator); }
};
$('btnRoom').onclick = async ()=>{
  if(!local && !(await startLocal())) return;
  const r = await api('/room',{name:'room'});
  if(r.ok){ roomId=r.id; $('roomNote').textContent = 'Invite link: '+location.origin+location.pathname+'#'+r.id; setStatus('room '+r.id); }
};
$('btnCam').onclick = ()=>{ if(!local) return; const t=local.getVideoTracks()[0]; if(!t) return; t.enabled=!t.enabled; $('btnCam').classList.toggle('on',t.enabled); };
$('btnMic').onclick = ()=>{ if(!local) return; const t=local.getAudioTracks()[0]; if(!t) return; t.enabled=!t.enabled; $('btnMic').classList.toggle('on',t.enabled); };
$('btnScreen').onclick = async ()=>{
  try{
    if (screenTrack){ screenTrack.stop(); screenTrack=null; $('btnScreen').classList.remove('on'); await republish(local.getVideoTracks()[0]); return; }
    const s = await navigator.mediaDevices.getDisplayMedia({video:true});
    screenTrack = s.getVideoTracks()[0];
    screenTrack.onended = ()=>{ screenTrack=null; $('btnScreen').classList.remove('on'); republish(local && local.getVideoTracks()[0]); };
    $('btnScreen').classList.add('on');
    await republish(screenTrack);
  }catch(e){ setStatus('screen share: '+e.name); }
};
async function republish(track){
  if(!track) return;
  for (const pc of peers.values()){
    const s = pc.getSenders().find(x=>x.track && x.track.kind==='video');
    if (s) try{ await s.replaceTrack(track); }catch{}
  }
  $('local').srcObject = new MediaStream([track, ...(local?local.getAudioTracks():[])]);
}
$('btnSnap').onclick = ()=>{
  const v=$('local'); if(!v.videoWidth) return setStatus('no video to capture');
  const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight;
  c.getContext('2d').drawImage(v,0,0);
  c.toBlob(b=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='snapshot-'+Date.now()+'.png'; a.click(); });
};
$('btnRec').onclick = async ()=>{
  if (recorder && recorder.state!=='inactive'){
    recorder.stop(); $('btnRec').classList.remove('on'); return;
  }
  if(!local) return setStatus('start your camera first');
  chunks=[];
  try{ recorder = new MediaRecorder(local, {mimeType:'video/webm'}); }
  catch(e){ return setStatus('recording unsupported: '+e.name); }
  recorder.ondataavailable = e=>{ if(e.data.size) chunks.push(e.data); };
  recorder.onstop = async ()=>{
    const blob = new Blob(chunks, {type:'video/webm'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='recording-'+Date.now()+'.webm'; a.click();
    $('recNote').textContent = 'Saved locally ('+Math.round(blob.size/1024)+' KB). Uploading to '+SURFACE+'…';
    const up = await api('/upload-url',{filename:'recording-'+Date.now()+'.webm', bytes: blob.size});
    if(!up.ok){ $('recNote').textContent = 'Saved locally. Not uploaded: '+up.reason; return; }
    try{
      const r = await fetch(up.putUrl, {method:'PUT', body:blob, headers:{'content-type':'video/webm'}});
      $('recNote').textContent = r.ok ? ('Uploaded to '+up.surface+' as '+up.key) : ('Upload failed: HTTP '+r.status);
    }catch(e){ $('recNote').textContent='Upload failed: '+e.message; }
  };
  recorder.start(1000); $('btnRec').classList.add('on'); setStatus('recording');
};
$('btnPip').onclick = async ()=>{
  const v = document.querySelector('#stage .tile:not(:first-child) video') || $('local');
  try{ await v.requestPictureInPicture(); }catch(e){ setStatus('PiP: '+e.name); }
};
$('btnStats').onclick = async ()=>{
  const out=[];
  for (const [who,pc] of peers){
    const s = await pc.getStats();
    s.forEach(r=>{
      if (r.type==='candidate-pair' && r.state==='succeeded') out.push(who+': rtt '+(r.currentRoundTripTime!=null?Math.round(r.currentRoundTripTime*1000)+'ms':'?')+', out '+(r.bytesSent||0)+'B, in '+(r.bytesReceived||0)+'B');
      if (r.type==='inbound-rtp' && r.kind==='video') out.push(who+': video in '+(r.framesPerSecond||'?')+'fps, lost '+(r.packetsLost||0));
    });
  }
  $('stats').textContent = out.join('\\n') || 'no connected peers';
};
$('btnBlock').onclick = async ()=>{
  const who=[...peers.keys()][0]; if(!who) return;
  await api('/block',{account:who}); say('system','blocked '+who); dropPeer(who);
};
$('btnReport').onclick = async ()=>{
  const who=[...peers.keys()][0]; if(!who) return;
  const reason = prompt('What happened? This also blocks them.') || '';
  await api('/report',{account:who, reason}); say('system','reported '+who); dropPeer(who);
};
$('btnSend').onclick = ()=>{
  const t=$('msg').value.trim(); if(!t) return;
  for (const who of peers.keys()) api('/signal',{to:who,payload:{type:'chat',text:t}});
  say(ME||'you', t); $('msg').value='';
};
$('msg').addEventListener('keydown', e=>{ if(e.key==='Enter') $('btnSend').click(); });

if (location.hash.length>1){
  (async()=>{
    if(!local && !(await startLocal())) return;
    const id=location.hash.slice(1);
    const r = await api('/room/'+id+'/join',{});
    if(r.ok){ roomId=id; setStatus('joined '+id); (r.peers||[]).forEach(pp=>peer(pp,true)); }
    else setStatus('could not join: '+r.reason);
  })();
}

${signedIn ? `listDevices(); setInterval(pump, 1200); setInterval(heartbeat, 10000); heartbeat();` : ''}
window.addEventListener('beforeunload', ()=>{ try{ navigator.sendBeacon(MOUNT + '/offline'); }catch{} });
</script>
</body></html>`;
}
