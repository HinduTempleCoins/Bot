// server.mjs — Shopping.SoapBox.Community. The SHOPPING PARENT HUB in the SoapBox house style
// (mirrors site/coupons/server.mjs and site/hemp/server.mjs). Operator (Jun-4, L6853): Shopping is the
// parent vertical that surfaces COUPONS INSIDE it — coupons already lives on its own subdomain
// (coupons.soapbox.community), so Shopping does NOT re-implement it; it embeds/links coupons + A Buck
// (real under-$2 stores) + a curated store directory + general shopping deals into ONE doorway.
//
//   PORT=8132 BASE_URL=https://shopping.soapbox.community node site/shopping/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            hub home — Coupons-inside card + A Buck card + store directory + a store search box
//   /stores      the curated store directory (categories → stores; each links to coupons per store)
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE (inherited from coupons.mjs + affiliate.mjs) ───────────────────────────────────────
//   HONEST RANKING, NOT PAY-TO-RANK. We never re-rank by commission. Outbound store links route through
//   affiliate.trackedLink() (works unmonetized until publisher ids are set in the env) and carry the FTC
//   disclosure. NO data-selling. Soft-fail: every route renders even with no upstream data — never throws.
//   esc() on every interpolated value. An honest directory, not shopping advice.

import { createServer } from 'node:http';

import * as affiliate from '../../integrations/affiliate.mjs';
import { CATEGORIES } from '../coupons/server.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import * as seo from '../../integrations/soapbox/seo.mjs';
import * as guides from '../../integrations/affiliate-guides.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8132);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.DATA_SITE || 'https://data.soapbox.community';
const COUPONS = process.env.COUPONS_SITE || 'https://coupons.soapbox.community';
const ABUCK = process.env.ABUCK_SITE || 'https://abuck.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const SITE_NAME = 'SoapBox Shopping';

