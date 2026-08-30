// render.test.mjs — the MediaWiki-lite → HTML renderer (render.mjs). Pure functions, fully offline.
// Two jobs: (1) XSS guard — raw HTML in an article must be escaped before markup is applied, so a
// malicious/fact-checked-but-hostile source can't inject script; (2) markup fidelity — [[links]],
// '''bold''', ''italic'', <ref> footnotes, headers and lists transform correctly.
// Run: node --test site/wiki/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderWiki, buildToc, esc, slugify, titleize } from './render.mjs';

test('esc escapes the HTML metacharacters', () => {
  assert.equal(esc(`<>&"`), '&lt;&gt;&amp;&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('renderWiki ESCAPES raw HTML before applying markup (XSS guard)', () => {
  const { html } = renderWiki('A line with <script>alert(1)</script> and an <img src=x onerror=alert(2)>.');
  assert.ok(!/<script>/i.test(html), 'raw <script> must not survive');
  assert.ok(!/<img/i.test(html), 'raw <img> must not survive');
  assert.ok(html.includes('&lt;script&gt;'), 'script tag must be escaped to entities');
  assert.ok(html.includes('alert(1)'), 'inner text is preserved (as inert text)');
});

test('renderWiki does not let raw HTML break out via a [[link|text]] label', () => {
  // The label of a piped wikilink becomes anchor content. A hostile label must stay inert.
  const { html } = renderWiki('See [[Target|<script>alert(3)</script>]].');
  assert.ok(!/<script>/i.test(html), 'no live script may appear via a link label');
  assert.ok(/<a href="\/wiki\/Target">/.test(html), 'the link itself still renders');
  assert.ok(html.includes('&lt;script&gt;'), 'the label is escaped');
});

test('renderWiki does not let raw HTML break out via bold/italic content', () => {
  const { html } = renderWiki(`'''<b onclick=evil()>x</b>''' and ''<i>y</i>''`);
  // user-supplied tags are escaped to entities; only the markup-generated <b>/<i> are real tags.
  // The raw "<b onclick=...>" must be inert — escaped, never a live tag with a live handler.
  assert.ok(!/<b onclick/i.test(html), 'no live <b onclick> tag may survive');
  assert.ok(html.includes('&lt;b onclick=evil()&gt;'), 'the inner raw tag is escaped to entities');
  assert.ok(/<b>/.test(html) && /<i>/.test(html), 'markup-generated bold/italic are real tags');
});

test('renderWiki transforms [[Plain Link]] and [[Target|Label]]', () => {
  const a = renderWiki('Go to [[Oilahuasca]] now.');
  assert.ok(a.html.includes('<a href="/wiki/Oilahuasca">Oilahuasca</a>'), 'plain wikilink → anchor');
  const b = renderWiki('Go to [[Some Page|the page]].');
  assert.ok(b.html.includes('<a href="/wiki/Some_Page">the page</a>'), 'piped wikilink → anchor with label + slugified target');
});

test('renderWiki transforms bold and italic', () => {
  const { html } = renderWiki(`This is '''bold''' and this is ''italic''.`);
  assert.ok(html.includes('<b>bold</b>'), 'triple-quote → bold');
  assert.ok(html.includes('<i>italic</i>'), 'double-quote → italic');
});

test('renderWiki turns <ref> into numbered footnotes and collects refs', () => {
  const { html, refs, footnotes } = renderWiki('A claim<ref>source-a.md</ref> and another<ref>source-b.md</ref> and a repeat<ref>source-a.md</ref>.');
  assert.deepEqual(refs, ['source-a.md', 'source-b.md'], 'unique refs collected in order');
  assert.ok(/<sup class=ref><a href="#ref1"[^>]*>\[1\]<\/a><\/sup>/.test(html), 'first ref → [1]');
  assert.ok(/<sup class=ref><a href="#ref2"[^>]*>\[2\]<\/a><\/sup>/.test(html), 'second ref → [2]');
  assert.ok(/\[1\]/.test(html.split('source-b')[1] || html), 'repeated source reuses [1]');
  assert.ok(/<h2[^>]*>References<\/h2>/.test(footnotes), 'footnotes block has a References heading');
  assert.ok(footnotes.includes('id=ref1') && footnotes.includes('source-a.md'), 'footnote anchors + filenames present');
});

test('renderWiki escapes a ref filename in the footnote + title (no breakout)', () => {
  const { html, footnotes } = renderWiki('x<ref>"><script>bad()</script></ref>');
  assert.ok(!/<script>/i.test(html + footnotes), 'a hostile ref filename cannot inject script');
});

test('renderWiki handles headers and lists', () => {
  const { html } = renderWiki('== History ==\n* one\n* two\n\n# first\n# second');
  assert.ok(/<h2[^>]*>History<\/h2>/.test(html), '== → h2 (with anchor id)');
  assert.ok(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/.test(html), 'bullets → <ul>');
  assert.ok(/<ol>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/.test(html), 'hashes → <ol>');
});

test('renderWiki gives headings anchor ids and buildToc lists them', () => {
  const { html } = renderWiki('== History ==\ntext\n== Uses ==\nmore\n=== Detail ===\nx');
  assert.ok(/<h2 id="History">History<\/h2>/.test(html), 'h2 carries a slugged id');
  assert.ok(/<h3 id="Detail">Detail<\/h3>/.test(html), 'h3 carries a slugged id');
  const toc = buildToc(html);
  assert.ok(toc.includes('href="#History"') && toc.includes('href="#Uses"'), 'TOC links the section anchors');
  assert.ok(toc.includes('class="h3"'), 'TOC marks h3 depth');
  assert.equal(buildToc('<h2 id="only">Only one</h2>'), '', 'a single heading yields no TOC');
});

test('renderWiki dedupes duplicate heading ids', () => {
  const { html } = renderWiki('== See also ==\na\n== See also ==\nb');
  assert.ok(/id="See_also"/.test(html) && /id="See_also-2"/.test(html), 'second identical heading gets a -2 suffix');
});

test('renderWiki strips the bot preamble', () => {
  const { html } = renderWiki('The Library of Ashurbanipal presents the following wiki article:\n---\nReal body here.');
  assert.ok(html.includes('Real body here.'), 'body kept');
  assert.ok(!/presents the following/i.test(html), 'preamble removed');
});

test('slugify and titleize round-trip sensibly', () => {
  assert.equal(slugify('Some Page.wiki'), 'Some_Page');
  assert.equal(titleize('Some_Page'), 'Some Page');
  assert.equal(slugify('a/b<c>d'), 'abcd', 'unsafe path chars dropped');
});

test('renderWiki: external links [url text], bare [url], and autolinked URLs — internal [[links]] unaffected', () => {
  const { html } = renderWiki('A [https://pool.soapbox.community pool] link, a bare [https://x.test], an autolink https://credentials.soapbox.community and an [[Internal Page]].');
  assert.match(html, /<a href="https:\/\/pool\.soapbox\.community" rel="nofollow">pool<\/a>/);
  assert.match(html, /<a href="https:\/\/x\.test" rel="nofollow">https:\/\/x\.test<\/a>/);
  assert.match(html, /<a href="https:\/\/credentials\.soapbox\.community" rel="nofollow">/);
  assert.match(html, /<a href="\/wiki\/Internal_Page">Internal Page<\/a>/);   // internal still works
});
