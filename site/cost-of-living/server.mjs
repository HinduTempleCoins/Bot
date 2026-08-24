// server.mjs — CostOfLiving.SoapBox.Community. A cost-of-living calculator + programmatic per-city
// stats pages, as a standalone zero-dependency HTTP service in the SoapBox house style (mirrors
// site/coupons/server.mjs). It fronts the ALREADY-BUILT, all-free-data engines:
//   - integrations/soapbox/coliving.mjs  (CPI + gas + grocery + metro income, FRED/BLS/Census/USDA,
//     provenance-tagged, confidence-weighted fusion), and
//   - integrations/soapbox/census-acs.mjs (per-place demographics/wages panel).
// Every number carries a source + freshness label. We NEVER invent a figure, and — to stay on the
// right side of Google's thin/doorway-content line — a city page with no real data is rendered as an
// honest "data unavailable" page and marked noindex, never as filler that pretends to have stats.
//
//   PORT=8181 BASE_URL=https://costofliving.soapbox.community node site/cost-of-living/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                 calculator intro + compare form + city directory
//   /city/<slug>      a per-city stats page (gas, groceries, CPI, income, demographics)
//   /compare          ?a=<slug>&b=<slug> → "$X in A ≈ $Y in B" (income-anchored), honest about method
//   /health  /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt

import { createServer } from 'node:http';

import * as coliving from '../../integrations/soapbox/coliving.mjs';
import * as census from '../../integrations/soapbox/census-acs.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8181);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SITE_NAME = 'SoapBox Cost of Living';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── city registry — real Census place FIPS + a metro-name needle for the coliving income match ────
// Seeded with major US cities; each page pulls LIVE data at request time (soft-fails to "unavailable").
export const CITIES = [
  { slug: 'austin-tx',     name: 'Austin, TX',       metro: 'Austin',      state: '48', place: '05000' },
  { slug: 'denver-co',     name: 'Denver, CO',       metro: 'Denver',      state: '08', place: '20000' },
  { slug: 'miami-fl',      name: 'Miami, FL',        metro: 'Miami',       state: '12', place: '45000' },
  { slug: 'portland-or',   name: 'Portland, OR',     metro: 'Portland',    state: '41', place: '59000' },
  { slug: 'nashville-tn',  name: 'Nashville, TN',    metro: 'Nashville',   state: '47', place: '52006' },
  { slug: 'columbus-oh',   name: 'Columbus, OH',     metro: 'Columbus',    state: '39', place: '18000' },
  { slug: 'seattle-wa',    name: 'Seattle, WA',      metro: 'Seattle',     state: '53', place: '63000' },
  { slug: 'phoenix-az',    name: 'Phoenix, AZ',      metro: 'Phoenix',     state: '04', place: '55000' },
  { slug: 'atlanta-ga',    name: 'Atlanta, GA',      metro: 'Atlanta',     state: '13', place: '04000' },
  { slug: 'chicago-il',    name: 'Chicago, IL',      metro: 'Chicago',     state: '17', place: '14000' },
];
const _cityBySlug = new Map(CITIES.map((c) => [c.slug, c]));
export function findCity(slug) { return _cityBySlug.get(String(slug || '').toLowerCase()); }

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:14px 0 8px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  select.q,input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 13px;font-size:15px}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:10px 18px;font-size:15px}
  button:hover{border-color:var(--blue)}
  table.stats{width:100%;border-collapse:collapse;margin:6px 0;font-size:14px}
  .stats th,.stats td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
  .stats th{color:var(--mut);font-weight:600;font-size:13px}
  .src{font-size:11px;color:var(--mut)} .fresh-fresh{color:#3fb950} .fresh-recent{color:#58a6ff} .fresh-aging{color:var(--gold)} .fresh-stale,.fresh-unknown{color:var(--mut)}
  .acs-profile table{width:100%;border-collapse:collapse} .acs-profile td,.acs-profile th{padding:7px 8px;border-bottom:1px solid var(--line);font-size:14px}
  .unavail{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:12px 16px;color:var(--gold);font-size:14px}
  .note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:24px 22px;margin-top:24px;border-top:1px solid var(--line)}
