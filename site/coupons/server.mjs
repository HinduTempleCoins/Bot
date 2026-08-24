// server.mjs — Coupons.SoapBox.Community. The coupons & cashback vertical as a standalone, zero-
// dependency HTTP service in the SoapBox house style (mirrors site/hemp/server.mjs and site/law).
// It fronts the keyless coupons aggregator (integrations/soapbox/coupons.mjs) and the GENERAL
// affiliate engine (integrations/affiliate.mjs) and binds them into ONE cross-linked surface:
//   - a category directory (the Honey/Rakuten/RetailMeNot space, done honestly),
//   - per-store coupon CODES + deals ranked by HONEST value (validity + savings; never commission),
//   - cashback PORTAL compare (Rakuten/Honey/TopCashback/…) as disclosed windowed links, and
//   - EVERY outbound merchant link routed through affiliate.trackedLink() — it works unmonetized
//     until publisher ids are set in the environment, and is always paired with the FTC disclosure.
//
//   PORT=8102 BASE_URL=https://coupons.soapbox.community node site/coupons/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            portal home — category cards + a store search box
//   /c/<slug>    a category page — the stores in that category (each links to its store page)
//   /store       per-store coupons + cashback (?store=nike[&category=...])
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE (inherited from the readers + the rest of SoapBox) ─────────────────────────────────
//   HONEST RANKING, NOT PAY-TO-RANK. Coupons rank by real value to the shopper (validity + savings);
//   sponsored items are labeled and segregated to the end and can never outrank a better deal —
//   proven in coupons.mjs via affiliate.assertRankingUnbiased(). NO data-selling, ever. Affiliate
//   ids come from the environment BY NAME via affiliate.mjs; none are stored here and none are
//   fabricated (unset env → plain url + "unmonetized"). The FTC disclosure is on EVERY page. Deals
//   move constantly, so every page says "deals change — verify on the merchant's site". Soft-fail:
//   every route renders even when a coupon source returns nothing — the page never breaks or throws.
//   esc() on every interpolated value. Not financial/shopping advice — an honest directory only.

import { createServer } from 'node:http';

import * as coupons from '../../integrations/soapbox/coupons.mjs';
import * as affiliate from '../../integrations/affiliate.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import * as seo from '../../integrations/soapbox/seo.mjs';
import * as guides from '../../integrations/affiliate-guides.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8102);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const HEMP = process.env.HEMP_SITE || 'https://hemp.soapbox.community';
const SITE_NAME = 'SoapBox Coupons';

