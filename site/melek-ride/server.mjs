// site/melek-ride/server.mjs — MELEK Ride: the rideshare app, served inside MELEK Move at /ride.
//
// MELEK Drive pays a driver for miles. MELEK Ride gives them someone to drive: riders request, the
// nearest online driver accepts, the trip runs, and at the end the rider signs ONE transaction with two
// transfers — the driver's share and the platform fee. That fee is the app's revenue line; the drive
// lane pays the driver on top of the fare, which is the gas-money half.
//
// NO KEYS HERE AND NO ESCROW. MELEK Ride cannot move a rider's MELEK: it shows the rider exactly what to
// send (and a hot-sign link when the signer exposes one), and the trip closes only when the signed
// transaction is verified on-chain by the injected verifier. A trip nobody paid for stays
// awaiting_payment forever rather than being marked paid on a client's word.
//
// Mounted by the Move server (move.melek.salon/ride) — the handler accepts both the bare paths and the
// /ride-prefixed ones, so it also runs standalone:
//
//   PORT=8143 node site/melek-ride/server.mjs
//   import { handler } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  rideSummary, quoteFare, driverOnline, driverOffline, driversNearSummary, requestTrip, acceptTrip,
  advanceTrip, completeTrip, confirmPayment, cancelTrip, tripById, openRequests, driverDashboard,
  applyDriver, driverApplication, reviewDriver, pendingApplications, riderPing, marketStatus, coverage,
  RIDE_FEE_ACCOUNT, RIDE_FEE_PCT,
} from './ride-core.mjs';
import { recordDrive } from '../../integrations/games/drive-ledger.mjs';
import { currentAccount, signerSignupUrl, publicSignerUrl } from '../../integrations/melek-signer-session.mjs';

const PORT = +(process.env.PORT || 8143);
const HOST = process.env.HOST || '127.0.0.1';
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The signed-in MELEK account (MELEK-Signer session cookie), or null. */
export function rideUser(req) { return currentAccount(req && req.headers && req.headers.cookie); }

/** Accounts allowed to read the application queue and approve drivers. */
export const reviewers = () => String(process.env.RIDE_REVIEWERS || 'hathor').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isReviewer = (acct) => !!acct && reviewers().includes(String(acct).toLowerCase());

// A hot-sign link, HiveSigner-style, for the rider's fare transaction. The upstream pattern is
// /sign/transfer?to=&amount=&memo= ; whether MELEK-Signer exposes it is an operator setting, so the UI
// always shows the plain to/amount/memo as well — those work from any condenser wallet.
export const signTransferUrl = ({ to, amount, memo }) => {
  const base = (process.env.MELEK_SIGNER_SIGN_URL || `${publicSignerUrl()}/sign/transfer`).replace(/\/$/, '');
  const q = new URLSearchParams({ to: String(to || ''), amount: String(amount || ''), memo: String(memo || '') });
  return `${base}?${q.toString()}`;
};

