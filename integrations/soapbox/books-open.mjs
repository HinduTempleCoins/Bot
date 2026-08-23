// books-open.mjs — the "Scribd-side" of the SoapBox Resource Center (spec §5a): a PUBLIC-DOMAIN-FIRST
// books / documents reader. Like music-catalog.mjs / video-discovery.mjs this is a READER: it surfaces
// book METADATA + read/download links and NEVER rehosts someone else's copyrighted file.
//
// POSTURE — the load-bearing distinction (mirrors license-router.mjs HOST / WINDOW / POINT):
//   host       — Project Gutenberg PD texts. The formats (epub/text/html) are OURS TO SERVE.
//   window     — Internet Archive texts. IA hosts the reader; we frame IA's OWN embed, never store.
//   aggregate  — Open Library metadata. We LINK OUT to openlibrary.org; we don't host anything.
//
// PUBLIC DOMAIN FIRST: the only source we treat as host is Project Gutenberg via Gutendex, and we keep
// ONLY records with copyright === false (true / null / unknown → dropped at normalizeBook → null).
//
// Keyless sources (all run in search()):
//   • Gutendex     (gutendex.com/books?search=) — KEYLESS JSON over Project Gutenberg's 70k+ PD books.
//                  Base overridable via env GUTENDEX_BASE so a self-hosted instance can be swapped in.
//   • Open Library (openlibrary.org/search.json?q=) — KEYLESS metadata, AGGREGATE (link-out only).
//   • IA texts     (archive.org/advancedsearch.php?q=mediatype:texts …) — KEYLESS, WINDOW (IA reader embed).
//
// Pattern matches the sibling readers: ESM, zero deps, __setFetch hook, keyless-first, graceful
// soft-fail (return []/null, NEVER throw), guarded CLI, escaped rendered HTML, provenance on each row.
//
//   import { normalizeBook, searchGutenberg, searchOpenLibrary, searchIAtexts, search,
//            renderList, dataNote, __setFetch } from './books-open.mjs'
//   node integrations/soapbox/books-open.mjs "frankenstein"   # search the keyless sources

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxBooks/1.0 (+https://data.soapbox.community)' };

// Gutendex base — overridable so a self-hosted Gutendex can be swapped in without a code change.
const GUTENDEX_BASE = (process.env.GUTENDEX_BASE || 'https://gutendex.com').replace(/\/+$/, '');

// Postures this reader emits (see header).
export const POSTURE = Object.freeze({ HOST: 'host', WINDOW: 'window', AGGREGATE: 'aggregate' });

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function clamp(n, def = 12) { return Math.max(1, Math.min(50, Number(n) || def)); }

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Normalize a source token to one of our three known sources; '' if unrecognized.
function canonSource(source) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'gutendex' || s === 'gutenberg' || s === 'project gutenberg' || s === 'pg') return 'gutenberg';
  if (s === 'openlibrary' || s === 'open library' || s === 'ol') return 'openlibrary';
  if (s === 'archive' || s === 'ia' || s === 'internet archive' || s === 'archive.org') return 'archive';
  return '';
}

// Pull the epub / text / html read+download links out of a Gutendex `formats` map.
// Gutendex formats is { <mime-type>: <url>, ... }. We pick the friendliest of each family.
function gutenbergFormats(formats = {}) {
  const f = formats && typeof formats === 'object' ? formats : {};
  const out = {};
  for (const [mime, url] of Object.entries(f)) {
    if (!url || typeof url !== 'string') continue;
    const m = String(mime).toLowerCase();
    if (!out.epub && m.includes('epub')) out.epub = url;
    else if (!out.text && m.startsWith('text/plain')) out.text = url;
    else if (!out.html && m.includes('html')) out.html = url;
  }
  return out;
}

// ── normalization (the single choke point; PD filter lives here) ──────────────────────────────────────
/**
 * Shape a raw source record into our book. RETURNS NULL for a non-PD Gutendex record (copyright !== false)
 * and for an unrecognized/empty source. Output shape:
 *   { id, title, author, year, source, license, posture, readUrl?, embed?, formats?, cover?, attribution }
 * @param {object} raw     the raw source record
 * @param {string} source  'gutenberg' | 'openlibrary' | 'archive' (aliases accepted)
 */
