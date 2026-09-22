// server.mjs — Lexicon.MELEK: the Legal Lexicon & Sources of Authority vertical.
//
// A free legal-EDUCATION surface and part of the pro-se teaching mission. It answers a specific,
// recurring confusion: people (often in the sovereign-citizen orbit) treat Black's Law Dictionary as
// if a dictionary were binding law. It is not. A dictionary is persuasive reference; it describes how a
// word is used — it does not create a right, or override a statute or a court's holding. This surface
// teaches that distinction accurately and completely, and offers better tools: an American legal
// lexicon of our own, a founding-era-meaning lens for constitutional interpretation, and a directory of
// real, reputable legal dictionaries (including per-country glossaries).
//
//   PORT=8110 BASE_URL=https://lexicon.melek.salon node site/lexicon/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  home — the thesis + section cards + FAQ
//   /dictionaries      legal dictionaries: what they are and aren't (Black's, Bouvier's, Johnson's)
//   /founding-era      founding-era dictionaries & original public meaning (constitutional interpretation)
//   /common-law        American common law vs British common law (Erie; federal-common-law enclaves; NFIB)
//   /persuasive        persuasive British case law still cited in U.S. courts (M'Naghten; binding vs persuasive)
//   /reception         pre-Revolution British + earliest American case law (De Longchamps; reception of English law)
//   /federalist        The Federalist & Anti-Federalist Papers as near-law persuasive authority
//   /sovereign-citizen how Black's Law is misused — and the correct use (respectful, factual)
//   /glossary          our own American legal dictionary (browse · ?q= search · ?term= detail)
//   /directory         a directory of real legal dictionaries + per-country glossaries (verified links)
//   /health            liveness probe
//   /robots.txt /sitemap.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   Accuracy is the whole product. Every case name, year, reporter citation, dictionary edition and
//   doctrine on this surface is real and verified. Facts and sources, not legal advice: education and
//   reference are in scope; individualized legal advice is not. Soft-fail: every route renders even if
//   the lexicon data is unavailable — the page never throws.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8110);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LAW = (process.env.LAW_SITE || 'https://law.soapbox.community').replace(/\/$/, '');
const WIKI = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, '');

const HERE = dirname(fileURLToPath(import.meta.url));

