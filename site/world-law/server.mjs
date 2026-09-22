// site/world-law/server.mjs — World Law. A documentary surface over contested questions of
// international law (world-law.melek / law.soapbox.community/world). Read-only, server-rendered,
// zero-custody, keyless.
//
//   PORT=8123 BASE_URL=https://world-law.soapbox.community node site/world-law/server.mjs
//
// ── EDITORIAL DISCIPLINE — THE WHOLE POINT OF THIS SURFACE (do not weaken) ────────────────────────
//   TWO-VOICE / DOCUMENT-AND-ATTRIBUTE, NOT SITE-VOICE ADVOCACY. These are contested geopolitical and
//   legal topics. Every contested claim on this surface is ATTRIBUTED to who holds it and carries a
//   source link. MELEK never asserts a contested position in its own voice. The page states:
//     (1) the international-law FRAMEWORK at issue (treaty text, tribunals, the tests),
//     (2) sourced FACTS with citations — and marks an ALLEGATION as an allegation, a verified FINDING
//         as a finding, never conflating the two,
//     (3) the competing POSITIONS, each explicitly attributed to the party that holds it.
//   Where sources conflict, both are shown with attribution. If a claim cannot be sourced, it is
//   omitted. A prior attempt to publish one-sided advocacy here was correctly blocked; the neutral,
//   attributed treatment is what ships. An agent tempted to "take a side," add a MELEK-voice verdict,
//   or drop the attribution scaffolding — stop. That is the failure mode this surface exists to avoid.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                 home — what this surface is, the discipline, the topic index
//   /reading          "how to read contested world-law claims" — the teaching page
//   /<topic-id>       one topic: framework at issue → sourced facts → attributed positions
//   /health /robots.txt /sitemap.xml /llms.txt
//
// House style mirrors site/law/server.mjs (nav, SEO, breadcrumb/FAQ JSON-LD, dark theme). This file is
// self-contained and does NOT edit site/law/server.mjs. Data lives in knowledge/civic/world-law.json.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8123);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LAW = process.env.LAW_SITE || 'https://law.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';

// ── data load (soft-fail; the surface renders even if the corpus file is missing) ─────────────────
const DATA_FILE = process.env.WORLD_LAW_DATA || join(HERE, '..', '..', 'knowledge', 'civic', 'world-law.json');

function loadData(file = DATA_FILE) {
  try {
    const raw = readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return normalizeData(obj);
  } catch { /* soft-fail to an empty, still-valid corpus */ }
  return normalizeData({});
}

// Guarantee the shape the renderers expect, whatever the file holds. PURE, never throws.
function normalizeData(input) {
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const topics = Array.isArray(obj.topics) ? obj.topics.filter((t) => t && t.id) : [];
  return {
    meta: obj.meta && typeof obj.meta === 'object' ? obj.meta : {},
    topics,
    reading_guide: obj.reading_guide && typeof obj.reading_guide === 'object' ? obj.reading_guide : null,
  };
}

// Loaded once at import; exported loader lets tests inject a fixture path.
export const DATASET = loadData();
export function topicById(id, data = DATASET) {
  return (data.topics || []).find((t) => t.id === id) || null;
}

