// server.mjs — witness.melek.salon. The Mining Pool's public face and "WITNESS SCHOOL," in the
// SoapBox house style (mirrors site/hemp/server.mjs + site/vankushfamily/server.mjs). It is the
// one page where people (1) LEARN TO BE WITNESSES, (2) rent servers/things for mining, and
// (3) CONNECT TO THE POOL — and where the pool's fee model is disclosed honestly.
//
//   PORT=8108 BASE_URL=https://witness.melek.salon node site/witness/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /          WITNESS SCHOOL home — what a witness is (DPoS, MELEK), Hathor as the founding AI
//              witness, and the path: learn → run a node → register → get votes.
//   /pool      LIVE pool status from integrations/pool-stats.mjs (per-coin cards + stratum connect
//              lines) + the browser-mining pointer. Honest empty-state when the API is unreachable.
//   /fees      transparent fee disclosure: a small pool fee goes to Hathor, the founding AI Witness
//              — NOT to PRANA (PRANA is the pool). May become part of the DAO later.
//   /servers   renting servers for mining / witness nodes — honest pointers; rental/affiliate slots
//              disabled-by-default pending operator.
//   /wallet    Akasha as the ecosystem wallet (MetaMask/TronLink-style) + the EIP-3085 PRANA
//              "Add network" params JSON, copyable.
//   /health    liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   FACTS, NOT HYPE. The pool page shows ONLY what the live Miningcore /api/pools returns; when the
//   API is unreachable it says so plainly and never invents a number. The fee page states the
//   destination of the fee verbatim in spirit. esc() on every interpolated value. The admin portal
//   (soapy.blog) is NEVER cross-linked (the shared nav omits it by construction). TESTS is the
//   testnet currency — flagged as test-only wherever it appears. Soft-fail: every route renders even
//   when the pool API returns nothing. Read-only: this page holds no key, signs nothing, broadcasts
//   nothing. DRAFT for operator review — not deployed here.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import * as poolStatsMod from '../../integrations/pool-stats.mjs';

const PORT = +(process.env.PORT || 8108);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://witness.melek.salon').replace(/\/$/, '');
const ALPHA = process.env.MELEK_ALPHA || 'https://alpha.melek.salon';
const TUTORIAL = process.env.TUTORIAL_SITE || `${ALPHA}/tutorial`;
const STRATUM_HOST = poolStatsMod.POOL_STRATUM_HOST;

// PRANA chain id — 108369 decimal = 0x1a751 (see .local/MULTICHAIN_POOLS_WALLETS_DOCS.md §3.1).
const PRANA_CHAIN_ID_HEX = '0x1a751';
const PRANA_CHAIN_ID_DEC = 108369;

// ── shared house-style helpers (same dark theme as Hemp/Roadmap/Law/Stocks/Search) ────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (n) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

