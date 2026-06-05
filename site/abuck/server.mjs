// server.mjs — abuck.soapbox.community, the dedicated home of the TRUE-DOLLAR-STORE aggregator.
//
// Operator 2026-06-05: "Put it at abuck.SoapBox.community". This is the full "Real Dollar Stores"
// experience promoted from data.soapbox.community/stores to its own branded site — "A Buck — real
// under-$2 stores". The data site's /stores now 301s here; the family nav links here as "A Buck".
//
//   PORT=8109 BASE_URL=https://abuck.soapbox.community node site/abuck/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the homepage — chain truth table + locator (ZIP/city/lat,lng) + keyless OSM map
//   /health      liveness probe
//   /robots.txt /sitemap.xml
//
// House pattern (matches site/dudael/): pure render functions, esc() on every interpolated value,
// keyless-first (the locator soft-fails to the curated facts table), carries the shared ecosystem nav.
// ALL store logic is reused from integrations/soapbox/cheap-stores.mjs — no logic is duplicated here.

import http from 'node:http';
import { navBar, NAV_STYLE, esc } from '../../integrations/ecosystem-nav.mjs';
import { robotsTxt, sitemapXml } from '../../integrations/soapbox/crawlers.mjs';
import {
  trulyCheapChains, locateStores, renderChainTable, renderResults, googlePlacesStatus,
} from '../../integrations/soapbox/cheap-stores.mjs';

const PORT = +(process.env.PORT || 8109);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || 'https://abuck.soapbox.community').replace(/\/$/, '');

