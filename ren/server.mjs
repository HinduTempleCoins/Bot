// ren/server.mjs — REN claim + lookup surface (names.melek / ren.melek.salon).
//
// A browser page to look up a `.melek` / `.prana` / `.kula` name, see if it's free, what it costs,
// and CLAIM it — the claim tx is built unsigned by the resolver and signed CLIENT-SIDE by the
// user's wallet (Akasha / MetaMask via window.ethereum). The server never holds a key. Lookups go
// through our own API (server-side eth_call over the PRANA RPC) so the page needs no RPC/CORS setup.
//
// House style: ESM, esc() all interpolation, handler(req,res) export, CLI guarded, env config.

import { fileURLToPath } from 'node:url';
import * as ren from './resolver.mjs';

export { __setFetch } from './resolver.mjs';

const PORT = Number(process.env.PORT || 8133);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const reg = () => process.env.REN_REGISTRAR || ''; // read lazily so runtime/test env applies
const CHAIN_ID = Number(process.env.PRANA_CHAIN_ID || 108369);
const CHAIN_ID_HEX = '0x' + CHAIN_ID.toString(16);
const TLDS = (process.env.REN_TLDS || 'melek,prana,kula').split(',').map((s) => s.trim());

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// the ◈ mark on the brand blue — served at /favicon.svg + inlined in <head> (matches SoapBox brand)
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0d1117"/><text x="16" y="23" font-size="22" text-anchor="middle" fill="#58a6ff" font-family="system-ui,sans-serif">◈</text></svg>`;

// validate a full name: lowercase label.tld, label a-z0-9-, allowlisted tld, total 3..255
export function validName(name) {
  const s = String(name || '').trim().toLowerCase();
  if (s.length < 3 || s.length > 255) return null;
  const dot = s.indexOf('.');
  if (dot < 1 || dot !== s.lastIndexOf('.') || dot === s.length - 1) return null;
  const label = s.slice(0, dot), tld = s.slice(dot + 1);
  if (!/^[a-z0-9-]+$/.test(label) || !TLDS.includes(tld)) return null;
  return s;
}

const fmtPrana = (wei) => { try { return (Number(BigInt(wei)) / 1e18).toString(); } catch { return '?'; } };

// ── HTTP handler ─────────────────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  let url; try { url = new URL(req.url, BASE_URL); } catch { return send(res, 400, 'text/plain', 'bad url'); }
  const p = url.pathname;
  const q = url.searchParams;
  const json = (code, obj) => send(res, code, 'application/json', JSON.stringify(obj));

  if (p === '/healthz') return json(200, { ok: true, configured: ren.configured(), registrar: reg() || null });

  if (p === '/api/lookup') {
    const name = validName(q.get('name'));
    if (!name) return json(200, { ok: false, error: 'Use label.tld — e.g. ryan.melek (.' + TLDS.join(' .') + ')' });
    const card = await ren.lookup(name);
    return json(200, { ok: true, ...card });
  }

  if (p === '/api/price') {
    const name = validName(q.get('name'));
    if (!name) return json(200, { ok: false, error: 'invalid name' });
    const years = Math.max(1, Math.min(10, Number(q.get('years') || 1)));
    const inKula = q.get('kula') === '1' || q.get('kula') === 'true';
    const wei = await ren.price(name, years, inKula);
    return json(200, { ok: wei != null, name, years, inKula, priceWei: wei, priceHuman: wei != null ? fmtPrana(wei) : null });
  }

  if (p === '/api/register-tx') {
    const name = validName(q.get('name'));
    if (!name) return json(200, { ok: false, error: 'invalid name' });
    if (!reg()) return json(200, { ok: false, error: 'registrar not configured' });
    const years = Math.max(1, Math.min(10, Number(q.get('years') || 1)));
    const inKula = q.get('kula') === '1' || q.get('kula') === 'true';
    const priceWei = await ren.price(name, years, inKula);
    if (priceWei == null) return json(200, { ok: false, error: 'price unavailable (RPC down?)' });
    const tx = ren.buildRegisterTx({ contract: reg(), name, years, inKula, priceWei });
    return json(200, { ok: true, name, years, inKula, priceWei, chainIdHex: CHAIN_ID_HEX, tx });
  }

  if (p === '/favicon.svg' || p === '/favicon.ico') return send(res, 200, 'image/svg+xml', FAVICON_SVG);
  if (p === '/' || p === '/index.html') return send(res, 200, 'text/html; charset=utf-8', page());
  return send(res, 404, 'text/plain', 'not found');
}

function send(res, code, type, body) { res.writeHead(code, { 'content-type': type }); res.end(body); }

