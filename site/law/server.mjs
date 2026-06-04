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

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import * as opinions from '../../integrations/soapbox/courtlistener-opinions.mjs';
import * as cap from '../../integrations/soapbox/caselaw-cap.mjs';
import * as ecfr from '../../integrations/soapbox/ecfr.mjs';
import * as fedreg from '../../integrations/soapbox/federal-register.mjs';
import * as uscode from '../../integrations/soapbox/uscode.mjs';
import * as judges from '../../integrations/soapbox/courtlistener-judges.mjs';
import * as lawyers from '../../integrations/soapbox/lawyer-directory.mjs';

const PORT = +(process.env.PORT || 8099);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const DIRECTORY = process.env.DIRECTORY_SITE || 'https://directory.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';

// Jurisdiction registry. US is jurisdiction #1; the bare paths alias to it. Add a code here to open a
// new jurisdiction's URL prefix (see the extension plan in the header).
const JURISDICTIONS = { us: 'United States' };
const DEFAULT_JURISDICTION = 'us';

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
  <div style="margin-top:8px"><a href="/">Law</a> · <a href="${DATA}">Data</a> · <a href="${SEARCH}">Search</a> · <a href="${DIRECTORY}">Directory</a> · <a href="${WIKI}">Library</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Law.SoapBox — U.S. caselaw, statutes, regulations, judges, and lawyer records. Facts, not verdicts. Public-domain, keyless, source-linked.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">⚖ SoapBox <span>law</span></a>
  <div class=topbar-r><a href="/cases">Cases</a><a href="/statutes">Statutes</a><a href="/regulations">Regulations</a><a href="/judges">Judges</a><a href="/lawyers">Lawyers</a><a href="/complaints">File a complaint</a><a href="${DATA}">Data</a><a href="${WIKI}">Library</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// small URL-encode shorthand
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

// search form + an optional cases/statutes toggle on the home box
function searchForm(action, { value = '', placeholder = 'Search…', label = 'Search', extra = '' } = {}) {
  return `<form class=lawsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name=q value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    ${extra}<button type=submit>${esc(label)}</button>
  </div></form>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
function homePage() {
  const sections = [
    ['/cases', 'Cases', 'Search U.S. court opinions, or resolve a reporter citation like “347 U.S. 483” to the case record.'],
    ['/statutes', 'Statutes & Code', 'Parse a U.S.C. citation (“18 U.S.C. § 2261A”) to its official text, or search the Code of Federal Regulations.'],
    ['/regulations', 'Regulations', 'Recent rules, proposed rules, and notices from the Federal Register, by agency.'],
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
    <div class=grid style="margin-top:18px">
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('')}
    </div>
    <div class=card style="margin-top:18px"><h2>How this connects</h2>
      <p class=muted style="font-size:14px">Case files and judges are linked: a case record links the judge who can be looked up here,
      and a judge profile links straight to a search of the opinions they authored. The whole surface is jurisdiction-namespaced —
      the United States is jurisdiction #1, and paths can later take a <code>/us/…</code> prefix as other jurisdictions are added.</p></div>`;
  return page('SoapBox Law — caselaw, statutes, regulations, judges', body, { canonical: `${BASE_URL}/` });
}

