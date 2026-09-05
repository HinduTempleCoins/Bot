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
import { createTabFragment } from '../../integrations/token-launch.mjs';
import { CHAINS } from '../../kulaswap/kula-config.mjs';
import { quoteVote, DEFAULT_MARKET } from '../../kulaswap/alti-vote-market.mjs';
import { faucetClaim, dispositionFor, FAUCET_DEFAULTS } from '../../cryptology/hathor-disposition.mjs';

const ENGINE_API = process.env.ENGINE_API || 'https://engine.alpha.melek.salon';
const AUTO_URL = process.env.AUTO_URL || 'https://auto.alpha.melek.salon';
const MANAGE_URL = process.env.MANAGE_URL || 'https://manage.melek.salon';   // token-management + buyback front-end
const ACADEMY_URL = process.env.ACADEMY_URL || 'https://academy.melek.salon'; // Token Academy (how-to) + Economics 101
const CHAIN_RPC = process.env.CHAIN_RPC || 'https://alpha.melek.salon/rpc';
const PORT = +(process.env.PORT || process.env.TOKENS_PORT || 8130);

// PRANA factory addresses for the turnkey "Create a Token" flow. Env-overridable; defaults are
// the kula-config PRANA addresses (placeholders until ERC20FactoryWizard/CloneFactory are deployed
// + recorded — the Create form gates the per-mode button when its factory is unset).
const PRANA = CHAINS.prana || {};
const WIZARD_ADDR = process.env.WIZARD_ADDR || '';
const CLONE_FACTORY_ADDR = process.env.CLONE_FACTORY_ADDR || '';
const CHAIN_ID_HEX = PRANA.chainIdHex || '0xADE19';

// Vote Shop: the @soapbox account that casts bought votes + the ALTI/full-vote price (env-tunable).
const VOTE_VOTER = process.env.VOTE_VOTER || DEFAULT_MARKET.voter;
const VOTE_FULL_ALTI = +(process.env.VOTE_FULL_ALTI || DEFAULT_MARKET.altiPerFullVote);
const VOTE_MARKET = Object.freeze({ voter: VOTE_VOTER, altiPerFullVote: VOTE_FULL_ALTI });

// Faucet (Hathor's claim-based tip): the token name shown + the Crypt-ology disposition store file.
const FAUCET_TOKEN = process.env.FAUCET_TOKEN || 'APIS';
const CRYPTOLOGY_STORE = process.env.CRYPTOLOGY_STORE || '';
// Cooldown ledger (account -> lastClaimAt ms). Injectable so the box wires durable storage; the default
// in-memory map enforces the cooldown within a process. The on-chain transfer is the durable record.
let _faucetClaims = new Map();
export function __setFaucetClaims(map) { _faucetClaims = map instanceof Map ? map : new Map(); }
const FAUCET_RESERVOIR = +(process.env.FAUCET_RESERVOIR || 0) || Infinity;

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

/**
 * A post's tags come from the MELEK CHAIN, not the engine: get_content -> category +
 * json_metadata.tags. The engine only knows tribe rules + payouts, never the post body.
 * Soft-fails to []. Tribe matching is by tag, so category-as-first-tag is included.
 */
async function chainTags(author, permlink) {
  if (!author || !permlink) return [];
  try {
    const r = await _fetch(CHAIN_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_content', params: [author, permlink], id: 1 }),
    });
    if (!r || !r.ok) return [];
    const d = await r.json();
    const c = (d && d.result) || {};
    let meta = {};
    try { meta = typeof c.json_metadata === 'string' ? JSON.parse(c.json_metadata || '{}') : (c.json_metadata || {}); } catch { meta = {}; }
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    return [c.category, ...tags].filter(Boolean).map((t) => String(t).toLowerCase());
  } catch { return []; }
}

/**
 * voterMana — the @soapbox voter's current voting power in basis points (0..10000), read from the
 * chain. Soft-fails to full mana (10000) if the RPC is unreachable — a quote is just a preview; the
 * live order on the box re-checks mana before broadcasting.
 */
