// books-open.test.mjs — offline, deterministic tests for the PD-first books/documents reader.
// No network: every source's fetch is injected via __setFetch with a fake that returns fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBook, searchGutenberg, searchOpenLibrary, searchIAtexts, search,
  renderList, dataNote, POSTURE, __setFetch,
} from './books-open.mjs';

// Build a fake fetch that returns `payload` (JSON) with ok:true, recording called URLs.
function fakeFetch(payload, { ok = true } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    return { ok, async json() { return payload; } };
  };
  fn.calls = calls;
  return fn;
}

// A Gutendex PD book fixture (copyright:false) with epub/text/html formats.
const GUTENDEX_PD = {
  id: 84,
  title: 'Frankenstein; Or, The Modern Prometheus',
  authors: [{ name: 'Shelley, Mary Wollstonecraft' }],
  subjects: ['Horror tales', 'Science fiction'],
  languages: ['en'],
  copyright: false,
  formats: {
    'application/epub+zip': 'https://www.gutenberg.org/ebooks/84.epub3.images',
    'text/plain; charset=us-ascii': 'https://www.gutenberg.org/files/84/84-0.txt',
    'text/html': 'https://www.gutenberg.org/ebooks/84.html.images',
  },
};

// A Gutendex copyrighted book fixture (copyright:true) — MUST be dropped.
const GUTENDEX_COPYRIGHTED = {
  id: 9999,
  title: 'A Modern In-Copyright Work',
  authors: [{ name: 'Doe, Jane' }],
  copyright: true,
  formats: { 'text/html': 'https://www.gutenberg.org/ebooks/9999.html' },
};

test('normalizeBook keeps a PD Gutendex record (copyright:false)', () => {
  const b = normalizeBook(GUTENDEX_PD, 'gutenberg');
  assert.ok(b, 'PD record should normalize to an object');
  assert.equal(b.source, 'Project Gutenberg');
  assert.equal(b.license, 'Public Domain');
  assert.equal(b.posture, POSTURE.HOST);
  assert.equal(b.author, 'Shelley, Mary Wollstonecraft');
  assert.equal(b.formats.epub, 'https://www.gutenberg.org/ebooks/84.epub3.images');
  assert.equal(b.formats.text, 'https://www.gutenberg.org/files/84/84-0.txt');
  assert.equal(b.formats.html, 'https://www.gutenberg.org/ebooks/84.html.images');
  assert.equal(b.attribution, ''); // PD → no attribution owed
});

test('normalizeBook DROPS a copyrighted Gutendex record (copyright:true) → null', () => {
  assert.equal(normalizeBook(GUTENDEX_COPYRIGHTED, 'gutenberg'), null);
});

test('normalizeBook drops a Gutendex record with unknown copyright (null) → null', () => {
  assert.equal(normalizeBook({ ...GUTENDEX_PD, copyright: null }, 'gutenberg'), null);
});

test('normalizeBook soft-fails on junk / unknown source', () => {
  assert.equal(normalizeBook(null, 'gutenberg'), null);
  assert.equal(normalizeBook({}, 'not-a-source'), null);
  assert.equal(normalizeBook(GUTENDEX_PD, 'not-a-source'), null);
});

test('searchGutenberg returns PD-only books with epub/text/html links', async () => {
  const f = fakeFetch({ results: [GUTENDEX_PD, GUTENDEX_COPYRIGHTED] });
  __setFetch(f);
  const books = await searchGutenberg({ query: 'frankenstein', limit: 10 });
  __setFetch(null);
  assert.equal(books.length, 1, 'the copyrighted result must be dropped');
  assert.equal(books[0].title, 'Frankenstein; Or, The Modern Prometheus');
  assert.equal(books[0].posture, POSTURE.HOST);
  assert.ok(books[0].formats.epub && books[0].formats.text);
  // request went through the injected fetch, hit the copyright=false filter, and searched.
  assert.ok(f.calls[0].includes('copyright=false'));
  assert.ok(f.calls[0].includes('search=frankenstein'));
});

test('searchOpenLibrary returns aggregate link-outs to openlibrary.org', async () => {
  const payload = {
    docs: [
      { key: '/works/OL45804W', title: 'Fantastic Mr Fox', author_name: ['Roald Dahl'], first_publish_year: 1970, cover_i: 6498519 },
    ],
  };
  const f = fakeFetch(payload);
  __setFetch(f);
  const books = await searchOpenLibrary({ query: 'fantastic mr fox', limit: 5 });
  __setFetch(null);
  assert.equal(books.length, 1);
  const b = books[0];
  assert.equal(b.posture, POSTURE.AGGREGATE);
  assert.equal(b.source, 'Open Library');
  assert.equal(b.readUrl, 'https://openlibrary.org/works/OL45804W');
  assert.equal(b.year, '1970');
  assert.ok(b.cover.includes('covers.openlibrary.org'));
  assert.ok(f.calls[0].startsWith('https://openlibrary.org/search.json?q='));
});

