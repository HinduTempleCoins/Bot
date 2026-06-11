// source-attribution.test.mjs — offline tests for the source-attribution / citation formatter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  formatAttribution,
  formatList,
  dedupeSources,
  toFootnotes,
} from './source-attribution.mjs';

// ── esc ─────────────────────────────────────────────────────────────────────
test('esc escapes the five HTML-significant chars and coerces null', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

// ── formatAttribution: happy path ───────────────────────────────────────────
test('formatAttribution renders all fields in canonical order', () => {
  const line = formatAttribution({
    title: 'Phoenix Protocol',
    author: 'Van Kush',
    url: 'https://melek/scripture/phoenix',
    publisher: 'MELEK',
    year: '2024',
    accessed: '2026-06-10',
    license: 'CC-BY',
  });
  assert.equal(
    line,
    'Van Kush. &quot;Phoenix Protocol.&quot; MELEK (2024). ' +
      '&lt;https://melek/scripture/phoenix&gt; [Accessed 2026-06-10]. License: CC-BY.',
  );
});

test('formatAttribution omits absent fields cleanly (no empty parens/separators)', () => {
  assert.equal(formatAttribution({ title: 'Just A Title' }), '&quot;Just A Title.&quot;');
  assert.equal(formatAttribution({ url: 'https://x/y' }), '&lt;https://x/y&gt;');
  assert.equal(
    formatAttribution({ title: 'T', year: '2020' }),
    '&quot;T.&quot; (2020).',
  );
  assert.equal(
    formatAttribution({ title: 'T', publisher: 'P' }),
    '&quot;T.&quot; P.',
  );
});

test('formatAttribution HTML-escapes every field', () => {
  const line = formatAttribution({
    title: 'A & B <x>',
    author: '"Quoted"',
    url: 'https://x/?a=1&b=2',
  });
  assert.ok(line.includes('A &amp; B &lt;x&gt;'));
  assert.ok(line.includes('&quot;Quoted&quot;'));
  assert.ok(line.includes('a=1&amp;b=2'));
  assert.ok(!line.includes('<x>'));
});

// ── formatAttribution: soft-fail ────────────────────────────────────────────
test('formatAttribution soft-fails to empty string on bad/empty input', () => {
  assert.equal(formatAttribution(null), '');
  assert.equal(formatAttribution(undefined), '');
  assert.equal(formatAttribution({}), '');
  assert.equal(formatAttribution('a string'), '');
  assert.equal(formatAttribution([]), '');
  assert.equal(formatAttribution({ author: 'only author' }), ''); // no title/url
  assert.equal(formatAttribution({ title: '   ', url: '  ' }), ''); // whitespace-only
});

// ── dedupeSources ───────────────────────────────────────────────────────────
test('dedupeSources is unique by normalized url, keeping the most complete', () => {
  const out = dedupeSources([
    { title: 'X', url: 'https://Example.com/Page/' },
    { title: 'X full', url: 'http://www.example.com/Page', author: 'A', year: '2020' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'X full'); // more complete record kept
  assert.equal(out[0].author, 'A');
});

test('dedupeSources is case/trailing-slash insensitive by title when no url', () => {
  const out = dedupeSources([
    { title: 'The Convergence' },
    { title: 'the convergence/' },
    { title: '  The   Convergence  ' },
  ]);
  assert.equal(out.length, 1);
});

test('dedupeSources preserves first-appearance order and skips bad entries', () => {
  const out = dedupeSources([
    { title: 'First', url: 'https://a' },
    null,
    'garbage',
    { author: 'no title or url' },
    { title: 'Second', url: 'https://b' },
    { title: 'First again', url: 'https://a/' }, // dup of First
  ]);
  assert.deepEqual(out.map((s) => s.url), ['https://a', 'https://b']);
  assert.equal(out[0].title, 'First'); // tie on completeness → first kept
});

test('dedupeSources returns [] for non-array / empty', () => {
  assert.deepEqual(dedupeSources(null), []);
  assert.deepEqual(dedupeSources('nope'), []);
  assert.deepEqual(dedupeSources([]), []);
  assert.deepEqual(dedupeSources([null, {}, 'x']), []);
});

// ── formatList ──────────────────────────────────────────────────────────────
test('formatList renders a deduped Markdown numbered list', () => {
  const md = formatList([
    { title: 'A', author: 'Alpha' },
    { title: 'B', url: 'https://b' },
    { title: 'A', author: 'Alpha' }, // dup
  ]);
  assert.equal(
    md,
    '1. Alpha. &quot;A.&quot;\n2. &quot;B.&quot; &lt;https://b&gt;',
  );
});

test('formatList returns empty string when nothing renderable', () => {
  assert.equal(formatList([]), '');
  assert.equal(formatList([null, {}, 'x']), '');
  assert.equal(formatList('not an array'), '');
});

// ── toFootnotes ─────────────────────────────────────────────────────────────
test('toFootnotes appends [n] markers and builds the footnote list', () => {
  const { text, footnotes } = toFootnotes('See the brief', [
    { title: 'A', author: 'Alpha' },
    { title: 'B', url: 'https://b' },
  ]);
  assert.equal(text, 'See the brief [1][2]');
  assert.equal(
    footnotes,
    '1. Alpha. &quot;A.&quot;\n2. &quot;B.&quot; &lt;https://b&gt;',
  );
});

test('toFootnotes dedupes sources before numbering', () => {
  const { text, footnotes } = toFootnotes('x', [
    { title: 'A', url: 'https://a' },
    { title: 'A', url: 'https://a/' },
  ]);
  assert.equal(text, 'x [1]');
  assert.equal(footnotes, '1. &quot;A.&quot; &lt;https://a&gt;');
});

test('toFootnotes escapes the input text', () => {
  const { text } = toFootnotes('a <b> & "c"', [{ title: 'S' }]);
  assert.equal(text, 'a &lt;b&gt; &amp; &quot;c&quot; [1]');
});

test('toFootnotes soft-fails: no usable sources → text unchanged, footnotes empty', () => {
  const r1 = toFootnotes('hello', []);
  assert.deepEqual(r1, { text: 'hello', footnotes: '' });
  const r2 = toFootnotes('hi', [null, {}, 'x']);
  assert.deepEqual(r2, { text: 'hi', footnotes: '' });
  const r3 = toFootnotes(null, []);
  assert.deepEqual(r3, { text: '', footnotes: '' });
});

test('toFootnotes with empty text but real sources yields just the markers', () => {
  const { text } = toFootnotes('', [{ title: 'A' }, { title: 'B' }]);
  assert.equal(text, '[1][2]');
});

// ── never throws (fuzz the public surface) ──────────────────────────────────
test('public API never throws on garbage', () => {
  const garbage = [undefined, null, 0, NaN, '', [], {}, { url: 5 }, Symbol.iterator];
  for (const g of garbage) {
    assert.doesNotThrow(() => formatAttribution(g));
    assert.doesNotThrow(() => formatList(g));
    assert.doesNotThrow(() => dedupeSources(g));
    assert.doesNotThrow(() => toFootnotes(g, g));
  }
});
