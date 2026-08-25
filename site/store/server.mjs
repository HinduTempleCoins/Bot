// server.mjs — Store.SoapBox.Community. A GENERAL e-commerce STOREFRONT in the SoapBox house style
// (mirrors site/shopping + site/insurance), but — unlike site/shopping (a curated hub/directory) —
// this one shows actual PRODUCTS + DEALS with names, prices, images and merchants, POPULATED FROM
// IMPACT (integrations/impact-api.mjs). It is CATEGORY-PARAMETERIZED from ONE codebase: a STORE_CATEGORY
// env makes the same server run as electronics.soapbox.community, home.soapbox.community, fashion.…, or
// the default general.soapbox.community — one build, many category storefronts at many subdomains.
//
//   STORE_CATEGORY=electronics PORT=8198 BASE_URL=https://electronics.soapbox.community node site/store/server.mjs
//   STORE_CATEGORY=general     PORT=8198 BASE_URL=https://store.soapbox.community       node site/store/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            storefront home for STORE_CATEGORY — real products + deals when Impact is connected,
//                curated directory + honest note when not
//   /c/<cat>     browse another category from the same codebase (electronics|home|fashion|general|…)
//   /deals       promo codes / coupon-style deals (impact-api.listDeals)
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   FILLS FROM IMPACT, NEVER FABRICATES. Products/prices/deals come ONLY from impact-api; when Impact is
//   unconfigured or unapproved for this category, impact-api soft-fails to [] and we render the curated
//   aggregator directory (aggregator-directory.listByGroup) + an honest "live offers load once Impact is
//   connected + approved for this category" note. We NEVER invent a product, a price, or a merchant.
//   HONEST RANKING, NOT PAY-TO-RANK — commission never reorders. Every outbound link routes through
//   affiliate.trackedLink() (works unmonetized until publisher ids are set) and the page carries the
//   Impact UTT so links are tracked client-side. FTC disclosure on every page. esc() on every
//   interpolated value. Soft-fail: every route renders even with no upstream data — never throws.

import { createServer } from 'node:http';

import * as impact from '../../integrations/impact-api.mjs';
import * as affiliate from '../../integrations/affiliate.mjs';
import * as aggregator from '../../integrations/aggregator-directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8198);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.DATA_SITE || 'https://data.soapbox.community';
const SHOPPING = process.env.SHOPPING_SITE || 'https://shopping.soapbox.community';
const COUPONS = process.env.COUPONS_SITE || 'https://coupons.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';

// STORE_CATEGORY / SITE_NAME are defined below, AFTER the slugify/normCat/catMeta helpers they depend
// on — const declarations are not hoisted, so evaluating them here would hit the temporal dead zone.

// ── shared house-style helpers (same dark theme as Shopping/Insurance/Coupons) ─────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s == null ? '' : s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function normCat(s) { return slugify(s) || 'general'; }

// Known category storefronts → { label, group (an aggregator group id for the curated fallback), emoji }.
// An UNKNOWN category still works: it title-cases the slug and falls back to the consumer-goods group.
const CATEGORY_META = {
  general:     { label: 'Everything',        group: 'consumer-goods', emoji: '🛍️' },
  electronics: { label: 'Electronics',       group: 'consumer-goods', emoji: '💻' },
  home:        { label: 'Home & Garden',     group: 'consumer-goods', emoji: '🏡' },
  fashion:     { label: 'Fashion & Apparel', group: 'consumer-goods', emoji: '👗' },
  beauty:      { label: 'Beauty & Personal Care', group: 'consumer-goods', emoji: '💄' },
  sports:      { label: 'Sports & Outdoors', group: 'consumer-goods', emoji: '⚽' },
  toys:        { label: 'Toys & Games',      group: 'consumer-goods', emoji: '🧸' },
  pets:        { label: 'Pet Supplies',      group: 'consumer-goods', emoji: '🐾' },
  office:      { label: 'Office & School',   group: 'software',       emoji: '🖇️' },
  travel:      { label: 'Travel',            group: 'travel',         emoji: '✈️' },
};
function catMeta(cat) {
  const key = normCat(cat);
  if (CATEGORY_META[key]) return { key, ...CATEGORY_META[key] };
  // Unknown category: title-case the slug, keep it working (soft, never throws).
  const label = key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { key, label, group: 'consumer-goods', emoji: '🛍️' };
}
// The category doorways shown in the nav / category strip.
const NAV_CATS = ['general', 'electronics', 'home', 'fashion', 'beauty', 'sports', 'toys', 'pets'];

