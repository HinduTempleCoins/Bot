// server.mjs — Free Speech & Sedition. A self-contained, read-only legal-education surface in the
// SoapBox house style (operator brief 2026-09-22). It teaches the First Amendment law of speech and the
// law of sedition — the incitement test, protected vs. unprotected categories, seditious conspiracy, and
// how surveillance chills lawful speech — from cited, verified authority. Facts and citation only:
// descriptive, never advocacy; two-voice on contested political matter.
//
//   PORT=8110 BASE_URL=https://free-speech.soapbox.community node site/free-speech/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                 overview + section cards + FAQ
//   /first-amendment  core doctrine: Schenck→Brandenburg incitement test; protected vs. unprotected; symbolic speech
//   /sedition         sedition acts, the Smith Act, and seditious conspiracy (18 U.S.C. § 2384) + the Jan-6 use
//   /surveillance     COINTELPRO, FISA, Snowden/NSA, the panopticon — surveillance & the chilling effect
//   /rights           know your rights: protest, dissent, and the line the law draws
//   /health /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   Every case/statute/year is stated as public record with a source link — never our verdict on whether
//   a decision is right or currently good law. Contested political questions are stated in two voices, not
//   adjudicated (a free-speech-aware editorial stance). Educational only — not legal advice. Soft-fail:
//   every route renders an empty-state if the data file is missing/short; the page never throws or 500s.
//   Read-only. No keys, no custody, no network fetch (the corpus is a local, public-domain JSON file).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8110);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LAW = (process.env.LAW_SITE || 'https://law.soapbox.community').replace(/\/$/, '');
const WIKI = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, '');
const DATA_SITE = (process.env.SOAPBOX_SITE || 'https://data.soapbox.community').replace(/\/$/, '');

// ── house-style escape (same table the other SoapBox servers use) ─────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

