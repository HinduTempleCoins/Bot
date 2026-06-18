// site/move-miner/server.mjs — MELEK Move: the FIRST PRANA app — a Step Counter + GeoMiner.
//
// Move-to-earn (SweatCoin pattern) + geomining in one installable PWA. The phone counts steps and
// reads location; the server (this) re-validates and signs an EIP-712 voucher via the attester
// (integrations/games/attester.mjs). The voucher is redeemed at the ArcadeFaucet / GeominingSettlement
// contracts on PRANA. THE BROWSER NEVER HOLDS A KEY — it POSTs steps/coords and gets a signed voucher.
//
// Until the faucet contracts are deployed to the live PRANA testnet (set ARCADE_FAUCET_ADDRESS /
// GEOMINING_ADDRESS / ATTESTER_KEY), the app runs in DEMO mode: it counts, derives the cell, and shows
// the reward it WOULD mint — honest, installable on your phone today, and flips to real claims the
// moment the contracts go live (no app change).
//
//   PORT=8142 node site/move-miner/server.mjs
//   import { handler } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { attestSteps, attestGeomine, faucetAddress, geominingAddress } from '../../integrations/games/attester.mjs';

const PORT = +(process.env.PORT || 8142);
const HOST = process.env.HOST || '127.0.0.1';

const liveMode = () => !!(process.env.ATTESTER_KEY && (faucetAddress() || geominingAddress()));

const MANIFEST = JSON.stringify({
  name: 'MELEK Move — Step & Geo Miner', short_name: 'MELEK Move', start_url: '/', display: 'standalone',
  background_color: '#0b0d12', theme_color: '#d9a441',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  description: 'Earn by moving — count your steps and mine the place you stand, on PRANA.',
});

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0d12"/><circle cx="32" cy="32" r="18" fill="none" stroke="#d9a441" stroke-width="4"/><circle cx="32" cy="32" r="4" fill="#36c08a"/></svg>`;

const SW = `self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>self.clients.claim());
self.addEventListener('fetch',e=>{});`;

const PAGE = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MELEK Move — Step & Geo Miner</title>
<meta name=description content="Earn by moving — count your steps and mine the place you stand, on PRANA.">
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
  .out{margin-top:10px;font-size:13px;color:var(--mut);white-space:pre-wrap;word-break:break-word}
  .reward{color:var(--green);font-weight:700} .err{color:#e08b8b}
  .cell{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--blue)}
  footer{color:var(--mut);font-size:12px;text-align:center;margin-top:20px}
  a{color:var(--gold)}
</style></head><body><div class=wrap>
<header>
  <span class=logo>${ICON}</span>
  <h1>MELEK Move <small>Step counter · Geo miner · on PRANA</small></h1>
  <span class="mode" id=mode>…</span>
</header>

<div class=card>
  <label for=wallet>Your wallet (where rewards go)</label>
  <input id=wallet placeholder="0x… your PRANA address" autocomplete=off spellcheck=false>
</div>

<div class=card>
  <h2>👟 Step boost</h2>
  <div class=big id=steps>0</div>
  <div class=sub id=stepsub>your steps charge the mining boost — <span id=boost>×1.0</span></div>
  <div class=row>
    <button id=startSteps class=primary>Start counting</button>
    <button id=plus50>+1000 (test)</button>
  </div>
</div>

<div class=card>
  <h2>📍 Geo-mine <span style="font-weight:400;color:var(--mut);font-size:12px">(boosted by your steps)</span></h2>
  <div class=sub id=geosub>mine the cell you're standing in — the more you walked, the bigger the reward</div>
  <div class=cell id=cell>location not read yet</div>
  <div class=row style="margin-top:10px">
    <button id=locate class=primary>Read my location</button>
    <button id=mine class=green disabled>Mine this cell</button>
  </div>
  <div class=out id=geoOut></div>
</div>

<footer>You earn by moving. Your phone counts; the MELEK attester signs a reward voucher you redeem on PRANA.
  No keys ever leave your phone — we only see your steps and the cell you mine.</footer>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const W=$('wallet'); W.value=localStorage.getItem('melekmove_wallet')||''; W.addEventListener('input',()=>localStorage.setItem('melekmove_wallet',W.value.trim()));
fetch('/health').then(r=>r.json()).then(j=>{const m=$('mode');m.textContent=j.live?'LIVE':'DEMO';m.className='mode '+(j.live?'live':'demo');}).catch(()=>{});
function badWallet(){const v=(W.value||'').trim();if(!/^0x[0-9a-fA-F]{40}$/.test(v)){return true;}return false;}

