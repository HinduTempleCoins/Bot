// pentecaust-vtuber.mjs — Pentecaust F1: V-Tuber webcam show hosting (standalone module).
//
// The operator's spec (PLATFORM_VISION_v2 § F1): import a character (from /compose or /gallery) and host
// a live show with that character as your V-Tuber — the host's webcam drives the avatar (face landmarks →
// move / blink / open-mouth) — plus on-screen emojis + customizable animations the host or viewers can
// call onto the screen, and donation + Patreon / "Pact Page" fields (link-out / embed only; we take NO
// custody of anyone's payments).
//
// This is PURE / data + HTML-fragment builders. No network at import, no fs, soft-fail-never-throw. All
// the heavy lifting (webcam, tracking, avatar drive) runs in the VISITOR's browser via MediaPipe loaded
// from jsdelivr — CPU on their device, keyless, nothing uploaded, no GPU on our infra.
//
//   import { SHOW_EFFECTS, listEffects, showPageHtml, hubFragmentHtml } from './pentecaust-vtuber.mjs'
//   listEffects()          -> [{ id, title, kind, glyph|css, ... }]   (a) the overlay-effect registry
//   showPageHtml({...})    -> full self-contained HTML string          (b) the live show page
//   hubFragmentHtml({...}) -> HTML fragment listing shows              (c) the hub landing fragment
//
// Honesty note: the avatar is a real face-landmark-driven 2D puppet (the standard PNGtuber technique) —
// head translate + roll rotation from the eye line, a "talk" bounce from mouth-open, and a blink squash
// from eye-close. A procedural drawn face (default / no-image) demonstrates the same blink + mouth-open
// clearly. We do NOT claim identity-preserving 3D rigging here — that needs a GPU and is out of this scope.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── (a) on-screen overlay effect registry ───────────────────────────────────────────────────────────
// Two kinds:
//   'emoji' — spawns N floating emoji that drift up and fade (shared `pcz-float` keyframe). Has `glyph`.
//   'fx'    — a custom CSS animation. Has `css` (@keyframes + class) and a `mode`:
//             'particles' spawns `count` elements of the class; 'overlay' adds one auto-removing element;
//             'toggle' turns a persistent overlay on/off; 'stage' applies the class to the stage briefly.
export const EMOJI_EFFECTS = [
  { id: 'hearts',   title: 'Hearts',    kind: 'emoji', glyph: '❤️', count: 16 },
  { id: 'laugh',    title: 'Laugh',     kind: 'emoji', glyph: '😂', count: 14 },
  { id: 'fire',     title: 'Fire',      kind: 'emoji', glyph: '🔥', count: 16 },
  { id: 'star',     title: 'Stars',     kind: 'emoji', glyph: '⭐',       count: 16 },
  { id: 'clap',     title: 'Applause',  kind: 'emoji', glyph: '👏', count: 14 },
  { id: 'rose',     title: 'Roses',     kind: 'emoji', glyph: '🌹', count: 12 },
  { id: 'gift',     title: 'Gifts',     kind: 'emoji', glyph: '🎁', count: 12 },
  { id: 'thumbsup', title: 'Thumbs Up', kind: 'emoji', glyph: '👍', count: 14 },
  { id: 'hundred',  title: '100',       kind: 'emoji', glyph: '💯', count: 12 },
  { id: 'gem',      title: 'Gems',      kind: 'emoji', glyph: '💎', count: 12 },
  { id: 'pray',     title: 'Blessings', kind: 'emoji', glyph: '🙏', count: 12 },
  { id: 'party',    title: 'Party',     kind: 'emoji', glyph: '🎉', count: 14 },
];

