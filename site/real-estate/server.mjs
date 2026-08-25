// server.mjs — RealEstate.SoapBox.Community. The real-estate vertical as a standalone, zero-dependency
// HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs). It fronts the already-
// built real-estate engine (integrations/soapbox/real-estate.mjs) and binds it into ONE honest surface:
//   - rent / buy / commercial search across the big portals, normalized into one comparable shape,
//   - listings ranked by VALUE (price-per-sqft), never by commission (proven in the engine),
//   - an affordability read (metro median income + 28% front-end DTI rule) from the engine, and
//   - every outbound listing link routed through the affiliate engine (id by env NAME; plain url when
//     unset) with the FTC disclosure on every rendered page (the engine's renderPage guarantees it).
//
//   PORT=8186 BASE_URL=https://real-estate.soapbox.community node site/real-estate/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            portal home — intro + a search form (rent/buy/commercial, area, beds, max price)
//   /search      ?type=&area=&beds=&maxPrice= → searchListings + affordability + renderPage
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   CONTENT + AFFILIATE, NOT A LICENSED BROKER. We do not list, sell, or negotiate real estate; we
//   normalize public listings and route out to the source portals. Ranking is by value (price/sqft),
//   never commission — proven in real-estate.mjs. Affiliate ids come from the environment BY NAME; none
//   stored or fabricated (plain url when unset). FTC disclosure on every page. esc() on every
//   interpolated value. Soft-fail: every route renders even when the engine returns nothing.

import { createServer } from 'node:http';

import * as re from '../../integrations/soapbox/real-estate.mjs';
import { trackedLink, ftcDisclosure } from '../../integrations/affiliate.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8186);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const INSURANCE = process.env.INSURANCE_SITE || 'https://insurance.soapbox.community';
const SITE_NAME = 'SoapBox Real Estate';

