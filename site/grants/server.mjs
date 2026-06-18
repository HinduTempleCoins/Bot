// site/grants/server.mjs — the SoapBox Grant Aggregator portal (grants.soapbox.community).
// One honest, BY-FIELD map of where the money is: the master search portals first (Grants.gov,
// SAM.gov, Candid), then the big funders per field — research, schools, small business, nonprofits,
// arts, individuals — plus an RFPs & contracts lane. Data = grants-catalog.mjs (pure, link-out).
//
// esc() everywhere, handler(req,res) exported for tests, CLI guarded, no network/keys.
//   PORT=8138 node site/grants/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import {
  FIELDS, GRANTS, field, getGrant, byField, search,
  fieldsWithCounts, validateCatalog, BRAND_GUARDRAIL,
} from '../../integrations/soapbox/grants-catalog.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';

const PORT = +(process.env.PORT || 8138);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || 'https://grants.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const CREDS = process.env.CREDENTIALS_SITE || 'https://credentials.soapbox.community';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const KIND = {
  portal: { label: 'Search portal', cls: 'portal' },
  federal: { label: 'Federal', cls: 'federal' },
  state: { label: 'State / local', cls: 'state' },
  foundation: { label: 'Foundation', cls: 'foundation' },
  fellowship: { label: 'Fellowship', cls: 'fellowship' },
  rfp: { label: 'RFP / contract', cls: 'rfp' },
};

const STYLE = `<style>
  :root{--bg:#0e1116;--fg:#e7edf3;--mut:#9fb0c0;--bd:#26303c;--card:#151b23;--accent:#46b98a;
    --portal:#46b98a;--federal:#4c8dff;--state:#7bb3ff;--foundation:#b98be0;--fellowship:#d9a441;--rfp:#e08b8b}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:inherit} .wrap{max-width:980px;margin:0 auto;padding:0 18px 60px}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;text-decoration:none} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r a{margin-left:14px;color:var(--mut);text-decoration:none;font-size:14px} .topbar-r a:hover{color:var(--fg)}
  h1{font-size:30px;margin:26px 0 6px} h2{font-size:20px;margin:28px 0 10px}
  .muted{color:var(--mut)} .lead{color:var(--mut);max-width:72ch}
  .guardrail{margin:16px 0;padding:12px 14px;border:1px solid var(--bd);border-left:3px solid var(--accent);border-radius:8px;background:var(--card);color:var(--mut);font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:14px}
  .sec{display:block;padding:14px;border:1px solid var(--bd);border-radius:10px;background:var(--card);text-decoration:none}
  .sec:hover{border-color:var(--accent)} .sec .t{font-weight:700;margin-bottom:4px} .sec .d{color:var(--mut);font-size:14px}
  .count{color:var(--mut);font-size:13px;margin-top:8px}
  .grant{padding:14px;border:1px solid var(--bd);border-radius:10px;background:var(--card);margin:10px 0}
  .grant .h{display:flex;align-items:center;gap:8px;flex-wrap:wrap} .grant .nm{font-weight:700;font-size:17px}
  .grant .by{color:var(--mut);font-size:13px;margin:2px 0 6px} .grant .what{font-size:15px}
  .grant .rec{color:var(--mut);font-size:13px;margin-top:6px} .grant .go{display:inline-block;margin-top:10px;padding:6px 12px;border:1px solid var(--accent);border-radius:8px;color:var(--accent);text-decoration:none;font-weight:600;font-size:14px}
  .badge{font-size:11px;text-transform:uppercase;letter-spacing:.04em;border:1px solid currentColor;border-radius:6px;padding:1px 7px;font-weight:700}
  .k-portal{color:var(--portal)} .k-federal{color:var(--federal)} .k-state{color:var(--state)} .k-foundation{color:var(--foundation)} .k-fellowship{color:var(--fellowship)} .k-rfp{color:var(--rfp)}
  .hsearch{margin:14px 0} .hsearch .row{display:flex;gap:8px;flex-wrap:wrap}
  .hsearch input{flex:1;min-width:200px;padding:10px 12px;border:1px solid var(--bd);border-radius:8px;background:#0b0f14;color:var(--fg)}
  .hsearch button{padding:10px 16px;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:8px;font-weight:700;cursor:pointer}
  .empty{color:var(--mut);font-style:italic} footer{border-top:1px solid var(--bd);margin-top:40px;padding:18px;color:var(--mut);font-size:13px;text-align:center}
  ${NAV_STYLE}
</style>`;