export const FX_EFFECTS = [
  { id: 'confetti', title: 'Confetti', kind: 'fx', mode: 'particles', count: 48, glyph: '',
    css: '.pcz-confetti{position:absolute;top:-24px;width:10px;height:14px;border-radius:2px;opacity:.95;animation:pcz-fall linear forwards}'
       + '@keyframes pcz-fall{0%{transform:translateY(-24px) rotate(0)}100%{transform:translateY(105vh) rotate(720deg);opacity:.2}}' },
  { id: 'sparkles', title: 'Sparkles', kind: 'fx', mode: 'particles', count: 28, glyph: '✨',
    css: '.pcz-spark{position:absolute;font-size:22px;filter:drop-shadow(0 0 6px #ffe08a);animation:pcz-twinkle 1.1s ease-out forwards}'
       + '@keyframes pcz-twinkle{0%{transform:scale(.2) rotate(0);opacity:0}30%{opacity:1}100%{transform:scale(1.4) rotate(90deg);opacity:0}}' },
  { id: 'snow',     title: 'Snow',     kind: 'fx', mode: 'particles', count: 40, glyph: '',
    css: '.pcz-snow{position:absolute;top:-16px;width:8px;height:8px;border-radius:50%;background:#eaf4ff;box-shadow:0 0 6px #cfe6ff;animation:pcz-drift linear forwards}'
       + '@keyframes pcz-drift{0%{transform:translate(0,-16px)}100%{transform:translate(24px,105vh);opacity:.3}}' },
  { id: 'goldflash', title: 'Gold Flash', kind: 'fx', mode: 'overlay', count: 1, glyph: '',
    css: '.pcz-goldflash{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 45%,rgba(255,243,196,.75),rgba(210,153,34,.25) 55%,transparent 75%);animation:pcz-flash 900ms ease-out forwards}'
       + '@keyframes pcz-flash{0%{opacity:0}20%{opacity:1}100%{opacity:0}}' },
  { id: 'shake',    title: 'Shake',    kind: 'fx', mode: 'stage', count: 1, glyph: '',
    css: '.pcz-shake{animation:pcz-shake 600ms ease-in-out}'
       + '@keyframes pcz-shake{0%,100%{transform:translate(0,0)}20%{transform:translate(-8px,4px)}40%{transform:translate(7px,-5px)}60%{transform:translate(-6px,-3px)}80%{transform:translate(5px,4px)}}' },
  { id: 'neonframe', title: 'Neon Frame', kind: 'fx', mode: 'toggle', count: 1, glyph: '',
    css: '.pcz-neonframe{position:absolute;inset:0;pointer-events:none;border:6px solid transparent;border-radius:14px;'
       + 'box-shadow:inset 0 0 22px rgba(88,166,255,.7),inset 0 0 60px rgba(210,153,34,.35);animation:pcz-neon 2.4s linear infinite}'
       + '@keyframes pcz-neon{0%{box-shadow:inset 0 0 22px rgba(88,166,255,.7),inset 0 0 60px rgba(210,153,34,.35)}50%{box-shadow:inset 0 0 22px rgba(210,153,34,.7),inset 0 0 60px rgba(88,166,255,.35)}100%{box-shadow:inset 0 0 22px rgba(88,166,255,.7),inset 0 0 60px rgba(210,153,34,.35)}}' },
];

// The combined registry. Every entry has: id (string), title (string), kind ('emoji'|'fx').
// emoji entries carry `glyph`; fx entries carry `css` + `mode`.
export const SHOW_EFFECTS = [...EMOJI_EFFECTS, ...FX_EFFECTS];

export function listEffects(kind) {
  if (kind === 'emoji') return EMOJI_EFFECTS.slice();
  if (kind === 'fx') return FX_EFFECTS.slice();
  return SHOW_EFFECTS.slice();
}

// One <style> block carrying the shared emoji float keyframe + every fx effect's css.
export function effectStyles() {
  const shared = '.pcz-emoji{position:absolute;bottom:-10%;font-size:34px;pointer-events:none;will-change:transform,opacity;animation:pcz-float 2.6s ease-in forwards}'
    + '@keyframes pcz-float{0%{transform:translateY(0) scale(.6) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(-115vh) scale(1.15) rotate(var(--pcz-rot,20deg));opacity:0}}';
  return `<style id=pcz-fx>${shared}${FX_EFFECTS.map((f) => f.css || '').join('')}</style>`;
}

