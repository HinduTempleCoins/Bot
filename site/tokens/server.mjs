// site/tokens/server.mjs — tokens.alpha.melek.salon
//
// Unified SCOT-token portal in the lineage of Hive-Engine / LeoFinance / eCency:
//   • Tokens   — every MELEK-Engine token + native SMT (discovery list)
//   • Wallet   — your holdings, with per-token TOGGLE-OFF (client-side pref)
//   • Earnings — ⭐ "all the SCOT tokens you'll earn for a post" (across every tribe it's tagged for)
//   • Automate — the multi-chain (Steem/Blurt/Hive/MELEK) autovote portal (separate, already live)
//
// House style: server-rendered HTML, no build step, esc() all interpolation, soft-fail-never-throw,
// injectable fetch, handler(req,res) exported for tests, PORT/BASE_URL/ENGINE_API/AUTO_URL env.

import { projectPostEarnings, __setFetch as setEarningsFetch } from '../../integrations/scot-earnings.mjs';

const ENGINE_API = process.env.ENGINE_API || 'https://engine.alpha.melek.salon';
const AUTO_URL = process.env.AUTO_URL || 'https://auto.alpha.melek.salon';
const PORT = +(process.env.PORT || process.env.TOKENS_PORT || 8130);

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch (also rewires the earnings module). */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); setEarningsFetch(fn); }

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const html = (res, code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
async function getJson(url) { try { const r = await _fetch(url); if (!r || !r.ok) return null; return await r.json(); } catch { return null; } }

// ---- shared shell ----------------------------------------------------------
const STYLE = `
:root{--bg:#0b0e14;--card:#131826;--ink:#e8e6e3;--dim:#9aa4b2;--gold:#d4a23c;--line:#222a3a;--ok:#2ecc71}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;padding:1rem;max-width:920px;margin:0 auto}
header{display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem}.logo{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--gold),#7a5a18)}
h1{font-size:1.25rem;display:flex;align-items:baseline;gap:.4rem}.alpha{font-size:.55rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(212,162,60,.5);border-radius:5px;padding:.05rem .3rem;vertical-align:super}
nav{display:flex;gap:.4rem;margin:.6rem 0 1rem;flex-wrap:wrap}nav a{color:var(--ink);text-decoration:none;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:.4rem .7rem;font-size:.85rem}
nav a.on{background:var(--gold);color:#1a1304;font-weight:700}
.card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:1rem;margin:.6rem 0}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{border-bottom:1px solid var(--line);padding:.45rem .5rem;text-align:left}th{color:var(--gold)}
input,button{font:inherit;border-radius:9px;border:1px solid var(--line);padding:.5rem .7rem;background:var(--bg);color:var(--ink)}
button{background:var(--gold);color:#1a1304;font-weight:700;cursor:pointer;border:0}.dim{color:var(--dim)}.tok{color:var(--gold);font-weight:600}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}.toggle{cursor:pointer;user-select:none}.off{opacity:.35}
a.tlink{color:#2c7be5}`;

function shell(active, title, inner) {
  const tab = (id, label, href) => `<a href="${esc(href)}" class="${active === id ? 'on' : ''}">${esc(label)}</a>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} · MELEK Tokens</title><style>${STYLE}</style></head><body>
<header><span class=logo></span><h1>MELEK Tokens <span class=alpha>Alpha</span></h1></header>
<nav>${tab('tokens', 'Tokens', '/')}${tab('wallet', 'Wallet', '/wallet')}${tab('earnings', 'Post Earnings', '/earnings')}<a href="${esc(AUTO_URL)}" class=tlink style="margin-left:auto;align-self:center">Automation (Steem·Blurt·Hive·MELEK) →</a></nav>
${inner}
<p class=dim style="margin-top:1.4rem;font-size:.75rem">Testnet. Token data from the MELEK-Engine; non-custodial — your keys never leave your device.</p>
</body></html>`;
}

// ---- pages -----------------------------------------------------------------
function pageTokens() {
  return shell('tokens', 'Tokens', `<div class=card><div class=row><b>All tokens</b><span class=dim>engine side-tokens + native SMTs</span></div>
<table id=tl><thead><tr><th>Token</th><th>Supply</th><th>Holders</th><th>Tribe tag</th><th></th></tr></thead><tbody><tr><td class=dim colspan=5>loading…</td></tr></tbody></table></div>
<script>
const E=${JSON.stringify(ENGINE_API)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(async()=>{let rows=[];try{const r=await fetch(E+'/contracts/tokens');const d=await r.json();rows=d.tokens||d.result||d||[]}catch(e){}
let rules={};try{const r=await fetch(E+'/contracts/rewards');const d=await r.json();(d.rules||d.result||d||[]).forEach(x=>rules[(x.symbol||'').toUpperCase()]=x)}catch(e){}
const tb=document.querySelector('#tl tbody');tb.innerHTML='';
if(!rows.length){tb.innerHTML='<tr><td class=dim colspan=5>No tokens yet (or engine unreachable).</td></tr>';return}
for(const t of rows){const s=(t.symbol||'').toUpperCase();const ru=rules[s];const tr=document.createElement('tr');
tr.innerHTML='<td class=tok>'+esc(s)+'</td><td>'+esc(t.supply??t.circulatingSupply??'—')+'</td><td>'+esc(t.holders??'—')+'</td><td>'+esc(ru?('#'+(ru.tag||s.toLowerCase())):'—')+'</td><td><a class=tlink href="/token/'+encodeURIComponent(s)+'">view →</a></td>';tb.appendChild(tr)}
})();
</script>`);
}

function pageWallet() {
  return shell('wallet', 'Wallet', `<div class=card><div class=row><b>Your holdings</b>
<input id=acct placeholder="account name" autocomplete=off><button onclick=load()>Show</button></div>
<p class=dim style="margin:.4rem 0">Tap a token to toggle it off — your choice is remembered on this device.</p>
<table id=bal><thead><tr><th>Show</th><th>Token</th><th>Liquid</th><th>Staked</th></tr></thead><tbody></tbody></table></div>
<script>
const E=${JSON.stringify(ENGINE_API)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const OFF=new Set(JSON.parse(localStorage.getItem('melek_tokens_off')||'[]'));
function persist(){localStorage.setItem('melek_tokens_off',JSON.stringify([...OFF]))}
async function load(){const a=document.getElementById('acct').value.trim().toLowerCase();const tb=document.querySelector('#bal tbody');tb.innerHTML='<tr><td class=dim colspan=4>loading…</td></tr>';
let rows=[];try{const r=await fetch(E+'/contracts/balances?account='+encodeURIComponent(a));const d=await r.json();rows=d.balances||d.result||d||[]}catch(e){}
tb.innerHTML='';if(!rows.length){tb.innerHTML='<tr><td class=dim colspan=4>No balances for @'+esc(a)+'.</td></tr>';return}
for(const b of rows){const s=(b.symbol||'').toUpperCase();const off=OFF.has(s);const tr=document.createElement('tr');if(off)tr.className='off';
tr.innerHTML='<td class=toggle>'+(off?'☐':'☑')+'</td><td class=tok>'+esc(s)+'</td><td>'+esc(b.balance??b.liquid??'0')+'</td><td>'+esc(b.stake??b.staked??'0')+'</td>';
tr.querySelector('.toggle').onclick=()=>{off?OFF.delete(s):OFF.add(s);persist();load()};tb.appendChild(tr)}}
const qa=new URLSearchParams(location.search).get('account');if(qa){document.getElementById('acct').value=qa;load()}
</script>`);
}

function pageEarnings() {
  return shell('earnings', 'Post Earnings', `<div class=card><div class=row><b>What will this post earn?</b></div>
<p class=dim style="margin:.4rem 0">Enter a post — see every tribe token it earns across all its hashtags.</p>
<div class=row><input id=author placeholder="author" autocomplete=off><input id=permlink placeholder="permlink" autocomplete=off style="flex:1"><button onclick=go()>Project</button></div>
<div id=out style="margin-top:.8rem"></div></div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function go(){const a=document.getElementById('author').value.trim();const p=document.getElementById('permlink').value.trim();const out=document.getElementById('out');out.innerHTML='<span class=dim>projecting…</span>';
let d;try{d=await (await fetch('/api/earnings?author='+encodeURIComponent(a)+'&permlink='+encodeURIComponent(p))).json()}catch(e){out.textContent='error';return}
if(!d||!d.earnings||!d.earnings.length){out.innerHTML='<span class=dim>This post isn\\'t in any tribe (no matching hashtags), or the engine is unreachable.</span>';return}
let h='<table><thead><tr><th>Token</th><th>Tribe</th><th>Author earns</th><th>Curators</th><th>Total</th></tr></thead><tbody>';
for(const e of d.earnings){h+='<tr><td class=tok>'+esc(e.symbol)+'</td><td>#'+esc(e.tag)+'</td><td>'+(+e.author).toFixed(3)+'</td><td>'+(+e.curators).toFixed(3)+'</td><td>'+(+e.total).toFixed(3)+'</td></tr>'}
h+='</tbody></table>';out.innerHTML=h}
const u=new URLSearchParams(location.search);if(u.get('author')&&u.get('permlink')){document.getElementById('author').value=u.get('author');document.getElementById('permlink').value=u.get('permlink');go()}
</script>`);
}

// ---- handler ---------------------------------------------------------------
export async function handler(req, res) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return html(res, 400, 'bad request'); }
  const p = url.pathname;
  try {
    if (p === '/' || p === '/tokens') return html(res, 200, pageTokens());
    if (p === '/wallet') return html(res, 200, pageWallet());
    if (p === '/earnings') return html(res, 200, pageEarnings());
    if (p.startsWith('/token/')) {
      const sym = decodeURIComponent(p.slice('/token/'.length)).toUpperCase();
      // per-token page = the engine's Nitrous tribe page (already built); link out to it
      const inner = `<div class=card><h2 class=tok>${esc(sym)}</h2>
<p class=dim>Per-tribe page (supply, holders, reward posts, leaderboard) is served by the engine's Nitrous renderer:</p>
<p><a class=tlink href="${esc(ENGINE_API)}/nitrous/${encodeURIComponent(sym)}">Open ${esc(sym)} tribe page →</a></p>
<p><a class=tlink href="/">← all tokens</a></p></div>`;
      return html(res, 200, shell('tokens', sym, inner));
    }
    if (p === '/api/earnings') {
      const author = url.searchParams.get('author') || '';
      const permlink = url.searchParams.get('permlink') || '';
      // fetch the post's tags from the chain via the engine (or accept tags param for tests)
      let tags = (url.searchParams.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
      if (!tags.length && author && permlink) {
        const c = await getJson(`${ENGINE_API}/contracts/post-tags?author=${encodeURIComponent(author)}&permlink=${encodeURIComponent(permlink)}`);
        tags = (c && (c.tags || c.result)) || [];
      }
      const out = await projectPostEarnings({ author, permlink, tags }, { engineApi: ENGINE_API });
      return json(res, 200, out);
    }
    return html(res, 404, shell('tokens', 'Not found', '<div class=card>Not found. <a class=tlink href="/">Home</a></div>'));
  } catch (e) {
    return html(res, 200, shell('tokens', 'Error', `<div class=card>Something went wrong, but we never crash. <a class=tlink href="/">Home</a></div>`));
  }
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs') && process.argv[1].includes('tokens')) {
  const http = await import('node:http');
  http.createServer(handler).listen(PORT, () => process.stdout.write(`tokens portal on :${PORT} (engine ${ENGINE_API})\n`));
}
