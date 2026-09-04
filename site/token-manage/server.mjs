// server.mjs — token-manage.alpha.melek.salon. The "Manage my token" front-end for MELEK-Engine token
// ISSUERS, in the SoapBox house style (mirrors site/insurance/server.mjs). It is the operate/maintain
// surface that sits alongside the existing token-tools (/tools) create surface: for a ?symbol=X it shows
// the token's facts (supply / holders / rewards, read from the engine READ API) and the four issuer
// actions — ISSUE more, BURN (deflation), configure STAKING / SCOT rewards, and a guided BUYBACK WIZARD.
//
//   PORT=8308 BASE_URL=https://token-manage.alpha.melek.salon node site/token-manage/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                      home — what this is + a "your token symbol" box + the compliance banner
//   /manage?symbol=X       (or /manage/X) the issuer dashboard: facts + issue/burn/scot/buyback actions
//   /manage/X/buyback      (or /buyback?symbol=X) the guided buyback wizard (Route A real, Route B gated)
//   /health                liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── KEY CUSTODY (BRIEF.md §7) ─────────────────────────────────────────────────────────────────────
//   This page NEVER signs and NEVER broadcasts and holds NO key. Every action RENDERS a client-signable
//   op INTENT (a Graphene custom_json with ACTIVE auth = the issuer account) that the user signs in their
//   condenser / MELEK-Signer. No WIF / seed / active key is entered, read, logged, or stored here. The
//   op shapes come straight from engine/lib/op-builder.mjs (build + validate only).
//
// ── COMPLIANCE (load-bearing, [[token-securities-compliance-posture]]) ────────────────────────────
//   A buyback / burn on this surface is framed STRICTLY as TOKEN-MANAGEMENT / DEFLATION UTILITY — a way
//   to reduce supply or deepen liquidity with your own revenue. It is NOT price support, NOT a promise
//   about token value, and NOT a claim of future appreciation. Every UI string is written to that line,
//   and the not-investment-advice notice appears on every page. Soft-fail: every route renders even when
//   the engine read returns nothing. esc() on every interpolated value.

import { createServer } from 'node:http';

import {
  burnOp,
  scotEnableOp,
  bridgeOutOp,
  buildEngineOp,
  isValidSymbol,
} from '../../engine/lib/op-builder.mjs';
import { marketPanel, kulaswapLink, isLive as marketIsLive } from '../../integrations/kulaswap-market.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8308);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ENGINE_API = (process.env.ENGINE_API_URL || 'https://engine.alpha.melek.salon').replace(/\/$/, '');
const WITNESS_SCHOOL = process.env.WITNESS_SCHOOL_URL || 'https://witness.melek.salon';
const SITE_NAME = 'MELEK Token Manage';

// Example values used only to render a READY-TO-SIGN sample intent; the user replaces them.
const EX_QTY = '100';
const EX_PRANA = '0x0000000000000000000000000000000000000000';

// ── the two load-bearing compliance lines (asserted in tests; contain NO banned copy) ──────────────
// NOTE: deliberately avoids the substrings "price floor" / "guaranteed" / "moon" — a buyback is a
// mechanic, never a price promise.
const COMPLIANCE =
  'A buyback or burn here is a token-management and deflation mechanic only — you spend your own supply ' +
  'or revenue to reduce circulating supply or deepen liquidity. It is not price support, not a promise ' +
  'about token value, and not a claim of future appreciation.';
const NOT_ADVICE = 'Educational information only — not investment, legal, or financial advice.';