</style>`;

const FOOTER = `<footer>Cost-of-living figures are built from free public data — U.S. Census (ACS), BLS (CPI + gas),
  FRED, and USDA — each labeled with its source and how recent it is. Regional/national series are labeled as such
  and are not presented as measured city prices. <div style="margin-top:6px"><a href="/">Home</a> · <a href="${esc(DATA)}">Data</a></div></footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Cost of living by city — gas, groceries, rent, wages, and demographics from free public data (Census, BLS, FRED, USDA), each labeled with its source and freshness.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({ title, description: desc, canonical, siteName: SITE_NAME, robots, jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🏙️ SoapBox <span>cost of living</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>${FOOTER}</body></html>`;
}

// ── freshness/label helpers ────────────────────────────────────────────────────────────────────────
function money(n) { return n == null ? 'n/a' : `$${Number(n).toLocaleString('en-US')}`; }
function freshBadge(rec) {
  if (!rec) return '';
  const f = esc(rec.freshness || 'unknown');
  return `<span class="src fresh-${f}">${esc(rec.source || '')} · ${f}</span>`;
}

// Count of genuinely-present data points — the thin-content gate. 0 → we do NOT pretend to have stats.
function densityScore(col, prof) {
  let n = 0;
  const comps = (col && col.components) || {};
  for (const k of Object.keys(comps)) if (comps[k] && comps[k].value != null) n++;
  if (prof) for (const k of ['population', 'medianHouseholdIncome', 'medianRent', 'medianAge']) if (prof[k] != null) n++;
  return n;
}

// ── /city/<slug> ────────────────────────────────────────────────────────────────────────────────
export async function cityView(city, { colFetch, censusFetch } = {}) {
  if (colFetch) coliving.__setFetch(colFetch);
  if (censusFetch) census.__setFetch(censusFetch);
  const col = await coliving.costOfLiving({ metro: city.metro, includeGas: true }).catch(() => null);
  const prof = await census.profile({ state: city.state, place: city.place }).catch(() => null);
  if (colFetch) coliving.__setFetch(null);
  if (censusFetch) census.__setFetch(null);

  const density = densityScore(col, prof);
  if (density === 0) {
    // Honest, non-thin: we say plainly we don't have live data yet, and we noindex so it can't be
    // treated as a doorway page. This never fabricates a number.
    return {
      density: 0,
      robots: 'noindex,follow',
      html: `<h1>${esc(city.name)} — cost of living</h1>
        <div class=unavail>We don't have live cost-of-living data for ${esc(city.name)} right now.
          Rather than show made-up figures, we've left this blank — check back soon.</div>
        <p class=muted>Browse other cities from the <a href="/">directory</a>.</p>`,
    };
  }

  const c = (col && col.components) || {};
  const rows = [
    ['Consumer Price Index (national)', c.cpi],
    ['Gasoline, $/gal (US city avg)', c.gas],
    ['Grocery commodity proxy', c.groceries],
    ['Median household income (metro)', c.metro],
  ].map(([label, rec]) => {
    const val = rec && rec.value != null ? esc(Number(rec.value).toLocaleString('en-US')) : 'n/a';
    return `<tr><td>${esc(label)}</td><td>${val}</td><td>${freshBadge(rec)}</td></tr>`;
  }).join('');

  const acsPanel = prof ? census.renderPage(prof) : '<p class=muted>Census demographic profile unavailable.</p>';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Dataset',
    name: `${city.name} cost-of-living & demographic statistics`,
    description: `Cost-of-living indicators and Census demographics for ${city.name}, from free public data.`,
    creator: { '@type': 'Organization', name: 'SoapBox' },
  };

  const html = `<h1>${esc(city.name)} — cost of living &amp; local stats</h1>
    <p class=muted>Free-data indicators for ${esc(city.name)}. National/regional series are labeled as such —
      they are not presented as measured local prices.</p>
    <div class=card><h2>Cost indicators</h2>
      <table class=stats><thead><tr><th>Indicator</th><th>Value</th><th>Source · freshness</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    <div class=card><h2>Local demographics &amp; wages</h2>${acsPanel}</div>
    <p class=note>${esc(census.dataNote())}. Cost indicators fused with confidence ${esc(col && col.confidence != null ? col.confidence : 'n/a')}.</p>`;
  return { density, robots: 'index,follow', html, jsonld };
}

// ── /compare ────────────────────────────────────────────────────────────────────────────────────
export async function compareView(a, b, { censusFetch } = {}) {
  if (!a || !b) return null;
  if (censusFetch) census.__setFetch(censusFetch);
  const [pa, pb] = await Promise.all([
    census.profile({ state: a.state, place: a.place }).catch(() => null),
    census.profile({ state: b.state, place: b.place }).catch(() => null),
  ]);
  if (censusFetch) census.__setFetch(null);

  const ia = pa && pa.medianHouseholdIncome, ib = pb && pb.medianHouseholdIncome;
  let verdict;
  if (ia != null && ib != null && ia > 0) {
    const ratio = ib / ia;
    verdict = `To keep a comparable standard of living, a ${money(ia)} income in ${esc(a.name)} scales to about `
      + `<strong>${money(Math.round(ia * ratio))}</strong> in ${esc(b.name)} (anchored on median household income; `
      + `a rough proxy, not a full basket index).`;
  } else {
    verdict = `<span class=muted>Not enough income data to compare these two right now.</span>`;
  }
  const html = `<h1>${esc(a.name)} vs ${esc(b.name)}</h1>
    <div class=card><p>${verdict}</p>
      <table class=stats><thead><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead>
      <tbody><tr><td>Median household income</td><td>${money(ia)}</td><td>${money(ib)}</td></tr>
      <tr><td>Median rent</td><td>${money(pa && pa.medianRent)}</td><td>${money(pb && pb.medianRent)}</td></tr></tbody></table></div>
    <p class=note>Income-anchored comparison from Census ACS. A full cost-of-living index would weight housing, food,
      transport, and services (BEA Regional Price Parities) — on the roadmap.</p>`;
  return { html };
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const opts = CITIES.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  const cards = CITIES.map((c) => `<a class=sec href="/city/${esc(c.slug)}"><span class=t>${esc(c.name)}</span></a>`).join('');
  const body = `<h1>Cost of Living <span class=muted style="font-size:14px">· by city, from free public data</span></h1>
    <p class=muted>Gas, groceries, rent, wages, and demographics for any city — every figure labeled with its
      source (Census, BLS, FRED, USDA) and how recent it is. Compare two cities:</p>
    <form class=hsearch method=get action="/compare"><div class=row>
      <select class=q name=a aria-label="From city">${opts}</select>
      <span class=muted>vs</span>
      <select class=q name=b aria-label="To city">${opts}</select>
      <button type=submit>Compare</button></div></form>
    <div class=card><h2>Cities</h2><div class=grid>${cards}</div></div>`;
  return page(`${SITE_NAME} — compare cities by cost of living`, body, { canonical: `${BASE_URL}/` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' });
  res.end(html);
}
export const SITEMAP_PATHS = ['/', ...CITIES.map((c) => `/city/${c.slug}`)];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'monthly', priority: u === '/' ? '1.0' : '0.6' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Cost of living by city from free public data (Census, BLS, FRED, USDA), each figure source- and freshness-labeled. Regional series never presented as measured city prices.',
        links: CITIES.map((c) => ({ label: c.name, path: `/city/${c.slug}` })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path.startsWith('/city/')) {
      const city = findCity(path.slice(6));
      if (!city) { res.writeHead(302, { location: '/' }); return res.end(); }
      const view = await cityView(city);
      return sendHtml(res, page(`${city.name} cost of living & stats — ${SITE_NAME}`, view.html,
        { canonical: `${BASE_URL}/city/${city.slug}`, robots: view.robots, jsonld: view.jsonld,
          description: `Cost of living, wages, and demographics for ${city.name} — from free public data (Census, BLS, FRED, USDA).` }));
    }

    if (path === '/compare') {
      const a = findCity(url.searchParams.get('a') || '');
      const b = findCity(url.searchParams.get('b') || '');
      if (!a || !b) { res.writeHead(302, { location: '/' }); return res.end(); }
      const view = await compareView(a, b);
      return sendHtml(res, page(`${a.name} vs ${b.name} cost of living — ${SITE_NAME}`, view.html,
        { canonical: `${BASE_URL}/compare?a=${a.slug}&b=${b.slug}`, robots: 'noindex,follow' }));
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/cost-of-living\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Cost of Living on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
