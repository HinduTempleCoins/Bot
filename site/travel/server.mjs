// server.mjs — Travel.SoapBox.Community. The TRAVEL vertical as a standalone HTTP service in the
// SoapBox house style (mirrors site/coupons/server.mjs and site/hemp/server.mjs). Operator (Jun-4,
// L6853) named Shopping/Travel/Home as siblings to the live Coupons/A Buck/Stores set.
//
// There is no FREE, keyless live flights/hotels price feed (Skyscanner/Kayak/Booking all gate behind
// paid affiliate APIs), so — exactly like the repo's other no-live-data verticals — Travel is a CURATED
// DIRECTORY: the honest travel-comparison doorways (flights, hotels, car rentals, cruises, vacation
// rentals, parking, tours, travel insurance), each with its honest incumbent and an outbound link
// routed through affiliate.trackedLink(). Source of truth for the doorway list is the shared
// aggregator-directory (group=travel) so it never drifts from the rest of the ecosystem.
//
//   PORT=8133 BASE_URL=https://travel.soapbox.community node site/travel/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the curated travel directory — a card per doorway + a destination search box
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   HONEST, NOT PAY-TO-RANK. Doorways are listed alphabetically/canonically, never reordered by
//   commission. Outbound links route through the shared affiliate engine (works unmonetized until env
//   ids are set) and carry the FTC disclosure. NO data-selling. Soft-fail: every route renders even if
//   the directory module is unavailable — never throws. esc() on every interpolated value. A directory,
//   not travel advice; prices and availability live on the merchant's own site.

import { createServer } from 'node:http';

import * as affiliate from '../../integrations/affiliate.mjs';
import { listByGroup, BRAND_GUARDRAIL } from '../../integrations/aggregator-directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import * as seo from '../../integrations/soapbox/seo.mjs';
import * as guides from '../../integrations/affiliate-guides.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8133);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.DATA_SITE || 'https://data.soapbox.community';
const SHOPPING = process.env.SHOPPING_SITE || 'https://shopping.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const SITE_NAME = 'SoapBox Travel';

// ── shared house-style helpers (same dark theme as Coupons/Hemp/Law/Stocks) ───────────────────────
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

const VERIFY_NOTE = `<div class=verify><b>Prices &amp; availability change constantly.</b> Fares, room rates, and
  terms move minute to minute — always check the current price and policy on the provider's own site before
  you book.</div>`;

const FOOTER = `<footer>
  <b>Honest ranking, not pay-to-rank.</b> SoapBox Travel lists comparison doorways in a fixed order — never
  reordered by commission. Some links are <b>affiliate links</b>; we may earn a commission at no extra cost to
  you, and <b>we never sell your data</b>. Verify current prices on the provider's site.
  <div style="margin-top:8px"><a href="/">Travel</a> · <a href="${esc(SHOPPING)}">Shopping</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a></div>
</footer>`;

// ── doorways: the curated travel directory (source of truth = the shared aggregator-directory) ──────
// Soft-fail: if the directory module is unavailable, fall back to a built-in list so the page still
// renders every doorway. Each doorway carries a generic outbound search routed through the shared
// affiliate engine (unmonetized until env ids are set) — we never hard-code a single vendor as "the" pick.
const FALLBACK_DOORWAYS = [
  { id: 'flights', name: 'Flights', exampleIncumbent: 'Skyscanner / Kayak' },
  { id: 'hotels', name: 'Hotels', exampleIncumbent: 'Trivago / Booking' },
  { id: 'car-rentals', name: 'Car rentals', exampleIncumbent: 'rental aggregator' },
  { id: 'cruises', name: 'Cruises', exampleIncumbent: 'cruise comparison' },
  { id: 'vacation-rentals', name: 'Vacation rentals', exampleIncumbent: 'HomeToGo' },
  { id: 'parking', name: 'Parking', exampleIncumbent: 'SpotHero' },
  { id: 'tours', name: 'Tours & activities', exampleIncumbent: 'Viator' },
  { id: 'travel-insurance', name: 'Travel insurance', exampleIncumbent: 'travel-insurance compare' },
];