async function voterMana(account) {
  if (!account) return 10000;
  try {
    const r = await _fetch(CHAIN_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[account]], id: 1 }),
    });
    if (!r || !r.ok) return 10000;
    const d = await r.json();
    const a = d && d.result && d.result[0];
    if (!a) return 10000;
    // Steem/Blurt fork: voting_power is 0..10000 directly (older), or a voting_manabar.current_mana ratio.
    const vp = Number(a.voting_power);
    if (Number.isFinite(vp) && vp > 0) return Math.max(0, Math.min(10000, Math.round(vp)));
    return 10000;
  } catch { return 10000; }
}

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
<nav>${tab('tokens', 'Tokens', '/')}${tab('create', 'Create', '/create')}<a href="${esc(MANAGE_URL)}" class=tlink>Manage &amp; Buyback</a>${tab('wallet', 'Wallet', '/wallet')}${tab('earnings', 'Post Earnings', '/earnings')}${tab('vote', 'Vote Shop', '/vote')}${tab('faucet', 'Faucet', '/faucet')}<a href="${esc(ACADEMY_URL)}" class=tlink>Learn</a>${tab('standing', 'How We Stand', '/standing')}<a href="${esc(AUTO_URL)}" class=tlink style="margin-left:auto;align-self:center">Automation (Steem·Blurt·Hive·MELEK) →</a></nav>
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
let rules={};try{const r=await fetch(E+'/contracts/tribes');const d=await r.json();(d.rules||d.result||d||[]).forEach(x=>rules[(x.symbol||'').toUpperCase()]=x)}catch(e){}
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

function pageCreate() {
  const frag = createTabFragment({ wizardAddr: WIZARD_ADDR, cloneFactoryAddr: CLONE_FACTORY_ADDR, chainIdHex: CHAIN_ID_HEX });
  return shell('create', 'Create a Token', frag);
}

function pageVote() {
  return shell('vote', 'Vote Shop', `<div class=card><div class=row><b>Buy a MELEK upvote with ALTI</b></div>
<p class=dim style="margin:.4rem 0">Spend <span class=tok>ALTI</span> (the SoapBox staking reward) and <b>@${esc(VOTE_VOTER)}</b> casts a proportional upvote on your MELEK post.
The vote is mana-honest — it never exceeds @${esc(VOTE_VOTER)}'s available voting power, and any ALTI it can't use is refunded. Nothing is signed here: you get back an order to confirm in your wallet.</p>
<div class=row><input id=author placeholder="author (your MELEK @, no @)" autocomplete=off>
<input id=permlink placeholder="permlink" autocomplete=off style="flex:1"></div>
<div class=row style="margin-top:.5rem"><input id=alti type=number min=1 step=1 placeholder="ALTI to spend" value=50 style="width:9rem"><button onclick=q()>Quote the vote</button></div>
<div id=out style="margin-top:.8rem"></div>
<p class=dim style="margin-top:.6rem;font-size:.78rem">${esc(VOTE_FULL_ALTI)} ALTI = a 100% upvote. This is a transparent promotion market, not pay-to-rank — votes never re-order honest curation.</p></div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function q(){const a=document.getElementById('author').value.trim().replace(/^@/,'');const p=document.getElementById('permlink').value.trim();const alti=+document.getElementById('alti').value||0;const out=document.getElementById('out');
if(!a||!p){out.innerHTML='<span class=dim>Enter your post (author + permlink) first.</span>';return}
out.innerHTML='<span class=dim>quoting…</span>';
let d;try{d=await (await fetch('/api/vote-quote?author='+encodeURIComponent(a)+'&permlink='+encodeURIComponent(p)+'&alti='+encodeURIComponent(alti))).json()}catch(e){out.textContent='error';return}
if(!d||!d.ok){out.innerHTML='<span class=dim>Can\\'t fill that: '+esc((d&&d.reason)||'unknown')+'.</span>';return}
const q=d.quote;const refund=q.altiRefunded>0?' <span class=dim>(+'+esc(q.altiRefunded)+' ALTI refunded)</span>':'';
out.innerHTML='<div class=card style="margin:0"><b>Spend '+esc(q.altiCharged)+' ALTI</b>'+refund+' → a <b class=tok>'+esc(q.weightPct)+'%</b> upvote from @'+esc(d.vote.voter)+' on @'+esc(d.vote.author)+'/'+esc(d.vote.permlink)+'.'+(q.clampedByMana?' <span class=dim>(clamped to available voting power)</span>':'')+'<p class=dim style="margin-top:.4rem;font-size:.78rem">Confirm the ALTI transfer in your wallet to place the order.</p></div>'}
const u=new URLSearchParams(location.search);if(u.get('author')&&u.get('permlink')){document.getElementById('author').value=u.get('author');document.getElementById('permlink').value=u.get('permlink');q()}
</script>`);
}

