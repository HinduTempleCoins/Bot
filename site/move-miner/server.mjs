// site/move-miner/server.mjs — MELEK Move: the FIRST consumer app — a Step Counter + GeoMiner PWA.
//
// MOVE-TO-EARN on the MELEK chain. The phone counts steps (the BOOST) and reads location (the EARN:
// geo-mining). Each mine records the walker's stake-weighted MOVE-WEIGHT into the hourly ledger
// (move-ledger.mjs). At hour close a settlement splits the Move budget — 15% OF THE BLOG POOL, the same
// MELEK that pays bloggers (move-economy.mjs) — across that hour's walkers by weight, exactly how the
// content pool splits by rshares, and pays each walker in MELEK on-chain.
//
// REWARD MODEL (operator, locked):
//   • currency = MELEK (testnet TESTS) — the chain coin, NOT a token/PoL/EVM claim.
//   • budget   = 15% of the blog pool (blog = 65% of emission). ~87.75 MELEK/hour at defaults.
//   • split    = stake-weighted, like vote weight: weight = (stake+floor) × geoBase × stepBoost × diminish.
//   • recipient= a MELEK Graphene ACCOUNT NAME from signup (NOT a 0x address).
//   • payout   = an on-chain MELEK transfer at hour close (the box settle timer; zero WIF here).
//
// THE BROWSER NEVER HOLDS A KEY. It POSTs {account, steps, lat, lng} and gets back its live standing
// (weight + projected MELEK this hour). The on-chain payout is the settlement's job, not the browser's.
//
//   PORT=8142 node site/move-miner/server.mjs
//   import { handler } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { moveWeight, moveBudgetForEpoch, economySummary } from '../../integrations/games/move-economy.mjs';
import { recordMine, standingFor, epochNow } from '../../integrations/games/move-ledger.mjs';
import { validAccountName } from '../../signup/welcome-grant.mjs';

const PORT = +(process.env.PORT || 8142);
const HOST = process.env.HOST || '127.0.0.1';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';
// "live" = settlement is wired on the host (payouts go out). Demo = standings show, payout pending.
const liveMode = () => process.env.MOVE_LIVE === '1';

// ── pure geo math (no keys, no EVM — moved off the attester/PoL path) ───────────────────────────────
const GEO_REWARD = () => Math.max(0, Math.floor(Number(process.env.GEO_REWARD || 10)));
const GEO_PRECISION = () => Number(process.env.GEO_PRECISION || 1000);
const GEO_DIMINISH_K = () => Number(process.env.GEO_DIMINISH_K || 1);
const STEP_BOOST_TIERS = [[1000, 1.2], [2000, 1.5], [5000, 2], [10000, 3], [15000, 4], [20000, 5], [25000, 6.5], [30000, 8], [40000, 11], [50000, 15]];
function stepBoost(steps) { const s = Number(steps) || 0; let m = 1; for (const [t, x] of STEP_BOOST_TIERS) { if (s >= t) m = x; else break; } return m; }
function diminishFor(mineIndex) { return 1 / (1 + GEO_DIMINISH_K() * Math.max(0, Number(mineIndex) || 0)); }
function cellIdFor(lat, lng, p = GEO_PRECISION()) {
  const la = Math.floor((Number(lat) + 90) * p); const lo = Math.floor((Number(lng) + 180) * p);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return BigInt(la) * BigInt(360 * p + 1) + BigInt(lo);
}
// per-(account,epoch) mine counter for diminishing returns within the hour (process-local; resets fine).
const _mineCount = new Map();
function nextMineIndex(account, epoch) { const k = `${account}:${epoch}`; const i = _mineCount.get(k) || 0; _mineCount.set(k, i + 1); return i; }

