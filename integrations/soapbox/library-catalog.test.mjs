// library-catalog.test.mjs — OFFLINE tests. Injected fetch (no network). Covers per-source
// normalization, cross-source merge/dedup, and bucket (host-fully | metadata-only) classification.
//   node --test integrations/soapbox/library-catalog.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  __setFetch, searchBooks, searchPapers, gutenberg, catalogSearch,
  mergeDedup, normTitle, BUCKET,
} from './library-catalog.mjs';

// A tiny router: map URL substring → { json } | { text } | { fail }.
function router(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, resp] of routes) {
      if (u.includes(needle)) {
        if (resp.fail) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
        return {
          ok: true, status: 200,
          json: async () => resp.json ?? {},
          text: async () => resp.text ?? '',
        };
      }
    }
    // default: not-found (soft-fail path)
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
}

const OL = {
  docs: [
    { key: '/works/OL1W', title: 'Moby Dick', author_name: ['Herman Melville'], first_publish_year: 1851, cover_i: 42, public_scan_b: true },
    { key: '/works/OL2W', title: 'Some New Novel', author_name: ['A. Writer'], first_publish_year: 2022, ebook_access: 'no_ebook' },
  ],
};
const OPENALEX = {
  results: [
    { display_name: 'Quantum Foo', publication_year: 2020, doi: 'https://doi.org/10.1/ABC', cited_by_count: 12,
      open_access: { is_oa: true, oa_url: 'https://oa.example/abc.pdf' },
      authorships: [{ author: { display_name: 'R. Searcher' } }] },
    { display_name: 'Closed Study', publication_year: 2019, doi: '10.2/XYZ', cited_by_count: 3,
      open_access: { is_oa: false }, authorships: [{ author: { display_name: 'P. Author' } }] },
  ],
};
const CROSSREF = {
  message: { items: [
    // same DOI as the closed OpenAlex study — should dedup by DOI
    { title: ['Closed Study'], DOI: '10.2/xyz', URL: 'https://doi.org/10.2/xyz', 'is-referenced-by-count': 5,
      issued: { 'date-parts': [[2019]] }, author: [{ given: 'P.', family: 'Author' }] },
    { title: ['Crossref Only Paper'], DOI: '10.3/QQQ', issued: { 'date-parts': [[2021]] }, author: [] },
  ] },
};
const DOAJ = {
  results: [
    { bibjson: { title: 'Open Journal Article', year: '2023',
      identifier: [{ type: 'doi', id: '10.4/DEF' }],
      link: [{ type: 'fulltext', url: 'https://oa.journal/def' }],
      author: [{ name: 'J. OA' }] } },
  ],
};
const ARXIV = `<feed><entry>
  <id>http://arxiv.org/abs/2401.00001v1</id>
  <title>An Arxiv Preprint</title>
  <published>2024-01-02T00:00:00Z</published>
  <author><name>X. Pre</name></author>
</entry></feed>`;
const GUTENDEX = {
  results: [
    { id: 2701, title: 'Moby Dick', authors: [{ name: 'Melville, Herman' }],
      formats: { 'text/html': 'https://gutenberg.org/2701.html', 'image/jpeg': 'https://gutenberg.org/2701.jpg' } },
  ],
};

const FULL_ROUTES = [
  ['openlibrary.org/search', { json: OL }],
  ['api.openalex.org/works', { json: OPENALEX }],
  ['api.crossref.org/works', { json: CROSSREF }],
  ['doaj.org/api/search', { json: DOAJ }],
  ['export.arxiv.org', { text: ARXIV }],
  ['gutendex.com', { json: GUTENDEX }],
  // CORE intentionally absent — no key in test env → coreWorks returns [] before fetching
];

test('searchBooks normalizes Open Library docs + classifies bucket by public-scan', async () => {
  __setFetch(router(FULL_ROUTES));
  const books = await searchBooks('moby');
  assert.equal(books.length, 2);
  const moby = books[0];
  assert.equal(moby.source, 'openlibrary');
  assert.equal(moby.type, 'book');
  assert.equal(moby.title, 'Moby Dick');
  assert.deepEqual(moby.authors, ['Herman Melville']);
  assert.equal(moby.year, 1851);
  assert.match(moby.cover, /covers\.openlibrary\.org\/b\/id\/42-M\.jpg/);
  assert.equal(moby.bucket, BUCKET.HOST, 'public_scan_b → host-fully');
  assert.equal(books[1].bucket, BUCKET.META, 'no ebook → metadata-only');
  __setFetch();
});

