// server.mjs — ScamAlert.SoapBox.Community. The consumer-protection / scam-alert vertical as a
// standalone, zero-dependency HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs).
// It fronts the ALREADY-BUILT Local Business Intelligence engine (integrations/local-business-intel.mjs)
// and the official-record gov readers in integrations/soapbox/*, binding them into ONE honest
// consumer-protection surface: search a company → see the OFFICIAL RECORDS about it, each stated as a
// FACT with a source link, plus a data-driven Clarity signal and a §230 right-of-reply.
//
//   PORT=8182 BASE_URL=https://scam-alert.soapbox.community node site/scam-alert/server.mjs
//
// ── Routes ────────────────────────────────────────────────────────────────────────────────────────
//   /                portal home — intro + company search box + which official sources we aggregate
//   /company?q=NAME  a per-company report (also accepts &report=..&handle=.. to append a user report)
//   /company/<slug>  the same report addressed by slug
//   /health          liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── HARD DISCIPLINE (baked in, not just hoped-for) ──────────────────────────────────────────────────
//   FACTS-NOT-VERDICTS. Official government records are stated as FACTS, each tagged with its source
//     and a source LINK. Truth is an absolute defense. The platform NEVER renders "they are scammers":
//     there is no verdict function anywhere. The Clarity signal SUMMARIZES the official-record count and
//     renders its basis ("based on official records"); it is data, never a human judgement. We prove this
//     at runtime with assertNoVerdict(page) — same unbiased/no-verdict stance as the watchdog dossiers.
//   USER SCAM REPORTS are §230 user content: they go through addScamReport() and are ALWAYS rendered
//     labeled USER-SUBMITTED / UNVERIFIED (moderation, not fact). No PII intake beyond an optional handle.
//   SOFT-FAIL-NEVER-THROW. Every reader can be down; each section renders honestly ("No official records
//     found") rather than erroring. A dead source never breaks the page.
//   esc() ON EVERY INTERPOLATED VALUE — defamation AND XSS both matter on a page like this.
//
// ── ENGINE REUSE ────────────────────────────────────────────────────────────────────────────────────
//   local-business-intel.businessPage() ALREADY aggregates FDA / CPSC / CFPB / SEC EDGAR internally
//   (via its defaultSources()). We WRAP it and additionally COMPOSE the official readers it does not
//   cover — SAM.gov federal exclusions/debarment (a strong predator signal), USDA FSIS recalls,
//   CourtListener court opinions, and the scam-registry's *government* signals (e.g. SEC PAUSE) —
//   merging each as a sourced FACT into page.officialRecords, then recomputing Clarity over the union.
//   Extra readers sit behind __setExtraSources() so tests stay fully offline; each underlying reader
//   also keeps its own __setFetch() seam.

import { createServer } from 'node:http';

import {
  businessPage, renderPage as renderBusinessPage, assertNoVerdict, addScamReport,
  clarityFromRecords, __setSources, __resetSources, esc as escFact,
} from '../../integrations/local-business-intel.mjs';

import * as samGov from '../../integrations/soapbox/sam-gov.mjs';
import * as fsis from '../../integrations/soapbox/fsis-recalls.mjs';
import * as court from '../../integrations/soapbox/courtlistener-opinions.mjs';
import * as scamRegistry from '../../integrations/soapbox/scam-registry.mjs';

import { companyLinks } from '../../integrations/cross-links.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8182);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const INSURANCE = process.env.INSURANCE_SITE || 'https://insurance.soapbox.community';
const SITE_NAME = 'SoapBox Scam Alert';

// esc() — reuse the engine's escape so every interpolated value is escaped identically. Defamation
// (a stray verdict word) and XSS (a hostile company name / user report) are BOTH escaped here.
export const esc = escFact;

const str = (s) => (s == null ? '' : String(s)).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

// ── the official sources we aggregate (shown on the home page + llms.txt) ───────────────────────────
// The first four are pulled INSIDE local-business-intel.businessPage(); the last four we compose here.
export const OFFICIAL_SOURCES = Object.freeze([
  { label: 'FDA recalls & enforcement', by: 'engine', note: 'food / drug / device / cosmetic recalls (openFDA)' },
  { label: 'CPSC product recalls', by: 'engine', note: 'SaferProducts.gov consumer-product recalls & penalties' },
  { label: 'CFPB consumer complaints', by: 'engine', note: 'consumer-finance complaints filed against the company' },
  { label: 'SEC EDGAR filings', by: 'engine', note: 'registered-company filings & enforcement (full-text search)' },
  { label: 'SAM.gov federal exclusions', by: 'composed', note: 'federal debarment / exclusion list — a strong predator signal' },
  { label: 'USDA FSIS recalls', by: 'composed', note: 'meat / poultry / egg product recalls' },
  { label: 'CourtListener opinions', by: 'composed', note: 'published court opinions naming the company' },
  { label: 'SEC PAUSE & regulator alerts', by: 'composed', note: 'government scam/impostor alerts (scam-registry)' },
]);