// ---- steps: accelerometer peak-count + manual ----
let steps=0, listening=false, lastPeak=0, lastMag=0, rising=false;
const TIERS=[[1000,1.2],[2000,1.5],[5000,2],[10000,3],[15000,4],[20000,5],[25000,6.5],[30000,8],[40000,11],[50000,15]];
function stepBoost(n){let m=1;for(const [t,x] of TIERS){if(n>=t)m=x;else break;}return m;}
function setSteps(n){steps=n;$('steps').textContent=String(n);$('boost').textContent='×'+stepBoost(n).toFixed(1);}
function onMotion(ev){
  const a=ev.accelerationIncludingGravity||ev.acceleration;if(!a)return;
  const mag=Math.sqrt((a.x||0)**2+(a.y||0)**2+(a.z||0)**2);
  const now=Date.now();
  if(mag>12 && !rising && mag>lastMag){rising=true;}
  if(rising && mag<lastMag && (now-lastPeak)>280){ setSteps(steps+1); lastPeak=now; rising=false; }
  lastMag=mag;
}
$('startSteps').onclick=async()=>{
  if(listening){window.removeEventListener('devicemotion',onMotion);listening=false;$('startSteps').textContent='Start counting';$('stepsub').textContent='paused';return;}
  try{ if(typeof DeviceMotionEvent!=='undefined' && DeviceMotionEvent.requestPermission){const p=await DeviceMotionEvent.requestPermission();if(p!=='granted'){$('stepsub').textContent='motion permission denied — use +50 to test';return;}} }catch(e){}
  window.addEventListener('devicemotion',onMotion);listening=true;$('startSteps').textContent='Pause';$('stepsub').textContent='counting… move your phone';
};
$('plus50').onclick=()=>setSteps(steps+1000);

// ---- geo (the earn action — boosted by steps, diminishing each hour) ----
let coords=null;
$('locate').onclick=()=>{
  if(!navigator.geolocation){$('cell').textContent='geolocation unavailable on this device';return;}
  $('cell').textContent='reading…';
  navigator.geolocation.getCurrentPosition(p=>{
    coords={lat:p.coords.latitude,lng:p.coords.longitude};
    $('cell').textContent='you are at '+coords.lat.toFixed(5)+', '+coords.lng.toFixed(5);
    $('mine').disabled=false;
  },err=>{$('cell').textContent='location denied: '+E(err.message);},{enableHighAccuracy:true,timeout:10000});
};
$('mine').onclick=async()=>{
  if(badWallet()){$('geoOut').innerHTML='<span class=err>Enter your 0x wallet first.</span>';return;}
  if(!coords){$('geoOut').innerHTML='<span class=err>Read your location first.</span>';return;}
  $('mine').disabled=true;$('geoOut').textContent='signing…';
  try{const r=await fetch('/api/geomine',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({player:W.value.trim(),lat:coords.lat,lng:coords.lng,steps})});
    const j=await r.json(); renderOut('geoOut',j); }
  catch(e){$('geoOut').innerHTML='<span class=err>Network error — try again.</span>';}
  $('mine').disabled=false;
};

function renderOut(elId,j){
  const el=$(elId);
  if(!j||!j.ok){el.innerHTML='<span class=err>'+E((j&&j.reason)||'no reward')+'</span>';return;}
  let html='<span class=reward>+ '+E(j.payout)+' MELEK</span>';
  // base × step-boost × hourly-diminish
  if(j.boost!=null){ html+=' = '+E(j.baseReward)+' × '+E(j.boost)+' boost'+(j.diminish!=null&&j.diminish<1?(' × '+E(j.diminish)+' (mine #'+(Number(j.mineIndex)+1)+' this hour)'):''); }
  if(j.cellId){ html+='\\ncell '+E(j.cellId); }
  if(j.signed){ html+='\\n✓ voucher signed — ready to claim on PRANA (nonce '+E(j.voucher.nonce)+')'; }
  else { html+='\\n'+E(j.reason||'demo')+'\\n(reward counted; on-chain claim opens when the faucet goes live)'; }
  el.innerHTML=html;
}
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
</script></body></html>`;

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

    if (path === '/health') return json(res, 200, { ok: true, live: liveMode() });
    if (path === '/manifest.webmanifest') { res.writeHead(200, { 'content-type': 'application/manifest+json' }); return res.end(MANIFEST); }
    if (path === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(SW); }
    if (path === '/icon.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=86400' }); return res.end(ICON); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nDisallow: /api/\n'); }

    if (path === '/api/steps' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad json' }); }
      const out = attestSteps({ player: b.player, steps: b.steps });
      return json(res, out.ok ? 200 : 422, out);
    }
    if (path === '/api/geomine' && method === 'POST') {
      let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad json' }); }
      const out = attestGeomine({ player: b.player, lat: b.lat, lng: b.lng, steps: b.steps });
      return json(res, out.ok ? 200 : 422, out);
    }

    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Move (step+geo miner) on http://${HOST}:${PORT} — ${liveMode() ? 'LIVE' : 'DEMO'} mode`));
}
