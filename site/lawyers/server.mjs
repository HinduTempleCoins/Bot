// server.mjs — Lawyers.SoapBox.Community. The attorney-directory vertical as a standalone,
// zero-dependency HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs). It
// fronts the already-built legal-directory engine (integrations/soapbox/lawyer-directory.mjs) and
// binds it into ONE honest, records-only surface:
//   - a search box (attorney name + state) over PUBLIC BAR RECORDS,
//   - profiles that render VERIFIED BAR FACTS ONLY — license status, admission date, and discipline
//     history WITH SOURCES — and deliberately NO rating / score / star / recommendation, by design,
//   - a curated, fully-clean public-interest set (legal aid, bar referral lines, complaint forms),
//   - optional PAID listing placement that is FLAT-FEE advertising only, clearly labeled "sponsored
//     listing", and can NEVER buy rank or a recommendation (ABA Model Rules 5.4 & 7.2, enforced in
//     the engine — this surface only surfaces it, minimally).
//
//   PORT=8185 BASE_URL=https://lawyers.soapbox.community node site/lawyers/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  portal home — intro + search box + records-only note + public-interest set
//   /search?q=&state=  render searchAttorneys() results (verified bar facts + sources), honest empty
//   /attorney/<slug>   profile via renderProfile (looked up through the injected bar fetcher)
//   /health            liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   DIRECTORY OF FACTS, NOT A REFERRAL OR RECOMMENDATION. We report what the state bar published
//   (status, admission, discipline WITH SOURCES) and we do NOT editorialize quality — there is
//   deliberately NO rating/score/star anywhere. State bars have no common public API, so the
//   transport is INJECTED (searchAttorneys' fetcher); with none configured we soft-fail to an honest
//   empty result, never a fabricated one. Paid listings are flat-fee advertising, labeled "sponsored
//   listing", and never reorder results. esc() on every interpolated value. Soft-fail: every route
//   renders even when the engine returns nothing.

import { createServer } from 'node:http';

import * as directory from '../../integrations/soapbox/lawyer-directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8185);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const INSURANCE = process.env.INSURANCE_SITE || 'https://insurance.soapbox.community';
const SITE_NAME = 'SoapBox Lawyers';

// ── injected transport ─────────────────────────────────────────────────────────────────────────
// State bars have no common public API, so the caller supplies the fetcher. Tests inject it; in
// production it stays null and searches soft-fail to an honest empty set (never a fabricated one).
let _barFetcher = null;
export function __setBarFetcher(fn) { _barFetcher = typeof fn === 'function' ? fn : null; }

