// server.mjs — the Library of Ashurbanipal, served. A page factory over the (faithful, fact-checked)
// articles the Ashurbanipal bot produces. Server-rendered for SEO; read-only; no keys. Shows each
// article's provenance (References), its Coverage note, and any FACT-CHECK FLAGS recorded for the KB
// sources it cites — so a reader sees what's disputed instead of trusting it blindly.
//
//   ARTICLES_DIR=../../library-of-ashurbanipal-bot/generated-articles node site/wiki/server.mjs
//   PORT=8090 BASE_URL=https://wiki.soapbox.community node site/wiki/server.mjs

import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout, renderWiki, esc, slugify, titleize, tocAside } from './render.mjs';
import { groupArticles, groupArticlesByPillars, categoriesFor, categoryById, PILLARS } from './categories.mjs';
import { robotsTxt, INDEXNOW_KEY, submitToIndexNow, pingSitemap, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ARTICLES_DIR = process.env.ARTICLES_DIR || path.join(__dir, '..', '..', 'library-of-ashurbanipal-bot', 'generated-articles');
const SEED_DRAFTS_DIR = path.join(__dir, '..', '..', 'library-of-ashurbanipal-bot', 'seed-drafts');
const FLAG_STORE = process.env.KB_FLAG_STORE || path.join(__dir, '..', '..', 'library-of-ashurbanipal-bot', 'data', 'kb-flags.json');

// privacy filter: only publish .wiki files; never anything from a private/sensitive list. The KB
// itself has private domains (scripture, operator material) — those are never turned into articles,
// but this is a second gate at the publish layer.
const PRIVATE = /(_private|secret|operator|\.local|scripture)/i;
// Article sources, first match wins per slug: the bot's generated articles (ARTICLES_DIR), then the articles
// committed with the site (how our tools work, MELEK, Hathor…), the seed articles, and finally seed drafts.
const ARTICLE_DIRS = [ARTICLES_DIR, path.join(__dir, 'articles'), path.join(__dir, 'seed-articles'), SEED_DRAFTS_DIR];
// Wiki images (the Metatron GenAI graphics) are served from here via the /files/ route. Serving code
// only — article text is untouched. Generated images live in site/wiki/files/.
const FILES_DIR = process.env.WIKI_FILES_DIR || path.join(__dir, 'files');
const IMG_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
function listArticles() {
  const seen = new Set(); const out = [];
  for (const dir of ARTICLE_DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.wiki') && !PRIVATE.test(f)).sort(); } catch { continue; }
    for (const f of files) {
      const slug = slugify(f);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, title: titleize(f.replace(/\.wiki$/, '')), file: path.join(dir, f) });
    }
  }
  return out;
}
function readArticle(slug) {
  const arts = listArticles();
  const direct = arts.find((x) => x.slug === slug);
  if (direct) {
    try { return { ...direct, text: fs.readFileSync(direct.file, 'utf8') }; } catch { return null; }
  }
  const clean = String(slug || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
  const fuzzy = arts.find((x) => String(x.slug).toLowerCase().replace(/[^a-z0-9]/gi, '') === clean);
  if (fuzzy) {
    try { return { ...fuzzy, text: fs.readFileSync(fuzzy.file, 'utf8') }; } catch { return null; }
  }
  return null;
}
function loadFlags() { try { return JSON.parse(fs.readFileSync(FLAG_STORE, 'utf8')); } catch { return { byFile: {} }; } }

function flagsForArticle(refs) {
  const db = loadFlags();
  const out = [];
  for (const f of refs) for (const fl of (db.byFile?.[f]?.flags || [])) out.push({ file: f, ...fl });
  return out;
}

// First real prose paragraph of an article, for meta description / og / JSON-LD. Strips the bot
// preamble, MediaWiki markup, headers, lists and refs; clamps to ~200 chars on a word boundary.
function articleDescription(text, fallbackTitle) {
  let t = String(text || '').replace(/^[\s\S]*?presents the following wiki article:\s*-*\s*/i, '');
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(=|\*|#|\|)/.test(line)) continue;            // headers, lists, table rows
    const plain = line
      .replace(/<ref>[^<]*<\/ref>/gi, '')                // drop citations
      .replace(/'''?(.+?)'''?/g, '$1')                   // bold/italic
      .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')        // [[link|text]]
      .replace(/\[\[([^\]]+)\]\]/g, '$1')                 // [[link]]
      .replace(/\s+/g, ' ').trim();
    if (plain.length < 30) continue;
    if (plain.length <= 200) return plain;
    return plain.slice(0, 200).replace(/\s+\S*$/, '') + '…';
  }
  return `${fallbackTitle} — an article in the Library of Ashurbanipal.`;
}

