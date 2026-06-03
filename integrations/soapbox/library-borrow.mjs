// library-borrow.mjs — the "go get the book" leg of the SoapBox Library (operator: "People can find
// Things through our System and like go to the Library and get the Book"). For a metadata-only work
// (in-copyright, someone else's — we NEVER host the file) this module produces the ordered set of
// LINK-OUTS that take the reader from a catalog record to an actual copy:
//
//   Open Library lending  — openlibrary.org availability/lending (keyless). When a scan exists we can
//                            tell "borrowable" / "available to read" vs "lendable elsewhere".
//   WorldCat              — worldcat.org "find in a library near you" SEARCH LINK (by ISBN or title).
//                            We LINK, never scrape.
//   Libby / OverDrive     — libbyapp.com search deep-link (read free with a library card).
//   Internet Archive      — archive.org/details/<iaId> lending page, when an IA id is known.
//
// Load-bearing rule (shared with library-buckets.mjs): WE NEVER HOST OTHER PEOPLE'S COPYRIGHTED FILES.
// Everything here is a link OUT to a library/lending service that has the rights. No hosting, no proxy.
//
// Pattern mirrors worldbank.mjs / library-catalog.mjs: ESM, zero deps, __setFetch seam, soft-fail
// (never throws — a dead source just means the availability probe is skipped), provenance on each
// link, CLI demo behind an argv guard, offline fixture tests.
//
//   import { borrowLinks, availability, worldcatLink, libbyLink, iaLink } from './library-borrow.mjs'
//   node integrations/soapbox/library-borrow.mjs "Dune" "Frank Herbert"      # title/author
//   node integrations/soapbox/library-borrow.mjs --isbn 9780441013593         # ISBN

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0; +https://soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// link kinds, in the order we want them presented to a reader (read-now first, then find-nearby).
export const KIND = Object.freeze({
  READ: 'read',          // Open Library / IA — read or borrow the scan right now
  BORROW: 'borrow',      // Open Library lending (waitlist / 1-hour / 14-day loans)
  WORLDCAT: 'worldcat',  // find a physical copy in a library near you
  LIBBY: 'libby',        // OverDrive/Libby — read free with a library card
  ARCHIVE: 'archive',    // Internet Archive lending page
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Normalize an ISBN to digits (+ trailing X for ISBN-10 check digit). Returns '' if it's not ISBN-ish.
function cleanISBN(isbn) {
  const s = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return (s.length === 10 || s.length === 13) ? s : '';
}

// Open Library work/edition key like "/works/OL123W" or "OL123M" → a bare key segment, else ''.
function olKey(work = {}) {
  const raw = work.olid || work.olKey || work.key || '';
  const m = String(raw).match(/OL\d+[WM]/i);
  return m ? m[0].toUpperCase() : '';
}

// Pull an Internet Archive identifier from common metadata shapes (string or first-of-array).
function iaId(work = {}) {
  const v = work.ia ?? work.iaId ?? work.identifier ?? '';
  const id = Array.isArray(v) ? v[0] : v;
  return id ? String(id).trim() : '';
}

// A human label for the work, used in link text / search terms.
function titleOf(work = {}) { return String(work.title || work.q || '').trim(); }
function authorOf(work = {}) {
  const a = work.author ?? work.authors;
  if (Array.isArray(a)) return a.filter(Boolean).join(' ');
  return String(a || '').trim();
}

// ── individual link builders (PURE — no network) ───────────────────────────────────────────────────

/** WorldCat "find in a library near you" search link. ISBN path when we have one, else a title query. */
export function worldcatLink(work = {}) {
  const isbn = cleanISBN(work.isbn);
  const url = isbn
    ? `https://search.worldcat.org/isbn/${encodeURIComponent(isbn)}`
    : `https://search.worldcat.org/search?q=${encodeURIComponent([titleOf(work), authorOf(work)].filter(Boolean).join(' '))}`;
  return { kind: KIND.WORLDCAT, label: 'Find it in a library near you (WorldCat)', url,
    note: 'Locate a physical copy at a library in your area.' };
}

/** Libby / OverDrive deep-link — read free with a library card. Search by title+author (Libby has no
 *  stable per-book public URL without a library context, so we hand off the search). */
export function libbyLink(work = {}) {
  const q = [titleOf(work), authorOf(work)].filter(Boolean).join(' ') || cleanISBN(work.isbn);
  if (!q) return null;
  return { kind: KIND.LIBBY, label: 'Read free with your library card (Libby / OverDrive)',
    url: `https://libbyapp.com/search/query-${encodeURIComponent(q)}`,
    note: 'Borrow the ebook or audiobook through your public library on Libby.' };
}

/** Internet Archive lending page for a known IA id. Returns null when no IA id is present. */
export function iaLink(work = {}) {
  const id = iaId(work);
  if (!id) return null;
  return { kind: KIND.ARCHIVE, label: 'Borrow / read at the Internet Archive',
    url: `https://archive.org/details/${encodeURIComponent(id)}`,
    note: 'Controlled digital lending from the Internet Archive.' };
}

// Open Library record link for the work itself (the catalog page), used as the READ link when a public
// scan is available. Returns null when we have no OL key.
function openLibraryReadLink(work = {}, status = {}) {
  const key = olKey(work);
  if (!key) return null;
  const url = `https://openlibrary.org/${key.endsWith('W') ? 'works' : 'books'}/${key}`;
  const isPublic = status.access === 'public';
  return {
    kind: isPublic ? KIND.READ : KIND.BORROW,
    label: isPublic ? 'Read now at Open Library (full scan)'
      : status.available === false ? 'Join the waitlist at Open Library'
        : 'Borrow at Open Library',
    url,
    note: isPublic ? 'Public-domain scan, read in your browser.'
      : status.available === false ? 'All copies are checked out — get in line to borrow.'
        : 'Borrow the digital scan (free) with an Open Library account.',
  };
}

// ── live availability probe (keyless, soft-fail) ─────────────────────────────────────────────────────
/**
 * Query Open Library's availability API for a work's lending status. Keyless. Soft-fails to a neutral
 * { available: null, access: null, status: null } on any error or missing id — borrowLinks() still
 * produces every link-out without it; this just upgrades the Open Library link's wording when it works.
 *
 * @param {object} work  needs an OL key (olid/key) or an IA id to probe; otherwise returns neutral.
 * @returns {Promise<{ available: boolean|null, access: string|null, status: string|null, source: string }>}
 */
export async function availability(work = {}) {
  const neutral = { available: null, access: null, status: null, source: 'openlibrary' };
  const ia = iaId(work);
  // Open Library availability is keyed by IA identifier; fall back to the editions API by OLID.
  if (ia) {
    const j = await getJSON(`https://openlibrary.org/availability?id=${encodeURIComponent(ia)}`);
    const a = j?.responses?.[ia] || j?.[ia] || (j && j.status ? j : null);
    if (a) {
      const status = a.status || null; // 'open' | 'borrow_available' | 'borrow_unavailable' | 'error'
      return {
        available: status === 'open' || status === 'borrow_available' ? true
          : status === 'borrow_unavailable' ? false : null,
        access: status === 'open' ? 'public' : status ? 'borrowable' : null,
        status,
        source: 'openlibrary',
      };
    }
  }
  return neutral;
}

// ── the assembled "go get the book" list ────────────────────────────────────────────────────────────
/**
 * Ordered link-outs that take a reader from a catalog record to an actual copy. ALL are link-outs; this
 * module never hosts a file. Optionally probes Open Library availability to sharpen the OL link wording
 * (set { probe:false } to stay fully offline/pure). Always returns at least the WorldCat link — every
 * book can be looked for in a library.
 *
 * @param {object} work  { title?, author?/authors?, isbn?, olid?/key?, ia?/iaId? }
 * @param {{probe?: boolean}} [opts]
 * @returns {Promise<Array<{kind,label,url,note}>>} ordered, no nulls
 */
export async function borrowLinks(work = {}, { probe = true } = {}) {
  if (!work || typeof work !== 'object') return [];
  let status = { available: null, access: null, status: null };
  if (probe) {
    try { status = await availability(work); } catch { /* soft-fail: keep neutral */ }
  }

  const links = [
    openLibraryReadLink(work, status), // read-now / borrow / waitlist (when we have an OL key)
    iaLink(work),                      // Internet Archive lending (when we have an IA id)
    worldcatLink(work),                // always present — find a physical copy nearby
    libbyLink(work),                   // Libby/OverDrive (needs at least a title or ISBN)
  ].filter(Boolean);

  // De-dup by url and keep first occurrence; preserve the intended order.
  const seen = new Set();
  return links.filter((l) => (l && l.url && !seen.has(l.url)) && seen.add(l.url));
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('library-borrow.mjs')) {
  const argv = process.argv.slice(2);
  let work;
  const isbnFlag = argv.indexOf('--isbn');
  if (isbnFlag >= 0) {
    work = { isbn: argv[isbnFlag + 1], title: argv.filter((a, i) => i !== isbnFlag && i !== isbnFlag + 1).join(' ') };
  } else {
    work = { title: argv[0] || 'Dune', author: argv.slice(1).join(' ') || 'Frank Herbert' };
  }
  const links = await borrowLinks(work);
  console.log(`\nGo get the book — "${work.title || work.isbn}"${work.author ? ` by ${work.author}` : ''}\n`);
  for (const l of links) {
    console.log(`  [${l.kind}] ${l.label}`);
    console.log(`       ${l.url}`);
    console.log(`       ${l.note}\n`);
  }
}
