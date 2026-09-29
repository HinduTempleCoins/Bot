// based-on.mjs — SoapBox Films ⇄ the SoapBox Library: films based on books (data/films/based-on.json, built by
// integrations/films-based-on.mjs from Wikidata P144 + the book's Project Gutenberg id).
//   - film page: "Based on" box — the book, its author and year, whether the BOOK is public domain (read it free
//     on Project Gutenberg), whether the FILM is public domain (watch it free on SoapBox Stream), and always a
//     "Find the book on SoapBox Library" search link.
//   - /films/book?gutenberg=<id> | ?book=<Qid> — every film of one book (the Library links here).
// Public domain, plainly: a book is public domain in the US if Project Gutenberg carries it or it was published in
// or before PD_YEAR; otherwise we say it is not public domain (or not known to be). Pure builders; esc() all.

import fs from 'node:fs';
import path from 'node:path';

export const LIBRARY = () => (process.env.LIBRARY_URL || 'https://library.soapbox.community').replace(/\/$/, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _cache = null;
export function loadBasedOn(dir) {
  const file = path.join(dir, 'based-on.json');
  let mt = 0; try { mt = fs.statSync(file).mtimeMs; } catch { return { byFilm: {}, byGutenberg: {}, byBook: {} }; }
  if (_cache && _cache.file === file && _cache.mt === mt) return _cache.data;
  let data = { byFilm: {}, byGutenberg: {}, byBook: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); data = { byFilm: j.byFilm || {}, byGutenberg: j.byGutenberg || {}, byBook: j.byBook || {} }; } catch {}
  _cache = { file, mt, data };
  return data;
}
export function __resetBasedOn() { _cache = null; }

/** { label, free } — plain-language public-domain status of a book. */
export function bookStatus(b, pdYear) {
  if (b.gut && b.gut.length) return { label: 'Public domain in the US — free on Project Gutenberg', free: true };
  if (b.y && b.y <= pdYear) return { label: `Public domain in the US (published ${b.y})`, free: true };
  if (b.y) return { label: `Not public domain (published ${b.y})`, free: false };
  return { label: 'Not known to be public domain', free: false };
}

export const librarySearch = (b) => `${LIBRARY()}/?q=${encodeURIComponent([b.t, (b.a || [])[0]].filter(Boolean).join(' '))}`;

/** The film page box. film: { r (record), freeHref (Stream link or ''), filmFree (bool), pdYear } */
export function basedOnBox(books, { r, freeHref = '', filmFree = false, pdYear }) {
  if (!books || !books.length) return '';
  const filmLine = filmFree
    ? `<b>Film:</b> public domain${freeHref ? ` — <a href="${esc(freeHref)}">watch it free on SoapBox Stream</a>` : ''}`
    : `<b>Film:</b> not public domain${r && r.y ? ` (${esc(r.y)})` : ''} — see where to watch it below`;
  const items = books.slice(0, 4).map((b) => {
    const st = bookStatus(b, pdYear);
    const kind = (b.kind || []).find((k) => /novel|book|story|play|poem|novella|literary|written|comic|fairy|epic|memoir/i.test(k)) || (b.kind || [])[0] || 'work';
    const read = (b.gut || []).slice(0, 1).map((g) => `<a class="chip ours" href="https://www.gutenberg.org/ebooks/${encodeURIComponent(g)}" target=_blank rel="noopener noreferrer">📖 Read it free on Project Gutenberg ↗</a>`).join('');
    return `<div style="margin:6px 0 10px"><b>${esc(b.t)}</b>${b.a && b.a.length ? ` by ${esc(b.a.slice(0, 2).join(', '))}` : ''}${b.y ? ` (${esc(b.y)})` : ''} <span class=note>· ${esc(kind)}</span><br>
      <b>Book:</b> ${esc(st.label)}<br>
      <span class=chips>${read}<a class=chip href="${esc(librarySearch(b))}">🔎 Find it on SoapBox Library</a>${(b.gut || []).length ? `<a class=chip href="/films/book?gutenberg=${encodeURIComponent(b.gut[0])}">🎬 Every film of this book</a>` : `<a class=chip href="/films/book?book=${encodeURIComponent(b.id)}">🎬 Every film of this book</a>`}</span></div>`;
  }).join('');
  return `<h2>Based on</h2><div class=box>${items}<p style="margin:4px 0 0">${filmLine}</p></div>`;
}

/** Films for one book: by Gutenberg id or book QID. → { book, filmIds } */
export function filmsForBook(data, { gutenberg = '', book = '' } = {}) {
  const ids = gutenberg ? (data.byGutenberg[gutenberg] || []) : book ? (data.byBook[book] || []) : [];
  let b = null;
  for (const f of ids) { b = (data.byFilm[f] || []).find((x) => (gutenberg ? (x.gut || []).includes(gutenberg) : x.id === book)); if (b) break; }
  return { book: b, filmIds: [...new Set(ids)] };
}