// ── data seam ─────────────────────────────────────────────────────────────────────────────────────
// The corpus is a local public-domain JSON file. loadData() soft-fails to {} so a missing/short file
// yields empty-state pages, never a throw. Tests inject via __setData() (no network is ever touched).
const DATA_PATH = fileURLToPath(new URL('../../knowledge/civic/free-speech.json', import.meta.url));
let _dataOverride = null;
export function __setData(obj) { _dataOverride = obj || null; }
export function loadData() {
  if (_dataOverride) return _dataOverride;
  try { const j = JSON.parse(readFileSync(DATA_PATH, 'utf8')); return j && typeof j === 'object' ? j : {}; }
  catch { return {}; }
}

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .cite{color:var(--gold);font-weight:600} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .rec .hold{font-size:14px;margin:6px 0 4px;line-height:1.6} .rec .note{color:var(--mut);font-size:13px;margin-top:4px}
  .rec .xlink{font-size:13px;margin-top:4px}
  blockquote{border-left:3px solid var(--gold);margin:8px 0;padding:2px 0 2px 12px;color:var(--fg);font-size:14px;font-style:italic}
  .testbox{border:1px solid var(--gold);border-radius:10px;padding:16px 18px;margin:14px 0;background:#d2992212}
  .testbox h2{color:var(--gold)} .testbox ol{margin:8px 0 8px 20px;padding:0} .testbox li{margin:4px 0}
  .prongs{list-style:decimal;margin:8px 0 8px 22px} .prongs li{margin:5px 0;font-weight:600}
  .twovoice{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:10px 0}
  .voice{border:1px solid var(--line2);border-radius:8px;padding:12px 14px;background:#0b0f14}
  .voice.protected{border-color:var(--up)} .voice.criminal{border-color:var(--down)}
  .voice .vlbl{font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .voice.protected .vlbl{color:var(--up)} .voice.criminal .vlbl{color:var(--down)}
  .cat{padding:12px 0;border-bottom:1px solid var(--line)} .cat:last-child{border-bottom:0}
  .cat .ct{font-weight:700;font-size:15px} .cat .cbadge{font-size:11px;border-radius:8px;padding:1px 7px;margin-left:6px;background:#f8514933;color:var(--down)}
  .cat .ccase{color:var(--gold);font-size:13px;margin:2px 0} .cat .cx{font-size:14px;line-height:1.6}
  .note-callout{border:1px solid var(--line2);border-left:3px solid var(--blue);border-radius:8px;padding:12px 14px;margin:12px 0;font-size:14px;background:#1f6feb12}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
  .empty{color:var(--mut);padding:14px 0}
</style>`;

const FOOTER = `<footer>
  <b>Educational legal information, not legal advice.</b> Every case, statute and year here is stated as
  public record from the reporters and the U.S. Code, with a source link — never our verdict on whether a
  decision is correct or currently good law. On contested political questions we state the competing
  positions and the controlling law and do not adjudicate. For advice about your situation, consult a
  licensed attorney.
  <div style="margin-top:8px"><a href="/">Free Speech &amp; Sedition</a> · <a href="${LAW}">Law</a> · <a href="${LAW}/rights">Your rights</a> · <a href="${WIKI}">Library</a> · <a href="${DATA_SITE}">Data</a></div>
</footer>`;

// ── page shell — shared SEO <head> (Org + WebSite + optional breadcrumb/FAQ/citation JSON-LD) ──────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Free Speech & Sedition — the First Amendment law of speech and the law of sedition: the incitement test, protected vs. unprotected speech, seditious conspiracy, and surveillance chilling effects. Cited authority, descriptive not advocacy.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';

  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: 'SoapBox — Free Speech & Sedition', ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  if (opts.jsonld) for (const j of [].concat(opts.jsonld)) if (j) extra.push(j);

  const seoHead = seoHeadTags({
    title, description: desc, canonical, robots, siteName: 'SoapBox — Free Speech & Sedition',
    site: { url: BASE_URL, name: 'SoapBox — Free Speech & Sedition' },
    jsonld: extra,
  });

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">§ Free Speech <span>&amp; Sedition</span></a>
  <div class=topbar-r><a href="/first-amendment">First Amendment</a><a href="/sedition">Sedition</a><a href="/surveillance">Surveillance</a><a href="/rights">Know your rights</a><a href="${LAW}">Law</a><a href="${WIKI}">Library</a></div></header>
<main class=wrap>${body}${citeHtml}</main>
${FOOTER}</body></html>`;
}

// BreadcrumbList trail helper.
const crumbs = (name, path) => [
  { name: 'Free Speech & Sedition', url: `${BASE_URL}/` },
  { name, url: `${BASE_URL}${path}` },
];

// ── render helpers ────────────────────────────────────────────────────────────────────────────────
function caseCard(c) {
  if (!c || typeof c !== 'object') return '';
  const meta = [c.court, c.year].filter(Boolean).map(esc).join(' · ');
  return `<div class=rec>
    <div class=nm>${esc(c.name || 'Case')}${c.citation ? `, <span class=cite>${esc(c.citation)}</span>` : ''}</div>
    ${meta ? `<div class=meta>${meta}</div>` : ''}
    ${c.holding ? `<p class=hold>${esc(c.holding)}</p>` : ''}
    ${c.quote ? `<blockquote>${esc(c.quote)}</blockquote>` : ''}
    ${c.what ? `<p class=hold>${esc(c.what)}</p>` : ''}
    ${c.status ? `<div class=note><b>Status:</b> ${esc(c.status)}</div>` : ''}
    ${c.note ? `<div class=note>${esc(c.note)}</div>` : ''}
    ${c.source ? `<div class=xlink><a href="${esc(c.source)}" rel=noopener>source →</a></div>` : ''}
  </div>`;
}

// A visible FAQ card whose Q&A exactly match the faq[] passed to page() (→ FAQPage JSON-LD).
function faqCard(pairs, heading = 'Frequently asked questions') {
  const items = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.q && p.a);
  if (!items.length) return '';
  return `<div class=card style="margin-top:18px"><h2>${esc(heading)}</h2>${items.map((p) =>
    `<details style="margin:0 0 8px;border:1px solid var(--line2);border-radius:8px">`
    + `<summary style="cursor:pointer;padding:12px 14px;font-weight:700">${esc(p.q)}</summary>`
    + `<div style="padding:0 14px 12px"><p class=muted style="margin:0">${esc(p.a)}</p></div></details>`).join('')}</div>`;
}

// ── FAQ (visible AND emitted as FAQPage JSON-LD — the pairs match) ─────────────────────────────────
const HOME_FAQ = [
  { q: 'What is the test for illegal incitement?',
    a: 'Under Brandenburg v. Ohio, 395 U.S. 444 (1969), advocacy of force or law-breaking is protected '
     + 'UNLESS it is (1) directed to inciting or producing imminent lawless action AND (2) likely to '
     + 'incite or produce such action. Both prongs must be met. Abstract advocacy of illegality or '
     + 'violence — even calling for revolution — is protected speech.' },
  { q: 'Is hate speech protected by the First Amendment?',
    a: 'In the United States, yes. There is no "hate speech" exception. Offensive, bigoted, and hateful '
     + 'speech is generally protected (see Snyder v. Phelps, 562 U.S. 443 (2011); Texas v. Johnson, 491 '
     + 'U.S. 397 (1989)). The narrow exceptions are incitement, true threats, fighting words, obscenity, '
     + 'and defamation — not offensiveness itself.' },
  { q: 'What is the difference between protected dissent and seditious conspiracy?',
    a: 'Dissent, criticism, and even abstract advocacy of overthrowing the government are protected '
     + 'speech. Seditious conspiracy (18 U.S.C. § 2384) is an agreement between two or more people to use '
     + 'FORCE against the government — to overthrow it, oppose its authority by force, or by force prevent '
     + 'the execution of the law. The crime is the agreement to use force, not the opinion.' },
  { q: 'Does the government need to prosecute you to violate free speech?',
    a: 'No. Surveillance that deters lawful speech and association is a First Amendment harm in its own '
     + 'right — courts call it the "chilling effect." The documented history of COINTELPRO, FISA, and the '
     + '2013 Snowden disclosures shows speech can be suppressed by being watched, without a single charge.' },
];

// ── / home ──────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const d = loadData();
  const meta = d.meta || {};
  const sections = [
    ['/first-amendment', 'First Amendment core doctrine', 'The incitement test from Schenck (1919) to Brandenburg (1969); protected vs. unprotected speech (true threats, fighting words, obscenity, defamation); symbolic speech and flag burning.'],
    ['/sedition', 'Sedition & seditious conspiracy', 'The Alien & Sedition Acts, the Espionage/Sedition Acts, the Smith Act, and modern seditious conspiracy (18 U.S.C. § 2384) — including the January 6 prosecutions and the line between dissent and force.'],
    ['/surveillance', 'Surveillance & chilling effects', 'COINTELPRO, FISA, the Snowden/NSA disclosures, and the panopticon frame — how surveillance chills lawful speech, with the real legal history.'],
    ['/rights', 'Know your rights', 'Protest, dissent, and the line the law draws — a plain-language guide to what the First Amendment protects and what it does not.'],
  ];
  const body = `<h1>Free Speech &amp; Sedition <span class=muted style="font-size:14px">· the law of speech and dissent</span></h1>
    <p class=muted>${esc(meta.summary || 'The First Amendment law of speech and the law of sedition, taught from cited, verified authority. Descriptive, not advocacy.')}</p>
    <div class=grid style="margin-top:16px">
      ${sections.map(([href, t, dd]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(dd)}</div></a>`).join('')}
    </div>
    <div class=note-callout style="margin-top:18px"><b>How we handle contested speech.</b> ${esc(meta.twoVoiceNote || 'On genuinely contested political matters this surface states the competing positions and the controlling law, and does not tell you which side is right — a two-voice discipline that is itself a free-speech-aware editorial stance.')}</div>
    <div class=card style="margin-top:6px"><h2>Cross-reference</h2>
      <p class=muted style="font-size:14px">The sovereign-citizen / pseudolaw teaching on the Law surface (<a href="${LAW}/rights" rel=noopener>Rights That Hold Up in Court →</a>) covers the mirror-image error to the sedition line: treating a legal theory or declaration as a shield, or treating protected advocacy as if it were already a crime.</p></div>
    ${faqCard(HOME_FAQ)}`;
  return page('Free Speech & Sedition — the law of speech and dissent', body, {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: 'Free Speech & Sedition', url: `${BASE_URL}/` }],
    faq: HOME_FAQ,
  });
}

// ── /first-amendment ──────────────────────────────────────────────────────────────────────────────
export function firstAmendmentView() {
  const d = loadData();
  const inc = d.incitement || {};
  const adv = d.advocacy || {};
  const tt = d.trueThreats || {};
  const cats = d.categories || {};
  const sym = d.symbolic || {};
  const st = d.stateSpeech || {};
  const test = inc.governingTest || {};

  const incCases = Array.isArray(inc.cases) ? inc.cases : [];
  const evolution = incCases.length
    ? `<div class=card><h2>The evolution: Schenck (1919) → Brandenburg (1969)</h2>
        ${inc.intro ? `<p>${esc(inc.intro)}</p>` : ''}
        ${incCases.map(caseCard).join('')}</div>`
    : '';

  const testBox = test.name
    ? `<div class=testbox><h2>${esc(test.name)}</h2>
        ${test.case ? `<div class=meta style="color:var(--gold);font-weight:600;margin-bottom:6px">${esc(test.case)}</div>` : ''}
        ${test.plain ? `<p>${esc(test.plain)}</p>` : ''}
        ${Array.isArray(test.prongs) && test.prongs.length ? `<ol class=prongs>${test.prongs.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
        ${test.quote ? `<blockquote>${esc(test.quote)}</blockquote>` : ''}
        ${test.commonMistake ? `<div class=note-callout style="margin-top:10px"><b>Common mistake:</b> ${esc(test.commonMistake)}</div>` : ''}</div>`
    : '';

  const catItems = Array.isArray(cats.items) ? cats.items : [];
  const catBox = catItems.length
    ? `<div class=card><h2>${esc(cats.heading || 'Protected vs. unprotected speech')}</h2>
        ${cats.intro ? `<p>${esc(cats.intro)}</p>` : ''}
        ${catItems.map((c) => `<div class=cat>
          <div class=ct>${esc(c.label)}${c.protected === false ? '<span class=cbadge>unprotected</span>' : ''}</div>
          ${c.case ? `<div class=ccase>${esc(c.case)}${c.test ? ` — <span class=muted>${esc(c.test)}</span>` : ''}</div>` : ''}
          <div class=cx>${esc(c.explain || '')}</div>
          ${c.source ? `<div class=xlink><a href="${esc(c.source)}" rel=noopener>source →</a></div>` : ''}
        </div>`).join('')}
        ${cats.protectedNote ? `<div class=note-callout style="margin-top:12px"><b>Generally protected (not on the list above):</b> ${esc(cats.protectedNote)}</div>` : ''}</div>`
    : '';

  const advCases = Array.isArray(adv.cases) ? adv.cases : [];
  const advBox = advCases.length
    ? `<div class=card><h2>${esc(adv.heading || 'Advocacy and association')}</h2>
        ${adv.intro ? `<p>${esc(adv.intro)}</p>` : ''}
        ${advCases.map(caseCard).join('')}</div>`
    : '';

  const ttCases = Array.isArray(tt.cases) ? tt.cases : [];
  const ttBox = ttCases.length
    ? `<div class=card><h2>${esc(tt.heading || 'True threats')}</h2>
        ${tt.intro ? `<p>${esc(tt.intro)}</p>` : ''}
        ${ttCases.map(caseCard).join('')}</div>`
    : '';

  const symCases = Array.isArray(sym.cases) ? sym.cases : [];
  const symBox = symCases.length
    ? `<div class=card><h2>${esc(sym.heading || 'Symbolic speech and speech we hate')}</h2>
        ${sym.intro ? `<p>${esc(sym.intro)}</p>` : ''}
        ${symCases.map(caseCard).join('')}</div>`
    : '';

  const stProv = Array.isArray(st.provisions) ? st.provisions : [];
  const stBox = stProv.length
    ? `<div class=card><h2>${esc(st.heading || 'State speech guarantees')}</h2>
        ${st.intro ? `<p>${esc(st.intro)}</p>` : ''}
        ${stProv.map(caseCard).join('')}</div>`
    : '';

  const inner = [evolution, testBox, advBox, ttBox, catBox, symBox, stBox].filter(Boolean).join('');
  return `<h1>First Amendment core doctrine</h1>
    <p class=muted>How the law decides which speech the government may punish. The default is protection;
      the exceptions are narrow and each is defined by a case. The crux is the incitement test —
      <b>Brandenburg</b>'s "imminent lawless action."</p>
    ${inner || '<div class=card><p class=empty>The doctrine corpus is unavailable right now.</p></div>'}`;
}

// ── /sedition ─────────────────────────────────────────────────────────────────────────────────────
export function seditionView() {
  const d = loadData();
  const s = d.sedition || {};
  const line = s.line || {};
  const statutes = Array.isArray(s.statutes) ? s.statutes : [];
  const sc = s.seditiousConspiracy || {};
  const ror = s.rightOfRevolution || {};

  const lineBox = (line.protected || line.criminal)
    ? `<div class=card><h2>${esc(line.heading || 'Protected dissent vs. criminal conspiracy')}</h2>
        <div class=twovoice>
          <div class="voice protected"><div class=vlbl>Protected advocacy / dissent</div><div>${esc(line.protected || '')}</div></div>
          <div class="voice criminal"><div class=vlbl>Criminal conspiracy (force)</div><div>${esc(line.criminal || '')}</div></div>
        </div>
        ${line.crossref ? `<p class=muted style="font-size:14px">${esc(line.crossref)} <a href="${LAW}/rights" rel=noopener>See the Law surface →</a></p>` : ''}</div>`
    : '';

  const statuteBox = statutes.length
    ? `<div class=card><h2>The sedition statutes, in order</h2>${statutes.map(caseCard).join('')}</div>`
    : '';

  const scCases = Array.isArray(sc.cases) ? sc.cases : [];
  const scBox = sc.heading
    ? `<div class=card><h2>${esc(sc.heading)}</h2>
        ${sc.intro ? `<p>${esc(sc.intro)}</p>` : ''}
        ${scCases.map((c) => `<div class=rec>
          <div class=nm>${esc(c.group || '')}</div>
          <div class=hold style="font-size:14px;margin:6px 0 4px">${esc(c.detail || '')}</div>
          ${c.source ? `<div class=xlink><a href="${esc(c.source)}" rel=noopener>source →</a></div>` : ''}
        </div>`).join('')}
        ${sc.teaching ? `<div class=note-callout style="margin-top:12px"><b>The line, not the politics:</b> ${esc(sc.teaching)}</div>` : ''}</div>`
    : '';

  const rorTexts = Array.isArray(ror.texts) ? ror.texts : [];
  const rorBox = ror.heading
    ? `<div class=card><h2>${esc(ror.heading)}</h2>
        ${ror.intro ? `<p>${esc(ror.intro)}</p>` : ''}
        ${rorTexts.map(caseCard).join('')}
        ${ror.line ? `<div class=note-callout style="margin-top:12px"><b>The line:</b> ${esc(ror.line)}</div>` : ''}</div>`
    : '';

  const inner = [lineBox, statuteBox, scBox, rorBox].filter(Boolean).join('');
  return `<h1>Sedition &amp; seditious conspiracy</h1>
    <p class=muted>${esc(s.intro || 'The United States has a long, cautionary history of sedition laws used to punish dissent — and a modern statute, seditious conspiracy, that punishes an agreement to use force against the government. The crucial thing to understand is the line between the two.')}</p>
    ${inner || '<div class=card><p class=empty>The sedition corpus is unavailable right now.</p></div>'}`;
}

// ── /surveillance ─────────────────────────────────────────────────────────────────────────────────
export function surveillanceView() {
  const d = loadData();
  const s = d.surveillance || {};
  const chill = s.chillingDoctrine || {};
  const items = Array.isArray(s.items) ? s.items : [];

  const chillBox = chill.text
    ? `<div class=card><h2>${esc(chill.heading || 'The "chilling effect" as a legal concept')}</h2>
        <p>${esc(chill.text)}</p>
        ${chill.source ? `<div class=xlink><a href="${esc(chill.source)}" rel=noopener>source →</a></div>` : ''}</div>`
    : '';

  const itemBox = items.length
    ? items.map((it) => `<div class=card><h2>${esc(it.label || '')}${it.period ? ` <span class=muted style="font-size:13px">· ${esc(it.period)}</span>` : ''}</h2>
        ${it.what ? `<p>${esc(it.what)}</p>` : ''}
        ${it.legalLegacy ? `<p><b>Legal legacy.</b> ${esc(it.legalLegacy)}</p>` : ''}
        ${it.freeSpeechPoint ? `<div class=note-callout><b>Why it is a speech harm:</b> ${esc(it.freeSpeechPoint)}</div>` : ''}
        ${it.source ? `<div class=xlink><a href="${esc(it.source)}" rel=noopener>source →</a></div>` : ''}</div>`).join('')
    : '';

  const inner = [chillBox, itemBox].filter(Boolean).join('');
  return `<h1>Surveillance &amp; chilling effects</h1>
    <p class=muted>${esc(s.intro || 'Free speech can be suppressed without a single prosecution. When people fear the state is watching who they associate with and what they say, they self-censor. Courts call this the "chilling effect" — a First Amendment harm in its own right.')}</p>
    ${inner || '<div class=card><p class=empty>The surveillance corpus is unavailable right now.</p></div>'}`;
}

// ── /rights ───────────────────────────────────────────────────────────────────────────────────────
export function rightsView() {
  const d = loadData();
  const r = d.knowYourRights || {};
  const points = Array.isArray(r.points) ? r.points : [];
  const box = points.length
    ? `<div class=card>${points.map((p) => `<div class=rec>
        <div class=nm>${esc(p.t || '')}</div>
        <div class=hold style="font-size:14px;margin-top:6px">${esc(p.d || '')}</div>
      </div>`).join('')}</div>`
    : '';
  return `<h1>${esc(r.heading || 'Know your rights: protest, dissent, and the line the law draws')}</h1>
    <p class=muted>${esc(r.intro || 'This is educational information, not legal advice, and rights at a protest depend heavily on where you are and the facts.')}</p>
    ${box || '<div class=card><p class=empty>The rights corpus is unavailable right now.</p></div>'}
    ${r.disclaimer ? `<div class=note-callout><b>Note.</b> ${esc(r.disclaimer)}</div>` : ''}`;
}

const RIGHTS_FAQ = [
  { q: 'Can I be arrested for what my protest sign says?',
    a: 'Not for the message itself. The government cannot ban a sign, chant, or symbol because it is '
     + 'offensive, hateful, or disagreeable (Texas v. Johnson; Snyder v. Phelps). You can be arrested for '
     + 'independent conduct — trespass, violence, blocking traffic without a permit — but not for the '
     + 'protected expression.' },
  { q: 'Is there a right to record the police?',
    a: 'Most federal appellate courts to reach the question have recognized a First Amendment right to '
     + 'record police performing their duties in public, subject to reasonable time/place/manner limits. '
     + 'It is circuit-dependent and still developing — not uniform nationwide.' },
];

// ── /llms.txt ─────────────────────────────────────────────────────────────────────────────────────
export function freeSpeechLlmsTxt() {
  const base = llmsTxt({
    name: 'SoapBox — Free Speech & Sedition', baseUrl: BASE_URL,
    summary: 'A legal-education surface on the First Amendment law of speech and the law of sedition — the '
      + 'incitement test, protected vs. unprotected speech, seditious conspiracy, and surveillance chilling '
      + 'effects. Every case, statute and year is cited to a source. Descriptive, not advocacy.',
    links: [
      { label: 'First Amendment core doctrine', path: '/first-amendment', note: 'Schenck→Brandenburg incitement test; protected vs. unprotected; symbolic speech' },
      { label: 'Sedition & seditious conspiracy', path: '/sedition', note: 'Alien & Sedition Acts, Smith Act, 18 U.S.C. § 2384, and the Jan-6 prosecutions' },
      { label: 'Surveillance & chilling effects', path: '/surveillance', note: 'COINTELPRO, FISA, Snowden/NSA, the panopticon frame' },
      { label: 'Know your rights', path: '/rights', note: 'protest, dissent, and the line the law draws' },
    ],
  });
  const extra = [
    '## About this corpus',
    'This is a reference surface for the U.S. constitutional law of speech and the law of sedition. Each '
      + 'record states a case, statute, or documented historical program with its citation and a source '
      + 'link — never a verdict on whether a decision is right or currently good law. Contested political '
      + 'questions are stated in two voices, not adjudicated. Educational only; not legal advice.',
    '',
    '## The governing incitement rule (state it correctly)',
    'Brandenburg v. Ohio, 395 U.S. 444 (1969): advocacy of force or law violation is protected UNLESS it '
      + 'is (1) directed to inciting or producing IMMINENT lawless action AND (2) likely to incite or '
      + 'produce such action. Both prongs are required. Abstract advocacy is protected.',
    '',
    '## How to cite',
    `Attribute general pages as: SoapBox — Free Speech & Sedition, ${BASE_URL} . For legal authority, cite `
      + 'the reporter citation or U.S.C. section named on the page (e.g. Brandenburg v. Ohio, 395 U.S. 444 '
      + '(1969); 18 U.S.C. § 2384).',
    '',
    '## Usage',
    'All crawlers, including AI/LLM crawlers, are welcome (see /robots.txt). This is public-interest legal '
      + 'education intended to be ingested, quoted, and cited.',
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/first-amendment', '/sedition', '/surveillance', '/rights'];

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
        path: u, lastmod: today, changefreq: u === '/' ? 'weekly' : 'monthly', priority: u === '/' ? '1.0' : '0.8',
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
      return res.end(freeSpeechLlmsTxt());
    }

    if (raw === '/') return sendHtml(res, homePage());

    if (raw === '/first-amendment') {
      return sendHtml(res, page('First Amendment core doctrine — Free Speech & Sedition', firstAmendmentView(), {
        canonical: `${BASE_URL}/first-amendment`, breadcrumb: crumbs('First Amendment', '/first-amendment'),
        cite: { title: 'First Amendment core doctrine', url: `${BASE_URL}/first-amendment`, author: 'SoapBox — Free Speech & Sedition',
          sourceOfRecord: 'U.S. Constitution and controlling U.S. Supreme Court precedent' } }));
    }
    if (raw === '/sedition') {
      return sendHtml(res, page('Sedition & seditious conspiracy — Free Speech & Sedition', seditionView(), {
        canonical: `${BASE_URL}/sedition`, breadcrumb: crumbs('Sedition', '/sedition'),
        cite: { title: 'Sedition & seditious conspiracy', url: `${BASE_URL}/sedition`, author: 'SoapBox — Free Speech & Sedition',
          sourceOfRecord: '18 U.S.C. § 2384 and the U.S. Statutes at Large' } }));
    }
    if (raw === '/surveillance') {
      return sendHtml(res, page('Surveillance & chilling effects — Free Speech & Sedition', surveillanceView(), {
        canonical: `${BASE_URL}/surveillance`, breadcrumb: crumbs('Surveillance', '/surveillance'),
        cite: { title: 'Surveillance & chilling effects', url: `${BASE_URL}/surveillance`, author: 'SoapBox — Free Speech & Sedition',
          sourceOfRecord: 'the Church Committee Final Report (1976), FISA (50 U.S.C. ch. 36), and controlling precedent' } }));
    }
    if (raw === '/rights') {
      return sendHtml(res, page('Know your rights — Free Speech & Sedition', rightsView(), {
        canonical: `${BASE_URL}/rights`, breadcrumb: crumbs('Know your rights', '/rights'),
        faq: RIGHTS_FAQ,
        cite: { title: 'Know your rights: protest, dissent, and the line the law draws', url: `${BASE_URL}/rights`, author: 'SoapBox — Free Speech & Sedition',
          sourceOfRecord: 'U.S. Constitution and controlling U.S. Supreme Court precedent' } }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /free-speech\/server\.mjs$/.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Free Speech & Sedition on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
