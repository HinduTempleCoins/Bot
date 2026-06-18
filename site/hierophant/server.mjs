// server.mjs — Hierophant.SoapBox.Community. The Temple's library of the world's sacred texts, as a
// standalone zero-dependency HTTP service in the SoapBox house style (mirrors site/politics/server.mjs).
//
// THE CONCEPT (operator's spec):
//   • A Sacred-Texts-style library — but UNLIKE our Justia-style case-text search, we DO NOT serve the
//     full text. For the texts we LINK OUT to sacred-texts.com / gutenberg.org / archive.org. Our value
//     is the MAP and the AI.
//   • A Theoi-style "gods and things" encyclopedia spanning traditions — each figure's names, tradition,
//     relationships, the texts it appears in, and a Theoi link for Greek figures.
//   • Integrated like Blue Letter Bible — a text's page gives you (1) where to read/download it,
//     (2) the GODS AND THINGS in it (linked to our entity pages), and (3) the COMPANION TEXTS you need
//     to understand it (the curated reading path, each with its own links out).
//   • More AI than Sacred-Texts — "Ask the Hierophant" answers over the Temple's OWN corpus
//     (the knowledge/ tree, via the existing library-rag retrieval seam), clearly labeled as such.
//
//   PORT=8124 BASE_URL=https://hierophant.soapbox.community node site/hierophant/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                 library front door — search box, traditions grid, featured reading paths
//   /texts            the full catalog (grouped by tradition)
//   /texts/:id        one text — links-out block + the gods & things in it + companion reading path
//   /gods             the entity encyclopedia (Theoi-style index): grouped by tradition / type / A–Z
//                     (?by=tradition|type|az), still filterable by ?tradition= / ?type=
//   /gods/:id         one figure — names/epithets, relationships, the texts it appears in, links out
//   /traditions/:id   one tradition — its texts and its figures
//   /ask              "Ask the Hierophant" — POST, RAG over the Temple's own corpus (soft-fails)
//   /health           liveness probe + catalog/entity self-check
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   We never serve the full primary text — we point to the canonical reading/download page and credit
//   the source (Sacred-Texts, Project Gutenberg, Theoi). "Ask the Hierophant" draws ONLY on the
//   Temple's own corpus and says so; it soft-fails to an honest empty state, never fabricates. esc()
//   on every interpolated value. Read-only, server-rendered, no keys, no custody.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import {
  TRADITIONS, TEXTS, READING_PATHS,
  getText, getTradition, textsByTradition, companionsOf, linksOf, validateCatalog,
} from '../../integrations/hierophant-catalog.mjs';
import {
  ENTITIES, ENTITY_TYPES,
  getEntity, entitiesByTradition, relationshipsOf, validateEntities,
} from '../../integrations/hierophant-entities.mjs';
import {
  groupEntities, entitiesForText, textsForEntity, interlink,
} from '../../integrations/hierophant-xref.mjs';

const PORT = +(process.env.PORT || 8124);
const HOST = process.env.HOST || '127.0.0.1';

// The masthead logo (a winged bronze lion of Jude) — bundled next to this file, served at /lion.jpg.
// Read once, lazily, and cached; soft-fails to null so a missing file never breaks the page.
const LION_PATH = join(dirname(fileURLToPath(import.meta.url)), 'lion.jpg');
let _lion;
function lionBytes() {
  if (_lion !== undefined) return _lion;
  try { _lion = readFileSync(LION_PATH); } catch { _lion = null; }
  return _lion;
}
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';

// ── "Ask the Hierophant" RAG seam ─────────────────────────────────────────────────────────────────
// We reuse the existing library-rag retrieval (askLibrary) rather than rebuilding it. It is injectable
// so offline tests drive it with a canned answer — and so the network/LLM dependency stays out of the
// route's hot path until a real ask. Default: lazily import library-rag and call askLibrary().
let _askImpl = null;
export function __setAsk(fn) { _askImpl = fn; }    // test seam
async function askCorpus(question) {
  try {
    if (_askImpl) return await _askImpl(question);
    const mod = await import('../../integrations/library-rag.mjs');
    return await mod.askLibrary(question, { task: 'quality' });
  } catch {
    return { answer: '', sources: [], grounded: false };
  }
}

