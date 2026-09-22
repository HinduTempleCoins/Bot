// server.mjs — "The Case Law of Us" (a.k.a. History in the Reporters). A standalone, zero-dependency,
// server-rendered surface in the SoapBox house style built on ONE idea: the case reporters ARE a
// narrative history of this country. Famous figures live in the caselaw — Fred Hampton, Marcus Garvey,
// Huey Newton, the Chicago Seven, Muhammad Ali, Curt Flood, 2 Live Crew — and the courts themselves do
// deep historical, anthropological and legislative-history work (Holy Trinity's "Christian nation"
// survey, Lukumi on Santería sacrifice, O Centro on the ayahuasca tradition, Heller/Bruen on founding-era
// history). Under all of it: the ancient written codes that invented the idea of precedent-bearing law.
//
//   PORT=8127 BASE_URL=https://caselaw.soapbox.community node site/caselaw-history/server.mjs
//
// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
//   /                  the surface — three parts, grouped by era, every case verified with a real cite
//   /health            liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt   crawler/GEO plumbing
//
// ── DISCIPLINE (Bot Charter §3 — prove, don't claim; no fabrication) ───────────────────────────────
//   Every case name, reporter citation, year, figure, and fact on this surface is verified against the
//   public record. We are precise about what each case is CITED FOR — Lukumi is the animal-sacrifice
//   case, O Centro is the ayahuasca/RFRA case; they are never merged. Where a "case" is really a trial,
//   indictment, or preliminary hearing rather than a reported appellate opinion, the entry SAYS SO.
//   Facts, not verdicts: we state what happened and what a decision is cited for as public record — not
//   whether it was rightly decided or is currently good law. Soft-fail: a missing data file renders an
//   empty state; the page never throws.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8127);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LAW_SITE = (process.env.LAW_SITE || 'https://law.soapbox.community').replace(/\/$/, '');
const WIKI = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'The Case Law of Us';

// ── house-style escape (same table the other SoapBox servers use) ─────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