// ── shared house-style helpers (same dark theme as Insurance/Coupons) ─────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// the three search types → human labels, from the engine's own PORTALS registry.
export const TYPES = ['rent', 'buy', 'commercial'];
const TYPE_META = {
  rent: { label: 'Rent', note: 'apartments & homes for rent', source: re.PORTALS.rent.source },
  buy: { label: 'Buy', note: 'homes & condos for sale', source: re.PORTALS.buy.source },
  commercial: { label: 'Commercial', note: 'offices, retail & industrial space', source: re.PORTALS.commercial.source },
};

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;min-width:120px}
  input.q{flex:1 1 200px;max-width:320px} input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .real-estate ul.re-list{list-style:none;padding:0;margin:12px 0}
  .real-estate li.re-listing{border-bottom:1px solid var(--line);padding:11px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .re-addr{font-weight:700;font-size:15px} .re-price{color:var(--up);font-weight:700}
  .re-source{color:var(--mut);font-size:12px} .re-badge{font-size:11px;background:#d2992233;color:var(--gold);border-radius:8px;padding:1px 7px}
  .re-afford{background:#3fb95011;border:1px solid var(--up);border-radius:8px;padding:10px 14px;color:var(--up);font-size:13px;margin:12px 0}
  .re-empty{color:var(--mut)} .re-datanote{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  .ftc-disclosure,.note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Honest comparison, not pay-to-rank.</b> SoapBox Real Estate ranks listings by <b>value</b> — price
  per square foot — and <b>never</b> by what a portal pays us. We are <b>not a licensed real-estate
  broker</b>; we don't list, sell, or negotiate property — we normalize public listings and route you to
  the source, and <b>we never sell your data</b>. Some links are affiliate links; we may earn a commission
  at no extra cost to you. Verify every listing, price, and availability on the source portal before you act.
  <div style="margin-top:8px"><a href="/">Real Estate</a> · <a href="${esc(INSURANCE)}">Insurance</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Search homes to rent or buy and commercial space — normalized across the major portals, ranked by value (price per square foot), never by commission, with an affordability read for the area. Not a licensed broker.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/search?area={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🏠 SoapBox <span>real estate</span></a>
  <div class=topbar-r><a href="/">Home</a>${TYPES.map((t) => `<a href="/search?type=${esc(t)}">${esc(TYPE_META[t].label)}</a>`).join('')}<a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── search form ───────────────────────────────────────────────────────────────────────────────────
function searchForm({ type = 'rent', area = '', beds = '', maxPrice = '' } = {}) {
  const opt = (t) => `<option value="${esc(t)}"${t === type ? ' selected' : ''}>${esc(TYPE_META[t].label)}</option>`;
  return `<form class=hsearch method=get action="/search"><div class=row>
    <select class=q name="type" aria-label="Rent or buy">${TYPES.map(opt).join('')}</select>
    <input class=q name="area" value="${esc(area)}" placeholder="City or metro, e.g. Austin" autocomplete=off aria-label="Area">
    <input class=q name="beds" value="${esc(beds)}" placeholder="Beds" inputmode=numeric aria-label="Minimum beds" style="max-width:90px">
    <input class=q name="maxPrice" value="${esc(maxPrice)}" placeholder="Max $" inputmode=numeric aria-label="Max price" style="max-width:120px">
    <button type=submit>Search</button>
  </div></form>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = TYPES.map((t) => {
    const m = TYPE_META[t];
    return `<a class=card style="display:block" href="/search?type=${esc(t)}"><h3 style="margin:0">${esc(m.label)}</h3><div class=muted style="font-size:13px">${esc(m.note)} · ${esc(m.source)}</div></a>`;
  }).join('');
  const body = `<h1>SoapBox Real Estate <span class=muted style="font-size:14px">· ranked by value</span></h1>
    <p class=muted>Search across the major portals, normalized into one comparable list and ranked by
      <b>price per square foot</b> — never by what a portal pays us. We also show whether a place fits the
      classic <b>28% rule</b> for the area's median income.</p>
    ${searchForm()}
    <div style="margin-top:8px">${cards}</div>
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">Listings are ranked by value (price per square foot). Commission
      can never reorder the list, sponsored rows are labeled and segregated to the end, and we <b>never sell
      your data</b>. We are not a licensed broker — verify every listing on the source portal before you act.</p></div>`;
  return page(`${SITE_NAME} — rent, buy & commercial, ranked by value`, body, { canonical: `${BASE_URL}/` });
}

// ── /search — run the engine, render the ranked+affordability page ──────────────────────────────────
// Optionally accepts injected `deps` (tests / a future live adapter) — passed straight to the engine so
// searchListings + affordability run fully offline in tests.
export async function searchView({ type, area, beds, maxPrice } = {}, deps = {}) {
  const t = TYPES.includes(String(type || '').toLowerCase()) ? String(type).toLowerCase() : 'rent';
  const meta = TYPE_META[t];
  if (!area) {
    return {
      type: t,
      html: `<h1>Search ${esc(meta.label.toLowerCase())} listings</h1>${searchForm({ type: t })}`
        + `<p class=muted>Enter a city or metro to see listings, ranked by value.</p>`,
    };
  }

  const bedsN = beds != null && String(beds).trim() !== '' ? Number(beds) : null;
  const maxN = maxPrice != null && String(maxPrice).trim() !== '' ? Number(maxPrice) : null;

  // both engine calls soft-fail internally; the .catch is belt-and-suspenders so a route never throws.
  const listings = await re.searchListings(
    { type: t, area, beds: Number.isFinite(bedsN) ? bedsN : null, maxPrice: Number.isFinite(maxN) ? maxN : null },
    deps,
  ).catch(() => []);

  // affordability context: use the cheapest listing's price (best-case fit) when we have one.
  let aff = null;
  const priced = listings.filter((x) => x && x.price != null).map((x) => x.price);
  if (priced.length) {
    const cheapest = Math.min(...priced);
    aff = await re.affordability({ price: cheapest, area }, deps).catch(() => null);
  }

  // the engine's renderPage does the value-ranking, affiliate-wrapping (trackedLink), and FTC disclosure.
  const section = re.renderPage({
    title: `${meta.label} — ${area}`,
    area, type: t, listings,
    affordability: aff,
    source: meta.source,
    asOf: listings[0] ? listings[0].asOf : undefined,
  });

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${meta.label} listings — ${esc(String(area))} — ${SITE_NAME}`,
    itemListElement: listings.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.address || meta.label })),
  };

  return { type: t, html: `${searchForm({ type: t, area, beds: bedsN ?? '', maxPrice: maxN ?? '' })}${section}`, jsonld };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...TYPES.map((t) => `/search?type=${t}`)];

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
        summary: 'Search rent/buy/commercial listings normalized across the major portals, ranked by value (price/sqft), never commission, with a 28%-rule affordability read. Not a licensed broker; outbound links to source portals; no data-selling.',
        links: TYPES.map((t) => ({ label: `${TYPE_META[t].label} — ${TYPE_META[t].note}`, path: `/search?type=${t}` })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path === '/search') {
      const view = await searchView({
        type: url.searchParams.get('type'),
        area: url.searchParams.get('area'),
        beds: url.searchParams.get('beds'),
        maxPrice: url.searchParams.get('maxPrice'),
      });
      const areaTxt = url.searchParams.get('area') || '';
      const title = areaTxt
        ? `${TYPE_META[view.type].label} in ${areaTxt} — ${SITE_NAME}`
        : `${TYPE_META[view.type].label} listings — ${SITE_NAME}`;
      return sendHtml(res, page(title, view.html, {
        canonical: `${BASE_URL}/search?type=${esc(view.type)}`,
        description: `Search ${esc(TYPE_META[view.type].note)}${areaTxt ? ` in ${esc(areaTxt)}` : ''}, ranked by value (price per square foot), never by commission.`,
        jsonld: view.jsonld || null,
      }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { siteGraph, jsonLdScript, trackedLink, ftcDisclosure };

// Only bind the port when run directly, not when imported by tests. CLI guard scoped to site/real-estate/.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/real-estate\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Real Estate on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
