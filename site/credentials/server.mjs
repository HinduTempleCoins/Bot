// site/credentials/server.mjs — the SoapBox Credentialing Aggregator portal
// (credentials.soapbox.community). One honest, BY-INDUSTRY map of how to actually get credentialed:
// certifications, accreditors, credit-by-exam, and the free / low-cost paths that lead to them.
//
// Data is the curated credentials-catalog.mjs (pure, link-out). This server just renders it: a home
// grid of industries, a per-industry list (free-first), a per-credential detail, and search. SEO
// (robots/sitemap/llms.txt) + the shared ecosystem nav. Pure render, esc() everywhere, handler(req,res)
// exported for tests, CLI guarded. No network, no keys.
//
//   PORT=8137 node site/credentials/server.mjs
//   import { handler, homePage, industryView } from './server.mjs'   // for tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import {
  INDUSTRIES, CREDENTIALS, industry, getCredential, byIndustry, search,
  industriesWithCounts, validateCatalog, BRAND_GUARDRAIL,
} from '../../integrations/soapbox/credentials-catalog.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';

const PORT = +(process.env.PORT || 8137);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || 'https://credentials.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const COST = {
  free: { label: 'Free', cls: 'free' },
  low: { label: 'Low cost', cls: 'low' },
  paid: { label: 'Paid', cls: 'paid' },
};
const TYPE_LABEL = {
  certification: 'Certification', certificate: 'Certificate', accreditor: 'Accreditor',
  'credit-by-exam': 'Credit by exam', 'course-provider': 'Course provider', 'license-prep': 'License prep',
  prep: 'Exam prep',
};

const STYLE = `<style>
  :root{--bg:#0e1116;--fg:#e7edf3;--mut:#9fb0c0;--bd:#26303c;--card:#151b23;--accent:#d9a441;--free:#36c08a;--low:#4c8dff;--paid:#b98be0}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:inherit} .wrap{max-width:980px;margin:0 auto;padding:0 18px 60px}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;text-decoration:none} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r a{margin-left:14px;color:var(--mut);text-decoration:none;font-size:14px} .topbar-r a:hover{color:var(--fg)}
  h1{font-size:30px;margin:26px 0 6px} h2{font-size:20px;margin:28px 0 10px}
  .muted{color:var(--mut)} .lead{color:var(--mut);max-width:70ch}
  .guardrail{margin:16px 0;padding:12px 14px;border:1px solid var(--bd);border-left:3px solid var(--accent);border-radius:8px;background:var(--card);color:var(--mut);font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:14px}
  .sec{display:block;padding:14px;border:1px solid var(--bd);border-radius:10px;background:var(--card);text-decoration:none}
  .sec:hover{border-color:var(--accent)} .sec .t{font-weight:700;margin-bottom:4px} .sec .d{color:var(--mut);font-size:14px}
  .count{color:var(--mut);font-size:13px;margin-top:8px}
  .cred{padding:14px;border:1px solid var(--bd);border-radius:10px;background:var(--card);margin:10px 0}
  .cred .h{display:flex;align-items:center;gap:8px;flex-wrap:wrap} .cred .nm{font-weight:700;font-size:17px}
  .cred .by{color:var(--mut);font-size:13px;margin:2px 0 6px} .cred .what{font-size:15px}
  .cred .rec{color:var(--mut);font-size:13px;margin-top:6px} .cred .go{display:inline-block;margin-top:10px;padding:6px 12px;border:1px solid var(--accent);border-radius:8px;color:var(--accent);text-decoration:none;font-weight:600;font-size:14px}
  .badge{font-size:11px;text-transform:uppercase;letter-spacing:.04em;border:1px solid currentColor;border-radius:6px;padding:1px 7px;font-weight:700}
  .b-free{color:var(--free)} .b-low{color:var(--low)} .b-paid{color:var(--paid)} .b-type{color:var(--mut)}
  .hsearch{margin:14px 0} .hsearch .row{display:flex;gap:8px;flex-wrap:wrap}
  .hsearch input{flex:1;min-width:200px;padding:10px 12px;border:1px solid var(--bd);border-radius:8px;background:#0b0f14;color:var(--fg)}
  .hsearch button{padding:10px 16px;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:8px;font-weight:700;cursor:pointer}
  .empty{color:var(--mut);font-style:italic} footer{border-top:1px solid var(--bd);margin-top:40px;padding:18px;color:var(--mut);font-size:13px;text-align:center}
  ${NAV_STYLE}
</style>`;