// ── injectable data seam — offline tests inject a fixture; production reads the JSON corpus ────────
const DATA_PATH = fileURLToPath(new URL('../../knowledge/legal/caselaw-as-history.json', import.meta.url));
let DATA_OVERRIDE = null;
/** Inject a data object for tests (pass null to clear and read the file again). */
export function __setData(d) { DATA_OVERRIDE = d || null; }
export function loadData() {
  if (DATA_OVERRIDE) return DATA_OVERRIDE;
  try {
    const j = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
    return (j && typeof j === 'object') ? j : { parts: [] };
  } catch { return { parts: [] }; }
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.65 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;min-width:0;display:flex;gap:10px;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin}
  .topbar-r::-webkit-scrollbar{height:6px} .topbar-r::-webkit-scrollbar-thumb{background:var(--line2);border-radius:6px}
  .topbar-r a{flex:0 0 auto;color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  @media (max-width:760px){header.topbar{position:static;padding:8px 14px}}
  .wrap{max-width:940px;margin:0 auto;padding:22px}
  h1{margin:0 0 8px;font-size:28px;line-height:1.25} h2{font-size:21px;margin:0 0 8px} h3{font-size:16px;margin:0 0 6px}
  .lede{font-size:17px;line-height:1.7;color:var(--fg);max-width:74ch} .lede.muted{color:var(--mut)}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:20px 22px;margin:16px 0}
  .part{scroll-margin-top:70px}
  .part-intro{font-size:15px;line-height:1.7;color:var(--fg);max-width:74ch;margin:0 0 6px}
  .toc{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 4px}
  .toc a{border:1px solid var(--line2);border-radius:20px;padding:6px 14px;color:var(--fg);font-weight:600;font-size:14px}
  .toc a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .era{margin:22px 0 6px} .era h3{font-size:15px;text-transform:uppercase;letter-spacing:.6px;color:var(--gold);margin:0 0 2px}
  .era .blurb{color:var(--mut);font-size:14px;margin:0 0 8px;max-width:74ch}
  .rec{padding:14px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:700;font-size:16px} .rec .fig{color:var(--gold);font-weight:600;font-size:14px}
  .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .rec p{margin:6px 0;font-size:14.5px;line-height:1.65;max-width:74ch}
  .rec .why{color:var(--fg)} .rec .why b{color:var(--gold);font-weight:700}
  .rec .xlink{font-size:13px;margin-top:6px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 8px;margin-left:6px;white-space:nowrap}
  .badge.warn{background:#d2992233;color:var(--gold)}
  .empty{color:var(--mut);padding:14px 0}
  details.faq{border:1px solid var(--line2);border-radius:10px;margin:0 0 8px;background:var(--panel)}
  details.faq>summary{cursor:pointer;padding:13px 16px;font-weight:700;font-size:15px;list-style:none}
  details.faq>summary::-webkit-details-marker{display:none}
  details.faq[open]>summary{border-bottom:1px solid var(--line)}
  details.faq .a{padding:13px 16px;color:var(--mut);font-size:14px;line-height:1.65}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Verified history, not verdicts.</b> Every case name, citation, year, and figure on this page is
  checked against the public record. We state what happened and what a decision is cited for — never
  whether it was rightly decided or is currently good law. Where a "case" is a trial, indictment, or
  hearing rather than a reported appellate opinion, the entry says so. U.S. caselaw and constitutional
  text are public domain. Informational and historical — not legal advice.
  <div style="margin-top:8px"><a href="/">${esc(SITE_NAME)}</a> · <a href="${esc(LAW_SITE)}">SoapBox Law</a> · <a href="${esc(WIKI)}">Library</a></div>
</footer>`;

// ── FAQ (visible on-page AND emitted as FAQPage JSON-LD — the SAME pairs, so structured data matches) ─
const HOME_FAQ = [
  { q: 'What does "the case law is a history of this country" mean?',
    a: 'The published court reports are, read end to end, a narrative history of the United States. The people '
     + 'who shaped the country appear in them by name as parties — Fred Hampton, Marcus Garvey, Huey Newton, '
     + 'Muhammad Ali, Curt Flood, the Chicago Seven — so the reporters preserve the movements, feuds, art, and '
     + 'conflicts of each era in the durable form of a docketed dispute.' },
  { q: 'Do courts really do historical and anthropological analysis?',
    a: 'Yes. Opinions routinely excavate history: Church of the Holy Trinity v. United States (1892) surveyed '
     + 'colonial charters and legislative history; Church of the Lukumi Babalu Aye v. City of Hialeah (1993) '
     + 'examined the history of Santería animal sacrifice; Gonzales v. O Centro Espírita (2006) addressed the '
     + 'ayahuasca sacramental tradition; and Heller (2008) and Bruen (2022) turn on founding-era history and '
     + 'tradition. Judges write history because the law tells them to.' },
  { q: 'Are all of these entries reported court opinions?',
    a: 'No, and the page is explicit about it. Some famous matters are trials, indictments, or preliminary '
     + 'hearings that never produced a reported appellate opinion — for example the 1881 Tombstone "Spicer '
     + 'hearing" after the O.K. Corral, or the 1995 O.J. Simpson criminal trial. Those entries are labeled as '
     + 'such rather than dressed up with an invented citation.' },
  { q: 'Is the ayahuasca case the same as the animal-sacrifice case?',
    a: 'No. They are two different Supreme Court cases and are never merged here. Church of the Lukumi Babalu '
     + 'Aye v. City of Hialeah, 508 U.S. 520 (1993), is the Santería animal-sacrifice case; Gonzales v. O '
     + 'Centro Espírita Beneficente União do Vegetal, 546 U.S. 418 (2006), is the ayahuasca (hoasca) case '
     + 'decided under the Religious Freedom Restoration Act.' },
];

// ── render helpers ─────────────────────────────────────────────────────────────────────────────────
// A single case entry. The case name links its verified source of record; a citation badge (and a
// SoapBox Law cross-link) let a reader pull the opinion. `figure` and `era` carry the "who lives here"
// framing; `what_happened` and `why_it_matters` are the verified prose. PURE.
function entryRow(e) {
  if (!e || typeof e !== 'object') return '';
  const name = e.case || 'Matter';
  const src = e.source_url || '';
  const nameHtml = src
    ? `<a href="${esc(src)}" rel="noopener nofollow">${esc(name)}</a>`
    : esc(name);
  const isOpinion = e.citation && /\b(U\.?S\.?|F\.?\s?\d|F\.?\s?(2d|3d|4th)|Cal\.|S\.?\s?Ct\.|L\.?\s?Ed\.|F\.?\s?Supp\.|F\.?\s?Cas\.)\b/.test(e.citation);
  const citeBadge = e.citation ? `<span class="badge${isOpinion ? '' : ' warn'}">${esc(e.citation)}</span>` : '';
  const yr = e.year ? `<span class=badge>${esc(e.year)}</span>` : '';
  // cross-link to the SoapBox Law case reader by citation, but only when this is a real reporter citation
  // (a trial/hearing descriptor is not something /cases can resolve).
  const lawLink = (isOpinion && e.citation)
    ? `<a href="${esc(LAW_SITE)}/cases?q=${q(e.citation)}" rel="noopener">look it up on SoapBox Law →</a>`
    : '';
  const srcLink = src ? `<a href="${esc(src)}" rel="noopener nofollow">source →</a>` : '';
  const links = [lawLink, srcLink].filter(Boolean).join(' · ');
  return `<div class=rec>
    <div class=nm>${nameHtml}${citeBadge}${yr}</div>
    ${e.figure ? `<div class=fig>${esc(e.figure)}</div>` : ''}
    ${e.what_happened ? `<p>${esc(e.what_happened)}</p>` : ''}
    ${e.why_it_matters ? `<p class=why><b>Why it lives in the reporters:</b> ${esc(e.why_it_matters)}</p>` : ''}
    ${links ? `<div class=xlink>${links}</div>` : ''}
  </div>`;
}

// Group a part's flat entries[] by `era`, preserving first-seen order, and render each era block. If the
// part supplies era_blurbs {era: text}, we caption each era. PURE.
function groupByEra(entries, eraBlurbs = {}) {
  const order = [];
  const buckets = new Map();
  for (const e of (Array.isArray(entries) ? entries : [])) {
    const era = (e && e.era) ? String(e.era) : 'Other';
    if (!buckets.has(era)) { buckets.set(era, []); order.push(era); }
    buckets.get(era).push(e);
  }
  if (!order.length) return '<p class=empty>No entries on record yet.</p>';
  return order.map((era) => {
    const blurb = eraBlurbs[era] ? `<div class=blurb>${esc(eraBlurbs[era])}</div>` : '';
    return `<div class=era><h3>${esc(era)}</h3>${blurb}</div>`
      + buckets.get(era).map(entryRow).join('');
  }).join('');
}

// One part (a section of the page): heading, intro prose, then the era-grouped entries. PURE.
function partSection(part) {
  if (!part || typeof part !== 'object') return '';
  const id = part.id || 'part';
  const grouped = groupByEra(part.entries, part.era_blurbs || {});
  return `<section id="${esc(id)}" class=part>
    <div class=card>
      <h2>${esc(part.title || 'Part')}</h2>
      ${part.intro ? `<p class=part-intro>${esc(part.intro)}</p>` : ''}
      ${grouped}
    </div>
  </section>`;
}

function faqCard(pairs, heading = 'Frequently asked questions') {
  const items = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.q && p.a);
  if (!items.length) return '';
  return `<div class=card><h2>${esc(heading)}</h2>${items.map((p) =>
    `<details class=faq><summary>${esc(p.q)}</summary><div class=a>${esc(p.a)}</div></details>`).join('')}</div>`;
}

// ── page shell (shared SEO head + house-style chrome) ─────────────────────────────────────────────
// "Act on this" — call-to-action on every page: OUR OWN legal tools first (they live on the law site),
// then external/official sources. Absolute URLs (separate subdomain).
function actOnThis() {
  return `<div class=card style="border-color:var(--gold)"><h2>Act on this</h2>
    <p>Somewhere to act on what you just read — start with our own tools:</p>
    <div class=xlink><a href="${LAW_SITE}/lawyers">Find a lawyer or legal aid →</a> · <a href="${LAW_SITE}/complaints">File a complaint / get help →</a> · <a href="${LAW_SITE}/appeals">Appeals, writs &amp; exhausting remedies →</a> · <a href="${LAW_SITE}/cases">Search the caselaw &amp; statutes →</a> · <a href="${LAW_SITE}/doctrines">Legal doctrines →</a></div>
    <p class=muted style="font-size:12px">Legal information, not legal advice.</p></div>`;
}

function page(title, body, opts = {}) {
  const desc = opts.description || `${SITE_NAME} — American history read through the case reporters: the figures who live in the caselaw, courts doing historical analysis, and the ancient codes that invented written law. Every case verified.`;
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: SITE_NAME, ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  const seoHead = seoHeadTags({
    analyticsBeacon: process.env.ANALYTICS_BEACON_URL || "https://analytics.soapbox.community/px", image: (opts && opts.image) || "https://image.pollinations.ai/prompt/law%20books%20and%20the%20US%20Constitution%20on%20a%20desk%2C%20warm%20library%20light%2C%20painterly%2C%20no%20text?width=1200&height=630&nologo=true&seed=7",
    title, description: desc, canonical, robots, siteName: SITE_NAME,
    site: { url: BASE_URL, name: SITE_NAME },
    jsonld: extra,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">§ ${esc(SITE_NAME)} <span>history in the reporters</span></a>
  <div class=topbar-r><a href="${esc(LAW_SITE)}">SoapBox Law</a><a href="${esc(LAW_SITE)}/cases">Cases</a><a href="${esc(LAW_SITE)}/constitution">Constitution</a><a href="${esc(WIKI)}">Library</a></div></header>
<main class=wrap>${body}${actOnThis()}${citeHtml}</main>
${FOOTER}</body></html>`;
}

