// server.mjs — Law.SoapBox.Community. The legal portal subdomain (operator decision 2026-06-03): a
// standalone, zero-dependency HTTP service in the SoapBox house style that fronts the already-built,
// keyless legal readers and binds them into ONE cross-linked surface — the operator's
// "case-files ↔ judges" connection made navigable. Read-only, server-rendered, no keys, no custody.
//
//   PORT=8099 BASE_URL=https://law.soapbox.community node site/law/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            portal home — one search box (cases ∣ statutes) + section cards
//   /cases       CourtListener opinion search + CAP citation lookup ("347 U.S. 483" resolves)
//   /statutes    U.S.C. citation parser (official OLRC + Cornell LII links) + eCFR full-text search
//   /regulations Federal Register — recent documents by agency
//   /judges      CourtListener judge profiles (search → profile + positions + disclosures)
//   /lawyers     lawyer-directory attorney search (public bar facts; no rating, by design)
//   /complaints  where-to-file public-interest links (legal aid, bar referral, agency complaints)
//   /health      liveness probe
//   /robots.txt /sitemap.xml
//
// ── JURISDICTION NAMESPACING (extension plan — designed in from day one) ─────────────────────────
//   The United States is jurisdiction #1. Every reader here is US-federal (CourtListener, CAP, OLRC
//   U.S. Code, eCFR, Federal Register) or US-state (the bar directory). To keep the URL space open for
//   other jurisdictions, the canonical future form of every content path is:
//
//       /<jurisdiction>/<section>[/...]      e.g.  /us/cases   /us/statutes   /eu/regulations
//
//   Today the bare paths (/cases, /statutes, …) are treated AS the US namespace — i.e. /cases is an
//   implicit alias of /us/cases. The router already accepts an optional leading /us/ segment and strips
//   it (JURISDICTIONS gates which prefixes are legal), so adding a second jurisdiction later means:
//     (1) add its code to JURISDICTIONS, (2) branch the section handlers on `juris`, (3) point the bare
//   paths at whichever jurisdiction is the site default. No route rewrite, no link churn. The
//   facts-not-verdicts / public-domain / right-of-reply discipline is jurisdiction-independent and lives
//   in the footer + each reader's dataNote(), so it travels with any new jurisdiction unchanged.
//
// ── DISCIPLINE (inherited verbatim from the readers, v3 §10) ─────────────────────────────────────
//   Facts, not verdicts. State the case name / citation / status; never a holding-summary or
//   "good law" judgment. Public-domain caselaw + statute, hosted forever, attributed to the digitizer.
//   Source links on every record. Right-of-reply: corrections route to the source of record. Soft-fail:
//   every route renders an empty-state page if a reader returns [] — the page never breaks or throws.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';
import * as opinions from '../../integrations/soapbox/courtlistener-opinions.mjs';
import * as cap from '../../integrations/soapbox/caselaw-cap.mjs';
import * as ecfr from '../../integrations/soapbox/ecfr.mjs';
import * as fedreg from '../../integrations/soapbox/federal-register.mjs';
import * as uscode from '../../integrations/soapbox/uscode.mjs';
import * as judges from '../../integrations/soapbox/courtlistener-judges.mjs';
import * as lawyers from '../../integrations/soapbox/lawyer-directory.mjs';
import { judgeLinks, companyLinks, categoryLinks } from '../../integrations/cross-links.mjs';
import { ingestCase } from '../../integrations/legal-knowledge-graph.mjs';
import * as privacy from '../../integrations/soapbox/privacy-law-map.mjs';
import * as appeals from '../../integrations/soapbox/appeals-engine.mjs';
import * as sol from '../../integrations/soapbox/spirit-of-the-laws.mjs';
import { adSlot, headTags as adHeadTags, slotStyles as adSlotStyles } from '../../integrations/soapbox/ad-slot.mjs';

const PORT = +(process.env.PORT || 8099);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const DIRECTORY = process.env.DIRECTORY_SITE || 'https://directory.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const OVERSIGHT = process.env.OVERSIGHT_SITE || 'https://oversight.soapbox.community';
const CASELAW = process.env.CASELAW_SITE || 'https://caselaw.soapbox.community';

// Jurisdiction registry. US is jurisdiction #1; the bare paths alias to it. Add a code here to open a
// new jurisdiction's URL prefix (see the extension plan in the header).
const JURISDICTIONS = { us: 'United States' };
const DEFAULT_JURISDICTION = 'us';

// ── monetization rail (SURFACES_USERS_ANALYTICS.md §4 — the #1 near-term-dollar lever) ────────────────
// Law is the first surface wired for the display-ad / affiliate rail: high organic traffic, and legal
// content is brand-safe, high-CPM, and squarely inside AdSense policy (the reason law goes first, ahead
// of the harm-reduction shelves where AdSense is a poor fit). The slot is env-gated AND behind this
// feature flag — LAW_ADS=1 turns it on; with no AD_CLIENT set it renders a labeled placeholder, so the
// slot geometry + impression tracking can be verified before an id exists. Default OFF.
const LAW_ADS = /^(1|true|yes|on)$/i.test(String(process.env.LAW_ADS || '').trim());
const ADS = { enabled: LAW_ADS };

