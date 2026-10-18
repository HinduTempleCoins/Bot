// markdown-doc.test.mjs — offline, node:test. Escape-first renderer safety: no byte of the source
// markdown can become a live HTML tag; only the fixed tag set is ever emitted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, renderMarkdown, readDoc } from './markdown-doc.mjs';

test('esc escapes &, <, > and " and turns null/undefined into an empty string', () => {
  assert.equal(esc('a & b < c > d " e'), 'a &amp; b &lt; c &gt; d &quot; e');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('esc leaves already-escaped text alone (idempotent on the documented fixtures)', () => {
  assert.equal(esc('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
});

test('renderMarkdown emits h1 through h4', () => {
  const md = '# one\n## two\n### three\n#### four';
  const out = renderMarkdown(md);
  for (let n = 1; n <= 4; n++) {
    assert.ok(out.includes(`<h${n}>`), `h${n} present`);
    assert.ok(out.includes(`</h${n}>`), `h${n} closed`);
  }
});

test('renderMarkdown builds nested-free ul/li lists and closes them', () => {
  const out = renderMarkdown('- a\n- b\n\nsome text');
  assert.ok(out.includes('<ul>'));
  assert.equal((out.match(/<li>/g) || []).length, 2);
  assert.ok(out.includes('</ul>'), 'list closed before the paragraph');
  assert.ok(out.includes('<p>some text</p>'));
});

test('renderMarkdown renders blockquotes from escaped "> " lines', () => {
  const out = renderMarkdown('> quoted words');
  assert.ok(out.includes('<blockquote>quoted words</blockquote>'));
});

test('renderMarkdown renders hr from --- lines', () => {
  assert.ok(renderMarkdown('a\n\n---\n\nb').includes('<hr>'));
});

test('renderMarkdown applies inline code, bold and italics', () => {
  const out = renderMarkdown('`c=x` and **b** and *i* and _u_');
  assert.ok(out.includes('<code>c=x</code>'));
  assert.ok(out.includes('<b>b</b>'));
  assert.ok(out.includes('<i>i</i>'));
  assert.ok(out.includes('<i>u</i>'));
});

test('pipe tables: header row becomes th cells and the |---| separator row is skipped', () => {
  const out = renderMarkdown('| h1 | h2 |\n|---|---|\n| a | b |');
  assert.ok(out.includes('<th>'), 'header th');
  assert.ok(out.includes('<td>a</td>'));
  assert.ok(out.includes('<td>b</td>'));
  assert.ok(!out.includes('<td>---</td>'), 'separator row skipped');
});

test('pipe tables are wrapped in <div class=tw>', () => {
  const out = renderMarkdown('| h1 |\n|---|\n| a |');
  assert.ok(out.includes('<div class=tw><table>'));
  assert.ok(out.includes('</table></div>'));
});

test('THE SAFETY PROPERTY: a <script> block in the source comes out escaped, never live', () => {
  const out = renderMarkdown('before\n\n<script>alert(1)</script>\n\nafter');
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!out.includes('<script>'), 'no live script tag');
});

test('THE SAFETY PROPERTY: an <img onerror=...> comes out escaped, never live', () => {
  const out = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(out.includes('&lt;img src='));
  assert.ok(!out.includes('<img'), 'no live img tag');
});

test('THE SAFETY PROPERTY: a table cell containing <b> stays escaped inside the cell', () => {
  const out = renderMarkdown('| h |\n|---|\n| <b>bold</b> |');
  assert.ok(out.includes('<td>&lt;b&gt;bold&lt;/b&gt;</td>'));
  assert.ok(!out.includes('<b>'), 'no live b tag');
});

test('readDoc soft-fails a missing file to the <h1> + <p> placeholder without throwing', async () => {
  const out = await readDoc('/nonexistent/nope-does-not-exist.md');
  assert.ok(out.startsWith('<h1>'), 'placeholder heading present');
  assert.ok(out.includes('<p>'), 'placeholder paragraph present');
  assert.ok(!out.includes('<hr>'), 'no document body leaked');
  const custom = await readDoc('/nonexistent/nope.md', { title: 'My Doc', missing: 'soon' });
  assert.ok(custom.includes('<h1>My Doc</h1>'));
  assert.ok(custom.includes('<p>soon</p>'));
});