export function doorways() {
  try {
    const items = listByGroup('travel');
    if (Array.isArray(items) && items.length) {
      return items.map((v) => ({ id: v.id, name: v.name, exampleIncumbent: v.exampleIncumbent || '' }));
    }
  } catch { /* fall through */ }
  return FALLBACK_DOORWAYS;
}

const DOORWAY_DESC = {
  flights: 'Compare fares across airlines and metasearch — find the cheapest route and date.',
  hotels: 'Compare room rates across booking sites for the same property.',
  'car-rentals': 'Compare rental cars by class, pickup, and total price.',
  cruises: 'Compare cruise lines, cabins, and sail dates.',
  'vacation-rentals': 'Compare whole-home rentals across listing sites.',
  parking: 'Reserve airport and city parking ahead of time.',
  tours: 'Book tours, attractions, and activities at your destination.',
  'travel-insurance': 'Compare trip-protection plans before you go.',
};

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Travel — an honest travel-comparison directory: flights, hotels, car rentals, cruises, vacation rentals, parking, tours, and travel insurance. Listed in a fixed order, never reordered by commission; affiliate links disclosed; we never sell your data.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({ title, description: desc, canonical, siteName: SITE_NAME, jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">✈️ SoapBox <span>travel</span></a>
  <div class=topbar-r><a href="/guides">Guides</a><a href="${esc(SHOPPING)}">Shopping</a><a href="${esc(DATA)}">Data</a><a href="${esc(SEARCH)}">Search</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// A destination-search box that fans out to a generic web search for the typed place (keyless, no API).
function searchForm() {
  return `<form class=hsearch method=get action="https://www.google.com/search"><div class=row>
    <input class=q name="q" placeholder="Where to? e.g. flights to Lisbon, hotels in Tokyo…" autocomplete=off aria-label="Search travel deals">
    <button type=submit>Search</button>
  </div></form>`;
}

// ── home — the curated directory ────────────────────────────────────────────────────────────────────
export function homePage() {
  const list = doorways();
  const cards = list.map((d) => {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`compare ${d.name.toLowerCase()} deals`)}`;
    const out = affiliate.trackedLink('travelpayouts', searchUrl, { subId: slugify(d.id) });
    const desc = DOORWAY_DESC[d.id] || (d.exampleIncumbent ? `Honest comparison — like ${d.exampleIncumbent}, done with disclosure.` : '');
    return `<a class=sec href="${esc(out.url)}" rel="sponsored nofollow noopener" target="_blank">
      <div class=t>${esc(d.name)}</div>
      <div class=d>${esc(desc)}</div>
      <span class=x>Compare ${esc(d.name.toLowerCase())} →${out.tracked ? '' : ' (unmonetized)'}</span>
    </a>`;
  }).join('');
  const body = `<h1>SoapBox Travel <span class=muted style="font-size:14px">· honest comparison doorways</span></h1>
    <p class=muted>${esc(BRAND_GUARDRAIL)}</p>
    ${searchForm()}
    ${VERIFY_NOTE}
    <div class=card><h2>Where are you going?</h2>
      <div class=grid style="margin-top:4px">${cards || '<p class=empty>Doorways are temporarily unavailable — please try again shortly.</p>'}</div></div>
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;
  return page(`${SITE_NAME} — flights, hotels, car rentals & more`, body, { canonical: `${BASE_URL}/` });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...guides.guideSitemapPaths('travel')];

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
        summary: 'Honest travel-comparison directory — flights, hotels, car rentals, cruises, vacation rentals, parking, tours, travel insurance. Fixed order, never reordered by commission; affiliate links disclosed; no data-selling.',
        links: doorways().map((d) => ({ label: d.name, path: '/' })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/guides') {
      return sendHtml(res, page(`Travel guides — ${SITE_NAME}`,
        guides.GUIDE_STYLE + guides.renderGuideIndexBody('travel'),
        { canonical: `${BASE_URL}/guides`, description: 'Honest travel guides — best carry-on luggage, how to find cheap flights and more, compared by value, never by commission.' }));
    }
    if (path.startsWith('/g/')) {
      const g = guides.guideBySlug('travel', path.slice(3));
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
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/travel\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Travel on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
