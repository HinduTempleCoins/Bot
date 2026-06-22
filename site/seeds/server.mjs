// site/seeds/server.mjs — seeds.soapbox.community
//
// The SEEDS page: a tokens.melek.salon-style WALLET view, wallet-gated, showing only your SEED tokens
// (operator 2026-06-22: "similar to the tokens.melek.salon page — you need your Akasha/MELEK wallet logged
// in, and you see Seeds only instead of all tokens or coins"). Seeds are PRANA tokens that MINT through
// MELEK-Engine, so a player's seeds are engine token balances; this page filters the wallet to the Kush Farm
// seed set (integrations/games/seed-tokens.mjs) and enriches each with its grow metadata.
//
// Connect: an EVM "Connect Wallet" (Akasha/MetaMask) OR type a MELEK account — balances read from the engine
// keyed by the MELEK account (non-custodial; no key ever touches this server). The seed CATALOG always
// renders (logged-out you still see which seeds exist); your balances fill in once connected.
//
// House style: ESM, esc() all interpolation, soft-fail, handler(req,res) exported, PORT/ENGINE_API env, Alpha.
//
//   PORT=8162 node site/seeds/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { seedCatalog, filterSeedBalances } from '../../integrations/games/seed-tokens.mjs';

const PORT = +(process.env.PORT || 8162);
const HOST = process.env.HOST || '127.0.0.1';
const ENGINE_API = process.env.ENGINE_API || 'https://engine.alpha.melek.salon';
const GROW_URL = process.env.GROW_URL || 'https://kush.soapbox.community';
const FARM_URL = process.env.FARM_URL || 'https://farm.soapbox.community';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
async function engineBalances(account) {
  if (!account) return [];
  try {
    const r = await _fetch(`${ENGINE_API}/contracts/balances?account=${encodeURIComponent(account)}`);
    if (!r || !r.ok) return [];
    const d = await r.json();
    return d.balances || d.result || d || [];
  } catch { return []; }
}

const RARITY = { common: '#93a1b3', uncommon: '#36c08a', rare: '#4c8dff', legendary: '#d9a441' };

function seedRow(s) {
  const flags = [];
  if (s.season === 'year-round') flags.push('<span class="tag yr">year-round</span>');
  else flags.push(`<span class="tag se">${esc(s.season)}</span>`);
  if (s.multiHarvest > 1) flags.push(`<span class=tag>🍎 ×${esc(s.multiHarvest)}</span>`);
  if (s.volunteer) flags.push('<span class=tag>🌱</span>');
  if (s.flower) flags.push('<span class=tag>🌷</span>');
  if (s.festival) flags.push('<span class=tag>🍂</span>');
  return `<tr data-symbol="${esc(s.symbol)}">
    <td><b class=sym style="color:${RARITY[s.rarity] || '#e9eef5'}">${esc(s.symbol)}</b><div class=nm>${esc(s.name)}</div></td>
    <td class=meta>${esc(s.tierLabel)} ${flags.join(' ')}</td>
    <td class="bal liquid">—</td>
    <td class="bal staked">—</td>
  </tr>`;
}

function page() {
  const cat = seedCatalog();
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Seeds — MELEK</title>
<meta name=description content="Your Seed wallet — the Kush Farm seed tokens you hold, minted through MELEK-Engine.">
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:880px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;margin:6px 0 4px}.brand{font-size:24px;font-weight:800}.brand b{color:var(--green)}
 .alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .lead{color:var(--mut);font-size:14px;margin:2px 0 14px}
 .connect{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:12px 14px;margin-bottom:14px}
 input{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:8px 12px}
 button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:8px 14px;cursor:pointer}
 .b-primary{background:var(--gold);color:#1a1306}.b-ghost{background:#0e131b;color:var(--fg);border:1px solid var(--bd)}
 .who{margin-left:auto;font-size:12px;color:var(--green)}
 table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--bd);vertical-align:top}
 th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
 .sym{font-size:14px}.nm{font-size:12px;color:var(--mut)}.meta{font-size:12px;color:var(--mut)}
 .tag{font-size:10px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:1px 5px}
 .tag.yr{color:var(--green);border-color:var(--green)}.tag.se{color:var(--blue);border-color:var(--blue)}
 .bal{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}.bal b{color:var(--fg)}
 .gate{color:var(--mut);font-size:13px;margin:8px 2px}
 footer{color:var(--mut);font-size:12px;text-align:center;margin:22px 0 8px}a{color:var(--gold)}
