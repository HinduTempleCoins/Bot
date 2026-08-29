// quotes.test.mjs — OFFLINE, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTES, addQuotes, normalizeQuote, searchQuotes, byAuthor, byTopic,
  authors, topics, quoteSeo, renderSearch, renderAuthorPage, renderTopicPage, dataNote,
} from './quotes.mjs';

test('seed corpus is normalized + attributed', () => {
  assert.ok(QUOTES.length >= 5);
  for (const q of QUOTES) { assert.ok(q.text && q.author && q.id); assert.equal(typeof q.verified, 'boolean'); }
  assert.ok(QUOTES.some((q) => q.author === 'Socrates'));
});

test('normalizeQuote defaults unknown author + drops empty topics', () => {
  const q = normalizeQuote({ text: 'x', topics: ['a', '', 'b'] });
  assert.equal(q.author, 'Unknown');
  assert.deepEqual(q.topics, ['a', 'b']);
  assert.equal(q.verified, false);
});

test('searchQuotes ranks author > topic > text and honors by-facet', () => {
  const all = searchQuotes('justice');
  assert.ok(all.length >= 1);
  assert.ok(all.some((q) => q.text.includes('Injustice')));
  // author-only search
  const byAuth = searchQuotes('Socrates', { by: 'author' });
  assert.ok(byAuth.every((q) => q.author === 'Socrates'));
  assert.deepEqual(searchQuotes(''), [], 'empty query → no results');
});

test('byAuthor / byTopic / facets', () => {
  assert.ok(byAuthor('Socrates').length >= 1);
  assert.ok(byTopic('justice').length >= 1);
  assert.ok(authors().includes('Socrates'));
  assert.ok(topics().includes('justice'));
});

test('addQuotes appends + dedups by id on a private corpus', () => {
  const corpus = [];
  addQuotes([{ text: 'A', author: 'X' }, { text: 'A', author: 'X' }], corpus);
  assert.equal(corpus.length, 1, 'dup dropped');
  addQuotes([{ text: 'B', author: 'X' }], corpus);
  assert.equal(corpus.length, 2);
});

test('quoteSeo builds CollectionPage of Quotation with canonical path', () => {
  const seo = quoteSeo('author', 'Socrates', byAuthor('Socrates'), { baseUrl: 'https://quotes.soapbox.community/' });
  assert.equal(seo.canonical, 'https://quotes.soapbox.community/quotes/author/socrates');
  assert.equal(seo.jsonLd['@type'], 'CollectionPage');
  assert.equal(seo.jsonLd.hasPart[0]['@type'], 'Quotation');
});

test('render escapes hostile input, flags unverified, embeds safe JSON-LD', () => {
  const corpus = [];
  addQuotes([{ text: '<script>x</script>', author: '"a"', topics: ['t'], verified: false }], corpus);
  const html = renderAuthorPage('"a"', { corpus });
  assert.doesNotMatch(html, /<script>x<\/script>/);      // body escaped
  assert.doesNotMatch(html, /"a"<\/a>|>"a"</);            // author escaped
  assert.match(html, /attribution unverified/);          // unverified flag shown
  // JSON-LD script block must not contain a raw closing tag from the data
  const ld = html.split('application/ld+json">')[1] || '';
  assert.doesNotMatch(ld, /<\/script>x/);
});

test('renderSearch + topic pages render and carry the data note', () => {
  assert.match(renderSearch('justice', { baseUrl: 'https://q' }), /Injustice/);
  assert.match(renderTopicPage('justice'), /Quotes about justice/);
  assert.match(renderSearch('justice'), /attributed/);   // dataNote
});

test('dataNote states attribution + no-fabrication posture', () => {
  assert.match(dataNote(), /attribut/i);
  assert.match(dataNote(), /unverified|never present a doubtful/i);
});