// The on-chain verifier for a rider's fare transaction. Injected so tests run offline; the box wires a
// real one (fetch the trx, check it carries the driver transfer with the right amount and memo).
let _verifyTransfer = null;
export function __setVerifyTransfer(fn) { _verifyTransfer = typeof fn === 'function' ? fn : null; }
let _recordDrive = (s) => recordDrive(s);
export function __setRecordDrive(fn) { _recordDrive = typeof fn === 'function' ? fn : ((s) => recordDrive(s)); }

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
function readBody(req, max = 16 * 1024) {
  return new Promise((resolve) => {
    let d = ''; let over = false;
    req.on('data', (c) => { d += c; if (d.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : d));
    req.on('error', () => resolve(null));
  });
}
// A MISSING query parameter must stay missing: Number(null) and Number('') are both 0, and 0,0 is a
// real point in the Atlantic, so coercing them would quietly answer about the wrong place on Earth.
const numOf = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export const PAGE = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MELEK Ride</title>
<meta name=description content="Request a ride, or drive and get paid in MELEK. Part of MELEK Move.">
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff;--red:#e2605a}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:max(12px,env(safe-area-inset-top)) 14px 40px}
 .wrap{max-width:560px;margin:0 auto} header{display:flex;align-items:center;gap:10px;margin:6px 0 14px}
 h1{font-size:20px;margin:0} h1 small{display:block;color:var(--mut);font-size:12px;font-weight:400}
 .who{margin-left:auto;font-size:12px;color:var(--mut)}
 .tabs{display:flex;gap:8px;margin:0 0 14px} .tabs button{flex:1;background:var(--panel);color:var(--mut);border:1px solid var(--bd);border-radius:10px;padding:10px;font:inherit;font-size:14px}
 .tabs button[aria-selected=true]{color:var(--fg);border-color:var(--gold)}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px;margin:0 0 12px}
 .card h2{font-size:15px;margin:0 0 8px} .card p{margin:0 0 10px;color:var(--mut);font-size:13px}
 label{display:block;font-size:12px;color:var(--mut);margin:8px 0 4px}
 input{width:100%;background:#0d1117;color:var(--fg);border:1px solid var(--bd);border-radius:9px;padding:10px;font:inherit}
 .row{display:flex;gap:8px} .row>*{flex:1}
 button.go{width:100%;background:var(--gold);color:#17120a;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:700;margin-top:10px}
 button.alt{background:transparent;color:var(--fg);border:1px solid var(--bd)}
 .k{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px dashed var(--bd)}
 .k:last-child{border:0} .k b{font-weight:600}
 .ok{color:var(--green)} .warn{color:var(--gold)} .bad{color:var(--red)}
 pre{white-space:pre-wrap;word-break:break-word;background:#0d1117;border:1px solid var(--bd);border-radius:9px;padding:10px;font-size:12px;color:var(--mut)}
 a{color:var(--blue)}
 .hide{display:none}
</style></head><body><div class=wrap>
<header><h1>MELEK Ride<small>rideshare on the MELEK chain · part of MELEK Move</small></h1><span class=who id=who></span></header>

<div class=card id=board>…</div>

<div class=tabs role=tablist>
 <button role=tab id=tab-ride aria-selected=true onclick="tab('ride')">Get a ride</button>
 <button role=tab id=tab-drive aria-selected=false onclick="tab('drive')">Drive</button>
</div>

<section id=pane-ride>
 <div class=card>
  <h2>Where to?</h2>
  <p>Fares are quoted in MELEK from the rate card below. Nothing is charged automatically — at the end of the trip you sign one transfer yourself.</p>
  <div class=row><div><label>Pickup lat</label><input id=plat placeholder="32.7767"></div><div><label>Pickup lng</label><input id=plng placeholder="-96.7970"></div></div>
  <div class=row><div><label>Drop-off lat</label><input id=dlat placeholder="32.8140"></div><div><label>Drop-off lng</label><input id=dlng placeholder="-96.9489"></div></div>
  <button class="go alt" onclick=useMyLocation()>Use my location for pickup</button>
  <button class=go onclick=requestRide()>Request a ride</button>
  <div id=rideout></div>
 </div>
 <div class=card><h2>Rate card</h2><div id=rates>…</div></div>
</section>

<section id=pane-drive class=hide>
 <div class=card id=applycard>
  <h2>Apply to drive</h2>
  <p>Riders only need a MELEK account. Driving needs an application: the car, the plate, the licence and the insurance. A person reviews it before you are ever shown to a rider. These details stay off-chain — they are never posted, never put in a transfer memo, and never shown to a rider.</p>
  <div class=row><div><label>Make</label><input id=a_make placeholder="Toyota"></div><div><label>Model</label><input id=a_model placeholder="Corolla"></div></div>
  <div class=row><div><label>Year</label><input id=a_year placeholder="2016"></div><div><label>Colour</label><input id=a_color placeholder="silver"></div></div>
  <div class=row><div><label>Licence plate</label><input id=a_plate placeholder="ABC1234"></div><div><label>Seats</label><input id=a_seats placeholder="4"></div></div>
  <div class=row><div><label>Driver's licence no.</label><input id=a_lic></div><div><label>Issuing state</label><input id=a_licst placeholder="TX"></div></div>
  <div class=row><div><label>Insurer</label><input id=a_ins placeholder="State Farm"></div><div><label>Policy no.</label><input id=a_pol></div></div>
  <label>Policy expires (YYYY-MM-DD)</label><input id=a_exp placeholder="2027-03-01">
  <div class=row><div><label>State/province you drive in</label><input id=a_state placeholder="TX"></div><div><label>Country (2 letters)</label><input id=a_country placeholder="US"></div></div>
  <button class=go onclick=apply()>Submit application</button>
  <div id=applyout></div>
 </div>
 <div class=card id=shiftcard>
  <h2>Go online</h2>
  <p>Set this before you pull out, not while you are moving. Every mile also earns MELEK Drive on top of the fare — that is the gas-money half.</p>
  <button class=go onclick=goOnline()>Go online</button>
  <button class="go alt" onclick=goOffline()>Go offline</button>
  <div id=driveout></div>
 </div>
 <div class=card id=earncard>
  <h2>Your MELEK earnings this hour</h2>
  <p>Driving earns twice while you are online: the <b>distance</b> lane pays for miles, and the
    <b>reward zones</b> you drive through pay the same way they pay a walker. They are separate chain
    pools, and both settle on-chain when the hour closes. Fares are separate and come straight from the rider.</p>
  <div id=earn>…</div>
 </div>
 <div class=card id=reqcard><h2>Ride requests near you</h2><div id=reqs>Go online to see requests.</div></div>
 <div class=card id=dashcard><h2>Your trips</h2><div id=dash>…</div></div>
</section>
</div>
<script>
const $=(id)=>document.getElementById(id);
let ME=null, POS=null, TRIP=null;
const api=async(p,b)=>{const r=await fetch('/ride/api'+p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{});return r.json()};
function tab(t){for(const k of ['ride','drive']){$('pane-'+k).classList.toggle('hide',k!==t);$('tab-'+k).setAttribute('aria-selected',String(k===t))}}
function kv(k,v,cls){return '<div class=k><span>'+k+'</span><b class="'+(cls||'')+'">'+v+'</b></div>'}
async function boot(){
 const me=await api('/me'); ME=me.account;
 $('who').innerHTML = ME ? '@'+ME : '<a href="/login?return=/ride">Sign in with MELEK</a>';
 const r=await api('/rates');
 $('rates').innerHTML = kv('Flag drop', r.rateCard.base+' '+r.rateCard.symbol)+kv('Per mile', r.rateCard.perMile+' '+r.rateCard.symbol)
  +kv('Per minute', r.rateCard.perMinute+' '+r.rateCard.symbol)+kv('Minimum fare', r.rateCard.minimum+' '+r.rateCard.symbol)
  +kv('Platform fee', Math.round(r.platformFeePct*100)+'% to @'+r.platformFeeAccount)
  +'<p style="margin-top:8px">'+r.custody+'</p>';
 if(ME){refreshApp();refreshDash()}
 board();
}
async function board(){
 const q=POS?('?lat='+POS.latitude+'&lng='+POS.longitude):'';
 const m=await api('/market'+q);
 const n=m.nearby;
 $('board').innerHTML='<h2>Who is out right now</h2>'
  +kv('Drivers online',m.driversOnline,m.driversOnline?'ok':'warn')
  +kv('Riders looking',m.ridersLooking,m.ridersLooking?'ok':'warn')
  +kv('Requests open',m.requestsOpen)+kv('Trips running',m.tripsRunning)
  +(n?kv('Within '+n.radiusMi+' mi','<span class=ok>'+n.driversOnline+'</span> drivers · <span class=ok>'+n.ridersLooking+'</span> riders'):'')
  +'<p>'+m.note+'</p>';
 if(ME&&!POS&&navigator.geolocation)navigator.geolocation.getCurrentPosition(p=>{POS=p.coords;ping()},()=>{});
 else if(ME)ping();
 setTimeout(board,20000);
}
async function ping(){if(ME&&POS)await api('/rider/ping',{lat:POS.latitude,lng:POS.longitude})}
async function refreshApp(){
 const a=await api('/driver/application'); const st=a.status||'none';
 const approved=st==='approved', pending=st==='pending';
 $('applycard').classList.toggle('hide',approved);
 for(const c of ['shiftcard','earncard','reqcard','dashcard'])$(c).classList.toggle('hide',!approved);
 if(pending)$('applyout').innerHTML='<p class=warn>Application received — a person is reviewing the car, the plate, the licence and the insurance.</p>';
 else if(st==='rejected')$('applyout').innerHTML='<p class=bad>This application was not approved.'+(a.reviewNote?' '+a.reviewNote:'')+'</p>';
 else if(st==='suspended')$('applyout').innerHTML='<p class=bad>This driver account is suspended.'+(a.reviewNote?' '+a.reviewNote:'')+'</p>';
 if(a.driver&&a.driver.car&&approved)$('driveout').innerHTML=kv('Approved car',a.driver.car+' · '+a.driver.vehicle.plate,'ok');
}
async function apply(){
 const r=await api('/driver/apply',{vehicle:{make:$('a_make').value,model:$('a_model').value,year:+$('a_year').value,color:$('a_color').value,plate:$('a_plate').value,seats:+$('a_seats').value||4},
  licenceNumber:$('a_lic').value,licenceState:$('a_licst').value,insurer:$('a_ins').value,policyNumber:$('a_pol').value,policyExpires:$('a_exp').value,
  state:$('a_state').value,country:$('a_country').value});
 $('applyout').innerHTML=r.ok?'<p class=ok>'+r.note+'</p>':'<p class=bad>'+(r.reason||'could not submit')+'</p>';
 if(r.ok)refreshApp();
}
function useMyLocation(){navigator.geolocation&&navigator.geolocation.getCurrentPosition(p=>{POS=p.coords;$('plat').value=p.coords.latitude.toFixed(5);$('plng').value=p.coords.longitude.toFixed(5)},()=>alert('Location unavailable'))}
async function requestRide(){
 const b={pickup:{lat:+$('plat').value,lng:+$('plng').value},dropoff:{lat:+$('dlat').value,lng:+$('dlng').value}};
 const r=await api('/request',b);
 if(!r.ok){$('rideout').innerHTML='<p class=bad>'+(r.reason||'could not request')+'</p>';return}
 TRIP=r.trip.id;
 $('rideout').innerHTML=kv('Trip',r.trip.id)+kv('Estimate',r.quote.total+' '+r.quote.symbol)+kv('Distance',r.quote.miles+' mi')
  +kv('Drivers nearby',r.driversAvailable,r.driversAvailable?'ok':'warn')
  +(r.coverage?'<p class=warn>'+r.coverage.message+'</p>':'<p>'+r.note+'</p>');
 poll();
}
async function poll(){
 if(!TRIP)return; const r=await api('/trip?id='+encodeURIComponent(TRIP));
 if(r.ok){
  let h=kv('Status',r.trip.status,r.trip.status==='completed'?'ok':'warn');
  if(r.trip.driver)h+=kv('Driver','@'+r.trip.driver);
  if(r.trip.fare){h+=kv('Fare',r.trip.fare.total+' MELEK')+kv('Driver share',r.trip.fare.driverShare)+kv('Platform fee',r.trip.fare.platformFee)}
  if(r.payment&&r.payment.ops&&r.trip.status==='awaiting_payment'){
   h+='<p>Send these transfers to close the trip — one transaction, from your own wallet or the signer:</p><pre>'
    +r.payment.ops.map(o=>'to '+o[1].to+'  '+o[1].amount+'  memo: '+o[1].memo).join('\\n')+'</pre>';
   if(r.signUrl)h+='<p><a href="'+r.signUrl+'" target=_blank rel=noopener>Sign the fare on MELEK-Signer</a></p>';
   h+='<label>Transaction id once sent</label><input id=trx><button class=go onclick=confirmPay()>Confirm payment</button>';
  }
  $('rideout').innerHTML=h;
  if(!['completed','cancelled'].includes(r.trip.status))setTimeout(poll,5000);
 }
}
async function confirmPay(){const r=await api('/confirm',{tripId:TRIP,trxId:$('trx').value.trim()});if(!r.ok)alert(r.reason||'not confirmed');poll()}
async function goOnline(){
 navigator.geolocation.getCurrentPosition(async p=>{
  const r=await api('/driver/online',{lat:p.coords.latitude,lng:p.coords.longitude});
  POS=p.coords;
  $('driveout').innerHTML = r.ok?'<p class=ok>Online. Drive safe — leave the phone alone while you are moving.</p>':'<p class=bad>'+(r.reason||'could not go online')+'</p>';
  refreshReqs();refreshDash();driveLoop();
 },()=>alert('Location is required to go online'))
}
// ── MELEK Drive through the Drive app: mine the zone you're in, bank the miles you cover ──────────
// Operator: drivers do the geolocation mining through the Drive app. So while a driver is online this
// claims the reward zone under the car (same /api/geomine a walker uses, no step boost) and files the
// miles covered into the MELEK Drive lane. Both are MELEK Move endpoints — MELEK Ride is served inside
// MELEK Move, so they are same-origin from here.
let dvLast=null,dvBanked=0,dvSince=0,dvTimer=null;
const milesBetween=(a,b,c,d)=>{const R=3958.7613,r=x=>x*Math.PI/180,p=r(c)-r(a),q=r(d)-r(b);
 const h=Math.sin(p/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(q/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))};
async function moveApi(p,b){try{const r=await fetch(p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{});return r.json()}catch(e){return{ok:false,reason:'offline'}}}
function driveLoop(){
 if(dvTimer)clearInterval(dvTimer);
 dvSince=Date.now();dvLast=null;dvBanked=0;
 dvTimer=setInterval(()=>{
  if(!navigator.geolocation)return;
  navigator.geolocation.getCurrentPosition(async p=>{
   const c=p.coords;POS=c;
   await api('/driver/online',{lat:c.latitude,lng:c.longitude});      // the online heartbeat
   await moveApi('/api/geomine',{account:ME,lat:c.latitude,lng:c.longitude,steps:0});  // zone mining
   if(dvLast){const d=milesBetween(dvLast.lat,dvLast.lng,c.latitude,c.longitude);if(d>0.01)dvBanked+=d}
   dvLast={lat:c.latitude,lng:c.longitude};
   if(dvBanked>=1){const secs=Math.max(1,(Date.now()-dvSince)/1000);
    await moveApi('/api/drive',{account:ME,miles:dvBanked,seconds:secs,source:'shift'});
    dvBanked=0;dvSince=Date.now()}
   refreshEarnings();
  },()=>{},{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
 },120000);
 refreshEarnings();
}
async function refreshEarnings(){
 if(!ME)return;
 const [drive,walk]=await Promise.all([moveApi('/api/drive-standing?account='+encodeURIComponent(ME)),moveApi('/api/standing?account='+encodeURIComponent(ME))]);
 let h='';
 if(drive&&drive.ok){h+=kv('Miles this hour',drive.milesThisHour)
  +kv('Distance lane','<b>'+drive.projectedMelek+'</b> MELEK projected','ok')
  +kv('Drivers sharing it',drive.drivers);
  if(drive.gas&&drive.gas.gallons!=null)h+=kv('That is about',drive.gas.gallons+' gal of gas');
  else h+='<p>No MELEK market price yet, so there is no dollar or gallon figure to show — only the MELEK.</p>'}
 if(walk&&walk.ok)h+=kv('Reward zones this hour','<b>'+walk.projectedMelek+'</b> MELEK projected','ok');
 $('earn').innerHTML=h||'<p>Go online and the numbers start here.</p>';
}
async function goOffline(){if(dvTimer){clearInterval(dvTimer);dvTimer=null}const r=await api('/driver/offline',{});$('driveout').innerHTML=r.ok?'<p>Offline.</p>':'<p class=bad>'+(r.reason||'')+'</p>'}
async function refreshReqs(){
 if(!POS)return; const r=await api('/requests?lat='+POS.latitude+'&lng='+POS.longitude);
 $('reqs').innerHTML=(r.requests&&r.requests.length)?r.requests.map(t=>
  kv(t.id+' · '+(t.pickupMiles!=null?t.pickupMiles+' mi away':''),t.estimate.total+' MELEK est')
  +'<button class="go alt" onclick="accept(\\''+t.id+'\\')">Accept '+t.id+'</button>').join('')
  :'<p>No open requests nearby.</p>';
 setTimeout(refreshReqs,10000);
}
async function accept(id){const r=await api('/accept',{tripId:id});if(!r.ok)return alert(r.reason);TRIP=id;refreshDash()}
async function refreshDash(){
 const r=await api('/driver/dashboard');
 if(!r.ok)return;
 let h=kv('Completed trips',r.totals.trips)+kv('Earned',r.totals.earnedMelek+' MELEK')+kv('Miles driven',r.totals.milesDriven);
 for(const t of r.active){
  h+=kv(t.id,t.status);
  if(t.status==='accepted')h+='<button class="go alt" onclick="adv(\\''+t.id+'\\',\\'arrived\\')">Arrived</button>';
  if(['accepted','arrived'].includes(t.status))h+='<button class="go alt" onclick="adv(\\''+t.id+'\\',\\'in_progress\\')">Start trip</button>';
  if(t.status==='in_progress')h+='<label>Miles driven</label><input id=mi_'+t.id+'><button class=go onclick="finish(\\''+t.id+'\\')">End trip</button>';
 }
 $('dash').innerHTML=h;
}
async function adv(id,to){const r=await api('/advance',{tripId:id,to});if(!r.ok)alert(r.reason);refreshDash()}
async function finish(id){const mi=+($('mi_'+id)||{}).value||0;const r=await api('/complete',{tripId:id,miles:mi});if(!r.ok)return alert(r.reason);alert('Trip ended. Fare '+r.fare.total+' MELEK — the rider signs it; you keep '+r.fare.driverShare+'.');refreshDash()}
boot();
</script></body></html>`;

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://ride.local');
    // served both at /ride/* (mounted inside MELEK Move) and bare (standalone)
    let path = url.pathname.replace(/^\/ride(?=\/|$)/, '') || '/';
    const method = (req.method || 'GET').toUpperCase();
    const who = rideUser(req);
    let b = {};
    if (method === 'POST') {
      const raw = await readBody(req);
      try { b = JSON.parse(raw || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad json' }); }
    }
    // A signed-in session always wins; an explicit account in the body is only honoured without one
    // (standalone/testing). Nobody can act as another account while signed in.
    const actor = who || String((b && (b.account || b.driver || b.rider)) || '').trim().toLowerCase();
    const needActor = () => json(res, 401, { ok: false, reason: 'sign in with MELEK first', login: '/login?return=/ride', signup: signerSignupUrl() });

    if (path === '/api/health') return json(res, 200, { ok: true, app: 'MELEK Ride', feePct: RIDE_FEE_PCT(), feeAccount: RIDE_FEE_ACCOUNT() });
    if (path === '/api/rates') return json(res, 200, { ok: true, ...rideSummary() });
    if (path === '/api/me') return json(res, 200, { ok: true, account: who, signup: signerSignupUrl() });
    if (path === '/api/quote') {
      const q = quoteFare({ miles: numOf(url.searchParams.get('miles')) || 0, minutes: numOf(url.searchParams.get('minutes')) || 0 });
      return json(res, 200, { ok: true, ...q });
    }
    // The market board — how many on each side. Public on purpose: both sides need the same number,
    // and it carries no identity and no position.
    if (path === '/api/market') {
      const lat = numOf(url.searchParams.get('lat')); const lng = numOf(url.searchParams.get('lng'));
      return json(res, 200, marketStatus({ lat, lng }));
    }
    if (path === '/api/drivers') {
      const lat = numOf(url.searchParams.get('lat')); const lng = numOf(url.searchParams.get('lng'));
      if (lat == null || lng == null) return json(res, 422, { ok: false, reason: 'lat and lng are required' });
      return json(res, 200, driversNearSummary({ lat, lng }, { state: url.searchParams.get('state'), country: url.searchParams.get('country') }));
    }
    // "is anyone driving near me — and if not, where IS the nearest driver?" Area, region, state,
    // country, anywhere. A rider is told which level has a car instead of watching a spinner.
    if (path === '/api/coverage') {
      return json(res, 200, coverage({
        lat: numOf(url.searchParams.get('lat')), lng: numOf(url.searchParams.get('lng')),
        state: url.searchParams.get('state'), country: url.searchParams.get('country'),
      }));
    }
    if (path === '/api/requests') {
      const lat = numOf(url.searchParams.get('lat')); const lng = numOf(url.searchParams.get('lng'));
      return json(res, 200, { ok: true, requests: openRequests({ lat, lng }) });
    }
    if (path === '/api/trip') {
      const r = tripById(url.searchParams.get('id'));
      if (r.ok && r.payment && r.payment.ops && r.payment.ops[0]) {
        const op = r.payment.ops[0][1];
        r.signUrl = signTransferUrl({ to: op.to, amount: op.amount, memo: op.memo });
      }
      return json(res, r.ok ? 200 : 404, r);
    }
    if (path === '/api/driver/dashboard') {
      if (!actor) return needActor();
      return json(res, 200, driverDashboard(actor));
    }
    // A driver's own application, including their own licence/insurance (self:true) — never anyone else's.
    if (path === '/api/driver/application') {
      if (!actor) return needActor();
      return json(res, 200, driverApplication(actor, { self: true }));
    }
    // The review queue. Licence + insurance are in here, so it is gated to the review accounts.
    if (path === '/api/admin/applications') {
      if (!who) return needActor();
      if (!isReviewer(who)) return json(res, 403, { ok: false, reason: 'not a reviewer' });
      return json(res, 200, { ok: true, pending: pendingApplications() });
    }

    if (method === 'POST') {
      // Apply to drive. This is the only route that takes personal details, and they stay off-chain.
      if (path === '/api/driver/apply') {
        if (!actor) return needActor();
        const r = applyDriver({
          account: actor, vehicle: b.vehicle || {},
          licenceNumber: b.licenceNumber || b.licenseNumber, licenceState: b.licenceState || b.licenseState,
          insurer: b.insurer, policyNumber: b.policyNumber, policyExpires: b.policyExpires,
          state: b.state, country: b.country,
        });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/admin/review') {
        if (!who) return needActor();
        if (!isReviewer(who)) return json(res, 403, { ok: false, reason: 'not a reviewer' });
        const r = reviewDriver({ account: b.account, decision: b.decision, by: who, note: b.note });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/driver/online') {
        if (!actor) return needActor();
        const r = driverOnline({ account: actor, lat: b.lat, lng: b.lng, vehicle: b.vehicle, seats: b.seats });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/driver/offline') {
        if (!actor) return needActor();
        const r = driverOffline({ account: actor });
        return json(res, r.ok ? 200 : 422, r);
      }
      // a rider says "I'm here, looking" — this is what makes ridersLooking a real number
      if (path === '/api/rider/ping') {
        if (!actor) return needActor();
        const r = riderPing({ account: actor, lat: b.lat, lng: b.lng });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/request') {
        if (!actor) return needActor();
        const r = requestTrip({ rider: actor, pickup: b.pickup, dropoff: b.dropoff, note: b.note }, { state: b.state, country: b.country });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/accept') {
        if (!actor) return needActor();
        const r = acceptTrip({ tripId: b.tripId, driver: actor });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/advance') {
        if (!actor) return needActor();
        const r = advanceTrip({ tripId: b.tripId, driver: actor, to: b.to });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/complete') {
        if (!actor) return needActor();
        const r = completeTrip({ tripId: b.tripId, driver: actor, miles: b.miles, minutes: b.minutes });
        if (r.ok && r.payment && r.payment.ops[0]) {
          const op = r.payment.ops[0][1];
          r.signUrl = signTransferUrl({ to: op.to, amount: op.amount, memo: op.memo });
        }
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/confirm') {
        const r = await confirmPayment({ tripId: b.tripId, trxId: b.trxId },
          { verifyTransfer: _verifyTransfer, recordDrive: _recordDrive });
        return json(res, r.ok ? 200 : 422, r);
      }
      if (path === '/api/cancel') {
        if (!actor) return needActor();
        const r = cancelTrip({ tripId: b.tripId, account: actor, reason: b.reason });
        return json(res, r.ok ? 200 : 422, r);
      }
    }

    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Ride on http://${HOST}:${PORT} — fee ${Math.round(RIDE_FEE_PCT() * 100)}% to @${RIDE_FEE_ACCOUNT()}`));
}
