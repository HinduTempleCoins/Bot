// wikiStubGenerator.test.js — tests for the wiki stub generator for back-references (#49):
// wikilink extraction, missing-term detection (case-insensitive), stub shape (stub:true +
// back-reference), and stubsForArticle (one stub per missing term, none for existing terms).
//
// Run: node test/wikiStubGenerator.test.js   (node:test + node:assert, no new deps, no network)

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTerm,
  extractLinkedTerms,
  findMissingTerms,
  generateStub,
  stubsForArticle,
} from '../src/wikiStubGenerator.js';

// ── extraction finds wikilinks ──────────────────────────────────────────────────────────────────
test('extractLinkedTerms parses [[wikilinks]] and [[Target|display]] from a body string', () => {
  const body = [
    '== Overview ==',
    'See [[Oilahuasca]] and [[Space Paste]] for the recipe.',
    'Also the [[CYP450 Enzyme System|liver enzymes]] matter, and [[Kyphi#History|kyphi history]].',
  ].join('\n');
  const terms = extractLinkedTerms(body);
  assert.deepEqual(terms, ['Oilahuasca', 'Space Paste', 'CYP450 Enzyme System', 'Kyphi']);
});

test('extractLinkedTerms de-dupes case/space-insensitively, keeps first spelling, preserves order', () => {
  const body = 'Link [[Space Paste]] then [[space_paste]] then [[SPACE PASTE]] and [[Kyphi]].';
  assert.deepEqual(extractLinkedTerms(body), ['Space Paste', 'Kyphi']);
});

test('extractLinkedTerms reads an article object (content/body) and merges a links array', () => {
  const article = {
    title: 'Heterosis',
    content: 'Grounded in [[Hybrid Vigor]].',
    links: ['Norman Borlaug', { title: 'Green Revolution' }, { target: 'Wheat' }],
  };
  const terms = extractLinkedTerms(article);
  assert.deepEqual(terms.sort(), ['Green Revolution', 'Hybrid Vigor', 'Norman Borlaug', 'Wheat'].sort());
});

test('extractLinkedTerms soft-fails to [] on junk input', () => {
  assert.deepEqual(extractLinkedTerms(null), []);
  assert.deepEqual(extractLinkedTerms(undefined), []);
  assert.deepEqual(extractLinkedTerms(42), []);
  assert.deepEqual(extractLinkedTerms('no links here'), []);
});

// ── missing-term detection respects existing titles case-insensitively ──────────────────────────
test('findMissingTerms excludes existing titles case- and space-insensitively', () => {
  const linked = ['Oilahuasca', 'Space Paste', 'Kyphi', 'New Term'];
  const existing = ['oilahuasca', 'SPACE_PASTE'];
  const missing = findMissingTerms(linked, existing);
  assert.deepEqual(missing, ['Kyphi', 'New Term']);
});

test('findMissingTerms accepts a Set of existing titles and de-dupes the input', () => {
  const linked = ['Kyphi', 'kyphi', 'Egregore'];
  const existing = new Set(['Egregore']);
  assert.deepEqual(findMissingTerms(linked, existing), ['Kyphi']);
});

test('findMissingTerms soft-fails to [] on bad input', () => {
  assert.deepEqual(findMissingTerms(null, ['x']), []);
  assert.deepEqual(findMissingTerms('not array', ['x']), []);
  assert.deepEqual(findMissingTerms(['A', 'B'], null), ['A', 'B']); // no existing → all missing
});

// ── generateStub returns the right shape with stub:true ─────────────────────────────────────────
test('generateStub returns a minimal valid stub article with stub:true + back-reference', () => {
  const stub = generateStub('Kyphi', { context: 'Egyptian Wax Headcones' });
  assert.equal(stub.title, 'Kyphi');
  assert.equal(stub.stub, true);
  assert.deepEqual(stub.linkedFrom, ['Egyptian Wax Headcones']);
  // body is a one-line "stub" sentence naming the term
  assert.match(stub.body, /Kyphi/);
  assert.match(stub.body, /stub/i);
  // content carries the back-reference as a wikilink so the graph stays connected
  assert.match(stub.content, /\[\[Egyptian Wax Headcones\]\]/);
  assert.match(stub.content, /\{\{stub\}\}/);
  // generic article fields present (matches generateArticle shape: title/content/body)
  assert.equal(typeof stub.content, 'string');
  assert.ok(stub.content.length > 0);
  assert.match(stub.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('generateStub works without a context (no back-reference) and trims the term', () => {
  const stub = generateStub('  Egregore  ');
  assert.equal(stub.title, 'Egregore');
  assert.equal(stub.stub, true);
  assert.deepEqual(stub.linkedFrom, []);
  assert.ok(!/linked from/i.test(stub.content));
});

test('generateStub soft-fails to null on bad term', () => {
  assert.equal(generateStub(''), null);
  assert.equal(generateStub('   '), null);
  assert.equal(generateStub(null), null);
  assert.equal(generateStub(123), null);
});

// ── stubsForArticle: one stub per missing term, none for existing terms ──────────────────────────
test('stubsForArticle produces one stub per missing term and none for existing terms', () => {
  const article = {
    title: 'Egyptian Wax Headcones',
    content: 'Built on [[Oilahuasca]], [[Kyphi]], and [[Punic Wax]]. See also [[Egregore]].',
  };
  const existing = ['Oilahuasca', 'egregore']; // Kyphi + Punic Wax are missing
  const stubs = stubsForArticle(article, existing);

  assert.equal(stubs.length, 2);
  const titles = stubs.map((s) => s.title).sort();
  assert.deepEqual(titles, ['Kyphi', 'Punic Wax']);
  for (const s of stubs) {
    assert.equal(s.stub, true);
    assert.deepEqual(s.linkedFrom, ['Egyptian Wax Headcones']);
  }
});

test('stubsForArticle does not stub a self-link to the article title', () => {
  const article = { title: 'Kyphi', content: 'A [[Kyphi]] note linking [[Sacred Incense]].' };
  const stubs = stubsForArticle(article, []);
  assert.deepEqual(stubs.map((s) => s.title), ['Sacred Incense']);
});

test('stubsForArticle returns [] when there are no missing terms', () => {
  const article = { title: 'A', content: 'Links [[B]] and [[C]].' };
  assert.deepEqual(stubsForArticle(article, ['B', 'C']), []);
});

test('stubsForArticle soft-fails to [] on bad input', () => {
  assert.deepEqual(stubsForArticle(null, ['x']), []);
  assert.deepEqual(stubsForArticle(undefined, []), []);
  // raw body string (no title) is acceptable input; back-reference is empty
  const stubs = stubsForArticle('Links [[Lone Term]].', []);
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0].title, 'Lone Term');
  assert.deepEqual(stubs[0].linkedFrom, []);
});

// ── normaliseTerm helper ────────────────────────────────────────────────────────────────────────
test('normaliseTerm lowercases, swaps underscores for spaces, collapses whitespace', () => {
  assert.equal(normaliseTerm('Space_Paste'), 'space paste');
  assert.equal(normaliseTerm('  CYP450   System '), 'cyp450 system');
  assert.equal(normaliseTerm(null), '');
  assert.equal(normaliseTerm(42), '');
});
