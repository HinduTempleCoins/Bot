// server.mjs — Economics 101 Academy: the money & market basics index for the MELEK token community.
// A standalone, zero-dependency HTTP surface in the SoapBox / Witness-School house style (mirrors
// site/academy-token/server.mjs). It is the INDEX to the Library of Ashurbanipal's Economics 101
// series — seven foundational articles (supply & demand, inflation/deflation, market cap vs FDV,
// buy/sell walls, liquidity & AMMs, tokenomics, and the "selling isn't profit" discipline) — where
// each card names the topic, teaches one honest sentence, and links straight to the Library article
// and to Witness School.
//
//   PORT=8197 BASE_URL=https://academy-econ.alpha.melek.salon node site/academy-econ/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the series index — the seven Economics 101 topics with links
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE (load-bearing) ─────────────────────────────────────────────────────────────────────
//   Every topic is EDUCATIONAL / NEUTRAL — market mechanics, never a signal to buy or sell, never a
//   price prediction, never a "how to pump." Buy/sell walls are explained as mechanics. A not-
//   investment-advice note rides on every page. esc() on every interpolated value. Soft-fail: every
//   route renders even with no upstream. Read-only: this page holds no key and signs nothing.
import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8197);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Economics 101';

// Where the cards point — overridable so surfaces can move without touching module copy.
const LIBRARY = (process.env.LIBRARY_URL || 'https://wiki.soapbox.community').replace(/\/$/, '');
const WITNESS = (process.env.WITNESS_URL || 'https://witness.melek.salon').replace(/\/$/, '');
const TOKEN_ACADEMY = (process.env.TOKEN_ACADEMY_URL || 'https://academy.alpha.melek.salon').replace(/\/$/, '');
const libUrl = (slug) => `${LIBRARY}/wiki/${slug}`;