export function normalizeBook(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const src = canonSource(source);
  if (!src) return null;

  if (src === 'gutenberg') {
    // PUBLIC DOMAIN FIRST: keep ONLY copyright === false. true / null / undefined → dropped.
    if (raw.copyright !== false) return null;
    const authors = Array.isArray(raw.authors)
      ? raw.authors.map((a) => (a && a.name) || '').filter(Boolean).join(', ')
      : (typeof raw.author === 'string' ? raw.author : '');
    const formats = gutenbergFormats(raw.formats);
    // Prefer an in-browser read link (html) as readUrl; else the Gutenberg book page.
    const readUrl = formats.html || formats.text
      || (raw.id != null ? `https://www.gutenberg.org/ebooks/${encodeURIComponent(raw.id)}` : '');
    return {
      id: raw.id != null ? `gutenberg-${raw.id}` : (readUrl || String(raw.title || '')),
      title: raw.title || '',
      author: authors || 'Unknown',
      year: '',                                   // Gutendex carries no publication year
      source: 'Project Gutenberg',
      license: 'Public Domain',
      posture: POSTURE.HOST,                      // PG PD texts → ours to serve
      readUrl,
      formats,
      attribution: '',                            // PD → no attribution owed
    };
  }

  if (src === 'openlibrary') {
    const key = String(raw.key || '').trim();     // e.g. "/works/OL45804W"
    const author = Array.isArray(raw.author_name)
      ? raw.author_name.filter(Boolean).join(', ')
      : (raw.author_name || raw.author || '');
    const readUrl = key
      ? `https://openlibrary.org${key.startsWith('/') ? '' : '/'}${key}`
      : (raw.title ? `https://openlibrary.org/search?q=${encodeURIComponent(raw.title)}` : 'https://openlibrary.org');
    return {
      id: key ? `openlibrary-${key.replace(/[^A-Za-z0-9]+/g, '')}` : (readUrl || String(raw.title || '')),
      title: raw.title || '',
      author: author || 'Unknown',
      year: raw.first_publish_year != null ? String(raw.first_publish_year) : '',
      source: 'Open Library',
      license: 'metadata only — rights vary, see Open Library',
      posture: POSTURE.AGGREGATE,                 // metadata → link out, we host nothing
      readUrl,
      cover: raw.cover_i != null ? `https://covers.openlibrary.org/b/id/${encodeURIComponent(raw.cover_i)}-M.jpg` : '',
      attribution: '',
    };
  }

  // archive (IA texts) → WINDOW: IA hosts the reader; we frame IA's own embed, never store.
  const id = String(raw.identifier || raw.id || '').trim();
  if (!id) return null;
  return {
    id: `archive-${id}`,
    title: (Array.isArray(raw.title) ? raw.title[0] : raw.title) || id,
    author: (Array.isArray(raw.creator) ? raw.creator.join(', ') : (raw.creator || '')) || 'Unknown',
    year: raw.year != null ? String(Array.isArray(raw.year) ? raw.year[0] : raw.year) : '',
    source: 'Internet Archive',
    license: raw.licenseurl || 'Internet Archive — see item page',
    posture: POSTURE.WINDOW,                      // IA hosts the reader
    readUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
    embed: `https://archive.org/embed/${encodeURIComponent(id)}`,
    attribution: '',
  };
}