function pageFaucet() {
  return shell('faucet', 'Faucet', `<div class=card><div class=row><b>Hathor's faucet</b><span class=dim>a daily drip of <span class=tok>${esc(FAUCET_TOKEN)}</span></span></div>
<p class=dim style="margin:.4rem 0">Not a bottomless tap — a real faucet: <b>once a day</b>, from a finite reservoir, and earned by good standing in the community (Crypt-ology). Spend time here, give back, and the drip grows.</p>
<div class=row><input id=acct placeholder="your MELEK @ (no @)" autocomplete=off><button onclick=claim()>Check my claim</button></div>
<div id=out style="margin-top:.8rem"></div></div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function claim(){const a=document.getElementById('acct').value.trim().replace(/^@/,'');const out=document.getElementById('out');
if(!a){out.innerHTML='<span class=dim>Enter your account first.</span>';return}
out.innerHTML='<span class=dim>checking…</span>';
let d;try{d=await (await fetch('/api/faucet-claim?account='+encodeURIComponent(a))).json()}catch(e){out.textContent='error';return}
if(d&&d.ok){out.innerHTML='<div class=card style="margin:0"><b>Claimed '+esc(d.amount)+' '+esc(d.token)+'</b> → @'+esc(a)+'. <span class=dim>Come back tomorrow for the next drip.</span></div>';return}
const why={cooldown:'You already claimed today — the faucet refills once a day.','reservoir-empty':'The reservoir is empty right now — it refills over time.','standing-too-low':'We\\'re still getting acquainted — spend a little time in the community first.','taker-no-reciprocity':'The faucet rewards giving back, not just taking. Engage a bit and try again.'};
out.innerHTML='<span class=dim>'+esc(why[d&&d.reason]||'Not eligible right now.')+(d&&d.nextClaimAt?' Next claim ~'+new Date(d.nextClaimAt).toLocaleString():'')+'</span>'}
const u=new URLSearchParams(location.search);if(u.get('account')){document.getElementById('acct').value=u.get('account');claim()}
</script>`);
}

function pageStanding() {
  return shell('standing', 'How We Stand', `<div class=card><div class=row><b>How Hathor sees you</b><span class=dim>Crypt-ology — a living relationship map</span></div>
<p class=dim style="margin:.4rem 0">Hathor remembers everyone she meets on-chain. Your posts, replies, and votes move your coordinates — trust, warmth, respect, familiarity, and how much you give back. This is read-only; it's how her greeting and her faucet shift, person to person.</p>
<div class=row><input id=acct placeholder="a MELEK @ (no @)" autocomplete=off><button onclick=go()>Look up</button></div>
<div id=out style="margin-top:.8rem"></div></div>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function bar(v,lo,hi){const pct=Math.max(0,Math.min(100,Math.round((v-lo)/(hi-lo)*100)));return '<div style="background:#222a3a;border-radius:5px;height:8px;overflow:hidden"><div style="height:8px;width:'+pct+'%;background:var(--gold)"></div></div>'}
async function go(){const a=document.getElementById('acct').value.trim().replace(/^@/,'');const out=document.getElementById('out');
if(!a){out.innerHTML='<span class=dim>Enter an account.</span>';return}
out.innerHTML='<span class=dim>reading the map…</span>';
let d;try{d=await (await fetch('/api/standing?account='+encodeURIComponent(a))).json()}catch(e){out.textContent='error';return}
if(!d||!d.ok){out.textContent='Could not read that.';return}
if(!d.totalInteractions){out.innerHTML='<div class=card style="margin:0">Hathor hasn\\'t met <b>@'+esc(a)+'</b> yet. Say hello on-chain and check back.</div>';return}
const c=d.coordinates||{};const dims=[['trust',-100,100],['warmth',-100,100],['respect',-100,100],['familiarity',0,100],['alignment',-100,100],['reciprocity',-100,100],['curiosity',0,100],['care',0,100]];
let rows='';for(const[k,lo,hi]of dims){rows+='<tr><td style="text-transform:capitalize">'+k+'</td><td style="width:55%">'+bar(+c[k]||0,lo,hi)+'</td><td class=dim>'+esc(Math.round(+c[k]||0))+'</td></tr>'}
out.innerHTML='<div class=card style="margin:0"><div class=row><b>@'+esc(a)+'</b> — <span class=tok style="text-transform:capitalize">'+esc(d.stance)+'</span><span class=dim>closeness '+esc(d.closeness)+' · standing '+esc(d.standing)+' · '+esc(d.totalInteractions)+' interactions</span></div>'+
'<table style="margin-top:.5rem"><tbody>'+rows+'</tbody></table>'+(d.topics&&d.topics.length?'<p class=dim style="margin-top:.5rem">Shared ground: '+d.topics.map(esc).join(', ')+'</p>':'')+'</div>'}
const u=new URLSearchParams(location.search);if(u.get('account')){document.getElementById('acct').value=u.get('account');go()}
</script>`);
}

