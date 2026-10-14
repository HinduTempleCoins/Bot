// compile.mjs — Native book compiler for the Van Kush Family Research Institute / MELEK corpus.
//
// WHY. We researched every publishing platform (marketing/press/PUBLISHING_PLATFORMS_LANDSCAPE.md)
// but never built the actual books. This does. It compiles our own corpus into real, upload-ready
// EPUB + PDF + HTML, and — the load-bearing requirement — every book is FULL OF LINKS: a front
// "Where to find us" matter page, per-chapter back-links, live cross-links out to the wiki, and a
// closing index of every MELEK surface. The finished files are what gets uploaded to Amazon KDP,
// Draft2Digital, archive.org, Google Play Books, etc. — and the same pipeline is the back end for
// the Writing Room (write.soapbox.community): a writer's exported draft becomes a book the same way.
//
// NATIVE ONLY (no API): pandoc (a local binary) does markup -> EPUB/HTML; Playwright (local
// Chromium) renders HTML -> PDF. Nothing leaves this machine.
//
//   node marketing/books/compile.mjs            # compile every book in the manifest
//   node marketing/books/compile.mjs library    # compile one book by slug
//
// Output: marketing/books/dist/<slug>.{epub,html,pdf}

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'marketing', 'books', 'dist');
mkdirSync(DIST, { recursive: true });

const AUTHOR = 'Rev. Ryan Sasha-Shai Van Kush';
const PUBLISHER = 'Van Kush Family Research Institute';
const WIKI = 'https://wiki.soapbox.community';

// ── The links every book carries. "Full of links" is the whole point. ──────────────────────────
const SURFACES = [
  ['MELEK', 'https://melek.salon', 'The MELEK blockchain — a Graphene chain whose founding witness is an AI.'],
  ['Hathor', 'https://hathor.live', 'The AI Witness: chain daemon, community bot, helper, and tutor in one account.'],
  ['Witness School', 'https://witness.melek.salon', 'Learn to run a witness; watch Hathor produce blocks live.'],
  ['The Library of Ashurbanipal', 'https://wiki.soapbox.community', 'The open reference corpus — 243 cross-linked, source-cited monographs.'],
  ['The Mining Pool', 'https://pool.soapbox.community', 'Browser mining + an in-browser wallet you alone hold the keys to.'],
  ['The Herald', 'https://herald.soapbox.community', 'The MELEK newsroom and press wire.'],
  ['The Writing Room', 'https://write.soapbox.community', 'A drafting studio whose words never leave your browser — successor to NaNoWriMo.'],
  ['Van Kush Family', 'https://vankushfamily.com', 'The research institute and its roadmap.'],
  ['Dudael', 'https://dudael.com', 'The metaverse — 3D scenes toward an embodied, agentic world.'],
  ['Pentecaust', 'https://pentecaust.com', 'The outreach and backlink engine.'],
  ['Grants', 'https://grants.soapbox.community', 'Discretionary grants and funding.'],
];

// The DOI'd works — cited, permanent, citable.
const WORKS = [
  ['MELEK Whitepaper', 'https://doi.org/10.5281/ZENODO.23321842'],
  ['The PRANA Paper', 'https://doi.org/10.5281/ZENODO.23321846'],
  ['The KULA Paper', 'https://doi.org/10.5281/ZENODO.23321853'],
  ['The Convergence', 'https://doi.org/10.5281/ZENODO.23354837'],
  ['The Van Kush Master Synthesis', 'https://doi.org/10.5281/ZENODO.23354839'],
  ['Zar-AI: A Consciousness Synthesis', 'https://doi.org/10.5281/ZENODO.23354843'],
  ['The Library of Ashurbanipal (corpus DOI)', 'https://doi.org/10.5281/ZENODO.23354847'],
];

