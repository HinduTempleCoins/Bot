// mwRender.test.js — tests for the MediaWiki-markup → HTML renderer (#87).
//
// Covers: headings/bold/italic convert; [[links]] and [[a|b]] render with escaped/encoded href;
// external link rejects a javascript: scheme (text, not a link); lists convert; a <script> in source
// is neutralized (no live script in output); <ref> produces a footnote + references section; garbage
// input soft-fails to a string. node:test + node:assert/strict, no new deps, no network.
//
// Run: node test/mwRender.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkup, extractRefs } from '../src/mwRender.js';

// ── headings ────────────────────────────────────────────────────────────────────────────────────
test('== H2 == and === H3 === become <h2>/<h3> with escaped text', () => {
  const html = renderMarkup('== Overview ==\n\n=== Sub & Section ===');
  assert.match(html, /<h2>Overview<\/h2>/);
  assert.match(html, /<h3>Sub &amp; Section<\/h3>/);
});

// ── bold / italic ───────────────────────────────────────────────────────────────────────────────
test('bold and italic convert to <strong>/<em>', () => {
  const html = renderMarkup("This is '''bold''' and ''italic'' text.");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
});

// ── internal links ──────────────────────────────────────────────────────────────────────────────
test('[[Target]] renders an anchor to /wiki/Target', () => {
  const html = renderMarkup('See [[Oilahuasca]].');
  assert.match(html, /<a href="\/wiki\/Oilahuasca">Oilahuasca<\/a>/);
});

test('[[Target|label]] uses the label, encodes the target href', () => {
  const html = renderMarkup('See [[Space Paste|the recipe]].');
  // space → underscore, then a normal path segment
  assert.match(html, /<a href="\/wiki\/Space_Paste">the recipe<\/a>/);
});

test('internal-link target is HTML-escaped (no injection via target)', () => {
  const html = renderMarkup('[[Foo"<bar>]]');
  assert.ok(!html.includes('<bar>'), 'raw <bar> must not appear');
  assert.ok(!html.includes('"<'), 'unescaped quote+angle must not appear');
});

// ── external links ──────────────────────────────────────────────────────────────────────────────
test('external http link renders with rel="nofollow noopener"', () => {
  const html = renderMarkup('[https://bitsharestalk.org/ BitSharesTalk]');
  assert.match(html, /<a href="https:\/\/bitsharestalk\.org\/" rel="nofollow noopener">BitSharesTalk<\/a>/);
});