// ---- handler ---------------------------------------------------------------
export async function handler(req, res) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return html(res, 400, 'bad request'); }
  const p = url.pathname;
  try {
    if (p === '/' || p === '/tokens') return html(res, 200, pageTokens());
    if (p === '/create') return html(res, 200, pageCreate());
    if (p === '/wallet') return html(res, 200, pageWallet());
    if (p === '/earnings') return html(res, 200, pageEarnings());
    if (p === '/vote') return html(res, 200, pageVote());
    if (p === '/faucet') return html(res, 200, pageFaucet());
    if (p === '/standing') return html(res, 200, pageStanding());
    if (p === '/api/standing') {
      const account = (url.searchParams.get('account') || '').replace(/^@/, '').toLowerCase();
      if (!account) return json(res, 200, { ok: false, reason: 'no-account' });
      try {
        const d = dispositionFor(account, { file: CRYPTOLOGY_STORE || undefined });
        return json(res, 200, { ok: true, ...d });
      } catch { return json(res, 200, { ok: true, stance: 'welcoming', coordinates: {}, closeness: 0, standing: 0, totalInteractions: 0, topics: [] }); }
    }
    if (p === '/api/faucet-claim') {
      const account = (url.searchParams.get('account') || '').replace(/^@/, '').toLowerCase();
      if (!account) return json(res, 200, { ok: false, reason: 'no-account' });
      const file = CRYPTOLOGY_STORE || undefined;
      let karma = 0;
      try { const d = dispositionFor(account, { file }); if (d && Number.isFinite(d.standing)) karma = d.standing; } catch { /* soft */ }
      const lastClaimAt = _faucetClaims.get(account) || 0;
      const res2 = faucetClaim({ account, lastClaimAt, reservoir: FAUCET_RESERVOIR, karma, file });
      if (res2.ok) _faucetClaims.set(account, Date.now());
      // The drip is QUEUED here (the cooldown is recorded); Hathor's signer broadcasts the transfer on the
      // box from her JIT key — this portal never holds a key.
      return json(res, 200, { ...res2, token: FAUCET_TOKEN });
    }
    if (p === '/api/vote-quote') {
      const author = url.searchParams.get('author') || '';
      const permlink = url.searchParams.get('permlink') || '';
      const altiSpent = +(url.searchParams.get('alti') || 0);
      const manaParam = url.searchParams.get('mana');
      const votingManaBps = manaParam != null ? +manaParam : await voterMana(VOTE_VOTER);
      const quote = quoteVote({ altiSpent, votingManaBps, market: VOTE_MARKET });
      if (!quote.ok) return json(res, 200, { ok: false, reason: quote.reason });
      return json(res, 200, {
        ok: true, quote,
        vote: { voter: VOTE_VOTER, author: String(author).replace(/^@/, ''), permlink, weight: quote.weightBps },
      });
    }
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
      if (!tags.length && author && permlink) tags = await chainTags(author, permlink);
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
