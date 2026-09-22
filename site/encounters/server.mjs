// server.mjs — Faux Law Files (encounters.soapbox / hathor.live/encounters). The pop-culture front
// door to the legal library: a curated, browsable gallery of real "sovereign citizen" / pseudolaw
// encounter videos — the entertainment hook everyone already searches for ("window broken," "owned in
// court") — with every clip sat next to the REAL law it misreads and a link into the live /doctrines
// page. Entertainment AND education: we own the destination instead of scattering five warning links.
//
//   PORT=8110 BASE_URL=https://encounters.soapbox.community node site/encounters/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the gallery — videos grouped by category, each with its real-law teaching note
//   /health      liveness probe
//   /robots.txt /sitemap.xml /llms.txt
//
// ── DISCIPLINE (inherited from the Law surface) ───────────────────────────────────────────────────
//   Neutral and factual, never mockery — source titles may be lurid; our copy is not. Every embed
//   credits its source channel/publication. NO fabricated video ids: every url in encounters.json was
//   verified to exist before it was added (charter §3 — prove, don't claim). Privacy-friendly:
//   youtube-nocookie.com embeds, lazy-loaded, so no cookie is set until the viewer presses play.
//   Soft-fail: a missing/empty data file renders an empty-state page; the server never throws.
//
// House style: ESM, esc() every interpolation, handler(req,res) exported for offline tests, CLI guarded
// by the process.argv[1] check, PORT/BASE_URL from env, injectable data seam (__setData) — no network.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags as seoHeadTags, breadcrumbJsonLd, faqJsonLd, citationBlock } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8110);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LAW = (process.env.LAW_SITE || 'https://law.soapbox.community').replace(/\/$/, '');
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const OVERSIGHT = process.env.OVERSIGHT_SITE || 'https://oversight.soapbox.community';
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';

const SITE_TITLE = 'Faux Law Files';

// ── house-style helpers (same dark theme as Law / Stocks / Search) ────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

