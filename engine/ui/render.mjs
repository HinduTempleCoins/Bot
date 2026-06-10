/**
 * render.mjs — server-rendered single-page UI for Melek-Engine.
 *
 * No build step, no framework. The page lists tokens + state, looks up
 * balances, and offers a "create / issue / transfer" builder that assembles
 * the exact custom_json and (optionally) broadcasts it CLIENT-SIDE via dhive
 * from a CDN. The private key is entered in the browser and NEVER sent to the
 * server (key-custody rule §7) — broadcast goes browser -> L1 RPC directly,
 * or the user copies the JSON into their own wallet.
 */

import { config, genesis } from '../config.mjs';
import { fromBaseUnits } from '../lib/decimal.mjs';

export function renderUI(state) {
  const tokens = state
    .collection('tokens')
    .map((t) => ({
      symbol: t.symbol,
      name: t.name,
      issuer: t.issuer,
      supply: fromBaseUnits(BigInt(t.supply), t.precision),
      maxSupply: fromBaseUnits(BigInt(t.maxSupply), t.precision),
      precision: t.precision,
      immutable: t.supplyCapImmutable,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const rows = tokens
    .map(
      (t) => `<tr>
      <td class="sym">${t.symbol}</td>
      <td>${esc(t.name)}</td>
      <td>@${esc(t.issuer)}</td>
      <td class="num">${t.supply}</td>
      <td class="num">${t.maxSupply}${t.immutable ? ' 🔒' : ''}</td>
      <td class="num">${t.precision}</td>
    </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MELEK-Engine · alpha testnet</title>
<style>
:root{--bg:#0d0b14;--card:#16131f;--ink:#e9e4f5;--mut:#9a90b5;--gold:#d8b35a;--line:#2a2438}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{padding:28px 20px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#1a1626,#0d0b14)}
h1{margin:0;font-size:24px;letter-spacing:.5px}h1 span{color:var(--gold)}
.sub{color:var(--mut);margin-top:6px;font-size:13px}
main{max-width:980px;margin:0 auto;padding:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:16px 0}
h2{font-size:16px;margin:0 0 12px;color:var(--gold)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
.num{text-align:right;font-variant-numeric:tabular-nums}.sym{font-weight:700;color:var(--gold)}
input,select,textarea{background:#0d0b14;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:9px 11px;font:inherit;width:100%}
label{display:block;color:var(--mut);font-size:12px;margin:10px 0 4px}
button{background:var(--gold);color:#1a1626;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;margin-top:14px}
button.ghost{background:transparent;color:var(--gold);border:1px solid var(--gold)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
pre{background:#0d0b14;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all}
.pill{display:inline-block;background:#0d0b14;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut);margin-right:6px}
.warn{color:#e0a; font-size:12px}
a{color:var(--gold)}
@media(max-width:640px){.grid{grid-template-columns:1fr}}
</style></head>
<body>
<header>
  <h1><span>MELEK</span>-Engine</h1>
  <div class="sub">Hive-Engine-style token layer for the MELEK chain · alpha testnet ·
    fee token <b>${genesis.feeToken}</b> · governance <b>${genesis.minerToken}</b> ·
    sidechain id <code>${config.sidechainId}</code></div>
  <div class="sub" id="status">loading status…</div>
</header>
<main>

  <div class="card">
    <h2>Tokens</h2>
    <table><thead><tr><th>Symbol</th><th>Name</th><th>Issuer</th>
      <th class="num">Supply</th><th class="num">Max</th><th class="num">Prec</th></tr></thead>
      <tbody>${rows || '<tr><td colspan=6>no tokens yet</td></tr>'}</tbody></table>
  </div>

  <div class="card">
    <h2>Balance lookup</h2>
    <div class="grid">
      <div><label>Account</label><input id="balAcct" placeholder="hathor"></div>
      <div style="align-self:end"><button class="ghost" onclick="lookup()">Look up balances</button></div>
    </div>
    <pre id="balOut" style="margin-top:14px">—</pre>
  </div>

  <div class="card">
    <h2>Create / Issue / Transfer — build a transaction</h2>
    <p class="sub">This builds the exact <code>custom_json</code> for the MELEK chain.
    Your key is used <b>only in your browser</b> to sign &amp; broadcast — it is never sent to this server.</p>
    <label>Action</label>
    <select id="action" onchange="renderForm()">
      <option value="create">tokens.create — make a new token (burns ${genesis.feeToken})</option>
      <option value="issue">tokens.issue — mint to an account (issuer only)</option>
      <option value="transfer">tokens.transfer — send tokens</option>
      <option value="stake">tokens.stake — stake tokens</option>
    </select>
    <div id="form"></div>
    <label>Your account (L1 username)</label><input id="acct" placeholder="hathor">
    <label>Active private key (WIF) — stays in your browser <span class="warn">never sent to server</span></label>
    <input id="wif" type="password" placeholder="5J… (testnet throwaway only)">
    <div style="display:flex;gap:10px">
      <button onclick="buildOnly()" class="ghost">Build JSON (copy to wallet)</button>
      <button onclick="broadcast()">Sign &amp; broadcast (in browser)</button>
    </div>
    <label>Generated custom_json</label><pre id="jsonOut">—</pre>
    <pre id="bcOut"></pre>
  </div>

  <div class="card">
    <h2>Architecture</h2>
    <p><span class="pill">L2 sidechain</span><span class="pill">deterministic replay</span>
       <span class="pill">issuer-only issue</span><span class="pill">immutable cap option</span>
       <span class="pill">state hash published</span><span class="pill">NO DEX (PRANA seams gated)</span></p>
    <p class="sub">Anchored to MELEK L1 via <code>custom_json</code> id <code>${config.sidechainId}</code>.
    State is a deterministic fold over L1 blocks; the per-block SHA-256 state hash is published at
    <a href="/status">/status</a> so anyone can replay and verify. The PRANA DEX plugs in later via two
    gated seams (pegged-asset gateway + signed-fill settlement) — both disabled here.</p>
    <p class="sub">API: <a href="/contracts/tokens">/contracts/tokens</a> ·
      <a href="/status">/status</a> · <a href="/health">/health</a></p>
    <p class="sub"><b><a href="/tools">→ Token Tools</a></b>: unified list (engine side-tokens +
      native SMT/NAI), token detail, and an op builder for create / issue / transfer / smt_create.</p>
  </div>

</main>
<script src="https://unpkg.com/@hiveio/dhive@1.3.2/dist/dhive.js"></script>
<script>
const SIDECHAIN_ID = ${JSON.stringify(config.sidechainId)};
const CHAIN_ID = ${JSON.stringify(config.chainId)};
const PREFIX = ${JSON.stringify(config.addressPrefix)};
const RPC = location.origin.includes('localhost') ? 'http://127.0.0.1:8090' : 'https://alpha.melek.salon/rpc';

async function refreshStatus(){
  try{const s=await (await fetch('/status')).json();
    document.getElementById('status').innerHTML =
      'block <b>'+s.lastBlock+'</b> · '+s.tokenCount+' tokens · state '+
      '<code>'+(s.stateHash||'').slice(0,16)+'…</code>';
  }catch(e){}
}
refreshStatus(); setInterval(refreshStatus, 8000);

async function lookup(){
  const a=document.getElementById('balAcct').value.trim();
  if(!a)return;
  const r=await (await fetch('/contracts/balances?account='+encodeURIComponent(a))).json();
  document.getElementById('balOut').textContent = JSON.stringify(r,null,2);
}

function renderForm(){
  const a=document.getElementById('action').value;
  const f={
    create:'<label>Symbol (1-10 A-Z)</label><input id="p_symbol" placeholder="MYTOK">'+
           '<label>Name</label><input id="p_name" placeholder="My Token">'+
           '<label>Precision (0-8)</label><input id="p_precision" value="3">'+
           '<label>Max supply</label><input id="p_maxSupply" placeholder="1000000">'+
           '<label><input type="checkbox" id="p_immutable" style="width:auto"> immutable supply cap</label>',
    issue:'<label>Symbol</label><input id="p_symbol" placeholder="MYTOK">'+
          '<label>To</label><input id="p_to" placeholder="alice">'+
          '<label>Quantity</label><input id="p_quantity" placeholder="100">',
    transfer:'<label>Symbol</label><input id="p_symbol" placeholder="MYTOK">'+
          '<label>To</label><input id="p_to" placeholder="bob">'+
          '<label>Quantity</label><input id="p_quantity" placeholder="10">',
    stake:'<label>Symbol</label><input id="p_symbol" placeholder="DRONE">'+
          '<label>Quantity</label><input id="p_quantity" placeholder="10">',
  }[a];
  document.getElementById('form').innerHTML=f;
}
renderForm();

function buildPayload(){
  const a=document.getElementById('action').value;
  const g=id=>{const el=document.getElementById(id);return el?el.value.trim():undefined};
  let payload={};
  if(a==='create'){payload={symbol:g('p_symbol').toUpperCase(),name:g('p_name'),
    precision:Number(g('p_precision')),maxSupply:g('p_maxSupply')};
    if(document.getElementById('p_immutable').checked)payload.supplyCapImmutable=true;}
  if(a==='issue')payload={symbol:g('p_symbol').toUpperCase(),to:g('p_to'),quantity:g('p_quantity')};
  if(a==='transfer')payload={symbol:g('p_symbol').toUpperCase(),to:g('p_to'),quantity:g('p_quantity')};
  if(a==='stake')payload={symbol:g('p_symbol').toUpperCase(),quantity:g('p_quantity')};
  return {contractName:'tokens',contractAction:a,contractPayload:payload};
}

function buildOnly(){
  const json=buildPayload();
  document.getElementById('jsonOut').textContent=JSON.stringify(json,null,2);
  return json;
}

async function broadcast(){
  const out=document.getElementById('bcOut');
  try{
    const json=buildOnly();
    const acct=document.getElementById('acct').value.trim();
    const wif=document.getElementById('wif').value.trim();
    if(!acct||!wif){out.textContent='enter account + key';return;}
    const client=new dhive.Client(RPC,{chainId:CHAIN_ID,addressPrefix:PREFIX});
    const key=dhive.PrivateKey.fromString(wif);
    const op=['custom_json',{required_auths:[acct],required_posting_auths:[],
      id:SIDECHAIN_ID,json:JSON.stringify(json)}];
    out.textContent='broadcasting…';
    const r=await client.broadcast.sendOperations([op],key);
    out.textContent='✓ broadcast id '+r.id+' — engine will reflect it within ~3s\\n'+JSON.stringify(r,null,2);
    setTimeout(refreshStatus,4000);
  }catch(e){out.textContent='✗ '+(e&&e.message?e.message:e);}
}
</script>
</body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
