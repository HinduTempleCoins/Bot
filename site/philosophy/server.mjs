// server.mjs — Philosophy.SoapBox.Community. A free civic-education surface: the history of political
// ideas and movements, presented with strict descriptive neutrality. Read-only, server-rendered, no
// keys, no custody. Self-contained: all content lives in knowledge/civic/political-philosophy.json —
// no external API, no network. Mirrors the SoapBox Law house style (nav, SEO head, breadcrumb/FAQ
// JSON-LD, dark theme) without depending on Law.
//
//   PORT=8114 BASE_URL=https://philosophy.soapbox.community node site/philosophy/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                     home — what this is + section cards + the spectrum note + FAQ
//   /spectrum             the ideological spectrum — every ideology as a cross-linked card
//   /ideology?id=…        ideology detail — tenets, key thinkers, historical arc, major criticisms
//   /self-determination   the concept (national/indigenous/individual) + its international-law spine
//   /movements            movements index (Black Panther Party, punk & skinhead, self-determination)
//   /movement?id=…        movement detail — factual/historical
//   /maxims               political & philosophical maxims (COMPLEMENTS SoapBox Law's /maxims)
//   /health /robots.txt /sitemap.xml /llms.txt
//
// ── DISCIPLINE (this surface's load-bearing rule) ─────────────────────────────────────────────────
//   History of ideas, not a manifesto. Each ideology and movement is presented AS ITS ADHERENTS
//   understand it AND with its major criticisms. No advocacy, no endorsement, no editorializing.
//   Descriptive neutrality on contested politics (CLAUDE.md Charter §3; neutral educational voice).
//   Facts — thinkers, dates, programs — are web-verified; no fabricated quotes or dates. Soft-fail:
//   every route renders an empty-state page if the data is missing; the page never throws or 500s.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8114);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LAW = process.env.LAW_SITE || 'https://law.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const DATA_SITE = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';

// ── house-style helpers ───────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