const FOOTER = `<footer>
  SoapBox Credentials — an honest map of how to get credentialed, by industry. We link out to official issuers; we don't sell credentials.
  <div style="margin-top:8px">${navBar({ current: 'credentials' })}</div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Credentials — a free, by-industry map of certifications, accreditors and credit-by-exam: teach English (TEFL/TESOL/CELTA), free college credit (Modern States, Saylor, CLEP), IT, cybersecurity, healthcare, trades and more. Free and credit-bearing paths first.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🎓 Credentials <span>SoapBox</span></a>
  <div class=topbar-r><a href="/">Industries</a><a href="/search">Search</a><a href="${esc(WIKI)}">Wiki</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(value = '') {
  return `<form class=hsearch method=get action="/search"><div class=row>
    <input name=q value="${esc(value)}" placeholder="Search credentials — e.g. TEFL, free college credit, Security+…" autocomplete=off aria-label="Search credentials">
    <button type=submit>Search</button>
  </div></form>`;
}

function costBadge(cost) {
  const c = COST[cost] || COST.paid;
  return `<span class="badge b-${esc(c.cls)}">${esc(c.label)}</span>`;
}

function credCard(x) {
  return `<div class=cred>
    <div class=h><a class=nm href="/c/${esc(x.id)}">${esc(x.name)}</a> ${costBadge(x.cost)} <span class="badge b-type">${esc(TYPE_LABEL[x.type] || x.type)}</span></div>
    <div class=by>${esc(x.provider || '')}</div>
    <div class=what>${esc(x.what || '')}</div>
    ${x.recognition ? `<div class=rec>✓ ${esc(x.recognition)}</div>` : ''}
    <a class=go href="${esc(x.url)}" rel="nofollow noopener">Go to the official issuer →</a>
  </div>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const counts = industriesWithCounts();
  const cards = counts.map((i) => `<a class=sec href="/industry/${esc(i.id)}">
    <div class=t>${esc(i.name)}</div>
    <div class=d>${esc(i.blurb)}</div>
    <div class=count>${esc(`${i.total} credentials${i.free ? ` · ${i.free} free` : ''}`)}</div></a>`).join('');
  const featured = ['modernstates', 'saylor', 'isc2-cc', 'freecodecamp'].map(getCredential).filter(Boolean);
  const body = `<h1>Get credentialed — by industry</h1>
    <p class=lead>A plain map of how to actually earn the credential you need: certifications, accreditors,
      credit-by-exam, and the free or low-cost paths that lead to them. We link out to the official issuer —
      we never sell credentials.</p>
    <p class=guardrail>${esc(BRAND_GUARDRAIL)}</p>
    ${searchForm()}
    <h2>Start here — free paths worth knowing</h2>
    <div>${featured.map(credCard).join('')}</div>
    <h2>Browse by industry</h2>
    <div class=grid>${cards}</div>`;
  return page('Credentials — get credentialed, by industry · SoapBox', body);
}

// ── one industry ────────────────────────────────────────────────────────────────────────────────
export function industryView(id) {
  const i = industry(id);
  if (!i) return page('Industry not found · SoapBox Credentials', `<h1>Industry not found</h1>
    <p class=muted>That industry isn't in the catalog yet. <a href="/">See all industries →</a></p>`, { robots: 'noindex' });
  const items = byIndustry(id);
  const body = `<p class=muted><a href="/">← All industries</a></p>
    <h1>${esc(i.name)}</h1>
    <p class=lead>${esc(i.blurb)}</p>
    ${searchForm()}
    ${items.length ? items.map(credCard).join('') : '<p class=empty>No credentials catalogued here yet.</p>'}`;
  return page(`${i.name} credentials · SoapBox`, body, { canonical: `${BASE_URL}/industry/${i.id}` });
}

