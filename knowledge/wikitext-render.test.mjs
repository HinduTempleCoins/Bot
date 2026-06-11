// wikitext-render.test.mjs — offline tests for the MediaWiki wikitext renderer.
// node:test + node:assert/strict, no network, no file I/O. Happy paths + soft-fail edges.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mdToWikitext,
  recordToArticle,
  buildInfobox,
  escapeWikitext,
  esc,
} from './wikitext-render.mjs';

// ── mdToWikitext: headings ─────────────────────────────────────────────────────────
test('mdToWikitext converts headings #..###### to ==..======', () => {
  // Markdown level N → wiki level N+1 (wiki reserves single "=" for the page title).
  assert.equal(mdToWikitext('# Title'), '== Title ==');
  assert.equal(mdToWikitext('### Sub'), '==== Sub ====');
  assert.equal(mdToWikitext('###### Deep'), '====== Deep ======'); // clamped at 6
});

test('mdToWikitext strips trailing ATX hashes from headings', () => {
  assert.equal(mdToWikitext('## Heading ##'), '=== Heading ===');
});

// ── mdToWikitext: bold / italic ──────────────────────────────────────────────────────
test('mdToWikitext converts bold and italic', () => {
  assert.equal(mdToWikitext('**bold**'), "'''bold'''");
  assert.equal(mdToWikitext('__bold__'), "'''bold'''");
  assert.equal(mdToWikitext('*it*'), "''it''");
  assert.equal(mdToWikitext('_it_'), "''it''");
});

test('mdToWikitext handles bold and italic on the same line', () => {
  assert.equal(mdToWikitext('a **b** and *c*'), "a '''b''' and ''c''");
});

// ── mdToWikitext: lists ──────────────────────────────────────────────────────────────
test('mdToWikitext converts bullet lists (- * +) to *', () => {
  assert.equal(mdToWikitext('- one\n* two\n+ three'), '* one\n* two\n* three');
});

test('mdToWikitext converts numbered lists to #', () => {
  assert.equal(mdToWikitext('1. one\n2. two'), '# one\n# two');
  assert.equal(mdToWikitext('1) one'), '# one');
});

// ── mdToWikitext: links ──────────────────────────────────────────────────────────────
test('mdToWikitext converts [text](url) to [url text]', () => {
  assert.equal(
    mdToWikitext('see [the docs](https://example.org/d)'),
    'see [https://example.org/d the docs]'
  );
});

test('mdToWikitext link with empty text emits bare [url]', () => {
  assert.equal(mdToWikitext('[](https://example.org)'), '[https://example.org]');
});

// ── mdToWikitext: code fences ────────────────────────────────────────────────────────
test('mdToWikitext converts fenced code to syntaxhighlight with lang', () => {
  const out = mdToWikitext('```js\nconst x = 1;\n```');
  assert.equal(out, '<syntaxhighlight lang="js">\nconst x = 1;\n</syntaxhighlight>');
});

test('mdToWikitext fence without lang omits the lang attr', () => {
  const out = mdToWikitext('```\nplain\n```');
  assert.equal(out, '<syntaxhighlight>\nplain\n</syntaxhighlight>');
});

test('mdToWikitext does not transform inline markup inside a code fence', () => {
  const out = mdToWikitext('```\n**not bold** and [no](link)\n```');
  assert.match(out, /\*\*not bold\*\* and \[no\]\(link\)/);
});

test('mdToWikitext soft-fails on an unterminated code fence (flushes block)', () => {
  const out = mdToWikitext('```js\nconst x = 1;');
  assert.match(out, /^<syntaxhighlight lang="js">/);
  assert.match(out, /const x = 1;/);
  assert.match(out, /<\/syntaxhighlight>$/);
});

// ── mdToWikitext: soft-fail input ────────────────────────────────────────────────────
test('mdToWikitext soft-fails on null/undefined/empty', () => {
  assert.equal(mdToWikitext(null), '');
  assert.equal(mdToWikitext(undefined), '');
  assert.equal(mdToWikitext(''), '');
  assert.equal(mdToWikitext('   '), '');
});

test('mdToWikitext coerces non-string input', () => {
  assert.equal(mdToWikitext(42), '42');
});