// ── data load (injectable seam, soft-fail-never-throw) ────────────────────────────────────────────
// The corpus is local JSON. There is no network fetch on this surface; the loader is nonetheless
// injectable (__setData) so tests can drive empty/partial corpora, and it soft-fails to a safe empty
// shape rather than throwing — so a missing or malformed file renders empty-state pages, never a 500.
const DATA_PATH = fileURLToPath(new URL('../../knowledge/civic/political-philosophy.json', import.meta.url));
const EMPTY = { ideologies: [], movements: [], maxims: [], selfDetermination: null, spectrumNote: '', updated: '' };
let DATA_OVERRIDE = null;
export function __setData(d) { DATA_OVERRIDE = d; }
function loadData() {
  if (DATA_OVERRIDE) return { ...EMPTY, ...DATA_OVERRIDE };
  try {
    const j = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
    return { ...EMPTY, ...j };
  } catch {
    return { ...EMPTY };
  }
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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .fam{display:inline-block;font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 8px;margin-top:6px}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  ul.tenets{margin:6px 0;padding-left:20px} ul.tenets li{margin:4px 0}
  .thinker{padding:8px 0;border-bottom:1px solid var(--line)} .thinker:last-child{border-bottom:0}
  .thinker .tn{font-weight:600} .thinker .td{color:var(--mut);font-size:13px}
  .crit li{margin:5px 0}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .warn{border-color:var(--gold);background:#d2992212}
  blockquote{border-left:3px solid var(--line2);margin:8px 0;padding:2px 0 2px 12px;color:var(--mut)}
  table{width:100%;border-collapse:collapse} td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
  .empty{color:var(--mut);padding:14px 0}
  .xlink{font-size:13px;margin-top:8px}
  .neutral{color:var(--gold);font-size:13px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Descriptive-neutrality footer — the load-bearing discipline of this surface, on EVERY page.
const FOOTER = `<footer>
  <b>History of ideas, not a manifesto.</b> Philosophy.SoapBox describes each political tradition and
  movement <b>as its own adherents understand it</b>, alongside its <b>major criticisms</b> — it does not
  endorse, rank, or argue for any of them. Thinkers, dates, and programs are drawn from the public
  historical record; where sources disagree, we say so. This is free civic education, not advocacy and
  not political, legal, or personal advice.
  <div style="margin-top:8px"><a href="/">Philosophy</a> · <a href="/spectrum">Spectrum</a> · <a href="/movements">Movements</a> · <a href="/self-determination">Self-determination</a> · <a href="/maxims">Maxims</a> · <a href="${LAW}">Law</a> · <a href="${WIKI}">Library</a></div>
</footer>`;

// BreadcrumbList trail: Philosophy → this section.
const crumbs = (name, path) => [
  { name: 'SoapBox Philosophy', url: `${BASE_URL}/` },
  { name, url: `${BASE_URL}${path}` },
];

function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Philosophy — a free, neutral guide to political philosophy and movements: the ideological spectrum, self-determination, the Black Panther Party, punk & skinhead subcultures, and the maxims of political thought. History of ideas, not a manifesto.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';

  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: 'SoapBox Philosophy', ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  if (opts.jsonld) for (const j of [].concat(opts.jsonld)) if (j) extra.push(j);

  const seoHead = seoHeadTags({
    title, description: desc, canonical, robots, siteName: 'SoapBox Philosophy',
    site: { url: BASE_URL, name: 'SoapBox Philosophy' },
    jsonld: extra,
  });

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🏛 SoapBox <span>philosophy</span></a>
  <div class=topbar-r><a href="/spectrum">Spectrum</a><a href="/movements">Movements</a><a href="/self-determination">Self-determination</a><a href="/maxims">Maxims</a><a href="${LAW}">Law</a><a href="${WIKI}">Library</a></div></header>
<main class=wrap>${body}${citeHtml}</main>
${FOOTER}</body></html>`;
}

// Render a visible FAQ card whose Q&A exactly match a faq[] passed to page() as FAQPage JSON-LD.
function faqCard(pairs, heading = 'Frequently asked questions') {
  const items = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.q && p.a);
  if (!items.length) return '';
  return `<div class=card style="margin-top:18px"><h2>${esc(heading)}</h2>${items.map((p) =>
    `<details style="margin:0 0 8px;border:1px solid var(--line2);border-radius:10px"><summary style="cursor:pointer;padding:12px 14px;font-weight:700">${esc(p.q)}</summary>`
    + `<div style="padding:0 14px 12px"><p class=muted style="margin:0">${esc(p.a)}</p></div></details>`).join('')}</div>`;
}

const HOME_FAQ = [
  { q: 'Is SoapBox Philosophy free?',
    a: 'Yes. It is a free, keyless civic-education surface — no account, no paywall. It covers the history '
     + 'of political ideas and movements.' },
  { q: 'Does it take a political side?',
    a: 'No. It describes each ideology and movement as its own adherents understand it, alongside the major '
     + 'criticisms of it. It does not endorse, rank, or argue for any position — this is history of ideas, '
     + 'not a manifesto.' },
  { q: 'Are the facts verified?',
    a: 'Thinkers, dates, and programs are drawn from the public historical record and cross-checked; where '
     + 'reputable sources disagree on a detail (for example, the exact founding year of SHARP), the page '
     + 'says so rather than picking one.' },
  { q: 'How is this different from the Law maxims page?',
    a: 'SoapBox Law carries legal maxims. This surface complements it with political and philosophical '
     + 'maxims — the sayings that carry ideas like the social contract, praxis, or the tyranny of the '
     + 'majority into political argument.' },
];

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
function homePage(data) {
  const sections = [
    ['/spectrum', 'The ideological spectrum', 'Liberalism, neoliberalism, the New Left, progressivism, conservatism, neoconservatism, the alt-right, libertarianism, socialism, and anarchism — each in its own terms, with its criticisms.'],
    ['/self-determination', 'Self-determination', 'National, indigenous, and individual self-determination as a concept in political theory and international law.'],
    ['/movements', 'Movements', 'The Black Panther Party (Ten-Point Program, survival programs, COINTELPRO), punk & skinhead subcultures (the SHARP vs. racist split), and self-determination movements.'],
    ['/maxims', 'Axioms, idioms & maxims', 'A small teaching set of the sayings of political thought — with a plain gloss and where each comes from.'],
  ];
  const spectrum = data.spectrumNote
    ? `<div class=card><h2>Reading the spectrum</h2><p class=muted>${esc(data.spectrumNote)}</p></div>` : '';
  const body = `<h1>Political Philosophy &amp; Movements <span class=muted style="font-size:14px">· the history of political ideas</span></h1>
    <p class=muted>A free, neutral guide to how people have thought about power, freedom, equality, and self-rule —
      and to the movements that carried those ideas into the street. Every entry is descriptive: the tradition
      as its adherents see it, and the strongest criticisms of it. History of ideas, not a manifesto.</p>
    <div class=grid style="margin-top:6px">
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('')}
    </div>
    ${spectrum}
    <div class=card><h2>How this connects</h2>
      <p class=muted style="font-size:14px">Ideologies, movements, and maxims cross-reference each other: an ideology
      links the thinkers and criticisms that define it and the movements that drew on it; self-determination links
      both the political theory and the international-law framework (see also <a href="${esc(LAW)}">SoapBox Law</a> and
      the future World Law surface); and the maxims here complement the legal maxims on Law.</p></div>
    ${faqCard(HOME_FAQ)}`;
  return page('Political Philosophy & Movements — SoapBox Philosophy', body, {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: 'SoapBox Philosophy', url: `${BASE_URL}/` }],
    faq: HOME_FAQ,
  });
}

// ── /spectrum — every ideology as a cross-linked card ─────────────────────────────────────────────
export function spectrumView(data) {
  const items = Array.isArray(data.ideologies) ? data.ideologies : [];
  if (!items.length) {
    return `<h1>The ideological spectrum</h1><div class=card><p class=empty>No ideologies on record right now.</p></div>`;
  }
  const cards = items.map((i) => `<a class=sec href="/ideology?id=${q(i.id)}">
    <div class=t>${esc(i.name)}</div>
    <div class=d>${esc(i.summary || '')}</div>
    ${i.family ? `<span class=fam>${esc(i.family)}</span>` : ''}
  </a>`).join('');
  const note = data.spectrumNote ? `<p class=muted>${esc(data.spectrumNote)}</p>` : '';
  return `<h1>The ideological spectrum</h1>
    ${note}
    <p class=muted style="font-size:14px">Click any tradition for its core tenets, key thinkers, historical arc, and major
      criticisms. Each is presented in its own terms and with the standard objections to it — no ranking, no endorsement.</p>
    <div class=grid style="margin-top:6px">${cards}</div>`;
}

// ── /ideology?id=… — ideology detail ──────────────────────────────────────────────────────────────
export function ideologyView(data, id) {
  const items = Array.isArray(data.ideologies) ? data.ideologies : [];
  const it = items.find((x) => x.id === String(id || ''));
  const back = `<p class=muted><a href="/spectrum">← the ideological spectrum</a></p>`;
  if (!it) {
    return { html: `<h1>Ideology</h1>${back}<div class=card><p class=empty>No entry on record for that id. <a href="/spectrum">Browse the spectrum →</a></p></div>`, found: false };
  }
  const tenets = Array.isArray(it.tenets) && it.tenets.length
    ? `<div class=card><h2>Core tenets — as adherents frame them</h2><ul class=tenets>${it.tenets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  const thinkers = Array.isArray(it.thinkers) && it.thinkers.length
    ? `<div class=card><h2>Key thinkers</h2>${it.thinkers.map((t) => `<div class=thinker>
        <div class=tn>${esc(t.name)}${t.dates ? ` <span class=td>(${esc(t.dates)})</span>` : ''}</div>
        ${t.note ? `<div class=td>${esc(t.note)}</div>` : ''}</div>`).join('')}</div>` : '';
  const arc = it.arc ? `<div class=card><h2>Historical arc</h2><p>${esc(it.arc)}</p></div>` : '';
  const crit = Array.isArray(it.criticisms) && it.criticisms.length
    ? `<div class="card warn"><h2>Major criticisms</h2><ul class=crit>${it.criticisms.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
       <p class=neutral>Listed to show how the tradition is contested — not as this surface's verdict.</p></div>` : '';
  const related = Array.isArray(it.related) && it.related.length
    ? `<div class=xlink>Related: ${it.related.map((r) => {
        const rel = items.find((x) => x.id === r);
        return rel ? `<a href="/ideology?id=${q(r)}">${esc(rel.name)}</a>` : '';
      }).filter(Boolean).join(' · ')}</div>` : '';
  const html = `<h1>${esc(it.name)}${it.family ? ` <span class=fam>${esc(it.family)}</span>` : ''}</h1>
    ${back}
    <div class=card><p>${esc(it.summary || '')}</p>${related}</div>
    ${tenets}${thinkers}${arc}${crit}`;
  return { html, found: true, name: it.name };
}

// ── /self-determination ───────────────────────────────────────────────────────────────────────────
export function selfDeterminationView(data) {
  const sd = data.selfDetermination;
  if (!sd) {
    return `<h1>Self-determination</h1><div class=card><p class=empty>No entry on record right now.</p></div>`;
  }
  const dims = Array.isArray(sd.dimensions) && sd.dimensions.length
    ? `<div class=card><h2>Three scales of the claim</h2>${sd.dimensions.map((d) => `<div class=rec>
        <div class=nm>${esc(d.name)}</div><div class=meta>${esc(d.note)}</div></div>`).join('')}</div>` : '';
  const theory = sd.theory ? `<div class=card><h2>In political theory</h2><p>${esc(sd.theory)}</p></div>` : '';
  const law = Array.isArray(sd.internationalLaw) && sd.internationalLaw.length
    ? `<div class=card><h2>In international law</h2>
        <table><thead><tr><th>Instrument</th><th>Year</th><th>What it does</th></tr></thead><tbody>
        ${sd.internationalLaw.map((l) => `<tr><td>${esc(l.instrument)}</td><td>${esc(l.year)}</td><td>${esc(l.note)}</td></tr>`).join('')}
        </tbody></table>
        <p class=xlink>The treaty framework connects to <a href="${esc(LAW)}">SoapBox Law</a> and the future World Law surface.</p></div>` : '';
  const tensions = Array.isArray(sd.tensions) && sd.tensions.length
    ? `<div class="card warn"><h2>The hard tensions</h2><ul class=crit>${sd.tensions.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  return `<h1>Self-determination</h1>
    <p class=muted>${esc(sd.summary || '')}</p>
    ${dims}${theory}${law}${tensions}
    <p class=xlink><a href="/movements">See self-determination &amp; autonomy movements →</a></p>`;
}

// ── /movements — index ────────────────────────────────────────────────────────────────────────────
export function movementsView(data) {
  const items = Array.isArray(data.movements) ? data.movements : [];
  if (!items.length) {
    return `<h1>Movements</h1><div class=card><p class=empty>No movements on record right now.</p></div>`;
  }
  const cards = items.map((m) => `<a class=sec href="/movement?id=${q(m.id)}">
    <div class=t>${esc(m.name)}</div>
    <div class=d>${esc(m.summary || '')}</div>
    ${m.period ? `<span class=fam>${esc(m.period)}</span>` : ''}
  </a>`).join('');
  return `<h1>Movements</h1>
    <p class=muted style="font-size:14px">Political and social movements, told as factual history — what they did, what they
      stood for, and how they are criticized. Presented neutrally, in the movement's own terms and with the record around it.</p>
    <div class=grid style="margin-top:6px">${cards}</div>`;
}

// ── /movement?id=… — movement detail ──────────────────────────────────────────────────────────────
export function movementView(data, id) {
  const items = Array.isArray(data.movements) ? data.movements : [];
  const m = items.find((x) => x.id === String(id || ''));
  const back = `<p class=muted><a href="/movements">← all movements</a></p>`;
  if (!m) {
    return { html: `<h1>Movement</h1>${back}<div class=card><p class=empty>No entry on record for that id. <a href="/movements">Browse movements →</a></p></div>`, found: false };
  }
  const list = (title, arr, opt = {}) => (Array.isArray(arr) && arr.length)
    ? `<div class="card${opt.warn ? ' warn' : ''}"><h2>${esc(title)}</h2><ul class=crit>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  // named sub-records rendered as term/note rows (survival programs, split factions, forms)
  const rows = (title, arr, keyName, keyNote) => (Array.isArray(arr) && arr.length)
    ? `<div class=card><h2>${esc(title)}</h2>${arr.map((x) => `<div class=rec>
        <div class=nm>${esc(x[keyName] || '')}</div><div class=meta>${esc(x[keyNote] || '')}</div></div>`).join('')}</div>` : '';

  const keyFacts = list('Key facts', m.keyFacts);
  const tpp = m.tenPointProgramNote ? `<div class=card><h2>The Ten-Point Program</h2><p>${esc(m.tenPointProgramNote)}</p></div>` : '';
  const origins = m.origins ? `<div class=card><h2>Origins</h2><p>${esc(m.origins)}</p></div>` : '';
  const survival = rows('Survival programs', m.survivalPrograms, 'name', 'note');
  const split = rows('The split — faction by faction', m.theSplit, 'faction', 'note');
  const forms = rows('Forms it takes', m.forms, 'form', 'note');
  const cointel = m.cointelpro ? `<div class="card warn"><h2>COINTELPRO &amp; state repression</h2><p>${esc(m.cointelpro)}</p></div>` : '';
  const neutralityNote = m.neutralityNote ? `<div class=card><p class=neutral>${esc(m.neutralityNote)}</p></div>` : '';
  const note = m.note ? `<div class=card><p class=muted>${esc(m.note)}</p></div>` : '';
  const crit = list('How it is criticized', m.criticisms, { warn: false });
  const sources = m.sources ? `<p class=muted style="font-size:12px">Sources: ${esc(m.sources)}</p>` : '';

  const html = `<h1>${esc(m.name)}${m.period ? ` <span class=fam>${esc(m.period)}</span>` : ''}</h1>
    ${back}
    <div class=card><p>${esc(m.summary || '')}</p>${m.kind ? `<p class=muted style="font-size:13px;margin-bottom:0">${esc(m.kind)}</p>` : ''}</div>
    ${keyFacts}${tpp}${origins}${survival}${split}${forms}${cointel}${neutralityNote}${note}${crit}${sources}`;
  return { html, found: true, name: m.name };
}

// ── /maxims — political & philosophical maxims (complements Law's /maxims) ─────────────────────────
export function maximsView(data) {
  const items = Array.isArray(data.maxims) ? data.maxims : [];
  const rows = items.length ? items.map((m) => `<div class=rec>
    <div class=nm>${esc(m.term)}</div>
    ${m.attribution ? `<div class=meta>${esc(m.attribution)}</div>` : ''}
    ${m.gloss ? `<div class=meta>${esc(m.gloss)}</div>` : ''}
  </div>`).join('') : `<p class=empty>No maxims on record right now.</p>`;
  return `<h1>Axioms, idioms &amp; maxims of political thought</h1>
    <p class=muted>The sayings that carry political ideas into everyday argument — each with a plain gloss and where it comes from.
      We state what a maxim <b>means</b> and <b>where it's from</b>; we do not tell you it is right. This set <b>complements</b>
      the legal maxims on <a href="${esc(LAW)}/maxims">SoapBox Law</a> — political and philosophical rather than legal.</p>
    <div class=card>${rows}</div>`;
}

// ── /llms.txt — corpus index for AI crawlers (GEO) ────────────────────────────────────────────────
export function philosophyLlmsTxt() {
  const base = llmsTxt({
    name: 'SoapBox Philosophy', baseUrl: BASE_URL,
    summary: 'Free, keyless civic education on political philosophy and movements — the ideological spectrum, '
      + 'self-determination, and movements (Black Panther Party, punk & skinhead, self-determination), each '
      + 'described neutrally in its own terms and with its major criticisms. History of ideas, not a manifesto.',
    links: [
      { label: 'The ideological spectrum', path: '/spectrum', note: 'liberalism, neoliberalism, New Left, progressivism, conservatism, neoconservatism, alt-right, libertarianism, socialism/social-democracy, anarchism' },
      { label: 'Self-determination', path: '/self-determination', note: 'concept in political theory + international law (UN Charter, ICCPR/ICESCR, Res 1514, UNDRIP)' },
      { label: 'Movements', path: '/movements', note: 'Black Panther Party, punk & skinhead subcultures, self-determination movements' },
      { label: 'Axioms, idioms & maxims', path: '/maxims', note: 'political & philosophical maxims (complements the legal maxims on SoapBox Law)' },
    ],
  });
  const extra = [
    '## About this corpus',
    'SoapBox Philosophy is a history-of-ideas reference. Each ideology and movement is presented as its own '
      + 'adherents understand it AND with its major criticisms — descriptive neutrality, no advocacy or ranking. '
      + 'Thinkers, dates, and programs are drawn from the public historical record; where reputable sources '
      + 'disagree on a detail, the page says so.',
    '',
    '## Usage',
    'All crawlers, including AI/LLM crawlers, are welcome (see /robots.txt). This is public-interest civic-'
      + 'education content intended to be ingested, quoted, and cited. Attribute as: SoapBox Philosophy, ' + BASE_URL + ' .',
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/spectrum', '/self-determination', '/movements', '/maxims'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const raw = url.pathname;
    const sp = url.searchParams;

    if (raw === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (raw === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (raw === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const data = loadData();
      const idPaths = [
        ...(Array.isArray(data.ideologies) ? data.ideologies.map((i) => `/ideology?id=${q(i.id)}`) : []),
        ...(Array.isArray(data.movements) ? data.movements.map((m) => `/movement?id=${q(m.id)}`) : []),
      ];
      const entries = [...SITEMAP_PATHS, ...idPaths].map((u) => ({
        path: u, lastmod: today, changefreq: u === '/' ? 'weekly' : 'monthly', priority: u === '/' ? '1.0' : '0.7',
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
      return res.end(philosophyLlmsTxt());
    }

    const data = loadData();

    if (raw === '/') return sendHtml(res, homePage(data));

    if (raw === '/spectrum') {
      return sendHtml(res, page('The ideological spectrum — SoapBox Philosophy', spectrumView(data),
        { canonical: `${BASE_URL}/spectrum`, breadcrumb: crumbs('The ideological spectrum', '/spectrum') }));
    }
    if (raw === '/ideology') {
      const r = ideologyView(data, sp.get('id') || '');
      return sendHtml(res, page(`${r.found ? esc(r.name) : 'Ideology'} — SoapBox Philosophy`, r.html,
        { canonical: `${BASE_URL}/ideology?id=${q(sp.get('id') || '')}`, robots: r.found ? 'index,follow' : 'noindex,follow',
          breadcrumb: crumbs(r.found ? r.name : 'Ideology', `/ideology?id=${q(sp.get('id') || '')}`),
          cite: r.found ? { title: `${r.name} — history of the idea`, url: `${BASE_URL}/ideology?id=${q(sp.get('id') || '')}`, author: 'SoapBox Philosophy', sourceOfRecord: 'the public history of political thought' } : undefined }));
    }
    if (raw === '/self-determination') {
      return sendHtml(res, page('Self-determination — SoapBox Philosophy', selfDeterminationView(data),
        { canonical: `${BASE_URL}/self-determination`, breadcrumb: crumbs('Self-determination', '/self-determination'),
          cite: { title: 'Self-determination — concept and international law', url: `${BASE_URL}/self-determination`, author: 'SoapBox Philosophy', sourceOfRecord: 'the UN Charter, ICCPR/ICESCR, and UN General Assembly resolutions' } }));
    }
    if (raw === '/movements') {
      return sendHtml(res, page('Movements — SoapBox Philosophy', movementsView(data),
        { canonical: `${BASE_URL}/movements`, breadcrumb: crumbs('Movements', '/movements') }));
    }
    if (raw === '/movement') {
      const r = movementView(data, sp.get('id') || '');
      return sendHtml(res, page(`${r.found ? esc(r.name) : 'Movement'} — SoapBox Philosophy`, r.html,
        { canonical: `${BASE_URL}/movement?id=${q(sp.get('id') || '')}`, robots: r.found ? 'index,follow' : 'noindex,follow',
          breadcrumb: crumbs(r.found ? r.name : 'Movement', `/movement?id=${q(sp.get('id') || '')}`),
          cite: r.found ? { title: `${r.name} — a factual history`, url: `${BASE_URL}/movement?id=${q(sp.get('id') || '')}`, author: 'SoapBox Philosophy', sourceOfRecord: 'the public historical record' } : undefined }));
    }
    if (raw === '/maxims') {
      return sendHtml(res, page('Axioms, idioms & maxims of political thought — SoapBox Philosophy', maximsView(data),
        { canonical: `${BASE_URL}/maxims`, breadcrumb: crumbs('Maxims', '/maxims') }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

export { homePage, loadData, page };

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/philosophy\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Philosophy on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