// ── one credential ────────────────────────────────────────────────────────────────────────────────
export function credentialView(id) {
  const x = getCredential(id);
  if (!x) return page('Credential not found · SoapBox Credentials', `<h1>Credential not found</h1>
    <p class=muted><a href="/">Back to industries →</a></p>`, { robots: 'noindex' });
  const i = industry(x.industry);
  const body = `<p class=muted><a href="/industry/${esc(x.industry)}">← ${esc(i ? i.name : 'Industry')}</a></p>
    <h1>${esc(x.name)} ${costBadge(x.cost)}</h1>
    <div class=by>${esc(x.provider || '')} · <span class="badge b-type">${esc(TYPE_LABEL[x.type] || x.type)}</span></div>
    <p class=what>${esc(x.what || '')}</p>
    ${x.recognition ? `<p class=rec>✓ ${esc(x.recognition)}</p>` : ''}
    <p><a class=go href="${esc(x.url)}" rel="nofollow noopener">Go to the official issuer →</a></p>`;
  return page(`${x.name} · SoapBox Credentials`, body, { canonical: `${BASE_URL}/c/${x.id}` });
}

// ── search ──────────────────────────────────────────────────────────────────────────────────────
export function searchView(q) {
  const query = String(q || '').trim();
  const hits = query ? search(query, { limit: 20 }) : [];
  const body = `<h1>Search credentials</h1>
    ${searchForm(query)}
    ${query
    ? (hits.length ? `<p class=muted>${esc(`${hits.length} result${hits.length === 1 ? '' : 's'} for "${query}"`)}</p>${hits.map(credCard).join('')}`
      : `<p class=empty>No credentials matched "${esc(query)}". Try "TEFL", "free college credit", "cloud", or browse <a href="/">by industry</a>.</p>`)
    : '<p class=muted>Search by credential, provider, or goal — or browse <a href="/">by industry</a>.</p>'}`;
  return page(query ? `"${query}" · SoapBox Credentials` : 'Search · SoapBox Credentials', body, { robots: 'noindex' });
}

// ── request handler ───────────────────────────────────────────────────────────────────────────────
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
        ...INDUSTRIES.map((i) => ({ path: `/industry/${i.id}`, lastmod: today, changefreq: 'weekly', priority: '0.8' })),
        ...CREDENTIALS.map((x) => ({ path: `/c/${x.id}`, lastmod: today, changefreq: 'monthly', priority: '0.6' })),
      ];
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'SoapBox Credentials', baseUrl: BASE_URL,
        summary: 'A free, by-industry map of certifications, accreditors and credit-by-exam pathways — teaching English (TEFL/TESOL/CELTA), free college credit (Modern States, Saylor, CLEP), IT, cybersecurity, data/AI, business/PM, healthcare and skilled trades. Free and credit-bearing paths first; we link out to official issuers.',
        links: INDUSTRIES.map((i) => ({ label: i.name, path: `/industry/${i.id}` })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/search') return sendHtml(res, searchView(url.searchParams.get('q')));
    if (path.startsWith('/industry/')) {
      const id = decodeURIComponent(path.slice('/industry/'.length).replace(/\/+$/, ''));
      return sendHtml(res, industryView(id), industry(id) ? 200 : 404);
    }
    if (path.startsWith('/c/')) {
      const id = decodeURIComponent(path.slice('/c/'.length).replace(/\/+$/, ''));
      return sendHtml(res, credentialView(id), getCredential(id) ? 200 : 404);
    }
    return sendHtml(res, page('Not found · SoapBox Credentials', '<h1>Not found</h1><p class=muted><a href="/">Back to industries →</a></p>', { robots: 'noindex' }), 404);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Credentials on http://${HOST}:${PORT} — ${CREDENTIALS.length} credentials / ${INDUSTRIES.length} industries`);
  });
}