// Best-effort publication date (ISO yyyy-mm-dd) from the article file's mtime. Returns '' on error
// so the JSON-LD simply omits datePublished rather than asserting a fabricated date.
function articleDate(file) {
  try { return fs.statSync(file).mtime.toISOString().slice(0, 10); } catch { return ''; }
}

function articlePage(slug) {
  const a = readArticle(slug);
  if (!a) return { code: 404, html: layout({ title: 'Not found', body: `<h1>Not found</h1><p class=muted>No article "${esc(slug)}". <a href="/">← Library</a></p>` }) };
  const { html, refs, footnotes, toc } = renderWiki(a.text);
  const flags = flagsForArticle(refs);
  const flagBlock = flags.length ? `<div class=flag><b>⚠️ Fact-check flags (${flags.length})</b> — the knowledge base sources for this article contain claims our fact-checker could not verify against external reality. Treat the following with caution:
    <ul>${flags.slice(0, 10).map((f) => `<li>[${esc(f.verdict)}] ${esc(f.claim)}${f.reason ? ` — <span class=muted>${esc(f.reason)}</span>` : ''}</li>`).join('')}</ul></div>` : '';
  // description: first prose paragraph of the rendered article, trimmed for og:/meta/JSON-LD.
  const descText = articleDescription(a.text, a.title);
  const url = `${BASE_URL}/wiki/${a.slug}`;
  // schema.org Article. datePublished is best-effort from the file mtime; omitted (not faked) if
  // unavailable. No {placeholder} tokens here, and safeJsonLd() strips any that slip through.
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: descText,
    url,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: 'Library of Ashurbanipal' },
    publisher: { '@type': 'Organization', name: 'Van Kush Family Research Institute' },
    isPartOf: { '@type': 'CreativeWorkSeries', name: 'Library of Ashurbanipal' },
  };
  const datePublished = articleDate(a.file);
  if (datePublished) jsonld.datePublished = datePublished;
  // breadcrumbs: Library › <first real category> › <title> — orients a reader who arrived deep-linked.
  const catIds = categoriesFor(a.title).filter((c) => c !== 'other');
  const cat = catIds.length ? categoryById(catIds[0]) : null;
  const crumbs = `<a href="/">Library</a><span class=sep>›</span>${cat ? `<a href="/category/${esc(cat.id)}">${esc(cat.name)}</a><span class=sep>›</span>` : ''}${esc(a.title)}`;
  // "filed under" category chips at the foot of the article — lateral navigation.
  const chipIds = categoriesFor(a.title);
  const chips = `<p style="margin-top:28px"><span class=faint style="font-family:system-ui,sans-serif;font-size:12px">Filed under &nbsp;</span>${chipIds.map((id) => { const g = categoryById(id) || { id, name: id }; return `<a class=chip href="/category/${esc(g.id)}">${esc(g.name)}</a>`; }).join('')}</p>`;
  const topToc = tocAside(toc);
  const body = `<h1>${esc(a.title)}<span class=lede-rule aria-hidden=true></span></h1>${flagBlock}${html}${footnotes}${chips}`;
  return { code: 200, html: layout({ title: a.title, description: descText, canonical: url, jsonld, ogType: 'article', body, toc: topToc, crumbs }) };
}