// ── the categories, in display order. Each carries the section name and the plain-language HOOK that
// names the real doctrine the clips in it misread; the per-video real_law / doctrine_link in the data
// sharpen it clip-by-clip. Category ids match the "category" field in knowledge/civic/encounters.json.
export const CATEGORIES = [
  {
    id: 'window-breaking',
    name: 'Window-breaking & refusal to comply',
    hook: 'The theory: you can refuse a lawful order at a traffic stop because you never "consented." '
      + 'The reality: a lawful stop does not need your consent, and there is no right to resist it — '
      + 'refusing a lawful command is what turns a ticket into a broken window and an arrest.',
    real_law: 'A stop supported by reasonable suspicion is lawful without consent (Terry v. Ohio; '
      + 'Pennsylvania v. Mimms lets an officer order you out of the car); there is no lawful right to '
      + 'resist it.',
    doctrine_link: `${LAW}/rights`,
  },
  {
    id: 'traveling-not-driving',
    name: '"Traveling, not driving" traffic stops',
    hook: 'The theory: driving is a "right to travel" the state cannot license, so you need no licence '
      + 'or registration. The reality: the right to interstate travel is real, but it has never '
      + 'exempted anyone from a neutral licensing law — states may require a driver licence under their '
      + 'police power.',
    real_law: 'States may require driver licences and registration under their police power '
      + '(Hendrick v. Maryland, 235 U.S. 610 (1915)). The right to travel (Saenz v. Roe) is about '
      + 'moving between states, not a personal exemption from traffic law.',
    doctrine_link: `${LAW}/doctrines#commerce-power`,
  },
  {
    id: 'courtroom-antics',
    name: 'Courtroom antics & "jurisdiction"',
    hook: 'The theory: refuse to give your name, appear "specially," or say the court has no '
      + 'jurisdiction and the case evaporates. The reality: courts reject these arguments summarily '
      + 'and hold the speaker in contempt — a real court has jurisdiction whether or not you consent to it.',
    real_law: 'Courts reject sovereign-citizen jurisdiction arguments "summarily, however they are '
      + 'presented" (United States v. Benabe, 654 F.3d 753 (7th Cir. 2011)); they have "no conceivable '
      + 'validity in American law" (United States v. Sterling, 738 F.3d 228 (11th Cir. 2013)).',
    doctrine_link: `${LAW}/doctrines#judicial-review`,
  },
  {
    id: 'irs-untax',
    name: 'IRS & tax "untax" schemes',
    hook: 'The theory: the income tax is "voluntary," wages are not "income," or the 16th Amendment '
      + 'was never ratified. The reality: every version has been ruled frivolous, and acting on it is '
      + 'how people end up convicted of tax crimes.',
    real_law: 'The 16th Amendment authorises the income tax; "wages aren\'t income" and "the tax is '
      + 'voluntary" are frivolous (United States v. Sloan, 939 F.2d 499 (7th Cir. 1991); the IRS '
      + 'catalogs them in "The Truth About Frivolous Tax Arguments"). A sincere belief is no defence '
      + 'to willfulness (Cheek v. United States, 498 U.S. 192 (1991)).',
    doctrine_link: `${LAW}/doctrines`,
  },
  {
    id: 'strawman-a4v',
    name: '"Strawman" & Accepted-for-Value at the counter',
    hook: 'The theory: a secret government "strawman" account tied to your birth certificate lets you '
      + 'pay debts by "accepting them for value" or filing bogus bonds. The reality: there is no such '
      + 'account; these instruments are worthless, and filing them is prosecuted as fraud.',
    real_law: 'There is no "strawman" Treasury account; "redemption" / A4V / 1099-OID instruments are '
      + 'fictitious, and passing them or filing bogus liens is fraud (see the FBI\'s "redemption / '
      + 'strawman" scheme warnings and numerous federal convictions).',
    doctrine_link: `${LAW}/doctrines#judicial-review`,
  },
  {
    id: 'give-me-your-supervisor',
    name: '"Am I being detained?" & demanding officials',
    hook: 'The theory: demand the officer\'s oath of office, badge number, or supervisor, and keep '
      + 'asking "am I being detained?" until the encounter becomes a "contract" you can void. The '
      + 'reality: an officer with reasonable suspicion may detain and require identification in many '
      + 'states, and none of these demands dissolve that authority.',
    real_law: 'Brief investigative detention on reasonable suspicion is lawful (Terry v. Ohio, 392 U.S. '
      + '1 (1968)); a state may require identification during such a stop (Hiibel v. Sixth Judicial '
      + 'District Court, 542 U.S. 177 (2004)).',
    doctrine_link: `${LAW}/rights`,
  },
];
const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// ── data seam (injectable for offline tests) ──────────────────────────────────────────────────────
const DATA_PATH = fileURLToPath(new URL('../../knowledge/civic/encounters.json', import.meta.url));
let DATA_OVERRIDE = null;
/** Test hook: inject an array of video records (or null to fall back to the JSON file). */
export function __setData(arr) { DATA_OVERRIDE = Array.isArray(arr) ? arr : null; }

/** Load the video records. Soft-fail: any error returns []. */
export function loadEncounters() {
  if (DATA_OVERRIDE) return DATA_OVERRIDE;
  try {
    const j = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
    return Array.isArray(j) ? j : (Array.isArray(j && j.videos) ? j.videos : []);
  } catch { return []; }
}