// ── shared house-style helpers (same dark theme as Insurance/Coupons/Law) ──────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.st{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;width:120px}
  input.q:focus,input.st:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .not-advice,.not-advice-banner{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .attorney-profile{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:16px 18px;margin:12px 0}
  .attorney-name{margin:0 0 6px;font-size:18px}
  .bar-status{font-size:11px;border-radius:8px;padding:1px 8px;background:#30363d;color:var(--fg)}
  .bar-status-active{background:#3fb95022;color:var(--up)} .bar-status-suspended,.bar-status-disbarred{background:#f8514922;color:var(--down)}
  .bar-number,.bar-state{color:var(--mut);font-size:13px;margin-left:6px}
  .discipline-list{margin:6px 0;padding-left:20px} .discipline-none{color:var(--mut);font-size:13px}
  .disc-source{color:var(--blue);font-size:12px} .disc-source-missing{color:var(--mut)}
  .paid-ad-disclosure{font-size:11px;background:#d2992233;color:var(--gold);border-radius:8px;padding:2px 8px;display:inline-block;margin:6px 0}
  .no-results{color:var(--mut)}
  .pi-section ul{margin:6px 0;padding-left:20px}
  .sponsored-note{font-size:12px;color:var(--gold)}
  .note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>A directory of facts, not a referral or recommendation.</b> SoapBox Lawyers lists <b>verified public
  bar records</b> — license status, admission date, and discipline history with sources — and reports what
  the state bar published. There is deliberately <b>no rating, score, or star</b>: we do not rank or
  recommend lawyers. This is <b>not legal advice</b>. Any paid listing is flat-fee advertising, clearly
  labeled, and can never buy rank or a recommendation.
  <div style="margin-top:8px"><a href="/">Lawyers</a> · <a href="${esc(INSURANCE)}">Insurance</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Look up attorneys by verified public bar records — license status, admission date, and discipline history with sources. A directory of facts: no ratings, no recommendations, not legal advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/search?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">⚖️ SoapBox <span>lawyers</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="/#public-interest">Legal aid</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(q = '', state = '') {
  return `<form class=hsearch method=get action="/search"><div class=row>
    <input class=q name="q" value="${esc(q)}" placeholder="Attorney name — e.g. Jane Q. Public" autocomplete=off aria-label="Attorney name">
    <input class=st name="state" value="${esc(state)}" placeholder="State (CA)" autocomplete=off aria-label="State">
    <button type=submit>Look up</button>
  </div></form>`;
}

// The records-only note, surfaced on every human page. No rating, ever.
const RECORDS_ONLY_NOTE =
  'We list <b>verified bar facts only</b> — license status, admission date, and discipline history with sources. ' +
  'There are <b>no ratings, scores, or recommendations</b> here: we report what the state bar published, nothing more.';

// A minimal, clearly-labeled disclosure of the optional paid-listing tiers. Flat-fee advertising ONLY;
// never affects rank or implies a recommendation. Built from the engine's LISTING_TIERS/priceListing.
function sponsoredListingCard() {
  const paid = Object.keys(directory.LISTING_TIERS).filter((k) => {
    try { return directory.priceListing({ tier: k }).isAdvertising; } catch { return false; }
  });
  if (paid.length === 0) return '';
  const rows = paid.map((k) => {
    let p; try { p = directory.priceListing({ tier: k }); } catch { return ''; }
    return `<li><b>${esc(p.label)}</b> — $${esc(p.price)} ${esc(p.currency)} flat (${esc(p.model)}). ${esc(p.description)}</li>`;
  }).filter(Boolean).join('\n');
  return `<div class=card id="listings">
    <h2>Sponsored listing <span class="sponsored-note">· paid advertising</span></h2>
    <p class=muted style="font-size:14px">A <b>sponsored listing</b> is optional, <b>flat-fee advertising</b> —
      it can <b>never</b> buy rank or a recommendation, and it never reorders search results (ABA Model Rules 5.4 &amp; 7.2).</p>
    <ul>\n${rows}\n    </ul>
  </div>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const body = `<h1>SoapBox Lawyers <span class=muted style="font-size:14px">· public bar records</span></h1>
    <p class=muted>Look up an attorney by <b>verified public bar records</b>. Enter a name (and a state if you know it):</p>
    ${searchForm()}
    <div class="not-advice-banner" role="note">${RECORDS_ONLY_NOTE}</div>
    <div class="not-advice" role="note">${esc(directory.NOT_ADVICE)}</div>
    ${sponsoredListingCard()}
    <div class=card id="public-interest"><h2>Free & public-interest legal help</h2>
      ${directory.renderPublicInterest()}</div>`;
  return page(`${SITE_NAME} — verified attorney bar records`, body, { canonical: `${BASE_URL}/` });
}

// ── /search — render searchAttorneys() results (verified bar facts + sources) ───────────────────────
// Optionally accepts an injected `fetcher` (tests / a configured state-bar transport); omitted → the
// module-level `_barFetcher` (null in production → honest empty result).
export async function searchView(q, { state, fetcher } = {}) {
  const query = String(q || '').trim();
  const st = String(state || '').trim();
  if (!query) return { query, state: st, results: [], html: directory.renderDirectory([]) };
  const results = await directory.searchAttorneys(query, { state: st || undefined, fetcher: fetcher || _barFetcher || undefined }).catch(() => []);
  return { query, state: st, results, html: directory.renderDirectory(results) };
}

// ── /attorney/<slug> — a single profile, looked up through the injected fetcher ─────────────────────
function slugify(name) {
  return String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export async function attorneyView(slug, { state, fetcher } = {}) {
  const s = slugify(slug);
  if (!s) return null;
  const query = s.replace(/-/g, ' ');
  const results = await directory.searchAttorneys(query, { state: state || undefined, fetcher: fetcher || _barFetcher || undefined }).catch(() => []);
  const match = results.find((r) => slugify(r.name) === s) || results[0] || null;
  if (!match) return { slug: s, match: null, html: directory.renderDirectory([]) };
  return { slug: s, match, html: directory.renderProfile(match) };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/search'];

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
        summary: 'Look up attorneys by verified public bar records (status, admission, discipline with sources). A directory of facts — no ratings, no recommendations, not legal advice. Paid listings are flat-fee advertising only, never pay-to-rank (ABA Rules 5.4 & 7.2).',
        links: [
          { label: 'Search attorney bar records', path: '/search' },
          { label: 'Free & public-interest legal help', path: '/#public-interest' },
        ],
      }));
    }

    if (path === '/' || path === '') return sendHtml(res, homePage());

    if (path === '/search') {
      const q = url.searchParams.get('q') || '';
      const state = url.searchParams.get('state') || '';
      const view = await searchView(q, { state });
      const heading = view.query
        ? `Results for “${esc(view.query)}”${view.state ? ` in ${esc(view.state)}` : ''}`
        : 'Search attorney bar records';
      const body = `<h1>${heading}</h1>
        ${searchForm(view.query, view.state)}
        <div class="not-advice-banner" role="note">${RECORDS_ONLY_NOTE}</div>
        ${view.html}`;
      return sendHtml(res, page(`${view.query ? `${esc(view.query)} — ` : ''}bar records | ${SITE_NAME}`, body,
        { canonical: `${BASE_URL}/search`, robots: 'noindex,follow' }));
    }

    if (path.startsWith('/attorney/')) {
      const view = await attorneyView(decodeURIComponent(path.slice('/attorney/'.length)), {
        state: url.searchParams.get('state') || undefined,
      });
      if (!view) { res.writeHead(302, { location: '/' }); return res.end(); }
      const body = `<h1>Attorney bar record</h1>
        <div class="not-advice-banner" role="note">${RECORDS_ONLY_NOTE}</div>
        ${view.html}`;
      return sendHtml(res, page(`${view.match ? `${esc(view.match.name || 'Attorney')} — ` : ''}bar record | ${SITE_NAME}`, body,
        { canonical: `${BASE_URL}/attorney/${esc(view.slug)}`, robots: 'noindex,follow' }));
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
export { siteGraph, jsonLdScript };

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/lawyers\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Lawyers on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
