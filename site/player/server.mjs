// site/player/server.mjs — the SoapBox Media Player / "Caster". A REAL, working web media player:
// a <video>/<audio> stage, a client-managed PLAYLIST (add by URL, reorder, next/prev, remove), and
// per-track resume (remembers position in the browser). It plays DIRECT https media files and the
// ecosystem's own content (ScotTube reels, radio streams, podcast episodes), and it will only ever
// EMBED an official first-party player via integrations/soapbox/embed-whitelist.mjs (Samy-worm rule:
// zero arbitrary JS origins). Everything else is refused with a reason.
//
// DESIGN (mirrors site/tunein + site/insurance): no new player stack, no rehosting — one honest player
// shell over the readers we already have. esc() every interpolation, keyless + soft-fail (a dead source
// degrades a quick-add row, never breaks the page), handler(req,res) exported for tests, CLI guarded to
// site/player/, injectable fetch (__setFetch) so tests run fully offline.
//
// THE "CASTER" PART — kept HONEST. A web page cannot control arbitrary TV hardware, and we do not fake
// device control. What a browser genuinely offers is native casting on a <video> element: Chromecast and
// AirPlay are the browser's own buttons, and "open on your TV" is a plain URL/queue the user opens in the
// TV's browser. We surface exactly those and nothing more.
//
//   PORT=8310 BASE_URL=https://player.soapbox.community node site/player/server.mjs
//   import { handler, __setFetch, isPlayable, normalizeTrack, buildPlaylist, renderPlayer } from './server.mjs'
//
// Pure, exported, testable helpers:
//   normalizeTrack({url,title})  → a shaped track, or null
//   isPlayable(url)              → https + (media ext | whitelisted embed) ; javascript:/unlisted ⇒ false
//   buildPlaylist(items)         → validate + dedupe → track[]
//   renderPlayer(state)          → the player stage + playlist HTML (escaped)

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import * as radio from '../../integrations/soapbox/radio.mjs';
import * as podcasts from '../../integrations/soapbox/podcasts.mjs';
import { allowedEmbed } from '../../integrations/soapbox/embed-whitelist.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8310);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'SoapBox Player';

// Public product endpoints (env-overridable; same public defaults the /dtube client uses).
const RPC_URL = (process.env.MELEK_RPC_URL || 'https://alpha.melek.salon/rpc').replace(/\/$/, '');
const ENGINE_URL = (process.env.MELEK_ENGINE_URL || 'https://alpha.melek.salon/engine').replace(/\/$/, '');
const POD_TERM = process.env.PLAYER_POD_TERM || 'history';

// ── injectable fetch — one mock fans out to the readers + the ScotTube RPC reader ────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
  radio.__setFetch(_fetch);
  podcasts.__setFetch(_fetch);
}

