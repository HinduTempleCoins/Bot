import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  buildGlossary,
  lookup,
  renderGlossaryMarkdown,
  firstLetterIndex,
} from './glossary-builder.mjs';

test('esc escapes HTML-significant chars', () => {
  assert.equal(esc('<a href="x">A&B\'s</a>'),
    '&lt;a href=&quot;x&quot;&gt;A&amp;B&#39;s&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('buildGlossary normalizes terms and sorts case-insensitively', () => {
  const g = buildGlossary([
    { term: '  Zar  ', definition: 'a spirit rite', source: 'doc1' },
    { title: 'apple', summary: 'a fruit', source: 'doc2' },
    { term: 'Phoenix\tProtocol', definition: 'rebirth', source: 'doc3' },
  ]);
  assert.deepEqual(g.map((e) => e.term), ['apple', 'Phoenix Protocol', 'Zar']);
  assert.equal(g[0].definition, 'a fruit');
  assert.deepEqual(g[0].sources, ['doc2']);
  // collapsed internal whitespace
  assert.equal(g[1].term, 'Phoenix Protocol');
});

test('buildGlossary dedupes case-insensitively and merges defs + sources', () => {
  const g = buildGlossary([
    { term: 'MELEK', definition: 'the chain', source: 'a' },
    { term: 'melek', definition: 'the witness frame', source: 'b' },
    { term: 'Melek', definition: 'the chain', source: 'a' }, // dup def + dup source
  ]);
  assert.equal(g.length, 1);
  const e = g[0];
  assert.equal(e.term, 'MELEK'); // first-seen casing wins
  assert.equal(e.definition, 'the chain the witness frame');
  assert.deepEqual(e.sources, ['a', 'b']);
});

test('buildGlossary keeps missing definition as empty string', () => {
  const g = buildGlossary([{ term: 'Hathor', source: 'lineage' }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].definition, '');
  assert.deepEqual(g[0].sources, ['lineage']);
});

test('buildGlossary drops entries with no term', () => {
  const g = buildGlossary([
    { definition: 'orphan def', source: 's' },
    { term: '   ', definition: 'blank term' },
    { title: '', summary: 'empty title' },
    { term: 'Real', definition: 'kept' },
  ]);
  assert.deepEqual(g.map((e) => e.term), ['Real']);
});

test('buildGlossary minLen drops short terms (default 2)', () => {
  assert.deepEqual(buildGlossary([{ term: 'a', definition: 'x' }]).map((e) => e.term), []);
  assert.deepEqual(
    buildGlossary([{ term: 'a', definition: 'x' }], { minLen: 1 }).map((e) => e.term),
    ['a'],
  );
  assert.deepEqual(
    buildGlossary([{ term: 'abc', definition: 'x' }], { minLen: 4 }).map((e) => e.term),
    [],
  );
});

test('buildGlossary accepts an array of sources', () => {
  const g = buildGlossary([
    { term: 'Convergence', definition: 'd', sources: ['x', 'y'], source: 'z' },
  ]);
  assert.deepEqual(g[0].sources, ['x', 'y', 'z']);
});

test('buildGlossary soft-fails on garbage input', () => {
  assert.deepEqual(buildGlossary(null), []);
  assert.deepEqual(buildGlossary(undefined), []);
  assert.deepEqual(buildGlossary('nope'), []);
  assert.deepEqual(buildGlossary({}), []);
  assert.deepEqual(buildGlossary([null, 42, 'str', undefined]), []);
});

test('lookup is case-insensitive and trims', () => {
  const g = buildGlossary([{ term: 'Zar-AI', definition: 'd', source: 's' }]);
  assert.equal(lookup(g, '  zar-ai ').term, 'Zar-AI');
  assert.equal(lookup(g, 'ZAR-AI').definition, 'd');
  assert.equal(lookup(g, 'missing'), null);
  assert.equal(lookup(g, ''), null);
  assert.equal(lookup(null, 'x'), null);
});

test('renderGlossaryMarkdown produces esc()d alphabetized blocks', () => {
  const g = buildGlossary([
    { term: 'A&B', definition: 'tag <b>', source: 'src<1>' },
    { term: 'Plain', definition: 'no source' },
  ]);
  const md = renderGlossaryMarkdown(g);
  assert.match(md, /### A&amp;B/);
  assert.match(md, /tag &lt;b&gt;/);
  assert.match(md, /_sources: src&lt;1&gt;_/);
  assert.match(md, /### Plain\nno source/);
  // no raw angle brackets leaked
  assert.ok(!/<b>/.test(md));
  // blocks separated by blank line, A before Plain
  assert.ok(md.indexOf('### A&amp;B') < md.indexOf('### Plain'));
});

test('renderGlossaryMarkdown soft-fails and handles empty definition', () => {
  assert.equal(renderGlossaryMarkdown(null), '');
  assert.equal(renderGlossaryMarkdown('x'), '');
  const md = renderGlossaryMarkdown([{ term: 'Hathor', definition: '', sources: [] }]);
  assert.equal(md, '### Hathor\n');
});

test('firstLetterIndex groups by uppercased first letter', () => {
  const g = buildGlossary([
    { term: 'apple', definition: 'd' },
    { term: 'Avocado', definition: 'd' },
    { term: 'Banana', definition: 'd' },
    { term: '42 thing', definition: 'd' },
  ]);
  const idx = firstLetterIndex(g);
  assert.deepEqual(Object.keys(idx).sort(), ['#', 'A', 'B']);
  assert.deepEqual(idx.A.map((e) => e.term), ['apple', 'Avocado']);
  assert.deepEqual(idx.B.map((e) => e.term), ['Banana']);
  assert.deepEqual(idx['#'].map((e) => e.term), ['42 thing']);
});

test('firstLetterIndex soft-fails on garbage', () => {
  assert.deepEqual(firstLetterIndex(null), {});
  assert.deepEqual(firstLetterIndex('x'), {});
  assert.deepEqual(firstLetterIndex([null, {}, { term: '' }]), {});
});
