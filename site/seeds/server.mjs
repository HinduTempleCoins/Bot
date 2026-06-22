// site/seeds/server.mjs — seeds.soapbox.community
//
// The SEEDS page: a tokens.melek.salon-style WALLET, wallet-gated, showing your SEED NFT COLLECTION
// (operator 2026-06-22: "similar to the tokens.melek.salon page — you need your Akasha/MELEK wallet logged
// in, and you see Seeds only" … "they are NFTs"). Seeds are PRANA NFTs (semi-fungible, ERC-1155) that MINT
// through MELEK-Engine — each strain is one NFT type and you OWN a quantity. This page filters the wallet to
// the Kush Farm seed collection (integrations/games/seed-tokens.mjs) and shows which seeds you hold + traits.
//
// Connect: an EVM "Connect Wallet" (Akasha/MetaMask) OR type a MELEK account — holdings read from the engine
// keyed by the MELEK account (non-custodial; no key ever touches this server). The seed CATALOG always
// renders (logged-out you still see the collection); your owned counts fill in once connected.
//
// House style: ESM, esc() all interpolation, soft-fail, handler(req,res) exported, PORT/ENGINE_API env, Alpha.
//
//   PORT=8162 node site/seeds/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { seedCatalog, ownedSeeds, SEED_COLLECTION } from '../../integrations/games/seed-tokens.mjs';

const PORT = +(process.env.PORT || 8162);
const HOST = process.env.HOST || '127.0.0.1';
const ENGINE_API = process.env.ENGINE_API || 'https://engine.alpha.melek.salon';
const GROW_URL = process.env.GROW_URL || 'https://kush.soapbox.community';
const FARM_URL = process.env.FARM_URL || 'https://farm.soapbox.community';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

// Seeds come in two kinds (see seed-tokens.mjs): fungible engine TOKENS and semi-fungible NFTs. So we read
// BOTH the fungible balances endpoint and the NFT-holdings endpoint and merge — ownedSeeds() then keeps only
// the symbols that are seeds and that the wallet actually holds. Both paths env-overridable; soft-fail to [].
const ENGINE_TOKEN_PATH = process.env.ENGINE_TOKEN_PATH || '/contracts/balances';
const ENGINE_NFT_PATH = process.env.ENGINE_NFT_PATH || '/contracts/nft/balances';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
async function getList(url) {
  try {
    const r = await _fetch(url);
    if (!r || !r.ok) return [];
    const d = await r.json();
    return d.nfts || d.holdings || d.balances || d.result || d || [];
  } catch { return []; }
}
async function engineHoldings(account) {
  if (!account) return [];
  const a = encodeURIComponent(account);
  const [tokens, nfts] = await Promise.all([
    getList(`${ENGINE_API}${ENGINE_TOKEN_PATH}?account=${a}`),
    getList(`${ENGINE_API}${ENGINE_NFT_PATH}?account=${a}&collection=${encodeURIComponent(SEED_COLLECTION)}`),
  ]);
  return [...(Array.isArray(tokens) ? tokens : []), ...(Array.isArray(nfts) ? nfts : [])];
}

const RARITY = { common: '#93a1b3', uncommon: '#36c08a', rare: '#4c8dff', legendary: '#d9a441' };

