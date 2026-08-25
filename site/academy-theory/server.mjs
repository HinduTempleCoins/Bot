// server.mjs — Academy Theory: the Witness-School "Theory strand" index for the MELEK community.
// A standalone, zero-dependency HTTP surface in the SoapBox / Witness-School house style (mirrors
// site/academy-econ/server.mjs and site/academy-token/server.mjs). It is the INDEX to the Library of
// Ashurbanipal's "Theory" strand — the four foundational articles a witness, token-creator, or curator
// needs (what a witness is and does; curation theory; PoW vs PoS vs DPoS; the two-token MELEK↔PRANA
// economy) — where each card names the topic, teaches one honest sentence, and links straight to the
// Library article, plus links out to Witness School, Economics 101, and the Token Academy.
//
//   PORT=8203 BASE_URL=https://academy-theory.alpha.melek.salon node site/academy-theory/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the strand index — the four Theory topics with links
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE (load-bearing) ─────────────────────────────────────────────────────────────────────
//   Every topic is EDUCATIONAL / NEUTRAL — consensus and token mechanics, never a signal to buy or
//   sell, never a price prediction. Where economics/tokens are discussed, a not-investment-advice note
//   with no price predictions rides on every page (matching the Economics-101 framing). esc() on every
//   interpolated value. Soft-fail: every route renders even with no upstream. Read-only: this page
//   holds no key and signs nothing.
import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8203);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Academy — Theory';

// Where the cards point — overridable so surfaces can move without touching module copy.
const LIBRARY = (process.env.LIBRARY_URL || 'https://wiki.soapbox.community').replace(/\/$/, '');
const WITNESS = (process.env.WITNESS_URL || 'https://witness.melek.salon').replace(/\/$/, '');
const TOKEN_ACADEMY = (process.env.TOKEN_ACADEMY_URL || 'https://academy.alpha.melek.salon').replace(/\/$/, '');
const ECON_ACADEMY = (process.env.ECON_ACADEMY_URL || 'https://academy-econ.alpha.melek.salon').replace(/\/$/, '');
const libUrl = (slug) => `${LIBRARY}/wiki/${slug}`;