function frontMatterMd(title) {
  const l = [];
  l.push(`# ${title}\n`);
  l.push(`**${PUBLISHER}** · ${AUTHOR}\n`);
  l.push(`---\n`);
  l.push(`## Where to find us\n`);
  l.push(`This book is one copy of a living body of work. Everything below is online, free, and open. ` +
    `If a link is all you take from these pages, take this one: **[${SURFACES[0][0]}](${SURFACES[0][1]})**.\n`);
  for (const [name, url, desc] of SURFACES) l.push(`- **[${name}](${url})** — ${desc}`);
  l.push(`\n### The papers of record (permanent DOIs)\n`);
  for (const [name, url] of WORKS) l.push(`- [${name}](${url})`);
  l.push(`\n> Every chapter that follows links back out to the live [Library](${WIKI}), where each entry is cross-linked to the others. Read one, and you are one click from a hundred more.\n`);
  l.push(`\n---\n`);
  return l.join('\n');
}

function backMatterMd() {
  const l = [];
  l.push(`\n\n---\n`);
  l.push(`# Keep reading\n`);
  l.push(`The work does not end at the last page. It continues, and is added to, at every address below.\n`);
  for (const [name, url, desc] of SURFACES) l.push(`- **[${name}](${url})** — ${desc}`);
  l.push(`\n## Cite the record\n`);
  for (const [name, url] of WORKS) l.push(`- [${name}](${url})`);
  l.push(`\n*${PUBLISHER}. This book is released free; share it, mirror it, cite it. ` +
    `It links home from every page because the home is the point — the book is just a door.*\n`);
  return l.join('\n');
}

// Convert one source file to GitHub-Flavored Markdown via pandoc (mediawiki or markdown in).
function toMd(file) {
  const ext = file.split('.').pop().toLowerCase();
  const from = ext === 'wiki' ? 'mediawiki' : 'gfm';
  try {
    let md = execFileSync('pandoc', ['-f', from, '-t', 'gfm', '--wrap=none', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
    // Turn surviving [[Wiki Title]] / [[Title|label]] into live links out to the wiki. Full of links.
    md = md.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, t, label) => `[${label}](${WIKI}/wiki/${encodeURIComponent(t.trim().replace(/ /g, '_'))})`);
    md = md.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `[${t.trim()}](${WIKI}/wiki/${encodeURIComponent(t.trim().replace(/ /g, '_'))})`);
    return md;
  } catch (e) {
    console.error('  ! pandoc failed on', basename(file), String(e).slice(0, 120));
    return '';
  }
}

function chapterTitle(file) {
  return basename(file).replace(/\.(wiki|md)$/i, '').replace(/_/g, ' ');
}

async function renderPdf(htmlPath, pdfPath) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 120000 });
    await page.pdf({
      path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#888;text-align:center">melek.salon · hathor.live · wiki.soapbox.community — <span class="pageNumber"></span></div>`,
    });
  } finally { await browser.close(); }
}

function buildBook(book) {
  const files = book.files.filter(existsSync);
  if (!files.length) { console.error('SKIP', book.slug, '- no source files'); return null; }
  console.log(`\n=== ${book.title} (${files.length} source files) ===`);
  const parts = [frontMatterMd(book.title)];
  if (book.toc !== false && files.length > 1) {
    parts.push('# Contents\n');
    for (const f of files) {
      const t = chapterTitle(f);
      parts.push(`- [${t}](#${t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')})`);
    }
    parts.push('\n---\n');
  }
  for (const f of files) {
    const md = toMd(f);
    if (!md.trim()) continue;
    if (files.length > 1) parts.push(`\n\n# ${chapterTitle(f)}\n`);
    parts.push(md);
    parts.push(`\n\n> *Read this entry live, cross-linked to the whole Library, at [${WIKI}](${WIKI}). Home: [melek.salon](https://melek.salon).*\n`);
  }
  parts.push(backMatterMd());
  const mdPath = join(DIST, book.slug + '.md');
  writeFileSync(mdPath, parts.join('\n'));

  const meta = [
    '--metadata', `title=${book.title}`,
    '--metadata', `author=${AUTHOR}`,
    '--metadata', `publisher=${PUBLISHER}`,
    '--metadata', `lang=en`,
    '--metadata', `rights=CC BY 4.0 — ${PUBLISHER}`,
    '--toc', '--toc-depth=1',
  ];
  const epubPath = join(DIST, book.slug + '.epub');
  const htmlPath = join(DIST, book.slug + '.html');
  const css = join(DIST, '_book.css');
  writeFileSync(css, BOOK_CSS);
  try {
    execFileSync('pandoc', [mdPath, '-o', epubPath, ...meta, '--css', css], { maxBuffer: 1 << 28 });
    execFileSync('pandoc', [mdPath, '-o', htmlPath, ...meta, '--standalone', '--self-contained', '--css', css], { maxBuffer: 1 << 28 });
  } catch (e) { console.error('  ! pandoc build failed', String(e).slice(0, 200)); return null; }
  return { ...book, mdPath, epubPath, htmlPath, pdfPath: join(DIST, book.slug + '.pdf'), n: files.length };
}