// SoapBox-family dark theme (the data-site palette), plus the cheap-stores table/locator classes the
// shared render helpers emit (cs-*). One stylesheet so the reused render functions look at home here.
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--up:#3fb950;--down:#f85149;--gold:#d29922}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  .navwrap{background:#0a0d12;border-bottom:1px solid var(--line);padding:8px 18px}
  .wrap{max-width:920px;margin:0 auto;padding:34px 22px 80px}
  .eyebrow{color:var(--gold);font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:0 0 8px;font-weight:700}
  h1{font-size:40px;line-height:1.1;margin:0 0 8px;letter-spacing:.4px}
  h1 .buck{color:var(--up)}
  .lede{color:#c9d1d9;font-size:18px;margin:0 0 4px;max-width:680px}
  .sub{color:var(--mut);margin:0 0 24px;max-width:680px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:16px 0}
  .card h2{font-size:16px;margin:0 0 10px;color:var(--fg)}
  .muted{color:var(--mut)}
  .search{width:100%;padding:12px 14px;font-size:16px;background:#0a0d12;border:1px solid var(--line2);border-radius:10px;color:var(--fg)}
  .search:focus{outline:2px solid var(--blue);outline-offset:1px}
  /* cheap-stores render-helper classes (cs-*) — the table + locator share these */
  .cheap-stores-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:4px}
  .cheap-stores-table th,.cheap-stores-table td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  .cheap-stores-table th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .cs-name{font-weight:700;white-space:nowrap} .cs-price{white-space:nowrap;color:#c9d1d9}
  .cs-yes{color:var(--up);font-weight:700} .cs-no{color:var(--down);font-weight:700}
  .cs-closed{color:var(--mut);font-style:italic} .cs-shut{opacity:.62}
  .cs-notes{color:#c9d1d9} .cs-src{color:var(--blue);font-size:12px;white-space:nowrap}
  .cs-how-we-decide{color:var(--mut);font-size:13px;margin-top:12px}
  .cs-map{margin:4px 0 12px} .cs-map-link{font-size:12px;color:var(--mut);margin:6px 0 0}
  .cs-attr{margin-left:8px}
  .cs-count{font-weight:700;margin:6px 0 10px} .cs-via{color:var(--mut);font-weight:400;font-size:13px}
  .cs-empty{color:var(--mut)}
  .cs-store-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
  .cs-store{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;border:1px solid var(--line);border-radius:9px;padding:9px 12px;background:#0a0d12}
  .cs-store-name{font-weight:700} .cs-store-base{color:var(--up);font-size:13px}
  .cs-store-dist{color:var(--mut);font-size:13px} .cs-store-addr{color:#c9d1d9;font-size:13px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:30px 22px;border-top:1px solid var(--line);line-height:1.8}
</style>`;

// The homepage IS the full Real Dollar Stores experience: locator form + (optional) results + map,
// the honest chain truth table, and the methodology/map provenance — all from cheap-stores.mjs.
export async function homePage(where = '') {
  const q = String(where || '').trim();
  const loc = q ? await locateStores(q).catch(() => ({ where: q, origin: null, results: [], provider: 'none' })) : null;
  const gp = googlePlacesStatus();
  const truly = trulyCheapChains();

  const body = `
  <p class=eyebrow>SoapBox · real under-$2 stores</p>
  <h1>A <span class=buck>Buck</span></h1>
  <p class=lede>Stores that GENUINELY sell at the Dollar Tree model — most of the shelf around $0.99–$2.00 —
    not &ldquo;dollar&rdquo; in name only.</p>
  <p class=sub>${esc(String(truly.length))} chains hold true under-$2 pricing today; we list the
    not-actually-cheap crowd honestly too. Facts with sources, not a verdict.</p>

  <div class=card>
    <h2>Find true dollar stores near you</h2>
    <form method=get action=/><input class=search name=q value="${esc(q)}" placeholder="Enter a ZIP, city, or lat,lng (e.g. 75201 or Dallas, TX)" aria-label="Find true dollar stores near a place" autocomplete=off></form>
  </div>
  ${loc ? `<div class=card><h2>Stores near &ldquo;${esc(loc.where || q)}&rdquo;</h2>${renderResults(loc)}</div>` : ''}

  <div class=card>
    <h2>Who's truly under $2?</h2>
    <p class=muted style="font-size:13px;margin:0 0 8px">Current base prices, verified and sourced. &ldquo;Truly under $2&rdquo; means most of the shelf is genuinely at/below ~$2 — a low fixed price, not just the word &ldquo;dollar&rdquo; in the name.</p>
    ${renderChainTable()}
  </div>

  <div class=card>
    <h2>How we decide &amp; where the map comes from</h2>
    <p class=muted style="font-size:13px">The locator geocodes your place with OpenStreetMap's Nominatim and finds nearby variety stores via the keyless Overpass API, matching them to the curated chains above. The map is a keyless OpenStreetMap embed. ${esc(gp.note)}</p>
  </div>`;

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>A Buck — real under-$2 stores</title>
<meta name=description content="A Buck finds stores that genuinely sell at $0.99–$2.00 like Dollar Tree — honest chain pricing facts (Dollar Tree, Daiso, Target Bullseye's Playground) plus a keyless store locator and OpenStreetMap map. Dollar General & Family Dollar labeled honestly.">
<meta name=robots content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="A Buck">
<meta property="og:title" content="A Buck — real under-$2 stores"><meta property="og:description" content="Stores that genuinely sell at $0.99–$2.00 like Dollar Tree — honest chain facts plus a keyless locator and map.">
<link rel=canonical href="${BASE_URL}/">${STYLE}${NAV_STYLE}</head><body>
<div class=navwrap>${navBar({ current: 'abuck' })}</div>
<main class=wrap>${body}</main>
<footer>A Buck — real under-$2 stores · part of the
  <a href="https://soapbox.community">SoapBox</a> data family.
  <div style="margin-top:6px">Facts with sources, not a verdict · <a href="https://data.soapbox.community">SoapBox Data</a></div>
</footer>
</body></html>`;
}

export async function handler(req, res) {
  try {
    const u = new URL(req.url, BASE_URL);
    if (u.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (u.pathname === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemapXml(BASE_URL, [{ url: BASE_URL + '/' }])); }
    if (u.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
      return res.end(await homePage(u.searchParams.get('q') || ''));
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p><a href="/">A Buck — real under-$2 stores</a></p>');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message));
  }
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs') && process.argv[1].includes('abuck')) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`A Buck — real under-$2 stores on http://${HOST}:${PORT}`));
}