const FOOTER = `<footer>
  SoapBox Grants — an honest map of where the money is, by field. We link out to the official application; we never charge for access to public money.
  <div style="margin-top:8px">${navBar({ current: 'grants' })}</div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Grants — a free, by-field grant aggregator: research (NSF/NIH/DOE), schools (Title I, IDEA, TEACH), small business (SBIR), nonprofits & foundations, arts (NEA/NEH), fellowships, and RFPs. Start with the master portals (Grants.gov, SAM.gov, Candid).';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">💰 Grants <span>SoapBox</span></a>
  <div class=topbar-r><a href="/">Fields</a><a href="/search">Search</a><a href="${esc(CREDS)}">Credentials</a><a href="${esc(WIKI)}">Wiki</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(value = '') {
  return `<form class=hsearch method=get action="/search"><div class=row>
    <input name=q value="${esc(value)}" placeholder="Search grants — e.g. research, schools, small business, arts…" autocomplete=off aria-label="Search grants">
    <button type=submit>Search</button>
  </div></form>`;
}

function kindBadge(kind) {
  const k = KIND[kind] || { label: kind, cls: 'federal' };
  return `<span class="badge k-${esc(k.cls)}">${esc(k.label)}</span>`;
}

function grantCard(x) {
  return `<div class=grant>
    <div class=h><a class=nm href="/g/${esc(x.id)}">${esc(x.name)}</a> ${kindBadge(x.kind)}</div>
    <div class=by>${esc(x.funder || '')}</div>
    <div class=what>${esc(x.what || '')}</div>
    ${x.scope ? `<div class=rec>▸ ${esc(x.scope)}</div>` : ''}
    <a class=go href="${esc(x.url)}" rel="nofollow noopener">Go to the official source →</a>
  </div>`;
}

export function homePage() {
  const counts = fieldsWithCounts();
  const cards = counts.map((f) => `<a class=sec href="/field/${esc(f.id)}">
    <div class=t>${esc(f.name)}</div>
    <div class=d>${esc(f.blurb)}</div>
    <div class=count>${esc(`${f.total} sources${f.portals ? ` · ${f.portals} search portals` : ''}`)}</div></a>`).join('');
  const featured = ['grants-gov', 'sam-gov', 'candid', 'sbir-sttr'].map(getGrant).filter(Boolean);
  const body = `<h1>Find the grant — by field</h1>
    <p class=lead>Where the money actually is: federal grants, foundations, fellowships and RFPs — for research,
      schools, small business, nonprofits, the arts, and individuals. Start with the master search portals,
      then go straight to the official application. We never charge for access to public money.</p>
    <p class=guardrail>${esc(BRAND_GUARDRAIL)}</p>
    ${searchForm()}
    <h2>Start here — search them all</h2>
    <div>${featured.map(grantCard).join('')}</div>
    <h2>Browse by field</h2>
    <div class=grid>${cards}</div>`;
  return page('Grants — find the grant, by field · SoapBox', body);
}

export function fieldView(id) {
  const f = field(id);
  if (!f) return page('Field not found · SoapBox Grants', `<h1>Field not found</h1>
    <p class=muted>That field isn't in the catalog yet. <a href="/">See all fields →</a></p>`, { robots: 'noindex' });
  const items = byField(id);
  const body = `<p class=muted><a href="/">← All fields</a></p>
    <h1>${esc(f.name)}</h1>
    <p class=lead>${esc(f.blurb)}</p>
    ${searchForm()}
    ${items.length ? items.map(grantCard).join('') : '<p class=empty>No grant sources catalogued here yet.</p>'}`;
  return page(`${f.name} grants · SoapBox`, body, { canonical: `${BASE_URL}/field/${f.id}` });
}

