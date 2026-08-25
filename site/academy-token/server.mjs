// server.mjs — Token Academy: "Manage your token & do a buyback." A standalone, zero-dependency
// HTTP surface in the SoapBox / Witness-School house style (mirrors site/witness/server.mjs's
// action-board and site/insurance/server.mjs's shell). It is the TEACHING companion to the
// MELEK-Engine token-management front-end: a step-by-step how-to action board for a token issuer —
//   create/issue → configure SCOT rewards → burn/deflation → the buyback wizard → bridge to trade
//   on KulaSwap — where each step NAMES the exact tool and links to the token-manage surface and to
//   engine.alpha.melek.salon, with the Library-of-Ashurbanipal theory one click away.
//
//   PORT=8196 BASE_URL=https://academy.alpha.melek.salon node site/academy-token/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the action board — "Manage your token & do a buyback" (the 7-step how-to)
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE (load-bearing, per [[token-securities-compliance-posture]]) ────────────────────────
//   A buyback here is TOKEN-MANAGEMENT / DEFLATION / TREASURY utility — NEVER a price-floor promise,
//   a guarantee of appreciation, or an "invest and profit" pitch. Every string teaches the MECHANIC
//   (spend revenue to reduce supply or deepen liquidity) and names the risk; the buyback card must
//   never imply guaranteed price. A not-investment-advice note rides on every page. Facts, not hype:
//   every tool link is real. esc() on every interpolated value. Soft-fail: every route renders even
//   with no upstream. Read-only: this page holds no key, signs nothing, broadcasts nothing.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8196);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Token Academy';

// Where the "do this" steps point — all overridable so they can move without touching module copy.
const ENGINE = (process.env.ENGINE_URL || 'https://engine.alpha.melek.salon').replace(/\/$/, '');
const MANAGE = (process.env.MANAGE_URL || `${ENGINE}/manage`).replace(/\/$/, ''); // the token-manage surface (/manage/:SYMBOL)
const TOKENS_PORTAL = (process.env.TOKENS_URL || 'https://tokens.alpha.melek.salon').replace(/\/$/, '');
const KULA = (process.env.KULA_URL || 'https://kula.money').replace(/\/$/, '');
const WITNESS = (process.env.WITNESS_URL || 'https://witness.melek.salon').replace(/\/$/, '');
// The Library of Ashurbanipal — the cited reference wiki. The theory behind each step lives here.
const LIBRARY = (process.env.LIBRARY_URL || 'https://wiki.soapbox.community').replace(/\/$/, '');
const libArticle = (slug, label) => `<a href="${esc(`${LIBRARY}/wiki/${slug}`)}">${esc(label)}</a>`;
// The new UIA-lineage article this surface is the how-to companion to (§6 of the research doc).
const UIA_ARTICLE = 'Token_Buybacks__Market_Fees__and_the_UIA_Lineage';

