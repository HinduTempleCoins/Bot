// server.mjs — Profile / Portfolio front-door (v1) for the SoapBox Tools hub. A friendly, read-only
// "your coins" page in the SoapBox house style (mirrors site/diagram/server.mjs). It is a genuinely
// useful, standalone portfolio tracker: bookmark coins to a watchlist, paste any MELEK (Graphene)
// account or EVM 0x address to see its live balance, and optionally Connect an EVM wallet READ-ONLY
// to show its address + balance. It is a CMC-style bookmark list that reads REAL balances — NOT a
// wallet.
//
//   PORT=8210 BASE_URL=https://profile.soapbox.community node site/profile/server.mjs
//   → serves the profile at  /
//
// ── HARD BOUNDARY (read this first) ────────────────────────────────────────────────────────────────
//   This page holds NO private keys. It signs NOTHING. It NEVER asks for a seed, WIF, mnemonic, or
//   any secret. Every balance/RPC call is CLIENT-SIDE (the browser talks to the chain RPCs directly);
//   the SERVER makes ZERO network calls at request time — it only emits static HTML. Watchlist +
//   watched addresses live in the visitor's own localStorage (try/catch guarded), never on our server.
//   "Connect wallet" uses the injected window.ethereum directly (no library, no npm) and only READS
//   accounts + balance — it requests no signature. The §2a native self-custody wallet (one seed →
//   all chains) is the PARKED deep-end, not this file.
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   A portfolio tool is openly about coins, so coins are fine here — but there is NO token-shilling,
//   no "buy"/"moon"/pump copy, no up-front crypto pitch beyond the tool's own obvious purpose. MELEK
//   appears only as an understated, OPTIONAL "save your profile across devices — free MELEK account"
//   unlock (like the diagram maker). The tracker works fully without ever touching an account.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the single-page profile (watchlist + watched addresses + connect + rollup)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL; pasted addresses
//   are classified against strict allowlists (EVM ^0x[0-9a-fA-F]{40}$, MELEK a safe Graphene charset)
//   and esc()'d wherever echoed. Soft-fail: every route renders even with no data — unknown path →
//   404, never a 500. No PII intake, no network at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8210);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Profile';
// The opt-in unlock links the ordinary free-account signup flow (env-overridable). No wallet/token here.
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── Chain RPC endpoints (CLIENT-SIDE only — the browser calls these, the server never does) ─────────
// Public defaults, all env-overridable. MELEK_RPC is the confirmed public MELEK (Graphene) endpoint
// used across the repo's readers (integrations/*). PRANA_RPC defaults to the public PRANA EVM RPC.
// EVM_RPCS is a comma-separated list the client tries in order for 0x balances; it defaults to the
// PRANA RPC so a 0x address resolves out of the box. If an operator has no MELEK RPC, they can set
// MELEK_RPC='' and the page shows a graceful "add your RPC" note instead of inventing a hostname.
const MELEK_RPC = (process.env.MELEK_RPC == null ? 'https://melek.salon/rpc' : process.env.MELEK_RPC).trim();
const PRANA_RPC = (process.env.PRANA_RPC || 'https://rpc.prana.alpha.melek.salon').trim();
const EVM_RPCS = (process.env.EVM_RPCS || PRANA_RPC)
  .split(',').map((s) => s.trim()).filter(Boolean);