export function grantView(id) {
  const x = getGrant(id);
  if (!x) return page('Grant not found · SoapBox Grants', `<h1>Grant not found</h1>
    <p class=muted><a href="/">Back to fields →</a></p>`, { robots: 'noindex' });
  const f = field(x.field);
  const body = `<p class=muted><a href="/field/${esc(x.field)}">← ${esc(f ? f.name : 'Field')}</a></p>
    <h1>${esc(x.name)} ${kindBadge(x.kind)}</h1>
    <div class=by>${esc(x.funder || '')}</div>
    ${x.scope ? `<p class=rec>▸ ${esc(x.scope)}</p>` : ''}
    <p class=what>${esc(x.what || '')}</p>
    <p><a class=go href="${esc(x.url)}" rel="nofollow noopener">Go to the official source →</a></p>`;
  return page(`${x.name} · SoapBox Grants`, body, { canonical: `${BASE_URL}/g/${x.id}` });
}

export function searchView(q) {
  const query = String(q || '').trim();
  const hits = query ? search(query, { limit: 20 }) : [];
  const body = `<h1>Search grants</h1>
    ${searchForm(query)}
    ${query
    ? (hits.length ? `<p class=muted>${esc(`${hits.length} result${hits.length === 1 ? '' : 's'} for "${query}"`)}</p>${hits.map(grantCard).join('')}`
      : `<p class=empty>No grants matched "${esc(query)}". Try "research", "schools", "small business", "arts", or browse <a href="/">by field</a>.</p>`)
    : '<p class=muted>Search by field, funder, or who it\'s for — or browse <a href="/">by field</a>.</p>'}`;
  return page(query ? `"${query}" · SoapBox Grants` : 'Search · SoapBox Grants', body, { robots: 'noindex' });
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      const v = validateCatalog();
      res.writeHead(v.ok ? 200 : 500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(v));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = [
        { path: '/', lastmod: today, changefreq: 'weekly', priority: '1.0' },
        ...FIELDS.map((f) => ({ path: `/field/${f.id}`, lastmod: today, changefreq: 'weekly', priority: '0.8' })),
        ...GRANTS.map((x) => ({ path: `/g/${x.id}`, lastmod: today, changefreq: 'monthly', priority: '0.6' })),
      ];
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'SoapBox Grants', baseUrl: BASE_URL,
        summary: 'A free, by-field grant aggregator: master search portals (Grants.gov, SAM.gov, Candid), research (NSF/NIH/DOE/NASA), schools (Title I, IDEA, TEACH, E-Rate, DonorsChoose), small business (SBIR/STTR, SBA), nonprofits & foundations, arts (NEA/NEH), fellowships, and an RFPs/contracts lane. Links out to official applications; never charges for access to public money.',
        links: FIELDS.map((f) => ({ label: f.name, path: `/field/${f.id}` })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/search') return sendHtml(res, searchView(url.searchParams.get('q')));
    if (path.startsWith('/field/')) {
      const id = decodeURIComponent(path.slice('/field/'.length).replace(/\/+$/, ''));
      return sendHtml(res, fieldView(id), field(id) ? 200 : 404);
    }
    if (path.startsWith('/g/')) {
      const id = decodeURIComponent(path.slice('/g/'.length).replace(/\/+$/, ''));
      return sendHtml(res, grantView(id), getGrant(id) ? 200 : 404);
    }
    return sendHtml(res, page('Not found · SoapBox Grants', '<h1>Not found</h1><p class=muted><a href="/">Back to fields →</a></p>', { robots: 'noindex' }), 404);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Grants on http://${HOST}:${PORT} — ${GRANTS.length} sources / ${FIELDS.length} fields`);
  });
}