// ── home — the whole surface ───────────────────────────────────────────────────────────────────────
export function homePage() {
  const data = loadData();
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const toc = parts.length
    ? `<nav class=toc>${parts.map((p) => `<a href="#${esc(p.id || 'part')}">${esc(p.nav || p.title || 'Part')}</a>`).join('')}</nav>`
    : '';
  const intro = `<h1>${esc(data.title || SITE_NAME)}</h1>
    <p class=lede>${esc(data.summary || 'The case reporters are a narrative history of this country. Famous figures live in the caselaw, and the courts themselves do deep historical work.')}</p>`;
  const sections = parts.length
    ? parts.map(partSection).join('')
    : '<div class=card><p class=empty>The corpus is being assembled. Check back shortly.</p></div>';
  const verified = data.verified_date
    ? `<p class=muted style="font-size:13px">Every entry verified against the public record. Corpus last verified ${esc(data.verified_date)}.</p>`
    : '';
  const body = `${intro}${verified}${toc}${sections}${faqCard(HOME_FAQ)}`;
  return page(`${SITE_NAME} — American history in the case reporters`, body, {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: SITE_NAME, url: `${BASE_URL}/` }],
    faq: HOME_FAQ,
    cite: {
      title: `${SITE_NAME} — American history in the case reporters`,
      url: `${BASE_URL}/`,
      datePublished: data.verified_date || undefined,
      dateModified: data.verified_date || undefined,
    },
  });
}