// ── escapeWikitext ───────────────────────────────────────────────────────────────────
test('escapeWikitext escapes wiki-significant characters', () => {
  const out = escapeWikitext("[link]{tpl}|x=y '*<>");
  // No raw structural markup chars survive (the # in numeric entities is expected).
  assert.doesNotMatch(out, /[[\]{}|=*]/, 'raw wiki markup chars remain');
  assert.doesNotMatch(out, /</, 'raw < survives');
  assert.doesNotMatch(out, />/, 'raw > survives');
  assert.match(out, /&#91;/); // [
  assert.match(out, /&#124;/); // |
  assert.match(out, /&lt;/);
});

test('escapeWikitext soft-fails on null/empty', () => {
  assert.equal(escapeWikitext(null), '');
  assert.equal(escapeWikitext(''), '');
});

// ── buildInfobox ─────────────────────────────────────────────────────────────────────
test('buildInfobox renders fields as | key = value rows', () => {
  const box = buildInfobox({ name: 'Hathor', type: 'witness' });
  assert.match(box, /^\{\{Infobox/);
  assert.match(box, /\| name = Hathor/);
  assert.match(box, /\| type = witness/);
  assert.match(box, /\}\}$/);
});

test('buildInfobox escapes values so they cannot break the box', () => {
  const box = buildInfobox({ x: 'a|b=c}}' });
  // The value's pipes/equals/braces are escaped; only the row's own "| x = " uses raw |.
  const valuePart = box.replace(/^\{\{Infobox\n\| x = /, '').replace(/\n\}\}$/, '');
  assert.doesNotMatch(valuePart, /[|={}]/, 'value chars escaped');
  assert.match(box, /&#124;/);
});

test('buildInfobox skips empty/null fields', () => {
  const box = buildInfobox({ a: '', b: null, c: 'keep' });
  assert.doesNotMatch(box, /\| a /);
  assert.doesNotMatch(box, /\| b /);
  assert.match(box, /\| c = keep/);
});

test('buildInfobox soft-fails to empty string on no usable fields', () => {
  assert.equal(buildInfobox({}), '');
  assert.equal(buildInfobox(null), '');
  assert.equal(buildInfobox('nope'), '');
  assert.equal(buildInfobox([1, 2]), '');
  assert.equal(buildInfobox({ a: '', b: null }), '');
});

// ── recordToArticle ──────────────────────────────────────────────────────────────────
test('recordToArticle builds a full article with sections and references', () => {
  const art = recordToArticle({
    title: 'Phoenix Protocol',
    summary: 'A **continuity** framework.',
    sections: [
      { heading: 'Origins', body: '# Start\n\n- a\n- b' },
      { heading: 'Method', body: '1. first\n2. second' },
    ],
    sources: ['Doe, J. (2017).', 'https://example.org/ref'],
  });

  assert.match(art, /'''Phoenix Protocol''' A '''continuity''' framework\./);
  assert.match(art, /== Origins ==/);
  assert.match(art, /== Method ==/);
  assert.match(art, /== References ==/);
  assert.match(art, /<ref>Doe, J\. \(2017\)\.<\/ref>/);
  assert.match(art, /<references \/>/);
});

test('recordToArticle omits References when there are no sources', () => {
  const art = recordToArticle({ title: 'T', summary: 'body' });
  assert.doesNotMatch(art, /References/);
  assert.match(art, /'''T''' body/);
});

test('recordToArticle skips missing sections and empty source entries', () => {
  const art = recordToArticle({
    summary: 'lead',
    sections: [{ heading: '', body: '' }, { heading: 'Real', body: 'text' }],
    sources: ['', '   ', 'keep'],
  });
  assert.match(art, /== Real ==/);
  assert.doesNotMatch(art, /== {2}==/); // no empty heading emitted
  assert.match(art, /<ref>keep<\/ref>/);
  // only one ref despite three source entries
  assert.equal((art.match(/<ref>/g) || []).length, 1);
});

test('recordToArticle title-only record yields a bold lead', () => {
  assert.equal(recordToArticle({ title: 'Solo' }), "'''Solo'''");
});

test('recordToArticle soft-fails on non-object input', () => {
  assert.equal(recordToArticle(null), '');
  assert.equal(recordToArticle('x'), '');
  assert.equal(recordToArticle([1]), '');
  assert.equal(recordToArticle({}), '');
});

// ── esc ──────────────────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters and soft-fails on null', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

// ── determinism ──────────────────────────────────────────────────────────────────────
test('mdToWikitext is deterministic', () => {
  const md = '# H\n\n- x\n- y\n\n[t](https://e.org)';
  assert.equal(mdToWikitext(md), mdToWikitext(md));
});
