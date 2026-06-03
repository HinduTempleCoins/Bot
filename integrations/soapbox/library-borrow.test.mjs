// library-borrow.test.mjs — offline tests for the "go get the book" link-out leg.
// No network: availability probing is either disabled ({probe:false}) or stubbed via __setFetch.
// Run: node --test integrations/soapbox/library-borrow.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  borrowLinks, availability, worldcatLink, libbyLink, iaLink, KIND, __setFetch,
} from './library-borrow.mjs';

// Stub Open Library availability with a canned status payload.
function availFetch(status, id) {
  return async () => ({ ok: true, json: async () => ({ responses: { [id]: { status } } }) });
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('worldcatLink uses the ISBN path when an ISBN is present', () => {
  const l = worldcatLink({ title: 'Dune', isbn: '978-0-441-01359-3' });
  assert.equal(l.kind, KIND.WORLDCAT);
  assert.ok(l.url.includes('/isbn/9780441013593'), 'ISBN path, cleaned of punctuation');
});

test('worldcatLink falls back to a title+author query without an ISBN', () => {
  const l = worldcatLink({ title: 'Dune', author: 'Frank Herbert' });
  assert.ok(l.url.startsWith('https://search.worldcat.org/search?q='));
  assert.ok(l.url.includes('Dune'));
  assert.ok(l.url.includes('Frank'), 'author folded into the query');
});

test('libbyLink builds a Libby search deep-link; null when nothing to search on', () => {
  const l = libbyLink({ title: 'Dune', authors: ['Frank Herbert'] });
  assert.equal(l.kind, KIND.LIBBY);
  assert.ok(l.url.startsWith('https://libbyapp.com/search/query-'));
  assert.equal(libbyLink({}), null, 'no title/author/isbn → null');
});

test('iaLink only appears when an Internet Archive id is known', () => {
  assert.equal(iaLink({ title: 'Dune' }), null, 'no IA id → null');
  const l = iaLink({ ia: ['dune0000herb'] }); // array shape (Open Library returns ia as an array)
  assert.equal(l.kind, KIND.ARCHIVE);
  assert.ok(l.url.endsWith('/details/dune0000herb'));
});

test('availability soft-fails to neutral on a network error', async () => {
  __setFetch(throwingFetch());
  const a = await availability({ ia: 'dune0000herb' });
  __setFetch(null);
  assert.deepEqual(a, { available: null, access: null, status: null, source: 'openlibrary' });
});

test('availability maps a public-domain "open" status to read-now', async () => {
  __setFetch(availFetch('open', 'mobydick00melv'));
  const a = await availability({ ia: 'mobydick00melv' });
  __setFetch(null);
  assert.equal(a.available, true);
  assert.equal(a.access, 'public');
});

test('availability maps borrow_unavailable to available:false (waitlist)', async () => {
  __setFetch(availFetch('borrow_unavailable', 'dune0000herb'));
  const a = await availability({ ia: 'dune0000herb' });
  __setFetch(null);
  assert.equal(a.available, false);
  assert.equal(a.access, 'borrowable');
});

test('borrowLinks (probe:false) is pure and always includes a WorldCat link', async () => {
  const links = await borrowLinks({ title: 'A 2023 Novel', author: 'Some Author' }, { probe: false });
  assert.ok(Array.isArray(links) && links.length >= 1);
  assert.ok(links.some((l) => l.kind === KIND.WORLDCAT), 'every book is findable in a library');
  assert.ok(links.every((l) => l.url && l.label && l.note && l.kind), 'each link is fully shaped');
});

test('borrowLinks orders read-now first when an OL public scan is confirmed', async () => {
  __setFetch(availFetch('open', 'mobydick00melv'));
  const links = await borrowLinks({
    title: 'Moby-Dick', author: 'Herman Melville', olid: 'OL123W', ia: 'mobydick00melv', isbn: '9780000000000',
  });
  __setFetch(null);
  assert.equal(links[0].kind, KIND.READ, 'public scan → read-now leads');
  assert.ok(links[0].label.toLowerCase().includes('read now'));
  // all four channels present: OL read, IA, WorldCat, Libby
  const kinds = links.map((l) => l.kind);
  assert.ok(kinds.includes(KIND.ARCHIVE));
  assert.ok(kinds.includes(KIND.WORLDCAT));
  assert.ok(kinds.includes(KIND.LIBBY));
});

test('borrowLinks shows a waitlist wording for a checked-out OL borrowable', async () => {
  __setFetch(availFetch('borrow_unavailable', 'dune0000herb'));
  const links = await borrowLinks({ title: 'Dune', author: 'Frank Herbert', olid: 'OL456W', ia: 'dune0000herb' });
  __setFetch(null);
  const ol = links.find((l) => l.url.includes('openlibrary.org'));
  assert.equal(ol.kind, KIND.BORROW);
  assert.ok(/waitlist/i.test(ol.label), 'unavailable copy → waitlist wording');
});

test('borrowLinks de-dups by url and never throws on bad input', async () => {
  assert.deepEqual(await borrowLinks(null), []);
  const links = await borrowLinks({ title: 'Dune', author: 'Frank Herbert' }, { probe: false });
  const urls = links.map((l) => l.url);
  assert.equal(urls.length, new Set(urls).size, 'no duplicate urls');
});