// ── house-style CDN loads (jsdelivr only) — kept in one place so the test can verify them ─────────────
const MEDIAPIPE_VER = '0.10.14';
const MEDIAPIPE_ESM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VER}`;
const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VER}/wasm`;
// MediaPipe MODEL data (not a script) — Google's canonical host, fetched by the tracker at runtime.
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const THEME = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  .wrap{max-width:1040px;margin:0 auto;padding:18px}
  h1{margin:0 0 4px;font-size:24px} h2{font-size:17px;margin:18px 0 8px} .muted{color:var(--mut)} .gold{color:var(--gold)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:12px 0}
  .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .stage{position:relative;width:100%;max-width:960px;aspect-ratio:4/3;margin:0 auto;background:#000;border:1px solid var(--line2);border-radius:12px;overflow:hidden}
  .stage canvas,.stage video{position:absolute;inset:0;width:100%;height:100%}
  #pcz-overlay{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3}
  #pcz-cam{z-index:1} #pcz-avatar{z-index:2}
  button{cursor:pointer;background:var(--blue);border:1px solid var(--blue);border-radius:8px;color:#0d1117;font-weight:700;padding:9px 16px;font-size:14px}
  button:hover{filter:brightness(1.1)}
  .pill{display:inline-block;font-size:13px;background:transparent;color:var(--fg);border:1px solid var(--line2);border-radius:16px;padding:6px 13px}
  .pill:hover{border-color:var(--blue);color:var(--blue)}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font-size:14px;width:100%}
  input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  label.fld{display:block;margin:8px 0 3px;font-weight:600;font-size:13px}
  .support a{display:inline-block;margin:4px 8px 4px 0;font-weight:700}
  .btn-donate{background:var(--gold);border-color:var(--gold);color:#0d1117}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:22px;margin-top:20px;border-top:1px solid var(--line2)}
</style>`;

// A control button for one effect. `data-*` attributes fully drive the (generic) client spawner.
function effectButton(f) {
  const attrs = f.kind === 'emoji'
    ? `data-kind=emoji data-glyph="${esc(f.glyph)}" data-count="${esc(f.count || 14)}"`
    : `data-kind=fx data-fx="${esc(f.id)}" data-mode="${esc(f.mode || 'particles')}" data-count="${esc(f.count || 24)}" data-glyph="${esc(f.glyph || '')}"`;
  const face = f.kind === 'emoji' ? `${esc(f.glyph)} ${esc(f.title)}` : esc(f.title);
  return `<button type=button class="pill pcz-trigger" ${attrs} title="${esc(f.title)}">${face}</button>`;
}

// A link-out / embed support button (only rendered when a URL is supplied). Never posts anywhere: it is a
// plain external link — we take NO custody of the creator's funding.
function supportLink(url, label, cls) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return '';
  return `<a class="pill ${cls || ''}" href="${esc(u)}" target=_blank rel="noopener nofollow">${esc(label)} ↗</a>`;
}

// ── (b) the live show page ──────────────────────────────────────────────────────────────────────────
export function showPageHtml(opts = {}) {
  const o = opts || {};
  const title = o.title || 'Untitled show';
  const host = o.host || 'a MELEK creator';
  const charUrl = String(o.characterUrl || '').trim();
  const charName = o.characterName || '';
  const baseUrl = String(o.baseUrl || '').replace(/\/$/, '');
  const canonical = o.canonical || (baseUrl ? `${baseUrl}/pentecaust` : '');
  const d = o.donate || {};

  const emojiBtns = EMOJI_EFFECTS.map(effectButton).join('');
  const fxBtns = FX_EFFECTS.map(effectButton).join('');

  const support = [
    supportLink(d.patreon, 'Patreon', 'btn-donate'),
    supportLink(d.pactpage, 'Pact Page', ''),
    supportLink(d.kofi, 'Ko-fi', ''),
    supportLink(d.custom, d.customLabel || 'Support', ''),
  ].join('');
  const cryptoRow = (d.cryptoAddress)
    ? `<div class=row style="margin-top:8px"><span class=muted style="font-size:12px">${esc(d.cryptoLabel || 'Tip')}:</span>
        <code id=pcz-crypto style="font-size:12px;word-break:break-all">${esc(d.cryptoAddress)}</code>
        <button type=button class=pill id=pcz-copy>Copy</button></div>`
    : '';

  const body = `<div class=wrap>
    <h1>${esc(title)} <span class=muted style="font-size:13px">· Pentecaust V-Tuber show</span></h1>
    <p class=muted>Hosted by <b>${esc(host)}</b>${charName ? ` · avatar: <b>${esc(charName)}</b>` : ''}.
      Your webcam drives the avatar right here in your browser — <b>nothing is uploaded</b>, no GPU on our side, no account.</p>

    <div class=stage id=pcz-stage>
      <video id=pcz-cam playsinline muted style="display:none"></video>
      <canvas id=pcz-avatar width=960 height=720></canvas>
      <div id=pcz-overlay></div>
    </div>

    <div class=card>
      <div class=row style="margin-bottom:8px">
        <button type=button id=pcz-start>▶ Start camera</button>
        <button type=button class=pill id=pcz-mode>Avatar: drawn face</button>
        <label class="pill" style="cursor:pointer">Import character<input type=file id=pcz-charfile accept="image/*" hidden></label>
        <button type=button class=pill id=pcz-snap>📸 Snapshot</button>
        <button type=button class=pill id=pcz-rec>⏺ Record</button>
        <a class=pill id=pcz-dl style="display:none" download="pentecaust-show.png">⬇ Download</a>
      </div>
      <p class=muted id=pcz-status style="font-size:12px;margin:0">Click “Start camera” (your browser will ask permission). The avatar moves, blinks and opens its mouth with your face.</p>
    </div>

    <h2>On-screen emojis <span class=muted style="font-size:12px">(${EMOJI_EFFECTS.length})</span></h2>
    <div class=card id=pcz-emoji-strip><div class=row>${emojiBtns}</div></div>

    <h2>Animations <span class=muted style="font-size:12px">(${FX_EFFECTS.length})</span></h2>
    <div class=card id=pcz-fx-strip><div class=row>${fxBtns}</div></div>

    <h2>Support this show</h2>
    <div class=card>
      <p class=muted style="font-size:13px;margin:0 0 8px">Link out to your own funding — <b>we take no custody of payments</b>. Paste a URL to add or change a button live (on your device only).</p>
      <div class="support" id=pcz-support>${support || '<span class=muted style="font-size:12px">No funding links yet — add them below.</span>'}</div>
      ${cryptoRow}
      <div class=row style="margin-top:10px;align-items:flex-end">
        <div style="flex:1 1 240px"><label class=fld for=pcz-in-patreon>Patreon URL</label><input class=q id=pcz-in-patreon placeholder="https://patreon.com/you" value="${esc(d.patreon || '')}"></div>
        <div style="flex:1 1 240px"><label class=fld for=pcz-in-pact>Pact Page URL</label><input class=q id=pcz-in-pact placeholder="https://pactpage.example/you" value="${esc(d.pactpage || '')}"></div>
        <div style="flex:1 1 240px"><label class=fld for=pcz-in-kofi>Ko-fi / other URL</label><input class=q id=pcz-in-kofi placeholder="https://ko-fi.com/you" value="${esc(d.kofi || '')}"></div>
        <button type=button id=pcz-apply-links>Apply</button>
      </div>
    </div>

    <div class=card><p class=muted style="font-size:12px;margin:0"><b>Go live / broadcast:</b> add this page as an OBS / Streamlabs
      <b>Browser Source</b> and output OBS's Virtual Camera to appear on Zoom, Meet, Discord or a stream. The avatar, emojis
      and animations all render on the canvas. Tracking runs on your CPU via MediaPipe; the imported character comes from
      Hathor's <a href="/compose">Reference Studio</a> or <a href="/gallery">gallery</a>.</p></div>
  </div>
  <footer>Pentecaust — a Hathor / MELEK creator surface. In-browser, keyless, nothing uploaded. <a href="/pentecaust">All shows</a> · <a href="/webcam">Webcam Studio</a></footer>

  <script type=module>
  import { FaceLandmarker, FilesetResolver } from '${MEDIAPIPE_ESM}';
  const $=s=>document.querySelector(s);
  const cv=$('#pcz-avatar'), ctx=cv.getContext('2d'), v=$('#pcz-cam'), stage=$('#pcz-stage'),
        overlay=$('#pcz-overlay'), statusEl=$('#pcz-status'), dl=$('#pcz-dl');
  const W=cv.width, H=cv.height;
  const GOLD='#e0b44c';
  let face=null, running=false, rec=null, chunks=[], useImage=false, charImg=null;
  // smoothed avatar drive state
  let sx=W/2, sy=H*0.46, sroll=0, smouth=0, sblink=1;

  // import a character image (from /compose or /gallery, or the visitor's file). Preload one if supplied.
  const START_CHAR=${JSON.stringify(charUrl)};
  function loadChar(src){ const i=new Image(); i.crossOrigin='anonymous'; i.onload=()=>{charImg=i;useImage=true;$('#pcz-mode').textContent='Avatar: character';}; i.onerror=()=>{statusEl.textContent='Could not load that character image (CORS?). Using the drawn face.';}; i.src=src; }
  if(START_CHAR) loadChar(START_CHAR);
  $('#pcz-charfile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(!f)return;loadChar(URL.createObjectURL(f));});
  $('#pcz-mode').addEventListener('click',()=>{ if(!charImg){statusEl.textContent='Import a character first to switch avatars.';return;} useImage=!useImage; $('#pcz-mode').textContent='Avatar: '+(useImage?'character':'drawn face'); });

  async function init(){ statusEl.textContent='Loading the face tracker (first run downloads it)…';
    const vision=await FilesetResolver.forVisionTasks('${MEDIAPIPE_WASM}');
    face=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'${FACE_MODEL}'},runningMode:'VIDEO',numFaces:1}); }
  $('#pcz-start').addEventListener('click', async ()=>{ try{
      if(!face) await init();
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:960,height:720},audio:false});
      v.srcObject=stream; await v.play(); running=true; statusEl.textContent='Live. Trigger emojis and animations below.'; loop();
    }catch(err){ statusEl.textContent='Camera/model unavailable here ('+(err&&err.message||err)+').'; } });

  const lerp=(a,b,t)=>a+(b-a)*t;
  function drive(lm){ const P=i=>({x:lm[i].x, y:lm[i].y});
    const le=P(33), re=P(263), top=P(10), chin=P(152), nose=P(1);
    const upLip=P(13), loLip=P(14); const leU=P(159), leL=P(145);
    const faceH=Math.hypot(top.x-chin.x,top.y-chin.y)||0.001;
    const roll=Math.atan2(re.y-le.y, re.x-le.x);            // head tilt from the eye line
    const mouth=Math.min(1,Math.max(0,(Math.hypot(upLip.x-loLip.x,upLip.y-loLip.y)/faceH-0.02)*6)); // open ratio
    const eye=Math.min(1,Math.max(0,(Math.hypot(leU.x-leL.x,leU.y-leL.y)/faceH-0.012)*22));          // 1 open .. 0 closed
    sx=lerp(sx, nose.x*W, 0.35); sy=lerp(sy, nose.y*H, 0.35);
    sroll=lerp(sroll, roll, 0.35); smouth=lerp(smouth, mouth, 0.5); sblink=lerp(sblink, eye, 0.6); }

  function drawImageAvatar(){ const iw=charImg.naturalWidth||charImg.width, ih=charImg.naturalHeight||charImg.height;
    const base=Math.min(W*0.7/iw, H*0.9/ih); const bounce=1+smouth*0.06; const squash=0.85+sblink*0.15; // blink squash, talk bounce
    ctx.save(); ctx.translate(sx, sy - H*0.02*smouth); ctx.rotate(sroll*0.6);
    ctx.scale(base*bounce, base*bounce*squash); ctx.drawImage(charImg, -iw/2, -ih/2, iw, ih); ctx.restore(); }

  function drawProceduralAvatar(){ // a drawn 2D face that visibly blinks + opens its mouth from the tracking
    const cx=sx, cy=sy, r=H*0.24;
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(sroll*0.6);
    ctx.fillStyle='#f1d3b0'; ctx.strokeStyle=GOLD; ctx.lineWidth=6;
    ctx.beginPath(); ctx.ellipse(0,0,r*0.82,r,0,0,7); ctx.fill(); ctx.stroke();
    // eyes — height collapses to a line on blink (sblink 1 open .. 0 closed)
    const ey=-r*0.18, ex=r*0.34, eh=Math.max(2,r*0.14*sblink);
    ctx.fillStyle='#20242c';
    [-1,1].forEach(s=>{ ctx.beginPath(); ctx.ellipse(s*ex,ey,r*0.16,eh,0,0,7); ctx.fill(); });
    // mouth — opens with smouth
    const mh=r*0.06+r*0.34*smouth;
    ctx.fillStyle='#7a2230'; ctx.beginPath(); ctx.ellipse(0,r*0.34,r*0.28,mh,0,0,7); ctx.fill();
    ctx.restore(); }

  function loop(){ if(!running) return;
    ctx.clearRect(0,0,W,H);
    const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#12161d'); g.addColorStop(1,'#0b0f14'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    if(face){ const fr=face.detectForVideo(v, performance.now()); if(fr.faceLandmarks && fr.faceLandmarks[0]) drive(fr.faceLandmarks[0]); }
    if(useImage && charImg) drawImageAvatar(); else drawProceduralAvatar();
    requestAnimationFrame(loop); }

  // ── overlay effect spawner (generic, driven by the button data-* from the registry) ──
  const rand=(a,b)=>a+Math.random()*(b-a);
  let neonOn=null;
  function spawnEmoji(glyph,count){ for(let i=0;i<count;i++){ const el=document.createElement('span'); el.className='pcz-emoji';
      el.textContent=glyph; el.style.left=rand(2,92)+'%'; el.style.fontSize=rand(24,46)+'px';
      el.style.setProperty('--pcz-rot',(rand(-40,40))+'deg'); el.style.animationDelay=rand(0,0.5)+'s'; el.style.animationDuration=rand(2.1,3.2)+'s';
      overlay.appendChild(el); setTimeout(()=>el.remove(),3800); } }
  const CONFETTI_COLORS=['#58a6ff','#d29922','#3fb950','#f85149','#c86bff','#ffe08a'];
  function spawnFx(id,mode,count,glyph){
    if(mode==='stage'){ stage.classList.remove('pcz-'+id); void stage.offsetWidth; stage.classList.add('pcz-'+id); setTimeout(()=>stage.classList.remove('pcz-'+id),700); return; }
    if(mode==='toggle'){ if(neonOn){neonOn.remove();neonOn=null;return;} const el=document.createElement('div'); el.className='pcz-'+id; overlay.appendChild(el); neonOn=el; return; }
    if(mode==='overlay'){ const el=document.createElement('div'); el.className='pcz-'+id; overlay.appendChild(el); setTimeout(()=>el.remove(),1000); return; }
    // particles
    for(let i=0;i<count;i++){ const el=document.createElement(glyph?'span':'div'); el.className='pcz-'+(id==='confetti'?'confetti':id==='snow'?'snow':'spark');
      el.style.left=rand(0,98)+'%'; el.style.animationDelay=rand(0,0.6)+'s'; el.style.animationDuration=rand(1.4,3.2)+'s';
      if(glyph){ el.textContent=glyph; } else if(id==='confetti'){ el.style.background=CONFETTI_COLORS[i%CONFETTI_COLORS.length]; }
      overlay.appendChild(el); setTimeout(()=>el.remove(),3600); } }
  document.querySelectorAll('.pcz-trigger').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.kind==='emoji') spawnEmoji(b.dataset.glyph, +b.dataset.count||14);
    else spawnFx(b.dataset.fx, b.dataset.mode, +b.dataset.count||24, b.dataset.glyph||''); }));

  // ── support links: apply pasted URLs live (client-side only; nothing sent) ──
  function safeUrl(u){ return /^https?:\\/\\//i.test((u||'').trim()) ? u.trim() : ''; }
  function mkLink(u,label,cls){ if(!u) return ''; const a=document.createElement('a'); a.className='pill '+(cls||''); a.href=u; a.target='_blank'; a.rel='noopener nofollow'; a.textContent=label+' ↗'; return a; }
  $('#pcz-apply-links').addEventListener('click',()=>{ const box=$('#pcz-support'); box.textContent='';
    const items=[[safeUrl($('#pcz-in-patreon').value),'Patreon','btn-donate'],[safeUrl($('#pcz-in-pact').value),'Pact Page',''],[safeUrl($('#pcz-in-kofi').value),'Ko-fi',''] ];
    let any=false; items.forEach(([u,l,c])=>{ if(u){ box.appendChild(mkLink(u,l,c)); box.appendChild(document.createTextNode(' ')); any=true; } });
    if(!any) box.innerHTML='<span class=muted style="font-size:12px">No funding links yet.</span>'; });
  const copyBtn=$('#pcz-copy'); if(copyBtn) copyBtn.addEventListener('click',()=>{ const t=$('#pcz-crypto'); if(t&&navigator.clipboard){navigator.clipboard.writeText(t.textContent).then(()=>{copyBtn.textContent='Copied';setTimeout(()=>copyBtn.textContent='Copy',1500);});} });

  $('#pcz-snap').addEventListener('click',()=>{ cv.toBlob(b=>{ if(b){ dl.href=URL.createObjectURL(b); dl.download='pentecaust-show.png'; dl.style.display=''; statusEl.textContent='Snapshot ready — download it.'; } },'image/png'); });
  $('#pcz-rec').addEventListener('click',()=>{ if(rec&&rec.state==='recording'){ rec.stop(); $('#pcz-rec').textContent='⏺ Record'; return; }
    try{ chunks=[]; rec=new MediaRecorder(cv.captureStream(30),{mimeType:'video/webm'}); rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      rec.onstop=()=>{ const b=new Blob(chunks,{type:'video/webm'}); dl.href=URL.createObjectURL(b); dl.download='pentecaust-show.webm'; dl.style.display=''; statusEl.textContent='Clip ready — download it.'; };
      rec.start(); $('#pcz-rec').textContent='⏹ Stop'; statusEl.textContent='Recording…'; }catch(e){ statusEl.textContent='Recording not supported here.'; } });
  </script>`;

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} — Pentecaust V-Tuber show</title>
<meta name=description content="${esc(`${title} — a live Pentecaust V-Tuber show hosted by ${host}. In-browser webcam avatar, on-screen emojis and animations, creator funding. Keyless, nothing uploaded.`)}">
<meta name=robots content="index,follow">${canonical ? `\n<link rel=canonical href="${esc(canonical)}">` : ''}
${THEME}
${effectStyles()}
</head><body>${body}</body></html>`;
}