// ── the claim page ───────────────────────────────────────────────────────────────────────────
function page() {
  const tlds = TLDS.map((t) => esc('.' + t)).join(' · ');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>REN — claim your .melek name</title>
<link rel="icon" href="/favicon.svg">
<style>
  :root{--bg:#0d1117;--panel:#131826;--line:#222a3a;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d4a23c;--green:#3fb950;--red:#f85149}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,Segoe UI,Roboto,system-ui,sans-serif}
  .wrap{max-width:640px;margin:0 auto;padding:2rem 1rem}
  .badge{display:inline-block;font-size:.7rem;font-weight:700;color:#1a1304;background:var(--gold);border-radius:6px;padding:1px 6px;vertical-align:middle}
  h1{font-size:2rem;margin:.2rem 0;font-weight:800}.dia{color:var(--blue)}
  .sub{color:var(--mut);margin:.2rem 0 1.4rem}
  .box{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.1rem;margin:1rem 0}
  .row{display:flex;gap:.5rem;flex-wrap:wrap}
  input,select,button{font:inherit;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:.6rem .7rem}
  input{flex:1;min-width:180px}
  button{background:var(--blue);color:#06101f;font-weight:700;border:0;cursor:pointer}
  button.gold{background:var(--gold);color:#1a1304}button:disabled{opacity:.5;cursor:default}
  .k{color:var(--mut);font-size:.85rem}.v{font-weight:700}
  .ok{color:var(--green)}.no{color:var(--red)}
  code{background:#0b0e14;border:1px solid var(--line);border-radius:6px;padding:1px 5px;font-size:.85rem;word-break:break-all}
  a{color:var(--blue)}
  .grid{display:grid;grid-template-columns:auto 1fr;gap:.35rem .8rem;margin-top:.6rem}
</style></head><body><div class=wrap>
  <span class=badge>Alpha · PRANA testnet</span>
  <h1><span class=dia>◈</span> REN</h1>
  <div class=sub>Your true name on MELEK. Claim a <b>${tlds}</b> name — resolves to your wallet &amp; site, leased annually, paid in PRANA or KULA. No ICANN, no Web3 resolver — our chain, our names.</div>

  <div class=box>
    <div class=row>
      <input id=name placeholder="yourname.melek" autocomplete=off spellcheck=false>
      <button id=look>Look up</button>
    </div>
    <div id=result></div>
  </div>

  <div class=box id=claimbox style="display:none">
    <div class=row>
      <label class=k>Years <select id=years>${[1, 2, 3, 5, 10].map((y) => `<option>${y}</option>`).join('')}</select></label>
      <label class=k>Pay in <select id=pay><option value="0">PRANA</option><option value="1">KULA</option></select></label>
      <button class=gold id=claim>Claim with wallet</button>
    </div>
    <div id=claimmsg class=sub style="margin:.6rem 0 0"></div>
  </div>

  <p class=k>Connect Akasha or any EVM wallet on PRANA (chainId ${CHAIN_ID}). KULA payment needs a one-time approval first; PRANA is paid inline.</p>

<script>
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function jget(u){try{return await (await fetch(u)).json()}catch(e){return{ok:false,error:'network'}}}
function row(k,v){return '<div class=k>'+k+'</div><div class=v>'+v+'</div>'}
async function look(){
  const name=$('#name').value.trim().toLowerCase();
  const r=$('#result'); $('#claimbox').style.display='none';
  if(!name){r.innerHTML='';return}
  r.innerHTML='<div class=sub>…</div>';
  const d=await jget('/api/lookup?name='+encodeURIComponent(name));
  if(!d.ok){r.innerHTML='<div class=no>'+esc(d.error||'error')+'</div>';return}
  let html='<div class=grid>';
  if(d.available){
    html+=row('Status','<span class=ok>Available ✓</span>');
    const pr=await jget('/api/price?name='+encodeURIComponent(name)+'&years=1');
    if(pr.ok) html+=row('Price','<span class=v>'+esc(pr.priceHuman)+' PRANA</span> <span class=k>/ year</span>');
    r.innerHTML=html+'</div>';
    $('#claimbox').style.display='';
  }else{
    html+=row('Status','<span class=no>Taken</span>');
    if(d.resolvesTo) html+=row('Resolves to','<code>'+esc(d.resolvesTo)+'</code>');
    if(d.expiresISO) html+=row('Expires',esc(d.expiresISO.slice(0,10)));
    r.innerHTML=html+'</div>';
  }
}
async function claim(){
  const name=$('#name').value.trim().toLowerCase();
  const years=$('#years').value, kula=$('#pay').value;
  const m=$('#claimmsg');
  if(!window.ethereum){m.innerHTML='<span class=no>No EVM wallet found. Open Akasha or install MetaMask.</span>';return}
  m.textContent='Building transaction…';
  const d=await jget('/api/register-tx?name='+encodeURIComponent(name)+'&years='+years+'&kula='+kula);
  if(!d.ok){m.innerHTML='<span class=no>'+esc(d.error||'error')+'</span>';return}
  try{
    const accts=await window.ethereum.request({method:'eth_requestAccounts'});
    const from=accts[0];
    try{await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:d.chainIdHex}]})}catch(e){}
    if(d.inKula){m.innerHTML='<span class=no>KULA path: approve KULA to the registrar first, then claim. (PRANA is simpler for now.)</span>';return}
    m.textContent='Confirm in your wallet…';
    const hash=await window.ethereum.request({method:'eth_sendTransaction',params:[{from,to:d.tx.to,data:d.tx.data,value:d.tx.value}]});
    m.innerHTML='<span class=ok>Claimed!</span> tx <code>'+esc(hash)+'</code> — '+esc(name)+' is being registered. Re-look-up in a few seconds.';
  }catch(e){m.innerHTML='<span class=no>'+esc(e&&e.message||'rejected')+'</span>'}
}
$('#look').onclick=look;
$('#name').addEventListener('keydown',e=>{if(e.key==='Enter')look()});
$('#claim').onclick=claim;
</script>
</div></body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createServer } = await import('node:http');
  createServer((req, res) => handler(req, res).catch(() => send(res, 500, 'text/plain', 'err')))
    .listen(PORT, () => console.log(`REN claim page on ${BASE_URL} (registrar ${reg() || 'UNSET'})`));
}
