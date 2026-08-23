// server.mjs — sleep.melek.salon — the MELEK Sleep / Focus player. A dark, calm, full-screen
// audio surface whose sound is GENERATED CLIENT-SIDE with the Web Audio API — two detuned sine
// tones make a binaural beat, an amplitude-gated tone makes an isochronic pulse, and a 40 Hz
// preset gives the gamma tone. There is NO audio file anywhere: nothing to stream, nothing to
// rehost, nothing to license. This is 100% ours — pure synthesis in the listener's own browser.
//
//   PORT=8168 BASE_URL=https://sleep.melek.salon node site/sleep/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the full-screen player (optional ?band=&min= to preselect a preset + timer).
//   /api/presets JSON of the band table (BANDS) — the presets a client offers.
//   /health      liveness probe.
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   The SERVER only renders the page + presets — it is pure and testable; the audio math runs in the
//   browser. HOST posture: the tones are synthesized locally, so we hold no license and stream no
//   file. Optionally we point at a public-domain nature-sound backing track via the shared music
//   reader (searchIA — keyless, feature-detected, soft-fail); if it is unavailable the player is
//   fully functional without it. esc() on every interpolated value. Soft-fail: every route renders
//   even when a helper is handed bad input — nothing throws to the route. Read-only: holds no key,
//   signs nothing. Not medical advice; includes a hearing-safety note.

import { createServer } from 'node:http';

// Optional PD nature-sound backing track reader — reused, keyless, feature-detected, soft-fail.
// We import it lazily/defensively: the player never depends on it.
import * as musicCatalog from '../../integrations/soapbox/music-catalog.mjs';

const PORT = +(process.env.PORT || 8168);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ── house-style helper ───────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Injectable fetch — fanned to the optional backing-track reader so the offline tests mock it.
export function __setFetch(fn) {
  try { if (musicCatalog && typeof musicCatalog.__setFetch === 'function') musicCatalog.__setFetch(fn); } catch { /* soft-fail */ }
}

// ── BANDS — the brainwave-band preset table (name → {beat, carrier, blurb}) ────────────────────────
// beat = the entrainment frequency (Hz, the difference between the two ears / the pulse rate).
// carrier = the base tone both ears hear (Hz). blurb = plain-language "what it's for".
// These five cover the classic EEG bands; Gamma is the 40 Hz preset. Facts, not claims: the blurbs
// describe the traditional association, and the page states plainly this is not medical advice.
export const BANDS = {
  delta: { beat: 2, carrier: 100, blurb: 'Delta · 2 Hz — deep sleep' },
  theta: { beat: 6, carrier: 150, blurb: 'Theta · 6 Hz — meditation, drifting off' },
  alpha: { beat: 10, carrier: 200, blurb: 'Alpha · 10 Hz — calm, relaxed focus' },
  beta: { beat: 18, carrier: 240, blurb: 'Beta · 18 Hz — alert focus' },
  gamma: { beat: 40, carrier: 250, blurb: 'Gamma · 40 Hz — the 40 Hz gamma preset' },
};
const DEFAULT_BAND = 'alpha';

// Safe numeric clamp — soft-fails a bad value to a fallback inside [lo, hi].
function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** presetFor(name) → a band preset object {name, beat, carrier, blurb}. Unknown → the safe default. */
export function presetFor(name) {
  const key = String(name == null ? '' : name).trim().toLowerCase();
  const band = Object.prototype.hasOwnProperty.call(BANDS, key) ? key : DEFAULT_BAND;
  return { name: band, ...BANDS[band] };
}

/**
 * sessionPlan({band, minutes, fadeSec, type}) → a validated, shaped session plan. Soft-fails every
 * field to a safe value; never throws. type ∈ {binaural, isochronic, gamma}.
 *   { band, carrier, beat, minutes, fadeSec, type, blurb }
 */
export function sessionPlan(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const preset = presetFor(o.band);
  const validTypes = ['binaural', 'isochronic', 'gamma'];
  let type = String(o.type == null ? '' : o.type).trim().toLowerCase();
  if (!validTypes.includes(type)) type = 'binaural';
  // Gamma is a band AND a type; when the type is gamma, pin the carrier/beat to the gamma preset.
  const g = type === 'gamma' ? presetFor('gamma') : preset;
  const carrier = clampNum(o.carrier, 20, 1500, g.carrier);
  const beat = clampNum(o.beat, 0.5, 100, g.beat);
  const minutes = Math.round(clampNum(o.minutes, 0, 600, 30));
  const fadeSec = Math.round(clampNum(o.fadeSec, 0, 600, 30));
  return {
    band: type === 'gamma' ? 'gamma' : preset.name,
    carrier,
    beat,
    minutes,
    fadeSec,
    type,
    blurb: (type === 'gamma' ? presetFor('gamma') : preset).blurb,
  };
}