// "Start here" — the newcomer's learning path, surfaced above the A–Z list so the Library actually
// teaches what MELEK / SoapBox is. Each entry links to an article on this wiki (by slug) or a live surface.
const STARTERS = [
  { slug: 'MELEK', label: 'MELEK', blurb: 'The social blockchain — post, vote, earn.' },
  { slug: 'SoapBox', label: 'SoapBox', blurb: 'The whole ecosystem of apps, mapped.' },
  { slug: 'PRANA', label: 'PRANA', blurb: 'The compute chain you mine with a laptop.' },
  { slug: 'KULA', label: 'KULA', blurb: 'The DeFi layer — DEX, collateral, stable.' },
];

function indexPage() {
  const arts = listArticles();
  const have = new Set(arts.map((a) => a.slug));
  const starters = STARTERS.filter((s) => have.has(s.slug));
  const startBlock = starters.length ? `<div class=pylon>
      <h2 style="margin:0 0 4px;border:0;padding:0">Start here — newcomer orientation</h2>
      <p class=muted style="margin:0 0 12px;font-size:14px">New to the ecosystem? These four foundational pillars explain MELEK, SoapBox, compute, and DeFi. Then explore the complete research library below or browse <a href="/categories">all categories</a>.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">${starters.map((s) => `<a href="/wiki/${s.slug}" style="display:block;padding:11px 13px;border:1px solid var(--line2);border-radius:9px;text-decoration:none;background:var(--panel)"><b style="display:block;color:var(--link)">${esc(s.label)}</b><span style="font-size:13px;color:var(--mut)">${esc(s.blurb)}</span></a>`).join('')}</div>
    </div>` : '';

  const pillars = groupArticlesByPillars(arts);
  const total = arts.length;

  // High-Level Knowledge Pillars Directory Cards (Clean, high-level map of the Library)
  const pillarCardsHtml = `<div class="pillar-overview" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:22px 0">
    ${pillars.map((p) => `
      <a class="pillar-card" href="#pillar-${esc(p.id)}" onclick="selectPillar('${esc(p.id)}');event.preventDefault();location.hash='pillar-${esc(p.id)}';document.getElementById('pillar-${esc(p.id)}').scrollIntoView({behavior:'smooth'})">
        <h3><span>${p.icon} ${esc(p.name)}</span> <span class="chip" style="font-size:11px;padding:2px 8px;margin:0">${p.items.length}</span></h3>
        <p>${esc(p.blurb)}</p>
      </a>
    `).join('')}
  </div>`;

  // Interactive Pillar Filter Tabs (Sticky bar)
  const pillarTabsHtml = `<div class="pillar-nav" style="margin:22px 0 14px;display:flex;flex-wrap:wrap;gap:7px;align-items:center">
    <span class="faint" style="font-size:12.5px;font-family:system-ui,sans-serif;font-weight:600;margin-right:4px">Filter by domain:</span>
    <button class="pill-btn active" id="btn-all" onclick="selectPillar('all')">🌐 All Knowledge (${total})</button>
    ${pillars.map((p) => `<button class="pill-btn" id="btn-${esc(p.id)}" onclick="selectPillar('${esc(p.id)}')">${p.icon} ${esc(p.name.split('&')[0].trim())} (${p.items.length})</button>`).join('')}
  </div>`;

  // Pillar Sections with Full Article Grids
  const pillarSectionsHtml = pillars.map((p) => `
    <section class="pillar-block" id="pillar-${esc(p.id)}" data-pillar="${esc(p.id)}" style="margin:36px 0;scroll-margin-top:80px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid var(--line2);padding-bottom:6px;margin-bottom:12px">
        <h2 style="margin:0;font-size:22px;border:0;padding:0"><span style="margin-right:8px">${p.icon}</span>${esc(p.name)}</h2>
        <span class="muted" style="font-size:13px;font-weight:600">${p.items.length} articles</span>
      </div>
      <p class="muted" style="margin:0 0 14px;font-size:14px">${esc(p.blurb)}</p>
      <div class="grid">${p.items.map((a) => `<a href="/wiki/${esc(a.slug)}" class="article-link" data-title="${esc(a.title.toLowerCase())}">${esc(a.title)}</a>`).join('')}</div>
    </section>
  `).join('');

  // Interactive Client-Side Search and Pillar Filter
  const clientScript = `<script>
    function selectPillar(id) {
      document.querySelectorAll('.pill-btn').forEach(function(b) { b.classList.remove('active'); });
      var targetBtn = document.getElementById('btn-' + id);
      if (targetBtn) targetBtn.classList.add('active');
      var blocks = document.querySelectorAll('.pillar-block');
      blocks.forEach(function(b) {
        if (id === 'all' || b.getAttribute('data-pillar') === id) {
          b.style.display = '';
        } else {
          b.style.display = 'none';
        }
      });
    }

    function filterWiki(q) {
      var term = (q || '').trim().toLowerCase();
      var links = document.querySelectorAll('.article-link');
      var countEl = document.getElementById('matchCount');
      if (!term) {
        links.forEach(function(l) { l.style.display = ''; });
        document.querySelectorAll('.pillar-block').forEach(function(b) { b.style.display = ''; });
        if (countEl) countEl.textContent = '';
        return;
      }
      var matches = 0;
      links.forEach(function(l) {
        var hit = (l.getAttribute('data-title') || '').indexOf(term) !== -1;
        l.style.display = hit ? '' : 'none';
        if (hit) matches++;
      });
      document.querySelectorAll('.pillar-block').forEach(function(b) {
        var visible = b.querySelectorAll('.article-link:not([style*="display: none"])');
        b.style.display = visible.length ? '' : 'none';
      });
      if (countEl) countEl.textContent = matches + (matches === 1 ? ' match' : ' matches');
    }
  </script>`;

  const body = `<h1>The Library of Ashurbanipal<span class=lede-rule aria-hidden=true></span></h1>
    <p class=muted>The Van Kush Family Research Institute knowledge base, synthesized into verified reference articles across science, pharmacology, law, and decentralized infrastructure. <b>${total} articles</b> structured across <b>${pillars.length} research pillars</b>.</p>
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:18px 0 10px">
      <input class=search id=wikiFilter placeholder="Type to instantly filter the entire library…" autocomplete=off oninput="filterWiki(this.value)" onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">
      <span id=matchCount style="font-family:system-ui,sans-serif;font-size:13px;color:var(--goldink);font-weight:600"></span>
    </div>
    ${startBlock}
    <h2 style="font-size:18px;margin:28px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);border:0;padding:0">Knowledge Pillars</h2>
    ${pillarCardsHtml}
    ${pillarTabsHtml}
    ${pillarSectionsHtml}
    ${clientScript}`;

  return layout({ title: 'Library', canonical: `${BASE_URL}/`, body, active: 'home' });
}