// ── composed extra sources (readers businessPage does NOT already cover) ─────────────────────────────
// Each adapter maps a reader's native shape into the engine's flat FACT record
// { kind:'fact', source, sourceUrl, asOf, title, detail } and SOFT-FAILS to [] on any error, so a dead
// reader yields an empty section, never a thrown page. Tests override the whole set via __setExtraSources.
const fact = ({ source, sourceUrl, asOf, title, detail }) => ({
  kind: 'fact',
  source: str(source),
  sourceUrl: str(sourceUrl) || null,
  asOf: str(asOf) || null,
  title: str(title) || null,
  detail: str(detail) || null,
});

function defaultExtraSources() {
  return {
    // SAM.gov — federal exclusion / debarment. Present only when a SAM API key is configured; without one
    // the reader returns { skipped:true } and we honestly contribute nothing.
    samExclusions: async ({ name }) => {
      const data = await samGov.exclusions({ name: str(name) }).catch(() => null);
      return arr(data?.records).map((r) => fact({
        source: 'SAM.gov Exclusions',
        sourceUrl: 'https://sam.gov/search/?index=ex',
        asOf: r.activeDate,
        title: `Federal exclusion: ${str(r.exclusionType) || str(r.classification) || 'listed'}`,
        detail: [str(r.name), str(r.agency)].filter(Boolean).join(' — ') || null,
      }));
    },
    // USDA FSIS — meat/poultry/egg recalls naming the company.
    fsisRecalls: async ({ name }) => {
      const rows = await fsis.recalls({ query: str(name), limit: 10 }).catch(() => []);
      return arr(rows).map((r) => fact({
        source: 'USDA FSIS',
        sourceUrl: r.url || 'https://www.fsis.usda.gov/recalls',
        asOf: r.date,
        title: str(r.title) || 'FSIS recall',
        detail: [str(r.company), str(r.reason)].filter(Boolean).join(' — ') || null,
      }));
    },
    // CourtListener — published court opinions naming the company.
    courtOpinions: async ({ name }) => {
      if (!str(name)) return [];
      const rows = await court.searchCases({ q: str(name), limit: 8 }).catch(() => []);
      return arr(rows).map((r) => fact({
        source: 'CourtListener',
        sourceUrl: r.url || 'https://www.courtlistener.com',
        asOf: r.dateFiled,
        title: str(r.caseName) || 'Court opinion',
        detail: str(r.snippet) || str(r.court) || null,
      }));
    },
    // scam-registry — GOVERNMENT signals only (e.g. SEC PAUSE, SEC EDGAR). Community/commercial signals are
    // deliberately NOT folded in as facts (they are not official records); only kind:'gov' reports qualify.
    regulatorAlerts: async ({ name }) => {
      if (!str(name)) return [];
      const sig = await scamRegistry.scamSignals(str(name)).catch(() => null);
      return arr(sig?.reports)
        .filter((rep) => rep && rep.kind === 'gov')
        .map((rep) => fact({
          source: str(rep.source) || 'Government alert',
          sourceUrl: 'https://www.sec.gov/litigation/sec-action-look-up-individuals',
          asOf: sig?.checked_at,
          title: `${str(rep.source)} listing`,
          detail: str(rep.detail) || null,
        }));
    },
  };
}

let _extra = defaultExtraSources();
/** Override the composed extra sources with injected fakes (offline tests) or restore with no arg. */
export function __setExtraSources(s) {
  _extra = s && typeof s === 'object' ? { ...defaultExtraSources(), ...s } : defaultExtraSources();
}
export function __resetExtraSources() { _extra = defaultExtraSources(); }

// Run one extra source with per-section soft-fail → [] (never throws, never breaks the page).
async function softExtra(fn, args) {
  try { const v = await fn(args); return arr(v); } catch { return []; }
}

// ── companyReport: wrap businessPage, compose the extra readers, recompute Clarity ──────────────────
/**
 * Build ONE company report page. businessPage() already covers FDA/CPSC/CFPB/SEC EDGAR; we union in the
 * composed extra official records and recompute Clarity over the whole set. assertNoVerdict() is run so a
 * report can NEVER ship a platform verdict — a merged record that wasn't a sourced fact would throw here.
 */
