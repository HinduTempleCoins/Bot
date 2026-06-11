/**
 * Offline tests for src/chain/markdown-post-builder.mjs.
 * node:test + node:assert/strict, fully offline (pure assembler, no IO).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildComment,
  buildMetadata,
  normalizeTags,
  esc,
} from './markdown-post-builder.mjs';

// ---- buildComment: op shape (root post) ------------------------------------

test('buildComment returns a comment op tuple for a root post', () => {
  const op = buildComment({
    author: 'hathor',
    parentPermlink: 'melek',
    permlink: 'introducing-hathor',
    title: 'Hello',
    body: '# Hello, MELEK',
    tags: ['melek', 'witness'],
  });
  assert.ok(Array.isArray(op), 'op is a tuple');
  assert.equal(op[0], 'comment');
  const p = op[1];
  assert.equal(p.parent_author, '', 'root post has empty parent_author');
  assert.equal(p.parent_permlink, 'melek');
  assert.equal(p.author, 'hathor');
  assert.equal(p.permlink, 'introducing-hathor');
  assert.equal(p.title, 'Hello');
  assert.equal(p.body, '# Hello, MELEK');
  assert.equal(typeof p.json_metadata, 'string', 'json_metadata is stringified');
});

// ---- json_metadata round-trip ----------------------------------------------

test('json_metadata is valid JSON and round-trips with markdown format', () => {
  const op = buildComment({
    author: 'hathor',
    parentPermlink: 'melek',
    permlink: 'post-1',
    body: 'body',
    tags: ['Melek', 'Witness'],
    app: 'melek',
  });
  const meta = JSON.parse(op[1].json_metadata);
  assert.deepEqual(meta.tags, ['melek', 'witness']);
  assert.equal(meta.app, 'melek');
  assert.equal(meta.format, 'markdown');
});

test('buildMetadata defaults app to melek and includes images when given', () => {
  const m = buildMetadata({ tags: ['a'], images: ['http://x/y.png', '', '  '] });
  assert.equal(m.app, 'melek');
  assert.equal(m.format, 'markdown');
  assert.deepEqual(m.tags, ['a']);
  assert.deepEqual(m.image, ['http://x/y.png'], 'empty image entries dropped');
});

test('buildMetadata omits image key when no valid images', () => {
  const m = buildMetadata({ tags: ['a'], images: [] });
  assert.equal('image' in m, false);
  const m2 = buildMetadata({ tags: ['a'] });
  assert.equal('image' in m2, false);
});

test('buildMetadata custom app is honored and trimmed', () => {
  const m = buildMetadata({ tags: [], app: '  soapbox  ' });
  assert.equal(m.app, 'soapbox');
});

// ---- tag normalization / clamp ---------------------------------------------

test('normalizeTags lowercases, dedupes, preserves order', () => {
  assert.deepEqual(
    normalizeTags(['Melek', 'witness', 'MELEK', 'Witness', 'news']),
    ['melek', 'witness', 'news'],
  );
});

test('normalizeTags clamps to 5 and first tag is the category', () => {
  const t = normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(t.length, 5);
  assert.deepEqual(t, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(t[0], 'a', 'first tag is category');
});

test('normalizeTags drops empties/whitespace and soft-fails non-arrays', () => {
  assert.deepEqual(normalizeTags(['  a  ', '', '   ', 'b']), ['a', 'b']);
  assert.deepEqual(normalizeTags(null), []);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags('melek'), []);
  assert.deepEqual(normalizeTags(42), []);
});

// ---- root vs reply ----------------------------------------------------------

test('buildComment builds a reply when parentAuthor is set', () => {
  const op = buildComment({
    author: 'hathor',
    parentAuthor: 'alice',
    parentPermlink: 'her-post',
    permlink: 're-her-post',
    body: 'A reply.',
  });
  assert.equal(op[0], 'comment');
  assert.equal(op[1].parent_author, 'alice');
  assert.equal(op[1].parent_permlink, 'her-post');
  assert.equal(op[1].title, '', 'missing title coerces to empty string');
});

test('empty parentAuthor (default) yields a root post', () => {
  const op = buildComment({
    author: 'hathor',
    parentPermlink: 'melek',
    permlink: 'p',
  });
  assert.equal(op[1].parent_author, '');
});

// ---- soft-fail: missing required fields -> {error} -------------------------

test('buildComment returns an error marker when author is missing', () => {
  const r = buildComment({ parentPermlink: 'melek', permlink: 'p' });
  assert.ok(r && r.error, 'error marker present');
  assert.ok(!Array.isArray(r), 'not a tuple');
  assert.deepEqual(r.missing, ['author']);
});

test('buildComment reports all missing required fields, never throws', () => {
  const r = buildComment({});
  assert.ok(r.error.includes('author'));
  assert.ok(r.error.includes('parentPermlink'));
  assert.ok(r.error.includes('permlink'));
  assert.deepEqual(r.missing, ['author', 'parentPermlink', 'permlink']);
});

test('buildComment with no args does not throw', () => {
  assert.doesNotThrow(() => buildComment());
  assert.doesNotThrow(() => buildComment(undefined));
});

// ---- over-long body left intact --------------------------------------------

test('over-long body is left intact (caller concern)', () => {
  const big = 'x'.repeat(70000);
  const op = buildComment({
    author: 'hathor',
    parentPermlink: 'melek',
    permlink: 'p',
    body: big,
  });
  assert.equal(op[1].body.length, 70000);
});

// ---- esc --------------------------------------------------------------------

test('esc escapes HTML metacharacters and soft-fails non-strings', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});