// ── house-style helpers (same dark theme as Politics/Law/Search) ────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  /* the home masthead — a small centered logo with space from the top, an older-website feel */
  .masthead{text-align:center;margin:34px 0 14px}
  .masthead img{width:160px;height:160px;border-radius:6px;border:1px solid var(--bd);
    box-shadow:0 1px 4px rgba(0,0,0,.18);background:#000}
  .masthead .tagline{margin-top:10px;color:var(--mut);font-size:13px;letter-spacing:.04em;text-transform:uppercase}
  @media(max-width:520px){.masthead img{width:128px;height:128px}}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:18px 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .gold{color:var(--gold)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q,textarea.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;font-family:inherit}
  input.q{flex:1 1 320px;min-width:220px;max-width:560px} textarea.q{width:100%;min-height:80px;resize:vertical}
  input.q:focus,select.q:focus,textarea.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 8px;margin-left:6px;vertical-align:middle}
  .badge.trad{background:#d2992233;color:var(--gold)} .badge.type{background:#3fb95033;color:var(--up)}
  .badge.warn{background:#f8514922;color:#f85149}
  .links a{display:inline-block;margin:0 10px 6px 0;border:1px solid var(--line2);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600}
  .links a:hover{border-color:var(--blue);text-decoration:none}
  .companion{padding:10px 0;border-bottom:1px dashed var(--line)} .companion:last-child{border-bottom:0}
  .companion .why{color:var(--mut);font-size:13px;margin-top:3px}
  .pill{display:inline-block;font-size:13px;border:1px solid var(--line2);border-radius:14px;padding:4px 12px;margin:0 6px 6px 0}
  .pill:hover{border-color:var(--blue)}
  a.xref{color:var(--gold);border-bottom:1px dotted var(--gold);text-decoration:none}
  a.xref:hover{color:var(--blue);border-bottom-color:var(--blue);text-decoration:none}
  .answer{white-space:pre-wrap;line-height:1.65} .empty{color:var(--mut);padding:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Footer credits the sources we LINK OUT to (Sacred-Texts, Project Gutenberg, Theoi) and states the
// link-out-not-host posture + the corpus-scope of the AI. On every page.
const FOOTER = `<footer>
  <b>The Hierophant links; it does not host.</b> For the texts themselves we send you to the source — the
  full text lives at <a href="https://sacred-texts.com" rel="nofollow noopener">Sacred-Texts.com</a>,
  <a href="https://www.gutenberg.org" rel="nofollow noopener">Project Gutenberg</a>, and
  <a href="https://archive.org" rel="nofollow noopener">Archive.org</a>; Greek figures link to
  <a href="https://www.theoi.com" rel="nofollow noopener">Theoi.com</a>. Our work is the <b>map</b> — what is
  in a text, who appears in it, and what to read alongside it. <b>Ask the Hierophant</b> answers only from
  the Temple's own corpus and says when it cannot. With gratitude to those libraries, which make the
  world's scriptures free to all.
  <div style="margin-top:8px"><a href="/">Library</a> · <a href="/texts">Texts</a> · <a href="/gods">Gods</a> · <a href="/ask">Ask</a> · <a href="${esc(WIKI)}">Wiki</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'The Hierophant — a library of the world\'s sacred and mythological texts. A cross-tradition gods-and-things encyclopedia, curated reading paths, links out to Sacred-Texts, Gutenberg and Theoi, and "Ask the Hierophant" over the Temple\'s own corpus.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🜔 Hierophant <span>the Temple library</span></a>
  <div class=topbar-r><a href="/texts">Texts</a><a href="/gods">Gods</a><a href="/ask">Ask</a><a href="${esc(WIKI)}">Wiki</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(action, { value = '', placeholder = 'Search…', label = 'Search', name = 'q', extra = '' } = {}) {
  return `<form class=hsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    ${extra}<button type=submit>${esc(label)}</button>
  </div></form>`;
}

const traditionName = (id) => { const t = getTradition(id); return t ? t.name : id; };

// ── shared renderers ────────────────────────────────────────────────────────────────────────────
// The links-out block — every text page's "download at Sacred-Texts / Gutenberg" CTA. Unverified
// (machine-uncheckable) links carry an honest "scheme link" hint rather than being hidden.
function linksBlock(textId) {
  const t = getText(textId);
  if (!t) return '';
  const links = linksOf(textId);
  if (links.length === 0) return '<p class=empty>No external reading link on file yet.</p>';
  const note = t.verified ? '' : ' <span class="badge warn" title="canonical URL scheme; not machine-verified at build time">link unverified</span>';
  return `<div class=links>${links.map((l) =>
    `<a href="${esc(l.url)}" rel="nofollow noopener">${esc(l.label)} →</a>`).join('')}${note}</div>`;
}

// The "gods and things in this text" block — links to our own entity pages. Uses the derived
// cross-reference (union of both directions) so a one-sided edit can't drop a figure.
function entitiesInTextBlock(textId) {
  const ents = entitiesForText(textId);
  if (ents.length === 0) return '<p class=empty>No figures catalogued in this text yet.</p>';
  return ents.map((e) =>
    `<a class=pill href="/gods/${esc(e.id)}">${esc(e.name)}</a>`).join('');
}

// Blue-Letter-Bible interlinking: escape the prose, THEN wrap recognised entity names with links to
// their /gods page. excludeId stops an entity's own description self-linking. Soft-fails to plain text.
function interlinked(prose, excludeId = '') {
  return interlink(esc(prose), esc, { excludeId, linkClass: 'xref' });
}

// The curated reading-path block — companion texts + the one-line WHY, each linking on to its own page.
function companionsBlock(textId) {
  const comps = companionsOf(textId);
  if (comps.length === 0) return '<p class=empty>No companion reading path on file yet.</p>';
  return comps.map((c) => `<div class=companion>
    <div class=nm><a href="/texts/${esc(c.text.id)}">${esc(c.text.title)}</a>
      <span class="badge trad">${esc(traditionName(c.text.tradition))}</span></div>
    <div class=why>${esc(c.why)}</div>
  </div>`).join('');
}

function textCard(t) {
  return `<a class=sec href="/texts/${esc(t.id)}">
    <div class=t>${esc(t.title)}</div>
    <div class=d>${esc(traditionName(t.tradition))} · ${esc(t.era)}</div></a>`;
}
function entityCard(e) {
  return `<a class=sec href="/gods/${esc(e.id)}">
    <div class=t>${esc(e.name)}</div>
    <div class=d>${esc(traditionName(e.tradition))} · ${esc(e.type)}</div></a>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const body = `<div class=masthead>
      <img src="/lion.jpg" width=160 height=160 alt="The Hierophant — a winged lion guarding the Book of Jude" loading="eager">
      <div class=tagline>The Temple Library</div>
    </div>
    <h1>The Hierophant <span class=muted style="font-size:14px">· the Temple's library of sacred texts</span></h1>
    <p class=muted>A map of the world's scriptures, myths and mysteries — from the Pyramid Texts to the
      Popol Vuh. We do not host the texts; we point you to where they live free
      (<a href="https://sacred-texts.com" rel="nofollow noopener">Sacred-Texts</a>,
      <a href="https://www.gutenberg.org" rel="nofollow noopener">Gutenberg</a>,
      <a href="https://archive.org" rel="nofollow noopener">Archive.org</a>) and tell you who is in each one
      and what to read alongside it. Then you can <a href="/ask">ask the Hierophant</a> — our own oracle over
      the Temple's corpus.</p>
    ${searchForm('/ask', { placeholder: 'Ask the Hierophant a question about the corpus…', label: 'Ask', name: 'q' })}
    <div class=grid style="margin-top:8px">
      <a class=sec href="/texts"><div class=t>📜 The Texts</div><div class=d>${TEXTS.length} primary texts across ${TRADITIONS.length} traditions — each with links out and a reading path.</div></a>
      <a class=sec href="/gods"><div class=t>🜔 The Gods &amp; Things</div><div class=d>${ENTITIES.length} gods, heroes, prophets and concepts — names, relationships, and the texts they appear in.</div></a>
      <a class=sec href="/ask"><div class=t>🔮 Ask the Hierophant</div><div class=d>An oracle that answers from the Temple's own corpus — grounded, sourced, never invented.</div></a>
    </div>

    <h2>Traditions</h2>
    <div class=grid>
      ${TRADITIONS.map((t) => `<a class=sec href="/traditions/${esc(t.id)}">
        <div class=t>${esc(t.name)}</div><div class=d>${esc(t.blurb)}</div></a>`).join('')}
    </div>

    <h2>Featured reading paths</h2>
    <div class=card>${READING_PATHS.map((p) => {
      const t = getText(p.id);
      if (!t) return '';
      return `<div class=companion><div class=nm><a href="/texts/${esc(p.id)}">${esc(p.label)}</a></div>
        <div class=why>${esc(p.lead)}</div></div>`;
    }).join('')}</div>`;
  return page('The Hierophant — the Temple library of sacred texts', body, { canonical: `${BASE_URL}/` });
}

// ── /texts and /texts/:id ─────────────────────────────────────────────────────────────────────────
export function textsIndexView() {
  const byTrad = TRADITIONS
    .map((tr) => ({ tr, list: textsByTradition(tr.id) }))
    .filter((g) => g.list.length);
  const body = `<h1>The Texts</h1>
    <p class=muted>${TEXTS.length} primary texts. We link out to the source; click any text for its reading
      links, the gods and things in it, and its companion reading path.</p>
    ${byTrad.map((g) => `<h2>${esc(g.tr.name)}</h2><div class=grid>${g.list.map(textCard).join('')}</div>`).join('')}`;
  return page('The Texts — The Hierophant', body, { canonical: `${BASE_URL}/texts` });
}

export function textDetailView(id) {
  const t = getText(id);
  if (!t) {
    return page('Text not found — The Hierophant', `<h1>Text not found</h1>
      <p class=muted><a href="/texts">← back to all texts</a></p>
      <div class=card><p class=empty>No text on file for “${esc(id)}”. Browse the <a href="/texts">full catalog</a>.</p></div>`,
      { canonical: `${BASE_URL}/texts`, robots: 'noindex,follow' });
  }
  const body = `<h1>${esc(t.title)}</h1>
    <p class=muted><a href="/texts">← all texts</a> · <a href="/traditions/${esc(t.tradition)}">${esc(traditionName(t.tradition))}</a> · ${esc(t.era)}</p>
    <div class=card><h2 style="margin-top:0">What this is</h2><p>${interlinked(t.what)}</p>
      <p class=muted style="font-size:12px">Highlighted names link to their entry in the encyclopedia.</p></div>
    <div class=card><h2 style="margin-top:0">Read &amp; download</h2>
      <p class=muted style="font-size:13px">We don't host the text — these go to the source library.</p>
      ${linksBlock(id)}</div>
    <div class=card><h2 style="margin-top:0">The gods &amp; things in it</h2>${entitiesInTextBlock(id)}</div>
    <div class=card><h2 style="margin-top:0">Companion reading path</h2>
      <p class=muted style="font-size:13px">What to read alongside it, and why.</p>
      ${companionsBlock(id)}</div>`;
  return page(`${t.title} — The Hierophant`, body, { canonical: `${BASE_URL}/texts/${id}` });
}

// ── /gods and /gods/:id ───────────────────────────────────────────────────────────────────────────
// The Theoi-style entity INDEX. Browse every figure, grouped (by tradition / by type / A–Z) — and
// still filterable to one tradition or type. The grouping is applied to whatever the filters leave.
const GROUP_LABELS = { tradition: 'By tradition', type: 'By type', az: 'A–Z' };
function godsGroupLabel(by, key) {
  if (by === 'tradition') return traditionName(key);
  if (by === 'type') return key.charAt(0).toUpperCase() + key.slice(1);
  return key;   // az: the letter itself
}
// Preserve the active filters across grouping/filter links.
function godsHref({ tr = '', ty = '', by = '' } = {}) {
  const p = new URLSearchParams();
  if (tr) p.set('tradition', tr);
  if (ty) p.set('type', ty);
  if (by && by !== 'tradition') p.set('by', by);
  const s = p.toString();
  return s ? `/gods?${s}` : '/gods';
}

export function godsIndexView(traditionFilter = '', typeFilter = '', groupBy = '') {
  const tr = String(traditionFilter || '').trim();
  const ty = String(typeFilter || '').trim();
  let by = String(groupBy || '').trim().toLowerCase();
  if (!['tradition', 'type', 'az'].includes(by)) by = 'tradition';

  // filtered universe (the filters narrow; the grouping organises what's left)
  const inFilter = (e) => (!tr || e.tradition === tr) && (!ty || e.type === ty);

  const tradPills = `<a class=pill href="${godsHref({ ty, by })}"${tr ? '' : ' style="border-color:var(--blue)"'}>All traditions</a>`
    + TRADITIONS.filter((t) => entitiesByTradition(t.id).length)
      .map((t) => `<a class=pill href="${godsHref({ tr: t.id, ty, by })}"${tr === t.id ? ' style="border-color:var(--blue)"' : ''}>${esc(t.name)}</a>`).join('');
  const typePills = `<a class=pill href="${godsHref({ tr, by })}"${ty ? '' : ' style="border-color:var(--blue)"'}>All types</a>`
    + ENTITY_TYPES.map((t) => `<a class=pill href="${godsHref({ tr, ty: t, by })}"${ty === t ? ' style="border-color:var(--blue)"' : ''}>${esc(t)}</a>`).join('');
  const groupPills = Object.entries(GROUP_LABELS)
    .map(([k, label]) => `<a class=pill href="${godsHref({ tr, ty, by: k })}"${by === k ? ' style="border-color:var(--blue)"' : ''}>${esc(label)}</a>`).join('');

  // build the grouped sections from the derived index, then apply the active filters within each group
  const map = { tradition: 'tradition', type: 'type', az: 'letter' };
  const groups = groupEntities(map[by])
    .map((g) => ({ ...g, list: g.list.filter(inFilter) }))
    .filter((g) => g.list.length);
  const total = groups.reduce((n, g) => n + g.list.length, 0);

  const sections = groups.map((g) => `<h2 id="g-${esc(g.key)}">${esc(godsGroupLabel(by, g.key))}
      <span class=muted style="font-size:13px;font-weight:400">· ${g.list.length}</span></h2>
    <div class=grid>${g.list.map(entityCard).join('')}</div>`).join('');

  const body = `<h1>The Gods &amp; Things</h1>
    <p class=muted>A cross-tradition encyclopedia of gods, heroes, prophets, angels and concepts — in the
      spirit of <a href="https://www.theoi.com" rel="nofollow noopener">Theoi</a>, but spanning the whole
      corpus. Browse below; each figure carries its names, kin, and <b>every text that names it</b>. Greek
      figures link out to their Theoi page; all figures link to Wikipedia.</p>
    <div style="margin:10px 0">${groupPills}</div>
    <div style="margin:0 0 6px">${tradPills}</div>
    <div style="margin:0 0 10px">${typePills}</div>
    ${total
      ? `<p class=muted>${total} figure${total === 1 ? '' : 's'}${tr ? ` in ${esc(traditionName(tr))}` : ''}${ty ? ` of type “${esc(ty)}”` : ''}, grouped ${esc((GROUP_LABELS[by] || '').toLowerCase())}.</p>
         ${sections}`
      : `<div class=card><p class=empty>No figures match that filter.</p></div>`}`;
  return page('The Gods & Things — The Hierophant', body, { canonical: `${BASE_URL}/gods` });
}

export function entityDetailView(id) {
  const e = getEntity(id);
  if (!e) {
    return page('Figure not found — The Hierophant', `<h1>Figure not found</h1>
      <p class=muted><a href="/gods">← back to all figures</a></p>
      <div class=card><p class=empty>No figure on file for “${esc(id)}”. Browse the <a href="/gods">encyclopedia</a>.</p></div>`,
      { canonical: `${BASE_URL}/gods`, robots: 'noindex,follow' });
  }
  const rels = relationshipsOf(id);
  const texts = textsForEntity(id);   // derived union xref — every text that names this figure
  const extLinks = [];
  if (e.links && e.links.theoi) extLinks.push(`<a href="${esc(e.links.theoi)}" rel="nofollow noopener">on Theoi →</a>`);
  if (e.links && e.links.wikipedia) extLinks.push(`<a href="${esc(e.links.wikipedia)}" rel="nofollow noopener">on Wikipedia →</a>`);

  const body = `<h1>${esc(e.name)} <span class="badge trad">${esc(traditionName(e.tradition))}</span> <span class="badge type">${esc(e.type)}</span></h1>
    <p class=muted><a href="/gods">← all figures</a> · <a href="/traditions/${esc(e.tradition)}">${esc(traditionName(e.tradition))}</a></p>
    ${(e.epithets && e.epithets.length) ? `<p class=muted><b>Also:</b> ${e.epithets.map(esc).join(' · ')}</p>` : ''}
    <div class=card><p>${interlinked(e.desc, e.id)}</p>
      ${extLinks.length ? `<div class=links style="margin-top:10px">${extLinks.join('')}</div>` : ''}</div>
    ${rels.length ? `<div class=card><h2 style="margin-top:0">Relationships</h2>
      ${rels.map((r) => `<div class=rec><div class=nm><span class=muted style="text-transform:capitalize">${esc(r.rel)}:</span>
        <a href="/gods/${esc(r.entity.id)}">${esc(r.entity.name)}</a></div></div>`).join('')}</div>` : ''}
    <div class=card><h2 style="margin-top:0">Appears in</h2>
      ${texts.length
        ? texts.map((t) => `<a class=pill href="/texts/${esc(t.id)}">${esc(t.title)}</a>`).join('')
        : '<p class=empty>No texts on file for this figure yet.</p>'}</div>`;
  return page(`${e.name} — The Hierophant`, body, { canonical: `${BASE_URL}/gods/${id}` });
}

// ── /traditions/:id ─────────────────────────────────────────────────────────────────────────────
export function traditionView(id) {
  const tr = getTradition(id);
  if (!tr) {
    return page('Tradition not found — The Hierophant', `<h1>Tradition not found</h1>
      <p class=muted><a href="/">← home</a></p>
      <div class=card><p class=empty>No tradition on file for “${esc(id)}”.</p></div>`,
      { canonical: `${BASE_URL}/`, robots: 'noindex,follow' });
  }
  const texts = textsByTradition(id);
  const ents = entitiesByTradition(id);
  const body = `<h1>${esc(tr.name)}</h1>
    <p class=muted><a href="/">← home</a></p>
    <div class=card><p>${esc(tr.blurb)}</p></div>
    <h2>Texts</h2>
    ${texts.length ? `<div class=grid>${texts.map(textCard).join('')}</div>` : '<p class=empty>No texts catalogued yet.</p>'}
    <h2>Gods &amp; things</h2>
    ${ents.length ? `<div class=grid>${ents.map(entityCard).join('')}</div>` : '<p class=empty>No figures catalogued yet.</p>'}`;
  return page(`${tr.name} — The Hierophant`, body, { canonical: `${BASE_URL}/traditions/${id}` });
}

// ── /ask — Ask the Hierophant (RAG over the Temple's own corpus) ────────────────────────────────────
// GET renders the form (+ answers a ?q= if present); POST takes the form body. Always soft-fails to an
// honest empty/“not covered” state — never fabricates. The answer is clearly framed as drawn from the
// Temple's OWN corpus, not from the linked-out source texts.
export async function askView(question) {
  const term = String(question == null ? '' : question).trim();
  const form = `<form class=hsearch method=post action="/ask"><div class=row>
      <textarea class=q name=q placeholder="e.g. What is the Convergence? Who is Hathor? What does the corpus say about the egregore?" aria-label="Your question">${esc(term)}</textarea>
    </div><div class=row style="margin-top:8px"><button type=submit>Ask the Hierophant</button></div></form>`;

  let answerBlock = '';
  if (term) {
    const res = await askCorpus(term);
    if (res && res.grounded && res.answer) {
      const sources = Array.isArray(res.sources) ? res.sources : [];
      answerBlock = `<div class=card><h2 style="margin-top:0">The Hierophant answers</h2>
        <div class=answer>${esc(res.answer)}</div>
        ${sources.length ? `<div class=links style="margin-top:12px"><span class=muted style="font-size:13px;margin-right:8px">From the Temple's corpus:</span>
          ${sources.map((s) => `<a href="${esc(s.url || '#')}" rel="nofollow noopener">${esc(s.title || 'source')} →</a>`).join('')}</div>` : ''}</div>`;
    } else {
      answerBlock = `<div class=card><h2 style="margin-top:0">The Hierophant answers</h2>
        <p class=empty>${esc((res && res.answer) || "The Temple's corpus doesn't cover that.")}
        Try the <a href="${esc(WIKI)}">Library wiki</a> or browse the <a href="/texts">texts</a> directly.</p></div>`;
    }
  }

  const body = `<h1>Ask the Hierophant</h1>
    <p class=muted>An oracle over the <b>Temple's own corpus</b> — the knowledge tree of scripture, ancient
      Egypt, the mystery schools, the Convergence and more. It answers <b>only</b> from what the corpus
      actually says, cites its sources, and tells you plainly when it has nothing. It is <i>not</i> a search
      of the linked-out primary texts — for those, use the <a href="/texts">catalog</a>.</p>
    ${form}${answerBlock}`;
  return page('Ask the Hierophant — The Hierophant', body,
    { canonical: `${BASE_URL}/ask`, robots: term ? 'noindex,follow' : 'index,follow' });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = [
  '/', '/texts', '/gods', '/ask',
  ...TRADITIONS.map((t) => `/traditions/${t.id}`),
  ...TEXTS.map((t) => `/texts/${t.id}`),
  ...ENTITIES.map((e) => `/gods/${e.id}`),
];

// read a urlencoded POST body (best-effort, bounded). Returns the decoded `q` field.
function readPostQ(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8192) { tooBig = true; data = data.slice(0, 8192); }
    });
    req.on('end', () => {
      if (tooBig) return resolve('');
      try {
        const params = new URLSearchParams(data);
        resolve(params.get('q') || '');
      } catch { resolve(''); }
    });
    req.on('error', () => resolve(''));
  });
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/health') {
      const cat = validateCatalog();
      const ent = validateEntities();
      const ok = cat.ok && ent.ok;
      res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ok, texts: TEXTS.length, entities: ENTITIES.length, traditions: TRADITIONS.length,
        catalogErrors: cat.errors, entityErrors: ent.errors,
      }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({
        path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.6',
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
        name: 'The Hierophant', baseUrl: BASE_URL,
        summary: 'A library of the world\'s sacred and mythological texts — links out to Sacred-Texts/Gutenberg/Theoi (we do not host full text), a cross-tradition gods-and-things encyclopedia, curated reading paths, and an "Ask the Hierophant" oracle over the Temple\'s own corpus.',
        links: [
          { label: 'The texts', path: '/texts' },
          { label: 'The gods & things', path: '/gods' },
          { label: 'Ask the Hierophant', path: '/ask' },
        ],
      }));
    }

    if (path === '/lion.jpg') {
      const bytes = lionBytes();
      if (!bytes) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      return res.end(bytes);
    }

    const sp = url.searchParams;

    if (path === '/') return sendHtml(res, homePage());

    if (path === '/texts') return sendHtml(res, textsIndexView());
    if (path.startsWith('/texts/')) {
      const id = decodeURIComponent(path.slice('/texts/'.length).replace(/\/+$/, ''));
      const html = textDetailView(id);
      return sendHtml(res, html, getText(id) ? 200 : 404);
    }

    if (path === '/gods') return sendHtml(res, godsIndexView(sp.get('tradition') || '', sp.get('type') || '', sp.get('by') || ''));
    if (path.startsWith('/gods/')) {
      const id = decodeURIComponent(path.slice('/gods/'.length).replace(/\/+$/, ''));
      const html = entityDetailView(id);
      return sendHtml(res, html, getEntity(id) ? 200 : 404);
    }

    if (path.startsWith('/traditions/')) {
      const id = decodeURIComponent(path.slice('/traditions/'.length).replace(/\/+$/, ''));
      const html = traditionView(id);
      return sendHtml(res, html, getTradition(id) ? 200 : 404);
    }

    if (path === '/ask') {
      const term = method === 'POST' ? await readPostQ(req) : (sp.get('q') || '');
      return sendHtml(res, await askView(term));
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
if (process.argv[1] && process.argv[1].endsWith('server.mjs') && /site\/hierophant\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`The Hierophant on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
