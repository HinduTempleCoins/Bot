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
const POOL_SITE = process.env.POOL_SITE || 'https://pool.soapbox.community';
const STRATUM_HOST = poolStatsMod.POOL_STRATUM_HOST;

// PRANA chain id — 108369 decimal = 0x1a751 (see .local/MULTICHAIN_POOLS_WALLETS_DOCS.md §3.1).
const PRANA_CHAIN_ID_HEX = '0x1a751';
const PRANA_CHAIN_ID_DEC = 108369;

// MELEK testnet RPC for the live /hathor witness-status page (read-only condenser calls).
const MELEK_RPC_URL = process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
let _chainFetch = (...a) => globalThis.fetch(...a);
export function __setChainFetch(fn) { _chainFetch = fn || ((...a) => globalThis.fetch(...a)); }

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
  <div class=topbar-r><a href="/">School</a><a href="/learn">Learn</a><a href="/academy">Academy</a><a href="/run">Run</a><a href="/pool">Pool</a><a href="/fees">Fees</a><a href="/servers">Servers</a><a href="/wallet">Wallet</a><a href="/hathor">Hathor</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── / — WITNESS SCHOOL home ────────────────────────────────────────────────────────────────────
export function homePage() {
  const sections = [
    ['/learn', 'Learn the systems', 'How rewards, curation trails, tokens, the AutoNetwork bots, and the cross-chain Karma system actually work — and how our witnesses give back to the community, not just collect rewards.'],
    ['/academy', 'Token Academy', 'Build your own curation-reward network: a community token, curation and token trails, keyless autovote, and fair rewards to the members who curate — the model, plus the steps to stand one up on MELEK.'],
    ['/run', 'Run a witness — mainnet is live', 'MELEK mainnet fired 7:12 CDT 7/12/2026 (no premine). The full step-by-step: chain id, seed node, build the node, config.ini, register your witness, and get voted into the producing set.'],
    ['/pool', 'Connect to the pool', 'Live pool status per coin — RandomX, Etchash and the PRANA chain — with the stratum line to point your miner at. Or mine right in the browser.'],
    ['/fees', 'The fee model', 'Transparent and plain: a small pool fee goes to Hathor, the founding AI Witness — not to PRANA, because PRANA is the pool. Fees may become part of the DAO later.'],
    ['/servers', 'Rent for mining', 'What a witness or mining node actually needs, and honest pointers for renting hardware. No upsells.'],
    ['/wallet', 'Akasha wallet', 'The ecosystem wallet — MetaMask / TronLink style. Add the PRANA network in one tap and connect wallet ↔ pool ↔ chains.'],
    ['/hathor', 'Hathor, live', 'The founding AI Witness measured in real time — head block, confirmations, missed blocks — the working example of what the school teaches.'],
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
  // Only advertise pools whose daemon is actually reachable (a live network height or hashrate) or
  // that have real activity. A pool with a dead daemon isn't mineable, so we don't show a stale card.
  list = list.filter((p) => p && (p.blockHeight != null || p.networkHashrate > 0 || p.connectedMiners > 0 || p.hashrate > 0));

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
    <div class=card><h2>The pool IS your wallet — no address from anywhere else</h2>
      <p class=muted style="font-size:14px">You never need to go get a wallet address somewhere
        else: the pool <b>creates your account right here</b>. On
        <a href="${esc(POOL_SITE)}/mycoins.html">My Coins</a> you generate your wallet
        <b>in your own browser</b> — Zephyr (ZEPH), Monero (XMR), and one EVM address for the
        ETC/PRANA side — and the address drops straight into your mining setup. The seed is shown
        to you once and <b>never leaves your browser</b>; we cannot see it, store it, or recover
        it — the pool holds <em>no</em> keys, the same custody rule the whole ecosystem runs on.
        Funds leaving your wallet require flipping the <b>spend-lock</b> toggle (locked by
        default); receiving and mining never need it. This wallet is the seed of your
        <a href="/wallet">Akasha</a> identity — one account across the pool and the chains.</p>
      <p style="margin-top:6px"><a class=cta href="${esc(POOL_SITE)}/mycoins.html"
        style="display:inline-block;background:#1f6feb;color:#fff;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:8px">Create your wallet / open My Coins →</a></p>
    </div>
    ${cards}
    <div class=card><h2>Your wallet on the pool</h2>
      <p class=muted style="font-size:14px">This is the <b>Akasha ↔ pool</b> connection in its
        simplest form: paste the wallet address you mine to (the part before the dot in
        <code>wallet.worker</code>) and see your live hashrate, pending balance and payouts —
        read-only, straight from the pool engine.</p>
      <form method=get action="/pool/miner" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <input name=addr placeholder="your payout wallet address" required
          style="flex:1;min-width:240px;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:9px 12px;font:13px ui-monospace,Menlo,monospace">
        <button style="background:#1f6feb;border:0;border-radius:8px;color:#fff;font-weight:700;padding:9px 18px;cursor:pointer">Look up</button>
      </form>
    </div>
    <div class=card><h2>No hardware? Mine in the browser</h2>
      <p class=muted style="font-size:14px">The RandomX coins can be mined right in your browser tab
        (a WebAssembly miner bridged to the pool's stratum) — the "Mine right now" path on
        <a href="${esc(POOL_SITE)}">the pool front page</a>. It is slow compared to a real rig, but
        it is the zero-setup way to put your first shares in.</p></div>`;
}

// ── /hathor — LIVE witness status for the founding AI Witness (read-only) ──────────────────────
async function chainRpc(method, params) {
  const res = await _chainFetch(MELEK_RPC_URL, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}

/** Read-only snapshot of hathor-the-witness straight from the live chain. Soft-fails to null. */
export async function hathorStatus() {
  try {
    const [w, g, f] = await Promise.all([
      chainRpc('condenser_api.get_witness_by_account', ['hathor']),
      chainRpc('condenser_api.get_dynamic_global_properties', []),
      chainRpc('condenser_api.get_feed_history', []).catch(() => null),
    ]);
    if (!w || !g) return null;
    const last = +w.last_confirmed_block_num || 0;
    const head = +g.head_block_number || 0;
    return {
      headBlock: head,
      lastConfirmed: last,
      blocksBehind: Math.max(0, head - last),
      totalMissed: +w.total_missed || 0,
      version: w.running_version || null,
      signingKeyDisabled: /^(TST|STM|MLK)1{20,}/.test(String(w.signing_key || '')),
      url: w.url || null,
      currentWitness: g.current_witness || null,
      time: g.time || null,
      feed: f && f.current_median_history ? `${f.current_median_history.base} / ${f.current_median_history.quote}` : null,
    };
  } catch { return null; }
}

export async function hathorView(readStatus) {
  const s = await (readStatus || hathorStatus)();
  const live = s ? `
    <div class=card><h2>Live from the chain</h2>
      <div class=idx>
        <div><div class=v>#${esc(num(s.headBlock))}</div><div class=l>head block</div></div>
        <div><div class=v>#${esc(num(s.lastConfirmed))}</div><div class=l>hathor last confirmed</div></div>
        <div><div class=v>${esc(num(s.blocksBehind))}</div><div class=l>blocks behind head</div></div>
        <div><div class=v>${esc(num(s.totalMissed))}</div><div class=l>missed (all-time)</div></div>
        <div><div class=v>${s.version ? esc(s.version) : '—'}</div><div class=l>node version</div></div>
      </div>
      <p class=muted style="font-size:13px">
        signing: ${s.signingKeyDisabled ? '<b style="color:var(--down)">DISABLED</b>' : '<b style="color:var(--up)">active</b>'}
        · producing now: <code>@${esc(s.currentWitness || '?')}</code>
        · chain time ${esc(s.time || '—')} UTC
        ${s.feed ? `· price feed <code>${esc(s.feed)}</code>` : '· price feed not yet on a loop'}
        ${s.url ? `· <a href="${esc(s.url)}">witness URL</a>` : ''}</p>
    </div>`
    : `<div class=card><p class=empty>The testnet RPC is unreachable right now, so there is nothing
        live to show — and we will not invent numbers. The chain runs on our own infrastructure;
        check back shortly.</p></div>`;

  return `<h1>Hathor — the founding AI Witness <span class="badge test">testnet</span></h1>
    <p class=lead>This is what "a witness doing its job" looks like, measured live: <b>hathor</b> is
      a genesis witness on the MELEK testnet, holds the protected 1st slot for the chain's first
      year, and produces blocks like any other witness — the numbers below come straight from the
      chain, refreshed on every page load.</p>
    ${live}
    <div class=card><h2>What you're looking at</h2>
      <p class=muted style="font-size:14px"><b>Last confirmed</b> close to <b>head block</b> means the
      witness is signing on schedule. <b>Missed</b> counts every block it was scheduled to sign but
      didn't (all-time — ours date from a genesis-clock fix during bring-up). A witness whose signing
      key is <b>disabled</b> has turned itself off. This is the same checklist our automated monitor
      runs every five minutes — and the same one you'll use on <em>your</em> witness when you
      <a href="/">finish the school</a>.</p></div>`;
}

// ── /pool/miner — Akasha wallet ↔ pool lookup (read-only) ──────────────────────────────────────
/**
 * Looks the address up on EVERY pool (a wallet may mine more than one coin) and renders one card
 * per pool where the address is known. Facts only: unknown address → says so, API down → says so.
 */
export async function minerView(addr, { readPools, readMiner } = {}) {
  const address = String(addr == null ? '' : addr).trim();
  const listPools = readPools || poolStatsMod.pools;
  const lookupMiner = readMiner || poolStatsMod.minerStats;
  const back = `<p style="margin-top:10px"><a href="/pool">← back to the live pool</a></p>`;

  if (!address) {
    return `<h1>Wallet lookup</h1><div class=card><p class=empty>No address given. Paste the wallet
      address you mine to (the part before the dot in <code>wallet.worker</code>).</p></div>${back}`;
  }

  let list = [];
  try { list = await listPools(); } catch { list = []; }
  list = Array.isArray(list) ? list : [];
  if (!list.length) {
    return `<h1>Wallet lookup</h1><div class=card><p class=empty>The pool API is unreachable right
      now, so the lookup cannot run — and we will not invent numbers. Try again shortly.</p></div>${back}`;
  }

  const found = [];
  for (const p of list) {
    let m = null;
    try { m = await lookupMiner(p.id, address); } catch { m = null; }
    if (m && (m.hashrate > 0 || m.pendingBalance > 0 || m.totalPaid > 0 || m.workers.length)) {
      found.push({ pool: p, m });
    }
  }

  const cards = found.length
    ? found.map(({ pool, m }) => `<div class=card>
        <h3>${esc(pool.coin)} ${pool.symbol ? `<span class=muted>(${esc(pool.symbol)})</span>` : ''}</h3>
        <div class=idx>
          <div><div class=v>${esc(hr(m.hashrate))}</div><div class=l>your hashrate</div></div>
          <div><div class=v>${esc(num(m.pendingBalance))}</div><div class=l>pending balance</div></div>
          <div><div class=v>${esc(num(m.totalPaid))}</div><div class=l>total paid</div></div>
          <div><div class=v>${m.workers.length}</div><div class=l>workers</div></div>
        </div>
        ${m.workers.length ? m.workers.map((w) =>
          `<div class=conn>${esc(w.name)} — ${esc(hr(w.hashrate))}</div>`).join('') : ''}
        ${m.lastPayment ? `<p class=muted style="font-size:13px">last payment: ${esc(String(m.lastPayment))}</p>` : ''}
      </div>`).join('')
    : `<div class=card><p class=empty>The pool engine has no record of
        <code>${esc(address)}</code> on any coin yet. If you just started mining, shares can take a
        few minutes to register; double-check the address matches your miner's
        <code>wallet.worker</code> login exactly.</p></div>`;

  return `<h1>Your wallet on the pool</h1>
    <p class=lead>Read-only view of <code>${esc(address)}</code> across every coin the pool runs —
      this is the Akasha wallet ↔ pool connection: one address, all your mining in one place.</p>
    ${cards}${back}`;
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

// ── /learn — how the systems work (for everyone) ──────────────────────────────────────────────────
export function learnPage() {
  const body = `<h1>Learn the systems <span class=muted style="font-size:14px">· how MELEK rewards, curates, and raises people up</span></h1>
  <p class=lead>MELEK isn't just a chain that pays block producers. It's a set of systems for <b>finding good
    work and rewarding it</b> — and for our witnesses to <b>give back</b> to the community, not just collect
    rewards. Here's how each part works.</p>

  <div class=card><h2>💎 How rewards work</h2>
    <p class=muted style="font-size:14px">When you post or comment, people <b>vote</b> on it. Votes carry
    weight (your stake / "Power"), and at payout the chain splits a daily reward pool across content by how
    much vote-weight it earned — like Steem/Hive/Blurt. MELEK is <b>fee-less</b> and has <b>no downvotes</b>:
    you reward good work; you don't punish. Curators who vote early on work that does well earn a curation
    share — so <b>curating well is itself rewarded</b>.</p>
  </div>

  <div class=card><h2>🔗 Curation Trails</h2>
    <p class=muted style="font-size:14px">A <b>trail</b> lets your account automatically follow another
    account's votes — when a curator you trust upvotes something, your account upvotes it too, at a weight you
    set. It's how a community pools its judgment: one good curator's calls lift everyone who follows them.
    You stay in control — pause it, scale the weight, or cap how many votes per day.</p>
  </div>

  <div class=card><h2>🪙 Tokens &amp; Token Trails</h2>
    <p class=muted style="font-size:14px">Beyond the base coin, communities can run their own <b>tokens</b>
    (SCOT / tribe tokens) that reward posts tagged for that community. A <b>Token Trail</b> is a curation trail
    flagged for a specific token or organization — so a project, DAO, or tribe can run an automated curation
    program that rewards its own contributors in its own token, on top of the base rewards.</p>
  </div>

  <div class=card><h2>🤖 The AutoNetwork (bots)</h2>
    <p class=muted style="font-size:14px">Voting well takes attention you don't always have. The
    <b>AutoNetwork</b> lets you pick an automated-vote strategy and runs it for you — keylessly, through
    MELEK-Signer, even while you're offline. Choose any of them:</p>
    <ul style="font-size:14px;color:var(--mut,#9fb0c3)">
      <li><b>Curation Trail</b> — follow a leader you trust.</li>
      <li><b>Earnings Autovote</b> — fire your votes at the <b>best moment for curation rewards</b> (each chain's reward-timing optimum).</li>
      <li><b>Token / Org Trail</b> — automated curation for a token or organization.</li>
      <li><b>Karma Curation</b> — lift quality newcomers by merit (below).</li>
    </ul>
  </div>

  <div class=card><h2>⭐ The Karma system</h2>
    <p class=muted style="font-size:14px"><b>Karma</b> is social reputation — earned by teaching, helping
    newcomers, curating well, and being here a while. It is <b>not</b> economic: it never changes the chain's
    reward math or your vote weight. It informs the witness's <b>discretionary</b> choices — who to lift, how
    much to weigh a flag. Karma is <b>cross-chain</b>: your standing on Hive, Steem, Blurt and MELEK combine
    into <b>one score that lives on your MELEK account</b>. And <b>Karma Curation</b> uses it to do the most
    valuable thing a curator can: <b>lift quality newcomers</b> — a real contributor with little reach counts
    for more than the same vote aimed at someone already established.</p>
  </div>

  <div class=card><h2>🤝 Witnesses that give back — Community Rewards Programs</h2>
    <p class=muted style="font-size:14px">A witness earns block rewards. The question is what it does with
    them. Our witnesses are built to <b>reward the community and raise people up</b> — not just pull rewards
    off the chain. Think of programs like a chain-run <b>curation rewards fund</b> or a community rewards coin
    (in the spirit of regional rewards programs other chains have run): the witness routes a share of what it
    earns back out — funding curation, grants to people doing valuable work, and lifting newcomers via the
    Karma system. <b>Being a witness here is a stewardship role, not a faucet.</b></p>
    <p class=muted style="font-size:13px">These programs are coming online now — built on the Karma and
    AutoNetwork systems above. <a href="${esc(ALPHA)}">Watch the live chain →</a></p>
  </div>

  <p style="margin-top:14px"><a class="btn ghost" href="/">← back to the Witness School</a></p>`;
  return page('Learn the systems — MELEK Witness School', body, { canonical: `${BASE_URL}/learn`, description: 'How MELEK works: rewards, curation trails, tokens, the AutoNetwork bots, and the cross-chain Karma system — and how MELEK witnesses give back to the community.' });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

// ── /academy — Token Academy: build a curation-reward network ──────────────────────────────────────
export function academyPage() {
  const body = `<h1>Token Academy <span class=muted style="font-size:14px">· build your own curation-reward network</span></h1>
  <p class=lead>A witness produces blocks. A <b>curation-reward network</b> does something bigger: it gathers a
    community around <b>finding good work and paying the people who find it</b>. This is the playbook — the idea,
    the parts MELEK already gives you, and the steps to stand up your own.</p>

  <h2 style="margin-top:18px">The idea</h2>
  <div class=card><h2>🌐 What a curation-reward network is</h2>
    <p class=muted style="font-size:14px">One person voting has small reach. A curation network pools many people's
    judgment and voting power behind a shared goal — surfacing quality, lifting newcomers, growing a topic — and it
    <b>shares the curation rewards back to the members who make it work</b>. Add a community <b>token</b> and it
    becomes a self-funding loop: good posts earn the token, holders curate, curating earns more, and the community
    grows around its own economy. No central boss — it runs on rules and trust.</p>
  </div>

  <h2 style="margin-top:18px">The parts MELEK already gives you</h2>
  <div class=card><h2>🪙 A community token</h2>
    <p class=muted style="font-size:14px">Mint your own token (a SCOT / tribe token) that rewards posts tagged for
    your community, on top of the base MELEK rewards. Set the tag, the daily emission, and the author/curator split.
    This is your network's currency and its incentive dial.</p>
  </div>
  <div class=card><h2>🔗 A curation trail</h2>
    <p class=muted style="font-size:14px">A trail lets members' accounts automatically follow a curator — or a small
    council — they trust: when the lead upvotes, the followers do too, at a weight each member sets. It's how a
    scattered group votes like one strong account, without anyone handing over a key.</p>
  </div>
  <div class=card><h2>🏷️ A token trail</h2>
    <p class=muted style="font-size:14px">A curation trail flagged for <i>your</i> token — so the automated votes
    reward your community's contributors in your token, not just the base coin. This is the engine that pays the
    people producing and curating for your network.</p>
  </div>
  <div class=card><h2>🤖 Autovote strategies (keyless)</h2>
    <p class=muted style="font-size:14px">Members pick a strategy — follow the trail, reward by merit, boost
    newcomers — and it runs automatically and <b>keylessly</b> (through the signer boundary; the network never holds
    their keys). Delegated stake makes each vote heavier without giving up ownership.</p>
  </div>
  <div class=card><h2>⭐ Merit &amp; fair distribution</h2>
    <p class=muted style="font-size:14px">The Karma system weighs need and recent activity so rewards lift real,
    active newcomers instead of the already-large — and keeps a network from becoming a circle that only pays itself.
    Fair distribution is what makes it last.</p>
  </div>

  <h2 style="margin-top:18px">The tools — and where you actually do it</h2>
  <div class=card><h2>⚙️ MELEK-Engine — mint &amp; run your token</h2>
    <p class=muted style="font-size:14px">MELEK's Hive-Engine-style layer-2 token engine. <code>tokens.create</code>
    registers your community token (symbol, precision, optional immutable cap); <code>rewards.setReward</code> is the
    <b>Scotbot equivalent</b> — you configure the token's social-reward pool (daily emission, author/curator split,
    reward curve) as <i>settings, not code</i>. <code>tokens.issue</code> / <code>tokens.transfer</code> /
    <code>tokens.stake</code> do the rest. Manage it from the
    <a href="https://tokens.alpha.melek.salon">Tokens portal</a>.</p>
  </div>
  <div class=card><h2>🐝 APIS — the fee token</h2>
    <p class=muted style="font-size:14px">APIS is the engine's fee/utility token (its "BEE"), named for <i>Apis</i>, the
    sacred bee. You <b>burn a little APIS</b> to create your token and to pay engine resource fees — it's what powers
    the engine. Get some first; it's the key that turns the crank.</p>
  </div>
  <div class=card><h2>💧 KulaSwap — liquidity &amp; DeFi for your token</h2>
    <p class=muted style="font-size:14px">Once your token exists, <a href="https://kula.money">KulaSwap</a> is where it
    gets a market: swap it, add it to a <b>liquidity pool</b>, run a <b>farm</b> to reward holders, or use the <b>CDP</b>
    vaults (lock wMELEK for a passive APIS yield) to help fund the network. It's the DeFi side that turns a reward token
    into a working little economy.</p>
  </div>

  <h2 style="margin-top:18px">Build your own — the steps</h2>
  <div class=card>
    <ol class=steps>
      <li><b>Define the community.</b> Pick what you reward (a topic, a region, quality originals, newcomers) and a tag.</li>
      <li><b>Mint the token.</b> In MELEK-Engine, <code>tokens.create</code> (burns a little APIS) mints it; <code>rewards.setReward</code> sets its reward pool — tag, daily emission, author/curator split.</li>
      <li><b>Set the curation trail.</b> Choose the curator or council whose votes the network follows.</li>
      <li><b>Flag the token trail.</b> Point the trail at your token so curation pays your contributors in it.</li>
      <li><b>Invite members.</b> They follow the trail / delegate stake — keylessly — and set their own vote weight.</li>
      <li><b>Distribute, list &amp; show it.</b> Rewards flow to authors and curators; list the token on KulaSwap for liquidity, and publish a live leaderboard so the community sees it working.</li>
    </ol>
    <p class=muted style="font-size:13px">Every step runs on tooling MELEK already ships — SCOT tokens, curation and
    token trails, keyless autovote, and the Karma merit system. The Academy is the guided front door to it.</p>
  </div>

  <p class=muted style="font-size:13px;margin-top:14px">This page teaches the model. <a href="/learn">Learn</a> covers
    how MELEK's rewards and curation work underneath, and <a href="/pool">the pool</a> and <a href="/hathor">Hathor</a>
    show the live chain the same tools run on.</p>`;
  return page('Token Academy — build a curation-reward network on MELEK', body, { canonical: `${BASE_URL}/academy`, description: 'Token Academy: how to build a curation-reward network on MELEK — a community token, curation and token trails, keyless autovote, and fair reward distribution, using tooling MELEK already ships.' });
}

// ── /run — Run a MELEK Witness (mainnet is LIVE) ───────────────────────────────────────────────
export function runPage() {
  const CHAIN_ID = process.env.MELEK_MAINNET_CHAIN_ID || '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b';
  const SEED = process.env.MELEK_SEED_NODE || '167.86.77.4:2001';
  const body = `<h1>Run a MELEK Witness <span class=muted style="font-size:14px">· mainnet is live</span></h1>

  <div class=card style="border-color:#d9a441">
    <h2>🟢 MELEK mainnet is LIVE</h2>
    <p>Genesis fired <b>7:12 AM CDT · 7/12/2026</b>. No premine — every MELEK is mined or earned. The
       genesis inscription's SHA-256 <b>is</b> the chain id, so a node on a different inscription is a
       different chain. Connect on these exact parameters:</p>
    <pre>chain id     ${esc(CHAIN_ID)}
prefix       MELEK       coin  MELEK       (no backed dollar / no MBD)
block time   3 seconds   consensus  Graphene DPoS
seed node    ${esc(SEED)}</pre>
  </div>

  <div class=card><h2>1 · Get a box</h2>
    <p class=muted>Ubuntu 24.04, x86_64, <b>8 GB RAM</b>, ~40 GB disk to start (a fresh chain is light).
    See <a href="/servers">Rent for mining</a> for honest hardware pointers.</p></div>

  <div class=card><h2>2 · Build the node</h2>
    <pre>git clone https://github.com/HinduTempleCoins/melek-chain
cd melek-chain
sudo apt install -y build-essential cmake libboost-all-dev libssl-dev \\
  libsnappy-dev liblz4-dev libzstd-dev liblzma-dev libreadline-dev libbz2-dev
mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_STEEM_TESTNET=OFF ..   # OFF = mainnet
make -j$(nproc) steemd cli_wallet</pre>
    <p class=muted>The build is the same code MELEK runs; <code>BUILD_STEEM_TESTNET=OFF</code> selects mainnet
    (prefix MELEK, the inscription chain id). Prebuilt binaries can be requested in Discord.</p></div>

  <div class=card><h2>3 · Get an account + a signing key</h2>
    <p class=muted>Create your MELEK account at <a href="https://melek.salon">melek.salon</a> (invite-gated).
    Then generate a dedicated <b>block-signing key</b> — it is separate from your account keys and is the
    only key that lives on the witness box:</p>
    <pre>./cli_wallet -s ws://127.0.0.1:8090 --chain-id ${esc(CHAIN_ID)}
&gt;&gt;&gt; suggest_brain_key      # gives you a wif_priv_key + pub_key for signing</pre></div>

  <div class=card><h2>4 · config.ini</h2>
    <pre>p2p-endpoint = 0.0.0.0:2001
rpc-endpoint = 127.0.0.1:8090
p2p-seed-node = ${esc(SEED)}
enable-stale-production = false
witness = "youraccount"
private-key = &lt;your signing WIF from step 3&gt;
plugin = witness account_by_key account_by_key_api database_api condenser_api block_api network_broadcast_api rc rc_api account_history_rocksdb account_history_api
shared-file-size = 8G
shared-file-dir = "blockchain"</pre>
    <p class=muted>Keep your signing WIF on this box only. Your account's owner/active keys never go here.</p></div>

  <div class=card><h2>5 · Sync + start producing</h2>
    <pre>./steemd --data-dir=/opt/melek</pre>
    <p class=muted>It connects to the seed, syncs the chain, and — once you're registered and voted in —
    signs blocks on your turn.</p></div>

  <div class=card><h2>6 · Register your witness</h2>
    <p class=muted>In cli_wallet (unlocked, your account's active key imported):</p>
    <pre>update_witness "youraccount" "https://your-witness-url" "&lt;your signing PUB key&gt;" \\
  {"account_creation_fee":"1.000 MELEK","maximum_block_size":65536,"sbd_interest_rate":0} true</pre></div>

  <div class=card><h2>7 · Get voted in</h2>
    <p class=muted>MELEK is <b>stake-weighted DPoS</b> — the community votes witnesses into the producing
    set. Post your intro thread, share your node's uptime, and ask MELEK holders to
    <code>vote_for_witness</code> for you. Watch <a href="/hathor">Hathor, live</a> for the working example,
    and read <a href="/learn">Learn the systems</a> for how rewards and curation flow.</p>
    <blockquote>Being a witness is a <b>job you run</b> — keep the node in sync, don't miss blocks, and give
    back to the community. Questions? Hathor answers in Discord and on the <a href="/pool">pool</a>.</blockquote></div>`;
  return page('Run a MELEK Witness — mainnet is live', body, { canonical: `${BASE_URL}/run`, description: 'How to run a MELEK mainnet witness: chain id, seed node, build the node (BUILD_STEEM_TESTNET=OFF), config.ini, register your witness, and get voted into the producing set. MELEK genesis fired 7:12 CDT 7/12/2026 — no premine.' });
}

const SITEMAP_PATHS = ['/', '/learn', '/academy', '/run', '/pool', '/fees', '/servers', '/wallet', '/hathor'];

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
    if (path === '/learn') return sendHtml(res, learnPage());
    if (path === '/academy') return sendHtml(res, academyPage());
    if (path === '/run') return sendHtml(res, runPage());
    if (path === '/pool') {
      return sendHtml(res, page('Live pool status — Witness School', await poolView(), { canonical: `${BASE_URL}/pool` }));
    }
    if (path === '/hathor') {
      return sendHtml(res, page('Hathor — the founding AI Witness, live — Witness School',
        await hathorView(), { canonical: `${BASE_URL}/hathor` }));
    }
    if (path === '/pool/miner') {
      const addr = url.searchParams.get('addr') || '';
      return sendHtml(res, page('Your wallet on the pool — Witness School',
        await minerView(addr), { canonical: `${BASE_URL}/pool`, robots: 'noindex,follow' }));
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
