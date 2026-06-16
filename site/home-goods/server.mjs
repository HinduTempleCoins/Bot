// server.mjs — Home.SoapBox.Community. The HOME vertical as a standalone HTTP service in the SoapBox
// house style (mirrors site/coupons/server.mjs and site/travel/server.mjs). Operator (Jun-4, L6853)
// named Shopping/Travel/Home as siblings to the live Coupons/A Buck/Stores set.
//
// There is no free, keyless live feed for home-goods prices or contractor quotes (Angi/Thumbtack/
// HomeAdvisor all gate behind paid lead-gen APIs), so — like the repo's other no-live-data verticals —
// Home is a CURATED DIRECTORY in two parts:
//   1. Home services & improvement — the honest comparison doorways (contractors, movers, solar,
//      broadband, cell plans, electricity, home security, self-storage). Source of truth = the shared
//      aggregator-directory (group=home-services) so it never drifts from the rest of the ecosystem.
//   2. Home goods & furnishings — a curated store list (Wayfair, Home Depot, Lowe's, IKEA, Overstock),
//      each cross-linked to its coupons on the Coupons subdomain (Coupons surfaced through Shopping).
// Outbound links route through affiliate.trackedLink() (works unmonetized until env ids are set).
//
//   PORT=8134 BASE_URL=https://home.soapbox.community node site/home/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the curated home directory — services/improvement doorways + home-goods stores
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   HONEST, NOT PAY-TO-RANK. Doorways/stores are listed in a fixed order, never reordered by commission.
//   Outbound links route through the shared affiliate engine (unmonetized until env ids are set) and
//   carry the FTC disclosure. NO data-selling. Soft-fail: every route renders even if the directory
//   module is unavailable — never throws. esc() on every interpolated value. A directory, not advice.

import { createServer } from 'node:http';

import * as affiliate from '../../integrations/affiliate.mjs';
import { listByGroup, BRAND_GUARDRAIL } from '../../integrations/aggregator-directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8134);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.DATA_SITE || 'https://data.soapbox.community';
const SHOPPING = process.env.SHOPPING_SITE || 'https://shopping.soapbox.community';
const COUPONS = process.env.COUPONS_SITE || 'https://coupons.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const SITE_NAME = 'SoapBox Home';