// ── optional PD nature-sound backing track (feature-detected, soft-fail) ───────────────────────────
/**
 * A single public-domain ambient/nature backing track to layer under the tones, discovered through
 * the shared music reader (searchIA — keyless Internet Archive). Feature-detected and soft-fail:
 * returns null when the reader is absent or the network is unavailable. The player works without it.
 */
export async function backingTrack(query = 'rain ambient nature') {
  try {
    if (!musicCatalog || typeof musicCatalog.searchIA !== 'function') return null;
    const tracks = await musicCatalog.searchIA({ query: String(query || ''), limit: 1 });
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const t = tracks[0];
    if (!t || !t.streamUrl) return null;
    return { title: t.title || 'Ambient', artist: t.artist || '', streamUrl: t.streamUrl, license: t.license || '' };
  } catch {
    return null;
  }
}

// ── the page ───────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#05060a;--bg2:#0b0f18;--panel:#111725;--line:#1c2740;--fg:#e6edf3;--mut:#7d8aa3;--glow:#8a7dff;--gold:#d29922;--up:#5fd68a}
  *{box-sizing:border-box} html,body{height:100%}
  body{font:15px/1.6 system-ui,-apple-system,sans-serif;margin:0;background:radial-gradient(1200px 800px at 50% -10%,#131a2e 0%,var(--bg2) 45%,var(--bg) 100%);color:var(--fg);min-height:100vh;display:flex;flex-direction:column}
  a{color:var(--glow);text-decoration:none} a:hover{text-decoration:underline}
  .alpha{position:fixed;top:12px;left:14px;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:1px 6px;text-transform:uppercase;z-index:9}
  main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 20px 40px;width:100%;max-width:640px;margin:0 auto}
  h1{font-size:26px;font-weight:800;margin:0 0 2px;text-align:center;letter-spacing:.01em}
  .sub{color:var(--mut);font-size:14px;text-align:center;margin:0 0 22px;max-width:52ch}
  .orb{width:180px;height:180px;border-radius:50%;margin:6px 0 26px;background:radial-gradient(circle at 50% 40%,#a99bff 0%,#6a5cff 40%,#2b2b6b 100%);box-shadow:0 0 60px 10px #6a5cff55;transition:transform .6s ease,box-shadow .6s ease}
  .orb.on{animation:breathe 8s ease-in-out infinite}
  @keyframes breathe{0%,100%{transform:scale(.9);box-shadow:0 0 40px 6px #6a5cff44}50%{transform:scale(1.08);box-shadow:0 0 90px 20px #6a5cff88}}
  @media (prefers-reduced-motion:reduce){.orb.on{animation:none}}
  .panel{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px;box-shadow:0 20px 60px #0008}
  .row{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:12px 0}
  label{font-size:13px;color:var(--mut);display:flex;flex-direction:column;gap:5px;flex:1 1 150px}
  label b{color:var(--fg);font-weight:600;font-size:13px}
  select,input[type=number]{background:#0a0e18;border:1px solid var(--line);border-radius:9px;color:var(--fg);padding:9px 11px;font-size:14px}
  input[type=range]{width:100%;accent-color:var(--glow)}
  .seg{display:flex;gap:8px;flex-wrap:wrap}
  .seg button{flex:1;min-width:96px;background:#0a0e18;border:1px solid var(--line);border-radius:9px;color:var(--fg);font-weight:600;font-size:13px;padding:9px 8px;cursor:pointer}
  .seg button.active{border-color:var(--glow);color:#fff;background:#1a1740}
  .val{color:var(--glow);font-weight:700}
  .play{width:100%;margin-top:16px;background:linear-gradient(180deg,#7d6cff,#5a4be0);border:0;border-radius:12px;color:#fff;font-weight:800;font-size:17px;padding:15px;cursor:pointer;letter-spacing:.02em}
  .play:hover{filter:brightness(1.08)} .play.playing{background:linear-gradient(180deg,#2a3350,#1c2740)}
  .status{text-align:center;color:var(--mut);font-size:13px;margin-top:10px;min-height:18px}
  .note{color:var(--mut);font-size:12px;line-height:1.6;margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
  .note b{color:var(--fg)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:22px}
  footer a{color:var(--glow)}
</style>`;

/**
 * renderPage(preset) — the full player HTML. `preset` is a sessionPlan-shaped object (or anything;
 * it is re-normalized through sessionPlan so the function is total and esc-safe).
 */
export function renderPage(preset) {
  const p = sessionPlan(preset || {});
  const bandOpts = Object.entries(BANDS).map(([key, b]) =>
    `<option value="${esc(key)}"${key === p.band ? ' selected' : ''}>${esc(b.blurb)}</option>`).join('');
  // The band table is emitted to the client as JSON so the client JS reads the same source of truth.
  // JSON.stringify then esc() → safe inside a <script> block (the < > & " ' are all escaped).
  const bandsJson = esc(JSON.stringify(BANDS));
  const initJson = esc(JSON.stringify({ band: p.band, minutes: p.minutes, fadeSec: p.fadeSec, type: p.type }));

  const body = `<span class=alpha>Alpha</span>
<main>
  <h1>MELEK Sleep &amp; Focus</h1>
  <p class=sub>Generative binaural beats, isochronic tones, and a 40&nbsp;Hz gamma preset — synthesized live in your browser. Use headphones for binaural.</p>
  <div class="orb" id="orb"></div>
  <div class=panel>
    <div class=seg id="typeSeg">
      <button type=button data-type="binaural" class="${p.type === 'binaural' ? 'active' : ''}">Binaural</button>
      <button type=button data-type="isochronic" class="${p.type === 'isochronic' ? 'active' : ''}">Isochronic</button>
      <button type=button data-type="gamma" class="${p.type === 'gamma' ? 'active' : ''}">40&nbsp;Hz Gamma</button>
    </div>
    <div class=row>
      <label><b>Preset band</b>
        <select id="band">${bandOpts}</select>
      </label>
      <label><b>Sleep timer</b>
        <select id="minutes">
          <option value="0">No timer</option>
          <option value="10">10 min</option>
          <option value="20">20 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
          <option value="90">90 min</option>
        </select>
      </label>
    </div>
    <div class=row>
      <label><b>Carrier <span class=val id="carrierV"></span> Hz</b>
        <input type=range id="carrier" min="40" max="500" step="5" value="${esc(p.carrier)}">
      </label>
    </div>
    <div class=row>
      <label><b>Beat <span class=val id="beatV"></span> Hz</b>
        <input type=range id="beat" min="0.5" max="40" step="0.5" value="${esc(p.beat)}">
      </label>
    </div>
    <div class=row>
      <label><b>Volume <span class=val id="volV"></span>%</b>
        <input type=range id="vol" min="0" max="100" step="1" value="30">
      </label>
    </div>
    <button class=play id="play" type=button>▶ Play</button>
    <div class=status id="status">Ready. Put on headphones for the binaural effect.</div>
    <div class=note>
      <b>Hearing safety.</b> Start at a low volume and keep it comfortable — prolonged loud audio, especially through headphones, can damage hearing. Take breaks. If you feel discomfort, stop.
      <br><b>Not medical advice.</b> Brainwave-entrainment audio is offered for relaxation and focus only. It is not a treatment, and the band descriptions are traditional associations, not clinical claims. Do not listen while driving or operating machinery. If you have epilepsy or a seizure disorder, consult a clinician first.
      <br><b>Ours, no licensing.</b> Every tone here is generated in your browser with the Web Audio API — no audio file is streamed or stored. The sound is yours the moment the page loads.
    </div>
  </div>
</main>
<footer>MELEK Sleep &amp; Focus · client-side Web Audio synthesis · <a href="/api/presets">presets JSON</a></footer>
<script id="bands" type="application/json">${bandsJson}</script>
<script id="init" type="application/json">${initJson}</script>
<script>
(function(){
  "use strict";
  var BANDS={}, INIT={};
  try{ BANDS=JSON.parse(document.getElementById('bands').textContent||'{}'); }catch(e){ BANDS={}; }
  try{ INIT=JSON.parse(document.getElementById('init').textContent||'{}'); }catch(e){ INIT={}; }

  var $=function(id){ return document.getElementById(id); };
  var bandEl=$('band'), minEl=$('minutes'), carrierEl=$('carrier'), beatEl=$('beat'), volEl=$('vol');
  var carrierV=$('carrierV'), beatV=$('beatV'), volV=$('volV'), status=$('status'), playBtn=$('play'), orb=$('orb');
  var typeSeg=$('typeSeg');

  var supported = (typeof (window.AudioContext||window.webkitAudioContext) === 'function');
  var ctx=null, nodes=null, playing=false, timerId=null, curType=(INIT.type||'binaural');

  function setLabels(){
    if(carrierV) carrierV.textContent=carrierEl.value;
    if(beatV) beatV.textContent=beatEl.value;
    if(volV) volV.textContent=volEl.value;
  }
  function applyBand(){
    var b=BANDS[bandEl.value];
    if(b){ carrierEl.value=b.carrier; beatEl.value=b.beat; }
    if(curType==='gamma' && BANDS.gamma){ carrierEl.value=BANDS.gamma.carrier; beatEl.value=BANDS.gamma.beat; }
    setLabels();
    if(playing) restart();
  }
  function setType(t){
    curType=t;
    var btns=typeSeg.getElementsByTagName('button');
    for(var i=0;i<btns.length;i++){ btns[i].className = (btns[i].getAttribute('data-type')===t)?'active':''; }
    if(t==='gamma'){ bandEl.value='gamma'; }
    applyBand();
  }

  function stopNodes(){
    if(!nodes) return;
    try{ if(nodes.timerFade) clearInterval(nodes.timerFade); }catch(e){}
    try{ nodes.oscs.forEach(function(o){ try{ o.stop(); }catch(e){} }); }catch(e){}
    try{ nodes.lfo && nodes.lfo.stop(); }catch(e){}
    nodes=null;
  }

  function build(){
    // Fresh graph each start. Two modes:
    //  binaural/gamma: left osc = carrier, right osc = carrier+beat, hard-panned per ear.
    //  isochronic:     one osc at carrier, amplitude gated on/off at the beat rate (an LFO square).
    var carrier=parseFloat(carrierEl.value)||200;
    var beat=parseFloat(beatEl.value)||10;
    var vol=(parseFloat(volEl.value)||0)/100;
    var master=ctx.createGain(); master.gain.value=0; master.connect(ctx.destination);
    var oscs=[], lfo=null;
    if(curType==='isochronic'){
      var osc=ctx.createOscillator(); osc.type='sine'; osc.frequency.value=carrier;
      var gate=ctx.createGain(); gate.gain.value=0.0001;
      lfo=ctx.createOscillator(); lfo.type='square'; lfo.frequency.value=beat;
      var lfoGain=ctx.createGain(); lfoGain.gain.value=0.5;
      lfo.connect(lfoGain); lfoGain.connect(gate.gain); // square -0.5..0.5 → gate ~0..1
      var lift=ctx.createConstantSource(); lift.offset.value=0.5; lift.connect(gate.gain);
      osc.connect(gate); gate.connect(master);
      osc.start(); lfo.start(); lift.start();
      oscs.push(osc); oscs.push(lift);
    } else {
      var beatHz = (curType==='gamma') ? (BANDS.gamma?BANDS.gamma.beat:40) : beat;
      var carHz = (curType==='gamma') ? (BANDS.gamma?BANDS.gamma.carrier:carrier) : carrier;
      var oL=ctx.createOscillator(), oR=ctx.createOscillator();
      oL.type='sine'; oR.type='sine'; oL.frequency.value=carHz; oR.frequency.value=carHz+beatHz;
      var pL=ctx.createStereoPanner?ctx.createStereoPanner():null;
      var pR=ctx.createStereoPanner?ctx.createStereoPanner():null;
      if(pL&&pR){ pL.pan.value=-1; pR.pan.value=1; oL.connect(pL); pL.connect(master); oR.connect(pR); pR.connect(master); }
      else { oL.connect(master); oR.connect(master); }
      oL.start(); oR.start(); oscs.push(oL); oscs.push(oR);
    }
    // fade in
    var now=ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), now+2);
    nodes={oscs:oscs, lfo:lfo, master:master};
  }

  function fadeOutAndStop(sec){
    if(!nodes||!ctx) return stop();
    var now=ctx.currentTime;
    try{
      nodes.master.gain.cancelScheduledValues(now);
      nodes.master.gain.setValueAtTime(Math.max(0.0001,nodes.master.gain.value), now);
      nodes.master.gain.exponentialRampToValueAtTime(0.0001, now+sec);
    }catch(e){}
    setTimeout(stop, sec*1000+120);
  }

  function scheduleTimer(){
    if(timerId){ clearTimeout(timerId); timerId=null; }
    var mins=parseInt(minEl.value,10)||0;
    var fade=INIT.fadeSec||30;
    if(mins>0){
      var ms=Math.max(0, mins*60*1000 - fade*1000);
      timerId=setTimeout(function(){ status.textContent='Fading out — good night.'; fadeOutAndStop(fade); }, ms);
    }
  }

  function start(){
    if(!supported){ status.textContent='Web Audio is not available in this browser.'; return; }
    try{
      var AC=window.AudioContext||window.webkitAudioContext;
      ctx=ctx||new AC();
      if(ctx.state==='suspended' && ctx.resume) ctx.resume();
      build();
      playing=true; playBtn.textContent='■ Stop'; playBtn.className='play playing';
      orb.className='orb on';
      var mins=parseInt(minEl.value,10)||0;
      status.textContent = (curType==='isochronic'?'Isochronic':(curType==='gamma'?'40 Hz gamma':'Binaural'))
        + ' · carrier '+carrierEl.value+' Hz · beat '+beatEl.value+' Hz'
        + (mins>0?(' · timer '+mins+' min'):'');
      scheduleTimer();
    }catch(e){ status.textContent='Could not start audio.'; }
  }
  function stop(){
    stopNodes(); playing=false;
    if(timerId){ clearTimeout(timerId); timerId=null; }
    playBtn.textContent='▶ Play'; playBtn.className='play'; orb.className='orb';
    status.textContent='Stopped.';
  }
  function restart(){ stopNodes(); if(supported&&ctx){ build(); scheduleTimer(); } }

  playBtn.onclick=function(){ if(playing) stop(); else start(); };
  bandEl.onchange=applyBand;
  minEl.onchange=function(){ if(playing) scheduleTimer(); };
  [carrierEl,beatEl].forEach(function(el){ el.oninput=function(){ setLabels(); if(playing) restart(); }; });
  volEl.oninput=function(){ setLabels(); if(playing&&nodes&&ctx){ try{ nodes.master.gain.setTargetAtTime((parseFloat(volEl.value)||0)/100, ctx.currentTime, 0.1); }catch(e){} } };
  var segBtns=typeSeg.getElementsByTagName('button');
  for(var i=0;i<segBtns.length;i++){ segBtns[i].onclick=function(){ setType(this.getAttribute('data-type')); }; }

  // init from server-provided preset
  if(INIT.band){ bandEl.value=INIT.band; }
  if(INIT.minutes){ minEl.value=String(INIT.minutes); }
  setType(curType);
  setLabels();
  if(!supported){ status.textContent='Web Audio is not supported here — the player needs a modern browser.'; playBtn.disabled=true; }
})();
</script>`;

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>MELEK Sleep &amp; Focus — binaural, isochronic &amp; 40 Hz gamma</title>
<meta name=description content="A calm full-screen sleep and focus player: generative binaural beats, isochronic tones, and a 40 Hz gamma preset, synthesized live in your browser with the Web Audio API. No audio files, no licensing. Includes a sleep timer.">
<meta name=robots content="index,follow,max-image-preview:large">${STYLE}</head><body>
${body}
</body></html>`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(JSON.stringify(obj));
}

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (path === '/api/presets') {
      return sendJson(res, { bands: BANDS, default: DEFAULT_BAND, note: 'Tones are synthesized client-side via Web Audio; no audio files.' });
    }

    if (path === '/') {
      const plan = sessionPlan({ band: url.searchParams.get('band'), minutes: url.searchParams.get('min') });
      return sendHtml(res, renderPage(plan));
    }

    // Unknown route → a soft-fail 404 that still points home.
    return sendHtml(res, `<!doctype html><meta charset=utf-8><title>Not found</title>${STYLE}<main style="padding:60px 20px;text-align:center"><h1>Not found</h1><p class=sub>That page isn't part of the Sleep player. <a href="/">Go to the player →</a></p></main>`, 404);
  } catch (e) {
    // last-ditch soft-fail: never leak a stack, never crash the process.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK Sleep & Focus on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