// ── house-style esc (escapes the single quote too — attribute interpolation is always safe) ──────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Every source call is wrapped: on ANY failure (empty / network / throw) we degrade to [].
async function safe(fn) {
  try { const v = await fn(); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// ── the safety gate: what may play ───────────────────────────────────────────────────────────────────
// A direct https MEDIA FILE (by extension) is fine — an <audio>/<video> src has no script context, so it
// cannot run JS against the viewer. An EMBED is only allowed for a whitelisted first-party player
// (embed-whitelist.mjs). Anything else — javascript:/data:/http:, or an unlisted host with no media
// extension — is refused. This is the same allowlist posture as the rest of SoapBox.
const AUDIO_EXT = /\.(mp3|m4a|aac|oga|ogg|opus|wav|flac|weba)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|m3u8)(\?|#|$)/i;

function mediaKind(u) {
  if (AUDIO_EXT.test(u.pathname)) return 'audio';
  if (VIDEO_EXT.test(u.pathname)) return 'video';
  return null;
}

/**
 * Is `url` something we will play? https AND (a direct media file by extension OR a whitelisted official
 * embed). Pure and total — never throws; bad input / javascript: / unlisted host ⇒ false.
 */
export function isPlayable(url) {
  if (!url || typeof url !== 'string') return false;
  let u;
  try { u = new URL(url.trim()); } catch { return false; }
  if (u.protocol !== 'https:') return false;            // no javascript:/data:/http:/file:
  if (allowedEmbed(url).ok) return true;                // whitelisted first-party embed
  return !!mediaKind(u);                                // direct https media file
}

function hostTitle(u) {
  const seg = u.pathname.split('/').filter(Boolean).pop() || '';
  return seg ? `${seg} — ${u.hostname}` : u.hostname;
}

/**
 * Shape an input into a track, or null. Accepts a string url or {url,title,kind,poster}.
 * A whitelisted embed becomes kind:'embed' with its official embed URL. A direct media file becomes
 * kind:'audio'|'video' by extension. A trusted server-side kind hint (radio streams carry no extension)
 * is honored ONLY as audio/video and ONLY over https — a javascript:/http: url is always rejected.
 */
export function normalizeTrack(input) {
  if (input == null) return null;
  const raw = typeof input === 'string' ? { url: input } : input;
  const url = String(raw.url == null ? '' : raw.url).trim();
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;             // hard scheme gate — never js:/data:/http:

  const title = String(raw.title == null ? '' : raw.title).trim().slice(0, 200) || hostTitle(u);

  const emb = allowedEmbed(url);
  if (emb.ok) {
    return { url, title, kind: 'embed', host: u.hostname, provider: emb.provider, embed: emb.embed, poster: '' };
  }

  let kind = mediaKind(u);
  if (!kind && (raw.kind === 'audio' || raw.kind === 'video')) kind = raw.kind; // trusted ecosystem hint
  if (!kind) return null;

  return { url, title, kind, host: u.hostname, provider: '', embed: '', poster: String(raw.poster == null ? '' : raw.poster).trim() };
}

/** Validate + dedupe a list of inputs into a playlist. Invalid items are dropped (never throws). */
export function buildPlaylist(items = []) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    const t = normalizeTrack(it);
    if (!t) continue;
    const key = t.kind === 'embed' ? `embed:${t.embed}` : t.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── ScotTube (On MELEK) — the engine /dtube feed, read server-side (soft-fails to []) ────────────────
export function videoUrlOf(meta) {
  if (!meta) return null;
  if (typeof meta.video === 'string') return meta.video;
  if (meta.video && typeof meta.video.url === 'string') return meta.video.url;
  if (Array.isArray(meta.links)) return meta.links.find((l) => /\.(mp4|webm|ogg)$/i.test(l)) || null;
  return null;
}

async function rpc(method, params) {
  try {
    const r = await _fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && j.result;
  } catch { return null; }
}

/** `reel`-tagged video posts with a playable video URL. Soft-fails to []. */
export async function scottubeFeed({ tag = 'reel', limit = 8 } = {}) {
  try {
    const posts = await rpc('condenser_api.get_discussions_by_created', [{ tag, limit }]);
    const list = Array.isArray(posts) ? posts : [];
    const out = [];
    for (const p of list) {
      let meta = {};
      try { meta = JSON.parse(p.json_metadata || '{}'); } catch { meta = {}; }
      const vurl = videoUrlOf(meta);
      if (!vurl) continue;
      out.push({ title: p.title || '(untitled)', author: p.author, url: vurl });
    }
    return out;
  } catch { return []; }
}

// ── quick-add rows — trusted ecosystem sources the user can add in one click ─────────────────────────
// Radio streams and ScotTube reels are the ecosystem's own content; podcasts resolve to the latest
// episode's own enclosure audio. Each row is soft-failed independently and validated through
// buildPlaylist so nothing unsafe reaches the page.
export async function quickAddRows() {
  const [stations, shows, scots] = await Promise.all([
    safe(() => radio.dallasStations(6)),
    safe(() => podcasts.searchPodcasts({ term: POD_TERM, limit: 6 })),
    safe(() => scottubeFeed({ limit: 6 })),
  ]);

  const radioItems = buildPlaylist(
    stations.filter((s) => /^https:/i.test(s.stream || ''))
      .map((s) => ({ url: s.stream, title: s.name, kind: 'audio' }))
  ).slice(0, 6);

  // Podcasts: resolve the latest episode of the first show or two (one feed fetch each).
  const podItems = [];
  for (const s of shows.slice(0, 3)) {
    if (podItems.length >= 4) break;
    if (!s.feedUrl || !/^https:/i.test(s.feedUrl)) continue;
    const eps = await safe(() => podcasts.episodes(s.feedUrl, 1));
    const ep = eps[0];
    if (ep && /^https:/i.test(ep.audioUrl || '')) {
      podItems.push({ url: ep.audioUrl, title: `${s.title} — ${ep.title}`, kind: 'audio' });
    }
  }
  const podTracks = buildPlaylist(podItems).slice(0, 4);

  const scotTracks = buildPlaylist(
    scots.filter((v) => /^https:/i.test(v.url || ''))
      .map((v) => ({ url: v.url, title: `${v.title} · @${v.author}` }))
  ).slice(0, 6);

  return [
    { id: 'radio', title: 'Radio · Dallas first', kind: 'Radio', tracks: radioItems },
    { id: 'podcasts', title: 'Podcasts', kind: 'Podcast', tracks: podTracks },
    { id: 'scottube', title: 'On MELEK · ScotTube', kind: 'Video', tracks: scotTracks },
  ];
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
const STYLE = `
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:var(--gold);text-decoration:none} a:hover{text-decoration:underline}
  header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--bd)}
  .brand{font-size:22px;font-weight:800} .brand b{color:var(--gold)}
  .alpha{font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
  .wrap{max-width:1080px;margin:0 auto;padding:16px 18px 48px}
  .lead{color:var(--mut);font-size:14px;margin:2px 0 16px}
  .stage{position:relative;width:100%;background:#0a0e15 radial-gradient(circle at 50% 38%,#16202e,#0a0e15);border:1px solid var(--bd);border-radius:14px;overflow:hidden;min-height:200px;display:flex;flex-direction:column;justify-content:center}
  .stage video{width:100%;max-height:62vh;display:block;background:#000}
  .stage iframe{width:100%;height:62vh;border:0;display:block}
  .stage audio{width:100%;margin:auto;padding:24px 18px}
  .stage .none{color:var(--mut);text-align:center;padding:44px 20px}
  .stage .nowtitle{color:var(--fg);font-size:15px;font-weight:600;padding:0 18px 18px;text-align:center}
  .transport{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
  .btn{cursor:pointer;font-weight:700;border-radius:10px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 14px;font-size:14px}
  .btn:hover{border-color:var(--blue)} .btn.primary{border-color:var(--gold);color:var(--gold)}
  .addbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .addbar input{flex:1 1 260px;min-width:180px;background:#0b0f14;border:1px solid var(--bd);border-radius:10px;color:var(--fg);padding:10px 13px;font-size:14px}
  .addbar input:focus{border-color:var(--blue);outline:none}
  .msg{font-size:13px;color:var(--mut);min-height:18px;margin:2px 0 8px}
  .msg.err{color:var(--red)} .msg.ok{color:var(--green)}
  h2{font-size:15px;margin:20px 0 8px}
  ol.playlist{list-style:none;margin:0;padding:0;border:1px solid var(--bd);border-radius:12px;overflow:hidden}
  ol.playlist li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bd);background:var(--panel)}
  ol.playlist li:last-child{border-bottom:0}
  ol.playlist li.cur{background:#161d2a}
  ol.playlist li.empty{color:var(--mut);justify-content:center;font-size:13px}
  .pl-kind{font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap;text-transform:uppercase}
  .pl-kind.embed{color:var(--green);border-color:var(--green)}
  .pl-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;cursor:pointer}
  .pl-host{color:var(--mut);font-size:11px}
  .pl-ctl{display:flex;gap:4px}
  .pl-ctl button{cursor:pointer;background:#0e131b;border:1px solid var(--bd);border-radius:8px;color:var(--mut);font-size:13px;padding:3px 8px}
  .pl-ctl button:hover{color:var(--fg);border-color:var(--blue)}
  .rows{display:flex;flex-direction:column;gap:14px;margin-top:8px}
  .qrow h3{font-size:13px;margin:0 0 6px;color:var(--mut)}
  .qtiles{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}
  .qtile{min-width:200px;max-width:200px;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:11px 12px;display:flex;flex-direction:column;gap:6px}
  .qtile .qt{font-size:13px;line-height:1.35;max-height:2.7em;overflow:hidden}
  .qtile button{cursor:pointer;margin-top:auto;font-weight:700;border-radius:8px;border:1px solid var(--bd);background:#0e131b;color:var(--gold);padding:6px 10px;font-size:12px}
  .qtile button:hover{border-color:var(--gold)}
  .cast{border:1px solid var(--bd);border-radius:12px;padding:14px 16px;margin:20px 0;background:var(--panel);color:var(--mut);font-size:13px}
  .cast b{color:var(--fg)} .cast code{background:#0b0f14;border:1px solid var(--bd);border-radius:6px;padding:1px 6px;color:var(--gold)}
  .empty{color:var(--mut);font-size:13px;padding:8px 2px}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:28px 0 8px}`;

function stageFor(t) {
  if (!t) return '<div class=none>Playlist is empty — add a direct https media URL (or a YouTube / Vimeo / Archive link) below.</div>';
  const title = esc(t.title || '');
  if (t.kind === 'embed' && t.embed) {
    return `<iframe src="${esc(t.embed)}" title="${title}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy=no-referrer sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"></iframe>`;
  }
  if (t.kind === 'audio') {
    return `<audio controls preload=metadata src="${esc(t.url)}"></audio><div class=nowtitle>${title}</div>`;
  }
  // video — <video> carries the browser's native Chromecast / AirPlay controls (the honest "cast").
  return `<video controls playsinline preload=metadata src="${esc(t.url)}"${t.poster ? ` poster="${esc(t.poster)}"` : ''}></video>`;
}

function plItem(t, i, cur) {
  const kindCls = t.kind === 'embed' ? 'embed' : '';
  const kindLabel = t.kind === 'embed' ? (t.provider || 'embed') : t.kind;
  return `<li class="${cur ? 'cur' : ''}" data-i="${i}">
    <span class="pl-kind ${kindCls}">${esc(kindLabel)}</span>
    <span class=pl-title data-act=play data-i="${i}" title="${esc(t.title)}">${esc(t.title)} <span class=pl-host>${esc(t.host || '')}</span></span>
    <span class=pl-ctl>
      <button data-act=up data-i="${i}" title="Move up" aria-label="Move up">▲</button>
      <button data-act=down data-i="${i}" title="Move down" aria-label="Move down">▼</button>
      <button data-act=remove data-i="${i}" title="Remove" aria-label="Remove">✕</button>
    </span>
  </li>`;
}

/** The player stage + playlist HTML for a given state {tracks,index}. Escaped; pure. */
export function renderPlayer(state = {}) {
  const tracks = Array.isArray(state.tracks) ? state.tracks : [];
  const index = tracks.length ? Math.max(0, Math.min(tracks.length - 1, +state.index || 0)) : 0;
  const cur = tracks[index] || null;
  const list = tracks.length
    ? tracks.map((t, i) => plItem(t, i, i === index)).join('')
    : '<li class=empty>No tracks yet — add one above, or use a quick-add below.</li>';
  return `<div class=stage id=stage data-index="${index}">${stageFor(cur)}</div>
    <div class=transport>
      <button class=btn id=prev>⏮ Prev</button>
      <button class=btn id=next>Next ⏭</button>
      <button class=btn id=clear>Clear playlist</button>
    </div>
    <ol class=playlist id=playlist>${list}</ol>`;
}

function quickRowsHtml(rows) {
  const nonEmpty = rows.filter((r) => r.tracks.length);
  if (!nonEmpty.length) return '<p class=empty>Quick-add sources are quiet right now — paste a media URL above to start a playlist.</p>';
  return nonEmpty.map((r) => {
    const tiles = r.tracks.map((t) => `<div class=qtile>
      <div class=qt>${esc(t.title)}</div>
      <button class=qadd data-url="${esc(t.url)}" data-title="${esc(t.title)}" data-kind="${esc(t.kind)}">+ Add to playlist</button>
    </div>`).join('');
    return `<div class=qrow><h3>${esc(r.title)}</h3><div class=qtiles>${tiles}</div></div>`;
  }).join('');
}

// Client player: playlist state in localStorage, per-track resume, add via /api/resolve, reorder /
// next / prev / remove, autoplay-next on ended, quick-add buttons. Built with DOM APIs (textContent),
// so a hostile track title can never inject markup on the client either.
const CLIENT_JS = `
(function(){
  var KEY='melek_player_v1', POS='melek_player_pos_v1';
  var state={tracks:[],index:0};
  try{var s=JSON.parse(localStorage.getItem(KEY)||'null'); if(s&&Array.isArray(s.tracks)){state=s;}}catch(e){}
  var positions={}; try{positions=JSON.parse(localStorage.getItem(POS)||'{}')||{};}catch(e){}
  var stage=document.getElementById('stage'), list=document.getElementById('playlist');
  function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
  function savePos(){try{localStorage.setItem(POS,JSON.stringify(positions));}catch(e){}}
  function msg(t,cls){var m=document.getElementById('msg'); if(!m)return; m.textContent=t||''; m.className='msg'+(cls?' '+cls:'');}
  function el(tag,cls,txt){var e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;}

  function mountStage(){
    stage.textContent='';
    var t=state.tracks[state.index];
    if(!t){stage.appendChild(el('div','none','Playlist is empty — add a direct https media URL (or a YouTube / Vimeo / Archive link) below.')); return;}
    if(t.kind==='embed'&&t.embed){
      var f=document.createElement('iframe'); f.src=t.embed; f.title=t.title||''; f.setAttribute('allowfullscreen','');
      f.setAttribute('referrerpolicy','no-referrer'); f.setAttribute('allow','autoplay; fullscreen; encrypted-media; picture-in-picture');
      f.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation allow-forms');
      stage.appendChild(f); return;
    }
    var media=document.createElement(t.kind==='audio'?'audio':'video');
    media.src=t.url; media.controls=true; media.setAttribute('preload','metadata');
    if(t.kind==='video'){media.setAttribute('playsinline',''); if(t.poster)media.poster=t.poster;}
    media.addEventListener('loadedmetadata',function(){var p=positions[t.url]; if(p&&p<(media.duration||1e9)-3){try{media.currentTime=p;}catch(e){}}});
    media.addEventListener('timeupdate',function(){if(media.currentTime>3){positions[t.url]=media.currentTime; savePos();}});
    media.addEventListener('ended',function(){go(1);});
    stage.appendChild(media);
    if(t.kind==='audio'){stage.appendChild(el('div','nowtitle',t.title||''));}
    try{media.play().catch(function(){});}catch(e){}
  }

  function mountList(){
    list.textContent='';
    if(!state.tracks.length){var li=el('li','empty','No tracks yet — add one above, or use a quick-add below.'); list.appendChild(li); return;}
    state.tracks.forEach(function(t,i){
      var li=el('li',i===state.index?'cur':''); li.setAttribute('data-i',i);
      li.appendChild(el('span','pl-kind '+(t.kind==='embed'?'embed':''),(t.kind==='embed'?(t.provider||'embed'):t.kind)));
      var title=el('span','pl-title',t.title||''); title.title=t.title||'';
      var host=el('span','pl-host',' '+(t.host||'')); title.appendChild(host);
      title.addEventListener('click',function(){play(i);});
      li.appendChild(title);
      var ctl=el('span','pl-ctl');
      [['▲','up'],['▼','down'],['✕','remove']].forEach(function(p){
        var b=el('button',null,p[0]); b.addEventListener('click',function(){act(p[1],i);}); ctl.appendChild(b);
      });
      li.appendChild(ctl); list.appendChild(li);
    });
  }

  function render(){mountStage(); mountList(); save();}
  function play(i){if(i<0||i>=state.tracks.length)return; state.index=i; render();}
  function go(d){if(!state.tracks.length)return; play(Math.min(state.tracks.length-1,Math.max(0,state.index+d)));}
  function act(a,i){
    if(a==='up'&&i>0){var x=state.tracks.splice(i,1)[0]; state.tracks.splice(i-1,0,x); if(state.index===i)state.index=i-1; else if(state.index===i-1)state.index=i; render();}
    else if(a==='down'&&i<state.tracks.length-1){var y=state.tracks.splice(i,1)[0]; state.tracks.splice(i+1,0,y); if(state.index===i)state.index=i+1; else if(state.index===i+1)state.index=i; render();}
    else if(a==='remove'){state.tracks.splice(i,1); if(state.index>=state.tracks.length)state.index=Math.max(0,state.tracks.length-1); render();}
  }
  function addTrack(t,announce){
    var key=t.kind==='embed'?('embed:'+t.embed):t.url;
    for(var i=0;i<state.tracks.length;i++){var k=state.tracks[i].kind==='embed'?('embed:'+state.tracks[i].embed):state.tracks[i].url; if(k===key){if(announce)msg('Already in playlist.',''); return false;}}
    state.tracks.push(t); if(state.tracks.length===1)state.index=0; render(); if(announce)msg('Added: '+(t.title||t.url),'ok'); return true;
  }

  document.getElementById('next').addEventListener('click',function(){go(1);});
  document.getElementById('prev').addEventListener('click',function(){go(-1);});
  document.getElementById('clear').addEventListener('click',function(){state={tracks:[],index:0}; render(); msg('Playlist cleared.','');});

  var form=document.getElementById('addform');
  form.addEventListener('submit',function(ev){
    ev.preventDefault();
    var u=document.getElementById('addurl').value.trim(); if(!u){return;}
    var ti=document.getElementById('addtitle').value.trim();
    msg('Checking…','');
    fetch('/api/resolve?url='+encodeURIComponent(u)+(ti?'&title='+encodeURIComponent(ti):''))
      .then(function(r){return r.json();})
      .then(function(j){
        if(j&&j.ok&&j.track){addTrack(j.track,true); document.getElementById('addurl').value=''; document.getElementById('addtitle').value='';}
        else{msg(j&&j.reason?('Refused: '+j.reason):'Could not add that URL.','err');}
      }).catch(function(){msg('Network error — try again.','err');});
  });

  Array.prototype.forEach.call(document.querySelectorAll('.qadd'),function(b){
    b.addEventListener('click',function(){
      // quick-add sources are server-vetted; still route through /api/resolve so the same gate applies.
      var u=b.getAttribute('data-url'), ti=b.getAttribute('data-title')||'';
      fetch('/api/resolve?url='+encodeURIComponent(u)+'&title='+encodeURIComponent(ti)+'&hint='+encodeURIComponent(b.getAttribute('data-kind')||''))
        .then(function(r){return r.json();})
        .then(function(j){if(j&&j.ok&&j.track){addTrack(j.track,true);}else{msg(j&&j.reason?('Refused: '+j.reason):'Could not add.','err');}})
        .catch(function(){msg('Network error.','err');});
    });
  });

  render();
})();`;

function page(rows) {
  const head = headTags({
    title: `${SITE_NAME} — media player + playlist`,
    description: 'A real web media player for SoapBox: play direct media URLs and the ecosystem’s own content (ScotTube, radio, podcasts), build a playlist, and resume where you left off. Only official first-party players are embedded — nothing else.',
    canonical: `${BASE_URL}/`,
    siteName: SITE_NAME,
    robots: 'index,follow,max-image-preview:large',
    site: { url: BASE_URL, name: SITE_NAME },
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(SITE_NAME)} — media player + playlist</title>
${head}<style>${STYLE}</style>${impactUtt()}</head><body>
<header><span class=brand><b>MELEK</b> Player</span><span class=alpha>Alpha</span></header>
<div class=wrap>
  <p class=lead>Play a direct media URL or an official YouTube / Vimeo / Archive link, build a playlist, and pick up where you left off. Radio, podcasts, and on-chain ScotTube reels are one click away.</p>
  ${renderPlayer({ tracks: [], index: 0 })}
  <h2>Add media</h2>
  <form class=addbar id=addform autocomplete=off>
    <input id=addurl name=url placeholder="https://…  (mp3 / mp4 / webm, or a YouTube / Vimeo / Archive link)" aria-label="Media URL">
    <input id=addtitle name=title placeholder="Title (optional)" aria-label="Title" style="flex:0 1 180px">
    <button class="btn primary" type=submit>+ Add</button>
  </form>
  <div class=msg id=msg></div>
  <h2>Quick add · from the ecosystem</h2>
  <div class=rows>${quickRowsHtml(rows)}</div>
  <div class=cast>
    <b>Casting — the honest version.</b> A web page can’t take over your TV, and we don’t pretend to.
    What actually works is your browser’s own casting: on a video above, use the native
    <b>Chromecast</b> or <b>AirPlay</b> button your browser adds to the <code>&lt;video&gt;</code> controls,
    or open this page in your TV’s built-in browser and play there. Your playlist lives in this browser,
    so it follows the device you open it on — no device control, no fakery.
  </div>
  <footer>We play direct media and embed only official first-party players (YouTube, Vimeo, Dailymotion, 3Speak, Internet Archive). We never rehost, and we never frame an unlisted source. Your playlist stays in your browser.</footer>
</div>
<script>${CLIENT_JS}</script>
</body></html>`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL || 'http://player.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      return sendJson(res, { ok: true, surface: 'player' });
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: '1.0' }));
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
        summary: 'A web media player + playlist. Plays direct https media and the ecosystem’s own content (ScotTube, radio, podcasts); embeds only whitelisted official players; never rehosts. Playlist is client-side.',
        links: [{ label: 'Player', path: '/' }],
      }));
    }

    if (path === '/api/resolve') {
      // Validate + normalize one URL to a track. Soft-fail (always 200 JSON, never throws).
      const raw = url.searchParams.get('url') || '';
      const title = url.searchParams.get('title') || '';
      if (!isPlayable(raw)) {
        const reason = !raw ? 'no url'
          : /^https:/i.test(raw.trim()) ? 'not a direct media file and not a whitelisted official player'
          : 'must be an https URL (no javascript:/data:/http:)';
        return sendJson(res, { ok: false, reason });
      }
      const track = normalizeTrack({ url: raw, title });
      if (!track) return sendJson(res, { ok: false, reason: 'could not shape a track from that URL' });
      return sendJson(res, { ok: true, track });
    }

    if (path === '/') {
      const rows = await quickAddRows(); // already soft-failed per source
      return sendHtml(res, page(rows));
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Player on http://${HOST}:${PORT} — media player + playlist`));
}