// ── shared house-style helpers ────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));
const slugify = (s) => String(s == null ? '' : s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── lexicon corpus (knowledge/legal/lexicon.json) — loaded once, soft-fails to empty ───────────────
function loadLexicon() {
  try {
    const raw = readFileSync(join(HERE, '..', '..', 'knowledge', 'legal', 'lexicon.json'), 'utf8');
    const j = JSON.parse(raw);
    const terms = Array.isArray(j.terms) ? j.terms.filter((t) => t && t.term) : [];
    return { meta: j.meta || {}, terms };
  } catch { return { meta: {}, terms: [] }; }
}
export const LEXICON = loadLexicon();

// ── the dictionary directory (VERIFIED real, reputable sources) ────────────────────────────────────
// Each entry names a real dictionary/glossary and links a real hosted copy or the official publisher.
// Public-domain works link a hosted full-text copy; in-copyright works link the publisher / an
// authoritative reference. Per-country glossaries link an official government or flagship-reputable body.
export const DICTIONARIES = [
  {
    name: "Black's Law Dictionary",
    est: 'First ed. 1891 (Henry Campbell Black); current 12th ed. 2024 (ed. Bryan A. Garner, Thomson Reuters)',
    what: 'The most-cited American legal dictionary. Useful, authoritative as reference — but still a dictionary, not law. Early editions (1891, 1910) are now public domain; current editions are in copyright.',
    tags: ['American', 'reference'],
    links: [
      { label: 'History & editions (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Black%27s_Law_Dictionary' },
      { label: 'Current edition (Thomson Reuters)', url: 'https://legal.thomsonreuters.com/en/products/law-books/blacks-law-dictionary' },
    ],
  },
  {
    name: "Bouvier's Law Dictionary",
    est: 'First ed. 1839 (John Bouvier, 1787–1851)',
    what: 'The first great AMERICAN law dictionary — written specifically for "the Constitution and Laws of the United States of America," not English law. Public domain. Especially valuable for 19th-century American usage.',
    tags: ['American', 'public domain', 'founding-adjacent'],
    links: [
      { label: 'Full text — 1839 first edition (Internet Archive)', url: 'https://archive.org/details/bouvierlawdictionary01' },
    ],
  },
  {
    name: "A Dictionary of the English Language (Samuel Johnson)",
    est: 'Published 15 April 1755 (Samuel Johnson, 1709–1784)',
    what: 'Not a law dictionary, but the landmark English dictionary of the era — a primary source for the ORDINARY meaning of words at the time of the Founding. Public domain. Cited by the Supreme Court for founding-era meaning.',
    tags: ['English', 'public domain', 'founding-era'],
    links: [
      { label: 'Full text — 1755 (Internet Archive)', url: 'https://archive.org/details/johnsons_dictionary_1755' },
      { label: 'Searchable edition (Johnson’s Dictionary Online)', url: 'https://johnsonsdictionaryonline.com/' },
    ],
  },
];

// Per-country legal dictionaries / glossaries. `body` names the publisher; `official` marks a
// government/court source. Operator direction: "make and link them for different countries."
export const COUNTRY_GLOSSARIES = [
  {
    country: 'United States', flag: '\u{1F1FA}\u{1F1F8}',
    entries: [
      { label: 'The American Legal Lexicon (this site)', body: 'MELEK / SoapBox', url: `${BASE_URL}/glossary`, official: false },
      { label: "Bouvier's Law Dictionary (1839)", body: 'John Bouvier — public domain', url: 'https://archive.org/details/bouvierlawdictionary01', official: false },
      { label: 'Wex legal dictionary & encyclopedia', body: 'Cornell Legal Information Institute', url: 'https://www.law.cornell.edu/wex', official: false },
    ],
  },
  {
    country: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}',
    entries: [
      { label: 'Glossary of legal terms', body: 'UK Ministry of Justice (Family Procedure Rules)', url: 'https://www.justice.gov.uk/courts/procedure-rules/family/backmatter/fpr_glossary', official: true },
      { label: 'Glossary of legal terms & phrases', body: 'The Inner Temple Library', url: 'https://www.innertemplelibrary.org.uk/research-and-training/glossary/', official: false },
    ],
  },
  {
    country: 'Canada', flag: '\u{1F1E8}\u{1F1E6}',
    entries: [
      { label: 'Glossary (Justice Laws Website)', body: 'Department of Justice Canada', url: 'https://laws-lois.justice.gc.ca/eng/glossary/', official: true },
    ],
  },
  {
    country: 'Australia', flag: '\u{1F1E6}\u{1F1FA}',
    entries: [
      { label: 'Glossary of legal terms', body: 'Federal Court of Australia', url: 'https://www.fedcourt.gov.au/digital-law-library/glossary-of-legal-terms', official: true },
      { label: 'AustLII — free case law & legislation', body: 'Australasian Legal Information Institute', url: 'https://www.austlii.edu.au/', official: false },
    ],
  },
  {
    country: 'India', flag: '\u{1F1EE}\u{1F1F3}',
    entries: [
      { label: 'Legal Glossary', body: 'Legislative Dept., Ministry of Law & Justice (GoI)', url: 'https://lddashboard.legislative.gov.in/legal-glossary', official: true },
      { label: 'Glossary of legal terms (plain language)', body: 'Nyaaya (legal-literacy initiative)', url: 'https://nyaaya.org/glossary/', official: false },
    ],
  },
  {
    country: 'European Union', flag: '\u{1F1EA}\u{1F1FA}',
    entries: [
      { label: 'Glossary of summaries', body: 'EUR-Lex (Publications Office of the EU)', url: 'https://eur-lex.europa.eu/summary/glossary.html', official: true },
      { label: 'Glossaries and translations', body: 'European e-Justice Portal', url: 'https://e-justice.europa.eu/topics/legislation-and-case-law/glossaries-and-translations_en', official: true },
    ],
  },
];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.65 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:13px;border:1px solid var(--line2);border-radius:8px;padding:6px 11px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px 16px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:22px 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.lex{margin:14px 0} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 320px;min-width:220px;max-width:520px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  p{margin:0 0 12px} ul{margin:8px 0;padding-left:20px} li{margin:5px 0}
  .lead{font-size:16px;color:var(--fg)}
  .teach p{max-width:74ch} .teach h2{border-bottom:1px solid var(--line);padding-bottom:6px}
  blockquote{border-left:3px solid var(--gold);margin:12px 0;padding:6px 0 6px 14px;color:var(--fg);background:#d2992212;border-radius:0 8px 8px 0}
  blockquote .src{display:block;color:var(--mut);font-size:12px;margin-top:6px}
  .cite{font-size:13px;color:var(--mut)} .cite b{color:var(--fg)}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
  .tag{display:inline-block;font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 8px;margin:0 4px 4px 0}
  .tag.pd{background:#3fb95033;color:var(--up)} .tag.off{background:#d2992233;color:var(--gold)}
  .term{padding:16px 0;border-bottom:1px solid var(--line)} .term:last-child{border-bottom:0}
  .term .nm{font-weight:700;font-size:17px} .term .plain{margin:6px 0} .term .tech{color:var(--mut);font-size:14px}
  .term .fe{margin-top:8px;padding:8px 12px;border-left:3px solid var(--blue);background:#1f6feb12;border-radius:0 8px 8px 0;font-size:13px}
  .term .fe b{color:var(--blue)}
  .term .srcs{font-size:12px;color:var(--mut);margin-top:8px}
  .az{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0} .az a{border:1px solid var(--line2);border-radius:6px;padding:3px 9px;font-size:13px}
  .dict{border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:12px 0;background:var(--panel)}
  .dict .nm{font-weight:700;font-size:16px} .dict .est{color:var(--mut);font-size:13px;margin:2px 0 6px}
  .country{border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:12px 0;background:var(--panel)}
  .country h3{font-size:16px;margin:0 0 8px}
  .country .row2{padding:6px 0;border-bottom:1px solid var(--line)} .country .row2:last-child{border-bottom:0}
  .empty{color:var(--mut);padding:14px 0}
  details.faq{border:1px solid var(--line2);border-radius:10px;margin:0 0 8px;background:var(--panel)}
  details.faq>summary{cursor:pointer;padding:12px 15px;font-weight:700;list-style:none} details.faq>summary::-webkit-details-marker{display:none}
  details.faq[open]>summary{border-bottom:1px solid var(--line)} details.faq .a{padding:12px 15px;color:var(--mut)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 16px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const NAV = [
  ['/dictionaries', 'Dictionaries'],
  ['/founding-era', 'Founding-era meaning'],
  ['/common-law', 'American vs British common law'],
  ['/persuasive', 'Persuasive authority'],
  ['/reception', 'Reception of English law'],
  ['/federalist', 'The Federalist'],
  ['/glossary', 'American Lexicon'],
  ['/directory', 'Dictionary directory'],
  ['/sovereign-citizen', 'Using Black’s correctly'],
];

const FOOTER = `<footer>
  <b>Reference, not law.</b> A dictionary describes how a word is used; it does not create a right or
  override a statute or a court's holding. Everything here is legal <b>education and reference</b> with
  its sources named — not legal advice. Every case, citation, dictionary edition and doctrine is real
  and verified. For advice about your situation, consult a licensed attorney.
  <div style="margin-top:8px"><a href="/">Lexicon</a> · <a href="${esc(LAW)}">Law</a> · <a href="${esc(WIKI)}">Library</a></div>
</footer>`;

const SEARCH_URL_TEMPLATE = `${BASE_URL}/glossary?q={search_term_string}`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Legal Lexicon & Sources of Authority — legal dictionaries vs law, founding-era meaning, American vs British common law, persuasive authority, and an American legal lexicon. Free, sourced, not legal advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';

  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: 'MELEK Legal Lexicon', ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  if (opts.jsonld) for (const j of [].concat(opts.jsonld)) if (j) extra.push(j);

  const seoHead = seoHeadTags({
    title, description: desc, canonical, robots, siteName: 'MELEK Legal Lexicon',
    site: { url: BASE_URL, name: 'MELEK Legal Lexicon', searchUrlTemplate: SEARCH_URL_TEMPLATE },
    jsonld: extra,
  });

  const navLinks = NAV.map(([h, t]) => `<a href="${esc(h)}">${esc(t)}</a>`).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">⚖ Legal Lexicon <span>sources of authority</span></a>
  <div class=topbar-r>${navLinks}</div></header>
<main class=wrap>${body}${citeHtml}</main>
${FOOTER}</body></html>`;
}

const crumbs = (name, path) => [
  { name: 'Legal Lexicon', url: `${BASE_URL}/` },
  { name, url: `${BASE_URL}${path}` },
];

// Render a source list [{name,url}] as inline links.
function sourceList(sources) {
  const s = (Array.isArray(sources) ? sources : []).filter((x) => x && x.name);
  if (!s.length) return '';
  return 'Sources: ' + s.map((x) => x.url ? `<a href="${esc(x.url)}" rel=noopener>${esc(x.name)}</a>` : esc(x.name)).join(' · ');
}

// ── FAQ (visible AND emitted as FAQPage JSON-LD) ──────────────────────────────────────────────────
const HOME_FAQ = [
  { q: 'Is Black’s Law Dictionary the law?',
    a: 'No. Black’s Law Dictionary is a reference work — persuasive at most. A dictionary records how a '
     + 'word is used; it does not enact a right, and it cannot override a statute or a court’s ruling. Courts '
     + 'sometimes cite dictionaries as evidence of a word’s meaning, but the binding law is the constitution, '
     + 'statutes, and case law themselves.' },
  { q: 'What are founding-era dictionaries good for?',
    a: 'They are primary evidence of what a constitutional word MEANT when the Constitution was written and '
     + 'ratified (original public meaning). In District of Columbia v. Heller (2008) the Supreme Court used '
     + 'founding-era dictionaries — including Samuel Johnson’s (1755) and Noah Webster’s (1828) — to fix the '
     + 'meaning of “arms” and “bear arms.”' },
  { q: 'Does America use British common law?',
    a: 'The states RECEIVED English common law (by reception statutes, with dates and terms that vary by '
     + 'state) and then developed their own American common law. In the federal system, Erie R.R. Co. v. '
     + 'Tompkins (1938) held there is “no federal general common law,” though narrow federal-common-law '
     + 'enclaves survive and federal courts remain the authority on the Constitution and federal statutes.' },
  { q: 'Is this legal advice?',
    a: 'No. This is free legal education and reference, with every source named. It is not legal advice and '
     + 'not a substitute for a licensed attorney.' },
];

function faqCard(pairs, heading = 'Frequently asked questions') {
  const items = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.q && p.a);
  if (!items.length) return '';
  return `<h2>${esc(heading)}</h2>` + items.map((p) =>
    `<details class=faq><summary>${esc(p.q)}</summary><div class=a>${esc(p.a)}</div></details>`).join('');
}

// ── /  home ───────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const sections = [
    ['/dictionaries', 'Legal dictionaries — what they are and aren’t', 'Black’s (1891→today), Bouvier’s (1839, distinctly American), Johnson’s (1755). A dictionary is reference, not law.'],
    ['/founding-era', 'Founding-era meaning & originalism', 'Reading a constitutional word as it was understood when the Constitution was written — with the Heller example.'],
    ['/common-law', 'American common law vs British common law', 'Reception of English law, Erie (“no federal general common law”), the surviving federal enclaves, and NFIB v. Sebelius.'],
    ['/persuasive', 'Persuasive British case law in U.S. courts', 'Binding vs persuasive authority — e.g. M’Naghten’s Case (1843), the insanity rule adopted across U.S. jurisdictions.'],
    ['/reception', 'Reception of English law & the earliest American cases', 'Pre-Revolution British cases and early American law — e.g. Respublica v. De Longchamps (1784).'],
    ['/federalist', 'The Federalist & Anti-Federalist Papers', 'How courts use them as weighty (but non-binding) evidence of original intent and meaning — and how to cite them.'],
    ['/glossary', 'The American Legal Lexicon', `Our own American legal dictionary — ${LEXICON.terms.length} terms, each with a plain and a technical definition, sourced.`],
    ['/directory', 'Dictionary directory', 'Real, reputable legal dictionaries — Black’s, Bouvier’s, Johnson’s — plus per-country official glossaries.'],
    ['/sovereign-citizen', 'Using Black’s Law correctly', 'How the dictionary gets misused as if it were binding law — and what it actually does.'],
  ];
  const body = `<h1>Legal Lexicon &amp; Sources of Authority</h1>
    <p class=lead>A free legal-education surface on <b>what actually counts as law</b> — and what only looks like it.
      Legal dictionaries are useful, but a dictionary is <b>persuasive reference, not binding law</b>. It records how a
      word is used; it does not create a right or override a statute or a court’s holding. This is especially worth
      getting straight if you’ve been told that a line in Black’s Law Dictionary settles a legal question. It doesn’t —
      and there are better tools, which this surface lays out.</p>
    <form class=lex method=get action="/glossary"><div class=row>
      <input class=q name=q placeholder="Look up a legal term (e.g. “common law”, “due process”)…" autocomplete=off aria-label="Search the lexicon">
      <button type=submit>Search the lexicon</button>
    </div></form>
    <div class=grid>
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('')}
    </div>
    <div class=card>${faqCard(HOME_FAQ)}</div>`;
  return page('Legal Lexicon & Sources of Authority — dictionaries vs. law', body, {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: 'Legal Lexicon', url: `${BASE_URL}/` }],
    faq: HOME_FAQ,
  });
}

// ── /dictionaries ─────────────────────────────────────────────────────────────────────────────────
export function dictionariesPage() {
  const dictCards = DICTIONARIES.map((d) => `<div class=dict>
    <div class=nm>${esc(d.name)}</div>
    <div class=est>${esc(d.est)}</div>
    <p>${esc(d.what)}</p>
    <div>${(d.tags || []).map((t) => `<span class="tag${/public domain/i.test(t) ? ' pd' : ''}">${esc(t)}</span>`).join('')}</div>
    <div class=cite>${d.links.map((l) => `<a href="${esc(l.url)}" rel=noopener>${esc(l.label)} →</a>`).join(' · ')}</div>
  </div>`).join('');
  const body = `<div class=teach><h1>Legal dictionaries — what they are, and what they aren’t</h1>
    <p class=lead>A legal dictionary is a <b>reference book</b>. At its best it is authoritative and precise; courts
      do sometimes cite one as evidence of a word’s ordinary or technical meaning. But it is <b>persuasive at most</b> —
      never binding. It does not make law, confer rights, or override a statute or a court’s decision. Keep that
      distinction and a dictionary becomes a powerful tool; forget it and you’ll build an argument on sand.</p>
    <h2>Three dictionaries worth knowing</h2>
    ${dictCards}
    <h2>The key use: founding-era dictionaries for constitutional interpretation</h2>
    <p>The single most powerful, legitimate use of a dictionary in law is reading a constitutional word as it was
      understood <b>when the Constitution was written and ratified</b> — its <b>original public meaning</b>. For that,
      the right tool is a dictionary from the founding era (Johnson’s 1755; later Webster’s 1828), not a modern one.
      The Supreme Court did exactly this in <b>District of Columbia v. Heller, 554 U.S. 570 (2008)</b>, using
      founding-era dictionaries to fix the meaning of “arms” and “bear arms.”
      <a href="/founding-era">See the founding-era-meaning page →</a></p>
    <p class=muted>Related: <a href="/glossary">our own American legal lexicon</a> ·
      <a href="/directory">a directory of dictionaries, incl. per-country glossaries</a> ·
      <a href="/sovereign-citizen">using Black’s Law correctly</a>.</p></div>`;
  return page('Legal dictionaries — what they are and aren’t', body, {
    canonical: `${BASE_URL}/dictionaries`,
    breadcrumb: crumbs('Legal dictionaries', '/dictionaries'),
    cite: { title: 'Legal dictionaries — what they are and aren’t', url: `${BASE_URL}/dictionaries` },
  });
}

// ── /founding-era ─────────────────────────────────────────────────────────────────────────────────
export function foundingEraPage() {
  // pull a few lexicon terms that carry founding-era notes, to show the method concretely.
  const examples = LEXICON.terms.filter((t) => t.foundingEra
    && ['well-regulated', 'domestic-violence-constitutional', 'commerce', 'emolument'].includes(t.slug));
  const exampleHtml = examples.length ? examples.map((t) => `<div class=term>
    <div class=nm>${esc(t.term)}</div>
    <div class=fe><b>Then vs. now:</b> ${esc(t.foundingEra)}</div>
    <div class=srcs>${sourceList(t.sources)}</div></div>`).join('') : '';
  const body = `<div class=teach><h1>Founding-era dictionaries &amp; original public meaning</h1>
    <p class=lead>When lawyers and judges argue about what the Constitution means, one recognized method is to ask:
      <b>what did these words mean to an ordinary, informed reader at the time they were written and ratified?</b>
      This is <b>original public meaning</b> (a form of originalism). A dictionary from the founding era is primary
      evidence of that meaning — which is the most powerful legitimate use of a dictionary in constitutional law.</p>
    <h2>The method, in one case</h2>
    <p>In <b>District of Columbia v. Heller, 554 U.S. 570 (2008)</b>, the Court had to decide what the Second
      Amendment’s words meant. Justice Scalia’s majority opinion turned to <b>founding-era dictionaries</b> — among
      them <b>Samuel Johnson’s Dictionary of the English Language (1755)</b> and <b>Noah Webster’s American Dictionary
      of the English Language (1828)</b> — to establish the ordinary 18th-century meanings of “arms,” “keep,” and
      “bear.” The guiding principle: “The Constitution was written to be understood by the voters; its words and
      phrases were used in their normal and ordinary as distinguished from technical meaning.”</p>
    <blockquote>Use a <b>founding-era</b> dictionary to read a <b>founding-era</b> document. Reading 1787 words
      through a 2024 dictionary is how you get the meaning wrong.
      <span class=src>General principle, illustrated by Heller’s method.</span></blockquote>
    <h2>Words whose meaning has shifted since 1787</h2>
    <p>These are concrete examples — each drawn from <a href="/glossary">the lexicon</a>, each sourced:</p>
    ${exampleHtml || '<p class=empty>Lexicon examples are unavailable right now.</p>'}
    <h2>Where to get founding-era meaning</h2>
    <ul>
      <li><b>Samuel Johnson, A Dictionary of the English Language (1755)</b> — the ordinary English of the era.
        <a href="/directory">see the directory →</a></li>
      <li><b>Bouvier’s Law Dictionary (1839)</b> — early American legal usage, adapted to U.S. law.</li>
      <li>Contemporaneous sources: <a href="/federalist">The Federalist &amp; Anti-Federalist Papers</a>, the
        ratification debates, and early statutes.</li>
    </ul>
    <p class=muted>Caveat: founding-era meaning is <b>evidence</b>, argued and weighed — not an on/off switch.
      Different judges weigh it differently, and it is one method of interpretation among several.</p></div>`;
  return page('Founding-era dictionaries & original public meaning', body, {
    canonical: `${BASE_URL}/founding-era`,
    breadcrumb: crumbs('Founding-era meaning', '/founding-era'),
    cite: { title: 'Founding-era dictionaries & original public meaning', url: `${BASE_URL}/founding-era`, sourceOfRecord: 'District of Columbia v. Heller, 554 U.S. 570 (2008)', sourceUrl: 'https://supreme.justia.com/cases/federal/us/554/570/' },
  });
}

// ── /common-law ───────────────────────────────────────────────────────────────────────────────────
export function commonLawPage() {
  const body = `<div class=teach><h1>American common law vs British common law</h1>
    <p class=lead>English common law is the root — but America grew its own legal order from it. Getting this right
      means holding two true things at once: the states <b>received</b> English common law, and America then
      <b>developed its own</b>, at both the state and federal levels.</p>
    <h2>1. Reception: English common law came over — on each state’s terms</h2>
    <p>The original colonies, and later the states, <b>received</b> the English common law by <a href="/reception">reception
      statutes</a>. Each state fixed its own reception date and terms, keeping English common law <b>except</b> where its
      own constitution and statutes changed it. So there is no single “American common law” inherited whole from England —
      there are fifty state common-law traditions, each with an English root and its own subsequent growth.</p>
    <h2>2. Federal courts: “there is no federal general common law”</h2>
    <p>On the federal side, the landmark is <b>Erie Railroad Co. v. Tompkins, 304 U.S. 64 (1938)</b>. Justice Brandeis,
      overruling <i>Swift v. Tyson</i> (1842), held that when a federal court hears a state-law claim (in diversity), it
      must apply <b>state</b> law — there is <b>no federal general common law</b> for the federal courts to make up. That
      is the accurate, load-bearing statement of the rule.</p>
    <blockquote>“There is no federal general common law.”
      <span class=src>Erie R.R. Co. v. Tompkins, 304 U.S. 64 (1938) (Brandeis, J.).</span></blockquote>
    <h2>3. But federal law is still made by federal courts — in two accurate senses</h2>
    <p><b>(a) Surviving federal-common-law enclaves.</b> Erie ended <i>general</i> federal common law, not <i>all</i> of it.
      Federal courts still fashion common-law rules in narrow, genuinely federal areas — for example admiralty and
      maritime law, disputes between states, foreign relations, and the rights and duties of the United States itself.</p>
    <p><b>(b) The federal judicial power over federal and constitutional questions.</b> When the question is one of
      <b>federal statute or the Constitution</b>, the federal courts — with the Supreme Court at the top — are the
      authority, and their rulings bind nationwide. This is the accurate version of the idea that America has its own
      overriding body of national law: it is the <b>federal judicial power over federal/constitutional law</b>, not a
      free-floating “federal common law” of general subjects.</p>
    <h2>The ACA example: a national question, decided for the whole country</h2>
    <p>A clean illustration is <b>National Federation of Independent Business v. Sebelius, 567 U.S. 519 (2012)</b>. The
      Court upheld the Affordable Care Act’s individual mandate — not under the Commerce Clause, but as a valid exercise
      of Congress’s <b>taxing power</b> (Chief Justice Roberts writing; decided June 28, 2012). Whatever one thinks of the
      result, it shows the mechanism: a federal court resolving a <b>national, constitutional question</b>, and that ruling
      binding every state. That is the federal judicial power at work — the accurate core of the “America has its own law”
      point.</p>
    <p class=muted>Related: <a href="/persuasive">binding vs. persuasive authority</a> ·
      <a href="/reception">reception of English law &amp; the earliest American cases</a>.</p></div>`;
  return page('American common law vs British common law', body, {
    canonical: `${BASE_URL}/common-law`,
    breadcrumb: crumbs('American vs British common law', '/common-law'),
    cite: { title: 'American common law vs British common law', url: `${BASE_URL}/common-law`, sourceOfRecord: 'Erie R.R. Co. v. Tompkins, 304 U.S. 64 (1938); NFIB v. Sebelius, 567 U.S. 519 (2012)' },
  });
}

// ── /persuasive ───────────────────────────────────────────────────────────────────────────────────
export function persuasivePage() {
  const body = `<div class=teach><h1>Persuasive authority: British case law in American courts</h1>
    <p class=lead>Not every source a court reads is one it must obey. The core distinction every self-represented
      litigant should master is <b>binding</b> vs. <b>persuasive</b> authority.</p>
    <h2>Binding vs. persuasive</h2>
    <ul>
      <li><b>Binding (mandatory) authority</b> — a court <b>must</b> follow it: the applicable constitution and statutes,
        and precedent from a <b>higher court in the same jurisdiction</b>.</li>
      <li><b>Persuasive authority</b> — a court <b>may</b> consider it and be influenced by it, but need not follow it:
        decisions of other jurisdictions (including English courts), lower or coordinate courts, treatises, law
        dictionaries, and historical materials.</li>
    </ul>
    <h2>English cases as persuasive authority — M’Naghten’s Case</h2>
    <p>American courts still cite British decisions as persuasive authority, and some English rules were adopted so
      widely that they became the American standard. The classic example is <b>M’Naghten’s Case, 8 Eng. Rep. 718,
      10 Cl. &amp; Fin. 200 (H.L. 1843)</b> — decided by the British <b>House of Lords</b>, yet its test became the
      insanity-defense rule in many U.S. jurisdictions.</p>
    <blockquote>Under the <b>M’Naghten rule</b>, a defendant is not criminally responsible if, from a disease of the
      mind, he did not know the nature and quality of the act he was doing — or, if he did know it, that he did not
      know it was wrong.
      <span class=src>M’Naghten’s Case (H.L. 1843), as adopted across many U.S. states.</span></blockquote>
    <p>The lesson: an English case is <b>not binding</b> on an American court, but it can be highly <b>persuasive</b> —
      and once an American court adopts its rule, <b>that American decision</b> is the binding authority going forward,
      not the English case itself.</p>
    <p class=muted>Related: <a href="/reception">pre-Revolution British cases &amp; the earliest American case law</a> ·
      <a href="/glossary#mnaghten-rule">the M’Naghten rule in the lexicon</a>.</p></div>`;
  return page('Persuasive authority: British case law in American courts', body, {
    canonical: `${BASE_URL}/persuasive`,
    breadcrumb: crumbs('Persuasive authority', '/persuasive'),
    cite: { title: 'Persuasive authority: British case law in American courts', url: `${BASE_URL}/persuasive`, sourceOfRecord: "M'Naghten's Case, 8 Eng. Rep. 718 (H.L. 1843)" },
  });
}

// ── /reception ────────────────────────────────────────────────────────────────────────────────────
export function receptionPage() {
  const body = `<div class=teach><h1>Reception of English law &amp; the earliest American cases</h1>
    <p class=lead>Before there was American case law, there was English law — and American courts, both before and
      after the Constitution, drew directly on it. Two ideas explain how English law became American law: the
      <b>reception</b> of English common law, and the earliest American decisions building on it.</p>
    <h2>Reception statutes</h2>
    <p>A <b>reception statute</b> is how a state formally adopted the English common law (and often English statutes)
      in force as of a chosen cut-off date — keeping it as state law <b>except</b> where repugnant to the state’s own
      constitution and enactments. The reception <b>date and terms vary by state</b>, which is why “the common law” is
      not identical from one state to the next.</p>
    <h2>Pre-Revolution British cases &amp; the earliest American case law</h2>
    <p>Pre-Revolution British cases were the working law of the colonies and continued to be cited afterward as
      persuasive authority. And America’s earliest reported decisions show the transition in progress. A landmark
      example is <b>Respublica v. De Longchamps, 1 U.S. (1 Dall.) 111 (1784)</b> — decided in <b>Pennsylvania</b>,
      <b>before</b> the Constitution was written. Charles De Longchamps assaulted a French diplomat; the court held that
      the <b>law of nations</b> (customary international law) was part of the law of Pennsylvania, and that an offense
      against a foreign minister was “a crime against the whole world.”</p>
    <blockquote>“The person of a public minister is sacred and inviolable.”
      <span class=src>Respublica v. De Longchamps, 1 U.S. (1 Dall.) 111 (Pa. 1784) (McKean, C.J.).</span></blockquote>
    <p>De Longchamps is a founding-era illustration of two things at once: American courts <b>receiving</b> established
      legal principles (here, the law of nations) and generating <b>the earliest American case law</b> — the first
      volume of U.S. Reports, no less — before the constitutional order was even in place.</p>
    <p class=muted>Related: <a href="/common-law">American vs British common law</a> ·
      <a href="/glossary#law-of-nations">law of nations in the lexicon</a>.</p></div>`;
  return page('Reception of English law & the earliest American cases', body, {
    canonical: `${BASE_URL}/reception`,
    breadcrumb: crumbs('Reception of English law', '/reception'),
    cite: { title: 'Reception of English law & the earliest American cases', url: `${BASE_URL}/reception`, sourceOfRecord: 'Respublica v. De Longchamps, 1 U.S. (1 Dall.) 111 (Pa. 1784)' },
  });
}

// ── /federalist ───────────────────────────────────────────────────────────────────────────────────
export function federalistPage() {
  const body = `<div class=teach><h1>The Federalist &amp; Anti-Federalist Papers as near-law authority</h1>
    <p class=lead>Some documents are not law, yet carry so much interpretive weight that courts cite them constantly.
      The prime example is <b>The Federalist</b> — and, on the other side of the argument, the <b>Anti-Federalist</b>
      writings.</p>
    <h2>What they are</h2>
    <p><b>The Federalist</b> (the “Federalist Papers”) is a series of <b>85 essays</b> published in <b>1787–1788</b> under
      the pseudonym <b>“Publius”</b> by <b>Alexander Hamilton, James Madison, and John Jay</b>, urging New York to
      ratify the Constitution. The <b>Anti-Federalist Papers</b> is the umbrella name for the many essays (by writers
      such as “Brutus” and “Cato”) arguing <b>against</b> ratification or for a bill of rights.</p>
    <h2>Why courts treat them as weighty — but not binding</h2>
    <p>They are <b>persuasive authority</b>, not law. But because they were written <b>contemporaneously with
      ratification</b> and explain the design of the Constitution to the very public that ratified it, courts —
      including the Supreme Court — cite them as strong evidence of <b>original intent and original meaning</b>. The
      Federalist is one of the most-cited non-judicial sources in American constitutional law. The Anti-Federalist
      writings matter too: they show what the ratifiers were reacting to and worried about, which is itself evidence
      of meaning.</p>
    <blockquote>Weighty evidence of what the Constitution was understood to mean — <b>not</b> a binding rule of decision.
      A court may quote Federalist No. 78 on judicial power; it is still bound by the Constitution’s text and by
      precedent, not by Hamilton’s essay.
      <span class=src>General principle on the interpretive use of The Federalist.</span></blockquote>
    <h2>How to cite them</h2>
    <ul>
      <li><b>The Federalist</b> is cited by essay number and author, e.g. <i>The Federalist No. 78 (Alexander
        Hamilton)</i>. Full public-domain text: <a href="https://guides.loc.gov/federalist-papers/full-text" rel=noopener>Library of Congress →</a></li>
      <li><b>Anti-Federalist</b> essays are cited by pseudonym (and, where known, author), e.g. <i>Brutus No. 1</i>.</li>
    </ul>
    <p class=muted>Related: <a href="/founding-era">founding-era meaning &amp; original public meaning</a> ·
      <a href="/glossary#the-federalist">The Federalist in the lexicon</a>.</p></div>`;
  return page('The Federalist & Anti-Federalist Papers as near-law authority', body, {
    canonical: `${BASE_URL}/federalist`,
    breadcrumb: crumbs('The Federalist', '/federalist'),
    cite: { title: 'The Federalist & Anti-Federalist Papers as near-law authority', url: `${BASE_URL}/federalist`, sourceOfRecord: 'The Federalist (1787–1788), Library of Congress', sourceUrl: 'https://guides.loc.gov/federalist-papers/full-text' },
  });
}

// ── /sovereign-citizen ────────────────────────────────────────────────────────────────────────────
export function sovereignCitizenPage() {
  const body = `<div class=teach><h1>Using Black’s Law Dictionary correctly</h1>
    <p class=lead>A recurring mistake — common in the sovereign-citizen orbit — is to treat a definition in Black’s
      Law Dictionary as if it were <b>binding law</b>: as though quoting a dictionary entry could override a statute,
      defeat a court’s jurisdiction, or create a right. This page explains, plainly and without condescension, why
      that doesn’t work — and how the very same dictionary <b>is</b> genuinely useful.</p>
    <h2>What a dictionary actually is</h2>
    <p>A legal dictionary <b>describes usage</b>. It reports how a word has been used by courts and lawyers. That is
      valuable — but description is not enactment. A dictionary is not passed by a legislature, not signed by an
      executive, and not handed down by a court. So it <b>cannot</b>:</p>
    <ul>
      <li>create a legal right or a legal status;</li>
      <li>repeal or override a statute or regulation;</li>
      <li>strip a court of jurisdiction, or change the meaning a statute gives a term for its own purposes;</li>
      <li>substitute for the actual holding of a case.</li>
    </ul>
    <h2>Where the misuse goes wrong</h2>
    <p>Typical patterns: quoting an old edition’s definition of “person,” “driving,” “includes,” or “United States” and
      treating that entry as if it controlled a statute’s meaning. But when a statute <b>defines its own terms</b>, that
      statutory definition governs — not the dictionary. And courts read “includes” and similar words in context, under
      settled canons of construction, not by a dictionary line taken in isolation. Arguments built this way have a
      long, <b>consistent</b> record of losing in court — not because the courts are hiding a secret, but because a
      dictionary was never the source of binding law in the first place.</p>
    <h2>The correct, powerful uses of Black’s (and better tools)</h2>
    <ul>
      <li><b>Understand a term of art</b> so you can read a statute or opinion accurately.</li>
      <li><b>Evidence of ordinary meaning</b> — and for a constitutional word, a <b>founding-era</b> dictionary is the
        right tool for <a href="/founding-era">original public meaning</a>, as the Supreme Court used in
        <i>Heller</i> (2008).</li>
      <li><b>Trace how a term evolved</b> by comparing editions (Black’s 1891 → today; <a href="/dictionaries">Bouvier’s
        1839</a> for early American usage).</li>
      <li>Then go to the <b>actual authority</b>: the <a href="${esc(LAW)}">constitution, statutes, and case law</a>
        themselves — that is where binding law lives.</li>
    </ul>
    <p>None of this makes Black’s useless — it makes it a <b>reference</b>, used for what a reference is good for. The
      failure isn’t reading the dictionary; it’s asking the dictionary to do a job (make law) that no dictionary can do.</p>
    <p class=muted>See also: <a href="/dictionaries">what dictionaries are and aren’t</a> ·
      <a href="/glossary#persuasive-authority">binding vs. persuasive authority</a> ·
      <a href="/common-law">American vs British common law</a>.</p></div>`;
  return page('Using Black’s Law Dictionary correctly', body, {
    canonical: `${BASE_URL}/sovereign-citizen`,
    breadcrumb: crumbs('Using Black’s correctly', '/sovereign-citizen'),
    cite: { title: 'Using Black’s Law Dictionary correctly', url: `${BASE_URL}/sovereign-citizen` },
  });
}

// ── /glossary — the American Legal Lexicon (browse · search · detail) ──────────────────────────────
function termCard(t) {
  const slug = t.slug || slugify(t.term);
  const fe = t.foundingEra ? `<div class=fe><b>Founding-era note:</b> ${esc(t.foundingEra)}</div>` : '';
  return `<div class=term id="${esc(slug)}">
    <div class=nm>${esc(t.term)}${t.category ? ` <span class=tag>${esc(t.category)}</span>` : ''}</div>
    <div class=plain>${esc(t.plain)}</div>
    <div class=tech><b>Technical:</b> ${esc(t.technical)}</div>
    ${fe}
    <div class=srcs>${sourceList(t.sources)}</div>
  </div>`;
}

export function glossaryView(query, termSlug) {
  const term = String(query == null ? '' : query).trim();
  const wantSlug = String(termSlug == null ? '' : termSlug).trim();
  const all = LEXICON.terms;

  // detail view: a single term by slug (?term=)
  if (wantSlug) {
    const t = all.find((x) => (x.slug || slugify(x.term)) === wantSlug);
    if (t) {
      const body = `<h1>${esc(t.term)}</h1>
        <p class=muted><a href="/glossary">← the full American Legal Lexicon</a></p>
        <div class=card>${termCard(t)}</div>
        <p class=muted style="font-size:13px">A dictionary entry is <b>reference</b>: it describes how a term is used.
          It is not itself binding law. <a href="/sovereign-citizen">Why that matters →</a></p>`;
      return page(`${t.term} — American Legal Lexicon`, body, {
        canonical: `${BASE_URL}/glossary?term=${q(wantSlug)}`,
        robots: 'index,follow',
        breadcrumb: [...crumbs('American Lexicon', '/glossary'), { name: t.term, url: `${BASE_URL}/glossary?term=${q(wantSlug)}` }],
        cite: { title: `${t.term} — American Legal Lexicon`, url: `${BASE_URL}/glossary?term=${q(wantSlug)}` },
      });
    }
  }

  // search view: filter terms by query
  let shown = all;
  if (term) {
    const needle = term.toLowerCase();
    shown = all.filter((t) =>
      String(t.term).toLowerCase().includes(needle)
      || String(t.plain).toLowerCase().includes(needle)
      || String(t.technical).toLowerCase().includes(needle)
      || String(t.category || '').toLowerCase().includes(needle));
  }
  const sorted = [...shown].sort((a, b) => String(a.term).localeCompare(String(b.term)));

  const form = `<form class=lex method=get action="/glossary"><div class=row>
    <input class=q name=q value="${esc(term)}" placeholder="Search the lexicon…" autocomplete=off aria-label="Search the lexicon">
    <button type=submit>Search</button>
  </div></form>`;

  // A-Z jump index (of the currently-shown set)
  const letters = [...new Set(sorted.map((t) => String(t.term)[0].toUpperCase()))];
  const az = letters.length ? `<div class=az>${letters.map((L) => `<a href="#letter-${esc(L)}">${esc(L)}</a>`).join('')}</div>` : '';

  let lastLetter = '';
  const list = sorted.map((t) => {
    const L = String(t.term)[0].toUpperCase();
    let anchor = '';
    if (L !== lastLetter) { anchor = `<h2 id="letter-${esc(L)}">${esc(L)}</h2>`; lastLetter = L; }
    return anchor + termCard(t);
  }).join('');

  const heading = term
    ? `${sorted.length} term${sorted.length === 1 ? '' : 's'} matching “${esc(term)}”`
    : `The American Legal Lexicon — ${all.length} terms`;

  const intro = term ? '' : `<p class=lead>Our own American legal dictionary. Each entry gives a <b>plain-language</b>
    definition and a <b>technical</b> one, plus — where the meaning has shifted — a <b>founding-era note</b>, and every
    entry names its <b>sources</b>. It is reference, not law, and it is designed to grow.</p>
    <p class=muted style="font-size:13px">${esc(LEXICON.meta.editorialNote || '')}</p>`;

  const body = `<h1>American Legal Lexicon</h1>${intro}${form}
    <div class=card><h2 style="margin-top:2px">${heading}</h2>${az}
      ${sorted.length ? list : '<p class=empty>No terms match that search. Try a broader word, or <a href="/glossary">browse all terms</a>.</p>'}</div>`;

  return page(term ? `“${esc(term)}” — American Legal Lexicon` : 'The American Legal Lexicon', body, {
    canonical: term ? `${BASE_URL}/glossary?q=${q(term)}` : `${BASE_URL}/glossary`,
    robots: term ? 'noindex,follow' : 'index,follow,max-image-preview:large',
    breadcrumb: crumbs('American Lexicon', '/glossary'),
    cite: term ? undefined : { title: 'The American Legal Lexicon', url: `${BASE_URL}/glossary` },
  });
}

// ── /directory — a directory of real legal dictionaries + per-country glossaries ───────────────────
export function directoryPage() {
  const dictBlock = DICTIONARIES.map((d) => `<div class=dict>
    <div class=nm>${esc(d.name)}</div>
    <div class=est>${esc(d.est)}</div>
    <div>${(d.tags || []).map((t) => `<span class="tag${/public domain/i.test(t) ? ' pd' : ''}">${esc(t)}</span>`).join('')}</div>
    <div class=cite style="margin-top:6px">${d.links.map((l) => `<a href="${esc(l.url)}" rel=noopener>${esc(l.label)} →</a>`).join(' · ')}</div>
  </div>`).join('');

  const countryBlock = COUNTRY_GLOSSARIES.map((c) => `<div class=country>
    <h3>${esc(c.flag || '')} ${esc(c.country)}</h3>
    ${c.entries.map((e) => `<div class=row2>
      <a href="${esc(e.url)}" rel=noopener>${esc(e.label)} →</a>
      ${e.official ? '<span class="tag off">official</span>' : ''}
      <div class=muted style="font-size:13px">${esc(e.body)}</div>
    </div>`).join('')}
  </div>`).join('');

  const body = `<div class=teach><h1>Dictionary directory</h1>
    <p class=lead>Real, reputable legal dictionaries — with links that resolve. Public-domain works link a hosted
      full-text copy; in-copyright works link the publisher. Then, per the plan to “make and link them for different
      countries,” a set of <b>per-country legal glossaries</b>, favoring official government and court sources.</p>
    <h2>Core legal dictionaries</h2>
    ${dictBlock}
    <h2>Legal glossaries by country</h2>
    <p class=muted style="font-size:13px">Each country’s legal system has its own vocabulary. These link official or
      flagship-reputable glossaries; the list is designed to grow.</p>
    ${countryBlock}
    <p class=muted>See also: <a href="/dictionaries">what these dictionaries are and aren’t</a> ·
      <a href="/glossary">our own American legal lexicon</a>.</p></div>`;
  return page('Dictionary directory — legal dictionaries & per-country glossaries', body, {
    canonical: `${BASE_URL}/directory`,
    breadcrumb: crumbs('Dictionary directory', '/directory'),
    cite: { title: 'Dictionary directory — legal dictionaries & per-country glossaries', url: `${BASE_URL}/directory` },
  });
}

// ── /llms.txt — corpus-describing index for AI crawlers (GEO) ──────────────────────────────────────
export function lexiconLlmsTxt() {
  const base = llmsTxt({
    name: 'MELEK Legal Lexicon', baseUrl: BASE_URL,
    summary: 'Free legal-education reference on sources of legal authority: legal dictionaries vs. binding law, '
      + 'founding-era meaning (original public meaning), American vs. British common law, persuasive authority, '
      + 'and an American legal lexicon. Every case, citation and dictionary edition is real and sourced.',
    links: [
      { label: 'Legal dictionaries — what they are and aren’t', path: '/dictionaries' },
      { label: 'Founding-era dictionaries & original public meaning', path: '/founding-era', note: 'Heller (2008); Johnson 1755; Webster 1828' },
      { label: 'American common law vs British common law', path: '/common-law', note: 'Erie (1938); federal enclaves; NFIB v. Sebelius (2012)' },
      { label: 'Persuasive authority (British case law in U.S. courts)', path: '/persuasive', note: "M'Naghten (1843)" },
      { label: 'Reception of English law & earliest American cases', path: '/reception', note: 'De Longchamps (1784)' },
      { label: 'The Federalist & Anti-Federalist Papers', path: '/federalist' },
      { label: 'The American Legal Lexicon', path: '/glossary' },
      { label: 'Dictionary directory (incl. per-country glossaries)', path: '/directory' },
      { label: 'Using Black’s Law Dictionary correctly', path: '/sovereign-citizen' },
    ],
  });
  const extra = [
    '## About this corpus',
    'A reference and teaching surface. It states verified facts — case names, reporter citations, dates, dictionary '
      + 'editions — and teaches the distinction between binding law and persuasive reference. A dictionary is reference, '
      + 'not law; it does not create rights or override statutes or holdings. This is legal education, not legal advice.',
    '',
    '## Key authorities cited (all real, verified)',
    '- Erie R.R. Co. v. Tompkins, 304 U.S. 64 (1938) — "there is no federal general common law."',
    '- NFIB v. Sebelius, 567 U.S. 519 (2012) — ACA individual mandate upheld under the taxing power.',
    "- M'Naghten's Case, 8 Eng. Rep. 718, 10 Cl. & Fin. 200 (H.L. 1843) — the insanity-defense rule.",
    '- Respublica v. De Longchamps, 1 U.S. (1 Dall.) 111 (Pa. 1784) — law of nations in early American law.',
    '- District of Columbia v. Heller, 554 U.S. 570 (2008) — founding-era dictionaries for original public meaning.',
    '',
    '## Usage',
    'Public-interest legal reference. All crawlers, including AI/LLM crawlers, are welcome. Quote and cite freely; '
      + `attribute as: MELEK Legal Lexicon, ${BASE_URL} .`,
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// ── sitemap entries ────────────────────────────────────────────────────────────────────────────────
function sitemapEntries() {
  const paths = ['/', '/dictionaries', '/founding-era', '/common-law', '/persuasive', '/reception',
    '/federalist', '/glossary', '/directory', '/sovereign-citizen'];
  const entries = paths.map((p) => ({ path: p, changefreq: 'monthly', priority: p === '/' ? '1.0' : '0.7' }));
  // include each lexicon term's detail page
  for (const t of LEXICON.terms) {
    entries.push({ path: `/glossary?term=${q(t.slug || slugify(t.term))}`, changefreq: 'yearly', priority: '0.4' });
  }
  return entries;
}

// ── router / handler ───────────────────────────────────────────────────────────────────────────────
function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

export async function handler(req, res) {
  let pathname = '/', params = new URLSearchParams();
  try {
    const u = new URL(req.url, BASE_URL);
    pathname = u.pathname.replace(/\/+$/, '') || '/';
    params = u.searchParams;
  } catch { /* soft-fail to home */ }

  try {
    switch (pathname) {
      case '/':
        return send(res, 200, homePage());
      case '/dictionaries':
        return send(res, 200, dictionariesPage());
      case '/founding-era':
        return send(res, 200, foundingEraPage());
      case '/common-law':
        return send(res, 200, commonLawPage());
      case '/persuasive':
        return send(res, 200, persuasivePage());
      case '/reception':
        return send(res, 200, receptionPage());
      case '/federalist':
        return send(res, 200, federalistPage());
      case '/sovereign-citizen':
        return send(res, 200, sovereignCitizenPage());
      case '/glossary':
        return send(res, 200, glossaryView(params.get('q'), params.get('term')));
      case '/directory':
        return send(res, 200, directoryPage());
      case '/health':
        return send(res, 200, JSON.stringify({ ok: true, service: 'lexicon', terms: LEXICON.terms.length }), 'application/json; charset=utf-8');
      case '/robots.txt':
        return send(res, 200, robotsTxt(BASE_URL), 'text/plain; charset=utf-8');
      case '/llms.txt':
        return send(res, 200, lexiconLlmsTxt(), 'text/plain; charset=utf-8');
      case '/sitemap.xml':
        return send(res, 200, sitemapXml(BASE_URL, sitemapEntries()), 'application/xml; charset=utf-8');
      default:
        return send(res, 404, page('Not found', `<h1>Not found</h1>
          <p class=muted>No page at <code>${esc(pathname)}</code>. <a href="/">Back to the Legal Lexicon →</a></p>`, { robots: 'noindex,follow' }));
    }
  } catch (e) {
    // soft-fail: never 500 a content page; render a minimal recoverable page
    return send(res, 200, page('Legal Lexicon', `<h1>Legal Lexicon</h1>
      <p class=muted>Something went wrong rendering this page. <a href="/">Return home →</a></p>`, { robots: 'noindex,follow' }));
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Legal Lexicon on http://${HOST}:${PORT}  (${LEXICON.terms.length} terms)  BASE_URL=${BASE_URL}`);
  });
}