// ── shared house-style helpers (same dark theme as Coupons/Hemp/Law/Stocks/Search) ────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s == null ? '' : s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .rec{padding:11px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .verify{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .empty{color:var(--mut);padding:12px 0}
  .ftc-disclosure{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const VERIFY_NOTE = `<div class=verify><b>Deals change constantly.</b> Codes expire, prices move, and terms vary —
  always verify the current offer on the merchant's own site before you rely on it.</div>`;

const FOOTER = `<footer>
  <b>Honest ranking, not pay-to-rank.</b> SoapBox Shopping ranks deals by real value to you — never by
  commission. Some links are <b>affiliate links</b>; we may earn a commission at no extra cost to you, and
  <b>we never sell your data</b>. Deals move fast — verify the current offer on the merchant's site.
  <div style="margin-top:8px"><a href="/">Shopping</a> · <a href="${esc(COUPONS)}">Coupons</a> · <a href="${esc(ABUCK)}">A Buck</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Shopping — the honest shopping hub: coupon codes & cashback, real under-$2 stores, and a curated store directory. Ranked by value, never by commission; affiliate links disclosed; we never sell your data.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${COUPONS}/store?store={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🛍️ SoapBox <span>shopping</span></a>
  <div class=topbar-r><a href="/guides">Guides</a><a href="/stores">Stores</a><a href="${esc(COUPONS)}">Coupons</a><a href="${esc(ABUCK)}">A Buck</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// Store search posts to the COUPONS subdomain's /store (coupons surfaced inside Shopping).
function searchForm() {
  return `<form class=hsearch method=get action="${esc(COUPONS)}/store"><div class=row>
    <input class=q name="store" placeholder="Store name, e.g. Nike — see its coupons…" autocomplete=off aria-label="Find coupons for a store">
    <button type=submit>Find coupons</button>
  </div></form>`;
}

// ── home — the parent hub ──────────────────────────────────────────────────────────────────────────
export function homePage() {
  const body = `<h1>SoapBox Shopping <span class=muted style="font-size:14px">· the honest shopping hub</span></h1>
    <p class=muted>One doorway to everything we shop honestly: coupon codes &amp; cashback, real under-$2 stores,
      and a curated store directory — all ranked by real value to you, <b>never</b> by what pays us most.</p>
    ${searchForm()}
    <div class=grid style="margin-top:8px">
      <a class=sec href="${esc(COUPONS)}"><div class=t>🏷️ Coupons &amp; cashback</div><div class=d>Coupon codes, deals, and cashback-portal compare across every store — ranked honestly.</div></a>
      <a class=sec href="${esc(ABUCK)}"><div class=t>💲 A Buck — real under-$2 stores</div><div class=d>Stores that genuinely sell at $0.99–$2.00 like Dollar Tree, with a keyless locator.</div></a>
      <a class=sec href="/stores"><div class=t>🛒 Store directory</div><div class=d>Browse stores by category and jump straight to that store's coupons.</div></a>
    </div>
    ${VERIFY_NOTE}
    <div class=card><h2>Coupons, inside Shopping</h2>
      <p class=muted style="font-size:14px">Coupons &amp; cashback live at
        <a href="${esc(COUPONS)}">coupons.soapbox.community</a> and are surfaced here as the hub's first stop.
        Pick a store category below to jump straight to its current codes:</p>
      <div class=grid style="margin-top:8px">
        ${CATEGORIES.map((c) => `<a class=sec href="${esc(COUPONS)}/c/${esc(c.slug)}"><div class=t>${esc(c.name)}</div><div class=d>${esc(c.desc)}</div></a>`).join('')}
      </div>
    </div>
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">We rank by genuine value to the shopper — a recently-verified,
      bigger-savings deal wins. Commission can never reorder the list. Sponsored items are labeled and pushed
      to the end. Some links are affiliate links — disclosed on every page — and <b>we never sell your data</b>.</p>
      <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p></div>`;
  return page(`${SITE_NAME} — coupons, real dollar stores & a store directory`, body, { canonical: `${BASE_URL}/` });
}

// ── /stores — curated store directory ──────────────────────────────────────────────────────────────
// Reuses the coupons vertical's CATEGORIES (single source of truth) so the two never drift. Each store
// links out to its coupons page; the store's primary "shop" outbound goes through the shared tracker.
export function storesPage() {
  const blocks = CATEGORIES.map((c) => {
    const rows = c.stores.map((s) => {
      const shopUrl = `https://www.google.com/search?q=${encodeURIComponent(`${s} official site`)}`;
      const shop = affiliate.trackedLink('skimlinks', shopUrl, { subId: slugify(s) });
      return `<div class=rec>
        <div class=nm><a href="${esc(COUPONS)}/store?store=${esc(encodeURIComponent(s))}">${esc(s)}</a>
          <a class=badge href="${esc(shop.url)}" rel="sponsored nofollow noopener" target="_blank">shop${shop.tracked ? '' : ' (unmonetized)'}</a></div>
        <div class=meta>Coupon codes &amp; cashback for ${esc(s)} →</div></div>`;
    }).join('');
    return `<div class=card><h2>${esc(c.name)}</h2><p class=muted style="font-size:13px;margin:0 0 8px">${esc(c.desc)}</p>${rows}</div>`;
  }).join('');
  const body = `<h1>Store directory</h1>
    <p class=muted>Browse stores by category. Each links to its current coupon codes, deals, and cashback-portal
      compare on <a href="${esc(COUPONS)}">Coupons</a> — all ranked by honest value.</p>
    ${searchForm()}
    ${VERIFY_NOTE}
    ${blocks}
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;
  return page(`Store directory — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/stores` });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/stores', ...guides.guideSitemapPaths('shopping')];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
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
        summary: 'The honest shopping hub — coupons & cashback, real under-$2 stores, and a curated store directory. Ranked by value, never commission; affiliate links disclosed; no data-selling.',
        links: [{ label: 'Store directory', path: '/stores' }, { label: 'Coupons', path: COUPONS }, { label: 'A Buck — real dollar stores', path: ABUCK }],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/stores') return sendHtml(res, storesPage());
    if (path === '/guides') {
      return sendHtml(res, page(`Buying guides — ${SITE_NAME}`,
        guides.GUIDE_STYLE + guides.renderGuideIndexBody('shopping'),
        { canonical: `${BASE_URL}/guides`, description: 'Honest buying guides — best standing desks, office chairs and more, ranked by value, never by commission.' }));
    }
    if (path.startsWith('/g/')) {
      const g = guides.guideBySlug('shopping', path.slice(3));
      if (!g) { res.writeHead(302, { location: '/guides' }); return res.end(); }
      const { html, jsonld } = guides.renderGuideBody(g, { baseUrl: BASE_URL, affiliate, seo });
      return sendHtml(res, page(`${g.title} — ${SITE_NAME}`, guides.GUIDE_STYLE + html,
        { canonical: `${BASE_URL}/g/${g.slug}`, description: g.description, jsonld }));
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/shopping\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Shopping on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