// ── (c) the hub landing fragment — lists shows ──────────────────────────────────────────────────────
// Returns an HTML FRAGMENT (the central server drops it into its own pageShell). `shows` is an array of
// { id, title, host, characterUrl?, live? }. `basePath` sets the per-show link (default /pentecaust/s/<id>).
export function hubFragmentHtml(opts = {}) {
  const o = opts || {};
  const shows = Array.isArray(o.shows) ? o.shows : [];
  const basePath = String(o.basePath || '/pentecaust').replace(/\/$/, '');
  const showHref = (s) => `${basePath}/s/${encodeURIComponent(String(s.id || ''))}`;

  const cards = shows.map((s) => {
    const live = s.live ? '<span class="badge" style="background:#3fb95033;color:#3fb950;border-radius:8px;padding:1px 8px;font-size:11px">● LIVE</span>' : '';
    const thumb = String(s.characterUrl || '').trim();
    const thumbHtml = /^https?:\/\/|^\//.test(thumb)
      ? `<img src="${esc(thumb)}" alt="${esc(s.title || 'show')}" loading=lazy style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:8px 8px 0 0;background:#0b0f14">`
      : '<div style="width:100%;aspect-ratio:16/10;border-radius:8px 8px 0 0;background:linear-gradient(135deg,#12161d,#0b0f14);display:flex;align-items:center;justify-content:center;font-size:34px">🎭</div>';
    return `<a class=sec href="${esc(showHref(s))}" style="padding:0;overflow:hidden">
      ${thumbHtml}
      <div style="padding:12px 14px"><div class=t>${esc(s.title || 'Untitled show')} ${live}</div>
        <div class=d>Hosted by ${esc(s.host || 'a MELEK creator')}</div></div></a>`;
  }).join('');

  const empty = '<div class=card><p class=empty>No shows yet. Be the first — import a character from the <a href="/compose">Reference Studio</a> and start one.</p></div>';

  return `<h1>Pentecaust <span class=muted style="font-size:14px">· V-Tuber shows on MELEK</span></h1>
    <p class=muted>Host a live show as your imported character — your webcam drives the avatar in your own browser
      (face tracking on your CPU, keyless, nothing uploaded). Call emojis and animations onto the screen; link your own
      funding (Patreon, Pact Page, Ko-fi) — <b>we take no custody of payments</b>.</p>
    <div class=row style="margin:10px 0"><a class=pill href="${esc(basePath)}/new">➕ Start a show</a>
      <a class=pill href="/compose">Design a character</a> <a class=pill href="/webcam">Webcam Studio</a></div>
    ${shows.length ? `<div class=gallery>${cards}</div>` : empty}`;
}

export default { SHOW_EFFECTS, EMOJI_EFFECTS, FX_EFFECTS, listEffects, effectStyles, showPageHtml, hubFragmentHtml };