export async function companyReport(name, { registrationId } = {}) {
  const business = { name: str(name), registrationId: str(registrationId) || undefined };
  const page = await businessPage(business).catch(() => null) || {
    kind: 'business-page', identity: { name: str(name) }, officialRecords: [],
    reviews: { own: [], windowed: [] }, scamReports: [],
    neighborhood: { census: null }, clarity: clarityFromRecords([]),
    rightOfReply: { open: true, howTo: '' },
  };

  const args = { name: str(name) };
  const extraGroups = await Promise.all([
    softExtra(_extra.samExclusions, args),
    softExtra(_extra.fsisRecalls, args),
    softExtra(_extra.courtOpinions, args),
    softExtra(_extra.regulatorAlerts, args),
  ]);
  const extras = extraGroups.flat().filter((r) => r && r.kind === 'fact' && r.source);

  page.officialRecords = arr(page.officialRecords).concat(extras);
  // Recompute the Clarity signal over the UNION of official records (engine + composed).
  page.clarity = clarityFromRecords(page.officialRecords);

  assertNoVerdict(page); // runtime proof: no platform verdict ever leaves this function
  return page;
}

// slug <-> name. Slug is lowercase, non-alnum → '-'. The name we search is the de-slugged text.
export const slugify = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const deslug = (s) => str(s).replace(/-+/g, ' ').trim();