test('gutenberg marks everything host-fully (public domain) with a readable url', async () => {
  __setFetch(router(FULL_ROUTES));
  const g = await gutenberg('moby');
  assert.equal(g.length, 1);
  assert.equal(g[0].source, 'gutenberg');
  assert.equal(g[0].bucket, BUCKET.HOST);
  assert.equal(g[0].url, 'https://gutenberg.org/2701.html');
  assert.equal(g[0].cover, 'https://gutenberg.org/2701.jpg');
  __setFetch();
});

test('searchPapers merges sources, dedups by DOI, upgrades bucket when any source is OA', async () => {
  __setFetch(router(FULL_ROUTES));
  const papers = await searchPapers('quantum');
  const dois = papers.map((p) => p.doi);
  // 10.2/xyz appears in BOTH OpenAlex (closed) and Crossref → one row only
  assert.equal(dois.filter((d) => d === '10.2/xyz').length, 1, 'deduped by DOI');

  const quantum = papers.find((p) => p.doi === '10.1/abc');
  assert.ok(quantum);
  assert.equal(quantum.bucket, BUCKET.HOST, 'OpenAlex OA → host-fully');
  assert.equal(quantum.openAccess, true);

  const closed = papers.find((p) => p.doi === '10.2/xyz');
  assert.equal(closed.bucket, BUCKET.META, 'neither OpenAlex nor Crossref OA → metadata-only');
  // citation count keeps the larger (Crossref 5 > OpenAlex 3)
  assert.equal(closed.cited, 5);

  const arxiv = papers.find((p) => p.source === 'arxiv');
  assert.ok(arxiv, 'arXiv parsed from XML');
  assert.equal(arxiv.title, 'An Arxiv Preprint');
  assert.equal(arxiv.year, 2024);
  assert.equal(arxiv.bucket, BUCKET.HOST);
  __setFetch();
});

test('mergeDedup: collision by title upgrades bucket to host-fully when one side is OA', () => {
  const merged = mergeDedup([
    { source: 'crossref', title: 'Shared Title', doi: null, openAccess: false, bucket: BUCKET.META, authors: [] },
    { source: 'doaj', title: 'shared   title!!', doi: null, openAccess: true, bucket: BUCKET.HOST, authors: ['Au Thor'] },
  ]);
  assert.equal(merged.length, 1, 'normalized-title dedup');
  assert.equal(merged[0].bucket, BUCKET.HOST, 'OA duplicate upgrades bucket');
  assert.deepEqual(merged[0].sources, ['crossref', 'doaj']);
  assert.deepEqual(merged[0].authors, ['Au Thor'], 'filled missing authors from dup');
});

test('mergeDedup drops empty titles and dedups DOI ahead of title', () => {
  const merged = mergeDedup([
    { source: 'a', title: '', doi: '10.x/1' },
    { source: 'b', title: 'Real', doi: '10.X/2' },
    { source: 'c', title: 'Different Wording', doi: '10.x/2' }, // same DOI, different title → one row
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].doi, '10.x/2');
});

test('catalogSearch unifies books + papers with bucket counts', async () => {
  __setFetch(router(FULL_ROUTES));
  const out = await catalogSearch('moby quantum');
  assert.equal(out.query, 'moby quantum');
  assert.equal(out.total, out.results.length);
  assert.equal(out.hostFully + out.metadataOnly, out.total, 'every row is bucketed');
  // Open Library "Moby Dick" + Gutenberg "Moby Dick" dedup to one row
  const mobys = out.results.filter((r) => normTitle(r.title) === 'moby dick');
  assert.equal(mobys.length, 1, 'book deduped across Open Library + Gutenberg');
  assert.equal(mobys[0].bucket, BUCKET.HOST);
  __setFetch();
});

test('soft-fail: all sources error → empty results, no throw', async () => {
  __setFetch(router([
    ['openlibrary.org/search', { fail: true }],
    ['api.openalex.org', { fail: true }],
    ['api.crossref.org', { fail: true }],
    ['doaj.org', { fail: true }],
    ['export.arxiv.org', { fail: true }],
    ['gutendex.com', { fail: true }],
  ]));
  const out = await catalogSearch('anything');
  assert.equal(out.total, 0);
  assert.deepEqual(out.results, []);
  __setFetch();
});

test('thrown fetch is caught (never propagates)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const books = await searchBooks('x');
  const papers = await searchPapers('x');
  const out = await catalogSearch('x');
  assert.deepEqual(books, []);
  assert.deepEqual(papers, []);
  assert.equal(out.total, 0);
  __setFetch();
});

test('empty query short-circuits without fetching', async () => {
  __setFetch(async () => { throw new Error('should not be called'); });
  assert.deepEqual(await searchBooks(''), []);
  assert.deepEqual(await gutenberg(''), []);
  assert.deepEqual(await searchPapers(''), []);
  const out = await catalogSearch('');
  assert.equal(out.total, 0);
  __setFetch();
});
