// server.mjs — SoftwareReviews.SoapBox.Community. The software / service reviews comparison vertical as a
// standalone, zero-dependency HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs).
// It fronts the already-built software-reviews engine (integrations/soapbox/software-reviews.mjs) and the
// GENERAL affiliate engine, binding them into ONE honest comparison surface:
//   - a category directory (software / B2B SaaS, web hosting, VPN, domain registrars) — the G2 / Capterra
//     space, done honestly,
//   - per-category vendor comparison ranked BY VERIFIED USER RATING (then fit), NEVER by commission,
//   - every outbound "visit" link routed through the affiliate engine (id by env NAME; plain url when
//     unset), and the no-pay-to-rank guarantee + FTC disclosure on every comparison.
//
//   PORT=8183 BASE_URL=https://software-reviews.soapbox.community node site/software-reviews/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /               portal home — category cards + a "what software?" search box
//   /c/<category>   a category page — vendors compared (software-saas|web-hosting|vpn|domains)
//   /compare        ?q=<free text> → matched to a category and redirected (or home if unmatched)
//   /health         liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   Ranking is BY VERIFIED USER RATING then fit, NEVER commission — the G2/Capterra pay-to-rank model
//   INVERTED. The engine proves it (assertRankingUnbiased): a 4.8 always outranks a 4.2, review-count and
//   fit are tiny capped tiebreakers that can never flip a rating gap, and sponsored rows are segregated to
//   the end and labeled. Affiliate ids come from the environment BY NAME; none are stored or fabricated —
//   an unset id returns the plain url. FTC disclosure + the no-pay-to-rank note on every comparison. esc()
//   on every interpolated value. Soft-fail: every route renders even when the engine returns nothing. We
//   never sell your data.

import { createServer } from 'node:http';

import * as reviews from '../../integrations/soapbox/software-reviews.mjs';
import * as affiliate from '../../integrations/affiliate.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8183);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const COUPONS = process.env.COUPONS_SITE || 'https://coupons.soapbox.community';
const SITE_NAME = 'SoapBox Software Reviews';