test('searchIAtexts returns window-posture items with IA reader embeds', async () => {
  const payload = {
    response: {
      docs: [
        { identifier: 'artofwar00suntuoft', title: 'The Art of War', creator: 'Sun Tzu', year: '1910', licenseurl: '' },
      ],
    },
  };
  const f = fakeFetch(payload);
  __setFetch(f);
  const books = await searchIAtexts({ query: 'art of war', limit: 5 });
  __setFetch(null);
  assert.equal(books.length, 1);
  const b = books[0];
  assert.equal(b.posture, POSTURE.WINDOW);
  assert.equal(b.source, 'Internet Archive');
  assert.equal(b.embed, 'https://archive.org/embed/artofwar00suntuoft');
  assert.equal(b.readUrl, 'https://archive.org/details/artofwar00suntuoft');
  // the query is scoped to mediatype:texts
  assert.ok(decodeURIComponent(f.calls[0]).includes('mediatype:texts'));
});

test('search merges the three sources and dedupes by title/author', async () => {
  // Same work from Gutenberg (host) and Open Library (aggregate) → collapses to the host copy.
  let mode = '';
  const fn = async (url) => {
    const u = String(url);
    if (u.includes('gutendex') || u.includes('/books?')) {
      return { ok: true, async json() { return { results: [GUTENDEX_PD] }; } };
    }
    if (u.includes('openlibrary.org/search.json')) {
      return { ok: true, async json() {
        return { docs: [{ key: '/works/OLXX', title: 'Frankenstein; Or, The Modern Prometheus', author_name: ['Shelley, Mary Wollstonecraft'] }] };
      } };
    }
    if (u.includes('archive.org/advancedsearch')) {
      return { ok: true, async json() {
        return { response: { docs: [{ identifier: 'dracula00stok', title: 'Dracula', creator: 'Bram Stoker' }] } };
      } };
    }
    return { ok: false, async json() { return {}; } };
  };
  void mode;
  __setFetch(fn);
  const books = await search({ query: 'gothic', limit: 20 });
  __setFetch(null);
  const titles = books.map((b) => b.title);
  // Frankenstein appears once (deduped), Dracula once → 2 total.
  assert.equal(books.length, 2);
  const frank = books.filter((b) => b.title.startsWith('Frankenstein'));
  assert.equal(frank.length, 1);
  assert.equal(frank[0].source, 'Project Gutenberg', 'host copy wins the dedupe');
  assert.ok(titles.includes('Dracula'));
});

test('renderList escapes titles/authors (no raw HTML leaks)', () => {
  const html = renderList([
    {
      title: '<script>alert(1)</script>',
      author: 'Evil "Hacker" & Co',
      source: 'Project Gutenberg',
      license: 'Public Domain',
      posture: POSTURE.HOST,
      readUrl: 'https://example.org/x?a=1&b=2',
      formats: { epub: 'https://example.org/x.epub', text: 'https://example.org/x.txt' },
    },
  ]);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script tag must be escaped');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Evil &quot;Hacker&quot; &amp; Co'));
  assert.ok(html.includes('&amp;b=2'), 'url ampersand escaped');
  assert.ok(html.includes('epub') && html.includes('text'));
});

test('renderList soft-handles an empty / non-array list', () => {
  assert.ok(renderList([]).includes('No books found'));
  assert.ok(renderList(undefined).includes('No books found'));
  assert.ok(renderList('nope').includes('No books found'));
});

test('sources soft-fail (return []) on a non-ok response — never throw', async () => {
  const bad = fakeFetch(null, { ok: false });
  __setFetch(bad);
  assert.deepEqual(await searchGutenberg({ query: 'x' }), []);
  assert.deepEqual(await searchOpenLibrary({ query: 'x' }), []);
  assert.deepEqual(await searchIAtexts({ query: 'x' }), []);
  assert.deepEqual(await search({ query: 'x' }), []);
  __setFetch(null);
});

test('sources soft-fail (return []) when fetch throws — never throw', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await searchGutenberg({ query: 'x' }), []);
  assert.deepEqual(await search({ query: 'x' }), []);
  __setFetch(null);
});

test('dataNote names the sources and the PD-first posture', () => {
  const note = dataNote();
  assert.ok(/gutenberg/i.test(note));
  assert.ok(/internet archive/i.test(note));
  assert.ok(/open library/i.test(note));
  assert.ok(/public.domain/i.test(note));
});