// store-grade manifest: PNG 192/512 + maskable, categories, orientation — passes Lighthouse PWA / TWA.
export const MANIFEST = JSON.stringify({
  name: 'MELEK Move — Step & Geo Miner', short_name: 'MELEK Move', start_url: '/', scope: '/',
  display: 'standalone', orientation: 'portrait', background_color: '#0b0d12', theme_color: '#d9a441',
  categories: ['health', 'fitness', 'lifestyle'], lang: 'en',
  description: 'Track your steps and explore — a fitness step-tracker + geo game that rewards movement in MELEK.',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

const ICON_DIR = join(dirname(fileURLToPath(import.meta.url)), 'icons');
const _png = {};
function iconPng(name) { if (name in _png) return _png[name]; try { _png[name] = readFileSync(join(ICON_DIR, name)); } catch { _png[name] = null; } return _png[name]; }

export const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0d12"/><circle cx="32" cy="32" r="18" fill="none" stroke="#d9a441" stroke-width="4"/><circle cx="32" cy="32" r="4" fill="#36c08a"/></svg>`;

export const SW = `self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>self.clients.claim());
self.addEventListener('fetch',e=>{});`;

export const PAGE = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MELEK Move — Step & Geo Miner</title>
<meta name=description content="A fitness step-tracker + geo-explore game with in-app MELEK rewards (testnet — no monetary value).">
<link rel=manifest href="/manifest.webmanifest">
<meta name=theme-color content="#d9a441">
<link rel="apple-touch-icon" href="/icon.svg">
<style>
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;
    padding:max(12px,env(safe-area-inset-top)) 14px 40px}
  .wrap{max-width:540px;margin:0 auto}
  header{display:flex;align-items:center;gap:10px;margin:6px 0 14px}
  .logo{width:38px;height:38px} h1{font-size:20px;margin:0} h1 small{display:block;color:var(--mut);font-size:12px;font-weight:400}
  .mode{margin-left:auto;font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--bd);color:var(--mut)}
  .mode.live{color:var(--green);border-color:var(--green)} .mode.demo{color:var(--gold);border-color:var(--gold)}
  .card{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:16px;margin:12px 0}
  .card h2{font-size:15px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
  .big{font-size:44px;font-weight:800;letter-spacing:-1px;text-align:center;margin:4px 0}
  .sub{text-align:center;color:var(--mut);font-size:13px;margin-bottom:10px}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  button{flex:1;min-width:120px;padding:12px;border-radius:12px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);font:inherit;font-weight:700;cursor:pointer}
  button.primary{background:var(--gold);color:#1a1306;border-color:var(--gold)}
  button.green{background:var(--green);color:#062018;border-color:var(--green)}
  button:disabled{opacity:.5}
  input{width:100%;padding:11px 12px;border:1px solid var(--bd);border-radius:10px;background:#0e131b;color:var(--fg);font:inherit}
  label{font-size:12px;color:var(--mut);display:block;margin:0 0 5px}
  .hint{font-size:12px;color:var(--mut);margin-top:6px} .hint a{color:var(--gold)}
  .out{margin-top:10px;font-size:13px;color:var(--mut);white-space:pre-wrap;word-break:break-word}
  .reward{color:var(--green);font-weight:700} .err{color:#e08b8b}
  .cell{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--blue)}
  .blockmap{width:100%;max-width:360px;aspect-ratio:1/1;display:block;margin:4px auto 6px;border:1px solid var(--bd);border-radius:14px;background:#0e131b;touch-action:none}
  .legend{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:11px;color:var(--mut);margin:0 0 6px}
  .legend i{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:-1px;margin-right:5px;border:1px solid var(--bd)}
  .legend i.here{background:rgba(217,164,65,.28);border-color:var(--gold)} .legend i.mined{background:rgba(54,192,138,.22);border-color:var(--green)}
  .legend i.you{border-radius:50%;background:var(--green);border-color:#0b0d12}
  footer{color:var(--mut);font-size:12px;text-align:center;margin-top:20px}
  a{color:var(--gold)}
</style></head><body><div class=wrap>
<header>
  <span class=logo>${ICON}</span>
  <h1>MELEK Move <small>Step counter · explore · MELEK rewards (testnet)</small></h1>
  <span class="mode" id=mode>…</span>
</header>

<div class=card>
  <label for=account>Your MELEK username (where rewards go)</label>
  <input id=account placeholder="your-melek-name" autocomplete=off autocapitalize=off spellcheck=false>
  <div class=hint>No account yet? <a href="${SIGNUP_URL}" target="_blank" rel=noopener>Create your MELEK account →</a></div>
  <label for=stake style="margin-top:10px">MELEK you hold (your stake — boosts your share, like vote weight)</label>
  <input id=stake type=number inputmode=numeric placeholder="0" autocomplete=off>
</div>

<div class=card>
  <h2>👟 Step boost</h2>
  <div class=big id=steps>0</div>
  <div class=sub id=stepsub>your steps charge the reward boost — <span id=boost>×1.0</span></div>
  <div class=row>
    <button id=startSteps class=primary>Start counting</button>
    <button id=plus50>+1000 (test)</button>
  </div>
  <div class=hint>We read your phone's motion/step sensor <b>only</b> to calculate your fitness rewards — your activity data is never sold or shared. <a href="/privacy">Privacy</a></div>
</div>

<div class=card>
  <h2>📍 Reward zone <span style="font-weight:400;color:var(--mut);font-size:12px">(boosted by your steps)</span></h2>
  <div class=sub id=geosub>claim the zone you're standing in — the more you walked, the bigger your share of this hour's MELEK reward pool</div>
  <canvas id=map class=blockmap width=320 height=320 role=img aria-label="Block map: the grid of reward blocks around you, your position, and the block you can claim"></canvas>
  <div class=legend><span><i class=you></i>you</span><span><i class=here></i>block you can claim</span><span><i class=mined></i>claimed this hour</span></div>
  <div class=cell id=cell>location not read yet</div>
  <div class=row style="margin-top:10px">
    <button id=locate class=primary>Read my location</button>
    <button id=mine class=green disabled>Claim this zone</button>
  </div>
  <div class=out id=geoOut></div>
</div>

<footer>Move, explore, and collect <b>MELEK</b> fitness rewards. Your phone counts steps and reads where
  you stand; we record your stake-weighted share of this hour's reward pool — <b>15% of the blog pool</b>,
  the same MELEK that rewards writers — and send it to your account when the hour closes. MELEK is a
  <b>testnet</b> coin with no monetary value. No keys ever leave your phone. <a href="/privacy">Privacy policy</a></footer>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const W=$('account'); W.value=localStorage.getItem('melekmove_account')||''; W.addEventListener('input',()=>localStorage.setItem('melekmove_account',W.value.trim().toLowerCase()));
fetch('/health').then(r=>r.json()).then(j=>{const m=$('mode');m.textContent=j.live?'LIVE':'DEMO';m.className='mode '+(j.live?'live':'demo');
  if(j.geoPrecision>0){GEOP=j.geoPrecision;} drawMap();}).catch(()=>{});
// MELEK Graphene account name: lowercase, dot segments, 3-16 each, no leading/trailing/double hyphen.
function badName(){const v=(W.value||'').trim().toLowerCase();if(v.length<3||v.length>16)return true;
  for(const seg of v.split('.')){if(!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(seg)||seg.length<3||seg.length>16||seg.includes('--'))return true;}return false;}

// ---- steps: a REAL accelerometer step detector (high-pass + threshold), not a stopwatch ----
// Bug fixed 2026-06-22: the old version peak-counted RAW magnitude with a fixed mag>12 gate sitting just
// above gravity (~9.8), so idle sensor noise kept tripping it and it free-ran like a stopwatch. Now we track
// a slow gravity baseline, look at the DEVIATION (gravity removed → ~0 at rest), and only count a footfall
// when the deviation rises past a real threshold and falls back (hysteresis), with a walking-cadence
// refractory. At rest the deviation stays sub-threshold, so nothing counts.
let steps=0, listening=false;
let grav=9.81, sArmed=false, sLastAt=0, sWarm=0;
const STEP_THRESH=1.6;   // m/s² a footfall clears above gravity (lowered 1/3 from 2.4 — generous, so every real step counts; still well above idle noise ~0)
const STEP_RESET=1.0;    // must fall back below this to complete a step (hysteresis, no double-count)
const STEP_MIN_MS=300;   // refractory → ≤ ~3.3 steps/s (a brisk walk/jog); kills the noise "stopwatch"
const TIERS=[[1000,1.2],[2000,1.5],[5000,2],[10000,3],[15000,4],[20000,5],[25000,6.5],[30000,8],[40000,11],[50000,15]];
function sboost(n){let m=1;for(const [t,x] of TIERS){if(n>=t)m=x;else break;}return m;}
function setSteps(n){steps=n;$('steps').textContent=String(n);$('boost').textContent='×'+sboost(n).toFixed(1);}
function resetStepDetector(){grav=9.81;sArmed=false;sLastAt=0;sWarm=0;}
function onMotion(ev){
  const a=ev.accelerationIncludingGravity||ev.acceleration;if(!a)return;
  const mag=Math.sqrt((a.x||0)**2+(a.y||0)**2+(a.z||0)**2);
  if(!isFinite(mag))return;
  grav=grav*0.9+mag*0.1;                 // slow baseline ≈ gravity (or ~0 when gravity is already removed)
  const dev=mag-grav;                    // high-passed: ~0 at rest, spikes on a footfall
  if(sWarm<10){sWarm++;return;}          // let the baseline settle first — no start-up transient step
  const now=Date.now();
  if(!sArmed){ if(dev>STEP_THRESH) sArmed=true; }                 // rose past a real footfall peak
  else if(dev<STEP_RESET){                                        // …then fell back → one step
    if(now-sLastAt>STEP_MIN_MS){ setSteps(steps+1); sLastAt=now; }
    sArmed=false;
  }
}
$('startSteps').onclick=async()=>{
  if(listening){window.removeEventListener('devicemotion',onMotion);listening=false;$('startSteps').textContent='Start counting';$('stepsub').textContent='paused';return;}
  try{ if(typeof DeviceMotionEvent!=='undefined' && DeviceMotionEvent.requestPermission){const p=await DeviceMotionEvent.requestPermission();if(p!=='granted'){$('stepsub').textContent='motion permission denied — use “+1000 steps” to test';return;}} }catch(e){}
  // Most desktop browsers have no motion sensor → devicemotion never fires. Probe so we tell the user the
  // truth instead of silently doing nothing (or, before this fix, pretending to count).
  let gotMotion=false; const probe=()=>{gotMotion=true;window.removeEventListener('devicemotion',probe);};
  window.addEventListener('devicemotion',probe);
  resetStepDetector();
  window.addEventListener('devicemotion',onMotion);listening=true;$('startSteps').textContent='Pause';$('stepsub').textContent='counting… walk with your phone';
  setTimeout(()=>{ if(!gotMotion && listening){ $('stepsub').textContent='no motion sensor here — open on your phone, or use “+1000 steps” to test'; } },1200);
};
$('plus50').onclick=()=>setSteps(steps+1000);

// ---- geo (the earn action — boosted by steps, diminishing each hour, paid in MELEK) ----
// Block map: the geo-mining grid drawn AROUND you. Self-contained canvas — no map tiles, no API key,
// no network, works offline + in the store PWA. The "blocks" ARE the reward cells the chain pays on:
// each block = one grid cell (1/GEOP degrees ≈ 100m at GEOP=1000), exactly matching cellIdFor() server-side.
let coords=null, watchId=null, GEOP=1000;
const minedCells=new Set();           // cellIds you've claimed this hour → drawn green
const GRID_N=7;                       // blocks across the map (odd → you sit in the centre block)
function cellIdx(lat,lng){return {la:Math.floor((lat+90)*GEOP),lo:Math.floor((lng+180)*GEOP)};}
function cellId(la,lo){return (BigInt(la)*BigInt(360*GEOP+1)+BigInt(lo)).toString();}
function drawMap(){
  const cv=$('map'); if(!cv||!cv.getContext)return;
  const ctx=cv.getContext('2d'),W=cv.width,H=cv.height,N=GRID_N,mid=(N-1)/2,cs=W/N;
  ctx.clearRect(0,0,W,H); ctx.fillStyle='#0e131b'; ctx.fillRect(0,0,W,H);
  if(!coords){ctx.fillStyle='#93a1b3';ctx.font='13px -apple-system,Segoe UI,Roboto,Arial';ctx.textAlign='center';
    ctx.fillText('tap “Read my location” to map your blocks',W/2,H/2);return;}
  const {la,lo}=cellIdx(coords.lat,coords.lng);
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    const laI=la+(mid-r),loI=lo+(c-mid),x=c*cs,y=r*cs,here=(r===mid&&c===mid);
    if(here){ctx.fillStyle='rgba(217,164,65,.28)';ctx.fillRect(x,y,cs,cs);}
    else if(minedCells.has(cellId(laI,loI))){ctx.fillStyle='rgba(54,192,138,.22)';ctx.fillRect(x,y,cs,cs);}
    ctx.strokeStyle=here?'#d9a441':'#222b38';ctx.lineWidth=here?2:1;ctx.strokeRect(x+0.5,y+0.5,cs-1,cs-1);
  }
  // your dot — fractional position inside the centre block (north is up, east is right)
  const fE=((coords.lng+180)*GEOP)-lo,fN=((coords.lat+90)*GEOP)-la;
  const dx=mid*cs+fE*cs,dy=mid*cs+(1-fN)*cs;
  ctx.beginPath();ctx.arc(dx,dy,6,0,Math.PI*2);ctx.fillStyle='#36c08a';ctx.fill();
  ctx.lineWidth=2;ctx.strokeStyle='#0b0d12';ctx.stroke();
  ctx.fillStyle='#93a1b3';ctx.font='bold 11px -apple-system,Segoe UI,Roboto,Arial';ctx.textAlign='center';ctx.fillText('N',W/2,13);
}
$('locate').onclick=()=>{
  if(!navigator.geolocation){$('cell').textContent='geolocation unavailable on this device';return;}
  if(watchId!=null){navigator.geolocation.clearWatch(watchId);watchId=null;$('locate').textContent='Read my location';return;}
  $('cell').textContent='reading…';$('locate').textContent='Tracking… (tap to stop)';
  watchId=navigator.geolocation.watchPosition(p=>{
    coords={lat:p.coords.latitude,lng:p.coords.longitude};
    $('cell').textContent='you are at '+coords.lat.toFixed(5)+', '+coords.lng.toFixed(5);
    $('mine').disabled=false; drawMap();
  },err=>{$('cell').textContent='location denied: '+E(err.message);$('locate').textContent='Read my location';},{enableHighAccuracy:true,timeout:10000,maximumAge:2000});
};
$('mine').onclick=async()=>{
  if(badName()){$('geoOut').innerHTML='<span class=err>Enter your MELEK username first (or create one).</span>';return;}
  if(!coords){$('geoOut').innerHTML='<span class=err>Read your location first.</span>';return;}
  $('mine').disabled=true;$('geoOut').textContent='claiming…';
  try{const r=await fetch('/api/geomine',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:W.value.trim().toLowerCase(),lat:coords.lat,lng:coords.lng,steps,stake:Number(($('stake')||{}).value)||0})});
    const j=await r.json(); renderOut('geoOut',j); if(j&&j.ok&&j.cellId){minedCells.add(String(j.cellId));drawMap();} }
  catch(e){$('geoOut').innerHTML='<span class=err>Network error — try again.</span>';}
  $('mine').disabled=false;
};

function renderOut(elId,j){
  const el=$(elId);
  if(!j||!j.ok){el.innerHTML='<span class=err>'+E((j&&j.reason)||'no reward')+'</span>';return;}
  const s=j.standing||{};
  let html='<span class=reward>+'+E(j.weight)+' move-weight</span>';
  if(j.boost!=null){ html+=' = stake×'+E(j.boost)+' boost'+(j.diminish!=null&&j.diminish<1?(' ×'+E(j.diminish)+' (mine #'+(Number(j.mineIndex)+1)+' this hour)'):''); }
  html+='\\nthis hour: you hold '+E(s.accountWeight)+' of '+E(s.totalWeight)+' weight across '+E(s.miners)+' walker(s)';
  html+='\\n→ projected payout: <span class=reward>'+E(s.projectedMelek)+' MELEK</span> (your slice of the '+E(s.hourlyPool)+' MELEK Move pool this hour)';
  html+='\\nsent to your account @'+E(j.account)+' when the hour closes.';
  if(j.cellId){ html+='\\nzone '+E(j.cellId); }
  el.innerHTML=html;
}
// Native step bridge: when wrapped by the Capacitor Android/iOS shell, the native step-counter plugin
// exposes window.MelekSteps.start(cb) (reads the OS pedometer in a health foreground service — counts
// with the screen off, which a browser can't). Feature-detected: a plain browser ignores this and uses
// the in-page accelerometer counter above. The native side requests ACTIVITY_RECOGNITION after the
// prominent-disclosure prompt shown in the step card.
if(window.MelekSteps&&typeof window.MelekSteps.start==='function'){
  try{ $('startSteps').textContent='Counting (device)'; $('stepsub').textContent='counting your steps from the device sensor…';
    window.MelekSteps.start(function(n){ if(typeof n==='number'&&n>=0) setSteps(n); }); }catch(e){}
}
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
</script></body></html>`;

// Privacy policy — REQUIRED by Google Play (we read motion/step + coarse location sensors).
// States what we collect, why, that we never sell/share activity data, and the testnet-no-value fact.
export const PRIVACY = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>MELEK Move — Privacy Policy</title>
<style>body{margin:0;background:#0b0d12;color:#e9eef5;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px}
.w{max-width:640px;margin:0 auto}h1{font-size:22px}h2{font-size:16px;margin-top:22px}a{color:#d9a441}.mut{color:#93a1b3}</style></head>
<body><div class=w>
<h1>MELEK Move — Privacy Policy</h1>
<p class=mut>Last updated 2026-06-19. MELEK Move is a fitness step-tracker and geo-explore game with in-app MELEK rewards (a testnet coin with no monetary value).</p>
<h2>What we collect</h2>
<ul>
<li><b>Step / motion data</b> — read from your device's step-counter / motion sensor, used <b>only</b> to calculate your in-app fitness reward boost. Step counts are processed on your device and sent to our server only as a number to compute rewards.</li>
<li><b>Approximate location</b> — when you tap "Read my location", used <b>only</b> to derive the reward zone you are claiming. We store a coarse numeric zone id, not a precise track of your movements.</li>
<li><b>Your MELEK account name</b> — the public account you choose, so rewards can be sent to it on the MELEK chain.</li>
</ul>
<h2>What we never do</h2>
<ul>
<li>We never sell, rent, or share your activity, motion, or location data with third parties.</li>
<li>We never use health or fitness data for advertising.</li>
<li>We never ask for, receive, or store your private keys — they stay on your device.</li>
</ul>
<h2>Permissions</h2>
<p>Physical-activity / motion sensor access is requested before counting steps, and location is requested only when you claim a zone. You can decline either; the app still runs with reduced features.</p>
<h2>Rewards</h2>
<p>MELEK is currently a <b>testnet</b> token with <b>no monetary value</b>. Rewards are in-app and not an investment, security, or guarantee of any future value.</p>
<h2>Data retention & contact</h2>
<p>Reward standings are kept only as long as needed to settle each hourly pool. Questions: <a href="https://wallet.melek.salon">wallet.melek.salon</a>.</p>
<p><a href="/">← Back to MELEK Move</a></p>
</div></body></html>`;

// ── request handler ───────────────────────────────────────────────────────────────────────────────
function readBody(req, max = 20_000) {
  return new Promise((resolve) => {
    let d = ''; let over = false;
    req.on('data', (c) => { d += c; if (d.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : d));
    req.on('error', () => resolve(null));
  });
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://move.local');
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/health') return json(res, 200, { ok: true, live: liveMode(), epoch: epochNow(), geoPrecision: GEO_PRECISION() });
    if (path === '/economy') return json(res, 200, { ok: true, ...economySummary() });
    if (path === '/manifest.webmanifest') { res.writeHead(200, { 'content-type': 'application/manifest+json' }); return res.end(MANIFEST); }
    if (path === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(SW); }
    if (path === '/icon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=86400' }); return res.end(ICON); }
    if (path.startsWith('/icons/') && path.endsWith('.png')) {
      const b = iconPng(path.slice('/icons/'.length).replace(/[^a-z0-9.\-]/gi, ''));
      if (!b) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public,max-age=86400' }); return res.end(b);
    }
    if (path === '/.well-known/assetlinks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'community.soapbox.move', sha256_cert_fingerprints: ['REPLACE_AFTER_PLAY_BUILD'] } }]));
    }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nDisallow: /api/\n'); }
    if (path === '/privacy' || path === '/privacy.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PRIVACY); }

    // a walker's current standing this hour (read-only)
    if (path === '/api/standing') {
      const account = (url.searchParams.get('account') || '').trim().toLowerCase();
      if (!validAccountName(account)) return json(res, 422, { ok: false, reason: 'account must be a valid MELEK account name' });
      return json(res, 200, { ok: true, account, ...standingFor(account) });
    }

    // steps preview — steps are the BOOST (no separate payout); informational only.
    if (path === '/api/steps' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad json' }); }
      const n = Number(b.steps);
      if (!Number.isFinite(n) || n <= 0) return json(res, 422, { ok: false, reason: 'steps must be a positive number' });
      return json(res, 200, { ok: true, steps: n, boost: stepBoost(n), note: 'steps are the boost — mine a cell to earn your MELEK slice' });
    }

    // THE EARN: geo-mine → stake-weighted move-weight → recorded into this hour's MELEK pool ledger.
    if (path === '/api/geomine' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad json' }); }
      const account = String(b.account || b.player || '').trim().toLowerCase();
      if (!validAccountName(account)) return json(res, 422, { ok: false, reason: 'account must be a valid MELEK account name (create one at signup)' });
      let cell;
      if (b.cellId != null) { try { cell = BigInt(b.cellId); } catch { cell = null; } }
      else if (b.lat != null && b.lng != null) cell = cellIdFor(b.lat, b.lng);
      else return json(res, 422, { ok: false, reason: 'cellId or lat/lng required' });
      if (cell == null) return json(res, 422, { ok: false, reason: 'could not derive cell from coordinates' });

      const ep = epochNow();
      const idx = nextMineIndex(account, ep);
      const boost = stepBoost(b.steps);
      const diminish = diminishFor(idx);
      const stake = Math.max(0, Number(b.stake) || 0);
      const weight = moveWeight({ stake, geoBase: GEO_REWARD(), stepBoost: boost, diminish });
      if (!(weight > 0)) return json(res, 422, { ok: false, reason: 'no weight earned (diminished out this hour)' });

      const rec = recordMine({ account, weight }, { epoch: ep });
      if (!rec.ok) return json(res, 422, rec);
      return json(res, 200, {
        ok: true, account, cellId: cell.toString(), epoch: ep,
        steps: Number(b.steps) || 0, boost: Math.round(boost * 100) / 100,
        diminish: Math.round(diminish * 100) / 100, mineIndex: idx,
        weight: Math.round(weight),
        standing: { accountWeight: rec.accountWeight, totalWeight: rec.totalWeight, hourlyPool: rec.hourlyPool, projectedMelek: rec.projectedMelek, miners: rec.miners },
        model: 'stake-weighted share of the hourly Move pool (15% of the blog pool, in MELEK); finalizes + pays on-chain hourly',
      });
    }

    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Move (step+geo miner) on http://${HOST}:${PORT} — ${liveMode() ? 'LIVE' : 'DEMO'} mode · epoch ${epochNow()}`));
}