function seedCard(s) {
  const col = RARITY[s.rarity] || '#e9eef5';
  const isNft = s.kind === 'nft';
  const kindBadge = isNft ? '🖼 NFT' : '🪙 Token';
  const sub = isNft ? `${esc(s.collection)} NFT` : 'fungible token';
  const chips = [];
  if (s.season === 'year-round') chips.push('<span class="tag yr">year-round</span>');
  else chips.push(`<span class="tag se">${esc(s.season)}</span>`);
  chips.push(`<span class=tag>${esc(s.tierLabel)}</span>`);
  if (s.multiHarvest > 1) chips.push(`<span class=tag>🍎 ×${esc(s.multiHarvest)}</span>`);
  if (s.volunteer) chips.push('<span class=tag>🌱 volunteer</span>');
  if (s.flower) chips.push('<span class=tag>🌷 flower</span>');
  if (s.festival) chips.push('<span class=tag>🍂 festival</span>');
  return `<div class="nft ${esc(s.kind)}" data-symbol="${esc(s.symbol)}" style="--rc:${col}">
    <div class=art aria-hidden=true><span>🌱</span><span class="kind ${esc(s.kind)}">${kindBadge}</span></div>
    <div class=body>
      <div class=top><b class=nm>${esc(s.name)}</b><span class=rar style="color:${col};border-color:${col}">${esc(s.rarity)}</span></div>
      <div class=sub><span class=sym>${esc(s.symbol)}</span> <span class=mut>· ${sub}</span></div>
      <div class=chips>${chips.join(' ')}</div>
      <div class=own><span class=ownlabel>${isNft ? 'Owned' : 'Balance'}</span> <b class=count>—</b></div>
    </div>
  </div>`;
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
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
 .nft{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--bd);border-radius:14px;overflow:hidden}
 .nft.owned{border-color:var(--rc);box-shadow:0 0 0 1px var(--rc) inset}.nft.dim{opacity:.45}
 .art{position:relative;height:84px;display:flex;align-items:center;justify-content:center;font-size:38px;background:radial-gradient(120px 80px at 50% 20%,color-mix(in srgb,var(--rc) 28%,transparent),transparent),#0e131b;border-bottom:1px solid var(--bd)}
 .art .kind{position:absolute;top:7px;right:7px;font-size:9px;font-weight:700;padding:2px 6px;border-radius:999px;background:#0b0d12cc;border:1px solid var(--bd);color:var(--mut)}
 .art .kind.nft{color:var(--gold);border-color:var(--gold)}.art .kind.token{color:var(--blue);border-color:var(--blue)}
 .body{padding:11px 12px}.top{display:flex;align-items:center;gap:8px}.nm{font-size:15px}
 .rar{margin-left:auto;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border:1px solid;border-radius:999px;padding:2px 7px}
 .sub{font-size:12px;margin:3px 0 8px}.sym{color:var(--fg);font-weight:700;font-family:ui-monospace,Menlo,monospace}
 .chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}
 .tag{font-size:10px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:1px 5px}
 .tag.yr{color:var(--green);border-color:var(--green)}.tag.se{color:var(--blue);border-color:var(--blue)}
 .own{display:flex;align-items:baseline;gap:6px;border-top:1px solid var(--bd);padding-top:8px}
 .ownlabel{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}.count{font-size:18px;font-variant-numeric:tabular-nums}
 .mut{color:var(--mut)}.blue{color:var(--blue)}.gold{color:var(--gold)}.gate{color:var(--mut);font-size:13px;margin:8px 2px}
 footer{color:var(--mut);font-size:12px;text-align:center;margin:22px 0 8px}a{color:var(--gold)}
</style></head><body><div class=wrap>
<header><span class=brand>🌱 <b>Seeds</b></span><span class=alpha>Alpha</span></header>
<p class=lead>Your Seed wallet — every Kush Farm strain, minted through MELEK-Engine. Some seeds are <b class=blue>fungible tokens</b> (the abundant ones — trade them, plant = burn them); the scarce strains are <b class=gold>NFTs</b> (collectable, with traits). Connect your Akasha / MELEK wallet (or enter your MELEK account) to see which seeds <b>you</b> hold; everything else is just the catalog.</p>
<div class=connect>
 <button class=b-ghost id=connect>Connect Wallet</button>
 <input id=acct placeholder="…or MELEK account" autocomplete=off spellcheck=false>
 <button class=b-primary id=show>Show my Seeds</button>
 <span class=who id=who></span>
</div>
<div class=gate id=gate>Not connected — showing the full seed collection. Your owned counts appear once you connect.</div>
<div class=grid>${cat.map(seedCard).join('')}</div>
<footer>Seed NFTs mint through MELEK-Engine. Grow them at <a href="${esc(GROW_URL)}">🌿 Kush Farm</a> · farm the tokens at <a href="${esc(FARM_URL)}">🌾 KULA Farm</a>. Non-custodial — your keys never leave your device. <a href="/api/seeds">api</a></footer>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const who=document.getElementById('who'),gate=document.getElementById('gate'),acct=document.getElementById('acct');
function fill(rows){const have=new Map((rows||[]).map(r=>[String(r.symbol).toUpperCase(),r]));let any=false;
 for(const card of document.querySelectorAll('.nft')){const s=card.dataset.symbol;const r=have.get(s);
  const c=card.querySelector('.count');
  if(r&&Number(r.owned)>0){any=true;c.textContent=r.owned;card.classList.add('owned');card.classList.remove('dim');}
  else{c.textContent='0';card.classList.remove('owned');card.classList.add('dim');}}
 gate.textContent=any?'':'No seed NFTs in this wallet yet — grow some at the Kush Farm.';}
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
      const holdings = await engineHoldings(account);
      return json(res, 200, { ok: true, account, collection: SEED_COLLECTION, seeds: ownedSeeds(holdings) });
    }
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`Seeds wallet on http://${HOST}:${PORT} — engine ${ENGINE_API}`));
}