// ── shared house-style shell (same dark theme as Insurance/Coupons/Hemp/Law) ────────────────────────
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
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec .t{font-weight:700;font-size:15px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .business-page h2{font-size:22px} .business-page section{border:1px solid var(--line2);border-radius:10px;padding:14px 18px;margin:12px 0;background:var(--panel)}
  .business-page ul{margin:6px 0;padding-left:18px} .business-page li{margin:6px 0}
  .business-page .src{color:var(--blue)} .business-page .asof{color:var(--mut);font-size:12px}
  .business-page .empty{color:var(--mut)}
  .business-page .clarity-score{font-size:30px;font-weight:800;margin:4px 0}
  .business-page .disclaimer{color:var(--mut);font-size:13px}
  .business-page .scam-report .byline,.business-page .user-review .byline{color:var(--gold);font-weight:700;font-size:13px}
  .facts-banner{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  .unverified-note{background:#f8514911;border:1px solid var(--down);border-radius:8px;padding:8px 12px;color:var(--down);font-size:13px;margin:10px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FACTS_BANNER = 'Facts, not verdicts. We state official government records and link each to its source. '
  + 'We do NOT call any business a "scam." User reports below are unverified and are not our claims.';

const FOOTER = `<footer>
  <b>Consumer protection with sources, not accusations.</b> SoapBox Scam Alert aggregates OFFICIAL government
  records — recalls, complaints, filings, federal exclusions and court opinions — and states each as a fact with
  a link to its source. We never publish a verdict, and user-submitted reports are labeled unverified. Every
  business has a standing right of reply. This is information, not legal, financial, or investment advice.
  <div style="margin-top:8px"><a href="/">Scam Alert</a> · <a href="${esc(INSURANCE)}">Insurance</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'Look up a company against official government records — FDA/CPSC/FSIS recalls, '
    + 'CFPB complaints, SEC filings, SAM.gov federal exclusions and court opinions — each stated as a fact with a '
    + 'source link. Facts, not verdicts. Not legal or financial advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/company?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🛡️ SoapBox <span>scam alert</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="${esc(INSURANCE)}">Insurance</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(value = '') {
  return `<form class=hsearch method=get action="/company"><div class=row>
    <input class=q name="q" value="${esc(value)}" placeholder="Company or business name, e.g. Acme Diner" autocomplete=off aria-label="Company name">
    <button type=submit>Check records</button>
  </div></form>`;
}

// ── home ────────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = OFFICIAL_SOURCES.map((s) => (
    `<div class=sec><div class=t>${esc(s.label)}</div><div class=d>${esc(s.note)}</div></div>`
  )).join('');
  const body = `<h1>SoapBox Scam Alert <span class=muted style="font-size:14px">· official records, not accusations</span></h1>
    <p class=muted>Search a company to see the <b>official government records</b> about it — recalls, consumer
      complaints, regulatory filings, federal exclusions and court opinions — each stated as a fact and linked to
      its source. We do not call anyone a scammer; we show you the records and let you decide.</p>
    ${searchForm()}
    <div class="facts-banner" role="note">${esc(FACTS_BANNER)}</div>
    <div class=card><h2>Official sources we aggregate</h2>
      <div class=grid style="margin-top:8px">${cards}</div></div>
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">Government records are <b>facts</b> — truth is an absolute defense, so
      we host them flatly, each with its source link. The Clarity signal only <b>summarizes how many official
      records exist</b>; it is data, never a verdict. User-submitted reports are §230 user content, always labeled
      <b>unverified</b>. Every business has a standing right of reply. We collect no personal information.</p></div>`;
  return pageShell(`${SITE_NAME} — check a company against official records`, body, { canonical: `${BASE_URL}/` });
}

// ── company report page ─────────────────────────────────────────────────────────────────────────────
/**
 * Render the full company report. `report`/`handle` (optional) append a §230 user scam report, which is
 * rendered by the engine labeled as user content; we add an explicit UNVERIFIED note above it. No PII is
 * accepted beyond an optional handle.
 */
export async function companyPage(name, { report, handle } = {}) {
  const page = await companyReport(name);
  let unverifiedNote = '';
  if (str(report)) {
    // §230 user content: NEVER authored by the platform, ALWAYS labeled unverified. Only an optional handle.
    addScamReport(page, { user: str(handle) || 'anonymous', text: str(report) });
    assertNoVerdict(page); // a user report can't turn the page into a platform verdict
    unverifiedNote = `<div class="unverified-note" role="note">Thank you. Your report was added as
      <b>USER-SUBMITTED / UNVERIFIED</b> content — it is not a claim by SoapBox and has not been verified.</div>`;
  }
  const facts = page.officialRecords.length;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: str(page.identity && page.identity.name) || str(name),
    subjectOf: { '@type': 'Dataset', name: `${facts} official record(s)` },
  };
  const cl = companyLinks(str(name));
  const body = `${searchForm(str(name))}
    <div class="facts-banner" role="note">${esc(FACTS_BANNER)}</div>
    ${unverifiedNote}
    ${renderBusinessPage(page)}
    <div class=card><h3>Across SoapBox</h3>
      <p style="font-size:13px"><a href="${esc(cl.stocks)}" rel="noopener">Company / stock profile →</a>
      · <a href="${esc(cl.law)}" rel="noopener">Court cases mentioning ${esc(str(name))} →</a>
      · <a href="${esc(cl.scams)}" rel="noopener">SoapBox scam &amp; fraud check →</a></p></div>
    <div class=card><h3>Report an experience (optional)</h3>
      <p class=muted style="font-size:13px">Reports are user-submitted and shown <b>unverified</b>. Optional handle
      only — no personal information.</p>
      <form class=hsearch method=get action="/company"><div class=row>
        <input type=hidden name="q" value="${esc(name)}">
        <input class=q name="handle" placeholder="handle (optional)" autocomplete=off aria-label="handle">
        <input class=q name="report" placeholder="what happened" autocomplete=off aria-label="what happened">
        <button type=submit>Submit report</button>
      </div></form></div>`;
  return pageShell(`${str(name) || 'Company'} — official records | ${SITE_NAME}`, body, {
    canonical: `${BASE_URL}/company/${slugify(name)}`,
    description: `Official government records for ${str(name)} — recalls, complaints, filings, exclusions and court records, each with a source link. Facts, not verdicts.`,
    jsonld,
  });
}

// ── routing ──────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/'];

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
        path: u, lastmod: today, changefreq: 'daily', priority: '1.0',
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
        summary: 'Look up a company against official government records (FDA/CPSC/FSIS recalls, CFPB complaints, SEC '
          + 'filings, SAM.gov federal exclusions, CourtListener opinions, regulator alerts). Facts stated with source '
          + 'links; never a verdict. User reports are unverified §230 content. Not legal or financial advice.',
        links: OFFICIAL_SOURCES.map((s) => ({ label: s.label, path: '/' })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    // /company?q=NAME  (and optional &report=..&handle=..)
    if (path === '/company') {
      const q = url.searchParams.get('q') || '';
      if (!str(q)) { res.writeHead(302, { location: '/' }); return res.end(); }
      const report = url.searchParams.get('report') || '';
      const handle = url.searchParams.get('handle') || '';
      return sendHtml(res, await companyPage(q, { report, handle }));
    }

    // /company/<slug>
    if (path.startsWith('/company/')) {
      const name = deslug(decodeURIComponent(path.slice('/company/'.length)));
      if (!str(name)) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, await companyPage(name));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// re-export engine seams for tests + expose seo helpers
export { __setSources, __resetSources, assertNoVerdict, addScamReport, clarityFromRecords, siteGraph, jsonLdScript };

// Only bind the port when run directly, not when imported by tests. CLI guard scoped to site/scam-alert/.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/scam-alert\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Scam Alert on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