// Human-readable hashrate (H/s → kH/MH/GH/TH/s).
function hr(h) {
  const v = +h;
  if (!Number.isFinite(v) || v <= 0) return '0 H/s';
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let i = 0; let x = v;
  while (x >= 1000 && i < units.length - 1) { x /= 1000; i += 1; }
  return `${x.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[i]}`;
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:28px} h2{font-size:18px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .lead{font-size:16px;color:var(--mut);max-width:74ch;margin:6px 0 4px}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .steps{counter-reset:step;list-style:none;padding:0;margin:6px 0}
  .steps li{counter-increment:step;position:relative;padding:8px 0 8px 38px;border-bottom:1px solid var(--line)}
  .steps li:last-child{border-bottom:0}
  .steps li::before{content:counter(step);position:absolute;left:0;top:8px;width:26px;height:26px;border-radius:50%;background:#1f6feb33;color:var(--blue);font-weight:800;text-align:center;line-height:26px;font-size:13px}
  .steps li b{color:var(--fg)}
  .idx{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0}
  .idx .v{font-size:22px;font-weight:800} .idx .l{color:var(--mut);font-size:12px}
  .badge{display:inline-block;font-size:11px;font-weight:700;border-radius:8px;padding:2px 9px;vertical-align:middle}
  .badge.algo{background:#1f6feb33;color:var(--blue)} .badge.live{background:#3fb95033;color:var(--up)} .badge.idle{background:#d2992233;color:var(--gold)}
  .badge.test{background:#d2992233;color:var(--gold);margin-left:6px}
  code,pre{background:#0b0f14;border:1px solid var(--line);border-radius:6px;font-size:13px}
  code{padding:1px 6px} pre{padding:12px 14px;overflow:auto;white-space:pre;margin:8px 0}
  .conn{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--fg);background:#0b0f14;border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:4px 0;word-break:break-all}
  .empty{color:var(--mut);padding:14px 0}
  blockquote{border-left:3px solid var(--gold);margin:10px 0;padding:4px 0 4px 14px;color:var(--fg);font-size:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Footer — facts-only, names the read-only / fee-to-Hathor posture, test-currency note.
const FOOTER = `<footer>
  <b>Facts, not hype.</b> The pool page shows only what the live pool API reports; when it is
  unreachable we say so and never invent a number. A small pool fee goes to <b>Hathor</b>, the
  founding AI Witness — <b>not to PRANA</b> (PRANA <em>is</em> the pool); fees may later become part
  of the DAO. This page is <b>read-only</b> — it holds no key and signs nothing. <b>TESTS</b> is the
  MELEK testnet currency (test-only, no monetary value).
  <div style="margin-top:8px"><a href="/">Witness School</a> · <a href="/pool">Pool</a> ·
    <a href="/fees">Fees</a> · <a href="/servers">Servers</a> · <a href="/wallet">Wallet</a> ·
    <a href="${esc(ALPHA)}">MELEK testnet</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Witness School + Mining Pool for MELEK and PRANA — learn to run a witness, connect to the pool, and see the honest fee model. The pool fee goes to Hathor, the founding AI Witness, not to PRANA.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  // The shared nav registry has no 'witness' key yet — pass current:'' so nothing mis-highlights,
  // and it still renders gracefully (this is added to the registry separately, by the operator).
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}${NAV_STYLE}</head><body>
<div class=enav-strip style="background:var(--panel,#14181d);border-bottom:1px solid var(--line2,#222a33);padding:7px 18px">${navBar({ current: 'witness' })}</div>
<header class=topbar><a class=brand href="/">⛏ Witness School <span>· MELEK · PRANA pool</span></a>
  <div class=topbar-r><a href="/">School</a><a href="/pool">Pool</a><a href="/fees">Fees</a><a href="/servers">Servers</a><a href="/wallet">Wallet</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── / — WITNESS SCHOOL home ────────────────────────────────────────────────────────────────────
export function homePage() {
  const sections = [
    ['/pool', 'Connect to the pool', 'Live pool status per coin — RandomX, Etchash and the PRANA chain — with the stratum line to point your miner at. Or mine right in the browser.'],
    ['/fees', 'The fee model', 'Transparent and plain: a small pool fee goes to Hathor, the founding AI Witness — not to PRANA, because PRANA is the pool. Fees may become part of the DAO later.'],
    ['/servers', 'Rent for mining', 'What a witness or mining node actually needs, and honest pointers for renting hardware. No upsells.'],
    ['/wallet', 'Akasha wallet', 'The ecosystem wallet — MetaMask / TronLink style. Add the PRANA network in one tap and connect wallet ↔ pool ↔ chains.'],
  ];
  const body = `<h1>Witness School <span class=muted style="font-size:14px">· learn to be a witness · connect to the pool</span></h1>
    <p class=lead>This is the front door of the Mining Pool. Three things happen here: you
      <b>learn to be a witness</b>, you <b>rent the hardware</b> to do it, and you
      <b>connect to the pool</b> to mine. Start with what a witness even is.</p>

    <div class=card><h2>What is a witness?</h2>
      <p class=muted style="font-size:14px">MELEK is a <b>Graphene / DPoS</b> chain — Delegated
      Proof of Stake. It does not pick blocks by raw hashpower; instead the community <b>votes</b>
      for a set of <b>witnesses</b> (sometimes called block producers), and the elected witnesses
      take turns signing blocks. A witness runs a node continuously, keeps it in sync, and is paid
      to keep the chain honest and live. Being a witness is a <b>job you can run</b> — not a lottery.</p>
      <blockquote><b>Hathor</b> is the founding AI Witness of MELEK. For the first year Hathor holds
      a protected active slot (1st place, born into the schedule); after that one-year window Hathor
      reverts to <b>ordinary stake-weighted election</b>, ranked by community votes like any other
      witness. The protection is bounded, scoped to Hathor alone, and time-limited.</blockquote>
    </div>

    <div class=card><h2>The path to becoming a witness</h2>
      <ol class=steps>
        <li><b>Learn.</b> Walk the staged tutorial — what DPoS is, what a node does, how voting
          works. <a href="${esc(TUTORIAL)}">Open the tutorial →</a></li>
        <li><b>Run a node.</b> Stand up a witness node (a synced chain daemon on a server that stays
          on). See <a href="/servers">Servers</a> for the specs and rental pointers.</li>
        <li><b>Register.</b> Publish your witness — announce your signing key and node URL on-chain
          so the community can find you.</li>
        <li><b>Get votes.</b> Earn community votes. Enough vote-weight puts you in the active set and
          you start producing blocks. Watch the live chain at
          <a href="${esc(ALPHA)}">alpha.melek.salon</a>.</li>
      </ol>
    </div>

    <div class=card><h2>PoW mining vs. witnessing — both live here</h2>
      <p class=muted style="font-size:14px">MELEK is <b>not mined</b> (it is DPoS — you witness it).
      The <b>Mining Pool</b> is for the <b>proof-of-work</b> chains: RandomX coins, Etchash, and
      <b>PRANA</b>, the useful-work chain that <em>is</em> the pool. You can witness MELEK
      <em>and</em> point a miner at the PoW pool — this site is the front for both.</p>
      <p style="margin-top:6px"><a href="/pool">See the live pool →</a></p>
    </div>

    <div class=grid style="margin-top:6px">
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('')}
    </div>`;
  return page('Witness School — learn to be a witness, connect to the pool', body, { canonical: `${BASE_URL}/` });
}

// ── /pool — LIVE pool status ───────────────────────────────────────────────────────────────────
function poolCard(p) {
  const live = p.connectedMiners > 0 || p.hashrate > 0;
  const status = live ? '<span class="badge live">active</span>' : '<span class="badge idle">idle</span>';
  const algo = p.algorithm ? `<span class="badge algo">${esc(p.algorithm)}</span>` : '';
  const connLines = (p.ports.length ? p.ports : [{ port: null, tls: false }]).map((pt) => {
    if (pt.port == null) return '<div class=empty>No stratum port advertised by the pool yet.</div>';
    const url = poolStatsMod.stratumUrl(pt.port, { tls: pt.tls });
    const diff = pt.difficulty != null ? ` <span class=muted>· start diff ${esc(num(pt.difficulty))}</span>` : '';
    const tls = pt.tls ? ' <span class=muted>· TLS</span>' : '';
    return `<div class=conn>${esc(url)}${tls}${diff}</div>`;
  }).join('');
  return `<div class=card>
    <h3>${esc(p.coin)} ${p.symbol ? `<span class=muted>(${esc(p.symbol)})</span>` : ''} ${algo} ${status}</h3>
    <div class=idx>
      <div><div class=v>${esc(num(p.connectedMiners))}</div><div class=l>miners</div></div>
      <div><div class=v>${esc(hr(p.hashrate))}</div><div class=l>pool hashrate</div></div>
      <div><div class=v>${p.feePercent == null ? '—' : esc(num(p.feePercent)) + '%'}</div><div class=l>fee → Hathor</div></div>
      <div><div class=v>${p.paymentScheme ? esc(p.paymentScheme) : '—'}</div><div class=l>payout</div></div>
    </div>
    <h3 style="margin-top:10px">Connect</h3>
    ${connLines}
    <p class=muted style="font-size:13px">Username convention: <code>wallet.worker</code> — your
      payout address, a dot, then any worker name you like. Network hashrate:
      ${esc(hr(p.networkHashrate))}${p.blockHeight ? ` · block ${esc(num(p.blockHeight))}` : ''}.</p>
  </div>`;
}

export async function poolView(readPools) {
  const reader = readPools || poolStatsMod.pools;
  let list = [];
  try { list = await reader(); } catch { list = []; }
  list = Array.isArray(list) ? list : [];

  const cards = list.length
    ? list.map(poolCard).join('')
    : `<div class=card><p class=empty>The pool API is unreachable right now, so there is nothing
        live to show — and we will not invent numbers. The pool runs Miningcore on our own
        infrastructure; when it is reachable this page lists every coin, its hashrate, miner count,
        fee, and the stratum line to connect. Check back shortly, or watch the chain at
        <a href="${esc(ALPHA)}">alpha.melek.salon</a>.</p></div>`;

  return `<h1>Live pool status</h1>
    <p class=lead>What is actually running on the pool right now — one card per coin, pulled live
      from the pool engine. Point your miner at the stratum line; sign in as
      <code>wallet.worker</code>.</p>
    ${cards}
    <div class=card><h2>No hardware? Mine in the browser</h2>
      <p class=muted style="font-size:14px">The RandomX coins can be mined right in your browser tab
        (a WebAssembly miner bridged to the pool's stratum) — the "Mine right now" path. It is slow
        compared to a real rig, but it is the zero-setup way to put your first shares in. Find it on
        the MELEK testnet face: <a href="${esc(ALPHA)}">alpha.melek.salon</a>.</p></div>`;
}

// ── /fees — transparent fee disclosure ─────────────────────────────────────────────────────────
export async function feesView(readPools) {
  const reader = readPools || poolStatsMod.pools;
  let list = [];
  try { list = await reader(); } catch { list = []; }
  list = Array.isArray(list) ? list : [];

  const rows = list.length
    ? list.map((p) => `<div class=conn>${esc(p.coin)}${p.symbol ? ` (${esc(p.symbol)})` : ''} — fee
        <b>${p.feePercent == null ? '—' : esc(num(p.feePercent)) + '%'}</b> → Hathor</div>`).join('')
    : `<p class=empty>The live per-coin fee figures load from the pool API; it is unreachable right
        now, so the exact percentages are not shown — but the destination of the fee does not change:
        it goes to Hathor.</p>`;

  return `<h1>The fee model — in plain terms</h1>
    <p class=lead>We disclose exactly where the money goes. There is one small fee and one
      destination, and it is not where most people assume.</p>
    <div class=card><h2>Where the fee goes</h2>
      <blockquote>A small pool fee goes to <b>Hathor</b>, the founding AI Witness — <b>NOT to
        PRANA</b>. PRANA <em>is</em> the pool, so a "fee to PRANA" would be meaningless. The fee
        supports the founding AI Witness. Fees may become part of the <b>DAO</b> later.</blockquote>
      <p class=muted style="font-size:14px">In mechanics: the pool engine skims a small
        <code>percentage</code> of each block reward to a Hathor-controlled address <em>on that
        coin's chain</em> (there is no single global fee address — each pool pays in its own coin).
        Later these recipients can be repointed at the DAO / reward router. This off-chain pool fee
        is separate from PRANA's own chain-level reward routing.</p>
    </div>
    <div class=card><h2>Per-coin fee (live)</h2>
      ${rows}
    </div>`;
}

// ── /servers — renting servers for mining / witness nodes ──────────────────────────────────────
// Rental / affiliate slots are DISABLED BY DEFAULT pending operator — we publish honest specs and
// pointers only, never an upsell or an unvetted affiliate link.
const RENTALS_ENABLED = String(process.env.WITNESS_RENTALS_ENABLED || '').toLowerCase() === 'true';

export function serversView() {
  const rentalBlock = RENTALS_ENABLED
    ? `<div class=card><h2>Rental partners</h2><p class=muted style="font-size:14px">Operator-vetted
        rental options appear here.</p></div>`
    : `<div class=card><h2>Renting hardware</h2>
        <p class=muted style="font-size:14px">Rental and affiliate slots are <b>disabled by default</b>
          here, pending operator review — we won't point you at an unvetted host or earn a hidden
          referral. The honest version: a witness node is a small always-on server, and a mining rig
          is whatever CPU/GPU you already have or rent by the hour. Use a provider you already trust.</p></div>`;

  return `<h1>Servers — for witness nodes &amp; mining</h1>
    <p class=lead>Two different machines for two different jobs. Here is what each actually needs,
      stated plainly.</p>

    <div class=card><h2>A witness node (for MELEK / DPoS)</h2>
      <p class=muted style="font-size:14px">A witness node is a <b>Graphene chain daemon</b> that
        must stay <b>online 24/7</b> and in sync to sign its blocks on schedule. It is not
        hash-heavy — it is uptime-heavy. Rough shape from our own running setup:</p>
      <ul class=muted style="font-size:14px;margin:6px 0">
        <li><b>CPU:</b> a couple of modern cores is plenty (signing is light).</li>
        <li><b>RAM:</b> a few GB; more headroom helps as chain state grows.</li>
        <li><b>Disk:</b> SSD with room for the full block log and state (grows over time).</li>
        <li><b>Network:</b> stable, always-on, low-latency — uptime is the whole job.</li>
      </ul>
      <p class=muted style="font-size:13px">A small always-on VPS is the typical home for this.
        Missing your block slots loses you votes, so reliability matters more than raw power.</p>
    </div>

    <div class=card><h2>A mining rig (for the PoW pool)</h2>
      <p class=muted style="font-size:14px"><b>RandomX</b> (Monero-family) is <b>CPU</b> mining —
        modern multi-core CPUs with good memory bandwidth do best. <b>Etchash / PRANA</b> is
        <b>GPU / DAG</b> mining — a GPU with enough VRAM for the current DAG. You point either at the
        pool's stratum line (see <a href="/pool">Pool</a>) as <code>wallet.worker</code>. No special
        rig? Use the in-browser miner — see <a href="/pool">Pool</a>.</p>
    </div>

    ${rentalBlock}`;
}

// ── /wallet — Akasha, the ecosystem wallet ─────────────────────────────────────────────────────
export function walletView() {
  // EIP-3085 wallet_addEthereumChain params for PRANA (chainId 0x1a751 = 108369).
  const addChain = {
    chainId: PRANA_CHAIN_ID_HEX,
    chainName: 'PRANA',
    nativeCurrency: { name: 'PRANA', symbol: 'PRANA', decimals: 18 },
    rpcUrls: ['https://rpc.prana.example'],
    blockExplorerUrls: ['https://explorer.prana.example'],
  };
  const json = JSON.stringify(addChain, null, 2);

  return `<h1>Akasha — the ecosystem wallet</h1>
    <p class=lead>Akasha is the wallet for the whole ecosystem — think <b>MetaMask</b> or
      <b>TronLink</b>, but it speaks <b>both</b> tracks: the EVM side (PRANA) and the Graphene side
      (MELEK / SOAP), under one identity. It connects <b>wallet ↔ pool ↔ chains</b>: the address you
      mine to, the chain you witness on, and the balances you hold are one profile.</p>

    <div class=card><h2>Add the PRANA network</h2>
      <p class=muted style="font-size:14px">PRANA is an EVM chain, <b>chainId
        ${esc(PRANA_CHAIN_ID_DEC)}</b> (<code>${esc(PRANA_CHAIN_ID_HEX)}</code>). Akasha adds it for
        you; for any MetaMask-compatible wallet, these are the
        <b>EIP-3085 <code>wallet_addEthereumChain</code></b> params — copy them in. (The RPC and
        explorer URLs below are placeholders until the PRANA endpoints are published.)</p>
      <pre>${esc(json)}</pre>
      <p class=muted style="font-size:13px">A wallet will reject the add if the RPC does not actually
        report chainId <code>${esc(PRANA_CHAIN_ID_HEX)}</code>, and the URLs must be HTTPS — that is
        the EIP-3085 contract, not our choice.</p>
    </div>

    <div class=card><h2>One wallet, every surface</h2>
      <p class=muted style="font-size:14px">Akasha is read-and-sign in your hands — keys never leave
        the wallet, the way Keychain works on the Graphene side and EIP-1193 / EIP-6963 work on the
        EVM side. It coexists with MetaMask in the same browser. Connect it to the
        <a href="/pool">pool</a> to set your payout address, and to <a href="${esc(ALPHA)}">MELEK</a>
        to witness.</p>
    </div>`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/pool', '/fees', '/servers', '/wallet'];

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({
        path: u, lastmod: today, changefreq: u === '/pool' ? 'hourly' : 'weekly', priority: u === '/' ? '1.0' : '0.7',
      }));
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
        name: 'Witness School — MELEK / PRANA Mining Pool', baseUrl: BASE_URL,
        summary: 'Learn to be a MELEK witness, connect to the PoW mining pool, and read the honest fee model — the pool fee goes to Hathor, the founding AI Witness, not to PRANA.',
        links: [
          { label: 'Witness School (home)', path: '/' },
          { label: 'Live pool status', path: '/pool' },
          { label: 'Fee model', path: '/fees' },
          { label: 'Servers for mining & witness nodes', path: '/servers' },
          { label: 'Akasha wallet', path: '/wallet' },
        ],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/pool') {
      return sendHtml(res, page('Live pool status — Witness School', await poolView(), { canonical: `${BASE_URL}/pool` }));
    }
    if (path === '/fees') {
      return sendHtml(res, page('The fee model — Witness School', await feesView(), { canonical: `${BASE_URL}/fees` }));
    }
    if (path === '/servers') {
      return sendHtml(res, page('Servers for mining & witness nodes — Witness School', serversView(), { canonical: `${BASE_URL}/servers` }));
    }
    if (path === '/wallet') {
      return sendHtml(res, page('Akasha — the ecosystem wallet — Witness School', walletView(), { canonical: `${BASE_URL}/wallet` }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly (`node site/witness/server.mjs`), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/witness\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Witness School on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