// ── shared house-style helpers (same dark theme + slim cross-linked bar as Stocks/Search) ─────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Federal Register agencies people most often want recent rulemaking from. Slug → label.
const FR_AGENCIES = [
  ['environmental-protection-agency', 'EPA'],
  ['securities-and-exchange-commission', 'SEC'],
  ['food-and-drug-administration', 'FDA'],
  ['federal-communications-commission', 'FCC'],
  ['internal-revenue-service', 'IRS'],
  ['federal-trade-commission', 'FTC'],
  ['consumer-financial-protection-bureau', 'CFPB'],
  ['federal-reserve-system', 'Federal Reserve'],
  ['department-of-labor', 'Labor'],
  ['department-of-justice', 'Justice'],
];
const FR_AGENCY_LABEL = Object.fromEntries(FR_AGENCIES.map(([s, l]) => [s, l]));

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .up{color:var(--up)} .down{color:var(--down)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.lawsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  input.q{flex:1 1 320px;min-width:220px;max-width:520px} input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .tabs{display:inline-flex;border:1px solid var(--line2);border-radius:20px;overflow:hidden;margin:0 0 12px}
  .tabs a{padding:7px 16px;color:var(--mut);font-weight:600;font-size:14px} .tabs a.on{background:var(--blue);color:#06101f}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .rec .xlink{font-size:13px;margin-top:4px} .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  blockquote{border-left:3px solid var(--line2);margin:8px 0;padding:2px 0 2px 12px;color:var(--mut);font-size:13px}
  article.opinion{font-size:15px;line-height:1.75;color:var(--fg);max-width:72ch} article.opinion p{margin:0 0 14px}
  table{width:100%;border-collapse:collapse} td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
  .empty{color:var(--mut);padding:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
  /* privacy-law map (federal↔Texas statute→case-law visualization) */
  .plm-legend{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 16px}
  .plm-leg,.plm-pat{font-size:12px;border:1px solid var(--line2);border-radius:20px;padding:3px 10px;color:var(--mut)}
  .plm-leg b{color:var(--fg)}
  .plm-pairing{border:1px solid var(--line2);border-radius:10px;margin:0 0 10px;background:var(--panel)}
  .plm-pairing>summary{cursor:pointer;padding:13px 16px;font-weight:700;font-size:16px;list-style:none;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .plm-pairing>summary::-webkit-details-marker{display:none}
  .plm-pairing[open]>summary{border-bottom:1px solid var(--line)}
  .plm-topic{color:var(--fg)} .plm-pat{margin-left:auto}
  .plm-body{padding:14px 16px}
  .plm-plain{color:var(--mut);font-size:14px;line-height:1.6;margin:0 0 14px}
  .plm-statutes{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}
  .plm-statute{flex:1 1 260px;border:1px solid var(--line);border-radius:8px;padding:12px;background:#0b0f14}
  .plm-texas{border-color:var(--gold)}
  .plm-kind{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut)}
  .plm-name{font-weight:600;font-size:15px;margin:3px 0 4px} .plm-eff{font-size:12px;color:var(--mut);margin-top:5px}
  .plm-verify{color:var(--gold)} .plm-link{margin-top:8px;font-size:13px}
  .plm-arrow{align-self:center;color:var(--mut);font-size:20px;flex:0 0 auto}
  .plm-cases{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
  .plm-cases h4{margin:0 0 8px;font-size:14px} .plm-cases-link{margin-top:14px;font-size:14px}
  .plm-case{padding:8px 0;border-bottom:1px solid var(--line)} .plm-case:last-child{border-bottom:0}
  .plm-case-nm{font-weight:600;font-size:14px} .plm-case-meta{color:var(--mut);font-size:12px;margin-top:2px}
  /* appeals & writs (pro-se ladder) */
  .ape-lbl{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--mut);font-weight:600}
  .ape-juris{margin:0 0 16px}
  .ape-legend{color:var(--mut);font-size:12px;margin:2px 0 12px}
  .ape-rungs{display:flex;flex-direction:column;gap:10px}
  .ape-rung{border:1px solid var(--line2);border-radius:10px;padding:12px 14px;background:var(--panel)}
  .ape-rung.ape-open{border-color:var(--blue)} .ape-rung.ape-locked{opacity:.92;border-style:dashed}
  .ape-rung-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .ape-tier{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:#0b0f14;border:1px solid var(--line2);color:var(--mut);font-weight:700;font-size:13px;display:inline-flex;align-items:center;justify-content:center}
  .ape-rung-nm{font-weight:700;font-size:16px}
  .ape-rung-plain{color:var(--mut);font-size:13px;margin:6px 0 4px} .ape-rung-links{font-size:13px}
  .ape-badge{font-size:11px;border-radius:8px;padding:1px 7px;margin-left:2px}
  .ape-badge-last{background:#d2992233;color:var(--gold)} .ape-badge-danger{background:#f8514933;color:var(--down)}
  .ape-tick{color:var(--up);font-weight:700} .ape-lock{color:var(--gold);font-weight:700}
  .ape-alert{border:1px solid var(--line2);border-radius:10px;padding:12px 14px;margin:12px 0}
  .ape-alert-t{font-weight:700;margin-bottom:4px}
  .ape-alert.ape-danger{border-color:var(--down);background:#f8514912} .ape-alert.ape-danger .ape-alert-t{color:var(--down)}
  .ape-alert.ape-warn{border-color:var(--gold);background:#d2992212} .ape-alert.ape-warn .ape-alert-t{color:var(--gold)}
  .ape-alert.ape-info{border-color:var(--blue);background:#1f6feb12}
  .ape-alert p{margin:4px 0;font-size:14px}
  .ape-detail h2{margin:6px 0 8px} .ape-detail h3{margin:16px 0 6px;font-size:15px} .ape-detail h4{margin:12px 0 6px;font-size:14px}
  .ape-teach p{margin:4px 0 10px;font-size:14px;line-height:1.6}
  .ape-note{color:var(--mut);font-size:13px;margin:4px 0 10px}
  .ape-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
  .ape-field{border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:#0b0f14}
  .ape-field-l{font-weight:700;font-size:14px} .ape-field-h{color:var(--mut);font-size:12px;margin:3px 0 6px}
  .ape-field-blank{border:1px dashed var(--line2);border-radius:6px;padding:8px;color:var(--mut);font-size:12px;text-align:center}
  .ape-format ul{margin:6px 0;padding-left:18px} .ape-format li{font-size:13px;margin:4px 0}
  .ape-verify{color:var(--gold)}
  .ape-deadline{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:6px 0;background:#0b0f14}
  .ape-deadline.ape-danger{border-color:var(--down)} .ape-deadline.ape-warn{border-color:var(--gold)}
  .ape-dl-w{font-weight:700;font-size:14px;display:block} .ape-dl-t{font-size:13px;color:var(--fg)}
  .ape-auth,.ape-ord,.ape-respondent{padding:8px 0;border-bottom:1px solid var(--line)} .ape-auth:last-child,.ape-ord:last-child{border-bottom:0}
  .ape-auth-nm,.ape-ord-nm{font-weight:600;font-size:14px} .ape-auth-note,.ape-ord-note{color:var(--mut);font-size:13px;margin-top:2px}
  .ape-disclaimer{border:1px solid var(--gold);border-radius:10px;padding:14px 16px;margin:16px 0;background:#d2992212}
  .ape-disclaimer p{margin:6px 0;font-size:13px}
  .ape-empty{color:var(--mut);padding:14px 0}
</style>`;

// Facts-not-verdicts footer — load-bearing discipline, on EVERY page. Names the public-domain posture,
// the source-of-record correction path (right-of-reply), and the not-advice line.
const FOOTER = `<footer>
  <b>Facts, not verdicts.</b> Law.SoapBox states the public record — case names, citations, statuses,
  citation links — and never a holding-summary, a "good law / bad law" judgment, or legal advice.
  U.S. caselaw and federal statute are <b>public domain</b>, hosted forever and attributed to the
  digitizer of record (Caselaw Access Project · Free Law Project · OLRC). Every record links its
  official source. <b>Right of reply:</b> corrections route to the source of record (CAP / Free Law
  Project / OLRC / the relevant agency) — we surface, we do not adjudicate. Informational only — not
  legal advice; for advice, consult a licensed attorney.
  <div style="margin-top:8px"><a href="/">Law</a> · <a href="${OVERSIGHT}">Oversight</a> · <a href="${DATA}">Data</a> · <a href="${SEARCH}">Search</a> · <a href="${DIRECTORY}">Directory</a> · <a href="${WIKI}">Library</a></div>
</footer>`;

// SearchAction target — Law has a real GET results page (/cases?q=…), so the site graph can advertise a
// sitelinks searchbox. The literal {search_term_string} token MUST live inside the urlTemplate.
const SEARCH_URL_TEMPLATE = `${BASE_URL}/cases?q={search_term_string}`;

// Structured-data + full SEO <head>. Delegates to the shared house-style helper (integrations/soapbox/seo.mjs)
// so Law emits the SAME OpenGraph + Twitter-card + JSON-LD (Organization + WebSite + SearchAction, plus any
// per-page BreadcrumbList / FAQPage / citation node) as the other SoapBox surfaces — instead of the bare
// title/description/canonical it carried before. All builders esc() and soft-fail. opts:
//   description, canonical, robots  — as before (canonical/robots/description also feed OG/Twitter)
//   breadcrumb : [{name,url}]  → BreadcrumbList JSON-LD (emit on section pages)
//   faq        : [{q,a}]       → FAQPage JSON-LD (ONLY when the same Q&A are visible on the page)
//   cite       : citationBlock() opts → a visible "Cite this page" block (GEO) + its JSON-LD node
//   jsonld     : extra JSON-LD node(s) appended after the site graph
function page(title, body, opts = {}) {
  const desc = opts.description || 'Law.SoapBox — U.S. caselaw, statutes, regulations, judges, and lawyer records. Facts, not verdicts. Public-domain, keyless, source-linked.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';

  // assemble the extra JSON-LD nodes (site graph is emitted by seoHeadTags via `site`).
  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: 'SoapBox Law', ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  if (opts.jsonld) for (const j of [].concat(opts.jsonld)) if (j) extra.push(j);

  const seoHead = seoHeadTags({
    title, description: desc, canonical, robots, siteName: 'SoapBox Law',
    site: { url: BASE_URL, name: 'SoapBox Law', searchUrlTemplate: SEARCH_URL_TEMPLATE },
    jsonld: extra,
  });

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}${LAW_ADS ? `<style>${adSlotStyles()}</style>` : ''}<script defer src="https://soapy.blog/b.js"></script><noscript><img src="https://soapy.blog/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript>${adHeadTags(ADS)}</head><body>
<header class=topbar><a class=brand href="/">⚖ SoapBox <span>law</span></a>
  <div class=topbar-r><a href="/constitution" title="Foundational Law">Constitution</a><a href="/treaties">Treaties</a><a href="/cases">Cases</a><a href="/dockets">Dockets</a><a href="/statutes">Statutes</a><a href="/regulations">Regulations</a><a href="/privacy">Privacy law</a><a href="/appeals">Appeals &amp; writs</a><a href="/rights">Your rights</a><a href="/doctrines">Doctrines</a><a href="/spirit-of-the-laws">Spirit of the Laws</a><a href="${CASELAW}" title="Case law as the history of this country">Case law as history</a><a href="/maxims">Maxims</a><a href="/judges">Judges</a><a href="/lawyers">Lawyers</a><a href="/complaints">File a complaint</a><a href="${OVERSIGHT}">Oversight</a><a href="${DATA}">Data</a><a href="${WIKI}">Library</a></div></header>
<main class=wrap>${adSlot('law-top', ADS)}${body}${citeHtml}${adSlot('law-bottom', ADS)}</main>
${FOOTER}</body></html>`;
}

// ── FAQ (visible AND emitted as FAQPage JSON-LD) ─────────────────────────────────────────────────
// Real, quotable answers about what this surface IS and how to cite it — the kind of Q&A an AI overview
// lifts verbatim. The SAME pairs are rendered on-page (faqCard) and as JSON-LD (page opts.faq), so the
// structured data always matches the visible text (Google's requirement, and honest by construction).
const HOME_FAQ = [
  { q: 'Is SoapBox Law free to use?',
    a: 'Yes. SoapBox Law is keyless and free — no account, no paywall. It surfaces U.S. caselaw, statutes, '
     + 'regulations, judge records and lawyer bar facts from official public sources.' },
  { q: 'Where does the case law come from?',
    a: 'Court opinions come from CourtListener (Free Law Project) and the Caselaw Access Project (Harvard '
     + 'Law School Library); statutes from the OLRC U.S. Code and Cornell LII; regulations from the eCFR and '
     + 'the Federal Register. U.S. caselaw and federal statute are public domain.' },
  { q: 'Can I cite pages from SoapBox Law?',
    a: 'Yes. Every record links its official source of record, and each page carries a citation block. For '
     + 'legal authority, cite the source of record (the reporter citation, U.S.C. section, or Federal '
     + 'Register document) that the page links to.' },
  { q: 'Does SoapBox Law give legal advice?',
    a: 'No. SoapBox Law states the public record — case names, citations, statuses and official-source '
     + 'links — and never a holding-summary, a "good law / bad law" judgment, or legal advice. For advice, '
     + 'consult a licensed attorney.' },
];

// FAQ for the Appeals & writs surface (visible on-page AND emitted as FAQPage JSON-LD — they match).
const APPEALS_FAQ = [
  { q: 'What is the "exhaustion ladder" for appeals?',
    a: 'It is the fixed order you must challenge a court loss in: direct appeal, then a motion for '
     + 'reconsideration or new trial, then state post-conviction/state habeas, then discretionary review '
     + 'in the state supreme court, then certiorari to the U.S. Supreme Court, then federal habeas corpus, '
     + 'and only then the extraordinary writs like mandamus. Taking a step out of order can permanently '
     + 'forfeit ("burn") a later option.' },
  { q: 'Why can filing federal habeas too early hurt me?',
    a: 'Federal habeas (28 U.S.C. § 2254 for state prisoners, § 2255 for federal) requires that you first '
     + 'exhaust state remedies (28 U.S.C. § 2254(b)(1)). Filing before you finish the state process can get '
     + 'the petition dismissed, the AEDPA one-year clock (28 U.S.C. § 2244(d)(1)) can run out, a claim can '
     + 'be procedurally defaulted, and a second petition needs the court of appeals’ permission. Get a '
     + 'lawyer or a federal-defender office before filing.' },
  { q: 'When is a writ of mandamus appropriate?',
    a: 'Mandamus is a last resort after ordinary appeals fail and an official or agency still refuses to '
     + 'perform a clear, non-discretionary duty, when no other adequate remedy exists. It rests on statute '
     + 'now — 28 U.S.C. § 1361, the All Writs Act (§ 1651), and for agencies the APA (5 U.S.C. § 706(1)).' },
  { q: 'Does this tool give legal advice?',
    a: 'No. It is AI-generated legal information and a fill-in-the-blank scaffold — not legal advice and not '
     + 'a lawyer. Deadlines and rules vary by court and change; verify every specific in your court’s own '
     + 'rules, and take a draft to a licensed attorney, a legal-aid clinic, or your court’s self-help center.' },
];

// Render a visible FAQ card whose Q&A exactly match a faq[] passed to page() as FAQPage JSON-LD.
function faqCard(pairs, heading = 'Frequently asked questions') {
  const items = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.q && p.a);
  if (!items.length) return '';
  return `<div class=card style="margin-top:18px"><h2>${esc(heading)}</h2>${items.map((p) =>
    `<details class=plm-pairing style="margin:0 0 8px"><summary>${esc(p.q)}</summary>`
    + `<div class=plm-body><p class=plm-plain style="margin:0">${esc(p.a)}</p></div></details>`).join('')}</div>`;
}

// small URL-encode shorthand
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

// BreadcrumbList trail: SoapBox Law → this section. Passed to page() as opts.breadcrumb.
const crumbs = (name, path) => [
  { name: 'SoapBox Law', url: `${BASE_URL}/` },
  { name, url: `${BASE_URL}${path}` },
];

// ── /llms.txt — a corpus-describing, citation-guiding index for AI crawlers (GEO) ────────────────────
// The base llmsTxt() gives the header + Key-pages list; we APPEND corpus / sources-of-record / how-to-cite
// sections so an LLM ingesting this file knows WHAT the corpus is, that it is authoritative and quotable,
// and exactly how to attribute it. This is the per-surface GEO index the operator asked for.
export function lawLlmsTxt() {
  const base = llmsTxt({
    name: 'SoapBox Law', baseUrl: BASE_URL,
    summary: 'Free, keyless U.S. legal reference — caselaw, statutes, regulations, judges, and lawyer bar '
      + 'records, each surfaced verbatim from its official public source. Facts, not verdicts.',
    links: [
      { label: 'Caselaw (court opinions)', path: '/cases', note: 'CourtListener / Free Law Project + Caselaw Access Project; resolves reporter citations' },
      { label: 'Dockets (PACER/RECAP)', path: '/dockets', note: 'case filings and proceedings' },
      { label: 'Statutes (U.S. Code)', path: '/statutes', note: 'OLRC U.S. Code + Cornell LII; eCFR full-text search' },
      { label: 'Regulations (CFR / Federal Register)', path: '/regulations', note: 'recent rules by agency' },
      { label: 'Constitution', path: '/constitution', note: 'foundational law, public domain' },
      { label: 'Treaties', path: '/treaties' },
      { label: 'Privacy law (federal vs. Texas)', path: '/privacy' },
      { label: 'Appeals & extraordinary writs (pro-se ladder)', path: '/appeals', note: 'the exhaustion ladder, gated; deadlines, required fields, mandamus/habeas' },
      { label: 'Your rights', path: '/rights' },
      { label: 'Legal doctrines (real + sovereign-citizen pseudolaw, refuted)', path: '/doctrines', note: 'grouped doctrine reference with landmark cases; the Commerce Clause misreading contrasted with the real doctrine' },
      { label: 'The Spirit of the Laws (Montesquieu; purposive interpretation)', path: '/spirit-of-the-laws', note: 'separation of powers and letter-vs-spirit, with the real cases — verified quotes and cites' },
      { label: 'Maxims, axioms & idioms', path: '/maxims', note: 'each maxim links the case law that applies it' },
      { label: 'Judges', path: '/judges' },
      { label: 'Lawyers', path: '/lawyers' },
      { label: 'File a complaint', path: '/complaints' },
    ],
  });
  const extra = [
    '## About this corpus',
    'SoapBox Law is a reference surface, not a commentary site. Each record reproduces or links its '
      + 'official source of record and states only facts — case name, citation, court, date, status; '
      + 'statute section and official text; regulation document number. It never adds a holding-summary, '
      + 'a "good law / bad law" judgment, or legal advice. U.S. caselaw and federal statute are public domain.',
    '',
    '## Sources of record (authoritative upstream)',
    '- Court opinions: CourtListener (Free Law Project) and the Caselaw Access Project (Harvard Law School Library).',
    '- Statutes: Office of the Law Revision Counsel (OLRC) U.S. Code; Cornell Legal Information Institute (LII).',
    '- Regulations: the electronic Code of Federal Regulations (eCFR) and the Federal Register.',
    '- Judges: CourtListener judge database (positions, appointments, financial disclosures).',
    '',
    '## How to cite',
    'Pages are safe to quote and cite. Every page carries a machine-readable citation block (schema.org '
      + 'JSON-LD, author/publisher/date) and, for legal authority, names the source of record to cite '
      + 'directly (the reporter citation, U.S.C. section, or Federal Register document number). Attribute '
      + `general pages as: SoapBox Law, ${BASE_URL} .`,
    '',
    '## Usage',
    'All crawlers, including AI/LLM crawlers, are welcome (see /robots.txt). This is public-interest legal '
      + 'reference data intended to be ingested, quoted, and cited.',
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// search form + an optional cases/statutes toggle on the home box
function searchForm(action, { value = '', placeholder = 'Search…', label = 'Search', extra = '' } = {}) {
  return `<form class=lawsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name=q value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    ${extra}<button type=submit>${esc(label)}</button>
  </div></form>`;
}

// ── browse-by-court — the federal hierarchy, made navigable on the front page ──────────────────────
// SCOTUS as a prominent link, then a grid of the 13 Courts of Appeals (each → /cases?court=<slug>), plus
// a note that District (trial) courts are reached via docket search. PURE; rendered on home AND inside the
// cases tab when there's no term/court (so the courts are "organized within that tab" too).
function browseByCourt() {
  const { supreme, circuits } = opinions.COURTS;
  const circuitGrid = circuits.map((c) =>
    `<a class=sec href="/cases?court=${q(c.slug)}"><div class=t>${esc(c.short)}</div><div class=d>${esc(c.name)}</div></a>`
  ).join('');
  return `<div class=card><h2>Browse by court</h2>
      <p class=muted style="font-size:14px;margin:-2px 0 12px">Find Supreme Court and Appellate/Circuit opinions by court. District (trial)
        courts are searchable through <a href="/dockets">docket search →</a>.</p>
      <a class=sec href="/cases?court=${q(supreme.slug)}" style="display:block;border-color:var(--gold)">
        <div class=t style="font-size:18px">⚖ ${esc(supreme.name)}</div>
        <div class=d>The Supreme Court of the United States — recent opinions (${esc(supreme.short)}).</div></a>
      <h3 style="margin:16px 0 8px">Circuit Courts of Appeals</h3>
      <div class=grid>${circuitGrid}</div>
      <p class=muted style="font-size:12px;margin-top:12px">${esc(opinions.COURTS.districtNote)}</p></div>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
function homePage() {
  const sections = [
    ['/cases', 'Cases', 'Search U.S. court opinions, or resolve a reporter citation like “347 U.S. 483” to the case record.'],
    ['/dockets', 'Dockets', 'Case filings & proceedings (PACER/RECAP) — the docket record, à la Justia dockets.'],
    ['/statutes', 'Statutes & Code', 'Parse a U.S.C. citation (“18 U.S.C. § 2261A”) to its official text, or search the Code of Federal Regulations.'],
    ['/regulations', 'Regulations', 'Recent rules, proposed rules, and notices from the Federal Register, by agency.'],
    ['/privacy', 'Privacy law — federal vs. Texas', 'Click a privacy topic to see the federal law, where Texas replaces or supplements it, and the cases interpreting each — a plain-language map.'],
    ['/appeals', 'Appeals & extraordinary writs', 'A pro-se ladder: appeal → reconsideration → post-conviction → cert → federal habeas → mandamus. Gated so you don’t burn a step, with deadlines and required fields.'],
    ['/judges', 'Judges', 'Federal judge profiles — seats, appointments, opinion counts, and disclosure pointers.'],
    ['/lawyers', 'Lawyers', 'Public attorney bar facts — license status, admission, discipline. No ratings, by design.'],
    ['/complaints', 'File a complaint', 'Where to go for legal aid, a bar referral, or to file a complaint with the right agency.'],
  ];
  const body = `<h1>SoapBox Law <span class=muted style="font-size:14px">· the public legal record</span></h1>
    <p class=muted>Caselaw, statutes, regulations, judges, and lawyer records — keyless, public-domain, source-linked.
      One front door over the law. Start with a case or a citation:</p>
    ${searchForm('/cases', {
      placeholder: 'Case name, topic, or a citation like “347 U.S. 483”…',
      label: 'Search cases',
    })}
    <p class=muted style="font-size:13px;margin-top:-6px">Looking for a statute? <a href="/statutes">Parse a U.S.C. citation or search the CFR →</a></p>
    ${browseByCourt()}
    <div class=grid style="margin-top:18px">
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('')}
    </div>
    <div class=card style="margin-top:18px"><h2>How this connects</h2>
      <p class=muted style="font-size:14px">Case files and judges are linked: a case record links the judge who can be looked up here,
      and a judge profile links straight to a search of the opinions they authored. The whole surface is jurisdiction-namespaced —
      the United States is jurisdiction #1, and paths can later take a <code>/us/…</code> prefix as other jurisdictions are added.</p></div>
    ${faqCard(HOME_FAQ)}`;
  return page('SoapBox Law — caselaw, statutes, regulations, judges', body, {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: 'SoapBox Law', url: `${BASE_URL}/` }],
    faq: HOME_FAQ,
  });
}

// ── /cases — CourtListener opinion search + CAP citation lookup ──────────────────────────────────
// A reporter citation in the box (e.g. "347 U.S. 483") triggers the CAP citation resolver; anything
// else runs a CourtListener opinion search. Both soft-fail to an empty-state card.
function caseRow(c) {
  // cross-link: a case page links a judge-profile search (the operator's case-files ↔ judges connection).
  // Routed through the shared cross-links helper (single source of truth for inter-site URLs). We keep
  // the link relative when it points at THIS site — the helper's absolute Law URL and our relative
  // /judges path are the same destination; the relative form avoids a cross-host hop within Law.
  const judgeName = (c.caseName || '').replace(/\s+v\.?\s+.*/i, '').trim() || c.caseName || '';
  const judgeLink = `<a href="/judges?q=${q(judgeName)}">find the judge →</a>`;
  void judgeLinks; // shared helper available for off-site judge links (Politics); on-site stays relative.
  // cross-link: if a party is a company, link its Stocks company profile (a lookup, not a claim).
  const company = companyParty(c.caseName);
  const companyLink = company ? `<a href="${esc(companyLinks(company).stocks)}" rel=noopener>company profile: ${esc(company)} →</a> · ` : '';
  const cites = Array.isArray(c.citations) && c.citations.length ? ` · ${esc(c.citations.join('; '))}` : '';
  const meta = [c.court, c.dateFiled || c.decisionDate, c.precedentialStatus,
    c.citationCount != null ? `cited ${c.citationCount}×` : ''].filter(Boolean).map(esc).join(' · ');
  // detail route: read the court's own verbatim opinion text here on-site. CourtListener rows carry a
  // clusterId → ?id=; CAP rows carry a caseId → ?cap=. (CAP cluster id isn't a CL opinion id, so they
  // route to their respective full-text readers.)
  const detailHref = c.clusterId ? `/cases?id=${q(c.clusterId)}` : (c.caseId ? `/cases?cap=${q(c.caseId)}` : '');
  const nameHtml = detailHref
    ? `<a href="${esc(detailHref)}">${esc(c.caseName || 'Case')}</a>`
    : (c.url ? `<a href="${esc(c.url)}">${esc(c.caseName || 'Case')}</a>` : esc(c.caseName || 'Case'));
  return `<div class=rec>
    <div class=nm>${nameHtml}${c.license === 'public-domain' ? '<span class=badge>public domain</span>' : ''}</div>
    <div class=meta>${meta}${cites}</div>
    ${c.snippet ? `<blockquote>${esc(c.snippet)}</blockquote>` : ''}
    <div class=xlink>${detailHref ? `<a href="${esc(detailHref)}">read the full opinion</a> · ` : ''}${c.url ? `<a href="${esc(c.url)}">at the source</a> · ` : ''}${docketLink(c)}${companyLink}${judgeLink}</div>
  </div>`;
}

// cross-link an opinion back to its DOCKET (the filings behind the decision). Prefers an on-site docket
// search by docket number, else by case name, so the docket sits one click from the opinion.
function docketLink(c) {
  const key = c.docketNumber || c.caseName;
  return key ? `<a href="/dockets?q=${q(key)}">see the docket →</a> · ` : '';
}

// A reporter citation looks like "<vol> <Reporter…> <page>" — reuse CAP's parser to decide the path.
function looksLikeCitation(s) {
  return !!cap.parseCitation(s);
}

// ── party / company detection for cross-links ─────────────────────────────────────────────────────
// A case name is "<party> v. <party>". Split on the "v." separator and return the parties, trimmed of
// trailing procedural noise (", et al.", "; ...", parentheticals). PURE.
function caseParties(caseName) {
  const n = String(caseName == null ? '' : caseName).trim();
  if (!n) return [];
  return n.split(/\s+v\.?\s+/i)
    .map((p) => p.replace(/[,;(].*$/, '').replace(/\bet al\.?$/i, '').trim())
    .filter(Boolean);
}

// Corporate suffixes that mark a party as a COMPANY (so a "company profile →" cross-link is a fact, not a
// guess). We never link a plainly-personal name to a company profile.
const COMPANY_SUFFIX = /\b(Inc|Inc\.|Incorporated|Corp|Corp\.|Corporation|Co|Co\.|Company|LLC|L\.L\.C\.|LLP|LP|Ltd|Ltd\.|Limited|PLC|N\.A\.|Bank|Holdings|Group|Industries|Technologies|Systems|Pharmaceuticals|Motors|Airlines)\b\.?$/i;

// Return the first party that looks like a company (has a corporate suffix), or null. Conservative by
// design: when in doubt we render no cross-link rather than assert a company that may be a person/agency.
function companyParty(caseName) {
  for (const p of caseParties(caseName)) {
    if (p.length >= 3 && COMPANY_SUFFIX.test(p)) return p;
  }
  return null;
}

export async function casesView(query, court) {
  const term = String(query == null ? '' : query).trim();
  const ct = String(court == null ? '' : court).trim();
  // a court-scoped search keeps the slug on submit (hidden field) so the box stays scoped to that court.
  const courtExtra = ct ? `<input type=hidden name=court value="${esc(ct)}">` : '';
  const form = searchForm('/cases', {
    value: term,
    placeholder: ct ? `Search within ${esc(opinions.courtName(ct))}…` : 'Case name, topic, or “347 U.S. 483”…',
    label: 'Search cases',
    extra: courtExtra,
  });
  let results = '';
  if (term && !ct && looksLikeCitation(term)) {
    // citation path (only when not court-scoped): resolve via the Caselaw Access Project.
    const c = await cap.caseByCitation(term).catch(() => null);
    results = c
      ? `<div class=card><h2>Citation: ${esc(cap.parseCitation(term).normalized)}</h2>${caseRow(c)}</div>`
      : `<div class=card><h2>Citation: ${esc(cap.parseCitation(term).normalized)}</h2>
          <p class=empty>No case found for that citation right now. The Caselaw Access Project (Harvard LIL) is the source of record —
          <a href="${esc(cap.citationUrl(cap.parseCitation(term)))}">look it up there →</a></p></div>`;
  } else if (term || ct) {
    // free-text and/or court-browse path: CourtListener opinion search. When there's a term, rank by
    // relevance; for a bare court browse, list that court's most-recent opinions.
    const rows = await opinions.searchCases({
      q: term || '', court: ct || undefined,
      orderBy: term ? 'score desc' : 'dateFiled desc', limit: 25,
    }).catch(() => []);
    const heading = ct
      ? `Recent opinions — ${esc(opinions.courtName(ct))}${term ? ` · “${esc(term)}”` : ''}`
      : `${rows.length} opinion${rows.length === 1 ? '' : 's'} for “${esc(term)}”`;
    results = rows.length
      ? `<div class=card><h2>${heading}</h2>${rows.map(caseRow).join('')}</div>`
      : `<div class=card><h2>${ct ? heading : `Cases for “${esc(term)}”`}</h2><p class=empty>No opinions found. Try a different term, a party name, or a reporter citation like “347 U.S. 483”.</p></div>`;
  } else {
    // no term and no court → organize the courts within the tab too.
    results = browseByCourt();
  }
  return `<h1>Cases</h1>
    <p class=muted>Search U.S. court opinions (CourtListener / Free Law Project), or resolve a reporter citation to its case
      via the Caselaw Access Project. Facts only — name, court, date, status, citation count. Never a holding-summary.</p>
    ${form}${results}`;
}

// ── /cases?id=… / ?cap=… — case DETAIL: the court's own verbatim opinion text ─────────────────────
// Justia-style full-opinion page. We render the SOURCE'S OWN public-domain words (the whole decision) in
// a readable article block — NEVER a holding-summary or "good law / bad law" verdict of ours (v3 §10).
// `?id=` → a CourtListener opinion id (opinions.opinionText, full body); `?cap=` → a CAP case id
// (cap.caseById with { full:true }, fullText). Soft-fails to an empty-state; noindex,follow on detail.
function opinionArticle(text) {
  // Split the verbatim text into paragraphs for readability; each paragraph is escaped. The words are the
  // court's, unaltered — we only insert paragraph breaks where the source already had blank lines, and
  // otherwise wrap the single block. PURE.
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  const paras = t.split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const blocks = (paras.length > 1 ? paras : [t.replace(/\s+/g, ' ').trim()]);
  return `<article class=opinion>${blocks.map((p) => `<p>${esc(p)}</p>`).join('')}</article>`;
}

export async function caseDetailView({ clId = '', capId = '' } = {}) {
  const cl = String(clId == null ? '' : clId).trim();
  const cp = String(capId == null ? '' : capId).trim();
  let rec = null;
  let sourceLabel = '';
  let sourceUrl = '';
  if (cl) {
    rec = await opinions.opinionText(cl).catch(() => null);
    if (rec) {
      sourceLabel = 'CourtListener (Free Law Project)';
      sourceUrl = rec.absolute_url || rec.url || '';
    }
  } else if (cp) {
    const c = await cap.caseById(cp, { full: true }).catch(() => null);
    if (c) {
      rec = {
        caseName: c.caseName, court: c.court, dateFiled: c.decisionDate,
        citation: c.citations, text: c.fullText || '', url: c.url,
      };
      sourceLabel = 'Caselaw Access Project (Harvard LIL)';
      sourceUrl = c.url || '';
    }
  }

  const back = `<p class=muted><a href="/cases">← case search</a></p>`;
  if (!rec) {
    return `<h1>Opinion</h1>${back}
      <div class=card><p class=empty>No opinion on record for that id right now. The source is the record —
      <a href="/cases">search again →</a> or read it at the source.</p></div>`;
  }
  const text = rec.text || '';
  const cites = Array.isArray(rec.citation) ? rec.citation.filter(Boolean) : [];
  const meta = [rec.court, rec.dateFiled, cites.length ? cites.join('; ') : '', rec.judge]
    .filter(Boolean).map(esc).join(' · ');

  // SURFACE the previously-orphaned metadata extractor: run legal-knowledge-graph.ingestCase() over the
  // fetched opinion to pull out its legal CATEGORIES (keyword-matched against the seed taxonomy), then
  // render each as a cross-link to a topic search. Pure (no graph persisted) + soft-fails to []. These
  // are LOOKUP links ("other cases on this topic"), never an assertion about this case.
  let categoryLinksHtml = '';
  try {
    const ext = ingestCase({
      id: rec.caseName || 'case', caseName: rec.caseName, court: rec.court,
      dateFiled: rec.dateFiled, opinionText: text, citation: cites.join('; '),
    });
    const cats = (ext && Array.isArray(ext.categories) ? ext.categories : []).slice(0, 6);
    if (cats.length) {
      const links = cats.map((c) => `<a href="${esc(categoryLinks(c).law)}">${esc(String(c).replace(/^cat:/, '').replace(/[-_]/g, ' '))}</a>`).join(' · ');
      categoryLinksHtml = `<div class=xlink style="margin-top:6px"><span class=muted>Related topics:</span> ${links}</div>`;
    }
  } catch { /* extractor is best-effort; never breaks the page */ }

  // company cross-link: if a party is a company, link its Stocks company profile (a lookup, not a claim).
  const company = companyParty(rec.caseName);
  const companyLinkHtml = company
    ? `<div class=xlink style="margin-top:6px"><a href="${esc(companyLinks(company).stocks)}" rel=noopener>company profile: ${esc(company)} →</a></div>`
    : '';

  const body = `<h1>${esc(rec.caseName || 'Opinion')} <span class=muted style="font-size:14px">· public record</span></h1>
    ${back}
    <div class=card>
      <div class=meta>${meta || '—'}</div>
      <div class=xlink style="margin-top:6px">${sourceUrl ? `<a href="${esc(sourceUrl)}">source: ${esc(sourceLabel)} →</a> · ` : ''}${(rec.docketNumber || rec.caseName) ? `<a href="/dockets?q=${q(rec.docketNumber || rec.caseName)}">see the docket (filings behind this decision) →</a>` : ''}</div>
      ${companyLinkHtml}
      ${categoryLinksHtml}
      ${text
        ? `<h2 style="margin-top:14px">The court's words</h2>${opinionArticle(text)}`
        : `<p class=empty style="margin-top:12px">The opinion text isn't available from the source right now. ${sourceUrl ? `<a href="${esc(sourceUrl)}">Read it at the source →</a>` : ''}</p>`}
      <p class=muted style="font-size:12px;margin-top:12px">This is the court's own public-domain opinion text, reproduced verbatim and attributed to ${esc(sourceLabel || 'the source of record')}. We surface the source's words — we add no holding-summary, headnote, or verdict.</p>
    </div>`;
  // GEO: a stable, quotable citation unit. For legal authority a reader should cite the source of record
  // (the reporter citation / CourtListener / CAP), which this block names and links.
  const cite = citationBlock({
    title: rec.caseName || 'Opinion',
    url: sourceUrl || `${BASE_URL}/cases`,
    author: 'SoapBox Law', publisher: 'SoapBox Law',
    datePublished: rec.dateFiled || undefined,
    sourceOfRecord: sourceLabel || 'the source of record', sourceUrl: sourceUrl || undefined,
    license: 'https://creativecommons.org/publicdomain/mark/1.0/', type: 'Legislation',
  });
  return body + cite.html;
}

// ── /dockets — Justia-style docket search (RECAP/PACER case filings) ──────────────────────────────
// The docket record: case filings & proceedings. Searches CourtListener's open RECAP mirror of PACER.
// Facts only — case name, docket number, court, filed/terminated dates, assigned judge, nature of suit;
// every row links the CourtListener docket page. We never reconstruct sealed material (module discipline).
function docketRow(d) {
  const nameHtml = d.url
    ? `<a href="${esc(d.url)}">${esc(d.caseName || d.docketNumber || 'Docket')}</a>`
    : esc(d.caseName || d.docketNumber || 'Docket');
  const dates = [d.dateFiled ? `filed ${d.dateFiled}` : '', d.dateTerminated ? `terminated ${d.dateTerminated}` : ''].filter(Boolean).join(' · ');
  const meta = [d.docketNumber ? `No. ${d.docketNumber}` : '', d.court, dates, d.natureOfSuit, d.assignedTo ? `judge: ${d.assignedTo}` : '']
    .filter(Boolean).map(esc).join(' · ');
  // cross-link a docket to the OPINION it produced (Justia-style: dockets findable next to their opinion).
  const opinionLink = d.clusterId
    ? `<a href="/cases?id=${q(d.clusterId)}">read the related opinion →</a>`
    : (d.caseName ? `<a href="/cases?q=${q(d.caseName)}">find the opinion →</a>` : '');
  return `<div class=rec>
    <div class=nm>${nameHtml}</div>
    <div class=meta>${meta || '—'}</div>
    <div class=xlink>${opinionLink ? `${opinionLink} · ` : ''}${d.url ? `<a href="${esc(d.url)}">the docket record at CourtListener (RECAP) →</a>` : ''}</div>
  </div>`;
}

export async function docketsView(query, court) {
  const term = String(query == null ? '' : query).trim();
  const ct = String(court == null ? '' : court).trim();
  const { supreme, circuits } = opinions.COURTS;
  const opts = [['', 'Any court'], [supreme.slug, supreme.short], ...circuits.map((c) => [c.slug, c.short])];
  const courtSelect = `<select class=q name=court aria-label="Court" style="flex:0 0 150px;max-width:170px">${
    opts.map(([v, l]) => `<option value="${esc(v)}"${v === ct ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const form = searchForm('/dockets', { value: term, placeholder: 'Party, docket number, or case…', label: 'Search dockets', extra: courtSelect });
  let results = '';
  if (term || ct) {
    const rows = await opinions.searchDockets({ q: term || '', court: ct || undefined, limit: 25 }).catch(() => []);
    const scope = ct ? ` — ${esc(opinions.courtName(ct))}` : '';
    results = rows.length
      ? `<div class=card><h2>${rows.length} docket${rows.length === 1 ? '' : 's'}${term ? ` for “${esc(term)}”` : ''}${scope}</h2>${rows.map(docketRow).join('')}</div>`
      : `<div class=card><h2>Dockets${term ? ` for “${esc(term)}”` : ''}${scope}</h2>
          <p class=empty>No docket records found here right now. The docket record lives in PACER (the courts' own system) and its open
          RECAP mirror — <a href="https://www.courtlistener.com/?type=r">search dockets at CourtListener →</a>.</p></div>`;
  }
  return `<h1>Dockets <span class=muted style="font-size:14px">· case filings &amp; proceedings</span></h1>
    <p class=muted>Search the <b>docket record</b> — the list of filings and proceedings in a case — from PACER's open RECAP mirror
      (CourtListener / Free Law Project), à la Justia dockets. Facts only — case name, docket number, court, dates, assigned judge.
      We surface the published docket metadata and never reconstruct sealed material.</p>
    ${form}${results}`;
}

// ── /statutes — U.S.C. citation parser + eCFR search ────────────────────────────────────────────
export async function statutesView(query) {
  const term = String(query == null ? '' : query).trim();
  const form = searchForm('/statutes', { value: term, placeholder: '“18 U.S.C. § 2261A”, or CFR keywords…', label: 'Look up' });
  let results = '';
  if (term) {
    const card = uscode.citationCard(term);
    if (card) {
      // parsed a U.S.C. citation → official OLRC + Cornell LII links (window, never scrape/gloss).
      results = `<div class=card><h2>U.S. Code — ${esc(card.normalized)}</h2>
        <table><tbody>
          <tr><td class=muted>Title</td><td>${esc(card.title)}</td></tr>
          <tr><td class=muted>Section</td><td>${esc(card.section)}${esc(card.subsections || '')}</td></tr>
          <tr><td class=muted>USLM identifier</td><td><code>${esc(card.identifier)}</code></td></tr>
        </tbody></table>
        <p style="margin-top:10px"><a href="${esc(card.olrcUrl)}">Official text (OLRC · uscode.house.gov)</a> · <a href="${esc(card.corneliiUrl)}">Cornell LII display</a></p>
        <p class=muted style="font-size:12px">Federal statute is public domain; we window to the official source and never gloss it.</p></div>`;
    } else {
      // not a citation → treat as eCFR full-text search.
      const s = await ecfr.search({ q: term, limit: 20 }).catch(() => ({ total: 0, results: [] }));
      const rows = (s && Array.isArray(s.results)) ? s.results : [];
      results = `<div class=card><h2>Code of Federal Regulations — “${esc(term)}”${s && s.total ? ` <span class=muted style="font-weight:400">· ${esc(s.total)} hits</span>` : ''}</h2>`
        + (rows.length
          ? rows.map((r) => `<div class=rec>
              <div class=nm>${r.url ? `<a href="${esc(r.url)}">${esc(r.heading || 'CFR section')}</a>` : esc(r.heading || 'CFR section')}</div>
              <div class=meta>${[r.title != null ? `Title ${r.title}` : '', r.part ? `Part ${r.part}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
              ${r.excerpt ? `<blockquote>${esc(r.excerpt)}</blockquote>` : ''}</div>`).join('')
          : `<p class=empty>No matching regulations, and that doesn't parse as a U.S.C. citation. Try a citation like “18 U.S.C. § 2261A”, or different CFR keywords.</p>`)
        + `</div>`;
    }
  }
  return `<h1>Statutes &amp; Code</h1>
    <p class=muted>Enter a U.S. Code citation (e.g. <code>18 U.S.C. § 2261A</code>) to get its official OLRC text and a Cornell LII reader —
      or type keywords to search the Code of Federal Regulations (eCFR). We link the official source; we never interpret it.</p>
    ${form}${results}`;
}

// ── /regulations — Federal Register recent-by-agency ────────────────────────────────────────────
export async function regulationsView(agencySlug) {
  const slug = String(agencySlug == null ? '' : agencySlug).trim() || FR_AGENCIES[0][0];
  const chosen = FR_AGENCY_LABEL[slug] ? slug : FR_AGENCIES[0][0];
  const tabs = `<div class=tabs>${FR_AGENCIES.map(([s, l]) =>
    `<a href="/regulations?agency=${q(s)}" class="${s === chosen ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;
  const docs = await fedreg.recentByAgency(chosen, { limit: 20 }).catch(() => []);
  const list = docs.length
    ? docs.map((d) => `<div class=rec>
        <div class=nm>${d.htmlUrl ? `<a href="${esc(d.htmlUrl)}">${esc(d.title || 'Document')}</a>` : esc(d.title || 'Document')}</div>
        <div class=meta>${[d.type, d.publicationDate, (d.agencies || []).join(', ')].filter(Boolean).map(esc).join(' · ')}${d.documentNumber ? ` · <span class=muted>${esc(d.documentNumber)}</span>` : ''}</div>
        ${d.abstract ? `<blockquote>${esc(d.abstract)}</blockquote>` : ''}
        ${(d.htmlUrl || d.pdfUrl) ? `<div class=xlink>${d.htmlUrl ? `<a href="${esc(d.htmlUrl)}">read on the Federal Register</a>` : ''}${d.pdfUrl ? `${d.htmlUrl ? ' · ' : ''}<a href="${esc(d.pdfUrl)}">PDF</a>` : ''}</div>` : ''}
      </div>`).join('')
    : `<p class=empty>No recent Federal Register documents for ${esc(FR_AGENCY_LABEL[chosen])} right now. The Federal Register is the source of record — <a href="https://www.federalregister.gov/agencies/${q(chosen)}">browse the agency there →</a></p>`;
  return `<h1>Regulations</h1>
    <p class=muted>Recent rules, proposed rules, and notices from the <b>Federal Register</b> — the daily journal of the U.S. government.
      The abstract shown is the agency's own words. Pick an agency:</p>
    ${tabs}
    <div class=card><h2>${esc(FR_AGENCY_LABEL[chosen])} — recent documents</h2>${list}</div>`;
}

// ── /judges — CourtListener judge search → profile ──────────────────────────────────────────────
export async function judgesView(query, personId) {
  const term = String(query == null ? '' : query).trim();
  const form = searchForm('/judges', { value: term, placeholder: 'Judge last name…', label: 'Find judge' });

  // profile view (?id=…) — one judge with positions, opinion count, disclosures + a cross-link to their opinions.
  if (personId) {
    const id = String(personId).trim();
    const [judge, positions, opinionCount, disclosures] = await Promise.all([
      judges.judgeProfile(id).catch(() => null),
      judges.judgePositions(id).catch(() => []),
      judges.authoredOpinionCount(id).catch(() => null),
      judges.financialDisclosures(id).catch(() => []),
    ]);
    if (!judge) {
      return `<h1>Judge</h1>${form}<div class=card><p class=empty>No judge on record for #${esc(id)}. <a href="/judges">Back to judge search →</a></p></div>`;
    }
    // cross-link: judge → a search of the opinions they authored (the case-files ↔ judges connection).
    const opinionsLink = `<a href="/cases?q=${q(judge.name || '')}">search opinions by ${esc(judge.name || 'this judge')} →</a>`;
    const posTable = positions.length
      ? `<table><thead><tr><th>Position</th><th>Court</th><th>Start</th><th>End</th><th>Selection</th></tr></thead><tbody>${positions.map((p) =>
          `<tr><td>${esc(p.positionType || '—')}</td><td>${esc(p.court || '—')}</td><td>${esc(p.dateStart || '—')}</td><td>${esc(p.dateTermination || '—')}</td><td>${esc(p.howSelected || '—')}</td></tr>`).join('')}</tbody></table>`
      : `<p class=empty>No positions on record.</p>`;
    const discLine = disclosures.length
      ? `<p class=muted style="font-size:13px">Financial disclosures (public records): ${disclosures.map((d) => `<a href="${esc(d.url)}">${esc(d.year || d.disclosureId)}</a>`).join(', ')}</p>`
      : '';
    return `<h1>${esc(judge.name || 'Judge')} <span class=muted style="font-size:14px">· public record</span></h1>
      <p class=muted><a href="/judges">← judge search</a></p>
      <div class=card>
        <p>${judge.personId ? `CourtListener #${esc(judge.personId)}` : ''}${opinionCount != null ? ` · authored opinions on record: <b>${esc(opinionCount)}</b>` : ''}${judge.resourceUrl ? ` · <a href="${esc(judge.resourceUrl)}">CourtListener profile</a>` : ''}</p>
        <div class=xlink>${opinionsLink}</div>
        <h3 style="margin-top:14px">Positions</h3>${posTable}
        ${discLine}
      </div>`;
  }

  // search view.
  let results = '';
  if (term) {
    const rows = await judges.searchJudges({ q: term, limit: 20 }).catch(() => []);
    results = rows.length
      ? `<div class=card><h2>${rows.length} judge${rows.length === 1 ? '' : 's'} for “${esc(term)}”</h2>${rows.map((j) => `<div class=rec>
          <div class=nm><a href="/judges?id=${q(j.personId)}">${esc(j.name || 'Judge')}</a></div>
          <div class=meta>${[j.dateBorn ? `b. ${j.dateBorn}` : '', j.positionCount != null ? `${j.positionCount} position${j.positionCount === 1 ? '' : 's'}` : '', j.hasFinancialDisclosures ? 'has disclosures' : ''].filter(Boolean).map(esc).join(' · ')}</div>
          <div class=xlink><a href="/cases?q=${q(j.name)}">opinions by this judge →</a></div></div>`).join('')}</div>`
      : `<div class=card><h2>Judges for “${esc(term)}”</h2><p class=empty>No judges found. Try a last name.</p></div>`;
  }
  return `<h1>Judges</h1>
    <p class=muted>Federal judge profiles from CourtListener (Free Law Project) — seats, appointments, opinion counts, and pointers to
      public financial disclosures. Each profile links a search of the opinions that judge authored.</p>
    ${form}${results}`;
}

// ── /lawyers — attorney bar-record search ───────────────────────────────────────────────────────
// State-bar lookups have no common public API, so lawyer-directory.searchAttorneys requires an INJECTED
// fetcher. Without one configured, the search soft-fails to [] (by the module's design) and we show the
// public-interest path instead — we never invent attorney records.
export async function lawyersView(query, state) {
  const term = String(query == null ? '' : query).trim();
  const st = String(state == null ? '' : state).trim().toUpperCase();
  const extra = `<input class=q name=state value="${esc(st)}" placeholder="State (e.g. CA)" aria-label="State" style="flex:0 0 130px;max-width:130px">`;
  const form = searchForm('/lawyers', { value: term, placeholder: 'Attorney name…', label: 'Find attorney', extra });
  let results = '';
  if (term) {
    const rows = await lawyers.searchAttorneys(term, { state: st || undefined }).catch(() => []);
    if (rows.length) {
      results = `<div class=card><h2>${rows.length} attorney${rows.length === 1 ? '' : 's'} for “${esc(term)}”</h2>${rows.map((a) => `<div class=rec>
        <div class=nm>${esc(a.name || 'Attorney')}${a.status ? `<span class=badge>${esc(a.status)}</span>` : ''}</div>
        <div class=meta>${[a.barNumber ? `Bar #${a.barNumber}` : '', a.state, a.admitted ? `admitted ${a.admitted}` : '', (a.practiceAreas || []).join(', ')].filter(Boolean).map(esc).join(' · ')}</div>
        ${(a.discipline || []).length ? `<div class=meta>Discipline on record: ${a.discipline.map((d) => esc([d.date, d.action].filter(Boolean).join(' — '))).join('; ')}</div>` : ''}
      </div>`).join('')}<p class=muted style="font-size:12px;margin-top:8px">Public bar facts only — license status, admission, discipline. No rating or recommendation, by design (ABA Model Rules 5.4 / 7.2).</p></div>`;
    } else {
      results = `<div class=card><h2>Attorney lookup — “${esc(term)}”</h2>
        <p class=empty>No bar records available to search here yet — state-bar directories have no common public API, so this site
        doesn't invent attorney records. Look the attorney up directly with their state bar, or use the public-interest paths below.</p>
        ${publicInterestHtml(['Bar referral'])}</div>`;
    }
  }
  return `<h1>Lawyers</h1>
    <p class=muted>Search public attorney bar facts — license status, admission date, and discipline history. <b>No ratings, no recommendations</b>,
      by design. Need help finding or vetting a lawyer? See <a href="/complaints">File a complaint &amp; legal aid →</a>.</p>
    ${form}${results}
    <div class=card style="border-color:var(--gold)"><h2 style="margin-bottom:4px">Not sure who to contact?</h2>
      <p class=muted style="margin:0 0 10px">If your problem is with a company, product, or a government agency, the
        oversight directory routes you to the right office — federal Inspectors General, ombudsmen, consumer-protection
        bodies, and all 50 state Attorneys General, each with published contact info and its own complaint form.</p>
      <a class=rec style="display:inline-block" href="${OVERSIGHT}/file"><b>Who do I call? → Agency directory →</b></a></div>`;
}

// ── /complaints — where to file (public-interest links) ─────────────────────────────────────────
// Pull the curated where-to-file links from lawyer-directory.PUBLIC_INTEREST when present, else fall
// back to a static curated set so the page always renders.
const STATIC_PUBLIC_INTEREST = {
  'Legal aid': [
    { name: 'Legal Services Corporation — find local legal aid', url: 'https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help', note: 'Federally funded civil legal aid' },
    { name: 'LawHelp.org', url: 'https://www.lawhelp.org/', note: 'Free legal aid + self-help by state and topic' },
  ],
  'Bar referral': [
    { name: 'ABA Lawyer Referral Directory', url: 'https://www.americanbar.org/groups/legal_services/flh-home/flh-lawyer-referral-directory/', note: 'Find your state/local bar referral service' },
  ],
  'File a complaint': [
    { name: 'CFPB — Submit a complaint (financial)', url: 'https://www.consumerfinance.gov/complaint/', note: 'Banks, loans, credit, debt collection' },
    { name: 'FTC — ReportFraud.ftc.gov', url: 'https://reportfraud.ftc.gov/', note: 'Scams, fraud, bad business practices' },
    { name: 'USA.gov — State consumer protection / AG offices', url: 'https://www.usa.gov/state-consumer', note: 'File a consumer complaint with your state AG' },
  ],
};

function publicInterestData() {
  const pi = lawyers.PUBLIC_INTEREST;
  if (pi && typeof pi === 'object' && Object.keys(pi).length) return pi;
  return STATIC_PUBLIC_INTEREST;
}

function publicInterestHtml(onlyGroups) {
  const data = publicInterestData();
  const entries = Object.entries(data).filter(([g]) => !onlyGroups || onlyGroups.includes(g));
  return entries.map(([group, links]) => `<div style="margin:10px 0"><h3>${esc(group)}</h3>${(links || []).map((l) =>
    `<div class=rec><div class=nm><a href="${esc(l.url)}">${esc(l.name)}</a></div>${l.note ? `<div class=meta>${esc(l.note)}</div>` : ''}</div>`).join('')}</div>`).join('');
}

export function complaintsView() {
  return `<h1>File a complaint &amp; get help</h1>
    <p class=muted>Where to go for legal aid, a lawyer referral, or to file a complaint with the right agency. These are public services —
      no money changes hands here. This is information, not legal advice.</p>
    <div class=card>${publicInterestHtml()}</div>`;
}

// ── /privacy — the federal↔Texas privacy statute→case-law map ─────────────────────────────────────
// A free, direct-to-people visualization: click a privacy topic and it expands into the federal
// baseline statute, the Texas statute that supplements / fills a gap / parallels / is preempted by it,
// a plain-language explanation, and — via ?statute=<id> — a LIVE pull of the cases interpreting it.
// The engine is integrations/soapbox/privacy-law-map.mjs; here we bind it to the live CourtListener
// reader and this site's house-style case row. Soft-fail: a failed case lookup renders an empty note.
export async function privacyView(statuteId) {
  const want = String(statuteId == null ? '' : statuteId).trim();
  const casesById = {};
  if (want) {
    const p = privacy.findPairing(want);
    if (p) {
      const rows = await privacy.interpretingCases(p, {
        searchCases: (opts) => opinions.searchCases(opts), limit: 10,
      }).catch(() => []);
      casesById[p.id] = rows;
    }
  }
  const map = privacy.renderMap({
    caseRow, // reuse this site's house-style case row
    expandedId: want,
    casesById,
    casesHrefFor: (id) => `/privacy?statute=${q(id)}`,
  });
  const intro = `<h1>Privacy law — federal vs. Texas</h1>
    <p class=muted>The standard (federal) privacy law, and where <b>Texas</b> replaces, adds to, fills a gap in, or is
      limited by it. Click a topic to open the two statutes side by side, then pull the cases interpreting them.
      Federal privacy law is <em>sectoral</em> — there is no single comprehensive federal privacy statute — which is
      exactly why the states matter. Informational only, not legal advice.</p>`;
  return intro + map;
}

// ── /appeals (+ /writs) — the pro-se appeals & extraordinary-writ engine ───────────────────────────
// A court self-help kiosk in software: the exhaustion ladder, gated so a filer cannot skip a step and
// "burn" a later one, with plain-language teaching, a fill-in-the-blank generator, deadline warnings,
// and live legal search wired through the already-imported keyless readers. EDUCATION + a pro-se tool,
// never individualized advice (the UPL line). All data + gating live in appeals-engine.mjs (pure);
// this view supplies the live case/judge/statute lookups via the injectable-fetch readers, soft-fail.

// Build the "governing statutes" cards. A cite that parses as a U.S.C. section (uscode.citationCard)
// gets official OLRC + Cornell links; everything else (court rules, state statutes) is shown as a
// finder line pointing the reader at the right rulebook — never a fabricated deep link. PURE.
function appealsStatuteCards(statuteMap) {
  const rows = (Array.isArray(statuteMap) ? statuteMap : []).map((s) => {
    const card = uscode.citationCard(s.cite);
    if (card) {
      return `<div class=rec><div class=nm>${esc(s.label)} <span class=badge>${esc(card.normalized)}</span></div>
        <div class=xlink><a href="/statutes?q=${q(card.normalized)}">look it up on SoapBox →</a> · <a href="${esc(card.olrcUrl)}" rel="nofollow noopener">official (OLRC) →</a> · <a href="${esc(card.corneliiUrl)}" rel="nofollow noopener">Cornell LII →</a></div></div>`;
    }
    return `<div class=rec><div class=nm>${esc(s.label)} <span class=badge>${esc(s.cite)}</span></div>
      <div class=meta>A court rule or state statute — read it in the governing rulebook (your court's Rules of Appellate/Civil/Criminal Procedure or your state code).</div></div>`;
  }).join('');
  return rows;
}

// The respondents note per remedy — WHO you name/serve. Static, educational (not "sue this person").
function appealsRespondents(remedyId, state) {
  const stName = appeals.stateName(state) || 'your state';
  const ag = `<a href="/lawyers?q=${q('attorney general')}">${esc(stName)} Attorney General</a>`;
  if (remedyId === 'federal-habeas') {
    return `<p>In a § 2254 petition the respondent is your <b>immediate custodian</b> — the warden or superintendent of the facility holding you (named by title). The <b>${esc(stName)} Attorney General</b> represents the state. In a § 2255 motion the respondent is the <b>United States</b>, litigated by the U.S. Attorney in the sentencing district. Look up the office through <a href="/lawyers">the directory</a>.</p>`;
  }
  if (remedyId === 'mandamus' || remedyId === 'prohibition') {
    return `<p>Name the <b>official, court, or agency head</b> that owes the duty (e.g. an agency's Administrator or Secretary, or the lower-court judge for appellate mandamus). For a federal agency, the head is the proper respondent; the U.S. Attorney and DOJ defend. State the office by title. See ${ag} for state officials, and <a href="/regulations">Regulations</a> to identify the agency.</p>`;
  }
  if (remedyId === 'quo-warranto') {
    return `<p>Quo warranto is usually brought by a <b>public attorney</b> — the ${ag} at the state level, or the U.S. Attorney federally — challenging a person's right to hold office. A private person typically must ask that office to act.</p>`;
  }
  return `<p>On appeal the other side (the <b>appellee/respondent</b>) is whoever won below — in a criminal case, "the People"/"the State"/"the United States," represented by the prosecutor or ${ag}. Serve every party per the certificate of service.</p>`;
}

export async function appealsView({ state = '', level = '', remedy = '', done = '' } = {}) {
  const st = String(state || '').toUpperCase();
  const lvl = String(level || '');
  const doneIds = String(done || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sel = String(remedy || '').trim().toLowerCase();
  const r = appeals.findRemedy(sel);

  // links that carry jurisdiction + the done-list so the gate persists across clicks
  const base = (extra) => {
    const p = new URLSearchParams();
    if (st) p.set('state', st);
    if (lvl) p.set('level', lvl);
    if (doneIds.length) p.set('done', doneIds.join(','));
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v);
    return `/appeals?${p.toString()}`;
  };
  const hrefFor = (id) => base({ remedy: id });

  const intro = `<h1>Appeals &amp; extraordinary writs <span class=muted style="font-size:14px">· a pro-se ladder</span></h1>
    <p class=muted>If you lost and want to keep fighting, there is an <b>order</b> you have to climb — trial loss → appeal →
      reconsideration → state post-conviction → discretionary review → the Supreme Court → federal habeas → the extraordinary
      writs (mandamus and its cousins). Take them out of order and you can permanently <b>burn</b> a later option. Pick your
      jurisdiction, then walk the ladder. This is legal <b>information</b> and a fill-in-the-blank tool — not legal advice.</p>`;

  const selector = appeals.renderJurisdictionSelector({ state: st, level: lvl, remedy: sel });
  const ladder = appeals.renderLadder({ selected: sel, doneIds, state: st, level: lvl, hrefFor });

  // a "mark this step done" control so the gate can unlock the next rung
  let markDone = '';
  if (r && !doneIds.includes(r.id)) {
    markDone = `<p style="margin:10px 0"><a class=sec href="${esc(base({ remedy: r.id, done: [...doneIds, r.id].join(',') }))}" style="display:inline-block">✓ Mark &ldquo;${esc(r.name)}&rdquo; as done (unlock the next rung)</a></p>`;
  } else if (r && doneIds.includes(r.id)) {
    markDone = `<p style="margin:10px 0" class=muted>✓ You have marked this step done. <a href="${esc(base({ remedy: r.id, done: doneIds.filter((d) => d !== r.id).join(',') }))}">Undo</a></p>`;
  }

  let detail = `<div class=card><p class=ape-empty>Select a step on the ladder above to open its teaching, deadlines, required fields, and the governing statutes and cases.</p></div>`;
  if (r) {
    // live legal search — all soft-fail to '' so the page always renders
    const statuteCardsHtml = appealsStatuteCards(r.statuteMap);
    let casesHtml = '';
    try {
      const query = `${r.name.replace(/\s*\([^)]*\)/g, '')} ${r.id === 'mandamus' ? 'compel agency action' : (r.id === 'federal-habeas' ? 'exhaustion AEDPA' : 'appeal')}`;
      const rows = await opinions.searchCases({ q: query, limit: 8 }).catch(() => []);
      casesHtml = Array.isArray(rows) && rows.length ? rows.map(caseRow).join('') : '';
    } catch { casesHtml = ''; }
    let judgesHtml = '';
    try {
      const jq = st && st !== 'US' ? appeals.stateName(st) : (lvl === 'scotus' ? 'Supreme Court' : 'appeals');
      const jrows = await judges.searchJudges({ q: jq, limit: 5 }).catch(() => []);
      judgesHtml = Array.isArray(jrows) && jrows.length
        ? jrows.map((j) => `<div class=rec><div class=nm>${esc(j.name || 'Judge')}</div>
            <div class=xlink><a href="/judges?q=${q(j.name || '')}">judge profile →</a></div></div>`).join('')
        : '';
    } catch { judgesHtml = ''; }
    const respondentsHtml = appealsRespondents(r.id, st);
    detail = `<div class=card>${markDone}${appeals.renderRemedyDetail(r, {
      doneIds, state: st, level: lvl, statuteCardsHtml, casesHtml, judgesHtml, respondentsHtml,
    })}</div>`;
  }

  const ordinances = `<div class=card>${appeals.renderOrdinanceLinks()}</div>`;
  const disclaimer = appeals.renderDisclaimer();

  return `${intro}
    <div class=card><h2>1 · Your jurisdiction</h2>
      <p class=muted style="font-size:13px;margin:-2px 0 10px">State, DC, or federal — and the court level. This drives which deadlines and rules apply.</p>
      ${selector}</div>
    <div class=card>${ladder}</div>
    ${detail}
    ${ordinances}
    ${disclaimer}
    ${faqCard(APPEALS_FAQ)}`;
}

// ── /rights — "Rights That Hold Up in Court" ──────────────────────────────────────────────────────
// An editorial explainer that meets the sovereign-citizen / "traveler" / Moorish audience honestly and
// redirects them to REAL Fourth/Fifth-Amendment law and real remedies. NOTE ON DISCIPLINE: the /cases
// "facts, not verdicts / no holding-summary" rule governs the PENDING-case lister; this page is built on
// DECIDED, published SCOTUS & circuit precedent, where stating a final holding IS stating the public
// record. Every proposition is anchored to a real citation the reader can pull, in a neutral voice.
// The evidence shelf reads a curated, human-verified JSON list and soft-fails to an empty-state.
const RIGHTS_EVIDENCE_PATH = fileURLToPath(new URL('./rights-evidence.json', import.meta.url));
function rightsEvidence() {
  try {
    const j = JSON.parse(readFileSync(RIGHTS_EVIDENCE_PATH, 'utf8'));
    return Array.isArray(j.items) ? j.items : [];
  } catch { return []; }
}
function evidenceShelf() {
  const items = rightsEvidence();
  if (!items.length) {
    return `<p class=empty>Evidence links are being verified and will appear here — real, dated, sourced incidents only.</p>`;
  }
  return items.map((it) => `<div class=rec>
    <div class=nm>${it.url ? `<a href="${esc(it.url)}" rel="nofollow noopener">${esc(it.title || 'Incident')}</a>` : esc(it.title || 'Incident')}</div>
    <div class=meta>${[it.source, it.date].filter(Boolean).map(esc).join(' · ')}</div>
    ${it.lesson ? `<blockquote>${esc(it.lesson)}</blockquote>` : ''}
  </div>`).join('');
}

export function rightsPage() {
  const body = `<h1>Rights That Hold Up in Court</h1>
  <p class=muted>The rights that get thrown out, the rights that get you home, and how to tell them apart — with the actual cases.</p>

  <div class=card><h2>This page is for you — and it isn't here to laugh at you</h2>
    <p>If you've read that you're a &ldquo;traveler&rdquo; not a &ldquo;driver,&rdquo; that your name in capital letters is a corporate
      &ldquo;strawman,&rdquo; that a gold-fringed flag makes a courtroom a secret admiralty ship, or that the right treaty or UCC filing
      makes you immune to the police — read on. The grievances underneath that material are <b>real</b>: police overreach, checkpoints
      far from any border, civil forfeiture, courts treating ordinary people badly. Those are legitimate. The <b>remedies</b> being sold
      for them are not — and the gap between the two is where people get hurt.</p>
    <p>Here's the plain truth, and every line below links a citation you can pull yourself: <b>these theories have never once worked in a
      U.S. court.</b> Not &ldquo;rarely.&rdquo; Judges now reject them on sight as <b>&ldquo;frivolous&rdquo;</b> — a legal word that carries
      fines and sanctions. And on the roadside the same theories end in a broken window and a resisting charge, because asserting a right
      that doesn't exist reads to an officer as refusing a lawful order. We're not going to tell you to give up your rights — the opposite.
      <b>You have real, powerful Fourth and Fifth Amendment rights. Here are the ones that actually hold up, and how to use them so you're
      the one holding the winning paper afterward.</b></p></div>

  <div class=card><h2>The paperwork loses. Here's the court record.</h2>
    <p>&ldquo;Frivolous&rdquo; isn't an insult here — it's a legal status: an argument a court can dismiss without a hearing, with fines or
      a vexatious-litigant bar for repeat filers. Every major sovereign-citizen theory carries it.</p>
    <p><b>&ldquo;No jurisdiction over me&rdquo; / sovereign immunity.</b> <i>United States v. Benabe</i>, 654 F.3d 753 (7th Cir. 2011) (reject
      &ldquo;summarily, however they are presented&rdquo;); <i>United States v. Sterling</i>, 738 F.3d 228 (11th Cir. 2013) (&ldquo;no
      conceivable validity&rdquo;); <i>Crain v. Commissioner</i>, 737 F.2d 1417 (5th Cir. 1984) — the 5th Circuit is Texas's.</p>
    <p><b>&ldquo;Traveling, not driving.&rdquo;</b> <i>Hendrick v. Maryland</i>, 235 U.S. 610 (1915) (states may license drivers);
      <i>Miller v. Reed</i>, 176 F.3d 1202 (9th Cir. 1999) (no fundamental right to drive); <i>Saenz v. Roe</i>, 526 U.S. 489 (1999)
      protects interstate <i>travel</i> — never a right to drive unlicensed.</p>
    <p><b>&ldquo;Strawman&rdquo; / redemption / UCC filings.</b> <i>United States v. Mitchell</i>, 405 F. Supp. 2d 602 (D. Md. 2005);
      <i>Bryant v. Washington Mutual Bank</i>, 524 F. Supp. 2d 753 (W.D. Va. 2007) (&ldquo;no basis in law&rdquo;); <i>Meads v. Meads</i>,
      2012 ABQB 571 (Canada — persuasive only, the definitive catalog of these tactics). Bogus UCC &ldquo;commercial liens&rdquo; against
      officials are separately <b>criminal</b> in many states.</p>
    <p><b>Moorish / treaty immunity.</b> <i>El Ameen Bey v. Stumpf</i>, 825 F. Supp. 2d 537 (D.N.J. 2011); <i>Murakush Caliphate of Amexem
      Inc. v. New Jersey</i>, 790 F. Supp. 2d 241 (D.N.J. 2011). The Treaty of Peace and Friendship with Morocco confers no private
      immunity. <b>Admiralty flag / gold fringe:</b> <i>United States v. Greenstreet</i>, 912 F. Supp. 224 (N.D. Tex. 1996).</p>
    <p class=muted>Uniform across every circuit and both parties' appointees for fifty years. <b>If a theory only ever &ldquo;works&rdquo; in
      a video and never in a published opinion, it doesn't work.</b></p></div>

  <div class=card><h2>Pseudolegal myths, decoded</h2>
    <p>Here's the honest key to all of it: <b>every one of these myths is a misread of something real.</b> There really is admiralty law.
      There really was a 1933 resolution about gold. The Fourteenth Amendment really did change American citizenship. The folklore takes a
      real thing, adds a secret, and sells the secret. Below, each myth is matched to the real thing it distorts — and in every case
      <b>the real law turns out to be more powerful than the secret they're chasing.</b> Myth → what's real → the law you can actually use.
      For the treaty myths in depth, see <a href="/treaties">how treaties actually become law &rarr;</a></p></div>

  <div class=card><h2>The money myths: &ldquo;strawman,&rdquo; A4V, and the secret account</h2>
    <p><b>The myth:</b> your birth certificate created a &ldquo;strawman&rdquo; — your name in capital letters — and a secret Treasury or
      &ldquo;Treasury Direct&rdquo; account or a bond tied to your Social Security number. Stamp a bill or a court summons
      <b>&ldquo;Accepted for Value&rdquo;</b> (A4V) and you can discharge any debt against that account. The red numbers on the back of the
      Social Security card are said to be the routing number.</p>
    <p><b>What's real:</b> the birth certificate, the SSN, and the 1933 move off the gold standard are all real. <b>The secret account is not.</b>
      There is no strawman, no bond, no Treasury Direct account you can draw on; the numbers on the card are card-stock control numbering,
      which the Social Security Administration has said plainly. A4V discharges nothing.</p>
    <p><b>The real law:</b> filing bogus UCC-1 &ldquo;commercial liens&rdquo; or fictitious financial instruments isn't a clever remedy — it's a
      <b>federal crime</b>. Passing a false instrument that appears to be a real U.S. financial obligation is a Class B felony under
      <b>18 U.S.C. &sect; 514</b> (fictitious obligations), on top of mail- and wire-fraud exposure. Courts have dismantled the theory in full:
      <i>United States v. Mitchell</i>, 405 F. Supp. 2d 602 (D. Md. 2005), and <i>Bryant v. Washington Mutual Bank</i>, 524 F. Supp. 2d 753
      (W.D. Va. 2007) (&ldquo;no basis in law&rdquo;). The paperwork doesn't cancel your debt; it hands a prosecutor a case.</p></div>

  <div class=card><h2>Admiralty, the gold-fringe flag — and the real, dark history maritime law actually carries</h2>
    <p><b>The myth:</b> the gold fringe on a courtroom flag means the court is secretly sitting in &ldquo;admiralty&rdquo; — the courtroom is a
      ship, the judge is the captain, and you are &ldquo;maritime cargo&rdquo; unless you refuse that jurisdiction.</p>
    <p><b>What's real:</b> admiralty (maritime) law is one of the oldest and most real bodies of law there is. <b>Article III, &sect; 2</b>
      extends the federal judicial power to &ldquo;all Cases of admiralty and maritime Jurisdiction,&rdquo; and <b>28 U.S.C. &sect; 1333</b>
      vests that jurisdiction in the federal district courts. It governs shipping, cargo, salvage, collisions, and injuries at sea — real
      disputes on real water. It has nothing to do with flag fringe.</p>
    <p><b>And here is the sobering part the folklore never mentions:</b> for centuries, maritime law's docket included the slave trade —
      because human beings were carried across the ocean and litigated as &ldquo;cargo.&rdquo; That is a real horror in the actual record of
      admiralty, not a metaphor. <a href="/cases?q=${q('23 U.S. 66')}"><i>The Antelope</i></a>, 23 U.S. 66 (1825), is one of the darkest:
      because the international slave trade was not then unlawful under the law of nations, the Court ordered some captured Africans restored
      to foreign claimants as property. Sixteen years later, <a href="/cases?q=${q('40 U.S. 518')}"><i>United States v. The Amistad</i></a>,
      40 U.S. 518 (1841), came out the other way — the Court held the Africans who seized the schooner had been <b>illegally enslaved and were
      free</b> under American law. (In England, the 1783 <i>Zong</i> case — <i>Gregson v. Gilbert</i> — was an insurance claim over more than a
      hundred enslaved people thrown overboard and written off as lost cargo; historical context, not U.S. precedent.)</p>
    <p><b>The real law — and why the twist is grotesque:</b> precisely <b>because</b> admiralty is a genuine jurisdiction with that weight of
      history, the &ldquo;your traffic court is a maritime vessel and you are the cargo&rdquo; theory isn't a hidden truth — it's a grotesque
      misreading that borrows the vocabulary of a jurisdiction built, in part, on treating people as property, and points it at a routine
      criminal docket where it has no application. Courts reject the gold-fringe / admiralty-jurisdiction argument as frivolous:
      <i>United States v. Greenstreet</i>, 912 F. Supp. 224 (N.D. Tex. 1996). A criminal traffic case is heard under ordinary criminal
      jurisdiction, no matter what the flag looks like.</p></div>

  <div class=card><h2>The Mayflower Compact, and &ldquo;renounce your citizenship to unlock the trust&rdquo;</h2>
    <p><b>The myth:</b> the Mayflower Compact is a founding contract you can invoke to stand outside the government; and you can
      &ldquo;revoke&rdquo; or redefine your citizenship to access a secret trust fund (often tied to the 1933 gold story, HJR-192).</p>
    <p><b>What's real:</b> the <b>Mayflower Compact (1620)</b> was a genuine, important document — a covenant among the Plymouth colonists to
      form a &ldquo;civil Body Politick&rdquo; and govern themselves by agreed laws. It's an early root of American self-government by consent.
      It is not, and never was, a personal opt-out from law. And <b>HJR-192</b> (1933) was real too — it voided gold clauses in contracts and
      made U.S. currency legal tender at face value. That's <b>all</b> it did: no trust accounts, no pledged citizens, no discharge mechanism.</p>
    <p><b>The real law:</b> renouncing U.S. citizenship is a real, defined act under <b>8 U.S.C. &sect; 1481</b> — done before a consular
      officer abroad, with serious tax and immigration consequences — and it unlocks <b>no</b> fund and grants <b>no</b> immunity; it takes
      protections away, it doesn't add them. There is no trust to access because there is no trust.</p></div>

  <div class=card style="border-color:var(--gold)"><h2>The payoff: the 14th Amendment didn't trap you — it armed you</h2>
    <p><b>The myth:</b> the Fourteenth Amendment secretly created a lesser &ldquo;14th Amendment citizen&rdquo; — a federal subject — and if
      you opt out of it you escape the government's authority.</p>
    <p><b>What's real:</b> the Fourteenth Amendment, &sect; 1, Citizenship Clause makes every person born or naturalized in the United States a
      citizen of the United States <b>and</b> of their state — one citizenship, confirmed for everyone in
      <a href="/cases?q=${q('169 U.S. 649')}">United States v. Wong Kim Ark</a>, 169 U.S. 649 (1898). There is no two-tier system and no opt-out.</p>
    <p><b>The real law — and this is the whole point:</b> for most of early American history the Bill of Rights bound <b>only the federal
      government</b>, not the states (<a href="/cases?q=${q('32 U.S. 243')}">Barron v. Baltimore</a>, 32 U.S. 243 (1833)). The Fourteenth
      Amendment's Due Process Clause is what <b>incorporated</b> most of the Bill of Rights <b>against the states</b> — one right at a time:
      <a href="/cases?q=${q('268 U.S. 652')}">Gitlow v. New York</a>, 268 U.S. 652 (1925) (free speech);
      <a href="/cases?q=${q('367 U.S. 643')}">Mapp v. Ohio</a>, 367 U.S. 643 (1961) (the exclusionary rule — the same one on the roadside card
      above); <a href="/cases?q=${q('561 U.S. 742')}">McDonald v. City of Chicago</a>, 561 U.S. 742 (2010) (the Second Amendment);
      <a href="/cases?q=${q('586 U.S. 146')}">Timbs v. Indiana</a>, 586 U.S. 146 (2019) (excessive fines and fees).</p>
    <p><b>So the myth has it exactly backwards.</b> The Fourteenth Amendment is the reason a <b>state</b> trooper, a <b>county</b> jail, and a
      <b>city</b> court are bound by your Fourth, Fifth, and Eighth Amendment rights at all. It didn't lower your citizenship — it is the
      single biggest expansion of enforceable individual rights in American law. <a href="/constitution#checks">See how the Constitution's layers check each other &rarr;</a></p></div>

  <div class=card><h2>The &ldquo;state national&rdquo; myth — and the real 14th Amendment</h2>
    <p><b>The myth:</b> that you can declare yourself a &ldquo;state national,&rdquo; a &ldquo;state citizen,&rdquo; or a
      &ldquo;national but not a citizen,&rdquo; and thereby shed the <i>federal</i> (&ldquo;Fourteenth Amendment&rdquo;) citizenship that
      supposedly carries taxes, court jurisdiction, and obligations. It is the same two-tier fantasy as the &ldquo;14th Amendment citizen&rdquo;
      story above, dressed as a status you can elect.</p>
    <p><b>What's real:</b> there is <b>one</b> national citizenship, and it is not optional or two-tiered. In
      <a href="/cases?q=${q('169 U.S. 649')}"><i>United States v. Wong Kim Ark</i></a>, 169 U.S. 649 (1898), the Court held that a person
      born in the United States and subject to its jurisdiction is a citizen of the United States <b>and</b> of the state where he lives —
      the Fourteenth Amendment's Citizenship Clause states both in the same breath. There is no procedure to become a &ldquo;state national&rdquo;
      who owes nothing to the federal government, because no such category exists. And, as above, incorporation through the Fourteenth
      Amendment is what makes state and local officers answer to the Bill of Rights at all — declaring yourself outside it would forfeit
      protections, not gain immunity.</p></div>

  <div class=card><h2>The territory-and-jurisdiction myths: &ldquo;unincorporated,&rdquo; consular courts, and secession</h2>
    <p>A whole family of sovereign-citizen claims turns on the idea that <b>jurisdiction is a place you can step outside of</b> — that federal
      law only reaches federal &ldquo;territory&rdquo; or the District of Columbia, that being in one of the several States (or declaring your
      land a separate one) puts you beyond it, or that a state can simply leave the Union. Each borrows the vocabulary of a <b>real</b>,
      still-argued body of law and points it the wrong way.</p>
    <p><b>&ldquo;Unincorporated territory&rdquo; — the Insular Cases.</b> After the <b>Treaty of Paris (1898)</b> brought in Puerto Rico, Guam,
      and the Philippines, the Court built the <b>&ldquo;unincorporated territory&rdquo;</b> doctrine: in a territory not on the path to
      statehood, only the <i>fundamental</i> parts of the Constitution apply automatically. <a href="/cases?q=${q('182 U.S. 244')}"><i>Downes v. Bidwell</i></a>, 182 U.S. 244 (1901), drew that line; <a href="/cases?q=${q('195 U.S. 138')}"><i>Dorr v. United States</i></a>, 195 U.S. 138
      (1904), applied it to hold the jury-trial guarantee did not extend of its own force to the then-unincorporated Philippines; and
      <a href="/cases?q=${q('258 U.S. 298')}"><i>Balzac v. Porto Rico</i></a>, 258 U.S. 298 (1922), settled it. Note which way the doctrine
      actually cuts: it is about <b>territories that are not States getting less</b> — the several States get the whole Constitution and the
      whole reach of federal law. The theory that living in a State puts you in an &ldquo;unincorporated&rdquo; free zone reads the doctrine
      backwards. (This is live, criticized law — see <a href="/treaties">the treaties page</a> for the full arc.)</p>
    <p><b>Consular courts and the law of nations.</b> The reach question ran the other way too — how far American law follows a citizen abroad.
      In <a href="/cases?q=${q('140 U.S. 453')}"><i>In re Ross</i></a>, 140 U.S. 453 (1891), the Court upheld an American <b>consular court</b>
      trying a sailor overseas without a jury, on the theory the Constitution stopped at the water's edge. That theory did <b>not</b> survive:
      <a href="/cases?q=${q('354 U.S. 1')}"><i>Reid v. Covert</i></a>, 354 U.S. 1 (1957), repudiated it, holding the government carries the
      Constitution with it and a treaty or executive agreement cannot strip a citizen of its protections. The genuine &ldquo;law of nations&rdquo;
      in early American courts governed things like admiralty, piracy, and the slave trade (<a href="/cases?q=${q('23 U.S. 66')}"><i>The Antelope</i></a>, 23 U.S. 66 (1825); <a href="/cases?q=${q('40 U.S. 518')}"><i>United States v. The Amistad</i></a>, 40 U.S. 518 (1841) —
      see the admiralty card above) — it was never a personal &ldquo;I am a sovereign under natural/common law&rdquo; opt-out.</p>
    <p><b>Secession and &ldquo;perpetual union.&rdquo;</b> The furthest version of the claim is that a State — or a person on its soil — can
      unilaterally leave the United States. The Supreme Court answered that after the Civil War in
      <a href="/cases?q=${q('74 U.S. 700')}"><i>Texas v. White</i></a>, 74 U.S. 700 (1869): the Constitution &ldquo;in all its provisions,
      looks to an <b>indestructible Union, composed of indestructible States</b>,&rdquo; and Texas's ordinance of secession was
      &ldquo;absolutely null.&rdquo; A State cannot secede, and a private person certainly cannot declare a one-man secession. The Union is
      perpetual as a matter of decided constitutional law.</p>
    <p class=muted>The honest through-line: the <b>edges</b> of American jurisdiction — over acquired territory, over citizens abroad, over a
      State that tried to leave — are real, serious questions the courts have worked out case by case. That is the opposite of a secret switch
      an individual can flip to opt out. Jurisdiction's limits are argued in the U.S. Reports; they are not a loophole you file for.</p></div>

  <div class=card><h2>The part they're right about — the 100-mile zone &amp; the checkpoint</h2>
    <p>There really is a zone up to <b>100 miles from any external U.S. border</b> (coastlines included) where the Border Patrol has extra
      authority — the ACLU calls it the &ldquo;Constitution-free zone,&rdquo; and roughly two-thirds of the population lives inside it. Real,
      documented, not a theory. It comes from <b>8 U.S.C. &sect; 1357(a)(3)</b> and <b>8 C.F.R. &sect; 287.1(a)(2)</b> (defining
      &ldquo;reasonable distance&rdquo; as 100 air miles).</p>
    <p>But look at what the Supreme Court actually allows there — and what it doesn't. <i>United States v. Martinez-Fuerte</i>, 428 U.S. 543
      (1976): fixed interior checkpoints may <b>stop</b> you and ask questions with no individualized suspicion. <i>United States v.
      Brignoni-Ponce</i>, 422 U.S. 873 (1975): a <i>roving</i> patrol needs reasonable suspicion, and ethnicity alone isn't enough.
      <i>United States v. Ortiz</i>, 422 U.S. 891 (1975): a checkpoint stop is one thing — <b>searching your car still needs consent or
      probable cause.</b> <i>City of Indianapolis v. Edmond</i>, 531 U.S. 32 (2000): a checkpoint whose primary purpose is ordinary drug
      interdiction is <b>unconstitutional</b>.</p>
    <p class=muted>So the gap is exact: the theory says &ldquo;you can't stop me&rdquo; (false — <i>Martinez-Fuerte</i>), and by picking that
      losing argument the person forfeits the winning one — &ldquo;you can't search me&rdquo; (<i>Ortiz</i>). That trade is the broken window.</p></div>

  <div class=card><h2>The ordinary traffic stop — what they can and can't do</h2>
    <p><b>They CAN:</b> stop you for any real violation even as a pretext (<i>Whren v. United States</i>, 517 U.S. 806 (1996)); order you and
      passengers out (<i>Pennsylvania v. Mimms</i>, 434 U.S. 106 (1977); <i>Maryland v. Wilson</i>, 519 U.S. 408 (1997)) — refusing this is
      where windows break, so comply; frisk with reasonable suspicion (<i>Terry v. Ohio</i>, 392 U.S. 1 (1968); <i>Berkemer v. McCarty</i>,
      468 U.S. 420 (1984)); require your <b>name</b> in a stop-and-identify state (<i>Hiibel v. Sixth Judicial Dist. Court</i>, 542 U.S. 177
      (2004)) plus license/registration/insurance as the driver; and run a dog if it adds no time (<i>Illinois v. Caballes</i>, 543 U.S. 405
      (2005)).</p>
    <p><b>They CANNOT:</b> prolong the stop to go fishing (<i>Rodriguez v. United States</i>, 575 U.S. 348 (2015) — your strongest right; ask
      &ldquo;Am I free to go?&rdquo;); search without probable cause or consent, and you may refuse (<i>Schneckloth v. Bustamonte</i>, 412
      U.S. 218 (1973) — say &ldquo;I do not consent to any searches&rdquo;); treat your refusal as guilt (<i>Florida v. Royer</i>, 460 U.S.
      491 (1983)); or, in most places, stop you recording (<i>Turner v. Driver</i>, 848 F.3d 678 (5th Cir. 2017); <i>Glik v. Cunniffe</i>,
      655 F.3d 78 (1st Cir. 2011) — not uniform nationwide).</p></div>

  <div class=card style="border-color:var(--gold)"><h2>The move that actually works — and what to do afterward</h2>
    <p>You don't win a stop on the roadside. <b>You win it later — in a suppression motion or a civil suit — set up by how you behave in the
      first five minutes.</b> Comply with lawful commands; assert your rights in words, on camera; then litigate:</p>
    <p>1) Pull over safely, dome light on, hands on the wheel. 2) Give license, registration, insurance. 3) Beyond that:
      <b>&ldquo;Officer, I'm going to remain silent.&rdquo;</b> 4) If asked to search: <b>&ldquo;I do not consent to any searches.&rdquo;</b>
      5) If it drags: <b>&ldquo;Am I being detained, or am I free to go?&rdquo;</b> 6) Obey lawful commands even ones you think are wrong
      (step out — <i>Mimms</i>); argue it in court, not on the shoulder. Keep recording.</p>
    <p>Do this and, if the stop was unlawful, the evidence gets thrown out — the exclusionary rule (<i>Mapp v. Ohio</i>, 367 U.S. 643 (1961);
      <i>Wong Sun v. United States</i>, 371 U.S. 471 (1963)). That is the remedy the paperwork pretended to offer — and this one is real.</p>
    <p><b>The real remedies:</b> sue under <b>42 U.S.C. &sect; 1983</b> for a rights violation under color of law — with honest caveats:
      qualified immunity (<i>Harlow v. Fitzgerald</i>, 457 U.S. 800 (1982); <i>Pearson v. Callahan</i>, 555 U.S. 223 (2009)), suing a city
      needs a policy/custom (<i>Monell v. Dep't of Social Servs.</i>, 436 U.S. 658 (1978)), and suing <i>federal</i> Border Patrol agents is
      now nearly foreclosed after <i>Egbert v. Boule</i>, 596 U.S. 482 (2022) (narrowing <i>Bivens</i>, 403 U.S. 388 (1971)).</p>
    <p><a href="/complaints">File a complaint &amp; find legal aid &rarr;</a> · <a href="/lawyers">Find a lawyer &rarr;</a> · <a href="${OVERSIGHT}/file">Who do I even call? &rarr;</a></p>
    <p class=muted>The real law asks you to comply now and fight smart later — the only version that has ever actually gotten anyone their
      freedom, their car, or a check back. Use the rights that hold up.</p></div>

  <div class=card><h2>Watch what actually happens</h2>
    <p class=muted>Real, dated, sourced incidents — kept to show the doctrine above playing out, <b>not</b> to celebrate anyone getting hurt.
      Each is tagged with the legal lesson. If a link can't be verified, it comes down.</p>
    ${evidenceShelf()}</div>`;
  return body;
}

// ── /constitution — "Foundational Law" + the checks-and-balances spine ──────────────────────────────
// The four layers of law as one navigable checks-and-balances structure: Foundational (Constitution) →
// Statutory (Congress) → Case Law & Rules (courts) → Regulatory (agencies). This is an editorial civics
// explainer built on DECIDED, published precedent — where stating a final holding IS the public record
// (distinct from the /cases pending-lister rule). Landmark rows resolve live through /cases?q=<citation>.
// Neutral "the Court held…" register; no "good law" verdict; corrections route to the source of record.
// Constitution corpus (verbatim Bill of Rights + later amendments + landmark cases). Public-domain text
// from the National Archives transcript; soft-fails to empty arrays so the page never breaks. See
// knowledge/legal/constitution.json.
const CONSTITUTION_PATH = fileURLToPath(new URL('../../knowledge/legal/constitution.json', import.meta.url));
function loadConstitution() {
  try {
    const j = JSON.parse(readFileSync(CONSTITUTION_PATH, 'utf8'));
    return {
      bill_of_rights: Array.isArray(j.bill_of_rights) ? j.bill_of_rights : [],
      bill_of_rights_intro: str(j.bill_of_rights_intro),
      later_amendments: Array.isArray(j.later_amendments) ? j.later_amendments : [],
      later_amendments_intro: str(j.later_amendments_intro),
    };
  } catch { return { bill_of_rights: [], bill_of_rights_intro: '', later_amendments: [], later_amendments_intro: '' }; }
}
const str = (v) => (v == null ? '' : String(v)).trim();

// One amendment block: verbatim text (blockquote), plain-English explanation, and its landmark case(s)
// rendered with the same case-row pattern the checks section uses (name + cite badge → live /cases lookup).
function amendmentBlock(a, { anchorPrefix = 'amend' } = {}) {
  if (!a || typeof a !== 'object') return '';
  const id = `${anchorPrefix}-${esc(str(a.num) || str(a.n))}`;
  const year = a.year ? ` <span class=badge>ratified ${esc(str(a.year))}</span>` : '';
  const cases = (Array.isArray(a.cases) ? a.cases : []).map((c) =>
    `<div class=rec><div class=nm><a href="/cases?q=${q(c.cite)}">${esc(str(c.name))}</a> <span class=badge>${esc(str(c.cite))}</span></div>
      ${c.held ? `<div class=meta>${esc(str(c.held))}</div>` : ''}
      <div class=xlink><a href="/cases?q=${q(c.cite)}">read the opinion →</a></div></div>`).join('');
  // paragraph-split the verbatim text on newlines (Section 1 / Section 2 …), each escaped.
  const paras = str(a.text).split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const textHtml = paras.length ? `<blockquote style="font-size:14px;color:var(--fg);border-left-color:var(--gold)">${paras.map((p) => `<div style="margin:0 0 6px">${esc(p)}</div>`).join('')}</blockquote>` : '';
  return `<div id="${id}" style="margin:0 0 20px">
    <h3 style="margin:14px 0 6px">${esc(str(a.title))}${year}</h3>
    ${textHtml}
    ${a.sections_note ? `<p class=muted style="font-size:12px;margin:-4px 0 8px">${esc(str(a.sections_note))}</p>` : ''}
    ${a.explains ? `<p style="font-size:14px;margin:6px 0 8px">${esc(str(a.explains))}</p>` : ''}
    ${a.what ? `<p style="font-size:14px;margin:6px 0 8px"><b>What it did:</b> ${esc(str(a.what))}</p>` : ''}
    ${cases ? `<div style="margin-top:6px">${cases}</div>` : ''}</div>`;
}

export function constitutionView() {
  const landmark = (name, cite, held, q) => `<div class=rec>
    <div class=nm><a href="/cases?q=${q(cite)}">${esc(name)}</a> <span class=badge>${esc(cite)}</span></div>
    <div class=meta>${esc(held)}</div>
    <div class=xlink><a href="/cases?q=${q(cite)}">read the opinion →</a></div></div>`;
  const L = (name, cite, held) => landmark(name, cite, held, q);
  const { bill_of_rights, bill_of_rights_intro, later_amendments, later_amendments_intro } = loadConstitution();
  const borHtml = bill_of_rights.map((a) => amendmentBlock(a, { anchorPrefix: 'amend' })).join('');
  const laterHtml = later_amendments.map((a) => amendmentBlock(a, { anchorPrefix: 'amend' })).join('');
  return `<h1>Foundational Law <span class=muted style="font-size:14px">· the Constitution of the United States</span></h1>
  <p class=muted>The Constitution is the foundation every other layer of law rests on. It builds the three branches —
    <b>Congress</b> (Article I), the <b>President</b> (Article II), and the <b>courts</b> (Article III) — splits power so each
    checks the others, and sets the rights no statute, rule, or regulation may cross. Informational only, not legal advice.</p>

  <div class=card><h2>How U.S. law is layered — and how the layers check each other</h2>
    <p class=muted style="font-size:14px;margin:-2px 0 12px">Four layers, three branches, one system. Each layer draws its authority from the one above it, and the courts sit across all of them.</p>
    <div class=grid>
      <a class=sec href="/constitution" style="border-color:var(--gold)"><div class=t>1 · Foundational Law</div><div class=d>The <b>Constitution</b> — creates the three branches and the rights the other layers cannot cross.</div></a>
      <a class=sec href="/statutes"><div class=t>2 · Statutory Law</div><div class=d>Acts of <b>Congress</b> — the U.S. Code. Valid only within the powers Article I grants.</div></a>
      <a class=sec href="/cases"><div class=t>3 · Case Law &amp; Rules</div><div class=d>The <b>courts</b> — opinions interpreting the other layers. Courts can hold a statute or rule unconstitutional.</div></a>
      <a class=sec href="/regulations"><div class=t>4 · Regulatory Law</div><div class=d>The <b>executive</b> — agency rules (CFR / Federal Register). Bounded by their statute and the Constitution.</div></a>
    </div>
    <p class=muted style="font-size:13px;margin-top:12px"><b>The checks run between the layers:</b> courts strike statutes and rules as unconstitutional (<a href="#judicial-review">judicial review</a>); Congress amends the Code to override a court's reading of a statute; a constitutional amendment overrides the Court itself; an agency rule is bounded by its statute. <a href="#checks">See the landmark cases →</a></p></div>

  <div class=card><h2 id=hierarchy>How the Constitution establishes — and enforces — the authority of every other law</h2>
    <p>The Constitution is not just the first law in time; it is the law that <b>grants and limits all the others</b>. Every
      power that any government official in the United States exercises has to trace back to a grant somewhere in this
      document, and no law of any kind is valid where it collides with it. That is what makes it <b>foundational</b> rather
      than merely first: the three kinds of law that people actually live under all draw their authority from it, and all
      answer to it.</p>
    <p><b>Foundational law — the Constitution — comes first and sits above the rest.</b> It creates the branches, hands each
      an enumerated set of powers, and expressly withholds others (the rights in the amendments are powers the government was
      never given). Nothing below it can enlarge those powers; every layer beneath is measured against it.</p>
    <p><b>Statutory law — the acts of Congress and the state legislatures — is authoritative only insofar as it conforms to
      the Constitution.</b> A statute is the command of the people's elected representatives and binds everyone once enacted,
      but its force is <i>borrowed</i>: Congress may legislate only within the powers Article I grants, and a statute that
      exceeds them, or that crosses a right the Constitution secures, is void. The same is true of the fourth layer,
      <a href="/regulations">regulatory law</a> — an agency rule is valid only within the authority its statute delegates,
      which in turn must be constitutional.</p>
    <p><b>Case law and court rules — the work of the judiciary — interpret and apply the other layers, but always from within
      the constitutional frame.</b> Courts do not make foundational law; they say what the Constitution and the statutes
      mean in a concrete dispute, and in doing so they are the branch that enforces the hierarchy against the other two.</p>
    <p><b>Two clauses turn this from a diagram into an enforceable order.</b> The <b>Supremacy Clause</b> of
      <a href="#article-vi">Article VI</a> declares the Constitution, and the federal laws and treaties made under it, to be
      &ldquo;the supreme Law of the Land&hellip; any Thing in the Constitution or Laws of any State to the Contrary
      notwithstanding&rdquo; — binding the judges of every State to prefer the Constitution over any conflicting law. That
      settles <i>which</i> law wins. The <b>enforcement mechanism</b> — the power that actually gives a court the authority to
      refuse to apply an unconstitutional statute — was established in <a href="/cases?q=${q('5 U.S. 137')}">Marbury v.
      Madison</a>, 5 U.S. 137 (1803), where Chief Justice Marshall held that &ldquo;it is emphatically the province and duty
      of the judicial department to say what the law is,&rdquo; and that a legislative act repugnant to the Constitution is
      simply void. <b>Judicial review is how the paper hierarchy becomes real:</b> Supremacy names the winner, and judicial
      review is the courtroom power that enforces it. <a href="#checks">See the landmark cases that run this machinery →</a></p></div>

  <div class=card><h2 id=kinds>What kind of document is a constitution? Charters, compacts, treaties, and the rest</h2>
    <p>People use &ldquo;charter,&rdquo; &ldquo;compact,&rdquo; &ldquo;covenant,&rdquo; and &ldquo;constitution&rdquo; loosely, and a lot of
      pseudolegal argument lives in that blur. They are genuinely <b>different kinds of governing documents</b>, and where the U.S.
      Constitution sits among them is exactly what makes it supreme. The distinctions below are real and historical.</p>
    <p><b>A constitution</b> is the document that <b>constitutes</b> — literally creates — a government, defines its branches, grants it
      limited powers, and stands <b>above</b> everything that government then makes. The U.S. Constitution is ordained by
      &ldquo;We the People,&rdquo; not granted by any higher authority, and it is enforced against the government by the courts. That
      self-originating, supreme character is what sets it apart from the others.</p>
    <p><b>A charter</b> is the opposite in direction: it is a <b>grant of authority from a higher power down to a lesser one</b>. The
      colonial charters (the Charter of Massachusetts Bay of 1629, the Royal Charter of Connecticut of 1662) were granted by the English
      Crown and could be altered or revoked by it. A <b>corporate charter</b> is a grant from the state that brings a company into legal
      existence; a <b>municipal charter</b> is a grant from a state legislature that lets a city govern locally. Authority under a charter
      flows <i>downward</i> and is held at the sufferance of the grantor — the reverse of a constitution, whose authority wells up from the
      people and binds the government it creates.</p>
    <p><b>The Articles of Confederation (drafted 1777, ratified 1781)</b> were America's first national frame — and a cautionary tale. They
      created only &ldquo;a firm league of friendship&rdquo; among states that each kept &ldquo;its sovereignty, freedom and independence.&rdquo;
      There was no real central power: Congress could not tax (only beg requisitions from the states), there was no national executive and no
      national judiciary, and amending the Articles required the unanimous consent of all thirteen states. The result was paralysis — unpaid
      war debts, trade wars between states, and unrest like Shays' Rebellion — which drove the 1787 Convention to scrap the Articles and write
      a <b>constitution</b> with a genuine, if limited and checked, central government. The contrast is the whole lesson: a league of sovereign
      states with no power over individuals could not function; a constitution that acts directly on people, within enumerated limits, could.</p>
    <p><b>A compact or covenant</b> is a <b>mutual agreement among parties</b> to bind themselves together. The <b>Mayflower Compact (1620)</b>
      is the classic example: the Plymouth colonists agreed to &ldquo;covenant and combine ourselves together into a civil Body Politick&rdquo;
      and to obey the laws they would jointly make. That agreement-among-equals character is also where <b>&ldquo;compact theory&rdquo;</b> comes
      from — the argument that the Constitution is merely a compact among sovereign states, so a state may judge breaches for itself, nullify
      federal law, or secede. American law rejected that reading: the Union is not a dissolvable compact but, as
      <a href="/cases?q=${q('74 U.S. 700')}">Texas v. White</a>, 74 U.S. 700 (1869), put it, &ldquo;an indestructible Union, composed of indestructible States.&rdquo; Sovereign-citizen material often misinvokes the Mayflower Compact or &ldquo;compact theory&rdquo; as a
      personal opt-out — see <a href="/rights">Rights That Hold Up in Court</a> for why that fails.</p>
    <p><b>A treaty</b> is an agreement between <b>sovereign nations</b>. Under <a href="#article-vi">Article VI</a> a ratified treaty becomes part
      of the &ldquo;supreme Law of the Land&rdquo; — but it sits on the same tier as a federal statute (the later-in-time one prevails) and it can
      never override the Constitution itself. How a treaty is made, and when a court will actually enforce one, is its own subject:
      <a href="/treaties">see the treaties page →</a>.</p>
    <p><b>Bylaws and statutes</b> are <b>subordinate rules made under</b> a charter or a constitution — a corporation's bylaws enacted under its
      charter, or Congress's statutes enacted under the Constitution. They are law, and they bind, but only within, and never above, the
      instrument that authorizes them.</p>
    <p class=muted style="font-size:13px"><b>The through-line:</b> a constitution is the document that <i>creates</i> a government and is
      supreme over what that government makes — different in kind from a charter (authority granted from above, revocable by the grantor) and
      from a compact (authority agreed among parties). The U.S. Constitution gets called all of these at one time or another, but it is
      specifically a <b>constitution</b>: self-ordained by the people, creating a government of limited and enumerated powers, and standing over
      the statutory and case law that government then produces.</p></div>

  <div class=card><h2>Read the Constitution (official sources)</h2>
    <div class=grid>
      <a class=sec href="https://www.archives.gov/founding-docs/constitution-transcript" rel=noopener><div class=t>National Archives</div><div class=d>The engrossed transcript — the founding document itself.</div></a>
      <a class=sec href="https://www.law.cornell.edu/constitution" rel=noopener><div class=t>Cornell LII</div><div class=d>Full text, clause by clause, hyperlinked.</div></a>
      <a class=sec href="https://constitution.congress.gov/" rel=noopener><div class=t>Constitution Annotated</div><div class=d>Congress's official annotated edition — text + the cases construing each clause.</div></a>
    </div></div>

  <div class=card><h2 id=structure>The structure: three branches, three Articles</h2>
    <p style="font-size:14px;margin:-2px 0 14px">Here is the operator's point made literal: the Constitution is <b>Foundational Law</b>, and one of the things it founds is the <b>other kinds of law</b>. <b>Article I creates Congress</b> — the body whose acts are <a href="/statutes">Statutory Law</a>. <b>Article III creates the Supreme Court and the federal judiciary</b> — the courts whose decisions are <a href="/cases">Case Law &amp; Rules</a>. <b>Article II creates the Executive</b> that enforces the law and, through its agencies, issues <a href="/regulations">Regulatory Law</a>. And <b>Articles IV–VII</b> bind the States, provide the amendment power, and — through the <a href="#article-vi">Supremacy Clause</a> and the judicial review recognized in <a href="/cases?q=${q('5 U.S. 137')}">Marbury v. Madison</a> — make the whole hierarchy enforceable. So Congress and the courts do not stand on their own authority: <b>the Constitution creates the bodies that make Statutory Law and Case Law, and binds them to itself.</b></p>
    <h3 id=article-i>Article I — Legislative (Congress): the source of Statutory Law</h3>
    <p class=muted style="font-size:14px">Creates the House and Senate and grants their powers — tax and spend, borrow, regulate interstate commerce (the <b>Commerce Clause</b>), coin money, declare war, and make all laws &ldquo;necessary and proper.&rdquo; Limits Congress (no bills of attainder, no ex post facto laws) and sets how a bill becomes law: passed by both houses and presented to the President. This is where <a href="/statutes">Statutory Law</a> comes from.</p>
    <h3 id=article-ii>Article II — Executive (the President)</h3>
    <p class=muted style="font-size:14px">Vests executive power: faithfully execute the laws, command the armed forces, <a href="/treaties">make treaties</a> (Senate advice and consent) and appoint officers/judges, and veto legislation. The agencies that issue <a href="/regulations">Regulatory Law</a> sit here — acting only within the authority a statute delegates.</p>
    <h3 id=article-iii>Article III — Judicial (the courts)</h3>
    <p class=muted style="font-size:14px">Establishes the Supreme Court and lower federal courts and extends judicial power to &ldquo;cases and controversies.&rdquo; The branch that decides what the other layers mean and whether they are constitutional — the source of <a href="/cases">Case Law</a>.</p>
    <h3 id=article-iv>Article IV — the States and the federal system</h3>
    <p class=muted style="font-size:14px">Binds the States into one country: each must give <b>full faith and credit</b> to the others' laws and judgments; a citizen carries the <b>privileges and immunities</b> of citizenship into every State; a fugitive from justice is subject to <b>extradition</b>; Congress admits <b>new States</b> and governs the territories; and the United States <b>guarantees every State a republican form of government</b> and protection against invasion.</p>
    <h3 id=article-v>Article V — how the Constitution is amended</h3>
    <p class=muted style="font-size:14px">The only lawful way to change the text. An amendment is <b>proposed</b> either by a two-thirds vote of both houses of Congress or by a convention called by two-thirds of the States, and <b>ratified</b> by three-fourths of the States (through their legislatures or ratifying conventions). This is the one route that can <a href="#override">override the Supreme Court's reading of the Constitution itself</a>. The single entrenched limit today: no State may be deprived of its equal suffrage in the Senate without its consent.</p>
    <h3 id=article-vi>Article VI — the Supremacy Clause</h3>
    <p class=muted style="font-size:14px">Declares the Constitution, the laws made under it, and <a href="/treaties">treaties</a> to be the <b>&ldquo;supreme Law of the Land&rdquo;</b> — binding on the judges of every State, over any conflicting state law. It also honors the nation's pre-existing debts and requires officials to swear to support the Constitution, while forbidding any <b>religious test</b> for public office.</p>
    <h3 id=article-vii>Article VII — ratification</h3>
    <p class=muted style="font-size:14px">Set the terms by which the Constitution took effect: ratification by the conventions of <b>nine States</b> would establish it among the ratifying States. The ninth (New Hampshire) ratified in June 1788, and the new government began the following year.</p></div>

  <div class=card><h2 id=bill-of-rights>The Bill of Rights — Amendments I–X</h2>
    ${bill_of_rights_intro ? `<p class=muted style="font-size:14px;margin:-2px 0 14px">${esc(bill_of_rights_intro)}</p>` : ''}
    ${borHtml || '<p class=empty>The Bill of Rights text is unavailable right now.</p>'}
    <p class=muted style="font-size:12px;margin-top:6px">Amendment text is the verbatim public-domain text of the Constitution (National Archives engrossed transcript). Each case row states what a decision is cited for as a matter of public record — not our verdict on whether it is rightly decided or currently good law.</p></div>

  <div class=card><h2 id=amendments>The later amendments</h2>
    ${later_amendments_intro ? `<p class=muted style="font-size:14px;margin:-2px 0 14px">${esc(later_amendments_intro)}</p>` : ''}
    ${laterHtml || '<p class=empty>Amendment text is unavailable right now.</p>'}
    <p class=muted style="font-size:12px;margin-top:6px">Verbatim where quoted; summarized sections are labeled. The full text of every article and amendment is at the <a href="https://constitution.congress.gov/" rel=noopener>Constitution Annotated</a> and the <a href="https://www.archives.gov/founding-docs/constitution-transcript" rel=noopener>National Archives</a>.</p></div>

  <div class=card><h2 id=checks>Checks and balances — the landmark cases</h2>
    <p class=muted style="font-size:14px;margin:-2px 0 12px">Each row states the case, its citation, and what the Court held, as a matter of record — no judgment on whether it is rightly decided or currently good law. Click through to the court's own words.</p>
    <h3 id=judicial-review>Courts over statutes: judicial review</h3>
    ${L('Marbury v. Madison', '5 U.S. 137 (1803)', 'The Court held it has the power to declare an act of Congress unconstitutional — establishing judicial review, the keystone of every other check.')}
    ${L('McCulloch v. Maryland', '17 U.S. 316 (1819)', 'Implied powers under the Necessary and Proper Clause; a state may not tax a federal instrument (Supremacy Clause).')}
    <h3>Courts over the executive</h3>
    ${L('Youngstown Sheet & Tube Co. v. Sawyer', '343 U.S. 579 (1952)', 'The President could not seize the steel mills without congressional authorization. Jackson’s concurrence set the enduring framework for presidential power.')}
    ${L('United States v. Nixon', '418 U.S. 683 (1974)', 'Executive privilege is not absolute and does not defeat a criminal subpoena.')}
    <h3>Congress vs. the executive: bicameralism &amp; presentment</h3>
    ${L('INS v. Chadha', '462 U.S. 919 (1983)', 'The one-house legislative veto is unconstitutional — Congress acts with legal effect only through both houses plus presentment.')}
    ${L('Clinton v. City of New York', '524 U.S. 417 (1998)', 'The line-item veto is unconstitutional — the President may not cancel parts of a duly enacted statute.')}
    <h3>The executive bounded by statute: agency deference</h3>
    ${L('Chevron U.S.A. v. NRDC', '467 U.S. 837 (1984)', 'Courts should defer to an agency’s reasonable reading of an ambiguous statute it administers — the Chevron framework.')}
    ${L('Loper Bright Enterprises v. Raimondo', '603 U.S. 369 (2024)', 'Courts, not agencies, decide the best reading of a statute — overruling Chevron deference.')}
    <h3 id=override>The other direction: overriding the Court</h3>
    <p class=muted style="font-size:14px">Checks run <em>up</em> too. When the Court reads a <b>statute</b> a way Congress dislikes, Congress can amend it (e.g. the Lilly Ledbetter Fair Pay Act overrode <a href="/cases?q=${q('550 U.S. 618')}">Ledbetter v. Goodyear</a>, 550 U.S. 618 (2007)). When the Court reads the <b>Constitution</b>, only an Article V amendment can override it (the 11th overrode <a href="/cases?q=${q('2 U.S. 419')}">Chisholm v. Georgia</a>; the 16th overrode <a href="/cases?q=${q('157 U.S. 429')}">Pollock</a>; the 14th overrode <a href="/cases?q=${q('60 U.S. 393')}">Dred Scott</a>).</p></div>

  <p class=muted style="font-size:12px">Case descriptions state what each decision is cited for as a matter of legal-historical record, from the public reporters — not our verdict on whether a case is correct or currently good law. Corrections route to the source of record (see the footer).</p>`;
}

// ── /treaties — how a treaty becomes U.S. law: ratification → codification → cases ──────────────────
// Editorial civics explainer on DECIDED precedent (stating a final holding IS the public record;
// distinct from the /cases pending-lister rule). Neutral "the Court held" register; landmark rows
// resolve live through /cases?q=<citation>. Cross-links /constitution (Art. II treaty power, Art. VI
// Supremacy Clause) and /rights (the Moorish "treaty immunity" myth).
export function treatiesView() {
  const L = (name, cite, held) => `<div class=rec>
    <div class=nm><a href="/cases?q=${q(cite)}">${esc(name)}</a> <span class=badge>${esc(cite)}</span></div>
    <div class=meta>${esc(held)}</div>
    <div class=xlink><a href="/cases?q=${q(cite)}">read the opinion →</a></div></div>`;
  return `<h1>Treaties <span class=muted style="font-size:14px">· how they're made, and when they're actually law</span></h1>
  <p class=muted>A treaty is one of the most powerful instruments in American law — the Constitution calls a treaty part of the
    &ldquo;supreme Law of the Land.&rdquo; That is exactly why so much pseudolegal folklore is built on top of them. Here is how a real
    treaty is made, when it becomes enforceable law inside the United States, and the cases that draw those lines. Informational only,
    not legal advice.</p>

  <div class=card><h2>How a treaty is made</h2>
    <p>Under <b>Article II, &sect; 2</b>, the <b>President</b> negotiates a treaty — but it is not law on the President's signature alone.
      The <b>Senate</b> must give <b>advice and consent by a two-thirds vote</b>; only then does the President ratify it and exchange
      instruments with the other nation. Under <b>Article VI</b> (the <b>Supremacy Clause</b>), a ratified treaty stands with the
      Constitution and federal statutes as &ldquo;the supreme Law of the Land,&rdquo; binding on state judges.</p>
    <p><b>Not every international agreement is a &ldquo;treaty&rdquo; in this Article II sense.</b> The United States also makes
      <b>congressional-executive agreements</b> (approved by a simple majority of both houses — most trade agreements take this form) and
      <b>sole executive agreements</b> (made by the President alone within existing authority). They can carry real legal force, but they
      are made and unmade differently, and a sole executive agreement cannot override a federal statute.</p>
    <p class=xlink><a href="/constitution#article-ii">See Article II (the treaty power) and Article VI (Supremacy) on the Constitution page →</a></p></div>

  <div class=card><h2>When a treaty is enforceable law here: self-executing vs. not</h2>
    <p>A ratified treaty binds the United States internationally — but whether a <b>court in the United States</b> can enforce it directly
      depends on whether it is <b>self-executing</b>. A self-executing treaty operates as domestic law on its own. A
      <b>non-self-executing</b> treaty is a promise to the other nation that does <b>not</b> create rights a private person can sue on until
      <b>Congress passes implementing legislation</b> — that legislation is how the treaty is <b>codified</b> into the U.S. Code.</p>
    ${L('Foster & Elam v. Neilson', '27 U.S. 253 (1829)', 'Chief Justice Marshall drew the original line: a treaty is domestic law a court enforces directly only when it operates by itself; where its terms look to future legislative action, it is addressed to the political branches, not the courts.')}
    ${L('Medellín v. Texas', '552 U.S. 491 (2008)', 'A treaty obligation, and even a judgment of the International Court of Justice under it, is not automatically enforceable federal law in U.S. courts unless the treaty is self-executing or Congress has enacted implementing legislation; the President cannot make it domestic law by memorandum.')}
    <p class=muted style="font-size:14px">The practical upshot: pointing to a treaty is not the end of the argument. A court asks whether it is
      self-executing and, if not, whether Congress has codified it — the step the pseudolegal &ldquo;treaty immunity&rdquo; claims skip.</p></div>

  <div class=card><h2>The limits: powerful, but not above the Constitution</h2>
    ${L('Missouri v. Holland', '252 U.S. 416 (1920)', 'A valid treaty, and legislation passed to implement it, can reach subjects Congress might not otherwise regulate — recognizing the substantial scope of the treaty power.')}
    ${L('Reid v. Covert', '354 U.S. 1 (1957)', 'No treaty or executive agreement can confer power that violates the Constitution; constitutional protections (there, jury-trial rights) prevail over a conflicting international agreement.')}
    ${L('Head Money Cases (Edye v. Robertson)', '112 U.S. 580 (1884)', 'A treaty stands on equal footing with an act of Congress; it can be enforced, modified, or repealed by a later statute like any other law.')}
    ${L('Whitney v. Robertson', '124 U.S. 190 (1888)', 'When a self-executing treaty and a federal statute conflict, the one later in time controls — the "last-in-time" rule.')}
    <p class=muted style="font-size:14px">The real hierarchy: the <b>Constitution</b> above all; treaties and federal statutes on the same tier,
      the later one winning when they clash; and a treaty enforceable in court only when self-executing or codified. A treaty never places a
      person <b>outside</b> the Constitution or the courts.</p></div>

  <div class=card><h2>How far the Constitution reaches: territory acquired by treaty, and Americans abroad</h2>
    <p>Treaties don't just bind the country — they've been how the United States <b>acquired</b> territory, which forced a hard question:
      when land comes in by treaty, does the whole Constitution come with it? This is real, unsettled, and directly relevant to anyone who
      thinks &ldquo;jurisdiction&rdquo; is a switch you can flip.</p>
    <p><b>Territory acquired by treaty — the Insular Cases.</b> After the <b>Treaty of Paris (1898)</b> transferred Puerto Rico, Guam, and
      the Philippines from Spain, the Court built the <b>&ldquo;unincorporated territory&rdquo;</b> doctrine: in such territories only
      <i>some</i> constitutional provisions apply automatically.</p>
    ${L('Downes v. Bidwell', '182 U.S. 244 (1901)', 'The first Insular Case: distinguished "incorporated" territories (destined for statehood, full Constitution) from "unincorporated" ones, where only "fundamental" constitutional provisions apply of their own force.')}
    ${L('Dorr v. United States', '195 U.S. 138 (1904)', 'Applied the doctrine: the Sixth Amendment jury-trial guarantee did not extend of its own force to the then-unincorporated Philippines.')}
    ${L('Balzac v. Porto Rico', '258 U.S. 298 (1922)', 'Confirmed it: residents of Puerto Rico hold statutory U.S. citizenship yet were not guaranteed a jury trial in the territory — the settled statement of the unincorporated-territory doctrine.')}
    <p class=muted style="font-size:14px"><b>This is live, contested doctrine.</b> The Insular Cases have been widely criticized as resting on
      discredited, racist reasoning. In <a href="/cases?q=${q('Financial Oversight Board Aurelius')}">Financial Oversight Board v. Aurelius</a> (2020) the Court was
      asked to overrule them and declined to reach the question; in <a href="/cases?q=${q('596 U.S. 159')}">United States v. Vaello Madero</a>,
      596 U.S. 159 (2022), Justice Gorsuch's concurrence urged overruling them outright, writing they &ldquo;have no foundation in the
      Constitution and rest instead on racial stereotypes.&rdquo; The Court has not overruled them. We state this as the record, not a verdict.</p>
    <p><b>Americans abroad — the Consular Cases.</b> The reach question runs the other way too — how far U.S. law follows a citizen overseas.
      <i>In re Ross</i> upheld American <b>consular courts</b> trying citizens abroad without a jury, on the theory that the Constitution
      stopped at the water's edge. That theory did not survive:</p>
    ${L('In re Ross', '140 U.S. 453 (1891)', 'Upheld consular-court jurisdiction over an American sailor tried abroad without grand/petit jury, reasoning the Constitution had no application outside U.S. territory.')}
    ${L('Reid v. Covert', '354 U.S. 1 (1957)', 'Repudiated the Ross approach: the government has only the powers the Constitution grants and is bound by it even abroad; a treaty or executive agreement cannot strip a citizen of constitutional protections.')}
    <p class=muted style="font-size:14px">The honest through-line: the reach of American law over acquired territory and citizens abroad is a
      <b>real, serious, still-argued question</b> resolved by courts case by case — the opposite of the pseudolegal fantasy that a person can
      unilaterally declare themselves outside all jurisdiction. Jurisdiction's edges are contested in the U.S. Reports; they are not a secret
      you opt out of.</p></div>

  <div class=card style="border-color:var(--gold)"><h2>Why this matters for the &ldquo;treaty immunity&rdquo; claims</h2>
    <p>Some movements claim an old treaty — most often the 1786/1836 Treaty of Peace and Friendship with Morocco — makes them immune to
      U.S. law. Run it through the real framework and it fails at every step: the treaty is <b>not self-executing</b> as a grant of personal
      immunity, Congress never <b>codified</b> any such immunity, and even a self-executing treaty <b>could not</b> place a person outside the
      Constitution and the courts (<i>Reid v. Covert</i>). See <a href="/rights">Rights That Hold Up in Court → the Moorish / treaty-immunity cases</a>.</p></div>

  <div class=card><h2>Read the sources</h2>
    <div class=grid>
      <a class=sec href="https://www.congress.gov/treaty-document" rel=noopener><div class=t>Congress.gov — Treaties</div><div class=d>Treaty documents transmitted to the Senate and their status.</div></a>
      <a class=sec href="https://constitution.congress.gov/browse/essay/artII-S2-C2-1-4/" rel=noopener><div class=t>Constitution Annotated</div><div class=d>Self-executing vs. non-self-executing treaties, clause by clause.</div></a>
      <a class=sec href="/constitution"><div class=t>Foundational Law</div><div class=d>Article II, Article VI, and the checks-and-balances spine.</div></a>
    </div></div>

  <p class=muted style="font-size:12px">Case descriptions state what each decision is cited for as a matter of public record, from the reporters — not our verdict on whether a case is correct or currently good law. Corrections route to the source of record (see the footer).</p>`;
}

// ── /maxims — legal maxims, political axioms & idioms (same corpus that feeds the legal-graph 'maxim' node)
const MAXIMS_PATH = fileURLToPath(new URL('../../knowledge/maxims/maxims.json', import.meta.url));
function loadMaxims() {
  try { const j = JSON.parse(readFileSync(MAXIMS_PATH, 'utf8')); return Array.isArray(j.items) ? j.items : []; }
  catch { return []; }
}
const MAXIM_DOMAINS = [['legal', 'Legal maxims'], ['political', 'Political axioms'], ['idiom', 'Idioms &amp; mottos']];

// Render the case-law block for an EXPANDED maxim: curated (human-verified) cases from maxims.json first,
// then a LIVE CourtListener search on the maxim's Latin/text. Soft-fails to a "no cases found" note —
// never throws, never fabricates. `live` is the (possibly empty) array from opinions.searchCases().
function maximCasesHtml(maxim, live) {
  const curated = Array.isArray(maxim.cases) ? maxim.cases : [];
  const parts = [];
  if (curated.length) {
    parts.push('<h4 style="margin:10px 0 6px">Cases applying this maxim</h4>');
    parts.push(curated.map((c) => `<div class=rec>
      <div class=nm><a href="/cases?q=${q(c.cite || c.name)}">${esc(c.name)}</a>${c.cite ? ` <span class=badge>${esc(c.cite)}</span>` : ''}</div>
      ${c.note ? `<div class=meta>${esc(c.note)}</div>` : ''}
      <div class=xlink><a href="/cases?q=${q(c.cite || c.name)}">read the opinion &rarr;</a></div></div>`).join(''));
  }
  const rows = Array.isArray(live) ? live : [];
  if (rows.length) {
    parts.push(`<h4 style="margin:12px 0 6px">More from case law <span class=muted style="font-weight:400">&middot; live search: &ldquo;${esc(maxim.term)}&rdquo;</span></h4>`);
    parts.push(rows.map(caseRow).join(''));
  }
  if (!parts.length) {
    parts.push(`<p class=empty>No cases found for this maxim right now. Search it directly in <a href="/cases?q=${q(maxim.term)}">case law &rarr;</a>.</p>`);
  }
  return parts.join('');
}

// Each maxim renders as a <details>; the expanded one (?m=<id>) opens and shows its case law (curated +
// live). Making this async lets the expanded maxim pull live CourtListener results; the handler awaits it.
export async function maximsView(domain, expandId) {
  const items = loadMaxims();
  const want = ['legal', 'political', 'idiom'].includes(String(domain || '')) ? String(domain) : '';
  const expand = String(expandId == null ? '' : expandId).trim();
  const tabs = `<div class=tabs>${MAXIM_DOMAINS.map(([d, label]) =>
    `<a class="${want === d ? 'on' : ''}" href="/maxims?d=${esc(d)}">${label}</a>`).join('')}<a class="${!want ? 'on' : ''}" href="/maxims">All</a></div>`;
  const shown = want ? items.filter((m) => m.domain === want) : items;

  // Only the expanded maxim triggers a live lookup (soft-fails to []). Others show a link that expands them.
  const target = expand ? items.find((m) => m.id === expand) : null;
  let liveCases = [];
  if (target) {
    liveCases = await opinions.searchCases({ q: target.term, limit: 5 }).catch(() => []);
  }

  const expandHref = (m) => `/maxims?${want ? `d=${esc(want)}&` : ''}m=${esc(m.id)}#${esc(m.id)}`;
  const rows = shown.length ? shown.map((m) => {
    const isOpen = m.id === expand;
    const head = `<summary>${esc(m.term)} <span class=badge>${esc(m.domain)}${m.lang ? ` &middot; ${esc(m.lang)}` : ''}</span></summary>`;
    const meta = `${m.literal ? `<div class=meta><i>&ldquo;${esc(m.literal)}&rdquo;</i></div>` : ''}
      <div class=meta>${esc(m.gloss || '')}</div>
      ${m.provenance ? `<div class=meta>Provenance: ${esc(m.provenance)}</div>` : ''}`;
    const caseBlock = isOpen
      ? maximCasesHtml(m, liveCases)
      : `<p class=xlink style="margin-top:8px"><a href="${expandHref(m)}">Show the case law citing this maxim &rarr;</a></p>`;
    return `<details id="${esc(m.id)}" class=plm-pairing style="margin:0 0 8px"${isOpen ? ' open' : ''}>
      ${head}<div class=plm-body>${meta}${caseBlock}</div></details>`;
  }).join('') : `<p class=empty>No maxims in this set.</p>`;

  return `<h1>Maxims, axioms &amp; idioms <span class=muted style="font-size:14px">&middot; a browsable collection</span></h1>
    <p class=muted>Legal maxims, political axioms, and the idioms that carry them into everyday argument — each with a plain-English
      gloss and where it comes from. We state what a maxim <b>means</b> and <b>where it's from</b>; we do not tell you it is right.
      Open any maxim to see the <b>case law that cites or applies it</b> — curated landmark cases plus a live search of the public
      record. The legal maxims cross-reference the same categories as our <a href="/cases">case law</a>.</p>
    ${tabs}
    <div class=card>${rows}</div>`;
}

// ── /doctrines — legal doctrines + the sovereign-citizen faux-doctrines refuted ────────────────────
// Two parts. FIRST and first-class: real legal doctrines every citizen should know, grouped
// (criminal procedure / constitutional structure & rights / administrative / justiciability), each a
// plain-language definition + landmark case(s) with VERIFIED citations, linked live through /cases?q=.
// SECOND: the sovereign-citizen "faux-legal doctrines" — each myth stated neutrally, then the actual
// law and a REAL case rejecting it (the operator's "combat the Sovereign Citizen Faux-Legal Doctrines"
// framing). Editorial explainer on DECIDED, published precedent — stating what a case is cited for IS
// the public record (distinct from the /cases pending-lister rule). Bulk data: knowledge/legal/doctrines.json.
const DOCTRINES_PATH = fileURLToPath(new URL('../../knowledge/legal/doctrines.json', import.meta.url));
function loadDoctrines() {
  try {
    const j = JSON.parse(readFileSync(DOCTRINES_PATH, 'utf8'));
    return {
      groups: Array.isArray(j.groups) ? j.groups : [],
      callout: (j.sovereign_callout && typeof j.sovereign_callout === 'object') ? j.sovereign_callout : null,
    };
  } catch { return { groups: [], callout: null }; }
}

// FAQ (visible on-page AND emitted as FAQPage JSON-LD — the SAME pairs, so structured data matches text).
const DOCTRINES_FAQ = [
  { q: 'What is the difference between a real legal doctrine and a “sovereign citizen” doctrine?',
    a: 'A real legal doctrine is a settled principle courts actually apply, anchored in decided, published cases — '
     + 'stare decisis, standing, the exclusionary rule, federal preemption, and so on. A “sovereign citizen” or '
     + 'pseudolegal doctrine (the strawman, A4V, “traveling not driving,” treaty immunity) is a theory that sounds '
     + 'legal but has been rejected by U.S. courts every time it has been raised — often labeled “frivolous.”' },
  { q: 'Do sovereign-citizen arguments like the “strawman” or “Accepted for Value” ever work in court?',
    a: 'No. No U.S. court has ever accepted them; they are uniformly rejected as frivolous. Worse, filing bogus UCC '
     + 'liens or fictitious financial instruments to “discharge” debts is a federal felony under 18 U.S.C. § 514, on '
     + 'top of fraud exposure. The paperwork does not cancel a debt — it hands a prosecutor a case.' },
  { q: 'Was Chevron deference overruled?',
    a: 'Yes. In Loper Bright Enterprises v. Raimondo, 603 U.S. 369 (2024), the Supreme Court overruled Chevron '
     + 'U.S.A. Inc. v. NRDC, 467 U.S. 837 (1984). Courts now exercise independent judgment on the best reading of a '
     + 'statute rather than deferring to an agency’s reasonable interpretation of an ambiguous one.' },
];

// The landmark row helper — the SAME pattern constitutionView/treatiesView use: case name + citation
// badge, both linking the live /cases search by citation. `note` states what the case is cited for.
function doctrineCaseRow(name, cite, note, kind = '') {
  const badge = kind ? ` <span class=badge>${esc(kind)}</span>` : '';
  return `<div class=rec>
    <div class=nm><a href="/cases?q=${q(cite)}">${esc(name)}</a> <span class=badge>${esc(cite)}</span>${badge}</div>
    ${note ? `<div class=meta>${esc(note)}</div>` : ''}
    <div class=xlink><a href="/cases?q=${q(cite)}">read the opinion →</a></div></div>`;
}

// Two teaching sections that complement the grouped doctrines: (1) how a precedent gets overruled and a
// statute gets struck (the three mechanisms), and (2) how an incorporated right actually stands up in
// court (incorporation + the tiers of scrutiny). Editorial explainer on DECIDED precedent; every case is
// a real reporter citation, linked live through /cases?q=. PURE.
function teachingSections() {
  const cl = (name, cite) => `<a href="/cases?q=${q(cite)}">${esc(name)}</a>, ${esc(cite)}`;
  const overruling = `<div class=card><h2 id=overruling>How a case gets overruled — and how a statute gets struck</h2>
    <p><b>Stare decisis</b> (Latin, &ldquo;to stand by things decided&rdquo;) is the working rule of the common law: a court
      follows its own and higher courts' prior decisions, so the law stays stable and predictable. It is a strong presumption,
      not an iron law — and it is worth separating the different ways a prior decision actually loses its force. Note one
      distinction first: a higher court <i>reversing</i> a lower court on appeal in the same case is not &ldquo;overruling&rdquo; —
      overruling is discarding a <b>precedent</b> from an earlier, separate case.</p>
    <h3>1 · A court overrules its own precedent (horizontal overruling)</h3>
    <p>The Supreme Court can decide a past decision was wrong and discard it, though it demands a special justification beyond
      &ldquo;we would decide it differently now.&rdquo; The most consequential example: ${cl('Brown v. Board of Education', '347 U.S. 483 (1954)')},
      which overruled the &ldquo;separate but equal&rdquo; rule of ${cl('Plessy v. Ferguson', '163 U.S. 537 (1896)')}. Others across the
      ideological spectrum: ${cl('Gideon v. Wainwright', '372 U.S. 335 (1963)')} overruled ${cl('Betts v. Brady', '316 U.S. 455 (1942)')}
      (right to appointed counsel); ${cl('Mapp v. Ohio', '367 U.S. 643 (1961)')} overruled ${cl('Wolf v. Colorado', '338 U.S. 25 (1949)')}
      (the exclusionary rule against the States); ${cl('West Coast Hotel Co. v. Parrish', '300 U.S. 379 (1937)')} overruled
      ${cl('Adkins v. Children’s Hospital', '261 U.S. 525 (1923)')} (minimum-wage laws); ${cl('Lawrence v. Texas', '539 U.S. 558 (2003)')}
      overruled ${cl('Bowers v. Hardwick', '478 U.S. 186 (1986)')}; ${cl('Citizens United v. FEC', '558 U.S. 310 (2010)')} overruled
      ${cl('Austin v. Michigan Chamber of Commerce', '494 U.S. 652 (1990)')}; ${cl('Janus v. AFSCME', '585 U.S. 878 (2018)')} overruled
      ${cl('Abood v. Detroit Board of Education', '431 U.S. 209 (1977)')}; ${cl('Loper Bright Enterprises v. Raimondo', '603 U.S. 369 (2024)')}
      overruled ${cl('Chevron U.S.A. Inc. v. NRDC', '467 U.S. 837 (1984)')}; and ${cl('Dobbs v. Jackson Women’s Health Organization', '597 U.S. 215 (2022)')}
      overruled ${cl('Roe v. Wade', '410 U.S. 113 (1973)')} and ${cl('Planned Parenthood v. Casey', '505 U.S. 833 (1992)')}. Overruling
      runs in every direction — it is a mechanism, not a politics.</p>
    <h3>2 · A constitutional amendment overrides a case</h3>
    <p>When the Court interprets the <b>Constitution itself</b>, the Court's reading stands until the Court changes it or the people
      change the Constitution. Article V amendment is the people's answer, and it has been used to override specific decisions:
      ${cl('Dred Scott v. Sandford', '60 U.S. 393 (1857)')} — which held that Black Americans could not be citizens — was undone by the
      Thirteenth and Fourteenth Amendments; ${cl('Pollock v. Farmers’ Loan & Trust Co.', '157 U.S. 429 (1895)')}, which had barred an
      unapportioned income tax, was overridden by the Sixteenth Amendment; ${cl('Chisholm v. Georgia', '2 U.S. 419 (1793)')} was overridden
      by the Eleventh Amendment; and ${cl('Oregon v. Mitchell', '400 U.S. 112 (1970)')} — which let Congress set an 18-year voting age for
      federal but not state elections — was resolved by the Twenty-sixth Amendment. (When the Court merely interprets a <b>statute</b>,
      Congress can override it by amending the statute — a lower bar than a constitutional amendment. See
      <a href="/constitution#override">the Constitution page →</a>.)</p>
    <h3>3 · A court overrules Congress (judicial review striking a statute)</h3>
    <p>The most direct check: a court holds an <b>act of Congress</b> unconstitutional and refuses to enforce it. The power itself was
      established in ${cl('Marbury v. Madison', '5 U.S. 137 (1803)')}, where the Court held it is &ldquo;emphatically the province and duty
      of the judicial department to say what the law is&rdquo; and that a statute repugnant to the Constitution is void — the enforcement
      mechanism behind the whole <a href="/constitution#hierarchy">hierarchy of law</a>. Examples of it in action:
      ${cl('Leary v. United States', '395 U.S. 6 (1969)')} struck the Marihuana Tax Act of 1937 because its scheme forced self-incrimination
      in violation of the Fifth Amendment; ${cl('INS v. Chadha', '462 U.S. 919 (1983)')} struck the one-house legislative veto;
      ${cl('United States v. Lopez', '514 U.S. 549 (1995)')} struck the Gun-Free School Zones Act as beyond the Commerce Clause;
      ${cl('Clinton v. City of New York', '524 U.S. 417 (1998)')} struck the Line Item Veto Act; and
      ${cl('United States v. Morrison', '529 U.S. 598 (2000)')} struck the civil-remedy provision of the Violence Against Women Act.</p>
    <p class=muted style="font-size:12px">Case rows state what each decision is cited for as a matter of public record — not our verdict
      on whether it is rightly decided. Click any citation to read the court's own words.</p></div>`;

  const incorporation = `<div class=card><h2 id=incorporation>How an incorporated right stands up in court</h2>
    <p>Knowing a right exists is only half the picture; what matters in a real case is how it is <b>enforced against a law</b>. Two
      steps decide it: first, does the right even apply to the government being sued, and second, what test does the court use to judge
      the challenged law.</p>
    <h3>1 · Incorporation — making the Bill of Rights apply to the States</h3>
    <p>The Bill of Rights originally bound <b>only the federal government</b> — ${cl('Barron v. Baltimore', '32 U.S. 243 (1833)')} held it
      did not reach the States at all. The Fourteenth Amendment (1868) changed that: through its <b>Due Process Clause</b>, the Supreme
      Court has &ldquo;incorporated&rdquo; most of the Bill of Rights against the States, one guarantee at a time. Milestones:
      ${cl('Gitlow v. New York', '268 U.S. 652 (1925)')} (freedom of speech); ${cl('Duncan v. Louisiana', '391 U.S. 145 (1968)')} (criminal
      jury trial); ${cl('McDonald v. City of Chicago', '561 U.S. 742 (2010)')} (the Second Amendment); and
      ${cl('Timbs v. Indiana', '586 U.S. 146 (2019)')} (the Eighth Amendment's ban on excessive fines). A few provisions have
      <b>not</b> been incorporated and so still restrain only the federal government: the Third Amendment, the Seventh Amendment's
      civil-jury right, and the Fifth Amendment's grand-jury clause (${cl('Hurtado v. California', '110 U.S. 516 (1884)')}).</p>
    <h3>2 · The standard of review — the test that decides whether the law falls</h3>
    <p>Once a right applies, the court picks a <b>level of scrutiny</b>, and the tier chosen usually decides the outcome:</p>
    <p><b>Strict scrutiny</b> applies to laws burdening a fundamental right or classifying by a suspect trait such as race. The government
      must show a <b>compelling interest</b> pursued by the <b>least restrictive / narrowly tailored</b> means — a demanding test most
      laws fail. <b>Intermediate scrutiny</b> applies to classifications such as sex and to some speech regulations: the government needs
      an <b>important interest</b> and means <b>substantially related</b> to it (${cl('Craig v. Boren', '429 U.S. 190 (1976)')};
      ${cl('United States v. Virginia', '518 U.S. 515 (1996)')}). <b>Rational-basis review</b> is the default for ordinary economic and
      social legislation: a law survives if it is <b>rationally related to a legitimate interest</b> — a test most laws pass
      (${cl('Williamson v. Lee Optical Co.', '348 U.S. 483 (1955)')}).</p>
    <p>Some rights carry their <b>own</b> purpose-built test rather than a tier. Speech that allegedly incites violence is judged by
      ${cl('Brandenburg v. Ohio', '395 U.S. 444 (1969)')} — punishable only if directed to, and likely to produce, <b>imminent lawless
      action</b>. Gun regulations are now judged by ${cl('New York State Rifle & Pistol Ass’n v. Bruen', '597 U.S. 1 (2022)')}, which
      asks whether a law is consistent with the Nation's historical <b>text-and-tradition</b> of firearm regulation.</p>
    <p><b>The through-line:</b> a right &ldquo;stands up in court&rdquo; through a chain — the right is <a href="/constitution#bill-of-rights">incorporated</a>
      against the government being sued, a plaintiff invokes it against the challenged law, the court selects the tier or the
      right-specific test, and the law is <b>struck if it fails</b> that test. That is the machinery by which the Bill of Rights actually
      overturns a statute, connecting to <a href="#overruling">how courts strike laws</a> above. But there is a <b>procedural step</b> you
      cannot skip — <a href="#challenge">how you actually raise the challenge →</a></p></div>`;

  const challenge = `<div class=card><h2 id=challenge>How you raise a constitutional challenge — the procedure</h2>
    <p>Deciding a law is unconstitutional is the court's job; <b>putting the question before the court properly</b> is yours. When a
      litigant attacks a statute's constitutionality and the responsible government is not already in the case, the rules require that the
      government be <b>notified and given a chance to defend its own law</b>. Miss that step and the challenge can stall or fail on
      procedure, no matter how strong it is on the merits.</p>
    <h3>In federal court — Rule 5.1 and 28 U.S.C. &sect; 2403</h3>
    <p>Under <b>Fed. R. Civ. P. 5.1</b>, a party whose filing draws into question the constitutionality of a <b>federal or a state</b>
      statute — where the relevant government is not already a party — must <b>promptly file a &ldquo;notice of constitutional
      question&rdquo;</b> and <b>serve it on the Attorney General</b> (the U.S. Attorney General for a federal statute, the state attorney
      general for a state statute). The court must then <b>certify</b> the challenge to that Attorney General under
      <b>28 U.S.C. &sect; 2403</b> — subsection (a) for a federal statute, subsection (b) for a state statute — and the Attorney General
      <b>may intervene</b> (generally within 60 days) to defend the law. Until the intervention time runs, the court may reject the
      challenge but <b>may not enter a final judgment holding the statute unconstitutional</b>. Importantly, Rule 5.1(d) provides that a
      party's failure to file the notice, or the court's failure to certify, <b>does not forfeit</b> an otherwise timely constitutional
      claim — the mechanism protects the absent government, it does not trap the litigant.</p>
    <p><b>The case law in action.</b> ${cl('Maine v. Taylor', '477 U.S. 131 (1986)')} is the textbook example of &sect; 2403(b): when a
      defendant argued a Maine statute violated the Commerce Clause, <b>the State of Maine intervened under 28 U.S.C. &sect; 2403(b)</b> to
      defend its own statute — and, after the United States declined to pursue the appeal, it was Maine's intervention that carried the case
      to the Supreme Court, which upheld the statute. That is the whole point of the notice-and-certify machinery: the government whose law
      is attacked gets to walk in and defend it. On appeal, the parallel rule is <b>Fed. R. App. P. 44</b>, which requires a party
      questioning a statute's constitutionality to notify the clerk so the court can fulfill the same &sect; 2403 certification duty.</p>
    <h3>In Texas — Tex. Gov't Code &sect; 402.010</h3>
    <p>Texas has its own version. Under <b>Tex. Gov't Code &sect; 402.010</b>, a party challenging the constitutionality of a Texas
      statute must file the required notice, and the court must <b>serve notice of the challenge on the Texas Attorney General</b> (unless
      the AG is already involved). A court <b>may not enter a final judgment holding a Texas statute unconstitutional before the 45th day
      after</b> that notice is served. As with the federal rule, the current statute is explicit that a failure to file or serve the notice
      <b>does not deprive the court of jurisdiction</b> or forfeit a timely challenge.</p>
    <p><b>The case law — and a real separation-of-powers fight.</b> The <i>current</i> text exists because an earlier version was struck
      down. In ${cl('Ex parte Lo', '424 S.W.3d 10 (Tex. Crim. App. 2013)')}, the Texas Court of Criminal Appeals held that the
      then-existing &sect;&sect; 402.010(a)–(b) — which had forced courts to halt proceedings and delay ruling — <b>violated the separation
      of powers</b> under the Texas Constitution by intruding on the judicial function. The Legislature responded the same year (S.B. 392,
      83rd Leg., 2013), rewriting &sect; 402.010 into the notice-and-45-day-limit form described above, with the express no-forfeiture and
      no-loss-of-jurisdiction language. It is a clean illustration of the <a href="#overruling">checks between the branches</a>: a court
      struck a statute that overreached against courts, and the legislature rewrote it to fit.</p>
    <p class=muted style="font-size:13px"><b>The general rule:</b> most states have an analogous attorney-general-notice statute or rule
      when a state law's constitutionality is challenged. A litigant — represented or pro se — who wins the constitutional argument but
      skips the notice can still see the challenge stumble. Verify the exact notice rule and deadline in your court before you file; see the
      <a href="/appeals">appeals &amp; writs ladder</a> for the surrounding procedure.</p></div>`;

  return `${overruling}\n${incorporation}\n${challenge}`;
}

export function doctrinesView() {
  const { groups, callout } = loadDoctrines();

  const realGroups = groups.map((g) => {
    const doctrines = (Array.isArray(g.doctrines) ? g.doctrines : []).map((d) => {
      const cases = (Array.isArray(d.cases) ? d.cases : []).map((c) => doctrineCaseRow(c.name, c.cite, c.note)).join('');
      const exceptions = (Array.isArray(d.exceptions) ? d.exceptions : []);
      const exHtml = exceptions.length
        ? `<h4 style="margin:12px 0 6px">Key exceptions</h4>${exceptions.map((c) => doctrineCaseRow(c.name, c.cite, c.note, 'exception')).join('')}`
        : '';
      return `<div id="${esc(d.id)}" style="margin:0 0 18px">
        <h3>${esc(d.name)}</h3>
        <p style="margin:4px 0 10px">${esc(d.definition)}</p>
        ${cases}${exHtml}</div>`;
    }).join('');
    return `<div class=card><h2 id="${esc(g.id)}">${esc(g.name)}</h2>
      ${g.blurb ? `<p class=muted style="font-size:14px;margin:-2px 0 14px">${esc(g.blurb)}</p>` : ''}
      ${doctrines}</div>`;
  }).join('');

  // The single, brief, non-focus sovereign-citizen callout (operator reframe): factual, not mockery —
  // sov-cit theory rests on MISreadings of real law (the Commerce Clause being the clearest), a few
  // frivolous-rejection cases, and verified "what actually happens" news/body-cam links.
  let calloutHtml = '';
  if (callout) {
    const frivolous = (Array.isArray(callout.frivolous) ? callout.frivolous : [])
      .map((c) => doctrineCaseRow(c.name, c.cite, c.note)).join('');
    const videos = (Array.isArray(callout.videos) ? callout.videos : []).map((v) => `<div class=rec>
      <div class=nm><a href="${esc(v.url)}" rel="nofollow noopener">${esc(v.title || 'Video')}</a>${v.source ? ` <span class=badge>${esc(v.source)}</span>` : ''}</div>
      ${v.caption ? `<div class=meta>${esc(v.caption)}</div>` : ''}</div>`).join('');
    const seeAlso = (Array.isArray(callout.see_also) ? callout.see_also : [])
      .map((l) => `<a href="${esc(l.url)}">${esc(l.label)} →</a>`).join(' · ');
    calloutHtml = `<div class=card style="border-color:var(--gold)">
      <h2 style="margin-top:0">A note on “sovereign citizen” pseudolaw</h2>
      <p style="margin:0 0 8px">${esc(callout.mission || '')}</p>
      <p style="margin:0 0 8px"><b>Their theories misread real law.</b> ${esc(callout.misreading || '')}</p>
      ${frivolous ? `<h3 style="margin:12px 0 6px">Courts reject these across the board</h3>${frivolous}` : ''}
      ${videos ? `<h3 style="margin:14px 0 6px">What actually happens on the roadside</h3>
        <p class=muted style="font-size:13px;margin:-2px 0 8px">Real, sourced footage and reporting — shown to document the consequences, not to mock anyone:</p>${videos}` : ''}
      ${seeAlso ? `<p class=xlink style="margin-top:12px">${seeAlso}</p>` : ''}</div>`;
  }

  const body = `<h1>Legal doctrines <span class=muted style="font-size:14px">· the principles that run American law</span></h1>
    <p class=muted>A plain-English reference to the doctrines that actually decide cases — grouped by area, defined without
      jargon, and each anchored to the landmark case you can pull yourself. Click any citation to open the court's own
      opinion in <a href="/cases">Cases</a>. Every citation here is verified against the public reporters. Informational
      only, not legal advice.</p>

    <div class=card><h2>How to read this page</h2>
      <p class=muted style="font-size:14px;margin:0 0 8px">Each entry gives a doctrine, a plain-language definition, and the
        landmark case(s) that established it. Every row states what a decision is cited for as a matter of public record —
        not our verdict on whether it is rightly decided or currently good law. A short closing note addresses the
        sovereign-citizen pseudolaw this project works to counter.</p>
      <p class=muted style="font-size:14px;margin:0">These doctrines are how the real system actually works — the machinery
        that runs across the three kinds of law: <a href="/constitution">foundational</a> (the Constitution),
        <a href="/statutes">statutory</a> (Congress), and case law (the courts). MELEK is a chain that teaches that genuine
        structure — which is exactly why it is worth telling apart from the counterfeit that pseudolaw sells.</p></div>

    ${realGroups || '<div class=card><p class=empty>Doctrine data is unavailable right now.</p></div>'}

    ${teachingSections()}
    ${calloutHtml}
    ${faqCard(DOCTRINES_FAQ)}`;
  return body;
}

// ── /spirit-of-the-laws — Montesquieu, separation of powers, and reading a law for its purpose ──────
// Wires the verified teaching corpus (knowledge/legal/spirit-of-the-laws.json) onto a live page via the
// spirit-of-the-laws.mjs loader: the Montesquieu overview, the real cases (with the verified quotes/cites
// the JSON holds), the letter-vs-spirit teaching, the textualist counterpoint, and the reading list.
// Editorial explainer on DECIDED precedent + intellectual history; a quote the corpus could not confirm
// verbatim is surfaced with its verify-at-source note, never fabricated (Charter §3).
function solCaseRow(c) {
  if (!c || typeof c !== 'object') return '';
  const quote = str(c.quote);
  const note = str(c.quote_note);
  const secondary = str(c.secondary_quote);
  const nameLink = c.case ? `<a href="/cases?q=${q(c.citation || c.case)}">${esc(str(c.case))}</a>` : '';
  return `<div class=rec>
    <div class=nm>${nameLink}${c.citation ? ` <span class=badge>${esc(str(c.citation))}</span>` : ''}${c.method ? ` <span class=badge>${esc(str(c.method))}</span>` : ''}</div>
    ${c.court ? `<div class=meta>${esc(str(c.court))}</div>` : ''}
    ${c.holding ? `<p style="font-size:14px;margin:6px 0 8px">${esc(str(c.holding))}</p>` : ''}
    ${quote ? `<blockquote>&ldquo;${esc(quote)}&rdquo;</blockquote>`
      : (note ? `<p class=muted style="font-size:13px">Quote not yet verified verbatim — ${esc(note)}</p>` : '')}
    ${(quote && note) ? `<p class=muted style="font-size:12px">${esc(note)}</p>` : ''}
    ${secondary ? `<blockquote>&ldquo;${esc(secondary)}&rdquo;</blockquote>` : ''}
    ${c.pincite ? `<div class=meta>${esc(str(c.pincite))}</div>` : ''}
    ${c.teaching_blurb ? `<p style="font-size:13px;margin:8px 0 4px">${esc(str(c.teaching_blurb))}</p>` : ''}
    <div class=xlink>${c.source_url ? `<a href="${esc(str(c.source_url))}" rel="nofollow noopener">read it at the source →</a> · ` : ''}<a href="/cases?q=${q(c.citation || c.case)}">find it in Cases →</a></div>
  </div>`;
}

export function spiritOfTheLawsView() {
  const m = sol.montesquieu();
  const cp = sol.counterpoint();
  const reading = sol.readingList();
  const methodLabels = {
    purposivist: 'Reading for the purpose (purposivism)',
    'mischief-rule': 'The mischief rule',
    'separation-of-powers-Montesquieu': 'Separation of powers — Montesquieu cited by name',
    'plain-meaning-counterpoint': 'The counterpoint — letter over spirit',
  };
  // group the cases by interpretive method (loader-driven), in a teaching order.
  const order = ['separation-of-powers-Montesquieu', 'mischief-rule', 'purposivist', 'plain-meaning-counterpoint'];
  const present = sol.methods();
  const methodsInOrder = [...order.filter((mm) => present.includes(mm)), ...present.filter((mm) => !order.includes(mm))];
  const caseCards = methodsInOrder.map((mm) => {
    const rows = sol.casesFor(mm).map(solCaseRow).join('');
    if (!rows) return '';
    return `<div class=card><h2>${esc(methodLabels[mm] || mm)}</h2>${rows}</div>`;
  }).join('');

  const ideas = Array.isArray(m.two_ideas_we_teach) ? m.two_ideas_we_teach : [];
  const positions = Array.isArray(cp.positions) ? cp.positions : [];
  const readingHtml = reading.map((r) => `<div class=rec>
    <div class=nm>${r.source_url ? `<a href="${esc(str(r.source_url))}" rel="nofollow noopener">${esc(str(r.title))}</a>` : esc(str(r.title))}</div>
    <div class=meta>${[str(r.author), str(r.edition)].filter(Boolean).map(esc).join(' · ')}</div>
    ${r.why ? `<blockquote>${esc(str(r.why))}</blockquote>` : ''}</div>`).join('');

  return `<h1>The Spirit of the Laws <span class=muted style="font-size:14px">· Montesquieu, and reading a law for its purpose</span></h1>
    <p class=muted>${esc(str(m.one_line) || 'How Montesquieu shaped American separation of powers — and what it means to read a law for its spirit, not just its letter.')} Informational history and legal education, not legal advice.</p>

    <div class=card><h2>Montesquieu and <i>The Spirit of the Laws</i> (1748)</h2>
      ${m.work ? `<p style="font-size:14px">${esc(str(m.work))}</p>` : ''}
      ${ideas.length ? `<h3 style="margin:12px 0 6px">The two ideas this page teaches</h3><ul style="font-size:14px;line-height:1.6;padding-left:18px">${ideas.map((i) => `<li style="margin:6px 0">${esc(str(i))}</li>`).join('')}</ul>` : ''}
    </div>

    <div class=card><h2 id=separation>Separation of powers — the doctrine and the Framers</h2>
      ${m.separation_of_powers_doctrine ? `<p style="font-size:14px">${esc(str(m.separation_of_powers_doctrine))}</p>` : ''}
      ${m.influence_on_the_framers ? `<p style="font-size:14px">${esc(str(m.influence_on_the_framers))}</p>` : ''}
      <p class=xlink><a href="/constitution#structure">See the three branches on the Constitution page →</a> · <a href="/doctrines#structure">the separation-of-powers doctrine in Doctrines →</a></p></div>

    <div class=card><h2 id=letter-vs-spirit>Letter vs. spirit — reading a law for its purpose</h2>
      ${m.letter_vs_spirit ? `<p style="font-size:14px">${esc(str(m.letter_vs_spirit))}</p>` : ''}</div>

    ${caseCards}

    ${(cp.title || positions.length) ? `<div class=card style="border-color:var(--gold)"><h2>${esc(str(cp.title) || 'The textualist counterpoint — letter over spirit')}</h2>
      ${cp.summary ? `<p style="font-size:14px">${esc(str(cp.summary))}</p>` : ''}
      ${positions.map((p) => `<div class=rec><div class=nm>${esc(str(p.thinker))}</div>
        ${p.source ? `<div class=meta>${p.source_url ? `<a href="${esc(str(p.source_url))}" rel="nofollow noopener">${esc(str(p.source))}</a>` : esc(str(p.source))}</div>` : ''}
        ${p.position ? `<p style="font-size:14px;margin:6px 0">${esc(str(p.position))}</p>` : ''}</div>`).join('')}
      ${cp.honest_note ? `<p class=muted style="font-size:13px;margin-top:10px">${esc(str(cp.honest_note))}</p>` : ''}</div>` : ''}

    ${readingHtml ? `<div class=card><h2>Read further (verified editions)</h2>${readingHtml}</div>` : ''}

    <p class=muted style="font-size:12px">Every case, quote, pincite, and book on this page is drawn from a verified corpus (each with a source link); a quote that could not be confirmed verbatim against a primary text is labeled as such rather than invented. Case descriptions state what a decision is cited for as a matter of record — not our verdict on whether it is rightly decided. Corrections route to the source of record (see the footer).</p>`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

// Strip an optional leading jurisdiction segment (/us/…) and return { juris, path }. Unknown prefixes
// are NOT treated as jurisdictions (they fall through to the section router and 302 to home).
function splitJurisdiction(pathname) {
  const m = pathname.match(/^\/([a-z]{2})(\/.*|)$/i);
  if (m && JURISDICTIONS[m[1].toLowerCase()]) {
    return { juris: m[1].toLowerCase(), path: m[2] || '/' };
  }
  return { juris: DEFAULT_JURISDICTION, path: pathname };
}

const SITEMAP_PATHS = ['/', '/constitution', '/treaties', '/cases', '/dockets', '/statutes', '/regulations', '/judges', '/lawyers', '/complaints', '/privacy', '/appeals', '/rights', '/doctrines', '/spirit-of-the-laws', '/maxims'];

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const raw = url.pathname;

    if (raw === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (raw === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (raw === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({
        path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7',
      }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (raw === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (raw === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(lawLlmsTxt());
    }

    const { juris, path } = splitJurisdiction(raw);
    // (juris is reserved for the multi-jurisdiction future; today every reader is the US namespace.)
    void juris;
    const sp = url.searchParams;

    if (path === '/' && raw !== '/') {
      // a bare jurisdiction root like /us → the home page
      return sendHtml(res, homePage());
    }
    if (path === '/') return sendHtml(res, homePage());

    if (path === '/cases') {
      const detailId = sp.get('id') || '';
      const detailCap = sp.get('cap') || '';
      if (detailId || detailCap) {
        // case-DETAIL: the court's own verbatim opinion text. noindex,follow on the detail page.
        return sendHtml(res, page('Opinion — SoapBox Law',
          await caseDetailView({ clId: detailId, capId: detailCap }),
          { canonical: `${BASE_URL}/cases`, robots: 'noindex,follow' }));
      }
      return sendHtml(res, page('Cases — SoapBox Law', await casesView(sp.get('q') || '', sp.get('court') || ''),
        { canonical: `${BASE_URL}/cases`, robots: (sp.get('q') || sp.get('court')) ? 'noindex,follow' : 'index,follow',
          breadcrumb: crumbs('Cases', '/cases') }));
    }
    if (path === '/dockets') {
      return sendHtml(res, page('Dockets — SoapBox Law', await docketsView(sp.get('q') || '', sp.get('court') || ''),
        { canonical: `${BASE_URL}/dockets`, robots: (sp.get('q') || sp.get('court')) ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/statutes') {
      return sendHtml(res, page('Statutes & Code — SoapBox Law', await statutesView(sp.get('q') || ''),
        { canonical: `${BASE_URL}/statutes`, robots: sp.get('q') ? 'noindex,follow' : 'index,follow',
          breadcrumb: crumbs('Statutes & Code', '/statutes') }));
    }
    if (path === '/regulations') {
      return sendHtml(res, page('Regulations — SoapBox Law', await regulationsView(sp.get('agency') || ''),
        { canonical: `${BASE_URL}/regulations`, breadcrumb: crumbs('Regulations', '/regulations') }));
    }
    if (path === '/judges') {
      return sendHtml(res, page('Judges — SoapBox Law', await judgesView(sp.get('q') || '', sp.get('id') || ''),
        { canonical: `${BASE_URL}/judges`, robots: (sp.get('q') || sp.get('id')) ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/lawyers') {
      return sendHtml(res, page('Lawyers — SoapBox Law', await lawyersView(sp.get('q') || '', sp.get('state') || ''),
        { canonical: `${BASE_URL}/lawyers`, robots: sp.get('q') ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/complaints') {
      return sendHtml(res, page('File a complaint — SoapBox Law', complaintsView(), { canonical: `${BASE_URL}/complaints` }));
    }
    if (path === '/privacy') {
      const st = sp.get('statute') || '';
      return sendHtml(res, page('Privacy law — federal vs. Texas — SoapBox Law', await privacyView(st),
        { canonical: `${BASE_URL}/privacy`, robots: st ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/appeals' || path === '/writs') {
      const active = sp.get('remedy') || sp.get('state') || sp.get('level') || sp.get('done');
      return sendHtml(res, page('Appeals & extraordinary writs — a pro-se ladder — SoapBox Law',
        await appealsView({ state: sp.get('state') || '', level: sp.get('level') || '', remedy: sp.get('remedy') || '', done: sp.get('done') || '' }),
        { canonical: `${BASE_URL}/appeals`, robots: active ? 'noindex,follow' : 'index,follow',
          breadcrumb: crumbs('Appeals & writs', '/appeals'),
          faq: APPEALS_FAQ,
          cite: { title: 'Appeals & extraordinary writs — a pro-se ladder', url: `${BASE_URL}/appeals`, author: 'SoapBox Law',
            sourceOfRecord: 'the Federal Rules of Appellate Procedure, 28 U.S.C., and each state’s rules of appellate procedure' } }));
    }
    if (path === '/rights') {
      return sendHtml(res, page('Rights That Hold Up in Court — SoapBox Law', rightsPage(),
        { canonical: `${BASE_URL}/rights`, breadcrumb: crumbs('Your rights', '/rights'),
          cite: { title: 'Rights That Hold Up in Court', url: `${BASE_URL}/rights`, author: 'SoapBox Law',
            sourceOfRecord: 'U.S. Constitution and controlling U.S. Supreme Court precedent' } }));
    }
    if (path === '/constitution') {
      return sendHtml(res, page('Foundational Law — the Constitution — SoapBox Law', constitutionView(),
        { canonical: `${BASE_URL}/constitution`, breadcrumb: crumbs('Constitution', '/constitution'),
          cite: { title: 'Foundational Law — the U.S. Constitution', url: `${BASE_URL}/constitution`, author: 'SoapBox Law',
            sourceOfRecord: 'U.S. Constitution (public domain)',
            license: 'https://creativecommons.org/publicdomain/mark/1.0/' } }));
    }
    if (path === '/treaties') {
      return sendHtml(res, page('Treaties — how they’re made, and when they’re law — SoapBox Law', treatiesView(),
        { canonical: `${BASE_URL}/treaties`, breadcrumb: crumbs('Treaties', '/treaties'),
          cite: { title: 'Treaties — how they are made, and when they are law', url: `${BASE_URL}/treaties`, author: 'SoapBox Law',
            sourceOfRecord: 'U.S. Constitution, Art. II & Art. VI' } }));
    }
    if (path === '/doctrines') {
      return sendHtml(res, page('Legal doctrines — real doctrines & sovereign-citizen pseudolaw — SoapBox Law', doctrinesView(),
        { canonical: `${BASE_URL}/doctrines`, breadcrumb: crumbs('Doctrines', '/doctrines'),
          faq: DOCTRINES_FAQ,
          cite: { title: 'Legal doctrines — the principles that run American law', url: `${BASE_URL}/doctrines`, author: 'SoapBox Law',
            sourceOfRecord: 'U.S. Constitution and controlling U.S. Supreme Court and federal precedent' } }));
    }
    if (path === '/spirit-of-the-laws') {
      return sendHtml(res, page('The Spirit of the Laws — Montesquieu & purposive interpretation — SoapBox Law', spiritOfTheLawsView(),
        { canonical: `${BASE_URL}/spirit-of-the-laws`, breadcrumb: crumbs('The Spirit of the Laws', '/spirit-of-the-laws'),
          description: 'Montesquieu’s The Spirit of the Laws: separation of powers, and the cases where judges read a law for its spirit, not just its letter. Verified corpus — real quotes, real cites.',
          cite: { title: 'The Spirit of the Laws — Montesquieu & purposive interpretation', url: `${BASE_URL}/spirit-of-the-laws`, author: 'SoapBox Law',
            sourceOfRecord: 'Montesquieu, De l’esprit des lois (1748); The Federalist; and the cited U.S. and English reports' } }));
    }
    if (path === '/maxims') {
      return sendHtml(res, page('Maxims, axioms & idioms — SoapBox Law', await maximsView(sp.get('d') || '', sp.get('m') || ''),
        { canonical: `${BASE_URL}/maxims`, robots: (sp.get('d') || sp.get('m')) ? 'noindex,follow' : 'index,follow',
          breadcrumb: crumbs('Maxims', '/maxims') }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Exported for tests / extension wiring.
export { homePage, browseByCourt, splitJurisdiction, publicInterestData, looksLikeCitation, FR_AGENCIES, JURISDICTIONS };

// Only bind the port when run directly (`node site/law/server.mjs`), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/law\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Law on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