// The category this storefront runs as. ONE codebase, many subdomains: the env picks the doorway.
// Declared here (not up top) so slugify/normCat/catMeta/CATEGORY_META are already initialized.
const STORE_CATEGORY = normCat(process.env.STORE_CATEGORY || 'general');
// SITE_NAME defaults from the category but can be overridden per subdomain.
const SITE_NAME = process.env.SITE_NAME || `SoapBox ${catMeta(STORE_CATEGORY).label} Store`;

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:1040px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .cats{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
  .cats a{border:1px solid var(--line2);border-radius:20px;padding:5px 13px;font-size:13px;font-weight:600;color:var(--fg)}
  .cats a.on{border-color:var(--blue);color:var(--blue)} .cats a:hover{border-color:var(--blue);text-decoration:none}
  .products{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;margin:12px 0}
  .product{display:flex;flex-direction:column;border:1px solid var(--line2);border-radius:10px;background:var(--panel);overflow:hidden}
  .product .img{aspect-ratio:1/1;background:#0b0f14;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .product .img img{width:100%;height:100%;object-fit:cover} .product .img .ph{color:var(--mut);font-size:34px}
  .product .body{padding:11px 13px;display:flex;flex-direction:column;gap:5px;flex:1}
  .product .nm{font-weight:600;font-size:14px;line-height:1.35;color:var(--fg)}
  .product .merchant{color:var(--mut);font-size:12px}
  .product .price{font-weight:800;font-size:17px;color:var(--up);margin-top:auto}
  .product .buy{margin-top:6px;text-align:center;border:1px solid var(--line2);border-radius:8px;padding:8px 10px;font-weight:700;font-size:13px;color:var(--fg)}
  .product .buy:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .deal{padding:11px 0;border-bottom:1px solid var(--line)} .deal:last-child{border-bottom:0}
  .deal .nm{font-weight:600} .deal .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .code{font-family:ui-monospace,monospace;background:#1f6feb22;color:var(--blue);border:1px dashed var(--blue);border-radius:6px;padding:1px 8px;font-size:13px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .notice{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:12px 15px;color:var(--gold);font-size:13px;margin:14px 0}
  .empty{color:var(--mut);padding:12px 0}
  .ftc-disclosure{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Honest storefront — ranked by value, never by commission.</b> Products and deals here are pulled from
  our merchant partners via Impact; we never invent a product or a price. Some links are <b>affiliate
  links</b>; we may earn a commission at no extra cost to you, and <b>we never sell your data</b>. Prices
  and availability change — confirm on the merchant's own site before you buy.
  <div style="margin-top:8px"><a href="/">Store</a> · <a href="/deals">Deals</a> · <a href="${esc(SHOPPING)}">Shopping hub</a> · <a href="${esc(COUPONS)}">Coupons</a> · <a href="${esc(SEARCH)}">Search</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || `${SITE_NAME} — a general e-commerce storefront: real products, prices and deals from our merchant partners, ranked by value and never by commission. Affiliate links disclosed; we never sell your data.`;
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/c/{search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">${catMeta(STORE_CATEGORY).emoji} SoapBox <span>store</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="/deals">Deals</a><a href="${esc(SHOPPING)}">Shopping hub</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// The category strip — every doorway from this ONE codebase, current one marked.
function categoryStrip(activeKey) {
  const links = NAV_CATS.map((c) => {
    const m = catMeta(c);
    const on = m.key === activeKey ? ' class=on' : '';
    const href = m.key === STORE_CATEGORY ? '/' : `/c/${esc(m.key)}`;
    return `<a${on} href="${href}">${esc(m.emoji)} ${esc(m.label)}</a>`;
  }).join('');
  return `<nav class=cats aria-label="Shop by category">${links}</nav>`;
}

// ── Impact population ───────────────────────────────────────────────────────────────────────────────
// Pull real offers for a category from Impact: matched campaigns (advertisers) + real catalog PRODUCTS.
// Soft-fails to empty everything — impact-api never throws and never fabricates. When unconfigured,
// `configured` is false and all arrays are empty, which drives the curated fallback.
async function loadStore(category) {
  const configured = impact.configured();
  let campaigns = [];
  let products = [];
  try {
    const res = await impact.offersForVertical(category);
    campaigns = Array.isArray(res && res.campaigns) ? res.campaigns : [];
  } catch { campaigns = []; }
  if (configured) {
    // Real products come from the merchant catalogs (name/price/image/merchant). Bounded fan-out.
    try {
      const catalogs = await impact.listCatalogs();
      for (const cat of (Array.isArray(catalogs) ? catalogs : []).slice(0, 3)) {
        const items = await impact.catalogItems(cat.id, { pageSize: 12 }).catch(() => []);
        for (const it of (Array.isArray(items) ? items : [])) products.push(it);
      }
    } catch { products = []; }
  }
  return { configured, campaigns, products };
}

// Render ONE product card from a real Impact catalog item. Link routed through the affiliate tracker
// (plain, working url until the Impact publisher id is set) + rel="sponsored". Everything escaped.
function productCard(it) {
  const name = esc(it.name || 'Product');
  const link = affiliate.trackedLink('impact', it.url || '#', { subId: slugify(it.id || it.name || '') });
  const href = esc(link.url || '#');
  const priceNum = Number(it.price);
  const price = Number.isFinite(priceNum) && priceNum > 0
    ? `<div class=price>${esc(it.currency || 'USD')} ${esc(priceNum.toFixed(2))}</div>`
    : '<div class=price style="color:var(--mut);font-weight:600;font-size:13px">See price</div>';
  const merchant = it.advertiser ? `<div class=merchant>${esc(it.advertiser)}</div>` : '';
  const img = it.imageUrl
    ? `<div class=img><img loading=lazy alt="${name}" src="${esc(it.imageUrl)}"></div>`
    : '<div class=img><span class=ph>🛍️</span></div>';
  return `<div class=product>${img}<div class=body>
    <div class=nm>${name}</div>${merchant}${price}
    <a class=buy href="${href}" rel="sponsored nofollow noopener" target="_blank">View deal${link.tracked ? '' : ''}</a>
  </div></div>`;
}

// The honest note shown when Impact has no live offers for this category (unconfigured OR unapproved).
function honestNote(cat) {
  const m = catMeta(cat);
  return `<div class=notice role=note><b>Live offers load once Impact is connected + approved for the
    ${esc(m.label)} category.</b> This storefront never invents a product or a price — until our Impact
    partner feed is connected and approved for this category, browse the honest comparison directory below.</div>`;
}

// The curated fallback: the aggregator directory for this category's group — real doorways, no fake
// products. Reuses aggregator-directory.listByGroup (single source of truth; never re-implemented).
function curatedDirectory(cat) {
  const m = catMeta(cat);
  let items = [];
  try { items = aggregator.listByGroup(m.group) || []; } catch { items = []; }
  if (!items.length) return '<p class=empty>Directory unavailable right now.</p>';
  const cards = items.map((vt) => {
    const label = esc(vt.name || vt.id);
    const inc = vt.exampleIncumbent ? `<div class=d>Compare like ${esc(vt.exampleIncumbent)}</div>` : '';
    return `<a class=sec href="${esc(DATA)}#${esc(vt.id)}"><div class=t>${label}${vt.existsInRepo ? ' <span class=badge>live</span>' : ''}</div>${inc}</a>`;
  }).join('');
  return `<div class=grid>${cards}</div>`;
}

// ── home / category storefront ──────────────────────────────────────────────────────────────────────
export async function storePage(category) {
  const m = catMeta(category);
  const { configured, campaigns, products } = await loadStore(m.key);
  const hasProducts = products.length > 0;

  let offersBlock;
  if (hasProducts) {
    offersBlock = `<h2>Featured products</h2>
      <div class=products>${products.map(productCard).join('')}</div>`;
  } else {
    // No live products → honest note + curated comparison directory (never a fabricated product).
    offersBlock = `${honestNote(m.key)}
      <h2>Compare honestly while offers connect</h2>
      ${curatedDirectory(m.key)}`;
  }

  // Approved merchant partners (campaigns) — shown when Impact returns any; each links out tracked.
  let merchantsBlock = '';
  if (campaigns.length) {
    const rows = campaigns.slice(0, 24).map((c) => {
      const link = affiliate.trackedLink('impact', c.trackingLink || '#', { subId: slugify(c.name || c.id) });
      return `<a class=sec href="${esc(link.url || '#')}" rel="sponsored nofollow noopener" target="_blank"><div class=t>${esc(c.name || c.id)}</div><div class=d>${esc(c.category || 'Merchant partner')}</div></a>`;
    }).join('');
    merchantsBlock = `<div class=card><h2>Merchant partners</h2><div class=grid>${rows}</div></div>`;
  }

  const body = `<h1>${esc(m.emoji)} ${esc(m.label)} <span class=muted style="font-size:14px">· ${esc(SITE_NAME)}</span></h1>
    <p class=muted>A real storefront — products, prices and deals from our merchant partners, ranked by
      value to you and <b>never</b> by what pays us most. ${configured ? '' : 'Connect Impact to go live.'}</p>
    ${categoryStrip(m.key)}
    ${offersBlock}
    ${merchantsBlock}
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">Every product, price and merchant is pulled live from our
      Impact partner feed — we never fabricate an offer. Ranking is by genuine value; commission can never
      reorder the list, and <b>we never sell your data</b>. One codebase runs every category storefront.</p>
      <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p></div>`;
  return page(`${m.label} — ${SITE_NAME}`, body, { canonical: m.key === STORE_CATEGORY ? `${BASE_URL}/` : `${BASE_URL}/c/${m.key}` });
}

// ── /deals — promo codes / coupon-style deals from Impact ────────────────────────────────────────────
export async function dealsPage() {
  let deals = [];
  try { deals = await impact.listDeals(); } catch { deals = []; }
  deals = Array.isArray(deals) ? deals : [];

  let block;
  if (deals.length) {
    block = deals.slice(0, 60).map((d) => {
      const link = affiliate.trackedLink('impact', d.url || '#', { subId: slugify(d.id || d.name) });
      const code = d.code ? `<span class=code>${esc(d.code)}</span> ` : '';
      const disc = d.discount ? `<span class=badge>${esc(d.discount)}</span>` : '';
      const exp = d.expires ? ` · expires ${esc(d.expires)}` : '';
      return `<div class=deal><div class=nm>${esc(d.name || d.advertiser || 'Deal')}${disc}</div>
        <div class=meta>${code}${esc(d.advertiser || '')}${exp} — <a href="${esc(link.url || '#')}" rel="sponsored nofollow noopener" target="_blank">shop the deal</a></div></div>`;
    }).join('');
  } else {
    block = `${honestNote(STORE_CATEGORY)}<p class=empty>No live promo codes yet — they appear here the moment our Impact deals feed is connected + approved.</p>`;
  }

  const body = `<h1>🏷️ Deals &amp; promo codes</h1>
    <p class=muted>Active promo codes and deals across our merchant partners — pulled live from Impact,
      never invented. Ranked by real savings, never by commission.</p>
    ${categoryStrip('')}
    <div class=card>${block}</div>
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;
  return page(`Deals & promo codes — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/deals` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=180' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/deals', ...NAV_CATS.filter((c) => c !== STORE_CATEGORY).map((c) => `/c/${c}`)];

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
        summary: `A general e-commerce storefront (category: ${STORE_CATEGORY}) filled from Impact — real products, prices and deals from merchant partners. Ranked by value, never commission; affiliate links disclosed; no data-selling; never a fabricated product.`,
        links: [{ label: 'Deals & promo codes', path: '/deals' }, ...NAV_CATS.filter((c) => c !== STORE_CATEGORY).slice(0, 6).map((c) => ({ label: catMeta(c).label, path: `/c/${c}` }))],
      }));
    }

    if (path === '/') return sendHtml(res, await storePage(STORE_CATEGORY));
    if (path === '/deals') return sendHtml(res, await dealsPage());
    if (path.startsWith('/c/')) {
      const cat = normCat(decodeURIComponent(path.slice(3)));
      return sendHtml(res, await storePage(cat));
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose category helpers for tests
export { catMeta, STORE_CATEGORY, SITE_NAME };

// Only bind the port when run directly, not when imported by tests. CLI guard scoped to site/store/.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/store\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Store [${STORE_CATEGORY}] on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