</style></head><body><div class=wrap>
<header><span class=brand>🌱 <b>Seeds</b></span><span class=alpha>Alpha</span></header>
<p class=lead>Your Seed wallet — the Kush Farm seeds you hold, as tokens minted through MELEK-Engine. Connect your Akasha / MELEK wallet (or enter your MELEK account) to see <b>your</b> balances; everything else is just the seed list.</p>
<div class=connect>
 <button class=b-ghost id=connect>Connect Wallet</button>
 <input id=acct placeholder="…or MELEK account" autocomplete=off spellcheck=false>
 <button class=b-primary id=show>Show my Seeds</button>
 <span class=who id=who></span>
</div>
<div class=gate id=gate>Not connected — showing the seed catalog. Your liquid / staked balances appear once you connect.</div>
<table><thead><tr><th>Seed</th><th>Grow</th><th style="text-align:right">Liquid</th><th style="text-align:right">Staked</th></tr></thead>
<tbody>${cat.map(seedRow).join('')}</tbody></table>
<footer>Seeds mint through MELEK-Engine. Grow them at <a href="${esc(GROW_URL)}">🌿 Kush Farm</a> · farm the tokens at <a href="${esc(FARM_URL)}">🌾 KULA Farm</a>. Non-custodial — your keys never leave your device. <a href="/api/seeds">api</a></footer>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const who=document.getElementById('who'),gate=document.getElementById('gate'),acct=document.getElementById('acct');
function fill(rows){const have=new Map((rows||[]).map(r=>[String(r.symbol).toUpperCase(),r]));let any=false;
 for(const tr of document.querySelectorAll('tbody tr')){const s=tr.dataset.symbol;const r=have.get(s);
  const L=tr.querySelector('.liquid'),S=tr.querySelector('.staked');
  if(r){any=true;L.innerHTML='<b>'+esc(r.liquid)+'</b>';S.innerHTML=esc(r.staked||'0');tr.style.opacity='1';}
  else{L.textContent='0';S.textContent='0';tr.style.opacity='.5';}}
 gate.textContent=any?'':'No seeds in this wallet yet — grow some at the Kush Farm.';}
async function load(account){if(!account){return;}who.textContent='@'+account;gate.textContent='loading…';
 try{const d=await(await fetch('/api/seeds?account='+encodeURIComponent(account),{cache:'no-store'})).json();fill((d&&d.seeds)||[]);}
 catch(e){gate.textContent='Could not reach the engine — try again.';}}
document.getElementById('show').onclick=()=>{const a=acct.value.trim().replace(/^@/,'').toLowerCase();if(a)load(a);};
acct.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('show').click();});
document.getElementById('connect').onclick=async()=>{
 if(window.ethereum){try{const ac=await window.ethereum.request({method:'eth_requestAccounts'});if(ac&&ac[0]){who.textContent=ac[0].slice(0,6)+'…'+ac[0].slice(-4);
  // EVM address → resolve a MELEK account later; for now, if the account box is filled use it, else prompt.
  if(acct.value.trim())load(acct.value.trim().replace(/^@/,'').toLowerCase());
  else gate.textContent='Wallet connected. Enter your MELEK account to load engine-side Seed balances.';}}catch(e){gate.textContent='Wallet connection cancelled.';}}
 else{gate.textContent='No browser wallet found — enter your MELEK account instead.';}};
const qa=new URLSearchParams(location.search).get('account');if(qa){acct.value=qa;load(qa.replace(/^@/,'').toLowerCase());}
</script>
</div></body></html>`;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://seeds.local');
    if (url.pathname === '/health') return json(res, 200, { ok: true, seeds: seedCatalog().length });
    if (url.pathname === '/api/catalog') return json(res, 200, { ok: true, seeds: seedCatalog() });
    if (url.pathname === '/api/seeds') {
      const account = (url.searchParams.get('account') || '').replace(/^@/, '').toLowerCase();
      if (!account) return json(res, 200, { ok: false, reason: 'no-account', seeds: [] });
      const balances = await engineBalances(account);
      return json(res, 200, { ok: true, account, seeds: filterSeedBalances(balances) });
    }
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Seeds wallet on http://${HOST}:${PORT} — engine ${ENGINE_API}`));
}