const BOOK_CSS = `
body{font-family:Georgia,'Times New Roman',serif;line-height:1.6;max-width:42em;margin:2em auto;padding:0 1em;color:#1a1a1a}
h1{font-size:1.8em;border-bottom:2px solid #2a6b3f;padding-bottom:.2em;margin-top:2em}
h2{color:#2a6b3f;margin-top:1.6em}h3{color:#3a5}
a{color:#1a7a3a;text-decoration:underline}
blockquote{border-left:3px solid #2a6b3f;padding-left:1em;color:#444;font-style:italic}
code,pre{font-family:'DejaVu Sans Mono',monospace;font-size:.85em}
pre{background:#f6f8f6;padding:1em;overflow-x:auto;border-radius:4px}
table{border-collapse:collapse}td,th{border:1px solid #cdd;padding:.3em .6em}
`;

// ── The manifest. Each book is a title + ordered source files. ──────────────────────────────────
const wikiDir = join(ROOT, 'site', 'wiki', 'seed-articles');
const allWiki = existsSync(wikiDir) ? readdirSync(wikiDir).filter(f => f.endsWith('.wiki')).sort().map(f => join(wikiDir, f)) : [];
const scr = (f) => join(ROOT, 'knowledge', 'scripture', f);

// Split the 243 monographs into MANY books — one per pillar/shelf (operator: "not all into 1 Book,
// we talked about making Many Books"). The single-volume below is kept as the AI's full reference.
import { groupArticlesByPillars } from '../../site/wiki/categories.mjs';
const wikiArticles = allWiki.map((f) => ({ title: chapterTitle(f), file: f }));
const pillarBooks = groupArticlesByPillars(wikiArticles).map((p) => ({
  slug: 'library-' + p.id,
  title: `The Library of Ashurbanipal — ${p.name}`,
  files: p.items.map((a) => a.file),
}));

const BOOKS = [
  ...pillarBooks,
  {
    slug: 'library-of-ashurbanipal',
    title: 'The Library of Ashurbanipal — The Complete Reference (Hathor Edition)',
    files: allWiki,
  },
  {
    slug: 'foundational-corpus',
    title: 'The Foundational Corpus of the Van Kush Family Research Institute',
    files: [
      scr('the_convergence.md'), scr('van_kush_master_synthesis.md'),
      scr('zar_ai_consciousness_synthesis_complete.md'), scr('ai_consciousness_synthesis.md'),
      scr('phoenix_protocol.md'), scr('heterosis_mechanism.md'), scr('mythology_as_genealogy.md'),
    ],
  },
  {
    slug: 'melek-prana-kula-papers',
    title: 'The MELEK, PRANA & KULA Papers',
    files: [
      join(ROOT, 'site', 'melek-whitepaper.md'),
      join(ROOT, 'PRANA_PAPER.md'),
      join(ROOT, 'KULA_PAPER.md'),
    ],
  },
];

const only = process.argv[2];
const todo = only ? BOOKS.filter(b => b.slug === only || b.slug.includes(only)) : BOOKS;
const built = [];
for (const b of todo) {
  const r = buildBook(b);
  if (r) built.push(r);
}
for (const b of built) {
  try { await renderPdf(b.htmlPath, b.pdfPath); console.log('  PDF ok', basename(b.pdfPath)); }
  catch (e) { console.error('  ! PDF failed', b.slug, String(e).slice(0, 160)); }
}
console.log('\n=== BUILT ===');
for (const b of built) {
  for (const p of [b.epubPath, b.pdfPath, b.htmlPath]) {
    if (existsSync(p)) { const sz = execFileSync('du', ['-h', p], { encoding: 'utf8' }).split('\t')[0]; console.log(`  ${sz}\t${p.replace(ROOT + '/', '')}`); }
  }
}