// ── shared house-style helpers (same dark theme as Economics 101 / Token Academy / Witness School) ──
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
  .topics .who{display:inline-block;font-size:11px;font-weight:700;border-radius:8px;padding:1px 8px;margin-left:6px;background:#3fb95022;color:var(--up);vertical-align:middle}
  blockquote{border-left:3px solid var(--gold);margin:10px 0;padding:6px 0 6px 14px;color:var(--fg);font-size:14px}
  .not-advice{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const NOT_ADVICE = `<div class="not-advice" role="note"><b>Not investment advice.</b> The Theory strand is an
  educational reference to how the chain, its consensus, curation, and tokens <b>work</b>. Nothing here is
  financial, legal, or investment advice; nothing here predicts a price; and nothing here is a signal to buy
  or sell. Reward rules are described as rules, never as a promised yield.</div>`;

const FOOTER = `<footer>
  <b>Education, not hype.</b> Every article teaches how something <b>works</b> — consensus, curation, and
  token design — never a guarantee of price and never a signal to buy or sell. This page is <b>read-only</b>:
  it holds no key and signs nothing.
  <div style="margin-top:8px"><a href="/">Theory strand</a> ·
    <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a> ·
    <a href="${esc(WITNESS)}">Witness School</a> ·
    <a href="${esc(ECON_ACADEMY)}">Economics 101</a> ·
    <a href="${esc(TOKEN_ACADEMY)}">Token Academy</a></div>
</footer>`;

// ── the four Theory-strand topics (each: title, audience, one honest sentence, the Library slug) ────
// Slugs match the Library seed-drafts filenames (article title; spaces->_, ", " and " — "->"__").
export const TOPICS = [
  {
    title: 'What a Witness Is and Does',
    slug: 'What_a_Witness_Is_and_Does',
    who: 'for witnesses',
    blurb: 'The elected block-producer role on MELEK: the 21-slot shuffled schedule and 3-second blocks, the block-signing key, the price feed, witness-voted chain parameters, and why the elected-producer model gives DPoS its security, speed, and accountability.',
  },
  {
    title: 'Curation Theory — Rewards, the Auction Window, and Honest Curation',
    slug: 'Curation_Theory__Rewards__the_Auction_Window__and_Honest_Curation',
    who: 'for curators',
    blurb: 'How the curation reward works: the 25%/75% curator/author split and square-root curve, the live 5-minute reverse-auction window (vote at the ~5:20 edge to keep 100%), curation trails, and honest curation vs vote-farming.',
  },
  {
    title: 'Proof of Work, Proof of Stake, and DPoS',
    slug: 'Proof_of_Work__Proof_of_Stake__and_DPoS',
    who: 'foundations',
    blurb: 'The three consensus mechanisms as Sybil-resistance, their decentralization/speed/cost trade-offs, and where the ecosystem sits: MELEK on DPoS (fast social chain) and PRANA on Proof of Stake plus a proof-of-useful-work compute layer.',
  },
  {
    title: 'The Two-Token Economy — MELEK and PRANA',
    slug: 'The_Two-Token_Economy__MELEK_and_PRANA',
    who: 'for token creators',
    blurb: 'The theory behind the turnkey system: issue and earn on MELEK-Engine (mint/burn/rewards, no order book), trade and put to work on PRANA/KulaSwap (AMM + CDP), the 1:1 bridge peg, and the APIS and KULA roles.',
  },
];

// ── / — the strand index ────────────────────────────────────────────────────────────────────────
export function homePage() {
  const items = TOPICS.map((t) => `<li>
      <b>${esc(t.title)}</b> <span class="who">${esc(t.who)}</span>
      <div class="muted" style="font-size:14px;margin-top:4px">${esc(t.blurb)}</div>
      <div class="lnk">Read in the Library · <a href="${esc(libUrl(t.slug))}">${esc(t.title)}</a></div>
    </li>`).join('');

  const body = `<h1>Theory strand</h1>
    <p class=lead>The theory a witness, curator, or token-creator needs — four foundational articles in the
      <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a>, the reading behind the Witness School modules.
      Each teaches how something <b>works</b>, plainly and neutrally, and links to the full cited article.</p>

    <blockquote>These are <b>mechanics</b>, not tips. They explain how consensus, curation, and token design
      work — they never tell you what to buy or sell, and they never predict a price.</blockquote>
    ${NOT_ADVICE}

    <div class=card><h2>The strand</h2>
      <ol class=topics>${items}</ol>
    </div>

    <div class=card><h2>Keep learning</h2>
      <p class="muted" style="font-size:14px">This strand is the <b>theory</b> layer. For the hands-on course
        and contribution-earning modules, see <a href="${esc(WITNESS)}">Witness School</a>. For the money and
        market basics, read <a href="${esc(ECON_ACADEMY)}">Economics 101</a>. When you are ready to run a token
        yourself, the <a href="${esc(TOKEN_ACADEMY)}">Token Academy</a> is the step-by-step how-to (issue,
        rewards, burn, buyback). The full articles, with citations, live in the
        <a href="${esc(LIBRARY)}">Library of Ashurbanipal</a>.</p>
    </div>`;

  return page(`${SITE_NAME} — witness, curation & token theory`, body, { canonical: `${BASE_URL}/` });
}

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'The Theory strand for the MELEK community: what a witness is and does, curation theory (rewards & the auction window), Proof of Work vs Proof of Stake vs DPoS, and the two-token MELEK↔PRANA economy. Consensus, curation, and token mechanics — educational, not investment advice, no price predictions.';
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
<header class=topbar><a class=brand href="/">🏛️ Theory strand <span>· witness · curation · tokens</span></a>
  <div class=topbar-r><a href="/">Strand</a><a href="${esc(LIBRARY)}">Library</a><a href="${esc(WITNESS)}">Witness School</a><a href="${esc(ECON_ACADEMY)}">Economics 101</a><a href="${esc(TOKEN_ACADEMY)}">Token Academy</a></div></header>
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
        summary: 'Theory-strand index for the MELEK community — four Library of Ashurbanipal articles: what a witness is and does (block production & DPoS), curation theory (rewards, the reverse-auction window, honest curation vs vote-farming), Proof of Work vs Proof of Stake vs DPoS, and the two-token MELEK↔PRANA economy (MELEK-Engine issuance, KulaSwap trading, APIS & KULA). Educational consensus/curation/token mechanics; never a buy/sell signal, never a price prediction; not investment advice.',
        links: [
          { label: 'Theory strand index', path: '/' },
          ...TOPICS.map((t) => ({ label: t.title, url: libUrl(t.slug) })),
          { label: 'Witness School', url: WITNESS },
          { label: 'Economics 101', url: ECON_ACADEMY },
          { label: 'Token Academy (how-to)', url: TOKEN_ACADEMY },
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
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/academy-theory\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