// ── shared house-style helpers (same dark theme as Coupons/Insurance/Law) ──────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CATS = reviews.CATEGORIES;

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
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .software-reviews table.software-reviews-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
  .software-reviews-table th,.software-reviews-table td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line)}
  .software-reviews-table th{color:var(--mut);font-weight:600;font-size:13px}
  .software-reviews-table tr.sponsored{opacity:.85}
  .badge-sponsored{font-size:11px;background:#d2992233;color:var(--gold);border-radius:8px;padding:1px 7px}
  .no-pay-banner{background:#3fb95011;border:1px solid var(--up);border-radius:8px;padding:10px 14px;color:var(--up);font-size:13px;margin:12px 0}
  .transparency{color:var(--mut);font-size:13px}
  .ftc-disclosure,.note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Honest reviews, not pay-to-rank.</b> SoapBox Software Reviews ranks vendors by <b>verified user rating</b>
  and fit — <b>never</b> by what they pay us (the G2 / Capterra model, inverted). Review-count and fit only
  break ties between equally-rated vendors and can never outweigh a higher rating; sponsored placements are
  labeled, segregated, and never outrank organic results. Some links are affiliate links; we may earn a
  commission at no extra cost to you. <b>We never sell your data.</b> Confirm the current offer on the
  vendor's site before you buy.
  <div style="margin-top:8px"><a href="/">Software Reviews</a> · <a href="${esc(COUPONS)}">Coupons</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Compare software and services honestly — SaaS, web hosting, VPNs, and domain registrars — ranked by verified user rating and fit, never by commission. No pay-to-rank; we never sell your data.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/compare?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🧭 SoapBox <span>software reviews</span></a>
  <div class=topbar-r><a href="/">Home</a>${reviews.listCategories().map((c) => `<a href="/c/${esc(c)}">${esc(CATS[c].label.split(' ')[0])}</a>`).join('')}<a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm() {
  return `<form class=hsearch method=get action="/compare"><div class=row>
    <input class=q name="q" placeholder="What software? e.g. hosting, vpn, crm…" autocomplete=off aria-label="What software are you comparing?">
    <button type=submit>Compare</button>
  </div></form>`;
}

// Match a free-text query to a category key: exact key, then a substring match on key/label. Null if none.
export function matchCategory(q) {
  const s = String(q == null ? '' : q).trim().toLowerCase();
  if (!s) return null;
  if (reviews.isCategory(s)) return s;
  for (const key of reviews.listCategories()) {
    const label = String(CATS[key].label || '').toLowerCase();
    if (key.includes(s) || s.includes(key) || label.includes(s)) return key;
  }
  return null;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = reviews.listCategories().map((c) => {
    const m = CATS[c];
    return `<a class=sec href="/c/${esc(c)}"><div class=t>${esc(m.label)}</div><div class=d>${esc(m.note)}</div></a>`;
  }).join('');
  const body = `<h1>SoapBox Software Reviews <span class=muted style="font-size:14px">· compared honestly</span></h1>
    <p class=muted>Compare software and services by <b>verified user rating and fit</b> — never by what they pay us.
      Pick a category, or tell us what you're comparing:</p>
    ${searchForm()}
    <div class=grid style="margin-top:8px">${cards}</div>
    <div class="no-pay-banner" role="note">${esc(reviews.noPayToRankNote())}</div>
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">Vendors are ranked by verified user rating (0–5), then fit. The
      G2 / Capterra pay-to-rank model is <b>inverted</b> here: commission is never an input to the order, a 4.8
      always outranks a 4.2, and review-count and fit are tiny capped tiebreakers that can never bridge a
      rating gap. Sponsored placements are labeled, segregated to the end, and can never outrank an organic
      result. We <b>never sell your data</b>.</p></div>`;
  return page(`${SITE_NAME} — compare SaaS, hosting, VPN & domains`, body, { canonical: `${BASE_URL}/` });
}

// ── /c/<category> — a category comparison page ─────────────────────────────────────────────────────
// Optionally accepts injected `vendors` (tests / a curated feed) — omitted → engine reads the configured
// source (SOFTWARE_REVIEWS_SOURCE_URL) and soft-fails to [] when unset. renderPage ranks BY RATING and
// wraps every outbound link through vendorOut (affiliate id by env NAME; plain url when unset). Never throws.
export async function categoryView(category, { vendors, need } = {}) {
  const key = String(category || '').trim();
  if (!reviews.isCategory(key)) return null;
  let rows = Array.isArray(vendors) ? vendors : null;
  if (!rows) rows = await reviews.compareSoftware({ category: key, need }).catch(() => []);
  const ranked = reviews.rankByRating(rows);
  const section = reviews.renderPage({ category: key, vendors: rows });
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${CATS[key].label} — ${SITE_NAME}`,
    itemListElement: ranked.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name })),
  };
  return { key, html: section, jsonld, count: ranked.length };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...reviews.listCategories().map((c) => `/c/${c}`)];

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
        summary: 'Compare software / services (SaaS, web hosting, VPN, domains) by verified user rating + fit, never commission. Outbound affiliate links to vendors; no pay-to-rank; no data-selling.',
        links: reviews.listCategories().map((c) => ({ label: CATS[c].label, path: `/c/${c}` })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path === '/compare') {
      const q = url.searchParams.get('q') || url.searchParams.get('category') || '';
      const key = matchCategory(q);
      if (!key) { res.writeHead(302, { location: '/' }); return res.end(); }
      res.writeHead(302, { location: `/c/${key}` });
      return res.end();
    }

    if (path.startsWith('/c/')) {
      const view = await categoryView(decodeURIComponent(path.slice(3)));
      if (!view) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, page(`${CATS[view.key].label} — compare vendors | ${SITE_NAME}`,
        `<h1>${esc(CATS[view.key].label)}</h1>
         <p class=muted>${esc(CATS[view.key].note)}</p>
         <div class="no-pay-banner" role="note">${esc(reviews.noPayToRankNote())}</div>
         ${view.html}`,
        { canonical: `${BASE_URL}/c/${view.key}`, description: `Compare ${CATS[view.key].label.toLowerCase()} by verified user rating and fit — never commission. ${esc(CATS[view.key].note)}`, jsonld: view.jsonld }));
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
export { siteGraph, jsonLdScript, affiliate };

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/software-reviews\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Software Reviews on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