// ── shared house-style helpers (same dark theme as Token Academy / Witness School) ────────────────
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
  h1{margin:0 0 6px;font-size:28px} h2{font-size:18px;margin:0 0 10px}
  .muted{color:var(--mut)} .lead{font-size:16px;color:var(--mut);max-width:74ch;margin:6px 0 4px}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .topics{counter-reset:topic;list-style:none;padding:0;margin:6px 0}
  .topics li{counter-increment:topic;position:relative;padding:14px 0 14px 44px;border-bottom:1px solid var(--line)}
  .topics li:last-child{border-bottom:0}
  .topics li::before{content:counter(topic);position:absolute;left:0;top:14px;width:30px;height:30px;border-radius:50%;background:#1f6feb33;color:var(--blue);font-weight:800;text-align:center;line-height:30px;font-size:14px}
  .topics li b{color:var(--fg)} .topics .lnk{font-size:13px;margin-top:6px} .topics .lnk a{font-weight:700}
  .badge{display:inline-block;font-size:11px;font-weight:700;border-radius:8px;padding:2px 9px;vertical-align:middle;background:#1f6feb33;color:var(--blue)}
  .badge.priority{background:#d2992233;color:var(--gold)}
  blockquote{border-left:3px solid var(--gold);margin:10px 0;padding:6px 0 6px 14px;color:var(--fg);font-size:14px}
  .not-advice{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const NOT_ADVICE = `<div class="not-advice" role="note"><b>Not investment advice.</b> This is an educational
  index to market and money <b>mechanics</b>. Nothing here is financial, legal, or investment advice; nothing
  here predicts a price; and nothing here is a signal to buy or sell. Buy and sell walls are explained as market
  mechanics, never as a reason to trade.</div>`;

const FOOTER = `<footer>
  <b>Education, not hype.</b> Every topic teaches a <b>mechanic</b> — how prices, supply, and markets work —
  never a guarantee of price and never a signal to buy or sell. This page is <b>read-only</b>: it holds no key
  and signs nothing.
  <div style="margin-top:8px"><a href="/">Economics 101</a> ·
    <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a> ·
    <a href="${esc(WITNESS)}">Witness School</a> ·
    <a href="${esc(TOKEN_ACADEMY)}">Token Academy</a></div>
</footer>`;

// ── the seven Economics 101 topics (each: title, one honest sentence, the Library article slug) ────
// Slugs match the Library seed-drafts filenames (article title, spaces->_, ", "->"__").
export const TOPICS = [
  {
    title: 'Supply and Demand — the Price Basics',
    slug: 'Supply_and_Demand__the_Price_Basics',
    blurb: 'The one mechanism under every price: what buyers want vs what sellers offer, and the price where they meet. Everything else is a refinement of this.',
  },
  {
    title: 'Inflation and Deflation — Token Emission and Burns',
    slug: 'Inflation_and_Deflation__Token_Emission_and_Burns',
    blurb: 'New supply (emission) is inflationary; removing supply (burns, sinks) is deflationary. Neither sets a price on its own — a burn is a supply mechanic, not a promise.',
  },
  {
    title: 'Market Cap vs Fully-Diluted Valuation (FDV)',
    slug: 'Market_Cap_vs_Fully-Diluted_Valuation',
    blurb: 'The #1 beginner mistake: reading a small circulating market cap while ignoring the huge future supply the FDV reveals. Circulating vs total vs max supply.',
  },
  {
    title: 'Order Books, Buy Walls, and Sell Walls',
    slug: 'Order_Books__Buy_Walls__and_Sell_Walls',
    blurb: 'What a wall is, support vs resistance, spoofing and fake walls, and how walls relate to real liquidity and buybacks — grounded in our own order-book readers. A wall is mechanics, never a signal.',
    priority: true,
  },
  {
    title: 'Liquidity, Slippage, and AMMs',
    slug: 'Liquidity__Slippage__and_AMMs',
    blurb: 'Order book vs automated market maker (KulaSwap = a Uniswap-V2 AMM); why thin liquidity means big slippage — you move the price against yourself.',
  },
  {
    title: 'Tokenomics 101',
    slug: 'Tokenomics_101',
    blurb: 'The whole design: supply and caps, distribution, faucets (emission) vs sinks (burns/locks), and emission schedules. Where value comes from and where it goes.',
  },
  {
    title: "Selling Isn't Profit — You Have to Buy to Sell Higher",
    slug: 'Selling_Is_Not_Profit__Buy_to_Sell_Higher',
    blurb: 'The discipline: a sale is only a gain if you bought lower first, and dumping into a thin market sells your own price down. Realized vs unrealized. Buy low first.',
  },
  {
    title: 'The Economics No Coin Dev Teaches — Buybacks, Utility, and Why DevCoin Failed',
    slug: 'The_Economics_No_Coin_Dev_Teaches',
    blurb: 'The capstone: buybacks as commitment, real utility over speculation, and why DevCoin died on oversupply — the economics no coin dev teaches, that MELEK both teaches and practices.',
  },
];

// ── / — the series index ──────────────────────────────────────────────────────────────────────────
export function homePage() {
  const items = TOPICS.map((t) => `<li>
      <b>${esc(t.title)}</b> ${t.priority ? '<span class="badge priority">priority</span>' : ''}
      <div class="muted" style="font-size:14px;margin-top:4px">${esc(t.blurb)}</div>
      <div class="lnk">Read in the Library · <a href="${esc(libUrl(t.slug))}">${esc(t.title)}</a></div>
    </li>`).join('');

  const body = `<h1>Economics 101</h1>
    <p class=lead>The money and market basics a token community needs — seven foundational articles in the
      <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a>. Read them in order, or jump to the one you need.
      Each teaches a <b>mechanic</b>, plainly and neutrally.</p>

    <blockquote>These are <b>market mechanics</b>, not tips. They explain how prices, supply, and markets work —
      they never tell you what to buy or sell, and they never predict a price.</blockquote>
    ${NOT_ADVICE}

    <div class=card><h2>The series</h2>
      <ol class=topics>${items}</ol>
    </div>

    <div class=card><h2>Keep learning</h2>
      <p class="muted" style="font-size:14px">When you are ready to run a token yourself, the
        <a href="${esc(TOKEN_ACADEMY)}">Token Academy</a> is the step-by-step how-to (issue, rewards, burn,
        buyback). For running a witness and building on the chain, see
        <a href="${esc(WITNESS)}">Witness School</a>. The full articles, with citations, live in the
        <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a>.</p>
    </div>`;

  return page(`${SITE_NAME} — money & market basics`, body, { canonical: `${BASE_URL}/` });
}

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Economics 101 for the MELEK token community: supply & demand, inflation vs deflation, market cap vs FDV, buy/sell walls, liquidity & AMMs, tokenomics, and why selling is not profit. Market mechanics, educational — not investment advice, no price predictions.';
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
<header class=topbar><a class=brand href="/">📈 Economics 101 <span>· money &amp; market basics</span></a>
  <div class=topbar-r><a href="/">Series</a><a href="${esc(LIBRARY)}">Library</a><a href="${esc(TOKEN_ACADEMY)}">Token Academy</a><a href="${esc(WITNESS)}">Witness School</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
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
        summary: 'Economics 101 index for the MELEK token community — seven Library of Ashurbanipal articles: supply & demand, inflation/deflation & emission/burns, market cap vs FDV, order books & buy/sell walls, liquidity/slippage/AMMs, tokenomics, and why selling is not profit. Educational market mechanics; never a buy/sell signal, never a price prediction; not investment advice.',
        links: [
          { label: 'Economics 101 series index', path: '/' },
          ...TOPICS.map((t) => ({ label: t.title, url: libUrl(t.slug) })),
          { label: 'Token Academy (how-to)', url: TOKEN_ACADEMY },
          { label: 'Witness School', url: WITNESS },
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
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/academy-econ\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