// ── shared house-style helpers (same dark theme as Witness School / Insurance / Coupons) ──────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  .alpha-badge{position:fixed;top:8px;left:8px;z-index:20;font-size:11px;font-weight:700;letter-spacing:.04em;color:var(--gold);background:#d2992222;border:1px solid var(--gold);border-radius:7px;padding:2px 8px}
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
  .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .steps{counter-reset:step;list-style:none;padding:0;margin:6px 0}
  .steps li{counter-increment:step;position:relative;padding:14px 0 14px 44px;border-bottom:1px solid var(--line)}
  .steps li:last-child{border-bottom:0}
  .steps li::before{content:counter(step);position:absolute;left:0;top:14px;width:30px;height:30px;border-radius:50%;background:#1f6feb33;color:var(--blue);font-weight:800;text-align:center;line-height:30px;font-size:14px}
  .steps li b{color:var(--fg)} .steps .tool{font-size:13px;margin-top:6px}
  .steps .tool a{font-weight:700} .steps .ref{font-size:12px;margin-top:4px;opacity:.75}
  .badge{display:inline-block;font-size:11px;font-weight:700;border-radius:8px;padding:2px 9px;vertical-align:middle}
  .badge.live{background:#3fb95033;color:var(--up)} .badge.gated{background:#d2992233;color:var(--gold)}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:6px;font-size:13px;padding:1px 6px}
  blockquote{border-left:3px solid var(--gold);margin:10px 0;padding:6px 0 6px 14px;color:var(--fg);font-size:14px}
  .not-advice{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// The single compliance sentence, reused verbatim wherever a buyback is named.
const COMPLIANCE_LINE = 'A buyback spends your treasury revenue to buy your token back and either destroy it or lock it as liquidity. It is a token-management action — supply management and treasury discipline — <b>not a price-floor, not a promise your token will go up in value</b>.';

const NOT_ADVICE = `<div class="not-advice" role="note"><b>Not investment advice.</b> This page teaches how to
  <b>manage</b> a token you issue — issuance, rewards, deflation, and buybacks — as engineering and treasury
  mechanics. It is education, not financial, legal, or investment advice, and nothing here is a promise that any
  token will hold or gain value. Never market a token as guaranteed to appreciate.</div>`;

const FOOTER = `<footer>
  <b>Facts, not hype.</b> Every tool link here is real; the buyback lessons teach a <b>mechanic</b> (reduce
  supply / deepen liquidity), never a guarantee of price. A buyback is <b>token management and treasury
  discipline, not an investment promise.</b> This page is <b>read-only</b> — it holds no key and signs nothing;
  every on-chain action is built for you to sign in your own wallet.
  <div style="margin-top:8px"><a href="/">Token Academy</a> ·
    <a href="${esc(ENGINE)}">MELEK-Engine</a> ·
    <a href="${esc(KULA)}">KulaSwap</a> ·
    <a href="${esc(WITNESS)}">Witness School</a> ·
    <a href="${esc(`${LIBRARY}/wiki/${UIA_ARTICLE}`)}">The theory (Library)</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Manage your MELEK-Engine token and do a buyback — a step-by-step how-to: create and issue within an immutable cap, turn on SCOT rewards, burn to reduce supply, and run the cross-chain buyback wizard. Buybacks are token management, never a price-floor promise. Not investment advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<div class="alpha-badge">Alpha</div>
<header class=topbar><a class=brand href="/">🪙 Token Academy <span>· manage &amp; buy back</span></a>
  <div class=topbar-r><a href="/">How-to</a><a href="${esc(ENGINE)}">Engine</a><a href="${esc(KULA)}">KulaSwap</a><a href="${esc(WITNESS)}">Witness School</a><a href="${esc(`${LIBRARY}/wiki/${UIA_ARTICLE}`)}">Theory</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the 7 how-to steps (each: what you DO, the exact tool + link, the Library theory behind it) ────
// Ordered create/issue → SCOT rewards → burn/deflation → buyback wizard → bridge to KulaSwap, per
// the research doc §5. Each `tool` names the surface and links the token-manage page + engine.
export const STEPS = [
  {
    title: 'Create &amp; issue your token — within an immutable cap',
    tag: '<span class="badge live">real today</span>',
    body: `Register your token on MELEK-Engine (<code>tokens.create</code> — symbol, precision, an optional
      <b>immutable supply cap</b>), then mint into circulation with <code>tokens.issue</code>. Locking the cap
      forever is the oldest trust move in this lineage — it descends straight from BitShares'
      <code>lock_max_supply</code> UIA flag: once you renounce the ability to inflate, holders can verify you
      never will.`,
    tool: `Tool: the <a href="${esc(TOKENS_PORTAL)}">Tokens portal</a> &amp; the <a href="${esc(MANAGE)}">token-manage surface</a> on <a href="${esc(ENGINE)}">engine.alpha.melek.salon</a> — it <b>builds</b> the <code>custom_json</code>; you sign it in your own wallet.`,
    ref: libArticle('Hive_Engine_and_Smart_Media_Tokens', 'Hive-Engine / SMTs'),
  },
  {
    title: 'Turn on &amp; tune rewards (SCOT)',
    tag: '<span class="badge live">real today</span>',
    body: `Add a Scot reward rule so posts under your tag earn your token: set the emission per window, the
      window length, the reward curve, and the <b>author / curator split</b>. The ecosystem default we teach is
      <b>65 / 35</b> author-to-curator — real earned utility, described as a reward rule, <b>never</b> as an
      "APY" or a yield you promise.`,
    tool: `Tool: the <b>Rewards (SCOT)</b> card on the <a href="${esc(MANAGE)}">token-manage surface</a> (<code>scot.enable</code>) on <a href="${esc(ENGINE)}">MELEK-Engine</a>.`,
    ref: libArticle('Hive_Engine_and_Smart_Media_Tokens', 'SCOT / side-tokens'),
  },
  {
    title: 'Burn to reduce supply (deflation)',
    tag: '<span class="badge live">real today</span>',
    body: `<code>tokens.burn</code> destroys tokens the treasury holds and lowers circulating supply — the pure
      on-engine deflation lever, needing no market at all. It is the direct descendant of BitShares'
      <code>asset_reserve</code> operation. <b>Deflation is a management lever, not a price promise:</b> reducing
      supply is a supply-side decision you control, not a guarantee about what the market does next.`,
    tool: `Tool: the <b>Supply &amp; burn</b> card on the <a href="${esc(MANAGE)}">token-manage surface</a> (<code>tokens.burn</code>) — builds the op; the public <code>burnLog</code> is the receipt.`,
    ref: libArticle(UIA_ARTICLE, 'Reserve &amp; burn — the UIA lineage'),
  },
  {
    title: 'Do a buyback — the guided wizard',
    tag: '<span class="badge live">Route A today</span> <span class="badge gated">Route B needs PRANA</span>',
    body: `${COMPLIANCE_LINE} The wizard walks two honest routes. <b>Route A (real today):</b> the treasury
      acquires the token off-book and calls <code>tokens.burn</code> — a manual buyback that reduces supply now.
      <b>Route B (activates when PRANA + the bridge are live):</b> bridge the token to PRANA, buy it on the
      KulaSwap AMM, then choose a sink — <b>burn</b> (deflation) or <b>protocol-owned liquidity</b> (lock the
      bought liquidity to deepen the market; "PoL" is market depth, <b>not</b> a promised price). The wizard
      emits each step's op/tx for you to sign; it holds no key.`,
    tool: `Tool: the <b>Buyback wizard</b> at <a href="${esc(MANAGE)}">the token-manage surface</a> → <code>/manage/&lt;SYMBOL&gt;/buyback</code> on <a href="${esc(ENGINE)}">MELEK-Engine</a>.`,
    ref: libArticle(UIA_ARTICLE, 'Buybacks — deflation vs protocol-owned liquidity'),
  },
  {
    title: 'Bridge to PRANA &amp; give your token a market on KulaSwap',
    tag: '<span class="badge gated">needs PRANA</span>',
    body: `The MELEK-Engine has <b>no market on purpose</b> — price discovery and the AMM live on PRANA. To make a
      real (AMM) buyback possible, bridge your token to PRANA and list it on <a href="${esc(KULA)}">KulaSwap</a>:
      swap it, add a liquidity pool, or run a farm. This is the same UIA → order-book step BitShares drew — and
      it is why the market lives on PRANA, not on the engine.`,
    tool: `Tool: <a href="${esc(KULA)}">KulaSwap</a> (kula.money) — the AMM / DEX; the bridge-out step is built on the <a href="${esc(MANAGE)}">token-manage surface</a>.`,
    ref: libArticle('Hive_Engine_and_Smart_Media_Tokens', 'why a market needs an order book'),
  },
  {
    title: 'Automate the buyback from real revenue (optional)',
    tag: '<span class="badge gated">needs PRANA</span>',
    body: `If you want buybacks to be <b>standing</b> rather than one-off, point a slice of your token's real
      revenue — SCOT emission, LP fees, app income — at a community buyback vault that buys and burns (or locks
      as PoL) on a schedule. The rule is <b>buyback from real yield</b>: you can only spend revenue you actually
      earned. The immutable 3% Hathor floor rides along on native-PRANA inflow, funding the founding AI Witness.`,
    tool: `Tool: the automate step in the <b>Buyback wizard</b> on <a href="${esc(ENGINE)}">MELEK-Engine</a> (the revenue-router pattern).`,
    ref: libArticle(UIA_ARTICLE, 'Where the money comes from'),
  },
  {
    title: 'SmartCoin-class features? Use the CDP on PRANA',
    tag: '<span class="badge gated">needs PRANA</span>',
    body: `Collateral-backed, price-fed "advanced tokens" — BitShares' MPAs / SmartCoins / bitAssets, with
      margin calls and settlement — <b>structurally require an on-chain order book</b>. In MELEK's design that
      market is PRANA: the KULA / wMELEK <b>CDP</b> (lock collateral → borrow) is that SmartCoin idea rebuilt on
      our EVM chain. The engine <b>links to</b> it; it never reimplements it.`,
    tool: `Tool: the <b>CDP</b> vaults on <a href="${esc(KULA)}">KulaSwap</a> (PRANA).`,
    ref: libArticle(UIA_ARTICLE, 'The step up to advanced tokens'),
  },
];

// ── / — the action board ────────────────────────────────────────────────────────────────────────
export function homePage() {
  const steps = STEPS.map((s) => `<li>
      <b>${s.title}</b> ${s.tag || ''}
      <div class="muted" style="font-size:14px;margin-top:4px">${s.body}</div>
      <div class="tool">${s.tool}</div>
      ${s.ref ? `<div class="ref">Theory · ${s.ref}</div>` : ''}
    </li>`).join('');

  const body = `<h1>Manage your token &amp; do a buyback</h1>
    <p class=lead>You minted a token — now <b>run it well</b>. This is the operator's how-to: issue within a
      cap you can lock forever, turn on rewards, burn to manage supply, and do a buyback the honest way. Each
      step names the <b>exact tool</b> and links straight to the <a href="${esc(MANAGE)}">token-manage
      surface</a> on <a href="${esc(ENGINE)}">MELEK-Engine</a>; the theory behind it lives in the
      <a href="${esc(`${LIBRARY}/wiki/${UIA_ARTICLE}`)}">Library</a>.</p>

    <blockquote>${COMPLIANCE_LINE}</blockquote>
    ${NOT_ADVICE}

    <div class=card><h2>The how-to — step by step</h2>
      <ol class=steps>${steps}</ol>
    </div>

    <div class=card><h2>Two shapes of a buyback — plainly</h2>
      <p class="muted" style="font-size:14px"><b>Buyback → burn</b> is deflation: revenue buys the token and
        destroys it, so circulating supply falls. <b>Buyback → protocol-owned liquidity (PoL)</b> deepens the
        market: revenue buys the token and <b>locks it as liquidity</b> rather than burning it. Both are
        treasury decisions you make with money you actually earned. Neither is a promise about price — "PoL
        floor" means market <em>depth</em>, not a guaranteed value. Choose the one that fits your goal; the
        wizard builds either.</p>
    </div>

    <div class=card><h2>Where the market lives — and why</h2>
      <p class="muted" style="font-size:14px">The MELEK-Engine mints, rewards, and burns; it has <b>no order
        book by design</b>. Price discovery, the AMM, liquidity pools, and collateral (CDP) all live on
        <b>PRANA / <a href="${esc(KULA)}">KulaSwap</a></b>. This is the same line BitShares drew between a plain
        User-Issued Asset and its market-pegged "advanced" tokens: the moment a feature needs live trades, it
        needs a market — so we put the market on PRANA. Read the full lineage in the
        <a href="${esc(`${LIBRARY}/wiki/${UIA_ARTICLE}`)}">Library article</a>, and see the operate/mint
        companion on <a href="${esc(WITNESS)}/academy">Witness School</a>.</p>
    </div>`;

  return page(`${SITE_NAME} — manage your token & do a buyback`, body, { canonical: `${BASE_URL}/` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

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
        path: u, lastmod: today, changefreq: u === '/' ? 'weekly' : 'monthly', priority: u === '/' ? '1.0' : '0.6',
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
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'How-to for token issuers: create/issue within an immutable cap, configure SCOT rewards, burn for deflation, and run the cross-chain buyback wizard (bridge to KulaSwap on PRANA). A buyback is token-management / deflation, never a price-floor or appreciation promise. Educational, not investment advice.',
        links: [
          { label: 'Manage your token & do a buyback (how-to)', path: '/' },
          { label: 'MELEK-Engine token-manage surface', url: MANAGE },
          { label: 'KulaSwap (market, on PRANA)', url: KULA },
          { label: 'Token Buybacks, Market Fees & the UIA Lineage (theory)', url: `${LIBRARY}/wiki/${UIA_ARTICLE}` },
        ],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    // unknown → home (never a 500)
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/academy-token\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