// ── Gutendex (keyless; PD-only) ────────────────────────────────────────────────────────────────────
// gutendex.com/books?search=<q> → { results: [ { id, title, authors, subjects, languages, copyright,
// formats }, ... ] }. We keep ONLY copyright === false (normalizeBook enforces it).
/** @param {{query?:string, limit?:number}} opts */
export async function searchGutenberg({ query = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const url = `${GUTENDEX_BASE}/books?${query ? `search=${encodeURIComponent(String(query))}&` : ''}`
    + `copyright=false`;
  const j = await getJson(url);
  const results = j && Array.isArray(j.results) ? j.results : [];
  const out = [];
  for (const r of results) {
    const b = normalizeBook(r, 'gutenberg');       // drops any non-PD record → null
    if (b) out.push(b);
    if (out.length >= n) break;
  }
  return out;
}

// ── Open Library (keyless; AGGREGATE / link-out) ─────────────────────────────────────────────────────
// openlibrary.org/search.json?q=<q> → { docs: [ { title, author_name, first_publish_year, cover_i,
// key }, ... ] }. Metadata only — we link out to openlibrary.org, we host nothing.
/** @param {{query?:string, limit?:number}} opts */
export async function searchOpenLibrary({ query = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(String(query || ''))}`
    + `&limit=${n}&fields=key,title,author_name,first_publish_year,cover_i`;
  const j = await getJson(url);
  const docs = j && Array.isArray(j.docs) ? j.docs : [];
  const out = [];
  for (const d of docs) {
    const b = normalizeBook(d, 'openlibrary');
    if (b) out.push(b);
    if (out.length >= n) break;
  }
  return out;
}

// ── Internet Archive texts (keyless; WINDOW / IA reader embed) ───────────────────────────────────────
// advancedsearch.php?q=mediatype:texts AND <query> → { response: { docs: [ { identifier, title,
// creator, year, licenseurl }, ... ] } }. We return the item + IA's OWN reader embed.
/** @param {{query?:string, limit?:number}} opts */
export async function searchIAtexts({ query = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const q = `mediatype:texts` + (query ? ` AND (${query})` : '');
  const fl = ['identifier', 'title', 'creator', 'year', 'licenseurl']
    .map((f) => `fl[]=${encodeURIComponent(f)}`).join('&');
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}`
    + `&${fl}&rows=${n}&page=1&output=json`;
  const j = await getJson(url);
  const docs = j && j.response && Array.isArray(j.response.docs) ? j.response.docs : [];
  const out = [];
  for (const d of docs) {
    const b = normalizeBook(d, 'archive');
    if (b) out.push(b);
    if (out.length >= n) break;
  }
  return out;
}

// A stable dedupe key: lowercased title + first author token. Cross-source dupes collapse to one.
function dedupeKey(b) {
  const title = String(b && b.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const author = String(b && b.author || '').trim().toLowerCase().split(',')[0].trim();
  return `${title}|${author}`;
}

// ── merged search across the keyless sources ─────────────────────────────────────────────────────────
/**
 * Search all keyless sources (Gutenberg PD + Open Library metadata + IA texts), merge, and dedupe by
 * title/author. Each source soft-fails to [] independently. Gutenberg (host) is preferred on a tie, so
 * a PD read-now copy wins over an aggregate link-out for the same work.
 * @param {{query?:string, limit?:number}} opts
 */
export async function search({ query = '', limit = 12 } = {}) {
  const [pg, ol, ia] = await Promise.all([
    searchGutenberg({ query, limit }).catch(() => []),
    searchOpenLibrary({ query, limit }).catch(() => []),
    searchIAtexts({ query, limit }).catch(() => []),
  ]);
  const seen = new Set();
  const out = [];
  for (const b of [...pg, ...ia, ...ol]) {         // host first, then window, then aggregate
    if (!b) continue;
    const key = dedupeKey(b);
    if (key === '|' || seen.has(key)) continue;    // skip empty and already-seen
    seen.add(key);
    out.push(b);
  }
  return out;
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────
// Human label + link text for a book's posture.
function postureLabel(posture) {
  return ({
    [POSTURE.HOST]: 'Read / download (public domain)',
    [POSTURE.WINDOW]: 'Read at the Internet Archive',
    [POSTURE.AGGREGATE]: 'Details at Open Library',
  })[posture] || 'Open';
}

/** Escaped HTML list of books; shows posture + a Read/Download link (+ epub/text for PD). PURE; soft-handles empties. */
export function renderList(books = []) {
  const list = Array.isArray(books) ? books : [];
  const parts = ['<section class="books-open"><h2>Books &amp; documents</h2>'];
  if (list.length) {
    parts.push('<ul class="books-list">');
    for (const b of list) {
      const title = esc(b.title || 'Untitled');
      const link = b.readUrl
        ? `<a href="${esc(b.readUrl)}" rel="noopener noreferrer">${title}</a>` : title;
      const yr = b.year ? ` (${esc(b.year)})` : '';
      // For PD (host) books, surface the direct epub/text download links too.
      const fmt = b.formats || {};
      const dl = [];
      if (fmt.epub) dl.push(`<a href="${esc(fmt.epub)}" rel="noopener noreferrer">epub</a>`);
      if (fmt.text) dl.push(`<a href="${esc(fmt.text)}" rel="noopener noreferrer">text</a>`);
      const dlSpan = dl.length ? ` <span class="dl">[${dl.join(' · ')}]</span>` : '';
      parts.push(
        `<li>${link}${yr} — ${esc(b.author || 'Unknown')} `
        + `<span class="posture posture-${esc(b.posture)}">${esc(postureLabel(b.posture))}</span> `
        + `<span class="src">${esc(b.source)}</span> `
        + `<span class="lic">[${esc(b.license)}]</span>${dlSpan}</li>`,
      );
    }
    parts.push('</ul>');
  } else {
    parts.push('<p class="books-empty">No books found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the keyless sources + the PD-first, host/window/aggregate posture rule. */
export function dataNote() {
  return 'source: Project Gutenberg (public domain, host) + Internet Archive texts (IA reader, window) '
    + '+ Open Library (metadata, link-out) — public-domain first; we host only PD texts';
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('books-open.mjs')) {
  const q = process.argv.slice(2).join(' ').trim();
  const books = await search({ query: q, limit: 15 });
  console.log(`SoapBox Books — "${q || '(browse)'}" — ${books.length} result(s)`);
  console.log('─'.repeat(60));
  for (const b of books) {
    console.log(`  ${(b.title || 'Untitled').slice(0, 34).padEnd(36)} ${(b.author || '').slice(0, 20).padEnd(22)}`
      + ` [${b.posture}] (${b.source})`);
  }
  console.log(`  ${dataNote()}`);
}