// ── house-style helpers (dark theme; two-voice classes added on top of the Law palette) ───────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:22px 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
  blockquote{border-left:3px solid var(--line2);margin:10px 0;padding:6px 0 6px 14px;color:var(--fg);font-size:14px}
  blockquote cite{display:block;color:var(--mut);font-size:12px;font-style:normal;margin-top:6px}
  /* discipline banner */
  .disc{border:1px solid var(--gold);border-left:4px solid var(--gold);background:#d2992212;border-radius:8px;padding:12px 16px;margin:14px 0;font-size:14px}
  .disc b{color:var(--gold)}
  /* framework block */
  .frame{border:1px solid var(--blue);border-left:4px solid var(--blue);background:#1f6feb10;border-radius:8px;padding:14px 16px;margin:12px 0}
  .frame .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--blue);font-weight:700;margin-bottom:4px}
  /* provisions (treaty text) */
  .prov{border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:10px 0;background:#0b0f14}
  .prov .cite{font-weight:700;font-size:14px} .prov .src{font-size:12px;margin-top:8px}
  /* facts */
  .fact{padding:12px 0;border-bottom:1px solid var(--line)} .fact:last-child{border-bottom:0}
  .fact .body{font-size:14px} .fact .src{font-size:12px;color:var(--mut);margin-top:5px}
  .tag{font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-radius:8px;padding:1px 7px;margin-right:6px;font-weight:700;vertical-align:middle}
  .tag-fact{background:#3fb95022;color:var(--up)} .tag-finding{background:#1f6feb33;color:var(--blue)}
  .tag-allegation{background:#d2992233;color:var(--gold)} .tag-contested{background:#f8514922;color:var(--down)}
  /* positions — the attributed, two-voice core */
  .pos{border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:10px 0;background:var(--panel)}
  .pos .holder{font-weight:700;font-size:15px;color:var(--fg)}
  .pos .holder .who{color:var(--gold)}
  .pos .stance{color:var(--mut);font-size:12px;margin:2px 0 8px}
  .pos .summary{font-size:14px} .pos .src{font-size:12px;margin-top:8px}
  .steps{counter-reset:step} .step{border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:10px 0;background:var(--panel);position:relative}
  .step .n{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--blue);color:#06101f;font-weight:800;font-size:13px;margin-right:8px}
  .step .st{font-weight:700;font-size:15px} .step .sb{font-size:14px;color:var(--fg);margin-top:6px}
  ul.checklist{list-style:none;padding:0;margin:8px 0} ul.checklist li{padding:6px 0 6px 26px;position:relative;font-size:14px}
  ul.checklist li:before{content:"\\2713";position:absolute;left:0;color:var(--up);font-weight:800}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// The load-bearing discipline footer, on EVERY page.
const FOOTER = `<footer>
  <b>Documented and attributed — not advocacy.</b> World Law states the international-law framework at
  issue, sourced facts (an allegation is marked as an allegation, a verified finding as a finding), and
  the competing positions, <b>each attributed to the party that holds it</b>, with a source link. MELEK
  does not assert any contested position in its own voice. Where sources conflict, both are shown.
  Informational only — not legal advice.
  <div style="margin-top:8px"><a href="/">World Law</a> · <a href="/reading">How to read contested claims</a> · <a href="${LAW}">SoapBox Law</a> · <a href="${WIKI}">Library</a> · <a href="${DATA}">Data</a></div>
</footer>`;

// SEO <head> — delegates to the shared house helper (same OG/Twitter/JSON-LD as the other surfaces).
function page(title, body, opts = {}) {
  const desc = opts.description || 'World Law — a documentary reference on contested questions of international law: '
    + 'the framework at issue, sourced facts, and competing positions each attributed to who holds them. Not advocacy.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: 'MELEK World Law', ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  if (opts.jsonld) for (const j of [].concat(opts.jsonld)) if (j) extra.push(j);

  const seoHead = seoHeadTags({
    title, description: desc, canonical, robots, siteName: 'MELEK World Law',
    site: { url: BASE_URL, name: 'MELEK World Law' },
    jsonld: extra,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🌐 World <span>law</span></a>
  <div class=topbar-r>${navLinks()}<a href="/reading">How to read a claim</a><a href="${LAW}">U.S. Law</a><a href="${WIKI}">Library</a></div></header>
<main class=wrap>${body}${citeHtml}</main>
${FOOTER}</body></html>`;
}

// Top-nav topic links, built from the corpus (soft-fails to just Home if empty).
function navLinks(data = DATASET) {
  const links = (data.topics || []).map((t) =>
    `<a href="/${esc(t.id)}">${esc(t.navLabel || t.title)}</a>`).join('');
  return `<a href="/">Home</a>${links}`;
}

// ── renderers ─────────────────────────────────────────────────────────────────────────────────────

// The discipline banner, shown on the home page and atop every topic.
function disciplineBanner() {
  return `<div class=disc><b>How to read this page.</b> Each topic gives the international-law
    <b>framework</b> at issue, then <b>sourced facts</b> (an <span class="tag tag-allegation">allegation</span>
    is labelled as one; a <span class="tag tag-finding">finding</span> is a verified conclusion), then the
    <b>competing positions</b>, each attributed to who holds it. This surface documents and attributes —
    it does not take a side. <a href="/reading">How to read contested world-law claims →</a></div>`;
}

// A framework block (the international-law framework at issue).
function frameworkBlock(framework) {
  if (!framework) return '';
  const text = typeof framework === 'string' ? framework : (framework.text || framework.summary || '');
  const lbl = (framework && framework.label) || 'The framework at issue';
  if (!text) return '';
  return `<div class=frame><div class=lbl>${esc(lbl)}</div><div>${esc(text)}</div></div>`;
}

// A provision (verbatim treaty/tribunal text with an exact source). `quote:true` renders as a blockquote.
function provisionRow(p) {
  if (!p) return '';
  const cite = p.cite || p.title || '';
  const src = p.source_url
    ? `<div class=src><a href="${esc(p.source_url)}" rel=noopener>source: ${esc(p.source || p.source_url)} →</a></div>` : '';
  const bodyText = p.text || '';
  const body = p.quote
    ? `<blockquote>${esc(bodyText)}${p.source ? `<cite>— ${esc(p.source)}</cite>` : ''}</blockquote>`
    : `<div style="font-size:14px;margin-top:4px">${esc(bodyText)}</div>`;
  return `<div class=prov>${cite ? `<div class=cite>${esc(cite)}</div>` : ''}${body}${src}</div>`;
}

// A fact row. `kind` ∈ fact|finding|allegation|contested drives the label — the honesty gate.
const KIND_LABEL = { fact: 'Fact', finding: 'Finding', allegation: 'Allegation', contested: 'Contested' };
function factRow(f) {
  if (!f) return '';
  const kind = KIND_LABEL[f.kind] ? f.kind : 'fact';
  const tag = `<span class="tag tag-${kind}">${esc(KIND_LABEL[kind])}</span>`;
  const date = f.date ? `<span class=muted> (${esc(f.date)})</span>` : '';
  const src = f.source_url
    ? `<div class=src><a href="${esc(f.source_url)}" rel=noopener>${esc(f.source || 'source')} →</a></div>`
    : (f.source ? `<div class=src>${esc(f.source)}</div>` : '');
  return `<div class=fact><div class=body>${tag}${esc(f.text)}${date}</div>${src}</div>`;
}

// A position — attributed to WHO holds it. This is the two-voice core.
function positionRow(p) {
  if (!p) return '';
  const who = p.holder || p.who || 'Unattributed';
  const stance = p.stance ? `<div class=stance>${esc(p.stance)}</div>` : '';
  const src = p.source_url
    ? `<div class=src><a href="${esc(p.source_url)}" rel=noopener>source: ${esc(p.source || p.source_url)} →</a></div>`
    : (p.source ? `<div class=src>${esc(p.source)}</div>` : '');
  const attribution = p.attribution || 'holds:';
  return `<div class=pos><div class=holder><span class=who>${esc(who)}</span> <span class=muted style="font-weight:400;font-size:12px">${esc(attribution)}</span></div>${stance}<div class=summary>${esc(p.summary)}</div>${src}</div>`;
}

// ── home ────────────────────────────────────────────────────────────────────────────────────────
export function homePage(data = DATASET) {
  const topics = data.topics || [];
  const cards = topics.map((t) =>
    `<a class=sec href="/${esc(t.id)}"><div class=t>${esc(t.title)}</div><div class=d>${esc(t.blurb || '')}</div></a>`).join('');
  const body = `<h1>World Law <span class=muted style="font-size:14px">· contested questions, documented and attributed</span></h1>
    <p class=muted>Contested questions of international law — the law of occupation, humanitarian law, and the
      disputes built on them. For each topic: the <b>framework</b> at issue, <b>sourced facts</b>, and the
      <b>competing positions</b>, each attributed to who holds it. World Law documents and attributes; it
      does not take a side.</p>
    ${disciplineBanner()}
    <h2>Topics</h2>
    <div class=grid>${cards || '<p class=muted>No topics loaded.</p>'}</div>
    <div class=card><h2 style="margin-top:0">Start with the method</h2>
      <p class=muted style="font-size:14px">Before the topics, the teaching page shows how to read a contested
      world-law claim: primary sources vs. summaries, binding rulings vs. advisory opinions vs. political
      resolutions, and how to check whether an allegation has been verified.
      <a href="/reading">How to read contested world-law claims →</a></p></div>`;
  return page('World Law — contested questions of international law, documented and attributed', body, {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: 'World Law', url: `${BASE_URL}/` }],
    faq: HOME_FAQ,
    description: 'World Law — the framework at issue, sourced facts, and competing positions each attributed to '
      + 'who holds them, on contested questions of international law. Documented and attributed, not advocacy.',
  });
}

const HOME_FAQ = [
  { q: 'Does World Law take a side on these disputes?',
    a: 'No. World Law is a documentary reference. It states the international-law framework at issue, sourced '
     + 'facts, and the competing positions — each explicitly attributed to the party that holds it, with a '
     + 'source link. It does not assert any contested position in its own voice.' },
  { q: 'How does World Law handle allegations versus proven facts?',
    a: 'They are labelled differently and never conflated. A claim that has not been verified is marked as an '
     + 'allegation and attributed to who made it; a conclusion reached by an investigation or tribunal is '
     + 'marked as a finding and attributed to who found it. Where sources conflict, both are shown.' },
  { q: 'What sources does World Law use?',
    a: 'Primary sources wherever possible — treaty texts (the Geneva Conventions, the Hague Regulations), '
     + 'International Court of Justice opinions, UN resolutions and review reports, official government '
     + 'positions, and the parties’ own statements — plus reputable news reporting, each linked.' },
];

// ── topic page ───────────────────────────────────────────────────────────────────────────────────
export function topicView(topic) {
  if (!topic) return null;
  const provisions = Array.isArray(topic.provisions) && topic.provisions.length
    ? `<h2>${esc(topic.provisionsHeading || 'The text at issue')}</h2>${topic.provisions.map(provisionRow).join('')}` : '';
  const facts = Array.isArray(topic.facts) && topic.facts.length
    ? `<h2>Sourced facts</h2><div class=card>${topic.facts.map(factRow).join('')}</div>` : '';
  const positions = Array.isArray(topic.positions) && topic.positions.length
    ? `<h2>The competing positions</h2><p class=muted style="font-size:13px;margin-top:-4px">Each position below is
        attributed to the party that holds it. Inclusion is documentation, not endorsement.</p>${topic.positions.map(positionRow).join('')}` : '';
  const further = Array.isArray(topic.further_reading) && topic.further_reading.length
    ? `<div class=card><h3>Primary sources &amp; further reading</h3><ul style="margin:6px 0 0;padding-left:18px;font-size:14px">${
        topic.further_reading.map((r) => `<li><a href="${esc(r.url)}" rel=noopener>${esc(r.label || r.url)}</a>${r.note ? ` — ${esc(r.note)}` : ''}</li>`).join('')}</ul></div>` : '';
  return `<p class=muted><a href="/">← World Law</a></p>
    <h1>${esc(topic.title)}</h1>
    ${topic.blurb ? `<p class=muted>${esc(topic.blurb)}</p>` : ''}
    ${disciplineBanner()}
    ${frameworkBlock(topic.framework)}
    ${provisions}
    ${facts}
    ${positions}
    ${further}`;
}

// ── /reading — the "how to read a contested world-law claim" teaching page ─────────────────────────
export function readingView(guide = DATASET.reading_guide) {
  const g = guide || {};
  const steps = Array.isArray(g.steps) && g.steps.length
    ? `<div class=steps>${g.steps.map((s, i) =>
        `<div class=step><div class=st><span class=n>${i + 1}</span>${esc(s.title)}</div><div class=sb>${esc(s.body)}</div></div>`).join('')}</div>` : '';
  const checklist = Array.isArray(g.checklist) && g.checklist.length
    ? `<div class=card><h2 style="margin-top:0">${esc(g.checklistHeading || 'A quick checklist')}</h2><ul class=checklist>${
        g.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : '';
  const tiers = Array.isArray(g.authority_tiers) && g.authority_tiers.length
    ? `<h2>Binding vs. advisory vs. political — a quick key</h2><div class=card>${
        g.authority_tiers.map((t) => `<div class=fact><div class=body><b>${esc(t.name)}</b> — ${esc(t.what)}</div>${
          t.example ? `<div class=src>e.g. ${esc(t.example)}</div>` : ''}</div>`).join('')}</div>` : '';
  return `<p class=muted><a href="/">← World Law</a></p>
    <h1>${esc(g.title || 'How to read a contested world-law claim')}</h1>
    ${g.intro ? `<p class=muted>${esc(g.intro)}</p>` : ''}
    ${disciplineBanner()}
    ${steps}
    ${tiers}
    ${checklist}`;
}

// ── FAQ + reading page as sitemap/llms entries ────────────────────────────────────────────────────
function sitemapPaths(data = DATASET) {
  return ['/', '/reading', ...(data.topics || []).map((t) => `/${t.id}`)];
}

export function worldLawLlmsTxt(data = DATASET) {
  const base = llmsTxt({
    name: 'MELEK World Law', baseUrl: BASE_URL,
    summary: 'A documentary reference on contested questions of international law. For each topic: the '
      + 'framework at issue, sourced facts (allegations marked as allegations), and the competing positions, '
      + 'each attributed to who holds it. Documented and attributed, not advocacy.',
    links: [
      { label: 'How to read a contested world-law claim', path: '/reading', note: 'the method: primary sources, binding vs. advisory vs. political, checking an allegation' },
      ...(data.topics || []).map((t) => ({ label: t.title, path: `/${t.id}`, note: t.blurb || '' })),
    ],
  });
  const extra = [
    '## About this corpus',
    'World Law is a documentary surface, not a commentary or advocacy site. Every contested claim is '
      + 'attributed to the party that holds it and carries a source link; an allegation is labelled as an '
      + 'allegation and a verified finding as a finding. MELEK asserts no contested position in its own voice. '
      + 'Where sources conflict, both are presented with attribution.',
    '',
    '## How to cite',
    `Attribute pages as: MELEK World Law, ${BASE_URL} . For legal authority, cite the primary source each `
      + 'page links (the treaty article, the ICJ opinion, the UN resolution, the review report).',
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const crumbs = (name, path) => [
  { name: 'World Law', url: `${BASE_URL}/` },
  { name, url: `${BASE_URL}${path}` },
];

export async function handler(req, res, data = DATASET) {
  try {
    const url = new URL((req && req.url) || '/', BASE_URL);
    const raw = url.pathname;

    if (raw === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (raw === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (raw === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = sitemapPaths(data).map((u) => ({
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
      return res.end(worldLawLlmsTxt(data));
    }

    if (raw === '/') return sendHtml(res, homePage(data));

    if (raw === '/reading') {
      return sendHtml(res, page('How to read a contested world-law claim — World Law', readingView(data.reading_guide), {
        canonical: `${BASE_URL}/reading`, breadcrumb: crumbs('How to read a claim', '/reading'),
        cite: { title: 'How to read a contested world-law claim', url: `${BASE_URL}/reading`, author: 'MELEK World Law' },
      }));
    }

    // /<topic-id>
    const id = raw.replace(/^\/+/, '').replace(/\/+$/, '');
    const topic = topicById(id, data);
    if (topic) {
      const view = topicView(topic);
      return sendHtml(res, page(`${topic.title} — World Law`, view, {
        canonical: `${BASE_URL}/${topic.id}`,
        breadcrumb: crumbs(topic.title, `/${topic.id}`),
        description: topic.blurb || undefined,
        cite: {
          title: topic.title, url: `${BASE_URL}/${topic.id}`, author: 'MELEK World Law',
          sourceOfRecord: topic.source_of_record || 'the primary sources linked on this page',
        },
      }));
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
export { page, loadData, normalizeData, disciplineBanner, frameworkBlock, factRow, positionRow, provisionRow, sitemapPaths, HOME_FAQ };

// Only bind the port when run directly.
if (process.argv[1] && /world-law\/server\.mjs$/.test(process.argv[1])) {
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    console.log(`World Law on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