// ── shared house-style helpers (same dark theme as Hemp/Law/Stocks/Search) ────────────────────────
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
  ul.coupon-list,ul.cashback-list{list-style:none;margin:8px 0;padding:0}
  li.coupon-row,li.cashback-row{padding:10px 0;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  li.coupon-row:last-child,li.cashback-row:last-child{border-bottom:0}
  code.coupon-code{background:#0b0f14;border:1px dashed var(--line2);border-radius:4px;padding:2px 8px;font-size:13px;color:var(--gold)}
  .coupon-badge,.offer-badge{font-size:11px;background:#d2992233;color:var(--gold);border-radius:8px;padding:1px 7px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .coupon-empty{color:var(--mut);padding:12px 0} .empty{color:var(--mut);padding:12px 0}
  .as-of{color:var(--mut);font-size:12px} .no-pay-to-rank{color:var(--mut);font-size:13px}
  .ftc-disclosure{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:14px}
  .verify{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// The "deals change" disclaimer — on every coupons/store surface.
const VERIFY_NOTE = `<div class=verify><b>Deals change constantly.</b> Codes expire, rates move, and terms vary —
  always verify the current offer on the merchant's own site before you rely on it. Rates shown on cashback
  portals are set and paid by the portal and read live at click time; we never assert them as fact.</div>`;

// Facts-not-verdicts footer — on EVERY page. Names the honest-ranking posture + the FTC line + no-data-selling.
const FOOTER = `<footer>
  <b>Honest ranking, not pay-to-rank.</b> Coupons.SoapBox ranks deals by real value to you — validity and
  savings — and <b>never</b> by commission. Sponsored items are clearly labeled, segregated, and can never
  outrank a better deal. Some links are <b>affiliate links</b>; we may earn a commission at no extra cost to
  you, and <b>we never sell your data</b>. Deals move fast — verify the current offer on the merchant's site.
  <div style="margin-top:8px"><a href="/">Coupons</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a> · <a href="${esc(HEMP)}">Hemp</a></div>
</footer>`;

// ── store directory (curated, keyless) ────────────────────────────────────────────────────────────
// The categories the home page advertises and the stores under each. This is the directory skeleton;
// per-store coupon CODES come from the (injectable) coupon source at request time — offline that source
// is empty and the store page soft-fails to "no coupons right now", which is honest, not broken.
export const CATEGORIES = [
  { slug: 'fashion', name: 'Fashion & Apparel', desc: 'Clothing, shoes, and accessories.',
    stores: ['Nike', 'Adidas', 'Macy\'s', 'Nordstrom', 'Gap', 'H&M'] },
  { slug: 'electronics', name: 'Electronics & Tech', desc: 'Computers, phones, gadgets, and accessories.',
    stores: ['Best Buy', 'Dell', 'Lenovo', 'Newegg', 'Samsung'] },
  { slug: 'home', name: 'Home & Garden', desc: 'Furniture, decor, tools, and home improvement.',
    stores: ['Wayfair', 'Home Depot', 'Lowe\'s', 'IKEA', 'Overstock'] },
  { slug: 'travel', name: 'Travel', desc: 'Hotels, flights, and car rentals.',
    stores: ['Booking.com', 'Expedia', 'Hotels.com', 'Priceline'] },
  { slug: 'beauty', name: 'Health & Beauty', desc: 'Skincare, cosmetics, and wellness.',
    stores: ['Sephora', 'Ulta', 'iHerb', 'CVS'] },
  { slug: 'department', name: 'Department & General', desc: 'Big-box and general merchandise.',
    stores: ['Amazon', 'Walmart', 'Target', 'Kohl\'s'] },
];

const _catBySlug = new Map(CATEGORIES.map((c) => [c.slug, c]));
export function findCategory(slug) { return _catBySlug.get(String(slug || '').toLowerCase()); }

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Coupons & cashback, ranked by honest value — never by commission. Coupon codes, deals, and cashback-portal compare across every store, with the FTC disclosure on every page. Verify deals on the merchant site.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/store?store={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🏷️ SoapBox <span>coupons</span></a>
  <div class=topbar-r><a href="/guides">Guides</a>${CATEGORIES.map((c) => `<a href="/c/${esc(c.slug)}">${esc(c.name.split(' ')[0])}</a>`).join('')}<a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(action, { value = '', placeholder = 'Store name, e.g. Nike…', label = 'Find coupons', name = 'store' } = {}) {
  return `<form class=hsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    <button type=submit>${esc(label)}</button>
  </div></form>`;
}

// ── home ────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const body = `<h1>SoapBox Coupons <span class=muted style="font-size:14px">· deals, ranked honestly</span></h1>
    <p class=muted>Coupon codes, deals, and cashback-portal compare across every store — ranked by real value to you
      (validity and savings), <b>never</b> by what pays us most. Search a store, or browse a category:</p>
    ${searchForm('/store')}
    <div class=grid style="margin-top:8px">
      ${CATEGORIES.map((c) => `<a class=sec href="/c/${esc(c.slug)}"><div class=t>${esc(c.name)}</div><div class=d>${esc(c.desc)}</div></a>`).join('')}
    </div>
    ${VERIFY_NOTE}
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">We rank coupons by genuine value to the shopper — a recently-verified,
      unexpired, bigger-savings deal wins. Commission can never reorder the list (we prove it in code).
      Sponsored items are labeled and pushed to the end. Some links are affiliate links — disclosed on every page —
      and <b>we never sell your data</b>.</p></div>`;
  return page(`${SITE_NAME} — coupon codes, deals & cashback`, body, { canonical: `${BASE_URL}/` });
}

// ── /c/<slug> — a category page ──────────────────────────────────────────────────────────────────
export function categoryView(cat) {
  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${cat.name} stores — ${SITE_NAME}`,
    itemListElement: cat.stores.map((s, i) => ({
      '@type': 'ListItem', position: i + 1, name: s,
      url: `${BASE_URL}/store?store=${encodeURIComponent(s)}`,
    })),
  };
  const rows = cat.stores.map((s) =>
    `<div class=rec><div class=nm><a href="/store?store=${esc(encodeURIComponent(s))}">${esc(s)}</a></div>
      <div class=meta>Coupon codes &amp; cashback for ${esc(s)} →</div></div>`,
  ).join('');
  const body = `<h1>${esc(cat.name)}</h1>
    <p class=muted>${esc(cat.desc)} Pick a store for its current coupon codes, deals, and cashback-portal compare —
      all ranked by honest value, with the disclosure on every page.</p>
    ${searchForm('/store', { placeholder: `Search within ${cat.name}…` })}
    ${VERIFY_NOTE}
    <div class=card><h2>Stores</h2>${rows}</div>`;
  return { html: body, jsonld: itemList };
}

// ── /store — per-store coupons + cashback ────────────────────────────────────────────────────────
// findCoupons takes an INJECTABLE fetch (offline → []), so tests can pass canned coupons via `data`.
// Cashback portals come from coupons.cashbackCompare(), each routed (in coupons.mjs) through the
// affiliate engine; here we ADDITIONALLY render the store's primary "shop" outbound via
// affiliate.trackedLink() so the shape is the single shared tracking entry point the task wants.
export async function storeView(store, { category, coupons: injected, fetch } = {}) {
  const storeName = String(store == null ? '' : store).trim();
  if (!storeName) {
    return {
      html: `<h1>Find coupons</h1>
        <p class=muted>Enter a store to see its current coupon codes, deals, and cashback-portal compare.</p>
        ${searchForm('/store')}${VERIFY_NOTE}`,
      jsonld: null,
    };
  }

  // coupons: injected (tests) or fetched (offline → [], honest "none right now")
  const list = Array.isArray(injected)
    ? injected
    : await coupons.findCoupons({ store: storeName, category }, { fetch }).catch(() => []);
  const ranked = coupons.rankCoupons(list);

  // the store's primary outbound — through the SINGLE shared tracking entry point.
  const shopUrl = `https://www.google.com/search?q=${encodeURIComponent(`${storeName} official site`)}`;
  const shop = affiliate.trackedLink('skimlinks', shopUrl, { subId: slugify(storeName) });

  const couponRows = ranked.length
    ? ranked.map(renderCouponRow).join('')
    : '<li class="coupon-empty">No coupon codes are listed for this store right now — we never fabricate one. Try a cashback portal below, or check back later.</li>';

  // cashback portals via the coupons module (each already affiliate-tagged + disclosed in that module).
  const cashback = coupons.cashbackCompare(storeName);
  const cashbackRows = cashback.map((c) =>
    `<li class="cashback-row">`
    + `<a href="${esc(c.url)}" rel="sponsored nofollow noopener" target="_blank">${esc(c.portal)}</a>`
    + `<span class=meta>${esc(c.note || '')}</span>`
    + `<span class=meta title="rate read live at the portal">· rate read live at portal</span>`
    + (c.configured ? '' : '<span class=meta>· unmonetized</span>')
    + '</li>',
  ).join('');

  const offerList = ranked.length ? {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${storeName} coupons — ${SITE_NAME}`,
    itemListElement: ranked.map((c, i) => ({
      '@type': 'ListItem', position: i + 1,
      name: `${storeName} — ${c.discount || c.code || (c.type === 'cashback' ? 'cashback' : 'deal')}`,
    })),
  } : null;

  const shopOut = `<p><a href="${esc(shop.url)}" rel="sponsored nofollow noopener" target="_blank">Shop ${esc(storeName)} →</a>`
    + (shop.tracked ? '' : ' <span class=meta>(unmonetized — affiliate id not configured)</span>') + '</p>';

  const body = `<h1>${esc(storeName)} coupons &amp; cashback</h1>
    <p class="as-of">As of ${esc(new Date().toISOString())}</p>
    <p class=no-pay-to-rank>We do not take pay-to-rank. Coupons are ranked by real value to you (validity and savings);
      sponsored items are labeled and can never outrank a better deal. We never sell your data.</p>
    ${VERIFY_NOTE}
    ${shopOut}
    <div class=card><h2>Coupon codes &amp; deals</h2><ul class=coupon-list>${couponRows}</ul></div>
    <div class=card><h2>Cashback portals</h2><ul class=cashback-list>${cashbackRows}</ul></div>
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;

  return { html: body, jsonld: offerList, store: storeName, count: ranked.length };
}

function renderCouponRow(c) {
  const sponsored = c?.sponsored;
  const badge = sponsored ? '<span class="coupon-badge" aria-label="sponsored">Sponsored</span>' : '';
  const code = c?.type === 'code' && c?.code
    ? `<code class="coupon-code">${esc(c.code)}</code>`
    : '<span class="badge">cashback</span>';
  const discount = esc(c?.discount || '');
  const expires = c?.expires ? `<span class=meta>expires ${esc(c.expires)}</span>` : '';
  const verified = c?.verifiedAt ? `<span class=meta>verified ${esc(c.verifiedAt)}</span>` : '';
  const src = c?.sourceUrl
    ? `<a class=meta href="${esc(c.sourceUrl)}" rel="nofollow noopener" target="_blank">source</a>`
    : '';
  return `<li class="coupon-row${sponsored ? ' sponsored' : ''}"${sponsored ? ' data-sponsored="true"' : ''}>`
    + badge + code + `<span class="coupon-discount">${discount}</span>` + expires + verified + src
    + '</li>';
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

// All sitemap-able paths: the home, each category, and a couple of marquee store pages.
export const SITEMAP_PATHS = ['/', ...CATEGORIES.map((c) => `/c/${c.slug}`), ...guides.guideSitemapPaths('coupons')];

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
        path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7',
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
        summary: 'Coupon codes, deals, and cashback-portal compare — ranked by honest value, never by commission. Affiliate links disclosed; no data-selling.',
        links: [
          ...CATEGORIES.map((c) => ({ label: c.name, path: `/c/${c.slug}` })),
          { label: 'Find coupons for a store', path: '/store' },
        ],
      }));
    }

    const sp = url.searchParams;
    if (path === '/') return sendHtml(res, homePage());

    if (path.startsWith('/c/')) {
      const cat = findCategory(path.slice(3));
      if (!cat) { res.writeHead(302, { location: '/' }); return res.end(); }
      const { html, jsonld } = categoryView(cat);
      return sendHtml(res, page(`${cat.name} coupons — ${SITE_NAME}`, html,
        { canonical: `${BASE_URL}/c/${cat.slug}`, jsonld }));
    }

    if (path === '/store') {
      const store = sp.get('store') || '';
      const { html, jsonld, store: name } = await storeView(store, { category: sp.get('category') || '' });
      return sendHtml(res, page(
        name ? `${name} coupons & cashback — ${SITE_NAME}` : `Find coupons — ${SITE_NAME}`,
        html,
        { canonical: name ? `${BASE_URL}/store?store=${encodeURIComponent(name)}` : `${BASE_URL}/store`,
          robots: store ? 'noindex,follow' : 'index,follow', jsonld },
      ));
    }

    if (path === '/guides') {
      return sendHtml(res, page(`Money-saving guides — ${SITE_NAME}`,
        guides.GUIDE_STYLE + guides.renderGuideIndexBody('coupons'),
        { canonical: `${BASE_URL}/guides`, description: 'Honest money-saving guides — how to stack coupons and cashback the right way, and more.' }));
    }
    if (path.startsWith('/g/')) {
      const g = guides.guideBySlug('coupons', path.slice(3));
      if (!g) { res.writeHead(302, { location: '/guides' }); return res.end(); }
      const { html, jsonld } = guides.renderGuideBody(g, { baseUrl: BASE_URL, affiliate, seo });
      return sendHtml(res, page(`${g.title} — ${SITE_NAME}`, guides.GUIDE_STYLE + html,
        { canonical: `${BASE_URL}/g/${g.slug}`, description: g.description, jsonld }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests that want the schema builders directly
export { siteGraph, jsonLdScript };

// Only bind the port when run directly (`node site/coupons/server.mjs`), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/coupons\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Coupons on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