// ── Tools-hub path awareness (mundane-app-suite-stealth-funnel) ────────────────
// This app runs as its own process behind a path-routing proxy at tools.soapbox.community/<app>.
// The proxy STRIPS the prefix inbound (our routes stay on '/', '/health', …); we PREPEND it to every
// self-URL we EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The Tools hub sits at the domain root (default '/'); sibling links point at the hub, not this app.
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const SLUG = 'profile';
const HUB_SIBLINGS = [['/diagram', 'Diagram'], ['/calculator', 'Calculator'], ['/notes', 'Notes'], ['/move', 'Move'], ['/profile', 'Profile']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + HUB_SIBLINGS.filter(([p]) => p !== '/' + SLUG).slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${l}</a>`).join('');

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── address validation (strict allowlists) ──────────────────────────────────────────────────────────
// An EVM account is exactly 0x + 40 hex. A MELEK/Graphene account name is a safe lowercase charset
// (letters, digits, dot, dash), 2–16 chars — matching the chain's account-name rules closely enough
// to reject junk. Anything else classifies as null (rejected). These are used both server-side (to
// validate an echoed ?addr= param) and mirrored in the client.
export const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
export const MELEK_RE = /^[a-z][a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?(?:\.[a-z][a-z0-9-]{0,14}[a-z0-9])*$/;
export function classifyAddress(s) {
  const v = String(s == null ? '' : s).trim();
  if (EVM_RE.test(v)) return 'evm';
  if (v.length >= 3 && v.length <= 16 && MELEK_RE.test(v)) return 'melek';
  return null;
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .hublink{font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a,.topbar-r button{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel);cursor:pointer}
  .topbar-r a:hover,.topbar-r button:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:1080px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .muted{color:var(--mut)} .up{color:var(--up)} .down{color:var(--down)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media (max-width:820px){.cols{grid-template-columns:1fr}}
  .card{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:16px 18px;margin:0 0 16px}
  .card h2{margin:0 0 4px;font-size:17px} .card .hint{color:var(--mut);font-size:13px;margin:0 0 12px}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  input[type=text]{flex:1;min-width:0;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
  input[type=text]:focus{outline:none;border-color:var(--blue)}
  .btn{border:1px solid var(--line2);border-radius:8px;padding:9px 15px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer;white-space:nowrap}
  .btn:hover{border-color:var(--blue);color:var(--blue)}
  .btn.gold{border-color:var(--gold);color:var(--gold)} .btn.gold:hover{background:var(--gold);color:#0d1117}
  ul.list{list-style:none;margin:10px 0 0;padding:0}
  ul.list li{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:7px;background:#0b0f14}
  ul.list li .sym{font-weight:700} ul.list li .meta{color:var(--mut);font-size:12px;font-family:ui-monospace,monospace;word-break:break-all}
  ul.list li .bal{margin-left:auto;font-weight:700;font-family:ui-monospace,monospace;text-align:right;white-space:nowrap}
  ul.list li .x{margin-left:6px;border:1px solid var(--line2);border-radius:6px;background:var(--panel);color:var(--mut);cursor:pointer;font-size:12px;padding:2px 8px}
  ul.list li .x:hover{border-color:var(--down);color:var(--down)}
  .empty{color:var(--mut);font-size:13px;padding:8px 2px}
  .note{font-size:13px;color:var(--mut);margin-top:8px}
  .note.warn{color:var(--gold)}
  .rollup{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:16px 18px;margin:0 0 16px}
  .rollup h2{margin:0 0 10px;font-size:17px}
  .save-cta{margin:6px 0 16px}
  .panel{display:none;border:1px solid var(--gold);background:#d2992211;border-radius:10px;padding:16px 18px;margin:12px 0;color:var(--fg)}
  .panel.on{display:block}
  .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px;color:var(--fg)}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:8px;padding:8px 15px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#0d1117;text-decoration:none}
  .safe{border:1px solid var(--line);border-radius:10px;padding:11px 14px;margin:0 0 16px;color:var(--mut);font-size:13px;background:#0b0f14}
  .safe b{color:var(--fg)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a free, private portfolio tracker. Your watchlist and watched addresses stay
  in your own browser; balances are read live from public chain endpoints by your browser, not our server.
  This page holds no keys and signs nothing.
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'A free portfolio tracker: bookmark coins to a watchlist and paste any MELEK or EVM address to see its live balance. Read-only, runs in your browser, no account and no keys required.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">🪙 SoapBox <span>Profile</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<button type=button id=nav-save>☁ Save profile</button></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the profile page ─────────────────────────────────────────────────────────────────────────────
// `addr` (optional) pre-fills the watch-address box. It is user-controlled and possibly hostile → it
// is classified against the strict allowlists and only ever emitted through esc().
export function profilePage({ addr } = {}) {
  const rawAddr = addr ? String(addr) : '';
  const kind = classifyAddress(rawAddr);          // 'evm' | 'melek' | null
  // Echo the requested address back (escaped) as a subtle prefill note; junk is flagged, never trusted.
  const prefillNote = rawAddr
    ? (kind
      ? `<div class=note>Prefilled ${esc(kind === 'evm' ? 'EVM' : 'MELEK')} address: <b>${esc(rawAddr)}</b></div>`
      : `<div class="note warn">That address didn't look like a MELEK name or a 0x address — ignored: <b>${esc(rawAddr)}</b></div>`)
    : '';
  // Only a validated address is safe to seed the client input value.
  const seedAddr = kind ? esc(rawAddr) : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any (web browser)',
    description: 'Free read-only crypto portfolio tracker: watchlist plus live balances for pasted MELEK and EVM addresses. Runs entirely in the browser; holds no keys.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  // Config handed to the client (endpoints only — no secrets). melekRpc may be '' → graceful fallback.
  const cfg = {
    melekRpc: MELEK_RPC,
    pranaRpc: PRANA_RPC,
    evmRpcs: EVM_RPCS,
    basePath: BASE_PATH,
  };

  const body = `
<h1>Your coins, in one place</h1>
<p class=sub>Bookmark coins to a watchlist and paste any MELEK or EVM address to see its live balance across MELEK &amp; PRANA. Read-only — nothing to install, no account needed.</p>

<div class=safe>
  <b>Read-only &amp; private.</b> This page never holds your keys, never signs anything, and never asks
  you for anything secret. Balances are read by <b>your browser</b> straight from the public chain
  endpoints; your watchlist stays in this browser only.
</div>

<div class=cols>
  <div class=card>
    <h2>Watchlist</h2>
    <p class=hint>Bookmark any coin or symbol to keep an eye on — own it or not.</p>
    <div class=row>
      <input type=text id=coin-in placeholder="e.g. MELEK, PRANA, BTC" maxlength=24 aria-label="Coin symbol to watch">
      <button type=button class=btn id=coin-add>Add</button>
    </div>
    <ul class=list id=coin-list></ul>
    <div class=empty id=coin-empty>No coins bookmarked yet.</div>
  </div>

  <div class=card>
    <h2>Watched addresses</h2>
    <p class=hint>Paste a MELEK account name or an EVM <code>0x…</code> address to track its live balance. No keys — watch only.</p>
    <div class=row>
      <input type=text id=addr-in placeholder="hathor  ·  0x1234…abcd" maxlength=64 aria-label="MELEK account or EVM address to watch" value="${seedAddr}">
      <button type=button class=btn id=addr-add>Watch</button>
    </div>
    ${prefillNote}
    <div class=note id=addr-err></div>
    <ul class=list id=addr-list></ul>
    <div class=empty id=addr-empty>No addresses watched yet.</div>
  </div>
</div>

<div class=rollup>
  <h2>Connect a wallet (read-only)</h2>
  <p class=hint>Connect an injected browser wallet to read its address and balance. This only <b>reads</b> — it requests no signature and moves nothing.</p>
  <div class=row>
    <button type=button class=btn id=connect-btn>Connect wallet</button>
    <span class=note id=connect-status></span>
  </div>
  <div class=note id=connect-none style="display:none">No browser wallet detected — install one, or just paste an address above to watch it.</div>
</div>

<div class=rollup>
  <h2>Your coins across MELEK + PRANA</h2>
  <ul class=list id=rollup-list></ul>
  <div class=empty id=rollup-empty>Watch an address or connect a wallet to see balances roll up here.</div>
</div>

<div class=save-cta><button type=button class="btn gold" id=save-btn>☁ Save your profile across devices</button></div>

<div class=panel id=save-panel role=note>
  <h3>Keep your profile — across every device</h3>
  <p>This tracker is fully free and works right here in your browser, no account needed. To <b>save your
    watchlist and watched addresses</b> and carry the same profile across your devices, create a
    free MELEK account — it takes a minute and there's nothing to install.</p>
  <p class=muted>Prefer to stay local? Everything already works without an account; your list simply lives
    in this browser.</p>
  <a class=cta href="${esc(safeHref(SIGNUP_URL) || '/')}" target=_blank rel="noopener">Create a free account</a>
</div>

<script>
(function(){
  var CFG = ${JSON.stringify(cfg)};
  var EVM_RE = /^0x[0-9a-fA-F]{40}$/;
  var MELEK_RE = /^[a-z][a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?(?:\\.[a-z][a-z0-9-]{0,14}[a-z0-9])*$/;
  function classify(s){
    var v = String(s==null?'':s).trim();
    if (EVM_RE.test(v)) return 'evm';
    if (v.length>=3 && v.length<=16 && MELEK_RE.test(v)) return 'melek';
    return null;
  }
  function el(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  // ── localStorage (try/catch guarded — a private window or blocked storage must not break the page) ──
  var LS = { coins:'sbx.profile.coins', addrs:'sbx.profile.addrs' };
  function load(key){ try{ var s=localStorage.getItem(key); return s?JSON.parse(s):[]; }catch(e){ return []; } }
  function save(key,val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

  var coins = load(LS.coins);        // ["MELEK", ...]
  var addrs = load(LS.addrs);        // [{addr, kind}]
  var balances = {};                 // addr -> {sym, amount, err}

  // ── Watchlist ──
  function renderCoins(){
    var ul = el('coin-list'); ul.innerHTML='';
    el('coin-empty').style.display = coins.length ? 'none' : '';
    coins.forEach(function(sym){
      var li=document.createElement('li');
      li.innerHTML='<span class=sym>'+esc(sym)+'</span><button type=button class=x aria-label="Remove">✕</button>';
      li.querySelector('.x').addEventListener('click', function(){ coins=coins.filter(function(c){return c!==sym;}); save(LS.coins,coins); renderCoins(); });
      ul.appendChild(li);
    });
  }
  function addCoin(){
    var v=(el('coin-in').value||'').trim().toUpperCase().replace(/[^A-Z0-9.\\-]/g,'').slice(0,24);
    if(!v) return;
    if(coins.indexOf(v)===-1){ coins.push(v); save(LS.coins,coins); renderCoins(); }
    el('coin-in').value='';
  }
  el('coin-add').addEventListener('click', addCoin);
  el('coin-in').addEventListener('keydown', function(e){ if(e.key==='Enter') addCoin(); });

  // ── Watched addresses ──
  function renderAddrs(){
    var ul=el('addr-list'); ul.innerHTML='';
    el('addr-empty').style.display = addrs.length ? 'none' : '';
    addrs.forEach(function(a){
      var b = balances[a.addr] || {};
      var bal = b.err ? '<span class=down title="'+esc(b.err)+'">unavailable</span>'
                      : (b.amount==null ? '<span class=muted>…</span>' : esc(b.amount)+' '+esc(b.sym||''));
      var li=document.createElement('li');
      li.innerHTML='<span class=sym>'+esc(a.kind==='evm'?'EVM':'MELEK')+'</span>'
        +'<span class=meta>'+esc(a.addr)+'</span>'
        +'<span class=bal>'+bal+'</span>'
        +'<button type=button class=x aria-label="Remove">✕</button>';
      li.querySelector('.x').addEventListener('click', function(){ addrs=addrs.filter(function(x){return x.addr!==a.addr;}); save(LS.addrs,addrs); renderAddrs(); renderRollup(); });
      ul.appendChild(li);
    });
  }
  function addAddr(){
    var raw=(el('addr-in').value||'').trim();
    var kind=classify(raw);
    var err=el('addr-err');
    if(!kind){ err.textContent='Enter a valid MELEK account name or a 0x… EVM address.'; err.className='note warn'; return; }
    err.textContent=''; err.className='note';
    var addr = kind==='evm' ? raw.toLowerCase() : raw.toLowerCase();
    if(!addrs.some(function(x){return x.addr===addr;})){ addrs.push({addr:addr,kind:kind}); save(LS.addrs,addrs); }
    el('addr-in').value='';
    renderAddrs(); fetchBalance(addr,kind).then(function(){ renderAddrs(); renderRollup(); });
  }
  el('addr-add').addEventListener('click', addAddr);
  el('addr-in').addEventListener('keydown', function(e){ if(e.key==='Enter') addAddr(); });

  // ── balance fetch (ALL client-side; soft-fail, never throws to the page) ──
  function jsonRpc(url, method, params){
    return fetch(url, { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ jsonrpc:'2.0', id:1, method:method, params:params }) })
      .then(function(r){ return r.json(); });
  }
  // MELEK/Graphene: condenser_api.get_accounts -> [{ balance: "1.234 MELEK", ... }]
  function fetchMelek(addr){
    if(!CFG.melekRpc){ return Promise.resolve({err:'No MELEK RPC configured — set MELEK_RPC to enable.'}); }
    return jsonRpc(CFG.melekRpc,'condenser_api.get_accounts',[[addr]]).then(function(res){
      var acct = res && res.result && res.result[0];
      if(!acct){ return {err:'account not found'}; }
      var raw = acct.balance || acct.balance_amount || '';
      var parts = String(raw).split(' ');
      return { amount: parts[0]||'0', sym: parts[1]||'MELEK' };
    }).catch(function(){ return {err:'lookup failed'}; });
  }
  // EVM: eth_getBalance -> hex wei; try each configured RPC until one answers.
  function fetchEvm(addr){
    var rpcs = (CFG.evmRpcs||[]).slice();
    function tryNext(i){
      if(i>=rpcs.length){ return Promise.resolve({err:'no EVM RPC reachable'}); }
      return jsonRpc(rpcs[i],'eth_getBalance',[addr,'latest']).then(function(res){
        if(res && res.result){
          var wei = BigInt(res.result);
          var whole = wei / 1000000000000000000n;
          var frac = (wei % 1000000000000000000n).toString().padStart(18,'0').slice(0,4).replace(/0+$/,'');
          return { amount: whole.toString() + (frac?'.'+frac:''), sym:'PRANA' };
        }
        return tryNext(i+1);
      }).catch(function(){ return tryNext(i+1); });
    }
    return tryNext(0);
  }
  function fetchBalance(addr, kind){
    balances[addr] = { amount:null };
    var p = kind==='evm' ? fetchEvm(addr) : fetchMelek(addr);
    return p.then(function(b){ balances[addr]=b; return b; });
  }

  // ── Connect wallet (read-only, injected provider only — NO library, NO signing) ──
  // TODO(later): WalletConnect / multi-wallet picker (RainbowKit/Web3Modal-style) is a documented next
  // step — a standard Connect flow across many wallets. v1 uses only window.ethereum, read-only.
  var connected = null;   // {addr}
  function shortAddr(a){ return a.slice(0,6)+'…'+a.slice(-4); }
  el('connect-btn').addEventListener('click', function(){
    var eth = window.ethereum;
    if(!eth || !eth.request){ el('connect-none').style.display=''; return; }
    el('connect-status').textContent='Connecting…';
    eth.request({ method:'eth_requestAccounts' }).then(function(accs){
      var a = (accs && accs[0]) ? accs[0].toLowerCase() : null;
      if(!a){ el('connect-status').textContent='No account shared.'; return; }
      connected = { addr:a };
      el('connect-status').innerHTML='Connected: <b>'+esc(shortAddr(a))+'</b> (read-only)';
      // add to watched addresses + read its balance, exactly like a pasted address
      if(!addrs.some(function(x){return x.addr===a;})){ addrs.push({addr:a,kind:'evm'}); save(LS.addrs,addrs); }
      renderAddrs();
      fetchBalance(a,'evm').then(function(){ renderAddrs(); renderRollup(); });
    }).catch(function(e){ el('connect-status').textContent = (e && e.message) ? e.message : 'Connection cancelled.'; });
  });
  if(!window.ethereum){ el('connect-none').style.display=''; }

  // ── Rollup: watched/connected balances = "your coins" ──
  function renderRollup(){
    var ul=el('rollup-list'); ul.innerHTML='';
    var any = addrs.length>0;
    el('rollup-empty').style.display = any ? 'none' : '';
    addrs.forEach(function(a){
      var b=balances[a.addr]||{};
      var bal = b.err ? '<span class=down>unavailable</span>'
                      : (b.amount==null ? '<span class=muted>…</span>' : esc(b.amount)+' '+esc(b.sym||''));
      var li=document.createElement('li');
      li.innerHTML='<span class=sym>'+esc(b.sym||(a.kind==='evm'?'PRANA':'MELEK'))+'</span>'
        +'<span class=meta>'+esc(a.addr)+'</span>'
        +'<span class=bal>'+bal+'</span>';
      ul.appendChild(li);
    });
  }

  // ── save-profile unlock (client-side explainer only; the tracker never needs it) ──
  var panel=el('save-panel');
  function toggle(){ panel.classList.toggle('on'); if(panel.classList.contains('on')) panel.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  el('save-btn').addEventListener('click', toggle);
  var navSave=el('nav-save'); if(navSave) navSave.addEventListener('click', toggle);

  // ── initial paint + refresh any stored/prefilled balances ──
  renderCoins(); renderAddrs(); renderRollup();
  addrs.forEach(function(a){ fetchBalance(a.addr,a.kind).then(function(){ renderAddrs(); renderRollup(); }); });
  var seed = ${JSON.stringify(seedAddr)};
  if(seed){ el('addr-in').value = seed; }
})();
</script>`;

  return page('Crypto Portfolio Tracker & Watchlist — SoapBox Profile', body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.6' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Free read-only crypto portfolio tracker: coin watchlist plus live balances for pasted MELEK (Graphene) and EVM addresses across MELEK & PRANA. Runs in the browser, holds no keys. Optional free MELEK account to save your profile across devices.',
        links: [{ label: 'Profile / Portfolio', path: '/' }],
      }));
    }

    if (path === '/') {
      return sendHtml(res, profilePage({ addr: url.searchParams.get('addr') || '' }));
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Profile', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open your profile</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/profile\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Profile on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