// ── /cases — CourtListener opinion search + CAP citation lookup ──────────────────────────────────
// A reporter citation in the box (e.g. "347 U.S. 483") triggers the CAP citation resolver; anything
// else runs a CourtListener opinion search. Both soft-fail to an empty-state card.
function caseRow(c) {
  // cross-link: a case page links a judge-profile search (the operator's case-files ↔ judges connection).
  const judgeLink = `<a href="/judges?q=${q((c.caseName || '').replace(/\s+v\.?\s+.*/i, '').trim() || c.caseName || '')}">find the judge →</a>`;
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
    <div class=xlink>${detailHref ? `<a href="${esc(detailHref)}">read the full opinion</a> · ` : ''}${c.url ? `<a href="${esc(c.url)}">at the source</a> · ` : ''}${judgeLink}</div>
  </div>`;
}

// A reporter citation looks like "<vol> <Reporter…> <page>" — reuse CAP's parser to decide the path.
function looksLikeCitation(s) {
  return !!cap.parseCitation(s);
}

export async function casesView(query) {
  const term = String(query == null ? '' : query).trim();
  const form = searchForm('/cases', { value: term, placeholder: 'Case name, topic, or “347 U.S. 483”…', label: 'Search cases' });
  let results = '';
  if (term) {
    if (looksLikeCitation(term)) {
      // citation path: resolve via the Caselaw Access Project.
      const c = await cap.caseByCitation(term).catch(() => null);
      results = c
        ? `<div class=card><h2>Citation: ${esc(cap.parseCitation(term).normalized)}</h2>${caseRow(c)}</div>`
        : `<div class=card><h2>Citation: ${esc(cap.parseCitation(term).normalized)}</h2>
            <p class=empty>No case found for that citation right now. The Caselaw Access Project (Harvard LIL) is the source of record —
            <a href="${esc(cap.citationUrl(cap.parseCitation(term)))}">look it up there →</a></p></div>`;
    } else {
      // free-text path: CourtListener opinion search.
      const rows = await opinions.searchCases({ q: term, limit: 20 }).catch(() => []);
      results = rows.length
        ? `<div class=card><h2>${rows.length} opinion${rows.length === 1 ? '' : 's'} for “${esc(term)}”</h2>${rows.map(caseRow).join('')}</div>`
        : `<div class=card><h2>Cases for “${esc(term)}”</h2><p class=empty>No opinions found. Try a different term, a party name, or a reporter citation like “347 U.S. 483”.</p></div>`;
    }
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
  const body = `<h1>${esc(rec.caseName || 'Opinion')} <span class=muted style="font-size:14px">· public record</span></h1>
    ${back}
    <div class=card>
      <div class=meta>${meta || '—'}</div>
      ${sourceUrl ? `<div class=xlink style="margin-top:6px"><a href="${esc(sourceUrl)}">source: ${esc(sourceLabel)} →</a></div>` : ''}
      ${text
        ? `<h2 style="margin-top:14px">The court's words</h2>${opinionArticle(text)}`
        : `<p class=empty style="margin-top:12px">The opinion text isn't available from the source right now. ${sourceUrl ? `<a href="${esc(sourceUrl)}">Read it at the source →</a>` : ''}</p>`}
      <p class=muted style="font-size:12px;margin-top:12px">This is the court's own public-domain opinion text, reproduced verbatim and attributed to ${esc(sourceLabel || 'the source of record')}. We surface the source's words — we add no holding-summary, headnote, or verdict.</p>
    </div>`;
  return body;
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
    ${form}${results}`;
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

const SITEMAP_PATHS = ['/', '/cases', '/statutes', '/regulations', '/judges', '/lawyers', '/complaints'];

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
      return res.end(llmsTxt({
        name: 'SoapBox Law', baseUrl: BASE_URL,
        summary: 'Caselaw, statutes, regulations, judges, and lawyers — official-source US legal data.',
        links: [
          { label: 'Caselaw', path: '/cases' },
          { label: 'Statutes (US Code)', path: '/statutes' },
          { label: 'Regulations (CFR)', path: '/regulations' },
          { label: 'Judges', path: '/judges' },
          { label: 'Lawyers', path: '/lawyers' },
          { label: 'File a complaint', path: '/complaints' },
        ],
      }));
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
      return sendHtml(res, page('Cases — SoapBox Law', await casesView(sp.get('q') || ''),
        { canonical: `${BASE_URL}/cases`, robots: sp.get('q') ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/statutes') {
      return sendHtml(res, page('Statutes & Code — SoapBox Law', await statutesView(sp.get('q') || ''),
        { canonical: `${BASE_URL}/statutes`, robots: sp.get('q') ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/regulations') {
      return sendHtml(res, page('Regulations — SoapBox Law', await regulationsView(sp.get('agency') || ''),
        { canonical: `${BASE_URL}/regulations` }));
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

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Exported for tests / extension wiring.
export { homePage, splitJurisdiction, publicInterestData, looksLikeCitation, FR_AGENCIES, JURISDICTIONS };

// Only bind the port when run directly (`node site/law/server.mjs`), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/law\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Law on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
