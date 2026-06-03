// affiliate.mjs — the library affiliate lead-out (queue #88). PURE link builders, NO network.
// For a given book (ISBN/title), build buy + borrow links the reader can act on:
//   BUY:  Bookshop.org (indie-first, our PRIMARY), Amazon Associates (env tag, soft-fail to plain
//         link), AbeBooks + Better World Books (used/rare), Libro.fm (audiobooks).
//   BORROW (pro-social): Open Library, WorldCat, Libby — borrowing is free and we surface it first
//         alongside buying, because the loyalty economy isn't served by pushing a sale every time.
//
// FTC disclosure is REQUIRED wherever these links render — call ftcDisclosure() and show it.
// Commission from affiliate buys funds the loyalty economy (reader rewards / the corpus).
// We NEVER host piracy and NEVER link to pirated copies — only legitimate buy/borrow channels.
//
// Affiliate IDs come from env (process.env.AMAZON_ASSOC_TAG, process.env.BOOKSHOP_AFF_ID). If an
// ID is absent we SOFT-FALL to the plain, non-affiliate link — a missing tag must never break a link.
//
//   import { buyLinks, affiliateUrl, ftcDisclosure } from './affiliate.mjs'
//   node integrations/soapbox/affiliate.mjs "9780140449136"

// --- helpers ---------------------------------------------------------------

// Normalize a book input into { isbn, title, author }. Accepts a bare ISBN/title string or an object.
function normalizeBook(book) {
  if (typeof book === 'string') {
    const s = book.trim();
    return looksLikeIsbn(s) ? { isbn: cleanIsbn(s) } : { title: s };
  }
  const b = book || {};
  return {
    isbn: b.isbn ? cleanIsbn(String(b.isbn)) : undefined,
    title: b.title ? String(b.title).trim() : undefined,
    author: b.author ? String(b.author).trim() : undefined,
  };
}

const cleanIsbn = (s) => String(s).replace(/[^0-9Xx]/g, '').toUpperCase();
const looksLikeIsbn = (s) => /^[0-9][0-9\- ]{8,}[0-9Xx]$/.test(String(s).trim());

// The search term used by vendors that key on title/author rather than ISBN.
function searchTerm(b) {
  return [b.title, b.author].filter(Boolean).join(' ').trim();
}

// q-encode (spaces -> +) for query strings.
const q = (s) => encodeURIComponent(String(s || '')).replace(/%20/g, '+');
// path-encode (keep it path-safe).
const p = (s) => encodeURIComponent(String(s || ''));

// --- affiliate URL builder -------------------------------------------------

// Build the URL for a single vendor for this book. Injects the affiliate tag from env when present,
// soft-falls to the plain link when absent. Unknown vendor -> null.
export function affiliateUrl(vendor, book) {
  const b = normalizeBook(book);
  const v = String(vendor || '').toLowerCase();
  const term = searchTerm(b);
  const amazonTag = process.env.AMAZON_ASSOC_TAG;
  const bookshopId = process.env.BOOKSHOP_AFF_ID;

  switch (v) {
    case 'bookshop':
    case 'bookshop.org': {
      // Bookshop.org — indie-first, our primary buy link. Affiliate id goes in the /a/<id>/ path.
      if (b.isbn) {
        return bookshopId
          ? `https://bookshop.org/a/${p(bookshopId)}/${p(b.isbn)}`
          : `https://bookshop.org/book/${p(b.isbn)}`;
      }
      const base = bookshopId
        ? `https://bookshop.org/a/${p(bookshopId)}/search`
        : 'https://bookshop.org/search';
      return `${base}?keywords=${q(term)}`;
    }

    case 'amazon': {
      // Amazon Associates — ?tag=<assoc-tag>; soft-fall to a plain Amazon link with no tag.
      const url = b.isbn
        ? `https://www.amazon.com/dp/${p(b.isbn)}`
        : `https://www.amazon.com/s?k=${q(term)}`;
      if (!amazonTag) return url;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}tag=${p(amazonTag)}`;
    }

    case 'abebooks': {
      // AbeBooks — used/rare marketplace.
      return b.isbn
        ? `https://www.abebooks.com/servlet/SearchResults?isbn=${p(b.isbn)}`
        : `https://www.abebooks.com/servlet/SearchResults?kn=${q(term)}`;
    }

    case 'betterworldbooks':
    case 'better-world-books': {
      // Better World Books — used books, funds literacy.
      return b.isbn
        ? `https://www.betterworldbooks.com/product/detail/-${p(b.isbn)}`
        : `https://www.betterworldbooks.com/search/results?q=${q(term)}`;
    }

    case 'librofm':
    case 'libro.fm': {
      // Libro.fm — indie audiobooks.
      return b.isbn
        ? `https://libro.fm/search?q=${p(b.isbn)}`
        : `https://libro.fm/search?q=${q(term)}`;
    }

    case 'openlibrary':
    case 'open-library': {
      // Open Library (Internet Archive) — borrow free.
      return b.isbn
        ? `https://openlibrary.org/isbn/${p(b.isbn)}`
        : `https://openlibrary.org/search?q=${q(term)}`;
    }

    case 'worldcat': {
      // WorldCat — find it in a library near you.
      return b.isbn
        ? `https://search.worldcat.org/search?q=bn:${p(b.isbn)}`
        : `https://search.worldcat.org/search?q=${q(term)}`;
    }

    case 'libby':
    case 'overdrive': {
      // Libby / OverDrive — borrow ebooks & audiobooks via your library card.
      return `https://libbyapp.com/search/query-${q(term || b.isbn || '')}`;
    }

    default:
      return null;
  }
}

// --- combined buy + borrow links -------------------------------------------

const VENDORS = [
  { vendor: 'bookshop', kind: 'buy' },
  { vendor: 'amazon', kind: 'buy' },
  { vendor: 'abebooks', kind: 'buy' },
  { vendor: 'betterworldbooks', kind: 'buy' },
  { vendor: 'librofm', kind: 'buy' },
  { vendor: 'openlibrary', kind: 'borrow' },
  { vendor: 'worldcat', kind: 'borrow' },
  { vendor: 'libby', kind: 'borrow' },
];

// Array of { vendor, url, kind:'buy'|'borrow' } for a book. Borrow links are always present.
export function buyLinks(book) {
  return VENDORS
    .map(({ vendor, kind }) => {
      const url = affiliateUrl(vendor, book);
      return url ? { vendor, url, kind } : null;
    })
    .filter(Boolean);
}

// --- FTC disclosure --------------------------------------------------------

// The required disclosure string. Render this anywhere affiliate links appear.
export function ftcDisclosure() {
  return 'As an Amazon Associate and Bookshop.org affiliate, we earn from qualifying purchases. '
    + 'These commissions fund the loyalty economy — borrowing is always free, and we never host or link to piracy.';
}

// --- CLI -------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('affiliate.mjs')) {
  const input = process.argv.slice(2).join(' ').trim() || '9780140449136';
  const links = buyLinks(input);
  console.log(`Links for: ${input}\n`);
  for (const l of links) console.log(`  [${l.kind}] ${l.vendor.padEnd(18)} ${l.url}`);
  console.log(`\n${ftcDisclosure()}`);
}