// ── theme (mirrors site/law/server.mjs) ───────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:1040px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .jump{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
  .jump a{font-size:13px;border:1px solid var(--line2);border-radius:20px;padding:5px 12px;color:var(--mut)}
  .jump a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  section.cat{margin:26px 0 8px;scroll-margin-top:64px}
  .cat-head{border-left:3px solid var(--gold);padding:2px 0 2px 14px;margin:0 0 12px}
  .cat-hook{color:var(--mut);font-size:14px;margin:6px 0 0}
  .teach{border:1px solid var(--line2);border-radius:10px;background:#0b0f14;padding:12px 14px;margin:0 0 16px;font-size:14px;line-height:1.6}
  .teach b{color:var(--gold)} .teach .real{color:var(--fg)} .teach a{font-weight:600}
  .vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
  .vcard{background:var(--panel);border:1px solid var(--line2);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
  .vframe{position:relative;width:100%;aspect-ratio:16/9;background:#0b0f14;border-bottom:1px solid var(--line)}
  .vframe iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
  .vbody{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
  .vtitle{font-weight:600;font-size:15px;line-height:1.35}
  .vsrc{font-size:12px;color:var(--mut)}
  .vblurb{font-size:13px;color:var(--mut);line-height:1.55}
  .vteach{font-size:12px;color:var(--fg);line-height:1.5;border-top:1px solid var(--line);padding-top:8px;margin-top:2px}
  .vteach b{color:var(--gold)}
  .vlink{font-size:13px;margin-top:2px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .badge.article{background:#d2992233;color:var(--gold)}
  .artcard .vframe{display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:13px;text-align:center;padding:14px}
  .empty{color:var(--mut);padding:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_TITLE)}</b> — a public-education project of SoapBox / MELEK. Entertaining clips, real law.
  We curate publicly posted footage and reporting to teach the doctrines that "sovereign citizen"
  pseudolaw misreads; each clip is embedded from and credited to its source. Neutral and factual, not
  mockery — shown to document what actually happens, not to ridicule anyone. Informational only, not
  legal advice; for advice, consult a licensed attorney. Believe a clip is misattributed or want it
  removed? Corrections route to the source of record.
  <div style="margin-top:8px"><a href="/">Faux Law Files</a> · <a href="${LAW}/doctrines">Real doctrines</a> · <a href="${LAW}/rights">Your rights</a> · <a href="${LAW}">Law</a> · <a href="${OVERSIGHT}">Oversight</a> · <a href="${WIKI}">Library</a> · <a href="${DATA}">Data</a></div>
</footer>`;

// ── FAQ (visible AND emitted as FAQPage JSON-LD — the pairs match) ─────────────────────────────────
const FAQ = [
  { q: 'What is a "sovereign citizen"?',
    a: 'A person who believes, on the basis of pseudolegal theories, that they are not subject to most '
     + 'laws unless they personally consent. The theories have never prevailed in a U.S. court. This '
     + 'page collects real footage of these encounters and pairs each one with the actual law it misreads.' },
  { q: 'Are these videos making fun of people?',
    a: 'No. The clips are entertaining and that is the honest hook, but the purpose is education. Each '
     + 'is shown to document what actually happens and is placed next to the real doctrine — the point '
     + 'is that the real law is stronger than the "secret" being sold, not that anyone is stupid.' },
  { q: 'Where do the videos come from?',
    a: 'They are embedded from their original sources — YouTube channels that cover these encounters and '
     + 'mainstream news, body-cam and court footage — and each is credited. YouTube clips use the '
     + 'privacy-preserving youtube-nocookie player, so no tracking cookie is set until you press play.' },
  { q: 'Is any of this legal advice?',
    a: 'No. Faux Law Files is legal information and education. It explains the doctrines that decide '
     + 'these cases and links the landmark authority you can read yourself; for advice about your own '
     + 'situation, consult a licensed attorney.' },
];

function faqCard(pairs, heading = 'Frequently asked questions') {
  const items = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.q && p.a);
  if (!items.length) return '';
  return `<div class=card style="margin-top:18px"><h2>${esc(heading)}</h2>${items.map((p) =>
    `<details style="margin:0 0 8px"><summary style="cursor:pointer;font-weight:600">${esc(p.q)}</summary>`
    + `<p class=muted style="margin:8px 0 0;font-size:14px">${esc(p.a)}</p></details>`).join('')}</div>`;
}

// ── one video card. Soft-fails on bad records (skips embed, keeps the link). ───────────────────────
function videoCard(v) {
  if (!v || typeof v !== 'object') return '';
  const title = esc(v.title || 'Untitled clip');
  const source = v.source ? `<div class=vsrc>Source: ${esc(v.source)}</div>` : '';
  const blurb = v.blurb ? `<div class=vblurb>${esc(v.blurb)}</div>` : '';
  const isYt = (v.kind === 'youtube' || (!v.kind && v.youtube_id)) && v.youtube_id && /^[\w-]{11}$/.test(String(v.youtube_id));
  const link = v.url ? `<div class=vlink><a href="${esc(v.url)}" rel="nofollow noopener" target="_blank">Watch at source →</a></div>` : '';
  // per-clip education line: the specific real law this clip misreads, linking the real doctrine.
  const teach = v.real_law
    ? `<div class=vteach><b>Misreads:</b> ${esc(v.real_law)}${v.doctrine_link ? ` <a href="${esc(v.doctrine_link)}">the real law →</a>` : ''}</div>`
    : '';

  if (isYt) {
    const embed = `https://www.youtube-nocookie.com/embed/${esc(v.youtube_id)}`;
    return `<div class=vcard><div class=vframe>
      <iframe loading="lazy" src="${embed}" title="${title}" allow="accelerometer;clipboard-write;encrypted-media;gyroscope;picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
    </div><div class=vbody>
      <div class=vtitle>${title}<span class=badge>video</span></div>${source}${blurb}${teach}${link}
    </div></div>`;
  }
  // article / news-clip: no autoplay iframe, a captioned link card instead
  return `<div class="vcard artcard"><div class=vframe>Article &amp; clip — opens at the source</div>
    <div class=vbody>
      <div class=vtitle>${title}<span class="badge article">article</span></div>${source}${blurb}${teach}${link}
    </div></div>`;
}

// ── the gallery page ──────────────────────────────────────────────────────────────────────────────
export function galleryBody() {
  const all = loadEncounters();
  // group by category, preserving CATEGORIES order; unknown categories fall into their own trailing group
  const byCat = new Map(CATEGORIES.map((c) => [c.id, []]));
  for (const v of all) {
    if (!v || !v.category) continue;
    if (!byCat.has(v.category)) byCat.set(v.category, []);
    byCat.get(v.category).push(v);
  }
  const total = all.length;

  const jump = CATEGORIES.filter((c) => (byCat.get(c.id) || []).length)
    .map((c) => `<a href="#${esc(c.id)}">${esc(c.name)} <span class=muted>(${(byCat.get(c.id) || []).length})</span></a>`).join('');

  const sections = CATEGORIES.map((c) => {
    const vids = byCat.get(c.id) || [];
    if (!vids.length) return '';
    const cards = vids.map(videoCard).join('');
    return `<section class=cat id="${esc(c.id)}">
      <div class=cat-head><h2>${esc(c.name)}</h2><p class=cat-hook>${esc(c.hook)}</p></div>
      <div class=teach><b>The real law:</b> <span class=real>${esc(c.real_law)}</span>
        <a href="${esc(c.doctrine_link)}">Read the real doctrine →</a></div>
      <div class=vgrid>${cards}</div>
    </section>`;
  }).join('');

  const intro = `<h1>${esc(SITE_TITLE)} <span class=muted style="font-size:14px">· pseudolaw on camera, and the real law it misreads</span></h1>
    <p class=muted>Everyone has watched the clips — the smashed window, the "I do not consent," the guy
      "traveling, not driving." They are genuinely entertaining. They are also a teaching opportunity: every
      one of these "sovereign citizen" moves is a <b>misreading of a real piece of law</b>. Here each clip
      sits next to the doctrine it gets wrong, with a link to read that doctrine in full at
      <a href="${LAW}/doctrines">law.soapbox.community/doctrines</a>. Watch for the entertainment; leave
      knowing why the real law is stronger than the "secret" being sold.</p>
    <div class=card style="border-color:var(--gold)"><p style="margin:0;font-size:14px">
      <b>How to use this page:</b> browse a category, watch a clip, then read “the real law” note above each
      grid — it names the doctrine and links the landmark case you can pull yourself. This is a front door to
      the <a href="${LAW}">SoapBox legal library</a>, not legal advice.</p></div>
    ${jump ? `<div class=jump>${jump}</div>` : ''}`;

  const grid = sections || `<div class=card><p class=empty>The clip library is being assembled — check back shortly.</p></div>`;
  return `${intro}${grid}${faqCard(FAQ)}`;
}

// ── /llms.txt ─────────────────────────────────────────────────────────────────────────────────────
export function encountersLlmsTxt() {
  const base = llmsTxt({
    name: SITE_TITLE, baseUrl: BASE_URL,
    summary: 'A curated gallery of real "sovereign citizen" / pseudolaw encounter videos, each paired '
      + 'with the actual legal doctrine it misreads and a link to the SoapBox Law doctrine reference. '
      + 'Entertainment as a front door to legal education. Neutral and factual, not mockery.',
    links: CATEGORIES.map((c) => ({ label: c.name, path: `/#${c.id}` }))
      .concat([{ label: 'Real legal doctrines', path: `${LAW}/doctrines` }]),
  });
  const extra = [
    '## About this corpus',
    'Each video is embedded from and credited to its original source (a YouTube channel, news outlet, '
      + 'body-cam release, or court recording). Every clip is placed next to the real legal doctrine it '
      + 'misreads, with the landmark case cited. The purpose is education, not ridicule.',
    '',
    '## The through-line',
    'Sovereign-citizen theory has never prevailed in a U.S. court. Each "doctrine" (the strawman, '
      + '"traveling not driving," the income tax being "voluntary," court "jurisdiction" tricks) is a '
      + 'misreading of a real piece of law — and the real law, explained at ' + LAW + '/doctrines, is '
      + 'more powerful than the secret being sold.',
    '',
    '## How to cite',
    `Attribute this page as: ${SITE_TITLE} (SoapBox), ${BASE_URL} . Cite individual clips to their `
      + 'original source (linked on each card). For legal authority, cite the landmark case named in the '
      + 'doctrine note, or the SoapBox Law doctrine page it links to.',
    '',
    '## Usage',
    'All crawlers, including AI/LLM crawlers, are welcome (see /robots.txt). This is public-interest '
      + 'legal-education content intended to be quoted and cited.',
    '',
  ].join('\n');
  return `${base}\n${extra}`;
}

// ── page shell (SEO head + nav + footer) ──────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Faux Law Files — real "sovereign citizen" encounter videos (window-breaking, "traveling not '
     + 'driving," courtroom antics, tax "untax" schemes, strawman/A4V), each paired with the real law it '
     + 'misreads. Entertainment and legal education from SoapBox.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';

  const extra = [];
  const bc = Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null;
  if (bc) extra.push(bc);
  const faq = Array.isArray(opts.faq) && opts.faq.length ? faqJsonLd(opts.faq) : null;
  if (faq) extra.push(faq);
  let citeHtml = '';
  if (opts.cite && typeof opts.cite === 'object') {
    const cb = citationBlock({ publisher: 'SoapBox', ...opts.cite });
    citeHtml = cb.html;
    if (cb.jsonld) extra.push(cb.jsonld);
  }
  if (opts.jsonld) for (const j of [].concat(opts.jsonld)) if (j) extra.push(j);

  const seoHead = seoHeadTags({
    title, description: desc, canonical, robots, siteName: SITE_TITLE,
    site: { url: BASE_URL, name: SITE_TITLE },
    jsonld: extra,
  });

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoHead}${STYLE}</head><body>
<header class=topbar><a class=brand href="/">⚖ ${esc(SITE_TITLE)} <span>pseudolaw on camera</span></a>
  <div class=topbar-r><a href="${LAW}/doctrines">Real doctrines</a><a href="${LAW}/rights">Your rights</a><a href="${LAW}">Law</a><a href="${WIKI}">Library</a></div></header>
<main class=wrap>${body}${citeHtml}</main>
${FOOTER}</body></html>`;
}

export function homePage() {
  return page(`${SITE_TITLE} — sovereign-citizen encounters, and the real law they misread`, galleryBody(), {
    canonical: `${BASE_URL}/`,
    breadcrumb: [{ name: SITE_TITLE, url: `${BASE_URL}/` }],
    faq: FAQ,
    cite: {
      title: `${SITE_TITLE} — pseudolaw on camera, and the real law it misreads`,
      url: `${BASE_URL}/`, author: 'SoapBox', publisher: 'SoapBox',
      type: 'CollectionPage',
    },
  });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = ['/'];

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
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (raw === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (raw === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(encountersLlmsTxt());
    }

    if (raw === '/' || raw === '') return sendHtml(res, homePage());

    // unknown → home (302), same posture as the Law surface
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose category metadata for tests / sibling surfaces
export const _internal = { CATEGORIES, CATEGORY_BY_ID, DATA_PATH };

// CLI guard — only bind a port when run directly (never during offline tests / imports).
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/encounters\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`${SITE_TITLE} on http://${HOST}:${PORT}  (BASE_URL=${BASE_URL})`);
  });
}