// ── house-style helpers (dark theme, matches token-tools / coupons / insurance) ────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d0b14;--panel:#16131f;--line:#2a2438;--fg:#e9e4f5;--mut:#9a90b5;--gold:#d8b35a;--sky:#7fb3ff;--warn:#e07aa0}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--gold);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:linear-gradient(180deg,#1a1626,#0d0b14);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:12px}
  .brand{font-weight:800;font-size:19px;color:var(--fg)} .brand span{color:var(--gold)}
  .alpha{color:var(--gold);border:1px solid var(--gold);border-radius:5px;font-size:.55rem;letter-spacing:.5px;padding:1px 5px;vertical-align:super;text-transform:uppercase;margin-left:4px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:6px 12px}
  .topbar-r a:hover{border-color:var(--gold);color:var(--gold);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:25px} h2{font-size:17px;margin:0 0 10px;color:var(--gold)} h3{font-size:15px;margin:12px 0 6px}
  .muted{color:var(--mut)} .sky{color:var(--sky)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
  th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px} .num{text-align:right;font-variant-numeric:tabular-nums}
  .pill{display:inline-block;background:#0d0b14;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut);margin-right:6px}
  pre{background:#0d0b14;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all}
  input.q{background:#0b0f14;border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:360px}
  button{cursor:pointer;background:var(--gold);color:#1a1626;border:0;border-radius:8px;font-weight:700;padding:11px 20px;font-size:15px}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .compliance{background:#d8b35a11;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .gated{border-color:var(--warn);opacity:.9} .gatelabel{color:var(--warn);font-size:12px;font-weight:700}
  .step{border-left:3px solid var(--gold);padding:4px 0 4px 14px;margin:14px 0}
  .step.gated{border-left-color:var(--warn)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

const FOOTER = `<footer>
  <b>Token management, not a market pitch.</b> ${esc(COMPLIANCE)} ${esc(NOT_ADVICE)}
  This page holds no key and signs nothing — you sign every action in your own wallet (condenser / MELEK-Signer).
  <div style="margin-top:8px"><a href="/">Manage</a> · <a href="${esc(WITNESS_SCHOOL)}/academy/manage">Witness School</a> · <a href="${esc(ENGINE_API)}/tools">Token Tools</a></div>
</footer>`;

// ── injectable fetch (offline tests) ───────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function getJson(path) {
  try {
    const res = await _fetch(`${ENGINE_API}${path}`, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null; // soft-fail: never throw, never a fake number
  }
}

/**
 * fetchTokenFacts(symbol) — read a token's facts from the engine READ API (soft-fail to a shaped empty).
 * Returns { found, token, holders, rule } where token is the engineTokenView-shaped row (or null).
 */
export async function fetchTokenFacts(symbol) {
  const sym = String(symbol || '').toUpperCase();
  const [tokRes, holdRes, tribeRes] = await Promise.all([
    getJson(`/api/tokens?symbol=${encodeURIComponent(sym)}`),
    getJson(`/api/holders?symbol=${encodeURIComponent(sym)}`),
    getJson(`/api/tribes?symbol=${encodeURIComponent(sym)}`),
  ]);
  // /api/tokens may return an array or a { tokens: [] } wrapper; accept both.
  const list = Array.isArray(tokRes) ? tokRes : (tokRes && Array.isArray(tokRes.tokens) ? tokRes.tokens : []);
  const token = list.find((t) => String(t.symbol).toUpperCase() === sym) || (list.length === 1 ? list[0] : null);
  const holders = Array.isArray(holdRes) ? holdRes : (holdRes && Array.isArray(holdRes.holders) ? holdRes.holders : []);
  const tribes = Array.isArray(tribeRes) ? tribeRes : (tribeRes && Array.isArray(tribeRes.tribes) ? tribeRes.tribes : []);
  const rule = tribes.find((r) => String(r.symbol).toUpperCase() === sym) || (tribes.length ? tribes[0] : null);
  return { found: !!token, token: token || null, holders, rule };
}

// ── page shell ─────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Manage a MELEK-Engine token: issue, burn (deflation), configure SCOT rewards, and run a guided buyback — all as client-signed op intents. Token-management utility, not investment advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots: opts.robots || 'index,follow,max-image-preview:large',
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/manage?symbol={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/"><span>MELEK</span> Token Manage<span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="${esc(ENGINE_API)}/tools">Create</a><a href="${esc(WITNESS_SCHOOL)}/academy/manage">Learn</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function symbolForm(action = '/manage', placeholder = 'MYTOK') {
  return `<form class=row method=get action="${esc(action)}">
    <input class=q name="symbol" placeholder="${esc(placeholder)}" autocomplete=off aria-label="Your token symbol">
    <button type=submit>Manage</button></form>`;
}

// ── op-intent rendering (the client-signable custom_json the user pastes into their signer) ─────────
/** Render one built op as a labelled, ready-to-sign intent block, or its validation error. */
function intentBlock(label, built) {
  if (!built || built.ok === false) {
    return `<h3>${esc(label)}</h3><p class="muted">${esc((built && built.error) || 'intent unavailable')}</p>`;
  }
  const env = built.envelope;
  const tag = env ? `${env.contractName}.${env.contractAction}` : String(built.action || '');
  return `<h3>${esc(label)}</h3>
    <p class="muted">Sign in your condenser / MELEK-Signer (this page holds no key) · intent: <code>${esc(tag)}</code></p>
    <p class="muted">${esc(built.summary)}</p>
    <pre>${esc(JSON.stringify(built.op, null, 2))}</pre>`;
}

// ── home ───────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const body = `<h1>Manage your MELEK-Engine token</h1>
    <p class="muted">You created a token on the engine — this is where you <b>run</b> it. See its supply,
      holders and rewards, then issue more (within your cap), <b>burn</b> to reduce supply, tune <b>SCOT
      rewards</b>, or run a guided <b>buyback</b>. Every action is a client-signed op intent — this page
      holds no key.</p>
    <div class=card><h2>Open your token</h2>${symbolForm()}</div>
    <div class="compliance" role="note">${esc(COMPLIANCE)} ${esc(NOT_ADVICE)}</div>
    <div class=card><h2>What you can do</h2>
      <div class=grid>
        <div class=card style="margin:0"><b>Issue more</b><div class="muted">Mint within your max supply. An immutable cap is the trust move.</div></div>
        <div class=card style="margin:0"><b>Burn</b><div class="muted">Reduce circulating supply — a deflation lever, not a price promise.</div></div>
        <div class=card style="margin:0"><b>Rewards (SCOT)</b><div class="muted">Author/curator emission — the 65/35 honest-utility default.</div></div>
        <div class=card style="margin:0"><b>Buyback</b><div class="muted">Buy your token back, then burn or lock it as liquidity.</div></div>
      </div></div>`;
  return page(`${SITE_NAME} — issue, burn, rewards & buyback`, body, { canonical: `${BASE_URL}/` });
}

// ── /manage?symbol=X — the issuer dashboard ─────────────────────────────────────────────────────────
export async function managePage(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!isValidSymbol(sym)) {
    return page(`Manage — ${SITE_NAME}`,
      `<h1>Manage a token</h1><p class="muted">Enter a valid engine token symbol (1–10 A–Z).</p>
       <div class=card>${symbolForm()}</div>
       <div class="compliance">${esc(COMPLIANCE)} ${esc(NOT_ADVICE)}</div>`,
      { canonical: `${BASE_URL}/manage` });
  }

  const facts = await fetchTokenFacts(sym);
  const t = facts.token;
  const issuer = (t && t.issuer) || 'hathor'; // example account when facts are unavailable (labelled below)
  const issuerKnown = !!(t && t.issuer);
  const market = await marketPanel(sym);

  // Facts card (soft-fail: renders even when the engine read returned nothing).
  const supplyRow = t
    ? `<table>
        <tr><th>Issuer</th><td>@${esc(t.issuer)}</td></tr>
        <tr><th>Precision</th><td class=num>${esc(t.precision)}</td></tr>
        <tr><th>Supply</th><td class=num>${esc(t.supply)}</td></tr>
        <tr><th>Circulating</th><td class=num>${esc(t.circulatingSupply != null ? t.circulatingSupply : t.supply)}</td></tr>
        <tr><th>Max supply</th><td class=num>${esc(t.maxSupply)}${t.supplyCapImmutable || t.immutable ? ' 🔒' : ''}</td></tr>
        ${t.url ? `<tr><th>URL</th><td><a href="${esc(t.url)}" rel="noopener noreferrer">${esc(t.url)}</a></td></tr>` : ''}
      </table>`
    : `<p class="muted">Live facts unavailable (engine read soft-empty). The action intents below still assemble — replace the account and amounts with your own.</p>`;

  const holderRows = (facts.holders || []).slice(0, 20).map((h) =>
    `<tr><td>@${esc(h.account)}</td><td class=num>${esc(h.balance != null ? h.balance : '')}</td><td class=num>${esc(h.stake != null ? h.stake : '')}</td></tr>`).join('');

  const rule = facts.rule;
  const rewardFacts = rule
    ? `<p class="muted">Current rule: emission <b>${esc(rule.emissionPerWindow)}</b> per <b>${esc(rule.windowBlocks)}</b> blocks · author <b>${esc(rule.authorBps != null ? rule.authorBps / 100 : '?')}%</b> · curve <b>${esc(rule.curve || '?')}</b>${rule.tag ? ` · tag <b>${esc(rule.tag)}</b>` : ''}.</p>`
    : `<p class="muted">No SCOT reward rule yet. The intent below sets the honest-utility 65/35 default.</p>`;

  // Built op INTENTS (client-signable; no key). Example values the issuer replaces.
  const burnIntent = burnOp(issuer, { symbol: sym, quantity: EX_QTY });
  const issueIntent = buildEngineOp('issue', { symbol: sym, to: issuer, quantity: EX_QTY }, issuer);
  const scotIntent = scotEnableOp(issuer, { symbol: sym, config: { emissionPerWindow: '10', windowBlocks: 1200 } });

  const exampleNote = issuerKnown
    ? ''
    : `<p class="gatelabel">Example account @${esc(issuer)} shown — replace it with your issuer account before signing.</p>`;

  const body = `<h1>${esc(sym)}${t ? ` — ${esc(t.name || sym)}` : ''}
      <span class=pill>engine token</span>${t && (t.supplyCapImmutable || t.immutable) ? '<span class=pill>🔒 immutable cap</span>' : ''}</h1>
    <div class="compliance" role="note">${esc(COMPLIANCE)} ${esc(NOT_ADVICE)}</div>

    <div class=card><h2>Token facts</h2>${supplyRow}</div>

    <div class=card><h2>Holders (${(facts.holders || []).length})</h2>
      <table><thead><tr><th>Account</th><th class=num>Liquid</th><th class=num>Staked</th></tr></thead>
      <tbody>${holderRows || '<tr><td colspan=3 class="muted">no holders read</td></tr>'}</tbody></table></div>

    <div class=card><h2>Issue more (within your cap)</h2>
      <p class="muted">Mint new supply to an account. An <b>immutable</b> cap can never be exceeded — renouncing new supply is the trust move (the BitShares <code>lock_max_supply</code> lineage).</p>
      ${exampleNote}${intentBlock(`Issue ${EX_QTY} ${sym}`, issueIntent)}</div>

    <div class=card><h2>Burn (reduce supply · deflation)</h2>
      <p class="muted">Destroy tokens you hold to lower circulating supply. This is a supply mechanic — it is not price support and not a claim about token value.</p>
      ${intentBlock(`Burn ${EX_QTY} ${sym}`, burnIntent)}</div>

    <div class=card><h2>Staking / SCOT rewards</h2>${rewardFacts}
      <p class="muted">Author/curator emission for posts tagged with your token. Default <b>65/35</b> author/curator (honest utility, not an APY or yield promise).</p>
      ${intentBlock(`Enable / tune SCOT on ${sym}`, scotIntent)}</div>

    <div class=card><h2>Buyback</h2>
      <p class="muted">Spend your own revenue to buy ${esc(sym)} back and either <b>burn</b> it (deflation) or lock it as <b>protocol-owned liquidity</b> (market depth). A token-management action — not a claim about price.</p>
      <p><a href="/manage/${esc(sym)}/buyback"><b>Open the guided buyback wizard →</b></a></p></div>

    ${renderMarketCard(sym, market)}`;

  return page(`${sym} — manage · ${SITE_NAME}`, body, { canonical: `${BASE_URL}/manage?symbol=${encodeURIComponent(sym)}` });
}

function renderMarketCard(sym, market) {
  const live = market && market.live;
  return `<div class="card${live ? '' : ' gated'}"><h2>Market (KulaSwap · PRANA)</h2>
    ${live
      ? `<table>
          <tr><th>Pair</th><td>${esc(market.wsymbol)}</td></tr>
          <tr><th>Price</th><td class=num>${esc(market.price != null ? market.price : '—')}</td></tr>
          <tr><th>Liquidity</th><td class=num>${esc(market.liquidity != null ? market.liquidity : '—')}</td></tr>
          <tr><th>24h volume</th><td class=num>${esc(market.volume24h != null ? market.volume24h : '—')}</td></tr>
        </table>`
      : `<p class="gatelabel">Available when PRANA is live.</p>
         <p class="muted">${esc((market && market.note) || 'Market lives on KulaSwap (PRANA).')}</p>`}
    <p class="muted">Read-only. The market lives on PRANA on purpose — this page places no orders.
      <a href="${esc((market && market.link) || kulaswapLink(sym))}" rel="noopener noreferrer">KulaSwap ↗</a></p></div>`;
}

// ── /manage/X/buyback — the guided buyback wizard ───────────────────────────────────────────────────
export async function buybackPage(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!isValidSymbol(sym)) {
    return page(`Buyback — ${SITE_NAME}`,
      `<h1>Buyback wizard</h1><p class="muted">Enter a valid engine token symbol.</p><div class=card>${symbolForm('/buyback')}</div>`,
      { canonical: `${BASE_URL}/buyback` });
  }
  const facts = await fetchTokenFacts(sym);
  const t = facts.token;
  const issuer = (t && t.issuer) || 'hathor';
  const issuerKnown = !!(t && t.issuer);

  const burnIntent = burnOp(issuer, { symbol: sym, quantity: EX_QTY });
  // Route B step-1 intent (gated on PRANA + generic bridge): bridge-out transfer.
  const bridgeIntent = bridgeOutOp(issuer, { symbol: sym, quantity: EX_QTY, toPrana: EX_PRANA });
  const bridgeLive = marketIsLive();

  const exampleNote = issuerKnown ? '' : `<p class="gatelabel">Example account @${esc(issuer)} — replace with your issuer account before signing.</p>`;

  const body = `<h1>Buyback wizard — ${esc(sym)}</h1>
    <div class="compliance" role="note">${esc(COMPLIANCE)} ${esc(NOT_ADVICE)}</div>

    <div class=card><h2>Step 0 — choose your intent</h2>
      <p class="muted">A buyback spends your revenue to buy your token back and either <b>destroy it</b>
        (reduce supply) or <b>lock it as liquidity</b> (deepen the market). It is a token-management action,
        not a claim about token value.</p>
      <p><span class=pill>Burn = reduce supply</span><span class=pill>PoL = deepen liquidity</span></p></div>

    <div class=card><h2>Route A — engine-native (real today)</h2>
      <p class="muted">No PRANA needed. Acquire ${esc(sym)} off-book (from holders / OTC / rewards your
        treasury already holds), then burn it on the engine. Circulating supply falls; the burn log is the
        public receipt.</p>
      <div class=step><b>Step 1 — Acquire ${esc(sym)}</b><div class="muted">Buy back the supply you want to
        retire into your treasury account (off-book — there is no engine market to buy on).</div></div>
      <div class=step><b>Step 2 — Burn it (deflation)</b>${exampleNote}${intentBlock(`Burn ${EX_QTY} ${sym}`, burnIntent)}</div>
    </div>

    <div class="card gated"><h2>Route B — AMM buyback on PRANA <span class="gatelabel">${bridgeLive ? '(PRANA live)' : '(available when PRANA is live)'}</span></h2>
      <p class="muted">The full mechanism, gated on the bridge + PRANA. Bridge ${esc(sym)} to PRANA, buy it
        on KulaSwap with treasury funds, then burn it or lock it as protocol-owned liquidity.</p>
      <div class="step gated"><b>Step 1 — Bridge to PRANA</b>
        <div class="muted">Transfer ${esc(sym)} to the bridge custody with your 0x PRANA address in the memo;
          the off-chain watcher mints w${esc(sym)} on PRANA.</div>
        ${intentBlock(`Bridge ${EX_QTY} ${sym} → PRANA`, bridgeIntent)}</div>
      <div class="step gated"><b>Step 2 — Buy on KulaSwap</b>
        <div class="muted">Swap treasury funds → w${esc(sym)} on the KulaSwap AMM (signed by Akasha/MetaMask).</div>
        <p><a href="${esc(kulaswapLink(sym))}" rel="noopener noreferrer">Open KulaSwap ↗</a></p></div>
      <div class="step gated"><b>Step 3 — Choose the sink</b>
        <div class="muted"><b>Burn</b> the bought w${esc(sym)} (send to FeeCollectorBurner / bridge back and burn on the engine) —
          deflation; or <b>PoL</b>: deposit it as liquidity and lock it (CommunityBuybackVault → LiquidityLocker) — market depth.</div></div>
      <div class="step gated"><b>Step 4 — (optional) automate</b>
        <div class="muted">Route a revenue slice into a CommunityBuybackVault for a standing buyback
          (the LottoTreasuryRouter pattern). The immutable 3% Hathor floor rides along on native-PRANA inflow.</div></div>
    </div>

    <p class="muted"><a href="/manage?symbol=${encodeURIComponent(sym)}">← back to ${esc(sym)}</a></p>`;

  return page(`Buyback ${sym} · ${SITE_NAME}`, body, { canonical: `${BASE_URL}/manage/${encodeURIComponent(sym)}/buyback` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'daily', priority: u === '/' ? '1.0' : '0.7' }));
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
        summary: 'Manage a MELEK-Engine token: issue, burn (deflation), configure SCOT rewards, and run a guided buyback — as client-signed op intents. Token-management utility, never a price promise; not investment advice.',
        links: [{ label: 'Manage a token', path: '/manage' }, { label: 'Buyback wizard', path: '/buyback' }],
      }));
    }

    if (path === '/' || path === '/index.html') return sendHtml(res, homePage());

    // /manage/:SYMBOL/buyback  and  /manage/:SYMBOL  (path form)
    const mBuyback = path.match(/^\/manage\/([^/]+)\/buyback\/?$/);
    if (mBuyback) return sendHtml(res, await buybackPage(decodeURIComponent(mBuyback[1])));
    const mManage = path.match(/^\/manage\/([^/]+)\/?$/);
    if (mManage) return sendHtml(res, await managePage(decodeURIComponent(mManage[1])));

    // /manage?symbol=  and  /buyback?symbol=  (query form)
    if (path === '/manage' || path === '/manage/') return sendHtml(res, await managePage(url.searchParams.get('symbol') || ''));
    if (path === '/buyback' || path === '/buyback/') return sendHtml(res, await buybackPage(url.searchParams.get('symbol') || ''));

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    // soft-fail: never leak a stack, never crash the process
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/token-manage\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK Token Manage on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