// ── /llms.txt — corpus-describing index for AI crawlers (GEO) ─────────────────────────────────────
export function caselawLlmsTxt() {
  const data = loadData();
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const base = llmsTxt({
    name: SITE_NAME, baseUrl: BASE_URL,
    summary: 'American history read through the case reporters — the famous figures who live in the caselaw, '
      + 'courts doing historical and legislative-history analysis, and the ancient codes that invented written '
      + 'law. Every case name, citation, year, and figure is verified against the public record.',
    links: parts.map((p) => ({ label: p.title || p.id, path: `/#${p.id || ''}`, note: p.nav || '' })),
  });
  const extra = [
    '## About this corpus',
    'A curated, verified reference: the case reporters as a narrative history of the United States. Each entry '
      + 'states the case name, reporter citation (or an honest descriptor when the matter is a trial/hearing '
      + 'rather than a reported opinion), year, the historical figure who is a party, what happened, and what '
      + 'the decision is cited for. It never merges distinct cases (e.g. Lukumi = Santería animal sacrifice; O '
      + 'Centro = ayahuasca/RFRA) and never fabricates a citation.',
    '',
    '## Discipline',
    'Facts, not verdicts. We state what happened and what a case is cited for as public record — not whether it '
      + 'was rightly decided or is currently good law. U.S. caselaw and constitutional text are public domain.',
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// ── HTTP handler (exported for tests; soft-fail-never-throw) ───────────────────────────────────────
export async function handler(req, res) {
  let pathname = '/';
  try { pathname = new URL(req.url, BASE_URL).pathname; } catch { pathname = '/'; }

  const send = (code, type, bodyStr) => {
    res.writeHead(code, { 'content-type': type, 'x-content-type-options': 'nosniff' });
    res.end(bodyStr);
  };

  try {
    if (pathname === '/health') return send(200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, service: 'caselaw-history' }));
    if (pathname === '/robots.txt') return send(200, 'text/plain; charset=utf-8', robotsTxt(BASE_URL));
    if (pathname === '/sitemap.xml') return send(200, 'application/xml; charset=utf-8', sitemapXml(BASE_URL, [{ path: '/', changefreq: 'monthly', priority: '1.0' }]));
    if (pathname === '/sitemap-index.xml') return send(200, 'application/xml; charset=utf-8', publicSitemapIndexXml());
    if (pathname === '/llms.txt') return send(200, 'text/plain; charset=utf-8', caselawLlmsTxt());
    if (pathname === '/' || pathname === '') return send(200, 'text/html; charset=utf-8', homePage());
    // unknown path → render home with a 404 status but never throw (soft-fail).
    return send(404, 'text/html; charset=utf-8', homePage());
  } catch (err) {
    // last-resort soft-fail: a minimal page, never a 500 stack.
    try { return send(200, 'text/html; charset=utf-8', page(SITE_NAME, '<div class=card><p class=empty>Temporarily unavailable.</p></div>')); }
    catch { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  }
}

// ── CLI guard — only bind a port when run directly ────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`${SITE_NAME} on http://${HOST}:${PORT}`);
  });
}