// ── shared house-style helpers (same dark theme as Coupons/Hemp/Law/Stocks/Travel) ────────────────
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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .sec .x{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:var(--blue)}
  .rec{padding:11px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .verify{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .empty{color:var(--mut);padding:12px 0}
  .ftc-disclosure{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const VERIFY_NOTE = `<div class=verify><b>Prices &amp; quotes change constantly.</b> Product prices, service rates,
  and terms vary by location and time — always verify the current price and scope on the provider's own
  site before you commit.</div>`;

const FOOTER = `<footer>
  <b>Honest ranking, not pay-to-rank.</b> SoapBox Home lists doorways and stores in a fixed order — never
  reordered by commission. Some links are <b>affiliate links</b>; we may earn a commission at no extra cost to
  you, and <b>we never sell your data</b>. Verify current prices on the provider's site.
  <div style="margin-top:8px"><a href="/">Home</a> · <a href="${esc(SHOPPING)}">Shopping</a> · <a href="${esc(COUPONS)}">Coupons</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a></div>
</footer>`;

// ── services doorways (source of truth = the shared aggregator-directory) ───────────────────────────
const FALLBACK_SERVICES = [
  { id: 'contractors', name: 'Contractors', exampleIncumbent: 'Angi / Thumbtack' },
  { id: 'movers', name: 'Movers', exampleIncumbent: 'moving-quote compare' },
  { id: 'solar', name: 'Solar', exampleIncumbent: 'EnergySage' },
  { id: 'broadband', name: 'Broadband', exampleIncumbent: 'BroadbandNow' },
  { id: 'cell-plans', name: 'Cell plans', exampleIncumbent: 'WhistleOut' },
  { id: 'electricity', name: 'Electricity switching', exampleIncumbent: 'energy-switch compare' },
  { id: 'home-security', name: 'Home security', exampleIncumbent: 'home-security compare' },
  { id: 'storage', name: 'Self-storage', exampleIncumbent: 'SpareFoot' },
];

export function services() {
  try {
    const items = listByGroup('home-services');
    if (Array.isArray(items) && items.length) {
      return items.map((v) => ({ id: v.id, name: v.name, exampleIncumbent: v.exampleIncumbent || '' }));
    }
  } catch { /* fall through */ }
  return FALLBACK_SERVICES;
}

const SERVICE_DESC = {
  contractors: 'Get quotes from local pros for remodels and repairs.',
  movers: 'Compare moving-company quotes by date and distance.',
  solar: 'Compare rooftop-solar quotes and payback before you sign.',
  broadband: 'Compare internet plans and speeds available at your address.',
  'cell-plans': 'Compare phone plans by price, data, and coverage.',
  electricity: 'Compare energy suppliers where the market is deregulated.',
  'home-security': 'Compare alarm and camera systems and monitoring plans.',
  storage: 'Find and reserve self-storage units near you.',
};

// ── home-goods stores (curated; cross-linked to Coupons — Coupons surfaced through Shopping) ────────
const HOME_STORES = ['Wayfair', 'Home Depot', "Lowe's", 'IKEA', 'Overstock', 'Williams Sonoma', 'Crate & Barrel'];

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Home — an honest home directory: home-services & improvement (contractors, movers, solar, broadband, security, self-storage) and home-goods stores with coupons. Fixed order, never reordered by commission; affiliate links disclosed; we never sell your data.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({ title, description: desc, canonical, siteName: SITE_NAME });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🏠 SoapBox <span>home</span></a>
  <div class=topbar-r><a href="${esc(SHOPPING)}">Shopping</a><a href="${esc(COUPONS)}">Coupons</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm() {
  return `<form class=hsearch method=get action="https://www.google.com/search"><div class=row>
    <input class=q name="q" placeholder="What do you need? e.g. local contractors, standing desk…" autocomplete=off aria-label="Search home goods and services">
    <button type=submit>Search</button>
  </div></form>`;
}

// ── home — the curated directory ────────────────────────────────────────────────────────────────────
export function homePage() {
  const svc = services();
  const svcCards = svc.map((d) => {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`compare ${d.name.toLowerCase()} quotes`)}`;
    const out = affiliate.trackedLink('impact', searchUrl, { subId: slugify(d.id) });
    const desc = SERVICE_DESC[d.id] || (d.exampleIncumbent ? `Honest comparison — like ${d.exampleIncumbent}, done with disclosure.` : '');
    return `<a class=sec href="${esc(out.url)}" rel="sponsored nofollow noopener" target="_blank">
      <div class=t>${esc(d.name)}</div>
      <div class=d>${esc(desc)}</div>
      <span class=x>Compare ${esc(d.name.toLowerCase())} →${out.tracked ? '' : ' (unmonetized)'}</span>
    </a>`;
  }).join('');

  const storeRows = HOME_STORES.map((s) => {
    const shopUrl = `https://www.google.com/search?q=${encodeURIComponent(`${s} official site`)}`;
    const shop = affiliate.trackedLink('skimlinks', shopUrl, { subId: slugify(s) });
    return `<div class=rec>
      <div class=nm><a href="${esc(COUPONS)}/store?store=${esc(encodeURIComponent(s))}">${esc(s)}</a>
        <a class=badge href="${esc(shop.url)}" rel="sponsored nofollow noopener" target="_blank">shop${shop.tracked ? '' : ' (unmonetized)'}</a></div>
      <div class=meta>Coupon codes &amp; cashback for ${esc(s)} →</div></div>`;
  }).join('');

  const body = `<h1>SoapBox Home <span class=muted style="font-size:14px">· honest home doorways</span></h1>
    <p class=muted>${esc(BRAND_GUARDRAIL)}</p>
    ${searchForm()}
    ${VERIFY_NOTE}
    <div class=card><h2>Home services &amp; improvement</h2>
      <p class=muted style="font-size:13px;margin:0 0 8px">Compare quotes and plans before you commit — listed in a fixed order, never reordered by commission.</p>
      <div class=grid style="margin-top:4px">${svcCards || '<p class=empty>Doorways are temporarily unavailable — please try again shortly.</p>'}</div></div>
    <div class=card><h2>Home goods &amp; furnishings</h2>
      <p class=muted style="font-size:13px;margin:0 0 8px">Each store links to its current coupon codes on <a href="${esc(COUPONS)}">Coupons</a> — surfaced through <a href="${esc(SHOPPING)}">Shopping</a>.</p>
      ${storeRows}</div>
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;
  return page(`${SITE_NAME} — home services, improvement & home goods`, body, { canonical: `${BASE_URL}/` });
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

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: '1.0' }));
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
        summary: 'Honest home directory — home services & improvement (contractors, movers, solar, broadband, security, storage) and home-goods stores with coupons. Fixed order, never reordered by commission; affiliate links disclosed; no data-selling.',
        links: [...services().map((d) => ({ label: d.name, path: '/' })), { label: 'Home-goods coupons', path: COUPONS }],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/home\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Home on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
