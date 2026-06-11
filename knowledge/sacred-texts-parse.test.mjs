// sacred-texts-parse.test.mjs — offline tests for the sacred-texts.com page parser.
// Run: node --test knowledge/sacred-texts-parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePage,
  extractCanonText,
  toDocument,
  guessTradition,
  esc,
} from './sacred-texts-parse.mjs';

const PAGE = [
  '<html><head><title>Sacred Texts: The Book of the Dead</title></head><body>',
  '<h1>The Book of the Dead</h1>',
  '<p>A preamble paragraph before any section.</p>',
  '<h3>The Chapter of Coming Forth by Day</h3>',
  '<p>Hail to thee, O great god&mdash;Lord of Truth.<a name="fnr1" href="#fn_1">1</a></p>',
  '<p>I have come unto thee. p. 7</p>',
  '<h3>The Chapter of Not Dying a Second Time</h3>',
  '<p>My heart, my mother; my heart whereby I came into being.</p>',
  '<hr>',
  '<a name="fn_1">1</a> "Lord of Truth" renders neb-maat.',
  '<a name="fn_2">2</a> A second note for completeness.',
  '</body></html>',
].join('\n');

test('parsePage extracts title, sections and footnotes (happy path)', () => {
  const r = parsePage(PAGE);
  assert.equal(r.title, 'The Book of the Dead');
  assert.equal(r.tradition, null); // parsePage has no URL to map
  // preamble (heading null) + 2 h3 sections
  assert.equal(r.sections.length, 3);
  assert.equal(r.sections[0].heading, null);
  assert.equal(r.sections[1].heading, 'The Chapter of Coming Forth by Day');
  assert.equal(r.sections[1].paragraphs.length, 2);
  assert.equal(r.sections[2].heading, 'The Chapter of Not Dying a Second Time');
  // footnotes captured in order with their numbers
  assert.equal(r.footnotes.length, 2);
  assert.equal(r.footnotes[0].n, '1');
  assert.match(r.footnotes[0].text, /neb-maat/);
  assert.equal(r.footnotes[1].n, '2');
});

test('parsePage decodes entities in paragraph text', () => {
  const r = parsePage(PAGE);
  assert.match(r.sections[1].paragraphs[0], /great god—Lord of Truth/);
});

test('extractCanonText joins body and normalizes page-number noise', () => {
  const txt = extractCanonText(PAGE);
  assert.ok(txt.length > 0);
  assert.match(txt, /Hail to thee/);
  assert.match(txt, /heart whereby I came into being/);
  // "p. 7" page marker stripped
  assert.ok(!/p\.\s*7/.test(txt));
  // headings appear in the canon text
  assert.match(txt, /The Chapter of Coming Forth by Day/);
});

test('guessTradition maps known path segments', () => {
  assert.equal(guessTradition('https://sacred-texts.com/egy/pyt/pyt03.htm'), 'Egyptian');
  assert.equal(guessTradition('https://sacred-texts.com/cla/homer/ili.htm'), 'Classical');
  assert.equal(guessTradition('https://sacred-texts.com/pag/index.htm'), 'Paganism & Wicca');
  assert.equal(guessTradition('/hin/rigveda/rv01001.htm'), 'Hinduism');
});

test('guessTradition returns null for unknown or empty', () => {
  assert.equal(guessTradition('https://sacred-texts.com/zzz/foo.htm'), null);
  assert.equal(guessTradition(''), null);
  assert.equal(guessTradition(null), null);
  assert.equal(guessTradition('not a url at all'), null);
});

test('toDocument assembles a corpus document, tradition from url', () => {
  const doc = toDocument(PAGE, { url: 'https://sacred-texts.com/egy/boe/index.htm' });
  assert.equal(doc.title, 'The Book of the Dead');
  assert.equal(doc.tradition, 'Egyptian');
  assert.equal(doc.source, 'https://sacred-texts.com/egy/boe/index.htm');
  assert.ok(doc.wordCount > 0);
  assert.equal(doc.sections.length, 3);
  assert.match(doc.body, /Hail to thee/);
});

test('toDocument honors explicit tradition override', () => {
  const doc = toDocument(PAGE, { url: 'https://sacred-texts.com/egy/x.htm', tradition: 'Custom' });
  assert.equal(doc.tradition, 'Custom');
});

test('toDocument with no url yields null tradition and empty source', () => {
  const doc = toDocument(PAGE);
  assert.equal(doc.tradition, null);
  assert.equal(doc.source, '');
});

test('soft-fail: empty / null / undefined input never throws', () => {
  for (const bad of ['', null, undefined]) {
    const p = parsePage(bad);
    assert.deepEqual(p, { title: null, tradition: null, sections: [], footnotes: [] });
    assert.equal(extractCanonText(bad), '');
    const d = toDocument(bad);
    assert.equal(d.title, null);
    assert.deepEqual(d.sections, []);
    assert.equal(d.body, '');
    assert.equal(d.wordCount, 0);
  }
});

test('soft-fail: garbled HTML with no h1/h3/p degrades gracefully', () => {
  const garbled = '<div><span>just some loose text</span></div>';
  const p = parsePage(garbled);
  assert.equal(p.title, null);
  assert.deepEqual(p.sections, []);
  assert.deepEqual(p.footnotes, []);
  // extractCanonText falls back to a flat strip
  assert.match(extractCanonText(garbled), /just some loose text/);
});

test('title falls back to <title> with site name trimmed', () => {
  const html = '<html><head><title>Sacred Texts: Just A Title</title></head><body><p>x</p></body></html>';
  assert.equal(parsePage(html).title, 'Just A Title');
});

test('script and style blocks are dropped from canon text', () => {
  const html = [
    '<h1>T</h1>',
    '<script>var leak = "SHOULD_NOT_APPEAR";</script>',
    '<style>.x{color:red}</style>',
    '<p>real body text</p>',
  ].join('\n');
  const txt = extractCanonText(html);
  assert.match(txt, /real body text/);
  assert.ok(!/SHOULD_NOT_APPEAR/.test(txt));
  assert.ok(!/color:red/.test(txt));
});

test('non-string input is coerced (numbers/objects do not throw)', () => {
  assert.doesNotThrow(() => parsePage(12345));
  assert.doesNotThrow(() => extractCanonText({}));
  assert.doesNotThrow(() => toDocument([], { url: 7 }));
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
