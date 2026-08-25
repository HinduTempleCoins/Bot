// server.mjs — HealthProviders.SoapBox.Community. The healthcare-provider-finder vertical as a
// standalone, zero-dependency HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs).
// It fronts the already-built engine (integrations/soapbox/health-providers.mjs) — a reader over two
// FREE, KEYLESS, OFFICIAL CMS sources:
//   - NPI Registry (npiregistry.cms.hhs.gov) — CMS's open provider directory (find clinicians / orgs),
//   - Medicare Care Compare (data.cms.gov) — the OFFICIAL hospital quality dataset (overall star rating
//     + measures). We surface its numbers as SOURCED FACTS attributed to CMS — the star rating is
//     Medicare's official measure, NEVER a SoapBox rating.
//
//   PORT=8184 BASE_URL=https://health-providers.soapbox.community node site/health-providers/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /             portal home — search a hospital/provider by name or location + explainer
//   /hospital     ?q=<name> → one hospital's OFFICIAL CMS quality facts (renderPage)
//   /compare      ?q=<name>[&q=<name>…] → side-by-side of OFFICIAL measures, NO winner (compareHospitals)
//   /health       liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   CONTENT + DIRECTORY, NOT MEDICAL ADVICE and NOT OUR RATING. The star rating and every quality
//   measure are Medicare's OFFICIAL published figures, attributed to CMS with a source link — they are
//   NOT a SoapBox rating and no "best" is ever implied (compareHospitals declares no winner). The
//   engine's not-medical-advice banner + right-of-reply note render on every result. Both sources are
//   keyless; nothing is read from process.env for secrets. esc() on every interpolated value.
//   Soft-fail: every route renders even when the engine returns nothing ("no providers found", honestly).

import { createServer } from 'node:http';

import * as hp from '../../integrations/soapbox/health-providers.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8184);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const INSURANCE = process.env.INSURANCE_SITE || 'https://insurance.soapbox.community';
const SITE_NAME = 'SoapBox Health Providers';