test('external link with a javascript: scheme is NOT a link (rendered as text)', () => {
  const html = renderMarkup('[javascript:alert(1) click me]');
  assert.ok(!/<a\b[^>]*href="javascript:/i.test(html), 'must not emit a javascript: href');
  assert.ok(!html.toLowerCase().includes('<a href="javascript'), 'no javascript anchor');
  // the literal text remains, escaped, not as a live link
  assert.match(html, /click me/);
});

test('external link with a data: scheme is rejected', () => {
  const html = renderMarkup('[data:text/html,<script>alert(1)</script> x]');
  assert.ok(!/href="data:/i.test(html), 'no data: href');
  assert.ok(!/<script/i.test(html), 'no live script');
});

// ── lists ───────────────────────────────────────────────────────────────────────────────────────
test('* items convert to a <ul>, # items convert to an <ol>', () => {
  const ul = renderMarkup('* one\n* two');
  assert.match(ul, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  const ol = renderMarkup('# first\n# second');
  assert.match(ol, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test('list items still get inline formatting', () => {
  const html = renderMarkup("* see [[Kyphi]] and '''bold'''");
  assert.match(html, /<li>see <a href="\/wiki\/Kyphi">Kyphi<\/a> and <strong>bold<\/strong><\/li>/);
});

// ── paragraphs ──────────────────────────────────────────────────────────────────────────────────
test('blank-line-separated text becomes <p> blocks', () => {
  const html = renderMarkup('First paragraph.\n\nSecond paragraph.');
  assert.match(html, /<p>First paragraph\.<\/p>/);
  assert.match(html, /<p>Second paragraph\.<\/p>/);
});

// ── XSS / dangerous HTML neutralization ─────────────────────────────────────────────────────────
test('a <script> in source is neutralized (no live script in output)', () => {
  const html = renderMarkup('Hello <script>alert("xss")</script> world');
  assert.ok(!/<script/i.test(html), 'output must contain no <script tag');
  assert.ok(!html.includes('alert("xss")') || !/<script/i.test(html), 'no executable script');
});

test('an <iframe> and on*= handler are neutralized', () => {
  const html = renderMarkup('<iframe src="evil"></iframe>\n\n<img src=x onerror="alert(1)">');
  assert.ok(!/<iframe/i.test(html), 'no iframe tag');
  assert.ok(!/onerror=/i.test(html), 'no onerror handler');
  assert.ok(!/<img[^>]*onerror/i.test(html), 'no live img with handler');
});

test('angle brackets in plain prose are escaped, not emitted as tags', () => {
  const html = renderMarkup('Use the <b>tag</b> carefully.');
  assert.match(html, /&lt;b&gt;tag&lt;\/b&gt;/);
});

// ── references ──────────────────────────────────────────────────────────────────────────────────
test('<ref> produces a numbered footnote marker AND a references section', () => {
  const html = renderMarkup('Claim one.<ref>Source A, 2020</ref>\n\nClaim two.<ref>Source B, 2021</ref>');
  // footnote markers
  assert.match(html, /<sup class="reference"><a href="#cite_note-1">\[1\]<\/a><\/sup>/);
  assert.match(html, /<sup class="reference"><a href="#cite_note-2">\[2\]<\/a><\/sup>/);
  // references section
  assert.match(html, /<h2>References<\/h2>/);
  assert.match(html, /<li id="cite_note-1">Source A, 2020<\/li>/);
  assert.match(html, /<li id="cite_note-2">Source B, 2021<\/li>/);
});

test('ref body is escaped (no injection through a citation)', () => {
  const html = renderMarkup('X.<ref><script>alert(1)</script> Cite</ref>');
  assert.ok(!/<script/i.test(html), 'no script via ref body');
});

test('extractRefs returns the citation list, numbered', () => {
  const refs = extractRefs('A.<ref>First cite</ref> B.<ref>Second cite</ref>');
  assert.deepEqual(refs, [
    { n: 1, text: 'First cite' },
    { n: 2, text: 'Second cite' },
  ]);
});

test('extractRefs soft-fails to [] on bad input', () => {
  assert.deepEqual(extractRefs(null), []);
  assert.deepEqual(extractRefs(undefined), []);
  assert.deepEqual(extractRefs(42), []);
  assert.deepEqual(extractRefs('no refs here'), []);
});

test('no references section when there are no refs', () => {
  const html = renderMarkup('Just a sentence.');
  assert.ok(!/References/.test(html), 'no References heading when no refs');
});

// ── soft-fail on garbage input ──────────────────────────────────────────────────────────────────
test('garbage input soft-fails to a string (never throws)', () => {
  assert.equal(typeof renderMarkup(null), 'string');
  assert.equal(typeof renderMarkup(undefined), 'string');
  assert.equal(typeof renderMarkup(42), 'string');
  assert.equal(typeof renderMarkup({}), 'string');
  assert.equal(typeof renderMarkup([]), 'string');
  assert.equal(renderMarkup(''), '');
  assert.equal(renderMarkup('   '), '');
});

// ── combined / integration ──────────────────────────────────────────────────────────────────────
test('a realistic generator-style article renders without leaking anything live', () => {
  const wiki = [
    '== Oilahuasca ==',
    '',
    "Oilahuasca is an '''essential-oil''' based methodology.<ref>Shulgin, TIHKAL</ref>",
    '',
    '=== See Also ===',
    '',
    '* [[Space Paste]]',
    '* [[CYP450 Enzyme System|liver enzymes]]',
    '',
    'External: [https://example.org/ Example]',
  ].join('\n');
  const html = renderMarkup(wiki);
  assert.match(html, /<h2>Oilahuasca<\/h2>/);
  assert.match(html, /<strong>essential-oil<\/strong>/);
  assert.match(html, /<a href="\/wiki\/Space_Paste">Space Paste<\/a>/);
  assert.match(html, /<a href="\/wiki\/CYP450_Enzyme_System">liver enzymes<\/a>/);
  assert.match(html, /rel="nofollow noopener"/);
  assert.match(html, /<h2>References<\/h2>/);
  assert.ok(!/<script/i.test(html));
});
