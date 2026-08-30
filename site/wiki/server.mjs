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
import { layout, renderWiki, buildToc, esc, slugify, titleize } from './render.mjs';
import { robotsTxt, INDEXNOW_KEY, submitToIndexNow, pingSitemap, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Where the articles live. In production the deploy pins ARTICLES_DIR (a single dir). With no override
// we serve the co-located, curated seed set (site/wiki/seed-articles + site/wiki/articles) so the
// ecosystem pages (MELEK / PRANA / KULA …) are present and discoverable by default.
const ARTICLE_DIRS = process.env.ARTICLES_DIR
  ? [process.env.ARTICLES_DIR]
  : [path.join(__dir, 'seed-articles'), path.join(__dir, 'articles')];
const FLAG_STORE = process.env.KB_FLAG_STORE || path.join(__dir, '..', '..', 'library-of-ashurbanipal-bot', 'data', 'kb-flags.json');

// privacy filter: only publish .wiki files; never anything from a private/sensitive list. The KB
// itself has private domains (scripture, operator material) — those are never turned into articles,
// but this is a second gate at the publish layer.
const PRIVATE = /(_private|secret|operator|\.local|scripture)/i;
function listArticles() {
  const bySlug = new Map();
  for (const dir of ARTICLE_DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.wiki') && !PRIVATE.test(f)); } catch {}
    for (const f of files) {
      const slug = slugify(f);
      if (!bySlug.has(slug)) bySlug.set(slug, { slug, title: titleize(f.replace(/\.wiki$/, '')), file: path.join(dir, f) });
    }
  }
  return [...bySlug.values()];
}
function readArticle(slug) {
  const a = listArticles().find((x) => x.slug === slug);
  if (!a) return null;
  try { return { ...a, text: fs.readFileSync(a.file, 'utf8') }; } catch { return null; }
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

// ── Fact cards. A curated infobox for the core ecosystem pages — a single source of truth for the
// load-bearing numbers, rendered as a wiki-style fact card so the key facts are correct and scannable.
// (These describe the finalized design; anything not yet live is badged "launching".)
const INFOBOXES = {
  MELEK: { head: 'MELEK', rows: [
    ['Type', 'Graphene / Blurt-lineage social chain (DPoS)'],
    ['Symbol', 'MELEK · prefix MELEK'],
    ['Backed dollar', 'None — "one honest token" (no MBD)'],
    ['Rewards', '65 / 35 author / curator · 5-min curation window'],
    ['Issuance', '~9.5%/yr, tapering'],
    ['Rules', 'No downvotes · no per-op fee · invite-only'],
    ['AI witness', 'hathor'],
    ['Front-end', 'melek.salon'],
    ['Mainnet', '2026-07-12 · no premine'],
  ], live: 'Mainnet live' },
  PRANA: { head: 'PRANA', rows: [
    ['Type', 'EVM Layer-1, Proof-of-Work (core-geth)'],
    ['Chain ID', '712217'],
    ['Algorithm', 'Etchash (ECIP-1099) — same as Ethereum Classic, GPU'],
    ['Block', '2 PRANA / ~13s'],
    ['Emission', 'Decays 10%/yr (era decay — not a halving)'],
    ['Chain fee', '2% "Hathor fee" split to treasury each block'],
    ['Burn', 'EIP-1559 base-fee burn active'],
    ['Launch', 'No premine'],
    ['RPC', 'rpc.prana.melek.salon'],
    ['Explorer / wallet', 'PRANAScan · Akasha'],
  ], soon: 'RPC / explorer / wallet: launching' },
  KULA: { head: 'KULA', rows: [
    ['Type', 'Reward token on PRANA (KulaSwap DEX)'],
    ['Not', 'A stablecoin — no dollar peg, no redemption claim'],
    ['Paid to', 'PRANA miners · a LOTTO · liquidity providers'],
    ['Emission', 'Minted on a 10%/yr-decaying schedule'],
    ['MELEK link', 'wMELEK/KULA DEX pair (bridged — being stood up) + CDP (lock KULA → borrow wMELEK, overcollateralized)'],
    ['Liquidity token', 'MWALI (per-block for LPs; burns → KULA / lotto tickets)'],
    ['Governance', 'SHELLS (future, ve-style)'],
  ], soon: 'KulaSwap: launching' },
};
function infoboxHtml(slug) {
  const ib = INFOBOXES[slug];
  if (!ib) return '';
  const badge = ib.live ? `<span class=badge>${esc(ib.live)}</span>` : (ib.soon ? `<span class="badge soon">${esc(ib.soon)}</span>` : '');
  const rows = ib.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  return `<aside class=infobox aria-label="${esc(ib.head)} facts"><div class=ib-h>${esc(ib.head)}</div><dl>${badge ? `<dd style="margin-bottom:6px">${badge}</dd>` : ''}${rows}</dl></aside>`;
}

// ── Categories. Group the Library into sections so the landing reads like a real wiki and every
// article is reachable by topic. Order matters (an article lands in the first section that claims it).
const CATEGORIES = [
  ['The MELEK Ecosystem', ['MELEK', 'PRANA', 'KULA', 'SoapBox', 'Hathor', 'REN', 'Portable_Identity', 'Pentecaust', 'Congress.ink']],
  ['Blockchains & Graphene', ['The_Graphene_Family', 'STEEM_Blockchain', 'HIVE_Blockchain', 'BLURT_Blockchain', 'Steem___Hive_Bots___the_SteemBots___Steemcenter_ecosystem', 'Mining', 'Forking', 'Cloning', 'Curation_Trails_and_Auto-Voting', 'Running_Tokens_on_MELEK-Engine', 'Running_a_Condenser_Front-End']],
  ['Plant Medicine & Harm Reduction', ['Cannabis', 'Cannabis_Harm_Reduction', 'PIHKAL_and_TIHKAL', 'Psychedelic_and_Psychopharmacology_Glossary', 'Kyphi', 'Head_Cone']],
  ['Health & Nutrition', ['Fast_Food_and_Processed_Food_Nutrition', 'Food_Pyramid_and_Supplements']],
  ['Learning & Reference', ['Autodidacts_and_Credentials', 'SoapBox_Credentials', 'Crypto_Glossary', 'Spanish_Glossary', 'Glossaries']],
];
// Assign a slug to its section: an explicit CATEGORIES membership wins; SoapBox_* surfaces group
// together; everything else falls to "More topics". Returns [ [sectionName, colorIndex, arts[]] … ].
function categorize(arts) {
  const bySlug = new Map(arts.map((a) => [a.slug, a]));
  const used = new Set();
  const groups = [];
  CATEGORIES.forEach(([name, slugs], i) => {
    const hits = slugs.map((s) => bySlug.get(s)).filter(Boolean);
    hits.forEach((a) => used.add(a.slug));
    if (hits.length) groups.push([name, i, hits]);
  });
  const surfaces = arts.filter((a) => a.slug.startsWith('SoapBox_') && !used.has(a.slug));
  surfaces.forEach((a) => used.add(a.slug));
  if (surfaces.length) groups.push(['SoapBox Surfaces', 5, surfaces]);
  const rest = arts.filter((a) => !used.has(a.slug));
  if (rest.length) groups.push(['More topics', 4, rest.sort((x, y) => x.title.localeCompare(y.title))]);
  return groups;
}
// The category chips shown on an article page (reverse lookup: which section(s) claim this slug).
function chipsFor(slug) {
  const out = [];
  CATEGORIES.forEach(([name, slugs], i) => { if (slugs.includes(slug)) out.push([name, i]); });
  if (slug.startsWith('SoapBox_')) out.push(['SoapBox Surfaces', 5]);
  if (!out.length) return '';
  return `<div class=chips>${out.map(([n, i]) => `<a class="chip c${i % 6}" href="/#cat-${slugify(n)}">${esc(n)}</a>`).join('')}</div>`;
}

function articlePage(slug) {
  const a = readArticle(slug);
  if (!a) return { code: 404, html: layout({ title: 'Not found', body: `<h1>Not found</h1><p class=muted>No article "${esc(slug)}". <a href="/">← Library</a></p>` }) };
  const { html, refs, footnotes } = renderWiki(a.text);
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
  const toc = buildToc(html + footnotes);
  const body = `<p class=muted><a href="/">← Library</a></p>${infoboxHtml(a.slug)}<h1>${esc(a.title)}</h1>${chipsFor(a.slug)}${flagBlock}${html}${footnotes}`;
  return { code: 200, html: layout({ title: a.title, description: descText, canonical: url, jsonld, ogType: 'article', body, toc }) };
}

// "Start here" — the newcomer's learning path, surfaced above the A–Z list so the Library actually
// teaches what MELEK / SoapBox is. Each entry links to an article on this wiki (by slug) or a live surface.
const STARTERS = [
  { slug: 'MELEK', label: 'MELEK', blurb: 'The social blockchain — post, vote, earn.' },
  { slug: 'SoapBox', label: 'SoapBox', blurb: 'The whole ecosystem of apps, mapped.' },
  { slug: 'PRANA', label: 'PRANA', blurb: 'The EVM compute chain you mine with a GPU.' },
  { slug: 'KULA', label: 'KULA', blurb: 'The DeFi layer — KulaSwap DEX, rewards, collateral.' },
];

function indexPage() {
  const arts = listArticles().sort((x, y) => x.title.localeCompare(y.title));
  const have = new Set(arts.map((a) => a.slug));
  const starters = STARTERS.filter((s) => have.has(s.slug));
  const startBlock = starters.length ? `<div class=starter>
      <h2>Start here — what is this?</h2>
      <p class=muted style="margin:0 0 12px;font-size:14px">New to MELEK and SoapBox? These explain the whole thing. Then visit the <a href="https://witness.melek.salon">Witness School</a>.</p>
      <div class=grid>${starters.map((s) => `<a href="/wiki/${s.slug}"><b style="display:block;color:var(--lapis)">${esc(s.label)}</b><span style="font-size:13px;color:var(--mut);font-weight:400">${esc(s.blurb)}</span></a>`).join('')}</div>
    </div>` : '';
  const groups = categorize(arts);
  const catBlocks = groups.map(([name, ci, list]) => `<section class=cat id="cat-${slugify(name)}">
      <h2><span class="chip c${ci % 6}">${esc(name)}</span> <span class=muted style="font-size:13px;font-weight:400">${list.length}</span></h2>
      <div class=grid>${list.map((a) => `<a href="/wiki/${a.slug}">${esc(a.title)}</a>`).join('')}</div>
    </section>`).join('');
  const body = `<div class=hero><h1 style="margin-top:0">The Library of Ashurbanipal</h1>
    <p class=muted style="margin-bottom:0">The Van Kush Family Research Institute knowledge base, synthesized into reference articles — grounded in cited sources, audited by a fact-checker, with disputed claims flagged openly.</p></div>
    <input class=search id=q placeholder="Search the Library…" autocomplete=off oninput="location.href='/search?q='+encodeURIComponent(this.value)" onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">
    ${startBlock}
    <p class=muted style="margin-top:18px">${arts.length} articles, by topic</p>
    ${catBlocks}`;
  return layout({ title: 'Library', canonical: `${BASE_URL}/`, body });
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
  const body = `<h1>Search</h1>
    <input class=search id=q value="${esc(q)}" placeholder="Search the Library…" onkeydown="if(event.key==='Enter')location.href='/search?q='+encodeURIComponent(this.value)">
    ${q ? `<p class=muted style="margin-top:14px">${hits.length} result(s) for "${esc(q)}"</p>
      ${hits.map((a) => `<div class=card><a href="/wiki/${a.slug}" style="font-size:16px;font-weight:700">${esc(a.title)}</a></div>`).join('')}`
      : '<p class=muted style="margin-top:14px">Type a term and press Enter.</p>'}`;
  return layout({ title: q ? `Search: ${q}` : 'Search', body });
}

function aboutPage() {
  const body = `<h1>About the Library</h1>
    <p>The Library of Ashurbanipal is the Van Kush Family Research Institute's knowledge base, rendered as reference articles. It is named for the ancient Nineveh library whose clay tablets were preserved by fire.</p>
    <h2>How it stays honest</h2>
    <ul>
      <li><b>Faithful synthesis.</b> Articles report only what the source documents state — no invented facts, dates, mechanisms, or connections.</li>
      <li><b>Provenance.</b> Every claim cites the source file it came from; each article ends with its sources and a coverage note flagging thin material.</li>
      <li><b>Fact-checked.</b> A separate fact-checker audits each claim against external reality (Wikipedia, scientific literature, web search). Claims it can't verify are flagged openly on the page.</li>
      <li><b>Attribution.</b> The Institute's own hypotheses are marked as such ("VKFRI proposes…") and never presented as established science.</li>
    </ul>
    <p class=muted>This is research and synthesis, openly sourced — not an oracle.</p>`;
  return layout({ title: 'About', canonical: `${BASE_URL}/about`, body });
}

function sitemap() {
  const statics = ['/', '/about', '/search'].map((u) => ({ loc: u, lastmod: '' }));
  const arts = listArticles().map((a) => ({ loc: `/wiki/${a.slug}`, lastmod: articleDate(a.file) }));
  const entries = [...statics, ...arts];
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
    if (p === '/about') return send(aboutPage());
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(sitemap()); }
    if (p === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (p === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'Library of Ashurbanipal', baseUrl: BASE_URL,
        summary: 'A grounded, fact-checked knowledge library — articles synthesized from authoritative sources with citations.',
        links: [{ label: 'Library', path: '/' }, { label: 'Search', path: '/search' }, { label: 'About', path: '/about' }],
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
    console.log(`Library of Ashurbanipal on ${BASE_URL} (bound ${HOST}:${PORT}, articles: ${ARTICLE_DIRS.join(', ')})`);
    if (process.env.NO_CRAWL_PING !== '1' && BASE_URL.startsWith('https')) {
      const urls = ['/', '/about', ...listArticles().map((a) => `/wiki/${a.slug}`)];
      submitToIndexNow(BASE_URL, urls).then((r) => console.log('IndexNow:', JSON.stringify(r))).catch(() => {});
      pingSitemap(BASE_URL).then((r) => console.log('Bing ping:', JSON.stringify(r))).catch(() => {});
    }
  });
}