// ── shared house-style helpers (same dark theme as Insurance/Coupons) ──────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

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
  .health-providers table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
  .health-providers th,.health-providers td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line)}
  .health-providers th{color:var(--mut);font-weight:600;font-size:13px}
  .health-providers .official{font-size:11px;color:var(--gold)}
  .not-medical-advice{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .right-of-reply,.source,.no-winner,.empty{color:var(--mut);font-size:13px}
  .note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>A directory, plus official CMS data — not our rating.</b> Hospital star ratings and quality measures
  shown here are published by <b>Medicare (CMS Care Compare)</b>, not by SoapBox. They are official facts,
  attributed with a source link — never a SoapBox rating, and we imply no "best" hospital. This is
  informational only and <b>not medical advice</b>. Confirm any figure on
  <a href="https://www.medicare.gov/care-compare/">Medicare Care Compare</a> and consult a licensed clinician
  for medical decisions.
  <div style="margin-top:8px"><a href="/">Health Providers</a> · <a href="${esc(INSURANCE)}">Insurance</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Find hospitals and healthcare providers and read their official Medicare Care Compare quality data — overall star rating and measures. The ratings are Medicare\'s official figures, not a SoapBox rating. Not medical advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/hospital?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🏥 SoapBox <span>health providers</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="/hospital">Hospital lookup</a><a href="/compare">Compare</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(action = '/hospital', value = '') {
  return `<form class=hsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="q" value="${esc(value)}" placeholder="Hospital name or location — e.g. Cleveland Clinic, or Boston" autocomplete=off aria-label="Hospital name or location">
    <button type=submit>Search</button>
  </div></form>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const body = `<h1>SoapBox Health Providers <span class=muted style="font-size:14px">· official data, not our rating</span></h1>
    <p class=muted>Look up a hospital or provider by <b>name or location</b> and read its
      <b>official Medicare Care Compare</b> quality data — overall star rating and measures. The star
      rating is <b>Medicare's official measure, not a SoapBox rating</b>.</p>
    ${searchForm('/hospital')}
    <div class=grid style="margin-top:8px">
      <a class=sec href="/hospital"><div class=t>Look up a hospital</div><div class=d>Search by name or location for its official CMS quality facts.</div></a>
      <a class=sec href="/compare"><div class=t>Compare hospitals</div><div class=d>Line official CMS measures up side by side — no "best" implied.</div></a>
    </div>
    <div class="not-medical-advice" role="note"><strong>Not medical advice.</strong> This is a directory
      and a presentation of official CMS data for informational use only. It is not a recommendation,
      diagnosis, or endorsement. Consult a licensed clinician for medical decisions.</div>
    <div class=card><h2>Where the numbers come from</h2>
      <p class=muted style="font-size:14px">Provider listings come from the <b>NPI Registry</b> (CMS's open
      national provider directory). Hospital quality — the overall <b>star rating</b> and measures — comes
      from <b>Medicare Care Compare</b>. Those figures are <b>CMS's official published data</b>, shown here
      as sourced facts with a link back to Medicare. They are <b>not a SoapBox rating</b>, and when we place
      hospitals side by side we declare no winner.</p></div>`;
  return page(`${SITE_NAME} — find hospitals & read official Medicare data`, body, { canonical: `${BASE_URL}/` });
}

// ── /hospital — one hospital's official CMS quality facts ───────────────────────────────────────────
// Optionally accepts an injected `quality` (tests); otherwise fetches via the engine. Soft-fails.
export async function hospitalView(q, { quality } = {}) {
  const name = String(q || '').trim();
  if (!name) return { name, html: null };
  const data = quality !== undefined ? quality : await hp.hospitalQuality({ name }).catch(() => null);
  const html = hp.renderPage({ quality: data });
  return { name, quality: data, html };
}

// ── /compare — side-by-side of official CMS measures, NO winner ─────────────────────────────────────
// Optionally accepts injected `list` (tests); otherwise fetches each named hospital via the engine.
export async function compareView(names, { list } = {}) {
  const wanted = (Array.isArray(names) ? names : [names]).map((n) => String(n || '').trim()).filter(Boolean);
  if (!wanted.length) return { names: wanted, html: null };
  let quals = list;
  if (quals === undefined) {
    quals = await Promise.all(wanted.map((name) => hp.hospitalQuality({ name }).catch(() => null)));
  }
  const clean = (Array.isArray(quals) ? quals : []).filter(Boolean);
  const comparison = hp.compareHospitals(clean);
  const html = hp.renderPage({ comparison });
  return { names: wanted, comparison, html };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/hospital', '/compare'];

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
        summary: 'Find hospitals/providers and read their OFFICIAL Medicare Care Compare quality data (overall star rating + measures). Ratings are CMS\'s official figures with a source link, NOT a SoapBox rating; comparisons declare no winner. Not medical advice.',
        links: [
          { label: 'Hospital lookup', path: '/hospital' },
          { label: 'Compare hospitals', path: '/compare' },
        ],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path === '/hospital') {
      const q = url.searchParams.get('q') || '';
      if (!q.trim()) {
        return sendHtml(res, page(`Hospital lookup | ${SITE_NAME}`,
          `<h1>Hospital lookup</h1><p class=muted>Search a hospital by name or location for its official
            Medicare Care Compare quality data. The star rating is Medicare's official measure, not a
            SoapBox rating.</p>${searchForm('/hospital')}`,
          { canonical: `${BASE_URL}/hospital` }));
      }
      const view = await hospitalView(q);
      const jsonld = view.quality ? {
        '@context': 'https://schema.org', '@type': 'Hospital',
        name: view.quality.name || view.name,
      } : null;
      return sendHtml(res, page(`${view.name} — official Medicare quality data | ${SITE_NAME}`,
        `<h1>${esc(view.name)}</h1>${searchForm('/hospital', view.name)}${view.html}`,
        { canonical: `${BASE_URL}/hospital?q=${encodeURIComponent(view.name)}`,
          description: `Official Medicare Care Compare quality data for ${view.name} — overall star rating and measures, CMS's official figures, not a SoapBox rating.`,
          jsonld }));
    }

    if (path === '/compare') {
      const qs = url.searchParams.getAll('q').filter((s) => s && s.trim());
      if (!qs.length) {
        return sendHtml(res, page(`Compare hospitals | ${SITE_NAME}`,
          `<h1>Compare hospitals</h1><p class=muted>Add two or more hospitals (by name) to line their
            official Medicare Care Compare measures up side by side. We declare no winner — the figures are
            CMS's official facts, not a SoapBox rating.</p>${searchForm('/compare')}`,
          { canonical: `${BASE_URL}/compare` }));
      }
      const view = await compareView(qs);
      return sendHtml(res, page(`Compare hospitals — official Medicare measures | ${SITE_NAME}`,
        `<h1>Compare hospitals</h1>${searchForm('/compare')}${view.html}`,
        { canonical: `${BASE_URL}/compare`,
          description: 'Compare hospitals side by side on their official Medicare Care Compare measures — CMS\'s official figures, no winner implied, not a SoapBox rating.' }));
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
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/health-providers\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Health Providers on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
