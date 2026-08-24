// server.mjs — Insurance.SoapBox.Community. The insurance price-comparison vertical as a standalone,
// zero-dependency HTTP service in the SoapBox house style (mirrors site/coupons/server.mjs). It fronts
// the already-built insurance engine (integrations/soapbox/insurance.mjs) and the GENERAL affiliate
// engine, binding them into ONE honest comparison surface:
//   - a lines directory (auto / home / health / life / pet / travel) — The Zebra space, done honestly,
//   - per-line carrier comparison ranked by CLARITY (transparency + AM Best strength), never commission,
//   - every outbound "get a quote" link routed through the affiliate engine (id by env NAME; plain url
//     when unset), and the not-advice / not-a-broker banner + FTC disclosure on every comparison.
//
//   PORT=8180 BASE_URL=https://insurance.soapbox.community node site/insurance/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            portal home — line cards + a "what are you insuring?" search box
//   /l/<line>    a line page — carriers compared (auto|home|health|life|pet|travel)
//   /compare     ?line=<free text> → classified to a line and rendered (or home if unmatched)
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   CONTENT + LEAD-GEN + AFFILIATE, NOT A LICENSED PRODUCER. We do not sell, solicit, or negotiate
//   insurance and we never present a premium as a binding offer; we route to licensed carriers/partners.
//   No PII is collected here (outbound links only) — the compliant, TCPA-safe first version. Ranking is
//   by Clarity (never commission), proven in insurance.mjs. Affiliate ids come from the environment BY
//   NAME; none are stored or fabricated. FTC disclosure + not-advice banner on every comparison. esc()
//   on every interpolated value. Soft-fail: every route renders even when the engine returns nothing.

import { createServer } from 'node:http';

import * as insurance from '../../integrations/soapbox/insurance.mjs';
import * as affiliate from '../../integrations/affiliate.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8180);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const COUPONS = process.env.COUPONS_SITE || 'https://coupons.soapbox.community';
const SITE_NAME = 'SoapBox Insurance';

// ── shared house-style helpers (same dark theme as Coupons/Hemp/Law) ──────────────────────────────
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
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .insurance table.insurance-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
  .insurance-table th,.insurance-table td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line)}
  .insurance-table th{color:var(--mut);font-weight:600;font-size:13px}
  .insurance-table tr.sponsored{opacity:.85}
  .badge-sponsored{font-size:11px;background:#d2992233;color:var(--gold);border-radius:8px;padding:1px 7px}
  .clarity-band{font-size:11px;color:var(--mut)}
  .no-quote{color:var(--mut);font-size:13px}
  .not-advice-banner{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .rate-context{color:var(--mut);font-size:13px}
  .transparency{color:var(--mut);font-size:13px}
  .ftc-disclosure,.note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// human-facing labels/blurbs for the six lines, from the engine's own LINES registry.
const LINE_META = insurance.LINES;

const FOOTER = `<footer>
  <b>Honest comparison, not pay-to-rank.</b> SoapBox Insurance ranks carriers by Clarity — transparency and
  financial strength (AM Best) — and <b>never</b> by what they pay us. We are <b>not a licensed insurance
  broker</b>; we don't sell, solicit, or negotiate insurance — we route you to licensed carriers and partners,
  and <b>we never sell your data</b>. Some links are affiliate links; we may earn a commission at no extra cost
  to you. Confirm any policy on the carrier's site or with a licensed agent before you buy.
  <div style="margin-top:8px"><a href="/">Insurance</a> · <a href="${esc(COUPONS)}">Coupons</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Compare insurance carriers honestly — auto, home, health, life, pet, and travel — ranked by financial strength and transparency, never by commission. Not a licensed broker; not insurance advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/compare?line={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🛡️ SoapBox <span>insurance</span></a>
  <div class=topbar-r><a href="/">Home</a>${insurance.listLines().map((l) => `<a href="/l/${esc(l)}">${esc(LINE_META[l].label.split(' ')[0])}</a>`).join('')}<a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm() {
  return `<form class=hsearch method=get action="/compare"><div class=row>
    <input class=q name="line" placeholder="What are you insuring? e.g. car, renters, dog…" autocomplete=off aria-label="What are you insuring?">
    <button type=submit>Compare</button>
  </div></form>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = insurance.listLines().map((l) => {
    const m = LINE_META[l];
    return `<a class=sec href="/l/${esc(l)}"><div class=t>${esc(m.label)}</div><div class=d>${esc(m.note)}</div></a>`;
  }).join('');
  const body = `<h1>SoapBox Insurance <span class=muted style="font-size:14px">· compared honestly</span></h1>
    <p class=muted>Compare carriers by <b>financial strength and transparency</b> — never by what they pay us.
      Pick a line, or tell us what you're insuring:</p>
    ${searchForm()}
    <div class=grid style="margin-top:8px">${cards}</div>
    <div class="not-advice-banner" role="note">${esc(insurance.notAdviceBanner())}</div>
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">Carriers are ranked by a Clarity score built from observable facts —
      AM Best financial-strength rating, whether they publish an official site, and how many lines they openly
      write. Commission can never reorder the list. We are not a licensed broker, we never present a premium as
      an offer, and we <b>never sell your data</b>.</p></div>`;
  return page(`${SITE_NAME} — compare auto, home, life & more`, body, { canonical: `${BASE_URL}/` });
}

// ── /l/<line> — a line comparison page ─────────────────────────────────────────────────────────────
// Optionally accepts injected `quotes` (tests / a future licensed partner) — omitted → facts-only.
export async function lineView(line, { quotes } = {}) {
  const key = insurance.classifyLine(line);
  if (!key) return null;
  const rows = await insurance.compareCarriers({ line: key }, { quotes }).catch(() => []);
  const section = insurance.renderPage({ line: key, rows });
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${LINE_META[key].label} carriers — ${SITE_NAME}`,
    itemListElement: rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name })),
  };
  return { key, html: section, jsonld };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...insurance.listLines().map((l) => `/l/${l}`)];

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
        summary: 'Compare insurance carriers by financial strength + transparency, never commission. Not a licensed broker; outbound links to licensed carriers/partners; no data-selling.',
        links: insurance.listLines().map((l) => ({ label: LINE_META[l].label, path: `/l/${l}` })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path === '/compare') {
      const q = url.searchParams.get('line') || '';
      const key = insurance.classifyLine(q);
      if (!key) { res.writeHead(302, { location: '/' }); return res.end(); }
      res.writeHead(302, { location: `/l/${key}` });
      return res.end();
    }

    if (path.startsWith('/l/')) {
      const view = await lineView(path.slice(3));
      if (!view) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, page(`${LINE_META[view.key].label} — compare carriers | ${SITE_NAME}`,
        `<h1>${esc(LINE_META[view.key].label)}</h1>${view.html}`,
        { canonical: `${BASE_URL}/l/${view.key}`, description: `Compare ${LINE_META[view.key].label.toLowerCase()} carriers by financial strength and transparency — ${esc(LINE_META[view.key].note)}`, jsonld: view.jsonld }));
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
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/insurance\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Insurance on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