function searchPage(q) {
  q = (q || '').trim();
  const arts = listArticles();
  let hits = [];
  if (q) {
    const ql = q.toLowerCase();
    hits = arts.map((a) => {
      const text = (() => { try { return fs.readFileSync(a.file, 'utf8').toLowerCase(); } catch { return ''; } })();
      const titleHit = a.title.toLowerCase().includes(ql);
      const n = (text.match(new RegExp(ql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      return { ...a, score: (titleHit ? 100 : 0) + n };
    }).filter((a) => a.score > 0).sort((a, b) => b.score - a.score);
  }
  const body = `<h1>Search<span class=lede-rule aria-hidden=true></span></h1>
    <input class=search id=q value="${esc(q)}" autofocus placeholder="Search the Library…" onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">
    ${q ? `<p class=muted style="margin-top:14px">${hits.length} result(s) for "${esc(q)}"</p>
      ${hits.map((a) => `<div class=card><a href="/wiki/${a.slug}" style="font-size:16px;font-weight:700">${esc(a.title)}</a></div>`).join('')}`
      : '<p class=muted style="margin-top:14px">Type a term and press Enter.</p>'}`;
  return layout({ title: q ? `Search: ${q}` : 'Search', body, active: 'search' });
}

function aboutPage() {
  const body = `<h1>About the Library<span class=lede-rule aria-hidden=true></span></h1>
    <p>The Library of Ashurbanipal is the Van Kush Family Research Institute's knowledge base, rendered as reference articles. It is named for the ancient Nineveh library whose clay tablets were preserved by fire.</p>
    <h2>How it stays honest</h2>
    <ul>
      <li><b>Faithful synthesis.</b> Articles report only what the source documents state — no invented facts, dates, mechanisms, or connections.</li>
      <li><b>Provenance.</b> Every claim cites the source file it came from; each article ends with its sources and a coverage note flagging thin material.</li>
      <li><b>Fact-checked.</b> A separate fact-checker audits each claim against external reality (Wikipedia, scientific literature, web search). Claims it can't verify are flagged openly on the page.</li>
      <li><b>Attribution.</b> The Institute's own hypotheses are marked as such ("VKFRI proposes…") and never presented as established science.</li>
    </ul>
    <p class=muted>This is research and synthesis, openly sourced — not an oracle.</p>`;
  return layout({ title: 'About', canonical: `${BASE_URL}/about`, body, active: 'about' });
}

// ── categories ────────────────────────────────────────────────────────────────────────────────
// The library had an A-Z list and a search box. That serves a reader who already knows the word
// they want, and nobody else — which is most first-time arrivals, including everyone who follows a
// link out of a press or research letter. Categories give the collection a shape you can browse.
function categoriesPage() {
  const arts = listArticles();
  const sortedArts = [...arts].sort((a, b) => a.title.localeCompare(b.title));
  const groups = groupArticles(arts);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const jumpBar = `<div style="margin:16px 0 24px;display:flex;flex-wrap:wrap;gap:6px">
    <a class=chip href="#all-az" style="font-size:12.5px;padding:4px 11px;background:var(--goldsoft);border-color:var(--gold);color:var(--fg);font-weight:700">All Articles A–Z <span class=faint>(${arts.length})</span></a>
    ${groups.map((g) => `<a class=chip href="#cat-${esc(g.id)}" style="font-size:12.5px;padding:4px 11px">${esc(g.name)} <span class=faint>(${g.items.length})</span></a>`).join('')}
  </div>`;

  const filterScript = `<script>
    function filterCat(q) {
      var term = (q || '').trim().toLowerCase();
      var links = document.querySelectorAll('.cat-link');
      var countEl = document.getElementById('catMatchCount');
      if (!term) {
        links.forEach(function(l) { l.style.display = ''; });
        document.querySelectorAll('.cat-section').forEach(function(s) { s.style.display = ''; });
        if (countEl) countEl.textContent = '';
        return;
      }
      var matches = 0;
      links.forEach(function(l) {
        var hit = (l.getAttribute('data-title') || '').indexOf(term) !== -1;
        l.style.display = hit ? '' : 'none';
        if (hit) matches++;
      });
      document.querySelectorAll('.cat-section').forEach(function(s) {
        var visible = s.querySelectorAll('.cat-link:not([style*="display: none"])');
        s.style.display = visible.length ? '' : 'none';
      });
      if (countEl) countEl.textContent = matches + (matches === 1 ? ' match' : ' matches');
    }
  </script>`;

  const body = `<h1>Contents by Category<span class=lede-rule aria-hidden=true></span></h1>
    <p class=muted>Every article in the library organized across all ${groups.length} subject categories. <b>${arts.length} unique articles</b> (${total} categorized entries across all subjects).</p>
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:18px 0 10px">
      <input class=search id=catFilter placeholder="Filter all ${arts.length} articles across categories…" autocomplete=off oninput="filterCat(this.value)" onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">
      <span id=catMatchCount style="font-family:system-ui,sans-serif;font-size:13px;color:var(--goldink);font-weight:600"></span>
    </div>
    ${jumpBar}
    ${groups.map((g) => `<section id="cat-${esc(g.id)}" class=cat-section style="margin:34px 0;scroll-margin-top:80px">
      <h2 style="margin:0 0 4px;font-size:20px;display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--line2);padding-bottom:5px">
        <a href="/category/${esc(g.id)}" style="color:var(--fg);text-decoration:none">${esc(g.name)}</a>
        <span class=muted style="font-weight:400;font-size:13px"><a href="/category/${esc(g.id)}" style="color:var(--mut);font-weight:400">${g.items.length} ${g.items.length === 1 ? 'article' : 'articles'} &rsaquo;</a></span>
      </h2>
      ${g.blurb ? `<p class=muted style="margin:0 0 12px;font-size:14px">${esc(g.blurb)}</p>` : ''}
      <p class="cat-links" style="margin:0;line-height:2.15;font-size:18px">${g.items.map((a) => `<a class="cat-link" data-title="${esc(a.title.toLowerCase())}" href="/wiki/${esc(a.slug)}" style="color:var(--link);font-weight:600;text-decoration:none">${esc(a.title)}</a>`).join(' <span class=sep style="color:var(--line2);padding:0 5px;font-size:16px">&middot;</span> ')}</p>
    </section>`).join('')}
    <section id="all-az" class=cat-section style="margin:44px 0;scroll-margin-top:80px;border-top:2px solid var(--line);padding-top:28px">
      <h2 style="margin:0 0 6px;font-size:22px;display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--line2);padding-bottom:6px">
        <span>Complete Alphabetical Index (A–Z)</span>
        <span class=muted style="font-weight:400;font-size:13px">${sortedArts.length} total articles</span>
      </h2>
      <p class=muted style="margin:0 0 16px;font-size:14px">Every verified monograph, reference sheet, and document in the Library of Ashurbanipal, listed alphabetically.</p>
      <p class="cat-links" style="margin:0;line-height:2.15;font-size:18px">${sortedArts.map((a) => `<a class="cat-link" data-title="${esc(a.title.toLowerCase())}" href="/wiki/${esc(a.slug)}" style="color:var(--link);font-weight:600;text-decoration:none">${esc(a.title)}</a>`).join(' <span class=sep style="color:var(--line2);padding:0 5px;font-size:16px">&middot;</span> ')}</p>
    </section>
    ${filterScript}`;
  return layout({ title: 'Contents', canonical: `${BASE_URL}/categories`, body, active: 'categories' });
}

function categoryPage(id) {
  const g = groupArticles(listArticles()).find((x) => x.id === id);
  if (!g) {
    return { html: layout({ title: 'Not found', canonical: `${BASE_URL}/categories`, body: '<h1>No such category</h1><p><a href="/categories">All contents</a></p>' }), code: 404 };
  }
  const crumbs = `<a href="/">Library</a><span class=sep>›</span><a href="/categories">Contents</a><span class=sep>›</span>${esc(g.name)}`;
  const body = `<h1>${esc(g.name)}<span class=lede-rule aria-hidden=true></span></h1><p class=muted>${esc(g.blurb || '')}</p>
    <p style="margin:16px 0;line-height:2.15;font-size:18px">${g.items.map((a) => `<a href="/wiki/${esc(a.slug)}" style="color:var(--link);font-weight:600;text-decoration:none">${esc(a.title)}</a>`).join(' <span class=sep style="color:var(--line2);padding:0 5px;font-size:16px">&middot;</span> ')}</p>
    <p style="margin-top:22px"><a href="/categories">← All contents</a></p>`;
  return { html: layout({ title: g.name, canonical: `${BASE_URL}/category/${id}`, body, active: 'categories', crumbs }), code: 200 };
}

function sitemap() {
  const statics = ['/', '/about', '/search', '/categories'].map((u) => ({ loc: u, lastmod: '' }));
  const cats = groupArticles(listArticles()).map((g) => ({ loc: `/category/${g.id}`, lastmod: '' }));
  const arts = listArticles().map((a) => ({ loc: `/wiki/${a.slug}`, lastmod: articleDate(a.file) }));
  const entries = [...statics, ...cats, ...arts];
  const node = (e) => `  <url><loc>${BASE_URL}${encodeURI(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<changefreq>weekly</changefreq></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(node).join('\n')}\n</urlset>`;
}

export const handler = (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    const send = (html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' }); res.end(html); };
    if (p === '/' || p === '/wiki' || p === '/wiki/') return send(indexPage());
    if (p.startsWith('/wiki/')) { const r = articlePage(decodeURIComponent(p.slice('/wiki/'.length))); return send(r.html, r.code); }
    if (p.startsWith('/files/')) {
      const name = decodeURIComponent(p.slice('/files/'.length));
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..') || !IMG_TYPES[ext]) { res.writeHead(404); return res.end('not found'); }
      try {
        const buf = fs.readFileSync(path.join(FILES_DIR, name));
        res.writeHead(200, { 'content-type': IMG_TYPES[ext], 'cache-control': 'public, max-age=86400' });
        return res.end(buf);
      } catch { res.writeHead(404); return res.end('not found'); }
    }
    if (p === '/search') return send(searchPage(url.searchParams.get('q')));
    if (p === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const arts = listArticles();
      const results = !q ? [] : arts.map((a) => {
        const text = (() => { try { return fs.readFileSync(a.file, 'utf8'); } catch { return ''; } })();
        const lc = text.toLowerCase();
        const titleHit = a.title.toLowerCase().includes(q);
        const idx = lc.indexOf(q);
        const n = titleHit ? 100 : (idx >= 0 ? 10 : 0);
        const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, ' ').trim() : '';
        return { slug: a.slug, title: a.title, url: `${BASE_URL}/wiki/${a.slug}`, score: n, snippet };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ q, count: results.length, results }));
    }
    if (p === '/categories' || p === '/contents') return send(categoriesPage());
    if (p.startsWith('/category/')) { const r = categoryPage(decodeURIComponent(p.slice('/category/'.length))); return send(r.html, r.code); }
    if (p === '/about') return send(aboutPage());
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemap()); }
    if (p === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (p === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'Library of Ashurbanipal', baseUrl: BASE_URL,
        summary: 'A grounded, fact-checked knowledge library — articles synthesized from authoritative sources with citations.',
        links: [{ label: 'Library', path: '/' }, { label: 'Contents', path: '/categories' }, { label: 'Search', path: '/search' }, { label: 'About', path: '/about' }],
      }));
    }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (p === `/${INDEXNOW_KEY}.txt`) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(INDEXNOW_KEY); }
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }
    return send(layout({ title: '404', body: '<h1>404</h1><p class=muted><a href="/">← Library</a></p>' }), 404);
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
};

// CLI guard: bind a socket only when run directly, not when imported by a unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Library of Ashurbanipal on ${BASE_URL} (bound ${HOST}:${PORT}, articles: ${ARTICLES_DIR})`);
    if (process.env.NO_CRAWL_PING !== '1' && BASE_URL.startsWith('https')) {
      const urls = ['/', '/about', ...listArticles().map((a) => `/wiki/${a.slug}`)];
      submitToIndexNow(BASE_URL, urls).then((r) => console.log('IndexNow:', JSON.stringify(r))).catch(() => {});
      pingSitemap(BASE_URL).then((r) => console.log('Bing ping:', JSON.stringify(r))).catch(() => {});
    }
  });
}
