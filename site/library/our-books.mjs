// our-books.mjs — the Van Kush Family Research Institute's OWN books, served free from our own
// shelf on library.soapbox.community. This is "our Scribd": read online, or download EPUB/PDF, no
// account, no paywall, no third party. The files are compiled by marketing/books/compile.mjs and
// deployed next to this module in ./ourbooks/.
//
// tier "host": we own these outright (CC BY 4.0), so unlike the public-domain shelf we serve the
// files directly. Every book is already full of links back to our surfaces (compile.mjs injects
// them), so the shelf itself just needs to be found.
//
// Pure + soft-fail: a missing books dir renders an honest empty shelf, never throws. No network.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BOOKS_DIR = process.env.OURBOOKS_DIR || join(HERE, 'ourbooks');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const human = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// Reading order: the way in first, the big reference last.
const ORDER = [
  'foundational-corpus', 'melek-prana-kula-papers',
  'library-chains', 'library-ecosystem', 'library-chemistry', 'library-pharmacology',
  'library-botanicals', 'library-mind', 'library-law', 'library-of-ashurbanipal',
];

function titleOf(slug) {
  try {
    const html = readFileSync(join(BOOKS_DIR, slug + '.html'), 'utf8');
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (m) return m[1].trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  } catch {}
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The catalogue: every slug that has at least an .html in the books dir. Soft-fails to []. */
export function catalog() {
  if (!existsSync(BOOKS_DIR)) return [];
  let slugs;
  try {
    slugs = [...new Set(readdirSync(BOOKS_DIR)
      .filter((f) => /\.(html|epub|pdf)$/.test(f))
      .map((f) => f.replace(/\.(html|epub|pdf)$/, '')))];
  } catch { return []; }
  slugs.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  return slugs.map((slug) => {
    const fmts = {};
    for (const ext of ['html', 'epub', 'pdf']) {
      const p = join(BOOKS_DIR, slug + '.' + ext);
      if (existsSync(p)) { try { fmts[ext] = statSync(p).size; } catch {} }
    }
    return { slug, title: titleOf(slug), fmts };
  });
}

const TYPES = { html: 'text/html; charset=utf-8', epub: 'application/epub+zip', pdf: 'application/pdf' };

/** Serve one book file. Returns { buf, type, download } or null. Path-safe (slug is sanitised). */
export function serveBook(slug, ext) {
  if (!/^[a-z0-9-]+$/.test(String(slug)) || !TYPES[ext]) return null;
  const p = join(BOOKS_DIR, slug + '.' + ext);
  if (!existsSync(p) || !p.startsWith(BOOKS_DIR)) return null;
  try { return { buf: readFileSync(p), type: TYPES[ext], download: ext !== 'html' }; } catch { return null; }
}

/** The shelf page body (slots into the library's own page() shell). Full of links by construction. */
export function renderShelf(bp = (p) => p) {
  const items = catalog();
  if (!items.length) return '<p class="data-note">Our own books are being compiled.</p>';
  const rows = items.map((b) => {
    const links = [];
    if (b.fmts.html) links.push(`<a href="${bp('/our-books/' + b.slug)}">Read online</a>`);
    if (b.fmts.epub) links.push(`<a href="${bp('/our-books/' + b.slug + '.epub')}">EPUB <small>${human(b.fmts.epub)}</small></a>`);
    if (b.fmts.pdf) links.push(`<a href="${bp('/our-books/' + b.slug + '.pdf')}">PDF <small>${human(b.fmts.pdf)}</small></a>`);
    return `<li class="ourbook"><strong>${esc(b.title)}</strong><div class="fmts">${links.join(' · ')}</div></li>`;
  }).join('\n');
  return `<section class="our-books">
  <h2>Our own books — free</h2>
  <p>The books of the <a href="https://vankushfamily.com">Van Kush Family Research Institute</a>, released free under CC&nbsp;BY&nbsp;4.0. Read them here or take the EPUB or PDF — every one links home to <a href="https://melek.salon">MELEK</a>, <a href="https://hathor.live">Hathor</a> and the live <a href="https://wiki.soapbox.community">Library</a>. Cite the permanent record at our <a href="https://doi.org/10.5281/zenodo.23354847">DOIs</a>.</p>
  <ul class="ourbooks-list">${rows}</ul>
</section>`;
}

export const OURBOOKS_STYLE = `
.our-books{margin:1.5em 0;padding:1.2em;border:1px solid #2a6b3f;border-radius:8px;background:#f6fbf7}
.our-books h2{margin-top:0;color:#2a6b3f}
.ourbooks-list{list-style:none;padding:0;margin:0}
.ourbooks-list .ourbook{padding:.6em 0;border-bottom:1px solid #d7e7dc}
.ourbooks-list .ourbook:last-child{border-bottom:none}
.ourbooks-list .fmts{margin-top:.2em}
.ourbooks-list .fmts a{margin-right:.4em;color:#1a7a3a}
.ourbooks-list small{color:#789}
`;
