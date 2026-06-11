// gutenberg-parse.test.mjs — offline tests for the Gutenberg plain-text parser.
// node:test + node:assert/strict, no network, happy + edge/soft-fail paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc,
  stripBoilerplate,
  extractMeta,
  splitChapters,
  countWords,
  toDocument,
} from './gutenberg-parse.mjs';

const SAMPLE = [
  'The Project Gutenberg eBook of A Small Sample',
  '',
  'Title: A Small Sample',
  'Author: Jane Example',
  'Release Date: January 1, 2000',
  'Language: English',
  '',
  '*** START OF THE PROJECT GUTENBERG EBOOK A SMALL SAMPLE ***',
  '',
  'CHAPTER I',
  '',
  'It was the first chapter.',
  '',
  'CHAPTER II',
  '',
  'The second chapter followed.',
  '',
  '*** END OF THE PROJECT GUTENBERG EBOOK A SMALL SAMPLE ***',
  '',
  'This eBook is for the use of anyone anywhere ... (license tail).',
].join('\n');

// ── esc ───────────────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters and null', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── stripBoilerplate ────────────────────────────────────────────────────────────────
test('stripBoilerplate returns only the work body between markers', () => {
  const body = stripBoilerplate(SAMPLE);
  assert.ok(body.includes('CHAPTER I'));
  assert.ok(body.includes('The second chapter followed.'));
  assert.ok(!body.includes('Title: A Small Sample'), 'header stripped');
  assert.ok(!body.includes('license tail'), 'license tail stripped');
  assert.ok(!body.includes('START OF'), 'start marker removed');
  assert.ok(!body.includes('END OF'), 'end marker removed');
});

test('stripBoilerplate handles older "THIS PROJECT GUTENBERG" phrasing', () => {
  const txt = [
    'header',
    '*** START OF THIS PROJECT GUTENBERG EBOOK FOO ***',
    'real body',
    '*** END OF THIS PROJECT GUTENBERG EBOOK FOO ***',
    'tail',
  ].join('\n');
  assert.equal(stripBoilerplate(txt), 'real body');
});

test('stripBoilerplate soft-fails on missing markers (returns trimmed text)', () => {
  assert.equal(stripBoilerplate('  just some text  '), 'just some text');
  assert.equal(stripBoilerplate(''), '');
  assert.equal(stripBoilerplate(null), '');
  assert.equal(stripBoilerplate(undefined), '');
  assert.equal(stripBoilerplate(12345), '12345');
});

test('stripBoilerplate with only a START marker keeps everything after it', () => {
  const txt = 'preamble\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nbody only';
  assert.equal(stripBoilerplate(txt), 'body only');
});

// ── extractMeta ──────────────────────────────────────────────────────────────────────
test('extractMeta parses the standard header fields', () => {
  const meta = extractMeta(SAMPLE);
  assert.deepEqual(meta, {
    title: 'A Small Sample',
    author: 'Jane Example',
    language: 'English',
    releaseDate: 'January 1, 2000',
  });
});

test('extractMeta returns null per-field when absent', () => {
  const meta = extractMeta('Title: Only A Title\n\nbody');
  assert.equal(meta.title, 'Only A Title');
  assert.equal(meta.author, null);
  assert.equal(meta.language, null);
  assert.equal(meta.releaseDate, null);
});

test('extractMeta soft-fails on empty/non-string', () => {
  const allNull = { title: null, author: null, language: null, releaseDate: null };
  assert.deepEqual(extractMeta(''), allNull);
  assert.deepEqual(extractMeta(null), allNull);
  assert.deepEqual(extractMeta(undefined), allNull);
});

test('extractMeta ignores body text after START that mimics a header', () => {
  // "Author:" inside the body (after START) must not override the real header.
  const meta = extractMeta(SAMPLE.replace('It was the first chapter.', 'Author: Impostor'));
  assert.equal(meta.author, 'Jane Example');
});

test('extractMeta accepts Posting Date as a release-date fallback', () => {
  const meta = extractMeta('Title: T\nPosting Date: March 2008');
  assert.equal(meta.releaseDate, 'March 2008');
});

// ── splitChapters ──────────────────────────────────────────────────────────────────
test('splitChapters splits on CHAPTER headings', () => {
  const body = stripBoilerplate(SAMPLE);
  const chapters = splitChapters(body);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].heading, 'CHAPTER I');
  assert.equal(chapters[0].text, 'It was the first chapter.');
  assert.equal(chapters[1].heading, 'CHAPTER II');
  assert.equal(chapters[1].text, 'The second chapter followed.');
});

test('splitChapters splits on BOOK/PART and bare Roman-numeral dividers', () => {
  const body = [
    'BOOK ONE',
    'opening',
    'IV.',
    'roman section',
    'PART II',
    'closing',
  ].join('\n');
  const chapters = splitChapters(body);
  assert.deepEqual(chapters.map((c) => c.heading), ['BOOK ONE', 'IV.', 'PART II']);
  assert.equal(chapters[1].text, 'roman section');
});

test('splitChapters captures preface text before the first heading', () => {
  const body = 'Some front matter.\n\nCHAPTER I\n\nThe body.';
  const chapters = splitChapters(body);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].heading, null);
  assert.equal(chapters[0].text, 'Some front matter.');
  assert.equal(chapters[1].heading, 'CHAPTER I');
});

test('splitChapters soft-fails: no headings → one untitled chapter', () => {
  const chapters = splitChapters('just a paragraph with no headings at all');
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].heading, null);
  assert.equal(chapters[0].text, 'just a paragraph with no headings at all');
});

test('splitChapters on empty/whitespace → []', () => {
  assert.deepEqual(splitChapters(''), []);
  assert.deepEqual(splitChapters('   \n  \n'), []);
  assert.deepEqual(splitChapters(null), []);
});

// ── countWords ──────────────────────────────────────────────────────────────────────
test('countWords counts whitespace-delimited tokens; empty → 0', () => {
  assert.equal(countWords('one two three'), 3);
  assert.equal(countWords('  spaced \n\n out  words '), 3);
  assert.equal(countWords(''), 0);
  assert.equal(countWords(null), 0);
});

// ── toDocument ──────────────────────────────────────────────────────────────────────
test('toDocument assembles meta + chapters + wordCount + source', () => {
  const doc = toDocument(SAMPLE);
  assert.equal(doc.source, 'gutenberg');
  assert.equal(doc.meta.title, 'A Small Sample');
  assert.equal(doc.chapters.length, 2);
  assert.ok(doc.wordCount > 0);
  // wordCount is over the stripped body, not the header/license.
  assert.equal(doc.wordCount, countWords(stripBoilerplate(SAMPLE)));
});

test('toDocument honors a custom source', () => {
  const doc = toDocument(SAMPLE, { source: 'archive.org' });
  assert.equal(doc.source, 'archive.org');
});

test('toDocument soft-fails on empty input', () => {
  const doc = toDocument('');
  assert.deepEqual(doc, {
    meta: { title: null, author: null, language: null, releaseDate: null },
    chapters: [],
    wordCount: 0,
    source: 'gutenberg',
  });
});

test('toDocument soft-fails on null/undefined input', () => {
  for (const v of [null, undefined]) {
    const doc = toDocument(v);
    assert.deepEqual(doc.chapters, []);
    assert.equal(doc.wordCount, 0);
    assert.equal(doc.source, 'gutenberg');
  }
});

test('toDocument is deterministic (identical input → identical output)', () => {
  assert.deepEqual(toDocument(SAMPLE), toDocument(SAMPLE));
});
